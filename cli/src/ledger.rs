use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

pub const FILE: &str = ".local/state/ai-stack/links.json";

pub fn path(home: &Path) -> PathBuf {
    home.join(FILE)
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Ledger {
    version: u32,
    links: BTreeMap<String, String>,
}

pub fn load(path: &Path) -> BTreeMap<String, String> {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str::<Ledger>(&text).ok()).map(|ledger| ledger.links).unwrap_or_default()
}

pub fn update(path: &Path, changes: &[(String, Option<String>)]) -> Result<()> {
    if changes.is_empty() {
        return Ok(());
    }
    let mut links = load(path);
    for (link, target) in changes {
        match target {
            Some(target) => links.insert(link.clone(), target.clone()),
            None => links.remove(link),
        };
    }
    let mut text = serde_json::to_string_pretty(&Ledger { version: 1, links })?;
    text.push('\n');
    crate::plan::write_atomic(path, &text, None).with_context(|| format!("recording skill links in {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_or_malformed_ledger_records_nothing_and_updates_keep_other_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = path(dir.path());
        assert!(load(&path).is_empty());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "not json").unwrap();
        assert!(load(&path).is_empty());
        update(&path, &[("/a".into(), Some("/t/a".into())), ("/b".into(), Some("/t/b".into()))]).unwrap();
        update(&path, &[("/a".into(), None), ("/c".into(), Some("/t/c".into()))]).unwrap();
        let links = load(&path);
        assert_eq!(links.into_iter().collect::<Vec<_>>(), [("/b".to_string(), "/t/b".to_string()), ("/c".to_string(), "/t/c".to_string())]);
    }
}
