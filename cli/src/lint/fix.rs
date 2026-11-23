use std::collections::HashSet;
use std::ops::Range;
use std::panic::AssertUnwindSafe;
use std::path::Path;
use std::sync::LazyLock;

use ast_grep_core::tree_sitter::{LanguageExt as _, StrDoc};
use ast_grep_core::{AstGrep, Node};
use ast_grep_language::SupportLang;
use regex::Regex;

use super::lines::{LineIndex, hunks};

type Tree = AstGrep<StrDoc<SupportLang>>;
type TreeNode<'t> = Node<'t, StrDoc<SupportLang>>;

const LINE_TERMINATORS: [char; 5] = ['\n', '\r', '\u{85}', '\u{2028}', '\u{2029}'];
const GO_STATEMENT_LISTS: [&str; 7] = ["source_file", "block", "statement_list", "expression_case", "default_case", "type_case", "communication_case"];

pub struct Prior<'a> {
    pub file: Option<&'a str>,
    pub removed: &'a str,
}

impl Prior<'_> {
    fn holds(&self, comment: &str) -> bool {
        comment.lines().map(str::trim).filter(|line| line.chars().any(char::is_alphanumeric)).any(|line| self.file.is_some_and(|file| file.contains(line)) || self.removed.contains(line))
    }
}

pub struct Fixed {
    pub text: String,
    pub removed: Vec<Range<usize>>,
}

pub fn generated_or_vendored(rel: &Path, source: &str) -> bool {
    static MARKER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Code generated|DO NOT EDIT|@generated").unwrap());
    let vendored = rel.components().any(|part| matches!(part.as_os_str().to_str(), Some("vendor" | "third_party" | "node_modules")));
    vendored || source.lines().take(5).any(|line| MARKER.is_match(line))
}

pub fn remove_new_plain_comments(language: SupportLang, source: &str, comments: &[Range<usize>], prior: &Prior) -> Option<Fixed> {
    std::panic::catch_unwind(AssertUnwindSafe(|| fix(language, source, comments, prior))).ok().flatten()
}

fn fix(language: SupportLang, source: &str, comments: &[Range<usize>], prior: &Prior) -> Option<Fixed> {
    let tree = language.ast_grep(source);
    let file = File::new(language, source, &tree, prior.file);
    let mut removed: Vec<Range<usize>> = comments
        .iter()
        .filter_map(|range| tree.root().dfs().find(|node| node.range() == *range && is_comment(node)))
        .filter(|node| file.deletable(node, prior))
        .map(|node| node.range())
        .collect();
    if removed.is_empty() {
        return None;
    }
    removed.sort_by_key(|range| range.start);
    removed.dedup();
    let text = apply(source, &removed);
    verified(source, &tree, &text, &language.ast_grep(&text)).then_some(Fixed { text, removed })
}

struct File<'s> {
    language: SupportLang,
    source: &'s str,
    index: LineIndex,
    edited: Vec<Range<usize>>,
    trailing: HashSet<u32>,
    package_line: Option<u32>,
}

