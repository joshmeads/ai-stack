use std::collections::HashSet;
use std::ffi::OsStr;
use std::io::Write;
use std::ops::Range;
use std::os::unix::ffi::OsStrExt as _;
use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context as _, Result, bail};

use super::events::{Event, Kind, Log, Outcome, Pending};
use super::fix::{Fixed, Prior, drop_lines, remove_new_plain_comments, untouchable};
use super::lines::hunks;
use super::process::{CallerIndex, GitProcess, lock_of};
use super::provenance::Provenance;
use super::repo::{Attributes, GITLINK, Repo, SYMLINK, blobs, nul_paths, parse_raw, path_of, removed_lines, run_git};
use super::scan::{Change, Engine, TEST_FILE_NAMES, language_of};
use super::{Baseline, Finding, Settings, Severity, files_named};
use crate::paths;

pub const REFUSE: i32 = 3;
const STATE_FILES: [&str; 6] = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "SQUASH_MSG", "rebase-merge", "rebase-apply"];
const REPOSITORY_ENV: [&str; 7] = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"];
const SHOWN_ERRORS: usize = 20;
pub(super) const SKIP_REMINDER: &str = "Skips are only for a rule that is wrong for this specific code, never to save time; every other change must pass before you continue.";
pub(super) const HIGH_RATE: &str = "ai-stack lint: agents skip or bypass this check often in this repository. Fix findings instead; AI_STACK_LINT_SKIP is only for a rule that is wrong for this specific code.";

pub struct Env {
    pub cwd: PathBuf,
    pub index_file: Option<PathBuf>,
    pub skip: Option<String>,
    pub harness: Option<String>,
    pub git: GitProcess,
    pub now: u64,
    pub tmpdir: Option<PathBuf>,
    pub allow_temp: bool,
    pub allow_no_harness: bool,
}

impl Env {
    pub fn from_process() -> Result<Env> {
        let cwd = std::env::current_dir()?;
        let index_file = std::env::var_os("GIT_INDEX_FILE").map(|file| paths::normalize(&cwd.join(file)));
        let hidden = |name: &str| std::env::var_os(name).is_some_and(|allow| allow == "1");
        Ok(Env {
            git: GitProcess::parent_of_this_hook(&cwd),
            cwd,
            index_file,
            skip: std::env::var("AI_STACK_LINT_SKIP").ok(),
            harness: std::env::var("AI_STACK_HARNESS").ok().filter(|harness| !harness.is_empty()),
            now: super::events::now(),
            tmpdir: std::env::var_os("TMPDIR").filter(|dir| !dir.is_empty()).map(PathBuf::from),
            allow_temp: hidden("AI_STACK_LINT_ALLOW_TEMP"),
            allow_no_harness: hidden("AI_STACK_LINT_ALLOW_NO_HARNESS"),
        })
    }

    fn agent_commit(&self) -> bool {
        self.git.from_shell && (self.git.under_harness || self.allow_no_harness)
    }
}

pub(super) struct Git {
    pub(super) root: PathBuf,
    pub(super) git_dir: PathBuf,
    index: Option<PathBuf>,
    detached: bool,
}

impl Git {
    pub(super) fn of_store(root: PathBuf, git_dir: PathBuf) -> Git {
        Git { root, git_dir, index: None, detached: true }
    }

    fn run<S: AsRef<OsStr>>(&self, args: &[S], input: &[u8]) -> Result<Vec<u8>> {
        match &self.index {
            Some(index) => self.run_on(index, args, input),
            None if self.detached => run_git(&self.root, args, input, &[("GIT_DIR", self.git_dir.as_os_str())]),
            None => run_git(&self.root, args, input, &[]),
        }
    }

    fn run_on<S: AsRef<OsStr>>(&self, index: &Path, args: &[S], input: &[u8]) -> Result<Vec<u8>> {
        run_git(&self.root, args, input, &[("GIT_INDEX_FILE", index.as_os_str())])
    }

    fn text<S: AsRef<OsStr>>(&self, args: &[S]) -> Result<String> {
        Ok(String::from_utf8_lossy(&self.run(args, &[])?).trim().to_string())
    }

    pub(super) fn empty_tree(&self) -> Result<String> {
        self.text(&["hash-object", "-t", "tree", "/dev/null"])
    }

