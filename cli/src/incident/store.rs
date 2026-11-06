use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read as _, Write as _};
use std::os::fd::AsRawFd as _;
use std::os::unix::fs::{DirBuilderExt as _, MetadataExt as _, OpenOptionsExt as _};
use std::path::{Path, PathBuf};

use super::{Code, Log};

const HEADER: &str = "# Agent incidents\n\nReport-time Git state is recorded below. Regular agents submit through ai-stack and leave this file unopened.\n\n";
const DATA_START: &str = "<details>\n<summary>Record data</summary>\n\n```json\n";
const DATA_END: &str = "\n```\n</details>\n";
const MAX_LOG: u64 = 16 * 1024 * 1024;

pub(super) struct Store {
    path: PathBuf,
    parent: PathBuf,
    _lock: File,
}

impl Drop for Store {
    fn drop(&mut self) {
        unsafe { libc::flock(self._lock.as_raw_fd(), libc::LOCK_UN); }
    }
}

impl Store {
    pub fn lock(path: &Path) -> Result<Self, Code> {
        let parent = path.parent().ok_or(Code::UnsafeDestination)?;
        fs::DirBuilder::new().recursive(true).mode(0o700).create(parent).map_err(|_| Code::StateUnavailable)?;
        let parent = fs::canonicalize(parent).map_err(|_| Code::StateUnavailable)?;
        let name = path.file_name().ok_or(Code::UnsafeDestination)?;
        let path = parent.join(name);
        let lock_path = parent.join(format!(".{}.lock", name.to_string_lossy()));
        let lock = OpenOptions::new().create(true).truncate(false).read(true).write(true).mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(lock_path).map_err(|_| Code::UnsafeDestination)?;
        safe_file(&lock)?;
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let error = std::io::Error::last_os_error();
            return Err(if error.kind() == std::io::ErrorKind::WouldBlock { Code::Busy } else { Code::StateUnavailable });
        }
        Ok(Self { path, parent, _lock: lock })
    }

    fn bytes(&self) -> Result<Option<Vec<u8>>, Code> {
        let mut file = match OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK).open(&self.path) {
            Ok(file) => file,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(Code::UnsafeDestination),
        };
        safe_file(&file)?;
        let mut bytes = Vec::new();
        (&mut file).take(MAX_LOG + 1).read_to_end(&mut bytes).map_err(|_| Code::StateUnavailable)?;
        if bytes.len() as u64 > MAX_LOG { return Err(Code::MalformedLog); }
        Ok(Some(bytes))
    }

    pub fn load(&self) -> Result<(Log, Option<Vec<u8>>), Code> {
        let Some(bytes) = self.bytes()? else { return Ok((Log::default(), None)); };
        let text = std::str::from_utf8(&bytes).map_err(|_| Code::MalformedLog)?;
        let (_, data) = text.split_once(DATA_START).ok_or(Code::MalformedLog)?;
        let data = data.strip_suffix(DATA_END).ok_or(Code::MalformedLog)?;
        let log: Log = serde_json::from_str(data).map_err(|_| Code::MalformedLog)?;
        validate(&log)?;
        if render(&log)?.as_bytes() != bytes { return Err(Code::MalformedLog); }
        Ok((log, Some(bytes)))
    }

    pub fn sync(&self) -> Result<(), Code> {
        let file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
            .open(&self.path).map_err(|_| Code::PersistenceUnknown)?;
        safe_file(&file)?;
        file.sync_all().map_err(|_| Code::PersistenceUnknown)?;
        File::open(&self.parent).and_then(|dir| dir.sync_all()).map_err(|_| Code::PersistenceUnknown)
    }

    pub fn save(&self, log: &Log, original: Option<&[u8]>) -> Result<(), Code> {
        validate(log)?;
        let bytes = render(log)?;
        if bytes.len() as u64 > MAX_LOG { return Err(Code::RequestTooLarge); }
        let mut temp = tempfile::NamedTempFile::new_in(&self.parent).map_err(|_| Code::StateUnavailable)?;
        temp.write_all(bytes.as_bytes()).and_then(|()| temp.as_file().sync_all()).map_err(|_| Code::StateUnavailable)?;
        if self.bytes()?.as_deref() != original { return Err(Code::ConcurrentEdit); }
        temp.persist(&self.path).map_err(|_| Code::StateUnavailable)?;
        self.sync()
    }
}

fn safe_file(file: &File) -> Result<(), Code> {
    let metadata = file.metadata().map_err(|_| Code::UnsafeDestination)?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o077 != 0 { return Err(Code::UnsafeDestination); }
    Ok(())
}

fn validate(log: &Log) -> Result<(), Code> {
    if log.version != 1 { return Err(Code::MalformedLog); }
    let mut entries = HashSet::new();
    let mut occurrences = HashSet::new();
    for entry in &log.entries {
        if entry.occurrences.is_empty() || !entries.insert(&entry.id) { return Err(Code::MalformedLog); }
        for occurrence in &entry.occurrences {
            occurrence.submission.validate().map_err(|_| Code::MalformedLog)?;
            if !occurrences.insert(&occurrence.submission.occurrence_id) { return Err(Code::MalformedLog); }
        }
        let first = entry.occurrences.last().ok_or(Code::MalformedLog)?;
        if entry.id != format!("i-{}", first.submission.occurrence_id) { return Err(Code::MalformedLog); }
    }
    Ok(())
}

fn escape(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"), '<' => out.push_str("&lt;"), '>' => out.push_str("&gt;"),
            '\\' | '`' | '*' | '_' | '[' | ']' | '(' | ')' | '#' | '|' => { out.push('\\'); out.push(ch); },
            ch if ch.is_control() => out.push(' '),
            ch => out.push(ch),
        }
    }
    out
}

fn render(log: &Log) -> Result<String, Code> {
    let mut out = HEADER.to_string();
    for entry in &log.entries {
        let first = entry.occurrences.first().ok_or(Code::MalformedLog)?;
        let kind = serde_json::to_value(&first.submission.kind).map_err(|_| Code::MalformedLog)?;
        out.push_str(&format!("## {} | {}\n\nCount: {} | Type: {}\n\n{}\n\n",
            escape(&first.reported_at), escape(&first.submission.problem), entry.occurrences.len(),
            escape(kind.as_str().ok_or(Code::MalformedLog)?), escape(&first.submission.summary)));
        for occurrence in &entry.occurrences {
            let git = match &occurrence.git {
                super::GitState::Known { commit, dirty } => format!("{} ({})", commit, if *dirty { "dirty" } else { "clean" }),
                super::GitState::NotGit => "not a Git repository".into(),
                super::GitState::Unknown => "unknown".into(),
            };
            out.push_str(&format!("- {} | Project: {} | Git: {} | Model: {} (reported) | Harness: {} (reported)\n",
                escape(&occurrence.reported_at), escape(&occurrence.project), escape(&git),
                escape(&occurrence.submission.responsible_model), escape(&occurrence.submission.harness)));
            if occurrence.submission.summary != first.submission.summary {
                out.push_str(&format!("  - {}\n", escape(&occurrence.submission.summary)));
            }
            for evidence in &occurrence.submission.evidence { out.push_str(&format!("  - {}\n", escape(evidence))); }
        }
        out.push('\n');
    }
    out.push_str(DATA_START);
    let data = serde_json::to_string_pretty(log).map_err(|_| Code::MalformedLog)?;
    out.push_str(&data.replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026"));
    out.push_str(DATA_END);
    Ok(out)
}
