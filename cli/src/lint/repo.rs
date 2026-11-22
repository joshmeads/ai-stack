use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::{ErrorKind, Write as _};
use std::os::unix::ffi::{OsStrExt as _, OsStringExt as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

use anyhow::{Context as _, Result, anyhow, bail};

use super::Baseline;
use super::owned::same_lines;
use super::scan::language_of;
use crate::paths;

const GITLINK: &str = "160000";
const MAX_SNAPSHOT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repo {
    pub root: PathBuf,
    pub project_key: PathBuf,
}

pub struct Snapshot {
    pub tree: String,
    pub skipped: Vec<PathBuf>,
    pub head: Option<String>,
    pub taken: u64,
    pub reflogs: Option<Vec<(String, String)>>,
}

pub enum Authors {
    Reflog(HashSet<String>),
    Before(u64),
}

impl Authors {
    fn made(&self, id: &str, committed: u64) -> bool {
        match self {
            Authors::Reflog(ids) => ids.contains(id),
            Authors::Before(taken) => committed >= *taken,
        }
    }
}

pub struct History {
    pub authors: Authors,
    before: Option<String>,
    head: Option<String>,
    applying: Option<Applying>,
}

struct Applying {
    tip: String,
    base: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Submodules {
    Follow,
    Skip,
}

impl Repo {
    pub fn discover(dir: &Path) -> Option<Repo> {
        let dir = dir.ancestors().find(|ancestor| ancestor.is_dir())?;
        let out = git(dir, &["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"]).ok()?;
        let mut lines = out.split(|&byte| byte == b'\n');
        let root = paths::resolve(Path::new(OsStr::from_bytes(lines.next()?)));
        let common = paths::resolve(Path::new(OsStr::from_bytes(lines.next()?)));
        let project_key = match (common.file_name(), common.parent()) {
            (Some(name), Some(parent)) if name == ".git" => parent.to_path_buf(),
            _ => common,
        };
        Some(Repo { root, project_key })
    }

    pub fn relative(&self, path: &Path) -> Option<PathBuf> {
        path.strip_prefix(&self.root).map(Path::to_path_buf).or_else(|_| paths::resolve(path).strip_prefix(&self.root).map(Path::to_path_buf)).ok()
    }

    pub fn generated(&self, rels: &[PathBuf]) -> HashSet<PathBuf> {
        let input = nul_joined(rels);
        let Ok(work) = Workspace::new(self, None, None) else { return HashSet::new() };
        let Ok(out) = work.git(&work.index(), &["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"], &input) else {
            return HashSet::new();
        };
        let fields: Vec<&[u8]> = out.split(|&byte| byte == 0).collect();
        fields.chunks(3).filter(|chunk| chunk.len() == 3 && matches!(chunk[2], b"set" | b"true")).map(|chunk| path_of(chunk[0])).collect()
    }

    pub fn head(&self) -> Option<String> {
        self.commit("HEAD")
    }

    fn commit(&self, rev: &str) -> Option<String> {
        let out = git(&self.root, &["rev-parse", "--verify", "--quiet", "--end-of-options", &format!("{rev}^{{commit}}")]).ok()?;
        Some(String::from_utf8_lossy(&out).trim().to_string())
    }

    fn reflog(&self, name: &str, newest: bool) -> Vec<String> {
        let mut args = vec!["log", "--walk-reflogs", "--no-show-signature", "--date=unix", "--format=%H %gd %gs"];
        if newest {
            args.push("-1");
        }
        args.extend([name, "--"]);
        git(&self.root, &args).map(|out| String::from_utf8_lossy(&out).lines().map(String::from).collect()).unwrap_or_default()
    }

    fn reflog_tips(&self) -> Vec<(String, String)> {
        let branch = git(&self.root, &["symbolic-ref", "--quiet", "HEAD"]).ok().map(|out| String::from_utf8_lossy(&out).trim().to_string());
        std::iter::once("HEAD".to_string())
            .chain(branch)
            .map(|name| {
                let newest = self.reflog(&name, true).into_iter().next().unwrap_or_default();
                (name, newest)
            })
            .collect()
    }

    fn authors(&self, snapshot: &Snapshot) -> Authors {
        let fallback = Authors::Before(snapshot.taken);
        let Some(tips) = &snapshot.reflogs else { return fallback };
        let mut made = HashSet::new();
        for (at, (name, newest)) in tips.iter().enumerate() {
            let entries = self.reflog(name, false);
            let fresh = match entries.iter().position(|entry| entry == newest) {
                Some(end) => &entries[..end],
                None if newest.is_empty() && !entries.is_empty() => &entries[..],
                None if at == 0 => return fallback,
                None => continue,
            };
            made.extend(fresh.iter().filter_map(|entry| made_here(entry)));
        }
        Authors::Reflog(made)
    }

    pub fn changes(&self, base: &str) -> Result<Vec<(PathBuf, Baseline)>> {
        let Some(head) = self.head() else {
            if base != "HEAD" {
                bail!("{} has no commits yet, so --base {base} cannot be resolved", self.root.display());
            }
            let work = Workspace::new(self, None, None)?;
            work.track_untracked(&lintable)?;
            let all = work.git(&work.index(), &["ls-files", "-z", "--cached"], &[])?;
            return Ok(nul_paths(&all).map(|rel| self.root.join(rel)).filter(|path| lintable(path)).map(|path| (path, Baseline::Absent)).collect());
        };
        git(&self.root, &["rev-parse", "--verify", "--quiet", "--end-of-options", &format!("{base}^{{commit}}")])
            .map_err(|_| anyhow!("--base {base} does not name a commit in {}", self.root.display()))?;
        let merge_base = git(&self.root, &["merge-base", base, "HEAD"])
            .map_err(|_| anyhow!("{base} and HEAD share no history in {}, so they have no merge base to compare against", self.root.display()))?;
        self.changes_from(&head, String::from_utf8(merge_base)?.trim())
    }

    fn changes_from(&self, head: &str, base: &str) -> Result<Vec<(PathBuf, Baseline)>> {
        let work = Workspace::new(self, None, Some(head))?;
        work.track_untracked(&lintable)?;
        work.changes(base, Submodules::Follow, &lintable)
    }

    pub fn snapshot(&self, store: &Path) -> Result<Snapshot> {
        let taken = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)?.as_secs();
        let head = self.head();
        let work = Workspace::new(self, Some(store), head.as_deref())?;
        work.track_untracked(&|_| true)?;
        let dirty = match &head {
            Some(head) => work.git(&work.index(), &["diff", "--name-only", "-z", "--no-renames", "--ignore-submodules=all", head], &[])?,
            None => work.git(&work.index(), &["ls-files", "-z", "--cached"], &[])?,
        };
        let (mut hashed, mut removed, mut skipped) = (Vec::new(), Vec::new(), Vec::new());
        for rel in nul_paths(&dirty) {
            match std::fs::symlink_metadata(self.root.join(&rel)) {
                Ok(meta) if meta.is_file() && meta.len() <= MAX_SNAPSHOT_BYTES => hashed.push(rel),
                Err(err) if err.kind() == ErrorKind::NotFound => removed.push(rel),
                _ => {
                    removed.push(rel.clone());
                    skipped.push(rel);
                }
            }
        }
        let index = work.dir.path().join("snapshot");
        work.git(&index, &["read-tree", head.as_deref().unwrap_or("--empty")], &[])?;
        if !hashed.is_empty() {
            let paths: Vec<u8> = hashed.iter().flat_map(|rel| quoted(rel.as_os_str().as_bytes()).into_iter().chain([b'\n'])).collect();
            let ids = work.git(&index, &["hash-object", "-w", "--no-filters", "--stdin-paths"], &paths)?;
            let mut info = Vec::new();
            for (rel, id) in hashed.iter().zip(ids.split(|&byte| byte == b'\n')) {
                info.extend_from_slice(b"100644 ");
                info.extend_from_slice(id);
                info.push(b'\t');
                info.extend_from_slice(rel.as_os_str().as_bytes());
                info.push(0);
            }
            work.git(&index, &["update-index", "-z", "--index-info"], &info)?;
        }
        if !removed.is_empty() {
            work.git(&index, &["update-index", "-z", "--force-remove", "--stdin"], &nul_joined(&removed))?;
        }
        let tree = String::from_utf8(work.git(&index, &["write-tree"], &[])?)?.trim().to_string();
        Ok(Snapshot { tree, skipped, head, taken, reflogs: Some(self.reflog_tips()) })
    }

    pub fn changes_since<'a>(&'a self, snapshot: &Snapshot, store: &Path, head: Option<&str>, only: Option<&HashSet<PathBuf>>) -> Result<Since<'a>> {
        let work = Workspace::new(self, Some(store), head)?;
        let skipped: HashSet<PathBuf> = snapshot.skipped.iter().map(|rel| self.root.join(rel)).collect();
        let tracked = |path: &Path| lintable(path) && !skipped.contains(path);
        work.track_untracked(&tracked)?;
        let changes = work.changes(&snapshot.tree, Submodules::Skip, &|path| tracked(path) && only.is_none_or(|only| only.contains(path)))?;
        Ok(Since { work, head: head.map(str::to_string), changes })
    }

    fn submodule_changes(&self, rel: &Path, recorded: &str) -> Vec<(PathBuf, Baseline)> {
        let dir = self.root.join(rel);
        let Some(submodule) = Repo::discover(&dir).filter(|submodule| submodule.root == paths::resolve(&dir)) else { return Vec::new() };
        let Some(head) = submodule.head() else { return Vec::new() };
        submodule.changes_from(&head, recorded).unwrap_or_default()
    }
}

