use std::collections::{HashMap, HashSet};
use std::io::Write as _;
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
        let out = String::from_utf8(out).ok()?;
        let mut lines = out.lines();
        let root = paths::resolve(Path::new(lines.next()?));
        let common = paths::resolve(Path::new(lines.next()?));
        let project_key = match common.file_name() {
            Some(name) if name == ".git" => common.parent().map_or_else(|| root.clone(), Path::to_path_buf),
            _ => root.clone(),
        };
        Some(Repo { root, project_key })
    }

    pub fn relative(&self, path: &Path) -> Option<String> {
        let rel = path.strip_prefix(&self.root).map(Path::to_path_buf).or_else(|_| paths::resolve(path).strip_prefix(&self.root).map(Path::to_path_buf)).ok()?;
        Some(rel.to_string_lossy().into_owned())
    }

    pub fn generated(&self, rels: &[String]) -> HashSet<String> {
        let mut input = Vec::new();
        for rel in rels {
            input.extend_from_slice(rel.as_bytes());
            input.push(0);
        }
        let Ok(out) = git_input(&self.root, &["check-attr", "-z", "--stdin", "linguist-generated", "linguist-vendored"], &input) else {
            return HashSet::new();
        };
        let fields: Vec<&[u8]> = out.split(|&byte| byte == 0).collect();
        fields
            .chunks(3)
            .filter(|chunk| chunk.len() == 3 && matches!(chunk[2], b"set" | b"true"))
            .map(|chunk| String::from_utf8_lossy(chunk[0]).into_owned())
            .collect()
    }

    pub fn changes(&self, base: &str, wanted: impl Fn(&str) -> bool) -> Result<Vec<(String, Baseline)>> {
        let merge_base = String::from_utf8(git(&self.root, &["merge-base", base, "HEAD"])?)?.trim().to_string();
        let diff = git(&self.root, &["diff", "--name-status", "-z", "-M", "--no-ext-diff", &merge_base])?;
        let mut fields = nul_fields(&diff);
        let mut sources: Vec<(String, Option<String>)> = Vec::new();
        while let Some(status) = fields.next() {
            let first = fields.next().context("git diff --name-status ended early")?;
            match status.chars().next() {
                Some('R' | 'C') => sources.push((fields.next().context("git diff --name-status ended early")?, Some(first))),
                Some('A') => sources.push((first, None)),
                Some('D') => {}
                _ => sources.push((first.clone(), Some(first))),
            }
        }
        sources.extend(nul_fields(&git(&self.root, &["ls-files", "-z", "--others", "--exclude-standard"])?).map(|rel| (rel, None)));
        sources
            .into_iter()
            .filter(|(current, _)| wanted(current))
            .map(|(current, before)| {
                let baseline = match before {
                    Some(before) => self.blob(&merge_base, &before)?,
                    None => Baseline::Absent,
                };
                Ok((current, baseline))
            })
            .collect()
    }

    fn blob(&self, rev: &str, rel: &str) -> Result<Baseline> {
        let bytes = git(&self.root, &["cat-file", "blob", &format!("{rev}:{rel}")])?;
        Ok(Baseline::Text(String::from_utf8_lossy(&bytes).into_owned()))
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

fn nul_fields(bytes: &[u8]) -> impl Iterator<Item = String> + '_ {
    bytes.split(|&byte| byte == 0).filter(|field| !field.is_empty()).map(|field| String::from_utf8_lossy(field).into_owned())
}

fn git(dir: &Path, args: &[&str]) -> Result<Vec<u8>> {
    git_input(dir, args, &[])
}

fn git_input(dir: &Path, args: &[&str], input: &[u8]) -> Result<Vec<u8>> {
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
        bail!("git {} in {}: {}", args.join(" "), dir.display(), String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(output.stdout)
}
