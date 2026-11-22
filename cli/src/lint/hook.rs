use std::collections::{BTreeSet, HashMap};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use super::scan::{Change, Engine};
use super::{Finding, Settings, Severity};
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
    cwd: Option<PathBuf>,
    #[serde(default)]
    tool_input: Value,
    #[serde(default)]
    stop_hook_active: bool,
}

pub fn run(harness: Harness, event: HookEvent, settings: &Settings, input: &str) -> Result<Option<String>> {
    if !settings.enabled {
        return Ok(None);
    }
    let payload: Payload = serde_json::from_str(input).context("hook payload is not the expected JSON")?;
    let cwd = payload.cwd.clone().unwrap_or_else(|| PathBuf::from("/"));
    let session = Session::at(&settings.state_dir, &payload.session_id);
    session.keep_alive();
    let reply = match event {
        HookEvent::PreEdit => HookReply::Silent,
        HookEvent::PostEdit => {
            let changes: Vec<Change> = edited(harness, &payload, &cwd).into_iter().filter_map(|_| None).collect();
            if changes.is_empty() {
                return Ok(None);
            }
            match settings.rules() {
                Ok(rules) => post_edit_reply(&Engine { settings, rules: &rules, scope: None, display: &cwd }.lint(changes)),
                Err(error) => session.load_error(&error),
            }
        }
        HookEvent::Stop => {
            if !session.root.is_dir() {
                return Ok(None);
            }
            match settings.rules() {
                Ok(rules) => {
                    let findings = Engine { settings, rules: &rules, scope: None, display: &cwd }.lint(Vec::new());
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

pub fn config_error(state_dir: &Path, event: HookEvent, input: &str, error: &anyhow::Error) -> Option<String> {
    if event == HookEvent::PreEdit {
        return None;
    }
    let payload: Payload = serde_json::from_str(input).ok()?;
    let session = Session::at(state_dir, &payload.session_id);
    std::fs::create_dir_all(&session.root).ok()?;
    std::fs::OpenOptions::new().write(true).create_new(true).open(session.root.join("config-error-reported")).ok()?;
    HookReply::Notice(format!("ai-stack lint is not checking this session because its config could not be read: {}", format!("{error:#}").trim_end())).render()
}

const CONTEXT_BUDGET: usize = 9_000;
const SNIPPET_CHARS: usize = 160;

fn post_edit_reply(findings: &[Finding]) -> HookReply {
    if findings.is_empty() {
        return HookReply::Silent;
    }
    HookReply::Context(report(
        &format!("ai-stack lint found {} problem(s) in the lines you just changed. Fix them now; errors block stopping until they are gone.", findings.len()),
        findings,
    ))
}

fn report(header: &str, findings: &[Finding]) -> String {
    let mut rules: Vec<(&str, &str)> = Vec::new();
    for finding in findings {
        if !rules.contains(&(finding.rule.as_str(), finding.message.as_str())) {
            rules.push((&finding.rule, &finding.message));
        }
    }
    let mut text = format!("{header}\n");
    for (rule, message) in rules {
        text.push_str(&format!("{rule}: {message}\n"));
    }
    for (shown, finding) in findings.iter().enumerate() {
        let snippet: String = finding.snippet.trim().chars().take(SNIPPET_CHARS).collect();
        let entry = format!("{}:{}:{} {} {}\n    {snippet}\n", finding.path, finding.line, finding.column, finding.severity.as_str(), finding.rule);
        if text.len() + entry.len() > CONTEXT_BUDGET {
            text.push_str(&format!("and {} more\n", findings.len() - shown));
            break;
        }
        text.push_str(&entry);
    }
    text
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
            let occurrence = seen.entry((finding.rule.clone(), finding.file.clone(), finding.text.clone())).or_insert(0);
            let fingerprint = format!("{}\u{0}{}\u{0}{}\u{0}{occurrence}", finding.rule, finding.file.display(), finding.text);
            *occurrence += 1;
            (fingerprint, finding)
        })
        .collect()
}

fn decide(state: &mut StopState, active: bool, findings: Vec<Finding>) -> HookReply {
    if !active {
        state.blocks = 0;
    }
    let errors = fingerprinted(findings.into_iter().filter(|finding| finding.severity == Severity::Error).collect());
    state.acknowledged.retain(|fingerprint| errors.iter().any(|(present, _)| present == fingerprint));
    let (current, blocking): (BTreeSet<String>, Vec<Finding>) = errors.into_iter().filter(|(fingerprint, _)| !state.acknowledged.contains(fingerprint)).unzip();
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
    HookReply::Block(report("ai-stack lint: fix these errors in lines you changed this session before stopping. If one must stay, say why in your reply.", &blocking))
}

fn edited(harness: Harness, payload: &Payload, cwd: &Path) -> Vec<PathBuf> {
    let absolute = |path: &str| paths::normalize(&cwd.join(path.trim()));
    match harness {
        Harness::Claude => payload.tool_input.get("file_path").and_then(Value::as_str).map(absolute).into_iter().collect(),
        Harness::Codex => {
            let patch = payload.tool_input.get("command").and_then(Value::as_str).or_else(|| payload.tool_input.as_str()).unwrap_or_default();
            let headers = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];
            patch.lines().filter_map(|line| headers.iter().find_map(|prefix| line.strip_prefix(prefix))).map(absolute).collect()
        }
    }
}

struct Session {
    root: PathBuf,
}

impl Session {
    fn at(state_dir: &Path, session: &str) -> Session {
        Session { root: state_dir.join(session_name(session)) }
    }

    fn open(state_dir: &Path, session: &str) -> Result<Session> {
        std::fs::create_dir_all(state_dir).with_context(|| format!("creating {}", state_dir.display()))?;
        let opened = Session::at(state_dir, session);
        match std::fs::create_dir(&opened.root) {
            Ok(()) => prune(state_dir, &opened.root),
            Err(err) if err.kind() == ErrorKind::AlreadyExists => {}
            Err(err) => return Err(err).with_context(|| format!("creating {}", opened.root.display())),
        }
        Ok(opened)
    }

    fn keep_alive(&self) {
        if let Ok(root) = std::fs::File::open(&self.root) {
            let _ = root.set_modified(SystemTime::now());
        }
    }

    fn load_error(&self, error: &anyhow::Error) -> HookReply {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(self.root.join("load-error-reported")) {
            Ok(_) => HookReply::Notice(format!("ai-stack lint could not load its rules, so it is not checking this session: {error:#}")),
            Err(_) => HookReply::Silent,
        }
    }

    fn stop_state(&self) -> StopState {
        std::fs::read(self.root.join("stop.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    fn save_stop_state(&self, state: &StopState) -> Result<()> {
        let mut staged = tempfile::NamedTempFile::new_in(&self.root)?;
        serde_json::to_writer(&mut staged, state)?;
        staged.persist(self.root.join("stop.json"))?;
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

    fn payload(session: &str, cwd: &Path, tool_input: Value, active: bool) -> String {
        json!({"session_id": session, "cwd": cwd, "hook_event_name": "x", "tool_input": tool_input, "stop_hook_active": active}).to_string()
    }

    fn finding(path: &str, line: u32) -> Finding {
        Finding {
            file: Path::new("/w").join(path),
            path: path.into(),
            rule: "no-comments".into(),
            severity: Severity::Error,
            line,
            column: 1,
            end_line: line + 2,
            message: "m".into(),
            snippet: "/**".into(),
            text: format!("/**\n * {line}\n */"),
        }
    }

    #[test]
    fn claude_and_codex_payloads_name_every_edited_file() {
        let cwd = Path::new("/w");
        let claude: Payload = serde_json::from_str(&payload("s", cwd, json!({"file_path": "/w/a.ts", "old_string": "x"}), false)).unwrap();
        assert_eq!(edited(Harness::Claude, &claude, cwd), [PathBuf::from("/w/a.ts")]);
        let patch = "*** Begin Patch\n*** Add File: new.ts\n+x\n*** Update File: src/old.ts\n*** Move to: src/moved.ts\n@@\n-a\n+b\n*** Delete File: gone.py\n*** Update File: /abs/x.rs\n@@\n*** End Patch\n";
        let codex: Payload = serde_json::from_str(&payload("s", cwd, json!({"command": patch}), false)).unwrap();
        let named: Vec<PathBuf> = ["/w/new.ts", "/w/src/old.ts", "/w/src/moved.ts", "/w/gone.py", "/abs/x.rs"].map(PathBuf::from).into();
        assert_eq!(edited(Harness::Codex, &codex, cwd), named);
    }

    #[test]
    fn stop_guard_blocks_releases_an_unchanged_set_and_reblocks_only_what_is_new_or_back() {
        let mut state = StopState::default();
        let kept = || vec![finding("a.ts", 1)];
        assert!(matches!(decide(&mut state, false, kept()), HookReply::Block(reason) if reason.contains("a.ts:1:1 error no-comments")));
        assert!(matches!(decide(&mut state, true, kept()), HookReply::Notice(message) if message.contains("a.ts:1 no-comments")));
        assert_eq!(decide(&mut state, false, kept()), HookReply::Silent, "a later turn with the same kept finding stops at once");
        let from_elsewhere = Finding { path: "../a.ts".into(), ..finding("a.ts", 1) };
        assert_eq!(decide(&mut state, false, vec![from_elsewhere]), HookReply::Silent, "the fingerprint does not depend on the cwd");
        let moved = Finding { line: 9, end_line: 11, ..finding("a.ts", 1) };
        assert_eq!(decide(&mut state, false, vec![moved]), HookReply::Silent, "the fingerprint does not depend on the line");
        let copy = Finding { line: 5, end_line: 7, ..finding("a.ts", 1) };
        assert!(matches!(decide(&mut state, false, vec![finding("a.ts", 1), copy]), HookReply::Block(reason) if reason.contains("a.ts:5") && !reason.contains("a.ts:1:")), "a new identical occurrence blocks");
        let same_first_line = Finding { line: 5, end_line: 7, text: "/**\n * other\n */".into(), ..finding("a.ts", 1) };
        assert!(matches!(decide(&mut state, false, vec![finding("a.ts", 1), same_first_line]), HookReply::Block(reason) if reason.contains("a.ts:5")), "a different block that starts the same way blocks");
        assert!(matches!(decide(&mut state, false, vec![finding("a.ts", 1), finding("b.ts", 2)]), HookReply::Block(reason) if reason.contains("b.ts:2") && !reason.contains("a.ts")));
        assert_eq!(decide(&mut state, false, Vec::new()), HookReply::Silent);
        assert!(matches!(decide(&mut state, false, kept()), HookReply::Block(_)), "a finding that went away and came back blocks again");
        let warning = Finding { severity: Severity::Warning, ..finding("w.ts", 3) };
        assert_eq!(decide(&mut StopState::default(), false, vec![warning]), HookReply::Silent);

        let mut churn = StopState::default();
        for round in 0..MAX_BLOCKS {
            assert!(matches!(decide(&mut churn, round > 0, vec![finding("c.ts", round + 1)]), HookReply::Block(_)), "round {round}");
        }
        assert!(matches!(decide(&mut churn, true, vec![finding("c.ts", 99)]), HookReply::Notice(_)), "the cap releases a set that keeps changing");
        assert_eq!(decide(&mut churn, false, Vec::new()), HookReply::Silent);

        let many: Vec<Finding> = (1..=400).map(|line| Finding { message: "x".repeat(240), snippet: format!("export const v{line} = {line}; // {}", "p".repeat(300)), ..finding("big.ts", line) }).collect();
        let text = report("header", &many);
        assert!(text.len() <= CONTEXT_BUDGET && text.matches(&"x".repeat(240)).count() == 1 && text.contains(" more\n"), "{}", text.len());
        assert_eq!(session_name("../../etc"), hex(b"../../etc"));
    }
}
