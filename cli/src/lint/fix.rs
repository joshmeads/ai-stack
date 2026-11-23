use std::ops::Range;
use std::path::Path;
use std::sync::LazyLock;

use ast_grep_core::tree_sitter::{LanguageExt as _, StrDoc};
use ast_grep_core::{AstGrep, Node};
use ast_grep_language::SupportLang;
use regex::Regex;

type Tree = AstGrep<StrDoc<SupportLang>>;
type TreeNode<'t> = Node<'t, StrDoc<SupportLang>>;

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
    pub removed: usize,
}

pub fn generated_or_vendored(rel: &Path, source: &str) -> bool {
    static MARKER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Code generated|DO NOT EDIT|@generated").unwrap());
    let vendored = rel.components().any(|part| matches!(part.as_os_str().to_str(), Some("vendor" | "third_party" | "node_modules")));
    vendored || source.lines().take(5).any(|line| MARKER.is_match(line))
}

pub fn remove_new_plain_comments(language: SupportLang, source: &str, comments: &[Range<usize>], prior: &Prior) -> Option<Fixed> {
    let tree = language.ast_grep(source);
    let breaks = LineBreaks::of(language);
    let mut edits: Vec<Edit> = Vec::new();
    for range in comments {
        let Some(node) = tree.root().dfs().find(|node| node.range() == *range && is_comment(node)) else { continue };
        if prior.holds(&node.text()) || is_doc(language, &node, source) || looks_like_a_directive(&node.text()) {
            continue;
        }
        let edit = match node.parent().filter(|parent| parent.kind() == "jsx_expression" && parent.named_children().count() == 1) {
            Some(container) if alone_on_its_lines(source, container.range()) => Edit { range: container.range(), text: "" },
            _ => edit_for(source, without_line_end(source, node.range()), breaks),
        };
        if !edits.iter().any(|known| known.range.start < edit.range.end && edit.range.start < known.range.end) {
            edits.push(edit);
        }
    }
    if edits.is_empty() {
        return None;
    }
    edits.sort_by_key(|edit| edit.range.start);
    let text = apply(source, &edits);
    verified(&tree, &language.ast_grep(&text), breaks).then_some(Fixed { text, removed: edits.len() })
}

#[derive(Clone, Copy)]
struct LineBreaks {
    unicode: bool,
}

impl LineBreaks {
    fn of(language: SupportLang) -> LineBreaks {
        LineBreaks { unicode: matches!(language, SupportLang::JavaScript | SupportLang::TypeScript | SupportLang::Tsx) }
    }

    fn within(self, text: &str) -> bool {
        text.contains('\n') || (self.unicode && text.contains(['\u{2028}', '\u{2029}']))
    }
}

fn is_doc(language: SupportLang, node: &TreeNode, source: &str) -> bool {
    let text = node.text();
    let block_doc = (text.starts_with("/**") && !text.starts_with("/**/")) || text.starts_with("/*!");
    match language {
        SupportLang::Rust => block_doc || (text.starts_with("///") && !text.starts_with("////")) || text.starts_with("//!"),
        SupportLang::Go => directly_above_a_declaration(node, source),
        SupportLang::Python => false,
        _ => block_doc,
    }
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
    static OPENER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?://+!?|/\*+!?|#+)").unwrap());
    static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[@$][A-Za-z]").unwrap());
    let after = &text[OPENER.find(text).map_or(0, |opener| opener.end())..];
    let spaced = text.starts_with("/*") || after.starts_with(char::is_whitespace);
    let body = after.trim_end().strip_suffix("*/").unwrap_or(after).trim();
    let Some(first) = body.split_whitespace().next() else { return true };
    let letters: Vec<char> = first.chars().filter(|char| char.is_alphabetic()).collect();
    let all_caps = letters.len() > 1 && letters.iter().all(|char| char.is_uppercase());
    !spaced || !first.starts_with(char::is_alphabetic) || first.contains(':') || all_caps || TAG.is_match(body)
}

fn without_line_end(source: &str, range: Range<usize>) -> Range<usize> {
    let text = &source[range.clone()];
    let text = text.strip_suffix('\n').unwrap_or(text);
    let text = text.strip_suffix('\r').unwrap_or(text);
    range.start..range.start + text.len()
}

struct Edit {
    range: Range<usize>,
    text: &'static str,
}

fn is_comment(node: &TreeNode) -> bool {
    matches!(node.kind().as_ref(), "comment" | "line_comment" | "block_comment")
}

fn holds_only_comments(node: &TreeNode) -> bool {
    node.children().filter(|child| child.is_named()).all(|child| is_comment(&child))
}

