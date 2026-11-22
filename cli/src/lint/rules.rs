use std::collections::BTreeMap;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::str::FromStr as _;

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use ast_grep_config::{GlobalRules, RuleConfig, SerializableRuleConfig, Severity as AstSeverity};
use ast_grep_language::SupportLang;
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use regex::Regex;
use serde_json::{Map, Value};

use super::Severity;
use super::owned::LineIndex;

pub const COMPILED: [SupportLang; 6] = [SupportLang::TypeScript, SupportLang::Tsx, SupportLang::JavaScript, SupportLang::Rust, SupportLang::Python, SupportLang::Go];

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RuleKey {
    pub id: String,
    pub language: SupportLang,
}

pub struct Rule {
    pub key: RuleKey,
    pub source: PathBuf,
    pub config: RuleConfig<SupportLang>,
    pub base: Option<Severity>,
    pub default_off: bool,
    files: Option<GlobSet>,
    ignores: Option<GlobSet>,
    unless_file: Option<Regex>,
    when_file: Option<Regex>,
    allow_license_header: bool,
    allow_in: Option<Regex>,
}

impl Rule {
    pub fn allowed_regions(&self, source: &str, index: &LineIndex, license: Option<&RangeInclusive<u32>>) -> Vec<RangeInclusive<u32>> {
        let license = license.filter(|_| self.allow_license_header).cloned();
        let marked = self.allow_in.iter().flat_map(|regions| regions.find_iter(source)).map(|region| index.span(region.range()));
        license.into_iter().chain(marked).collect()
    }

    pub fn applies_to_path(&self, rel: &Path) -> bool {
        self.files.as_ref().is_none_or(|files| files.is_match(rel)) && !self.ignores.as_ref().is_some_and(|ignores| ignores.is_match(rel))
    }

    pub fn applies_to_source(&self, source: &str) -> bool {
        !self.unless_file.as_ref().is_some_and(|fact| fact.is_match(source)) && self.when_file.as_ref().is_none_or(|fact| fact.is_match(source))
    }
}

#[derive(Default)]
pub struct Rules {
    pub rules: Vec<Rule>,
}

impl Rules {
    pub fn load(shipped: &Path, local: Option<&Path>) -> Result<Rules> {
        let mut rules: Vec<Rule> = Vec::new();
        let mut owners: BTreeMap<(String, String), PathBuf> = BTreeMap::new();
        for (dir, required) in std::iter::once((shipped, true)).chain(local.map(|local| (local, false))) {
            let mut files: Vec<PathBuf> = match std::fs::read_dir(dir) {
                Ok(entries) => entries
                    .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                    .filter(|path| path.extension().is_some_and(|ext| ext == "yml" || ext == "yaml"))
                    .collect(),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound && !required => continue,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => bail!("the shipped lint rules directory {} does not exist; check [stack] path or pass --stack", dir.display()),
                Err(err) => return Err(err).with_context(|| format!("reading {}", dir.display())),
            };
            files.sort();
            for file in files {
                let text = std::fs::read_to_string(&file).with_context(|| format!("reading {}", file.display()))?;
                for rule in parse(&text, &file)? {
                    let owner = owners.entry((rule.key.id.clone(), rule.key.language.to_string())).or_insert_with(|| file.clone());
                    ensure!(
                        *owner == file,
                        "lint rule `{}` for {} is defined in both {} and {}; rename one or move both into one file",
                        rule.key.id,
                        rule.key.language,
                        owner.display(),
                        file.display()
                    );
                    rules.push(rule);
                }
            }
        }
        Ok(Rules { rules })
    }

    pub fn for_language(&self, language: SupportLang) -> impl Iterator<Item = &Rule> {
        self.rules.iter().filter(move |rule| rule.key.language == language)
    }
}

