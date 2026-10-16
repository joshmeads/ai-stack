//! Adds the stack checkout to each harness as the local `jm` marketplace and installs its
//! plugins through the harness's own CLI. The commands run through a `Runner`, so tests use a
//! fake and `diff` only runs the read-only `list --json` queries.

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use anyhow::{Context as _, Result, anyhow};
use serde_json::Value;

use crate::config::{Config, Harness, HarnessConfig};
use crate::exec::shell_quote as quote;
use crate::plan::Plan;

pub const MARKETPLACE: &str = "jm";
pub const PLUGINS: [&str; 3] = ["jm-stack", "jm-games", "jm-tools"];

/// One harness CLI invocation, e.g. `claude plugin install jm-stack@jm`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Command {
    pub harness: Harness,
    /// `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, set only when the harness home is not the one the
    /// CLI would use anyway.
    pub env: Option<(&'static str, PathBuf)>,
    pub args: Vec<String>,
    /// For a `--clean` removal, the arguments that would restore the plugin. `None` otherwise.
    pub undo: Option<Vec<String>>,
}

impl Command {
    pub fn undo_command(&self) -> Option<Command> {
        let args = self.undo.clone()?;
        Some(Command { harness: self.harness, env: self.env.clone(), args, undo: None })
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
    /// Runs `cmd` to completion. An `Err` means it could not start (e.g. the CLI is missing).
    fn run(&self, cmd: &Command) -> io::Result<Ran>;
}

/// Runs the real `claude` / `codex` binaries from `PATH`.
pub struct SystemRunner;

impl Runner for SystemRunner {
    fn run(&self, cmd: &Command) -> io::Result<Ran> {
        let mut process = std::process::Command::new(cmd.harness.as_str());
        process.args(&cmd.args).stdin(Stdio::null());
        if let Some((name, value)) = &cmd.env {
            process.env(name, value);
        }
        let output = process.output()?;
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
    let command = |args: &[&str]| Command { harness: hc.harness, env: env.clone(), args: strings(args), undo: None };
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
        // Nothing is configured yet, and Codex refuses a CODEX_HOME that does not exist.
        // The file actions create the home before the commands run.
        out.commands.extend(everything());
        return Ok(());
    }