    fn blob_id(&self, text: &str, write: bool) -> Result<String> {
        let args: &[&str] = if write { &["hash-object", "-w", "--no-filters", "--stdin"] } else { &["hash-object", "--no-filters", "--stdin"] };
        Ok(String::from_utf8(self.run(args, text.as_bytes())?)?.trim().to_string())
    }

    fn patch(&self, base: &str, target: &Target) -> Result<Vec<u8>> {
        let shape = ["-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--text"];
        match target {
            Target::Index => self.run(&[&["diff-index", "--cached"][..], &shape, &[base]].concat(), &[]),
            Target::Commit(commit) => self.run(&[&["diff-tree", "-r", "-p"][..], &shape, &[base, commit]].concat(), &[]),
        }
    }
}

pub(super) struct Checkout {
    pub(super) git: Git,
    pub(super) repo: Repo,
}

fn open(settings: &Settings, env: &Env) -> Result<Option<Checkout>> {
    let out = run_git(&env.cwd, &["rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir"], &[], &[])?;
    let mut lines = out.split(|&byte| byte == b'\n');
    let root = paths::resolve(Path::new(OsStr::from_bytes(lines.next().context("git rev-parse printed no top level")?)));
    let git_dir = PathBuf::from(OsStr::from_bytes(lines.next().context("git rev-parse printed no git dir")?));
    if STATE_FILES.iter().any(|name| git_dir.join(name).exists()) || (!env.allow_temp && throwaway(&root, env.tmpdir.as_deref())) {
        return Ok(None);
    }
    let repo = Repo::discover(&root).context("the repository could not be read")?;
    if !settings.policy(Some(&repo)).enabled() {
        return Ok(None);
    }
    Ok(Some(Checkout { git: Git { root, git_dir, index: env.index_file.clone(), detached: false }, repo }))
}

fn throwaway(root: &Path, tmpdir: Option<&Path>) -> bool {
    let temporary = std::iter::once(Path::new("/tmp")).chain(tmpdir).any(|dir| root.starts_with(paths::resolve(dir)));
    temporary || ignored_by_another_repository(root)
}

fn ignored_by_another_repository(root: &Path) -> bool {
    let git = |dir: &Path, args: &[&str]| {
        let mut command = Command::new("git");
        for name in REPOSITORY_ENV {
            command.env_remove(name);
        }
        command.arg("-C").arg(dir).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok().filter(|out| out.status.success()).map(|out| path_of(out.stdout.trim_ascii_end()))
    };
    let common = |dir: &Path| git(dir, &["rev-parse", "--path-format=absolute", "--git-common-dir"]).map(|dir| paths::resolve(&dir));
    let Some(parent) = root.parent() else { return false };
    let Some(enclosing) = git(parent, &["rev-parse", "--show-toplevel"]) else { return false };
    if common(&enclosing).is_some_and(|enclosing| Some(enclosing) == common(root)) {
        return false;
    }
    let mut check = Command::new("git");
    for name in REPOSITORY_ENV {
        check.env_remove(name);
    }
    check.arg("-C").arg(&enclosing).args(["check-ignore", "-q", "--"]).arg(root).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|status| status.success())
}

pub(super) struct Staged {
    pub(super) rel: PathBuf,
    mode: String,
    blob: String,
    pub(super) baseline: Baseline,
    pub(super) source: String,
}

impl Staged {
    fn prior<'a>(&'a self, removed: &'a str, written: &'a HashSet<String>, moved: &'a HashSet<String>) -> Prior<'a> {
        Prior { file: match &self.baseline { Baseline::Text(text) => Some(text.as_str()), Baseline::Absent => None }, removed, written, moved }
    }
}

pub(super) enum Target<'a> {
    Index,
    Commit(&'a str),
}

pub(super) enum OnDisk {
    Index,
    Links,
    Ignored,
}

pub(super) struct Source<'a> {
    pub(super) base: &'a str,
    pub(super) target: Target<'a>,
    pub(super) attributes: Attributes,
    pub(super) on_disk: OnDisk,
}

enum PartialIndex {
    None,
    Lock(PathBuf),
    Unknown,
}

pub(super) struct Deletion<'s> {
    pub(super) file: &'s Staged,
    pub(super) fixed: Fixed,
}

