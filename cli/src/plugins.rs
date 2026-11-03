//! Adds the stack checkout to each harness as the local `jm` marketplace and installs its
//! plugins through the harness's own CLI. ai-stack owns the `jm` marketplace, so an installed
//! `jm` plugin the checkout no longer lists is removed. The commands run through a `Runner`, so
//! tests use a fake and `diff` only runs the read-only `list --json` queries.

use std::fmt;
use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{Context as _, Result};
use serde_json::Value;

use crate::config::{Config, Harness, HarnessConfig};
use crate::exec::{self, shell_quote as quote};
use crate::plan::Plan;

pub const MARKETPLACE: &str = "jm";
/// The plugins every harness gets. The stack's other skills are standalone skills.
pub const PLUGINS: [&str; 1] = ["jm-stack"];

/// One harness CLI invocation, e.g. `claude plugin install jm-stack@jm`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Command {
    pub harness: Harness,
    /// `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, set only when the harness home is not the one the
    /// CLI would use anyway.
    pub env: Option<(&'static str, PathBuf)>,
    pub args: Vec<String>,
    /// For a removal, how the plugin comes back. `None` otherwise.
    pub undo: Option<Restore>,
    /// A `--clean` removal of a plugin the stack does not own.
    pub clean: bool,
}

/// How a removed plugin comes back, recorded in `removed-plugins.json`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Restore {
    /// Arguments to the same CLI that reinstall or re-enable it.
    Command(Vec<String>),
    /// No command can, because its marketplace (the stack) no longer lists it. Apply names
    /// the stack commit to restore it from (`retired_note`).
    Retired { stack: PathBuf, plugin: String },
}

impl Command {
    pub fn undo_command(&self) -> Option<Command> {
        let Some(Restore::Command(args)) = &self.undo else { return None };
        Some(Command { harness: self.harness, env: self.env.clone(), args: args.clone(), undo: None, clean: false })
    }

    /// For a retired plugin, where to restore it from. Runs `git` in the stack.
    pub fn undo_note(&self) -> Option<String> {
        match &self.undo {
            Some(Restore::Retired { stack, plugin }) => Some(retired_note(stack, self.harness, plugin)),
            _ => None,
        }
    }
}

impl fmt::Display for Command {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some((name, value)) = &self.env {
            write!(f, "{name}={} ", quote(&value.to_string_lossy()))?;
        }
        f.write_str(self.harness.as_str())?;
        for arg in &self.args {
            write!(f, " {}", quote(arg))?;
        }
        Ok(())
    }
}

pub struct Ran {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

pub trait Runner {
    fn available(&self, harness: Harness) -> bool;

    /// Runs `cmd` to completion. An `Err` means the detected CLI could not start.
    fn run(&self, cmd: &Command) -> io::Result<Ran>;
}

/// Runs the absolute `claude` / `codex` paths captured during detection.
pub struct SystemRunner {
    executables: BTreeMap<Harness, PathBuf>,
}

impl SystemRunner {
    pub fn detect() -> Self {
        let path = std::env::var_os("PATH");
        Self::on_path(path.as_deref())
    }

    fn on_path(path: Option<&std::ffi::OsStr>) -> Self {
        Self { executables: Harness::ALL.into_iter().filter_map(|harness| exec::executable_on_path(harness.as_str(), path?).map(|path| (harness, path))).collect() }
    }
}

impl Runner for SystemRunner {
    fn available(&self, harness: Harness) -> bool {
        self.executables.contains_key(&harness)
    }

