use std::collections::BTreeSet;
use std::io::ErrorKind;
use std::os::unix::ffi::OsStrExt as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use super::repo::{Repo, Repos, Snapshot, nul_joined, nul_paths, path_of};
use super::scan::{Change, Engine, language_of};
use super::{Baseline, Finding, Settings, Severity};
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
    hook_event_name: Option<String>,
    #[serde(default)]
    cwd: Option<PathBuf>,
    #[serde(default)]
    tool_input: Value,
    #[serde(default)]
    stop_hook_active: bool,
}

impl Payload {
    fn is_subagent(&self) -> bool {
        self.agent_id.is_some() || self.hook_event_name.as_deref() == Some("SubagentStop")
    }
}

pub fn run(harness: Harness, event: HookEvent, settings: &Settings, input: &str) -> Result<Option<String>> {
    if !settings.enabled {
        return Ok(None);
    }
    let payload: Payload = serde_json::from_str(input).context("hook payload is not the expected JSON")?;
    if event == HookEvent::Stop && payload.is_subagent() {
        return Ok(None);
    }
    let cwd = payload.cwd.clone().unwrap_or_else(|| PathBuf::from("/"));
    let session = Session::at(&settings.state_dir, &payload.session_id);
    session.keep_alive();
    let lint = |changes| settings.rules().map(|rules| Engine { settings, rules: &rules, scope: None, display: &cwd }.lint(changes));
    let reply = match event {
        HookEvent::PreEdit => {
            let edited = by_repo(settings, edited(harness, &payload, &cwd));
            if edited.is_empty() {
                return Ok(None);
            }
            let session = Session::open(&settings.state_dir, &payload.session_id)?;
            for (repo, _) in &edited {
                session.baseline(repo)?;
            }
            HookReply::Silent
        }
        HookEvent::PostEdit => {
            let edited = by_repo(settings, edited(harness, &payload, &cwd));
            if edited.is_empty() {
                return Ok(None);
            }
            let session = Session::open(&settings.state_dir, &payload.session_id)?;
            let mut changes = Vec::new();
            for (repo, files) in &edited {
                let since = session.baseline(repo)?.changes(repo)?;
                changes.extend(since.into_iter().filter(|(path, _)| files.contains(path)).filter_map(|(path, baseline)| Change::read(path, &baseline)));
            }
            if changes.is_empty() {
                return Ok(None);
            }
            match lint(changes) {
                Ok(findings) => post_edit_reply(&findings),
                Err(error) => session.load_error(&error),
            }
        }
        HookEvent::Stop => {
            let turns = session.turns();
            if turns.is_empty() && !session.root.join(STOP_STATE).exists() {
                return Ok(None);
            }
            let reply = stop(&session, &turns, payload.stop_hook_active, lint);
            if !matches!(reply, Ok(HookReply::Block(_))) {
                session.close_turn();
            }
            reply?
        }
    };
    Ok(reply.render())
}