impl<'s> File<'s> {
    fn new(language: SupportLang, source: &'s str, tree: &Tree, before: Option<&str>) -> File<'s> {
        let index = LineIndex::new(source);
        let trailing = tree.root().dfs().filter(is_comment).filter(|node| !blank(&source[line_start(source, node.range().start)..node.range().start])).map(|node| index.line(node.range().start)).collect();
        let package_line = tree.root().children().find(|node| node.kind() == "package_clause").map(|node| index.line(node.range().start));
        File { language, source, edited: edited_commentary(language, before, source), index, trailing, package_line }
    }

    fn deletable(&self, node: &TreeNode, prior: &Prior) -> bool {
        let body = &self.source[without_line_end(self.source, node.range())];
        let line = self.index.line(node.range().start);
        (body.starts_with("//") || body.starts_with('#'))
            && !body.contains(LINE_TERMINATORS)
            && !prior.holds(body)
            && !self.edited.iter().any(|hunk| hunk.contains(&(line as usize - 1)))
            && !self.is_doc(node, body)
            && !looks_like_a_directive(body)
            && (self.language != SupportLang::Go || self.gofmt_stable(node, line))
    }

    fn is_doc(&self, node: &TreeNode, body: &str) -> bool {
        match self.language {
            SupportLang::Rust => (body.starts_with("///") && !body.starts_with("////")) || body.starts_with("//!"),
            SupportLang::Go => directly_above_a_declaration(node, self.source),
            _ => false,
        }
    }

    fn gofmt_stable(&self, node: &TreeNode, line: u32) -> bool {
        let (above, below) = (self.trailing.contains(&(line - 1)), self.trailing.contains(&(line + 1)));
        if self.package_line == Some(line) {
            return false;
        }
        if self.trailing.contains(&line) {
            return !above && !below;
        }
        if above && below {
            return false;
        }
        if node.parent().is_some_and(|parent| GO_STATEMENT_LISTS.contains(&parent.kind().as_ref())) {
            return true;
        }
        let text = |at: u32| at.checked_sub(1).and_then(|at| self.source.split('\n').nth(at as usize)).map(str::trim);
        text(line - 1).is_some_and(|above| above.is_empty() || above.ends_with(['{', '('])) || text(line + 1).is_some_and(|below| below.is_empty() || below.starts_with(['}', ')']))
    }
}

fn edited_commentary(language: SupportLang, before: Option<&str>, after: &str) -> Vec<Range<usize>> {
    let Some(before) = before else { return Vec::new() };
    let tree = language.ast_grep(before);
    let index = LineIndex::new(before);
    let commented: HashSet<usize> = tree.root().dfs().filter(is_comment).flat_map(|node| index.span(node.range())).map(|line| line as usize - 1).collect();
    hunks(before, after).into_iter().filter(|hunk| hunk.old.clone().any(|line| commented.contains(&line))).map(|hunk| hunk.new).collect()
}

fn directly_above_a_declaration(node: &TreeNode, source: &str) -> bool {
    if node.ancestors().any(|ancestor| ancestor.kind() == "block") || !blank(&source[line_start(source, node.range().start)..node.range().start]) {
        return false;
    }
    let mut last = node.clone();
    while let Some(next) = last.next() {
        let gap = &source[without_line_end(source, last.range()).end..next.range().start];
        if gap.matches('\n').count() != 1 {
            return false;
        }
        if !is_comment(&next) {
            return next.is_named();
        }
        last = next;
    }
    false
}

fn looks_like_a_directive(text: &str) -> bool {
    static OPENER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?://+!?|#+)").unwrap());
    static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[@$][A-Za-z]").unwrap());
    static TOOL_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)ignore|disable|suppress|noqa|pragma|codeql|deepcode|nosec|lint").unwrap());
    let after = &text[OPENER.find(text).map_or(0, |opener| opener.end())..];
    let body = after.trim();
    let Some(first) = body.split_whitespace().next() else { return true };
    let letters: Vec<char> = first.chars().filter(|char| char.is_alphabetic()).collect();
    let all_caps = letters.len() > 1 && letters.iter().all(|char| char.is_uppercase());
    !after.starts_with(char::is_whitespace) || !first.starts_with(char::is_alphabetic) || first.contains(':') || all_caps || TAG.is_match(body) || TOOL_WORD.is_match(body)
}

fn without_line_end(source: &str, range: Range<usize>) -> Range<usize> {
    let text = &source[range.clone()];
    let text = text.strip_suffix('\n').unwrap_or(text);
    let text = text.strip_suffix('\r').unwrap_or(text);
    range.start..range.start + text.len()
}

fn is_comment(node: &TreeNode) -> bool {
    matches!(node.kind().as_ref(), "comment" | "line_comment" | "block_comment")
}

fn line_start(source: &str, at: usize) -> usize {
    source[..at].rfind('\n').map_or(0, |newline| newline + 1)
}

fn blank(text: &str) -> bool {
    text.chars().all(|char| char == ' ' || char == '\t' || char == '\r')
}