impl Checkout {
    pub(super) fn staged(&self, base: &str, target: &Target) -> Result<Vec<Staged>> {
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

    pub(super) fn changes(&self, staged: &[Staged]) -> Vec<Change> {
        staged.iter().filter_map(|file| Change::new(self.git.root.join(&file.rel), file.source.clone(), &file.baseline)).collect()
    }

    pub(super) fn engine<'a>(&'a self, settings: &'a Settings, rules: &'a super::rules::Rules) -> Engine<'a> {
        Engine { settings, rules, scope: None, display: &self.git.root, attributes: Attributes::Index(self.git.index.clone()), repo: None }
    }

    fn narrow(&self, base: &str, deletions: &[Deletion]) -> Result<Narrow> {
        let names: Vec<PathBuf> = nul_paths(&self.git.run(&["diff-index", "--cached", "-z", "--no-renames", "--name-only", base], &[])?).collect();
        let patch = self.git.patch(base, &Target::Index)?;
        let mut sections: Vec<Vec<&[u8]>> = Vec::new();
        for line in patch.split(|&byte| byte == b'\n') {
            if line.starts_with(b"diff --git ") {
                sections.push(Vec::new());
            } else if let Some(section) = sections.last_mut() {
                section.push(line);
            }
        }
        let paired = sections.len() == names.len();
        let mut narrow = Narrow::default();
        for (at, section) in sections.iter().enumerate() {
            let fixed = names.get(at).filter(|_| paired).and_then(|name| deletions.iter().find(|deletion| deletion.file.rel == *name));
            let sizes: Vec<usize> = match fixed {
                Some(deletion) => {
                    let before = match &deletion.file.baseline {
                        Baseline::Text(text) => text.as_str(),
                        Baseline::Absent => "",
                    };
                    hunks(before, &deletion.fixed.text).into_iter().map(|hunk| hunk.old.len().max(hunk.new.len())).collect()
                }
                None => section
                    .iter()
                    .filter_map(|line| line.strip_prefix(b"@@ -"))
                    .map(|header| {
                        let header = String::from_utf8_lossy(header);
                        let mut counts = header.split(' ').take(2).map(|side| side.trim_start_matches('+').split_once(',').map_or(1, |(_, count)| count.parse().unwrap_or(1)));
                        counts.next().unwrap_or(0).max(counts.next().unwrap_or(0))
                    })
                    .collect(),
            };
            if fixed.is_some() && sizes.is_empty() {
                continue;
            }
            narrow.files += 1;
            narrow.hunks += sizes.len();
            narrow.lines += sizes.iter().sum::<usize>();
        }
        Ok(narrow)
    }

    fn emptied(&self, base: &str, fixed: &[(&PathBuf, &str)]) -> Result<bool> {
        let raw = self.git.run(&["diff-index", "--cached", "-z", "--no-renames", "--no-abbrev", base], &[])?;
        let mut fields = raw.split(|&byte| byte == 0).filter(|field| !field.is_empty());
        while let Some(header) = fields.next() {
            let path = path_of(fields.next().context("git diff-index ended early")?);
            let header = String::from_utf8_lossy(header);
            let [old_mode, new_mode, old_id, _, status] = header.trim_start_matches(':').split(' ').collect::<Vec<_>>()[..] else { bail!("git diff-index printed {header}") };
            let restored = status == "M" && old_mode == new_mode && fixed.iter().any(|(rel, id)| **rel == path && *id == old_id);
            if !restored {
                return Ok(false);
            }
        }
        Ok(true)
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

    fn rewrite_worktree(&self, deletion: &Deletion, id: &str, modes: bool) -> Result<Worktree> {
        let file = deletion.file;
        let path = self.git.root.join(&file.rel);
        let Ok(meta) = std::fs::symlink_metadata(&path) else { return Ok(Worktree::Untouched) };
        let executable = meta.permissions().mode() & 0o100 != 0;
        if !meta.is_file() || meta.nlink() != 1 || (modes && executable != (file.mode == "100755")) {
            return Ok(Worktree::Untouched);
        }
        let path_arg = [b"--path=".as_slice(), file.rel.as_os_str().as_bytes()].concat();
        let hash = |args: &[&OsStr], input: &[u8]| -> Result<String> { Ok(String::from_utf8(self.git.run(&[&[OsStr::new("hash-object"), OsStr::from_bytes(&path_arg)], args].concat(), input)?)?.trim().to_string()) };
        if hash(&[OsStr::new("--"), path.as_os_str()], &[])? != file.blob {
            return Ok(Worktree::Untouched);
        }
        let bytes = std::fs::read(&path)?;
        if bytes.iter().filter(|&&byte| byte == b'\n').count() != file.source.matches('\n').count() {
            return Ok(Worktree::Untouched);
        }
        let rewritten = drop_lines(&bytes, &deletion.fixed.dropped);
        if hash(&[OsStr::new("--stdin")], &rewritten)? != id {
            return Ok(Worktree::Untouched);
        }
        std::fs::OpenOptions::new().write(true).truncate(true).open(&path)?.write_all(&rewritten)?;
        Ok(Worktree::Rewritten)
    }

    fn rewritable(&self, staged: &[&Staged], source: &Source) -> Result<HashSet<PathBuf>> {
        let rels: Vec<PathBuf> = staged.iter().map(|file| file.rel.clone()).collect();
        let filtered = self.repo.filtered(&rels, &source.attributes)?;
        let flagged = match source.on_disk {
            OnDisk::Index => self.repo.flagged(&rels, self.git.index.as_deref()),
            OnDisk::Links | OnDisk::Ignored => HashSet::new(),
        };
        let single_link = |file: &Staged| matches!(source.on_disk, OnDisk::Ignored) || std::fs::symlink_metadata(self.git.root.join(&file.rel)).map_or(true, |meta| meta.nlink() == 1);
        Ok(staged
            .iter()
            .filter(|file| !filtered.contains(&file.rel) && !flagged.contains(&file.rel) && !untouchable(&file.rel, &file.source) && single_link(file))
            .map(|file| file.rel.clone())
            .collect())
    }

    pub(super) fn deletions<'s>(&self, staged: &'s [Staged], fixable: &[&Finding], source: &Source, provenance: &Provenance) -> Result<Vec<Deletion<'s>>> {
        let ranges = |file: &Staged| -> Vec<Range<usize>> {
            let path = self.git.root.join(&file.rel);
            fixable.iter().filter(|finding| finding.file == path).map(|finding| finding.bytes.clone()).collect()
        };
        let candidates: Vec<&Staged> = staged.iter().filter(|file| !ranges(file).is_empty()).collect();
        if candidates.is_empty() {
            return Ok(Vec::new());
        }
        let eligible = self.rewritable(&candidates, source)?;
        if eligible.is_empty() {
            return Ok(Vec::new());
        }
        let removed = removed_lines(&self.git.patch(source.base, &source.target)?);
        let moved = provenance.moved(&self.repo.project_key);
        Ok(candidates
            .into_iter()
            .filter(|file| eligible.contains(&file.rel))
            .filter_map(|file| {
                let language = language_of(&file.rel)?;
                let written = provenance.written(&self.git.root.join(&file.rel));
                remove_new_plain_comments(language, &file.source, &ranges(file), &file.prior(&removed, &written, &moved)).map(|fixed| Deletion { file, fixed })
            })
            .collect())
    }

    pub(super) fn display(&self, rel: &Path) -> String {
        let path = self.git.root.join(rel);
        self.repo.relative(&path).unwrap_or_else(|| rel.to_path_buf()).display().to_string()
    }

    pub(super) fn fixed_files(&self, deletions: &[&Deletion]) -> String {
        files_named(&deletions.iter().map(|deletion| self.display(&deletion.file.rel)).collect::<Vec<_>>())
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

pub(super) fn named(findings: &[&Finding]) -> Vec<String> {
    findings.iter().map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect()
}

pub(super) fn plural(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

pub(super) fn removed_by<'f>(checkout: &Checkout, fixable: &[&'f Finding], deletions: &[Deletion]) -> Vec<&'f Finding> {
    fixable.iter().filter(|finding| deletions.iter().any(|deletion| checkout.git.root.join(&deletion.file.rel) == finding.file && deletion.fixed.removed.contains(&finding.bytes))).copied().collect()
}