fn line_start(source: &str, at: usize) -> usize {
    source[..at].rfind('\n').map_or(0, |newline| newline + 1)
}

fn line_end(source: &str, at: usize) -> usize {
    source[at..].find('\n').map_or(source.len(), |newline| at + newline)
}

fn blank(text: &str) -> bool {
    text.chars().all(|char| char == ' ' || char == '\t' || char == '\r')
}

fn alone_on_its_lines(source: &str, range: Range<usize>) -> bool {
    blank(&source[line_start(source, range.start)..range.start]) && blank(&source[range.end..line_end(source, range.end)])
}

fn horizontal(byte: u8) -> bool {
    byte == b' ' || byte == b'\t'
}

fn edit_for(source: &str, range: Range<usize>, breaks: LineBreaks) -> Edit {
    let bytes = source.as_bytes();
    let back_over_space = |mut at: usize| {
        while at > 0 && horizontal(bytes[at - 1]) {
            at -= 1;
        }
        at
    };
    let forward_over_space = |mut at: usize| {
        while at < bytes.len() && horizontal(bytes[at]) {
            at += 1;
        }
        at
    };
    let comment = &source[range.clone()];
    let before_blank = blank(&source[line_start(source, range.start)..range.start]);
    if breaks.within(comment) {
        let crlf = comment.contains("\r\n") || (!comment.contains('\n') && source.contains("\r\n"));
        let start = if before_blank { range.start } else { back_over_space(range.start) };
        return Edit { range: start..range.end, text: if crlf { "\r\n" } else { "\n" } };
    }
    let after_blank = blank(&source[range.end..line_end(source, range.end)]);
    match (before_blank, after_blank) {
        (_, true) => Edit { range: back_over_space(range.start)..range.end, text: "" },
        (true, false) => Edit { range: range.start..forward_over_space(range.end), text: "" },
        (false, false) => {
            let end = forward_over_space(range.end);
            let spaced = horizontal(bytes[range.start - 1]);
            Edit { range: range.start..end, text: if spaced { "" } else { " " } }
        }
    }
}

fn apply(source: &str, edits: &[Edit]) -> String {
    let mut out = String::with_capacity(source.len());
    let mut touched: Vec<Range<usize>> = Vec::new();
    let mut copied = 0;
    for edit in edits {
        out.push_str(&source[copied..edit.range.start]);
        let start = out.len();
        out.push_str(edit.text);
        touched.push(start..out.len());
        copied = edit.range.end;
    }
    out.push_str(&source[copied..]);
    let mut kept = String::with_capacity(out.len());
    let mut previous: Option<&str> = None;
    let mut at = 0;
    for line in out.split_inclusive('\n') {
        let span = at..at + line.len();
        at = span.end;
        let content = line.strip_suffix('\n').unwrap_or(line);
        let was_touched = touched.iter().any(|edit| edit.start <= span.end && span.start <= edit.end && !(edit.start == span.end && line.ends_with('\n')));
        let continues = previous.is_some_and(|previous| previous.trim_end_matches(['\n', '\r']).ends_with('\\'));
        if !(was_touched && blank(content) && !continues) {
            kept.push_str(line);
        }
        previous = Some(line);
    }
    kept
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
    let empty_container = node.kind() == "jsx_expression" && holds_only_comments(node);
    if node.children().len() == 0 {
        let text = node.text();
        let layout = node.kind() == "jsx_text" && text.trim().is_empty() && text.contains('\n');
        if !layout {
            out.push(Token { kind: node.kind().into_owned(), text: text.into_owned(), range: node.range() });
        }
        return;
    }
    for child in node.children() {
        if empty_container && !child.is_named() {
            continue;
        }
        tokens(&child, out);
    }
}

fn errors(node: &TreeNode) -> usize {
    node.dfs().filter(|node| node.is_error() || node.is_missing()).count()
}

fn bare_line_feeds(text: &str) -> usize {
    text.match_indices('\n').filter(|(at, _)| !text[..*at].ends_with('\r')).count()
}

