use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::io::Write as _;
use std::os::unix::ffi::{OsStrExt as _, OsStringExt as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context as _, Result, bail};

use super::Baseline;
use crate::paths;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repo {
    pub root: PathBuf,
    pub project_key: PathBuf,
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
        let mut input = Vec::new();
        for rel in rels {
            input.extend_from_slice(rel.as_os_str().as_bytes());
            input.push(0);
        }
        let Ok(out) = git_input(&self.root, &["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"], &input, None) else {
            return HashSet::new();
        };
        let fields: Vec<&[u8]> = out.split(|&byte| byte == 0).collect();
        fields.chunks(3).filter(|chunk| chunk.len() == 3 && matches!(chunk[2], b"set" | b"true")).map(|chunk| path_of(chunk[0])).collect()
    }

    pub fn changes(&self, base: &str, wanted: &dyn Fn(&Path) -> bool) -> Result<Vec<(PathBuf, Baseline)>> {
        if git(&self.root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).is_err() {
            if base != "HEAD" {
                bail!("{} has no commits yet, so --base {base} cannot be resolved", self.root.display());
            }
            let all = git(&self.root, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
            return Ok(nul_paths(&all).map(|rel| self.root.join(rel)).filter(|path| wanted(path)).map(|path| (path, Baseline::Absent)).collect());
        }
        let merge_base = String::from_utf8(git(&self.root, &["merge-base", base, "HEAD"])?)?.trim().to_string();
        let index = self.index_with_untracked(wanted)?;
        let diff = git_input(&self.root, &["diff", "--raw", "-z", "-M", "--no-abbrev", "--ignore-submodules=none", &merge_base], &[], Some(&*index))?;
        let mut fields = diff.split(|&byte| byte == 0).filter(|field| !field.is_empty());
        let mut changes = Vec::new();
        while let Some(header) = fields.next() {
            let header = String::from_utf8_lossy(header);
            let words: Vec<&str> = header.trim_start_matches(':').split(' ').collect();
            let [old_mode, new_mode, old_id, _, status] = words[..] else { bail!("git diff --raw printed an unexpected line: {header}") };
            let first = path_of(fields.next().context("git diff --raw ended early")?);
            let second = if status.starts_with(['R', 'C']) { Some(path_of(fields.next().context("git diff --raw ended early")?)) } else { None };
            if old_mode == GITLINK || new_mode == GITLINK {
                if old_mode == new_mode && status == "M" {
                    changes.extend(self.submodule_changes(&first, old_id, wanted));
                }
                continue;
            }
            let (current, before) = match (status.as_bytes().first(), second) {
                (Some(b'D'), _) => continue,
                (Some(b'A'), _) => (first, None),
                (_, Some(destination)) => (destination, Some(first)),
                (_, None) => (first.clone(), Some(first)),
            };
            let path = self.root.join(&current);
            if !wanted(&path) {
                continue;
            }
            let baseline = match before {
                None => Baseline::Absent,
                Some(before) => match self.blob(&merge_base, &before) {
                    Ok(bytes) => Baseline::Text(String::from_utf8_lossy(&bytes).into_owned()),
                    Err(_) if status == "U" => Baseline::Absent,
                    Err(error) => return Err(error),
                },
            };
            changes.push((path, baseline));
        }
        Ok(changes)
    }

    fn index_with_untracked(&self, wanted: &dyn Fn(&Path) -> bool) -> Result<tempfile::TempPath> {
        let index = tempfile::NamedTempFile::new()?.into_temp_path();
        let real = path_of(git(&self.root, &["rev-parse", "--path-format=absolute", "--git-path", "index"])?.trim_ascii_end());
        let written = match std::fs::copy(&real, &index) {
            Ok(_) => std::fs::metadata(&real)?.modified()?,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                git_input(&self.root, &["read-tree", "HEAD"], &[], Some(&*index))?;
                std::time::SystemTime::UNIX_EPOCH
            }
            Err(err) => return Err(err).with_context(|| format!("copying {}", real.display())),
        };
        let mut untracked = Vec::new();
        for rel in nul_paths(&git(&self.root, &["ls-files", "-z", "--others", "--exclude-standard"])?) {
            if wanted(&self.root.join(&rel)) {
                untracked.extend_from_slice(rel.as_os_str().as_bytes());
                untracked.push(0);
            }
        }
        if !untracked.is_empty() {
            git_input(&self.root, &["add", "--intent-to-add", "--pathspec-from-file=-", "--pathspec-file-nul"], &untracked, Some(&*index))?;
        }
        std::fs::File::options().write(true).open(&index)?.set_modified(written)?;
        Ok(index)
    }

    fn submodule_changes(&self, rel: &Path, recorded: &str, wanted: &dyn Fn(&Path) -> bool) -> Vec<(PathBuf, Baseline)> {
        let dir = self.root.join(rel);
        match Repo::discover(&dir) {
            Some(submodule) if submodule.root == paths::resolve(&dir) => submodule.changes(recorded, wanted).unwrap_or_default(),
            _ => Vec::new(),
        }
    }

    fn blob(&self, rev: &str, rel: &Path) -> Result<Vec<u8>> {
        let mut spec = OsString::from(format!("{rev}:"));
        spec.push(rel.as_os_str());
        git(&self.root, &[OsStr::new("cat-file"), OsStr::new("blob"), &spec])
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

fn path_of(bytes: &[u8]) -> PathBuf {
    PathBuf::from(OsString::from_vec(bytes.to_vec()))
}

fn nul_paths(bytes: &[u8]) -> impl Iterator<Item = PathBuf> + '_ {
    bytes.split(|&byte| byte == 0).filter(|field| !field.is_empty()).map(path_of)
}

const GITLINK: &str = "160000";

fn git<S: AsRef<OsStr>>(dir: &Path, args: &[S]) -> Result<Vec<u8>> {
    git_input(dir, args, &[], None)
}

fn git_input<S: AsRef<OsStr>>(dir: &Path, args: &[S], input: &[u8], index: Option<&Path>) -> Result<Vec<u8>> {
    let mut command = Command::new("git");
    if let Some(index) = index {
        command.env("GIT_INDEX_FILE", index);
    }
    let mut child = command
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
