use std::fs;
use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
use std::path::Path;
use std::process::Command;
use std::os::unix::process::CommandExt as _;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

#[test]
fn incident_cli_keeps_worker_context_and_failures_out_of_the_caller() {
    let tmp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(tmp.path()).unwrap();
    let home = root.join("home");
    let project = root.join("project");
    let bin = root.join("bin");
    for path in [&home, &project, &bin] { fs::create_dir(path).unwrap(); }
    let provider = bin.join("claude");
    let script = r#"#!/bin/sh
root=@ROOT@
/bin/cat > "$root/request.json"
printf '%s\n' "$@" > "$root/argv"
/usr/bin/env > "$root/environment"
pwd > "$root/cwd"
case "$(/bin/cat "$root/mode")" in
stall)
    printf '%s\n' "$$" > "$root/worker.pid"
    exec /bin/sleep 30
    ;;
error)
    printf 'PRIVATE_HISTORY_CANARY\n' >&2
    exit 1
    ;;
invalid)
    printf '%s\n' '{"is_error":false,"subtype":"success","stop_reason":"end_turn","terminal_reason":"completed","modelUsage":{"claude-haiku-5-5":{}},"result":"{\"action\":\"new\",\"old_history\":\"PRIVATE_HISTORY_CANARY\"}"}'
    ;;
*)
    printf '%s\n' '{"is_error":false,"subtype":"success","stop_reason":"end_turn","terminal_reason":"completed","modelUsage":{"claude-haiku-5-5":{}},"result":"{\"action\":\"new\"}"}'
    ;;
esac
"#;
    let quoted = format!("'{}'", root.to_str().unwrap().replace('\'', "'\\''"));
    fs::write(&provider, script.replace("@ROOT@", &quoted)).unwrap();
    fs::set_permissions(&provider, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(root.join("mode"), "normal").unwrap();
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let command = || {
        let mut command = Command::new(env!("CARGO_BIN_EXE_ai-stack"));
        command.env_clear().env("HOME", &home)
            .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
            .env("CODEX_THREAD_ID", "PRIVATE_PARENT_SESSION")
            .env("PROJECT_CONTEXT_CANARY", "PRIVATE_PARENT_CONTEXT")
            .current_dir(&root).arg("--config").arg(repo.join("cli/config.default.toml"))
            .arg("--home").arg(&home).arg("--stack").arg(repo).arg("incident");
        command
    };
    let run = |args: &[&str]| command().args(args).output().unwrap();
    let init = run(&["init"]);
    assert!(init.status.success());
    let log = home.join(".local/state/ai-stack/incidents.md");
    assert_eq!(fs::metadata(&log).unwrap().mode() & 0o777, 0o600);
    let payload = root.join("submission.json");
    let mut data = json!({"occurrence_id":"first", "project_root":project, "kind":"delivered-bug",
        "problem":"missing-validation", "summary":"PRIVATE_HISTORY_CANARY: delivered CLI accepted invalid input.",
        "responsible_model":"synthetic-fixture", "harness":"synthetic-fixture", "evidence":["src/cli.mjs:42; invalid input accepted"]});
    fs::write(&payload, serde_json::to_vec(&data).unwrap()).unwrap();
    let first = run(&["record", "--file", payload.to_str().unwrap()]);
    assert!(first.status.success(), "{}", String::from_utf8_lossy(&first.stderr));
    let receipt: Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(receipt["status"], "recorded");
    let markdown = fs::read_to_string(&log).unwrap();
    let (_, record) = markdown.split_once("```json\n").unwrap();
    let record = record.split_once("\n```").unwrap().0;
    let record: Value = serde_json::from_str(record).unwrap();
    assert_eq!(record["entries"][0]["occurrences"][0]["workspace"], project.to_str().unwrap());
    let environment = fs::read_to_string(root.join("environment")).unwrap();
    assert!(!environment.contains("PRIVATE_PARENT_SESSION"));
    assert!(!environment.contains("PRIVATE_PARENT_CONTEXT"));
    assert!(environment.lines().any(|line| line.starts_with("USER=")));
    let cwd = fs::read_to_string(root.join("cwd")).unwrap();
    assert_ne!(Path::new(cwd.trim()), project);
    let original = fs::read(&log).unwrap();
    fs::write(root.join("mode"), "error").unwrap();
    let replay = run(&["record", "--file", payload.to_str().unwrap()]);
    assert!(replay.status.success());
    assert_eq!(serde_json::from_slice::<Value>(&replay.stdout).unwrap()["status"], "already_recorded");
    assert_eq!(fs::read(&log).unwrap(), original);
    for mode in ["error", "invalid"] {
        fs::write(root.join("mode"), mode).unwrap();
        data["occurrence_id"] = json!(mode);
        fs::write(&payload, serde_json::to_vec(&data).unwrap()).unwrap();
        let failed = run(&["record", "--file", payload.to_str().unwrap()]);
        assert!(!failed.status.success());
        assert_eq!(serde_json::from_slice::<Value>(&failed.stdout).unwrap()["status"], "failed");
        assert!(!String::from_utf8_lossy(&failed.stdout).contains("PRIVATE_HISTORY_CANARY"));
        assert!(!String::from_utf8_lossy(&failed.stderr).contains("PRIVATE_HISTORY_CANARY"));
        assert_eq!(fs::read(&log).unwrap(), original);
    }
    assert!(run(&["init"]).status.success());
    assert_eq!(fs::read(&log).unwrap(), original);
    fs::write(root.join("mode"), "stall").unwrap();
    for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP] {
        data["occurrence_id"] = json!(format!("cancel-{signal}"));
        fs::write(&payload, serde_json::to_vec(&data).unwrap()).unwrap();
        let marker = root.join("worker.pid");
        let _ = fs::remove_file(&marker);
        let mut child = command().args(["record", "--file", payload.to_str().unwrap()])
            .process_group(0).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        let started = Instant::now();
        while !marker.exists() {
            if started.elapsed() > Duration::from_secs(10) { child.kill().unwrap(); panic!("Worker did not start"); }
            std::thread::sleep(Duration::from_millis(10));
        }
        let pid: i32 = fs::read_to_string(&marker).unwrap().trim().parse().unwrap();
        let workspace = fs::read_to_string(root.join("cwd")).unwrap();
        let target = if signal == libc::SIGINT { -(child.id() as i32) } else { child.id() as i32 };
        assert_eq!(unsafe { libc::kill(target, signal) }, 0);
        let cancelled = Instant::now();
        while child.try_wait().unwrap().is_none() {
            if cancelled.elapsed() > Duration::from_secs(10) {
                unsafe { libc::kill(-pid, libc::SIGKILL); }
                child.kill().unwrap();
                panic!("Cancellation did not stop the worker");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let output = child.wait_with_output().unwrap();
        assert_eq!(output.status.code(), Some(130));
        assert_eq!(serde_json::from_slice::<Value>(&output.stdout).unwrap()["code"], "cancelled");
        assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
        assert!(!Path::new(workspace.trim()).exists());
        assert_eq!(fs::read(&log).unwrap(), original);
    }
}
