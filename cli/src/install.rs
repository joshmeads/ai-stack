//! Builds the install plan for every enabled harness: the model sheet, the instruction-file
//! blocks, cleanup of what older installs left behind, and the plugin commands.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, ensure};
use serde_json::Value;

use crate::blocks;
use crate::config::{Config, Harness, HarnessConfig};
use crate::paths;
use crate::plan::{self, Action, Plan};
use crate::plugins::{self, Runner};
use crate::render;

const LEGACY_LOCAL_BEGIN: &str = "<!-- open-pstack:local:begin -->";
const LEGACY_LOCAL_END: &str = "<!-- open-pstack:local:end -->";
const ROUTING_BLOCK: &str = "routing";
/// Claude only: the Anthropic prompting-guide bullets.
const GUIDANCE_BLOCK: &str = "anthropic-guidance";
/// Claude's `@` import of the sheet.
const SHEET_BLOCK: &str = "pstack-models";
/// The owner's global instructions from `<stack>/instructions/`, inlined for every harness.
const INSTRUCTIONS_BLOCK: &str = "instructions";
/// Hook commands older installs registered in Claude's settings.json: program and script
/// path relative to the stack root. The script may be quoted and followed by `SED_SUFFIX`.
const OLD_HOOKS: [(&str, &str); 2] = [("bash", "plugins/pstack/hooks/session-start"), ("python3", "scripts/task-context.py")];
const SED_SUFFIX: &str = " | sed 's/pstack://g'";

#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    /// Replace an unmanaged model sheet, after backing it up.
    pub force: bool,
    /// Move every skill-root entry and remove every plugin that `[clean]` does not keep.
    pub clean: bool,
}

pub fn plan(cfg: &Config, opts: Options, runner: &dyn Runner) -> Result<Plan> {
    ensure!(cfg.stack.path.is_dir(), "stack path {} does not exist; set [stack] path in the config or pass --stack", cfg.stack.path.display());
    let mut out = Plan { home: Some(cfg.home.clone()), ..Plan::default() };
    for hc in &cfg.harnesses {
        plan_sheet(cfg, hc, opts, &mut out)?;
        plan_instructions(cfg, hc, &mut out)?;
        if hc.harness == Harness::Claude {
            plan_settings(cfg, hc, &mut out)?;
        }
        plan_leftover_links(cfg, hc, &mut out)?;
    }
    if opts.clean {
        plan_clean_skills(cfg, &mut out)?;
        // Removals run before the jm installs.
        for hc in &cfg.harnesses {
            plugins::plan_clean(cfg, hc, runner, &mut out)?;
        }
    }
    for hc in &cfg.harnesses {
        plugins::plan(cfg, hc, runner, &mut out)?;
    }
    Ok(out)
}

/// `--clean`: every entry of each skill root that `[clean]` does not keep moves into the backup.
/// Entries an earlier action already handles (the leftover-link unlinks) are not planned again,
/// and a root reached twice through a symlink is read once.
fn plan_clean_skills(cfg: &Config, out: &mut Plan) -> Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    for root in &cfg.clean.skill_roots {
        if !seen.insert(fs::canonicalize(root).unwrap_or_else(|_| root.clone())) {
            continue;
        }
        for path in entries(root)? {
            let kept = path.file_name().is_some_and(|name| cfg.clean.keeps_skill(&name.to_string_lossy()));
            if kept || out.actions.iter().any(|action| action.path() == path) {
                continue;
            }
            out.actions.push(Action::MoveToBackup { fingerprint: plan::fingerprint(&path)?, path });
        }
    }
    Ok(())
}

fn sheet_path(hc: &HarnessConfig) -> PathBuf {
    hc.home.join("pstack-models.md")
}

/// `<home>/pstack-models.md`. An unmanaged sheet (for example one setup-stack wrote) is a
/// conflict unless `--force`.
fn plan_sheet(cfg: &Config, hc: &HarnessConfig, opts: Options, out: &mut Plan) -> Result<()> {
    let path = sheet_path(hc);
    let text = render::sheet(cfg, hc.harness);
    let replace = |out: &mut Plan| -> Result<()> {
        out.actions.push(Action::ReplaceWithFile { fingerprint: plan::fingerprint(&path)?, path: path.clone(), text: text.clone() });
        Ok(())
    };
    match metadata(&path)? {
        None => out.actions.extend(plan::write_if_changed(&path, text.clone())?),
        Some(meta) if meta.is_file() && first_line(&path)?.starts_with("<!-- Managed by ai-stack") => {
            out.actions.extend(plan::write_if_changed(&path, text.clone())?)
        }
        Some(meta) if meta.file_type().is_symlink() && owned_link(&path, cfg)? => replace(out)?,
        Some(_) if opts.force => replace(out)?,
        Some(_) => out.conflicts.push(format!("{} exists and is not managed by ai-stack; move it or run with --force", path.display())),
    }
    Ok(())
}

