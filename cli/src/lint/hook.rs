use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::Deserialize;
use serde_json::{Value, json};

use super::command::{Action, Call, jj_calls};
use super::events::{Log, now};
use super::jj;
use super::provenance::Provenance;
use super::repo::{Attributes, Repos};
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
    #[serde(default)]
    tool_response: Value,
}

struct Edited {
    file: PathBuf,
    added: Vec<String>,
    removed: Vec<String>,
}

pub fn run(harness: Harness, state_dir: &Path, settings: impl FnOnce() -> Result<Settings>, input: &str) -> Result<Option<String>> {
    let payload: Payload = serde_json::from_str(input)?;
    let shell = payload.tool_name.as_deref() == Some("Bash");
    let cwd = payload.cwd.clone().unwrap_or_else(|| PathBuf::from("/"));
    let calls = match shell {
        true => jj_calls(payload.tool_input.get("command").and_then(Value::as_str).unwrap_or_default(), &cwd),
        false => Vec::new(),
    };
    match payload.hook_event_name.as_deref() {
        Some("PreToolUse") => return before(harness, state_dir, settings, &payload, &cwd, &calls),
        Some("PostToolUse") | None => {}
        Some(_) => return Ok(None),
    }
    let log = Log::new(state_dir);
    let queued = log.has_notices();
    let mut committed: Vec<&Path> = calls.iter().filter(|call| matches!(call.action, Action::Commit { .. }) && jj::Workspace::find(&call.dir).is_some()).map(|call| call.dir.as_path()).collect();
    committed.dedup();
    let jj_commit = !committed.is_empty();
    if shell && !queued && !jj_commit {
        return Ok(None);
    }
    let edits = if shell { Vec::new() } else { edited(harness, &payload, &cwd) };
    let mut files: Vec<PathBuf> = edits.iter().map(|edit| edit.file.clone()).collect();
    files.dedup();
    let mut repos = Repos::default();
    let mut context = None;
    if !files.is_empty() || jj_commit {
        let settings = settings()?;
        if settings.enabled {
            let provenance = Provenance::new(state_dir, now());
            for edit in &edits {
                let repo = jj::locate(edit.file.parent().unwrap_or(&edit.file));
                if !settings.policy(repo.as_ref()).enabled() {
                    continue;
                }
                let _ = provenance.record(&edit.file, edit.added.iter().map(String::as_str));
                if let Some(repo) = repo {
                    let _ = provenance.record_removed(&repo.project_key, not_the_agents(&provenance, &edit.file, edit.removed.iter().map(String::as_str)));
                }
            }
            context = report(&settings, &files, &cwd, &mut repos)?;
            if jj_commit {
                let mut lines = Vec::new();
                for dir in committed {
                    let skip = calls.iter().filter(|call| call.dir.as_path() == dir).find_map(|call| call.skip.as_deref());
                    lines.extend(jj::after_commit(&settings, state_dir, dir, skip, harness.as_str())?);
                }
                context = (!lines.is_empty()).then(|| lines.join("\n"));
            }
        }
    }
    let mut notices = Vec::new();
    if queued {
        let mut keys: Vec<PathBuf> = jj::locate(&cwd).map(|repo| repo.project_key).into_iter().collect();
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

fn before(harness: Harness, state_dir: &Path, settings: impl FnOnce() -> Result<Settings>, payload: &Payload, cwd: &Path, calls: &[Call]) -> Result<Option<String>> {
    let deleted = match harness {
        Harness::Codex if payload.tool_name.as_deref() != Some("Bash") => deleted_files(payload, cwd),
        _ => Vec::new(),
    };
    if calls.is_empty() && deleted.is_empty() {
        return Ok(None);
    }
    let settings = settings()?;
    if !settings.enabled {
        return Ok(None);
    }
    let provenance = Provenance::new(state_dir, now());
    for (file, text) in &deleted {
        if let Some(repo) = jj::locate(file.parent().unwrap_or(file))
            && settings.policy(Some(&repo)).enabled()
        {
            let _ = provenance.record_removed(&repo.project_key, not_the_agents(&provenance, file, text.lines()));
        }
    }
    let committing: Vec<&Call> = calls.iter().filter(|call| matches!(call.action, Action::Commit { .. })).collect();
    let _ = jj::stage(&settings, state_dir, &committing);
    Ok(calls.iter().find_map(|call| jj::before_push(&settings, state_dir, call, harness.as_str())).map(|reply| reply.to_string()))
}

fn not_the_agents<'l>(provenance: &Provenance, file: &Path, removed: impl IntoIterator<Item = &'l str>) -> Vec<&'l str> {
    let own = provenance.written(file);
    removed.into_iter().filter(|line| !own.contains(line.trim())).collect()
}

