use std::collections::{BTreeMap, HashSet};
use std::ffi::OsStr;
use std::io::Write;
use std::os::unix::ffi::OsStrExt as _;
use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};

use super::events::{self, Event, Kind, Log};
use super::fix::delete_comments;
use super::repo::{GITLINK, Repo, SYMLINK, blobs, nul_joined, nul_paths, parse_raw, run_git};
use super::scan::{Change, Engine, language_of, sort};
use super::{Baseline, Finding, Settings, Severity};
use crate::paths;

const LFS_POINTER: &[u8] = b"version https://git-lfs.github.com/spec/";
const STATE_FILES: [&str; 6] = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "SQUASH_MSG", "rebase-merge", "rebase-apply"];
const SHOWN_ERRORS: usize = 20;
const SKIP_REMINDER: &str = "Skips are only for a rule that is wrong for this specific code, never to save time; every other change must pass before you continue.";
const HIGH_RATE: &str = "ai-stack lint: agents skip or bypass this check often in this repository. Fix findings instead; AI_STACK_LINT_SKIP is only for a rule that is wrong for this specific code.";

pub struct Env {
    pub cwd: PathBuf,
    pub index_file: Option<PathBuf>,
    pub skip: Option<String>,
    pub harness: Option<String>,
    pub throwaway: Vec<PathBuf>,
    pub commit_process: String,
    pub now: u64,
}

