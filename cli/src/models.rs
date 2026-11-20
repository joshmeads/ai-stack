use std::cmp::Ordering;
use std::ops::Range;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};
use toml_edit::{Document, Item, TableLike, Value};

use crate::config::{self, Config, Provider, Registry};

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
            let status = match catalog {
                Err(reason) => Status::Unknown(reason.to_string()),
                Ok(_) if model.reference.is_rolling_alias() => Status::Current,
                Ok(list) if !list.iter().any(|slug| slug == model.id()) => Status::Missing,
                Ok(list) => match newer_than(model.id(), list) {
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

pub fn openai_catalog(codex_home: &Path) -> Result<Vec<String>> {
    let body = run_command("codex", &["debug", "models"], &[("CODEX_HOME", codex_home)])?;
    let value: serde_json::Value =
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

struct Migration<'a> {
    source: &'a str,
    edits: Vec<(Range<usize>, String)>,
    changes: Vec<String>,
    stuck: Vec<String>,
}

impl Migration<'_> {
    fn replace(&mut self, span: Option<Range<usize>>, text: String) -> Result<()> {
        let span = span.ok_or_else(|| anyhow!("toml_edit gave no source span"))?;
        self.edits.push((span, text));
        Ok(())
    }

    fn replace_string(&mut self, value: &Value, text: &str) -> Result<()> {
        let quote = match value.span().and_then(|span| self.source.get(span)) {
            Some(raw) if raw.starts_with('\'') => '\'',
            _ => '"',
        };
        self.replace(value.span(), format!("{quote}{text}{quote}"))
    }

    fn model(&mut self, alias: &str, entry: &dyn TableLike, registry: &Registry) -> Result<()> {
        let Some((key, Item::Value(value))) = entry.get_key_value("id") else { return Ok(()) };
        let Some(id) = value.as_str() else { return Ok(()) };
        let label = format!("[models.{alias}] id \"{id}\"");
        let Some(family) = ["claude", "codex"].into_iter().find_map(|provider| registry.family_of_slug(provider, id)) else {
            self.stuck.push(label);
            return Ok(());
        };
        self.replace(key.span(), "family".to_owned())?;
        self.replace_string(value, &family.name)?;
        self.changes.push(format!("{label} -> family \"{}\"", family.name));
        Ok(())
    }

    fn lane(&mut self, harness: &str, row: &str, value: &Value, registry: &Registry) -> Result<()> {
        let Some(lane) = value.as_str().map(str::trim) else { return Ok(()) };
        let Some((provider, (model, effort))) = lane
            .split_once(':')
            .filter(|(provider, _)| matches!(*provider, "claude" | "codex"))
            .and_then(|(provider, rest)| Some((provider, rest.split_once('@')?)))
        else {
            return Ok(());
        };
        if registry.has_family(provider, model) {
            return Ok(());
        }
        match registry.family_of_slug(provider, model).filter(|family| family.efforts.iter().any(|allowed| allowed == effort)) {
            Some(family) => {
                let renamed = format!("{provider}:{}@{effort}", family.name);
                self.replace_string(value, &renamed)?;
                self.changes.push(format!("[sheet.{harness}] {lane} -> {renamed}"));
            }
            None => self.stuck.push(format!("[sheet.{harness}] \"{row}\" lane \"{lane}\"")),
        }
        Ok(())
    }

    fn apply(mut self) -> (String, Vec<String>, Vec<String>) {
        self.edits.sort_by_key(|(span, _)| std::cmp::Reverse(span.start));
        let mut text = self.source.to_owned();
        for (span, replacement) in self.edits {
            text.replace_range(span, &replacement);
        }
        (text, self.changes, self.stuck)
    }
}

pub fn bump(source: &str, home: &Path, registry: &Registry) -> Result<Bumped> {
    let document = Document::parse(source)?;
    let mut migration = Migration { source, edits: Vec::new(), changes: Vec::new(), stuck: Vec::new() };
    if let Some(models) = document.get("models").and_then(Item::as_table_like) {
        for (alias, entry) in models.iter() {
            if let Some(entry) = entry.as_table_like() {
                migration.model(alias, entry, registry)?;
            }
        }
    }
    if let Some(sheets) = document.get("sheet").and_then(Item::as_table_like) {
        for (harness, rows) in sheets.iter() {
            let Some(rows) = rows.as_table_like() else { continue };
            for (row, lanes) in rows.iter() {
                let values: Vec<&Value> = match lanes {
                    Item::Value(Value::Array(lanes)) => lanes.iter().collect(),
                    Item::Value(lane) => vec![lane],
                    _ => Vec::new(),
                };
                for value in values {
                    migration.lane(harness, row, value, registry)?;
                }
            }
        }
    }
    let (text, changes, stuck) = migration.apply();
    if (!changes.is_empty() || !stuck.is_empty())
        && let Err(err) = config::parse(&text, home, None).and_then(|parsed| parsed.resolve(registry))
    {
        if stuck.is_empty() {
            bail!("the migrated config does not load, so the config is unchanged: {err:#}");
        }
        bail!("cannot migrate {}, so the config is unchanged: {err:#}", stuck.join(", "));
    }
    Ok(Bumped { text, changes })
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
    let value: serde_json::Value = serde_json::from_slice(&body).context("Anthropic Models API did not return JSON")?;
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

    fn replaced(text: &str, pairs: &[(&str, &str)]) -> String {
        pairs.iter().fold(text.to_owned(), |text, (from, to)| {
            assert_eq!(text.matches(from).count(), 1, "{from}");
            text.replace(from, to)
        })
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
        let text = with_models(concat!(
            "[models.astra]\nfamily = \"astra\"\n",
            "[models.haiku]\nid = \"haiku\"\n",
            "[models.old]\nid = \"gpt-6.1-sol\"\n",
            "[models.opus]\nfamily = \"opus\"\n",
            "[models.sol]\nfamily = \"sol\"\n",
            "[models.terra]\nfamily = \"terra\"\n",
        ));
        let cfg = config::test_config(&text, Path::new("/h")).unwrap();
        let openai = strings(&["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.3-sol"]);
        let anthropic = strings(&["claude-opus-5-5", "claude-haiku-5-5"]);
        let summary = |anthropic: Result<&[String], &str>| -> Vec<(String, String, Status)> {
            check(&cfg, Ok(openai.as_slice()), anthropic)
                .into_iter()
                .map(|report| (report.alias, report.id, report.status))
                .collect()
        };
        let row = |alias: &str, id: &str, status: Status| (alias.to_owned(), id.to_owned(), status);
        assert_eq!(summary(Ok(anthropic.as_slice())), vec![
            row("astra", "gpt-6.2-astra", Status::Current),
            row("haiku", "haiku", Status::Current),
            row("old", "gpt-6.1-sol", Status::Missing),
            row("opus", "opus", Status::Current),
            row("sol", "gpt-6.2-sol", Status::Newer { latest: "gpt-6.3-sol".into() }),
            row("terra", "gpt-6.1-terra", Status::Missing),
        ]);
        let offline = summary(Err("offline"));
        assert_eq!(offline[1], row("haiku", "haiku", Status::Unknown("offline".into())));
        assert_eq!(offline[3], row("opus", "opus", Status::Unknown("offline".into())));
    }

    #[test]
    fn bump_migrates_ids_and_lanes_in_every_toml_form_and_nothing_else() {
        let example = "prompt_runner = [\"claude\", \"-p\", \"\"\"\nExample:\n[models.sol]\nid = \"gpt-6.1-sol\"\n\"bug-fix\" = 'codex:gpt-6.1-sol@medium'\n\"\"\"]";
        let pinned = replaced(
            &with_models(concat!(
                "[models]\n",
                "opus = { id = 'claude-opus-5-5' }\n",
                "haiku = { id = \"haiku\", context = 100000 }\n\n",
                "[models.sol]\nprovider = \"openai\"\n  id = \"gpt-6.1-sol\"   # pinned\n\n",
                "[models.astra]\nfamily = \"astra\"\n\n",
                "[models.terra]\nid = 'gpt-6.1-terra'\n",
            )),
            &[
                ("prompt_runner = [\"claude\", \"-p\", \"--permission-mode\", \"acceptEdits\"]", example),
                ("\"bug-fix\" = \"codex:sol@medium\"", "\"bug-fix\" = 'codex:gpt-6.1-sol@medium' # was \"codex:gpt-6.1-sol@high\""),
                ("\"architect runners\" = [\"codex:astra@xhigh\", \"codex:sol@medium\"]", "\"architect runners\" = [\n  \"codex:gpt-6-astra@xhigh\",\n  'codex:gpt-6.2-sol@medium', # current\n]"),
                ("\"judgment and prose\" = \"claude:opus@xhigh\"", "\"judgment and prose\" = \"  claude:claude-opus-5-5@xhigh \""),
            ],
        );
        let error = config::test_config(&pinned, Path::new("/h")).unwrap_err().to_string();
        assert!(error.contains("run `ai-stack models --bump`"), "{error}");

        let registry = config::fixture_registry();
        let bumped = bump(&pinned, Path::new("/h"), &registry).unwrap();
        let expected = replaced(&pinned, &[
            ("opus = { id = 'claude-opus-5-5' }", "opus = { family = 'opus' }"),
            ("haiku = { id = \"haiku\", context", "haiku = { family = \"haiku\", context"),
            ("  id = \"gpt-6.1-sol\"   # pinned", "  family = \"sol\"   # pinned"),
            ("id = 'gpt-6.1-terra'", "family = 'terra'"),
            ("'codex:gpt-6.1-sol@medium' # was", "'codex:sol@medium' # was"),
            ("  \"codex:gpt-6-astra@xhigh\",\n  'codex:gpt-6.2-sol@medium',", "  \"codex:astra@xhigh\",\n  'codex:sol@medium',"),
            ("\"  claude:claude-opus-5-5@xhigh \"", "\"claude:opus@xhigh\""),
        ]);
        assert_eq!(bumped.text, expected);
        assert!(bumped.text.contains(example));
        assert_eq!(bumped.changes, [
            "[models.opus] id \"claude-opus-5-5\" -> family \"opus\"",
            "[models.haiku] id \"haiku\" -> family \"haiku\"",
            "[models.sol] id \"gpt-6.1-sol\" -> family \"sol\"",
            "[models.terra] id \"gpt-6.1-terra\" -> family \"terra\"",
            "[sheet.claude] claude:claude-opus-5-5@xhigh -> claude:opus@xhigh",
            "[sheet.codex] codex:gpt-6.1-sol@medium -> codex:sol@medium",
            "[sheet.codex] codex:gpt-6-astra@xhigh -> codex:astra@xhigh",
            "[sheet.codex] codex:gpt-6.2-sol@medium -> codex:sol@medium",
        ]);
        assert!(config::test_config(&bumped.text, Path::new("/h")).is_ok());
        assert!(bump(&bumped.text, Path::new("/h"), &registry).unwrap().changes.is_empty());
        assert!(bump(config::default_config_text(), Path::new("/h"), &registry).unwrap().changes.is_empty());
    }

    #[test]
    fn bump_refuses_a_config_it_cannot_migrate_and_names_the_entry() {
        let registry = config::fixture_registry();
        let text = with_models("[models.sol]\nid = \"gpt-6.1-sol\"\n[models.astra]\nid = \"gpt-6.12-astra\"\n[models.opus]\nfamily = \"opus\"\n[models.haiku]\nfamily = \"haiku\"\n[models.terra]\nfamily = \"terra\"\n");
        let error = format!("{:#}", bump(&text, Path::new("/h"), &registry).err().unwrap());
        assert!(error.contains("cannot migrate [models.astra] id \"gpt-6.12-astra\", so the config is unchanged"), "{error}");
        let lane = config::default_config_text().replace("\"bug-fix\" = \"codex:sol@medium\"", "\"bug-fix\" = \"codex:gpt-6.12-sol@medium\"");
        let error = format!("{:#}", bump(&lane, Path::new("/h"), &registry).err().unwrap());
        assert!(error.contains("cannot migrate [sheet.codex] \"bug-fix\" lane \"codex:gpt-6.12-sol@medium\""), "{error}");
    }

    #[test]
    #[ignore = "needs codex on PATH and network access"]
    fn live_catalogs_are_listed() {
        let codex_home = std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| Path::new(&std::env::var_os("HOME").unwrap()).join(".codex"));
        let openai = openai_catalog(&codex_home).expect("openai catalog");
        let anthropic = anthropic_catalog().expect("anthropic catalog");
        println!("openai: {} ids, first {:?}", openai.len(), &openai[..openai.len().min(10)]);
        println!("anthropic: {} ids, first {:?}", anthropic.len(), &anthropic[..anthropic.len().min(10)]);
        assert!(!openai.is_empty() && !anthropic.is_empty());
    }
}
