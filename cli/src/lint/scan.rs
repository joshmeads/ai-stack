use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use ast_grep_config::CombinedScan;
use ast_grep_core::tree_sitter::{LanguageExt as _, StrDoc};
use ast_grep_core::{AstGrep, Language as _};
use ast_grep_language::SupportLang;
use regex::Regex;

use super::owned::LineIndex;
use super::repo::{Repo, Repos};
use super::rules::{Rule, Rules};
use super::settings::{Policy, Settings};
use super::{Baseline, Finding, Owned, Scope, Severity};

pub const TEST_FILE_NAMES: &str = "test-file-names";

pub struct Target {
    pub path: PathBuf,
    pub repo: Option<Repo>,
    pub owned: Owned,
    pub created: bool,
    pub source: String,
}

pub struct Engine<'a> {
    pub settings: &'a Settings,
    pub rules: &'a Rules,
    pub scope: Option<Scope>,
    pub display: &'a Path,
}

impl Engine<'_> {
    pub fn lint(&self, files: Vec<(PathBuf, Baseline)>) -> Vec<Finding> {
        let mut repos = Repos::default();
        let mut targets = Vec::new();
        for (path, baseline) in files {
            if language_of(&path).is_none() {
                continue;
            }
            let Ok(source) = std::fs::read_to_string(&path) else { continue };
            let owned = Owned::between(&baseline, &source);
            if owned.is_empty() {
                continue;
            }
            let repo = repos.of(&path);
            targets.push(Target { path, repo, owned, created: baseline == Baseline::Absent, source });
        }
        let mut findings = Vec::new();
        let mut by_repo: Vec<(Option<Repo>, Vec<Target>)> = Vec::new();
        for target in targets {
            match by_repo.iter_mut().find(|(repo, _)| *repo == target.repo) {
                Some((_, group)) => group.push(target),
                None => by_repo.push((target.repo.clone(), vec![target])),
            }
        }
        for (repo, group) in by_repo {
            let policy = self.settings.policy(repo.as_ref());
            if !policy.enabled() {
                continue;
            }
            let rels: Vec<String> = group.iter().map(relative).collect();
            let generated = repo.as_ref().map(|repo| repo.generated(&rels)).unwrap_or_default();
            for (target, rel) in group.iter().zip(&rels) {
                if generated.contains(rel) || policy.ignored(rel) {
                    continue;
                }
                findings.extend(self.lint_target(target, rel, &policy));
            }
        }
        findings.sort_by(|a, b| (&a.path, a.line, a.column, &a.rule).cmp(&(&b.path, b.line, b.column, &b.rule)));
        findings
    }

    fn lint_target(&self, target: &Target, rel: &str, policy: &Policy) -> Vec<Finding> {
        let Some(language) = language_of(&target.path) else { return Vec::new() };
        let shown = display_path(&target.path, self.display);
        let mut findings = Vec::new();
        if target.created
            && let Some(message) = misnamed(&target.path)
            && policy.allows(TEST_FILE_NAMES, rel)
            && let Some(severity) = policy.severity(TEST_FILE_NAMES, Some(Severity::Error), false)
        {
            let snippet = target.source.lines().next().unwrap_or_default().to_string();
            findings.push(Finding { file: target.path.clone(), path: shown.clone(), rule: TEST_FILE_NAMES.into(), severity, line: 1, column: 1, end_line: 1, message: message.into(), snippet });
        }
        let active: Vec<(&Rule, Severity)> = self
            .rules
            .for_language(language)
            .filter(|rule| rule.applies_to_path(rel) && policy.allows(&rule.key.id, rel) && rule.applies_to_source(&target.source))
            .filter_map(|rule| policy.severity(&rule.key.id, rule.base, rule.default_off).map(|severity| (rule, severity)))
            .collect();
        if active.is_empty() {
            return findings;
        }
        let root = language.ast_grep(&target.source);
        let index = LineIndex::new(&target.source);
        let owned = match self.scope.unwrap_or(policy.scope()) {
            Scope::Lines => target.owned.clone(),
            Scope::Function => target.owned.widen(&function_spans(&root, language, &index)),
            Scope::File => Owned::whole(&target.source),
        };
        let scan = CombinedScan::new(active.iter().map(|(rule, _)| &rule.config).collect());
        for (config, matches) in scan.scan(&root, false).matches {
            let Some((rule, severity)) = active.iter().find(|(rule, _)| std::ptr::eq(&rule.config, config)) else { continue };
            for found in matches {
                let bytes = found.range();
                let span = index.span(bytes.clone());
                if !owned.intersects(span.clone()) {
                    continue;
                }
                let line_start = index.start(*span.start());
                let column = target.source[line_start..bytes.start].chars().count() as u32 + 1;
                let line_end = target.source[line_start..].find('\n').map_or(target.source.len(), |at| line_start + at);
                findings.push(Finding {
                    file: target.path.clone(),
                    path: shown.clone(),
                    rule: rule.key.id.clone(),
                    severity: *severity,
                    line: *span.start(),
                    column,
                    end_line: *span.end(),
                    message: config.get_message(&found),
                    snippet: target.source[line_start..line_end].trim_end_matches('\r').to_string(),
                });
            }
        }
        findings
    }
}

pub fn language_of(path: &Path) -> Option<SupportLang> {
    SupportLang::from_path(path)
}

fn relative(target: &Target) -> String {
    target.repo.as_ref().and_then(|repo| repo.relative(&target.path)).unwrap_or_else(|| target.path.to_string_lossy().into_owned())
}

pub fn display_path(path: &Path, base: &Path) -> String {
    path.strip_prefix(base).unwrap_or(path).to_string_lossy().into_owned()
}

fn function_kinds(language: SupportLang) -> &'static [&'static str] {
    match language {
        SupportLang::Rust => &["function_item", "closure_expression"],
        SupportLang::Python => &["function_definition", "lambda"],
        SupportLang::Go => &["function_declaration", "method_declaration", "func_literal"],
        _ => &["function_declaration", "function_expression", "arrow_function", "method_definition", "generator_function_declaration", "generator_function"],
    }
}

fn function_spans(root: &AstGrep<StrDoc<SupportLang>>, language: SupportLang, index: &LineIndex) -> Vec<RangeInclusive<u32>> {
    let kinds = function_kinds(language);
    root.root().dfs().filter(|node| kinds.contains(&node.kind().as_ref())).map(|node| index.span(node.range())).collect()
}

fn misnamed(path: &Path) -> Option<&'static str> {
    static TEST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.(?:spec|specs|tests)\.[cm]?[jt]sx?$").unwrap());
    static FIXTURE_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:^|[-_.])fixtures?\.[cm]?[jt]sx?$").unwrap());
    static NAMED_FIXTURE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r".\.fixture\.[cm]?[jt]sx?$").unwrap());
    static HELPER: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\.(?:test-helpers?|test-util|testutils?|test-utilities|helpers?|mocks?|stubs?|harness)\.[cm]?[jt]sx?$").unwrap()
    });
    let name = path.file_name()?.to_str()?;
    if TEST.is_match(name) {
        Some("Name test files <subject>.test.ts, adding a runtime infix such as .browser.test.tsx when a Vitest project needs one.")
    } else if FIXTURE_WORD.is_match(name) && !NAMED_FIXTURE.is_match(name) {
        Some("Name test data <subject>.fixture.ts.")
    } else if HELPER.is_match(name) {
        Some("Name test helpers, harnesses and mocks <subject>.test-utils.ts.")
    } else {
        None
    }
}