fn stop(session: &Session, turns: &[(Repo, Turn)], active: bool, lint: impl FnOnce(Vec<Change>) -> Result<Vec<Finding>>) -> Result<HookReply> {
    let mut changes = Vec::new();
    for (repo, turn) in turns {
        changes.extend(turn.changes(repo)?.into_iter().filter_map(|(path, baseline)| Change::read(path, &baseline)));
    }
    let findings = if changes.is_empty() {
        Vec::new()
    } else {
        match lint(changes) {
            Ok(findings) => findings,
            Err(error) => return Ok(session.load_error(&error)),
        }
    };
    let mut state = session.stop_state();
    let reply = decide(&mut state, active, findings);
    session.save_stop_state(&state)?;
    Ok(reply)
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

fn fingerprint(finding: &Finding) -> String {
    format!("{}\u{0}{}\u{0}{}\u{0}{}", finding.rule, finding.file.display(), finding.text, finding.occurrence)
}

fn decide(state: &mut StopState, active: bool, findings: Vec<Finding>) -> HookReply {
    if !active {
        state.blocks = 0;
    }
    let errors: Vec<(String, Finding)> = findings.into_iter().filter(|finding| finding.severity == Severity::Error).map(|finding| (fingerprint(&finding), finding)).collect();
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
    HookReply::Block(report("ai-stack lint: fix these errors in lines changed this turn before stopping. If one must stay, say why in your reply.", &blocking))
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

fn by_repo(settings: &Settings, files: Vec<PathBuf>) -> Vec<(Repo, Vec<PathBuf>)> {
    let mut repos = Repos::default();
    let mut grouped: Vec<(Repo, Vec<PathBuf>)> = Vec::new();
    for file in files.into_iter().filter(|file| language_of(file).is_some() && settings.lints(file)) {
        let Some(repo) = repos.of(&file) else { continue };
        let Some(rel) = repo.relative(&file) else { continue };
        let file = repo.root.join(rel);
        match grouped.iter_mut().find(|(known, _)| *known == repo) {
            Some((_, files)) => files.push(file),
            None => grouped.push((repo, vec![file])),
        }
    }
    grouped
}

const STOP_STATE: &str = "stop.json";

struct Turn {
    dir: PathBuf,
    snapshot: Snapshot,
}

impl Turn {
    fn load(dir: &Path) -> Option<Turn> {
        let tree = String::from_utf8(std::fs::read(dir.join("tree")).ok()?).ok()?;
        let skipped = nul_paths(&std::fs::read(dir.join("skipped")).ok()?).collect();
        Some(Turn { dir: dir.to_path_buf(), snapshot: Snapshot { tree, skipped } })
    }

    fn changes(&self, repo: &Repo) -> Result<Vec<(PathBuf, Baseline)>> {
        repo.changes_since(&self.snapshot, &self.dir.join("objects"))
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

    fn turn_dir(&self) -> PathBuf {
        self.root.join("turn")
    }

    fn baseline(&self, repo: &Repo) -> Result<Turn> {
        let dir = self.turn_dir().join(hex(repo.root.as_os_str().as_bytes()));
        if let Some(turn) = Turn::load(&dir) {
            return Ok(turn);
        }
        std::fs::create_dir_all(self.turn_dir())?;
        let staged = tempfile::Builder::new().prefix(".capture").tempdir_in(self.turn_dir())?;
        let snapshot = repo.snapshot(&staged.path().join("objects"))?;
        std::fs::write(staged.path().join("root"), repo.root.as_os_str().as_bytes())?;
        std::fs::write(staged.path().join("skipped"), nul_joined(&snapshot.skipped))?;
        std::fs::write(staged.path().join("tree"), &snapshot.tree)?;
        if std::fs::rename(staged.path(), &dir).is_ok() {
            let _ = staged.keep();
        }
        Turn::load(&dir).with_context(|| format!("reading the turn baseline in {}", dir.display()))
    }

    fn turns(&self) -> Vec<(Repo, Turn)> {
        let Ok(entries) = std::fs::read_dir(self.turn_dir()) else { return Vec::new() };
        let mut turns: Vec<(Repo, Turn)> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| !entry.file_name().as_bytes().starts_with(b"."))
            .filter_map(|entry| {
                let root = path_of(&std::fs::read(entry.path().join("root")).ok()?);
                let repo = Repo::discover(&root).filter(|repo| repo.root == root)?;
                Some((repo, Turn::load(&entry.path())?))
            })
            .collect();
        turns.sort_by(|(a, _), (b, _)| a.root.cmp(&b.root));
        turns
    }

    fn close_turn(&self) {
        let _ = std::fs::remove_dir_all(self.turn_dir());
    }

    fn stop_state(&self) -> StopState {
        std::fs::read(self.root.join(STOP_STATE)).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    fn save_stop_state(&self, state: &StopState) -> Result<()> {
        let mut staged = tempfile::NamedTempFile::new_in(&self.root)?;
        serde_json::to_writer(&mut staged, state)?;
        staged.persist(self.root.join(STOP_STATE))?;
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
            end_line: line + 2,
            message: "m".into(),
            snippet: "/**".into(),
            text: format!("/**\n * {line}\n */"),
            occurrence: 0,
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
        let copy = Finding { line: 5, end_line: 7, occurrence: 1, ..finding("a.ts", 1) };
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

    #[test]
    fn a_turn_owns_what_changed_since_its_first_edit_through_formatters_renames_commits_failed_edits_and_subagents() {
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
        let edit = |event, file: &str| hook(Harness::Claude, event, payload("s", &repo, json!({"file_path": repo.join(file)}), false));
        let stop = |input: String| hook(Harness::Claude, HookEvent::Stop, input);
        let lead_stop = |active| stop(payload("s", &repo, Value::Null, active));

        assert_eq!(edit(HookEvent::PreEdit, "foo.ts"), None);
        put(&repo.join("foo.ts"), &human.replace("export const v2 = 2;\n", "export const v2 = [1, 2].map((n) => n * 2).length; // agent prose\n"));
        let context = edit(HookEvent::PostEdit, "foo.ts").unwrap();
        assert!(context.contains("PostToolUse") && context.contains("foo.ts:2:") && !context.contains("foo.ts:8:"), "{context}");

        let child_edit = |event| hook(Harness::Claude, event, subagent("worker", payload("s", &repo, json!({"file_path": repo.join("bar.ts")}), false)));
        assert_eq!(child_edit(HookEvent::PreEdit), None);
        put(&repo.join("bar.ts"), "export const bar = 1; // child prose\n");
        assert!(child_edit(HookEvent::PostEdit).is_some_and(|context| context.contains("bar.ts:1:")));
        assert_eq!(stop(subagent("worker", payload("s", &repo, Value::Null, false))), None, "a subagent's stop is silent");
        let mut named_only: Value = serde_json::from_str(&payload("s", &repo, Value::Null, false)).unwrap();
        named_only["hook_event_name"] = json!("SubagentStop");
        assert_eq!(stop(named_only.to_string()), None);

        let failed_move = "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-export const gone = 1;\n+export const moved = 1;\n*** End Patch\n";
        assert_eq!(hook(Harness::Codex, HookEvent::PreEdit, payload("s", &repo, json!({"command": failed_move}), false)), None);

        edit(HookEvent::PreEdit, "helper.spec.ts");
        put(&repo.join("helper.spec.ts"), "export const helper = 1; // helper prose\n");
        assert!(edit(HookEvent::PostEdit, "helper.spec.ts").is_some_and(|context| context.contains("test-file-names")));
        std::fs::rename(repo.join("helper.spec.ts"), repo.join("helper.test.ts")).unwrap();
        put(&repo.join("foo.ts"), &human.replace("export const v2 = 2;\n", "export const v2 = [1, 2]\n  .map((n) => n * 2)\n  .length; // agent prose\n"));
        git(&repo, &["commit", "-qam", "the agent commits"]);

        let blocked: Value = serde_json::from_str(&lead_stop(false).unwrap()).unwrap();
        let reason = blocked["reason"].as_str().unwrap();
        assert_eq!(blocked["decision"], "block");
        let located: Vec<&str> = reason.lines().filter(|line| line.contains(" error ")).collect();
        assert_eq!(located, ["bar.ts:1:23 error no-comments", "foo.ts:4:12 error no-comments", "helper.test.ts:1:26 error no-comments"], "{reason}");
        assert!(lead_stop(true).unwrap().contains("systemMessage"), "the loop guard releases an unchanged set");

        put(&repo.join("foo.ts"), &(std::fs::read_to_string(repo.join("foo.ts")).unwrap() + "// human between turns\n"));
        assert_eq!(lead_stop(false), None, "a human's edit between turns is not the agent's");
        assert_eq!(edit(HookEvent::PreEdit, "foo.ts"), None);
        let current = std::fs::read_to_string(repo.join("foo.ts")).unwrap();
        put(&repo.join("foo.ts"), &current.replace("export const v1 = 1;", "export const v1 = 100;"));
        assert_eq!(edit(HookEvent::PostEdit, "foo.ts"), None);
        assert_eq!(lead_stop(false), None, "the next turn's baseline holds every earlier line");
    }

    #[test]
    fn a_disabled_project_stores_nothing_and_missing_rules_are_reported_once_and_close_the_turn() {
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
        assert!(!broken.state_dir.join("s/turn").exists() && !broken.state_dir.join("s").join(STOP_STATE).exists());

        let bad = anyhow::anyhow!("unknown field `scopes`");
        let reported = |event| config_error(&broken.state_dir, event, &payload("typo", &repo, Value::Null, false), &bad);
        assert_eq!(reported(HookEvent::PreEdit), None);
        assert!(reported(HookEvent::PostEdit).is_some_and(|notice| notice.contains("unknown field `scopes`")));
        assert_eq!(reported(HookEvent::Stop), None, "a config error is reported once per session");

        let old = broken.state_dir.join("s");
        std::fs::File::open(&old).unwrap().set_modified(SystemTime::now() - 2 * STALE_AFTER).unwrap();
        hook(HookEvent::Stop);
        run(Harness::Claude, HookEvent::PreEdit, &broken, &payload("fresh", &repo, edit.clone(), false)).unwrap();
        assert!(old.is_dir(), "pruning deleted a session that is still running");
    }
}
