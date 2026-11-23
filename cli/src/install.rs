use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, ensure};
use clap::ValueEnum as _;
use serde_json::Value;

use crate::blocks;
use crate::config::{Config, Harness, HarnessConfig};
use crate::exec;
use crate::links;
use crate::paths;
use crate::plan::{self, Action, Plan};
use crate::plugins::{self, Runner};
use crate::render;
use crate::stackfile;

const LEGACY_LOCAL_BEGIN: &str = "<!-- open-pstack:local:begin -->";
const LEGACY_LOCAL_END: &str = "<!-- open-pstack:local:end -->";
const ROUTING_BLOCK: &str = "routing";
const SHEET_BLOCK: &str = "pstack-models";
const INSTRUCTIONS_BLOCK: &str = "instructions";
const OLD_HOOKS: [(&str, &str); 2] = [("bash", "plugins/pstack/hooks/session-start"), ("python3", "scripts/task-context.py")];
const SED_SUFFIX: &str = " | sed 's/pstack://g'";
const ARENA_JUDGE_ROW: &str = "arena cross-judge pool";

#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    pub force: bool,
    pub clean: bool,
    pub report: bool,
}

pub fn plan(cfg: &Config, opts: Options, runner: &dyn Runner) -> Result<Plan> {
    let mut out = Plan { home: Some(cfg.home.clone()), report: opts.report, ..Plan::default() };
    let (active, skipped) = available_config(cfg, runner, &mut out);
    if active.harnesses.is_empty() && !cfg.harnesses.is_empty() {
        return Ok(out);
    }
    let cfg = &active;
    let git = std::process::Command::new("git").arg("--version").output();
    out.warnings.extend(git.ok().and_then(|ran| git_version_warning(&String::from_utf8_lossy(&ran.stdout))));
    ensure!(cfg.stack.path.is_dir(), "stack path {} does not exist; set [stack] path in the config or pass --stack", cfg.stack.path.display());
    let stack_file = stackfile::load(&cfg.stack.path)?;
    let owner = links::Owner::new(cfg);
    let folders = links::Index::new(cfg, &skipped);
    for hc in &cfg.harnesses {
        warn_if_arena_judge_skipped(cfg, hc, &mut out);
        plan_sheet(cfg, &owner, hc, opts, &folders, &mut out)?;
        plan_instructions(cfg, hc, &folders, &mut out)?;
        plan_hooks(cfg, hc, &folders, &mut out)?;
    }
    links::plan(cfg, &owner, &folders, &stack_file, opts, &mut out)?;
    if opts.clean {
        for hc in &cfg.harnesses {
            plugins::plan_clean(cfg, hc, runner, &mut out)?;
        }
    }
    for hc in &cfg.harnesses {
        plugins::plan(cfg, hc, runner, &mut out)?;
    }
    Ok(out)
}

fn available_config(cfg: &Config, runner: &dyn Runner, out: &mut Plan) -> (Config, Vec<HarnessConfig>) {
    let mut active = cfg.clone();
    let (available, skipped): (Vec<_>, Vec<_>) = cfg.harnesses.iter().cloned().partition(|hc| runner.available(hc.harness));
    active.harnesses = available;
    for hc in &skipped {
        let id = hc.harness.as_str();
        out.warnings.push(format!("skipping {}: `{id}` not found on PATH", hc.harness.name()));
    }
    (active, skipped)
}

fn warn_if_arena_judge_skipped(cfg: &Config, hc: &HarnessConfig, out: &mut Plan) {
    let id = hc.harness.as_str();
    let pool = cfg.sheets[&hc.harness].iter().find(|(label, _)| label == ARENA_JUDGE_ROW).map_or("", |(_, lanes)| lanes);
    let other_provider = pool.split(", ").any(|lane| lane.split_once(':').is_some_and(|(provider, _)| provider != id));
    if !other_provider {
        out.warnings.push(format!(
            "note: {}'s `{ARENA_JUDGE_ROW}` has no entry from another provider, so arena will skip its judge; add one to that row in [sheet.{id}]",
            hc.harness.name(),
        ));
    }
}

fn sheet_path(hc: &HarnessConfig) -> PathBuf {
    hc.home.join("pstack-models.md")
}

fn plan_sheet(cfg: &Config, owner: &links::Owner, hc: &HarnessConfig, opts: Options, folders: &links::Index, out: &mut Plan) -> Result<()> {
    let path = sheet_path(hc);
    if folders.blocks_write(&path, out) { return Ok(()); }
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
        Some(meta) if meta.file_type().is_symlink() && owner.owns(&path)? => replace(out)?,
        Some(_) if opts.force => replace(out)?,
        Some(_) => out.conflicts.push(format!("{} exists and is not managed by ai-stack; move it or run with --force", path.display())),
    }
    Ok(())
}