fn outside_deletions<'f>(checkout: &Checkout, unfixable: &[&'f Finding], deletions: &[Deletion]) -> Vec<&'f Finding> {
    let deleted = |finding: &Finding| {
        !finding.bytes.is_empty()
            && deletions.iter().any(|deletion| checkout.git.root.join(&deletion.file.rel) == finding.file && deletion.fixed.removed.iter().any(|gone| gone.start <= finding.bytes.start && finding.bytes.end <= gone.end))
    };
    unfixable.iter().filter(|finding| !deleted(finding)).copied().collect()
}

pub(super) fn refusal(findings: &[&Finding], verb: &str) -> Vec<String> {
    let mut sorted = findings.to_vec();
    sorted.sort_by(|a, b| (&a.path, a.line, a.column, &a.rule).cmp(&(&b.path, b.line, b.column, &b.rule)));
    let mut lines = Vec::new();
    let mut explained = HashSet::new();
    for finding in sorted.iter().take(SHOWN_ERRORS) {
        let message = if explained.insert(finding.rule.as_str()) { format!(": {}", finding.message) } else { String::new() };
        lines.push(format!("{}:{} {}{message}", finding.path, finding.line, finding.rule));
    }
    if sorted.len() > SHOWN_ERRORS {
        lines.push(format!("and {} more", sorted.len() - SHOWN_ERRORS));
    }
    lines.push(format!("Fix these, or {verb} with AI_STACK_LINT_SKIP=\"<reason>\" if a rule is wrong here."));
    lines
}

