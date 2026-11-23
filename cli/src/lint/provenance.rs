use std::collections::HashSet;
use std::io::Write as _;
use std::os::unix::ffi::OsStrExt as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::paths;

const KEEP: u64 = 7 * 24 * 60 * 60;

#[derive(Serialize, Deserialize)]
struct Written {
    time: u64,
    lines: Vec<String>,
}

pub struct Provenance {
    dir: PathBuf,
    now: u64,
}

#[derive(Clone, Copy)]
enum Record {
    WrittenTo,
    RemovedIn,
}

pub fn comment_line(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    (trimmed.starts_with("//") || trimmed.starts_with('#')).then_some(trimmed)
}

impl Provenance {
    pub fn new(state_dir: &Path, now: u64) -> Provenance {
        Provenance { dir: state_dir.join("provenance"), now }
    }

    fn file_of(&self, record: Record, path: &Path) -> PathBuf {
        let prefix: &[u8] = match record {
            Record::WrittenTo => b"",
            Record::RemovedIn => b"removed\0",
        };
        let digest: String = Sha256::new().chain_update(prefix).chain_update(paths::resolve(path).as_os_str().as_bytes()).finalize().iter().take(16).map(|byte| format!("{byte:02x}")).collect();
        self.dir.join(digest)
    }

    fn records(&self, file: &Path) -> Vec<Written> {
        let Ok(text) = std::fs::read_to_string(file) else { return Vec::new() };
        text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect()
    }

    pub fn record<'l>(&self, path: &Path, added: impl IntoIterator<Item = &'l str>) -> Result<()> {
        self.append(Record::WrittenTo, path, added)
    }

    pub fn record_removed<'l>(&self, repo: &Path, removed: impl IntoIterator<Item = &'l str>) -> Result<()> {
        self.append(Record::RemovedIn, repo, removed)
    }

    fn append<'l>(&self, record: Record, path: &Path, lines: impl IntoIterator<Item = &'l str>) -> Result<()> {
        let mut lines: Vec<String> = lines.into_iter().filter_map(comment_line).map(str::to_string).collect();
        lines.sort();
        lines.dedup();
        if lines.is_empty() {
            return Ok(());
        }
        std::fs::create_dir_all(&self.dir).with_context(|| format!("creating {}", self.dir.display()))?;
        self.prune();
        let file = self.file_of(record, path);
        let cutoff = self.now.saturating_sub(KEEP);
        let records = self.records(&file);
        if records.first().is_some_and(|oldest| oldest.time < cutoff) {
            let mut kept = tempfile::NamedTempFile::new_in(&self.dir)?;
            for record in records.iter().filter(|record| record.time >= cutoff) {
                writeln!(kept, "{}", serde_json::to_string(record)?)?;
            }
            kept.persist(&file)?;
        }
        let mut line = serde_json::to_string(&Written { time: self.now, lines })?;
        line.push('\n');
        std::fs::OpenOptions::new().create(true).append(true).open(&file)?.write_all(line.as_bytes())?;
        Ok(())
    }

    fn prune(&self) {
        let Ok(entries) = std::fs::read_dir(&self.dir) else { return };
        let keep = Duration::from_secs(KEEP);
        let now = SystemTime::now();
        for entry in entries.filter_map(|entry| entry.ok()) {
            let stale = entry.metadata().and_then(|meta| meta.modified()).is_ok_and(|modified| now.duration_since(modified).is_ok_and(|age| age > keep));
            if stale {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    fn lines(&self, record: Record, path: &Path) -> HashSet<String> {
        let cutoff = self.now.saturating_sub(KEEP);
        self.records(&self.file_of(record, path)).into_iter().filter(|record| record.time >= cutoff).flat_map(|record| record.lines).collect()
    }

    pub fn written(&self, path: &Path) -> HashSet<String> {
        self.lines(Record::WrittenTo, path)
    }

    pub fn moved(&self, repo: &Path) -> HashSet<String> {
        self.lines(Record::RemovedIn, repo)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_comment_lines_the_agent_wrote_in_the_last_week_count_for_their_file_and_removals_count_for_the_repository() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("a.ts");
        let day = 24 * 60 * 60;
        Provenance::new(tmp.path(), 100 * day).record(&file, ["  // old prose", "const a = 1;"]).unwrap();
        Provenance::new(tmp.path(), 105 * day).record(&file, ["\t# new prose  ", "// old prose"]).unwrap();
        let later = Provenance::new(tmp.path(), 108 * day);
        assert_eq!(later.written(&file), HashSet::from(["# new prose".to_string(), "// old prose".to_string()]));
        assert!(later.written(&tmp.path().join("b.ts")).is_empty(), "entries are per file");
        later.record(&file, ["// newest"]).unwrap();
        let text = std::fs::read_to_string(later.file_of(Record::WrittenTo, &file)).unwrap();
        assert_eq!(text.lines().count(), 2, "an expired record is dropped when its file is written: {text}");
        assert_eq!(Provenance::new(tmp.path(), 114 * day).written(&file), HashSet::from(["// newest".to_string()]));
        later.record_removed(tmp.path(), ["  // a human's rule", "return 1;"]).unwrap();
        assert_eq!(later.moved(tmp.path()), HashSet::from(["// a human's rule".to_string()]));
        assert!(later.written(tmp.path()).is_empty(), "a repository's removals are kept apart from a file's additions");
    }
}