fn deleted_files(payload: &Payload, cwd: &Path) -> Vec<(PathBuf, String)> {
    let patch = payload.tool_input.get("command").and_then(Value::as_str).or_else(|| payload.tool_input.as_str()).unwrap_or_default();
    patch
        .lines()
        .filter_map(|line| line.strip_prefix("*** Delete File: "))
        .map(|path| paths::normalize(&cwd.join(path.trim())))
        .filter_map(|file| Some((file.clone(), std::fs::read_to_string(&file).ok()?)))
        .collect()
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
    let mut findings = Engine { settings, rules: &rules, scope: None, display: cwd, attributes: Attributes::Worktree, repo: None }.lint(&changes);
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

fn added(new: &[&str], old: &[&str]) -> Vec<String> {
    let old: HashSet<&str> = old.iter().flat_map(|text| text.lines()).map(str::trim).collect();
    new.iter().flat_map(|text| text.lines()).filter(|line| !old.contains(line.trim())).map(str::to_string).collect()
}

fn edit(file: PathBuf, new: &[&str], old: &[&str]) -> Edited {
    Edited { file, added: added(new, old), removed: added(old, new) }
}

fn edited(harness: Harness, payload: &Payload, cwd: &Path) -> Vec<Edited> {
    let absolute = |path: &str| paths::normalize(&cwd.join(path.trim()));
    let input = &payload.tool_input;
    fn text<'v>(value: &'v Value, key: &str) -> &'v str {
        value.get(key).and_then(Value::as_str).unwrap_or_default()
    }
    match harness {
        Harness::Claude => {
            let Some(file) = input.get("file_path").and_then(Value::as_str).map(absolute) else { return Vec::new() };
            if input.get("content").is_some() {
                return vec![edit(file, &[text(input, "content")], &[text(&payload.tool_response, "originalFile")])];
            }
            let mut whole = Edited { file, added: Vec::new(), removed: Vec::new() };
            for pair in std::iter::once(input).chain(input.get("edits").and_then(Value::as_array).into_iter().flatten()) {
                let (new, old) = (text(pair, "new_string"), text(pair, "old_string"));
                whole.added.extend(added(&[new], &[old]));
                whole.removed.extend(added(&[old], &[new]));
            }
            vec![whole]
        }
        Harness::Codex => {
            let patch = input.get("command").and_then(Value::as_str).or_else(|| input.as_str()).unwrap_or_default();
            let mut edits: Vec<(PathBuf, Vec<&str>, Vec<&str>)> = Vec::new();
            for line in patch.lines() {
                if let Some(path) = ["*** Add File: ", "*** Update File: "].iter().find_map(|prefix| line.strip_prefix(prefix)) {
                    edits.push((absolute(path), Vec::new(), Vec::new()));
                } else if let Some(path) = line.strip_prefix("*** Move to: ")
                    && let Some((file, ..)) = edits.last_mut()
                {
                    *file = absolute(path);
                } else if line.starts_with("*** ") {
                    continue;
                } else if let Some((_, added, removed)) = edits.last_mut() {
                    match line.split_at_checked(1) {
                        Some(("+", text)) => added.push(text),
                        Some(("-", text)) => removed.push(text),
                        _ => {}
                    }
                }
            }
            edits.into_iter().map(|(file, added, removed)| edit(file, &added, &removed)).collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{LintProject, LintSection};
    use crate::lint::repo::Repo;
    use crate::lint::tests::{git, put, settings};

    #[test]
    fn an_edit_records_the_comment_lines_it_added_gets_one_line_of_unfixable_errors_and_any_shell_call_delivers_a_queued_notice() {
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

        let written = |file: &str| Provenance::new(&state, now()).written(&repo.join(file));
        let claude_edit = json!({"hook_event_name": "PostToolUse", "tool_name": "Edit", "cwd": repo, "tool_input": {"file_path": repo.join("b.ts"), "old_string": "// human note\nf();", "new_string": "  // human note\n  // agent note\ng();"}});
        call(Harness::Claude, claude_edit);
        assert_eq!(written("b.ts"), HashSet::from(["// agent note".to_string()]), "only comment lines the edit added are the agent's");
        let codex_patch = "*** Begin Patch\n*** Add File: c.ts\n+// new file note\n+export {};\n*** Update File: b.ts\n*** Move to: d.ts\n@@\n-// kept wording\n+// kept wording\n+// codex note\n*** End Patch\n";
        call(Harness::Codex, json!({"hook_event_name": "PostToolUse", "tool_name": "apply_patch", "cwd": repo, "tool_input": {"command": codex_patch}}));
        assert_eq!((written("c.ts"), written("d.ts")), (HashSet::from(["// new file note".to_string()]), HashSet::from(["// codex note".to_string()])));
        let cut = json!({"hook_event_name": "PostToolUse", "tool_name": "Edit", "cwd": repo, "tool_input": {"file_path": repo.join("b.ts"), "old_string": "// rounding rule\nx();", "new_string": "x();"}, "tool_response": {"originalFile": "// earlier agent prose\n// rounding rule\nx();\n"}});
        call(Harness::Claude, cut);
        let key = Repo::discover(&repo).unwrap().project_key;
        assert_eq!(Provenance::new(&state, now()).moved(&key), HashSet::from(["// rounding rule".to_string()]), "an Edit removes only what its old_string held, never the rest of originalFile");
        let own_cut = json!({"hook_event_name": "PostToolUse", "tool_name": "Edit", "cwd": repo, "tool_input": {"file_path": repo.join("b.ts"), "old_string": "// agent note\ng();", "new_string": "g();"}});
        call(Harness::Claude, own_cut);
        assert!(!Provenance::new(&state, now()).moved(&key).contains("// agent note"), "the agent cutting its own prose is not a move of a human's note");
        put(&repo.join("draft.ts"), "// a human's untracked note\nexport {};\n");
        let delete = json!({"hook_event_name": "PreToolUse", "tool_name": "apply_patch", "cwd": repo, "tool_input": {"command": "*** Begin Patch\n*** Delete File: draft.ts\n*** End Patch\n"}});
        call(Harness::Codex, delete);
        assert!(Provenance::new(&state, now()).moved(&key).contains("// a human's untracked note"), "a file a Codex patch deletes is read before it goes");
        let off = LintProject { path: repo.to_string_lossy().into_owned(), paths: Default::default(), ignore: Vec::new(), scope: None, enabled: Some(false) };
        let write = json!({"hook_event_name": "PostToolUse", "tool_name": "Write", "cwd": repo, "tool_input": {"file_path": repo.join("off.ts"), "content": "// written while lint is off\n"}});
        run(Harness::Claude, &state, || Ok(settings(&home, LintSection { project: vec![off], ..LintSection::default() })), &write.to_string()).unwrap();
        assert!(written("off.ts").is_empty(), "a disabled project records nothing");

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
