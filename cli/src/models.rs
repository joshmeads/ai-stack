use std::cmp::Ordering;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};
use serde_json::Value;

use crate::config::{self, Config, ModelRef, Provider};

const ANTHROPIC_DOCS_URL: &str = "https://platform.claude.com/docs/en/about-claude/models/overview";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Current,
    Newer { latest: String },
    Missing,
    Unknown(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelReport {
    pub alias: String,
    pub id: String,
    pub provider: Provider,
    pub status: Status,
}

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
            let status = match (catalog, model.reference) {
                (Err(reason), _) => Status::Unknown(reason.to_string()),
                (Ok(list), ModelRef::Pinned { model: id, .. }) if !list.iter().any(|slug| slug == id) => Status::Missing,
                (Ok(list), reference) => match newer_than(reference.id(), list) {
                    Some(latest) => Status::Newer { latest },
                    None => Status::Current,
                },
            };
            ModelReport {
                alias: model.alias.clone(),
                id: model.id().to_string(),
                provider: model.provider,
                status,
            }
        })
        .collect()
}

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

pub fn openai_catalog(codex_home: Option<&Path>) -> Result<Vec<String>> {
    let env: Vec<(&str, &Path)> = codex_home.map(|home| ("CODEX_HOME", home)).into_iter().collect();
    let body = run_command("codex", &["debug", "models"], &env)?;
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

pub struct Bumped {
    pub text: String,
    pub changes: Vec<String>,
}

pub fn bump(config_text: &str) -> Bumped {
    let mut table = "";
    let mut text = String::with_capacity(config_text.len());
    let mut changes = Vec::new();
    for line in config_text.split_inclusive('\n') {
        let body = line.trim_end_matches(['\n', '\r']);
        let trimmed = body.trim_start();
        if trimmed.starts_with('[') {
            table = trimmed.split_inclusive(']').next().unwrap_or(trimmed);
        }
        let rewritten = if table.starts_with("[models.") && is_id_line(trimmed) {
            id_as_family(body)
        } else if table.starts_with("[sheet.") {
            lanes_as_families(body)
        } else {
            None
        };
        match rewritten {
            Some((new_body, line_changes)) => {
                text.push_str(&new_body);
                text.push_str(&line[body.len()..]);
                changes.extend(line_changes.into_iter().map(|change| format!("{table} {change}")));
            }
            None => text.push_str(line),
        }
    }
    Bumped { text, changes }
}

fn is_id_line(trimmed: &str) -> bool {
    trimmed
        .strip_prefix("id")
        .is_some_and(|rest| rest.trim_start().starts_with('='))
}

fn id_as_family(body: &str) -> Option<(String, Vec<String>)> {
    let trimmed = body.trim_start();
    let indent = &body[..body.len() - trimmed.len()];
    let mut changes = Vec::new();
    let value = rewrite_strings(&trimmed["id".len()..], |id| {
        let family = ["claude", "codex"].into_iter().find_map(|provider| config::family_of_slug(provider, id))?;
        changes.push(format!("id \"{id}\" -> family \"{}\"", family.name));
        Some(family.name.to_string())
    });
    (!changes.is_empty()).then(|| (format!("{indent}family{value}"), changes))
}

fn lanes_as_families(body: &str) -> Option<(String, Vec<String>)> {
    let mut changes = Vec::new();
    let text = rewrite_strings(body, |lane| {
        let (provider, rest) = lane.split_once(':').filter(|(provider, _)| matches!(*provider, "claude" | "codex"))?;
        let (slug, effort) = rest.split_once('@')?;
        let family = config::family_of_slug(provider, slug).filter(|family| family.name != slug && family.efforts.contains(&effort))?;
        let renamed = format!("{provider}:{}@{effort}", family.name);
        changes.push(format!("{lane} -> {renamed}"));
        Some(renamed)
    });
    (!changes.is_empty()).then_some((text, changes))
}

fn rewrite_strings(text: &str, mut rewrite: impl FnMut(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find(['"', '#']).filter(|&open| rest.as_bytes()[open] == b'"') {
        let Some(len) = rest[open + 1..].find('"') else { break };
        let value = &rest[open + 1..open + 1 + len];
        out.push_str(&rest[..=open]);
        out.push_str(&rewrite(value).unwrap_or_else(|| value.to_string()));
        out.push('"');
        rest = &rest[open + 2 + len..];
    }
    out.push_str(rest);
    out
}

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

fn run_command(program: &str, args: &[&str], env: &[(&str, &Path)]) -> Result<Vec<u8>> {
    let output = Command::new(program)
        .args(args)
        .envs(env.iter().copied())
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
    let config_from_stdin_keeps_the_key_out_of_argv = ["-fsS", "-K", "-"];
    let mut child = Command::new("curl")
        .args(config_from_stdin_keeps_the_key_out_of_argv)
        .arg("https://api.anthropic.com/v1/models?limit=1000")
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
    let body = run_command("curl", &["-fsSL", ANTHROPIC_DOCS_URL], &[])?;
    let text = String::from_utf8_lossy(&body);
    let mut ids: Vec<String> = Vec::new();
    for id in scan_model_ids(&text) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

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
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    fn with_models(models: &str) -> String {
        let text = config::default_config_text();
        let (start, end) = (text.find("[models.sol]").unwrap(), text.find("# The lead in each harness").unwrap());
        format!("{}{models}\n{}", &text[..start], &text[end..])
    }

    fn config_with(models: &str) -> Config {
        config::from_str(&with_models(models), Path::new("/h")).unwrap()
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
        let cfg = config_with(concat!(
            "[models.astra]\nfamily = \"astra\"\n",
            "[models.old]\nid = \"gpt-6.1-sol\"\n",
            "[models.opus]\nfamily = \"opus\"\n",
            "[models.sol]\nfamily = \"sol\"\n",
        ));
        let openai = strings(&["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.3-sol"]);
        let reports = check(&cfg, Ok(openai.as_slice()), Err("offline"));
        let summary: Vec<(&str, &str, Status)> = reports
            .iter()
            .map(|report| (report.alias.as_str(), report.id.as_str(), report.status.clone()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("astra", "gpt-6.2-astra", Status::Current),
                ("old", "gpt-6.1-sol", Status::Missing),
                ("opus", "opus", Status::Unknown("offline".into())),
                ("sol", "gpt-6.2-sol", Status::Newer { latest: "gpt-6.3-sol".into() }),
            ]
        );
    }

    #[test]
    fn bump_rewrites_exact_ids_and_lanes_as_families_and_nothing_else() {
        let pinned = with_models(concat!(
            "[models.sol]\nprovider = \"openai\"\n  id = \"gpt-6.1-sol\"   # pinned\n\n",
            "[models.luna]\nid = \"gpt-6-luna\"\n\n",
            "[models.astra]\nfamily = \"astra\"\n\n",
            "[models.opus]\nprovider = \"anthropic\"\nid = \"claude-opus-5-5\"\n\n",
            "[models.haiku]\nid = \"haiku\"\ncontext = 100000\n",
        ))
        .replace("\"bug-fix\" = \"codex:sol@medium\"", "\"bug-fix\" = \"codex:gpt-6.1-sol@medium\" # was \"codex:gpt-6.1-sol@high\"")
        .replace("\"architect runners\" = [\"codex:astra@xhigh\", \"codex:sol@medium\"]", "\"architect runners\" = [\n  \"codex:gpt-6-astra@xhigh\",\n  \"codex:gpt-6.2-sol@medium\",\n]")
        .replace("\"how explorer\" = \"codex:terra@xhigh\"", "\"how explorer\" = \"codex:gpt-6-luna@xhigh\"");
        let error = config::from_str(&pinned, Path::new("/h")).unwrap_err().to_string();
        assert!(error.contains("run `ai-stack models --bump`"), "{error}");

        let bumped = bump(&pinned);
        let expected = with_models(concat!(
            "[models.sol]\nprovider = \"openai\"\n  family = \"sol\"   # pinned\n\n",
            "[models.luna]\nfamily = \"luna\"\n\n",
            "[models.astra]\nfamily = \"astra\"\n\n",
            "[models.opus]\nprovider = \"anthropic\"\nfamily = \"opus\"\n\n",
            "[models.haiku]\nfamily = \"haiku\"\ncontext = 100000\n",
        ))
        .replace("\"bug-fix\" = \"codex:sol@medium\"", "\"bug-fix\" = \"codex:sol@medium\" # was \"codex:gpt-6.1-sol@high\"")
        .replace("\"architect runners\" = [\"codex:astra@xhigh\", \"codex:sol@medium\"]", "\"architect runners\" = [\n  \"codex:astra@xhigh\",\n  \"codex:sol@medium\",\n]")
        .replace("\"how explorer\" = \"codex:terra@xhigh\"", "\"how explorer\" = \"codex:luna@xhigh\"");
        assert_eq!(bumped.text, expected);
        assert_eq!(bumped.changes, [
            "[models.sol] id \"gpt-6.1-sol\" -> family \"sol\"",
            "[models.luna] id \"gpt-6-luna\" -> family \"luna\"",
            "[models.opus] id \"claude-opus-5-5\" -> family \"opus\"",
            "[models.haiku] id \"haiku\" -> family \"haiku\"",
            "[sheet.codex] codex:gpt-6.1-sol@medium -> codex:sol@medium",
            "[sheet.codex] codex:gpt-6-luna@xhigh -> codex:luna@xhigh",
            "[sheet.codex] codex:gpt-6-astra@xhigh -> codex:astra@xhigh",
            "[sheet.codex] codex:gpt-6.2-sol@medium -> codex:sol@medium",
        ]);
        assert!(config::from_str(&bumped.text, Path::new("/h")).is_ok());
        assert!(bump(&bumped.text).changes.is_empty());
        assert!(bump(config::default_config_text()).changes.is_empty());
    }

    #[test]
    #[ignore = "needs codex on PATH and network access"]
    fn live_catalogs_are_listed() {
        let openai = openai_catalog(None).expect("openai catalog");
        let anthropic = anthropic_catalog().expect("anthropic catalog");
        println!("openai: {} ids, first {:?}", openai.len(), &openai[..openai.len().min(10)]);
        println!("anthropic: {} ids, first {:?}", anthropic.len(), &anthropic[..anthropic.len().min(10)]);
        assert!(!openai.is_empty() && !anthropic.is_empty());
    }
}
