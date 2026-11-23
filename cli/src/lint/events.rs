use std::io::Write as _;
use std::os::unix::ffi::OsStrExt as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::config::SkipAlert;

const KEEP_EVENTS: u64 = 30 * DAY;
const KEEP_MARKERS: Duration = Duration::from_secs(DAY);
const DAY: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Checked,
    Skip,
    Bypassed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub time: u64,
    pub kind: Kind,
    pub repo: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub findings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Rate {
    pub commits: u32,
    pub flagged: u32,
}

impl Rate {
    pub fn of(events: &[Event], repo: &Path, since: u64) -> Rate {
        let mut rate = Rate::default();
        for event in events.iter().filter(|event| event.repo == repo && event.time >= since) {
            match event.kind {
                Kind::Checked => rate.commits += 1,
                Kind::Skip | Kind::Bypassed => {
                    rate.commits += 1;
                    rate.flagged += 1;
                }
            }
        }
        rate
    }

    pub fn over(self, alert: SkipAlert) -> bool {
        self.flagged > 0 && self.commits >= alert.min_commits && u64::from(self.flagged) * 100 >= u64::from(alert.percent) * u64::from(self.commits)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Pending {
    Nothing,
    Checked,
    Skip { findings: Vec<String>, reason: String },
}

pub struct Log {
    dir: PathBuf,
}

pub fn now() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs())
}

fn key(repo: &Path) -> String {
    Sha256::digest(repo.as_os_str().as_bytes()).iter().take(16).map(|byte| format!("{byte:02x}")).collect()
}

impl Log {
    pub fn new(state_dir: &Path) -> Log {
        Log { dir: state_dir.to_path_buf() }
    }

    fn events_path(&self) -> PathBuf {
        self.dir.join("events.jsonl")
    }

    pub fn read(&self) -> Vec<Event> {
        let Ok(text) = std::fs::read_to_string(self.events_path()) else { return Vec::new() };
        text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect()
    }

    pub fn record(&self, event: &Event) -> Result<()> {
        std::fs::create_dir_all(&self.dir).with_context(|| format!("creating {}", self.dir.display()))?;
        let events = self.read();
        let cutoff = event.time.saturating_sub(KEEP_EVENTS);
        if events.first().is_some_and(|oldest| oldest.time < cutoff) {
            let mut kept = tempfile::NamedTempFile::new_in(&self.dir)?;
            for old in events.iter().filter(|old| old.time >= cutoff) {
                writeln!(kept, "{}", serde_json::to_string(old)?)?;
            }
            kept.persist(self.events_path())?;
        }
        let mut line = serde_json::to_string(event)?;
        line.push('\n');
        std::fs::OpenOptions::new().create(true).append(true).open(self.events_path())?.write_all(line.as_bytes())?;
        Ok(())
    }

    pub fn writable(&self) -> Result<()> {
        std::fs::create_dir_all(&self.dir).with_context(|| format!("creating {}", self.dir.display()))?;
        std::fs::OpenOptions::new().create(true).append(true).open(self.events_path()).with_context(|| format!("opening {}", self.events_path().display()))?;
        Ok(())
    }

    pub fn rate(&self, repo: &Path, alert: SkipAlert, now: u64) -> Rate {
        Rate::of(&self.read(), repo, now.saturating_sub(u64::from(alert.days) * DAY))
    }

    pub fn alert(&self, repo: &Path, alert: SkipAlert, now: u64) -> Result<bool> {
        let rate = self.rate(repo, alert, now);
        let flag = self.dir.join("alerts").join(key(repo));
        let over = rate.over(alert);
        match (over, flag.exists()) {
            (true, false) => {
                std::fs::create_dir_all(self.dir.join("alerts"))?;
                std::fs::write(&flag, repo.as_os_str().as_bytes())?;
                self.queue_notice(
                    repo,
                    &format!(
                        "ai-stack lint: agents skipped or bypassed the commit check on {} of {} commits in {} in the last {} days. `ai-stack lint skips` lists the reasons.",
                        rate.flagged,
                        rate.commits,
                        repo.display(),
                        alert.days
                    ),
                )?;
            }
            (false, true) => std::fs::remove_file(&flag)?,
            _ => {}
        }
        Ok(over)
    }