fn verified(before: &Tree, after: &Tree, breaks: LineBreaks) -> bool {
    let (old_text, new_text) = (before.root().text(), after.root().text());
    let crlf_lost = old_text.contains("\r\n") && bare_line_feeds(&new_text) > bare_line_feeds(&old_text);
    if errors(&after.root()) > errors(&before.root()) || crlf_lost {
        return false;
    }
    let (mut old, mut new) = (Vec::new(), Vec::new());
    tokens(&before.root(), &mut old);
    tokens(&after.root(), &mut new);
    let same_tokens = old.len() == new.len() && old.iter().zip(&new).all(|(a, b)| a.kind == b.kind && a.text == b.text);
    let gaps = |tree: &Tree, tokens: &[Token]| -> Vec<bool> {
        let source = tree.root().text();
        tokens.windows(2).map(|pair| breaks.within(&source[pair[0].range.end..pair[1].range.start])).collect()
    };
    same_tokens && gaps(before, &old) == gaps(after, &new)
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
    fn only_new_plain_comments_are_deleted_and_every_token_and_line_break_is_kept() {
        let new = Prior { file: None, removed: "" };
        let removed = [
            (SupportLang::JavaScript, "function f() { return /* note\n*/ 1 }\n", "function f() { return\n 1 }\n"),
            (SupportLang::JavaScript, "function f() { return /* note\u{2028}x */ 7 }\n", "function f() { return\n 7 }\n"),
            (SupportLang::TypeScript, "console.log(1+/* note */+n)\n", "console.log(1+ +n)\n"),
            (SupportLang::Tsx, "h(<span>a{/* note */}b</span>)\n", "h(<span>a{ }b</span>)\n"),
            (SupportLang::Tsx, "h(<div>\n  {/* note */}\n  <i />\n</div>)\n", "h(<div>\n  <i />\n</div>)\n"),
            (SupportLang::Tsx, "h(<main>\n  {/* note */ /* SPDX-License-Identifier: MIT */}\n</main>)\n", "h(<main>\n  { /* SPDX-License-Identifier: MIT */}\n</main>)\n"),
            (SupportLang::Rust, "fn main() { let/* note */n = 1; }\n", "fn main() { let n = 1; }\n"),
            (SupportLang::Rust, "fn f() {\n    let a = 1; // note\n\n    // note\n    a\n}\n", "fn f() {\n    let a = 1;\n\n    a\n}\n"),
            (SupportLang::Rust, "fn f() {\r\n    let a = 1; // note\r\n    a\r\n}\r\n", "fn f() {\r\n    let a = 1;\r\n    a\r\n}\r\n"),
            (SupportLang::Python, "x = 1 \\\n# note\nprint(x)\n", "x = 1 \\\n\nprint(x)\n"),
            (SupportLang::Python, "def f():\n    # note\n    return 1  # note\n", "def f():\n    return 1\n"),
            (SupportLang::Python, "x = 2  # note\r\ny = 3\r\n", "x = 2\r\ny = 3\r\n"),
            (SupportLang::Go, "package main\nfunc main() { var/* note */n int; println(n) }\n", "package main\nfunc main() { var n int; println(n) }\n"),
            (SupportLang::Go, "package main\n\n// note\n\nfunc main() {}\n", "package main\n\n\nfunc main() {}\n"),
        ];
        for (language, source, expected) in removed {
            assert_eq!(fixed(language, source, &new), expected, "{language} {source:?}");
        }
        let kept = [
            (SupportLang::Rust, "/// note\nfn f() {}\n"),
            (SupportLang::Rust, "//! note\nfn f() {}\n"),
            (SupportLang::JavaScript, "/** note */\nfunction f() {}\n"),
            (SupportLang::Go, "package main\n\n// note\nfunc main() {}\n"),
            (SupportLang::Go, "package main\n\nimport (\n\t// int note = 42;\n\t\"C\"\n)\n"),
            (SupportLang::JavaScript, "f(); // TODO: note\n"),
            (SupportLang::JavaScript, "f(); // NOSONAR note\n"),
            (SupportLang::JavaScript, "f(); // $FlowFixMe note\n"),
            (SupportLang::JavaScript, "f(); // see @note\n"),
            (SupportLang::JavaScript, "f(); //note\n"),
            (SupportLang::Python, "x = 1  # %% note\n"),
            (SupportLang::Tsx, "h(<div>\n  a\n  {/* note */}\n  b\n</div>)\n"),
        ];
        for (language, source) in kept {
            assert_eq!(fixed(language, source, &new), source, "{language} {source:?}");
        }
        let source = "export const a = 2; // note the ledger\n";
        assert_eq!(fixed(SupportLang::TypeScript, source, &Prior { file: Some("export const a = 1; // note the ledger\n"), removed: "" }), source, "a comment already in the file is kept");
        assert_eq!(fixed(SupportLang::TypeScript, source, &Prior { file: None, removed: "  // note the ledger\n" }), source, "a comment moved from another file is kept");
        assert!(generated_or_vendored(Path::new("gen/a.go"), "// Code generated by protoc. DO NOT EDIT.\npackage gen\n"));
        assert!(generated_or_vendored(Path::new("third_party/semver/a.js"), "f();\n"));
        assert!(!generated_or_vendored(Path::new("src/vendors.ts"), "f();\n"));
    }
}
