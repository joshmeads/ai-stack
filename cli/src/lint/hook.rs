use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::Deserialize;
use serde_json::{Value, json};

use super::events::Log;
use super::repo::{Attributes, Repo, Repos};
use super::scan::{Change, Engine, read_lintable, sort};
use super::{Baseline, Settings, Severity};
use crate::config::Harness;
use crate::paths;

const SHOWN: usize = 5;

#[derive(Deserialize)]
struct Payload {
    #[serde(default)]
    hook_event_name: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    cwd: Option<PathBuf>,
    #[serde(default)]
    tool_input: Value,
}

pub fn run(harness: Harness, state_dir: &Path, settings: impl FnOnce() -> Result<Settings>, input: &str) -> Result<Option<String>> {
    let payload: Payload = serde_json::from_str(input)?;
    if payload.hook_event_name.as_deref().is_some_and(|event| event != "PostToolUse") {
        return Ok(None);
    }
    let cwd = payload.cwd.clone().unwrap_or_else(|| PathBuf::from("/"));
    let log = Log::new(state_dir);
    let queued = log.has_notices();
    let shell = payload.tool_name.as_deref() == Some("Bash");
    if shell && !queued {
        return Ok(None);
    }
    let files = if shell { Vec::new() } else { edited(harness, &payload, &cwd) };
    let mut repos = Repos::default();
    let mut context = None;
    if !files.is_empty() {
        let settings = settings()?;
        if settings.enabled {
            context = report(&settings, &files, &cwd, &mut repos)?;
        }
    }
    let mut notices = Vec::new();
    if queued {
        let mut keys: Vec<PathBuf> = Repo::discover(&cwd).map(|repo| repo.project_key).into_iter().collect();
        keys.extend(files.iter().filter_map(|file| repos.of(file)).map(|repo| repo.project_key));
        keys.dedup();
        notices.extend(keys.iter().filter_map(|key| log.take_notice(key)));
    }
    if context.is_none() && notices.is_empty() {
        return Ok(None);
    }
    let mut reply = json!({});
    if let Some(context) = context {
        reply["hookSpecificOutput"] = json!({"hookEventName": "PostToolUse", "additionalContext": context});
    }
    if !notices.is_empty() {
        reply["systemMessage"] = json!(notices.join("\n"));
    }
    Ok(Some(reply.to_string()))
}

fn report(settings: &Settings, files: &[PathBuf], cwd: &Path, repos: &mut Repos) -> Result<Option<String>> {
    let mut changes = Vec::new();
    for file in files.iter().filter(|file| settings.lints(file)) {
        let Some(source) = read_lintable(file) else { continue };
        let Some(repo) = repos.of(file) else { continue };
        let Some(rel) = repo.relative(file) else { continue };
        let baseline = match repo.head() {
            Some(head) => repo.blob_at(&head, &rel)?.map_or(Baseline::Absent, |blob| Baseline::Text(String::from_utf8_lossy(&blob).into_owned())),
            None => Baseline::Absent,
        };
        changes.extend(Change::new(repo.root.join(rel), source, &baseline));
    }
    if changes.is_empty() {
        return Ok(None);
    }
    let rules = settings.rules()?;
    let mut findings = Engine { settings, rules: &rules, scope: None, display: cwd, attributes: Attributes::Worktree }.lint(&changes);
    findings.retain(|finding| finding.severity == Severity::Error && finding.fix.is_none());
    sort(&mut findings);
    if findings.is_empty() {
        return Ok(None);
    }
    let mut named: Vec<String> = findings.iter().take(SHOWN).map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect();
    if findings.len() > SHOWN {
        named.push(format!("+{} more", findings.len() - SHOWN));
    }
    Ok(Some(format!("ai-stack lint: {} (fix before committing)", named.join(", "))))
}

