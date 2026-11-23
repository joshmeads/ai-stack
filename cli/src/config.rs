use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow, bail, ensure};
use serde::{Deserialize, Serialize};

use crate::lint::{Level, Scope};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, clap::ValueEnum)]
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

    pub fn instruction_file(self) -> &'static str {
        match self {
            Harness::Claude => "CLAUDE.md",
            Harness::Codex => "AGENTS.md",
        }
    }

    pub fn skill_folder(self, harness_home: &Path, user_home: &Path) -> PathBuf {
        match self {
            Harness::Claude => harness_home.join("skills"),
            Harness::Codex => user_home.join(".agents/skills"),
        }
    }

    pub fn instructions_stem(self) -> &'static str {
        match self {
            Harness::Claude => "claude",
            Harness::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
        }
    }

    fn of(family: &Family) -> Option<Provider> {
        match family.provider.as_str() {
            "claude" => Some(Provider::Anthropic),
            "codex" => Some(Provider::Openai),
            _ => None,
        }
    }
}

pub const FAMILIES_FILE: &str = "plugins/pstack/skills/poteto-mode/references/model-families.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Family {
    pub provider: String,
    pub name: String,
    pub model: String,
    pub efforts: Vec<String>,
    pub kept: Vec<Kept>,
    pub revision_prefix: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kept {
    pub model: String,
    pub efforts: Vec<String>,
}

impl Family {
    fn pin(&self, slug: &str) -> Option<ModelRef> {
        std::iter::once((&self.model, &self.efforts))
            .chain(self.kept.iter().map(|kept| (&kept.model, &kept.efforts)))
            .find(|(model, _)| *model == slug)
            .map(|(model, efforts)| ModelRef::Pinned { family: self.clone(), model: model.clone(), efforts: efforts.clone() })
    }

