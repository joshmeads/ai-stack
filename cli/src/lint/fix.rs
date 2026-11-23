use std::ops::Range;

use ast_grep_core::tree_sitter::{LanguageExt as _, StrDoc};
use ast_grep_core::{AstGrep, Node};
use ast_grep_language::SupportLang;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    ChangesCode,
    NotAComment,
}

impl Refusal {
    pub fn reason(self) -> &'static str {
        match self {
            Refusal::ChangesCode => "removing it would change the code",
            Refusal::NotAComment => "the finding is not a whole comment",
        }
    }
}

type Tree = AstGrep<StrDoc<SupportLang>>;
type TreeNode<'t> = Node<'t, StrDoc<SupportLang>>;

pub fn delete_comments(language: SupportLang, source: &str, comments: &[Range<usize>]) -> Result<String, Refusal> {
    let tree = language.ast_grep(source);
    let mut edits: Vec<Edit> = Vec::new();
    for range in comments {
        let node = tree.root().dfs().find(|node| node.range() == *range && is_comment(node)).ok_or(Refusal::NotAComment)?;
        let edit = match node.parent().filter(|parent| parent.kind() == "jsx_expression" && holds_only_comments(parent)) {
            Some(container) if alone_on_its_lines(source, container.range()) => Edit { range: container.range(), text: "" },
            _ => edit_for(source, without_line_end(source, node.range())),
        };
        if !edits.iter().any(|known| known.range.start < edit.range.end && edit.range.start < known.range.end) {
            edits.push(edit);
        }
    }
    edits.sort_by_key(|edit| edit.range.start);
    let fixed = apply(source, &edits);
    if verified(&tree, &language.ast_grep(&fixed)) { Ok(fixed) } else { Err(Refusal::ChangesCode) }
}

fn without_line_end(source: &str, range: Range<usize>) -> Range<usize> {
    let text = &source[range.clone()];
    let trimmed = text.strip_suffix('\n').map_or(text, |text| text.strip_suffix('\r').unwrap_or(text));
    range.start..range.start + trimmed.len()
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

fn edit_for(source: &str, range: Range<usize>) -> Edit {
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
    let before_blank = blank(&source[line_start(source, range.start)..range.start]);
    if source[range.clone()].contains('\n') {
        let start = if before_blank { range.start } else { back_over_space(range.start) };
        return Edit { range: start..range.end, text: "\n" };
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

fn verified(before: &Tree, after: &Tree) -> bool {
    if errors(&after.root()) > errors(&before.root()) {
        return false;
    }
    let (mut old, mut new) = (Vec::new(), Vec::new());
    tokens(&before.root(), &mut old);
    tokens(&after.root(), &mut new);
    let same_tokens = old.len() == new.len() && old.iter().zip(&new).all(|(a, b)| a.kind == b.kind && a.text == b.text);
    let breaks = |tree: &Tree, tokens: &[Token]| -> Vec<bool> {
        let source = tree.root().text();
        tokens.windows(2).map(|pair| source[pair[0].range.end..pair[1].range.start].contains('\n')).collect()
    };
    same_tokens && breaks(before, &old) == breaks(after, &new)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed(language: SupportLang, source: &str) -> Result<String, Refusal> {
        let tree = language.ast_grep(source);
        let comments: Vec<Range<usize>> = tree.root().dfs().filter(|node| is_comment(node) && node.text().contains("note")).map(|node| node.range()).collect();
        delete_comments(language, source, &comments)
    }

    #[test]
    fn deleting_a_comment_keeps_every_token_and_line_break_or_refuses() {
        let cases = [
            (SupportLang::JavaScript, "function f() { return /* note\n*/ 1 }\n", "function f() { return\n 1 }\n"),
            (SupportLang::TypeScript, "console.log(1+/* note */+n)\n", "console.log(1+ +n)\n"),
            (SupportLang::Tsx, "h(<span>a{/* note */}b</span>)\n", "h(<span>a{ }b</span>)\n"),
            (SupportLang::Tsx, "h(<div>\n  {/* note */}\n  <i />\n</div>)\n", "h(<div>\n  <i />\n</div>)\n"),
            (SupportLang::Rust, "fn main() { let/* note */n = 1; }\n", "fn main() { let n = 1; }\n"),
            (SupportLang::Rust, "fn f() {\n    let a = 1; // note\n\n    // note\n    a\n}\n", "fn f() {\n    let a = 1;\n\n    a\n}\n"),
            (SupportLang::Python, "x = 1 \\\n# note\nprint(x)\n", "x = 1 \\\n\nprint(x)\n"),
            (SupportLang::Python, "def f():\n    # note\n    return 1  # note\n", "def f():\n    return 1\n"),
            (SupportLang::Go, "package main\nfunc main() { var/* note */n int; println(n) }\n", "package main\nfunc main() { var n int; println(n) }\n"),
            (SupportLang::Go, "package main\n\n/* note\n   more note */\nfunc main() {}\n", "package main\n\nfunc main() {}\n"),
        ];
        for (language, source, expected) in cases {
            assert_eq!(fixed(language, source).as_deref(), Ok(expected), "{language} {source:?}");
        }
        assert_eq!(fixed(SupportLang::Tsx, "h(<div>\n  a\n  {/* note */}\n  b\n</div>)\n"), Err(Refusal::ChangesCode), "joining two JSX text children changes what renders");
    }
}