fn edited(harness: Harness, payload: &Payload, cwd: &Path) -> Vec<PathBuf> {
    let absolute = |path: &str| paths::normalize(&cwd.join(path.trim()));
    let mut files: Vec<PathBuf> = match harness {
        Harness::Claude => payload.tool_input.get("file_path").and_then(Value::as_str).map(absolute).into_iter().collect(),
        Harness::Codex => {
            let patch = payload.tool_input.get("command").and_then(Value::as_str).or_else(|| payload.tool_input.as_str()).unwrap_or_default();
            let headers = ["*** Add File: ", "*** Update File: ", "*** Move to: "];
            patch.lines().filter_map(|line| headers.iter().find_map(|prefix| line.strip_prefix(prefix))).map(absolute).collect()
        }
    };
    files.dedup();
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::LintSection;
    use crate::lint::tests::{git, put, settings};

    #[test]
    fn an_edit_gets_one_line_of_unfixable_errors_and_any_shell_call_delivers_a_queued_notice() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let home = root.join("home");
        let repo = root.join("repo");
        put(&repo.join("a.test.ts"), "test(\"x\", async () => {});\n");
        git(&repo, &["init", "-q"]);
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-qm", "base"]);
        let sleep = (1..=7).map(|n| format!("test(\"{n}\", async () => {{ await new Promise((r) => setTimeout(r, 5)); }}); // prose\n")).collect::<String>();
        put(&repo.join("a.test.ts"), &format!("test(\"x\", async () => {{}});\n{sleep}"));
        let state = home.join(".local/state/ai-stack/lint");
        let call = |harness, input: Value| run(harness, &state, || Ok(settings(&home, LintSection::default())), &input.to_string()).unwrap();
        let edit = |file: &Path| json!({"hook_event_name": "PostToolUse", "tool_name": "Edit", "cwd": repo, "tool_input": {"file_path": file}});
        let reply: Value = serde_json::from_str(&call(Harness::Claude, edit(&repo.join("a.test.ts"))).unwrap()).unwrap();
        let context = reply["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert_eq!(context, "ai-stack lint: a.test.ts:2 no-fixed-sleep, a.test.ts:3 no-fixed-sleep, a.test.ts:4 no-fixed-sleep, a.test.ts:5 no-fixed-sleep, a.test.ts:6 no-fixed-sleep, +2 more (fix before committing)");
        assert!(reply.get("systemMessage").is_none());

        put(&repo.join("b.ts"), "export const b = 1; // prose the commit hook removes\n");
        assert_eq!(call(Harness::Claude, edit(&repo.join("b.ts"))), None, "fixable findings are never mentioned");
        let patch = json!({"hook_event_name": "PostToolUse", "tool_name": "apply_patch", "cwd": repo, "tool_input": {"command": "*** Begin Patch\n*** Update File: a.test.ts\n@@\n*** End Patch\n"}});
        assert!(call(Harness::Codex, patch).unwrap().contains("a.test.ts:2 no-fixed-sleep"));

        let shell = json!({"hook_event_name": "PostToolUse", "tool_name": "Bash", "cwd": repo.join("sub"), "tool_input": {"command": "git status"}});
        assert_eq!(call(Harness::Claude, shell.clone()), None);
        Log::new(&state).queue_notice(&Repo::discover(&repo).unwrap().project_key, "agents skipped the check").unwrap();
        let other = json!({"hook_event_name": "PostToolUse", "tool_name": "Bash", "cwd": root, "tool_input": {"command": "ls"}});
        assert_eq!(call(Harness::Claude, other), None, "a notice waits for its own repository");
        let delivered: Value = serde_json::from_str(&call(Harness::Codex, shell.clone()).unwrap()).unwrap();
        assert_eq!(delivered, json!({"systemMessage": "agents skipped the check"}));
        assert_eq!(call(Harness::Claude, shell), None, "a notice is delivered once");
        let stop = json!({"hook_event_name": "Stop", "cwd": repo});
        assert_eq!(call(Harness::Claude, stop), None, "a v1 hook entry left in place is silent");
    }
}