    fn run(&self, cmd: &Command) -> io::Result<Ran> {
        let path = self.executables.get(&cmd.harness).ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("{} was not detected on PATH", cmd.harness.name())))?;
        let mut process = std::process::Command::new(path);
        process.args(&cmd.args).stdin(Stdio::null());
        if let Some((name, value)) = &cmd.env {
            process.env(name, value);
        }
        let output = process.output().map_err(|err| io::Error::new(err.kind(), format!("{} CLI was found at {} but could not be started: {err}", cmd.harness.name(), path.display())))?;
        Ok(Ran {
            ok: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Where the harness's `jm` marketplace currently points.
enum Marketplace {
    Absent,
    Stack,
    Elsewhere(String),
}

/// Adds the marketplace and plugin commands one harness still needs to `out`.
pub fn plan(cfg: &Config, hc: &HarnessConfig, runner: &dyn Runner, out: &mut Plan) -> Result<()> {
    let stack = &cfg.stack.path;
    let name = hc.harness.name();
    let manifest = match read_manifest(stack, hc.harness) {
        Ok(manifest) => manifest,
        Err(err) => {
            out.conflicts.push(format!("{name}: the stack checkout {} does not publish the `{MARKETPLACE}` marketplace: {err:#}", stack.display()));
            return Ok(());
        }
    };
    let env = env_for(hc);
    let command = |args: &[&str]| Command { harness: hc.harness, env: env.clone(), args: strings(args), undo: None, clean: false };
    let stack_text = stack.to_string_lossy();
    let add_marketplace = command(&["plugin", "marketplace", "add", &stack_text]);
    let install = |plugin: &str| {
        let id = format!("{plugin}@{MARKETPLACE}");
        match hc.harness {
            Harness::Claude => command(&["plugin", "install", &id]),
            Harness::Codex => command(&["plugin", "add", &id]),
        }
    };
    let everything = || std::iter::once(add_marketplace.clone()).chain(PLUGINS.map(install)).collect::<Vec<_>>();
    if !hc.home.is_dir() {
        if let Query::CannotStart(err) = query(runner, &command(&["--version"])) {
            out.conflicts.push(err);
            return Ok(());
        }
        // Nothing is configured yet, and Codex refuses a CODEX_HOME that does not exist.
        // The file actions create the home before the commands run.
        out.commands.extend(everything());
        return Ok(());
    }

    let marketplace = match query(runner, &command(&["plugin", "marketplace", "list", "--json"])) {
        Query::CannotStart(err) => {
            out.conflicts.push(err);
            return Ok(());
        }
        Query::Failed(err) => {
            out.warnings.push(format!("note: cannot read {name}'s marketplaces ({err}); planning every plugin command, which the CLI skips when already done"));
            out.commands.extend(everything());
            return Ok(());
        }
        Query::Json(json) => marketplace_state(hc.harness, &json, stack),
    };
    match marketplace {
        Marketplace::Absent => {
            out.commands.extend(everything());
            return Ok(());
        }
        Marketplace::Elsewhere(source) => {
            out.conflicts.push(format!(
                "{name}: marketplace `{MARKETPLACE}` comes from {source}, not {}; remove it with `{} plugin marketplace remove {MARKETPLACE}` or set [stack] path to it",
                stack.display(),
                hc.harness.as_str()
            ));
            return Ok(());
        }
        Marketplace::Stack => {}
    }

    let installed = match query(runner, &command(&["plugin", "list", "--json"])) {
        Query::CannotStart(err) => {
            out.conflicts.push(err);
            return Ok(());
        }
        Query::Json(json) => installed_plugins(hc.harness, &json),
        Query::Failed(_) => None,
    };
    let Some(installed) = installed else {
        out.warnings.push(format!("note: cannot read {name}'s installed plugins; planning every install command, which the CLI skips when already done"));
        out.commands.extend(PLUGINS.map(install));
        return Ok(());
    };
    // A `jm` plugin the checkout no longer lists, such as the retired jm-games, is removed
    // before the installs. Its marketplace cannot reinstall it, so the record names the last
    // stack commit that lists it instead of a command.
    for entry in &installed {
        let Some(plugin) = entry.id.strip_suffix(&format!("@{MARKETPLACE}")) else { continue };
        if manifest.iter().any(|(name, _)| name == plugin) {
            continue;
        }
        let undo = Restore::Retired { stack: stack.clone(), plugin: plugin.to_string() };
        let removal = |args: &[&str], _: &[&str]| Command { harness: hc.harness, env: env.clone(), args: strings(args), undo: Some(undo.clone()), clean: false };
        plan_removal(hc.harness, entry, &removal, out);
    }
    for plugin in PLUGINS {
        let id = format!("{plugin}@{MARKETPLACE}");
        match installed.iter().find(|entry| entry.id == id && (hc.harness != Harness::Claude || matches!(entry.scope.as_deref(), None | Some("user")))) {
            None => out.commands.push(install(plugin)),
            Some(entry) => {
                // Both CLIs cache an installed version; a checkout version change needs a refresh.
                let wanted = manifest.iter().find(|(name, _)| name == plugin).and_then(|(_, version)| version.as_deref());
                if wanted.is_some() && entry.version.as_deref() != wanted {
                    out.commands.push(match hc.harness {
                        Harness::Claude => command(&["plugin", "update", &id, "--scope", "user"]),
                        Harness::Codex => install(plugin),
                    });
                }
                if !entry.enabled {
                    out.warnings.push(format!("note: {id} is installed but disabled in {name}; ai-stack leaves it disabled"));
                }
            }
        }
    }
    Ok(())
}

/// `--clean`: removes every installed plugin `[clean] keep_plugins` does not match, except the
/// `jm` marketplace's own, which `plan` handles. Marketplaces stay.
pub fn plan_clean(cfg: &Config, hc: &HarnessConfig, runner: &dyn Runner, out: &mut Plan) -> Result<()> {
    let name = hc.harness.name();
    let env = env_for(hc);
    let list = Command { harness: hc.harness, env: env.clone(), args: strings(&["plugin", "list", "--json"]), undo: None, clean: false };
    if !hc.home.is_dir() {
        let version = Command { args: strings(&["--version"]), ..list };
        if let Query::CannotStart(err) = query(runner, &version) {
            out.conflicts.push(err);
        }
        return Ok(());
    }
    let removal = |args: &[&str], undo: &[&str]| Command { harness: hc.harness, env: env.clone(), args: strings(args), undo: Some(Restore::Command(strings(undo))), clean: true };
    let installed = match query(runner, &list) {
        Query::CannotStart(err) => {
            out.conflicts.push(err);
            return Ok(());
        }
        Query::Failed(err) => Err(err),
        Query::Json(json) => installed_plugins(hc.harness, &json).ok_or_else(|| "unexpected JSON shape".to_string()),
    };
    let installed = match installed {
        Ok(installed) => installed,
        Err(err) => {
            out.conflicts.push(format!("{name}: --clean cannot read the installed plugins ({err})"));
            return Ok(());
        }
    };
    for entry in installed {
        let marketplace = entry.id.rsplit_once('@').map_or("", |(_, marketplace)| marketplace);
        // Skills-directory plugins are entries in a skill root, which the skill pass handles.
        if cfg.clean.keeps_plugin(&entry.id) || marketplace == "skills-dir" || marketplace == MARKETPLACE {
            continue;
        }
        plan_removal(hc.harness, &entry, &removal, out);
    }
    Ok(())
}

/// Removes one installed plugin with a command that records how to restore it: a user-scope
/// uninstall, a disable for a plugin synced from the claude.ai account (which Claude Code
/// cannot uninstall, and the app may sync back), or `codex plugin remove`. A Claude plugin
/// installed for a project stays, with a note.
fn plan_removal(harness: Harness, entry: &Installed, removal: &dyn Fn(&[&str], &[&str]) -> Command, out: &mut Plan) {
    let id = entry.id.as_str();
    match (harness, entry.scope.as_deref()) {
        (Harness::Codex, _) => out.commands.push(removal(&["plugin", "remove", id], &["plugin", "add", id])),
        (Harness::Claude, Some("synced")) => {
            out.warnings.push(format!("note: {id} is synced from your claude.ai account; Claude Code cannot uninstall it, so ai-stack disables it, and the app may sync it back. Remove it on claude.ai to keep it gone."));
            if entry.enabled {
                out.commands.push(removal(&["plugin", "disable", id], &["plugin", "enable", id]));
            }
        }
        (Harness::Claude, None | Some("user")) => out.commands.push(removal(&["plugin", "uninstall", id], &["plugin", "install", id])),
        (Harness::Claude, Some(scope)) => {
            out.warnings.push(format!("note: {id} is installed in {scope} scope for a project; ai-stack removes user-scope plugins only, so it stays"));
        }
    }
}

/// Where a retired `jm` plugin can be restored from: the newest stack commit whose marketplace
/// manifest lists it and whose copy of its source directory still holds a skill (a `SKILL.md`).
/// A commit that only lists it, after its skills moved out, cannot restore it.
fn retired_note(stack: &Path, harness: Harness, plugin: &str) -> String {
    let manifest = manifest_path(harness);
    match restorable_commit(stack, manifest, plugin) {
        Some(commit) => format!("{plugin} was retired from the {MARKETPLACE} marketplace. Commit {commit} of the stack {} is the last that lists it in {manifest} with its skills; restore it from there.", stack.display()),
        None => format!("{plugin} was retired from the {MARKETPLACE} marketplace, and the stack {} has no commit that lists it in {manifest} with its skills.", stack.display()),
    }
}

fn restorable_commit(stack: &Path, manifest: &str, plugin: &str) -> Option<String> {
    let git = |args: &[&str]| exec::check(&exec::SystemExec, "git", &strings(&[&["-C", &stack.to_string_lossy()], args].concat()), None).ok();
    // A plugin no commit ever named needs no walk through the history.
    git(&["log", "-1", "--format=%H", "-S", &format!("\"{plugin}\""), "--", manifest]).filter(|found| !found.trim().is_empty())?;
    let commits = git(&["rev-list", "HEAD"])?;
    commits.lines().find(|commit| {
        let Some(text) = git(&["show", &format!("{commit}:{manifest}")]) else { return false };
        let Ok(json) = serde_json::from_str::<Value>(&text) else { return false };
        let entry = json["plugins"].as_array().and_then(|entries| entries.iter().find(|entry| entry["name"] == plugin));
        let Some(source) = entry.and_then(|entry| entry["source"].as_str().or_else(|| entry["source"]["path"].as_str())) else { return false };
        let source = source.trim_start_matches("./").trim_end_matches('/');
        git(&["ls-tree", "-r", "--name-only", commit, "--", source]).is_some_and(|files| files.lines().any(|file| file.rsplit('/').next() == Some("SKILL.md")))
    }).map(str::to_string)
}

fn manifest_path(harness: Harness) -> &'static str {
    match harness {
        Harness::Claude => ".claude-plugin/marketplace.json",
        Harness::Codex => ".agents/plugins/marketplace.json",
    }
}

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| arg.to_string()).collect()
}