impl Env {
    pub fn from_process() -> Result<Env> {
        let cwd = std::env::current_dir()?;
        let index_file = std::env::var_os("GIT_INDEX_FILE").map(|file| paths::normalize(&cwd.join(file)));
        let throwaway = [std::env::temp_dir(), PathBuf::from("/tmp")].into_iter().chain(std::env::var_os("TMPDIR").map(PathBuf::from)).map(|dir| paths::resolve(&dir)).collect();
        Ok(Env {
            cwd,
            index_file,
            skip: std::env::var("AI_STACK_LINT_SKIP").ok(),
            harness: std::env::var("AI_STACK_HARNESS").ok().filter(|harness| !harness.is_empty()),
            throwaway,
            commit_process: events::parent_commit_process(),
            now: events::now(),
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
    if env.throwaway.iter().any(|dir| root.starts_with(dir)) || STATE_FILES.iter().any(|name| git_dir.join(name).exists()) {
        return Ok(None);
    }
    let hooks_paths = std::process::Command::new("git").arg("-C").arg(&root).args(["config", "--get-all", "core.hooksPath"]).output()?;
    if String::from_utf8_lossy(&hooks_paths.stdout).lines().any(|path| path.trim() == "/dev/null") {
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
            if new.starts_with(LFS_POINTER) {
                continue;
            }
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

    fn base(&self) -> Result<String> {
        match self.repo.head() {
            Some(head) => Ok(head),
            None => self.git.empty_tree(),
        }
    }

    fn filtered(&self, rels: &[PathBuf]) -> HashSet<PathBuf> {
        let Ok(out) = self.git.run(&["check-attr", "--cached", "-z", "--stdin", "filter"], &nul_joined(rels)) else { return rels.iter().cloned().collect() };
        let fields: Vec<&[u8]> = out.split(|&byte| byte == 0).collect();
        fields.chunks(3).filter(|chunk| chunk.len() == 3 && !matches!(chunk[2], b"unspecified" | b"unset")).map(|chunk| super::repo::path_of(chunk[0])).collect()
    }

    fn skip_worktree(&self, rels: &[PathBuf]) -> HashSet<PathBuf> {
        let mut args: Vec<&OsStr> = ["ls-files", "-t", "-z", "--"].map(OsStr::new).to_vec();
        args.extend(rels.iter().map(|rel| rel.as_os_str()));
        let Ok(out) = self.git.run(&args, &[]) else { return rels.iter().cloned().collect() };
        nul_paths(&out).filter_map(|tagged| tagged.as_os_str().as_bytes().strip_prefix(b"S ").map(super::repo::path_of)).collect()
    }

    fn narrow(&self, base: &str) -> Result<Narrow> {
        let patch = self.git.run(&["diff-index", "--cached", "-U0", "--no-color", "--no-ext-diff", "--no-renames", base], &[])?;
        let mut narrow = Narrow::default();
        for line in patch.split(|&byte| byte == b'\n') {
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

    fn rewrite(&self, file: &Staged, fixed: &str, pathspec_index: Option<&Path>) -> Result<Worktree> {
        let id = String::from_utf8(self.git.run(&["hash-object", "-w", "--no-filters", "--stdin"], fixed.as_bytes())?)?.trim().to_string();
        let info = |path: &Path| -> Vec<u8> {
            let mut line = format!("{} {}\t", file.mode, id).into_bytes();
            line.extend_from_slice(path.as_os_str().as_bytes());
            line.push(0);
            line
        };
        self.git.run(&["update-index", "-z", "--index-info"], &info(&file.rel))?;
        if let Some(real) = pathspec_index {
            let listed = self.git.run_on(real, &[OsStr::new("ls-files"), OsStr::new("-s"), OsStr::new("-z"), OsStr::new("--"), file.rel.as_os_str()], &[])?;
            let holds_original = String::from_utf8_lossy(&listed).split(' ').nth(1) == Some(file.blob.as_str());
            if holds_original {
                self.git.run_on(real, &["update-index", "-z", "--index-info"], &info(&file.rel))?;
            }
        }
        let path = self.git.root.join(&file.rel);
        let Ok(meta) = std::fs::symlink_metadata(&path) else { return Ok(Worktree::Untouched) };
        let executable = meta.permissions().mode() & 0o100 != 0;
        if !meta.is_file() || executable != (file.mode == "100755") {
            return Ok(Worktree::Untouched);
        }
        let mut args: Vec<&OsStr> = vec![OsStr::new("hash-object")];
        let path_arg = [b"--path=".as_slice(), file.rel.as_os_str().as_bytes()].concat();
        args.push(OsStr::from_bytes(&path_arg));
        args.extend([OsStr::new("--"), path.as_os_str()]);
        let current = String::from_utf8(self.git.run(&args, &[])?)?.trim().to_string();
        if current != file.blob {
            return Ok(Worktree::Untouched);
        }
        let smudged = self.git.run(&[OsStr::new("cat-file"), OsStr::new("--filters"), OsStr::from_bytes(&path_arg), OsStr::new(&id)], &[])?;
        std::fs::OpenOptions::new().write(true).truncate(true).open(&path)?.write_all(&smudged)?;
        Ok(Worktree::Rewritten)
    }

    fn pathspec_index(&self) -> Option<PathBuf> {
        let index = self.git.index.as_ref()?;
        let name = index.file_name()?.as_bytes();
        (name.starts_with(b"next-index-") && name.ends_with(b".lock")).then(|| self.git.git_dir.join("index.lock")).filter(|real| real.exists())
    }

    fn event(&self, env: &Env, kind: Kind, findings: &[Finding], reason: Option<String>) -> Event {
        Event {
            time: env.now,
            kind,
            repo: self.repo.project_key.clone(),
            harness: env.harness.clone(),
            head: self.repo.head(),
            findings: findings.iter().map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect(),
            reason,
        }
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

pub fn pre_commit(state_dir: &Path, settings: Result<Settings>, env: &Env, err: &mut dyn Write) -> i32 {
    let log = Log::new(state_dir);
    let _ = log.mark(&env.commit_process);
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
    let engine = Engine { settings, rules: &rules, scope: None, display: &checkout.git.root };
    let base = checkout.base()?;
    let staged = checkout.staged(&base, Target::Index)?;
    let changes = checkout.changes(&staged);
    let findings = engine.lint(&changes);
    let errors: Vec<&Finding> = findings.iter().filter(|finding| finding.severity == Severity::Error).collect();
    let project = &checkout.repo.project_key;
    let mut lines: Vec<String> = Vec::new();
    if log.over(project) {
        lines.push(HIGH_RATE.into());
    }
    let reason = env.skip.as_deref().map(str::trim).filter(|reason| !reason.is_empty());
    if env.skip.is_some() && reason.is_none() {
        lines.push("ai-stack lint: AI_STACK_LINT_SKIP needs a reason, so this commit is checked as usual.".into());
    }
    if let Some(reason) = reason
        && !errors.is_empty()
    {
        let narrow = checkout.narrow(&base)?;
        let limits = settings.skip;
        if narrow.files > limits.files || narrow.hunks > limits.hunks || narrow.lines > limits.lines || errors.len() > limits.findings {
            lines.push(format!(
                "ai-stack lint: a skip must be its own commit containing only the exception (at most {} file, {} hunk, {} changed lines and {} findings; this commit has {}, {}, {} and {}). Commit the rest without a skip first.",
                limits.files, limits.hunks, limits.lines, limits.findings, narrow.files, narrow.hunks, narrow.lines, errors.len()
            ));
            print(err, &lines);
            return Ok(1);
        }
        let skipped: Vec<Finding> = errors.into_iter().cloned().collect();
        log.record(&checkout.event(env, Kind::Checked, &[], None))?;
        log.record(&checkout.event(env, Kind::Skip, &skipped, Some(reason.to_string())))?;
        let named: Vec<String> = skipped.iter().map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect();
        lines.push(format!("ai-stack lint: skip recorded for {} ({reason}). {SKIP_REMINDER}", named.join(", ")));
        log.alert(project, settings.skip_alert, env.now)?;
        print(err, &lines);
        return Ok(0);
    }
    let mut by_file: BTreeMap<&Path, Vec<&Finding>> = BTreeMap::new();
    for finding in errors.iter().filter(|finding| finding.fix.is_some()) {
        by_file.entry(finding.file.as_path()).or_default().push(finding);
    }
    let candidates: Vec<&Staged> = staged.iter().filter(|file| by_file.contains_key(checkout.git.root.join(&file.rel).as_path())).collect();
    let rels: Vec<PathBuf> = candidates.iter().map(|file| file.rel.clone()).collect();
    let (filtered, sparse) = if rels.is_empty() { Default::default() } else { (checkout.filtered(&rels), checkout.skip_worktree(&rels)) };
    let pathspec_index = checkout.pathspec_index();
    let mut fixed_files: Vec<(PathBuf, String)> = Vec::new();
    let mut removed = 0;
    let mut kept: Vec<String> = Vec::new();
    let mut unstaged: Vec<String> = Vec::new();
    for file in candidates {
        let path = checkout.git.root.join(&file.rel);
        let found = &by_file[path.as_path()];
        let shown = found[0].path.clone();
        let refusal = if filtered.contains(&file.rel) {
            Some("it has a filter attribute".to_string())
        } else if sparse.contains(&file.rel) {
            Some("it is outside the sparse checkout".to_string())
        } else {
            let language = language_of(&path).expect("staged files are lintable");
            let ranges: Vec<_> = found.iter().map(|finding| finding.bytes.clone()).collect();
            match delete_comments(language, &file.source, &ranges) {
                Err(refusal) => Some(refusal.reason().to_string()),
                Ok(fixed) => match checkout.rewrite(file, &fixed, pathspec_index.as_deref()) {
                    Err(error) => Some(format!("the index could not be updated: {}", format!("{error:#}").lines().next().unwrap_or_default())),
                    Ok(worktree) => {
                        if matches!(worktree, Worktree::Untouched) {
                            unstaged.push(shown.clone());
                        }
                        removed += found.len();
                        fixed_files.push((path.clone(), fixed));
                        None
                    }
                },
            }
        };
        if let Some(reason) = refusal {
            kept.push(format!("{shown}: comments kept because {reason}"));
        }
    }
    let mut findings = findings;
    if !fixed_files.is_empty() {
        let fixed_paths: HashSet<&Path> = fixed_files.iter().map(|(path, _)| path.as_path()).collect();
        findings.retain(|finding| !fixed_paths.contains(finding.file.as_path()));
        let rescanned: Vec<Change> = fixed_files
            .iter()
            .filter_map(|(path, fixed)| {
                let file = staged.iter().find(|file| checkout.git.root.join(&file.rel) == *path)?;
                Change::new(path.clone(), fixed.clone(), &file.baseline)
            })
            .collect();
        findings.extend(engine.lint(&rescanned));
        sort(&mut findings);
    }
    let remaining: Vec<&Finding> = findings.iter().filter(|finding| finding.severity == Severity::Error).collect();
    lines.extend(kept);
    if !unstaged.is_empty() {
        lines.push(format!("ai-stack lint: {} {} unstaged changes, so only the staged version was fixed.", unstaged.join(", "), if unstaged.len() == 1 { "has" } else { "have" }));
    }
    if !remaining.is_empty() {
        let mut explained = HashSet::new();
        for finding in remaining.iter().take(SHOWN_ERRORS) {
            let message = if explained.insert(finding.rule.as_str()) { format!(": {}", finding.message) } else { String::new() };
            lines.push(format!("{}:{} {}{message}", finding.path, finding.line, finding.rule));
        }
        if remaining.len() > SHOWN_ERRORS {
            lines.push(format!("and {} more", remaining.len() - SHOWN_ERRORS));
        }
        lines.push("Fix these, or commit with AI_STACK_LINT_SKIP=\"<reason>\" if a rule is wrong here.".into());
        print(err, &lines);
        return Ok(1);
    }
    if removed > 0 {
        let names: Vec<String> = fixed_files.iter().map(|(path, _)| checkout.repo.relative(path).unwrap_or_else(|| path.clone()).display().to_string()).collect();
        lines.push(format!("ai-stack lint: removed {removed} comment{} in {}", if removed == 1 { "" } else { "s" }, names.join(", ")));
    }
    log.record(&checkout.event(env, Kind::Checked, &[], None))?;
    log.alert(project, settings.skip_alert, env.now)?;
    print(err, &lines);
    Ok(0)
}

fn print(err: &mut dyn Write, lines: &[String]) {
    for line in lines {
        let _ = writeln!(err, "{line}");
    }
}

pub fn post_commit(state_dir: &Path, settings: Result<Settings>, env: &Env) -> i32 {
    let log = Log::new(state_dir);
    let _ = settings.and_then(|settings| {
        if !settings.enabled {
            return Ok(());
        }
        let Some(checkout) = open(&settings, env)? else { return Ok(()) };
        let subject = checkout.git.text(&["log", "-g", "-1", "--format=%gs", "HEAD"])?;
        let by_commit = ["commit: ", "commit (amend): ", "commit (initial): "].iter().any(|action| subject.starts_with(action));
        if !by_commit || log.take_mark(&env.commit_process) {
            return Ok(());
        }
        let rules = settings.rules()?;
        let engine = Engine { settings: &settings, rules: &rules, scope: None, display: &checkout.git.root };
        let parent = match checkout.git.text(&["rev-parse", "--verify", "--quiet", "HEAD^1"]) {
            Ok(parent) if !parent.is_empty() => parent,
            _ => checkout.git.empty_tree()?,
        };
        let staged = checkout.staged(&parent, Target::Commit("HEAD"))?;
        let errors: Vec<Finding> = engine.lint(&checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error).collect();
        let event = checkout.event(env, Kind::Bypassed, &errors, None);
        log.record(&event)?;
        let short = event.head.as_deref().map_or("HEAD", |head| &head[..head.len().min(12)]);
        let found = match errors.len() {
            0 => "no error findings".to_string(),
            count => format!("{count} error finding(s): {}", event.findings.iter().take(5).cloned().collect::<Vec<_>>().join(", ")),
        };
        let who = env.harness.as_deref().map_or("An agent".to_string(), |harness| format!("A {harness} agent"));
        log.queue_notice(&checkout.repo.project_key, &format!("ai-stack lint: {who} committed {short} in {} without the commit check (--no-verify or hooks turned off), with {found}.", checkout.repo.project_key.display()))?;
        log.alert(&checkout.repo.project_key, settings.skip_alert, env.now)?;
        Ok(())
    });
    0
}
