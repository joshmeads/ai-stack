use std::path::{Path, PathBuf};

use crate::exec::{Lexeme, Word, lex};
use crate::paths;

const COMMITTING: [&str; 5] = ["commit", "describe", "new", "squash", "split"];
const TAKES_VALUE: [&str; 36] = [
    "-R", "--repository", "--config", "--config-file", "--at-op", "--at-operation", "--color", "-m", "--message", "--remote", "-b", "--bookmark", "-t", "--tag", "-r", "--revision", "--revisions", "-c", "--change", "--named",
    "-o", "--option", "--onto", "-f", "--from", "--into", "--to", "-d", "--destination", "-A", "--insert-after", "--after", "-B", "--insert-before", "--before", "--tool",
];
const SQUASH_INTO: [&str; 3] = ["-t", "--into", "--to"];
const SQUASH_NEW_COMMIT: [&str; 10] = ["-o", "--onto", "-d", "--destination", "-A", "--insert-after", "--after", "-B", "--insert-before", "--before"];
const PATTERN_KINDS: [&str; 8] = ["exact", "glob", "regex", "substring", "exact-i", "glob-i", "regex-i", "substring-i"];
const PUSHABLE: &str = "(bookmarks() | tags())";

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Commit { owns: String },
    Push { targets: Option<String>, dry_run: bool },
}

#[derive(Debug, PartialEq, Eq)]
pub struct Call {
    pub dir: PathBuf,
    pub skip: Option<String>,
    pub action: Action,
}

pub fn jj_calls(command: &str, cwd: &Path) -> Vec<Call> {
    if !command.contains("jj") {
        return Vec::new();
    }
    let Some(lexemes) = lex(command) else { return Vec::new() };
    lexemes.split(|lexeme| *lexeme == Lexeme::Separator).filter_map(|segment| call(segment, cwd)).collect()
}

fn call(segment: &[Lexeme], cwd: &Path) -> Option<Call> {
    let mut words: Vec<&Word> = Vec::new();
    let mut redirected = false;
    for lexeme in segment {
        match lexeme {
            Lexeme::Redirect => redirected = true,
            Lexeme::Word(_) if redirected => redirected = false,
            Lexeme::Word(word) => words.push(word),
            Lexeme::Separator => {}
        }
    }
    let at = words.iter().position(|word| word.assignment().is_none())?;
    let program = words[at];
    if program.quoted_from.is_some() || Path::new(&program.text).file_name().is_none_or(|name| name != "jj") {
        return None;
    }
    let skip = words[..at].iter().filter_map(|word| word.assignment()).find(|(name, _)| *name == "AI_STACK_LINT_SKIP").map(|(_, value)| value.trim().to_string());
    let args: Vec<&str> = words[at + 1..].iter().map(|word| word.text.as_str()).collect();
    let dir = values(&args, &["-R", "--repository"]).last().map_or_else(|| cwd.to_path_buf(), |repository| paths::normalize(&cwd.join(repository)));
    let action = match positionals(&args)[..] {
        [name, ..] if COMMITTING.contains(&name) => Action::Commit { owns: owned_by(name, &args) },
        ["git", "push", ..] => Action::Push { targets: push_targets(&args), dry_run: flag(&args, &["--dry-run", "-n"]) },
        _ => return None,
    };
    Some(Call { dir, skip, action })
}

fn positionals<'a>(args: &[&'a str]) -> Vec<&'a str> {
    let mut found = Vec::new();
    let mut rest = args.iter();
    while let Some(&arg) = rest.next() {
        if TAKES_VALUE.contains(&arg) {
            rest.next();
        } else if !arg.starts_with('-') {
            found.push(arg);
        }
    }
    found
}

fn values<'a>(args: &[&'a str], names: &[&str]) -> Vec<&'a str> {
    let mut found = Vec::new();
    let mut at = 0;
    while at < args.len() {
        let arg = args[at];
        if names.contains(&arg) {
            found.extend(args.get(at + 1));
            at += 2;
            continue;
        }
        if TAKES_VALUE.contains(&arg) {
            at += 2;
            continue;
        }
        for name in names {
            let attached = match name.strip_prefix("--") {
                Some(_) => arg.strip_prefix(name).and_then(|rest| rest.strip_prefix('=')),
                None => arg.strip_prefix(name).filter(|rest| !rest.is_empty() && !arg.starts_with("--")),
            };
            found.extend(attached);
        }
        at += 1;
    }
    found
}

fn flag(args: &[&str], names: &[&str]) -> bool {
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        if names.contains(arg) {
            return true;
        }
        if TAKES_VALUE.contains(arg) {
            rest.next();
        }
    }
    false
}

