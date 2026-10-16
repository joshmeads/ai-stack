use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::exec::{self, Exec, Ran};

pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub binary: &'static str,
    pub login: Login,
    pub status: &'static [&'static str],
    parser: fn(&Ran) -> State,
    expiry: Option<ExpirySource>,
}

pub enum Login {
    Supported(&'static [&'static str]),
    Unsupported(&'static str),
}

struct ExpirySource {
    env: &'static str,
    directory: &'static str,
    file: &'static str,
    reader: fn(&Value) -> Option<Expiry>,
}

pub const PROVIDERS: &[Provider] = &[
    Provider { id: "claude", name: "Claude Code", binary: "claude", login: Login::Supported(&["claude", "auth", "login"]), status: &["auth", "status", "--json"], parser: claude, expiry: if cfg!(target_os = "linux") { Some(ExpirySource { env: "CLAUDE_CONFIG_DIR", directory: ".claude", file: ".credentials.json", reader: claude_expiry }) } else { None } },
    Provider { id: "codex", name: "Codex", binary: "codex", login: Login::Supported(&["codex", "login", "--device-auth"]), status: &["login", "status"], parser: codex, expiry: Some(ExpirySource { env: "CODEX_HOME", directory: ".codex", file: "auth.json", reader: codex_expiry }) },
    Provider { id: "cursor", name: "Cursor Agent", binary: "cursor-agent", login: Login::Supported(&["env", "NO_OPEN_BROWSER=1", "cursor-agent", "login"]), status: &["status", "--format", "json"], parser: cursor, expiry: None },
    Provider { id: "opencode", name: "OpenCode", binary: "opencode", login: Login::Supported(&["opencode", "auth", "login"]), status: &["auth", "list"], parser: opencode, expiry: None },
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum State {
    LoggedIn {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        account: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        expires_at: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        expiry_source: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        refresh_available: Option<bool>,
    },
    LoggedOut,
    NotInstalled,
    Unknown { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub provider: String,
    pub state: State,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireReport {
    id: String,
    state: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    expiry_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    refresh_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    reason: Option<String>,
}

impl Serialize for Report {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serde_json::to_value(&self.state).map_err(serde::ser::Error::custom)?;
        value.as_object_mut().unwrap().insert("id".into(), self.provider.clone().into());
        value.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Report {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        let wire = WireReport::deserialize(deserializer)?;
        let has_login_fields = wire.account.is_some() || wire.expires_at.is_some() || wire.expiry_source.is_some() || wire.refresh_available.is_some();
        let invalid = || serde::de::Error::custom("invalid provider status");
        let state = match wire.state.as_str() {
            "logged_in" if wire.reason.is_none() && (wire.expiry_source.is_none() || wire.expires_at.is_some()) => State::LoggedIn {
                account: wire.account, expires_at: wire.expires_at, expiry_source: wire.expiry_source, refresh_available: wire.refresh_available,
            },
            "logged_out" if !has_login_fields && wire.reason.is_none() => State::LoggedOut,
            "not_installed" if !has_login_fields && wire.reason.is_none() => State::NotInstalled,
            "unknown" if !has_login_fields => State::Unknown { reason: wire.reason.ok_or_else(invalid)? },
            _ => return Err(invalid()),
        };
        Ok(Self { provider: wire.id, state })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Status {
    pub providers: Vec<Report>,
}

fn logged_in(account: Option<&str>) -> State {
    State::LoggedIn { account: account.map(exec::one_line), expires_at: None, expiry_source: None, refresh_available: None }
}

fn unknown(reason: impl Into<String>) -> State {
    State::Unknown { reason: reason.into() }
}

fn json(ran: &Ran) -> Option<Value> {
    serde_json::from_str(&ran.stdout).ok()
}

fn claude(ran: &Ran) -> State {
    let Some(value) = json(ran) else { return unknown("unexpected status output") };
    match value.get("loggedIn").and_then(Value::as_bool) {
        Some(true) if ran.ok => logged_in(value.get("email").and_then(Value::as_str)),
        Some(false) => State::LoggedOut,
        _ => unknown("status command failed or returned unexpected output"),
    }
}

fn codex(ran: &Ran) -> State {
    for line in ran.stdout.lines().chain(ran.stderr.lines()).map(str::trim) {
        if ran.ok && (line == "Logged in using ChatGPT" || line.starts_with("Logged in using an API key")) {
            return logged_in(None);
        }
        if line == "Not logged in" { return State::LoggedOut; }
    }
    unknown("status command failed or returned unexpected output")
}

fn cursor(ran: &Ran) -> State {
    let Some(value) = json(ran) else { return unknown("unexpected status output") };
    match value.get("isAuthenticated").and_then(Value::as_bool) {
        Some(true) if ran.ok => {
            let mut state = logged_in(value.pointer("/userInfo/email").and_then(Value::as_str));
            if let State::LoggedIn { refresh_available, .. } = &mut state {
                *refresh_available = value.get("hasRefreshToken").and_then(Value::as_bool);
            }
            state
        }
        Some(false) => State::LoggedOut,
        _ => unknown("status command failed or returned unexpected output"),
    }
}

fn without_ansi(text: &str) -> String {
    let mut result = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.next() == Some('[') {
                for c in chars.by_ref() { if ('@'..='~').contains(&c) { break; } }
            }
        } else { result.push(c); }
    }
    result
}

fn opencode(ran: &Ran) -> State {
    if ran.ok {
        let text = without_ansi(&ran.stdout);
        let mut configured = None;
        for line in text.lines() {
            let words: Vec<_> = line.split_whitespace().collect();
            let count = match words.as_slice() {
                ["└", count, "credential" | "credentials"] => count.parse::<usize>().ok(),
                ["└", count, "environment", "variable" | "variables"] => count.parse::<usize>().ok(),
                _ => None,
            };
            if let Some(count) = count { configured = Some(configured.unwrap_or(0usize).saturating_add(count)); }
        }
        if let Some(count) = configured { return if count == 0 { State::LoggedOut } else { logged_in(None) }; }
    }
    unknown("status command failed or returned unexpected output")
}

struct Expiry {
    seconds: i64,
    refresh: bool,
}

fn codex_expiry(value: &Value) -> Option<Expiry> {
    if value.get("OPENAI_API_KEY").and_then(Value::as_str).is_some() { return None; }
    let tokens = value.get("tokens")?;
    let token = tokens.get("access_token")?.as_str()?;
    let payload = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
    let payload: Value = serde_json::from_slice(&payload).ok()?;
    Some(Expiry { seconds: payload.get("exp")?.as_i64()?, refresh: tokens.get("refresh_token").and_then(Value::as_str).is_some_and(|s| !s.is_empty()) })
}

fn claude_expiry(value: &Value) -> Option<Expiry> {
    let oauth = value.get("claudeAiOauth")?;
    Some(Expiry { seconds: oauth.get("expiresAt")?.as_i64()?.checked_div(1000)?, refresh: oauth.get("refreshToken").and_then(Value::as_str).is_some_and(|s| !s.is_empty()) })
}

fn read_expiry(path: &Path, reader: fn(&Value) -> Option<Expiry>) -> Result<Expiry> {
    let read = || reader(&serde_json::from_slice::<Value>(&fs::read(path).ok()?).ok()?);
    read().ok_or_else(|| anyhow!("expiry unavailable"))
}

pub fn collect(exec: &dyn Exec, home: &Path, environment: impl Fn(&str) -> Option<PathBuf>) -> Status {
    let providers = PROVIDERS.iter().map(|provider| {
        let mut state = if !exec.available(provider.binary) {
            State::NotInstalled
        } else {
            match exec.run(provider.binary, &exec::strings(provider.status), None) {
                Ok(ran) => (provider.parser)(&ran),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => State::NotInstalled,
                Err(_) => unknown(format!("cannot run {} status command", provider.name)),
            }
        };
        if let (State::LoggedIn { expires_at, expiry_source, refresh_available, .. }, Some(source)) = (&mut state, &provider.expiry) {
            let path = environment(source.env).unwrap_or_else(|| home.join(source.directory)).join(source.file);
            if let Ok(expiry) = read_expiry(&path, source.reader) {
                *expires_at = Some(expiry.seconds);
                *expiry_source = Some(source.file.into());
                *refresh_available = Some(expiry.refresh);
            }
        }
        Report { provider: provider.id.into(), state }
    }).collect();
    Status { providers }
}

pub fn now() -> i64 { time::OffsetDateTime::now_utc().unix_timestamp() }

impl Report {
    pub fn healthy(&self, now: i64) -> bool {
        match &self.state {
            State::NotInstalled => true,
            State::LoggedIn { expires_at, refresh_available, .. } => expires_at.is_none_or(|expiry| expiry > now) || *refresh_available == Some(true),
            _ => false,
        }
    }

    pub fn text(&self, now: i64) -> String {
        let detail = match &self.state {
            State::NotInstalled => "not installed".into(),
            State::LoggedOut => "logged out".into(),
            State::Unknown { reason } => format!("unknown ({})", exec::one_line(reason)),
            State::LoggedIn { account, expires_at, refresh_available, .. } => {
                let mut detail = "logged in".to_string();
                if let Some(account) = account { detail.push_str(&format!("  {}", exec::one_line(account))); }
                if let Some(expiry) = expires_at {
                    let date = time::OffsetDateTime::from_unix_timestamp(*expiry).map(|d| d.date().to_string()).unwrap_or_else(|_| "unknown date".into());
                    let relative = if *expiry <= now { "access token expired".into() } else { format!("access token expires in {}d", expiry.saturating_sub(now) / 86400) };
                    detail.push_str(&format!("  {relative} ({date})"));
                    if *refresh_available == Some(true) { detail.push_str(" (refresh available)"); }
                }
                detail
            }
        };
        format!("{:<8}  {detail}", self.provider)
    }
}

pub fn write_status(status: &Status, json: bool, now: i64, out: &mut dyn Write) -> Result<()> {
    if json { writeln!(out, "{}", serde_json::to_string(status)?)?; }
    else { for report in &status.providers { writeln!(out, "{}", report.text(now))?; } }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exec::fake::{FakeExec, ok};

    fn ran(stdout: &str, stderr: &str, code: i32) -> Ran {
        Ran { ok: code == 0, code: Some(code), stdout: stdout.into(), stderr: stderr.into() }
    }

    #[test]
    fn login_commands_are_static_safe_words_or_explicitly_unsupported() {
        for provider in PROVIDERS {
            match provider.login {
                Login::Supported(argv) => {
                    assert!(!argv.is_empty(), "{}", provider.id);
                    assert!(argv.contains(&provider.binary));
                    for word in argv {
                        assert!(!word.is_empty() && word.chars().all(|c| c.is_ascii_alphanumeric() || "/._-=".contains(c)), "{word}");
                    }
                }
                Login::Unsupported(reason) => assert!(!reason.is_empty()),
            }
        }
    }

    #[test]
    fn claude_status_samples() {
        assert_eq!(claude(&ran(r#"{"loggedIn":true,"authMethod":"claude.ai","email":"user@example.com","subscriptionType":"max"}"#, "", 0)), logged_in(Some("user@example.com")));
        assert_eq!(claude(&ran(r#"{"loggedIn":false,"authMethod":"none"}"#, "", 1)), State::LoggedOut);
        assert!(matches!(claude(&ran("garbage", "", 0)), State::Unknown { .. }));
    }

    #[test]
    fn codex_status_samples_do_not_echo_api_keys_or_warnings() {
        assert_eq!(codex(&ran("", "WARNING: PATH aliases unavailable\nLogged in using ChatGPT\n", 0)), logged_in(None));
        assert_eq!(codex(&ran("", "Logged in using an API key - sk-fake-secret\n", 0)), logged_in(None));
        assert_eq!(codex(&ran("", "Not logged in\n", 1)), State::LoggedOut);
        assert!(matches!(codex(&ran("", "failed", 1)), State::Unknown { .. }));
    }

    #[test]
    fn cursor_status_samples() {
        let state = cursor(&ran(r#"{"status":"authenticated","isAuthenticated":true,"hasAccessToken":true,"hasRefreshToken":true,"userInfo":{"email":"user@example.com"}}"#, "", 0));
        assert!(matches!(state, State::LoggedIn { account: Some(ref a), refresh_available: Some(true), .. } if a == "user@example.com"));
        assert_eq!(cursor(&ran(r#"{"status":"unauthenticated","isAuthenticated":false,"hasAccessToken":false,"hasRefreshToken":false}"#, "", 1)), State::LoggedOut);
        assert!(matches!(cursor(&ran("", "failure", 1)), State::Unknown { .. }));
    }

    #[test]
    fn opencode_status_samples() {
        let sample = "\x1b[0m\n┌  Credentials \x1b[90m~/.local/share/opencode/auth.json\n│\n●  Anthropic \x1b[90moauth\n│\n●  OpenRouter \x1b[90mapi\n│\n└  2 credentials\n";
        assert_eq!(opencode(&ran(sample, "", 0)), logged_in(None));
        assert_eq!(opencode(&ran("┌  Credentials ~/.local/share/opencode/auth.json\n│\n└  0 credentials\n", "", 0)), State::LoggedOut);
        assert_eq!(opencode(&ran("└  0 credentials\n└  1 environment variable", "", 0)), logged_in(None));
        assert!(matches!(opencode(&ran("", "FileSystem.open", 1)), State::Unknown { .. }));
    }

    #[test]
    fn expiry_readers_and_outputs_never_expose_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let payload = URL_SAFE_NO_PAD.encode(br#"{"exp":1792540800,"private":"fake-private-data"}"#);
        let token = format!("e30.{payload}.fake-signature");
        let secret = "fake-long-refresh-secret-that-must-never-appear-in-any-output";
        let value = serde_json::json!({"tokens":{"access_token":token,"refresh_token":secret}, "other_secret":secret});
        let path = dir.path().join("auth.json");
        fs::write(&path, value.to_string()).unwrap();
        let expiry = read_expiry(&path, codex_expiry).unwrap();
        assert_eq!(expiry.seconds, 1792540800);
        assert!(expiry.refresh);
        let exec = FakeExec::new(|line| {
            if line == "codex login status" { ok("Logged in using ChatGPT") }
            else { Err(std::io::Error::from(std::io::ErrorKind::NotFound)) }
        });
        let status = collect(&exec, dir.path(), |name| (name == "CODEX_HOME").then(|| dir.path().to_path_buf()));
        let mut text = Vec::new();
        write_status(&status, false, 1792540801, &mut text).unwrap();
        let text = String::from_utf8(text).unwrap();
        assert!(text.contains("logged in  access token expired (2026-10-21) (refresh available)"), "{text}");
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"expires_at\":1792540800"));
        assert!(json.contains("\"expiry_source\":\"auth.json\""));
        assert_eq!(serde_json::from_str::<Status>(&json).unwrap().providers, status.providers);
        fs::write(&path, format!("garbage {token} {secret}")).unwrap();
        let error = read_expiry(&path, codex_expiry).err().unwrap().to_string();
        assert_eq!(error, "expiry unavailable");
        for output in [&text, &json, &error] {
            assert!(!output.contains(&token));
            assert!(!output.contains(secret));
            assert!(!output.contains("fake-private-data"));
        }
        assert!(read_expiry(&dir.path().join("missing"), codex_expiry).is_err());
        fs::write(&path, r#"{"claudeAiOauth":{"expiresAt":1792540800000,"refreshToken":"fake"}}"#).unwrap();
        assert_eq!(read_expiry(&path, claude_expiry).unwrap().seconds, 1792540800);
    }

    #[test]
    fn missing_and_failing_providers_do_not_stop_collection() {
        let exec = FakeExec::new(|line| match line {
            "claude auth status --json" => Err(std::io::Error::from(std::io::ErrorKind::NotFound)),
            "codex login status" => Err(std::io::Error::other("secret diagnostic must not escape")),
            "cursor-agent status --format json" => ok(r#"{"isAuthenticated":false}"#),
            "opencode auth list" => ok("└  1 credential"),
            _ => panic!("unexpected {line}"),
        });
        let dir = tempfile::tempdir().unwrap();
        let status = collect(&exec, dir.path(), |_| None);
        assert_eq!(status.providers.len(), 4);
        assert_eq!(status.providers[0].state, State::NotInstalled);
        assert!(matches!(status.providers[1].state, State::Unknown { .. }));
        assert_eq!(status.providers[2].state, State::LoggedOut);
        assert_eq!(status.providers[3].state, logged_in(None));
        let mut output = Vec::new();
        write_status(&status, true, 0, &mut output).unwrap();
        assert_eq!(output.iter().filter(|&&c| c == b'\n').count(), 1);
        let value: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(value["providers"][0], serde_json::json!({"id":"claude","state":"not_installed"}));
        assert!(!String::from_utf8(output).unwrap().contains("secret diagnostic"));
        assert_eq!(exec.calls.borrow().len(), 4);
    }

    #[test]
    fn absent_binary_is_not_run_and_wire_states_are_validated() {
        struct Missing;
        impl Exec for Missing {
            fn interactive(&self, _: &str, _: &[String]) -> std::io::Result<Option<i32>> { panic!("must not run") }
            fn available(&self, _: &str) -> bool { false }
            fn run(&self, _: &str, _: &[String], _: Option<&Path>) -> std::io::Result<Ran> { panic!("must not run") }
        }
        let status = collect(&Missing, Path::new("/unused"), |_| panic!("must not read credentials"));
        assert!(status.providers.iter().all(|p| p.state == State::NotInstalled));
        for bad in [
            r#"{"id":"codex","state":"logged_out","expires_at":123}"#,
            r#"{"id":"codex","state":"logged_in","token":"secret"}"#,
            r#"{"id":"codex","state":"invalid"}"#,
        ] { assert!(serde_json::from_str::<Report>(bad).is_err(), "{bad}"); }
        let mut report = Report { provider: "codex".into(), state: logged_in(None) };
        assert!(report.healthy(100));
        report.state = State::LoggedIn { account: None, expires_at: Some(100), expiry_source: None, refresh_available: Some(true) };
        assert!(report.healthy(100));
        report.state = State::LoggedIn { account: None, expires_at: Some(100), expiry_source: None, refresh_available: None };
        assert!(!report.healthy(100));
        assert!(report.healthy(99));
    }
}
