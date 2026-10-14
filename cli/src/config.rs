use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow, ensure};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Harness {
    Claude,
    Codex,
}

impl Harness {
    pub const ALL: [Harness; 2] = [Harness::Claude, Harness::Codex];

    pub fn as_str(self) -> &'static str {
        match self {
            Harness::Claude => "claude",
            Harness::Codex => "codex",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Harness::Claude => "Claude Code",
            Harness::Codex => "Codex",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    pub fn as_str(self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::Xhigh => "xhigh",
            Effort::Max => "max",
        }
    }
}

// ---- What the jm-stack plugin accepts in a model sheet ----
//
// Keep these in step with plugins/pstack/skills/poteto-mode/references/provider-dispatch.md
// (descriptor grammar `<provider>:<model>@<effort>` and its model matrix) and with the role
// rows that setup-stack writes.

/// The 15 sheet rows, in file order.
pub const SHEET_ROWS: [&str; 15] = [
    "feature, refactoring", "bug-fix", "perf-issue", "hillclimb", "judgment and prose",
    "hardest tasks", "how explorer", "how explainer", "why investigators, synthesizer",
    "reflect tooling, judgment, divergent, synthesizer", "arena runners",
    "arena cross-judge pool", "swarm workers", "architect runners", "interrogate reviewers",
];
/// Rows that take more than one lane.
const PANEL_ROWS: [&str; 4] = ["arena runners", "arena cross-judge pool", "architect runners", "interrogate reviewers"];
/// Rows whose roles need the parent's MCP servers, so they run on the parent's model.
const PARENT_ROWS: [&str; 2] = ["why investigators, synthesizer", "reflect tooling, judgment, divergent, synthesizer"];
/// Lanes that run on the parent's own model.
const PARENT_LANES: [&str; 2] = ["inherit-parent", "auto"];
const FIVE: &[&str] = &["low", "medium", "high", "xhigh", "max"];
const SIX: &[&str] = &["low", "medium", "high", "xhigh", "max", "ultra"];
/// (provider, model, selectable efforts) for every model-matrix row.
const MATRIX: [(&str, &str, &[&str]); 5] = [
    ("claude", "fable", FIVE),
    ("claude", "opus", FIVE),
    ("claude", "haiku", FIVE),
    ("codex", "gpt-6.1-sol", SIX),
    ("codex", "gpt-6-luna", FIVE),
];

// ---- File schema (what config.toml contains) ----

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    stack: StackSection,
    #[serde(default)]
    harness: HarnessSection,
    models: BTreeMap<String, ModelEntry>,
    leads: PerHarness<String>,
    review: PerHarness<String>,
    sheet: PerHarness<BTreeMap<String, Lanes>>,
    /// Absent in configs from before `--clean` existed; the defaults fill it in.
    #[serde(default)]
    clean: CleanSection,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct PerHarness<T> {
    claude: T,
    codex: T,
}

