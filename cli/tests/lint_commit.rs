use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const EXE: &str = env!("CARGO_BIN_EXE_ai-stack");

#[derive(Clone, Copy, PartialEq, Eq)]
enum Launch {
    Human,
    Tool,
    Agent,
    AgentShellChild,
}

struct Sandbox {
    _dir: tempfile::TempDir,
    root: PathBuf,
    home: PathBuf,
}

impl Sandbox {
    fn new(config: &str) -> Sandbox {
        let dir = tempfile::Builder::new().prefix("lint-commit").tempdir_in(env!("CARGO_TARGET_TMPDIR")).unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let home = root.join("home");
        let stack = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        write(&home.join(".config/ai-stack/config.toml"), &format!("[stack]\npath = {:?}\n{config}", stack.display().to_string()));
        Sandbox { _dir: dir, root, home }
    }

    fn command(&self, dir: &Path, launch: Launch) -> Command {
        let mut command = match launch {
            Launch::Human | Launch::Tool => Command::new("git"),
            Launch::Agent => {
                let mut bash = Command::new("bash");
                bash.args(["-c", "git \"$@\"", "bash"]);
                bash
            }
            Launch::AgentShellChild => {
                let mut sh = Command::new("sh");
                sh.args(["-c", "git \"$@\"; exit $?", "sh"]);
                sh
            }
        };
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("GIT_") || name == "AI_STACK_HARNESS" || name == "AI_STACK_LINT_SKIP" {
                command.env_remove(name);
            }
        }
        command
            .current_dir(dir)
            .env("HOME", &self.home)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .env("GIT_EDITOR", "true")
            .args(["-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"]);
        if launch != Launch::Human {
            let stack = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().display().to_string();
            let exe = format!("'{EXE}' --home '{}' --stack '{stack}'", self.home.display());
            command
                .env("GIT_CONFIG_COUNT", "4")
                .env("GIT_CONFIG_KEY_0", "hook.ai-stack-lint.event")
                .env("GIT_CONFIG_VALUE_0", "pre-commit")
                .env("GIT_CONFIG_KEY_1", "hook.ai-stack-lint.command")
                .env("GIT_CONFIG_VALUE_1", format!("[ -x '{EXE}' ] || exit 0; {exe} lint pre-commit; [ $? -ne 3 ]"))
                .env("GIT_CONFIG_KEY_2", "hook.ai-stack-lint-post.event")
                .env("GIT_CONFIG_VALUE_2", "post-commit")
                .env("GIT_CONFIG_KEY_3", "hook.ai-stack-lint-post.command")
                .env("GIT_CONFIG_VALUE_3", format!("[ -x '{EXE}' ] || exit 0; exec {exe} lint post-commit"))
                .env("AI_STACK_HARNESS", "claude")
                .env("AI_STACK_LINT_ALLOW_TEMP", "1");
        }
        command
    }

    fn git(&self, dir: &Path, args: &[&str]) -> String {
        let output = self.command(dir, Launch::Human).args(args).output().unwrap();
        assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn agent(&self, dir: &Path, args: &[&str]) -> Output {
        self.command(dir, Launch::Agent).args(args).output().unwrap()
    }

    fn repo(&self, name: &str, files: &[(&str, &str)]) -> PathBuf {
        let dir = self.root.join(name);
        for (path, text) in files {
            write(&dir.join(path), text);
        }
        self.git(&self.root, &["init", "-q", dir.to_str().unwrap()]);
        self.git(&dir, &["add", "-A"]);
        self.git(&dir, &["commit", "-qm", "base"]);
        dir
    }

    fn events(&self) -> Vec<serde_json::Value> {
        let text = fs::read_to_string(self.home.join(".local/state/ai-stack/lint/events.jsonl")).unwrap_or_default();
        text.lines().map(|line| serde_json::from_str(line).unwrap()).collect()
    }
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[track_caller]
fn committed(output: &Output) -> String {
    assert!(output.status.success(), "the commit was refused: {}", stderr(output));
    stderr(output)
}

const BASE: [(&str, &str); 2] = [("a.ts", "export const a = 1;\n"), ("b.ts", "export const b = 1;\n")];
const PROSE: &str = "export const a = 2; // agent prose\n";
const FIXED: &str = "export const a = 2;\n";

#[test]
fn the_commit_hook_fixes_the_index_and_a_matching_worktree_in_every_commit_form() {
    let s = Sandbox::new("");
    let show = |dir: &Path, spec: &str| s.git(dir, &["show", spec]);
    let status = |dir: &Path| s.git(dir, &["status", "--short"]);

    let plain = s.repo("plain", &BASE);
    write(&plain.join("a.ts"), PROSE);
    s.git(&plain, &["add", "a.ts"]);
    assert!(committed(&s.agent(&plain, &["commit", "-qm", "plain"])).contains("ai-stack lint: removed 1 comment in a.ts"));
    assert_eq!((show(&plain, "HEAD:a.ts"), fs::read_to_string(plain.join("a.ts")).unwrap(), status(&plain)), (FIXED.into(), FIXED.into(), String::new()));

    let all = s.repo("all", &BASE);
    write(&all.join("a.ts"), PROSE);
    committed(&s.agent(&all, &["commit", "-qam", "all"]));
    assert_eq!((show(&all, "HEAD:a.ts"), status(&all)), (FIXED.into(), String::new()));

    let only_prose = s.repo("only-prose", &BASE);
    write(&only_prose.join("b.ts"), "export const b = 1; // agent prose\n");
    let refused = s.agent(&only_prose, &["commit", "-qam", "prose"]);
    assert!(!refused.status.success() && stderr(&refused).contains("left nothing to commit"), "{}", stderr(&refused));
    assert_eq!(s.git(&only_prose, &["rev-list", "--count", "HEAD"]), "1\n");

    for split in [false, true] {
        let pathspec = s.repo(if split { "pathspec-split" } else { "pathspec" }, &BASE);
        if split {
            s.git(&pathspec, &["config", "core.splitIndex", "true"]);
            s.git(&pathspec, &["update-index", "--split-index"]);
        }
        write(&pathspec.join("a.ts"), PROSE);
        write(&pathspec.join("b.ts"), "export const b = 2;\n");
        s.git(&pathspec, &["add", "b.ts"]);
        committed(&s.agent(&pathspec, &["commit", "-qm", "only a", "a.ts"]));
        assert_eq!((show(&pathspec, "HEAD:a.ts"), show(&pathspec, ":a.ts")), (FIXED.into(), FIXED.into()), "split index {split}");
        assert_eq!(status(&pathspec), "M  b.ts\n", "the unrelated staged change stays staged");
        write(&pathspec.join("a.ts"), "export const a = 3; // more prose\n");
        s.git(&pathspec, &["add", "a.ts"]);
        committed(&s.agent(&pathspec, &["commit", "-qm", "plain"]));
        assert_eq!(status(&pathspec), "", "split index {split}");
        s.git(&pathspec, &["fsck", "--no-progress"]);
    }

    let alternate = s.repo("alternate", &BASE);
    let index = alternate.join(".git/alternate-index");
    let mut read_tree = s.command(&alternate, Launch::Human);
    assert!(read_tree.env("GIT_INDEX_FILE", &index).args(["read-tree", "HEAD"]).status().unwrap().success());
    write(&alternate.join("a.ts"), PROSE);
    let mut pathspec = s.command(&alternate, Launch::Agent);
    committed(&pathspec.env("GIT_INDEX_FILE", &index).args(["commit", "-qm", "alternate", "--", "a.ts"]).output().unwrap());
    let mut staged = s.command(&alternate, Launch::Human);
    let staged = staged.env("GIT_INDEX_FILE", &index).args(["show", ":a.ts"]).output().unwrap();
    assert_eq!((show(&alternate, "HEAD:a.ts"), String::from_utf8_lossy(&staged.stdout).into_owned()), (FIXED.into(), FIXED.into()), "the caller's own index is fixed too");

    let partial = s.repo("partial", &BASE);
    write(&partial.join("a.ts"), PROSE);
    s.git(&partial, &["add", "a.ts"]);
    write(&partial.join("a.ts"), "export const a = 3; // agent prose\n");
    assert!(committed(&s.agent(&partial, &["commit", "-qm", "partial"])).contains("a.ts has unstaged changes, so only the staged version was fixed"));
    assert_eq!((show(&partial, "HEAD:a.ts"), fs::read_to_string(partial.join("a.ts")).unwrap()), (FIXED.into(), "export const a = 3; // agent prose\n".into()));

    let modes = s.repo("modes", &BASE);
    write(&modes.join("a.ts"), PROSE);
    fs::set_permissions(modes.join("a.ts"), fs::Permissions::from_mode(0o755)).unwrap();
    s.git(&modes, &["add", "a.ts"]);
    committed(&s.agent(&modes, &["commit", "-qm", "executable"]));
    assert!(s.git(&modes, &["ls-files", "-s", "a.ts"]).starts_with("100755"));
    assert_eq!((fs::read_to_string(modes.join("a.ts")).unwrap(), fs::metadata(modes.join("a.ts")).unwrap().permissions().mode() & 0o777), (FIXED.into(), 0o755));
    write(&modes.join("b.ts"), "export const b = 2; // prose\n");
    s.git(&modes, &["add", "b.ts"]);
    fs::set_permissions(modes.join("b.ts"), fs::Permissions::from_mode(0o755)).unwrap();
    assert!(committed(&s.agent(&modes, &["commit", "-qm", "unstaged mode"])).contains("b.ts has unstaged changes"));
    assert_eq!(show(&modes, "HEAD:b.ts"), "export const b = 2;\n");
    assert_eq!(fs::metadata(modes.join("b.ts")).unwrap().permissions().mode() & 0o777, 0o755, "an unstaged mode change is kept");

    let links = s.repo("links", &BASE);
    symlink("a.ts", links.join("link.ts")).unwrap();
    s.git(&links, &["add", "link.ts"]);
    committed(&s.agent(&links, &["commit", "-qm", "link"]));
    assert_eq!((show(&links, "HEAD:link.ts"), fs::symlink_metadata(links.join("link.ts")).unwrap().file_type().is_symlink()), ("a.ts".into(), true));
    write(&links.join("a.ts"), PROSE);
    fs::hard_link(links.join("a.ts"), links.join("shared.txt")).unwrap();
    s.git(&links, &["add", "a.ts"]);
    assert!(committed(&s.agent(&links, &["commit", "-qm", "hard link"])).contains("kept 1 comment"));
    assert_eq!((show(&links, "HEAD:a.ts"), fs::read_to_string(links.join("shared.txt")).unwrap()), (PROSE.into(), PROSE.into()), "a file with another hard link is never rewritten");

    let sparse = s.repo("sparse", &[("in/i.ts", "export const i = 1;\n"), ("out/o.ts", "export const o = 1;\n")]);
    write(&sparse.join("out/o.ts"), "export const o = 2; // prose\n");
    s.git(&sparse, &["add", "out/o.ts"]);
    s.git(&sparse, &["sparse-checkout", "set", "--cone", "--sparse-index", "in"]);
    write(&sparse.join("in/i.ts"), "export const i = 2; // prose\n");
    s.git(&sparse, &["add", "in/i.ts"]);
    assert!(committed(&s.agent(&sparse, &["commit", "-qm", "sparse"])).contains("removed 1 comment in in/i.ts; kept 1 comment"));
    assert_eq!((s.git(&sparse, &["ls-files", "-t", "out/o.ts"]), sparse.join("out/o.ts").exists()), ("S out/o.ts\n".into(), false));
    assert_eq!((show(&sparse, "HEAD:in/i.ts"), show(&sparse, "HEAD:out/o.ts")), ("export const i = 2;\n".into(), "export const o = 2; // prose\n".into()));

    let assumed = s.repo("assumed", &BASE);
    write(&assumed.join("a.ts"), PROSE);
    s.git(&assumed, &["add", "a.ts"]);
    s.git(&assumed, &["update-index", "--assume-unchanged", "a.ts"]);
    assert!(committed(&s.agent(&assumed, &["commit", "-qm", "assumed"])).contains("kept 1 comment"));
    assert_eq!((show(&assumed, "HEAD:a.ts"), s.git(&assumed, &["ls-files", "-v", "a.ts"])), (PROSE.into(), "h a.ts\n".into()), "an assume-unchanged entry is never rewritten");

    let filtered = s.repo("filtered", &[(".gitattributes", "*.js filter=keep\n"), ("x.js", "f(0);\n"), ("pointer.js", "f(0);\n")]);
    s.git(&filtered, &["config", "filter.keep.clean", "cat"]);
    s.git(&filtered, &["config", "filter.keep.smudge", "cat"]);
    write(&filtered.join("x.js"), "f(1); // prose\n");
    s.git(&filtered, &["add", "x.js"]);
    assert!(committed(&s.agent(&filtered, &["commit", "-qm", "filtered"])).contains("kept 1 comment"));
    assert_eq!(show(&filtered, "HEAD:x.js"), "f(1); // prose\n", "a filtered file is never rewritten");
    let pointer = "version https://git-lfs.github.com/spec/v1\noid sha256:6562e408f0ef0bb1e8bf6cd2bc1e6e8d0e0d5a59b9dfc0e2c8a1f3e8f0b3d2a1\nsize 42\n";
    write(&filtered.join("pointer.js"), pointer);
    s.git(&filtered, &["add", "pointer.js"]);
    committed(&s.agent(&filtered, &["commit", "-qm", "pointer"]));
    assert_eq!(show(&filtered, "HEAD:pointer.js"), pointer, "an LFS pointer is never read as code");

    let moved = s.repo("moved", &[("a.ts", "export const a = 1; // cents, never floats\n"), ("b.ts", "export const b = 1;\n")]);
    write(&moved.join("a.ts"), "export const a = 2; // cents, never floats\n");
    fs::remove_file(moved.join("b.ts")).unwrap();
    write(&moved.join("c.ts"), "export const b = 1;\n// Rate table: finance/rates.md\nexport const c = 1; // agent prose\n");
    write(&moved.join("b.ts"), "// Rate table: finance/rates.md\n");
    s.git(&moved, &["add", "-A"]);
    s.git(&moved, &["commit", "-qm", "human comment"]);
    fs::remove_file(moved.join("b.ts")).unwrap();
    write(&moved.join("a.ts"), "export const lineItems = 2; // cents, never floats\n");
    s.git(&moved, &["add", "-A"]);
    assert!(committed(&s.agent(&moved, &["commit", "-qm", "rename"])).contains("kept 1 comment"));
    assert!(show(&moved, "HEAD:a.ts").contains("// cents, never floats"), "a comment already in the file is kept when its line changes");

    let unfixable = s.repo("unfixable", &BASE);
    write(&unfixable.join("a.test.ts"), "test(\"x\", async () => {\n  await new Promise((r) => setTimeout(r, 50));\n});\n");
    s.git(&unfixable, &["add", "a.test.ts"]);
    let refused = s.agent(&unfixable, &["commit", "-qm", "sleep"]);
    assert_eq!(refused.status.code(), Some(1));
    assert!(stderr(&refused).contains("a.test.ts:2 no-fixed-sleep: ") && stderr(&refused).contains("AI_STACK_LINT_SKIP=\"<reason>\""), "{}", stderr(&refused));

    let ancestry = s.repo("ancestry", &BASE);
    write(&ancestry.join("a.ts"), PROSE);
    committed(&s.command(&ancestry, Launch::Tool).args(["commit", "-qam", "a tool calls git itself"]).output().unwrap());
    assert_eq!(show(&ancestry, "HEAD:a.ts"), PROSE, "git started by a program, not a shell, is left alone");
    write(&ancestry.join("a.ts"), &format!("{PROSE}export const c = 3; // shell child prose\n"));
    committed(&s.command(&ancestry, Launch::AgentShellChild).args(["-c", "core.hooksPath=/dev/null", "commit", "-qam", "shell child"]).output().unwrap());
    assert_eq!(show(&ancestry, "HEAD:a.ts"), format!("{PROSE}export const c = 3;\n"), "an agent turning off project hooks is still checked");
    write(&ancestry.join(".git/SQUASH_MSG"), "squash\n");
    write(&ancestry.join("a.ts"), "export const a = 4; // squashed prose\n");
    committed(&s.agent(&ancestry, &["commit", "-qam", "squash"]));
    assert_eq!(show(&ancestry, "HEAD:a.ts"), "export const a = 4; // squashed prose\n", "a squash carries other people's code");
}

#[test]
fn skips_are_narrow_and_recorded_bypasses_queue_a_notice_and_the_rate_flags_a_repository() {
    let s = Sandbox::new("[lint]\nskip_alert = { percent = 40, days = 7, min_commits = 3 }\n");
    let repo = s.repo("repo", &BASE);
    let sleep = "test(\"x\", async () => {\n  await new Promise((r) => setTimeout(r, 50)); // the poll has no event to wait on\n});\n";
    write(&repo.join("a.test.ts"), sleep);
    write(&repo.join("b.ts"), "export const b = 2;\n");
    s.git(&repo, &["add", "-A"]);
    let skip = |reason: &str, args: &[&str]| s.command(&repo, Launch::Agent).env("AI_STACK_LINT_SKIP", reason).args(args).output().unwrap();
    let refused = skip("the device has no event", &["commit", "-qm", "wide skip"]);
    assert!(!refused.status.success() && stderr(&refused).contains("a skip must be its own commit"), "{}", stderr(&refused));
    s.git(&repo, &["reset", "-q", "b.ts"]);
    let kinds = |s: &Sandbox| s.events().iter().map(|event| event["kind"].as_str().unwrap().to_string()).collect::<Vec<_>>();
    write(&repo.join(".git/hooks/commit-msg"), "#!/bin/sh\nexit 1\n");
    fs::set_permissions(repo.join(".git/hooks/commit-msg"), fs::Permissions::from_mode(0o755)).unwrap();
    assert!(!skip("the device has no event", &["commit", "-qm", "rejected"]).status.success());
    assert_eq!(kinds(&s), Vec::<String>::new(), "a commit a later hook refuses is never counted");
    fs::remove_file(repo.join(".git/hooks/commit-msg")).unwrap();
    let skipped = skip("the device has no event", &["commit", "-qm", "narrow skip"]);
    assert!(committed(&skipped).contains("skip recorded for a.test.ts:2 no-fixed-sleep, a.test.ts:2 no-comments (the device has no event)"), "{}", stderr(&skipped));
    assert_eq!(s.git(&repo, &["show", "HEAD:a.test.ts"]), sleep, "a skip commit gets no fixes");
    assert_eq!(kinds(&s), ["skip"]);
    assert_eq!(s.events()[0]["reason"], "the device has no event");
    assert_eq!(s.events()[0]["harness"], "claude");
    assert_eq!(s.events()[0]["head"].as_str().unwrap(), s.git(&repo, &["rev-parse", "HEAD"]).trim(), "the event names the commit it records");

    s.git(&repo, &["switch", "-qc", "side"]);
    write(&repo.join("c.ts"), "export const c = 1;\n");
    s.git(&repo, &["add", "c.ts"]);
    s.git(&repo, &["commit", "-qm", "side"]);
    s.git(&repo, &["switch", "-q", "main"]);
    committed(&s.agent(&repo, &["cherry-pick", "side"]));
    assert_eq!(kinds(&s), ["skip"], "a cherry-pick is never a bypass");
    write(&repo.join("b.ts"), "export const b = 3;\n");
    committed(&s.agent(&repo, &["commit", "-qam", "plain"]));
    assert_eq!(kinds(&s), ["skip", "checked"]);
    write(&repo.join("b.ts"), "export const b = 4;\n");
    committed(&s.agent(&repo, &["commit", "-qam", "clean bypass", "--no-verify"]));
    assert_eq!(kinds(&s), ["skip", "checked"], "a bypass with nothing the hook would refuse or remove is not counted");
    assert!(!s.home.join(".local/state/ai-stack/lint/notices").exists());

    write(&repo.join("b.test.ts"), "test(\"y\", async () => {\n  await new Promise((r) => setTimeout(r, 50));\n});\n");
    s.git(&repo, &["add", "b.test.ts"]);
    committed(&s.agent(&repo, &["commit", "-qm", "bypass", "--no-verify"]));
    assert_eq!(kinds(&s), ["skip", "checked", "bypassed"]);
    assert_eq!(s.events()[2]["findings"], serde_json::json!(["b.test.ts:2 no-fixed-sleep"]));
    committed(&s.agent(&repo, &["commit", "-q", "--amend", "--no-verify", "-m", "reworded"]));
    assert_eq!(kinds(&s), ["skip", "checked", "bypassed"], "an amend is charged only with what it changed");
    let hook = Command::new(EXE)
        .args(["--home", s.home.to_str().unwrap(), "lint", "hook", "claude"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let payload = serde_json::json!({"hook_event_name": "PostToolUse", "tool_name": "Bash", "cwd": repo, "tool_input": {"command": "git log"}});
    std::io::Write::write_all(&mut hook.stdin.as_ref().unwrap(), payload.to_string().as_bytes()).unwrap();
    let reply: serde_json::Value = serde_json::from_slice(&hook.wait_with_output().unwrap().stdout).unwrap();
    let notice = reply["systemMessage"].as_str().unwrap();
    assert!(notice.contains("committed") && notice.contains("without the commit check") && notice.contains("b.test.ts:2 no-fixed-sleep"), "{notice}");
    assert!(notice.contains("agents skipped or bypassed the commit check on 2 of 3 commits"), "the bypass crosses the threshold: {notice}");

    write(&repo.join("b.ts"), "export const b = 5;\n");
    assert!(committed(&s.agent(&repo, &["commit", "-qam", "while flagged"])).contains("agents skip or bypass this check often"));
    let report = Command::new(EXE).args(["--home", s.home.to_str().unwrap(), "--stack", Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_str().unwrap(), "lint", "skips"]).output().unwrap();
    let report = String::from_utf8_lossy(&report.stdout);
    assert!(report.contains("4 commits, 1 skips, 1 bypasses") && report.contains("skip: the device has no event"), "{report}");
    write(&repo.join("b.ts"), "export const b = 6; // prose the hook would remove\n");
    committed(&s.agent(&repo, &["commit", "-qam", "prose bypass", "--no-verify"]));
    assert_eq!((kinds(&s).last().unwrap().as_str(), &s.events().last().unwrap()["findings"]), ("bypassed", &serde_json::json!(["b.ts:1 no-comments"])), "prose the fixer would delete counts as a bypass");

    let events = s.home.join(".local/state/ai-stack/lint/events.jsonl");
    fs::rename(&events, s.home.join("events.saved")).unwrap();
    fs::create_dir(&events).unwrap();
    write(&repo.join("a.test.ts"), &sleep.replace("50", "60"));
    let unrecorded = skip("the device has no event", &["commit", "-qam", "unrecorded skip"]);
    assert!(!unrecorded.status.success() && stderr(&unrecorded).contains("the skip could not be recorded"), "{}", stderr(&unrecorded));
    fs::remove_dir(&events).unwrap();

    write(&repo.join("b.ts"), "export const b = 7; // moved binary\n");
    let moved = "[ -x '/nonexistent/ai-stack' ] || exit 0; '/nonexistent/ai-stack' lint pre-commit; [ $? -ne 3 ]";
    committed(&s.command(&repo, Launch::Agent).env("GIT_CONFIG_VALUE_1", moved).args(["commit", "-qam", "moved binary"]).output().unwrap());

    let quiet = s.root.join("no-reflog");
    write(&quiet.join("a.ts"), "export const a = 1;\n");
    s.git(&s.root, &["init", "-q", quiet.to_str().unwrap()]);
    s.git(&quiet, &["config", "core.logAllRefUpdates", "false"]);
    s.git(&quiet, &["add", "-A"]);
    s.git(&quiet, &["commit", "-qm", "base"]);
    write(&quiet.join("a.test.ts"), sleep);
    s.git(&quiet, &["add", "a.test.ts"]);
    committed(&s.command(&quiet, Launch::Agent).env("AI_STACK_LINT_SKIP", "the device has no event").args(["commit", "-qm", "skip without a reflog"]).output().unwrap());
    let last = s.events().last().cloned().unwrap();
    assert_eq!((last["kind"].as_str(), last["head"].as_str()), (Some("skip"), Some(s.git(&quiet, &["rev-parse", "HEAD"]).trim())), "a skip is recorded with reflogs off");
}