/// CLAUDE.md or AGENTS.md: drops leftover blocks, then upserts (or removes) the owner's
/// instructions block, the routing block, the guidance
/// block (Claude), and the sheet include (Claude) or mirror (Codex). User text outside the
/// blocks is kept.
fn plan_instructions(cfg: &Config, hc: &HarnessConfig, out: &mut Plan) -> Result<()> {
    let path = write_through(&hc.home.join(hc.harness.instruction_file()))?;
    let original = read_optional(&path)?.unwrap_or_default();
    blocks::validate(&original).with_context(|| format!("checking managed markers in {}", path.display()))?;
    let mut text = blocks::remove_marked(&original, LEGACY_LOCAL_BEGIN, LEGACY_LOCAL_END)?;
    for name in blocks::block_names(&text) {
        let guidance = hc.harness == Harness::Claude && name == GUIDANCE_BLOCK;
        if ![ROUTING_BLOCK, SHEET_BLOCK, INSTRUCTIONS_BLOCK].contains(&name.as_str()) && !guidance {
            text = blocks::remove(&text, &name)?;
        }
    }
    if hc.harness == Harness::Claude {
        text = remove_sheet_imports(&text, cfg, hc);
    }
    match instructions_body(cfg, hc.harness)? {
        Ok(Some(body)) => text = blocks::upsert(&text, INSTRUCTIONS_BLOCK, &body)?,
        Ok(None) => text = blocks::remove(&text, INSTRUCTIONS_BLOCK)?,
        Err(conflict) => out.conflicts.push(conflict),
    }
    let sheet = sheet_path(hc);
    text = blocks::upsert(&text, ROUTING_BLOCK, &render::routing(cfg, hc.harness, &sheet))?;
    if hc.harness == Harness::Claude {
        text = blocks::upsert(&text, GUIDANCE_BLOCK, render::ANTHROPIC_GUIDANCE)?;
    }
    text = match hc.harness {
        Harness::Claude => blocks::upsert(&text, SHEET_BLOCK, &format!("@{}", sheet.display()))?,
        Harness::Codex => blocks::upsert_marked(&text, blocks::PSTACK_BEGIN, blocks::PSTACK_END, &render::sheet(cfg, hc.harness))?,
    };
    out.actions.extend(plan::write_if_changed(&path, text)?);
    Ok(())
}

/// The owner's global instructions for `harness`: `<stack>/instructions/common.md`, a blank
/// line, then `<stem>.md`, each trimmed and skipped when absent or blank. `Ok(None)` when there
/// is nothing to manage; the inner `Err` is a conflict for a source holding a block marker.
fn instructions_body(cfg: &Config, harness: Harness) -> Result<Result<Option<String>, String>> {
    let dir = cfg.stack.path.join("instructions");
    let mut parts = Vec::new();
    for stem in ["common", harness.instructions_stem()] {
        let path = dir.join(format!("{stem}.md"));
        let Some(text) = read_optional(&path)? else { continue };
        if let Some(marker) = blocks::find_marker(&text) {
            return Ok(Err(format!("{} contains the managed marker prefix `{marker}`, which would corrupt the instruction file; remove it from the source", path.display())));
        }
        if !text.trim().is_empty() {
            parts.push(text.trim().to_string());
        }
    }
    Ok(Ok((!parts.is_empty()).then(|| parts.join("\n\n"))))
}

/// Drops `@...` import lines that load this harness's sheet, so the managed include is the
/// only one (setup-stack refuses a file with more than one).
fn remove_sheet_imports(text: &str, cfg: &Config, hc: &HarnessConfig) -> String {
    let sheet = sheet_path(hc);
    let imports_sheet = |line: &str| {
        let Some(target) = line.trim().strip_prefix('@') else { return false };
        let target = paths::expand(target, &cfg.home);
        let target = if target.is_absolute() { target } else { hc.home.join(target) };
        paths::normalize(&target) == sheet
    };
    let kept: String = text.split_inclusive('\n').filter(|line| !imports_sheet(line)).collect();
    if kept.len() == text.len() { kept } else { format!("{}\n", kept.trim_end()) }
}

