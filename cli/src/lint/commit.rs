use std::collections::{BTreeMap, HashSet};
use std::ffi::OsStr;
use std::io::Write;
use std::os::unix::ffi::OsStrExt as _;
use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};

use super::events::{Event, Kind, Log, Pending};
use super::fix::{Prior, generated_or_vendored, remove_new_plain_comments};
use super::process::{CallerIndex, GitProcess, lock_of};
use super::repo::{Attributes, GITLINK, Repo, SYMLINK, blobs, nul_paths, parse_raw, removed_lines, run_git};
use super::scan::{Change, Engine, language_of, sort};
use super::{Baseline, Finding, Settings, Severity};
use crate::paths;

const STATE_FILES: [&str; 6] = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "SQUASH_MSG", "rebase-merge", "rebase-apply"];
const SHOWN_ERRORS: usize = 20;
const SKIP_REMINDER: &str = "Skips are only for a rule that is wrong for this specific code, never to save time; every other change must pass before you continue.";
const HIGH_RATE: &str = "ai-stack lint: agents skip or bypass this check often in this repository. Fix findings instead; AI_STACK_LINT_SKIP is only for a rule that is wrong for this specific code.";

pub struct Env {
    pub cwd: PathBuf,
    pub index_file: Option<PathBuf>,
    pub skip: Option<String>,
    pub harness: Option<String>,
    pub git: GitProcess,
    pub now: u64,
}

impl Env {
    pub fn from_process() -> Result<Env> {
        let cwd = std::env::current_dir()?;
        let index_file = std::env::var_os("GIT_INDEX_FILE").map(|file| paths::normalize(&cwd.join(file)));
        Ok(Env {
            git: GitProcess::parent_of_this_hook(&cwd),
            cwd,
            index_file,
            skip: std::env::var("AI_STACK_LINT_SKIP").ok(),
            harness: std::env::var("AI_STACK_HARNESS").ok().filter(|harness| !harness.is_empty()),
            now: super::events::now(),
        })
    }
}

struct Git {
    root: PathBuf,
    git_dir: PathBuf,
    index: Option<PathBuf>,
}

impl Git {
    fn run<S: AsRef<OsStr>>(&self, args: &[S], input: &[u8]) -> Result<Vec<u8>> {
        match &self.index {
            Some(index) => self.run_on(index, args, input),
            None => run_git(&self.root, args, input, &[]),
        }
    }

    fn run_on<S: AsRef<OsStr>>(&self, index: &Path, args: &[S], input: &[u8]) -> Result<Vec<u8>> {
        run_git(&self.root, args, input, &[("GIT_INDEX_FILE", index.as_os_str())])
    }

    fn text<S: AsRef<OsStr>>(&self, args: &[S]) -> Result<String> {
        Ok(String::from_utf8_lossy(&self.run(args, &[])?).trim().to_string())
    }

    fn empty_tree(&self) -> Result<String> {
        self.text(&["hash-object", "-t", "tree", "/dev/null"])
    }

    fn patch(&self, base: &str, text: bool) -> Result<Vec<u8>> {
        let mut args = vec!["diff-index", "--cached", "-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"];
        if text {
            args.push("--text");
        }
        args.push(base);
        self.run(&args, &[])
    }
}

struct Checkout {
    git: Git,
    repo: Repo,
}

fn open(settings: &Settings, env: &Env) -> Result<Option<Checkout>> {
    let out = run_git(&env.cwd, &["rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir"], &[], &[])?;
    let mut lines = out.split(|&byte| byte == b'\n');
    let root = paths::resolve(Path::new(OsStr::from_bytes(lines.next().context("git rev-parse printed no top level")?)));
    let git_dir = PathBuf::from(OsStr::from_bytes(lines.next().context("git rev-parse printed no git dir")?));
    if STATE_FILES.iter().any(|name| git_dir.join(name).exists()) {
        return Ok(None);
    }
    let repo = Repo::discover(&root).context("the repository could not be read")?;
    if !settings.policy(Some(&repo)).enabled() {
        return Ok(None);
    }
    Ok(Some(Checkout { git: Git { root, git_dir, index: env.index_file.clone() }, repo }))
}