pub fn parse(text: &str, source: &Path) -> Result<Vec<Rule>> {
    let docs: Vec<Value> = ast_grep_config::from_multiple(text).map_err(|err| anyhow!("{}: {err}", source.display()))?;
    let mut rules = Vec::new();
    for doc in docs {
        let Value::Object(mut doc) = doc else { bail!("{}: each YAML document must be a rule mapping", source.display()) };
        let id = doc.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).map(str::to_owned).with_context(|| format!("{}: a rule has no `id`", source.display()))?;
        let context = || format!("{}: rule `{id}`", source.display());
        let languages = languages(doc.get("language")).with_context(context)?;
        let files = globs(doc.remove("files")).with_context(context)?;
        let ignores = globs(doc.remove("ignores")).with_context(context)?;
        let metadata = doc.get("metadata").and_then(Value::as_object).cloned().unwrap_or_default();
        let unless_file = fact(&metadata, "unless_file").with_context(context)?;
        let when_file = fact(&metadata, "when_file").with_context(context)?;
        let default_off = flag(&metadata, "default_off").with_context(context)?;
        let allow_license_header = flag(&metadata, "allow_license_header").with_context(context)?;
        let allow_in = fact(&metadata, "allow_in").with_context(context)?;
        for language in languages {
            let mut one = doc.clone();
            one.insert("language".into(), Value::String(language.to_string()));
            let serializable: SerializableRuleConfig<SupportLang> = serde_json::from_value(Value::Object(one)).with_context(context)?;
            let config = RuleConfig::try_from(serializable, &GlobalRules::default()).map_err(|err| anyhow::Error::new(err).context(context()))?;
            let base = match config.severity {
                AstSeverity::Off => None,
                AstSeverity::Error => Some(Severity::Error),
                AstSeverity::Warning | AstSeverity::Info | AstSeverity::Hint => Some(Severity::Warning),
            };
            rules.push(Rule {
                key: RuleKey { id: id.clone(), language },
                source: source.to_path_buf(),
                config,
                base,
                default_off: default_off || base.is_none(),
                files: files.clone(),
                ignores: ignores.clone(),
                unless_file: unless_file.clone(),
                when_file: when_file.clone(),
                allow_license_header,
                allow_in: allow_in.clone(),
            });
        }
    }
    Ok(rules)
}

fn languages(value: Option<&Value>) -> Result<Vec<SupportLang>> {
    let names: Vec<&str> = match value {
        Some(Value::String(name)) => vec![name],
        Some(Value::Array(names)) => names.iter().map(|name| name.as_str().context("`language` entries must be strings")).collect::<Result<_>>()?,
        _ => bail!("`language` must be a language name or a list of them"),
    };
    ensure!(!names.is_empty(), "`language` is empty");
    names
        .into_iter()
        .map(|name| {
            SupportLang::from_str(name).map_err(|_| {
                let compiled: Vec<String> = COMPILED.iter().map(ToString::to_string).collect();
                anyhow!("language `{name}` is not compiled into ai-stack; it has {}", compiled.join(", "))
            })
        })
        .collect()
}

fn globs(value: Option<Value>) -> Result<Option<GlobSet>> {
    let Some(value) = value else { return Ok(None) };
    let Value::Array(entries) = value else { bail!("`files` and `ignores` must be lists of globs") };
    let mut builder = GlobSetBuilder::new();
    for entry in entries {
        let (glob, case_insensitive) = match &entry {
            Value::String(glob) => (glob.as_str(), false),
            Value::Object(config) => (
                config.get("glob").and_then(Value::as_str).context("a glob entry needs `glob`")?,
                config.get("caseInsensitive").and_then(Value::as_bool).unwrap_or(false),
            ),
            _ => bail!("a glob entry must be a string or {{glob, caseInsensitive}}"),
        };
        builder.add(GlobBuilder::new(glob).case_insensitive(case_insensitive).build()?);
    }
    Ok(Some(builder.build()?))
}

fn fact(metadata: &Map<String, Value>, key: &str) -> Result<Option<Regex>> {
    match metadata.get(key) {
        None => Ok(None),
        Some(Value::String(pattern)) => Ok(Some(Regex::new(pattern).with_context(|| format!("metadata.{key}"))?)),
        Some(_) => bail!("metadata.{key} must be a regex string"),
    }
}

fn flag(metadata: &Map<String, Value>, key: &str) -> Result<bool> {
    match metadata.get(key) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => bail!("metadata.{key} must be true or false"),
    }
}

