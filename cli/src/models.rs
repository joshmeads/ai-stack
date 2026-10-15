//! Checks configured models against the providers' catalogs.

use std::cmp::Ordering;
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};
use serde_json::Value;

use crate::config::{Config, Provider};

const ANTHROPIC_DOCS_URL: &str = "https://platform.claude.com/docs/en/about-claude/models/overview";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Current,
    /// A model in the same family with a higher version exists.
    Newer { latest: String },
    /// The catalog was fetched but does not list this ID.
    Missing,
    /// The catalog could not be fetched; the string says why.
    Unknown(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelReport {
    pub alias: String,
    pub id: String,
    pub provider: Provider,
    pub status: Status,
}

/// Pure comparison. `None` for a provider means its catalog was unavailable (`reason`).
pub fn check(
    cfg: &Config,
    openai: Result<&[String], &str>,
    anthropic: Result<&[String], &str>,
) -> Vec<ModelReport> {
    cfg.models
        .values()
        .map(|model| {
            let catalog = match model.provider {
                Provider::Openai => openai,
                Provider::Anthropic => anthropic,
            };
            let status = match catalog {
                Err(reason) => Status::Unknown(reason.to_string()),
                Ok(list) if !list.contains(&model.id) => Status::Missing,
                Ok(list) => match newer_than(&model.id, list) {
                    Some(latest) => Status::Newer { latest },
                    None => Status::Current,
                },
            };
            ModelReport {
                alias: model.alias.clone(),
                id: model.id.clone(),
                provider: model.provider,
                status,
            }
        })
        .collect()
}

/// The newest ID in `catalog` from the same family as `id` with a strictly higher version.
pub fn newer_than(id: &str, catalog: &[String]) -> Option<String> {
    let (family, numbers, _) = parse_version(id)?;
    let mut best: Option<(Vec<u64>, Option<u64>, &String)> = None;
    for candidate in catalog {
        let Some((cand_family, cand_numbers, cand_date)) = parse_version(candidate) else {
            continue;
        };
        if cand_family != family || compare_versions(&cand_numbers, &numbers) != Ordering::Greater {
            continue;
        }
        let better = match &best {
            None => true,
            Some((best_numbers, best_date, _)) => {
                match compare_versions(&cand_numbers, best_numbers) {
                    Ordering::Greater => true,
                    Ordering::Equal => cand_date > *best_date,
                    Ordering::Less => false,
                }
            }
        };
        if better {
            best = Some((cand_numbers, cand_date, candidate));
        }
    }
    best.map(|(_, _, latest)| latest.clone())
}

/// Listed (non-hidden) model slugs from `codex debug models`.
pub fn openai_catalog() -> Result<Vec<String>> {
    let body = run_command("codex", &["debug", "models"])?;
    let value: Value =
        serde_json::from_slice(&body).context("codex debug models did not return JSON")?;
    let models = value["models"]
        .as_array()
        .ok_or_else(|| anyhow!("codex debug models JSON has no models array"))?;
    let slugs: Vec<String> = models
        .iter()
        .filter(|model| model["visibility"].as_str() != Some("hide"))
        .filter_map(|model| model["slug"].as_str().map(str::to_owned))
        .collect();
    if slugs.is_empty() {
        bail!("codex debug models listed no models");
    }
    Ok(slugs)
}

/// Anthropic model IDs: the Models API when `ANTHROPIC_API_KEY` is set, otherwise the public models docs page.
pub fn anthropic_catalog() -> Result<Vec<String>> {
    let ids = match std::env::var("ANTHROPIC_API_KEY") {
        Ok(key) if !key.is_empty() => anthropic_api_ids(&key)?,
        _ => anthropic_docs_ids()?,
    };
    if ids.is_empty() {
        bail!("no Claude model IDs found in the Anthropic catalog");
    }
    Ok(ids)
}

/// Rewrites `id = "..."` inside `[models.<alias>]` of the config text, preserving everything else.
pub fn bump(config_text: &str, alias: &str, new_id: &str) -> Result<String> {
    if new_id.contains('"') {
        bail!("new id {new_id:?} contains a quote");
    }
    let header = format!("[models.{alias}]");
    let mut in_table = false;
    let mut found_table = false;
    let mut replaced = false;
    let mut out = String::with_capacity(config_text.len() + new_id.len());
    for line in config_text.split_inclusive('\n') {
        let body = line.trim_end_matches(['\n', '\r']);
        let terminator = &line[body.len()..];
        let trimmed = body.trim_start();
        if trimmed.starts_with('[') {
            in_table = body.trim() == header;
            found_table |= in_table;
        }
        if in_table && !replaced && is_id_line(trimmed) {
            out.push_str(&replace_quoted_value(body, new_id, alias)?);
            out.push_str(terminator);
            replaced = true;
            continue;
        }
        out.push_str(line);
    }
    if !found_table {
        bail!("config has no {header} table");
    }
    if !replaced {
        bail!("{header} has no id line");
    }
    Ok(out)
}

fn is_id_line(trimmed: &str) -> bool {
    trimmed
        .strip_prefix("id")
        .is_some_and(|rest| rest.trim_start().starts_with('='))
}

/// Replaces the first quoted value after `=` and keeps the text around it, including any comment.
fn replace_quoted_value(line: &str, new_id: &str, alias: &str) -> Result<String> {
    let eq = line.find('=').context("id line has no =")?;
    let open = eq + line[eq..].find('"').with_context(|| {
        format!("id line in [models.{alias}] has no quoted value")
    })?;
    let close = open + 1 + line[open + 1..].find('"').with_context(|| {
        format!("id line in [models.{alias}] has an unclosed quoted value")
    })?;
    Ok(format!("{}{}{}", &line[..=open], new_id, &line[close..]))
}

/// `(family, version numbers, date)` for a model ID, or `None` when the ID is not a recognized format.
fn parse_version(id: &str) -> Option<(String, Vec<u64>, Option<u64>)> {
    if let Some(rest) = id.strip_prefix("gpt-") {
        let (ver, name) = match rest.split_once('-') {
            Some((ver, name)) => (ver, Some(name)),
            None => (rest, None),
        };
        let numbers = ver.split('.').map(parse_number).collect::<Option<Vec<u64>>>()?;
        let family = match name {
            Some("") => return None,
            Some(name) => format!("gpt-*-{name}"),
            None => "gpt-*".to_string(),
        };
        return Some((family, numbers, None));
    }
    let rest = id.strip_prefix("claude-")?;
    let mut parts: Vec<&str> = rest.split('-').collect();
    let name = parts.remove(0);
    if name.is_empty() || !name.bytes().all(|b| b.is_ascii_lowercase()) {
        return None;
    }
    let date = match parts.last() {
        Some(last) if parts.len() > 1 && last.len() == 8 => {
            let date = parse_number(last)?;
            parts.pop();
            Some(date)
        }
        _ => None,
    };
    let numbers = parts.iter().map(|part| parse_number(part)).collect::<Option<Vec<u64>>>()?;
    if numbers.is_empty() {
        return None;
    }
    Some((format!("claude-{name}"), numbers, date))
}

fn parse_number(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// Compares version numbers, treating missing trailing parts as zero.
fn compare_versions(a: &[u64], b: &[u64]) -> Ordering {
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    Ordering::Equal
}

fn run_command(program: &str, args: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new(program)
        .args(args)
        .output()
        .with_context(|| format!("failed to run {program}"))?;
    if !output.status.success() {
        bail!(
            "{program} {} exited with {}: {}",
            args.join(" "),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output.stdout)
}

fn anthropic_api_ids(key: &str) -> Result<Vec<String>> {
    // The key goes to curl as a config file on stdin so it never appears in argv or error text.
    let mut child = Command::new("curl")
        .args(["-fsS", "-K", "-", "https://api.anthropic.com/v1/models?limit=1000"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("failed to run curl")?;
    {
        use std::io::Write;
        let mut stdin = child.stdin.take().context("curl stdin unavailable")?;
        writeln!(stdin, "header = \"x-api-key: {key}\"")?;
        writeln!(stdin, "header = \"anthropic-version: 2023-06-01\"")?;
    }
    let output = child.wait_with_output().context("failed to run curl")?;
    if !output.status.success() {
        bail!("Anthropic Models API request failed ({}): {}", output.status, String::from_utf8_lossy(&output.stderr).trim());
    }
    let body = output.stdout;
    let value: Value = serde_json::from_slice(&body).context("Anthropic Models API did not return JSON")?;
    let data = value["data"]
        .as_array()
        .ok_or_else(|| anyhow!("Anthropic Models API response has no data array"))?;
    Ok(data
        .iter()
        .filter_map(|model| model["id"].as_str().map(str::to_owned))
        .collect())
}

fn anthropic_docs_ids() -> Result<Vec<String>> {
    let body = run_command("curl", &["-fsSL", ANTHROPIC_DOCS_URL])?;
    let text = String::from_utf8_lossy(&body);
    let mut ids: Vec<String> = Vec::new();
    for id in scan_model_ids(&text) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// Every `claude-<letters>-<digits>[-<digits>...]` token in `text`, in order of appearance.
fn scan_model_ids(text: &str) -> Vec<String> {
    const PREFIX: &str = "claude-";
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(pos) = rest.find(PREFIX) {
        let preceded_by_word = rest[..pos]
            .bytes()
            .last()
            .is_some_and(|b| b.is_ascii_alphanumeric());
        let tail = &rest[pos..];
        let len = model_id_len(tail);
        if len > 0 && !preceded_by_word {
            found.push(tail[..len].to_string());
        }
        rest = &tail[PREFIX.len()..];
    }
    found
}

/// Length of the model ID at the start of `s`, or 0 when `s` does not start with one.
fn model_id_len(s: &str) -> usize {
    let bytes = s.as_bytes();
    let name_start = "claude-".len();
    let mut i = name_start;
    while i < bytes.len() && bytes[i].is_ascii_lowercase() {
        i += 1;
    }
    if i == name_start {
        return 0;
    }
    let mut end = 0;
    while i < bytes.len() && bytes[i] == b'-' {
        let start = i + 1;
        let mut j = start;
        while j < bytes.len() && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j == start {
            break;
        }
        end = j;
        i = j;
    }
    if end == 0 || bytes.get(end).is_some_and(|b| b.is_ascii_alphanumeric()) {
        return 0;
    }
    end
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    use super::*;
    use crate::config::{Config, Model, Stack};

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    fn config_with(models: &[(&str, Provider, &str)]) -> Config {
        let models: BTreeMap<String, Model> = models
            .iter()
            .map(|&(alias, provider, id)| {
                (
                    alias.to_string(),
                    Model {
                        alias: alias.to_string(),
                        id: id.to_string(),
                        provider,
                        efforts: None,
                        context: None,
                    },
                )
            })
            .collect();
        Config {
            stack: Stack {
                path: PathBuf::from("/h/stack"),
                configured: "/h/stack".into(),
                remote: "origin".into(),
                branch: "main".into(),
                legacy_paths: Vec::new(),
            },
            harnesses: Vec::new(),
            models,
            ..crate::config::from_str(crate::config::default_config_text(), std::path::Path::new("/h")).unwrap()
        }
    }

    #[test]
    fn newer_than_picks_highest_same_family() {
        let openai = strings(&["gpt-6-sol", "gpt-6.2-sol", "gpt-6.3-astra"]);
        assert_eq!(newer_than("gpt-6.1-sol", &openai), Some("gpt-6.2-sol".into()));
        let anthropic = strings(&["claude-opus-5-6", "claude-opus-6", "claude-haiku-6"]);
        assert_eq!(newer_than("claude-opus-5-5", &anthropic), Some("claude-opus-6".into()));
    }

    #[test]
    fn newer_than_ignores_equal_versions_and_unparsed_ids() {
        assert_eq!(newer_than("gpt-6-sol", &strings(&["gpt-6.0-sol"])), None);
        assert_eq!(newer_than("claude-haiku-4-5-20251001", &strings(&["claude-haiku-4-5"])), None);
        assert_eq!(newer_than("mystery-7", &strings(&["mystery-8"])), None);
    }

    #[test]
    fn check_reports_current_newer_missing_and_unknown() {
        let cfg = config_with(&[
            ("astra", Provider::Openai, "gpt-6-astra"),
            ("claude", Provider::Anthropic, "claude-haiku-5-5"),
            ("old", Provider::Openai, "gpt-5-sol"),
            ("sol", Provider::Openai, "gpt-6.1-sol"),
        ]);
        let openai = strings(&["gpt-6-astra", "gpt-6.1-sol", "gpt-6.2-sol"]);
        let reports = check(&cfg, Ok(openai.as_slice()), Err("offline"));
        let summary: Vec<(&str, Status)> = reports
            .iter()
            .map(|report| (report.alias.as_str(), report.status.clone()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("astra", Status::Current),
                ("claude", Status::Unknown("offline".into())),
                ("old", Status::Missing),
                ("sol", Status::Newer { latest: "gpt-6.2-sol".into() }),
            ]
        );
    }

    #[test]
    fn bump_keeps_comments_and_other_tables() {
        let text = "# top\n[stack]\npath = \"x\"\n\n[models.sol]\nprovider = \"openai\"\n    id = \"gpt-6.1-sol\"   # pinned\n# between\n[models.opus]\nid = \"claude-opus-5-5\"\n";
        let bumped = bump(text, "sol", "gpt-6.2-sol").unwrap();
        assert_eq!(
            bumped,
            "# top\n[stack]\npath = \"x\"\n\n[models.sol]\nprovider = \"openai\"\n    id = \"gpt-6.2-sol\"   # pinned\n# between\n[models.opus]\nid = \"claude-opus-5-5\"\n"
        );
        assert!(bump(text, "missing", "gpt-6.2-sol").is_err());
    }

    #[test]
    #[ignore = "needs codex on PATH and network access"]
    fn live_catalogs_are_listed() {
        let openai = openai_catalog().expect("openai catalog");
        let anthropic = anthropic_catalog().expect("anthropic catalog");
        println!("openai: {} ids, first {:?}", openai.len(), &openai[..openai.len().min(10)]);
        println!("anthropic: {} ids, first {:?}", anthropic.len(), &anthropic[..anthropic.len().min(10)]);
        assert!(!openai.is_empty() && !anthropic.is_empty());
    }
}