/// Sets the harness home for the CLI when it would otherwise use a different one.
fn env_for(hc: &HarnessConfig) -> Option<(&'static str, PathBuf)> {
    let (var, dir) = match hc.harness {
        Harness::Claude => ("CLAUDE_CONFIG_DIR", ".claude"),
        Harness::Codex => ("CODEX_HOME", ".codex"),
    };
    let effective = std::env::var_os(var)
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(dir)));
    (effective.as_deref() != Some(hc.home.as_path())).then(|| (var, hc.home.clone()))
}

enum Query {
    CannotStart(String),
    Failed(String),
    Json(Value),
}

fn query(runner: &dyn Runner, cmd: &Command) -> Query {
    match runner.run(cmd) {
        Err(err) => Query::CannotStart(format!("`{cmd}`: {err}")),
        Ok(ran) if !ran.ok => Query::Failed(format!("`{cmd}` failed: {}", ran.stderr.trim())),
        Ok(ran) => match serde_json::from_str(&ran.stdout) {
            Ok(json) => Query::Json(json),
            Err(err) => Query::Failed(format!("`{cmd}` printed no JSON: {err}")),
        },
    }
}

/// Reads `claude plugin marketplace list --json` (`[{name, source, path}]`) or
/// `codex plugin marketplace list --json` (`{marketplaces: [{name, marketplaceSource: {sourceType, source}}]}`).
fn marketplace_state(harness: Harness, json: &Value, stack: &Path) -> Marketplace {
    let entries = match harness {
        Harness::Claude => json.as_array(),
        Harness::Codex => json["marketplaces"].as_array(),
    };
    let Some(entry) = entries.into_iter().flatten().find(|entry| entry["name"] == MARKETPLACE) else {
        return Marketplace::Absent;
    };
    let (kind, path) = match harness {
        Harness::Claude => (entry["source"].as_str(), entry["path"].as_str()),
        Harness::Codex => (entry["marketplaceSource"]["sourceType"].as_str(), entry["marketplaceSource"]["source"].as_str()),
    };
    let local = matches!(kind, Some("directory" | "local"));
    match path {
        Some(path) if local && same_path(Path::new(path), stack) => Marketplace::Stack,
        _ => Marketplace::Elsewhere(format!("{} {}", kind.unwrap_or("an unknown source"), path.unwrap_or("?"))),
    }
}

