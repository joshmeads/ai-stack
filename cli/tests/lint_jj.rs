use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{Value, json};

const EXE: &str = env!("CARGO_BIN_EXE_ai-stack");

fn stack() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().display().to_string()
}

struct Sandbox {
    _dir: tempfile::TempDir,
    root: PathBuf,
    home: PathBuf,
    jj_config: PathBuf,
}

impl Sandbox {
    fn new() -> Sandbox {
        let dir = tempfile::Builder::new().prefix("lint-jj").tempdir_in(env!("CARGO_TARGET_TMPDIR")).unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let home = root.join("home");
        fs::create_dir_all(home.join(".config/ai-stack")).unwrap();
        fs::write(home.join(".config/ai-stack/config.toml"), format!("[stack]\npath = {:?}\n", stack())).unwrap();
        let jj_config = root.join("jj.toml");
        fs::write(&jj_config, "user.name = \"t\"\nuser.email = \"t@t\"\n[fix.tools.shout]\ncommand = [\"tr\", \"a-z\", \"A-Z\"]\npatterns = [\"glob:'**/*.ts'\"]\n").unwrap();
        Sandbox { _dir: dir, root, home, jj_config }
    }

    fn command(&self, program: &str, dir: &Path) -> Command {
        let mut command = Command::new(program);
        for (name, _) in std::env::vars_os() {
            let name = name.to_string_lossy().into_owned();
            if name.starts_with("GIT_") || name.starts_with("AI_STACK_") || name.starts_with("JJ_") {
                command.env_remove(name);
            }
        }
        command.current_dir(dir).env("HOME", &self.home).env("JJ_CONFIG", &self.jj_config).env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_CONFIG_GLOBAL", "/dev/null");
        command
    }

