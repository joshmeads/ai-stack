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
pub enum Outcome {
    Nothing,
    Checked,
    Skip { findings: Vec<String>, reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pending {
    pub before: Option<String>,
    #[serde(flatten)]
    pub outcome: Outcome,
}

impl Pending {
    pub fn nothing() -> Pending {
        Pending { before: None, outcome: Outcome::Nothing }
    }
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
        let mut events = self.read();
        let since = now.saturating_sub(u64::from(alert.days) * DAY);
        let rate = Rate::of(&events, repo, since);
        if let Some(newest) = events.iter().rposition(|event| event.repo == repo) {
            events.remove(newest);
        }
        let crossed = rate.over(alert) && !Rate::of(&events, repo, since).over(alert);
        if crossed {
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
        Ok(crossed)
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
        Some(serde_json::from_slice(&text).unwrap_or_else(|_| Pending::nothing()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(time: u64, kind: Kind) -> Event {
        Event { time, kind, repo: PathBuf::from("/r"), harness: None, head: None, findings: Vec::new(), reason: None }
    }

    #[test]
    fn each_landed_commit_that_takes_the_window_from_below_to_over_the_threshold_queues_one_notice() {
        let tmp = tempfile::tempdir().unwrap();
        let log = Log::new(tmp.path());
        let repo = Path::new("/r");
        let alert = SkipAlert { percent: 50, days: 7, min_commits: 3 };
        let start = 100 * DAY;
        let land = |time, kind| {
            log.record(&event(time, kind)).unwrap();
            let crossed = log.alert(repo, alert, time).unwrap();
            assert_eq!(crossed, log.take_notice(repo).is_some());
            crossed
        };
        assert!(!land(start, Kind::Skip));
        assert!(!land(start + 1, Kind::Skip), "two commits are below min_commits");
        assert!(land(start + 2, Kind::Checked), "two of three commits flagged");
        assert_eq!(Rate::of(&log.read(), repo, 0), Rate { commits: 3, flagged: 2 }, "a skip is a commit that was flagged");
        assert!(!land(start + 3, Kind::Checked), "two of four is still over, so no second notice");
        let mut aged = log.read();
        for (event, days) in aged.iter_mut().zip([8, 6, 5, 5]) {
            event.time -= days * DAY;
        }
        std::fs::write(log.events_path(), aged.iter().map(|event| serde_json::to_string(event).unwrap() + "\n").collect::<String>()).unwrap();
        assert!(!log.rate(repo, alert, start + 4).over(alert), "the oldest skip has left the window, so the rate is below the threshold");
        assert!(land(start + 4, Kind::Skip), "the window was below the threshold before this commit, so the state changed again");
        log.record(&event(start + 31 * DAY, Kind::Checked)).unwrap();
        assert_eq!(log.read().len(), 1, "events older than 30 days are pruned on write");
        assert_eq!(Rate::of(&log.read(), Path::new("/other"), 0), Rate::default());
    }
}