pub(super) fn skip_recorded(findings: &[String], reason: &str) -> String {
    format!("ai-stack lint: skip recorded for {} ({reason}). {SKIP_REMINDER}", findings.join(", "))
}

pub(super) fn sorted_names(findings: &[&Finding]) -> Vec<String> {
    let mut sorted = findings.to_vec();
    sorted.sort_by(|a, b| (&a.path, a.line, a.column, &a.rule).cmp(&(&b.path, b.line, b.column, &b.rule)));
    named(&sorted)
}

pub fn pre_commit(state_dir: &Path, settings: Result<Settings>, env: &Env, err: &mut dyn Write) -> i32 {
    if !env.agent_commit() {
        return 0;
    }
    let log = Log::new(state_dir);
    let _ = log.mark(&env.git.id, &Pending::nothing());
    let provenance = Provenance::new(state_dir, env.now);
    let outcome = settings.and_then(|settings| {
        if !settings.enabled {
            return Ok(0);
        }
        match open(&settings, env)? {
            Some(checkout) => check(&settings, &checkout, &log, &provenance, env, err),
            None => Ok(0),
        }
    });
    outcome.unwrap_or_else(|error| {
        let _ = writeln!(err, "ai-stack lint: skipped ({})", format!("{error:#}").lines().next().unwrap_or_default());
        0
    })
}

fn check(settings: &Settings, checkout: &Checkout, log: &Log, provenance: &Provenance, env: &Env, err: &mut dyn Write) -> Result<i32> {
    let rules = settings.rules()?;
    let engine = checkout.engine(settings, &rules);
    let before = checkout.repo.head();
    let base = match &before {
        Some(head) => head.clone(),
        None => checkout.git.empty_tree()?,
    };
    if checkout.git.run(&["diff-index", "--cached", "--quiet", &base], &[]).is_ok() {
        return Ok(0);
    }
    let staged = checkout.staged(&base, &Target::Index)?;
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
    let source = Source { base: &base, target: Target::Index, attributes: Attributes::Index(checkout.git.index.clone()), on_disk: OnDisk::Index };
    let deletions = checkout.deletions(&staged, &fixable, &source, provenance)?;
    let removed = removed_by(checkout, &fixable, &deletions);
    let left = outside_deletions(checkout, &unfixable, &deletions);
    let mut outcome = Outcome::Checked;
    match reason {
        _ if left.is_empty() => {}
        Some(reason) => match skip(settings, log, env, before.clone(), checkout.narrow(&base, &deletions)?, &left, reason) {
            Ok(line) => {
                lines.push(line);
                outcome = Outcome::Skip { findings: sorted_names(&left), reason: reason.to_string() };
            }
            Err(line) => {
                lines.push(line);
                print(err, &lines);
                return Ok(REFUSE);
            }
        },
        None => {
            lines.extend(refusal(&left, "commit"));
            print(err, &lines);
            return Ok(REFUSE);
        }
    }

    let all: Vec<&Deletion> = deletions.iter().collect();
    let ids: Vec<String> = deletions.iter().map(|deletion| checkout.git.blob_id(&deletion.fixed.text, false)).collect::<Result<_>>()?;
    if !removed.is_empty() && !env.git.amend {
        let fixed: Vec<(&PathBuf, &str)> = deletions.iter().zip(&ids).map(|(deletion, id)| (&deletion.file.rel, id.as_str())).collect();
        if checkout.emptied(&base, &fixed)? {
            lines.push(format!("ai-stack lint: removed {} in {}, which left nothing to commit.", plural(removed.len(), "comment"), checkout.fixed_files(&all)));
            print(err, &lines);
            return Ok(REFUSE);
        }
    }

    let partial = checkout.partial_index(env);
    let modes = checkout.file_mode_tracked();
    if matches!(partial, PartialIndex::Unknown) && !removed.is_empty() {
        for deletion in &deletions {
            let id = checkout.git.blob_id(&deletion.fixed.text, true)?;
            checkout.rewrite_worktree(deletion, &id, modes)?;
        }
        lines.push(format!("ai-stack lint: removed {} in {}; rerun the same commit.", plural(removed.len(), "comment"), checkout.fixed_files(&all)));
        print(err, &lines);
        return Ok(REFUSE);
    }

    let mut applied: Vec<&Deletion> = Vec::new();
    let mut unstaged: Vec<String> = Vec::new();
    for deletion in &deletions {
        let Ok(id) = checkout.git.blob_id(&deletion.fixed.text, true) else { continue };
        if checkout.rewrite_index(deletion.file, &id, &partial).is_err() {
            continue;
        }
        if matches!(checkout.rewrite_worktree(deletion, &id, modes).unwrap_or(Worktree::Untouched), Worktree::Untouched) {
            unstaged.push(checkout.display(&deletion.file.rel));
        }
        applied.push(deletion);
    }
    let removed_count: usize = applied.iter().map(|deletion| deletion.fixed.removed.len()).sum();
    if !unstaged.is_empty() {
        lines.push(format!("ai-stack lint: {} {} unstaged changes, so only the staged version was fixed.", files_named(&unstaged), if unstaged.len() == 1 { "has" } else { "have" }));
    }
    let kept = fixable.len() - removed_count;
    let mut summary = Vec::new();
    if removed_count > 0 {
        summary.push(format!("removed {} in {}", plural(removed_count, "comment"), checkout.fixed_files(&applied)));
    }
    if kept > 0 {
        summary.push(format!("kept {} (trailing, block, header, edited, tool-read or not written by the agent)", plural(kept, "comment")));
    }
    if !summary.is_empty() {
        lines.push(format!("ai-stack lint: {}", summary.join("; ")));
    }
    let _ = log.mark(&env.git.id, &Pending { before, outcome });
    print(err, &lines);
    Ok(0)
}

