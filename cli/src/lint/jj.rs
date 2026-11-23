use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::LazyLock;

use anyhow::{Context as _, Result, bail};
use regex::Regex;
use serde_json::{Value, json};

use super::commit::{Checkout, Git, HIGH_RATE, OnDisk, Source, Target, plural, refusal, skip_recorded, sorted_names};
use super::events::{Event, Kind, Log, now};
use super::fix::{self, Run};
use super::provenance::Provenance;
use super::repo::{Attributes, Repo};
use super::scan::{Engine, language_of, sort};
use super::{Finding, Settings, Severity, files_named};

const RANGE: &str = "latest(mutable() & ::@ & ~empty(), 50)";
const TOOL: &str = "ai-stack-lint";
const SHOWN: usize = 5;
const COMMITTING: [&str; 5] = ["commit", "describe", "new", "squash", "split"];
const GLOBAL_FLAGS_WITH_VALUES: [&str; 7] = ["-R", "--repository", "--config", "--config-file", "--at-op", "--at-operation", "--color"];

type Plan = BTreeMap<String, Vec<Run>>;

pub struct Workspace {
    root: PathBuf,
    key: PathBuf,
}

impl Workspace {
    pub fn find(dir: &Path) -> Option<Workspace> {
        let root = dir.ancestors().find(|ancestor| ancestor.join(".jj").is_dir())?;
        let marker = root.join(".jj/repo");
        let repo = match std::fs::read_to_string(&marker) {
            Ok(pointer) => root.join(".jj").join(pointer.trim()),
            Err(_) => marker,
        };
        let repo = crate::paths::resolve(&repo);
        let key = repo.parent().and_then(Path::parent).map_or_else(|| crate::paths::resolve(root), Path::to_path_buf);
        Some(Workspace { root: crate::paths::resolve(root), key })
    }

    fn repo(&self) -> Repo {
        Repo { root: self.root.clone(), project_key: self.key.clone() }
    }

