use std::collections::{BTreeSet, HashSet};
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
const SHEBANGS: [&str; 2] = ["hash_bang_line", "shebang"];
const UNTOUCHED_DIRECTORIES: [&str; 7] = ["vendor", "third_party", "node_modules", "testdata", "fixtures", "__fixtures__", "__testfixtures__"];

pub struct Prior<'a> {
    pub file: Option<&'a str>,
    pub removed: &'a str,
    pub written: &'a HashSet<String>,
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

pub fn untouchable(rel: &Path, source: &str) -> bool {
    static MARKER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"Code generated|DO NOT EDIT|@generated").unwrap());
    let set_apart = rel.components().any(|part| part.as_os_str().to_str().is_some_and(|part| UNTOUCHED_DIRECTORIES.contains(&part)));
    let notebook = rel.extension().is_some_and(|ext| ext == "py") && source.lines().any(|line| line.starts_with("# %%"));
    set_apart || notebook || source.lines().take(5).any(|line| MARKER.is_match(line))
}

pub fn remove_new_plain_comments(language: SupportLang, source: &str, comments: &[Range<usize>], prior: &Prior) -> Option<Fixed> {
    std::panic::catch_unwind(AssertUnwindSafe(|| fix(language, source, comments, prior))).ok().flatten()
}

fn fix(language: SupportLang, source: &str, comments: &[Range<usize>], prior: &Prior) -> Option<Fixed> {
    let tree = language.ast_grep(source);
    let file = File::new(language, source, &tree, prior.file);
    let reported: HashSet<&Range<usize>> = comments.iter().collect();
    let mut removed = Vec::new();
    let mut gone = BTreeSet::new();
    for block in file.blocks(&tree) {
        if block.iter().all(|node| reported.contains(&node.range()) && file.deletable(node, prior)) && file.fits(&block) {
            for node in &block {
                gone.extend(file.index.span(without_line_end(source, node.range())).map(|line| line as usize - 1));
                removed.push(node.range());
            }
        }
    }
    if removed.is_empty() {
        return None;
    }
    let text = apply(source, &gone);
    verified(source, &tree, &text, &language.ast_grep(&text)).then_some(Fixed { text, removed })
}

struct File<'s> {
    language: SupportLang,
    source: &'s str,
    index: LineIndex,
    edited: Vec<Range<usize>>,
    trailing: HashSet<u32>,
    code_start: usize,
}

impl<'s> File<'s> {
    fn new(language: SupportLang, source: &'s str, tree: &Tree, before: Option<&str>) -> File<'s> {
        let index = LineIndex::new(source);
        let trailing = tree.root().dfs().filter(is_comment).filter(|node| !alone(source, node.range())).map(|node| index.line(node.range().start)).collect();
        File { language, source, edited: edited_commentary(language, before, source), index, trailing, code_start: code_start(tree, source.len()) }
    }

    fn blocks<'t>(&self, tree: &'t Tree) -> Vec<Vec<TreeNode<'t>>> {
        let mut blocks: Vec<Vec<TreeNode<'t>>> = Vec::new();
        let mut last_line = 0;
        for node in tree.root().dfs().filter(|node| is_comment(node) && alone(self.source, node.range())) {
            let span = self.index.span(without_line_end(self.source, node.range()));
            match blocks.last_mut() {
                Some(block) if *span.start() == last_line + 1 => block.push(node),
                _ => blocks.push(vec![node]),
            }
            last_line = *span.end();
        }
        blocks
    }

    fn deletable(&self, node: &TreeNode, prior: &Prior) -> bool {
        let range = without_line_end(self.source, node.range());
        let body = &self.source[range.clone()];
        let line = self.index.line(range.start);
        (body.starts_with("//") || body.starts_with('#'))
            && !body.contains(LINE_TERMINATORS)
            && prior.written.contains(body.trim())
            && !prior.holds(body)
            && range.start >= self.code_start
            && !(self.language == SupportLang::Python && line <= 2)
            && !body.contains("want \"")
            && !self.edited.iter().any(|hunk| hunk.contains(&(line as usize - 1)))
            && !self.is_doc(node, body)
            && !looks_like_a_directive(body)
    }

    fn fits(&self, block: &[TreeNode]) -> bool {
        let (Some(first), Some(last)) = (block.first(), block.last()) else { return false };
        let above = self.index.line(first.range().start) - 1;
        let below = *self.index.span(without_line_end(self.source, last.range())).end() + 1;
        let containers = statement_containers(self.language);
        let continued = above >= 1 && self.source[self.index.start(above)..self.index.start(above + 1) - 1].trim_end_matches('\r').ends_with('\\');
        block.iter().all(|node| node.parent().is_some_and(|parent| containers.contains(&parent.kind().as_ref())))
            && !continued
            && !(self.language == SupportLang::Go && self.trailing.contains(&above) && self.trailing.contains(&below))
    }

    fn is_doc(&self, node: &TreeNode, body: &str) -> bool {
        match self.language {
            SupportLang::Rust => (body.starts_with("///") && !body.starts_with("////")) || body.starts_with("//!"),
            SupportLang::Go => directly_above_a_declaration(node, self.source),
            _ => false,
        }
    }
}

