use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use ast_grep_core::matcher::MatcherExt as _;
use ast_grep_core::tree_sitter::{LanguageExt as _, StrDoc};
use ast_grep_core::{AstGrep, Language as _, Matcher as _, NodeMatch};
use ast_grep_language::SupportLang;
use regex::Regex;

use super::owned::LineIndex;
use super::repo::{Repo, Repos};
use super::rules::{Rule, Rules};
use super::settings::{Policy, Settings};
use super::{Baseline, Finding, Owned, Scope, Severity};

pub const TEST_FILE_NAMES: &str = "test-file-names";

pub struct Change {
    pub path: PathBuf,
    pub source: String,
    pub owned: Owned,
    pub created: bool,
}

impl Change {
    pub fn read(path: PathBuf, baseline: &Baseline) -> Option<Change> {
        let source = read_lintable(&path)?;
        if matches!(baseline, Baseline::Text(before) if *before == source) {
            return None;
        }
        let owned = Owned::between(baseline, &source);
        Some(Change { path, source, owned, created: *baseline == Baseline::Absent })
    }
}

pub fn read_lintable(path: &Path) -> Option<String> {
    if language_of(path).is_none() || !std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file()) {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

struct Target {
    change: Change,
    repo: Option<Repo>,
}

pub struct Engine<'a> {
    pub settings: &'a Settings,
    pub rules: &'a Rules,
    pub scope: Option<Scope>,
    pub display: &'a Path,
}

impl Engine<'_> {
    pub fn lint(&self, changes: Vec<Change>) -> Vec<Finding> {
        let mut repos = Repos::default();
        let mut findings = Vec::new();
        let mut by_repo: Vec<(Option<Repo>, Vec<Target>)> = Vec::new();
        for change in changes {
            let repo = repos.of(&change.path);
            let target = Target { change, repo };
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
            let rels: Vec<PathBuf> = group.iter().map(relative).collect();
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

    fn lint_target(&self, target: &Target, rel: &Path, policy: &Policy) -> Vec<Finding> {
        let change = &target.change;
        let Some(language) = language_of(&change.path) else { return Vec::new() };
        let shown = display_path(&change.path, self.display);
        let source = change.source.as_str();
        let mut findings = Vec::new();
        if change.created
            && let Some(message) = misnamed(&change.path)
            && policy.allows(TEST_FILE_NAMES, rel)
            && let Some(severity) = policy.severity(TEST_FILE_NAMES, Some(Severity::Error), false)
        {
            let snippet = source.lines().next().unwrap_or_default().to_string();
            let text = change.path.to_string_lossy().into_owned();
            findings.push(Finding { file: change.path.clone(), path: shown.clone(), rule: TEST_FILE_NAMES.into(), severity, line: 1, column: 1, end_line: 1, message: message.into(), snippet, text });
        }
        let active: Vec<(&Rule, Severity)> = self
            .rules
            .for_language(language)
            .filter(|rule| rule.applies_to_path(rel) && policy.allows(&rule.key.id, rel) && rule.applies_to_source(source))
            .filter_map(|rule| policy.severity(&rule.key.id, rule.base, rule.default_off).map(|severity| (rule, severity)))
            .collect();
        let scope = self.scope.unwrap_or(policy.scope());
        if active.is_empty() || (change.owned.is_empty() && scope != Scope::File) {
            return findings;
        }
        let root = language.ast_grep(source);
        let index = LineIndex::new(source);
        let owned = match scope {
            Scope::Lines => change.owned.clone(),
            Scope::Function => change.owned.widen(&function_spans(&root, language, &index)),
            Scope::File => Owned::whole(source),
        };
        let rules: Vec<&Rule> = active.iter().map(|(rule, _)| *rule).collect();
        for (at, found) in scan(&rules, &root, source, &index) {
            let (rule, severity) = active[at];
            let bytes = found.range();
            let span = index.span(bytes.clone());
            if !owned.intersects(span.clone()) {
                continue;
            }
            let line_start = index.start(*span.start());
            let column = source[line_start..bytes.start].chars().count() as u32 + 1;
            let line_end = source[line_start..].find('\n').map_or(source.len(), |at| line_start + at);
            findings.push(Finding {
                file: change.path.clone(),
                path: shown.clone(),
                rule: rule.key.id.clone(),
                severity,
                line: *span.start(),
                column,
                end_line: *span.end(),
                message: rule.config.get_message(&found),
                snippet: source[line_start..line_end].trim_end_matches('\r').to_string(),
                text: found.text().into_owned(),
            });
        }
        findings
    }
}

pub fn scan<'t>(rules: &[&Rule], root: &'t AstGrep<StrDoc<SupportLang>>, source: &str, index: &LineIndex) -> Vec<(usize, NodeMatch<'t, StrDoc<SupportLang>>)> {
    let license = license_header(root, index);
    let allowed: Vec<Vec<RangeInclusive<u32>>> = rules.iter().map(|rule| rule.allowed_regions(source, index, license.as_ref())).collect();
    let mut by_kind: Vec<Vec<usize>> = Vec::new();
    for (at, rule) in rules.iter().enumerate() {
        for kind in rule.config.matcher.potential_kinds().iter().flat_map(|kinds| kinds.iter()) {
            if by_kind.len() <= kind {
                by_kind.resize_with(kind + 1, Vec::new);
            }
            by_kind[kind].push(at);
        }
    }
    let mut found = Vec::new();
    for node in root.root().dfs() {
        let Some(candidates) = by_kind.get(usize::from(node.kind_id())) else { continue };
        for &at in candidates {
            if let Some(matched) = rules[at].config.matcher.match_node(node.clone()) {
                let span = index.span(matched.range());
                if allowed[at].iter().any(|region| region.contains(span.start()) && region.contains(span.end())) {
                    continue;
                }
                found.push((at, matched));
            }
        }
    }
    found
}

fn license_header(root: &AstGrep<StrDoc<SupportLang>>, index: &LineIndex) -> Option<RangeInclusive<u32>> {
    static LICENSE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Copyright|SPDX-License-Identifier|License").unwrap());
    let leading: Vec<_> = root.root().children().take_while(|node| node.kind().contains("comment") || node.kind().contains("hash_bang")).collect();
    let licensed = leading.iter().any(|node| node.kind().contains("comment") && LICENSE.is_match(&node.text()));
    let (first, last) = (leading.first()?, leading.last()?);
    licensed.then(|| *index.span(first.range()).start()..=*index.span(last.range()).end())
}

pub fn language_of(path: &Path) -> Option<SupportLang> {
    SupportLang::from_path(path)
}

fn relative(target: &Target) -> PathBuf {
    target.repo.as_ref().and_then(|repo| repo.relative(&target.change.path)).unwrap_or_else(|| target.change.path.clone())
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