    fn jj(&self, dir: &Path, args: &[&str]) -> String {
        let output = self.command("jj", dir).args(["--quiet", "--no-pager", "--color=never"]).args(args).output().unwrap();
        assert!(output.status.success(), "jj {args:?}: {}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn hook(&self, dir: &Path, payload: Value) -> Value {
        let mut hook = self.command(EXE, dir).args(["--home", self.home.to_str().unwrap(), "--stack", &stack(), "lint", "hook", "claude"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        std::io::Write::write_all(&mut hook.stdin.take().unwrap(), payload.to_string().as_bytes()).unwrap();
        serde_json::from_slice(&hook.wait_with_output().unwrap().stdout).unwrap_or(Value::Null)
    }

    fn agent_writes(&self, repo: &Path, rel: &str, text: &str) {
        fs::write(repo.join(rel), text).unwrap();
        self.hook(repo, json!({"hook_event_name": "PostToolUse", "tool_name": "Write", "cwd": repo, "tool_input": {"file_path": repo.join(rel), "content": text}}));
    }

    fn agent_runs(&self, repo: &Path, event: &str, command: &str) -> Value {
        self.hook(repo, json!({"hook_event_name": event, "tool_name": "Bash", "cwd": repo, "tool_input": {"command": command}}))
    }

    fn agent_commits(&self, repo: &Path, args: &[&str]) -> Value {
        let command = format!("jj {}", args.join(" "));
        self.agent_runs(repo, "PreToolUse", &command);
        self.jj(repo, args);
        self.agent_runs(repo, "PostToolUse", &command)
    }

    fn commit_of(&self, repo: &Path, revision: &str) -> String {
        self.jj(repo, &["log", "--no-graph", "-r", revision, "-T", "commit_id"])
    }

    fn events(&self) -> Vec<Value> {
        let text = fs::read_to_string(self.home.join(".local/state/ai-stack/lint/events.jsonl")).unwrap_or_default();
        text.lines().map(|line| serde_json::from_str(line).unwrap()).collect()
    }
}

const SLEEP: &str = "test(\"t\", async () => {\n  await new Promise((r) => setTimeout(r, 500));\n});\n";

#[test]
fn jj_commits_lose_the_agents_prose_and_a_push_with_an_unfixable_error_is_denied_unless_a_narrow_skip_names_it() {
    let s = Sandbox::new();
    for layout in ["--colocate", "--no-colocate"] {
        let remote = s.root.join(format!("remote{layout}.git"));
        assert!(s.command("git", &s.root).args(["init", "-q", "--bare", remote.to_str().unwrap()]).status().unwrap().success());
        let repo = s.root.join(format!("repo{layout}"));
        s.jj(&s.root, &["git", "init", layout, repo.to_str().unwrap()]);
        s.jj(&repo, &["git", "remote", "add", "origin", remote.to_str().unwrap()]);
        fs::write(repo.join("a.ts"), "export const a = 1;\n").unwrap();
        s.jj(&repo, &["commit", "-m", "base"]);
        s.jj(&repo, &["bookmark", "create", "main", "-r", "@-"]);
        s.jj(&repo, &["git", "push", "--bookmark", "main"]);

        s.agent_writes(&repo, "h.ts", "export const h = 1;\n// agent prose the human chose to keep\n");
        s.jj(&repo, &["commit", "-m", "human"]);
        let human = s.commit_of(&repo, "@-");
        fs::write(repo.join("a.ts"), "export const a = 2;\n// agent prose about the total\n").unwrap();
        s.jj(&repo, &["commit", "-m", "side"]);
        s.jj(&repo, &["bookmark", "create", "side", "-r", "@-"]);
        let side = s.commit_of(&repo, "side");
        s.jj(&repo, &["new", &human]);

        s.agent_writes(&repo, "a.ts", "export const a = 2;\n// agent prose about the total\n");
        fs::write(repo.join("b.ts"), "export const b = 2;\n// The ledger rejects fractional cents.\n").unwrap();
        let after = s.agent_commits(&repo, &["commit", "-m", "work"]);
        assert_eq!(after["hookSpecificOutput"]["additionalContext"], "ai-stack lint: removed 1 comment in a.ts", "{layout}");
        assert_eq!(s.jj(&repo, &["file", "show", "-r", "@-", "a.ts"]), "export const a = 2;\n", "{layout}: the commit is rewritten");
        assert_eq!(fs::read_to_string(repo.join("a.ts")).unwrap(), "export const a = 2;\n", "{layout}: the working copy follows");
        assert_eq!(s.jj(&repo, &["file", "show", "-r", "@-", "b.ts"]), "export const b = 2;\n// The ledger rejects fractional cents.\n", "{layout}: a human's comment stays, and the user's own fix tools never run");
        assert_eq!(s.jj(&repo, &["diff", "--summary"]), "", "{layout}: the working copy is consistent");
        assert_eq!((s.commit_of(&repo, "@--"), s.commit_of(&repo, "side")), (human, side), "{layout}: the human's commit and the sibling branch are never rewritten");
        assert!(s.jj(&repo, &["file", "show", "-r", "side", "a.ts"]).contains("agent prose about the total"));

        s.agent_writes(&repo, "a.test.ts", SLEEP);
        assert_eq!(s.agent_commits(&repo, &["commit", "-m", "sleep"])["hookSpecificOutput"]["additionalContext"], "ai-stack lint: a.test.ts:2 no-fixed-sleep (fix before pushing)");
        s.jj(&repo, &["bookmark", "set", "main", "-r", "@-"]);
        s.agent_writes(&repo, "wip.test.ts", SLEEP);
        let described = s.agent_commits(&repo, &["describe", "-m", "wip"]);
        assert!(described["hookSpecificOutput"]["additionalContext"].as_str().unwrap().contains("wip.test.ts:2 no-fixed-sleep"), "{described}");
        let denied = s.agent_runs(&repo, "PreToolUse", "jj git push --bookmark main");
        let reason = denied["hookSpecificOutput"]["permissionDecisionReason"].as_str().unwrap_or_default();
        assert!(denied["hookSpecificOutput"]["permissionDecision"] == "deny" && reason.starts_with("a.test.ts:2 no-fixed-sleep: ") && reason.ends_with("Fix these, or push with AI_STACK_LINT_SKIP=\"<reason>\" if a rule is wrong here."), "{denied}");
        assert!(!reason.contains("wip.test.ts"), "{layout}: the working copy is not pushed, so it is not checked: {reason}");
        assert_eq!(s.agent_runs(&repo, "PreToolUse", "git push"), Value::Null, "only jj pushes are checked here");
        assert_eq!(s.agent_runs(&repo, "PreToolUse", "jj git push --dry-run --bookmark main"), Value::Null, "a dry run is not checked");

        let skipped = s.agent_runs(&repo, "PreToolUse", "AI_STACK_LINT_SKIP=\"the device has no event\" jj git push --bookmark main");
        assert!(skipped["hookSpecificOutput"].get("permissionDecision").is_none(), "{skipped}");
        assert!(skipped["hookSpecificOutput"]["additionalContext"].as_str().unwrap().starts_with("ai-stack lint: skip recorded for a.test.ts:2 no-fixed-sleep (the device has no event)."));
        let last = s.events().pop().unwrap();
        assert_eq!((&last["kind"], &last["vcs"], &last["harness"], &last["reason"]), (&json!("skip"), &json!("jj"), &json!("claude"), &json!("the device has no event")));
        assert_eq!(last["head"].as_str().unwrap(), s.jj(&repo, &["log", "--no-graph", "-r", "@-", "-T", "commit_id"]), "the skip names the newest commit it let through");
    }
    let report = s.command(EXE, &s.root).args(["--home", s.home.to_str().unwrap(), "--stack", &stack(), "lint", "skips"]).output().unwrap();
    let report = String::from_utf8_lossy(&report.stdout);
    assert!(report.contains("(including 2 jj pushes)") && report.contains("claude jj push"), "{report}");
}
