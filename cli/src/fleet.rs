//! `ai-stack fleet`: the machines in `<config dir>/fleet.toml` that stack updates are pushed to,
//! locally or over `ssh -o BatchMode=yes`.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use serde::Deserialize;

use crate::exec::{self, Exec, command_line, shell_quote};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FleetFile {
    #[serde(default)]
    machine: BTreeMap<String, Entry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    ssh: Option<String>,
    #[serde(default)]
    local: bool,
    stack: Option<String>,
    bin: Option<String>,
    #[serde(default = "default_true")]
    enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Machine {
    pub name: String,
    /// `None` runs on this machine.
    pub ssh: Option<String>,
    /// Checkout path on that machine, unexpanded so `~` expands there.
    pub stack: String,
    pub bin: String,
}

pub fn default_text() -> &'static str {
    include_str!("../fleet.default.toml")
}

/// Enabled machines in name order. `default_stack` is this machine's `stack.path` as written.
pub fn from_str(text: &str, default_stack: &str) -> Result<Vec<Machine>> {
    let file: FleetFile = toml::from_str(text)?;
    let mut machines = Vec::new();
    for (name, entry) in file.machine {
        match (&entry.ssh, entry.local) {
            (Some(dest), false) => ensure!(!dest.is_empty() && !dest.starts_with('-') && !dest.contains(char::is_whitespace), "[machine.{name}]: invalid ssh destination {dest:?}"),
            (None, true) => {}
            _ => bail!("[machine.{name}]: set exactly one of `ssh` or `local = true`"),
        }
        if entry.enabled {
            machines.push(Machine {
                name,
                ssh: entry.ssh,
                stack: entry.stack.unwrap_or_else(|| default_stack.to_string()),
                bin: entry.bin.unwrap_or_else(|| "ai-stack".into()),
            });
        }
    }
    Ok(machines)
}

pub fn load(path: &Path, default_stack: &str) -> Result<Vec<Machine>> {
    let text = std::fs::read_to_string(path).map_err(|err| anyhow!("cannot read {}: {err}. Run `ai-stack fleet init`.", path.display()))?;
    from_str(&text, default_stack).with_context(|| format!("invalid {}", path.display()))
}

/// A command word: a path on the target machine (`~` expands there) or a plain argument.
enum Word<'a> {
    Path(&'a str),
    Arg(&'a str),
}

pub struct Fleet<'a> {
    pub exec: &'a dyn Exec,
    pub home: &'a Path,
    /// This machine's checkout, used for `ls-remote` and ancestry checks.
    pub local_stack: &'a Path,
    pub remote: &'a str,
    pub machines: Vec<Machine>,
}

