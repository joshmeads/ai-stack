//! Runs git, ssh, process scripts and prompt runners for `skills` and `fleet`. Tests swap in
//! `fake::FakeExec`, which records each call and answers from a closure.

use std::io;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{Result, anyhow};

pub struct Ran {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

pub trait Exec {
    /// Runs `program` to completion with stdin closed. An `Err` means it could not start.
    fn run(&self, program: &str, args: &[String], cwd: Option<&Path>) -> io::Result<Ran>;
}

pub struct SystemExec;

impl Exec for SystemExec {
    fn run(&self, program: &str, args: &[String], cwd: Option<&Path>) -> io::Result<Ran> {
        let mut command = Command::new(program);
        command.args(args).stdin(Stdio::null());
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        let output = command.output()?;
        Ok(Ran {
            ok: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

/// Runs and returns stdout, or an error carrying the command line and its stderr.
pub fn check(exec: &dyn Exec, program: &str, args: &[String], cwd: Option<&Path>) -> Result<String> {
    let line = command_line(program, args);
    let ran = exec.run(program, args, cwd).map_err(|err| anyhow!("cannot run `{line}`: {err}"))?;
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

/// Quotes `arg` for a POSIX shell, leaving plainly safe words bare.
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

    /// Records every call as its command line (prefixed with `[cwd] ` when one is set) and
    /// answers with `respond(line)`.
    pub struct FakeExec {
        pub calls: RefCell<Vec<String>>,
        respond: Respond,
    }

    impl FakeExec {
        pub fn new(respond: impl Fn(&str) -> io::Result<Ran> + 'static) -> Self {
            FakeExec { calls: RefCell::default(), respond: Box::new(respond) }
        }
    }

    pub fn ok(stdout: &str) -> io::Result<Ran> {
        Ok(Ran { ok: true, stdout: stdout.to_string(), stderr: String::new() })
    }

    pub fn fail(stderr: &str) -> io::Result<Ran> {
        Ok(Ran { ok: false, stdout: String::new(), stderr: stderr.to_string() })
    }

    impl Exec for FakeExec {
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
    fn shell_quote_handles_spaces_and_single_quotes() {
        assert_eq!(shell_quote("plain/path-1.0"), "plain/path-1.0");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote(""), "''");
        assert_eq!(shell_quote("$HOME;rm"), "'$HOME;rm'");
    }
}