fn apply(source: &str, comments: &[Range<usize>]) -> String {
    let mut out = String::with_capacity(source.len());
    let mut touched: Vec<usize> = Vec::new();
    let mut copied = 0;
    for comment in comments {
        let comment = without_line_end(source, comment.clone());
        let start = source[..comment.start].trim_end_matches([' ', '\t']).len();
        out.push_str(&source[copied..start]);
        touched.push(out.len());
        copied = comment.end;
    }
    out.push_str(&source[copied..]);
    let lines: Vec<&str> = out.split_inclusive('\n').collect();
    let content = |at: usize| lines[at].strip_suffix('\n').unwrap_or(lines[at]);
    let continued = |at: usize| at > 0 && lines[at - 1].trim_end_matches(['\n', '\r']).ends_with('\\');
    let mut keep = vec![true; lines.len()];
    let mut emptied = Vec::new();
    let mut at = 0;
    for (line, text) in lines.iter().enumerate() {
        let span = at..at + text.len();
        at = span.end;
        let was_touched = touched.iter().any(|&edit| span.start <= edit && edit <= span.end && !(edit == span.end && text.ends_with('\n')));
        if was_touched && blank(content(line)) && !continued(line) {
            keep[line] = false;
            emptied.push(line);
        }
    }
    for line in emptied {
        let previous = (0..line).rev().find(|&at| keep[at]);
        let next = (line + 1..lines.len()).find(|&at| keep[at]);
        let spare = |at: usize| blank(content(at)) && !continued(at);
        let opens = previous.is_none_or(|at| blank(content(at)) || content(at).trim_end().ends_with(['{', '(', '[', ':']));
        let closes = next.is_none_or(|at| content(at).trim_start().starts_with(['}', ')', ']']));
        match (previous, next) {
            (_, Some(next)) if opens && spare(next) => keep[next] = false,
            (Some(previous), _) if closes && spare(previous) => keep[previous] = false,
            _ => {}
        }
    }
    lines.iter().zip(&keep).filter(|(_, keep)| **keep).map(|(line, _)| *line).collect()
}

struct Token {
    kind: String,
    text: String,
    range: Range<usize>,
}

fn tokens(node: &TreeNode, out: &mut Vec<Token>) {
    if is_comment(node) {
        return;
    }
    if node.children().len() == 0 {
        out.push(Token { kind: node.kind().into_owned(), text: node.text().into_owned(), range: node.range() });
        return;
    }
    for child in node.children() {
        tokens(&child, out);
    }
}

fn errors(node: &TreeNode) -> usize {
    node.dfs().filter(|node| node.is_error() || node.is_missing()).count()
}

