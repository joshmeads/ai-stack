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
const OUR_OUTPUT_FLAGS: [&str; 4] = ["--quiet", "--no-pager", "--dry-run", "-n"];

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Commit { owns: String },
    Push { args: Vec<String>, dry_run: bool, chained: bool },
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
    let mut calls = Vec::new();
    let mut earlier = false;
    for segment in lexemes.split(|lexeme| *lexeme == Lexeme::Separator) {
        calls.extend(call(segment, cwd, earlier));
        earlier |= segment.iter().any(|lexeme| matches!(lexeme, Lexeme::Word(_)));
    }
    calls
}

fn call(segment: &[Lexeme], cwd: &Path, chained: bool) -> Option<Call> {
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
    if flag(&args, &["-h", "--help"]) {
        return None;
    }
    let dir = values(&args, &["-R", "--repository"]).last().map_or_else(|| cwd.to_path_buf(), |repository| paths::normalize(&cwd.join(repository)));
    let action = match positionals(&args)[..] {
        [name, ..] if COMMITTING.contains(&name) => Action::Commit { owns: owned_by(name, &args) },
        ["git", "push", ..] => Action::Push { args: push_args(&args), dry_run: flag(&args, &["--dry-run", "-n"]), chained },
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

fn push_args(args: &[&str]) -> Vec<String> {
    let mut kept = Vec::new();
    let mut rest = args.iter();
    while let Some(&arg) = rest.next() {
        if ["-R", "--repository", "--color"].contains(&arg) {
            rest.next();
        } else if !(OUR_OUTPUT_FLAGS.contains(&arg) || arg.starts_with("--repository=") || arg.starts_with("--color=") || (arg.starts_with("-R") && !arg.starts_with("--"))) {
            kept.push(arg.to_string());
        }
    }
    kept
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
    fn jj_commands_are_read_from_unquoted_segments_with_their_workspace_push_arguments_and_skip_assignment() {
        let here = PathBuf::from("/w/repo");
        for command in ["jj commit -m x", "cd sub && jj --no-pager commit -m 'jj git push'", "/usr/bin/jj new", "jj split -r @-", "jj describe -m \"$(cat msg)\" 2>&1"] {
            assert_eq!(actions(command).len(), 1, "{command}");
        }
        for command in ["rg 'Use jj git push to publish' README.md", "echo jj git push", "git commit -m jj", "jj st", "jj log -r 'description(new)'", "'jj' commit", "jj git fetch", "jj push", "jj commit --help", "jj git push -h", "jj help commit", "cat > notes.md <<'EOF'\njj git push --bookmark feat\njj new\nEOF"] {
            assert_eq!(actions(command), [], "{command}");
        }
        assert_eq!(actions("jj -R ../other commit -m work; jj --repository=/x new"), [(PathBuf::from("/w/other"), None, owns("@")), (PathBuf::from("/x"), None, owns("@"))]);
        assert_eq!(actions("jj squash")[0].2, owns("@ | @-"));
        assert_eq!(actions("jj squash --into @--")[0].2, owns("@ | (@--)"));
        assert_eq!(actions("jj squash -r x")[0].2, owns("@ | (x)-"));
        assert_eq!(actions("jj squash -A x")[0].2, owns("@"));

        let push = |args: &[&str], chained: bool| Action::Push { args: args.iter().map(|arg| arg.to_string()).collect(), dry_run: false, chained };
        assert_eq!(actions("AI_STACK_LINT_SKIP=\"the device has no event\" jj git push -b main --bookmark 'glob:feat-*'"), [(here.clone(), Some("the device has no event".into()), push(&["git", "push", "-b", "main", "--bookmark", "glob:feat-*"], false))]);
        assert_eq!(actions("jj --quiet -R ../other --color=always git push --tracked")[0].2, push(&["git", "push", "--tracked"], false), "the dry run gets the push arguments without our output flags");
        assert_eq!(actions("jj commit -m x && jj git push -c @-")[1].2, push(&["git", "push", "-c", "@-"], true));
        assert_eq!(actions("# publish\n\njj git push")[0].2, push(&["git", "push"], false), "a comment is not a command");
        assert!(matches!(actions("jj git push --dry-run -b main")[0].2, Action::Push { dry_run: true, .. }));
        assert_eq!(actions("echo AI_STACK_LINT_SKIP=x; jj git push")[0].1, None, "a skip counts only as an assignment on the jj command");
        assert_eq!(actions("AI_STACK_LINT_SKIP= jj git push")[0].1.as_deref(), Some(""));
    }
}