struct Installed {
    id: String,
    version: Option<String>,
    enabled: bool,
    /// Claude Code only: `user`, `project`, `local` or `synced`.
    scope: Option<String>,
}

/// Reads `claude plugin list --json` (`[{id, version, enabled, scope}]`) or
/// `codex plugin list --json` (`{installed: [{pluginId, version, enabled}]}`).
fn installed_plugins(harness: Harness, json: &Value) -> Option<Vec<Installed>> {
    let (entries, key) = match harness {
        Harness::Claude => (json.as_array()?, "id"),
        Harness::Codex => (json["installed"].as_array()?, "pluginId"),
    };
    Some(
        entries
            .iter()
            .filter_map(|entry| {
                Some(Installed {
                    id: entry[key].as_str()?.to_string(),
                    version: entry["version"].as_str().map(str::to_string),
                    enabled: entry["enabled"].as_bool().unwrap_or(true),
                    scope: entry["scope"].as_str().map(str::to_string),
                })
            })
            .collect(),
    )
}

/// The harness's marketplace manifest in the stack: checks it is `jm` and lists every plugin
/// in `PLUGINS`. Returns every listed plugin with the version its harness manifest declares,
/// when it declares one.
fn read_manifest(stack: &Path, harness: Harness) -> Result<Vec<(String, Option<String>)>> {
    let manifest = manifest_path(harness);
    let plugin_manifest = match harness {
        Harness::Claude => ".claude-plugin/plugin.json",
        Harness::Codex => ".codex-plugin/plugin.json",
    };
    let path = stack.join(manifest);
    let text = std::fs::read_to_string(&path).with_context(|| format!("cannot read {}", path.display()))?;
    let json: Value = serde_json::from_str(&text).with_context(|| format!("{} is not JSON", path.display()))?;
    let found = json["name"].as_str().unwrap_or_default();
    anyhow::ensure!(found == MARKETPLACE, "{} names the marketplace {found:?}", path.display());
    let entries = json["plugins"].as_array().map(Vec::as_slice).unwrap_or_default();
    for plugin in PLUGINS {
        anyhow::ensure!(entries.iter().any(|entry| entry["name"] == plugin), "{} does not list {plugin}", path.display());
    }
    Ok(entries
        .iter()
        .filter_map(|entry| {
            let plugin = entry["name"].as_str()?;
            let source = entry["source"].as_str().or_else(|| entry["source"]["path"].as_str());
            let version = source.and_then(|source| {
                let text = std::fs::read_to_string(stack.join(source).join(plugin_manifest)).ok()?;
                serde_json::from_str::<Value>(&text).ok()?["version"].as_str().map(str::to_string)
            });
            Some((plugin.to_string(), version))
        })
        .collect())
}