fn plan_instructions(cfg: &Config, hc: &HarnessConfig, folders: &links::Index, out: &mut Plan) -> Result<()> {
    let requested = hc.home.join(hc.harness.instruction_file());
    if folders.blocks_write(&requested, out) { return Ok(()); }
    let path = paths::write_through(&requested)?;
    let original = read_optional(&path)?.unwrap_or_default();
    blocks::validate(&original).with_context(|| format!("checking managed markers in {}", path.display()))?;
    let mut text = blocks::remove_marked(&original, LEGACY_LOCAL_BEGIN, LEGACY_LOCAL_END)?;
    for name in blocks::block_names(&text) {
        if ![ROUTING_BLOCK, SHEET_BLOCK, INSTRUCTIONS_BLOCK].contains(&name.as_str()) {
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
    text = match hc.harness {
        Harness::Claude => blocks::upsert(&text, SHEET_BLOCK, &format!("@{}", sheet.display()))?,
        Harness::Codex => blocks::upsert_marked(&text, blocks::PSTACK_BEGIN, blocks::PSTACK_END, &render::sheet(cfg, hc.harness))?,
    };
    out.actions.extend(plan::write_if_changed(&path, text)?);
    Ok(())
}

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

fn remove_sheet_imports(text: &str, cfg: &Config, hc: &HarnessConfig) -> String {
    let sheet = paths::resolve(&sheet_path(hc));
    let imports_sheet = |line: &str| {
        let Some(target) = line.trim().strip_prefix('@') else { return false };
        let target = paths::expand(target, &cfg.home);
        let target = if target.is_absolute() { target } else { hc.home.join(target) };
        paths::resolve(&target) == sheet
    };
    let kept: String = text.split_inclusive('\n').filter(|line| !imports_sheet(line)).collect();
    if kept.len() == text.len() { kept } else { format!("{}\n", kept.trim_end()) }
}

fn hook_file(harness: Harness) -> &'static str {
    match harness {
        Harness::Claude => "settings.json",
        Harness::Codex => "hooks.json",
    }
}

fn plan_hooks(cfg: &Config, hc: &HarnessConfig, folders: &links::Index, out: &mut Plan) -> Result<()> {
    let file = hook_file(hc.harness);
    let requested = hc.home.join(file);
    if folders.blocks_write(&requested, out) { return Ok(()); }
    let path = paths::write_through(&requested)?;
    let text = read_optional(&path)?;
    let mut root: Value = match text.as_deref().map(serde_json::from_str::<Value>) {
        None => Value::Object(Default::default()),
        Some(Ok(root)) if root.is_object() => root,
        Some(Ok(_)) => {
            out.conflicts.push(format!("{} is not a JSON object; ai-stack never rewrites a malformed {file}, so fix it and run again", path.display()));
            return Ok(());
        }
        Some(Err(err)) => {
            out.conflicts.push(format!("{} is not valid JSON ({err}); ai-stack never rewrites a malformed {file}, so fix it and run again", path.display()));
            return Ok(());
        }
    };
    let roots: Vec<&Path> = std::iter::once(cfg.stack.path.as_path()).chain(cfg.stack.legacy_paths.iter().map(PathBuf::as_path)).collect();
    let removed = hc.harness == Harness::Claude && remove_owned_hooks(&mut root, &roots);
    let added = ensure_lint_hook(&mut root, hc.harness, &cfg.exe, &cfg.exe_flags);
    let env = match hc.harness {
        Harness::Claude => merge_claude_env(&mut root, &lint_env(cfg, hc.harness)),
        Harness::Codex => Ok(false),
    };
    match (added, env) {
        (Ok(added), Ok(env)) if removed || added || env => {
            let mut text = serde_json::to_string_pretty(&root)?;
            text.push('\n');
            out.actions.extend(plan::write_if_changed(&path, text)?);
        }
        (Ok(_), Ok(_)) => {}
        (Err(conflict), _) | (_, Err(conflict)) => out.conflicts.push(format!("{}: {conflict}; fix it and run again", path.display())),
    }
    if hc.harness == Harness::Codex {
        plan_codex_env(cfg, hc, folders, out)?;
    }
    Ok(())
}

const LINT_MATCHER: &str = "Edit|Write|Bash";
const HOOK_FLAGS: [&str; 3] = ["--config", "--home", "--stack"];
const OUR_GIT_KEYS: [&str; 4] = ["hook.ai-stack-lint.event", "hook.ai-stack-lint.command", "hook.ai-stack-lint-post.event", "hook.ai-stack-lint-post.command"];
const CODEX_INCLUDE: [&str; 4] = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_*", "GIT_CONFIG_VALUE_*", "AI_STACK_HARNESS"];
const FIRST_GIT_WITH_CONFIG_HOOKS: (u32, u32) = (2, 54);

fn exe_words(exe: &Path, flags: &[String]) -> String {
    std::iter::once(exe.to_string_lossy().into_owned()).chain(flags.iter().cloned()).map(|word| exec::shell_quote(&word)).collect::<Vec<_>>().join(" ")
}

fn lint_command(exe: &Path, flags: &[String], harness: Harness) -> String {
    format!("{} lint hook {}", exe_words(exe, flags), harness.as_str())
}

fn lint_env(cfg: &Config, harness: Harness) -> Vec<(String, String)> {
    let installed = format!("[ -x {} ] || exit 0", exec::shell_quote(&cfg.exe.to_string_lossy()));
    let exe = exe_words(&cfg.exe, &cfg.exe_flags);
    let values = [
        "pre-commit".to_string(),
        format!("{installed}; {exe} lint pre-commit; [ $? -ne {} ]", crate::lint::REFUSE),
        "post-commit".to_string(),
        format!("{installed}; exec {exe} lint post-commit"),
    ];
    let mut env = vec![("GIT_CONFIG_COUNT".to_string(), OUR_GIT_KEYS.len().to_string())];
    for (at, (key, value)) in OUR_GIT_KEYS.into_iter().zip(values).enumerate() {
        env.push((format!("GIT_CONFIG_KEY_{at}"), key.to_string()));
        env.push((format!("GIT_CONFIG_VALUE_{at}"), value));
    }
    env.push(("AI_STACK_HARNESS".to_string(), harness.as_str().to_string()));
    env
}

#[derive(Debug, PartialEq, Eq)]
enum EnvEdit {
    Set(String, String),
    Remove(String),
}

fn numbered<'a>(name: &'a str, prefix: &str) -> Option<&'a str> {
    name.strip_prefix(prefix).filter(|number| !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()))
}

fn env_edits(existing: &[(String, Option<String>)], wanted: &[(String, String)]) -> Result<Vec<EnvEdit>, String> {
    let keys: Vec<(&str, Option<&str>)> = existing.iter().filter_map(|(name, value)| numbered(name, "GIT_CONFIG_KEY_").map(|number| (number, value.as_deref()))).collect();
    if let Some((number, _)) = keys.iter().find(|(_, value)| !value.is_some_and(|value| OUR_GIT_KEYS.contains(&value))) {
        return Err(format!("GIT_CONFIG_KEY_{number} is already set to something ai-stack does not own, and ai-stack needs GIT_CONFIG_* for its agent commit hook; remove it or set [lint] enabled = false"));
    }
    if keys.is_empty() && existing.iter().any(|(name, _)| name == "GIT_CONFIG_COUNT") {
        return Err("GIT_CONFIG_COUNT is already set by something other than ai-stack, and ai-stack needs GIT_CONFIG_* for its agent commit hook; remove it".into());
    }
    let mut edits: Vec<EnvEdit> = existing
        .iter()
        .filter(|(name, _)| (numbered(name, "GIT_CONFIG_KEY_").is_some() || numbered(name, "GIT_CONFIG_VALUE_").is_some()) && !wanted.iter().any(|(wanted, _)| wanted == name))
        .map(|(name, _)| EnvEdit::Remove(name.clone()))
        .collect();
    for (name, value) in wanted {
        if !existing.iter().any(|(known, current)| known == name && current.as_deref() == Some(value.as_str())) {
            edits.push(EnvEdit::Set(name.clone(), value.clone()));
        }
    }
    Ok(edits)
}

fn merge_claude_env(root: &mut Value, wanted: &[(String, String)]) -> Result<bool, String> {
    let env = root.as_object_mut().ok_or("the file is not a JSON object")?.entry("env").or_insert_with(|| Value::Object(Default::default()));
    let env = env.as_object_mut().ok_or("`env` is not an object")?;
    let existing: Vec<(String, Option<String>)> = env.iter().map(|(name, value)| (name.clone(), value.as_str().map(String::from))).collect();
    let edits = env_edits(&existing, wanted)?;
    for edit in &edits {
        match edit {
            EnvEdit::Set(name, value) => {
                env.insert(name.clone(), Value::String(value.clone()));
            }
            EnvEdit::Remove(name) => {
                env.shift_remove(name);
            }
        }
    }
    Ok(!edits.is_empty())
}

fn plan_codex_env(cfg: &Config, hc: &HarnessConfig, folders: &links::Index, out: &mut Plan) -> Result<()> {
    let requested = hc.home.join("config.toml");
    if folders.blocks_write(&requested, out) {
        return Ok(());
    }
    let path = paths::write_through(&requested)?;
    let original = read_optional(&path)?.unwrap_or_default();
    let mut doc: toml_edit::DocumentMut = match original.parse() {
        Ok(doc) => doc,
        Err(err) => {
            out.conflicts.push(format!("{} is not valid TOML ({err}); ai-stack never rewrites a malformed config.toml, so fix it and run again", path.display()));
            return Ok(());
        }
    };
    match merge_codex_env(&mut doc, &lint_env(cfg, hc.harness)) {
        Ok(true) => out.actions.extend(plan::write_if_changed(&path, doc.to_string())?),
        Ok(false) => {}
        Err(conflict) => out.conflicts.push(format!("{}: {conflict}; fix it and run again", path.display())),
    }
    Ok(())
}

