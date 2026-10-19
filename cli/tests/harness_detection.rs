use std::fs;
use std::process::Command;

#[test]
fn stray_reports_skipped_harnesses_on_stderr_and_keeps_json_parseable() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path();
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_ai-stack"))
            .env_clear()
            .env("HOME", home)
            .env("PATH", home.join("empty-path"))
            .current_dir(home)
            .arg("--home").arg(home)
            .args(args).output().unwrap()
    };
    let init = run(&["init"]);
    assert!(init.status.success(), "{}", String::from_utf8_lossy(&init.stderr));
    assert_eq!(fs::read_to_string(home.join(".config/ai-stack/config.toml")).unwrap(), include_str!("../config.default.toml"));
    assert!(String::from_utf8_lossy(&init.stdout).contains("it will be skipped until installed"));
    for json in [false, true] {
        let args = if json { vec!["stray", "--json"] } else { vec!["stray"] };
        let output = run(&args);
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let stdout = String::from_utf8(output.stdout).unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(stderr.contains("skipping Claude Code: `claude` not found on PATH"), "{stderr}");
        assert!(stderr.contains("skipping Codex: `codex` not found on PATH"), "{stderr}");
        assert!(!stdout.contains("skipping"), "{stdout}");
        if json {
            let value: serde_json::Value = serde_json::from_str(&stdout).unwrap();
            assert_eq!(value["skills"], 0);
            assert_eq!(value["plugins"], 0);
        } else {
            assert!(stdout.starts_with("skills: 0  plugins: 0"), "{stdout}");
        }
    }
}