/// Removes hook commands older installs added to settings.json. Other commands in the same
/// group stay; a group or event list is dropped only when ai-stack's commands were all it held.
fn plan_settings(cfg: &Config, hc: &HarnessConfig, out: &mut Plan) -> Result<()> {
    let path = write_through(&hc.home.join("settings.json"))?;
    let Some(text) = read_optional(&path)? else { return Ok(()) };
    let mut root: Value = match serde_json::from_str(&text) {
        Ok(root) => root,
        Err(err) => {
            out.conflicts.push(format!("{} is not valid JSON ({err}); ai-stack never rewrites a malformed settings.json, so fix it and run again", path.display()));
            return Ok(());
        }
    };
    let roots: Vec<&Path> = std::iter::once(cfg.stack.path.as_path()).chain(cfg.stack.legacy_paths.iter().map(PathBuf::as_path)).collect();
    if remove_owned_hooks(&mut root, &roots) {
        let mut text = serde_json::to_string_pretty(&root)?;
        text.push('\n');
        out.actions.extend(plan::write_if_changed(&path, text)?);
    }
    Ok(())
}

fn remove_owned_hooks(root: &mut Value, roots: &[&Path]) -> bool {
    let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) else { return false };
    let owned = |hook: &Value| hook["command"].as_str().is_some_and(|command| owned_hook(command, roots));
    let mut changed = false;
    let mut emptied = Vec::new();
    for (event, groups) in hooks.iter_mut() {
        let Some(groups) = groups.as_array_mut() else { continue };
        let mut removed = false;
        groups.retain_mut(|group| {
            let Some(list) = group.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
            let before = list.len();
            list.retain(|hook| !owned(hook));
            removed |= list.len() != before;
            list.len() == before || !list.is_empty()
        });
        if removed && groups.is_empty() {
            emptied.push(event.clone());
        }
        changed |= removed;
    }
    for event in emptied {
        hooks.shift_remove(&event);
    }
    changed
}

/// True only for the exact commands older installs wrote, pointing into one of `roots`.
fn owned_hook(command: &str, roots: &[&Path]) -> bool {
    let command = command.strip_suffix(SED_SUFFIX).unwrap_or(command).trim();
    let Some((program, arg)) = command.split_once(' ') else { return false };
    let arg = arg.trim();
    let script = arg.strip_prefix('\'').and_then(|arg| arg.strip_suffix('\'')).unwrap_or(arg);
    OLD_HOOKS.iter().any(|(owner, relative)| *owner == program && roots.iter().any(|root| Path::new(script) == root.join(relative)))
}

/// Skill and agent links into the stack or a legacy root, and role agent files older ai-stack
/// builds wrote. The jm plugins provide skills and agents now.
fn plan_leftover_links(cfg: &Config, hc: &HarnessConfig, out: &mut Plan) -> Result<()> {
    for dir in ["skills", "agents"] {
        for path in entries(&hc.home.join(dir))? {
            if path.file_name().is_some_and(|name| name.to_string_lossy().starts_with('.')) {
                continue;
            }
            let meta = fs::symlink_metadata(&path)?;
            if meta.file_type().is_symlink() {
                if owned_link(&path, cfg)? {
                    out.actions.push(Action::Unlink { target: fs::read_link(&path)?, path });
                }
            } else if dir == "agents" && meta.is_file() {
                if let Ok(text) = fs::read_to_string(&path) {
                    let managed = match hc.harness {
                        Harness::Claude => text.contains(render::MANAGED_MD),
                        Harness::Codex => text.lines().next() == Some(render::MANAGED_TOML),
                    };
                    if managed {
                        out.actions.push(Action::Remove { path, before: text });
                    }
                }
            }
        }
    }
    Ok(())
}

/// The file a shared path writes to: the link's target when `path` is a symlink, so the link stays.
fn write_through(path: &Path) -> Result<PathBuf> {
    match metadata(path)? {
        Some(meta) if meta.file_type().is_symlink() => Ok(match fs::canonicalize(path) {
            Ok(target) => target,
            Err(_) => {
                let target = fs::read_link(path)?;
                paths::normalize(&path.parent().expect("link has a parent").join(target))
            }
        }),
        _ => Ok(path.to_path_buf()),
    }
}

fn read_optional(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).with_context(|| format!("reading {}", path.display())),
    }
}

fn first_line(path: &Path) -> Result<String> {
    let bytes = fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    Ok(String::from_utf8_lossy(&bytes).lines().next().unwrap_or_default().to_string())
}

fn metadata(path: &Path) -> Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(meta) => Ok(Some(meta)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).with_context(|| format!("inspecting {}", path.display())),
    }
}

fn owned_link(path: &Path, cfg: &Config) -> Result<bool> {
    let target = fs::read_link(path)?;
    let resolved = paths::normalize(&if target.is_absolute() { target } else { path.parent().expect("entry parent").join(target) });
    Ok(resolved.starts_with(&cfg.stack.path) || cfg.stack.legacy_paths.iter().any(|root| resolved.starts_with(root)))
}