struct Staged {
    rel: PathBuf,
    mode: String,
    blob: String,
    baseline: Baseline,
    source: String,
}

enum Target<'a> {
    Index,
    Commit(&'a str),
}

enum PartialIndex {
    None,
    Lock(PathBuf),
    Unknown,
}

impl Checkout {
    fn staged(&self, base: &str, target: Target) -> Result<Vec<Staged>> {
        let diff = match target {
            Target::Index => self.git.run(&["diff-index", "--cached", "-z", "-M", "--no-abbrev", base], &[])?,
            Target::Commit(commit) => self.git.run(&["diff-tree", "-r", "-z", "-M", "--no-abbrev", base, commit], &[])?,
        };
        let entries: Vec<_> = parse_raw(&diff)?.into_iter().filter(|entry| entry.new_mode != GITLINK && entry.new_mode != SYMLINK && language_of(&entry.path).is_some()).collect();
        let ids = entries.iter().flat_map(|entry| [entry.new_id.as_str()].into_iter().chain((!entry.absent_before()).then_some(entry.old_id.as_str())));
        let blobs = blobs(&self.git.root, ids, |args, input| self.git.run(args, input))?;
        let mut staged = Vec::new();
        for entry in entries {
            let new = blobs.get(&entry.new_id).with_context(|| format!("git cat-file did not return {}", entry.new_id))?;
            let Ok(source) = String::from_utf8(new.clone()) else { continue };
            let baseline = match entry.absent_before() {
                true => Baseline::Absent,
                false => Baseline::Text(String::from_utf8_lossy(blobs.get(&entry.old_id).with_context(|| format!("git cat-file did not return {}", entry.old_id))?).into_owned()),
            };
            staged.push(Staged { rel: entry.path, mode: entry.new_mode, blob: entry.new_id, baseline, source });
        }
        Ok(staged)
    }

    fn changes(&self, staged: &[Staged]) -> Vec<Change> {
        staged.iter().filter_map(|file| Change::new(self.git.root.join(&file.rel), file.source.clone(), &file.baseline)).collect()
    }

