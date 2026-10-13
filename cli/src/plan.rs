//! Planned filesystem changes, their diffs, and applying them safely.

use std::fs;
use std::io;
use std::os::unix::fs::symlink;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use std::collections::BTreeSet;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;

use anyhow::{Context, Result, anyhow, bail};
use similar::TextDiff;

use crate::plugins::{self, Runner};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Create or overwrite a regular file. `before` is the current text, `None` when absent.
    Write { path: PathBuf, before: Option<String>, after: String },
    /// Delete a regular file whose current text is `before`.
    Remove { path: PathBuf, before: String },
    /// Delete a symlink currently pointing at `target`.
    Unlink { path: PathBuf, target: PathBuf },
    /// Move whatever is at `path` (an unmanaged file or a symlink) into the backup and write `text`.
    ReplaceWithFile { path: PathBuf, text: String, fingerprint: u64 },
    /// `--clean`: move a skill-root entry (directory, file or symlink, never followed) into the
    /// backup. `fingerprint` is its lstat tree fingerprint at planning time.
    MoveToBackup { path: PathBuf, fingerprint: u64 },
}

impl Action {
    pub fn path(&self) -> &Path {
        match self {
            Action::Write { path, .. }
            | Action::Remove { path, .. }
            | Action::Unlink { path, .. }
            | Action::ReplaceWithFile { path, .. }
            | Action::MoveToBackup { path, .. } => path,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Plan {
    pub actions: Vec<Action>,
    /// Harness CLI commands (plugin marketplace and installs), run after every file action.
    pub commands: Vec<plugins::Command>,
    /// Problems that block applying, e.g. an unmanaged file in the way. Non-empty means apply must refuse.
    pub conflicts: Vec<String>,
    /// Informational lines, such as untouched extras. They never make a plan non-empty.
    pub warnings: Vec<String>,
    pub home: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyReport {
    pub applied: usize,
    pub backup_dir: Option<PathBuf>,
    /// `removed-plugins.json` in the backup dir, when the plan removed plugins.
    pub manifest: Option<PathBuf>,
}

pub const MANIFEST: &str = "removed-plugins.json";

/// Returns a `Write` action when `path` does not already contain exactly `after`.
pub fn write_if_changed(path: &Path, after: String) -> Result<Option<Action>> {
    let before = current_text(path)?;
    if before.as_deref() == Some(after.as_str()) {
        return Ok(None);
    }
    Ok(Some(Action::Write { path: path.to_path_buf(), before, after }))
}

impl Plan {
    pub fn is_empty(&self) -> bool {
        self.actions.is_empty() && self.commands.is_empty() && self.conflicts.is_empty()
    }

    /// Number of file actions plus commands.
    pub fn len(&self) -> usize {
        self.actions.len() + self.commands.len()
    }

    /// Whether the summary line at `index` belongs to `--clean`: a skill moved into the backup or
    /// a plugin removal.
    pub fn is_clean(&self, index: usize) -> bool {
        match self.actions.get(index) {
            Some(action) => matches!(action, Action::MoveToBackup { .. }),
            None => self.commands.get(index - self.actions.len()).is_some_and(|command| command.undo.is_some()),
        }
    }

    pub fn clean_count(&self) -> usize {
        (0..self.len()).filter(|&index| self.is_clean(index)).count()
    }

    /// One line per action, then one per command, e.g. `write   ~/.claude/CLAUDE.md`.
    pub fn summary_lines(&self, home: &Path) -> Vec<String> {
        let actions = self.actions.iter().map(|action| summary_line(action, home));
        actions.chain(self.commands.iter().map(|command| format!("run     {command}"))).collect()
    }

    /// Unified diff for one file action, or a one-line description for an unlink. Empty for
    /// indices past the file actions (the commands, whose summary line says everything).
    pub fn diff(&self, index: usize) -> String {
        let Some(action) = self.actions.get(index) else {
            return String::new();
        };
        match action {
            Action::Write { path, before, after } => {
                text_diff(before.as_deref().unwrap_or(""), after, path)
            }
            Action::Remove { path, before } => text_diff(before, "", path),
            Action::Unlink { path, target } => {
                format!("unlink {} (pointed at {})", path.display(), target.display())
            }
            Action::ReplaceWithFile { path, text, .. } => format!("Back up {} and replace with file\n{}", path.display(), text_diff(&fs::read_to_string(path).unwrap_or_default(), text, path)),
            Action::MoveToBackup { path, .. } => {
                let kind = match fs::symlink_metadata(path) {
                    Ok(meta) if meta.file_type().is_symlink() => format!("symlink to {}", fs::read_link(path).map(|t| t.display().to_string()).unwrap_or_default()),
                    Ok(meta) if meta.is_dir() => "directory".to_string(),
                    Ok(_) => "file".to_string(),
                    Err(_) => "missing".to_string(),
                };
                format!("Move {} ({kind}) into the backup directory at the same relative path. Nothing is deleted.", path.display())
            }
        }
    }

    /// Full plain-text rendering: conflicts, then each summary line followed by its diff, with
    /// the `--clean` lines in their own section.
    pub fn render_text(&self, home: &Path) -> String {
        let mut out: String = self.warnings.iter().map(|warning| format!("{warning}\n")).collect();
        if self.is_empty() {
            out.push_str("No changes.\n");
            return out;
        }
        if !self.conflicts.is_empty() {
            out.push_str("Conflicts:\n");
            for conflict in &self.conflicts {
                out.push_str(&format!("  {conflict}\n"));
            }
            out.push('\n');
        }
        let lines = self.summary_lines(home);
        let clean = self.clean_count();
        let regular = (0..lines.len()).filter(|&index| !self.is_clean(index));
        let cleaning = (0..lines.len()).filter(|&index| self.is_clean(index));
        let mut in_clean = false;
        for index in regular.chain(cleaning) {
            if !in_clean && self.is_clean(index) {
                in_clean = true;
                out.push_str(&format!("\nClean ({clean}): skills moved into the backup and plugins removed; the removals run before the installs above\n"));
            }
            let line = &lines[index];
            out.push_str(line);
            out.push('\n');
            let diff = self.diff(index);
            if !diff.is_empty() {
                out.push_str(&diff);
                if !diff.ends_with('\n') {
                    out.push('\n');
                }
            }
        }
        out
    }
}

/// Applies every file action, then runs every command through `runner`. Refuses when there
/// are conflicts or when a target's current state no longer matches the action's `before`.
/// Backs up every file or link it replaces or removes under `backup_root/<unix-seconds>/{home,abs}/`.
/// A target path with `..` or other non-plain components is refused so no backup escapes that
/// directory. Commands run last because the harness CLIs edit files the actions may touch.
/// Plugin removals are recorded with their reinstall commands in `MANIFEST` in the backup dir.
pub fn apply(plan: &Plan, backup_root: &Path, runner: &dyn Runner) -> Result<ApplyReport> {
    if !plan.conflicts.is_empty() {
        bail!(
            "refusing to apply: {} conflict(s) block this plan; resolve them and run again",
            plan.conflicts.len()
        );
    }
    for action in &plan.actions {
        verify(action)?;
    }

    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let backup_dir = backup_root.join(stamp.to_string());
    // A second apply in the same second must not overwrite the first one's backups.
    let mut backup_dir = backup_dir;
    let mut suffix = 1;
    let removals: Vec<&plugins::Command> = plan.commands.iter().filter(|command| command.undo.is_some()).collect();
    let needs_backup = !removals.is_empty() || plan.actions.iter().any(|action| fs::symlink_metadata(action.path()).is_ok());
    if needs_backup {
        fs::create_dir_all(backup_root)?;
        loop {
            match fs::create_dir(&backup_dir) {
                Ok(()) => break,
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
                    backup_dir = backup_root.join(format!("{stamp}-{suffix}"));
                    suffix += 1;
                }
                Err(err) => return Err(err.into()),
            }
        }
    }
    let mut destinations = BTreeSet::new();
    for action in &plan.actions {
        if fs::symlink_metadata(action.path()).is_ok() {
            let dest = backup_path(action.path(), &backup_dir, plan.home.as_deref())?;
            if !destinations.insert(dest.clone()) {
                bail!("refusing to apply: duplicate backup destination {}", dest.display());
            }
            vacant_backup(&dest)?;
        }
    }
    let mut backed_up = false;
    for action in &plan.actions {
        match action {
            Action::Write { path, after, .. } => {
                let permissions = file_permissions(path);
                backed_up |= backup(path, &backup_dir, plan.home.as_deref())?;
                write_atomic(path, after, permissions)?;
            }
            Action::Remove { path, .. } | Action::Unlink { path, .. } => {
                backed_up |= backup(path, &backup_dir, plan.home.as_deref())?;
                fs::remove_file(path).with_context(|| format!("removing {}", path.display()))?;
            }
            Action::ReplaceWithFile { path, text, .. } => {
                let permissions = file_permissions(path);
                move_to_backup(path, &backup_dir, plan.home.as_deref())?;
                backed_up = true;
                write_atomic(path, text, permissions)?;
            }
            Action::MoveToBackup { path, .. } => {
                move_to_backup(path, &backup_dir, plan.home.as_deref())?;
                backed_up = true;
            }
        }
    }

    // Written before the removals run, so it exists even when one of them fails.
    let manifest = if removals.is_empty() {
        None
    } else {
        let entries: Vec<serde_json::Value> = removals.iter().map(|command| serde_json::json!({
            "harness": command.harness.as_str(),
            "id": command.args.last(),
            "removed_with": command.to_string(),
            "reinstall": command.undo_command().map(|undo| undo.to_string()),
        })).collect();
        let path = backup_dir.join(MANIFEST);
        let text = serde_json::to_string_pretty(&serde_json::json!({ "plugins": entries }))?;
        fs::write(&path, format!("{text}\n")).with_context(|| format!("writing {}", path.display()))?;
        backed_up = true;
        Some(path)
    };

    for command in &plan.commands {
        let ran = runner.run(command).with_context(|| format!("cannot run `{command}`"))?;
        if !ran.ok {
            bail!(
                "`{command}` failed: {}\nThe file changes before it are applied. Fix the problem and run `ai-stack install` again.",
                ran.stderr.trim()
            );
        }
    }

    Ok(ApplyReport {
        applied: plan.len(),
        backup_dir: backed_up.then_some(backup_dir),
        manifest,
    })
}

fn summary_line(action: &Action, home: &Path) -> String {
    match action {
        Action::Write { path, before: None, .. } => format!("create  {}", tilde(path, home)),
        Action::Write { path, before: Some(_), .. } => format!("write   {}", tilde(path, home)),
        Action::Remove { path, .. } => format!("remove  {}", tilde(path, home)),
        Action::Unlink { path, .. } => format!("unlink  {}", tilde(path, home)),
        Action::ReplaceWithFile { path, .. } => format!("replace-file {}", tilde(path, home)),
        Action::MoveToBackup { path, .. } => format!("move    {} -> backup", tilde(path, home)),
    }
}

pub fn tilde(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rel) if rel.as_os_str().is_empty() => "~".to_string(),
        Ok(rel) => format!("~/{}", rel.display()),
        Err(_) => path.display().to_string(),
    }
}

fn text_diff(before: &str, after: &str, path: &Path) -> String {
    TextDiff::from_lines(before, after)
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{}", path.display()), &format!("b/{}", path.display()))
        .to_string()
}

/// Current text of a regular file, `None` when absent. Symlinks and directories are errors.
fn current_text(path: &Path) -> Result<Option<String>> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => {
            let text = fs::read_to_string(path)
                .with_context(|| format!("reading {}", path.display()))?;
            Ok(Some(text))
        }
        Ok(_) => bail!("{} is not a regular file", path.display()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).with_context(|| format!("inspecting {}", path.display())),
    }
}

