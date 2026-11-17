use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, Write};
use std::os::unix::fs::{OpenOptionsExt as _, PermissionsExt as _};
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::exec::{self, Exec, strings};
use crate::stackfile::{PRIVATE_DIR, SKILLS_DIR};

pub const SEALED: &str = "private.age";
pub const RECIPIENTS: &str = "private.recipients";
pub const HOOKS: &str = ".githooks";
pub const KEY_SECRET: &str = "AI_STACK_PRIVATE_KEY";
pub const GUARD_FILE: &str = "guard.txt";
const STATE: &str = "ai-stack-private";
const NO_COMMIT: &str = "0000000000000000000000000000000000000000";

pub struct Private<'a> {
    pub exec: &'a dyn Exec,
    pub repo: PathBuf,
    pub git_dir: PathBuf,
    pub key_command: Vec<String>,
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug)]
struct Bundle {
    files: BTreeMap<String, File>,
}

#[derive(Serialize, Deserialize, PartialEq, Eq, Debug)]
struct File {
    executable: bool,
    data: String,
}

pub enum Opened {
    Nothing,
    Current,
    Replaced,
}

impl Private<'_> {
    pub fn locate<'a>(exec: &'a dyn Exec, dir: &Path, key_command: Vec<String>) -> Result<Private<'a>> {
        let top = exec::check(exec, "git", &strings(&["rev-parse", "--show-toplevel"]), Some(dir))?;
        let git_dir = exec::check(exec, "git", &strings(&["rev-parse", "--absolute-git-dir"]), Some(dir))?;
        Ok(Private { exec, repo: PathBuf::from(top.trim()), git_dir: PathBuf::from(git_dir.trim()), key_command })
    }

    fn dir(&self) -> PathBuf {
        self.repo.join(PRIVATE_DIR)
    }

    fn sealed(&self) -> PathBuf {
        self.repo.join(SEALED)
    }

    fn state(&self) -> Result<PathBuf> {
        let state = self.git_dir.join(STATE);
        fs::create_dir_all(&state).with_context(|| format!("cannot create {}", state.display()))?;
        fs::set_permissions(&state, fs::Permissions::from_mode(0o700))?;
        Ok(state)
    }

    fn remembered(&self) -> Result<(Option<Vec<u8>>, Option<Vec<u8>>)> {
        let state = self.state()?;
        Ok((fs::read(state.join("bundle.json")).ok(), fs::read(state.join(SEALED)).ok()))
    }

    fn remember(&self, bundle: &[u8]) -> Result<()> {
        let state = self.state()?;
        write_private(&state.join("bundle.json"), bundle)?;
        fs::copy(self.sealed(), state.join(SEALED)).with_context(|| format!("cannot copy {}", self.sealed().display()))?;
        Ok(())
    }

    pub fn init(&self, out: &mut dyn Write) -> Result<()> {
        exec::check(self.exec, "git", &strings(&["config", "core.hooksPath", HOOKS]), Some(&self.repo))?;
        writeln!(out, "git hooks now run from {HOOKS}/ in {}", self.repo.display())?;
        match self.open(false, out) {
            Ok(_) => Ok(()),
            Err(err) => {
                writeln!(out, "warning: {err:#}")?;
                Ok(())
            }
        }
    }

    pub fn seal(&self, stage: bool, out: &mut dyn Write) -> Result<()> {
        if !self.dir().is_dir() {
            return Ok(());
        }
        let bundle = pack(&self.dir())?;
        let (saved, _) = self.remembered()?;
        if self.sealed().is_file() && saved.as_deref() == Some(bundle.as_slice()) {
            return Ok(());
        }
        let recipients = self.repo.join(RECIPIENTS);
        ensure!(recipients.is_file(), "{} is missing, so {PRIVATE_DIR}/ cannot be sealed", recipients.display());
        let work = tempfile::tempdir_in(self.state()?)?;
        let plain = work.path().join("bundle.json");
        write_private(&plain, &bundle)?;
        let next = work.path().join(SEALED);
        let args = vec!["-R".to_string(), path_arg(&recipients), "-o".to_string(), path_arg(&next), path_arg(&plain)];
        exec::check(self.exec, "age", &args, Some(&self.repo))?;
        fs::copy(&next, self.sealed()).with_context(|| format!("cannot write {}", self.sealed().display()))?;
        if stage {
            exec::check(self.exec, "git", &strings(&["add", "--", SEALED]), Some(&self.repo))?;
        }
        self.remember(&bundle)?;
        writeln!(out, "sealed {PRIVATE_DIR}/ into {SEALED}")?;
        Ok(())
    }

    pub fn open(&self, force: bool, out: &mut dyn Write) -> Result<Opened> {
        if !self.sealed().is_file() {
            return Ok(Opened::Nothing);
        }
        let sealed = fs::read(self.sealed())?;
        let (saved, saved_sealed) = self.remembered()?;
        let current = if self.dir().exists() { Some(pack(&self.dir())?) } else { None };
        if let Some(current) = &current {
            let unsealed = saved.as_deref() != Some(current.as_slice());
            if unsealed && !force {
                bail!("{} has changes that are not sealed in {SEALED}; commit them (the pre-commit hook seals them) or run `ai-stack private open --force` to replace them", self.dir().display());
            }
            if !unsealed && saved_sealed.as_deref() == Some(sealed.as_slice()) {
                return Ok(Opened::Current);
            }
        }
        let work = tempfile::tempdir_in(self.state()?)?;
        let key = work.path().join("key.txt");
        let (program, args) = self.key_command.split_first().ok_or_else(|| anyhow!("no command reads the private key"))?;
        let identity = exec::check(self.exec, program, args, Some(&self.repo)).context("reading the private key")?;
        ensure!(identity.contains("AGE-SECRET-KEY-"), "`{}` did not print an age identity", exec::command_line(program, args));
        write_private(&key, identity.as_bytes())?;
        let plain = work.path().join("bundle.json");
        let args = vec!["-d".to_string(), "-i".to_string(), path_arg(&key), "-o".to_string(), path_arg(&plain), path_arg(&self.sealed())];
        exec::check(self.exec, "age", &args, Some(&self.repo))?;
        let bundle = fs::read(&plain)?;
        if current.as_deref() != Some(bundle.as_slice()) {
            unpack(&bundle, &self.dir(), &self.repo)?;
        }
        self.remember(&bundle)?;
        writeln!(out, "opened {SEALED} into {PRIVATE_DIR}/")?;
        Ok(Opened::Replaced)
    }

    pub fn check(&self, updates: &mut dyn BufRead, out: &mut dyn Write) -> Result<i32> {
        let words = self.guarded_words()?;
        let mut found = BTreeSet::new();
        let mut line = String::new();
        while updates.read_line(&mut line)? > 0 {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if let [_, local, _, remote] = fields[..] {
                if local != NO_COMMIT {
                    let range = if remote == NO_COMMIT { vec![local.to_string(), "--not".into(), "--remotes".into()] } else { vec![format!("{remote}..{local}")] };
                    found.extend(self.leaks(&range, &words)?);
                }
            }
            line.clear();
        }
        if found.is_empty() {
            return Ok(0);
        }
        writeln!(out, "push refused: the outgoing commits contain private content:")?;
        for leak in &found {
            writeln!(out, "  {leak}")?;
        }
        writeln!(out, "Remove it from those commits (it belongs in {PRIVATE_DIR}/, which {SEALED} carries encrypted), then push again.")?;
        Ok(1)
    }

    fn guarded_words(&self) -> Result<BTreeSet<String>> {
        let mut words = BTreeSet::new();
        if let Ok(entries) = fs::read_dir(self.dir().join(SKILLS_DIR)) {
            for entry in entries {
                let name = entry?.file_name().to_string_lossy().into_owned();
                if !name.starts_with('.') {
                    words.insert(name.to_lowercase());
                }
            }
        }
        if let Ok(text) = fs::read_to_string(self.dir().join(GUARD_FILE)) {
            words.extend(text.lines().map(str::trim).filter(|word| !word.is_empty() && !word.starts_with('#')).map(str::to_lowercase));
        }
        Ok(words)
    }

    fn leaks(&self, range: &[String], words: &BTreeSet<String>) -> Result<BTreeSet<String>> {
        let mut found = BTreeSet::new();
        let names = ["log", "--format=", "--name-only", "--no-renames"].iter().map(|arg| arg.to_string()).chain(range.iter().cloned()).collect::<Vec<_>>();
        for path in exec::check(self.exec, "git", &names, Some(&self.repo))?.lines() {
            if path == PRIVATE_DIR || path.starts_with(&format!("{PRIVATE_DIR}/")) {
                found.insert(format!("the path {path}"));
            }
        }
        if !words.is_empty() {
            let patch = ["log", "-p", "--format=%B", "--no-ext-diff", "--no-textconv"].iter().map(|arg| arg.to_string()).chain(range.iter().cloned()).collect::<Vec<_>>();
            let text = exec::check(self.exec, "git", &patch, Some(&self.repo))?.to_lowercase();
            found.extend(words.iter().filter(|word| text.contains(word.as_str())).map(|word| format!("the private name {word:?}")));
        }
        Ok(found)
    }
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path).with_context(|| format!("cannot write {}", path.display()))?;
    file.write_all(bytes)?;
    Ok(())
}

