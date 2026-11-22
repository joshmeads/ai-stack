use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::{ErrorKind, Write as _};
use std::os::unix::ffi::{OsStrExt as _, OsStringExt as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context as _, Result, bail};

use super::Baseline;
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
        let Ok(out) = run_git(&self.root, &["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"], &input, &[]) else {
            return HashSet::new();
        };
        let fields: Vec<&[u8]> = out.split(|&byte| byte == 0).collect();
        fields.chunks(3).filter(|chunk| chunk.len() == 3 && matches!(chunk[2], b"set" | b"true")).map(|chunk| path_of(chunk[0])).collect()
    }

    fn head(&self) -> Option<String> {
        let out = git(&self.root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).ok()?;
        Some(String::from_utf8_lossy(&out).trim().to_string())
    }

    pub fn changes(&self, base: &str) -> Result<Vec<(PathBuf, Baseline)>> {
        let Some(head) = self.head() else {
            if base != "HEAD" {
                bail!("{} has no commits yet, so --base {base} cannot be resolved", self.root.display());
            }
            let all = git(&self.root, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
            return Ok(nul_paths(&all).map(|rel| self.root.join(rel)).filter(|path| lintable(path)).map(|path| (path, Baseline::Absent)).collect());
        };
        let merge_base = String::from_utf8(git(&self.root, &["merge-base", base, &head])?)?.trim().to_string();
        self.changes_from(&head, &merge_base)
    }

    fn changes_from(&self, head: &str, base: &str) -> Result<Vec<(PathBuf, Baseline)>> {
        let work = Workspace::new(self, None)?;
        work.track_untracked(Some(head), &lintable)?;
        work.changes(base, Submodules::Follow, &lintable)
    }

    pub fn snapshot(&self, store: &Path) -> Result<Snapshot> {
        let head = self.head();
        let work = Workspace::new(self, Some(store))?;
        let dirty = match &head {
            Some(head) => {
                work.track_untracked(Some(head), &lintable)?;
                work.git(&work.index(), &["diff", "--name-only", "-z", "--no-renames", "--ignore-submodules=all", head], &[])?
            }
            None => git(&self.root, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?,
        };
        let (mut hashed, mut removed, mut skipped) = (Vec::new(), Vec::new(), Vec::new());
        for rel in nul_paths(&dirty).filter(|rel| lintable(rel)) {
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
        Ok(Snapshot { tree, skipped })
    }

    pub fn changes_since(&self, snapshot: &Snapshot, store: &Path) -> Result<Vec<(PathBuf, Baseline)>> {
        let work = Workspace::new(self, Some(store))?;
        let skipped: HashSet<PathBuf> = snapshot.skipped.iter().map(|rel| self.root.join(rel)).collect();
        let wanted = |path: &Path| lintable(path) && !skipped.contains(path);
        work.track_untracked(self.head().as_deref(), &wanted)?;
        work.changes(&snapshot.tree, Submodules::Skip, &wanted)
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
    store: PathBuf,
    alternate: OsString,
}

impl<'a> Workspace<'a> {
    fn new(repo: &'a Repo, store: Option<&Path>) -> Result<Workspace<'a>> {
        let dir = tempfile::tempdir()?;
        let store = store.map_or_else(|| dir.path().join("objects"), Path::to_path_buf);
        std::fs::create_dir_all(&store).with_context(|| format!("creating {}", store.display()))?;
        let objects = path_of(git(&repo.root, &["rev-parse", "--path-format=absolute", "--git-path", "objects"])?.trim_ascii_end());
        Ok(Workspace { repo, dir, store, alternate: OsString::from_vec(quoted(objects.as_os_str().as_bytes())) })
    }

    fn index(&self) -> PathBuf {
        self.dir.path().join("index")
    }

    fn git(&self, index: &Path, args: &[&str], input: &[u8]) -> Result<Vec<u8>> {
        let args: Vec<&str> = ["-c", "core.splitIndex=false"].into_iter().chain(args.iter().copied()).collect();
        let env = [("GIT_INDEX_FILE", index.as_os_str()), ("GIT_OBJECT_DIRECTORY", self.store.as_os_str()), ("GIT_ALTERNATE_OBJECT_DIRECTORIES", &self.alternate)];
        run_git(&self.repo.root, &args, input, &env)
    }

    fn track_untracked(&self, head: Option<&str>, wanted: &dyn Fn(&Path) -> bool) -> Result<()> {
        let root = &self.repo.root;
        let index = self.index();
        let real = path_of(git(root, &["rev-parse", "--path-format=absolute", "--git-path", "index"])?.trim_ascii_end());
        let written = match std::fs::copy(&real, &index) {
            Ok(_) => Some(std::fs::metadata(&real)?.modified()?),
            Err(err) if err.kind() == ErrorKind::NotFound => {
                if let Some(head) = head {
                    self.git(&index, &["read-tree", head], &[])?;
                }
                None
            }
            Err(err) => return Err(err).with_context(|| format!("copying {}", real.display())),
        };
        let untracked: Vec<PathBuf> = nul_paths(&git(root, &["ls-files", "-z", "--others", "--exclude-standard"])?).filter(|rel| wanted(&root.join(rel))).collect();
        if !untracked.is_empty() {
            self.git(&index, &["add", "--intent-to-add", "--pathspec-from-file=-", "--pathspec-file-nul"], &nul_joined(&untracked))?;
        }
        if let Some(written) = written {
            std::fs::File::options().write(true).open(&index)?.set_modified(written)?;
        }
        Ok(())
    }

    fn changes(&self, base: &str, submodules: Submodules, wanted: &dyn Fn(&Path) -> bool) -> Result<Vec<(PathBuf, Baseline)>> {
        let diff = self.git(&self.index(), &["diff", "--raw", "-z", "-M", "--no-abbrev", "--ignore-submodules=none", base], &[])?;
        let mut fields = diff.split(|&byte| byte == 0).filter(|field| !field.is_empty());
        let mut changes = Vec::new();
        while let Some(header) = fields.next() {
            let header = String::from_utf8_lossy(header);
            let words: Vec<&str> = header.trim_start_matches(':').split(' ').collect();
            let [old_mode, new_mode, old_id, _, status] = words[..] else { bail!("git diff --raw printed an unexpected line: {header}") };
            let first = path_of(fields.next().context("git diff --raw ended early")?);
            let second = if status.starts_with(['R', 'C']) { Some(path_of(fields.next().context("git diff --raw ended early")?)) } else { None };
            if old_mode == GITLINK || new_mode == GITLINK {
                if submodules == Submodules::Follow && old_mode == new_mode && status == "M" {
                    changes.extend(self.repo.submodule_changes(&first, old_id));
                }
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
            let baseline = if status.starts_with('A') || old_id.bytes().all(|byte| byte == b'0') {
                Baseline::Absent
            } else {
                Baseline::Text(String::from_utf8_lossy(&self.git(&self.index(), &["cat-file", "blob", old_id], &[])?).into_owned())
            };
            changes.push((path, baseline));
        }
        Ok(changes)
    }
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
        .args(["--literal-pathspecs", "--no-optional-locks"])
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
