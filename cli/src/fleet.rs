//! `ai-stack fleet`: the machines in `<config dir>/fleet.toml` that stack updates are pushed to,
//! locally or over `ssh -o BatchMode=yes`.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use serde::{Deserialize, Serialize};

use crate::auth;

use crate::exec::{self, Exec, command_line, one_line, shell_quote, short};

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
    /// `None`: `ai-stack` over ssh, this binary locally.
    pub bin: Option<String>,
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
                bin: entry.bin,
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
    /// This binary, for a local machine without `bin`.
    pub self_bin: &'a str,
    /// The parent's explicit `--config` / `--home` flags, passed on to a local machine.
    pub local_flags: &'a [String],
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

    fn ai_stack<'w>(&'w self, machine: &'w Machine, args: Vec<Word<'w>>) -> Vec<Word<'w>> {
        let program = match (&machine.bin, &machine.ssh) {
            (Some(bin), _) => Word::Path(bin),
            (None, Some(_)) => Word::Arg("ai-stack"),
            (None, None) => Word::Path(self.self_bin),
        };
        let flags = if machine.ssh.is_none() { self.local_flags } else { &[] };
        std::iter::once(program).chain(flags.iter().map(|flag| Word::Arg(flag))).chain(args).collect()
    }

    /// `--stack` makes the update pull the same checkout `status` and `switch` use.
    fn update_words<'w>(&'w self, machine: &'w Machine, branch: &'w str) -> Vec<Word<'w>> {
        let args = vec![Word::Arg("--stack"), Word::Path(&machine.stack), Word::Arg("update"), Word::Arg("--yes"), Word::Arg("--plain"), Word::Arg("--branch"), Word::Arg(branch)];
        self.ai_stack(machine, args)
    }

    /// Each machine's branch, commit and whether it matches the remote tip of its own branch.
    /// Exit 0 when every machine is current.
    pub fn status(&self, out: &mut dyn Write) -> Result<i32> {
        let mut tips: BTreeMap<String, Result<Option<String>, String>> = BTreeMap::new();
        let mut current = true;
        for machine in &self.machines {
            let (branch, commit, state, reachable) = match self.run(machine, &Self::git(machine, &["rev-parse", "HEAD", "--abbrev-ref", "HEAD"])) {
                Err(err) => ("?".to_string(), "?".to_string(), format!("unreachable: {}", one_line(&format!("{err:#}"))), false),
                Ok(text) => {
                    let mut lines = text.lines().map(str::trim);
                    let commit = lines.next().unwrap_or_default().to_string();
                    let branch = lines.next().unwrap_or_default().to_string();
                    if exec::is_commit(&commit) {
                        let state = self.compare(&branch, &commit, &mut tips);
                        (branch, commit, state, true)
                    } else {
                        ("?".to_string(), "?".to_string(), "unreachable: unexpected output".to_string(), false)
                    }
                }
            };
            current &= state == "current";
            writeln!(out, "{}  {branch}  {}  {state}", machine.name, short(&commit))?;
            if reachable {
                writeln!(out, "  stray: {}", self.stray(machine))?;
            }
        }
        Ok(if current { 0 } else { 1 })
    }

    /// `<bin> stray --json` on the machine, as `N skills, M plugins`. Informational only: a
    /// failure (for example an ai-stack that predates `stray`) never changes the status.
    fn stray(&self, machine: &Machine) -> String {
        #[derive(Deserialize)]
        struct Counts {
            skills: usize,
            plugins: usize,
        }
        let words = self.ai_stack(machine, vec![Word::Arg("stray"), Word::Arg("--json")]);
        let counts = self.run(machine, &words).and_then(|text| {
            serde_json::from_str::<Counts>(text.trim()).with_context(|| format!("unexpected output {:?}", text.trim()))
        });
        match counts {
            Ok(counts) => format!("{} skills, {} plugins", counts.skills, counts.plugins),
            Err(err) => format!("unavailable ({})", one_line(&format!("{err:#}"))),
        }
    }

    pub fn auth(&self, json: bool, now: i64, out: &mut dyn Write) -> Result<i32> {
        #[derive(Serialize)]
        struct MachineStatus {
            machine: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            providers: Option<Vec<auth::Report>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            error: Option<String>,
        }
        let mut reports = Vec::new();
        let mut healthy = true;
        for machine in &self.machines {
            let words = self.ai_stack(machine, vec![Word::Arg("auth"), Word::Arg("status"), Word::Arg("--json")]);
            let (program, args) = self.invocation(machine, &words);
            let result = match self.exec.run(&program, &args, None) {
                Err(_) => Err("unreachable: cannot run command".to_string()),
                Ok(ran) if machine.ssh.is_some() && ran.code == Some(255) => Err("unreachable: ssh transport failed (exit 255)".to_string()),
                Ok(ran) if !ran.ok => Err(format!("unavailable (status command failed, exit {})", ran.code.map_or("signal".into(), |n| n.to_string()))),
                Ok(ran) => serde_json::from_str::<auth::Status>(ran.stdout.trim())
                    .ok()
                    .filter(|status| {
                        let ids: std::collections::BTreeSet<_> = status.providers.iter().map(|p| p.provider.as_str()).collect();
                        ids.len() == status.providers.len() && auth::PROVIDERS.iter().all(|provider| ids.contains(provider.id))
                    })
                    .ok_or_else(|| "unavailable (unexpected status output)".to_string()),
            };
            let (providers, error) = match result {
                Ok(status) => {
                    healthy &= status.providers.iter().all(|provider| provider.healthy(now));
                    if !json {
                        for provider in &status.providers { writeln!(out, "  {}  {}", machine.name, provider.text(now))?; }
                    }
                    (Some(status.providers), None)
                }
                Err(reason) => {
                    healthy = false;
                    if !json { writeln!(out, "  {}  {reason}", machine.name)?; }
                    (None, Some(reason))
                }
            };
            reports.push(MachineStatus { machine: machine.name.clone(), providers, error });
        }
        if json { writeln!(out, "{}", serde_json::to_string(&serde_json::json!({ "machines": reports }))?)?; }
        Ok(if healthy { 0 } else { 1 })
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
                let tip = tip.clone();
                match (self.is_ancestor(commit, &tip), self.is_ancestor(&tip, commit)) {
                    (Some(true), _) => "behind".into(),
                    (Some(false), Some(true)) => "ahead".into(),
                    (Some(false), Some(false)) => "different".into(),
                    _ => "unknown (fetch first)".into(),
                }
            }
        }
    }

    /// `None` when this machine's checkout lacks one of the commits (exit 128) or git fails otherwise.
    fn is_ancestor(&self, ancestor: &str, descendant: &str) -> Option<bool> {
        let args = ["-C", &self.local_stack.to_string_lossy(), "merge-base", "--is-ancestor", ancestor, descendant].map(String::from);
        match self.exec.run("git", &args, None).ok()?.code {
            Some(0) => Some(true),
            Some(1) => Some(false),
            _ => None,
        }
    }

    /// Runs `<bin> update --yes --plain --branch <B>` on each machine, `B` being `branch` or the
    /// machine's current branch. Without `yes`, prints the commands and runs nothing.
    pub fn update(&self, branch: Option<&str>, yes: bool, out: &mut dyn Write) -> Result<i32> {
        if let Some(branch) = branch {
            exec::check_branch(branch)?;
        }
        if !yes {
            for machine in &self.machines {
                let shown = branch.unwrap_or("<current branch>");
                writeln!(out, "{}: {}", machine.name, self.display(machine, &self.update_words(machine, shown)))?;
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
                Ok(Some(branch)) => match self.run(machine, &self.update_words(machine, &branch)) {
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
        exec::check_branch(branch)?;
        let machines: Vec<&Machine> = if names.is_empty() {
            self.machines.iter().collect()
        } else {
            names
                .iter()
                .map(|name| self.machines.iter().find(|machine| machine.name == *name).ok_or_else(|| anyhow!("no enabled machine {name:?} in the fleet file")))
                .collect::<Result<_>>()?
        };
        let tracking = format!("{}/{branch}", self.remote);
        let refspec = format!("+refs/heads/{branch}:refs/remotes/{tracking}");
        let mut ok = true;
        for machine in machines {
            let dirty = Self::git(machine, &["status", "--porcelain", "--untracked-files=no"]);
            let fetch = Self::git(machine, &["fetch", self.remote, &refspec]);
            let checkout = Self::git(machine, &["switch", branch]);
            let create = Self::git(machine, &["switch", "-c", branch, "--track", &tracking]);
            let update = self.update_words(machine, branch);
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
                self.run(machine, &update).with_context(|| format!("now on {branch}, but the update failed"))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exec::fake::{FakeExec, exit, fail, ok};

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
        Fleet { exec, home: Path::new("/h"), local_stack: Path::new("/h/stack"), remote: "origin", machines: from_str(FLEET, "~/default").unwrap(), self_bin: "/bin/self", local_flags: &[] }
    }

    fn run(f: impl FnOnce(&mut Vec<u8>) -> Result<i32>) -> (i32, String) {
        let mut out = Vec::new();
        let code = f(&mut out).unwrap();
        (code, String::from_utf8(out).unwrap())
    }

    fn auth_json(provider: &str) -> String {
        let provider: serde_json::Value = serde_json::from_str(provider).unwrap();
        let mut providers = vec![provider.clone()];
        for descriptor in auth::PROVIDERS {
            if provider["id"] != descriptor.id { providers.push(serde_json::json!({"id":descriptor.id,"state":"not_installed"})); }
        }
        serde_json::json!({"providers":providers}).to_string()
    }

    #[test]
    fn auth_uses_existing_transport_and_reports_unavailable_and_unreachable() {
        let exec = FakeExec::new(|line| {
            if line.contains("me@box") { exit(255, "Connection refused") }
            else if line.contains("cachy") { exit(2, "unrecognized subcommand 'auth'") }
            else { ok(&auth_json(r#"{"id":"codex","state":"logged_in"}"#)) }
        });
        let flags = exec::strings(&["--config", "/custom config", "--home", "/custom home"]);
        let mut f = fleet(&exec);
        f.local_flags = &flags;
        let (code, text) = run(|out| f.auth(false, 100, out));
        assert_eq!(code, 1);
        assert!(text.contains("box  unreachable: ssh transport failed"), "{text}");
        assert!(text.contains("cachy  unavailable (status command failed, exit 2)"));
        assert!(text.contains("mac  codex     logged in"));
        assert_eq!(*exec.calls.borrow(), [
            "ssh -o BatchMode=yes me@box -- 'ai-stack auth status --json'",
            "ssh -o BatchMode=yes cachy -- 'ai-stack auth status --json'",
            "/bin/self --config '/custom config' --home '/custom home' auth status --json",
        ]);
    }

    #[test]
    fn auth_quotes_custom_binary_and_validates_json_and_health() {
        for (status, expected) in [
            (r#"{"providers":[{"id":"codex","state":"logged_in","expires_at":101,"expiry_source":"auth.json"},{"id":"cursor","state":"not_installed"}]}"#, 0),
            (r#"{"providers":[{"id":"codex","state":"logged_in","expires_at":100,"expiry_source":"auth.json","refresh_available":true}]}"#, 0),
            (r#"{"providers":[{"id":"codex","state":"logged_in","expires_at":100,"expiry_source":"auth.json","refresh_available":false}]}"#, 1),
            (r#"{"providers":[{"id":"codex","state":"logged_out"}]}"#, 1),
            (r#"{"providers":[{"id":"codex","state":"unknown","reason":"failed"}]}"#, 1),
            (r#"{"providers":[]}"#, 1),
            (r#"{"providers":[{"id":"codex","state":"logged_out","token":"secret"}]}"#, 1),
            ("not json secret", 1),
        ] {
            let response = if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(status) {
                if let Some(providers) = value["providers"].as_array_mut().filter(|p| !p.is_empty()) {
                    for provider in auth::PROVIDERS {
                        if !providers.iter().any(|p| p["id"] == provider.id) {
                            providers.push(serde_json::json!({"id":provider.id,"state":"not_installed"}));
                        }
                    }
                }
                value.to_string()
            } else { status.to_string() };
            let exec = FakeExec::new(move |_| ok(&response));
            let mut f = fleet(&exec);
            f.machines = vec![Machine { name: "custom".into(), ssh: Some("host".into()), stack: "~/My Stack".into(), bin: Some("~/My Bin/ai's-stack".into()) }];
            let (code, text) = run(|out| f.auth(true, 100, out));
            assert_eq!(code, expected, "{status}");
            let value: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(value["machines"][0]["machine"], "custom");
            assert!(!text.contains("secret"));
            assert_eq!(exec.calls.borrow()[0], command_line("ssh", &exec::strings(&["-o", "BatchMode=yes", "host", "--", "~/'My Bin/ai'\\''s-stack' auth status --json"])));
        }
    }

    #[test]
    fn auth_rejects_incomplete_reports() {
        let exec = FakeExec::new(|_| ok(r#"{"providers":[{"id":"codex","state":"logged_in"}]}"#));
        let (code, text) = run(|out| fleet(&exec).auth(false, 100, out));
        assert_eq!(code, 1);
        assert_eq!(text.matches("unavailable (unexpected status output)").count(), 3);
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
            "/bin/self stray --json" => ok("{\"skills\":12,\"plugins\":3,\"skill_names\":[],\"plugin_ids\":[]}\n"),
            l if l.contains("cachy") && l.contains("stray") => fail("error: unrecognized subcommand 'stray'\n\nUsage: ai-stack <COMMAND>"),
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
        assert!(out.contains("mac  main  aaaaaaa  current\n  stray: 12 skills, 3 plugins\n"), "{out}");
        assert!(out.contains("cachy  test  bbbbbbb  behind\n  stray: unavailable (`ssh -o BatchMode=yes cachy -- 'ai-stack stray --json'` failed: error: unrecognized subcommand 'stray' Usage: ai-stack <COMMAND>)\n"), "{out}");
        assert_eq!(out.matches("stray:").count(), 2, "an unreachable machine gets no stray query: {out}");
        let calls = exec.calls.borrow();
        assert!(calls.contains(&r#"ssh -o BatchMode=yes cachy -- 'git -C ~/'\''My Stack'\'' rev-parse HEAD --abbrev-ref HEAD'"#.to_string()), "{calls:?}");
        assert!(calls.contains(&"git -C /h/stack ls-remote origin refs/heads/test".to_string()), "{calls:?}");
    }

    #[test]
    fn status_reports_ahead_different_unknown_and_unexpected_output() {
        let fleet_file = ["current", "behind", "ahead", "different", "unknown", "garbled"]
            .map(|name| format!("[machine.{name}]\nlocal = true\nstack = \"~/{name}\"\n"))
            .concat();
        let commit = |c: char| c.to_string().repeat(40);
        let exec = FakeExec::new(move |line| {
            let rev = |c: char| ok(&format!("{}\nmain\n", c.to_string().repeat(40)));
            let ancestor = |a: char, b: char| format!("merge-base --is-ancestor {} {}", a.to_string().repeat(40), b.to_string().repeat(40));
            match line {
                l if l.contains("stray") => ok("{\"skills\":0,\"plugins\":0}"),
                l if l.contains("ls-remote") => ok(&format!("{}\trefs/heads/main\n", "a".repeat(40))),
                l if l.contains("/h/current rev-parse") => rev('a'),
                l if l.contains("/h/behind rev-parse") => rev('b'),
                l if l.contains("/h/ahead rev-parse") => rev('c'),
                l if l.contains("/h/different rev-parse") => rev('d'),
                l if l.contains("/h/unknown rev-parse") => rev('e'),
                l if l.contains("/h/garbled rev-parse") => ok("fatal: not a git repository\n"),
                l if l.ends_with(&ancestor('b', 'a')) || l.ends_with(&ancestor('a', 'c')) => ok(""),
                l if l.ends_with(&ancestor('e', 'a')) => exit(128, "fatal: Not a valid commit name"),
                l if l.contains("merge-base") => exit(1, ""),
                other => panic!("unexpected {other}"),
            }
        });
        let f = Fleet { machines: from_str(&fleet_file, "~").unwrap(), ..fleet(&exec) };
        let (code, out) = run(|out| f.status(out));
        assert_eq!(code, 1);
        for (name, c, state) in [("current", 'a', "current"), ("behind", 'b', "behind"), ("ahead", 'c', "ahead"), ("different", 'd', "different"), ("unknown", 'e', "unknown (fetch first)")] {
            assert!(out.contains(&format!("{name}  main  {}  {state}\n", &commit(c)[..7])), "{name}: {out}");
        }
        assert!(out.contains("garbled  ?  ?  unreachable: unexpected output\n"), "{out}");
        assert_eq!(out.matches("stray:").count(), 5, "{out}");
    }

    #[test]
    fn unparsable_stray_output_is_unavailable_and_leaves_the_exit_code_alone() {
        let exec = FakeExec::new(|line| match line {
            l if l.contains("stray") => ok("skills: 1  plugins: 0\n"),
            l if l.contains("rev-parse") => ok(&format!("{A}\nmain\n")),
            _ => ok(&format!("{A}\trefs/heads/main\n")),
        });
        let mut f = fleet(&exec);
        f.machines.retain(|machine| machine.name == "mac");
        let (code, out) = run(|out| f.status(out));
        assert_eq!(code, 0, "{out}");
        assert!(out.contains("  stray: unavailable (unexpected output \"skills: 1 plugins: 0\": expected value"), "{out}");
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

        let flags = ["--home".to_string(), "/h".to_string()];
        let (code, out) = run(|out| Fleet { local_flags: &flags, ..fleet(&exec) }.update(None, true, out));
        assert_eq!(code, 1);
        assert!(out.contains("box: skipped: detached HEAD"), "{out}");
        assert!(out.contains("cachy: failed:") && out.contains("boom"), "{out}");
        assert!(out.contains("mac: updated main"), "{out}");
        let calls = exec.calls.borrow();
        assert!(calls.contains(&r#"ssh -o BatchMode=yes cachy -- 'ai-stack --stack ~/'\''My Stack'\'' update --yes --plain --branch test'"#.to_string()), "{calls:?}");
        assert!(calls.contains(&"/bin/self --home /h --stack /h/stack update --yes --plain --branch main".to_string()), "{calls:?}");
        assert!(!calls.iter().any(|call| call.contains("me@box") && call.contains("update")), "{calls:?}");
    }

    #[test]
    fn switch_fetches_switches_with_tracking_fallback_then_updates() {
        let exec = FakeExec::new(|line| match line {
            l if l.contains("cachy") && l.contains("switch feat") => fail("fatal: invalid reference: feat"),
            l if l.starts_with("/bin/self") => fail("install failed"),
            _ => ok(""),
        });
        let names = ["cachy".to_string(), "mac".to_string()];
        let (code, _) = run(|out| fleet(&exec).switch("feat", &names, false, out));
        assert_eq!(code, 1);
        assert!(exec.calls.borrow().is_empty());
        for bad in ["-feat", "HEAD", "refs/heads/feat", "+feat"] {
            assert!(fleet(&exec).switch(bad, &names, true, &mut Vec::new()).is_err(), "{bad}");
        }

        let (code, out) = run(|out| fleet(&exec).switch("feat", &names, true, out));
        assert_eq!(code, 1, "{out}");
        assert!(out.contains("cachy: switched to feat"), "{out}");
        assert!(out.contains("mac: failed: now on feat, but the update failed: "), "{out}");
        let cachy = |inner: &str| format!("ssh -o BatchMode=yes cachy -- '{inner}'");
        let git = r#"git -C ~/'\''My Stack'\''"#;
        assert_eq!(
            *exec.calls.borrow(),
            [
                cachy(&format!("{git} status --porcelain --untracked-files=no")),
                cachy(&format!("{git} fetch origin +refs/heads/feat:refs/remotes/origin/feat")),
                cachy(&format!("{git} switch feat")),
                cachy(&format!("{git} switch -c feat --track origin/feat")),
                cachy(r#"ai-stack --stack ~/'\''My Stack'\'' update --yes --plain --branch feat"#),
                "git -C /h/stack status --porcelain --untracked-files=no".to_string(),
                "git -C /h/stack fetch origin +refs/heads/feat:refs/remotes/origin/feat".to_string(),
                "git -C /h/stack switch feat".to_string(),
                "/bin/self --stack /h/stack update --yes --plain --branch feat".to_string(),
            ]
        );
    }
}