fn statement_containers(language: SupportLang) -> &'static [&'static str] {
    match language {
        SupportLang::Rust => &["source_file", "block", "declaration_list"],
        SupportLang::Python => &["module", "block"],
        SupportLang::Go => &["source_file", "block", "statement_list", "expression_case", "default_case", "type_case", "communication_case"],
        _ => &["program", "statement_block", "class_body", "switch_case", "switch_default"],
    }
}

fn code_start(tree: &Tree, end: usize) -> usize {
    tree.root()
        .dfs()
        .find(|node| node.children().len() == 0 && !node.range().is_empty() && !is_comment(node) && !SHEBANGS.contains(&node.kind().as_ref()) && !node.ancestors().any(|ancestor| is_comment(&ancestor)))
        .map_or(end, |node| node.range().start)
}

fn alone(source: &str, range: Range<usize>) -> bool {
    let range = without_line_end(source, range);
    let line_end = source[range.end..].find('\n').map_or(source.len(), |at| range.end + at);
    blank(&source[line_start(source, range.start)..range.start]) && blank(&source[range.end..line_end])
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

fn apply(source: &str, gone: &BTreeSet<usize>) -> String {
    let lines: Vec<&str> = source.split_inclusive('\n').collect();
    let content = |at: usize| lines[at].trim_end_matches(['\n', '\r']);
    let empty = |at: usize| !gone.contains(&at) && content(at).trim().is_empty();
    let opens = |at: usize| content(at).trim_end().ends_with(['{', '(', '[', ':']);
    let closes = |at: usize| content(at).trim_start().starts_with(['}', ')', ']']);
    let mut out = String::with_capacity(source.len());
    let mut at = 0;
    while at < lines.len() {
        if !gone.contains(&at) && !empty(at) {
            out.push_str(lines[at]);
            at += 1;
            continue;
        }
        let start = at;
        while at < lines.len() && (gone.contains(&at) || empty(at)) {
            at += 1;
        }
        let run: Vec<usize> = (start..at).collect();
        let keep = if !run.iter().any(|line| gone.contains(line)) {
            run.len()
        } else if start == 0 || at == lines.len() || opens(start - 1) || closes(at) {
            0
        } else {
            run.split(|line| gone.contains(line)).map(<[usize]>::len).max().unwrap_or(0)
        };
        for &line in run.iter().filter(|line| !gone.contains(line)).take(keep) {
            out.push_str(lines[line]);
        }
    }
    out
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

    fn fixed_with(language: SupportLang, source: &str, file: Option<&str>, removed: &str) -> String {
        let tree = language.ast_grep(source);
        let notes: Vec<TreeNode> = tree.root().dfs().filter(|node| is_comment(node) && node.text().contains("note")).collect();
        let written: HashSet<String> = notes.iter().map(|node| node.text().trim().to_string()).collect();
        let comments: Vec<Range<usize>> = notes.iter().map(|node| node.range()).collect();
        remove_new_plain_comments(language, source, &comments, &Prior { file, removed, written: &written }).map_or_else(|| source.to_string(), |fixed| fixed.text)
    }

    fn fixed(language: SupportLang, source: &str) -> String {
        fixed_with(language, source, None, "")
    }

    #[test]
    fn only_whole_line_blocks_the_agent_wrote_in_statement_lists_are_deleted_and_blank_runs_never_grow() {
        let removed = [
            (SupportLang::JavaScript, "f();\n// note\ng();\n", "f();\ng();\n"),
            (SupportLang::JavaScript, "\n\nconst a = 'é';\n  // note\nf();\n", "\n\nconst a = 'é';\nf();\n"),
            (SupportLang::TypeScript, "f();\n\n// note one\n// note two\n\ng();\n", "f();\n\ng();\n"),
            (SupportLang::Rust, "fn f() {\r\n    let a = 1;\r\n    // note\r\n    a\r\n}\r\n", "fn f() {\r\n    let a = 1;\r\n    a\r\n}\r\n"),
            (SupportLang::Rust, "fn f() {\n    // note\n\n    g();\n}\n", "fn f() {\n    g();\n}\n"),
            (SupportLang::Python, "def load():\n    return 1\n\n\n# note section\n\n\ndef parse(text):\n    return text\n", "def load():\n    return 1\n\n\ndef parse(text):\n    return text\n"),
            (SupportLang::Python, "x = 1\n\n# note\n", "x = 1\n"),
            (SupportLang::Go, "package main\n\nfunc main() {\n\t// note\n\tprintln(1)\n}\n", "package main\n\nfunc main() {\n\tprintln(1)\n}\n"),
        ];
        for (language, source, expected) in removed {
            assert_eq!(fixed(language, source), expected, "{language} {source:?}");
        }
        let kept = [
            (SupportLang::JavaScript, "f(); // note\n"),
            (SupportLang::JavaScript, "f();\n/* note */\ng();\n"),
            (SupportLang::JavaScript, "// note on the module\nf();\n"),
            (SupportLang::JavaScript, "#!/usr/bin/env node\n// note license\n// note terms\n\nf();\n"),
            (SupportLang::JavaScript, "const a = [\n  1,\n  // note\n  2,\n];\n"),
            (SupportLang::JavaScript, "f();\n// TODO: note\n"),
            (SupportLang::JavaScript, "f();\n// note\n// eslint-disable-next-line\ng();\n"),
            (SupportLang::Python, "import os\n# note\n"),
            (SupportLang::Python, "x = 1\ny = 2\n# Translators: note\n# note continues\nlabel = 1\n"),
            (SupportLang::Python, "y = 0\nx = 1 \\\n# note\nprint(x)\n"),
            (SupportLang::Rust, "fn g() {}\n/// note\nfn f() {}\n"),
            (SupportLang::Go, "package main\n\nfunc g() {}\n\n// note\nfunc main() {}\n"),
            (SupportLang::Go, "package main\n\ntype T struct {\n\tA int\n\t// note\n\tLong string\n}\n"),
            (SupportLang::Go, "package main\n\nfunc main() {\n\ta := 1 // x\n\t// note\n\tbb := 2 // y\n\t_ = a + bb\n}\n"),
            (SupportLang::Go, "package a\n\nfunc f() {\n\tg()\n\t// note want \"avoid\"\n}\n"),
        ];
        for (language, source) in kept {
            assert_eq!(fixed(language, source), source, "{language} {source:?}");
        }
        let unwritten = "f();\n// prose a human wrote\ng();\n";
        let tree = SupportLang::JavaScript.ast_grep(unwritten);
        let comments: Vec<Range<usize>> = tree.root().dfs().filter(is_comment).map(|node| node.range()).collect();
        assert!(remove_new_plain_comments(SupportLang::JavaScript, unwritten, &comments, &Prior { file: None, removed: "", written: &HashSet::new() }).is_none(), "a comment the agent's edits never wrote is kept");
        let source = "f();\n// note the ledger\n";
        assert_eq!(fixed_with(SupportLang::TypeScript, source, Some("// note the ledger\nf();\n"), ""), source, "a comment already in the file is kept");
        assert_eq!(fixed_with(SupportLang::TypeScript, source, None, "  // note the ledger\n"), source, "a comment moved from another file is kept");
        let before = "export const a = 1;\n// note per line\nexport const b = 1;\n\nexport const c = 1;\n";
        let after = "export const a = 1;\n// note per invoice\nexport const b = 2;\n\nexport const c = 2;\n// note from the agent\nexport const d = 2;\n";
        let expected = "export const a = 1;\n// note per invoice\nexport const b = 2;\n\nexport const c = 2;\nexport const d = 2;\n";
        assert_eq!(fixed_with(SupportLang::TypeScript, after, Some(before), ""), expected, "a hunk that edits a comment keeps every comment in it");
        assert!(untouchable(Path::new("gen/a.go"), "// Code generated by protoc. DO NOT EDIT.\npackage gen\n"));
        assert!(untouchable(Path::new("third_party/semver/a.js"), "f();\n"));
        assert!(untouchable(Path::new("pkg/testdata/src/a/a.go"), "package a\n"));
        assert!(untouchable(Path::new("analysis.py"), "x = 1\n# %% [markdown]\n# Sales\n"));
        assert!(!untouchable(Path::new("src/vendors.ts"), "f();\n"));
    }
}
