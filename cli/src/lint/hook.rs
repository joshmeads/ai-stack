use std::collections::{BTreeSet, HashMap};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use super::scan::{Engine, language_of};
use super::{Baseline, Finding, Settings, Severity, text};
use crate::config::Harness;
use crate::paths;

const MAX_BLOCKS: u32 = 3;
const STALE_AFTER: Duration = Duration::from_secs(14 * 24 * 60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum HookEvent {
    PreEdit,
    PostEdit,
    Stop,
}

impl HookEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            HookEvent::PreEdit => "pre-edit",
            HookEvent::PostEdit => "post-edit",
            HookEvent::Stop => "stop",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum HookReply {
    Silent,
    Context(String),
    Block(String),
    Notice(String),
}

impl HookReply {
    fn render(self) -> Option<String> {
        let value = match self {
            HookReply::Silent => return None,
            HookReply::Context(text) => json!({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": text}}),
            HookReply::Block(reason) => json!({"decision": "block", "reason": reason}),
            HookReply::Notice(message) => json!({"systemMessage": message}),
        };
        Some(value.to_string())
    }
}

#[derive(Deserialize)]
struct Payload {
    session_id: String,
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    cwd: Option<PathBuf>,
    #[serde(default)]
    tool_input: Value,
    #[serde(default)]
    stop_hook_active: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum Edit {
    File(PathBuf),
    Move { from: PathBuf, to: PathBuf },
}

impl Edit {
    fn target(&self) -> &Path {
        match self {
            Edit::File(path) | Edit::Move { to: path, .. } => path,
        }
    }
}

pub fn run(harness: Harness, event: HookEvent, settings: &Settings, input: &str) -> Result<Option<String>> {
    if !settings.enabled {
        return Ok(None);
    }
    let payload: Payload = serde_json::from_str(input).context("hook payload is not the expected JSON")?;
    let cwd = payload.cwd.clone().unwrap_or_else(|| PathBuf::from("/"));
    let agent = Agent { session: &payload.session_id, id: payload.agent_id.as_deref() };
    let reply = match event {
        HookEvent::PreEdit => {
            let edits: Vec<Edit> = edits(harness, &payload, &cwd).into_iter().filter(|edit| language_of(edit.target()).is_some() && settings.lints(edit.target())).collect();
            if edits.is_empty() {
                return Ok(None);
            }
            let session = Session::open(&settings.state_dir, agent)?;
            for edit in &edits {
                record(&session, edit)?;
            }
            HookReply::Silent
        }
        HookEvent::PostEdit => {
            let Some(session) = Session::existing(&settings.state_dir, agent) else { return Ok(None) };
            let files: Vec<(PathBuf, Baseline)> = edits(harness, &payload, &cwd)
                .iter()
                .filter_map(|edit| session.baseline(edit.target()).map(|baseline| (edit.target().to_path_buf(), baseline)))
                .collect();
            if files.is_empty() {
                return Ok(None);
            }
            match settings.rules() {
                Ok(rules) => post_edit_reply(&Engine { settings, rules: &rules, scope: None, display: &cwd }.lint(files)),
                Err(error) => session.load_error(&error),
            }
        }
        HookEvent::Stop => {
            let Some(session) = Session::existing(&settings.state_dir, agent) else { return Ok(None) };
            match settings.rules() {
                Ok(rules) => {
                    let findings = Engine { settings, rules: &rules, scope: None, display: &cwd }.lint(session.files());
                    let mut state = session.stop_state();
                    let reply = decide(&mut state, payload.stop_hook_active, findings);
                    session.save_stop_state(&state)?;
                    reply
                }
                Err(error) => session.load_error(&error),
            }
        }
    };
    Ok(reply.render())
}

#[derive(Clone, Copy)]
struct Agent<'a> {
    session: &'a str,
    id: Option<&'a str>,
}

fn post_edit_reply(findings: &[Finding]) -> HookReply {
    if findings.is_empty() {
        return HookReply::Silent;
    }
    HookReply::Context(format!(
        "ai-stack lint found {} problem(s) in the lines you just changed. Fix them now; errors block stopping until they are gone.\n{}",
        findings.len(),
        text(findings)
    ))
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StopState {
    blocks: u32,
    last_fingerprint: BTreeSet<String>,
    acknowledged: BTreeSet<String>,
}

fn fingerprinted(findings: Vec<Finding>) -> Vec<(String, Finding)> {
    let mut seen: HashMap<(String, PathBuf, String), usize> = HashMap::new();
    findings
        .into_iter()
        .map(|finding| {
            let text = finding.snippet.trim().to_string();
            let occurrence = seen.entry((finding.rule.clone(), finding.file.clone(), text.clone())).or_insert(0);
            let fingerprint = format!("{}\u{0}{}\u{0}{text}\u{0}{occurrence}", finding.rule, finding.file.display());
            *occurrence += 1;
            (fingerprint, finding)
        })
        .collect()
}

fn decide(state: &mut StopState, active: bool, findings: Vec<Finding>) -> HookReply {
    if !active {
        state.blocks = 0;
    }
    let (current, blocking): (BTreeSet<String>, Vec<Finding>) = fingerprinted(findings.into_iter().filter(|finding| finding.severity == Severity::Error).collect())
        .into_iter()
        .filter(|(fingerprint, _)| !state.acknowledged.contains(fingerprint))
        .unzip();
    if current.is_empty() {
        state.last_fingerprint.clear();
        return HookReply::Silent;
    }
    if active && (current == state.last_fingerprint || state.blocks >= MAX_BLOCKS) {
        state.acknowledged.extend(current);
        state.last_fingerprint.clear();
        state.blocks = 0;
        let named: Vec<String> = blocking.iter().map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect();
        return HookReply::Notice(format!(
            "ai-stack lint let the agent stop with {} unresolved error(s) it was asked to fix; they will not block again this session: {}",
            blocking.len(),
            named.join(", ")
        ));
    }
    state.blocks += 1;
    state.last_fingerprint = current;
    HookReply::Block(format!(
        "ai-stack lint: fix these errors in lines you changed this session before stopping. If one must stay, say why in your reply.\n{}",
        text(&blocking)
    ))
}

fn edits(harness: Harness, payload: &Payload, cwd: &Path) -> Vec<Edit> {
    let absolute = |path: &str| paths::normalize(&cwd.join(path.trim()));
    match harness {
        Harness::Claude => payload.tool_input.get("file_path").and_then(Value::as_str).map(|path| vec![Edit::File(absolute(path))]).unwrap_or_default(),
        Harness::Codex => {
            let patch = payload.tool_input.get("command").and_then(Value::as_str).or_else(|| payload.tool_input.as_str()).unwrap_or_default();
            let mut edits = Vec::new();
            for line in patch.lines() {
                let header = ["*** Add File: ", "*** Update File: ", "*** Delete File: "].iter().find_map(|prefix| line.strip_prefix(prefix));
                if let Some(path) = header {
                    edits.push(Edit::File(absolute(path)));
                } else if let Some(to) = line.strip_prefix("*** Move to: ")
                    && let Some(Edit::File(from)) = edits.pop()
                {
                    edits.push(Edit::Move { from, to: absolute(to) });
                }
            }
            edits
        }
    }
}

fn record(session: &Session, edit: &Edit) -> Result<()> {
    let target = edit.target();
    let baseline = match edit {
        Edit::File(path) => current(path),
        Edit::Move { from, .. } => session.baseline(from).or_else(|| current(from)),
    };
    match baseline {
        Some(baseline) => session.record(target, &baseline),
        None => Ok(()),
    }
}

fn current(path: &Path) -> Option<Baseline> {
    match std::fs::read_to_string(path) {
        Ok(text) => Some(Baseline::Text(text)),
        Err(err) if err.kind() == ErrorKind::NotFound => Some(Baseline::Absent),
        Err(_) => None,
    }
}

#[derive(Serialize, Deserialize)]
struct Stored {
    path: PathBuf,
    content: Option<String>,
}

struct Session {
    root: PathBuf,
    dir: PathBuf,
}

impl Session {
    fn at(state_dir: &Path, agent: Agent) -> Session {
        let root = state_dir.join(session_name(agent.session));
        let dir = match agent.id {
            None => root.clone(),
            Some(id) => root.join("agents").join(session_name(id)),
        };
        Session { root, dir }
    }

    fn open(state_dir: &Path, agent: Agent) -> Result<Session> {
        std::fs::create_dir_all(state_dir).with_context(|| format!("creating {}", state_dir.display()))?;
        let session = Session::at(state_dir, agent);
        match std::fs::create_dir(&session.root) {
            Ok(()) => prune(state_dir, &session.root),
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {}
            Err(err) => return Err(err).with_context(|| format!("creating {}", session.root.display())),
        }
        std::fs::create_dir_all(session.dir.join("baselines"))?;
        Ok(session)
    }

    fn existing(state_dir: &Path, agent: Agent) -> Option<Session> {
        let session = Session::at(state_dir, agent);
        session.dir.join("baselines").is_dir().then_some(session)
    }

    fn load_error(&self, error: &anyhow::Error) -> HookReply {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(self.root.join("load-error-reported")) {
            Ok(_) => HookReply::Notice(format!("ai-stack lint could not load its rules, so it is not checking this session: {error:#}")),
            Err(_) => HookReply::Silent,
        }
    }

    fn slot(&self, path: &Path) -> PathBuf {
        self.dir.join("baselines").join(hex(path.as_os_str().as_encoded_bytes()))
    }

    fn record(&self, path: &Path, baseline: &Baseline) -> Result<()> {
        let slot = self.slot(path);
        if slot.exists() {
            return Ok(());
        }
        let content = match baseline {
            Baseline::Absent => None,
            Baseline::Text(text) => Some(text.clone()),
        };
        let mut staged = tempfile::NamedTempFile::new_in(self.dir.join("baselines"))?;
        serde_json::to_writer(&mut staged, &Stored { path: path.to_path_buf(), content })?;
        match std::fs::hard_link(staged.path(), &slot) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == ErrorKind::AlreadyExists => Ok(()),
            Err(err) => Err(err).with_context(|| format!("writing {}", slot.display())),
        }
    }

    fn baseline(&self, path: &Path) -> Option<Baseline> {
        let stored: Stored = serde_json::from_slice(&std::fs::read(self.slot(path)).ok()?).ok()?;
        Some(stored.content.map_or(Baseline::Absent, Baseline::Text))
    }

    fn files(&self) -> Vec<(PathBuf, Baseline)> {
        let Ok(entries) = std::fs::read_dir(self.dir.join("baselines")) else { return Vec::new() };
        let mut files: Vec<(PathBuf, Baseline)> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
            .filter_map(|entry| serde_json::from_slice::<Stored>(&std::fs::read(entry.path()).ok()?).ok())
            .map(|stored| (stored.path, stored.content.map_or(Baseline::Absent, Baseline::Text)))
            .collect();
        files.sort_by(|a, b| a.0.cmp(&b.0));
        files
    }

    fn stop_state(&self) -> StopState {
        std::fs::read(self.dir.join("stop.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    fn save_stop_state(&self, state: &StopState) -> Result<()> {
        let mut staged = tempfile::NamedTempFile::new_in(&self.dir)?;
        serde_json::to_writer(&mut staged, state)?;
        staged.persist(self.dir.join("stop.json"))?;
        Ok(())
    }
}

fn session_name(id: &str) -> String {
    let plain = !id.is_empty() && !id.starts_with('.') && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte));
    if plain { id.to_string() } else { hex(id.as_bytes()) }
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

fn prune(state_dir: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(state_dir) else { return };
    let now = SystemTime::now();
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        let stale = entry.metadata().and_then(|meta| meta.modified()).is_ok_and(|modified| now.duration_since(modified).is_ok_and(|age| age > STALE_AFTER));
        if path != keep && stale && path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{LintProject, LintSection};
    use crate::lint::tests::{git, put, settings};

    fn payload(session: &str, cwd: &Path, tool_input: Value, active: bool) -> String {
        json!({"session_id": session, "cwd": cwd, "hook_event_name": "x", "tool_input": tool_input, "stop_hook_active": active}).to_string()
    }

    fn subagent(agent: &str, payload: String) -> String {
        let mut value: Value = serde_json::from_str(&payload).unwrap();
        value["agent_id"] = json!(agent);
        value.to_string()
    }

    fn finding(path: &str, line: u32) -> Finding {
        Finding {
            file: Path::new("/w").join(path),
            path: path.into(),
            rule: "no-comments".into(),
            severity: Severity::Error,
            line,
            column: 1,
            end_line: line,
            message: "m".into(),
            snippet: format!("// {line}"),
        }
    }

    #[test]
    fn claude_and_codex_payloads_name_every_edited_file_and_a_move_keeps_its_source() {
        let cwd = Path::new("/w");
        let claude: Payload = serde_json::from_str(&payload("s", cwd, json!({"file_path": "/w/a.ts", "old_string": "x"}), false)).unwrap();
        assert_eq!(edits(Harness::Claude, &claude, cwd), [Edit::File("/w/a.ts".into())]);
        let patch = "*** Begin Patch\n*** Add File: new.ts\n+x\n*** Update File: src/old.ts\n*** Move to: src/moved.ts\n@@\n-a\n+b\n*** Delete File: gone.py\n*** Update File: /abs/x.rs\n@@\n*** End Patch\n";
        let codex: Payload = serde_json::from_str(&payload("s", cwd, json!({"command": patch}), false)).unwrap();
        assert_eq!(edits(Harness::Codex, &codex, cwd), [
            Edit::File("/w/new.ts".into()),
            Edit::Move { from: "/w/src/old.ts".into(), to: "/w/src/moved.ts".into() },
            Edit::File("/w/gone.py".into()),
            Edit::File("/abs/x.rs".into()),
        ]);
    }

    #[test]
    fn the_first_baseline_of_a_file_wins_even_when_hooks_race() {
        let tmp = tempfile::tempdir().unwrap();
        let lead = Agent { session: "race", id: None };
        let session = Session::open(tmp.path(), lead).unwrap();
        let path = Path::new("/w/a.ts");
        std::thread::scope(|scope| {
            for writer in 0..8 {
                let session = &session;
                scope.spawn(move || session.record(path, &Baseline::Text(format!("writer {writer}\n"))).unwrap());
            }
        });
        let Some(Baseline::Text(first)) = session.baseline(path) else { panic!("no baseline") };
        session.record(path, &Baseline::Absent).unwrap();
        assert_eq!(session.baseline(path), Some(Baseline::Text(first)));
        assert_eq!(session.files().len(), 1);
        assert!(Session::existing(tmp.path(), Agent { session: "other", id: None }).is_none());
        assert!(Session::existing(tmp.path(), Agent { id: Some("child"), ..lead }).is_none(), "a subagent never sees the lead's baselines");
        assert_eq!(session_name("../../etc"), hex(b"../../etc"));
    }

    #[test]
    fn stop_guard_blocks_releases_an_unchanged_set_and_never_reblocks_what_it_released() {
        let mut state = StopState::default();
        let kept = || vec![finding("a.ts", 1)];
        assert!(matches!(decide(&mut state, false, kept()), HookReply::Block(reason) if reason.contains("a.ts:1:1 error no-comments")));
        assert!(matches!(decide(&mut state, true, kept()), HookReply::Notice(message) if message.contains("a.ts:1 no-comments")));
        assert_eq!(decide(&mut state, false, kept()), HookReply::Silent, "a later turn with the same kept finding stops at once");
        let from_elsewhere = Finding { path: "../a.ts".into(), ..finding("a.ts", 1) };
        assert_eq!(decide(&mut state, false, vec![from_elsewhere]), HookReply::Silent, "the fingerprint does not depend on the cwd");
        let copy = Finding { line: 5, end_line: 5, ..finding("a.ts", 1) };
        assert!(matches!(decide(&mut state, false, vec![finding("a.ts", 1), copy]), HookReply::Block(reason) if reason.contains("a.ts:5") && !reason.contains("a.ts:1:")), "a new identical occurrence blocks");
        assert!(matches!(decide(&mut state, false, vec![finding("a.ts", 1), finding("b.ts", 2)]), HookReply::Block(reason) if reason.contains("b.ts:2") && !reason.contains("a.ts")));
        let warning = Finding { severity: Severity::Warning, ..finding("w.ts", 3) };
        assert_eq!(decide(&mut StopState::default(), false, vec![warning]), HookReply::Silent);

        let mut churn = StopState::default();
        for round in 0..MAX_BLOCKS {
            assert!(matches!(decide(&mut churn, round > 0, vec![finding("c.ts", round + 1)]), HookReply::Block(_)), "round {round}");
        }
        assert!(matches!(decide(&mut churn, true, vec![finding("c.ts", 99)]), HookReply::Notice(_)), "the cap releases a set that keeps changing");
        assert_eq!(decide(&mut churn, false, Vec::new()), HookReply::Silent);
    }

    #[test]
    fn hooks_blame_only_each_agents_own_lines_through_commits_moves_and_both_harnesses() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let settings = settings(&root.join("home"), LintSection::default());
        let repo = root.join("repo");
        let body: String = (1..=10).map(|n| format!("export const v{n} = {n};\n")).collect();
        put(&repo.join("foo.ts"), &body);
        put(&repo.join("bar.ts"), "export const bar = 1;\n");
        put(&repo.join("src/old.ts"), "// legacy prose\nexport const old = 1;\n");
        git(&repo, &["init", "-q"]);
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-qm", "base"]);
        let human = body.replace("export const v8 = 8;\n", "export const v8 = 8; // human prose\n");
        put(&repo.join("foo.ts"), &human);
        git(&repo, &["add", "foo.ts"]);

        let hook = |harness, event, input: String| run(harness, event, &settings, &input).unwrap();
        let edit = json!({"file_path": repo.join("foo.ts")});
        assert_eq!(hook(Harness::Claude, HookEvent::PreEdit, payload("s1", &repo, edit.clone(), false)), None);
        put(&repo.join("foo.ts"), &human.replace("export const v2 = 2;\n", "export const v2 = 2; // agent prose\n"));
        let context: Value = serde_json::from_str(&hook(Harness::Claude, HookEvent::PostEdit, payload("s1", &repo, edit.clone(), false)).unwrap()).unwrap();
        assert_eq!(context["hookSpecificOutput"]["hookEventName"], "PostToolUse");
        let text = context["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(text.contains("foo.ts:2:") && !text.contains("foo.ts:8:"), "{text}");

        let child_edit = json!({"file_path": repo.join("bar.ts")});
        assert_eq!(hook(Harness::Claude, HookEvent::PreEdit, subagent("worker", payload("s1", &repo, child_edit, false))), None);
        put(&repo.join("bar.ts"), "export const bar = 1; // child prose\n");
        assert_eq!(hook(Harness::Claude, HookEvent::Stop, subagent("explorer", payload("s1", &repo, Value::Null, false))), None, "a read-only subagent stops at once");
        let child: Value = serde_json::from_str(&hook(Harness::Claude, HookEvent::Stop, subagent("worker", payload("s1", &repo, Value::Null, false))).unwrap()).unwrap();
        let reason = child["reason"].as_str().unwrap();
        assert!(reason.contains("bar.ts:1:") && !reason.contains("foo.ts"), "{reason}");
        assert!(hook(Harness::Claude, HookEvent::Stop, subagent("worker", payload("s1", &repo, Value::Null, true))).unwrap().contains("systemMessage"));

        git(&repo, &["commit", "-qam", "agent commits before stopping"]);
        let stop = |active, cwd: &Path| hook(Harness::Claude, HookEvent::Stop, payload("s1", cwd, Value::Null, active));
        let blocked: Value = serde_json::from_str(&stop(false, &repo).unwrap()).unwrap();
        let reason = blocked["reason"].as_str().unwrap();
        assert_eq!(blocked["decision"], "block");
        assert!(reason.contains("foo.ts:2:") && !reason.contains("foo.ts:8:") && !reason.contains("bar.ts"), "{reason}");
        let released: Value = serde_json::from_str(&stop(true, &repo).unwrap()).unwrap();
        assert!(released["systemMessage"].as_str().unwrap().contains("foo.ts:2 no-comments"));
        assert_eq!(stop(false, &repo), None);
        assert_eq!(stop(false, &repo.join("src")), None, "a cd does not revive an acknowledged finding");

        let patch = "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-export const old = 1;\n+export const renamed = 1; // codex prose\n*** End Patch\n";
        let codex = |event| hook(Harness::Codex, event, payload("s2", &repo, json!({"command": patch}), false));
        assert_eq!(codex(HookEvent::PreEdit), None);
        std::fs::remove_file(repo.join("src/old.ts")).unwrap();
        put(&repo.join("src/new.ts"), "// legacy prose\nexport const renamed = 1; // codex prose\n");
        let context: Value = serde_json::from_str(&codex(HookEvent::PostEdit).unwrap()).unwrap();
        assert_eq!(context["hookSpecificOutput"]["hookEventName"], "PostToolUse");
        let text = context["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(text.contains("src/new.ts:2:") && !text.contains("src/new.ts:1:"), "{text}");

        let mut disabled = settings;
        disabled.enabled = false;
        assert_eq!(run(Harness::Codex, HookEvent::Stop, &disabled, &payload("s2", &repo, Value::Null, false)).unwrap(), None);
    }

    #[test]
    fn a_disabled_project_stores_nothing_and_missing_rules_are_reported_once_without_touching_stop_state() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let repo = root.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q"]);
        let edit = json!({"file_path": repo.join("a.ts")});
        let off = LintProject { path: repo.to_string_lossy().into_owned(), paths: Default::default(), ignore: Vec::new(), scope: None, enabled: Some(false) };
        let disabled = settings(&root.join("home"), LintSection { project: vec![off], ..LintSection::default() });
        assert_eq!(run(Harness::Claude, HookEvent::PreEdit, &disabled, &payload("s", &repo, edit.clone(), false)).unwrap(), None);
        assert!(!disabled.state_dir.exists(), "pre-edit stored state for a disabled project");

        let mut broken = settings(&root.join("home"), LintSection::default());
        broken.shipped_rules = root.join("missing/lint/rules");
        let hook = |event| run(Harness::Claude, event, &broken, &payload("s", &repo, edit.clone(), false)).unwrap();
        assert_eq!(hook(HookEvent::PreEdit), None);
        put(&repo.join("a.ts"), "// prose\n");
        let notice: Value = serde_json::from_str(&hook(HookEvent::PostEdit).unwrap()).unwrap();
        assert!(notice["systemMessage"].as_str().unwrap().contains(&root.join("missing/lint/rules").display().to_string()), "{notice}");
        assert_eq!(hook(HookEvent::Stop), None);
        assert!(!broken.state_dir.join("s/stop.json").exists());
    }
}