/// Current target of a symlink, `None` when absent. Regular files and directories are errors.
fn current_link(path: &Path) -> Result<Option<PathBuf>> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            let target = fs::read_link(path)
                .with_context(|| format!("reading link {}", path.display()))?;
            Ok(Some(target))
        }
        Ok(_) => bail!("{} exists and is not a symlink", path.display()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).with_context(|| format!("inspecting {}", path.display())),
    }
}

fn stale(path: &Path) -> anyhow::Error {
    anyhow!("{} changed since the plan was made; run again", path.display())
}

/// Checks that the disk still matches the state the action was planned against.
fn verify(action: &Action) -> Result<()> {
    let matches = match action {
        Action::Write { path, before, .. } => (current_text(path)? == *before).then_some(()),
        Action::Remove { path, before } => {
            (current_text(path)?.as_deref() == Some(before.as_str())).then_some(())
        }
        Action::Unlink { path, target } => {
            (current_link(path)? == Some(target.clone())).then_some(())
        }
        Action::ReplaceWithFile { path, fingerprint: expected, .. } | Action::MoveToBackup { path, fingerprint: expected } => {
            (fingerprint(path).ok() == Some(*expected)).then_some(())
        }
    };
    matches.ok_or_else(|| stale(action.path()))
}

/// Copies the current file or symlink at `path` into `dir`. Returns false when `path` is absent.
fn backup(path: &Path, dir: &Path, home: Option<&Path>) -> Result<bool> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(err).with_context(|| format!("inspecting {}", path.display())),
    };
    let dest = backup_path(path, dir, home)?;
    vacant_backup(&dest)?;
    create_parent(&dest)?;
    if meta.file_type().is_symlink() {
        let target = fs::read_link(path)?;
        symlink(target, &dest).with_context(|| format!("backing up {}", path.display()))?;
    } else if meta.is_file() {
        fs::copy(path, &dest).with_context(|| format!("backing up {}", path.display()))?;
    } else {
        bail!("{} is neither a file nor a symlink", path.display());
    }
    Ok(true)
}

