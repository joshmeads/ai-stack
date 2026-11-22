mod owned;
mod repo;
mod rules;
mod scan;
mod settings;

use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

pub use owned::{Baseline, Owned};
pub use settings::Settings;

use repo::Repo;
use rules::Rules;
use scan::Engine;

pub const LOAD_ERROR: i32 = 2;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    #[default]
    Lines,
    Function,
    File,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Warning,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Warning => "warning",
            Severity::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warning,
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    pub path: String,
    pub rule: String,
    pub severity: Severity,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub message: String,
    pub snippet: String,
}

impl Finding {
    pub fn fingerprint(&self) -> String {
        format!("{}\u{0}{}\u{0}{}", self.rule, self.path, self.snippet.trim())
    }
}

pub fn settings(config_path: &Path, home: &Path, stack_override: Option<&Path>) -> Result<Settings> {
    let text = crate::config::read(config_path)?;
    let (stack, section) = crate::config::parse_lint(&text, home, stack_override).with_context(|| format!("reading [stack] and [lint] in {}", config_path.display()))?;
    let config_dir = config_path.parent().unwrap_or(Path::new("."));
    Settings::new(section, &stack, config_dir, home)
}

pub struct Request {
    pub paths: Vec<PathBuf>,
    pub base: String,
    pub scope: Option<Scope>,
    pub json: bool,
}

pub fn run(settings: &Settings, request: Request, out: &mut dyn Write, err: &mut dyn Write) -> Result<i32> {
    let rules = match Rules::load(&settings.rule_dirs) {
        Ok(rules) => rules,
        Err(error) => {
            writeln!(err, "error: {error:#}")?;
            return Ok(LOAD_ERROR);
        }
    };
    let cwd = std::env::current_dir()?;
    let paths = if request.paths.is_empty() { vec![cwd.clone()] } else { request.paths };
    let mut groups: Vec<(Repo, Vec<String>)> = Vec::new();
    for path in paths {
        let absolute = crate::paths::normalize(&std::path::absolute(&path)?);
        let dir = if absolute.is_dir() { absolute.clone() } else { absolute.parent().unwrap_or(&absolute).to_path_buf() };
        let Some(repo) = Repo::discover(&dir) else {
            writeln!(err, "error: {} is not inside a git repository", path.display())?;
            return Ok(LOAD_ERROR);
        };
        let rel = repo.relative(&absolute).unwrap_or_default();
        match groups.iter_mut().find(|(known, _)| *known == repo) {
            Some((_, specs)) => specs.push(rel),
            None => groups.push((repo, vec![rel])),
        }
    }
    let mut files = Vec::new();
    for (repo, specs) in groups {
        let wanted = |rel: &str| {
            scan::language_of(Path::new(rel)).is_some()
                && specs.iter().any(|spec| spec.is_empty() || rel == spec || rel.strip_prefix(spec.as_str()).is_some_and(|rest| rest.starts_with('/')))
        };
        for (rel, baseline) in repo.changes(&request.base, wanted)? {
            files.push((repo.root.join(&rel), baseline));
        }
    }
    let engine = Engine { settings, rules: &rules, scope: request.scope, display: &cwd };
    let findings = engine.lint(files);
    if request.json {
        writeln!(out, "{}", serde_json::json!({ "version": 1, "findings": findings }))?;
    } else {
        write!(out, "{}", text(&findings))?;
    }
    Ok(if findings.iter().any(|finding| finding.severity == Severity::Error) { 1 } else { 0 })
}

pub fn text(findings: &[Finding]) -> String {
    let mut text = String::new();
    for finding in findings {
        text.push_str(&format!(
            "{}:{}:{} {} {}: {}\n    {}\n",
            finding.path,
            finding.line,
            finding.column,
            finding.severity.as_str(),
            finding.rule,
            finding.message,
            finding.snippet.trim()
        ));
    }
    text
}

#[derive(Serialize)]
struct Listed {
    id: String,
    language: String,
    severity: Option<Severity>,
    source: String,
}

pub fn list(settings: &Settings, json: bool, out: &mut dyn Write, err: &mut dyn Write) -> Result<i32> {
    let rules = match Rules::load(&settings.rule_dirs) {
        Ok(rules) => rules,
        Err(error) => {
            writeln!(err, "error: {error:#}")?;
            return Ok(LOAD_ERROR);
        }
    };
    let repo = Repo::discover(&std::env::current_dir()?);
    let policy = settings.policy(repo.as_ref());
    let mut listed: Vec<Listed> = rules
        .rules
        .iter()
        .map(|rule| Listed {
            id: rule.key.id.clone(),
            language: rule.key.language.to_string(),
            severity: policy.severity(&rule.key.id, rule.base, rule.default_off),
            source: rule.source.to_string_lossy().into_owned(),
        })
        .collect();
    listed.push(Listed { id: scan::TEST_FILE_NAMES.into(), language: "path".into(), severity: policy.severity(scan::TEST_FILE_NAMES, Some(Severity::Error), false), source: "built in".into() });
    listed.sort_by(|a, b| (&a.id, &a.language).cmp(&(&b.id, &b.language)));
    if json {
        writeln!(out, "{}", serde_json::to_string(&listed)?)?;
    } else {
        for rule in &listed {
            writeln!(out, "{}  {}  {}  {}", rule.id, rule.language, rule.severity.map_or("off", Severity::as_str), rule.source)?;
        }
        writeln!(out, "{} rule(s) for {} project", listed.len(), repo.map_or_else(|| "no".to_string(), |repo| repo.project_key.display().to_string()))?;
    }
    Ok(0)
}
