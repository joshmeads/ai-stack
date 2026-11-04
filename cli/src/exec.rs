use std::ffi::{CString, OsStr};
use std::io;
use std::os::unix::ffi::OsStrExt as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Result, anyhow};

pub struct Ran {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub trait Exec {
    fn available(&self, program: &str) -> bool {
        find_executable(program).is_some()
    }

    fn interactive(&self, program: &str, args: &[String]) -> io::Result<Option<i32>>;

    fn run(&self, program: &str, args: &[String], cwd: Option<&Path>) -> io::Result<Ran>;
}

pub fn find_executable(program: &str) -> Option<PathBuf> {
    executable_on_path(program, &std::env::var_os("PATH")?)
}

pub(crate) fn executable_on_path(program: &str, path: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path).find_map(|dir| {
        let path = std::path::absolute(dir.join(program)).ok()?;
        let meta = std::fs::metadata(&path).ok()?;
        let name = CString::new(path.as_os_str().as_bytes()).ok()?;
        (meta.is_file() && unsafe { libc::access(name.as_ptr(), libc::X_OK) } == 0).then_some(path)
    })
}

pub struct SystemExec;

impl Exec for SystemExec {
    fn interactive(&self, program: &str, args: &[String]) -> io::Result<Option<i32>> {
        Ok(Command::new(program).args(args).stdin(Stdio::inherit()).stdout(Stdio::inherit()).stderr(Stdio::inherit()).status()?.code())
    }

