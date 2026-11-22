use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::str::FromStr as _;

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use ast_grep_config::{GlobalRules, RuleConfig, SerializableRuleConfig, Severity as AstSeverity};
use ast_grep_language::SupportLang;
use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use regex::Regex;
use serde_json::{Map, Value};

use super::Severity;

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
}

impl Rule {
    pub fn applies_to_path(&self, rel: &str) -> bool {
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
    pub fn load(dirs: &[PathBuf]) -> Result<Rules> {
        let mut rules: Vec<Rule> = Vec::new();
        let mut owners: BTreeMap<(String, String), PathBuf> = BTreeMap::new();
        for dir in dirs {
            let mut files: Vec<PathBuf> = match std::fs::read_dir(dir) {
                Ok(entries) => entries
                    .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                    .filter(|path| path.extension().is_some_and(|ext| ext == "yml" || ext == "yaml"))
                    .collect(),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
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
        let default_off = metadata.get("default_off").and_then(Value::as_bool).unwrap_or(false);
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

pub fn glob_set(patterns: &[String]) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        builder.add(GlobBuilder::new(pattern).build().with_context(|| format!("glob {pattern:?}"))?);
    }
    Ok(builder.build()?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn rule_identity_is_the_id_and_language_and_a_clash_across_files_is_a_load_error() {
        let dir = tempfile::tempdir().unwrap();
        let rule = "id: local\nlanguage: [TypeScript, Rust]\nseverity: warning\nmessage: m\nrule:\n  kind: identifier\n";
        std::fs::write(dir.path().join("a.yml"), rule).unwrap();
        let rules = Rules::load(&[dir.path().to_path_buf()]).unwrap();
        assert_eq!(rules.rules.iter().map(|rule| rule.key.language).collect::<Vec<_>>(), [SupportLang::TypeScript, SupportLang::Rust]);
        std::fs::write(dir.path().join("b.yml"), rule.replace("[TypeScript, Rust]", "Rust")).unwrap();
        let clash = format!("{:#}", Rules::load(&[dir.path().to_path_buf()]).err().unwrap());
        assert!(clash.contains("`local` for Rust is defined in both"), "{clash}");
        std::fs::write(dir.path().join("b.yml"), rule.replace("[TypeScript, Rust]", "Kotlin")).unwrap();
        let missing = format!("{:#}", Rules::load(&[dir.path().to_path_buf()]).err().unwrap());
        assert!(missing.contains("rule `local`") && missing.contains("`Kotlin` is not compiled into ai-stack"), "{missing}");
    }
}