pub struct Since<'a> {
    work: Workspace<'a>,
    head: Option<String>,
    pub changes: Vec<(PathBuf, Baseline)>,
}

impl Since<'_> {
    pub fn history(&self, snapshot: &Snapshot) -> Option<History> {
        let applying = self.applying();
        if self.head == snapshot.head && applying.is_none() {
            return None;
        }
        Some(History { authors: self.work.repo.authors(snapshot), before: snapshot.head.clone(), head: self.head.clone(), applying })
    }

    fn applying(&self) -> Option<Applying> {
        let (name, merging) = [("MERGE_HEAD", true), ("CHERRY_PICK_HEAD", false), ("REBASE_HEAD", false)].into_iter().find(|(name, _)| self.work.git_dir.join(name).exists())?;
        let repo = self.work.repo;
        let tip = repo.commit(name)?;
        let base = if merging {
            self.head.as_ref().and_then(|head| git(&repo.root, &["merge-base", head, &tip]).ok()).map(|out| String::from_utf8_lossy(&out).trim().to_string())
        } else {
            repo.commit(&format!("{tip}^"))
        };
        Some(Applying { tip, base })
    }

    pub fn upstream_only(&self, path: &Path, baseline: &Baseline, source: &str, history: &History) -> Result<bool> {
        let Some(rel) = self.work.repo.relative(path) else { return Ok(false) };
        let before = history.before.as_deref().and_then(|rev| self.blob(rev, &rel));
        let unchanged_since_capture = match (baseline, &before) {
            (Baseline::Absent, None) => true,
            (Baseline::Text(text), Some(blob)) => String::from_utf8_lossy(blob) == text.as_str(),
            _ => false,
        };
        if !unchanged_since_capture {
            return Ok(false);
        }
        let ours = history.head.as_deref().and_then(|head| self.blob(head, &rel));
        let mut ranges: Vec<String> = history.head.iter().map(|head| history.before.as_ref().map_or_else(|| head.clone(), |before| format!("{before}..{head}"))).collect();
        let expected = match &history.applying {
            None => ours,
            Some(Applying { base: None, .. }) => return Ok(false),
            Some(Applying { tip, base: Some(base) }) => {
                ranges.push(format!("{base}..{tip}"));
                let (based, theirs) = (self.blob(base, &rel), self.blob(tip, &rel));
                if based == ours {
                    theirs
                } else if based == theirs || ours == theirs {
                    ours
                } else {
                    let head = history.head.as_deref().unwrap_or("HEAD");
                    let args = [OsString::from("merge-file"), "-p".into(), "--object-id".into(), object(head, &rel), object(base, &rel), object(tip, &rel)];
                    self.work.git(&self.work.index(), &args, &[]).ok()
                }
            }
        };
        if !expected.is_some_and(|text| same_lines(&String::from_utf8_lossy(&text), source)) {
            return Ok(false);
        }
        for range in ranges {
            let listed = self.work.git(&self.work.index(), &[OsStr::new("rev-list"), OsStr::new("--timestamp"), OsStr::new(&range), OsStr::new("--"), rel.as_os_str()], &[])?;
            for row in String::from_utf8_lossy(&listed).lines() {
                let (time, id) = row.split_once(' ').context("git rev-list --timestamp printed an unexpected line")?;
                if history.authors.made(id, time.parse().unwrap_or(u64::MAX)) {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    fn blob(&self, rev: &str, rel: &Path) -> Option<Vec<u8>> {
        self.work.git(&self.work.index(), &[OsStr::new("cat-file"), OsStr::new("blob"), &object(rev, rel)], &[]).ok()
    }

    pub fn disowned(&self, path: &Path, authors: &Authors) -> Result<HashSet<u32>> {
        let rel = self.work.repo.relative(path).with_context(|| format!("{} is outside {}", path.display(), self.work.repo.root.display()))?;
        let args = [OsStr::new("blame"), OsStr::new("--no-ignore-revs-file"), OsStr::new("--porcelain"), OsStr::new("--"), rel.as_os_str()];
        let out = self.work.git(&self.work.index(), &args, &[])?;
        let mut times: HashMap<&[u8], u64> = HashMap::new();
        let (mut commit, mut line): (&[u8], u32) = (b"", 0);
        let mut disowned = HashSet::new();
        for row in out.split(|&byte| byte == b'\n') {
            if row.starts_with(b"\t") {
                if times.get(commit).is_some_and(|&committed| !authors.made(&String::from_utf8_lossy(commit), committed)) {
                    disowned.insert(line);
                }
            } else if let Some(seconds) = row.strip_prefix(b"committer-time ")
                && commit.iter().any(|&digit| digit != b'0')
            {
                times.insert(commit, String::from_utf8_lossy(seconds).trim().parse().unwrap_or(u64::MAX));
            } else {
                let mut words = row.split(|&byte| byte == b' ');
                if let (Some(id), Some(_), Some(Ok(number))) = (words.next(), words.next(), words.next().map(|word| String::from_utf8_lossy(word).parse::<u32>()))
                    && id.len() >= 40
                    && id.iter().all(u8::is_ascii_hexdigit)
                {
                    (commit, line) = (id, number);
                }
            }
        }
        Ok(disowned)
    }
}

fn object(rev: &str, rel: &Path) -> OsString {
    let mut spec = OsString::from(format!("{rev}:"));
    spec.push(rel);
    spec
}

fn made_here(entry: &str) -> Option<String> {
    let (id, rest) = entry.split_once(' ')?;
    let (_, subject) = rest.split_once(' ')?;
    let action = subject.split_once(": ").map_or(subject, |(action, _)| action);
    let committed = action == "commit" || action.starts_with("commit (") || matches!(action, "cherry-pick" | "revert");
    let replayed = ["(pick)", "(reword)", "(edit)", "(squash)", "(fixup)", "(continue)"].iter().any(|step| action.ends_with(step));
    (committed || replayed).then(|| id.to_string())
}

struct Workspace<'a> {
    repo: &'a Repo,
    dir: tempfile::TempDir,
    store: PathBuf,
    alternate: OsString,
    written: Option<SystemTime>,
    git_dir: PathBuf,
}

impl<'a> Workspace<'a> {
    fn new(repo: &'a Repo, store: Option<&Path>, head: Option<&str>) -> Result<Workspace<'a>> {
        let dir = tempfile::tempdir()?;
        let store = store.map_or_else(|| dir.path().join("objects"), Path::to_path_buf);
        std::fs::create_dir_all(&store).with_context(|| format!("creating {}", store.display()))?;
        let out = git(&repo.root, &["rev-parse", "--path-format=absolute", "--git-path", "objects", "--git-path", "index", "--absolute-git-dir", "--git-common-dir"])?;
        let located: Vec<PathBuf> = out.split(|&byte| byte == b'\n').filter(|line| !line.is_empty()).map(path_of).collect();
        let [objects, real, git_dir, common] = &located[..] else { bail!("git rev-parse printed {} paths, not 4", located.len()) };
        let mut work = Workspace { repo, dir, store, alternate: OsString::from_vec(quoted(objects.as_os_str().as_bytes())), written: None, git_dir: git_dir.clone() };
        match std::fs::copy(real, work.index()) {
            Ok(_) => {
                work.written = Some(std::fs::metadata(real)?.modified()?);
                if shared_indexes(git_dir).next().is_some() {
                    work.unsplit(git_dir, common)?;
                }
            }
            Err(err) if err.kind() == ErrorKind::NotFound => {
                if let Some(head) = head {
                    work.git(&work.index(), &["read-tree", head], &[])?;
                }
            }
            Err(err) => return Err(err).with_context(|| format!("copying {}", real.display())),
        }
        Ok(work)
    }

    fn unsplit(&self, git_dir: &Path, common: &Path) -> Result<()> {
        let private = self.dir.path().join("gitdir");
        std::fs::create_dir(&private)?;
        std::fs::copy(git_dir.join("HEAD"), private.join("HEAD"))?;
        for shared in shared_indexes(git_dir) {
            std::fs::copy(&shared, self.dir.path().join(shared.file_name().unwrap_or_default()))?;
        }
        let index = self.index();
        let env = [("GIT_DIR", private.as_os_str()), ("GIT_COMMON_DIR", common.as_os_str()), ("GIT_WORK_TREE", self.repo.root.as_os_str()), ("GIT_INDEX_FILE", index.as_os_str())];
        run_git(&self.repo.root, &["-c", "core.splitIndex=false", "update-index", "--no-split-index"], &[], &env)?;
        Ok(())
    }

    fn index(&self) -> PathBuf {
        self.dir.path().join("index")
    }

    fn git<S: AsRef<OsStr>>(&self, index: &Path, args: &[S], input: &[u8]) -> Result<Vec<u8>> {
        let args: Vec<&OsStr> = ["-c", "core.splitIndex=false"].iter().map(OsStr::new).chain(args.iter().map(AsRef::as_ref)).collect();
        let env = [("GIT_INDEX_FILE", index.as_os_str()), ("GIT_OBJECT_DIRECTORY", self.store.as_os_str()), ("GIT_ALTERNATE_OBJECT_DIRECTORIES", &self.alternate)];
        run_git(&self.repo.root, &args, input, &env)
    }

    fn track_untracked(&self, wanted: &dyn Fn(&Path) -> bool) -> Result<()> {
        let index = self.index();
        let mut retried = false;
        loop {
            let listed = self.git(&index, &["ls-files", "-z", "--others", "--exclude-standard"], &[])?;
            let untracked: Vec<PathBuf> = nul_paths(&listed).filter(|rel| wanted(&self.repo.root.join(rel))).collect();
            if untracked.is_empty() {
                break;
            }
            match self.git(&index, &["add", "--sparse", "--intent-to-add", "--pathspec-from-file=-", "--pathspec-file-nul"], &nul_joined(&untracked)) {
                Ok(_) => break,
                Err(_) if !retried => retried = true,
                Err(err) => return Err(err),
            }
        }
        if let Some(written) = self.written {
            std::fs::File::options().write(true).open(&index)?.set_modified(written)?;
        }
        Ok(())
    }

    fn changes(&self, base: &str, submodules: Submodules, wanted: &dyn Fn(&Path) -> bool) -> Result<Vec<(PathBuf, Baseline)>> {
        let diff = self.git(&self.index(), &["diff", "--raw", "-z", "-M", "--no-abbrev", "--ignore-submodules=all", base], &[])?;
        let mut fields = diff.split(|&byte| byte == 0).filter(|field| !field.is_empty());
        let mut found: Vec<(PathBuf, Option<String>)> = Vec::new();
        let mut nested = Vec::new();
        if submodules == Submodules::Follow {
            let listed = self.git(&self.index(), &["ls-tree", "-r", "-z", base], &[])?;
            for entry in listed.split(|&byte| byte == 0) {
                let Some(tab) = entry.iter().position(|&byte| byte == b'\t') else { continue };
                if let Some(recorded) = entry[..tab].strip_prefix(format!("{GITLINK} commit ").as_bytes()) {
                    nested.extend(self.repo.submodule_changes(&path_of(&entry[tab + 1..]), &String::from_utf8_lossy(recorded)));
                }
            }
        }
        while let Some(header) = fields.next() {
            let header = String::from_utf8_lossy(header);
            let words: Vec<&str> = header.trim_start_matches(':').split(' ').collect();
            let [old_mode, new_mode, old_id, _, status] = words[..] else { bail!("git diff --raw printed an unexpected line: {header}") };
            let first = path_of(fields.next().context("git diff --raw ended early")?);
            let second = if status.starts_with(['R', 'C']) { Some(path_of(fields.next().context("git diff --raw ended early")?)) } else { None };
            if old_mode == GITLINK || new_mode == GITLINK {
                continue;
            }
            let current = match status.as_bytes().first() {
                Some(b'D') => continue,
                _ => second.unwrap_or(first),
            };
            let path = self.repo.root.join(&current);
            if !wanted(&path) {
                continue;
            }
            let absent = status.starts_with('A') || old_id.bytes().all(|byte| byte == b'0');
            found.push((path, (!absent).then(|| old_id.to_string())));
        }
        let blobs = self.blobs(found.iter().filter_map(|(_, id)| id.as_deref()))?;
        let mut changes = Vec::with_capacity(found.len() + nested.len());
        for (path, id) in found {
            let baseline = match id {
                Some(id) => Baseline::Text(blobs.get(&id).cloned().with_context(|| format!("git cat-file --batch did not return {id}"))?),
                None => Baseline::Absent,
            };
            changes.push((path, baseline));
        }
        changes.extend(nested);
        Ok(changes)
    }

    fn blobs<'i>(&self, ids: impl Iterator<Item = &'i str>) -> Result<HashMap<String, String>> {
        let input: Vec<u8> = ids.flat_map(|id| id.bytes().chain([b'\n'])).collect();
        let mut blobs = HashMap::new();
        if input.is_empty() {
            return Ok(blobs);
        }
        let out = self.git(&self.index(), &["cat-file", "--batch"], &input)?;
        let mut rest = &out[..];
        while !rest.is_empty() {
            let end = rest.iter().position(|&byte| byte == b'\n').context("git cat-file --batch ended early")?;
            let header = String::from_utf8_lossy(&rest[..end]).into_owned();
            let [id, "blob", size] = header.split(' ').collect::<Vec<_>>()[..] else { bail!("git cat-file --batch printed {header}") };
            let size: usize = size.parse().with_context(|| format!("git cat-file --batch printed {header}"))?;
            let body = rest.get(end + 1..end + 1 + size).context("git cat-file --batch ended early")?;
            blobs.insert(id.to_string(), String::from_utf8_lossy(body).into_owned());
            rest = rest.get(end + 2 + size..).unwrap_or_default();
        }
        Ok(blobs)
    }
}

fn shared_indexes(git_dir: &Path) -> impl Iterator<Item = PathBuf> {
    std::fs::read_dir(git_dir).into_iter().flatten().filter_map(|entry| entry.ok()).filter(|entry| entry.file_name().as_bytes().starts_with(b"sharedindex.")).map(|entry| entry.path())
}

#[derive(Default)]
pub struct Repos(HashMap<PathBuf, Option<Repo>>);

impl Repos {
    pub fn of(&mut self, file: &Path) -> Option<Repo> {
        let dir = file.parent().unwrap_or(file).to_path_buf();
        self.0.entry(dir).or_insert_with_key(|dir| Repo::discover(dir)).clone()
    }
}

fn lintable(path: &Path) -> bool {
    language_of(path).is_some()
}

fn quoted(bytes: &[u8]) -> Vec<u8> {
    let mut out = vec![b'"'];
    for &byte in bytes {
        match byte {
            b'"' | b'\\' => out.extend([b'\\', byte]),
            0x20..=0x7e => out.push(byte),
            _ => out.extend(format!("\\{byte:03o}").bytes()),
        }
    }
    out.push(b'"');
    out
}

pub fn nul_joined(paths: &[PathBuf]) -> Vec<u8> {
    let mut joined = Vec::new();
    for path in paths {
        joined.extend_from_slice(path.as_os_str().as_bytes());
        joined.push(0);
    }
    joined
}

pub fn path_of(bytes: &[u8]) -> PathBuf {
    PathBuf::from(OsString::from_vec(bytes.to_vec()))
}

pub fn nul_paths(bytes: &[u8]) -> impl Iterator<Item = PathBuf> + '_ {
    bytes.split(|&byte| byte == 0).filter(|field| !field.is_empty()).map(path_of)
}

fn git<S: AsRef<OsStr>>(dir: &Path, args: &[S]) -> Result<Vec<u8>> {
    run_git(dir, args, &[], &[])
}

fn run_git<S: AsRef<OsStr>>(dir: &Path, args: &[S], input: &[u8], env: &[(&str, &OsStr)]) -> Result<Vec<u8>> {
    let mut child = Command::new("git")
        .envs(env.iter().copied())
        .args(["--literal-pathspecs", "--no-optional-locks", "-c", "core.hooksPath=/dev/null"])
        .arg("-C")
        .arg(dir)
        .args(args)
        .stdin(if input.is_empty() { Stdio::null() } else { Stdio::piped() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("cannot run git")?;
    let writer = child.stdin.take().map(|mut stdin| {
        let input = input.to_vec();
        std::thread::spawn(move || stdin.write_all(&input))
    });
    let output = child.wait_with_output()?;
    if let Some(writer) = writer {
        writer.join().map_err(|_| anyhow::anyhow!("git stdin writer panicked"))??;
    }
    if !output.status.success() {
        let shown: Vec<String> = args.iter().map(|arg| arg.as_ref().to_string_lossy().into_owned()).collect();
        bail!("git {} in {}: {}", shown.join(" "), dir.display(), String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(output.stdout)
}