    fn run(&self, program: &str, args: &[String], cwd: Option<&Path>) -> io::Result<Ran> {
        let mut command = Command::new(program);
        command.args(args).stdin(Stdio::null());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        let output = command.output()?;
        Ok(Ran {
            ok: output.status.success(),
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

pub fn check(exec: &dyn Exec, program: &str, args: &[String], cwd: Option<&Path>) -> Result<String> {
    let line = command_line(program, args);
    finish(&line, launch(exec, program, args, cwd)?)
}

pub fn launch(exec: &dyn Exec, program: &str, args: &[String], cwd: Option<&Path>) -> Result<Ran> {
    exec.run(program, args, cwd).map_err(|err| anyhow!("cannot run `{}`: {err}", command_line(program, args)))
}

pub fn finish(line: &str, ran: Ran) -> Result<String> {
    if !ran.ok {
        let detail = if ran.stderr.trim().is_empty() { ran.stdout.trim() } else { ran.stderr.trim() };
        return Err(anyhow!("`{line}` failed: {detail}"));
    }
    Ok(ran.stdout)
}

pub fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|arg| arg.to_string()).collect()
}

pub fn command_line(program: &str, args: &[String]) -> String {
    std::iter::once(program).chain(args.iter().map(String::as_str)).map(shell_quote).collect::<Vec<_>>().join(" ")
}

pub fn check_ref(name: &str) -> Result<()> {
    let bad = name.is_empty()
        || name.starts_with('-')
        || name.starts_with('/')
        || name.ends_with('/')
        || name.ends_with(".lock")
        || name.contains("..")
        || name.contains("@{")
        || name.chars().any(|c| c.is_whitespace() || c.is_control() || "~^:?*[\\".contains(c));
    anyhow::ensure!(!bad, "{name:?} is not a valid git branch or tag name");
    Ok(())
}

pub fn check_branch(name: &str) -> Result<()> {
    check_ref(name)?;
    anyhow::ensure!(name != "HEAD" && !name.starts_with("refs/") && !name.starts_with('+'), "{name:?} is not a plain branch name");
    Ok(())
}

pub fn is_commit(text: &str) -> bool {
    text.len() == 40 && text.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn short(text: &str) -> &str {
    text.char_indices().nth(7).map_or(text, |(end, _)| &text[..end])
}

pub fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn shell_quote(arg: &str) -> String {
    if !arg.is_empty() && arg.chars().all(|c| c.is_ascii_alphanumeric() || "/._-@:+=,".contains(c)) {
        arg.to_string()
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
pub mod fake {
    use std::cell::RefCell;

    use super::*;

    type Respond = Box<dyn Fn(&str) -> io::Result<Ran>>;

    pub struct FakeExec {
        pub calls: RefCell<Vec<String>>,
        pub interactive_calls: RefCell<Vec<String>>,
        respond: Respond,
    }

    impl FakeExec {
        pub fn new(respond: impl Fn(&str) -> io::Result<Ran> + 'static) -> Self {
            FakeExec { calls: RefCell::default(), interactive_calls: RefCell::default(), respond: Box::new(respond) }
        }
    }

    pub fn ok(stdout: &str) -> io::Result<Ran> {
        Ok(Ran { ok: true, code: Some(0), stdout: stdout.to_string(), stderr: String::new() })
    }

    pub fn fail(stderr: &str) -> io::Result<Ran> {
        exit(1, stderr)
    }

    pub fn exit(code: i32, stderr: &str) -> io::Result<Ran> {
        Ok(Ran { ok: code == 0, code: Some(code), stdout: String::new(), stderr: stderr.to_string() })
    }

    impl Exec for FakeExec {
        fn interactive(&self, program: &str, args: &[String]) -> io::Result<Option<i32>> {
            let line = command_line(program, args);
            self.interactive_calls.borrow_mut().push(line.clone());
            self.calls.borrow_mut().push(line.clone());
            (self.respond)(&line).map(|ran| ran.code)
        }

        fn available(&self, _program: &str) -> bool { true }

        fn run(&self, program: &str, args: &[String], cwd: Option<&Path>) -> io::Result<Ran> {
            let line = command_line(program, args);
            let recorded = match cwd {
                Some(cwd) => format!("[{}] {line}", cwd.display()),
                None => line.clone(),
            };
            self.calls.borrow_mut().push(recorded);
            (self.respond)(&line)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executable_resolution_checks_current_user_and_returns_an_absolute_path() {
        use std::os::unix::fs::{PermissionsExt, symlink};

        let tmp = tempfile::tempdir().unwrap();
        let first = tmp.path().join("first");
        let second = tmp.path().join("second");
        for dir in [&first, &second] { std::fs::create_dir_all(dir).unwrap(); }
        let path = std::env::join_paths([&first, &second]).unwrap();
        let program = first.join("claude");
        std::fs::write(&program, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(executable_on_path("claude", &path).is_none());
        if unsafe { libc::getuid() } != 0 {
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o641)).unwrap();
            assert!(executable_on_path("claude", &path).is_none(), "the owner's permissions take precedence over other execute");
        }
        let real = second.join("real");
        std::fs::write(&real, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o700)).unwrap();
        symlink(&real, second.join("claude")).unwrap();
        assert_eq!(executable_on_path("claude", &path), Some(second.join("claude")));
        assert!(executable_on_path("claude", &path).unwrap().is_absolute());
        std::fs::create_dir(first.join("codex")).unwrap();
        assert!(executable_on_path("codex", &path).is_none());
    }

    #[test]
    fn shell_quote_handles_spaces_and_single_quotes() {
        assert_eq!(shell_quote("plain/path-1.0"), "plain/path-1.0");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote(""), "''");
        assert_eq!(shell_quote("$HOME;rm"), "'$HOME;rm'");
    }

    #[test]
    fn check_ref_rejects_option_like_and_malformed_names() {
        for good in ["main", "feature/x-1", "v1.2.0", "HEAD"] {
            assert!(check_ref(good).is_ok(), "{good}");
        }
        for bad in ["", "-x", "--upload-pack=sh", "a..b", "a b", "a\tb", "a\u{7}", "x~1", "a:b"] {
            assert!(check_ref(bad).is_err(), "{bad:?}");
        }
        assert!(check_branch("feature/x-1").is_ok());
        for bad in ["HEAD", "refs/heads/main", "+main", "-main", "a b", "a..b", "a\u{1}"] {
            assert!(check_branch(bad).is_err(), "{bad:?}");
        }
        assert_eq!((short("0123456789"), short("\u{e9}\u{e9}\u{e9}\u{e9}\u{e9}\u{e9}\u{e9}\u{e9}"), short("ab")), ("0123456", "\u{e9}\u{e9}\u{e9}\u{e9}\u{e9}\u{e9}\u{e9}", "ab"));
    }
}