pub fn glob_set(patterns: &[String]) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(GlobBuilder::new(pattern).build().with_context(|| format!("glob {pattern:?}"))?);
    }
    Ok(builder.build()?)
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::BTreeSet;

    use ast_grep_core::tree_sitter::LanguageExt as _;

    use super::*;

    pub(crate) fn shipped() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("lint/rules")
    }

    fn fixture_languages(path: &Path) -> Vec<SupportLang> {
        match path.extension().and_then(|ext| ext.to_str()) {
            Some("js") => vec![SupportLang::JavaScript, SupportLang::TypeScript, SupportLang::Tsx],
            Some("ts") => vec![SupportLang::TypeScript, SupportLang::Tsx],
            _ => crate::lint::scan::language_of(path).into_iter().collect(),
        }
    }

    #[test]
    fn shipped_rules_hit_exactly_the_marked_lines_of_their_fixtures_in_every_language() {
        let rules = Rules::load(&shipped(), None).unwrap();
        let fixtures = shipped().parent().unwrap().join("tests");
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&fixtures).unwrap().map(|entry| entry.unwrap().path()).collect();
        entries.sort();
        let mut covered = BTreeSet::new();
        let mut failures = Vec::new();
        for fixture in entries {
            let name = fixture.file_name().unwrap().to_string_lossy().into_owned();
            let (id, rel) = name.split_once('.').unwrap();
            let id = id.to_string();
            let source = std::fs::read_to_string(&fixture).unwrap();
            let expected: BTreeSet<u32> = source.lines().enumerate().filter(|(_, line)| line.contains("@hit")).map(|(at, _)| at as u32 + 1).collect();
            for language in fixture_languages(&fixture) {
                let active: Vec<&Rule> = rules.for_language(language).filter(|rule| rule.key.id == id && rule.applies_to_path(Path::new(rel)) && rule.applies_to_source(&source)).collect();
                covered.insert((id.clone(), language.to_string()));
                let root = language.ast_grep(&source);
                let index = LineIndex::new(&source);
                let found: BTreeSet<u32> = crate::lint::scan::scan(&active, &root, &source, &index, &crate::lint::Owned::whole(&source)).into_iter().map(|(_, found)| index.line(found.range().start)).collect();
                if found != expected {
                    failures.push(format!("{name} as {language}: expected {expected:?}, found {found:?}"));
                }
            }
        }
        for rule in &rules.rules {
            if !covered.contains(&(rule.key.id.clone(), rule.key.language.to_string())) {
                failures.push(format!("{} for {} has no fixture", rule.key.id, rule.key.language));
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn shipped_rules_never_search_the_whole_program_or_every_sibling() {
        fn walk(value: &Value, unbounded: bool, trail: &str, offenders: &mut Vec<String>) {
            match value {
                Value::Object(map) => {
                    if unbounded && map.get("kind").and_then(Value::as_str).is_some_and(|kind| ["program", "module", "source_file"].contains(&kind)) {
                        offenders.push(trail.to_string());
                    }
                    for (key, child) in map {
                        let to_the_end = child.get("stopBy").and_then(Value::as_str) == Some("end");
                        if to_the_end && ["follows", "precedes"].contains(&key.as_str()) {
                            offenders.push(format!("{trail}.{key}"));
                        }
                        let nested = unbounded || (to_the_end && ["inside", "has"].contains(&key.as_str()));
                        walk(child, nested, &format!("{trail}.{key}"), offenders);
                    }
                }
                Value::Array(items) => items.iter().for_each(|item| walk(item, unbounded, trail, offenders)),
                _ => {}
            }
        }
        let mut offenders = Vec::new();
        for entry in std::fs::read_dir(shipped()).unwrap() {
            let path = entry.unwrap().path();
            for doc in ast_grep_config::from_multiple::<Value>(&std::fs::read_to_string(&path).unwrap()).unwrap() {
                walk(&doc, false, &path.file_name().unwrap().to_string_lossy(), &mut offenders);
            }
        }
        assert!(offenders.is_empty(), "file-level facts belong in metadata (unless_file, when_file, allow_license_header, allow_in): {offenders:?}");
    }

    #[test]
    fn rule_identity_is_the_id_and_language_and_a_clash_across_files_is_a_load_error() {
        let dir = tempfile::tempdir().unwrap();
        let rule = "id: local\nlanguage: [TypeScript, Rust]\nseverity: warning\nmessage: m\nrule:\n  kind: identifier\n";
        std::fs::write(dir.path().join("a.yml"), rule).unwrap();
        let rules = Rules::load(dir.path(), None).unwrap();
        assert_eq!(rules.rules.iter().map(|rule| rule.key.language).collect::<Vec<_>>(), [SupportLang::TypeScript, SupportLang::Rust]);
        std::fs::write(dir.path().join("b.yml"), rule.replace("[TypeScript, Rust]", "Rust")).unwrap();
        let clash = format!("{:#}", Rules::load(dir.path(), None).err().unwrap());
        assert!(clash.contains("`local` for Rust is defined in both"), "{clash}");
        std::fs::write(dir.path().join("b.yml"), rule.replace("[TypeScript, Rust]", "Kotlin")).unwrap();
        let missing = format!("{:#}", Rules::load(dir.path(), None).err().unwrap());
        assert!(missing.contains("rule `local`") && missing.contains("`Kotlin` is not compiled into ai-stack"), "{missing}");
    }
}