    fn revision(&self, slug: &str) -> bool {
        self.revision_prefix
            .as_deref()
            .and_then(|prefix| slug.strip_prefix(prefix))
            .is_some_and(|numbers| numbers.split('-').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit())))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryProvider {
    id: String,
    read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Registry {
    providers: Vec<RegistryProvider>,
    families: Vec<Family>,
}

impl Registry {
    pub fn load(stack: &Path) -> Result<Registry> {
        let path = stack.join(FAMILIES_FILE);
        let text = std::fs::read_to_string(&path).map_err(|err| {
            anyhow!("cannot read the model family table {}: {err}. stack.path (or --stack) must name an ai-stack checkout that has it; pull the stack.", path.display())
        })?;
        Registry::parse(&text).map_err(|err| anyhow!("cannot load the model family table {}: {err}", path.display()))
    }

    fn parse(text: &str) -> Result<Registry> {
        let registry: Registry = serde_json::from_str(text)?;
        for family in &registry.families {
            ensure!(registry.knows(&family.provider), "family {:?} names provider {:?}, which the table does not list", family.name, family.provider);
        }
        Ok(registry)
    }

    fn knows(&self, provider: &str) -> bool {
        self.providers.iter().any(|entry| entry.id == provider)
    }

    fn read_only(&self, provider: &str) -> bool {
        self.providers.iter().any(|entry| entry.id == provider && entry.read_only)
    }

    pub fn has_family(&self, provider: &str, name: &str) -> bool {
        self.families_of(provider).any(|family| family.name == name)
    }

    fn families_of<'a>(&'a self, provider: &str) -> impl Iterator<Item = &'a Family> + use<'a> {
        let provider = provider.to_owned();
        self.families.iter().filter(move |family| family.provider == provider)
    }

    fn resolve(&self, provider: &str, token: &str) -> Option<ModelRef> {
        self.families_of(provider)
            .find(|family| family.name == token)
            .map(|family| ModelRef::Family(family.clone()))
            .or_else(|| self.families_of(provider).find_map(|family| family.pin(token)))
    }

    pub fn family_of_slug(&self, provider: &str, slug: &str) -> Option<&Family> {
        self.families_of(provider).find(|family| family.pin(slug).is_some() || family.revision(slug))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum ModelRef {
    Family(Family),
    Pinned { family: Family, model: String, efforts: Vec<String> },
}

impl ModelRef {
    pub fn id(&self) -> &str {
        match self {
            ModelRef::Family(family) => &family.model,
            ModelRef::Pinned { model, .. } => model,
        }
    }

    fn efforts(&self) -> &[String] {
        match self {
            ModelRef::Family(family) => &family.efforts,
            ModelRef::Pinned { efforts, .. } => efforts,
        }
    }

    fn family(&self) -> &Family {
        match self {
            ModelRef::Family(family) | ModelRef::Pinned { family, .. } => family,
        }
    }

    pub fn is_rolling_alias(&self) -> bool {
        self.family().revision_prefix.is_some() && self.id() == self.family().model
    }
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

pub const SHEET_ROWS: [&str; 15] = [
    "feature, refactoring", "bug-fix", "perf-issue", "hillclimb", "judgment and prose",
    "hardest tasks", "how explorer", "how explainer", "why investigators, synthesizer",
    "reflect tooling, judgment, divergent, synthesizer", "arena runners",
    "arena cross-judge pool", "swarm workers", "architect runners", "interrogate reviewers",
];
const PANEL_ROWS: [&str; 4] = ["arena runners", "arena cross-judge pool", "architect runners", "interrogate reviewers"];
const PARENT_ROWS: [&str; 2] = ["why investigators, synthesizer", "reflect tooling, judgment, divergent, synthesizer"];
const PARENT_LANES: [&str; 2] = ["inherit-parent", "auto"];
const WRITER_ROWS: [&str; 7] = [
    "feature, refactoring", "bug-fix", "perf-issue", "hillclimb", "hardest tasks",
    "architect runners", "swarm workers",
];
const OPENROUTER_EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    stack: StackSection,
    #[serde(default)]
    harness: HarnessSection,
    models: BTreeMap<String, ModelEntry>,
    leads: PerHarness<String>,
    review: PerHarness<String>,
    sheet: PerHarness<BTreeMap<String, Lanes>>,
    #[serde(default)]
    clean: CleanSection,
    #[serde(default)]
    skills: SkillsSection,
    #[serde(default)]
    incidents: IncidentsSection,
    #[serde(default)]
    lint: LintSection,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, default)]
pub struct LintSection {
    pub enabled: bool,
    pub scope: Scope,
    pub disable: Vec<String>,
    pub enable: Vec<String>,
    pub severity: BTreeMap<String, Level>,
    pub ignore: Vec<String>,
    pub skip: SkipLimits,
    pub skip_alert: SkipAlert,
    pub project: Vec<LintProject>,
}

impl Default for LintSection {
    fn default() -> Self {
        LintSection {
            enabled: true,
            scope: Scope::Lines,
            disable: Vec::new(),
            enable: Vec::new(),
            severity: BTreeMap::new(),
            ignore: ["**/vendor/**", "**/node_modules/**"].map(String::from).to_vec(),
            skip: SkipLimits::default(),
            skip_alert: SkipAlert::default(),
            project: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, default)]
pub struct SkipLimits {
    pub files: usize,
    pub hunks: usize,
    pub lines: usize,
    pub findings: usize,
}

impl Default for SkipLimits {
    fn default() -> Self {
        SkipLimits { files: 1, hunks: 1, lines: 20, findings: 3 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, default)]
pub struct SkipAlert {
    pub percent: u32,
    pub days: u32,
    pub min_commits: u32,
}

impl Default for SkipAlert {
    fn default() -> Self {
        SkipAlert { percent: 20, days: 7, min_commits: 5 }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LintProject {
    pub path: String,
    #[serde(default)]
    pub paths: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub ignore: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<Scope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum IncidentWorker {
    #[default]
    Haiku,
    Luna,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct IncidentsSection {
    #[serde(default = "default_incident_path")]
    path: String,
    #[serde(default)]
    worker: IncidentWorker,
}

fn default_incident_path() -> String { "~/.local/state/ai-stack/incidents.md".into() }

impl Default for IncidentsSection {
    fn default() -> Self { Self { path: default_incident_path(), worker: IncidentWorker::default() } }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Incidents {
    pub path: PathBuf,
    pub worker: IncidentWorker,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
enum Lanes {
    Single(String),
    Panel(Vec<String>),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct HarnessEntry {
    home: String,
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ModelEntry {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<Provider>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    family: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    efforts: Option<Vec<Effort>>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, default)]
struct SkillsSection {
    prompt_runner: Vec<String>,
}

impl Default for SkillsSection {
    fn default() -> Self {
        SkillsSection { prompt_runner: ["claude", "-p", "--permission-mode", "acceptEdits"].map(String::from).to_vec() }
    }
}

const SKILL_ROOTS: [&str; 3] = ["~/.claude/skills", "~/.codex/skills", "~/.agents/skills"];
const KEEP_SKILLS: [&str; 18] = [
    "better-*", "brandkit", "break", "variant", "explain-interface", "interface-review", "design-taste-frontend",
    "gpt-taste", "high-end-visual-design", "image-to-code", "oklch-skill", "color-expert", "minimalist-ui", "cua-*", "gui-automation", "hatch-pet", "turborepo", "computer-use-linux",
];
const KEEP_PLUGINS: [&str; 3] = ["github@claude-plugins-official", "chrome-devtools-mcp@claude-plugins-official", "*@openai-*"];

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Model {
    pub alias: String,
    pub reference: ModelRef,
    pub provider: Provider,
    pub efforts: Option<Vec<Effort>>,
    pub context: Option<u64>,
}

impl Model {
    pub fn id(&self) -> &str {
        self.reference.id()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Route {
    pub model: Model,
    pub effort: Option<Effort>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stack {
    pub path: PathBuf,
    pub configured: String,
    pub remote: String,
    pub branch: String,
    pub legacy_paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HarnessConfig {
    pub harness: Harness,
    pub home: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Clean {
    pub skill_roots: Vec<PathBuf>,
    pub keep_skills: Vec<String>,
    pub keep_plugins: Vec<String>,
}

impl Clean {
    pub fn keeps_skill(&self, name: &str) -> bool {
        name.starts_with('.') || name == "synced" || self.keep_skills.iter().any(|pattern| glob(pattern, name))
    }

    pub fn keeps_plugin(&self, id: &str) -> bool {
        self.keep_plugins.iter().any(|pattern| glob(pattern, id))
    }
}

pub(crate) fn glob(pattern: &str, text: &str) -> bool {
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
    pub harnesses: Vec<HarnessConfig>,
    pub codex_home: PathBuf,
    pub models: BTreeMap<String, Model>,
    pub leads: BTreeMap<Harness, Route>,
    pub review: BTreeMap<Harness, Route>,
    pub sheets: BTreeMap<Harness, Vec<(String, String)>>,
    pub clean: Clean,
    pub prompt_runner: Vec<String>,
    pub incidents: Incidents,
    pub exe: PathBuf,
    pub exe_flags: Vec<String>,
}

pub fn default_config_text() -> &'static str {
    include_str!("../config.default.toml")
}

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

fn valid_openrouter_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || "._~:/-".contains(c))
}

fn render_descriptor(label: &str, lane: &str, registry: &Registry) -> Result<String> {
    let (provider, rest) = lane.split_once(':').ok_or_else(|| anyhow!("lane {lane:?} is not `<provider>:<family or model>@<effort>`, inherit-parent or auto"))?;
    let (model, effort) = rest.split_once('@').ok_or_else(|| anyhow!("lane {lane:?} has no `@<effort>`"))?;
    ensure!(
        registry.knows(provider),
        "lane {lane:?}: unknown provider {provider:?}; pstack accepts {}",
        registry.providers.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>().join(", ")
    );
    let any_openrouter_model = provider == "pi" && model.strip_prefix("openrouter/").is_some_and(valid_openrouter_id);
    let (rendered, efforts): (String, Vec<String>) = match registry.resolve(provider, model) {
        Some(reference) => (reference.id().to_owned(), reference.efforts().to_vec()),
        None if any_openrouter_model => (model.to_owned(), OPENROUTER_EFFORTS.map(String::from).to_vec()),
        None => {
            let mut known: Vec<&str> = registry
                .families_of(provider)
                .flat_map(|family| [family.name.as_str(), family.model.as_str()].into_iter().chain(family.kept.iter().map(|kept| kept.model.as_str())))
                .collect();
            known.dedup();
            bail!("lane {lane:?}: pstack has no {provider} model {model:?}; known families and models: {}", known.join(", "));
        }
    };
    ensure!(efforts.iter().any(|allowed| allowed == effort), "lane {lane:?}: effort {effort:?} is not selectable for {provider}:{model}; allowed: {}", efforts.join(", "));
    ensure!(
        !(WRITER_ROWS.contains(&label) && registry.read_only(provider)),
        "lane {lane:?}: row {label:?} writes files, and {provider} lanes are read-only; choose claude or codex",
    );
    Ok(format!("{provider}:{rendered}@{effort}"))
}

fn resolve_model(alias: &str, entry: &ModelEntry, registry: &Registry) -> Result<(ModelRef, Provider)> {
    let harness_families = || registry.families.iter().filter_map(|family| Provider::of(family).map(|provider| (family, provider)));
    let (reference, provider) = match (&entry.family, &entry.id) {
        (Some(name), None) => harness_families()
            .find(|(family, _)| &family.name == name)
            .map(|(family, provider)| (ModelRef::Family(family.clone()), provider))
            .ok_or_else(|| {
                let known: Vec<&str> = harness_families().map(|(family, _)| family.name.as_str()).collect();
                anyhow!("model \"{alias}\": unknown family {name:?}; known families: {}", known.join(", "))
            })?,
        (None, Some(id)) => harness_families()
            .find_map(|(family, provider)| family.pin(id).map(|reference| (reference, provider)))
            .ok_or_else(|| {
                let migration = ["claude", "codex"].into_iter().find_map(|provider| registry.family_of_slug(provider, id));
                match migration {
                    Some(family) => anyhow!("model \"{alias}\": id {id:?} is not a model pstack registers; run `ai-stack models --bump` to name its family \"{}\" instead", family.name),
                    None => anyhow!("model \"{alias}\": unknown model id {id:?}; use `family` (such as \"sol\") or a model id pstack registers"),
                }
            })?,
        _ => bail!("model \"{alias}\" needs exactly one of `family` (such as \"sol\") or `id` (an exact model id)"),
    };
    if let Some(given) = entry.provider {
        ensure!(given == provider, "model \"{alias}\": provider {} disagrees with {}, whose provider is {}", given.as_str(), reference.id(), provider.as_str());
    }
    Ok((reference, provider))
}

fn resolve_sheet(harness: Harness, rows: &BTreeMap<String, Lanes>, registry: &Registry) -> Result<Vec<(String, String)>> {
    let table = format!("[sheet.{}]", harness.as_str());
    for label in rows.keys() {
        ensure!(SHEET_ROWS.contains(&label.as_str()), "{table}: unknown pstack model row {label:?}");
    }
    let mut sheet = Vec::new();
    for label in SHEET_ROWS {
        let value = rows.get(label).ok_or_else(|| anyhow!("{table}: missing pstack model row {label:?}"))?;
        let lanes: Vec<&str> = match value {
            Lanes::Single(lane) => vec![lane.trim()],
            Lanes::Panel(lanes) => {
                ensure!(PANEL_ROWS.contains(&label), "{table}: pstack model row {label:?} is not a panel; give one lane");
                ensure!(!lanes.is_empty(), "{table}: pstack model panel {label:?} is empty");
                lanes.iter().map(|lane| lane.trim()).collect()
            }
        };
        let mut rendered = Vec::with_capacity(lanes.len());
        for lane in lanes {
            if PARENT_LANES.contains(&lane) {
                rendered.push(lane.to_owned());
                continue;
            }
            ensure!(!PARENT_ROWS.contains(&label), "{table}: pstack model row {label:?} needs the parent's MCP servers; use inherit-parent or auto");
            rendered.push(render_descriptor(label, lane, registry).map_err(|err| anyhow!("{table}: row {label:?}: {err}"))?);
        }
        sheet.push((label.to_owned(), rendered.join(", ")));
    }
    Ok(sheet)
}

pub struct Unresolved {
    file: ConfigFile,
    stack: Stack,
    home: PathBuf,
}

pub fn parse(text: &str, home: &Path, stack_override: Option<&Path>) -> Result<Unresolved> {
    let table: toml::Table = toml::from_str(text)?;
    let older = table.contains_key("roles")
        || table.contains_key("install")
        || table.get("stack").and_then(|stack| stack.get("models")).is_some();
    ensure!(!older, "this config is from an older ai-stack ([roles], [stack.models] or [install]); run `ai-stack init --force`, then re-apply your edits");
    let file: ConfigFile = toml::Value::Table(table).try_into()?;
    let stack = stack_of(&file.stack, home, stack_override)?;
    Ok(Unresolved { file, stack, home: home.to_path_buf() })
}

fn stack_of(section: &StackSection, home: &Path, stack_override: Option<&Path>) -> Result<Stack> {
    let mut stack = Stack {
        path: crate::paths::absolute(&section.path, home)?,
        configured: section.path.clone(),
        remote: section.remote.clone(),
        branch: section.branch.clone(),
        legacy_paths: section.legacy_paths.iter().map(|p| crate::paths::absolute(p, home)).collect::<std::io::Result<_>>()?,
    };
    if let Some(over) = stack_override {
        stack.configured = over.to_string_lossy().into_owned();
        let configured = std::mem::replace(&mut stack.path, crate::paths::absolute(&stack.configured, home)?);
        stack.legacy_paths.push(configured);
    }
    Ok(stack)
}

pub fn parse_lint(text: &str, home: &Path, stack_override: Option<&Path>) -> Result<(Stack, LintSection)> {
    #[derive(Deserialize)]
    struct LintFile {
        stack: StackSection,
        #[serde(default)]
        lint: LintSection,
    }
    let mut table: toml::Table = toml::from_str(text)?;
    table.retain(|key, _| key == "stack" || key == "lint");
    let file: LintFile = toml::Value::Table(table).try_into()?;
    Ok((stack_of(&file.stack, home, stack_override)?, file.lint))
}

impl Unresolved {
    pub fn stack(&self) -> &Stack {
        &self.stack
    }

    pub fn resolve(self, registry: &Registry) -> Result<Config> {
        let Unresolved { file, stack, home } = self;
        let mut models = BTreeMap::new();
        for (alias, entry) in file.models {
            ensure!(valid_name(&alias), "invalid model alias \"{alias}\": use lowercase letters, digits and '-'");
            let (reference, provider) = resolve_model(&alias, &entry, registry)?;
            ensure!(entry.efforts.as_ref().is_none_or(|efforts| !efforts.is_empty()), "model \"{alias}\" has an empty efforts list");
            ensure!(entry.context != Some(0), "model \"{alias}\" has a zero context limit");
            models.insert(alias.clone(), Model { alias, reference, provider, efforts: entry.efforts, context: entry.context });
        }

        let harnesses = Harness::ALL
            .into_iter()
            .filter(|harness| harness_entry(&file.harness, *harness).enabled)
            .map(|harness| Ok(HarnessConfig { harness, home: crate::paths::absolute(&harness_entry(&file.harness, harness).home, &home)? }))
            .collect::<std::io::Result<_>>()?;
        let codex_home = crate::paths::absolute(&file.harness.codex.home, &home)?;

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
            sheets.insert(harness, resolve_sheet(harness, file.sheet.get(harness), registry)?);
        }
        let clean = Clean {
            skill_roots: file.clean.skill_roots.iter().map(|p| crate::paths::absolute(p, &home)).collect::<std::io::Result<_>>()?,
            keep_skills: file.clean.keep_skills,
            keep_plugins: file.clean.keep_plugins,
        };
        ensure!(!file.skills.prompt_runner.is_empty(), "[skills] prompt_runner is empty");
        let incident_path = crate::paths::expand(&file.incidents.path, &home);
        let incident_path = if incident_path.is_absolute() { incident_path } else { home.join(incident_path) };
        let incidents = Incidents { path: crate::paths::normalize(&incident_path), worker: file.incidents.worker };
        Ok(Config { home, stack, harnesses, codex_home, models, leads, review, sheets, clean, prompt_runner: file.skills.prompt_runner, incidents, exe: std::env::current_exe().unwrap_or_else(|_| PathBuf::from("ai-stack")), exe_flags: Vec::new() })
    }
}

pub fn from_str(text: &str, home: &Path, stack_override: Option<&Path>) -> Result<Config> {
    let unresolved = parse(text, home, stack_override)?;
    let registry = Registry::load(&unresolved.stack.path)?;
    unresolved.resolve(&registry)
}

pub fn flat(text: &str, home: &Path, stack_override: Option<&Path>) -> Result<crate::drift::Flat> {
    from_str(text, home, stack_override)?;
    let file: ConfigFile = toml::from_str(text)?;
    fn flatten(prefix: &str, value: serde_json::Value, flat: &mut crate::drift::Flat) {
        if let serde_json::Value::Object(table) = value {
            for (key, value) in table {
                let key = if prefix.is_empty() { key } else { format!("{prefix}.{key}") };
                flatten(&key, value, flat);
            }
        } else {
            flat.insert(prefix.to_string(), value);
        }
    }
    let mut flat = crate::drift::Flat::new();
    flatten("", serde_json::to_value(file)?, &mut flat);
    Ok(flat)
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

pub fn read(path: &Path) -> Result<String> {
    std::fs::read_to_string(path).map_err(|e| anyhow!("cannot read config {}: {e}. Run `ai-stack init`.", path.display()))
}

pub fn load(path: &Path, home: &Path, stack_override: Option<&Path>) -> Result<Config> {
    from_str(&read(path)?, home, stack_override)
}

#[cfg(test)]
pub(crate) fn fixture_registry() -> Registry {
    Registry::parse(include_str!("../tests/fixtures/model-families.json")).unwrap()
}

#[cfg(test)]
pub(crate) fn test_config(text: &str, home: &Path) -> Result<Config> {
    parse(text, home, None)?.resolve(&fixture_registry())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn err_of(text: &str) -> String {
        test_config(text, Path::new("/h")).expect_err("config should be rejected").to_string()
    }

    #[test]
    fn default_config_resolves() {
        let cfg = test_config(default_config_text(), Path::new("/h")).unwrap();
        assert_eq!(cfg.stack.path, PathBuf::from("/h/Documents/Projects/@joshmeads/ai-stack"));
        assert_eq!(cfg.leads[&Harness::Claude].model.id(), "opus");
        assert_eq!(cfg.leads[&Harness::Codex].model.id(), "gpt-6.2-sol");
        assert_eq!(cfg.review[&Harness::Codex].model.id(), "gpt-6.2-astra");
        assert_eq!(cfg.models["haiku"].context, Some(100_000));
        assert_eq!(cfg.sheets[&Harness::Codex].len(), 15);
        assert_eq!(cfg.clean.skill_roots[2], PathBuf::from("/h/.agents/skills"));
        let text = default_config_text();
        let older = test_config(&text[..text.find("[clean]").unwrap()], Path::new("/h")).unwrap();
        assert_eq!(older.clean, cfg.clean);
        assert_eq!(older.prompt_runner, cfg.prompt_runner);
        assert_eq!(cfg.prompt_runner[0], "claude");
        let relative = test_config(&text.replace("~/.local/state/ai-stack/incidents.md", "incidents.md"), Path::new("/h")).unwrap();
        assert_eq!(relative.incidents.path, PathBuf::from("/h/incidents.md"));
    }

    #[test]
    fn families_come_from_the_stack_checkout_so_a_release_needs_no_rebuild() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let shipped = from_str(default_config_text(), Path::new("/h"), Some(repo)).unwrap();
        assert_eq!(shipped.stack.path, repo);

        let stack = tempfile::tempdir().unwrap();
        let missing = format!("{:#}", from_str(default_config_text(), Path::new("/h"), Some(stack.path())).unwrap_err());
        assert!(missing.contains(&format!("cannot read the model family table {}", stack.path().join(FAMILIES_FILE).display())), "{missing}");

        let table = stack.path().join(FAMILIES_FILE);
        std::fs::create_dir_all(table.parent().unwrap()).unwrap();
        std::fs::write(&table, "{\"families\": []}").unwrap();
        let unreadable = format!("{:#}", from_str(default_config_text(), Path::new("/h"), Some(stack.path())).unwrap_err());
        assert!(unreadable.contains(&format!("cannot load the model family table {}", table.display())), "{unreadable}");

        let released = std::fs::read_to_string(repo.join(FAMILIES_FILE)).unwrap().replace(&format!("\"model\": \"{}\"", shipped.leads[&Harness::Codex].model.id()), "\"model\": \"gpt-99-sol\"");
        std::fs::write(&table, released).unwrap();
        let cfg = from_str(default_config_text(), Path::new("/h"), Some(stack.path())).unwrap();
        assert_eq!(cfg.leads[&Harness::Codex].model.id(), "gpt-99-sol");
        assert!(cfg.sheets[&Harness::Codex].iter().any(|(label, lanes)| label == "bug-fix" && lanes == "codex:gpt-99-sol@medium"));
    }

    #[test]
    fn clean_keep_lists_match_globs_and_always_keep_dot_entries_and_synced() {
        let clean = test_config(default_config_text(), Path::new("/h")).unwrap().clean;
        for kept in ["better-ui", "cua-driver", "turborepo", ".system", ".DS_Store", "synced"] {
            assert!(clean.keeps_skill(kept), "{kept}");
        }
        for moved in ["better", "how", "turborepo-extra", "xcua-driver"] {
            assert!(!clean.keeps_skill(moved), "{moved}");
        }
        for kept in ["github@claude-plugins-official", "browser@openai-bundled", "pdf@openai-primary-runtime"] {
            assert!(clean.keeps_plugin(kept), "{kept}");
        }
        for removed in ["pstack@other", "expo@claude-plugins-official", "pdf-viewer@synced", "github@jm"] {
            assert!(!clean.keeps_plugin(removed), "{removed}");
        }
    }

    #[test]
    fn rejects_invalid_sheet_rows_and_descriptors() {
        let base = default_config_text();
        let bug = "\"bug-fix\" = \"claude:opus@medium\"";
        for (text, message) in [
            (base.replace(bug, "\"bug-fix\" = \"opus@medium\""), "is not `<provider>:<family or model>@<effort>`"),
            (base.replace(bug, "\"bug-fix\" = \"claude:opus\""), "has no `@<effort>`"),
            (base.replace(bug, "\"bug-fix\" = \"grok:grok-4.7@xhigh\""), "unknown provider \"grok\""),
            (base.replace(bug, "\"bug-fix\" = \"claude:claude-opus-5-5@high\""), "has no claude model \"claude-opus-5-5\""),
            (base.replace(bug, "\"bug-fix\" = \"claude:opus@ultra\""), "effort \"ultra\" is not selectable"),
            (base.replace(bug, "\"bug-fix\" = [\"claude:opus@high\"]"), "is not a panel"),
            (base.replace(bug, "\"unknown\" = \"claude:opus@high\""), "unknown pstack model row \"unknown\""),
            (base.replace(&format!("{bug}\n"), ""), "[sheet.claude]: missing pstack model row \"bug-fix\""),
            (base.replacen("\"why investigators, synthesizer\" = \"inherit-parent\"", "\"why investigators, synthesizer\" = \"claude:opus@high\"", 1), "needs the parent's MCP servers"),
            (base.replace("[\"claude:opus@high\", \"claude:opus@medium\"]", "[]"), "is empty"),
            (format!("{base}\n[roles.worker]\nclaude = \"opus\"\n"), "older ai-stack"),
        ] {
            assert_ne!(text, base);
            let msg = err_of(&text);
            assert!(msg.contains(message), "{message:?} not in {msg}");
        }
        assert!(test_config(&base.replace(bug, "\"bug-fix\" = \"claude:sonnet@high\""), Path::new("/h")).is_ok());
    }

    #[test]
    fn families_render_as_their_current_model_and_exact_ids_stay_pinned() {
        let base = default_config_text();
        let lane = |cfg: &Config, harness: Harness, row: &str| cfg.sheets[&harness].iter().find(|(label, _)| label == row).unwrap().1.clone();
        let cfg = test_config(base, Path::new("/h")).unwrap();
        assert_eq!(lane(&cfg, Harness::Codex, "bug-fix"), "codex:gpt-6.2-sol@medium");
        assert_eq!(lane(&cfg, Harness::Codex, "how explorer"), "codex:gpt-6.1-terra@xhigh");
        assert_eq!(lane(&cfg, Harness::Codex, "arena cross-judge pool"), "claude:opus@xhigh, codex:gpt-6.2-astra@xhigh");
        assert_eq!(lane(&cfg, Harness::Claude, "bug-fix"), "claude:opus@medium");

        let pinned = base
            .replace("\"bug-fix\" = \"codex:sol@medium\"", "\"bug-fix\" = \"codex:gpt-6.1-sol@ultra\"")
            .replace("[models.sol]\nfamily = \"sol\"", "[models.sol]\nprovider = \"openai\"\nid = \"gpt-6.1-sol\"");
        let cfg = test_config(&pinned, Path::new("/h")).unwrap();
        assert_eq!(lane(&cfg, Harness::Codex, "bug-fix"), "codex:gpt-6.1-sol@ultra");
        assert_eq!(cfg.leads[&Harness::Codex].model.id(), "gpt-6.1-sol");
        assert_eq!(cfg.leads[&Harness::Codex].model.provider, Provider::Openai);

        let sol = "[models.sol]\nfamily = \"sol\"";
        for (text, message) in [
            (base.replace("\"bug-fix\" = \"codex:sol@medium\"", "\"bug-fix\" = \"codex:gpt-6.12-sol@medium\""), "has no codex model \"gpt-6.12-sol\""),
            (base.replace(sol, "[models.sol]\nfamily = \"sol\"\nid = \"gpt-6.2-sol\""), "needs exactly one of `family`"),
            (base.replace(sol, "[models.sol]\nprovider = \"openai\""), "needs exactly one of `family`"),
            (base.replace(sol, "[models.sol]\nfamily = \"sol\"\nprovider = \"anthropic\""), "provider anthropic disagrees with gpt-6.2-sol, whose provider is openai"),
            (base.replace(sol, "[models.sol]\nfamily = \"grok-4.7\""), "unknown family \"grok-4.7\""),
            (base.replace(sol, "[models.sol]\nid = \"gpt-6.12-sol\""), "unknown model id \"gpt-6.12-sol\""),
            (base.replace("[models.opus]\nfamily = \"opus\"", "[models.opus]\nid = \"claude-opus-5-5\""), "run `ai-stack models --bump` to name its family \"opus\""),
        ] {
            assert_ne!(text, base);
            let msg = err_of(&text);
            assert!(msg.contains(message), "{message:?} not in {msg}");
        }
    }

    #[test]
    fn read_only_providers_fit_read_only_rows_and_never_writer_rows() {
        let base = default_config_text();
        let lane = "opencode:opencode/deepseek-v4.1-flash-free@high";
        let judgment = "\"judgment and prose\" = \"claude:opus@xhigh\"";
        let cfg = test_config(&base.replace(judgment, &format!("\"judgment and prose\" = \"{lane}\"")), Path::new("/h")).unwrap();
        assert!(cfg.sheets[&Harness::Claude].iter().any(|(label, lanes)| label == "judgment and prose" && lanes == lane));
        let panel = "\"interrogate reviewers\" = [\"claude:opus@xhigh\", \"codex:astra@xhigh\"]";
        assert!(test_config(&base.replace(panel, "\"interrogate reviewers\" = [\"claude:opus@xhigh\", \"cursor:composer-2.5@default\"]"), Path::new("/h")).is_ok());
        let writer = base.replace("\"bug-fix\" = \"claude:opus@medium\"", &format!("\"bug-fix\" = \"{lane}\""));
        let msg = err_of(&writer);
        assert!(msg.contains("row \"bug-fix\" writes files, and opencode lanes are read-only"), "{msg}");
        let effort = base.replace(judgment, "\"judgment and prose\" = \"agy:gemini-3.8-flash@xhigh\"");
        assert!(err_of(&effort).contains("effort \"xhigh\" is not selectable"));
    }

    #[test]
    fn arena_seats_take_read_only_providers_and_the_other_writer_rows_refuse_them() {
        let cfg = test_config(default_config_text(), Path::new("/h")).unwrap();
        let arena = |harness: Harness| cfg.sheets[&harness].iter().find(|(label, _)| label == "arena runners").unwrap().1.clone();
        assert_eq!(arena(Harness::Claude), "claude:opus@high, codex:gpt-6.2-sol@high, cursor:grok-4.7@high, agy:gemini-4-argon@high");
        assert_eq!(arena(Harness::Codex), "codex:gpt-6.2-sol@high, claude:opus@high, cursor:grok-4.7@high, agy:gemini-4-argon@high");
        let base = default_config_text();
        let lane = "pi:openrouter/~google/gemini-pro-latest@high";
        for (row, value) in [
            ("architect runners", "[\"claude:opus@high\", \"claude:opus@medium\"]"),
            ("swarm workers", "\"claude:opus@medium\""),
            ("bug-fix", "\"claude:opus@medium\""),
        ] {
            let text = base.replacen(&format!("\"{row}\" = {value}"), &format!("\"{row}\" = \"{lane}\""), 1);
            assert_ne!(text, base);
            let msg = err_of(&text);
            assert!(msg.contains(&format!("row \"{row}\" writes files, and pi lanes are read-only")), "{msg}");
        }
        assert!(err_of(&base.replace("cursor:grok-4.7@high", "cursor:grok-4.7@max")).contains("effort \"max\" is not selectable"));
        assert!(err_of(&base.replace("cursor:grok-4.7@high", "grok:grok-4.7@high")).contains("unknown provider \"grok\""));
    }

    #[test]
    fn any_openrouter_model_fits_a_read_only_row_through_pi() {
        let base = default_config_text();
        let seat = |lane: &str| base.replace("cursor:grok-4.7@high", lane);
        assert!(test_config(&seat("pi:openrouter/~moonshotai/kimi-latest@high"), Path::new("/h")).is_ok());
        assert!(test_config(&seat("pi:openrouter/x-ai/grok_4.7:free@high"), Path::new("/h")).is_ok());
        assert!(err_of(&seat("pi:openrouter/@high")).contains("has no pi model"));
        for unsafe_id in ["x\\nbug-fix: pi:openrouter/y", "x y", "x,y", "x\\u0007y", "x\\ty"] {
            assert!(err_of(&seat(&format!("pi:openrouter/{unsafe_id}@high"))).contains("has no pi model"), "{unsafe_id}");
        }
        assert!(err_of(&seat("pi:anthropic/claude@high")).contains("has no pi model"));
        assert!(err_of(&seat("pi:openrouter/~moonshotai/kimi-latest@ultra")).contains("effort \"ultra\" is not selectable"));
        let writer = base.replace("\"bug-fix\" = \"claude:opus@medium\"", "\"bug-fix\" = \"pi:openrouter/~moonshotai/kimi-latest@high\"");
        assert!(err_of(&writer).contains("row \"bug-fix\" writes files, and pi lanes are read-only"));
    }

    #[test]
    fn routes_need_known_models_and_efforts() {
        let base = default_config_text();
        let msg = err_of(&base.replace("claude = \"opus@high\"", "claude = \"opus\""));
        assert!(msg.contains("[leads] claude needs an effort"), "{msg}");
        let msg = err_of(&base.replace("codex = \"astra@xhigh\"", "codex = \"nope@xhigh\""));
        assert!(msg.contains("[review] codex: unknown model alias \"nope\""), "{msg}");
    }
}