    fn engine<'a>(&'a self, settings: &'a Settings, rules: &'a super::rules::Rules) -> Engine<'a> {
        Engine { settings, rules, scope: None, display: &self.git.root, attributes: Attributes::Index(self.git.index.clone()) }
    }

    fn base(&self) -> Result<String> {
        match self.repo.head() {
            Some(head) => Ok(head),
            None => self.git.empty_tree(),
        }
    }

    fn skip_worktree(&self, rels: &[PathBuf]) -> HashSet<PathBuf> {
        let mut args: Vec<&OsStr> = ["ls-files", "-t", "-z", "--"].map(OsStr::new).to_vec();
        args.extend(rels.iter().map(|rel| rel.as_os_str()));
        let Ok(out) = self.git.run(&args, &[]) else { return rels.iter().cloned().collect() };
        nul_paths(&out).filter_map(|tagged| tagged.as_os_str().as_bytes().strip_prefix(b"S ").map(super::repo::path_of)).collect()
    }

    fn narrow(&self, base: &str) -> Result<Narrow> {
        let mut narrow = Narrow::default();
        for line in self.git.patch(base, true)?.split(|&byte| byte == b'\n') {
            if line.starts_with(b"diff --git ") {
                narrow.files += 1;
            } else if let Some(header) = line.strip_prefix(b"@@ -") {
                narrow.hunks += 1;
                let header = String::from_utf8_lossy(header);
                let mut counts = header.split(' ').take(2).map(|side| side.trim_start_matches('+').split_once(',').map_or(1, |(_, count)| count.parse().unwrap_or(1)));
                narrow.lines += counts.next().unwrap_or(0).max(counts.next().unwrap_or(0));
            }
        }
        Ok(narrow)
    }

    fn file_mode_tracked(&self) -> bool {
        self.git.text(&["config", "--type=bool", "core.fileMode"]).map_or(true, |value| value != "false")
    }

    fn partial_index(&self, env: &Env) -> PartialIndex {
        let Some(name) = self.git.index.as_ref().and_then(|index| index.file_name()).map(OsStr::as_bytes) else { return PartialIndex::None };
        if !(name.starts_with(b"next-index-") && name.ends_with(b".lock")) {
            return PartialIndex::None;
        }
        let lock = match &env.git.index {
            CallerIndex::File(index) => lock_of(index),
            CallerIndex::Default | CallerIndex::Unknown => self.git.git_dir.join("index.lock"),
        };
        match lock.exists() {
            true => PartialIndex::Lock(lock),
            false => PartialIndex::Unknown,
        }
    }

    fn rewrite_index(&self, file: &Staged, id: &str, partial: &PartialIndex) -> Result<()> {
        let mut info = format!("{} {}\t", file.mode, id).into_bytes();
        info.extend_from_slice(file.rel.as_os_str().as_bytes());
        info.push(0);
        self.git.run(&["update-index", "-z", "--index-info"], &info)?;
        if let PartialIndex::Lock(real) = partial {
            let listed = self.git.run_on(real, &[OsStr::new("ls-files"), OsStr::new("-s"), OsStr::new("-z"), OsStr::new("--"), file.rel.as_os_str()], &[])?;
            if String::from_utf8_lossy(&listed).split(' ').nth(1) == Some(file.blob.as_str()) {
                self.git.run_on(real, &["update-index", "-z", "--index-info"], &info)?;
            }
        }
        Ok(())
    }

    fn rewrite_worktree(&self, file: &Staged, id: &str, modes: bool) -> Result<Worktree> {
        let path = self.git.root.join(&file.rel);
        let Ok(meta) = std::fs::symlink_metadata(&path) else { return Ok(Worktree::Untouched) };
        let executable = meta.permissions().mode() & 0o100 != 0;
        if !meta.is_file() || meta.nlink() != 1 || (modes && executable != (file.mode == "100755")) {
            return Ok(Worktree::Untouched);
        }
        let path_arg = [b"--path=".as_slice(), file.rel.as_os_str().as_bytes()].concat();
        let current = String::from_utf8(self.git.run(&[OsStr::new("hash-object"), OsStr::from_bytes(&path_arg), OsStr::new("--"), path.as_os_str()], &[])?)?.trim().to_string();
        if current != file.blob {
            return Ok(Worktree::Untouched);
        }
        let smudged = self.git.run(&[OsStr::new("cat-file"), OsStr::new("--filters"), OsStr::from_bytes(&path_arg), OsStr::new(id)], &[])?;
        std::fs::OpenOptions::new().write(true).truncate(true).open(&path)?.write_all(&smudged)?;
        Ok(Worktree::Rewritten)
    }

    fn eligible(&self, staged: &[&Staged]) -> Result<HashSet<PathBuf>> {
        let rels: Vec<PathBuf> = staged.iter().map(|file| file.rel.clone()).collect();
        let filtered = self.repo.filtered(&rels, &Attributes::Index(self.git.index.clone()))?;
        let sparse = self.skip_worktree(&rels);
        Ok(staged
            .iter()
            .filter(|file| !filtered.contains(&file.rel) && !sparse.contains(&file.rel) && !generated_or_vendored(&file.rel, &file.source))
            .filter(|file| std::fs::symlink_metadata(self.git.root.join(&file.rel)).map_or(true, |meta| meta.nlink() == 1))
            .map(|file| file.rel.clone())
            .collect())
    }
}