fn merge_codex_env(doc: &mut toml_edit::DocumentMut, wanted: &[(String, String)]) -> Result<bool, String> {
    let policy = doc.as_table_mut().entry("shell_environment_policy").or_insert_with(|| {
        let mut table = toml_edit::Table::new();
        table.set_implicit(true);
        toml_edit::Item::Table(table)
    });
    let policy = policy.as_table_like_mut().ok_or("`shell_environment_policy` is not a table")?;
    let mut changed = false;
    if let Some(include) = policy.get_mut("include_only") {
        let include = include.as_array_mut().ok_or("`shell_environment_policy.include_only` is not a list")?;
        let restricts = !include.is_empty();
        for name in CODEX_INCLUDE.into_iter().filter(|_| restricts) {
            if !include.iter().any(|known| known.as_str() == Some(name)) {
                include.push(name);
                changed = true;
            }
        }
    }
    if let Some(filters) = policy.get_mut("filters") {
        let filters = filters.as_table_like_mut().ok_or("`shell_environment_policy.filters` is not a table")?;
        if filters.iter().any(|(_, action)| action.as_str() == Some("include")) {
            for name in CODEX_INCLUDE {
                let listed = filters.iter().find(|(known, _)| known.eq_ignore_ascii_case(name)).map(|(known, action)| (known.to_string(), action.as_str() == Some("include")));
                match listed {
                    Some((_, true)) => {}
                    Some((known, false)) => {
                        return Err(format!(
                            "`shell_environment_policy.filters` sets {known:?} to something other than \"include\" while other filters include, so Codex would drop ai-stack's {name} after `set` and git would fail; remove that filter or set [lint] enabled = false"
                        ));
                    }
                    None => {
                        filters.insert(name, toml_edit::value("include"));
                        changed = true;
                    }
                }
            }
        }
    }
    let set = policy.entry("set").or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
    let set = set.as_table_like_mut().ok_or("`shell_environment_policy.set` is not a table")?;
    let existing: Vec<(String, Option<String>)> = set.iter().map(|(name, value)| (name.to_string(), value.as_str().map(String::from))).collect();
    let edits = env_edits(&existing, wanted)?;
    for edit in &edits {
        match edit {
            EnvEdit::Set(name, value) => {
                set.insert(name, toml_edit::value(value.as_str()));
            }
            EnvEdit::Remove(name) => {
                set.remove(name);
            }
        }
    }
    Ok(changed || !edits.is_empty())
}

fn git_version_warning(version: &str) -> Option<String> {
    let numbers: Vec<u32> = version.trim().strip_prefix("git version ")?.split(['.', ' ']).take(2).map(|part| part.parse().ok()).collect::<Option<_>>()?;
    let [major, minor] = numbers[..] else { return None };
    let (first_major, first_minor) = FIRST_GIT_WITH_CONFIG_HOOKS;
    ((major, minor) < FIRST_GIT_WITH_CONFIG_HOOKS).then(|| {
        format!("note: {} cannot run hooks from git config (that needs git {first_major}.{first_minor}), so the ai-stack lint commit hook will not run in agent shells until git is upgraded", version.trim())
    })
}

fn lint_hook_of(command: &str) -> Option<Harness> {
    let words = shell_words(command)?;
    let (program, mut rest) = words.split_first()?;
    while let [flag, value, tail @ ..] = rest
        && HOOK_FLAGS.contains(&flag.as_str())
        && !value.is_empty()
    {
        rest = tail;
    }
    let (harness, event) = match rest {
        [lint, hook, harness] if lint == "lint" && hook == "hook" => (harness, None),
        [lint, hook, harness, event] if lint == "lint" && hook == "hook" => (harness, Some(event)),
        _ => return None,
    };
    let ours = Path::new(program).file_name().is_some_and(|name| name == "ai-stack") && event.is_none_or(|event| event == "post-edit");
    ours.then(|| Harness::from_str(harness, false).ok()).flatten()
}

fn shell_words(command: &str) -> Option<Vec<String>> {
    let mut words = Vec::new();
    let mut word: Option<String> = None;
    let mut chars = command.chars();
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                let current = word.get_or_insert_with(String::new);
                loop {
                    match chars.next()? {
                        '\'' => break,
                        inner => current.push(inner),
                    }
                }
            }
            '"' => {
                let current = word.get_or_insert_with(String::new);
                loop {
                    match chars.next()? {
                        '"' => break,
                        '$' | '`' => return None,
                        '\\' => match chars.next()? {
                            escaped @ ('$' | '`' | '"' | '\\') => current.push(escaped),
                            '\n' => {}
                            other => current.extend(['\\', other]),
                        },
                        inner => current.push(inner),
                    }
                }
            }
            '\\' => word.get_or_insert_with(String::new).push(chars.next()?),
            c if c.is_whitespace() => words.extend(word.take()),
            c if "\"$`;&|<>(){}*?".contains(c) => return None,
            c => word.get_or_insert_with(String::new).push(c),
        }
    }
    words.extend(word);
    Some(words)
}