fn owned_by(subcommand: &str, args: &[&str]) -> String {
    if subcommand != "squash" {
        return "@".into();
    }
    let destination = match values(args, &SQUASH_INTO).last() {
        Some(into) => Some(format!("({into})")),
        None if !values(args, &SQUASH_NEW_COMMIT).is_empty() => None,
        None if !values(args, &["-f", "--from"]).is_empty() => Some("@".into()),
        None => Some(values(args, &["-r", "--revision"]).last().map_or_else(|| "@-".into(), |source| format!("({source})-"))),
    };
    destination.map_or_else(|| "@".into(), |destination| format!("@ | {destination}"))
}

fn push_targets(args: &[&str]) -> Option<String> {
    let mut targets: Vec<String> = Vec::new();
    targets.extend(values(args, &["-b", "--bookmark"]).into_iter().map(|bookmark| format!("bookmarks({})", pattern(bookmark))));
    targets.extend(values(args, &["-t", "--tag"]).into_iter().map(|tag| format!("tags({})", pattern(tag))));
    targets.extend(values(args, &["-r", "--revision", "--revisions"]).into_iter().map(|revision| format!("(({revision}) & {PUSHABLE})")));
    targets.extend(values(args, &["-c", "--change"]).into_iter().map(|change| format!("({change})")));
    targets.extend(values(args, &["--named"]).into_iter().filter_map(|named| named.split_once('=')).map(|(_, revision)| format!("({revision})")));
    if flag(args, &["--all", "--tracked"]) {
        targets.push(PUSHABLE.into());
    }
    if targets.is_empty() && !flag(args, &["--deleted"]) {
        targets.push(format!("({PUSHABLE} & (remote_bookmarks()..@))"));
    }
    (!targets.is_empty()).then(|| targets.join(" | "))
}

fn pattern(value: &str) -> String {
    let (kind, text) = match value.split_once(':') {
        Some((kind, text)) if PATTERN_KINDS.contains(&kind) => (kind, text),
        _ => ("glob", value),
    };
    format!("{kind}:\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actions(command: &str) -> Vec<(PathBuf, Option<String>, Action)> {
        jj_calls(command, Path::new("/w/repo")).into_iter().map(|call| (call.dir, call.skip, call.action)).collect()
    }

    fn owns(revset: &str) -> Action {
        Action::Commit { owns: revset.into() }
    }

    #[test]
    fn jj_commands_are_read_from_unquoted_segments_with_their_workspace_targets_and_skip_assignment() {
        let here = PathBuf::from("/w/repo");
        for command in ["jj commit -m x", "cd sub && jj --no-pager commit -m 'jj git push'", "/usr/bin/jj new", "jj split -r @-", "jj describe -m \"$(cat msg)\" 2>&1"] {
            assert_eq!(actions(command).len(), 1, "{command}");
        }
        for command in ["rg 'Use jj git push to publish' README.md", "echo jj git push", "git commit -m jj", "jj st", "jj log -r 'description(new)'", "'jj' commit", "jj git fetch", "jj push"] {
            assert_eq!(actions(command), [], "{command}");
        }
        assert_eq!(actions("jj -R ../other commit -m work; jj --repository=/x new"), [(PathBuf::from("/w/other"), None, owns("@")), (PathBuf::from("/x"), None, owns("@"))]);
        assert_eq!(actions("jj squash")[0].2, owns("@ | @-"));
        assert_eq!(actions("jj squash --into @--")[0].2, owns("@ | (@--)"));
        assert_eq!(actions("jj squash -r x")[0].2, owns("@ | (x)-"));
        assert_eq!(actions("jj squash -A x")[0].2, owns("@"));

        let push = |targets: &str| Action::Push { targets: Some(targets.into()), dry_run: false };
        assert_eq!(actions("AI_STACK_LINT_SKIP=\"the device has no event\" jj git push -b main --bookmark 'glob:feat-*'"), [(here.clone(), Some("the device has no event".into()), push("bookmarks(glob:\"main\") | bookmarks(glob:\"feat-*\")"))]);
        assert_eq!(actions("jj git push -c @- --named next=@")[0].2, push("(@-) | (@)"));
        assert_eq!(actions("jj git push -r @-")[0].2, push("((@-) & (bookmarks() | tags()))"));
        assert_eq!(actions("jj git push")[0].2, push("((bookmarks() | tags()) & (remote_bookmarks()..@))"));
        assert_eq!(actions("jj git push --deleted")[0].2, Action::Push { targets: None, dry_run: false });
        assert!(matches!(actions("jj git push --dry-run -b main")[0].2, Action::Push { dry_run: true, .. }));
        assert_eq!(actions("echo AI_STACK_LINT_SKIP=x; jj git push")[0].1, None, "a skip counts only as an assignment on the jj command");
        assert_eq!(actions("AI_STACK_LINT_SKIP= jj git push")[0].1.as_deref(), Some(""));
    }
}
