use std::ffi::OsString;
use std::os::unix::ffi::{OsStrExt as _, OsStringExt as _};
use std::path::{Path, PathBuf};

const SHELLS: [&str; 5] = ["sh", "bash", "zsh", "fish", "dash"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallerIndex {
    Default,
    File(PathBuf),
    Unknown,
}

pub struct GitProcess {
    pub id: String,
    pub from_shell: bool,
    pub index: CallerIndex,
}

impl GitProcess {
    pub fn parent_of_this_hook(cwd: &Path) -> GitProcess {
        let git = std::os::unix::process::parent_id();
        let environ = environ(git);
        let exec_by_shell = environ.as_ref().is_some_and(|vars| vars.iter().any(|(name, value)| name == "_" && Path::new(value).file_name().is_some_and(|name| name == "git")));
        let launched_by_shell = parent(git).and_then(command_name).is_some_and(|name| SHELLS.contains(&name.trim_start_matches('-')));
        let index = match environ {
            None => CallerIndex::Unknown,
            Some(vars) => vars.into_iter().find(|(name, _)| name == "GIT_INDEX_FILE").map_or(CallerIndex::Default, |(_, value)| CallerIndex::File(crate::paths::normalize(&cwd.join(value)))),
        };
        GitProcess { id: identity(git), from_shell: exec_by_shell || launched_by_shell, index }
    }
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

fn command_name(pid: u32) -> Option<String> {
    let name = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok().or_else(|| ps("comm=", pid))?;
    let name = name.trim();
    Some(Path::new(name).file_name().map_or(name, |base| base.to_str().unwrap_or(name)).to_string())
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
