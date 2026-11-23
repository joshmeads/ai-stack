use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::{ErrorKind, Write as _};
use std::os::unix::ffi::{OsStrExt as _, OsStringExt as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::SystemTime;

use anyhow::{Context as _, Result, anyhow, bail};

use super::Baseline;
use super::scan::language_of;
use crate::paths;

pub const GITLINK: &str = "160000";
pub const SYMLINK: &str = "120000";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Attributes {
    Worktree,
    Index(Option<PathBuf>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repo {
    pub root: PathBuf,
    pub project_key: PathBuf,
}

#[derive(Default)]
pub struct HeadPrior {
    pub removed: String,
    pub files: HashMap<PathBuf, Baseline>,
}

pub struct RawEntry {
    pub old_mode: String,
    pub new_mode: String,
    pub old_id: String,
    pub new_id: String,
    pub status: String,
    pub path: PathBuf,
}

impl RawEntry {
    pub fn absent_before(&self) -> bool {
        self.status.starts_with('A') || self.old_id.bytes().all(|byte| byte == b'0')
    }
}

pub fn parse_raw(diff: &[u8]) -> Result<Vec<RawEntry>> {
    let mut fields = diff.split(|&byte| byte == 0).filter(|field| !field.is_empty());
    let mut entries = Vec::new();
    while let Some(header) = fields.next() {
        let header = String::from_utf8_lossy(header);
        let words: Vec<&str> = header.trim_start_matches(':').split(' ').collect();
        let [old_mode, new_mode, old_id, new_id, status] = words[..] else { bail!("git diff --raw printed an unexpected line: {header}") };
        let first = path_of(fields.next().context("git diff --raw ended early")?);
        let second = if status.starts_with(['R', 'C']) { Some(path_of(fields.next().context("git diff --raw ended early")?)) } else { None };
        if status.starts_with('D') {
            continue;
        }
        entries.push(RawEntry {
            old_mode: old_mode.into(),
            new_mode: new_mode.into(),
            old_id: old_id.into(),
            new_id: new_id.into(),
            status: status.into(),
            path: second.unwrap_or(first),
        });
    }
    Ok(entries)
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

    pub fn generated(&self, rels: &[PathBuf], from: &Attributes) -> HashSet<PathBuf> {
        self.with_attribute(rels, &["linguist-generated", "linguist-vendored"], from, |value| matches!(value, b"set" | b"true")).unwrap_or_default()
    }

    pub fn filtered(&self, rels: &[PathBuf], from: &Attributes) -> Result<HashSet<PathBuf>> {
        self.with_attribute(rels, &["filter"], from, |value| !matches!(value, b"unspecified" | b"unset"))
    }

    pub fn flagged(&self, rels: &[PathBuf], index: Option<&Path>) -> HashSet<PathBuf> {
        if rels.is_empty() {
            return HashSet::new();
        }
        let env: Vec<(&str, &OsStr)> = index.iter().map(|index| ("GIT_INDEX_FILE", index.as_os_str())).collect();
        let mut args: Vec<&OsStr> = ["ls-files", "-v", "-z", "--"].map(OsStr::new).to_vec();
        args.extend(rels.iter().map(|rel| rel.as_os_str()));
        let Ok(out) = run_git(&self.root, &args, &[], &env) else { return rels.iter().cloned().collect() };
        out.split(|&byte| byte == 0)
            .filter_map(|tagged| {
                let (&tag, rest) = tagged.split_first()?;
                let rel = rest.strip_prefix(b" ")?;
                (tag == b'S' || tag.is_ascii_lowercase()).then(|| path_of(rel))
            })
            .collect()
    }

    fn with_attribute(&self, rels: &[PathBuf], names: &[&str], from: &Attributes, holds: impl Fn(&[u8]) -> bool) -> Result<HashSet<PathBuf>> {
        if rels.is_empty() {
            return Ok(HashSet::new());
        }
        let input = nul_joined(rels);
        let out = match from {
            Attributes::Worktree => Workspace::new(self, None)?.git(&[&["check-attr", "-z", "--stdin"], names].concat(), &input)?,
            Attributes::Index(index) => {
                let env: Vec<(&str, &OsStr)> = index.iter().map(|index| ("GIT_INDEX_FILE", index.as_os_str())).collect();
                run_git(&self.root, &[&["check-attr", "--cached", "-z", "--stdin"], names].concat(), &input, &env)?
            }
        };
        let fields: Vec<&[u8]> = out.split(|&byte| byte == 0).collect();
        Ok(fields.chunks(3).filter(|chunk| chunk.len() == 3 && holds(chunk[2])).map(|chunk| path_of(chunk[0])).collect())
    }

    pub fn head(&self) -> Option<String> {
        let out = git(&self.root, &["rev-parse", "--verify", "--quiet", "--end-of-options", "HEAD^{commit}"]).ok()?;
        Some(String::from_utf8_lossy(&out).trim().to_string())
    }

    pub fn blob_at(&self, rev: &str, rel: &Path) -> Result<Option<Vec<u8>>> {
        let mut spec = format!("{rev}:").into_bytes();
        spec.extend_from_slice(rel.as_os_str().as_bytes());
        spec.push(b'\n');
        let out = run_git(&self.root, &["cat-file", "--batch"], &spec, &[])?;
        let end = out.iter().position(|&byte| byte == b'\n').context("git cat-file --batch printed nothing")?;
        let header = String::from_utf8_lossy(&out[..end]);
        if header.ends_with(" missing") || header.ends_with(" ambiguous") {
            return Ok(None);
        }
        let size: usize = header.rsplit(' ').next().and_then(|size| size.parse().ok()).with_context(|| format!("git cat-file --batch printed {header}"))?;
        Ok(out.get(end + 1..end + 1 + size).map(<[u8]>::to_vec))
    }

    pub fn changes(&self, base: &str, against_head: bool) -> Result<(Vec<(PathBuf, Baseline)>, HeadPrior)> {
        let Some(head) = self.head() else {
            if base != "HEAD" {
                bail!("{} has no commits yet, so --base {base} cannot be resolved", self.root.display());
            }
            let work = Workspace::new(self, None)?;
            work.track_untracked()?;
            let all = work.git(&["ls-files", "-z", "--cached"], &[])?;
            let files: Vec<(PathBuf, Baseline)> = nul_paths(&all).map(|rel| self.root.join(rel)).filter(|path| lintable(path)).map(|path| (path, Baseline::Absent)).collect();
            let prior = HeadPrior { removed: String::new(), files: files.iter().cloned().collect() };
            return Ok((files, prior));
        };
        git(&self.root, &["rev-parse", "--verify", "--quiet", "--end-of-options", &format!("{base}^{{commit}}")])
            .map_err(|_| anyhow!("--base {base} does not name a commit in {}", self.root.display()))?;
        let merge_base = git(&self.root, &["merge-base", base, "HEAD"])
            .map_err(|_| anyhow!("{base} and HEAD share no history in {}, so they have no merge base to compare against", self.root.display()))?;
        let merge_base = String::from_utf8(merge_base)?;
        let work = Workspace::new(self, Some(&head))?;
        work.track_untracked()?;
        let prior = match against_head {
            true => HeadPrior {
                removed: removed_lines(&work.git(&["diff", "-U0", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--text", "--ignore-submodules=all", &head], &[])?),
                files: work.changes(&head)?.into_iter().collect(),
            },
            false => HeadPrior::default(),
        };
        Ok((work.changes(merge_base.trim())?, prior))
    }

    fn changes_from(&self, head: &str, base: &str) -> Result<Vec<(PathBuf, Baseline)>> {
        let work = Workspace::new(self, Some(head))?;
        work.track_untracked()?;
        work.changes(base)
    }

    fn submodule_changes(&self, rel: &Path, recorded: &str) -> Vec<(PathBuf, Baseline)> {
        let dir = self.root.join(rel);
        let Some(submodule) = Repo::discover(&dir).filter(|submodule| submodule.root == paths::resolve(&dir)) else { return Vec::new() };
        let Some(head) = submodule.head() else { return Vec::new() };
        submodule.changes_from(&head, recorded).unwrap_or_default()
    }
}

struct Workspace<'a> {
    repo: &'a Repo,
    dir: tempfile::TempDir,
    alternate: OsString,
    written: Option<SystemTime>,
}

impl<'a> Workspace<'a> {
    fn new(repo: &'a Repo, head: Option<&str>) -> Result<Workspace<'a>> {
        let dir = tempfile::tempdir()?;
        std::fs::create_dir(dir.path().join("objects"))?;
        let out = git(&repo.root, &["rev-parse", "--path-format=absolute", "--git-path", "objects", "--git-path", "index", "--absolute-git-dir", "--git-common-dir"])?;
        let located: Vec<PathBuf> = out.split(|&byte| byte == b'\n').filter(|line| !line.is_empty()).map(path_of).collect();
        let [objects, real, git_dir, common] = &located[..] else { bail!("git rev-parse printed {} paths, not 4", located.len()) };
        let mut work = Workspace { repo, dir, alternate: OsString::from_vec(quoted(objects.as_os_str().as_bytes())), written: None };
        match std::fs::copy(real, work.index()) {
            Ok(_) => {
                work.written = Some(std::fs::metadata(real)?.modified()?);
                if shared_indexes(git_dir).next().is_some() {
                    work.unsplit(git_dir, common)?;
                }
            }
            Err(err) if err.kind() == ErrorKind::NotFound => {
                if let Some(head) = head {
                    work.git(&["read-tree", head], &[])?;
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

    fn git<S: AsRef<OsStr>>(&self, args: &[S], input: &[u8]) -> Result<Vec<u8>> {
        let args: Vec<&OsStr> = ["-c", "core.splitIndex=false"].iter().map(OsStr::new).chain(args.iter().map(AsRef::as_ref)).collect();
        let objects = self.dir.path().join("objects");
        let index = self.index();
        let env = [("GIT_INDEX_FILE", index.as_os_str()), ("GIT_OBJECT_DIRECTORY", objects.as_os_str()), ("GIT_ALTERNATE_OBJECT_DIRECTORIES", &self.alternate)];
        run_git(&self.repo.root, &args, input, &env)
    }

    fn track_untracked(&self) -> Result<()> {
        let mut retried = false;
        loop {
            let listed = self.git(&["ls-files", "-z", "--others", "--exclude-standard"], &[])?;
            let untracked: Vec<PathBuf> = nul_paths(&listed).filter(|rel| lintable(&self.repo.root.join(rel))).collect();
            if untracked.is_empty() {
                break;
            }
            match self.git(&["add", "--sparse", "--intent-to-add", "--pathspec-from-file=-", "--pathspec-file-nul"], &nul_joined(&untracked)) {
                Ok(_) => break,
                Err(_) if !retried => retried = true,
                Err(err) => return Err(err),
            }
        }
        if let Some(written) = self.written {
            std::fs::File::options().write(true).open(self.index())?.set_modified(written)?;
        }
        Ok(())
    }

    fn changes(&self, base: &str) -> Result<Vec<(PathBuf, Baseline)>> {
        let diff = self.git(&["diff", "--raw", "-z", "-M", "--no-abbrev", "--ignore-submodules=all", base], &[])?;
        let mut nested = Vec::new();
        let listed = self.git(&["ls-tree", "-r", "-z", base], &[])?;
        for entry in listed.split(|&byte| byte == 0) {
            let Some(tab) = entry.iter().position(|&byte| byte == b'\t') else { continue };
            if let Some(recorded) = entry[..tab].strip_prefix(format!("{GITLINK} commit ").as_bytes()) {
                nested.extend(self.repo.submodule_changes(&path_of(&entry[tab + 1..]), &String::from_utf8_lossy(recorded)));
            }
        }
        let found: Vec<(PathBuf, Option<String>)> = parse_raw(&diff)?
            .into_iter()
            .filter(|entry| entry.old_mode != GITLINK && entry.new_mode != GITLINK)
            .map(|entry| (self.repo.root.join(&entry.path), (!entry.absent_before()).then(|| entry.old_id.clone())))
            .filter(|(path, _)| lintable(path))
            .collect();
        let blobs = blobs(&self.repo.root, found.iter().filter_map(|(_, id)| id.as_deref()), |args, input| self.git(args, input))?;
        let mut changes = Vec::with_capacity(found.len() + nested.len());
        for (path, id) in found {
            let baseline = match id {
                Some(id) => Baseline::Text(String::from_utf8_lossy(blobs.get(&id).with_context(|| format!("git cat-file --batch did not return {id}"))?).into_owned()),
                None => Baseline::Absent,
            };
            changes.push((path, baseline));
        }
        changes.extend(nested);
        Ok(changes)
    }
}

pub fn removed_lines(patch: &[u8]) -> String {
    let mut removed = String::new();
    let mut in_hunk = false;
    for line in patch.split(|&byte| byte == b'\n') {
        if line.starts_with(b"diff --git ") {
            in_hunk = false;
        } else if line.starts_with(b"@@ ") {
            in_hunk = true;
        } else if in_hunk && let Some(text) = line.strip_prefix(b"-") {
            removed.push_str(&String::from_utf8_lossy(text));
            removed.push('\n');
        }
    }
    removed
}

pub fn blobs<'i>(dir: &Path, ids: impl Iterator<Item = &'i str>, git: impl Fn(&[&str], &[u8]) -> Result<Vec<u8>>) -> Result<HashMap<String, Vec<u8>>> {
    let input: Vec<u8> = ids.flat_map(|id| id.bytes().chain([b'\n'])).collect();
    let mut blobs = HashMap::new();
    if input.is_empty() {
        return Ok(blobs);
    }
    let out = git(&["cat-file", "--batch"], &input).with_context(|| format!("reading blobs in {}", dir.display()))?;
    let mut rest = &out[..];
    while !rest.is_empty() {
        let end = rest.iter().position(|&byte| byte == b'\n').context("git cat-file --batch ended early")?;
        let header = String::from_utf8_lossy(&rest[..end]).into_owned();
        let [id, "blob", size] = header.split(' ').collect::<Vec<_>>()[..] else { bail!("git cat-file --batch printed {header}") };
        let size: usize = size.parse().with_context(|| format!("git cat-file --batch printed {header}"))?;
        let body = rest.get(end + 1..end + 1 + size).context("git cat-file --batch ended early")?;
        blobs.insert(id.to_string(), body.to_vec());
        rest = rest.get(end + 2 + size..).unwrap_or_default();
    }
    Ok(blobs)
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

pub fn run_git<S: AsRef<OsStr>>(dir: &Path, args: &[S], input: &[u8], env: &[(&str, &OsStr)]) -> Result<Vec<u8>> {
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