fn same_path(a: &Path, b: &Path) -> bool {
    crate::paths::resolve(a) == crate::paths::resolve(b)
}

#[cfg(test)]
pub mod fake {
    //! A stateful stand-in for the `claude` and `codex` plugin CLIs.

    use std::cell::RefCell;
    use std::collections::{BTreeMap, BTreeSet};

    use serde_json::json;

    use super::*;

    #[derive(Default)]
    pub struct State {
        /// marketplace name -> source path
        pub marketplaces: BTreeMap<String, String>,
        /// plugin id -> installed version. Claude ids ending in `@synced` list with scope `synced`.
        pub installed: BTreeMap<String, String>,
        pub disabled: std::collections::BTreeSet<String>,
    }

    #[derive(Default)]
    pub struct FakeRunner {
        pub missing: BTreeSet<Harness>,
        pub claude: RefCell<State>,
        pub codex: RefCell<State>,
        /// Every mutating command run, as displayed.
        pub ran: RefCell<Vec<String>>,
    }

    impl Runner for FakeRunner {
        fn available(&self, harness: Harness) -> bool {
            !self.missing.contains(&harness)
        }

        fn run(&self, cmd: &Command) -> io::Result<Ran> {
            assert!(self.available(cmd.harness), "unavailable harness command: {cmd}");
            let mut state = match cmd.harness { Harness::Claude => self.claude.borrow_mut(), Harness::Codex => self.codex.borrow_mut() };
            let args: Vec<&str> = cmd.args.iter().map(String::as_str).collect();
            let stdout = match (cmd.harness, args.as_slice()) {
                (_, ["--version"]) => "1.0.0".into(),
                (Harness::Claude, ["plugin", "marketplace", "list", "--json"]) => json!(state.marketplaces.iter().map(|(name, path)| json!({"name": name, "source": "directory", "path": path})).collect::<Vec<_>>()).to_string(),
                (Harness::Codex, ["plugin", "marketplace", "list", "--json"]) => json!({"marketplaces": state.marketplaces.iter().map(|(name, path)| json!({"name": name, "marketplaceSource": {"sourceType": "local", "source": path}})).collect::<Vec<_>>()}).to_string(),
                (Harness::Claude, ["plugin", "list", "--json"]) => json!(state.installed.iter().map(|(id, version)| {
                    let scope = if id.ends_with("@synced") { "synced" } else { "user" };
                    json!({"id": id, "version": version, "enabled": !state.disabled.contains(id), "scope": scope})
                }).collect::<Vec<_>>()).to_string(),
                (Harness::Codex, ["plugin", "list", "--json"]) => json!({"installed": state.installed.iter().map(|(id, version)| json!({"pluginId": id, "version": version, "enabled": !state.disabled.contains(id)})).collect::<Vec<_>>(), "available": []}).to_string(),
                // Like the real CLI, Claude Code refuses to uninstall a plugin synced from claude.ai.
                (Harness::Claude, ["plugin", "uninstall", id]) if id.ends_with("@synced") => {
                    return Ok(Ran { ok: false, stdout: String::new(), stderr: format!("{id} is synced from your claude.ai account") });
                }
                (Harness::Claude, ["plugin", "uninstall", id]) | (Harness::Codex, ["plugin", "remove", id]) if state.installed.remove(*id).is_some() => {
                    self.ran.borrow_mut().push(cmd.to_string());
                    String::new()
                }
                (Harness::Claude, ["plugin", "disable", id]) if state.installed.contains_key(*id) => {
                    state.disabled.insert(id.to_string());
                    self.ran.borrow_mut().push(cmd.to_string());
                    String::new()
                }
                (_, ["plugin", "marketplace", "add", path]) => {
                    state.marketplaces.insert(MARKETPLACE.into(), path.to_string());
                    self.ran.borrow_mut().push(cmd.to_string());
                    String::new()
                }
                (_, ["plugin", "install" | "add", id]) | (Harness::Claude, ["plugin", "update", id, "--scope", "user"]) => {
                    let version = if let Some(plugin) = id.strip_suffix("@jm") {
                        let stack = Path::new(&state.marketplaces[MARKETPLACE]);
                        read_manifest(stack, cmd.harness).unwrap().into_iter().find(|(name, _)| name == plugin).and_then(|(_, version)| version).unwrap_or_default()
                    } else {
                        "1.0.0".into()
                    };
                    state.installed.insert(id.to_string(), version);
                    self.ran.borrow_mut().push(cmd.to_string());
                    String::new()
                }
                _ => return Ok(Ran { ok: false, stdout: String::new(), stderr: format!("unexpected command {cmd}") }),
            };
            Ok(Ran { ok: true, stdout, stderr: String::new() })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detected_executable_path_is_reused_and_launch_failure_is_a_conflict() {
        use std::os::unix::fs::PermissionsExt;
        use crate::install::{self, Options};
        use crate::install::tests::{fixture, put};

        let f = fixture();
        let bin = f.root.join("bin");
        let program = bin.join("claude");
        put(&program, "#!/bin/sh\nprintf '%s' \"$0\"\n");
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        let runner = SystemRunner::on_path(Some(bin.as_os_str()));
        assert!(runner.available(Harness::Claude));
        assert!(!runner.available(Harness::Codex));
        let cmd = Command { harness: Harness::Claude, env: None, args: vec![], undo: None, clean: false };
        assert_eq!(runner.run(&cmd).unwrap().stdout, program.display().to_string());
        assert_eq!(runner.executables[&Harness::Claude], program);
        for failure in ["interpreter", "permission", "removed"] {
            match failure {
                "interpreter" => put(&program, &format!("#!{}\n", f.root.join("missing-interpreter").display())),
                "permission" => std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o600)).unwrap(),
                "removed" => std::fs::remove_file(&program).unwrap(),
                _ => unreachable!(),
            }
            put(&f.home.join(".claude/CLAUDE.md"), "# Mine\n");
            let plan = install::plan(&f.cfg, Options::default(), &runner).unwrap();
            assert!(plan.conflicts.iter().any(|conflict| conflict.contains(&format!("CLI was found at {} but could not be started", program.display()))), "{:?}", plan.conflicts);
            assert!(crate::plan::apply(&plan, &f.root.join("backups"), &runner).is_err());
            assert_eq!(std::fs::read_to_string(f.home.join(".claude/CLAUDE.md")).unwrap(), "# Mine\n");
        }
    }