    let marketplace = match query(runner, &command(&["plugin", "marketplace", "list", "--json"])) {
        Query::Missing => {
            out.conflicts.push(format!("{name}: `{}` is not on PATH; install it or set [harness.{}] enabled = false", hc.harness.as_str(), hc.harness.as_str()));
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
        Query::Json(json) => installed_plugins(hc.harness, &json),
        Query::Missing | Query::Failed(_) => None,
    };
    let Some(installed) = installed else {
        out.warnings.push(format!("note: cannot read {name}'s installed plugins; planning every install command, which the CLI skips when already done"));
        out.commands.extend(PLUGINS.map(install));
        return Ok(());
    };
    for plugin in PLUGINS {
        let id = format!("{plugin}@{MARKETPLACE}");
        match installed.iter().find(|entry| entry.id == id) {
            None => out.commands.push(install(plugin)),
            Some(entry) => {
                // Codex installs a copy, so a new version in the checkout needs a reinstall.
                // Claude Code loads a directory marketplace's plugins in place.
                let wanted = manifest.iter().find(|(name, _)| name == plugin).and_then(|(_, version)| version.as_deref());
                if hc.harness == Harness::Codex && wanted.is_some() && entry.version.as_deref() != wanted {
                    out.commands.push(install(plugin));
                }
                if !entry.enabled {
                    out.warnings.push(format!("note: {id} is installed but disabled in {name}; ai-stack leaves it disabled"));
                }
            }
        }
    }
    Ok(())
}

/// `--clean`: removes every installed plugin `[clean] keep_plugins` does not match. Marketplaces
/// stay. Claude Code cannot uninstall a plugin synced from the claude.ai account, so those are
/// disabled instead, with a warning that the app may sync them back.
pub fn plan_clean(cfg: &Config, hc: &HarnessConfig, runner: &dyn Runner, out: &mut Plan) -> Result<()> {
    if !hc.home.is_dir() {
        return Ok(());
    }
    let name = hc.harness.name();
    let env = env_for(hc);
    let command = |args: &[&str], undo: Option<&[&str]>| Command { harness: hc.harness, env: env.clone(), args: strings(args), undo: undo.map(strings) };
    let installed = match query(runner, &command(&["plugin", "list", "--json"], None)) {
        // The install pass reports the missing CLI as a conflict.
        Query::Missing => return Ok(()),
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
        let id = entry.id.as_str();
        let marketplace = id.rsplit_once('@').map_or("", |(_, marketplace)| marketplace);
        // Skills-directory plugins are entries in a skill root, which the skill pass handles.
        if cfg.clean.keeps_plugin(id) || marketplace == "skills-dir" {
            continue;
        }
        match (hc.harness, entry.scope.as_deref()) {
            (Harness::Codex, _) => out.commands.push(command(&["plugin", "remove", id], Some(&["plugin", "add", id]))),
            (Harness::Claude, Some("synced")) => {
                out.warnings.push(format!("note: {id} is synced from your claude.ai account; Claude Code cannot uninstall it, so --clean disables it, and the app may sync it back. Remove it on claude.ai to keep it gone."));
                if entry.enabled {
                    out.commands.push(command(&["plugin", "disable", id], Some(&["plugin", "enable", id])));
                }
            }
            (Harness::Claude, None | Some("user")) => out.commands.push(command(&["plugin", "uninstall", id], Some(&["plugin", "install", id]))),
            (Harness::Claude, Some(scope)) => {
                out.warnings.push(format!("note: {id} is installed in {scope} scope for a project; --clean removes user-scope plugins only, so it stays"));
            }
        }
    }
    Ok(())
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
    Missing,
    Failed(String),
    Json(Value),
}

fn query(runner: &dyn Runner, cmd: &Command) -> Query {
    match runner.run(cmd) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Query::Missing,
        Err(err) => Query::Failed(format!("`{cmd}`: {err}")),
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

/// The harness's marketplace manifest in the stack: checks it is `jm` and lists every plugin.
/// Returns each plugin with the version its harness manifest declares, when it declares one.
fn read_manifest(stack: &Path, harness: Harness) -> Result<Vec<(String, Option<String>)>> {
    let (manifest, plugin_manifest) = match harness {
        Harness::Claude => (".claude-plugin/marketplace.json", ".claude-plugin/plugin.json"),
        Harness::Codex => (".agents/plugins/marketplace.json", ".codex-plugin/plugin.json"),
    };
    let path = stack.join(manifest);
    let text = std::fs::read_to_string(&path).with_context(|| format!("cannot read {}", path.display()))?;
    let json: Value = serde_json::from_str(&text).with_context(|| format!("{} is not JSON", path.display()))?;
    let found = json["name"].as_str().unwrap_or_default();
    anyhow::ensure!(found == MARKETPLACE, "{} names the marketplace {found:?}", path.display());
    let entries = json["plugins"].as_array().map(Vec::as_slice).unwrap_or_default();
    PLUGINS
        .iter()
        .map(|plugin| {
            let entry = entries.iter().find(|entry| entry["name"] == *plugin).ok_or_else(|| anyhow!("{} does not list {plugin}", path.display()))?;
            let source = entry["source"].as_str().or_else(|| entry["source"]["path"].as_str());
            let version = source.and_then(|source| {
                let text = std::fs::read_to_string(stack.join(source).join(plugin_manifest)).ok()?;
                serde_json::from_str::<Value>(&text).ok()?["version"].as_str().map(str::to_string)
            });
            Ok((plugin.to_string(), version))
        })
        .collect()
}

fn same_path(a: &Path, b: &Path) -> bool {
    let resolve = |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| crate::paths::normalize(path));
    resolve(a) == resolve(b)
}

#[cfg(test)]
pub mod fake {
    //! A stateful stand-in for the `claude` and `codex` plugin CLIs.

    use std::cell::RefCell;
    use std::collections::BTreeMap;

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
        pub claude: RefCell<State>,
        pub codex: RefCell<State>,
        /// Every mutating command run, as displayed.
        pub ran: RefCell<Vec<String>>,
        /// Version a Codex `plugin add` records.
        pub codex_version: RefCell<String>,
    }

    impl Runner for FakeRunner {
        fn run(&self, cmd: &Command) -> io::Result<Ran> {
            let mut state = match cmd.harness { Harness::Claude => self.claude.borrow_mut(), Harness::Codex => self.codex.borrow_mut() };
            let args: Vec<&str> = cmd.args.iter().map(String::as_str).collect();
            let stdout = match (cmd.harness, args.as_slice()) {
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
                (_, ["plugin", "install" | "add", id]) => {
                    state.installed.insert(id.to_string(), self.codex_version.borrow().clone());
                    self.ran.borrow_mut().push(cmd.to_string());
                    String::new()
                }
                _ => return Ok(Ran { ok: false, stdout: String::new(), stderr: format!("unexpected command {cmd}") }),
            };
            Ok(Ran { ok: true, stdout, stderr: String::new() })
        }
    }
}