fn backup_path(path: &Path, dir: &Path, home: Option<&Path>) -> Result<PathBuf> {
    let (namespace, relative) = match home.and_then(|home| path.strip_prefix(home).ok()) {
        Some(relative) => ("home", relative),
        None => ("abs", path.strip_prefix("/").unwrap_or(path)),
    };
    if relative.as_os_str().is_empty() || !relative.components().all(|part| matches!(part, Component::Normal(_))) {
        bail!("refusing to apply: {} has `..`, `.` or no file name, so its backup could land outside {}", path.display(), dir.display());
    }
    Ok(dir.join(namespace).join(relative))
}

fn vacant_backup(dest: &Path) -> Result<()> {
    match fs::symlink_metadata(dest) {
        Ok(_) => bail!("refusing to apply: backup destination {} is already occupied", dest.display()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err).with_context(|| format!("inspecting backup {}", dest.display())),
    }
}

fn move_to_backup(path: &Path, dir: &Path, home: Option<&Path>) -> Result<()> {
    let dest = backup_path(path, dir, home)?;
    vacant_backup(&dest)?;
    create_parent(&dest)?;
    match fs::rename(path, &dest) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::CrossesDevices => {
            copy_tree(path, &dest)?;
            remove_tree(path)
        }
        Err(err) => Err(err).with_context(|| format!("backing up {}", path.display())),
    }
}

