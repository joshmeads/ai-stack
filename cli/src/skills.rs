//! `ai-stack skills`: vendor skills from external git repos into the stack, recorded in
//! `manifest.toml`, and rebuild them when upstream moves.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, anyhow, bail, ensure};

use crate::exec::{self, Exec, is_commit, one_line, short, strings};
use crate::manifest::{self, Skill, Step, StepKind};

pub struct Skills<'a> {
    pub exec: &'a dyn Exec,
    pub stack: &'a Path,
    pub prompt_runner: &'a [String],
}

pub struct Add {
    pub source: String,
    pub path: String,
    pub git_ref: String,
    pub dest: String,
    pub rename: Option<String>,
    pub process: Vec<Step>,
    pub name: Option<String>,
}

pub struct Update<'n> {
    pub names: &'n [String],
    /// Retarget the named entries to this branch or tag.
    pub git_ref: Option<String>,
    pub reprocess: bool,
    pub force: bool,
}

impl Skills<'_> {
    pub fn add(&self, add: Add, out: &mut dyn Write) -> Result<()> {
        let name = match add.name {
            Some(name) => name,
            None => Path::new(&add.path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .ok_or_else(|| anyhow!("cannot take a skill name from {:?}; pass --name", add.path))?,
        };
        let mut manifest = manifest::load(self.stack)?;
        let mut skill = Skill {
            name,
            source: add.source,
            path: add.path,
            git_ref: add.git_ref,
            commit: "0".repeat(40),
            dest: add.dest,
            rename: add.rename,
            process: add.process,
        };
        let target = crate::paths::normalize(&skill.target());
        ensure!(
            !manifest.skills.iter().any(|other| crate::paths::normalize(&other.target()) == target),
            "the manifest already installs {}; use `ai-stack skills update`",
            target.display()
        );
        manifest.skills.push(skill.clone());
        manifest.validate()?;
        ensure!(!self.stack.join(&target).exists(), "{} already exists; remove it first", self.stack.join(&target).display());

        skill.commit = self.resolve(&skill.source, &skill.git_ref)?;
        self.install(&skill)?;
        let short = short(&skill.commit);
        writeln!(out, "added {} -> {} at {short}", skill.name, target.display())?;
        *manifest.skills.last_mut().expect("pushed above") = skill;
        manifest::save(self.stack, &manifest)
    }

    /// Exit 0 when every entry is current, 1 otherwise.
    pub fn status(&self, out: &mut dyn Write) -> Result<i32> {
        let manifest = manifest::load(self.stack)?;
        if manifest.skills.is_empty() {
            writeln!(out, "No skills in {}.", self.stack.join(manifest::FILE).display())?;
            return Ok(0);
        }
        let mut current = true;
        for skill in &manifest.skills {
            let state = match self.resolve(&skill.source, &skill.git_ref) {
                Ok(latest) if latest == skill.commit => "current".to_string(),
                Ok(latest) => {
                    current = false;
                    format!("behind: {}", short(&latest))
                }
                Err(err) => {
                    current = false;
                    format!("unknown: {}", one_line(&format!("{err:#}")))
                }
            };
            writeln!(out, "{}  {}  {}  {state}", skill.name, skill.installed_name(), short(&skill.commit))?;
        }
        Ok(if current { 0 } else { 1 })
    }

    /// Rebuilds each selected entry whose upstream moved (all with `reprocess`). A failure is
    /// reported and the rest continue. Exit 1 when any failed.
    pub fn update(&self, update: Update, out: &mut dyn Write) -> Result<i32> {
        let mut manifest = manifest::load(self.stack)?;
        if let Some(git_ref) = &update.git_ref {
            exec::check_ref(git_ref)?;
            ensure!(!update.names.is_empty(), "--ref retargets named entries; pass the skill names");
        }
        let selected: Vec<usize> = if update.names.is_empty() {
            (0..manifest.skills.len()).collect()
        } else {
            update
                .names
                .iter()
                .map(|name| {
                    manifest
                        .skills
                        .iter()
                        .position(|skill| skill.name == *name || skill.installed_name() == name)
                        .ok_or_else(|| anyhow!("no manifest entry named {name:?}"))
                })
                .collect::<Result<_>>()?
        };
        let (mut changed, mut failed) = (false, 0);
        for index in selected {
            let mut next = manifest.skills[index].clone();
            if let Some(git_ref) = &update.git_ref {
                next.git_ref = git_ref.clone();
            }
            match self.update_one(&manifest.skills[index], next, &update) {
                Ok((next, message)) => {
                    writeln!(out, "{}: {message}", next.name)?;
                    changed |= next != manifest.skills[index];
                    manifest.skills[index] = next;
                }
                Err(err) => {
                    failed += 1;
                    writeln!(out, "{}: failed: {err:#}", manifest.skills[index].name)?;
                }
            }
        }
        if changed {
            manifest::save(self.stack, &manifest)?;
        }
        Ok(if failed > 0 { 1 } else { 0 })
    }

    fn update_one(&self, before: &Skill, mut next: Skill, update: &Update) -> Result<(Skill, String)> {
        let latest = self.resolve(&next.source, &next.git_ref)?;
        if latest == before.commit && !update.reprocess {
            let message = if next.git_ref == before.git_ref { "current".to_string() } else { format!("now tracks {} (same commit)", next.git_ref) };
            return Ok((next, message));
        }
        if !update.force {
            let target = before.target();
            let dirty = exec::check(self.exec, "git", &strings(&["status", "--porcelain", "--", &target.to_string_lossy()]), Some(self.stack))?;
            ensure!(dirty.trim().is_empty(), "{} has uncommitted changes; commit or discard them, or pass --force", target.display());
        }
        next.commit = latest;
        self.install(&next)?;
        let message = if next.commit == before.commit {
            format!("rebuilt at {}", short(&next.commit))
        } else {
            format!("{} -> {}", short(&before.commit), short(&next.commit))
        };
        Ok((next, message))
    }

    /// The commit `git_ref` names in `source`. A 40-hex ref is already a commit.
    fn resolve(&self, source: &str, git_ref: &str) -> Result<String> {
        if is_commit(git_ref) {
            return Ok(git_ref.to_string());
        }
        let listing = exec::check(self.exec, "git", &strings(&["ls-remote", source, git_ref]), None)?;
        let refs: Vec<(&str, &str)> = listing.lines().filter_map(|line| line.split_once('\t')).collect();
        let wanted = [format!("refs/tags/{git_ref}^{{}}"), git_ref.to_string(), format!("refs/heads/{git_ref}"), format!("refs/tags/{git_ref}")];
        wanted
            .iter()
            .find_map(|name| refs.iter().find(|(_, found)| found == name).map(|(commit, _)| commit.to_string()))
            .ok_or_else(|| anyhow!("{source} has no ref {git_ref:?}"))
    }

    /// Fetches `skill.commit`, stages the skill beside its target, applies `move` and the process
    /// steps, then swaps it in. Any failure leaves the target as it was.
    fn install(&self, skill: &Skill) -> Result<()> {
        let checkout = tempfile::tempdir().context("creating a temp checkout")?;
        let repo = checkout.path();
        for args in [
            vec!["init", "-q"],
            vec!["fetch", "-q", "--depth", "1", &skill.source, &skill.commit],
            vec!["checkout", "-q", "FETCH_HEAD", "--", &skill.path],
        ] {
            exec::check(self.exec, "git", &strings(&args), Some(repo))?;
        }
        for part in Path::new(&skill.path).ancestors().filter(|part| !part.as_os_str().is_empty()) {
            let meta = fs::symlink_metadata(repo.join(part));
            ensure!(!meta.is_ok_and(|meta| meta.file_type().is_symlink()), "{} is a symlink in {} at {}; refusing to install it", part.display(), skill.source, short(&skill.commit));
        }
        let source = repo.join(&skill.path);
        ensure!(source.is_dir(), "{} has no directory {} at {}", skill.source, skill.path, short(&skill.commit));
        if let Some(link) = find_symlink(&source)? {
            bail!("{} contains the symlink {} at {}; refusing to install it", skill.source, link.strip_prefix(repo).unwrap_or(&link).display(), short(&skill.commit));
        }

        let target = self.stack.join(skill.target());
        let parent = target.parent().ok_or_else(|| anyhow!("{} has no parent", target.display()))?;
        fs::create_dir_all(parent).with_context(|| format!("cannot create {}", parent.display()))?;
        let installed = skill.installed_name();
        let stage = tempfile::Builder::new().prefix(&format!(".{installed}.")).suffix(".ai-stack-stage").tempdir_in(parent)?;
        copy_contents(&source, stage.path())?;
        if let Some(rename) = &skill.rename {
            rename_frontmatter(&stage.path().join("SKILL.md"), rename)?;
        }
        for step in &skill.process {
            self.run_step(step, stage.path()).with_context(|| format!("process step {:?} {:?}", step.kind, step.input))?;
        }

        if fs::symlink_metadata(&target).is_err() {
            fs::rename(stage.keep(), &target).with_context(|| format!("cannot move the staged skill to {}", target.display()))?;
            return Ok(());
        }
        // Renaming a directory onto an empty one replaces it, so the old tree gets a reserved name.
        let old = tempfile::Builder::new().prefix(&format!(".{installed}.")).suffix(".ai-stack-old").tempdir_in(parent)?;
        fs::rename(&target, old.path()).with_context(|| format!("cannot move {} aside", target.display()))?;
        let staged = stage.keep();
        if let Err(err) = fs::rename(&staged, &target) {
            let _ = fs::rename(old.path(), &target);
            let _ = fs::remove_dir_all(&staged);
            return Err(err).with_context(|| format!("cannot move the staged skill to {}", target.display()));
        }
        Ok(())
    }

    fn run_step(&self, step: &Step, dir: &Path) -> Result<()> {
        let (program, args) = match step.kind {
            StepKind::Script => {
                let script = Path::new(&step.input);
                let script = if script.is_absolute() { script.to_path_buf() } else { self.stack.join(script) };
                ("sh".to_string(), vec![script.to_string_lossy().into_owned(), dir.to_string_lossy().into_owned()])
            }
            StepKind::Prompt => {
                let (program, rest) = self.prompt_runner.split_first().ok_or_else(|| anyhow!("[skills] prompt_runner is empty"))?;
                (program.clone(), rest.iter().cloned().chain([step.input.clone()]).collect())
            }
        };
        exec::check(self.exec, &program, &args, Some(dir))?;
        Ok(())
    }
}