impl Fleet<'_> {
    fn invocation(&self, machine: &Machine, words: &[Word]) -> (String, Vec<String>) {
        match &machine.ssh {
            None => {
                let mut all = words.iter().map(|word| match word {
                    Word::Path(path) => crate::paths::expand(path, self.home).to_string_lossy().into_owned(),
                    Word::Arg(arg) => arg.to_string(),
                });
                (all.next().unwrap_or_default(), all.collect())
            }
            Some(dest) => {
                let line = words
                    .iter()
                    .map(|word| match word {
                        Word::Path(path) => remote_path(path),
                        Word::Arg(arg) => shell_quote(arg),
                    })
                    .collect::<Vec<_>>()
                    .join(" ");
                ("ssh".into(), ["-o", "BatchMode=yes", dest, "--", &line].map(String::from).to_vec())
            }
        }
    }

    fn display(&self, machine: &Machine, words: &[Word]) -> String {
        let (program, args) = self.invocation(machine, words);
        command_line(&program, &args)
    }

    fn run(&self, machine: &Machine, words: &[Word]) -> Result<String> {
        let (program, args) = self.invocation(machine, words);
        exec::check(self.exec, &program, &args, None)
    }

    fn git<'w>(machine: &'w Machine, args: &[&'w str]) -> Vec<Word<'w>> {
        [Word::Arg("git"), Word::Arg("-C"), Word::Path(&machine.stack)].into_iter().chain(args.iter().map(|arg| Word::Arg(arg))).collect()
    }

    fn update_words<'w>(machine: &'w Machine, branch: &'w str) -> Vec<Word<'w>> {
        vec![Word::Path(&machine.bin), Word::Arg("update"), Word::Arg("--yes"), Word::Arg("--plain"), Word::Arg("--branch"), Word::Arg(branch)]
    }

    /// Each machine's branch, commit and whether it matches the remote tip of its own branch.
    /// Exit 0 when every machine is current.
    pub fn status(&self, out: &mut dyn Write) -> Result<i32> {
        let mut tips: BTreeMap<String, Result<Option<String>, String>> = BTreeMap::new();
        let mut current = true;
        for machine in &self.machines {
            let (branch, commit, state) = match self.run(machine, &Self::git(machine, &["rev-parse", "HEAD", "--abbrev-ref", "HEAD"])) {
                Err(err) => ("?".to_string(), "?".to_string(), format!("unreachable: {}", one_line(&format!("{err:#}")))),
                Ok(text) => {
                    let mut lines = text.lines().map(str::trim);
                    let commit = lines.next().unwrap_or_default().to_string();
                    let branch = lines.next().unwrap_or_default().to_string();
                    let state = self.compare(&branch, &commit, &mut tips);
                    (branch, commit, state)
                }
            };
            current &= state == "current";
            writeln!(out, "{}  {branch}  {}  {state}", machine.name, &commit[..commit.len().min(7)])?;
        }
        Ok(if current { 0 } else { 1 })
    }

    fn compare(&self, branch: &str, commit: &str, tips: &mut BTreeMap<String, Result<Option<String>, String>>) -> String {
        if branch == "HEAD" {
            return "detached".into();
        }
        if let Err(err) = exec::check_ref(branch) {
            return format!("unknown: {err}");
        }
        let tip = tips.entry(branch.to_string()).or_insert_with(|| {
            let args = ["-C", &self.local_stack.to_string_lossy(), "ls-remote", self.remote, &format!("refs/heads/{branch}")].map(String::from);
            exec::check(self.exec, "git", &args, None)
                .map(|text| text.split_whitespace().next().map(str::to_string))
                .map_err(|err| one_line(&format!("{err:#}")))
        });
        match tip {
            Err(err) => format!("unknown: {err}"),
            Ok(None) => format!("unknown: {} has no branch {branch}", self.remote),
            Ok(Some(tip)) if tip == commit => "current".into(),
            Ok(Some(tip)) => {
                let args = ["-C", &self.local_stack.to_string_lossy(), "merge-base", "--is-ancestor", commit, tip.as_str()].map(String::from);
                match self.exec.run("git", &args, None) {
                    Ok(ran) if ran.ok => "behind".into(),
                    _ => "different".into(),
                }
            }
        }
    }

    /// Runs `<bin> update --yes --plain --branch <B>` on each machine, `B` being `branch` or the
    /// machine's current branch. Without `yes`, prints the commands and runs nothing.
    pub fn update(&self, branch: Option<&str>, yes: bool, out: &mut dyn Write) -> Result<i32> {
        if let Some(branch) = branch {
            exec::check_ref(branch)?;
        }
        if !yes {
            for machine in &self.machines {
                let shown = branch.unwrap_or("<current branch>");
                writeln!(out, "{}: {}", machine.name, self.display(machine, &Self::update_words(machine, shown)))?;
            }
            if branch.is_none() {
                writeln!(out, "<current branch> is read from each machine first; a detached HEAD is skipped.")?;
            }
            writeln!(out, "Re-run with --yes to apply.")?;
            return Ok(1);
        }
        let mut ok = true;
        for machine in &self.machines {
            let result = match branch {
                Some(branch) => Ok(Some(branch.to_string())),
                None => self.current_branch(machine),
            };
            let line = match result {
                Err(err) => format!("failed: {err:#}"),
                Ok(None) => "skipped: detached HEAD; run `ai-stack fleet switch <branch>` first".into(),
                Ok(Some(branch)) => match self.run(machine, &Self::update_words(machine, &branch)) {
                    Ok(stdout) => format!("updated {branch}\n{}", indent(&stdout)),
                    Err(err) => format!("failed: {err:#}"),
                },
            };
            ok &= line.starts_with("updated");
            writeln!(out, "{}: {}", machine.name, line.trim_end())?;
        }
        Ok(if ok { 0 } else { 1 })
    }

    fn current_branch(&self, machine: &Machine) -> Result<Option<String>> {
        let branch = self.run(machine, &Self::git(machine, &["rev-parse", "--abbrev-ref", "HEAD"]))?.trim().to_string();
        if branch == "HEAD" {
            return Ok(None);
        }
        exec::check_ref(&branch)?;
        Ok(Some(branch))
    }

    /// Fetches `branch`, checks it out (creating a tracking branch when needed) and updates, on
    /// the named machines or all. Never forces: a dirty tree or failed checkout fails that machine.
    pub fn switch(&self, branch: &str, names: &[String], yes: bool, out: &mut dyn Write) -> Result<i32> {
        exec::check_ref(branch)?;
        let machines: Vec<&Machine> = if names.is_empty() {
            self.machines.iter().collect()
        } else {
            names
                .iter()
                .map(|name| self.machines.iter().find(|machine| machine.name == *name).ok_or_else(|| anyhow!("no enabled machine {name:?} in the fleet file")))
                .collect::<Result<_>>()?
        };
        let tracking = format!("{}/{branch}", self.remote);
        let mut ok = true;
        for machine in machines {
            let dirty = Self::git(machine, &["status", "--porcelain", "--untracked-files=no"]);
            let fetch = Self::git(machine, &["fetch", self.remote, branch]);
            let checkout = Self::git(machine, &["checkout", branch]);
            let create = Self::git(machine, &["checkout", "-b", branch, "--track", &tracking]);
            let update = Self::update_words(machine, branch);
            if !yes {
                writeln!(out, "{}:", machine.name)?;
                writeln!(out, "  {}", self.display(machine, &fetch))?;
                writeln!(out, "  {}", self.display(machine, &checkout))?;
                writeln!(out, "  (if no local branch) {}", self.display(machine, &create))?;
                writeln!(out, "  {}", self.display(machine, &update))?;
                continue;
            }
            let result = (|| -> Result<String> {
                let changes = self.run(machine, &dirty)?;
                ensure!(changes.trim().is_empty(), "the checkout has uncommitted changes:\n{}", indent(&changes));
                self.run(machine, &fetch)?;
                if let Err(first) = self.run(machine, &checkout) {
                    self.run(machine, &create).map_err(|second| anyhow!("{first:#}\n{second:#}"))?;
                }
                self.run(machine, &update)
            })();
            match result {
                Ok(stdout) => writeln!(out, "{}: switched to {branch}\n{}", machine.name, indent(&stdout).trim_end())?,
                Err(err) => {
                    ok = false;
                    writeln!(out, "{}: failed: {err:#}", machine.name)?;
                }
            }
        }
        if !yes {
            writeln!(out, "Re-run with --yes to apply.")?;
            return Ok(1);
        }
        Ok(if ok { 0 } else { 1 })
    }
}