fn copy_tree(path: &Path, dest: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        symlink(fs::read_link(path)?, dest)?;
    } else if meta.is_dir() {
        fs::create_dir(dest)?;
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dest.join(entry.file_name()))?;
        }
        fs::set_permissions(dest, meta.permissions())?;
    } else if meta.is_file() {
        fs::copy(path, dest)?;
    } else {
        bail!("{} has an unsupported file type", path.display());
    }
    Ok(())
}

fn remove_tree(path: &Path) -> Result<()> {
    if fs::symlink_metadata(path)?.is_dir() { fs::remove_dir_all(path)?; }
    else { fs::remove_file(path)?; }
    Ok(())
}

/// Stable FNV-1a over sorted relative paths and lstat metadata, never following links.
pub fn fingerprint(path: &Path) -> Result<u64> {
    fn field(hash: &mut u64, bytes: &[u8]) {
        for byte in (bytes.len() as u64).to_le_bytes().iter().chain(bytes) {
            *hash ^= u64::from(*byte);
            *hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    fn visit(path: &Path, root: &Path, hash: &mut u64) -> Result<()> {
        let meta = fs::symlink_metadata(path)?;
        field(hash, path.strip_prefix(root)?.as_os_str().as_bytes());
        field(hash, if meta.file_type().is_symlink() { b"link" } else if meta.is_dir() { b"dir" } else if meta.is_file() { b"file" } else { b"other" });
        field(hash, &meta.len().to_le_bytes());
        let modified = meta.modified()?.duration_since(UNIX_EPOCH)?;
        field(hash, &modified.as_nanos().to_le_bytes());
        if meta.file_type().is_symlink() {
            field(hash, fs::read_link(path)?.as_os_str().as_bytes());
        } else if meta.is_dir() {
            let mut children = fs::read_dir(path)?.map(|entry| entry.map(|e| e.path())).collect::<io::Result<Vec<_>>>()?;
            children.sort();
            for child in children { visit(&child, root, hash)?; }
        }
        Ok(())
    }
    let mut hash = 0xcbf29ce484222325;
    visit(path, path, &mut hash)?;
    Ok(hash)
}

/// Permissions of the regular file at `path` (following links), if there is one.
fn file_permissions(path: &Path) -> Option<fs::Permissions> {
    fs::metadata(path).ok().filter(|meta| meta.is_file()).map(|meta| meta.permissions())
}

/// Writes `text` to a new, exclusively created temp file with an unpredictable name
/// beside `path`, then renames it over `path`. The file gets `permissions` (the
/// replaced file's mode) or, for a new file, the default mode under the umask.
fn write_atomic(path: &Path, text: &str, permissions: Option<fs::Permissions>) -> Result<()> {
    use std::io::Write as _;
    create_parent(path)?;
    let parent = path.parent().ok_or_else(|| anyhow!("{} has no parent directory", path.display()))?;
    let name = path.file_name().ok_or_else(|| anyhow!("{} has no file name", path.display()))?;
    let mut tmp = tempfile::Builder::new()
        .prefix(&format!(".{}.", name.to_string_lossy()))
        .suffix(".ai-stack-tmp")
        .permissions(fs::Permissions::from_mode(0o666))
        .tempfile_in(parent)
        .with_context(|| format!("creating a temp file beside {}", path.display()))?;
    if let Some(permissions) = permissions {
        tmp.as_file().set_permissions(permissions).with_context(|| format!("setting permissions for {}", path.display()))?;
    }
    tmp.write_all(text.as_bytes()).with_context(|| format!("writing {}", tmp.path().display()))?;
    tmp.persist(path).map_err(|err| err.error).with_context(|| format!("replacing {}", path.display()))?;
    Ok(())
}

fn create_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NoCommands;
    impl Runner for NoCommands {
        fn run(&self, cmd: &plugins::Command) -> io::Result<plugins::Ran> {
            panic!("unexpected command {cmd}")
        }
    }

    fn plan_of(actions: Vec<Action>) -> Plan {
        Plan { actions, ..Plan::default() }
    }

    #[test]
    fn overwrite_backs_up_old_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("CLAUDE.md");
        fs::write(&path, "old\n").unwrap();
        let action = write_if_changed(&path, "new\n".into()).unwrap().expect("action");
        let backups = dir.path().join("backups");

        let report = apply(&plan_of(vec![action]), &backups, &NoCommands).unwrap();
        let backup_dir = report.backup_dir.expect("backup dir");
        assert!(backup_dir.starts_with(&backups));
        let backed_up = backup_dir.join("abs").join(path.strip_prefix("/").unwrap());
        assert_eq!(fs::read_to_string(backed_up).unwrap(), "old\n");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\n");
    }

    #[test]
    fn separates_home_and_absolute_backups_and_refuses_occupied_destinations() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let external = temp.path().join("external/file");
        let local = home.join(external.strip_prefix("/").unwrap());
        for (path, text) in [(&external, "external original"), (&local, "home original")] {
            create_parent(path).unwrap();
            fs::write(path, text).unwrap();
        }
        let plan = Plan {
            home: Some(home.clone()),
            actions: [&local, &external].into_iter().map(|path| Action::ReplaceWithFile {
                path: path.clone(), text: "replacement".into(), fingerprint: fingerprint(path).unwrap(),
            }).collect(),
            ..Plan::default()
        };
        let dir = apply(&plan, &temp.path().join("backups"), &NoCommands).unwrap().backup_dir.unwrap();
        assert_eq!(fs::read_to_string(dir.join("home").join(local.strip_prefix(&home).unwrap())).unwrap(), "home original");
        assert_eq!(fs::read_to_string(dir.join("abs").join(external.strip_prefix("/").unwrap())).unwrap(), "external original");
        let err = move_to_backup(&local, &dir, Some(&home)).unwrap_err();
        assert!(err.to_string().contains("already occupied"));
        assert!(backup(&external, &dir, Some(&home)).unwrap_err().to_string().contains("already occupied"));
        assert_eq!(fs::read_to_string(&local).unwrap(), "replacement");
        assert_eq!(fs::read_to_string(&external).unwrap(), "replacement");
    }

    #[test]
    fn rewrite_keeps_the_target_file_mode() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "old\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let replaced = dir.path().join("CLAUDE.md");
        fs::write(&replaced, "unmanaged\n").unwrap();
        fs::set_permissions(&replaced, fs::Permissions::from_mode(0o640)).unwrap();
        let plan = plan_of(vec![
            write_if_changed(&path, "new\n".into()).unwrap().expect("action"),
            Action::ReplaceWithFile { path: replaced.clone(), text: "managed\n".into(), fingerprint: fingerprint(&replaced).unwrap() },
        ]);
        apply(&plan, &dir.path().join("backups"), &NoCommands).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\n");
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(&replaced).unwrap().permissions().mode() & 0o777, 0o640);
        let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).filter(|n| n.to_string_lossy().ends_with(".ai-stack-tmp")).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn refuses_a_target_whose_backup_would_escape_the_backup_directory() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let outside = dir.path().join("outside/file");
        fs::create_dir_all(&home).unwrap();
        create_parent(&outside).unwrap();
        fs::write(&outside, "keep\n").unwrap();
        let sneaky = home.join("../outside/file");
        let plan = Plan { home: Some(home), actions: vec![write_if_changed(&sneaky, "new\n".into()).unwrap().expect("action")], ..Plan::default() };
        let err = apply(&plan, &dir.path().join("backups"), &NoCommands).unwrap_err();
        assert!(err.to_string().contains("could land outside"), "{err}");
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep\n");
    }

    #[test]
    fn refuses_when_file_changed_after_planning() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        fs::write(&a, "old\n").unwrap();
        let plan = plan_of(vec![
            write_if_changed(&a, "new\n".into()).unwrap().expect("a"),
            write_if_changed(&b, "x\n".into()).unwrap().expect("b"),
        ]);
        fs::write(&a, "edited\n").unwrap();

        let err = apply(&plan, &dir.path().join("backups"), &NoCommands).unwrap_err();
        assert!(err.to_string().contains("changed since the plan was made"));
        assert_eq!(fs::read_to_string(&a).unwrap(), "edited\n");
        assert!(!b.exists());
    }
}