fn skip(settings: &Settings, log: &Log, env: &Env, before: Option<String>, narrow: Narrow, exceptions: &[&Finding], reason: &str) -> Result<String, String> {
    let limits = settings.skip;
    let whole_files = exceptions.iter().all(|finding| finding.rule == TEST_FILE_NAMES);
    let wide = narrow.files > limits.files || exceptions.len() > limits.findings || (!whole_files && (narrow.hunks > limits.hunks || narrow.lines > limits.lines));
    if wide {
        return Err(format!(
            "ai-stack lint: a skip must be its own commit containing only the exception (at most {} file, {} hunk, {} changed lines and {} findings; this commit has {}, {}, {} and {}). Commit the rest without a skip first.",
            limits.files, limits.hunks, limits.lines, limits.findings, narrow.files, narrow.hunks, narrow.lines, exceptions.len()
        ));
    }
    let findings = sorted_names(exceptions);
    let outcome = Outcome::Skip { findings: findings.clone(), reason: reason.to_string() };
    if let Err(error) = log.writable().and_then(|()| log.mark(&env.git.id, &Pending { before, outcome })) {
        return Err(format!("ai-stack lint: the skip could not be recorded ({}), so this commit is refused.", format!("{error:#}").lines().next().unwrap_or_default()));
    }
    Ok(skip_recorded(&findings, reason))
}

fn print(err: &mut dyn Write, lines: &[String]) {
    for line in lines {
        let _ = writeln!(err, "{line}");
    }
}