/// Quotes a path for the remote shell, leaving a leading `~/` bare so it expands there.
fn remote_path(path: &str) -> String {
    match path.strip_prefix("~/") {
        Some(rest) => format!("~/{}", shell_quote(rest)),
        None if path == "~" => "~".into(),
        None => shell_quote(path),
    }
}

fn indent(text: &str) -> String {
    text.lines().map(|line| format!("  {line}\n")).collect()
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exec::fake::{FakeExec, fail, ok};

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const FLEET: &str = r#"
[machine.mac]
local = true
stack = "~/stack"

[machine.cachy]
ssh = "cachy"
stack = "~/My Stack"

[machine.box]
ssh = "me@box"

[machine.off]
ssh = "off"
enabled = false
"#;

    fn fleet(exec: &FakeExec) -> Fleet<'_> {
        Fleet { exec, home: Path::new("/h"), local_stack: Path::new("/h/stack"), remote: "origin", machines: from_str(FLEET, "~/default").unwrap() }
    }

    fn run(f: impl FnOnce(&mut Vec<u8>) -> Result<i32>) -> (i32, String) {
        let mut out = Vec::new();
        let code = f(&mut out).unwrap();
        (code, String::from_utf8(out).unwrap())
    }

    #[test]
    fn loads_and_validates_machines() {
        let machines = from_str(FLEET, "~/default").unwrap();
        assert_eq!(machines.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), ["box", "cachy", "mac"]);
        assert_eq!(machines[0].stack, "~/default");
        assert!(from_str("[machine.x]\nssh = \"x\"\nlocal = true\n", "~").is_err());
        assert!(from_str("[machine.x]\nlocal = false\n", "~").is_err());
        assert!(from_str("[machine.x]\nssh = \"-oProxyCommand=x\"\n", "~").is_err());
        assert!(from_str("[machine.x]\nlocal = true\nport = 1\n", "~").is_err());
        assert!(from_str(default_text(), "~").is_ok());
    }

    #[test]
    fn status_shows_each_branch_against_its_own_remote_tip() {
        let exec = FakeExec::new(|line| match line {
            l if l.starts_with("git -C /h/stack rev-parse") => ok(&format!("{A}\nmain\n")),
            l if l.contains("cachy") => ok(&format!("{B}\ntest\n")),
            l if l.contains("me@box") => fail("ssh: connect to host box: Connection refused"),
            l if l.ends_with("refs/heads/main") => ok(&format!("{A}\trefs/heads/main\n")),
            l if l.ends_with("refs/heads/test") => ok(&format!("{A}\trefs/heads/test\n")),
            l if l.contains("merge-base --is-ancestor") => ok(""),
            other => panic!("unexpected {other}"),
        });
        let (code, out) = run(|out| fleet(&exec).status(out));
        assert_eq!(code, 1);
        assert!(out.contains("mac  main  aaaaaaa  current"), "{out}");
        assert!(out.contains("cachy  test  bbbbbbb  behind"), "{out}");
        assert!(out.contains("box  ?  ?  unreachable: `ssh -o BatchMode=yes me@box"), "{out}");
        let calls = exec.calls.borrow();
        assert!(calls.contains(&r#"ssh -o BatchMode=yes cachy -- 'git -C ~/'\''My Stack'\'' rev-parse HEAD --abbrev-ref HEAD'"#.to_string()), "{calls:?}");
        assert!(calls.contains(&"git -C /h/stack ls-remote origin refs/heads/test".to_string()), "{calls:?}");
    }

    #[test]
    fn update_passes_each_machines_branch_skips_detached_and_continues_past_failures() {
        let exec = FakeExec::new(|line| match line {
            l if l.contains("update --yes") && l.contains("cachy") => fail("boom"),
            l if l.contains("update --yes") => ok("Nothing to install.\n"),
            l if l.contains("me@box") => ok("HEAD\n"),
            l if l.contains("cachy") => ok("test\n"),
            _ => ok("main\n"),
        });
        let (code, out) = run(|out| fleet(&exec).update(None, false, out));
        assert_eq!(code, 1);
        assert!(exec.calls.borrow().is_empty());
        assert!(out.contains("Re-run with --yes"), "{out}");

        let (code, out) = run(|out| fleet(&exec).update(None, true, out));
        assert_eq!(code, 1);
        assert!(out.contains("box: skipped: detached HEAD"), "{out}");
        assert!(out.contains("cachy: failed:") && out.contains("boom"), "{out}");
        assert!(out.contains("mac: updated main"), "{out}");
        let calls = exec.calls.borrow();
        assert!(calls.contains(&"ssh -o BatchMode=yes cachy -- 'ai-stack update --yes --plain --branch test'".to_string()), "{calls:?}");
        assert!(calls.contains(&"ai-stack update --yes --plain --branch main".to_string()), "{calls:?}");
        assert!(!calls.iter().any(|call| call.contains("me@box") && call.contains("update")), "{calls:?}");
    }

    #[test]
    fn switch_fetches_checks_out_with_tracking_fallback_then_updates() {
        let exec = FakeExec::new(|line| match line {
            l if l.contains("cachy") && l.contains("checkout feat") => fail("error: pathspec 'feat' did not match"),
            _ => ok(""),
        });
        let names = ["cachy".to_string(), "mac".to_string()];
        let (code, _) = run(|out| fleet(&exec).switch("feat", &names, false, out));
        assert_eq!(code, 1);
        assert!(exec.calls.borrow().is_empty());
        assert!(fleet(&exec).switch("-feat", &names, true, &mut Vec::new()).is_err());

        let (code, out) = run(|out| fleet(&exec).switch("feat", &names, true, out));
        assert_eq!(code, 0, "{out}");
        let cachy = |inner: &str| format!("ssh -o BatchMode=yes cachy -- '{inner}'");
        let git = r#"git -C ~/'\''My Stack'\''"#;
        assert_eq!(
            *exec.calls.borrow(),
            [
                cachy(&format!("{git} status --porcelain --untracked-files=no")),
                cachy(&format!("{git} fetch origin feat")),
                cachy(&format!("{git} checkout feat")),
                cachy(&format!("{git} checkout -b feat --track origin/feat")),
                cachy("ai-stack update --yes --plain --branch feat"),
                "git -C /h/stack status --porcelain --untracked-files=no".to_string(),
                "git -C /h/stack fetch origin feat".to_string(),
                "git -C /h/stack checkout feat".to_string(),
                "ai-stack update --yes --plain --branch feat".to_string(),
            ]
        );
    }
}