impl<T> PerHarness<T> {
    fn get(&self, harness: Harness) -> &T {
        match harness {
            Harness::Claude => &self.claude,
            Harness::Codex => &self.codex,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum Lanes {
    Single(String),
    Panel(Vec<String>),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct StackSection {
    path: String,
    #[serde(default = "default_remote")]
    remote: String,
    #[serde(default = "default_branch")]
    branch: String,
    #[serde(default)]
    legacy_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct HarnessSection {
    #[serde(default = "default_claude")]
    claude: HarnessEntry,
    #[serde(default = "default_codex")]
    codex: HarnessEntry,
}

impl Default for HarnessSection {
    fn default() -> Self {
        HarnessSection { claude: default_claude(), codex: default_codex() }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct HarnessEntry {
    home: String,
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelEntry {
    provider: Provider,
    id: String,
    #[serde(default)]
    efforts: Option<Vec<Effort>>,
    #[serde(default)]
    context: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, default)]
struct CleanSection {
    skill_roots: Vec<String>,
    keep_skills: Vec<String>,
    keep_plugins: Vec<String>,
}

impl Default for CleanSection {
    fn default() -> Self {
        let owned = |items: &[&str]| items.iter().map(|item| item.to_string()).collect();
        CleanSection { skill_roots: owned(&SKILL_ROOTS), keep_skills: owned(&KEEP_SKILLS), keep_plugins: owned(&KEEP_PLUGINS) }
    }
}

const SKILL_ROOTS: [&str; 3] = ["~/.claude/skills", "~/.codex/skills", "~/.agents/skills"];
const KEEP_SKILLS: [&str; 21] = [
    "better-*", "brandkit", "break", "variant", "explain-interface", "interface-review", "design-taste-frontend",
    "gpt-taste", "high-end-visual-design", "image-to-code", "redesign-existing-projects", "full-output-enforcement",
    "make-interfaces-feel-better", "oklch-skill", "color-expert", "minimalist-ui", "cua-*", "gui-automation", "hatch-pet", "turborepo", "computer-use-linux",
];
const KEEP_PLUGINS: [&str; 4] = ["jm-*@jm", "github@claude-plugins-official", "chrome-devtools-mcp@claude-plugins-official", "*@openai-*"];

fn default_remote() -> String {
    "origin".into()
}
fn default_branch() -> String {
    "main".into()
}
fn default_true() -> bool {
    true
}
fn default_claude() -> HarnessEntry {
    HarnessEntry { home: "~/.claude".into(), enabled: true }
}
fn default_codex() -> HarnessEntry {
    HarnessEntry { home: "~/.codex".into(), enabled: true }
}

// ---- Resolved config (what the rest of the program uses) ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Model {
    pub alias: String,
    pub id: String,
    pub provider: Provider,
    /// `None` allows all five efforts and lets a route omit its effort.
    pub efforts: Option<Vec<Effort>>,
    /// Usable context in tokens; ai-stack only describes it.
    pub context: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Route {
    pub model: Model,
    pub effort: Option<Effort>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stack {
    pub path: PathBuf,
    pub remote: String,
    pub branch: String,
    pub legacy_paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HarnessConfig {
    pub harness: Harness,
    pub home: PathBuf,
}

/// What `--clean` leaves in place. Matching uses `*` and `?` globs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Clean {
    pub skill_roots: Vec<PathBuf>,
    pub keep_skills: Vec<String>,
    /// Globs over `name@marketplace`.
    pub keep_plugins: Vec<String>,
}

impl Clean {
    /// Dot entries (Codex's `.system`, `.DS_Store`) and the app-managed `synced` directory are
    /// always kept.
    pub fn keeps_skill(&self, name: &str) -> bool {
        name.starts_with('.') || name == "synced" || self.keep_skills.iter().any(|pattern| glob(pattern, name))
    }

    pub fn keeps_plugin(&self, id: &str) -> bool {
        self.keep_plugins.iter().any(|pattern| glob(pattern, id))
    }
}

/// `*` matches any run of characters and `?` one character; everything else is literal.
fn glob(pattern: &str, text: &str) -> bool {
    let (pattern, text): (Vec<char>, Vec<char>) = (pattern.chars().collect(), text.chars().collect());
    let (mut p, mut t) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, t));
            p += 1;
        } else if let Some((star_p, star_t)) = star {
            p = star_p + 1;
            t = star_t + 1;
            star = Some((star_p, star_t + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|&c| c == '*')
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Config {
    pub home: PathBuf,
    pub stack: Stack,
    /// Enabled harnesses only, in `Harness::ALL` order.
    pub harnesses: Vec<HarnessConfig>,
    pub models: BTreeMap<String, Model>,
    pub leads: BTreeMap<Harness, Route>,
    pub review: BTreeMap<Harness, Route>,
    /// Per harness, each sheet row label with its lanes joined by ", ", in `SHEET_ROWS` order.
    pub sheets: BTreeMap<Harness, Vec<(String, String)>>,
    pub clean: Clean,
}

/// The reference config shipped with the CLI.
pub fn default_config_text() -> &'static str {
    include_str!("../config.default.toml")
}

/// Parses `"alias"` or `"alias@effort"` against the resolved models.
pub fn parse_route(text: &str, models: &BTreeMap<String, Model>) -> Result<Route> {
    let text = text.trim();
    let (alias, effort) = match text.split_once('@') {
        Some((alias, effort)) => (alias, Some(effort)),
        None => (text, None),
    };
    let model = models.get(alias).ok_or_else(|| {
        let known: Vec<&str> = models.keys().map(String::as_str).collect();
        anyhow!("unknown model alias \"{alias}\" in route \"{text}\"; known aliases: {}", known.join(", "))
    })?;
    let effort = match effort {
        None => None,
        Some(token) => Some(parse_effort(token).ok_or_else(|| {
            anyhow!("unknown effort \"{token}\" in route \"{text}\"; valid efforts: low, medium, high, xhigh, max")
        })?),
    };
    if let Some(allowed) = &model.efforts {
        let names = allowed.iter().map(|e| e.as_str()).collect::<Vec<_>>().join(", ");
        match effort {
            None => return Err(anyhow!("route \"{text}\" needs an effort; model {alias} allows: {names}")),
            Some(effort) if !allowed.contains(&effort) => {
                return Err(anyhow!("effort {} in route \"{text}\" is not allowed for model {alias}; allowed: {names}", effort.as_str()));
            }
            Some(_) => {}
        }
    }
    Ok(Route { model: model.clone(), effort })
}

pub fn parse_effort(token: &str) -> Option<Effort> {
    match token {
        "low" => Some(Effort::Low),
        "medium" => Some(Effort::Medium),
        "high" => Some(Effort::High),
        "xhigh" => Some(Effort::Xhigh),
        "max" => Some(Effort::Max),
        _ => None,
    }
}

/// Checks one sheet lane against the jm-stack descriptor grammar and model matrix.
fn check_descriptor(lane: &str) -> Result<()> {
    let (provider, rest) = lane.split_once(':').ok_or_else(|| anyhow!("lane {lane:?} is not `<provider>:<model>@<effort>`, inherit-parent or auto"))?;
    let (model, effort) = rest.split_once('@').ok_or_else(|| anyhow!("lane {lane:?} has no `@<effort>`"))?;
    let rows: Vec<_> = MATRIX.iter().filter(|(p, _, _)| *p == provider).collect();
    ensure!(!rows.is_empty(), "lane {lane:?}: unknown provider {provider:?}; jm-stack accepts claude and codex");
    let (_, _, efforts) = rows.iter().find(|(_, m, _)| *m == model).ok_or_else(|| {
        let known: Vec<&str> = rows.iter().map(|(_, m, _)| *m).collect();
        anyhow!("lane {lane:?}: jm-stack has no {provider} model {model:?}; known: {}", known.join(", "))
    })?;
    ensure!(efforts.contains(&effort), "lane {lane:?}: effort {effort:?} is not selectable for {provider}:{model}; allowed: {}", efforts.join(", "));
    Ok(())
}

/// Resolves one harness's sheet table: all 15 rows, valid lanes, panels only where allowed.
fn resolve_sheet(harness: Harness, rows: &BTreeMap<String, Lanes>) -> Result<Vec<(String, String)>> {
    let table = format!("[sheet.{}]", harness.as_str());
    for label in rows.keys() {
        ensure!(SHEET_ROWS.contains(&label.as_str()), "{table}: unknown jm:stack model row {label:?}");
    }
    let mut sheet = Vec::new();
    for label in SHEET_ROWS {
        let value = rows.get(label).ok_or_else(|| anyhow!("{table}: missing jm:stack model row {label:?}"))?;
        let lanes: Vec<&str> = match value {
            Lanes::Single(lane) => vec![lane.trim()],
            Lanes::Panel(lanes) => {
                ensure!(PANEL_ROWS.contains(&label), "{table}: jm:stack model row {label:?} is not a panel; give one lane");
                ensure!(!lanes.is_empty(), "{table}: jm:stack model panel {label:?} is empty");
                lanes.iter().map(|lane| lane.trim()).collect()
            }
        };
        for lane in &lanes {
            if PARENT_LANES.contains(lane) {
                continue;
            }
            ensure!(!PARENT_ROWS.contains(&label), "{table}: jm:stack model row {label:?} needs the parent's MCP servers; use inherit-parent or auto");
            check_descriptor(lane).map_err(|err| anyhow!("{table}: row {label:?}: {err}"))?;
        }
        sheet.push((label.to_owned(), lanes.join(", ")));
    }
    Ok(sheet)
}

/// Parses and validates config text. `home` expands `~` in paths.
pub fn from_str(text: &str, home: &Path) -> Result<Config> {
    let table: toml::Table = toml::from_str(text)?;
    let older = table.contains_key("roles")
        || table.contains_key("install")
        || table.get("stack").and_then(|stack| stack.get("models")).is_some();
    ensure!(!older, "this config is from an older ai-stack ([roles], [stack.models] or [install]); run `ai-stack init --force`, then re-apply your edits");
    let file: ConfigFile = toml::Value::Table(table).try_into()?;

    let mut models = BTreeMap::new();
    for (alias, entry) in file.models {
        ensure!(valid_name(&alias), "invalid model alias \"{alias}\": use lowercase letters, digits and '-'");
        ensure!(!entry.id.trim().is_empty(), "model \"{alias}\" has an empty id");
        ensure!(entry.efforts.as_ref().is_none_or(|efforts| !efforts.is_empty()), "model \"{alias}\" has an empty efforts list");
        ensure!(entry.context != Some(0), "model \"{alias}\" has a zero context limit");
        models.insert(alias.clone(), Model { alias, id: entry.id, provider: entry.provider, efforts: entry.efforts, context: entry.context });
    }

    let stack = Stack {
        path: crate::paths::absolute(&file.stack.path, home)?,
        remote: file.stack.remote,
        branch: file.stack.branch,
        legacy_paths: file.stack.legacy_paths.iter().map(|p| crate::paths::absolute(p, home)).collect::<std::io::Result<_>>()?,
    };

    let harnesses = Harness::ALL
        .into_iter()
        .filter(|harness| harness_entry(&file.harness, *harness).enabled)
        // Normalized so `..` never reaches backup paths derived from the home.
        .map(|harness| Ok(HarnessConfig { harness, home: crate::paths::absolute(&harness_entry(&file.harness, harness).home, home)? }))
        .collect::<std::io::Result<_>>()?;

    let mut leads = BTreeMap::new();
    let mut review = BTreeMap::new();
    let mut sheets = BTreeMap::new();
    for harness in Harness::ALL {
        for (section, routes) in [("leads", &mut leads), ("review", &mut review)] {
            let text = if section == "leads" { file.leads.get(harness) } else { file.review.get(harness) };
            let route = parse_route(text, &models).map_err(|err| anyhow!("[{section}] {}: {err}", harness.as_str()))?;
            ensure!(route.effort.is_some(), "[{section}] {} needs an effort, e.g. \"{}@high\"", harness.as_str(), route.model.alias);
            routes.insert(harness, route);
        }
        sheets.insert(harness, resolve_sheet(harness, file.sheet.get(harness))?);
    }
    let clean = Clean {
        skill_roots: file.clean.skill_roots.iter().map(|p| crate::paths::absolute(p, home)).collect::<std::io::Result<_>>()?,
        keep_skills: file.clean.keep_skills,
        keep_plugins: file.clean.keep_plugins,
    };
    Ok(Config { home: home.to_path_buf(), stack, harnesses, models, leads, review, sheets, clean })
}

fn harness_entry(section: &HarnessSection, harness: Harness) -> &HarnessEntry {
    match harness {
        Harness::Claude => &section.claude,
        Harness::Codex => &section.codex,
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub fn load(path: &Path, home: &Path) -> Result<Config> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("cannot read config {}: {e}. Run `ai-stack init`.", path.display()))?;
    from_str(&text, home)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err_of(text: &str) -> String {
        from_str(text, Path::new("/h")).expect_err("config should be rejected").to_string()
    }

    #[test]
    fn default_config_resolves() {
        let cfg = from_str(default_config_text(), Path::new("/h")).unwrap();
        assert_eq!(cfg.stack.path, PathBuf::from("/h/Documents/Projects/@joshmeads/ai-stack"));
        assert_eq!(cfg.leads[&Harness::Claude].model.id, "claude-opus-5-5");
        assert_eq!(cfg.review[&Harness::Codex].model.id, "gpt-6.1-sol");
        assert_eq!(cfg.models["haiku"].context, Some(100_000));
        assert_eq!(cfg.sheets[&Harness::Codex].len(), 15);
        assert_eq!(cfg.clean.skill_roots[2], PathBuf::from("/h/.agents/skills"));
        // An older config without [clean] gets the same defaults init writes.
        let text = default_config_text();
        let older = from_str(&text[..text.find("[clean]").unwrap()], Path::new("/h")).unwrap();
        assert_eq!(older.clean, cfg.clean);
    }

    #[test]
    fn clean_keep_lists_match_globs_and_always_keep_dot_entries_and_synced() {
        let clean = from_str(default_config_text(), Path::new("/h")).unwrap().clean;
        for kept in ["better-ui", "cua-driver", "turborepo", ".system", ".DS_Store", "synced"] {
            assert!(clean.keeps_skill(kept), "{kept}");
        }
        for moved in ["better", "how", "turborepo-extra", "xcua-driver"] {
            assert!(!clean.keeps_skill(moved), "{moved}");
        }
        for kept in ["jm-stack@jm", "github@claude-plugins-official", "browser@openai-bundled", "pdf@openai-primary-runtime"] {
            assert!(clean.keeps_plugin(kept), "{kept}");
        }
        for removed in ["jm-stack@other", "expo@claude-plugins-official", "pdf-viewer@synced", "github@jm"] {
            assert!(!clean.keeps_plugin(removed), "{removed}");
        }
    }

    #[test]
    fn rejects_invalid_sheet_rows_and_descriptors() {
        let base = default_config_text();
        let bug = "\"bug-fix\" = \"claude:opus@medium\"";
        for (text, message) in [
            (base.replace(bug, "\"bug-fix\" = \"opus@medium\""), "is not `<provider>:<model>@<effort>`"),
            (base.replace(bug, "\"bug-fix\" = \"claude:opus\""), "has no `@<effort>`"),
            (base.replace(bug, "\"bug-fix\" = \"grok:grok-4.7@xhigh\""), "unknown provider \"grok\""),
            (base.replace(bug, "\"bug-fix\" = \"claude:claude-opus-5-5@high\""), "has no claude model \"claude-opus-5-5\""),
            (base.replace(bug, "\"bug-fix\" = \"claude:opus@ultra\""), "effort \"ultra\" is not selectable"),
            (base.replace(bug, "\"bug-fix\" = [\"claude:opus@high\"]"), "is not a panel"),
            (base.replace(bug, "\"unknown\" = \"claude:opus@high\""), "unknown jm:stack model row \"unknown\""),
            (base.replace(&format!("{bug}\n"), ""), "[sheet.claude]: missing jm:stack model row \"bug-fix\""),
            (base.replacen("\"why investigators, synthesizer\" = \"inherit-parent\"", "\"why investigators, synthesizer\" = \"claude:opus@high\"", 1), "needs the parent's MCP servers"),
            (base.replace("[\"claude:opus@medium\", \"claude:opus@high\"]", "[]"), "is empty"),
            (format!("{base}\n[roles.worker]\nclaude = \"opus\"\n"), "older ai-stack"),
        ] {
            assert_ne!(text, base);
            let msg = err_of(&text);
            assert!(msg.contains(message), "{message:?} not in {msg}");
        }
        // Ultra is selectable for Sol only.
        assert!(from_str(&base.replace("\"bug-fix\" = \"codex:gpt-6.1-sol@medium\"", "\"bug-fix\" = \"codex:gpt-6.1-sol@ultra\""), Path::new("/h")).is_ok());
    }

    #[test]
    fn routes_need_known_models_and_efforts() {
        let base = default_config_text();
        let msg = err_of(&base.replace("claude = \"opus@high\"", "claude = \"opus\""));
        assert!(msg.contains("[leads] claude needs an effort"), "{msg}");
        let msg = err_of(&base.replace("codex = \"sol@xhigh\"", "codex = \"nope@xhigh\""));
        assert!(msg.contains("[review] codex: unknown model alias \"nope\""), "{msg}");
    }
}