fn pack(dir: &Path) -> Result<Vec<u8>> {
    let mut files = BTreeMap::new();
    collect(dir, dir, &mut files)?;
    Ok(serde_json::to_vec_pretty(&Bundle { files })?)
}

fn collect(root: &Path, dir: &Path, files: &mut BTreeMap<String, File>) -> Result<()> {
    for entry in fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".DS_Store" {
            continue;
        }
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            bail!("{} is a symlink; {PRIVATE_DIR}/ holds only plain files and directories", path.display());
        } else if kind.is_dir() {
            collect(root, &path, files)?;
        } else {
            let relative = path.strip_prefix(root).expect("walked from root").to_string_lossy().into_owned();
            let executable = entry.metadata()?.permissions().mode() & 0o111 != 0;
            let data = base64::engine::general_purpose::STANDARD.encode(fs::read(&path)?);
            files.insert(relative, File { executable, data });
        }
    }
    Ok(())
}

fn unpack(bundle: &[u8], dir: &Path, repo: &Path) -> Result<()> {
    let bundle: Bundle = serde_json::from_slice(bundle).context("the opened bundle is not valid")?;
    let next = tempfile::Builder::new().prefix(".private.new.").tempdir_in(repo)?;
    for (relative, file) in &bundle.files {
        let parts: Vec<_> = Path::new(relative).components().collect();
        ensure!(!parts.is_empty() && parts.iter().all(|part| matches!(part, std::path::Component::Normal(_))), "the bundle holds an unsafe path {relative:?}");
        let path = next.path().join(relative);
        fs::create_dir_all(path.parent().expect("joined under next"))?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(&file.data).with_context(|| format!("decoding {relative}"))?;
        fs::write(&path, bytes)?;
        fs::set_permissions(&path, fs::Permissions::from_mode(if file.executable { 0o755 } else { 0o644 }))?;
    }
    fs::set_permissions(next.path(), fs::Permissions::from_mode(0o755))?;
    let old = tempfile::Builder::new().prefix(".private.old.").tempdir_in(repo)?;
    if dir.exists() {
        fs::rename(dir, old.path().join("dir")).with_context(|| format!("cannot move {} aside", dir.display()))?;
    }
    let kept = next.keep();
    if let Err(err) = fs::rename(&kept, dir) {
        if old.path().join("dir").exists() {
            fs::rename(old.path().join("dir"), dir)?;
        }
        return Err(err).with_context(|| format!("cannot move the opened bundle to {}", dir.display()));
    }
    Ok(())
}