    fn notices(&self) -> PathBuf {
        self.dir.join("notices")
    }

    pub fn queue_notice(&self, repo: &Path, text: &str) -> Result<()> {
        std::fs::create_dir_all(self.notices())?;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(self.notices().join(key(repo)))?;
        writeln!(file, "{text}")?;
        Ok(())
    }

    pub fn has_notices(&self) -> bool {
        std::fs::read_dir(self.notices()).is_ok_and(|mut entries| entries.next().is_some())
    }

    pub fn take_notice(&self, repo: &Path) -> Option<String> {
        let queued = self.notices().join(key(repo));
        let claimed = self.notices().join(format!(".{}.{}", key(repo), std::process::id()));
        std::fs::rename(&queued, &claimed).ok()?;
        let text = std::fs::read_to_string(&claimed).ok();
        let _ = std::fs::remove_file(&claimed);
        text.map(|text| text.trim_end().to_string()).filter(|text| !text.is_empty())
    }

    fn markers(&self) -> PathBuf {
        self.dir.join("markers")
    }

    pub fn mark(&self, commit: &str, pending: &Pending) -> Result<()> {
        std::fs::create_dir_all(self.markers())?;
        let now = SystemTime::now();
        for entry in std::fs::read_dir(self.markers())?.filter_map(|entry| entry.ok()) {
            let stale = entry.metadata().and_then(|meta| meta.modified()).is_ok_and(|modified| now.duration_since(modified).is_ok_and(|age| age > KEEP_MARKERS));
            if stale {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        std::fs::write(self.markers().join(commit), serde_json::to_vec(pending)?).with_context(|| format!("writing {}", self.markers().join(commit).display()))?;
        Ok(())
    }

    pub fn take_mark(&self, commit: &str) -> Option<Pending> {
        let marker = self.markers().join(commit);
        let text = std::fs::read(&marker).ok()?;
        let _ = std::fs::remove_file(&marker);
        Some(serde_json::from_slice(&text).unwrap_or(Pending::Nothing))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(time: u64, kind: Kind) -> Event {
        Event { time, kind, repo: PathBuf::from("/r"), harness: None, head: None, findings: Vec::new(), reason: None }
    }

    #[test]
    fn the_rate_crosses_once_clears_below_the_threshold_and_old_events_are_pruned() {
        let tmp = tempfile::tempdir().unwrap();
        let log = Log::new(tmp.path());
        let alert = SkipAlert { percent: 20, days: 7, min_commits: 5 };
        let start = 100 * DAY;
        for at in 0..3 {
            log.record(&event(start + at, Kind::Checked)).unwrap();
        }
        log.record(&event(start + 3, Kind::Skip)).unwrap();
        assert!(!log.alert(Path::new("/r"), alert, start + 3).unwrap(), "four commits are below min_commits");
        log.record(&event(start + 4, Kind::Checked)).unwrap();
        assert_eq!(Rate::of(&log.read(), Path::new("/r"), 0), Rate { commits: 5, flagged: 1 }, "a skip is a commit that was flagged");
        assert!(log.alert(Path::new("/r"), alert, start + 5).unwrap(), "one of five commits flagged");
        assert!(log.take_notice(Path::new("/r")).unwrap().contains("1 of 5 commits"));
        log.record(&event(start + 5, Kind::Bypassed)).unwrap();
        assert!(log.alert(Path::new("/r"), alert, start + 6).unwrap(), "two of six commits flagged");
        assert!(log.alert(Path::new("/r"), alert, start + 7).unwrap());
        assert_eq!(log.take_notice(Path::new("/r")), None, "a notice is queued once per crossing");
        for at in 0..10 {
            log.record(&event(start + 10 + at, Kind::Checked)).unwrap();
        }
        assert!(!log.alert(Path::new("/r"), alert, start + 30).unwrap());
        assert!(!log.rate(Path::new("/r"), alert, start + 8 * DAY).over(alert), "events outside the window do not count");
        log.record(&event(start + 31 * DAY, Kind::Checked)).unwrap();
        assert_eq!(log.read().len(), 1, "events older than 30 days are pruned on write");
        assert_eq!(Rate::of(&log.read(), Path::new("/other"), 0), Rate::default());
    }
}