fn entries(dir: &Path) -> Result<Vec<PathBuf>> {
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err).with_context(|| format!("reading {}", dir.display())),
    };
    let mut paths = read.map(|e| e.map(|e| e.path())).collect::<io::Result<Vec<_>>>()?;
    paths.sort();
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::path::{Path, PathBuf};

    use serde_json::{Value, json};

    use super::*;
    use crate::config;
    use crate::plugins::fake::FakeRunner;

    struct Fixture {
        _tmp: tempfile::TempDir,
        root: PathBuf,
        stack: PathBuf,
        home: PathBuf,
        cfg: Config,
        runner: FakeRunner,
    }

    impl Fixture {
        fn plan(&self) -> Plan {
            super::plan(&self.cfg, Options::default(), &self.runner).unwrap()
        }
        fn apply(&self, plan: &Plan) {
            crate::plan::apply(plan, &self.root.join("backups"), &self.runner).unwrap();
        }
        fn read(&self, relative: &str) -> String {
            fs::read_to_string(self.home.join(relative)).unwrap()
        }
    }

    fn put(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn fixture() -> Fixture {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let stack = root.join("stack");
        let home = root.join("home");
        let sources = [("jm-stack", "plugins/pstack"), ("jm-games", "plugins/jm-games"), ("jm-tools", "plugins/jm-tools")];
        let claude = sources.map(|(name, dir)| json!({"name": name, "source": format!("./{dir}")}));
        let codex = sources.map(|(name, dir)| json!({"name": name, "source": {"source": "local", "path": format!("./{dir}")}}));
        put(&stack.join(".claude-plugin/marketplace.json"), &json!({"name": "jm", "plugins": claude}).to_string());
        put(&stack.join(".agents/plugins/marketplace.json"), &json!({"name": "jm", "plugins": codex}).to_string());
        for (name, dir) in sources {
            put(&stack.join(dir).join(".codex-plugin/plugin.json"), &json!({"name": name, "version": "1.0.0"}).to_string());
        }
        let mut cfg = config::from_str(config::default_config_text(), &home).unwrap();
        cfg.stack.path = stack.clone();
        cfg.stack.legacy_paths = vec![root.join("legacy")];
        let runner = FakeRunner::default();
        *runner.codex_version.borrow_mut() = "1.0.0".into();
        Fixture { _tmp: tmp, root, stack, home, cfg, runner }
    }

    #[test]
    fn fresh_install_writes_sheets_blocks_and_plugin_commands_then_settles() {
        let f = fixture();
        let first = f.plan();
        assert!(first.conflicts.is_empty(), "{:?}", first.conflicts);
        let stack = f.stack.display();
        let (claude_env, codex_env) = (format!("CLAUDE_CONFIG_DIR={}/.claude", f.home.display()), format!("CODEX_HOME={}/.codex", f.home.display()));
        let commands: Vec<String> = first.commands.iter().map(ToString::to_string).collect();
        assert_eq!(commands, [
            format!("{claude_env} claude plugin marketplace add {stack}"),
            format!("{claude_env} claude plugin install jm-stack@jm"),
            format!("{claude_env} claude plugin install jm-games@jm"),
            format!("{claude_env} claude plugin install jm-tools@jm"),
            format!("{codex_env} codex plugin marketplace add {stack}"),
            format!("{codex_env} codex plugin add jm-stack@jm"),
            format!("{codex_env} codex plugin add jm-games@jm"),
            format!("{codex_env} codex plugin add jm-tools@jm"),
        ]);
        assert!(f.runner.ran.borrow().is_empty(), "planning must not run install commands");
        f.apply(&first);
        assert_eq!(*f.runner.ran.borrow(), commands);

        let header = format!("{}\n", render::MANAGED_MD);
        let preamble = "Provider-qualified per-role choices. Read the installed jm:stack provider-dispatch reference before dispatching a configured role. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.\n\n";
        let claude_sheet = format!("{header}# jm:stack model sheet (Claude Code)\n\n{preamble}{}", concat!(
            "feature, refactoring: claude:opus@medium\n",
            "bug-fix: claude:opus@medium\n",
            "perf-issue: claude:opus@medium\n",
            "hillclimb: claude:opus@medium\n",
            "judgment and prose: claude:opus@xhigh\n",
            "hardest tasks: claude:opus@high\n",
            "how explorer: claude:haiku@xhigh\n",
            "how explainer: claude:opus@medium\n",
            "why investigators, synthesizer: inherit-parent\n",
            "reflect tooling, judgment, divergent, synthesizer: inherit-parent\n",
            "arena runners: claude:opus@medium, claude:opus@high\n",
            "arena cross-judge pool: claude:opus@xhigh\n",
            "swarm workers: claude:opus@medium\n",
            "architect runners: claude:opus@high, claude:opus@medium\n",
            "interrogate reviewers: claude:opus@xhigh, codex:gpt-6.1-sol@xhigh\n",
        ));
        let codex_sheet = format!("{header}# jm:stack model sheet (Codex)\n\n{preamble}{}", concat!(
            "feature, refactoring: codex:gpt-6.1-sol@medium\n",
            "bug-fix: codex:gpt-6.1-sol@medium\n",
            "perf-issue: codex:gpt-6.1-sol@medium\n",
            "hillclimb: codex:gpt-6.1-sol@medium\n",
            "judgment and prose: codex:gpt-6.1-sol@xhigh\n",
            "hardest tasks: codex:gpt-6.1-sol@xhigh\n",
            "how explorer: codex:gpt-6-luna@xhigh\n",
            "how explainer: codex:gpt-6.1-sol@medium\n",
            "why investigators, synthesizer: inherit-parent\n",
            "reflect tooling, judgment, divergent, synthesizer: inherit-parent\n",
            "arena runners: codex:gpt-6.1-sol@medium, codex:gpt-6.1-sol@xhigh\n",
            "arena cross-judge pool: codex:gpt-6.1-sol@xhigh\n",
            "swarm workers: codex:gpt-6.1-sol@medium\n",
            "architect runners: codex:gpt-6.1-sol@xhigh, codex:gpt-6.1-sol@medium\n",
            "interrogate reviewers: codex:gpt-6.1-sol@xhigh, claude:opus@xhigh\n",
        ));
        assert_eq!(f.read(".claude/pstack-models.md"), claude_sheet);
        assert_eq!(f.read(".codex/pstack-models.md"), codex_sheet);

        let claude = f.read(".claude/CLAUDE.md");
        let routing = render::routing(&f.cfg, Harness::Claude, &f.home.join(".claude/pstack-models.md"));
        assert_eq!(claude, format!(
            "<!-- ai-stack:routing:begin -->\n{routing}\n<!-- ai-stack:routing:end -->\n\n<!-- ai-stack:anthropic-guidance:begin -->\n{}\n<!-- ai-stack:anthropic-guidance:end -->\n\n<!-- ai-stack:pstack-models:begin -->\n@{}/.claude/pstack-models.md\n<!-- ai-stack:pstack-models:end -->\n",
            render::ANTHROPIC_GUIDANCE,
            f.home.display()
        ));
        let codex = f.read(".codex/AGENTS.md");
        assert!(!codex.contains("anthropic-guidance"), "{codex}");
        assert!(codex.ends_with(&format!("{}\n{codex_sheet}{}\n", blocks::PSTACK_BEGIN, blocks::PSTACK_END)), "{codex}");

        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));

        // A new plugin version in the checkout reinstalls it in Codex only.
        put(&f.stack.join("plugins/jm-games/.codex-plugin/plugin.json"), &json!({"name": "jm-games", "version": "1.1.0"}).to_string());
        let bumped: Vec<String> = f.plan().commands.iter().map(ToString::to_string).collect();
        assert_eq!(bumped, [format!("{codex_env} codex plugin add jm-games@jm")]);

        // A `jm` marketplace from somewhere else is never replaced silently.
        f.runner.claude.borrow_mut().marketplaces.insert("jm".into(), "/elsewhere".into());
        let conflicts = f.plan().conflicts;
        assert!(conflicts.iter().any(|c| c.contains("marketplace `jm` comes from directory /elsewhere")), "{conflicts:?}");
    }

    #[test]
    fn migration_removes_old_links_blocks_hooks_and_agent_files_but_keeps_user_content() {
        let f = fixture();
        let legacy = f.root.join("legacy");
        let skills = f.home.join(".claude/skills");
        let agents = f.home.join(".claude/agents");
        fs::create_dir_all(&skills).unwrap();
        fs::create_dir_all(&agents).unwrap();
        symlink(f.stack.join("plugins/pstack/skills/how"), skills.join("how")).unwrap();
        symlink(legacy.join("skills/art-iteration"), skills.join("art-iteration")).unwrap();
        symlink(f.stack.join("plugins/pstack/agents/pstack-opus-high.md"), agents.join("pstack-opus-high.md")).unwrap();
        symlink("../../.agents/skills/mine", skills.join("mine")).unwrap();
        put(&skills.join("own/SKILL.md"), "mine\n");
        put(&agents.join("worker.md"), &format!("---\nname: worker\n---\n\n{}\n", render::MANAGED_MD));
        put(&agents.join("haiku-worker.md"), "---\nname: haiku-worker\n---\nmine\n");
        put(&f.home.join(".codex/agents/worker.toml"), &format!("{}\nname = \"worker\"\n", render::MANAGED_TOML));

        put(&f.home.join(".claude/CLAUDE.md"), concat!(
            "<!-- open-pstack:local:begin -->\nold rules\n<!-- open-pstack:local:end -->\n\n",
            "# My notes\n\nKeep this.\n\n",
            "<!-- ai-stack:task-discipline:begin -->\nold discipline\n<!-- ai-stack:task-discipline:end -->\n\n",
            "<!-- ai-stack:anthropic-guidance:begin -->\nold guidance\n<!-- ai-stack:anthropic-guidance:end -->\n\n",
            "@~/.claude/pstack-models.md\n",
            "<!-- ai-stack:stack-models:begin -->\n@/old/sheet.md\n<!-- ai-stack:stack-models:end -->\n",
        ));
        let old = |root: &Path| (
            format!("bash {}/plugins/pstack/hooks/session-start | sed 's/pstack://g'", root.display()),
            format!("python3 '{}/scripts/task-context.py'", root.display()),
        );
        let (session, context) = old(&f.stack);
        let (_, legacy_context) = old(&legacy);
        let settings = f.home.join(".claude/settings.json");
        put(&settings, &json!({
            "theme": "dark",
            "hooks": {
                "SessionStart": [
                    {"matcher": "startup", "hooks": [{"type": "command", "command": "echo unrelated"}]},
                    {"matcher": "startup|clear|compact", "hooks": [{"type": "command", "command": session}]},
                    {"matcher": "startup|clear|compact", "hooks": [{"type": "command", "command": context}, {"type": "command", "command": "echo mine"}]}
                ],
                "SubagentStart": [{"hooks": [{"type": "command", "command": legacy_context}]}],
                "Stop": [{"hooks": [{"type": "command", "command": "python3 /elsewhere/scripts/task-context.py"}]}]
            }
        }).to_string());
        fs::set_permissions(&settings, fs::Permissions::from_mode(0o600)).unwrap();

        let plan = f.plan();
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        f.apply(&plan);

        for gone in ["skills/how", "skills/art-iteration", "agents/pstack-opus-high.md", "agents/worker.md"] {
            assert!(fs::symlink_metadata(f.home.join(".claude").join(gone)).is_err(), "{gone} survived");
        }
        assert!(fs::symlink_metadata(f.home.join(".codex/agents/worker.toml")).is_err());
        assert!(fs::symlink_metadata(skills.join("mine")).unwrap().file_type().is_symlink());
        assert!(skills.join("own/SKILL.md").exists() && agents.join("haiku-worker.md").exists());

        let claude = f.read(".claude/CLAUDE.md");
        // An existing guidance block is updated where it stands.
        assert!(claude.starts_with("# My notes\n\nKeep this.\n\n<!-- ai-stack:anthropic-guidance:begin -->"), "{claude}");
        assert_eq!(blocks::block_names(&claude), ["anthropic-guidance", "routing", "pstack-models"]);
        assert!(claude.contains(render::ANTHROPIC_GUIDANCE));
        for stale in ["open-pstack:local", "old rules", "old discipline", "old guidance", "@~/.claude/pstack-models.md", "/old/sheet.md"] {
            assert!(!claude.contains(stale), "{stale} in {claude}");
        }

        let value: Value = serde_json::from_str(&fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["hooks"]["SessionStart"], json!([
            {"matcher": "startup", "hooks": [{"type": "command", "command": "echo unrelated"}]},
            {"matcher": "startup|clear|compact", "hooks": [{"type": "command", "command": "echo mine"}]}
        ]));
        assert!(value["hooks"].get("SubagentStart").is_none());
        assert_eq!(value["hooks"]["Stop"][0]["hooks"][0]["command"], "python3 /elsewhere/scripts/task-context.py");
        assert_eq!(fs::metadata(&settings).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(f.plan().is_empty());
    }

    #[test]
    fn clean_moves_unkept_skills_into_the_backup_and_removes_unkept_plugins_then_settles() {
        let f = fixture();
        let (claude, codex, agents) = (f.home.join(".claude/skills"), f.home.join(".codex/skills"), f.home.join(".agents/skills"));
        for kept in ["better-ui/SKILL.md", ".system/x", "synced/x", "cua-driver/SKILL.md"] {
            put(&claude.join(kept), "kept\n");
        }
        put(&claude.join("old-skill/SKILL.md"), "old\n");
        put(&codex.join(".system/imagegen/SKILL.md"), "built-in\n");
        put(&codex.join("codex-only/SKILL.md"), "old\n");
        put(&agents.join("notes.txt"), "old\n");
        put(&f.root.join("elsewhere/linked/SKILL.md"), "target\n");
        symlink(f.root.join("elsewhere/linked"), claude.join("linked")).unwrap();
        symlink("/nonexistent/gone", claude.join("gone")).unwrap();
        // A link into the stack is the migration's to unlink, never planned twice.
        symlink(f.stack.join("plugins/pstack/skills/how"), claude.join("how")).unwrap();
        for id in ["github@claude-plugins-official", "expo@claude-plugins-official", "pdf-viewer@synced"] {
            f.runner.claude.borrow_mut().installed.insert(id.into(), "1".into());
        }
        for id in ["browser@openai-bundled", "old@market"] {
            f.runner.codex.borrow_mut().installed.insert(id.into(), "1".into());
        }

        let off = f.plan();
        assert_eq!(off.clean_count(), 0);
        assert!(!off.actions.iter().any(|a| matches!(a, Action::MoveToBackup { .. })));
        assert_eq!(off.stray(&f.home), crate::plan::Stray::default());

        let clean = |f: &Fixture| super::plan(&f.cfg, Options { clean: true, ..Options::default() }, &f.runner).unwrap();
        let plan = clean(&f);
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        let moved: Vec<PathBuf> = plan.actions.iter().filter(|a| matches!(a, Action::MoveToBackup { .. })).map(|a| a.path().to_path_buf()).collect();
        assert_eq!(moved, [claude.join("gone"), claude.join("linked"), claude.join("old-skill"), codex.join("codex-only"), agents.join("notes.txt")]);
        assert_eq!(plan.actions.iter().filter(|a| a.path() == claude.join("how")).count(), 1);
        let (claude_env, codex_env) = (format!("CLAUDE_CONFIG_DIR={}/.claude", f.home.display()), format!("CODEX_HOME={}/.codex", f.home.display()));
        let commands: Vec<String> = plan.commands.iter().map(ToString::to_string).collect();
        assert_eq!(commands[..4], [
            format!("{claude_env} claude plugin uninstall expo@claude-plugins-official"),
            format!("{claude_env} claude plugin disable pdf-viewer@synced"),
            format!("{codex_env} codex plugin remove old@market"),
            format!("{claude_env} claude plugin marketplace add {}", f.stack.display()),
        ]);
        assert!(plan.warnings.iter().any(|w| w.contains("pdf-viewer@synced") && w.contains("may sync it back")), "{:?}", plan.warnings);
        let stray = plan.stray(&f.home);
        assert_eq!(serde_json::to_string(&stray).unwrap(), json!({
            "skills": 5,
            "plugins": 3,
            "skill_names": ["~/.claude/skills/gone", "~/.claude/skills/linked", "~/.claude/skills/old-skill", "~/.codex/skills/codex-only", "~/.agents/skills/notes.txt"],
            "plugin_ids": ["expo@claude-plugins-official", "pdf-viewer@synced", "old@market"],
        }).to_string());
        assert!(stray.text().starts_with("skills: 5  plugins: 3\n  ~/.claude/skills/gone\n"), "{}", stray.text());

        let report = crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).unwrap();
        let backup = report.backup_dir.unwrap().join("home");
        assert_eq!(fs::read_to_string(backup.join(".claude/skills/old-skill/SKILL.md")).unwrap(), "old\n");
        assert_eq!(fs::read_to_string(backup.join(".agents/skills/notes.txt")).unwrap(), "old\n");
        assert!(backup.join(".codex/skills/codex-only/SKILL.md").exists());
        assert_eq!(fs::read_link(backup.join(".claude/skills/linked")).unwrap(), f.root.join("elsewhere/linked"));
        assert_eq!(fs::read_link(backup.join(".claude/skills/gone")).unwrap(), PathBuf::from("/nonexistent/gone"));
        assert!(f.root.join("elsewhere/linked/SKILL.md").exists(), "a moved link's target stays");
        for gone in [claude.join("old-skill"), claude.join("linked"), claude.join("gone"), codex.join("codex-only"), agents.join("notes.txt")] {
            assert!(fs::symlink_metadata(&gone).is_err(), "{} survived", gone.display());
        }
        for kept in ["better-ui", ".system", "synced", "cua-driver"] {
            assert!(claude.join(kept).exists(), "{kept} was moved");
        }
        assert!(codex.join(".system/imagegen/SKILL.md").exists());

        let manifest: Value = serde_json::from_str(&fs::read_to_string(report.manifest.unwrap()).unwrap()).unwrap();
        let reinstall: Vec<&str> = manifest["plugins"].as_array().unwrap().iter().map(|p| p["reinstall"].as_str().unwrap()).collect();
        assert_eq!(reinstall, [
            format!("{claude_env} claude plugin install expo@claude-plugins-official"),
            format!("{claude_env} claude plugin enable pdf-viewer@synced"),
            format!("{codex_env} codex plugin add old@market"),
        ]);
        assert_eq!(manifest["plugins"][2]["id"], "old@market");
        let installed: Vec<String> = f.runner.claude.borrow().installed.keys().cloned().collect();
        assert_eq!(installed, ["github@claude-plugins-official", "jm-games@jm", "jm-stack@jm", "jm-tools@jm", "pdf-viewer@synced"]);

        let again = clean(&f);
        assert!(again.is_empty(), "{}", again.render_text(&f.home));
    }

    #[test]
    fn instructions_sources_become_one_inline_block_per_harness_and_follow_edits_and_deletes() {
        let f = fixture();
        let sources = f.stack.join("instructions");
        put(&sources.join("common.md"), "Be terse.\n");
        put(&sources.join("claude.md"), "\nClaude only.\n\n");
        put(&f.home.join(".claude/CLAUDE.md"), "# Mine\n\nKeep this.\n");
        put(&f.home.join(".codex/AGENTS.md"), "# Mine too\n");
        let block = |body: &str| format!("<!-- ai-stack:instructions:begin -->\n{body}\n<!-- ai-stack:instructions:end -->");
        f.apply(&f.plan());
        let claude = f.read(".claude/CLAUDE.md");
        assert!(claude.starts_with(&format!("# Mine\n\nKeep this.\n\n{}\n\n", block("Be terse.\n\nClaude only."))), "{claude}");
        assert!(f.read(".codex/AGENTS.md").starts_with(&format!("# Mine too\n\n{}\n\n", block("Be terse."))));
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));

        put(&sources.join("codex.md"), "Codex only.\n");
        let edited = f.plan();
        let [Action::Write { path, before: Some(before), after }] = edited.actions.as_slice() else { panic!("{}", edited.render_text(&f.home)) };
        assert_eq!(*path, f.home.join(".codex/AGENTS.md"));
        assert_eq!(*after, before.replace(&block("Be terse."), &block("Be terse.\n\nCodex only.")));
        f.apply(&edited);

        for stem in ["common", "claude", "codex"] {
            fs::remove_file(sources.join(format!("{stem}.md"))).unwrap();
        }
        f.apply(&f.plan());
        for (file, mine) in [(".claude/CLAUDE.md", "# Mine\n\nKeep this.\n\n<!-- ai-stack:routing:begin -->"), (".codex/AGENTS.md", "# Mine too\n\n<!-- ai-stack:routing:begin -->")] {
            let text = f.read(file);
            assert!(text.starts_with(mine) && !text.contains("instructions:begin"), "{text}");
        }
        assert!(f.plan().is_empty());
    }

    #[test]
    fn instructions_source_with_a_block_marker_is_a_conflict() {
        let f = fixture();
        let source = f.stack.join("instructions/codex.md");
        put(&source, "Rules\n<!-- ai-stack:routing:end -->\n");
        let plan = f.plan();
        assert_eq!(plan.conflicts, [format!("{} contains the managed marker prefix `<!-- ai-stack:`, which would corrupt the instruction file; remove it from the source", source.display())]);
    }

    #[test]
    fn malformed_settings_is_reported_and_never_rewritten() {
        let f = fixture();
        let settings = f.home.join(".claude/settings.json");
        put(&settings, "{\"hooks\": ");
        let plan = f.plan();
        assert!(plan.conflicts.iter().any(|c| c.contains("is not valid JSON") && c.contains("never rewrites")), "{:?}", plan.conflicts);
        assert!(plan.actions.iter().all(|a| a.path() != settings.as_path()));
        assert!(crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).is_err());
        assert_eq!(fs::read_to_string(&settings).unwrap(), "{\"hooks\": ");
    }

    #[test]
    fn symlinked_instruction_file_is_written_through_and_keeps_its_mode() {
        let f = fixture();
        let target = f.root.join("dotfiles/AGENTS.md");
        put(&target, "# Shared\n");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        let link = f.home.join(".codex/AGENTS.md");
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink(&target, &link).unwrap();
        f.apply(&f.plan());
        assert_eq!(fs::read_link(&link).unwrap(), target);
        let text = fs::read_to_string(&target).unwrap();
        assert!(text.starts_with("# Shared\n\n<!-- ai-stack:routing:begin -->") && text.contains(blocks::PSTACK_BEGIN), "{text}");
        assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn unmanaged_sheet_conflicts_unless_forced() {
        let f = fixture();
        let sheet = f.home.join(".claude/pstack-models.md");
        put(&sheet, "# pstack model configuration\n");
        let refused = f.plan();
        assert_eq!(refused.conflicts, [format!("{} exists and is not managed by ai-stack; move it or run with --force", sheet.display())]);
        let forced = super::plan(&f.cfg, Options { force: true, ..Options::default() }, &f.runner).unwrap();
        assert!(forced.conflicts.is_empty());
        let report = crate::plan::apply(&forced, &f.root.join("backups"), &f.runner).unwrap();
        assert!(fs::read_to_string(&sheet).unwrap().starts_with(render::MANAGED_MD));
        assert_eq!(fs::read_to_string(report.backup_dir.unwrap().join("home/.claude/pstack-models.md")).unwrap(), "# pstack model configuration\n");
    }
}