#[derive(Default)]
struct Narrow {
    files: usize,
    hunks: usize,
    lines: usize,
}

enum Worktree {
    Rewritten,
    Untouched,
}

fn named(findings: &[&Finding]) -> Vec<String> {
    findings.iter().map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect()
}

fn plural(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

pub fn pre_commit(state_dir: &Path, settings: Result<Settings>, env: &Env, err: &mut dyn Write) -> i32 {
    if !env.git.from_shell {
        return 0;
    }
    let log = Log::new(state_dir);
    let _ = log.mark(&env.git.id, &Pending::Nothing);
    let outcome = settings.and_then(|settings| {
        if !settings.enabled {
            return Ok(0);
        }
        match open(&settings, env)? {
            Some(checkout) => check(&settings, &checkout, &log, env, err),
            None => Ok(0),
        }
    });
    outcome.unwrap_or_else(|error| {
        let _ = writeln!(err, "ai-stack lint: skipped ({})", format!("{error:#}").lines().next().unwrap_or_default());
        0
    })
}

fn check(settings: &Settings, checkout: &Checkout, log: &Log, env: &Env, err: &mut dyn Write) -> Result<i32> {
    let rules = settings.rules()?;
    let engine = checkout.engine(settings, &rules);
    let base = checkout.base()?;
    if checkout.git.run(&["diff-index", "--cached", "--quiet", &base], &[]).is_ok() {
        return Ok(0);
    }
    let staged = checkout.staged(&base, Target::Index)?;
    let findings = engine.lint(&checkout.changes(&staged));
    let (fixable, unfixable): (Vec<&Finding>, Vec<&Finding>) = findings.iter().filter(|finding| finding.severity == Severity::Error).partition(|finding| finding.fix.is_some());
    let project = &checkout.repo.project_key;
    let mut lines: Vec<String> = Vec::new();
    if log.rate(project, settings.skip_alert, env.now).over(settings.skip_alert) {
        lines.push(HIGH_RATE.into());
    }
    let reason = env.skip.as_deref().map(str::trim).filter(|reason| !reason.is_empty());
    if env.skip.is_some() && reason.is_none() {
        lines.push("ai-stack lint: AI_STACK_LINT_SKIP needs a reason, so this commit is checked as usual.".into());
    }
    let exceptions: Vec<&Finding> = unfixable.iter().chain(&fixable).copied().collect();
    if let Some(reason) = reason
        && !exceptions.is_empty()
    {
        let narrow = checkout.narrow(&base)?;
        let limits = settings.skip;
        if narrow.files > limits.files || narrow.hunks > limits.hunks || narrow.lines > limits.lines || exceptions.len() > limits.findings {
            lines.push(format!(
                "ai-stack lint: a skip must be its own commit containing only the exception (at most {} file, {} hunk, {} changed lines and {} findings; this commit has {}, {}, {} and {}). Commit the rest without a skip first.",
                limits.files, limits.hunks, limits.lines, limits.findings, narrow.files, narrow.hunks, narrow.lines, exceptions.len()
            ));
            print(err, &lines);
            return Ok(1);
        }
        let mut exceptions = exceptions;
        exceptions.sort_by(|a, b| (&a.path, a.line, a.column, &a.rule).cmp(&(&b.path, b.line, b.column, &b.rule)));
        let findings = named(&exceptions);
        let pending = Pending::Skip { findings: findings.clone(), reason: reason.to_string() };
        if let Err(error) = log.writable().and_then(|()| log.mark(&env.git.id, &pending)) {
            lines.push(format!("ai-stack lint: the skip could not be recorded ({}), so this commit is refused.", format!("{error:#}").lines().next().unwrap_or_default()));
            print(err, &lines);
            return Ok(1);
        }
        lines.push(format!("ai-stack lint: skip recorded for {} ({reason}). {SKIP_REMINDER}", findings.join(", ")));
        print(err, &lines);
        return Ok(0);
    }

    let mut by_file: BTreeMap<&Path, Vec<&Finding>> = BTreeMap::new();
    for finding in &fixable {
        by_file.entry(finding.file.as_path()).or_default().push(finding);
    }
    let candidates: Vec<&Staged> = staged.iter().filter(|file| by_file.contains_key(checkout.git.root.join(&file.rel).as_path())).collect();
    let eligible = if candidates.is_empty() { HashSet::new() } else { checkout.eligible(&candidates)? };
    let removed_text = if eligible.is_empty() { String::new() } else { removed_lines(&checkout.git.patch(&base, false)?) };
    let partial = checkout.partial_index(env);
    let modes = checkout.file_mode_tracked();
    let mut fixed_files: Vec<(PathBuf, String)> = Vec::new();
    let mut removed = 0;
    let mut unstaged: Vec<String> = Vec::new();
    for file in candidates.into_iter().filter(|file| eligible.contains(&file.rel)) {
        let path = checkout.git.root.join(&file.rel);
        let found = &by_file[path.as_path()];
        let language = language_of(&path).context("staged files are lintable")?;
        let ranges: Vec<_> = found.iter().map(|finding| finding.bytes.clone()).collect();
        let prior = Prior { file: match &file.baseline { Baseline::Text(text) => Some(text.as_str()), Baseline::Absent => None }, removed: &removed_text };
        let Some(fixed) = remove_new_plain_comments(language, &file.source, &ranges, &prior) else { continue };
        let id = String::from_utf8(checkout.git.run(&["hash-object", "-w", "--no-filters", "--stdin"], fixed.text.as_bytes())?)?.trim().to_string();
        if !matches!(partial, PartialIndex::Unknown) && checkout.rewrite_index(file, &id, &partial).is_err() {
            continue;
        }
        if matches!(checkout.rewrite_worktree(file, &id, modes).unwrap_or(Worktree::Untouched), Worktree::Untouched) {
            unstaged.push(found[0].path.clone());
        }
        removed += fixed.removed;
        fixed_files.push((path, fixed.text));
    }
    let kept = fixable.len() - removed;
    let fixed_names: Vec<String> = fixed_files.iter().map(|(path, _)| checkout.repo.relative(path).unwrap_or_else(|| path.clone()).display().to_string()).collect();
    if matches!(partial, PartialIndex::Unknown) && removed > 0 {
        lines.push(format!("ai-stack lint: removed {} in {}; rerun the same commit.", plural(removed, "comment"), fixed_names.join(", ")));
        print(err, &lines);
        return Ok(1);
    }

    let mut unfixable: Vec<Finding> = unfixable.into_iter().cloned().collect();
    if !fixed_files.is_empty() {
        let fixed_paths: HashSet<&Path> = fixed_files.iter().map(|(path, _)| path.as_path()).collect();
        unfixable.retain(|finding| !fixed_paths.contains(finding.file.as_path()));
        let rescanned: Vec<Change> = fixed_files
            .iter()
            .filter_map(|(path, fixed)| {
                let file = staged.iter().find(|file| checkout.git.root.join(&file.rel) == *path)?;
                Change::new(path.clone(), fixed.clone(), &file.baseline)
            })
            .collect();
        unfixable.extend(engine.lint(&rescanned).into_iter().filter(|finding| finding.severity == Severity::Error && finding.fix.is_none()));
        sort(&mut unfixable);
    }
    if !unstaged.is_empty() {
        lines.push(format!("ai-stack lint: {} {} unstaged changes, so only the staged version was fixed.", unstaged.join(", "), if unstaged.len() == 1 { "has" } else { "have" }));
    }
    if !unfixable.is_empty() {
        let mut explained = HashSet::new();
        for finding in unfixable.iter().take(SHOWN_ERRORS) {
            let message = if explained.insert(finding.rule.as_str()) { format!(": {}", finding.message) } else { String::new() };
            lines.push(format!("{}:{} {}{message}", finding.path, finding.line, finding.rule));
        }
        if unfixable.len() > SHOWN_ERRORS {
            lines.push(format!("and {} more", unfixable.len() - SHOWN_ERRORS));
        }
        lines.push("Fix these, or commit with AI_STACK_LINT_SKIP=\"<reason>\" if a rule is wrong here.".into());
        print(err, &lines);
        return Ok(1);
    }
    let mut summary = Vec::new();
    if removed > 0 {
        summary.push(format!("removed {} in {}", plural(removed, "comment"), fixed_names.join(", ")));
    }
    if kept > 0 {
        summary.push(format!("kept {} (pre-existing or tool-read)", plural(kept, "comment")));
    }
    if !summary.is_empty() {
        lines.push(format!("ai-stack lint: {}", summary.join("; ")));
    }
    let _ = log.mark(&env.git.id, &Pending::Checked);
    print(err, &lines);
    Ok(0)
}

fn print(err: &mut dyn Write, lines: &[String]) {
    for line in lines {
        let _ = writeln!(err, "{line}");
    }
}

pub fn post_commit(state_dir: &Path, settings: Result<Settings>, env: &Env) -> i32 {
    if !env.git.from_shell {
        return 0;
    }
    let log = Log::new(state_dir);
    let _ = settings.and_then(|settings| {
        if !settings.enabled {
            return Ok(());
        }
        let pending = log.take_mark(&env.git.id);
        let Some(checkout) = open(&settings, env)? else { return Ok(()) };
        let subject = checkout.git.text(&["log", "-g", "-1", "--format=%gs", "HEAD"])?;
        if !["commit: ", "commit (amend): ", "commit (initial): "].iter().any(|action| subject.starts_with(action)) {
            return Ok(());
        }
        let event = |kind, findings: Vec<String>, reason| Event { time: env.now, kind, repo: checkout.repo.project_key.clone(), harness: env.harness.clone(), head: checkout.repo.head(), findings, reason };
        match pending {
            Some(Pending::Nothing) => return Ok(()),
            Some(Pending::Checked) => log.record(&event(Kind::Checked, Vec::new(), None))?,
            Some(Pending::Skip { findings, reason }) => log.record(&event(Kind::Skip, findings, Some(reason)))?,
            None => {
                let rules = settings.rules()?;
                let parent = match checkout.git.text(&["rev-parse", "--verify", "--quiet", "HEAD^1"]) {
                    Ok(parent) if !parent.is_empty() => parent,
                    _ => checkout.git.empty_tree()?,
                };
                let staged = checkout.staged(&parent, Target::Commit("HEAD"))?;
                let engine = Engine { attributes: Attributes::Index(None), ..checkout.engine(&settings, &rules) };
                let errors: Vec<Finding> = engine.lint(&checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error && finding.fix.is_none()).collect();
                if errors.is_empty() {
                    return Ok(());
                }
                let bypass = event(Kind::Bypassed, named(&errors.iter().collect::<Vec<_>>()), None);
                log.record(&bypass)?;
                let short = bypass.head.as_deref().map_or("HEAD", |head| &head[..head.len().min(12)]);
                let who = env.harness.as_deref().map_or("An agent".to_string(), |harness| format!("A {harness} agent"));
                let shown: Vec<String> = bypass.findings.iter().take(5).cloned().collect();
                log.queue_notice(
                    &checkout.repo.project_key,
                    &format!("ai-stack lint: {who} committed {short} in {} without the commit check (--no-verify or hooks turned off), with {}: {}.", checkout.repo.project_key.display(), plural(errors.len(), "error finding"), shown.join(", ")),
                )?;
            }
        }
        log.alert(&checkout.repo.project_key, settings.skip_alert, env.now)?;
        Ok(())
    });
    0
}
