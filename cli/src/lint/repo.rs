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
        let project_key = match common.file_name() {
            Some(name) if name == ".git" => common.parent().map_or_else(|| root.clone(), Path::to_path_buf),
            _ => root.clone(),
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
        let Ok(out) = git_input(&self.root, &["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"], &input) else {
            return HashSet::new();
        };
        let fields: Vec<&[u8]> = out.split(|&byte| byte == 0).collect();
        fields.chunks(3).filter(|chunk| chunk.len() == 3 && matches!(chunk[2], b"set" | b"true")).map(|chunk| path_of(chunk[0])).collect()
    }

    pub fn changes(&self, base: &str, wanted: impl Fn(&Path) -> bool) -> Result<Vec<(PathBuf, Baseline)>> {
        if git(&self.root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).is_err() {
            if base != "HEAD" {
                bail!("{} has no commits yet, so --base {base} cannot be resolved", self.root.display());
            }
            let all = git(&self.root, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"])?;
            return Ok(nul_paths(&all).filter(|rel| wanted(rel)).map(|rel| (rel, Baseline::Absent)).collect());
        }
        let merge_base = String::from_utf8(git(&self.root, &["merge-base", base, "HEAD"])?)?.trim().to_string();
        let diff = git(&self.root, &["diff", "--name-status", "-z", "-M", "--no-ext-diff", &merge_base])?;
        let mut fields = nul_paths(&diff);
        let mut sources: Vec<(PathBuf, Option<PathBuf>)> = Vec::new();
        let mut deleted: Vec<PathBuf> = Vec::new();
        while let Some(status) = fields.next() {
            let first = fields.next().context("git diff --name-status ended early")?;
            match status.as_os_str().as_bytes().first() {
                Some(b'R' | b'C') => sources.push((fields.next().context("git diff --name-status ended early")?, Some(first))),
                Some(b'A') => sources.push((first, None)),
                Some(b'D') => deleted.push(first),
                _ => sources.push((first.clone(), Some(first))),
            }
        }
        let mut deleted_blobs: HashMap<PathBuf, Vec<u8>> = HashMap::new();
        for untracked in nul_paths(&git(&self.root, &["ls-files", "-z", "--others", "--exclude-standard"])?) {
            if !wanted(&untracked) {
                continue;
            }
            let renamed_from = match std::fs::read(self.root.join(&untracked)) {
                Ok(content) if !deleted.is_empty() => self.deleted_with(&content, &merge_base, &deleted, &mut deleted_blobs)?,
                _ => None,
            };
            sources.push((untracked, renamed_from));
        }
        sources
            .into_iter()
            .filter(|(current, _)| wanted(current))
            .map(|(current, before)| {
                let baseline = match before {
                    Some(before) => Baseline::Text(String::from_utf8_lossy(&self.blob(&merge_base, &before)?).into_owned()),
                    None => Baseline::Absent,
                };
                Ok((current, baseline))
            })
            .collect()
    }

    fn deleted_with(&self, content: &[u8], rev: &str, deleted: &[PathBuf], blobs: &mut HashMap<PathBuf, Vec<u8>>) -> Result<Option<PathBuf>> {
        for path in deleted {
            if !blobs.contains_key(path) {
                blobs.insert(path.clone(), self.blob(rev, path)?);
            }
            if blobs[path] == content {
                return Ok(Some(path.clone()));
            }
        }
        Ok(None)
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

fn git<S: AsRef<OsStr>>(dir: &Path, args: &[S]) -> Result<Vec<u8>> {
    git_input(dir, args, &[])
}

fn git_input<S: AsRef<OsStr>>(dir: &Path, args: &[S], input: &[u8]) -> Result<Vec<u8>> {
    let mut child = Command::new("git")
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