fn verified(old_source: &str, before: &Tree, new_source: &str, after: &Tree) -> bool {
    if errors(&after.root()) > errors(&before.root()) {
        return false;
    }
    let (mut old, mut new) = (Vec::new(), Vec::new());
    tokens(&before.root(), &mut old);
    tokens(&after.root(), &mut new);
    let same_tokens = old.len() == new.len() && old.iter().zip(&new).all(|(a, b)| a.kind == b.kind && a.text == b.text);
    let breaks = |source: &str, tokens: &[Token]| -> Vec<bool> { tokens.windows(2).map(|pair| source.get(pair[0].range.end..pair[1].range.start).is_none_or(|gap| gap.contains(LINE_TERMINATORS))).collect() };
    same_tokens && breaks(old_source, &old) == breaks(new_source, &new)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed(language: SupportLang, source: &str, prior: &Prior) -> String {
        let tree = language.ast_grep(source);
        let comments: Vec<Range<usize>> = tree.root().dfs().filter(|node| is_comment(node) && node.text().contains("note")).map(|node| node.range()).collect();
        remove_new_plain_comments(language, source, &comments, prior).map_or_else(|| source.to_string(), |fixed| fixed.text)
    }

    #[test]
    fn only_new_plain_line_comments_are_deleted_and_every_token_line_break_and_format_is_kept() {
        let new = Prior { file: None, removed: "" };
        let removed = [
            (SupportLang::JavaScript, "  console.log('é'); // note\n", "  console.log('é');\n"),
            (SupportLang::JavaScript, "\n\n\nconst a = 1; // note\n", "\n\n\nconst a = 1;\n"),
            (SupportLang::Rust, "fn f() {\n    let a = 1; // note\n\n    // note\n    a\n}\n", "fn f() {\n    let a = 1;\n\n    a\n}\n"),
            (SupportLang::Rust, "fn f() {\r\n    let a = 1; // note\r\n    a\r\n}\r\n", "fn f() {\r\n    let a = 1;\r\n    a\r\n}\r\n"),
            (SupportLang::Python, "x = 1 \\\n# note\nprint(x)\n", "x = 1 \\\n\nprint(x)\n"),
            (SupportLang::Python, "def f():\n    # note\n    return 1  # note\n", "def f():\n    return 1\n"),
            (SupportLang::Python, "x = 2  # note\r\ny = 3\r\n", "x = 2\r\ny = 3\r\n"),
            (SupportLang::Python, "x = 1\n\n# note\n", "x = 1\n"),
            (SupportLang::Go, "package main\n\n// note\n\nfunc main() {}\n", "package main\n\nfunc main() {}\n"),
            (SupportLang::Go, "package main\n\nfunc main() {\n\ta := 1\n\t// note\n\tprintln(a) // note\n}\n", "package main\n\nfunc main() {\n\ta := 1\n\tprintln(a)\n}\n"),        ];
        for (language, source, expected) in removed {
            assert_eq!(fixed(language, source, &new), expected, "{language} {source:?}");
        }
        let kept = [
            (SupportLang::JavaScript, "function f() { return /* note\r*/ 7 }\n"),
            (SupportLang::TypeScript, "console.log(1+/* note */+n)\n"),
            (SupportLang::Tsx, "h(<div>\n  {/* note */}\n  <i />\n</div>)\n"),
            (SupportLang::Rust, "/// note\nfn f() {}\n"),
            (SupportLang::Rust, "//! note\nfn f() {}\n"),
            (SupportLang::Go, "package main\n\n// note\nfunc main() {}\n"),
            (SupportLang::Go, "package main\n\nimport (\n\t// int note = 42;\n\t\"C\"\n)\n"),
            (SupportLang::Go, "package demo // note \"example.com/demo\"\n\nvar n = 1\n"),
            (SupportLang::Go, "package main\n\nfunc main() {\n\t_ = f()        //nolint:errcheck\n\tdefer g() // note\n}\n"),
            (SupportLang::Go, "package main\n\ntype T struct {\n\tA int\n\t// note\n\tLong string\n}\n"),
            (SupportLang::JavaScript, "f(); // TODO: note\n"),
            (SupportLang::JavaScript, "f(); // NOSONAR note\n"),
            (SupportLang::JavaScript, "f(); // $FlowFixMe note\n"),
            (SupportLang::JavaScript, "f(); // see @note\n"),
            (SupportLang::JavaScript, "f(); //note\n"),
            (SupportLang::JavaScript, "f(); // codeql[js/xss] note\n"),
            (SupportLang::JavaScript, "f(); // deepcode ignore XSS: note\n"),
            (SupportLang::Python, "x = 1  # pragma no cover note\n"),
            (SupportLang::Python, "x = 1  # %% note\n"),
        ];
        for (language, source) in kept {
            assert_eq!(fixed(language, source, &new), source, "{language} {source:?}");
        }
        let source = "export const a = 2; // note the ledger\n";
        assert_eq!(fixed(SupportLang::TypeScript, source, &Prior { file: Some("export const a = 1; // note the ledger\n"), removed: "" }), source, "a comment already in the file is kept");
        assert_eq!(fixed(SupportLang::TypeScript, source, &Prior { file: None, removed: "  // note the ledger\n" }), source, "a comment moved from another file is kept");
        let before = "export const a = 1;\n// note per line\nexport const b = 1;\n\nexport const c = 1;\n";
        let after = "export const a = 1;\n// note per invoice\nexport const b = 2;\n\nexport const c = 2; // note from the agent\n";
        let expected = "export const a = 1;\n// note per invoice\nexport const b = 2;\n\nexport const c = 2;\n";
        assert_eq!(fixed(SupportLang::TypeScript, after, &Prior { file: Some(before), removed: "" }), expected, "a hunk that edits a comment keeps every comment in it");
        assert!(generated_or_vendored(Path::new("gen/a.go"), "// Code generated by protoc. DO NOT EDIT.\npackage gen\n"));
        assert!(generated_or_vendored(Path::new("third_party/semver/a.js"), "f();\n"));
        assert!(!generated_or_vendored(Path::new("src/vendors.ts"), "f();\n"));
    }
}
