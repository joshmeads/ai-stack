mod store;
mod worker;

use std::io::{Read as _, Write as _};
use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::config::Config;

#[cfg(test)]
mod tests;

const MAX_SUBMISSION: u64 = 8192;
const MAX_REQUEST: usize = 65_536;

pub const HELP: &str = "Record a confirmed delivered-code bug, substantially off-course work, or an evidenced recurring mistake. Exclude ordinary intermediate errors and routine failing checks.\n\nRequired JSON fields: occurrence_id, project_root, kind, problem, summary, responsible_model, harness, evidence. project_root is the affected project's absolute directory. kind is delivered-bug, off-course, or recurring-mistake. Use unknown for an unavailable model or harness. evidence contains 1-5 brief strings, such as a file:line and observed behavior. Keep the payload brief and omit secrets.\n\nGenerate occurrence_id once and reuse the saved payload on retries. The CLI captures report date, project, Git hash and dirty state. Linked worktrees share repository scope. An isolated Haiku worker sees only incident data and eligible duplicate entries in bounded pages. Duplicates increase the count and move to the top. You receive only a receipt.\n\nKeep the payload until recorded or already_recorded. busy means retry later without a tight loop. persistence_unknown means retry the exact payload. Ctrl-C, SIGTERM and SIGHUP stop the worker and return cancelled. malformed_log or request_too_large requires operator maintenance; retries alone cannot repair it.\n\nThe shared log defaults to ~/.local/state/ai-stack/incidents.md. [incidents] path overrides it; relative paths start at the user home. Haiku needs an existing Claude login and caller network/keychain permission. Luna is unavailable because its isolated CLI still exposes tools. Never open, import, search, or learn from the log.";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Kind { DeliveredBug, OffCourse, RecurringMistake }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Submission {
    occurrence_id: String,
    project_root: std::path::PathBuf,
    kind: Kind,
    problem: String,
    summary: String,
    responsible_model: String,
    harness: String,
    evidence: Vec<String>,
}

impl Submission {
    fn validate(&self) -> Result<(), Code> {
        let valid = !self.occurrence_id.is_empty() && self.occurrence_id.len() <= 128
            && self.occurrence_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
            && text(&self.problem, 80) && text(&self.summary, 600)
            && text(&self.responsible_model, 120) && text(&self.harness, 80)
            && !self.evidence.is_empty() && self.evidence.len() <= 5
            && self.evidence.iter().all(|item| text(item, 400));
        if valid && self.project_root.is_absolute() { Ok(()) } else { Err(Code::InvalidSubmission) }
    }
}

fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
enum GitState {
    Known { commit: String, dirty: bool },
    NotGit,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Occurrence {
    submission: Submission,
    reported_at: String,
    project: String,
    workspace: String,
    repository: Option<String>,
    git: GitState,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    occurrences: Vec<Occurrence>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Log {
    version: u8,
    entries: Vec<Entry>,
}

impl Default for Log {
    fn default() -> Self { Self { version: 1, entries: Vec::new() } }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Decision {
    New {},
    Duplicate { incident_id: String },
    Reject { reason: Rejection },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Rejection { Routine, Unconfirmed, Incomplete }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Code {
    InvalidSubmission,
    InputUnavailable,
    StateUnavailable,
    InvalidProject,
    Busy,
    Cancelled,
    UnsafeDestination,
    MalformedLog,
    IdentityConflict,
    RequestTooLarge,
    WorkerUnavailable,
    WorkerFailed,
    InvalidDecision,
    UnsupportedIsolation,
    ConcurrentEdit,
    PersistenceUnknown,
    Routine,
    Unconfirmed,
    Incomplete,
}

#[derive(Debug, Serialize)]
struct Receipt<'a> {
    status: &'static str,
    occurrence_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<Code>,
}

trait Worker {
    fn decide(&self, request: &Value) -> Result<Decision, Code>;
}

pub fn run(cfg: &Config, file: &Path) -> i32 {
    let submission = read_submission(file);
    let result = match &submission {
        Ok(submission) => record(&cfg.incidents.path, submission, &worker::SystemWorker {
            kind: cfg.incidents.worker,
            home: &cfg.home,
            claude_home: cfg.harnesses.iter().find(|h| h.harness == crate::config::Harness::Claude).map(|h| h.home.as_path()),
        }),
        Err(code) => Err(*code),
    };
    let id = submission.as_ref().ok().map(|s| s.occurrence_id.as_str());
    let (receipt, exit) = match result {
        Ok(status) => (Receipt { status, occurrence_id: id, code: None }, 0),
        Err(code @ (Code::Routine | Code::Unconfirmed | Code::Incomplete)) =>
            (Receipt { status: "rejected", occurrence_id: id, code: Some(code) }, 2),
        Err(Code::Cancelled) => (Receipt { status: "failed", occurrence_id: id, code: Some(Code::Cancelled) }, 130),
        Err(code) => (Receipt { status: "failed", occurrence_id: id, code: Some(code) }, 1),
    };
    let mut out = std::io::stdout().lock();
    if serde_json::to_writer(&mut out, &receipt).is_err() || out.write_all(b"\n").is_err() { return 1; }
    exit
}

pub fn initialize(cfg: &Config) -> i32 {
    let result = (|| {
        let store = store::Store::lock(&cfg.incidents.path)?;
        let (log, original) = store.load()?;
        if original.is_some() { store.sync()?; } else { store.save(&log, None)?; }
        Ok::<_, Code>(())
    })();
    let receipt = Receipt { status: if result.is_ok() { "ready" } else { "failed" },
        occurrence_id: None, code: result.err() };
    let mut out = std::io::stdout().lock();
    if serde_json::to_writer(&mut out, &receipt).is_err() || out.write_all(b"\n").is_err() { return 1; }
    if receipt.code.is_some() { 1 } else { 0 }
}

fn read_submission(file: &Path) -> Result<Submission, Code> {
    let reader: Box<dyn std::io::Read> = if file == Path::new("-") {
        Box::new(std::io::stdin())
    } else {
        Box::new(std::fs::File::open(file).map_err(|_| Code::InputUnavailable)?)
    };
    let mut bytes = Vec::new();
    reader.take(MAX_SUBMISSION + 1).read_to_end(&mut bytes).map_err(|_| Code::InputUnavailable)?;
    if bytes.len() as u64 > MAX_SUBMISSION { return Err(Code::InvalidSubmission); }
    let submission: Submission = serde_json::from_slice(&bytes).map_err(|_| Code::InvalidSubmission)?;
    submission.validate()?;
    Ok(submission)
}

fn record(path: &Path, submission: &Submission, worker: &dyn Worker) -> Result<&'static str, Code> {
    submission.validate()?;
    let store = store::Store::lock(path)?;
    let (mut log, original) = store.load()?;
    for occurrence in log.entries.iter().flat_map(|entry| &entry.occurrences) {
        if occurrence.submission.occurrence_id == submission.occurrence_id {
            if occurrence.submission != *submission { return Err(Code::IdentityConflict); }
            store.sync()?;
            return Ok("already_recorded");
        }
    }
    let occurrence = observe(submission.clone())?;
    let candidates: Vec<Value> = log.entries.iter().filter(|entry| compatible(&entry.occurrences[0], &occurrence)).map(|entry| {
        let head = &entry.occurrences[0];
        json!({"id": entry.id, "kind": head.submission.kind, "problem": head.submission.problem,
               "summary": head.submission.summary, "project": head.repository.as_deref().unwrap_or(&head.project)})
    }).collect();
    let incident = json!({"kind": submission.kind, "problem": submission.problem,
        "summary": submission.summary, "evidence": submission.evidence,
        "project": occurrence.repository.as_deref().unwrap_or(&occurrence.project)});
    let entry = match classify(&incident, &candidates, worker)? {
        Decision::New {} => Entry { id: format!("i-{}", submission.occurrence_id), occurrences: vec![occurrence] },
        Decision::Duplicate { incident_id } => {
            let index = log.entries.iter().position(|entry| entry.id == incident_id).ok_or(Code::InvalidDecision)?;
            let mut entry = log.entries.remove(index);
            let head = &entry.occurrences[0];
            if !compatible(head, &occurrence) { return Err(Code::InvalidDecision); }
            entry.occurrences.insert(0, occurrence);
            entry
        },
        Decision::Reject { reason } => return Err(match reason {
            Rejection::Routine => Code::Routine,
            Rejection::Unconfirmed => Code::Unconfirmed,
            Rejection::Incomplete => Code::Incomplete,
        }),
    };
    log.entries.insert(0, entry);
    store.save(&log, original.as_deref())?;
    Ok("recorded")
}

fn classify(incident: &Value, candidates: &[Value], worker: &dyn Worker) -> Result<Decision, Code> {
    let base = serde_json::to_vec(&json!({"incident": incident, "existing": []})).map_err(|_| Code::InvalidSubmission)?.len();
    if base > MAX_REQUEST { return Err(Code::RequestTooLarge); }
    let mut end = 0;
    loop {
        let start = end;
        let mut bytes = base;
        while let Some(candidate) = candidates.get(end) {
            let size = serde_json::to_vec(candidate).map_err(|_| Code::MalformedLog)?.len() + usize::from(end > start);
            if bytes + size > MAX_REQUEST {
                if end == start { return Err(Code::RequestTooLarge); }
                break;
            }
            bytes += size;
            end += 1;
        }
        let batch = &candidates[start..end];
        let decision = worker.decide(&json!({"incident": incident, "existing": batch}))?;
        match &decision {
            Decision::Duplicate { incident_id } if !batch.iter().any(|item| item.get("id").and_then(Value::as_str) == Some(incident_id)) =>
                return Err(Code::InvalidDecision),
            Decision::New {} if end < candidates.len() => {},
            _ => return Ok(decision),
        }
    }
}

fn compatible(first: &Occurrence, next: &Occurrence) -> bool {
    first.submission.kind == next.submission.kind &&
        (next.submission.kind == Kind::RecurringMistake || match (&first.repository, &next.repository) {
            (Some(first), Some(next)) => first == next,
            (None, None) => first.workspace == next.workspace,
            _ => false,
        })
}

fn observe(submission: Submission) -> Result<Occurrence, Code> {
    let cwd = std::fs::canonicalize(&submission.project_root).map_err(|_| Code::InvalidProject)?;
    if !cwd.is_dir() { return Err(Code::InvalidProject); }
    let git = |args: &[&str]| -> Option<std::process::Output> {
        let mut command = Command::new("git");
        command.env_clear();
        if let Some(path) = std::env::var_os("PATH") { command.env("PATH", path); }
        command.env("LC_ALL", "C").env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_CONFIG_GLOBAL", "/dev/null").env("GIT_OPTIONAL_LOCKS", "0")
            .args(["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"])
            .current_dir(&cwd).args(args);
        command.output().ok()
    };
    let value = |args: &[&str]| -> Option<String> {
        let output = git(args)?;
        output.status.success().then(|| String::from_utf8(output.stdout).ok()).flatten()
    };
    let probe = git(&["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    let not_git = probe.as_ref().is_some_and(|output| output.status.code() == Some(128)
        && String::from_utf8_lossy(&output.stderr).starts_with("fatal: not a git repository"));
    let repository = probe.filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|path| std::fs::canonicalize(path.strip_suffix('\n').unwrap_or(&path)).ok()).map(|path| path.to_string_lossy().into_owned());
    let worktree = value(&["rev-parse", "--show-toplevel"]);
    let primary = repository.as_deref().map(Path::new)
        .filter(|path| path.file_name().is_some_and(|name| name == ".git")).and_then(Path::parent);
    let project = primary.or(worktree.as_deref().map(|path| path.strip_suffix('\n').unwrap_or(path)).map(Path::new)).or(Some(cwd.as_path()))
        .and_then(Path::file_name).map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "unknown".into());
    let state = match (&repository, value(&["rev-parse", "--verify", "HEAD"]),
                       value(&["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=none"])) {
        (Some(_), Some(commit), Some(status)) => GitState::Known { commit: commit.trim().into(), dirty: !status.is_empty() },
        _ if not_git => GitState::NotGit,
        _ => GitState::Unknown,
    };
    let now = time::OffsetDateTime::now_utc();
    let reported_at = format!("{}T{:02}:{:02}:{:02}Z", now.date(), now.hour(), now.minute(), now.second());
    Ok(Occurrence { submission, reported_at, project, workspace: cwd.to_string_lossy().into_owned(), repository, git: state })
}
