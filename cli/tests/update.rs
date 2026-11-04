use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::Path;
use std::process::Command;

#[test]
fn cli_changes_stop_update_before_models_or_installation() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let bin = root.join("bin");
    let home = root.join("home");
    let origin = root.join("origin");
    let seed = root.join("seed");
    let stack = root.join("stack checkout");
    let config = root.join("config.toml");
    fs::create_dir(&bin).unwrap();
    let git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|dir| dir.join("git")).find(|path| path.is_file()).unwrap();
    symlink(fs::canonicalize(git).unwrap(), bin.join("git")).unwrap();
    let run_git = |cwd: &Path, args: &[&str]| {
        let output = Command::new(bin.join("git"))
            .env_clear().env("HOME", &home).env("PATH", &bin)
            .env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_CONFIG_GLOBAL", "/dev/null")
            .current_dir(cwd)
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.templateDir="])
            .args(args).output().unwrap();
        assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    };
    run_git(root, &["init", "--bare", "--initial-branch=feat", origin.to_str().unwrap()]);
    run_git(root, &["clone", origin.to_str().unwrap(), seed.to_str().unwrap()]);
    fs::create_dir(seed.join("cli")).unwrap();
    fs::write(seed.join("cli/source.rs"), "before\n").unwrap();
    run_git(&seed, &["add", "."]);
    run_git(&seed, &["commit", "-m", "Initial CLI"]);
    run_git(&seed, &["push", "origin", "feat"]);
    run_git(root, &["clone", origin.to_str().unwrap(), stack.to_str().unwrap()]);
    fs::write(seed.join("cli/source.rs"), "after\n").unwrap();
    run_git(&seed, &["commit", "-am", "Change CLI"]);
    run_git(&seed, &["push", "origin", "feat"]);
    let wanted = run_git(&seed, &["rev-parse", "HEAD"]);
    let defaults = include_str!("../config.default.toml");
    fs::write(&config, defaults).unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_ai-stack"))
        .env_clear().env("HOME", &home).env("PATH", &bin)
        .env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_CONFIG_GLOBAL", "/dev/null")
        .current_dir(root)
        .arg("--home").arg(&home)
        .arg("--config").arg(&config)
        .arg("--stack").arg(&stack)
        .args(["update", "--yes", "--plain", "--bump-models", "--branch", "feat"])
        .output().unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert_eq!(output.status.code(), Some(3), "{stdout}\n{}", String::from_utf8_lossy(&output.stderr));
    assert!(stdout.contains("Nothing was installed.") && stdout.contains("rerun the same command"), "{stdout}");
    assert!(stdout.contains(&format!("cargo install --path '{}/cli'", stack.display())), "{stdout}");
    assert_eq!(run_git(&stack, &["rev-parse", "HEAD"]), wanted);
    for unexpected in ["current", "newer:", "missing", "unknown:", "Nothing to install.", "Applied", "No changes."] {
        assert!(!stdout.contains(unexpected), "update continued past the rebuild stop: {stdout}");
    }
    assert!(!home.exists(), "update wrote harness or install state");
    assert_eq!(fs::read_to_string(config).unwrap(), defaults);
}

#[test]
fn update_moves_a_stray_skill_only_with_force() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    let bin = root.join("bin");
    let home = root.join("home");
    let origin = root.join("origin");
    let stack = root.join("stack");
    let config = root.join("config.toml");
    fs::create_dir(&bin).unwrap();
    let git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|dir| dir.join("git")).find(|path| path.is_file()).unwrap();
    symlink(fs::canonicalize(git).unwrap(), bin.join("git")).unwrap();
    let claude = bin.join("claude");
    fs::write(&claude, "#!/bin/sh\ncase \"$*\" in *--json*) echo '[]';; esac\n").unwrap();
    fs::set_permissions(&claude, fs::Permissions::from_mode(0o755)).unwrap();
    let run_git = |cwd: &Path, args: &[&str]| {
        let output = Command::new(bin.join("git"))
            .env_clear().env("HOME", &home).env("PATH", &bin)
            .env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_CONFIG_GLOBAL", "/dev/null")
            .current_dir(cwd)
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.templateDir="])
            .args(args).output().unwrap();
        assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    };
    run_git(root, &["init", "--bare", "--initial-branch=main", origin.to_str().unwrap()]);
    run_git(root, &["clone", origin.to_str().unwrap(), stack.to_str().unwrap()]);
    run_git(&stack, &["switch", "-c", "main"]);
    for (path, text) in [
        ("stack.toml", "[groups.tools]\nglobal = true\nskills = [\"handoff\"]\n"),
        ("skills/handoff/SKILL.md", "---\nname: handoff\n---\n"),
        (".claude-plugin/marketplace.json", "{\"name\":\"jm\",\"plugins\":[{\"name\":\"jm-stack\",\"source\":\"./plugins/pstack\"}]}"),
        ("plugins/pstack/.claude-plugin/plugin.json", "{\"version\":\"1.0.0\"}"),
    ] {
        fs::create_dir_all(stack.join(path).parent().unwrap()).unwrap();
        fs::write(stack.join(path), text).unwrap();
    }
    run_git(&stack, &["add", "."]);
    run_git(&stack, &["commit", "-m", "Initial stack"]);
    run_git(&stack, &["push", "origin", "main"]);
    fs::write(&config, include_str!("../config.default.toml")).unwrap();
    let stray = home.join(".claude/skills/handoff/SKILL.md");
    fs::create_dir_all(stray.parent().unwrap()).unwrap();
    fs::write(&stray, "mine\n").unwrap();

    let update = |extra: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_ai-stack"))
            .env_clear().env("HOME", &home).env("PATH", &bin)
            .env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_CONFIG_GLOBAL", "/dev/null")
            .current_dir(root)
            .arg("--home").arg(&home)
            .arg("--config").arg(&config)
            .arg("--stack").arg(&stack)
            .args(["update", "--yes", "--plain", "--branch", "main"])
            .args(extra)
            .output().unwrap()
    };

    let refused = update(&[]);
    let stdout = String::from_utf8_lossy(&refused.stdout);
    assert_eq!(refused.status.code(), Some(1), "{stdout}\n{}", String::from_utf8_lossy(&refused.stderr));
    assert!(stdout.contains("stray skill in the way"), "{stdout}");
    assert_eq!(fs::read_to_string(&stray).unwrap(), "mine\n");

    let forced = update(&["--force"]);
    let stdout = String::from_utf8_lossy(&forced.stdout);
    assert_eq!(forced.status.code(), Some(0), "{stdout}\n{}", String::from_utf8_lossy(&forced.stderr));
    assert_eq!(fs::read_to_string(&stray).unwrap(), "---\nname: handoff\n---\n");
    assert!(fs::symlink_metadata(stray.parent().unwrap()).unwrap().file_type().is_symlink());
    assert!(stdout.contains("Backups: "), "{stdout}");
    let backups = home.join(".local/state/ai-stack/backups");
    let run = fs::read_dir(&backups).unwrap().next().unwrap().unwrap().path();
    assert_eq!(fs::read_to_string(run.join("home/.claude/skills/handoff/SKILL.md")).unwrap(), "mine\n");
}