fn ensure_lint_hook(root: &mut Value, harness: Harness, exe: &Path, flags: &[String]) -> Result<bool, String> {
    let hooks = root.as_object_mut().ok_or("the file is not a JSON object")?.entry("hooks").or_insert_with(|| Value::Object(Default::default()));
    let hooks = hooks.as_object_mut().ok_or("`hooks` is not an object")?;
    let wanted = lint_command(exe, flags, harness);
    let groups = hooks.entry("PostToolUse").or_insert_with(|| Value::Array(Vec::new())).as_array_mut().ok_or("`hooks.PostToolUse` is not a list")?;
    let ours = |hook: &Value| hook["command"].as_str().and_then(lint_hook_of) == Some(harness);
    let Some(group) = groups.iter_mut().find(|group| group["hooks"].as_array().is_some_and(|list| list.iter().any(ours))) else {
        groups.push(serde_json::json!({"matcher": LINT_MATCHER, "hooks": [{"type": "command", "command": wanted}]}));
        return Ok(true);
    };
    let mut changed = false;
    let alone = group["hooks"].as_array().is_some_and(|list| list.len() == 1);
    if alone && group["matcher"] != LINT_MATCHER {
        group["matcher"] = Value::String(LINT_MATCHER.into());
        changed = true;
    }
    let hook = group["hooks"].as_array_mut().and_then(|list| list.iter_mut().find(|hook| ours(hook))).ok_or("the lint hook entry moved while it was read")?;
    if hook["command"] != wanted.as_str() {
        hook["command"] = Value::String(wanted);
        changed = true;
    }
    Ok(changed)
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

fn owned_hook(command: &str, roots: &[&Path]) -> bool {
    let command = command.strip_suffix(SED_SUFFIX).unwrap_or(command).trim();
    let Some((program, arg)) = command.split_once(' ') else { return false };
    let arg = arg.trim();
    let script = arg.strip_prefix('\'').and_then(|arg| arg.strip_suffix('\'')).unwrap_or(arg);
    if !Path::new(script).is_absolute() {
        return false;
    }
    let script = paths::resolve(Path::new(script));
    OLD_HOOKS.iter().any(|(owner, relative)| *owner == program && roots.iter().any(|root| script == paths::resolve(&root.join(relative))))
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

#[cfg(test)]
pub(crate) mod tests {
    use std::fs;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::path::{Path, PathBuf};

    use serde_json::{Value, json};

    use super::*;
    use crate::config;
    use crate::plugins::fake::FakeRunner;

    pub(crate) struct Fixture {
        _tmp: tempfile::TempDir,
        pub(crate) root: PathBuf,
        pub(crate) stack: PathBuf,
        pub(crate) home: PathBuf,
        pub(crate) cfg: Config,
        pub(crate) runner: FakeRunner,
    }

    impl Fixture {
        pub(crate) fn plan(&self) -> Plan {
            self.plan_with(Options::default())
        }
        pub(crate) fn plan_with(&self, opts: Options) -> Plan {
            super::plan(&self.cfg, opts, &self.runner).unwrap()
        }
        pub(crate) fn apply(&self, plan: &Plan) {
            crate::plan::apply(plan, &self.root.join("backups"), &self.runner).unwrap();
        }
        fn read(&self, relative: &str) -> String {
            fs::read_to_string(self.home.join(relative)).unwrap()
        }
    }

    pub(crate) const STACK_TOML: &str = "[groups.tools]\nglobal = true\nskills = [\"handoff\", \"feedback\"]\n\n[groups.games]\nskills = [\"game-mvp\"]\n";

    pub(crate) fn put(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    pub(crate) fn fixture() -> Fixture {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let stack = root.join("stack");
        let home = root.join("home");
        let sources = [("pstack", "plugins/pstack")];
        let claude = sources.map(|(name, dir)| json!({"name": name, "source": format!("./{dir}")}));
        let codex = sources.map(|(name, dir)| json!({"name": name, "source": {"source": "local", "path": format!("./{dir}")}}));
        put(&stack.join(".claude-plugin/marketplace.json"), &json!({"name": "jm", "plugins": claude}).to_string());
        put(&stack.join(".agents/plugins/marketplace.json"), &json!({"name": "jm", "plugins": codex}).to_string());
        for (name, dir) in sources {
            for manifest in [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"] {
                put(&stack.join(dir).join(manifest), &json!({"name": name, "version": "1.0.0"}).to_string());
            }
        }
        for skill in ["handoff", "feedback", "game-mvp"] {
            put(&stack.join("skills").join(skill).join("SKILL.md"), &format!("---\nname: {skill}\ndescription: The {skill} skill.\n---\n"));
        }
        put(&stack.join("stack.toml"), STACK_TOML);
        let mut cfg = config::test_config(config::default_config_text(), &home).unwrap();
        cfg.stack.path = stack.clone();
        cfg.stack.legacy_paths = vec![root.join("legacy")];
        cfg.exe = root.join("bin/ai-stack");
        let runner = FakeRunner::default();
        Fixture { _tmp: tmp, root, stack, home, cfg, runner }
    }

    #[test]
    fn unavailable_harness_is_skipped_before_files_plugins_and_clean() {
        for missing in Harness::ALL {
            for existing in [false, true] {
                let mut f = fixture();
                f.runner.missing.insert(missing);
                let hc = f.cfg.harnesses.iter().find(|hc| hc.harness == missing).unwrap().clone();
                let skills = hc.harness.skill_folder(&hc.home, &f.home);
                if existing {
                    put(&hc.home.join(hc.harness.instruction_file()), "<!-- ai-stack:broken:begin -->");
                    put(&hc.home.join("pstack-models.md"), "unmanaged");
                    put(&skills.join("stray/SKILL.md"), "leave alone");
                    put(&hc.home.join("agents/old.md"), render::MANAGED_MD);
                }
                let plan = f.plan_with(Options { clean: true, ..Options::default() });
                assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
                assert_eq!(plan.warnings.len(), 1);
                assert!(plan.render_text(&f.home).contains(&format!("skipping {}:", missing.name())));
                assert!(!plan.is_empty());
                assert!(plan.commands.iter().all(|cmd| cmd.harness != missing));
                assert!(plan.actions.iter().all(|action| !action.path().starts_with(&hc.home) && !action.path().starts_with(&skills)));
                f.apply(&plan);
                assert!(f.plan_with(Options { clean: true, ..Options::default() }).is_empty());
                if existing {
                    assert_eq!(fs::read_to_string(skills.join("stray/SKILL.md")).unwrap(), "leave alone");
                } else {
                    assert!(!hc.home.exists());
                }
            }
        }
    }

    #[test]
    fn both_missing_plan_nothing_even_with_clean() {
        let mut f = fixture();
        f.runner.missing.extend(Harness::ALL);
        put(&f.home.join(".agents/skills/stray/SKILL.md"), "leave alone");
        let plan = f.plan_with(Options { clean: true, ..Options::default() });
        assert!(plan.is_empty(), "{plan:?}");
        assert_eq!(plan.warnings.len(), 2);
        assert!(plan.render_text(&f.home).ends_with("No changes.\n"));
        f.apply(&plan);
        assert!(!f.home.join(".claude").exists());
        assert!(!f.home.join(".codex").exists());
    }

    #[test]
    fn arena_pool_without_another_provider_warns_for_that_harness_only() {
        let mut f = fixture();
        let judge_warnings = |plan: &Plan| plan.warnings.iter().filter(|w| w.contains(ARENA_JUDGE_ROW) && w.contains("skip its judge")).count();
        assert_eq!(judge_warnings(&f.plan()), 0);
        for pool in ["claude:opus@xhigh", "claude:opus@xhigh, inherit-parent", "auto"] {
            let rows = f.cfg.sheets.get_mut(&Harness::Claude).unwrap();
            rows.iter_mut().find(|(label, _)| label == ARENA_JUDGE_ROW).unwrap().1 = pool.to_string();
            let plan = f.plan();
            assert_eq!(judge_warnings(&plan), 1, "{pool}");
            let text = plan.render_text(&f.home);
            assert!(text.contains("Claude Code's") && text.contains("[sheet.claude]"), "{text}");
        }
    }

    #[test]
    fn explicitly_disabled_harness_has_no_skip_notice() {
        let mut f = fixture();
        f.cfg.harnesses.retain(|hc| hc.harness != Harness::Claude);
        f.runner.missing.insert(Harness::Claude);
        let plan = f.plan();
        assert!(plan.warnings.is_empty());
        assert!(plan.conflicts.is_empty());
        assert!(plan.commands.iter().all(|cmd| cmd.harness == Harness::Codex));
        assert!(plan.actions.iter().all(|action| !action.path().starts_with(f.home.join(".claude"))));
    }

    #[test]
    fn legacy_cleanup_alias_leaves_skipped_skill_links_alone() {
        use std::os::unix::fs::symlink;

        let mut f = fixture();
        f.runner.missing.insert(Harness::Claude);
        let claude_skills = f.home.join(".claude/skills");
        fs::create_dir_all(&claude_skills).unwrap();
        fs::create_dir_all(f.home.join(".codex")).unwrap();
        symlink(f.stack.join("skills/handoff"), claude_skills.join("handoff")).unwrap();
        symlink(&claude_skills, f.home.join(".codex/skills")).unwrap();
        for clean in [false, true] {
            let plan = f.plan_with(Options { clean, ..Options::default() });
            assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
            assert!(plan.actions.iter().all(|action| !action.path().starts_with(&claude_skills) && !action.path().starts_with(f.home.join(".codex/skills"))));
            f.apply(&plan);
            assert!(claude_skills.join("handoff").is_symlink());
        }
    }

    #[test]
    fn available_harness_keeps_a_shared_skill_folder() {
        use std::os::unix::fs::symlink;

        let mut f = fixture();
        f.runner.missing.insert(Harness::Claude);
        let shared = f.home.join(".agents/skills");
        put(&shared.join("stray/SKILL.md"), "stray");
        fs::create_dir_all(f.home.join(".claude")).unwrap();
        symlink(&shared, f.home.join(".claude/skills")).unwrap();
        let plan = f.plan_with(Options { clean: true, ..Options::default() });
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        f.apply(&plan);
        assert!(!shared.join("stray").exists());
        assert!(shared.join("handoff").is_symlink());
        assert!(!f.home.join(".claude/CLAUDE.md").exists());
    }

    #[test]
    fn nested_skipped_skills_preserve_entries_and_keep_codex_links_active() {
        for layout in ["nested", "shared-alias", "outgoing-alias", "wanted"] {
            let mut f = fixture();
            f.runner.missing.insert(Harness::Claude);
            let shared = f.home.join(".agents/skills");
            let claude = f.home.join(".claude/skills");
            fs::create_dir_all(claude.parent().unwrap()).unwrap();
            fs::create_dir_all(&shared).unwrap();
            let target = shared.join(if layout == "wanted" { "handoff" } else { "claude" });
            if layout == "shared-alias" {
                symlink(".", &target).unwrap();
            } else {
                put(&target.join("mine/SKILL.md"), "leave alone");
            }
            symlink(&target, &claude).unwrap();
            if layout == "outgoing-alias" {
                symlink(&target, shared.join("outgoing")).unwrap();
            }
            put(&shared.join("stray/SKILL.md"), "clean me");
            let plan = f.plan_with(Options { clean: true, force: true, ..Options::default() });
            assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
            assert!(plan.actions.iter().any(|action| matches!(action, Action::Link { path, .. } if *path == shared.join("feedback"))), "{}", plan.render_text(&f.home));
            assert!(!plan.stray.iter().any(|path| path == &target || path == &shared.join("outgoing")));
            assert!(plan.actions.iter().all(|action| !action.path().starts_with(&target) && action.path() != shared.join("outgoing")));
            f.apply(&plan);
            assert!(!shared.join("stray").exists());
            assert!(shared.join("feedback").is_symlink());
            assert!(claude.exists());
            if layout != "shared-alias" {
                assert_eq!(fs::read_to_string(claude.join("mine/SKILL.md")).unwrap(), "leave alone");
            }
            assert!(f.plan_with(Options { clean: true, force: true, ..Options::default() }).is_empty());
        }
    }

    #[test]
    fn absent_skipped_home_reserves_a_wanted_link_name() {
        for name in ["handoff", "HANDOFF"] {
            let mut f = fixture();
            f.runner.missing.insert(Harness::Claude);
            let skills = f.home.join(".agents/skills");
            put(&skills.join("CaseProbe/SKILL.md"), "probe");
            if name == "HANDOFF" && !skills.join("caseprobe").exists() { continue; }
            let claude = skills.join(name);
            f.cfg.harnesses[0].home = claude.clone();
            let plan = f.plan_with(Options { clean: true, force: true, ..Options::default() });
            assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
            assert!(plan.actions.iter().all(|action| action.path() != skills.join("handoff")));
            f.apply(&plan);
            assert!(!claude.exists());
            assert!(skills.join("feedback").is_symlink());
        }
    }

    #[test]
    fn clean_cannot_move_a_skipped_home_through_an_ancestor_or_alias() {
        use std::os::unix::fs::symlink;

        for layout in ["directory", "symlink", "chain", "case"] {
            let mut f = fixture();
            if layout == "case" {
                fs::create_dir_all(f.home.join("Harnesses")).unwrap();
                if !f.home.join("harnesses").is_dir() { continue; }
            }
            let claude = f.home.join(if layout == "chain" { "other/claude" } else { "harnesses/agents/claude" });
            f.cfg.harnesses[0].home = claude.clone();
            f.cfg.harnesses[1].home = f.home.join("harnesses");
            f.runner.missing.insert(Harness::Claude);
            let external = f.root.join("external-skills");
            put(&external.join("stray/SKILL.md"), "leave alone");
            if layout != "directory" {
                let target = f.stack.join("skipped-home");
                fs::create_dir_all(&target).unwrap();
                fs::create_dir_all(claude.parent().unwrap()).unwrap();
                if layout == "chain" {
                    let bridge = f.home.join("harnesses/agents/bridge");
                    fs::create_dir_all(bridge.parent().unwrap()).unwrap();
                    fs::create_dir_all(target.join("profile")).unwrap();
                    symlink(target, &bridge).unwrap();
                    symlink(bridge.join("profile"), &claude).unwrap();
                } else {
                    symlink(target, &claude).unwrap();
                }
            } else {
                fs::create_dir_all(&claude).unwrap();
            }
            symlink(&external, claude.join("skills")).unwrap();
            f.cfg.clean.skill_roots.extend([f.home.join("harnesses"), f.home.join("harnesses/agents"), external.clone()]);
            put(&f.home.join(".claude/skills/stray/SKILL.md"), "leave alone");
            let plan = f.plan_with(Options { clean: true, ..Options::default() });
            assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
            assert!(plan.actions.iter().all(|action| !action.path().starts_with(&claude) && !action.path().starts_with(&external) && !action.path().starts_with(f.home.join(".claude"))));
            f.apply(&plan);
            assert!(claude.join("skills/stray/SKILL.md").exists());
        }
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
            format!("{claude_env} claude plugin install pstack@jm"),
            format!("{codex_env} codex plugin marketplace add {stack}"),
            format!("{codex_env} codex plugin add pstack@jm"),
        ]);
        assert!(f.runner.ran.borrow().is_empty(), "planning must not run install commands");
        f.apply(&first);
        assert_eq!(*f.runner.ran.borrow(), commands);

        let header = format!("{}\n", render::MANAGED_MD);
        let preamble = "Provider-qualified per-role choices. Read the installed pstack provider-dispatch reference before dispatching a configured role. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.\n\n";
        let claude_sheet = format!("{header}# pstack model sheet (Claude Code)\n\n{preamble}{}", concat!(
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
            "arena runners: claude:opus@high, codex:gpt-6.2-sol@high, cursor:grok-4.7@high, agy:gemini-4-argon@high\n",
            "arena cross-judge pool: codex:gpt-6.2-astra@xhigh, claude:opus@xhigh\n",
            "swarm workers: claude:opus@medium\n",
            "architect runners: claude:opus@high, claude:opus@medium\n",
            "interrogate reviewers: claude:opus@xhigh, codex:gpt-6.2-astra@xhigh\n",
        ));
        let codex_sheet = format!("{header}# pstack model sheet (Codex)\n\n{preamble}{}", concat!(
            "feature, refactoring: codex:gpt-6.2-sol@medium\n",
            "bug-fix: codex:gpt-6.2-sol@medium\n",
            "perf-issue: codex:gpt-6.2-sol@medium\n",
            "hillclimb: codex:gpt-6.2-sol@medium\n",
            "judgment and prose: codex:gpt-6.2-astra@xhigh\n",
            "hardest tasks: codex:gpt-6.2-astra@xhigh\n",
            "how explorer: codex:gpt-6.1-terra@xhigh\n",
            "how explainer: codex:gpt-6.2-sol@medium\n",
            "why investigators, synthesizer: inherit-parent\n",
            "reflect tooling, judgment, divergent, synthesizer: inherit-parent\n",
            "arena runners: codex:gpt-6.2-sol@high, claude:opus@high, cursor:grok-4.7@high, agy:gemini-4-argon@high\n",
            "arena cross-judge pool: claude:opus@xhigh, codex:gpt-6.2-astra@xhigh\n",
            "swarm workers: codex:gpt-6.2-sol@medium\n",
            "architect runners: codex:gpt-6.2-astra@xhigh, codex:gpt-6.2-sol@medium\n",
            "interrogate reviewers: codex:gpt-6.2-astra@xhigh, claude:opus@xhigh\n",
        ));
        assert_eq!(f.read(".claude/pstack-models.md"), claude_sheet);
        assert_eq!(f.read(".codex/pstack-models.md"), codex_sheet);

        let claude = f.read(".claude/CLAUDE.md");
        let routing = render::routing(&f.cfg, Harness::Claude, &f.home.join(".claude/pstack-models.md"));
        assert_eq!(claude, format!(
            "<!-- ai-stack:routing:begin -->\n{routing}\n<!-- ai-stack:routing:end -->\n\n<!-- ai-stack:pstack-models:begin -->\n@{}/.claude/pstack-models.md\n<!-- ai-stack:pstack-models:end -->\n",
            f.home.display()
        ));
        let codex = f.read(".codex/AGENTS.md");
        assert!(!codex.contains("anthropic-guidance"), "{codex}");
        assert!(codex.ends_with(&format!("{}\n{codex_sheet}{}\n", blocks::PSTACK_BEGIN, blocks::PSTACK_END)), "{codex}");

        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));

        for manifest in [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"] {
            put(&f.stack.join("plugins/pstack").join(manifest), &json!({"name": "pstack", "version": "1.1.0"}).to_string());
        }
        f.runner.claude.borrow_mut().disabled.insert("pstack@jm".into());
        let bumped = f.plan();
        assert_eq!(bumped.commands.iter().map(ToString::to_string).collect::<Vec<_>>(), [
            format!("{claude_env} claude plugin update pstack@jm --scope user"),
            format!("{codex_env} codex plugin add pstack@jm"),
        ]);
        f.apply(&bumped);
        assert!(f.runner.claude.borrow().disabled.contains("pstack@jm"));
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));

        f.runner.claude.borrow_mut().marketplaces.insert("jm".into(), "/elsewhere".into());
        let conflicts = f.plan().conflicts;
        assert!(conflicts.iter().any(|c| c.contains("marketplace `jm` comes from directory /elsewhere")), "{conflicts:?}");
    }

    #[test]
    fn migration_removes_old_links_blocks_hooks_and_agent_files_but_keeps_user_content() {
        let f = fixture();
        let guidance = include_str!("../../instructions/claude.md").trim();
        put(&f.stack.join("instructions/claude.md"), guidance);
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
            "<!-- ai-stack:routing:begin -->\nold routing\n<!-- ai-stack:routing:end -->\n\n",
            "<!-- ai-stack:pstack-models:begin -->\n@/old/sheet.md\n<!-- ai-stack:pstack-models:end -->\n\n",
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
        assert!(claude.starts_with("# My notes\n\nKeep this.\n\n<!-- ai-stack:routing:begin -->"), "{claude}");
        assert_eq!(blocks::block_names(&claude), ["routing", "pstack-models", "instructions"]);
        assert!(claude.ends_with(&format!("<!-- ai-stack:instructions:begin -->\n{guidance}\n<!-- ai-stack:instructions:end -->\n")));
        assert!(!f.read(".codex/AGENTS.md").contains(guidance));
        assert!(!claude.contains("anthropic-guidance"));
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
        symlink(f.stack.join("plugins/pstack/skills/how"), claude.join("how")).unwrap();
        for id in ["github@claude-plugins-official", "expo@claude-plugins-official", "pdf-viewer@synced"] {
            f.runner.claude.borrow_mut().installed.insert(id.into(), "1".into());
        }
        for id in ["browser@openai-bundled", "old@market"] {
            f.runner.codex.borrow_mut().installed.insert(id.into(), "1".into());
        }

        let strays = ["~/.agents/skills/notes.txt", "~/.claude/skills/gone", "~/.claude/skills/linked", "~/.claude/skills/old-skill", "~/.codex/skills/codex-only"];
        let off = f.plan();
        assert_eq!(off.clean_count(), 0);
        assert!(!off.actions.iter().any(|a| matches!(a, Action::MoveToBackup { .. })));
        assert_eq!(off.stray(&f.home).skill_names, strays);

        let clean = |f: &Fixture| f.plan_with(Options { clean: true, ..Options::default() });
        let plan = clean(&f);
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        let moved: Vec<PathBuf> = plan.actions.iter().filter(|a| matches!(a, Action::MoveToBackup { .. })).map(|a| a.path().to_path_buf()).collect();
        assert_eq!(moved, [claude.join("gone"), claude.join("linked"), claude.join("old-skill"), agents.join("notes.txt"), codex.join("codex-only")]);
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
            "skill_names": strays,
            "plugin_ids": ["expo@claude-plugins-official", "pdf-viewer@synced", "old@market"],
        }).to_string());
        assert!(stray.text().starts_with("skills: 5  plugins: 3\n  ~/.agents/skills/notes.txt\n"), "{}", stray.text());

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
        assert_eq!(installed, ["github@claude-plugins-official", "pdf-viewer@synced", "pstack@jm"]);

        let again = clean(&f);
        assert!(again.is_empty(), "{}", again.render_text(&f.home));
    }

    #[test]
    fn a_jm_plugin_the_checkout_no_longer_lists_is_removed_by_a_normal_install() {
        let f = fixture();
        let git = |args: &[&str]| {
            let config = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];
            let output = std::process::Command::new("git").args(config).args(args).current_dir(&f.stack).output().unwrap();
            assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        let manifests = [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"];
        let current: Vec<String> = manifests.iter().map(|path| fs::read_to_string(f.stack.join(path)).unwrap()).collect();
        for (path, text) in manifests.iter().zip(&current) {
            put(&f.stack.join(path), &text.replace("\"name\":\"pstack\"", "\"name\":\"jm-games\"},{\"name\":\"pstack\""));
        }
        let manifest_text: Vec<String> = manifests.iter().map(|path| fs::read_to_string(f.stack.join(path)).unwrap()).collect();
        for (path, text) in manifests.iter().zip(&manifest_text) {
            put(&f.stack.join(path), &text.replace("{\"name\":\"jm-games\"}", "{\"name\":\"jm-games\",\"source\":\"./plugins/jm-games\"}").replace("{\"name\":\"jm-games\",\"source\":\"./plugins/jm-games\"},{\"name\":\"pstack\",\"source\":{", "{\"name\":\"jm-games\",\"source\":{\"source\":\"local\",\"path\":\"./plugins/jm-games\"}},{\"name\":\"pstack\",\"source\":{"));
        }
        put(&f.stack.join("plugins/jm-games/skills/art/SKILL.md"), "---\nname: art\n---\n");
        git(&["init", "-q"]);
        git(&["add", "-A"]);
        git(&["commit", "-qm", "with jm-games"]);
        let listed = git(&["rev-parse", "HEAD"]);
        fs::remove_dir_all(f.stack.join("plugins/jm-games/skills")).unwrap();
        put(&f.stack.join("plugins/jm-games/README.md"), "moved\n");
        git(&["add", "-A"]);
        git(&["commit", "-qm", "move the jm-games skills out"]);
        for (path, text) in manifests.iter().zip(&current) {
            put(&f.stack.join(path), text);
        }
        git(&["commit", "-qam", "retire jm-games"]);

        fs::create_dir_all(f.home.join(".claude")).unwrap();
        fs::create_dir_all(f.home.join(".codex")).unwrap();
        for state in [&f.runner.claude, &f.runner.codex] {
            let mut state = state.borrow_mut();
            state.marketplaces.insert("jm".into(), f.stack.display().to_string());
            for id in ["pstack@jm", "jm-games@jm", "other@market"] {
                state.installed.insert(id.into(), "1.0.0".into());
            }
        }
        let plan = f.plan();
        let commands: Vec<String> = plan.commands.iter().map(ToString::to_string).collect();
        let (claude_env, codex_env) = (format!("CLAUDE_CONFIG_DIR={}/.claude", f.home.display()), format!("CODEX_HOME={}/.codex", f.home.display()));
        assert_eq!(commands, [format!("{claude_env} claude plugin uninstall jm-games@jm"), format!("{codex_env} codex plugin remove jm-games@jm")]);
        assert_eq!(plan.clean_count(), 0, "a jm plugin is the stack's, never stray");
        assert_eq!(plan.stray(&f.home), crate::plan::Stray::default());
        let report = crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).unwrap();
        let manifest: Value = serde_json::from_str(&fs::read_to_string(report.manifest.unwrap()).unwrap()).unwrap();
        for (entry, path) in manifest["plugins"].as_array().unwrap().iter().zip(manifests) {
            assert_eq!(entry["reinstall"], Value::Null);
            assert_eq!(entry["note"], format!("jm-games was retired from the jm marketplace. Commit {listed} of the stack {} is the last that lists it in {path} with its skills; restore it from there.", f.stack.display()));
        }
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));
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
    fn writes_through_aliases_into_skipped_routes_conflict() {
        for missing in Harness::ALL {
            for file in ["instructions", "sheet", "home", "settings"] {
                if file == "settings" && missing == Harness::Claude { continue; }
                let mut f = fixture();
                f.runner.missing.insert(missing);
                let skipped = f.cfg.harnesses.iter().find(|hc| hc.harness == missing).unwrap().clone();
                let active = f.cfg.harnesses.iter().find(|hc| hc.harness != missing).unwrap().clone();
                fs::create_dir_all(&skipped.home).unwrap();
                let (source, target, original) = match file {
                    "instructions" => (active.home.join(active.harness.instruction_file()), skipped.home.join(skipped.harness.instruction_file()), "# Shared instructions\n".to_string()),
                    "sheet" => (active.home.join("pstack-models.md"), skipped.home.join("pstack-models.md"), format!("{}\nold sheet\n", render::MANAGED_MD)),
                    "settings" => (active.home.join("settings.json"), skipped.home.join("settings.json"), "{}\n".to_string()),
                    "home" => (active.home.clone(), skipped.home.clone(), String::new()),
                    _ => unreachable!(),
                };
                fs::create_dir_all(source.parent().unwrap()).unwrap();
                if file != "home" { put(&target, &original); }
                symlink(&target, &source).unwrap();
                let plan = f.plan_with(Options { force: true, ..Options::default() });
                assert!(plan.conflicts.iter().any(|conflict| conflict.contains(&source.display().to_string()) && conflict.contains(&target.display().to_string()) && conflict.contains("skipped harness")), "{file}: {:?}", plan.conflicts);
                assert!(plan.actions.iter().filter(|action| matches!(action, Action::Write { .. } | Action::ReplaceWithFile { .. })).all(|action| !paths::resolve(action.path()).starts_with(&skipped.home)));
                assert!(crate::plan::apply(&plan, &f.root.join("backups"), &f.runner).is_err());
                assert_eq!(fs::read_link(&source).unwrap(), target);
                if file != "home" { assert_eq!(fs::read_to_string(&target).unwrap(), original); }
            }
        }
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

    #[test]
    fn sheet_imports_and_old_hooks_match_through_another_spelling_of_the_same_path() {
        let f = fixture();
        symlink(&f.root, f.root.join("alias")).unwrap();
        let alias = f.root.join("alias");
        put(&f.home.join(".claude/CLAUDE.md"), &format!("# Mine\n@{}/home/.claude/pstack-models.md\n", alias.display()));
        let hook = format!("bash {}/stack/plugins/pstack/hooks/session-start", alias.display());
        put(&f.home.join(".claude/settings.json"), &json!({"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": hook}]}]}}).to_string());
        f.apply(&f.plan());
        let claude = f.read(".claude/CLAUDE.md");
        assert!(!claude.contains(&alias.display().to_string()), "{claude}");
        let settings: Value = serde_json::from_str(&f.read(".claude/settings.json")).unwrap();
        assert!(settings["hooks"].get("SessionStart").is_none(), "{settings}");
    }

    #[test]
    fn lint_hook_and_agent_git_env_are_merged_in_place_and_foreign_git_config_is_a_conflict() {
        let mut f = fixture();
        let foreign = |command: &str| json!({"matcher": "apply_patch", "hooks": [{"type": "command", "command": command, "timeout": 30}]});
        let v1 = json!({"matcher": "apply_patch", "hooks": [{"type": "command", "command": "\"/old place/ai-stack\" lint hook codex post-edit"}]});
        let v1_stop = json!({"hooks": [{"type": "command", "command": "\"/old place/ai-stack\" lint hook codex stop"}]});
        put(&f.home.join(".codex/hooks.json"), &json!({"hooks": {"PostToolUse": [foreign("/usr/local/bin/format-hook"), v1], "Stop": [v1_stop.clone()]}}).to_string());
        put(&f.home.join(".codex/config.toml"), "model = \"o\" # keep this comment\n\n[shell_environment_policy]\ninclude_only = [\"PATH\", \"HOME\"]\nset = { EDITOR = \"vi\" }\n");
        put(&f.home.join(".claude/settings.json"), &json!({"env": {"TMPDIR": "/t"}, "hooks": {}}).to_string());
        f.cfg.exe_flags = vec!["--config".into(), "/cfg dir/selected.toml".into()];
        f.apply(&f.plan());

        let exe = f.cfg.exe.display().to_string();
        let codex: Value = serde_json::from_str(&f.read(".codex/hooks.json")).unwrap();
        assert_eq!(codex["hooks"]["PostToolUse"][0], foreign("/usr/local/bin/format-hook"));
        assert_eq!(codex["hooks"]["PostToolUse"][1], json!({"matcher": "Edit|Write|Bash", "hooks": [{"type": "command", "command": format!("{exe} --config '/cfg dir/selected.toml' lint hook codex")}]}), "a v1 entry is repointed where it stands");
        assert_eq!(codex["hooks"]["Stop"], json!([v1_stop]), "install never removes a hook entry");
        let claude: Value = serde_json::from_str(&f.read(".claude/settings.json")).unwrap();
        assert_eq!(claude["hooks"]["PostToolUse"][0]["matcher"], "Edit|Write|Bash");
        assert_eq!(claude["hooks"].as_object().unwrap().len(), 1, "only PostToolUse is registered");
        let pre = format!("[ -x {exe} ] || exit 0; {exe} --config '/cfg dir/selected.toml' lint pre-commit; [ $? -ne 3 ]");
        assert_eq!(claude["env"]["TMPDIR"], "/t");
        assert_eq!(claude["env"]["GIT_CONFIG_COUNT"], "4");
        assert_eq!((claude["env"]["GIT_CONFIG_KEY_1"].as_str(), claude["env"]["GIT_CONFIG_VALUE_1"].as_str()), (Some("hook.ai-stack-lint.command"), Some(pre.as_str())));
        assert_eq!(claude["env"]["GIT_CONFIG_VALUE_2"], "post-commit");
        assert_eq!(claude["env"]["AI_STACK_HARNESS"], "claude");
        let config: toml::Table = toml::from_str(&f.read(".codex/config.toml")).unwrap();
        let policy = &config["shell_environment_policy"];
        assert_eq!(policy["set"]["EDITOR"].as_str(), Some("vi"));
        assert_eq!(policy["set"]["AI_STACK_HARNESS"].as_str(), Some("codex"));
        assert_eq!(policy["set"]["GIT_CONFIG_VALUE_1"].as_str(), Some(pre.as_str()));
        let include: Vec<&str> = policy["include_only"].as_array().unwrap().iter().filter_map(|name| name.as_str()).collect();
        assert_eq!(include, ["PATH", "HOME", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_*", "GIT_CONFIG_VALUE_*", "AI_STACK_HARNESS"]);
        assert!(f.read(".codex/config.toml").starts_with("model = \"o\" # keep this comment\n"));
        assert!(f.plan().is_empty(), "{}", f.plan().render_text(&f.home));

        f.cfg.exe = f.root.join("new bin/ai-stack");
        f.cfg.exe_flags.clear();
        f.apply(&f.plan());
        let moved: Value = serde_json::from_str(&f.read(".claude/settings.json")).unwrap();
        assert_eq!(moved["env"]["GIT_CONFIG_VALUE_3"], format!("[ -x '{0}' ] || exit 0; exec '{0}' lint post-commit", f.cfg.exe.display()));
        assert_eq!(moved["env"]["GIT_CONFIG_VALUE_1"], format!("[ -x '{0}' ] || exit 0; '{0}' lint pre-commit; [ $? -ne 3 ]", f.cfg.exe.display()));
        assert_eq!(moved["hooks"]["PostToolUse"].as_array().unwrap().len(), 1);
        assert!(f.plan().is_empty());

        let mut claude = moved;
        claude["env"]["GIT_CONFIG_KEY_7"] = json!("user.name");
        put(&f.home.join(".claude/settings.json"), &claude.to_string());
        assert!(f.plan().conflicts.iter().any(|conflict| conflict.contains("GIT_CONFIG_KEY_7")), "{:?}", f.plan().conflicts);
        put(&f.home.join(".claude/settings.json"), &json!({"env": {"GIT_CONFIG_COUNT": "1"}}).to_string());
        assert!(f.plan().conflicts.iter().any(|conflict| conflict.contains("GIT_CONFIG_COUNT")));
        put(&f.home.join(".claude/settings.json"), "{}");
        put(&f.home.join(".codex/config.toml"), "[shell_environment_policy.set]\nGIT_CONFIG_COUNT = \"2\"\nGIT_CONFIG_KEY_0 = \"core.editor\"\nGIT_CONFIG_VALUE_0 = \"vi\"\n");
        let plan = f.plan();
        assert!(plan.conflicts.iter().any(|conflict| conflict.contains("config.toml") && conflict.contains("GIT_CONFIG_KEY_0")), "{:?}", plan.conflicts);
        for foreign in ["hook.ai-stack-lint-format.event", "hook.ai-stack-lint.format.event"] {
            put(&f.home.join(".claude/settings.json"), &json!({"env": {"GIT_CONFIG_COUNT": "2", "GIT_CONFIG_KEY_0": foreign, "GIT_CONFIG_VALUE_0": "pre-commit"}}).to_string());
            assert!(f.plan().conflicts.iter().any(|conflict| conflict.contains("settings.json") && conflict.contains("GIT_CONFIG_KEY_0")), "{foreign} only starts like ours, so it is foreign");
        }
        put(&f.home.join(".claude/settings.json"), "{}");
        put(&f.home.join(".codex/config.toml"), "[shell_environment_policy.filters]\nHOME = \"include\"\n\"GIT_CONFIG_KEY_*\" = \"exclude\"\n");
        let plan = f.plan();
        assert!(plan.conflicts.iter().any(|conflict| conflict.contains("config.toml") && conflict.contains("GIT_CONFIG_KEY_*")), "a filter that would drop an injected name after set is a conflict: {:?}", plan.conflicts);
        let policy_after = |f: &Fixture, before: &str| -> toml::Value {
            put(&f.home.join(".codex/config.toml"), before);
            f.apply(&f.plan());
            toml::from_str::<toml::Table>(&f.read(".codex/config.toml")).unwrap()["shell_environment_policy"].clone()
        };
        let unrestricted = policy_after(&f, "[shell_environment_policy]\ninclude_only = []\n");
        assert_eq!(unrestricted["include_only"].as_array().unwrap().len(), 0, "an empty include_only keeps every variable, so it stays empty");
        let filters = policy_after(&f, "[shell_environment_policy.filters]\nPATH = \"include\"\ngit_config_count = \"include\"\n");
        let filters = filters["filters"].as_table().unwrap();
        let mut names: Vec<&str> = filters.keys().map(String::as_str).collect();
        names.sort_unstable();
        assert_eq!(names, ["AI_STACK_HARNESS", "GIT_CONFIG_KEY_*", "GIT_CONFIG_VALUE_*", "PATH", "git_config_count"], "names already listed in any case are not added again");
        assert!(filters.values().all(|action| action.as_str() == Some("include")));
        let excludes = policy_after(&f, "[shell_environment_policy.filters]\n\"AWS_*\" = \"exclude\"\n");
        assert_eq!(excludes["filters"].as_table().unwrap().len(), 1, "filters with no include entry restrict nothing");
        assert!(git_version_warning("git version 2.53.1\n").is_some_and(|warning| warning.contains("2.54")));
        assert_eq!(git_version_warning("git version 2.54.0"), None);
    }
}