    fn jj(&self, args: &[&str]) -> Result<String> {
        let out = Command::new("jj")
            .arg("-R")
            .arg(&self.root)
            .args(["--no-pager", "--color=never", "--quiet"])
            .args(args)
            .stdin(Stdio::null())
            .output()
            .context("cannot run jj")?;
        if !out.status.success() {
            bail!("jj {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn commits(&self, revset: &str) -> Result<Vec<String>> {
        Ok(self.jj(&["log", "--no-graph", "-r", revset, "-T", "commit_id ++ \"\\n\""])?.lines().map(str::to_string).collect())
    }

    fn user_tools(&self) -> Result<Vec<String>> {
        let names = self.jj(&["config", "list", "-T", "name ++ \"\\n\"", "fix.tools"]).unwrap_or_default();
        let mut tools: Vec<String> = names
            .lines()
            .filter_map(|name| toml::from_str::<toml::Table>(&format!("{name} = 0")).ok())
            .filter_map(|table| table.get("fix")?.get("tools")?.as_table()?.keys().next().cloned())
            .collect();
        tools.sort();
        tools.dedup();
        Ok(tools)
    }
}

pub fn locate(dir: &Path) -> Option<Repo> {
    let git = Repo::discover(dir);
    match Workspace::find(dir) {
        Some(workspace) if git.as_ref().is_none_or(|git| !git.root.starts_with(&workspace.root)) => Some(workspace.repo()),
        _ => git,
    }
}

fn words(command: &str) -> Vec<&str> {
    command.split(|char: char| char.is_whitespace() || ";&|()".contains(char)).filter(|word| !word.is_empty()).collect()
}

fn subcommands(command: &str) -> Vec<(&str, Option<&str>)> {
    if !command.contains("jj") {
        return Vec::new();
    }
    let words = words(command);
    let mut found = Vec::new();
    for (at, word) in words.iter().enumerate() {
        if Path::new(word).file_name().is_none_or(|name| name != "jj") {
            continue;
        }
        let mut rest = words[at + 1..].iter().copied();
        let mut positional = Vec::new();
        while let Some(word) = rest.next() {
            if GLOBAL_FLAGS_WITH_VALUES.contains(&word) {
                rest.next();
            } else if !word.starts_with('-') {
                positional.push(word);
                if positional.len() == 2 {
                    break;
                }
            }
        }
        if let Some(&first) = positional.first() {
            found.push((first, positional.get(1).copied()));
        }
    }
    found
}

pub fn is_commit(command: &str) -> bool {
    subcommands(command).iter().any(|(name, _)| COMMITTING.contains(name))
}

pub fn is_push(command: &str) -> bool {
    subcommands(command).contains(&("git", Some("push")))
}

fn skip_reason(command: &str) -> Option<String> {
    static ASSIGNMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?:^|[\s;&|(])AI_STACK_LINT_SKIP=(?:"([^"]*)"|'([^']*)'|([^\s;&|]*))"#).unwrap());
    let found = ASSIGNMENT.captures(command)?;
    Some((1..=3).find_map(|group| found.get(group)).map_or("", |value| value.as_str()).trim().to_string())
}

struct Report {
    removed: usize,
    files: Vec<String>,
    left: Vec<Finding>,
    head: String,
}

fn fix_range(settings: &Settings, workspace: &Workspace, state_dir: &Path) -> Result<Option<Report>> {
    let repo = workspace.repo();
    if !settings.enabled || !settings.policy(Some(&repo)).enabled() {
        return Ok(None);
    }
    let roots = workspace.commits(&format!("roots({RANGE})"))?;
    if roots.is_empty() {
        return Ok(None);
    }
    let store = crate::paths::resolve(Path::new(workspace.jj(&["git", "root"])?.trim()));
    let checkout = Checkout { git: Git::of_store(workspace.root.clone(), store.clone()), repo };
    let base = match &workspace.commits(&format!("roots({RANGE})-"))?[..] {
        [one] => one.clone(),
        _ => match &workspace.commits(&format!("fork_point(roots({RANGE})-)"))?[..] {
            [one] => one.clone(),
            _ => bail!("the commits to check have no single base"),
        },
    };
    let base = if base.bytes().all(|byte| byte == b'0') { checkout.git.empty_tree()? } else { base };
    let rules = settings.rules()?;
    let provenance = Provenance::new(state_dir, now());
    let mut head = workspace.commits("@")?.into_iter().next().context("jj printed no working-copy commit")?;
    let engine = |commit: &str| Engine {
        settings,
        rules: &rules,
        scope: None,
        display: &workspace.root,
        attributes: Attributes::Tree { git_dir: store.clone(), commit: commit.to_string() },
        repo: Some(&checkout.repo),
    };

    let (plan, removed, files) = {
        let staged = checkout.staged(&base, &Target::Commit(&head))?;
        let fixable: Vec<Finding> = engine(&head).lint(&checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error && finding.fix.is_some()).collect();
        let source = Source { base: &base, target: Target::Commit(&head), attributes: Attributes::Tree { git_dir: store.clone(), commit: head.clone() }, on_disk: OnDisk::Links };
        let deletions = checkout.deletions(&staged, &fixable.iter().collect::<Vec<_>>(), &source, &provenance)?;
        let mut plan = Plan::new();
        let mut removed = 0;
        let mut files = Vec::new();
        for deletion in &deletions {
            let (Some(path), Some(language)) = (deletion.file.rel.to_str(), language_of(&deletion.file.rel)) else { continue };
            let everywhere = fix::runs(language, &deletion.file.source);
            let count = |runs: &[Run], run: &Run| runs.iter().filter(|other| *other == run).count();
            let unique: Vec<Run> = deletion.fixed.runs.iter().filter(|run| count(&everywhere, run) == count(&deletion.fixed.runs, run)).cloned().collect();
            if unique.is_empty() {
                continue;
            }
            removed += unique.iter().map(Vec::len).sum::<usize>();
            files.push(checkout.display(&deletion.file.rel));
            plan.insert(path.to_string(), unique);
        }
        (plan, removed, files)
    };
    if !plan.is_empty() {
        apply(workspace, state_dir, &roots, &plan)?;
        head = workspace.commits("@")?.into_iter().next().context("jj printed no working-copy commit")?;
    }

    let staged = checkout.staged(&base, &Target::Commit(&head))?;
    let mut left: Vec<Finding> = engine(&head).lint(&checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error && finding.fix.is_none()).collect();
    sort(&mut left);
    Ok(Some(Report { removed, files, left, head }))
}

fn apply(workspace: &Workspace, state_dir: &Path, roots: &[String], plan: &Plan) -> Result<()> {
    std::fs::create_dir_all(state_dir).with_context(|| format!("creating {}", state_dir.display()))?;
    let dir = tempfile::Builder::new().prefix("jj-fix-").tempdir_in(state_dir)?;
    let plan_file = dir.path().join("plan.json");
    std::fs::write(&plan_file, serde_json::to_vec(plan)?)?;
    let exe = std::env::current_exe().context("cannot find the ai-stack binary")?;
    let mut tools = toml::Table::new();
    for name in workspace.user_tools()? {
        tools.insert(name, toml::Value::Table(toml::Table::from_iter([("enabled".to_string(), toml::Value::Boolean(false))])));
    }
    let command = [exe.to_string_lossy().into_owned(), "lint".into(), "jj-tool".into(), "--plan".into(), plan_file.to_string_lossy().into_owned(), "$path".into()];
    let patterns: Vec<toml::Value> = plan.keys().map(|path| toml::Value::String(format!("root-file:{}", serde_json::to_string(path).unwrap_or_default()))).collect();
    let ours = toml::Table::from_iter([
        ("command".to_string(), toml::Value::Array(command.into_iter().map(toml::Value::String).collect())),
        ("patterns".to_string(), toml::Value::Array(patterns)),
        ("enabled".to_string(), toml::Value::Boolean(true)),
    ]);
    tools.insert(TOOL.into(), toml::Value::Table(ours));
    let config = toml::Table::from_iter([("fix".to_string(), toml::Value::Table(toml::Table::from_iter([("tools".to_string(), toml::Value::Table(tools))])))]);
    let config_file = dir.path().join("fix.toml");
    std::fs::write(&config_file, toml::to_string(&config)?)?;
    let config_arg = config_file.to_string_lossy().into_owned();
    let mut args: Vec<&str> = vec!["fix", "--config-file", &config_arg];
    for root in roots {
        args.extend(["-s", root.as_str()]);
    }
    workspace.jj(&args)?;
    Ok(())
}

pub fn tool(plan_file: &Path, path: &str, input: &mut dyn Read, out: &mut dyn Write) -> Result<()> {
    let mut bytes = Vec::new();
    input.read_to_end(&mut bytes)?;
    let fixed = planned_runs(plan_file, path).and_then(|(language, runs)| fix::remove_runs(language, std::str::from_utf8(&bytes).ok()?, &runs));
    out.write_all(fixed.as_ref().map_or(&bytes[..], |fixed| fixed.text.as_bytes()))?;
    Ok(())
}

fn planned_runs(plan_file: &Path, path: &str) -> Option<(ast_grep_language::SupportLang, Vec<Run>)> {
    let mut plan: Plan = serde_json::from_slice(&std::fs::read(plan_file).ok()?).ok()?;
    Some((language_of(Path::new(path))?, plan.remove(path)?))
}

fn located(report: &Report) -> Vec<String> {
    let mut named: Vec<String> = report.left.iter().take(SHOWN).map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect();
    if report.left.len() > SHOWN {
        named.push(format!("+{} more", report.left.len() - SHOWN));
    }
    named
}

fn removal(report: &Report) -> Option<String> {
    (report.removed > 0).then(|| format!("removed {} in {}", plural(report.removed, "comment"), files_named(&report.files)))
}

pub fn after_commit(settings: &Settings, state_dir: &Path, cwd: &Path) -> Result<Option<String>> {
    let Some(workspace) = Workspace::find(cwd) else { return Ok(None) };
    let report = match fix_range(settings, &workspace, state_dir) {
        Ok(Some(report)) => report,
        Ok(None) => return Ok(None),
        Err(error) => return Ok(Some(skipped(&error))),
    };
    let mut parts: Vec<String> = removal(&report).into_iter().collect();
    if !report.left.is_empty() {
        parts.push(format!("{} (fix before pushing)", located(&report).join(", ")));
    }
    Ok((!parts.is_empty()).then(|| format!("ai-stack lint: {}", parts.join("; "))))
}

fn skipped(error: &anyhow::Error) -> String {
    format!("ai-stack lint: skipped ({})", format!("{error:#}").lines().next().unwrap_or_default())
}

pub fn before_push(settings: &Settings, state_dir: &Path, cwd: &Path, command: &str, harness: &str) -> Option<Value> {
    let workspace = Workspace::find(cwd)?;
    match push_check(settings, state_dir, &workspace, command, harness) {
        Ok(None) => None,
        Ok(Some(Decision::Allow(lines))) => (!lines.is_empty()).then(|| json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": lines.join("\n")}})),
        Ok(Some(Decision::Deny(lines))) => Some(json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": lines.join("\n")}})),
        Err(error) => Some(json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": skipped(&error)}})),
    }
}

enum Decision {
    Allow(Vec<String>),
    Deny(Vec<String>),
}

fn push_check(settings: &Settings, state_dir: &Path, workspace: &Workspace, command: &str, harness: &str) -> Result<Option<Decision>> {
    let Some(report) = fix_range(settings, workspace, state_dir)? else { return Ok(None) };
    let log = Log::new(state_dir);
    let time = now();
    let mut lines = Vec::new();
    if log.rate(&workspace.key, settings.skip_alert, time).over(settings.skip_alert) {
        lines.push(HIGH_RATE.to_string());
    }
    lines.extend(removal(&report).map(|removed| format!("ai-stack lint: {removed}")));
    let reason = skip_reason(command);
    if reason.as_deref() == Some("") {
        lines.push("ai-stack lint: AI_STACK_LINT_SKIP needs a reason, so this push is checked as usual.".into());
    }
    let left: Vec<&Finding> = report.left.iter().collect();
    let newest = workspace.commits(&format!("heads({RANGE})"))?.into_iter().next().unwrap_or(report.head);
    let event = |kind, findings: Vec<String>, reason: Option<String>| Event { time, kind, repo: workspace.key.clone(), harness: Some(harness.to_string()), head: Some(newest.clone()), findings, reason, vcs: Some("jj".into()) };
    let recorded = match reason.filter(|reason| !reason.is_empty()) {
        _ if left.is_empty() => event(Kind::Checked, Vec::new(), None),
        Some(reason) => {
            let mut files: Vec<&Path> = left.iter().map(|finding| finding.file.as_path()).collect();
            files.dedup();
            let limits = settings.skip;
            if files.len() > limits.files || left.len() > limits.findings {
                lines.push(format!(
                    "ai-stack lint: a skip must cover only the exception (at most {} file and {} findings; this push has {} and {}). Fix the rest, then push with the skip.",
                    limits.files,
                    limits.findings,
                    files.len(),
                    left.len()
                ));
                return Ok(Some(Decision::Deny(lines)));
            }
            let findings = sorted_names(&left);
            lines.push(skip_recorded(&findings, &reason));
            event(Kind::Skip, findings, Some(reason))
        }
        None => {
            lines.extend(refusal(&left, "push"));
            return Ok(Some(Decision::Deny(lines)));
        }
    };
    if let Err(error) = log.record(&recorded)
        && recorded.kind == Kind::Skip
    {
        lines.pop();
        lines.push(format!("ai-stack lint: the skip could not be recorded ({}), so this push is refused.", format!("{error:#}").lines().next().unwrap_or_default()));
        return Ok(Some(Decision::Deny(lines)));
    }
    let _ = log.alert(&workspace.key, settings.skip_alert, time);
    Ok(Some(Decision::Allow(lines)))
}

pub fn fix_here(settings: &Settings, state_dir: &Path, cwd: &Path, err: &mut dyn Write) -> Result<i32> {
    let Some(workspace) = Workspace::find(cwd) else { bail!("{} is not inside a jj workspace", cwd.display()) };
    let Some(report) = fix_range(settings, &workspace, state_dir)? else { return Ok(0) };
    if let Some(removed) = removal(&report) {
        writeln!(err, "ai-stack lint: {removed}")?;
    }
    if report.left.is_empty() {
        return Ok(0);
    }
    for line in refusal(&report.left.iter().collect::<Vec<_>>(), "push") {
        writeln!(err, "{line}")?;
    }
    Ok(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_and_push_commands_are_recognised_from_the_text_alone() {
        for command in ["jj commit -m x", "cd sub && jj --no-pager commit -m 'x'", "jj -R ../other describe -m y", "/usr/bin/jj squash", "jj new", "jj split -r @-"] {
            assert!(is_commit(command), "{command}");
        }
        for command in ["jj log -r 'description(new)'", "git commit -m jj", "jj st", "echo jj", "jj git push"] {
            assert!(!is_commit(command), "{command}");
        }
        for command in ["jj git push", "jj --config ui.color=never git push -c @-", "AI_STACK_LINT_SKIP=\"the device has no event\" jj git push --bookmark main"] {
            assert!(is_push(command), "{command}");
        }
        assert!(!is_push("git push") && !is_push("jj git fetch") && !is_push("jj push"));
        assert_eq!(skip_reason("AI_STACK_LINT_SKIP=\"the device has no event\" jj git push").as_deref(), Some("the device has no event"));
        assert_eq!(skip_reason("AI_STACK_LINT_SKIP='quoted' jj git push").as_deref(), Some("quoted"));
        assert_eq!(skip_reason("AI_STACK_LINT_SKIP= jj git push").as_deref(), Some(""));
        assert_eq!(skip_reason("jj git push"), None);
    }
}