pub fn fnox_key_command() -> Vec<String> {
    strings(&["fnox", "get", KEY_SECRET])
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;
    use crate::exec::SystemExec;

    fn git(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", "-c", "core.hooksPath=/dev/null"])
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn put(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn seal_open_round_trip_skips_unchanged_bundles_and_refuses_to_overwrite_unsealed_edits() {
        if exec::find_executable("age-keygen").is_none() {
            eprintln!("skipped: age is not installed");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("key.txt");
        let made = Command::new("age-keygen").args(["-o", &key.to_string_lossy()]).output().unwrap();
        assert!(made.status.success());
        let public = String::from_utf8_lossy(&made.stderr).split("Public key: ").nth(1).unwrap().trim().to_string();
        let key_command = strings(&["cat", &key.to_string_lossy()]);

        let (first, second) = (dir.path().join("first"), dir.path().join("second"));
        fs::create_dir_all(&first).unwrap();
        git(&first, &["init", "-q"]);
        put(&first.join(RECIPIENTS), &format!("{public}\n"));
        put(&first.join("private/skills/secret/SKILL.md"), "---\nname: secret\n---\n");
        put(&first.join("private/skills/secret/run.sh"), "echo hi\n");
        fs::set_permissions(first.join("private/skills/secret/run.sh"), fs::Permissions::from_mode(0o755)).unwrap();
        let mine = Private::locate(&SystemExec, &first, key_command.clone()).unwrap();
        mine.seal(true, &mut Vec::new()).unwrap();
        let sealed = fs::read(first.join(SEALED)).unwrap();
        assert!(!String::from_utf8_lossy(&sealed).contains("secret"));
        assert!(git(&first, &["diff", "--cached", "--name-only"]).contains(SEALED));
        mine.seal(true, &mut Vec::new()).unwrap();
        assert_eq!(fs::read(first.join(SEALED)).unwrap(), sealed, "an unchanged bundle is not sealed again");

        fs::create_dir_all(&second).unwrap();
        git(&second, &["init", "-q"]);
        fs::copy(first.join(SEALED), second.join(SEALED)).unwrap();
        let theirs = Private::locate(&SystemExec, &second, key_command).unwrap();
        assert!(matches!(theirs.open(false, &mut Vec::new()).unwrap(), Opened::Replaced));
        assert_eq!(fs::read_to_string(second.join("private/skills/secret/SKILL.md")).unwrap(), "---\nname: secret\n---\n");
        assert_eq!(fs::metadata(second.join("private/skills/secret/run.sh")).unwrap().permissions().mode() & 0o777, 0o755);
        assert!(matches!(theirs.open(false, &mut Vec::new()).unwrap(), Opened::Current));

        put(&second.join("private/skills/secret/SKILL.md"), "local edit\n");
        let err = format!("{:#}", theirs.open(false, &mut Vec::new()).err().unwrap());
        assert!(err.contains("not sealed"), "{err}");
        assert_eq!(fs::read_to_string(second.join("private/skills/secret/SKILL.md")).unwrap(), "local edit\n");
        theirs.open(true, &mut Vec::new()).unwrap();
        assert_eq!(fs::read_to_string(second.join("private/skills/secret/SKILL.md")).unwrap(), "---\nname: secret\n---\n");
    }

    #[test]
    fn the_push_guard_refuses_private_paths_and_names_in_outgoing_commits() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        git(repo, &["init", "-q"]);
        put(&repo.join("private/skills/secret-skill/SKILL.md"), "x\n");
        put(&repo.join("private/guard.txt"), "# extra words\nCodename\n");
        put(&repo.join("README.md"), "public\n");
        git(repo, &["add", "README.md"]);
        git(repo, &["commit", "-qm", "public"]);
        let clean = git(repo, &["rev-parse", "HEAD"]);
        let private = Private::locate(&SystemExec, repo, Vec::new()).unwrap();
        let check = |sha: &str| -> (i32, String) {
            let mut out = Vec::new();
            let code = private.check(&mut format!("refs/heads/main {sha} refs/heads/main {NO_COMMIT}\n").as_bytes(), &mut out).unwrap();
            (code, String::from_utf8(out).unwrap())
        };
        assert_eq!(check(&clean).0, 0);

        put(&repo.join("README.md"), "mentions the CODENAME project\n");
        git(repo, &["commit", "-qam", "uses secret-skill"]);
        let (code, out) = check(&git(repo, &["rev-parse", "HEAD"]));
        assert_eq!(code, 1);
        assert!(out.contains("\"secret-skill\"") && out.contains("\"codename\""), "{out}");

        git(repo, &["reset", "-q", "--hard", &clean]);
        git(repo, &["add", "-f", "private/guard.txt"]);
        git(repo, &["commit", "-qm", "oops"]);
        let (code, out) = check(&git(repo, &["rev-parse", "HEAD"]));
        assert_eq!(code, 1);
        assert!(out.contains("the path private/guard.txt"), "{out}");
    }
}
