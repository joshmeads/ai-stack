use std::ffi::OsString;
use std::os::unix::ffi::{OsStrExt as _, OsStringExt as _};
use std::path::{Path, PathBuf};

const SHELLS: [&str; 5] = ["sh", "bash", "zsh", "fish", "dash"];
const WRAPPERS: [&str; 10] = ["timeout", "env", "nice", "nohup", "time", "stdbuf", "ionice", "chrt", "setsid", "flock"];
const HARNESSES: [&str; 2] = ["claude", "codex"];
const HARNESS_DEPTH: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallerIndex {
    Default,
    File(PathBuf),
    Unknown,
}

pub struct GitProcess {
    pub id: String,
    pub from_shell: bool,
    pub under_harness: bool,
    pub amend: bool,
    pub index: CallerIndex,
}

impl GitProcess {
    pub fn parent_of_this_hook(cwd: &Path) -> GitProcess {
        let hook_shell = std::os::unix::process::parent_id();
        let git = match command_name(hook_shell) {
            Some(name) if name != "git" => parent(hook_shell).filter(|&up| command_name(up).is_some_and(|name| name == "git")).unwrap_or(hook_shell),
            _ => hook_shell,
        };
        let environ = environ(git);
        let exec_by_shell = environ.as_ref().is_some_and(|vars| vars.iter().any(|(name, value)| name == "_" && Path::new(value).file_name().is_some_and(|name| name == "git")));
        let launched_by_shell = parent(git).and_then(command_name).is_some_and(|name| SHELLS.contains(&name.trim_start_matches('-')) || WRAPPERS.contains(&name.as_str()));
        let index = match environ {
            None => CallerIndex::Unknown,
            Some(vars) => vars.into_iter().find(|(name, _)| name == "GIT_INDEX_FILE").map_or(CallerIndex::Default, |(_, value)| CallerIndex::File(crate::paths::normalize(&cwd.join(value)))),
        };
        GitProcess { id: identity(git), from_shell: exec_by_shell || launched_by_shell, under_harness: under_harness(git), amend: amends(git), index }
    }
}

fn under_harness(git: u32) -> bool {
    std::iter::successors(parent(git), |&pid| parent(pid)).take_while(|&pid| pid >= 1).take(HARNESS_DEPTH).any(|pid| [command_name(pid), executable_name(pid)].into_iter().flatten().any(|name| HARNESSES.contains(&name.as_str())))
}

fn amends(git: u32) -> bool {
    let words: Vec<String> = match std::fs::read(format!("/proc/{git}/cmdline")) {
        Ok(bytes) => bytes.split(|&byte| byte == 0).map(|word| String::from_utf8_lossy(word).into_owned()).collect(),
        Err(_) => ps("args=", git).map(|args| args.split_whitespace().map(str::to_string).collect()).unwrap_or_default(),
    };
    words.iter().any(|word| word.len() >= 4 && "--amend".starts_with(word.as_str()))
}

fn identity(pid: u32) -> String {
    match started(pid) {
        Some(start) => format!("{pid}-{start}"),
        None => pid.to_string(),
    }
}

fn stat_fields(pid: u32) -> Option<Vec<String>> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    Some(stat[stat.rfind(')')? + 1..].split_whitespace().map(str::to_string).collect())
}

fn ps(field: &str, pid: u32) -> Option<String> {
    let out = std::process::Command::new("ps").args(["-o", field, "-p", &pid.to_string()]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn started(pid: u32) -> Option<String> {
    match stat_fields(pid) {
        Some(fields) => fields.get(19).cloned(),
        None => ps("lstart=", pid).map(|text| text.split_whitespace().collect::<Vec<_>>().join("-")),
    }
}

fn parent(pid: u32) -> Option<u32> {
    match stat_fields(pid) {
        Some(fields) => fields.get(1)?.parse().ok(),
        None => ps("ppid=", pid)?.parse().ok(),
    }
}

fn base_name(name: &str) -> String {
    let name = name.trim();
    Path::new(name).file_name().map_or(name, |base| base.to_str().unwrap_or(name)).to_string()
}

fn command_name(pid: u32) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{pid}/comm")).ok().or_else(|| ps("comm=", pid)).map(|name| base_name(&name))
}

fn executable_name(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok().map(|exe| base_name(&exe.to_string_lossy()))
}

fn environ(pid: u32) -> Option<Vec<(OsString, OsString)>> {
    let bytes = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
    Some(
        bytes
            .split(|&byte| byte == 0)
            .filter_map(|entry| {
                let at = entry.iter().position(|&byte| byte == b'=')?;
                Some((OsString::from_vec(entry[..at].to_vec()), OsString::from_vec(entry[at + 1..].to_vec())))
            })
            .collect(),
    )
}

pub fn lock_of(index: &Path) -> PathBuf {
    let mut lock = index.as_os_str().as_bytes().to_vec();
    lock.extend_from_slice(b".lock");
    PathBuf::from(OsString::from_vec(lock))
}