    #[test]
    fn any_query_spawn_error_blocks_apply_before_file_changes() {
        use crate::install::{self, Options};
        use crate::install::tests::{fixture, put};

        struct FailingQuery<'a> {
            inner: &'a fake::FakeRunner,
            args: Vec<String>,
            kind: io::ErrorKind,
        }
        impl Runner for FailingQuery<'_> {
            fn available(&self, harness: Harness) -> bool { self.inner.available(harness) }
            fn run(&self, cmd: &Command) -> io::Result<Ran> {
                if cmd.harness == Harness::Claude && cmd.args == self.args {
                    Err(io::Error::new(self.kind, "spawn failed"))
                } else {
                    self.inner.run(cmd)
                }
            }
        }
        for clean in [false, true] {
            for args in [strings(&["plugin", "marketplace", "list", "--json"]), strings(&["plugin", "list", "--json"])] {
                for kind in [io::ErrorKind::NotFound, io::ErrorKind::PermissionDenied, io::ErrorKind::InvalidInput] {
                    let f = fixture();
                    let instructions = f.home.join(".claude/CLAUDE.md");
                    put(&instructions, "# Mine\n");
                    f.runner.claude.borrow_mut().marketplaces.insert(MARKETPLACE.into(), f.stack.display().to_string());
                    let runner = FailingQuery { inner: &f.runner, args: args.clone(), kind };
                    let plan = install::plan(&f.cfg, Options { clean, ..Options::default() }, &runner).unwrap();
                    assert!(plan.conflicts.iter().any(|conflict| conflict.contains("spawn failed")), "{kind:?}: {:?}", plan.conflicts);
                    assert!(crate::plan::apply(&plan, &f.root.join("backups"), &runner).is_err());
                    assert_eq!(std::fs::read_to_string(&instructions).unwrap(), "# Mine\n");
                    assert!(f.runner.ran.borrow().is_empty());
                }
            }
        }
    }

    #[test]
    fn fresh_home_launch_failure_blocks_apply_before_files_or_commands() {
        use crate::install::{self, Options};
        use crate::install::tests::fixture;

        struct FailingLaunch<'a> {
            inner: &'a fake::FakeRunner,
            harness: Harness,
        }
        impl Runner for FailingLaunch<'_> {
            fn available(&self, harness: Harness) -> bool { self.inner.available(harness) }
            fn run(&self, cmd: &Command) -> io::Result<Ran> {
                if cmd.harness == self.harness {
                    assert_eq!(cmd.args, ["--version"]);
                    Err(io::Error::new(io::ErrorKind::NotFound, "bad interpreter"))
                } else {
                    self.inner.run(cmd)
                }
            }
        }
        for harness in Harness::ALL {
            for clean in [false, true] {
                let f = fixture();
                let runner = FailingLaunch { inner: &f.runner, harness };
                let plan = install::plan(&f.cfg, Options { clean, ..Options::default() }, &runner).unwrap();
                assert!(plan.conflicts.iter().any(|conflict| conflict.contains("--version") && conflict.contains("bad interpreter")), "{:?}", plan.conflicts);
                assert!(crate::plan::apply(&plan, &f.root.join("backups"), &runner).is_err());
                assert!(!f.home.exists());
                assert!(!f.root.join("backups").exists());
                assert!(f.runner.ran.borrow().is_empty());

                let hc = f.cfg.harnesses.iter().find(|hc| hc.harness == harness).unwrap();
                let mut clean_plan = Plan::default();
                plan_clean(&f.cfg, hc, &runner, &mut clean_plan).unwrap();
                assert!(clean_plan.conflicts.iter().any(|conflict| conflict.contains("bad interpreter")));
                assert!(clean_plan.commands.is_empty());
            }
        }
    }

    #[test]
    fn fresh_home_nonzero_launch_probe_still_plans_every_plugin_command() {
        use crate::install::tests::fixture;

        struct NonzeroVersion;
        impl Runner for NonzeroVersion {
            fn available(&self, _: Harness) -> bool { true }
            fn run(&self, cmd: &Command) -> io::Result<Ran> {
                assert_eq!(cmd.args, ["--version"]);
                Ok(Ran { ok: false, stdout: String::new(), stderr: "home does not exist".into() })
            }
        }
        let f = fixture();
        for hc in &f.cfg.harnesses {
            let mut plan = Plan::default();
            plan_clean(&f.cfg, hc, &NonzeroVersion, &mut plan).unwrap();
            assert!(plan.conflicts.is_empty());
            assert!(plan.commands.is_empty());
            super::plan(&f.cfg, hc, &NonzeroVersion, &mut plan).unwrap();
            assert!(plan.conflicts.is_empty());
            assert_eq!(plan.commands.len(), 1 + PLUGINS.len());
        }
        assert!(!f.home.exists());
    }

    #[test]
    fn claude_refresh_uses_the_user_install_and_plugin_manifest_version() {
        use crate::install::tests::{fixture, put};
        use serde_json::json;

        struct ScopedPlugins<'a> {
            inner: &'a fake::FakeRunner,
            installed: Value,
        }
        impl Runner for ScopedPlugins<'_> {
            fn available(&self, harness: Harness) -> bool { self.inner.available(harness) }
            fn run(&self, cmd: &Command) -> io::Result<Ran> {
                if cmd.harness == Harness::Claude && cmd.args == strings(&["plugin", "list", "--json"]) {
                    Ok(Ran { ok: true, stdout: self.installed.to_string(), stderr: String::new() })
                } else {
                    self.inner.run(cmd)
                }
            }
        }

        let f = fixture();
        f.apply(&f.plan());
        // The throwaway CLI probe confirmed plugin.json wins when these versions disagree.
        put(&f.stack.join(".claude-plugin/marketplace.json"), &json!({"name":"jm", "plugins":[{"name":"jm-stack", "source":"./plugins/pstack", "version":"9.0.0"}]}).to_string());
        let hc = f.cfg.harnesses.iter().find(|hc| hc.harness == Harness::Claude).unwrap();
        let project = json!({"id":"jm-stack@jm", "version":"0.1.0", "scope":"project"});
        for (installed, expected) in [
            (json!([project, {"id":"jm-stack@jm", "version":"1.0.0", "scope":"user"}]), vec![]),
            (json!([project, {"id":"jm-stack@jm", "version":"0.1.0", "scope":"user"}]), strings(&["plugin", "update", "jm-stack@jm", "--scope", "user"])),
            (json!([project, {"id":"jm-stack@jm", "version":"0.1.0"}]), strings(&["plugin", "update", "jm-stack@jm", "--scope", "user"])),
            (json!([project]), strings(&["plugin", "install", "jm-stack@jm"])),
            (json!([{"id":"jm-stack@jm", "version":"0.1.0", "scope":"local"}, {"id":"jm-stack@jm", "version":"0.1.0", "scope":"synced"}]), strings(&["plugin", "install", "jm-stack@jm"])),
        ] {
            let runner = ScopedPlugins { inner: &f.runner, installed };
            let mut out = Plan::default();
            plan(&f.cfg, hc, &runner, &mut out).unwrap();
            assert!(out.conflicts.is_empty(), "{:?}", out.conflicts);
            assert_eq!(out.commands.iter().map(|cmd| cmd.args.clone()).collect::<Vec<_>>(), if expected.is_empty() { vec![] } else { vec![expected] });
        }
    }

    #[test]
    fn the_retired_jm_plugins_restore_from_the_commit_before_their_skills_moved_out() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let git = |args: &[&str]| exec::check(&exec::SystemExec, "git", &strings(&[&["-C", &repo.to_string_lossy()], args].concat()), None).ok().map(|out| out.trim().to_string());
        // 8b08520 moved the jm-games and jm-tools skills to skills/; a shallow clone may lack it.
        let Some(parent) = git(&["rev-parse", "--verify", "-q", "8b08520^{commit}^"]) else { return };
        for plugin in ["jm-games", "jm-tools"] {
            for harness in [Harness::Claude, Harness::Codex] {
                assert_eq!(restorable_commit(repo, manifest_path(harness), plugin), Some(parent.clone()), "{plugin} {harness:?}");
            }
        }
    }
}