/// The first symlink under `dir`, skipping `.git`.
fn find_symlink(dir: &Path) -> Result<Option<PathBuf>> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_name() == ".git" {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Ok(Some(entry.path()));
        }
        if kind.is_dir() {
            if let Some(link) = find_symlink(&entry.path())? {
                return Ok(Some(link));
            }
        }
    }
    Ok(None)
}

/// Copies regular files and directories, never `.git`. Symlinks were refused before this runs.
fn copy_contents(from: &Path, to: &Path) -> Result<()> {
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        if entry.file_name() == ".git" {
            continue;
        }
        let (src, dest) = (entry.path(), to.join(entry.file_name()));
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            bail!("refusing to copy the symlink {}", src.display());
        } else if kind.is_dir() {
            fs::create_dir(&dest)?;
            copy_contents(&src, &dest)?;
        } else {
            fs::copy(&src, &dest)?;
        }
    }
    Ok(())
}

/// Rewrites the `name:` line of the leading `---` frontmatter block.
fn rename_frontmatter(path: &Path, name: &str) -> Result<()> {
    let meta = fs::symlink_metadata(path).with_context(|| format!("move needs {}", path.display()))?;
    ensure!(meta.is_file(), "{} is not a regular file", path.display());
    let text = fs::read_to_string(path)?;
    let mut lines: Vec<String> = text.split_inclusive('\n').map(str::to_string).collect();
    ensure!(lines.first().is_some_and(|line| line.trim_end() == "---"), "{} has no frontmatter", path.display());
    let end = lines.iter().skip(1).position(|line| line.trim_end() == "---").map(|i| i + 1);
    let Some(end) = end else { bail!("{} has unterminated frontmatter", path.display()) };
    let line = lines[1..end].iter_mut().find(|line| line.starts_with("name:")).ok_or_else(|| anyhow!("{} frontmatter has no name:", path.display()))?;
    let newline = if line.ends_with("\r\n") { "\r\n" } else { "\n" };
    *line = format!("name: {name}{newline}");
    fs::write(path, lines.concat())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
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

    struct Fixture {
        _dir: tempfile::TempDir,
        upstream: PathBuf,
        stack: PathBuf,
        runner: Vec<String>,
    }

    impl Fixture {
        fn new() -> Fixture {
            let dir = tempfile::tempdir().unwrap();
            let (upstream, stack) = (dir.path().join("upstream"), dir.path().join("stack"));
            fs::create_dir_all(upstream.join("skills/grill-with-docs/refs")).unwrap();
            fs::write(upstream.join("skills/grill-with-docs/SKILL.md"), "---\nname: grill-with-docs\ndescription: Grill \u{2014} hard\n---\nBody \u{2014} v1\n").unwrap();
            fs::write(upstream.join("skills/grill-with-docs/refs/notes.md"), "notes\n").unwrap();
            git(&upstream, &["init", "-q"]);
            git(&upstream, &["add", "-A"]);
            git(&upstream, &["commit", "-qm", "v1"]);
            fs::create_dir_all(stack.join("scripts")).unwrap();
            fs::write(stack.join("scripts/strip.sh"), "find \"$1\" -name '*.md' -exec perl -pi -e 's/\\xe2\\x80\\x94/-/g' {} +\n").unwrap();
            git(&stack, &["init", "-q"]);
            commit_all(&stack, "init");
            Fixture { _dir: dir, upstream, stack, runner: vec!["false".into()] }
        }

        fn skills(&self) -> Skills<'_> {
            Skills { exec: &SystemExec, stack: &self.stack, prompt_runner: &self.runner }
        }

        fn add(&self) {
            let add = Add {
                source: format!("file://{}", self.upstream.display()),
                path: "skills/grill-with-docs".into(),
                git_ref: "main".into(),
                dest: manifest::DEFAULT_DEST.into(),
                rename: Some("grill-docs".into()),
                process: vec![Step { kind: StepKind::Script, input: "scripts/strip.sh".into() }],
                name: None,
            };
            self.skills().add(add, &mut Vec::new()).unwrap();
            commit_all(&self.stack, "add skill");
        }

        fn upstream_commit(&self, file_text: &str, message: &str) -> String {
            fs::write(self.upstream.join("skills/grill-with-docs/SKILL.md"), file_text).unwrap();
            git(&self.upstream, &["commit", "-qam", message]);
            git(&self.upstream, &["rev-parse", "HEAD"])
        }

        fn installed(&self) -> String {
            fs::read_to_string(self.stack.join("plugins/jm-tools/skills/grill-docs/SKILL.md")).unwrap()
        }

        fn update(&self, names: &[String], git_ref: Option<&str>, reprocess: bool, force: bool) -> (i32, String) {
            let mut out = Vec::new();
            let update = Update { names, git_ref: git_ref.map(str::to_string), reprocess, force };
            let code = self.skills().update(update, &mut out).unwrap();
            (code, String::from_utf8(out).unwrap())
        }
    }

    fn commit_all(dir: &Path, message: &str) {
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-qm", message, "--allow-empty"]);
    }

    #[test]
    fn add_status_update_and_dirty_guard() {
        let fx = Fixture::new();
        let v1 = git(&fx.upstream, &["rev-parse", "HEAD"]);
        fx.add();

        let installed = fx.installed();
        assert!(installed.contains("name: grill-docs\n"), "{installed}");
        assert!(!installed.contains('\u{2014}'), "{installed}");
        assert!(fx.stack.join("plugins/jm-tools/skills/grill-docs/refs/notes.md").is_file());
        let entry = &manifest::load(&fx.stack).unwrap().skills[0];
        assert_eq!((entry.commit.as_str(), entry.installed_name()), (v1.as_str(), "grill-docs"));

        let mut out = Vec::new();
        assert_eq!(fx.skills().status(&mut out).unwrap(), 0);
        let v2 = fx.upstream_commit("---\nname: grill-with-docs\n---\nBody \u{2014} v2\n", "v2");
        out.clear();
        assert_eq!(fx.skills().status(&mut out).unwrap(), 1);
        let status = String::from_utf8(out).unwrap();
        assert!(status.contains(&format!("grill-with-docs  grill-docs  {}  behind: {}", &v1[..7], &v2[..7])), "{status}");

        let skill_md = fx.stack.join("plugins/jm-tools/skills/grill-docs/SKILL.md");
        fs::write(&skill_md, "local edit\n").unwrap();
        let (code, out) = fx.update(&[], None, false, false);
        assert_eq!(code, 1);
        assert!(out.contains("uncommitted changes"), "{out}");
        assert_eq!(fs::read_to_string(&skill_md).unwrap(), "local edit\n");

        git(&fx.stack, &["checkout", "--", "."]);
        let (code, out) = fx.update(&[], None, false, false);
        assert_eq!(code, 0, "{out}");
        assert!(fx.installed().contains("Body - v2"), "{}", fx.installed());
        assert_eq!(manifest::load(&fx.stack).unwrap().skills[0].commit, v2);
    }

    #[test]
    fn symlinks_from_upstream_are_refused_and_nothing_is_written() {
        let fx = Fixture::new();
        let outside = fx._dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("SKILL.md"), "---\nname: outside\n---\n").unwrap();
        std::os::unix::fs::symlink(&outside, fx.upstream.join("skills/linked")).unwrap();
        fs::create_dir_all(fx.upstream.join("skills/inner")).unwrap();
        std::os::unix::fs::symlink(outside.join("SKILL.md"), fx.upstream.join("skills/inner/SKILL.md")).unwrap();
        commit_all(&fx.upstream, "links");

        for (path, link) in [("skills/linked", "skills/linked is a symlink"), ("skills/inner", "contains the symlink skills/inner/SKILL.md")] {
            let add = Add {
                source: format!("file://{}", fx.upstream.display()),
                path: path.into(),
                git_ref: "main".into(),
                dest: manifest::DEFAULT_DEST.into(),
                rename: Some("renamed".into()),
                process: Vec::new(),
                name: None,
            };
            let err = format!("{:#}", fx.skills().add(add, &mut Vec::new()).unwrap_err());
            assert!(err.contains(link), "{err}");
            assert!(!fx.stack.join("plugins/jm-tools/skills/renamed").exists());
        }
        assert_eq!(fs::read_to_string(outside.join("SKILL.md")).unwrap(), "---\nname: outside\n---\n");
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
        assert!(manifest::load(&fx.stack).unwrap().skills.is_empty());
    }

    #[test]
    fn update_ref_retargets_and_a_failing_step_leaves_the_target() {
        let fx = Fixture::new();
        fx.add();
        git(&fx.upstream, &["checkout", "-qb", "test"]);
        let on_test = fx.upstream_commit("---\nname: grill-with-docs\n---\nTest branch\n", "test");
        git(&fx.upstream, &["checkout", "-q", "main"]);

        let names = ["grill-docs".to_string()];
        let (code, out) = fx.update(&names, Some("test"), false, false);
        assert_eq!(code, 0, "{out}");
        assert!(fx.installed().contains("Test branch"));
        let entry = &manifest::load(&fx.stack).unwrap().skills[0];
        assert_eq!((entry.git_ref.as_str(), entry.commit.as_str()), ("test", on_test.as_str()));
        commit_all(&fx.stack, "retarget");

        fs::write(fx.stack.join("scripts/strip.sh"), "echo broken >&2; exit 3\n").unwrap();
        let before = fx.installed();
        let (code, out) = fx.update(&[], None, true, false);
        assert_eq!(code, 1);
        assert!(out.contains("broken"), "{out}");
        assert_eq!(fx.installed(), before);
        let leftovers: Vec<_> = fs::read_dir(fx.stack.join("plugins/jm-tools/skills")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(leftovers, ["grill-docs"]);
    }
}