pub fn post_commit(state_dir: &Path, settings: Result<Settings>, env: &Env) -> i32 {
    if !env.agent_commit() {
        return 0;
    }
    let log = Log::new(state_dir);
    let provenance = Provenance::new(state_dir, env.now);
    let _ = settings.and_then(|settings| {
        if !settings.enabled {
            return Ok(());
        }
        let pending = log.take_mark(&env.git.id);
        let Some(checkout) = open(&settings, env)? else { return Ok(()) };
        let head = checkout.repo.head();
        let event = |kind, findings: Vec<String>, reason| Event { time: env.now, kind, repo: checkout.repo.project_key.clone(), harness: env.harness.clone(), head: head.clone(), findings, reason, vcs: None, change: None, fingerprints: Vec::new() };
        match pending {
            Some(pending) if pending.before == head => return Ok(()),
            Some(Pending { outcome: Outcome::Nothing, .. }) => return Ok(()),
            Some(Pending { outcome: Outcome::Checked, .. }) => log.record(&event(Kind::Checked, Vec::new(), None))?,
            Some(Pending { outcome: Outcome::Skip { findings, reason }, .. }) => log.record(&event(Kind::Skip, findings, Some(reason)))?,
            None => {
                let Some(found) = bypassed(&settings, &checkout, &provenance)? else { return Ok(()) };
                let bypass = event(Kind::Bypassed, found, None);
                log.record(&bypass)?;
                let short = bypass.head.as_deref().map_or("HEAD", |head| &head[..head.len().min(12)]);
                let who = env.harness.as_deref().map_or("An agent".to_string(), |harness| format!("A {harness} agent"));
                let shown: Vec<String> = bypass.findings.iter().take(5).cloned().collect();
                log.queue_notice(
                    &checkout.repo.project_key,
                    &format!(
                        "ai-stack lint: {who} committed {short} in {} without the commit check (--no-verify or hooks turned off), with {} the check would have refused or removed: {}.",
                        checkout.repo.project_key.display(),
                        plural(bypass.findings.len(), "finding"),
                        shown.join(", ")
                    ),
                )?;
            }
        }
        log.alert(&checkout.repo.project_key, settings.skip_alert, env.now)?;
        Ok(())
    });
    0
}

fn bypassed(settings: &Settings, checkout: &Checkout, provenance: &Provenance) -> Result<Option<Vec<String>>> {
    let subject = checkout.git.text(&["log", "-g", "-1", "--format=%gs", "HEAD"])?;
    let base = if subject.starts_with("commit (amend): ") {
        checkout.git.text(&["rev-parse", "--verify", "--quiet", "HEAD@{1}"])?
    } else if subject.starts_with("commit: ") || subject.starts_with("commit (initial): ") {
        match checkout.git.text(&["rev-parse", "--verify", "--quiet", "HEAD^1"]) {
            Ok(parent) if !parent.is_empty() => parent,
            _ => checkout.git.empty_tree()?,
        }
    } else {
        return Ok(None);
    };
    let rules = settings.rules()?;
    let source = Source { base: &base, target: Target::Commit("HEAD"), attributes: Attributes::Index(None), on_disk: OnDisk::Ignored };
    let staged = checkout.staged(&base, &source.target)?;
    let engine = Engine { attributes: source.attributes.clone(), ..checkout.engine(settings, &rules) };
    let findings: Vec<Finding> = engine.lint(&checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error).collect();
    let (fixable, unfixable): (Vec<&Finding>, Vec<&Finding>) = findings.iter().partition(|finding| finding.fix.is_some());
    let deletions = checkout.deletions(&staged, &fixable, &source, provenance)?;
    let counted: Vec<&Finding> = outside_deletions(checkout, &unfixable, &deletions).into_iter().chain(removed_by(checkout, &fixable, &deletions)).collect();
    Ok((!counted.is_empty()).then(|| sorted_names(&counted)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lint::tests::{git, put};

    #[test]
    fn repositories_in_an_ignored_path_of_another_repository_or_a_temp_dir_are_left_alone_but_worktrees_are_checked() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let outer = root.join("outer");
        put(&outer.join(".gitignore"), "target/\n.worktrees/\n");
        put(&outer.join("a.ts"), "export {};\n");
        git(&outer, &["init", "-q"]);
        git(&outer, &["add", "-A"]);
        git(&outer, &["commit", "-qm", "base"]);
        for inner in ["target/tmp/fixture", "visible/fixture"] {
            std::fs::create_dir_all(outer.join(inner)).unwrap();
            git(&outer.join(inner), &["init", "-q"]);
        }
        git(&outer, &["worktree", "add", "-q", "-b", "task", outer.join(".worktrees/task").to_str().unwrap()]);
        assert!(ignored_by_another_repository(&outer.join("target/tmp/fixture")));
        assert!(!ignored_by_another_repository(&outer.join("visible/fixture")));
        assert!(!ignored_by_another_repository(&outer.join(".worktrees/task")), "a worktree of the same repository is checked");
        assert!(throwaway(&outer.join("visible/fixture"), Some(&root)), "a repository under TMPDIR is a throwaway");
    }
}
