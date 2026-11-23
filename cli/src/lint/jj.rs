use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context as _, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use super::command::{Action, Call};
use super::commit::{Checkout, Git, HIGH_RATE, OnDisk, Source, Staged, Target, plural, refusal, skip_recorded, sorted_names};
use super::events::{Event, Kind, Log, now};
use super::fix::{self, Run};
use super::provenance::Provenance;
use super::repo::{Attributes, Repo};
use super::scan::{Engine, language_of};
use super::{Finding, Settings, Severity, files_named};

const TOOL: &str = "ai-stack-lint";
const SHOWN: usize = 5;
const UNPUBLISHED: &str = "mutable() & ~conflicts() & ~::remote_bookmarks()";
const MEMBER: &str = r#"commit_id ++ " " ++ change_id ++ " " ++ parents.map(|parent| parent.commit_id()).join(",") ++ "\n""#;
const CONFLICT_PATHS: [&str; 2] = [".jjconflict-", "JJ-CONFLICT-README"];

type Plan = BTreeMap<String, Vec<Run>>;

pub struct Workspace {
    root: PathBuf,
    key: PathBuf,
}

impl Workspace {
    pub fn find(dir: &Path) -> Option<Workspace> {
        let root = dir.ancestors().find(|ancestor| ancestor.join(".jj").is_dir())?;
        let marker = root.join(".jj/repo");
        let repo = match std::fs::read_to_string(&marker) {
            Ok(pointer) => root.join(".jj").join(pointer.trim()),
            Err(_) => marker,
        };
        let repo = crate::paths::resolve(&repo);
        let key = repo.parent().and_then(Path::parent).map_or_else(|| crate::paths::resolve(root), Path::to_path_buf);
        Some(Workspace { root: crate::paths::resolve(root), key })
    }

    fn repo(&self) -> Repo {
        Repo { root: self.root.clone(), project_key: self.key.clone() }
    }

    fn checked(&self, settings: &Settings) -> bool {
        settings.enabled && settings.policy(Some(&self.repo())).enabled()
    }

    fn jj(&self, args: &[&str]) -> Result<String> {
        let out = Command::new("jj")
            .arg("-R")
            .arg(&self.root)
            .args(["--no-pager", "--color=never", "--quiet"])
            .args(args)
            .stdin(Stdio::null())
            .output()
            .context("cannot run jj")?;
        if !out.status.success() {
            bail!("jj {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn changes(&self, revset: &str) -> Result<Vec<String>> {
        Ok(self.jj(&["--ignore-working-copy", "log", "--no-graph", "-r", revset, "-T", "change_id ++ \"\\n\""])?.lines().map(str::to_string).collect())
    }

    fn members(&self, revset: &str) -> Result<Vec<Member>> {
        let listed = self.jj(&["log", "--no-graph", "-r", revset, "-T", MEMBER])?;
        Ok(listed
            .lines()
            .filter_map(|line| {
                let mut fields = line.split(' ');
                Some(Member { commit: fields.next()?.into(), change: fields.next()?.into(), parents: fields.next().unwrap_or_default().split(',').filter(|parent| !parent.is_empty()).map(String::from).collect() })
            })
            .collect())
    }

    fn user_tools(&self) -> Result<Vec<String>> {
        let names = self.jj(&["config", "list", "-T", "name ++ \"\\n\"", "fix.tools"]).unwrap_or_default();
        let mut tools: Vec<String> = names
            .lines()
            .filter_map(|name| toml::from_str::<toml::Table>(&format!("{name} = 0")).ok())
            .filter_map(|table| table.get("fix")?.get("tools")?.as_table()?.keys().next().cloned())
            .collect();
        tools.sort();
        tools.dedup();
        Ok(tools)
    }

    fn owned(&self, state_dir: &Path) -> Option<String> {
        let mut changes: Vec<String> = Provenance::new(state_dir, now()).owned(&self.root).into_iter().filter(|change| !change.is_empty() && change.bytes().all(|byte| byte.is_ascii_lowercase())).collect();
        changes.sort();
        (!changes.is_empty()).then(|| changes.iter().map(|change| format!("change_id({change})")).collect::<Vec<_>>().join(" | "))
    }
}

pub fn locate(dir: &Path) -> Option<Repo> {
    let git = Repo::discover(dir);
    match Workspace::find(dir) {
        Some(workspace) if git.as_ref().is_none_or(|git| !git.root.starts_with(&workspace.root)) => Some(workspace.repo()),
        _ => git,
    }
}

pub fn own(settings: &Settings, state_dir: &Path, call: &Call) -> Result<()> {
    let Action::Commit { owns } = &call.action else { return Ok(()) };
    let Some(workspace) = Workspace::find(&call.dir) else { return Ok(()) };
    if !workspace.checked(settings) {
        return Ok(());
    }
    let changes = workspace.changes(owns).or_else(|_| workspace.changes("@"))?;
    Provenance::new(state_dir, now()).record_owned(&workspace.root, &changes)
}

struct Member {
    commit: String,
    change: String,
    parents: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct Segment {
    base: String,
    head: String,
    root: String,
}

fn segments(members: &[Member]) -> Vec<Segment> {
    let by_commit: HashMap<&str, &Member> = members.iter().map(|member| (member.commit.as_str(), member)).collect();
    let below: HashSet<&str> = members.iter().flat_map(|member| member.parents.iter().map(String::as_str)).collect();
    let mut segments: Vec<Segment> = Vec::new();
    for head in members.iter().filter(|member| !below.contains(member.commit.as_str())) {
        let mut chain = vec![head];
        while let [parent] = &chain[chain.len() - 1].parents[..]
            && let Some(next) = by_commit.get(parent.as_str())
        {
            chain.push(next);
        }
        let bottom = chain[chain.len() - 1];
        let found: Vec<Segment> = match &bottom.parents[..] {
            [base] => vec![Segment { base: base.clone(), head: head.commit.clone(), root: bottom.change.clone() }],
            _ => chain.iter().filter_map(|member| match &member.parents[..] {
                [base] => Some(Segment { base: base.clone(), head: member.commit.clone(), root: member.change.clone() }),
                _ => None,
            }).collect(),
        };
        for segment in found {
            if !segments.contains(&segment) {
                segments.push(segment);
            }
        }
    }
    segments
}

fn roots(members: &[Member]) -> Vec<String> {
    let commits: HashSet<&str> = members.iter().map(|member| member.commit.as_str()).collect();
    members.iter().filter(|member| member.parents.iter().all(|parent| !commits.contains(parent.as_str()))).map(|member| member.commit.clone()).collect()
}

struct Left {
    finding: Finding,
    fingerprint: String,
}

struct Report {
    removed: usize,
    files: Vec<String>,
    left: Vec<Left>,
    head: String,
    change: String,
}

fn fingerprint(change: &str, finding: &Finding) -> String {
    let digest = Sha256::new().chain_update(change).chain_update([0]).chain_update(&finding.rule).chain_update([0]).chain_update(&finding.path).chain_update([0]).chain_update(finding.snippet.trim()).finalize();
    digest.iter().take(16).map(|byte| format!("{byte:02x}")).collect()
}

fn own_files(staged: Vec<Staged>) -> Vec<Staged> {
    staged.into_iter().filter(|file| !file.rel.components().any(|part| part.as_os_str().to_str().is_some_and(|part| CONFLICT_PATHS.iter().any(|conflict| part.starts_with(conflict))))).collect()
}

fn fix_owned(settings: &Settings, workspace: &Workspace, state_dir: &Path, within: &str) -> Result<Option<Report>> {
    if !workspace.checked(settings) {
        return Ok(None);
    }
    let Some(owned) = workspace.owned(state_dir) else { return Ok(None) };
    let scope = format!("({owned}) & ({within}) & {UNPUBLISHED}");
    let members = workspace.members(&scope)?;
    if members.is_empty() {
        return Ok(None);
    }
    let store = crate::paths::resolve(Path::new(workspace.jj(&["git", "root"])?.trim()));
    let checkout = Checkout { git: Git::of_store(workspace.root.clone(), store.clone()), repo: workspace.repo() };
    let empty_tree = checkout.git.empty_tree()?;
    let base_of = |base: &str| if base.bytes().all(|byte| byte == b'0') { empty_tree.clone() } else { base.to_string() };
    let rules = settings.rules()?;
    let provenance = Provenance::new(state_dir, now());
    let engine = |commit: &str| Engine {
        settings,
        rules: &rules,
        scope: None,
        display: &workspace.root,
        attributes: Attributes::Tree { git_dir: store.clone(), commit: commit.to_string() },
        repo: Some(&checkout.repo),
    };

    let mut plan = Plan::new();
    for segment in segments(&members) {
        let base = base_of(&segment.base);
        let staged = own_files(checkout.staged(&base, &Target::Commit(&segment.head))?);
        let fixable: Vec<Finding> = engine(&segment.head).lint(&checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error && finding.fix.is_some()).collect();
        let source = Source { base: &base, target: Target::Commit(&segment.head), attributes: Attributes::Tree { git_dir: store.clone(), commit: segment.head.clone() }, on_disk: OnDisk::Links };
        for deletion in checkout.deletions(&staged, &fixable.iter().collect::<Vec<_>>(), &source, &provenance)? {
            let (Some(path), Some(language)) = (deletion.file.rel.to_str(), language_of(&deletion.file.rel)) else { continue };
            let everywhere = fix::runs(language, &deletion.file.source);
            let count = |runs: &[Run], run: &Run| runs.iter().filter(|other| *other == run).count();
            let planned = plan.entry(path.to_string()).or_default();
            for run in deletion.fixed.runs.iter().filter(|run| count(&everywhere, run) == count(&deletion.fixed.runs, run)) {
                if !planned.contains(run) {
                    planned.push(run.clone());
                }
            }
        }
    }
    plan.retain(|_, runs| !runs.is_empty());
    let removed = plan.values().flatten().map(Vec::len).sum();
    let files = plan.keys().map(|path| checkout.display(Path::new(path))).collect();
    let members = if plan.is_empty() {
        members
    } else {
        apply(workspace, state_dir, &roots(&members), &plan)?;
        workspace.members(&scope)?
    };

    let mut left = Vec::new();
    let mut seen = HashSet::new();
    for segment in segments(&members) {
        let staged = own_files(checkout.staged(&base_of(&segment.base), &Target::Commit(&segment.head))?);
        for finding in engine(&segment.head).lint(&checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error && finding.fix.is_none()) {
            let fingerprint = fingerprint(&segment.root, &finding);
            if seen.insert(fingerprint.clone()) {
                left.push(Left { finding, fingerprint });
            }
        }
    }
    left.sort_by(|a, b| (&a.finding.path, a.finding.line, a.finding.column, &a.finding.rule).cmp(&(&b.finding.path, b.finding.line, b.finding.column, &b.finding.rule)));
    let newest = members.first().context("jj listed no commits")?;
    Ok(Some(Report { removed, files, left, head: newest.commit.clone(), change: newest.change.clone() }))
}

fn apply(workspace: &Workspace, state_dir: &Path, roots: &[String], plan: &Plan) -> Result<()> {
    std::fs::create_dir_all(state_dir).with_context(|| format!("creating {}", state_dir.display()))?;
    let dir = tempfile::Builder::new().prefix("jj-fix-").tempdir_in(state_dir)?;
    let plan_file = dir.path().join("plan.json");
    std::fs::write(&plan_file, serde_json::to_vec(plan)?)?;
    let exe = std::env::current_exe().context("cannot find the ai-stack binary")?;
    let mut tools = toml::Table::new();
    for name in workspace.user_tools()? {
        tools.insert(name, toml::Value::Table(toml::Table::from_iter([("enabled".to_string(), toml::Value::Boolean(false))])));
    }
    let command = [exe.to_string_lossy().into_owned(), "lint".into(), "jj-tool".into(), "--plan".into(), plan_file.to_string_lossy().into_owned(), "$path".into()];
    let patterns: Vec<toml::Value> = plan.keys().map(|path| toml::Value::String(format!("root-file:{}", serde_json::to_string(path).unwrap_or_default()))).collect();
    let ours = toml::Table::from_iter([
        ("command".to_string(), toml::Value::Array(command.into_iter().map(toml::Value::String).collect())),
        ("patterns".to_string(), toml::Value::Array(patterns)),
        ("enabled".to_string(), toml::Value::Boolean(true)),
    ]);
    tools.insert(TOOL.into(), toml::Value::Table(ours));
    let config = toml::Table::from_iter([("fix".to_string(), toml::Value::Table(toml::Table::from_iter([("tools".to_string(), toml::Value::Table(tools))])))]);
    let config_file = dir.path().join("fix.toml");
    std::fs::write(&config_file, toml::to_string(&config)?)?;
    let config_arg = config_file.to_string_lossy().into_owned();
    let mut args: Vec<&str> = vec!["fix", "--config-file", &config_arg];
    for root in roots {
        args.extend(["-s", root.as_str()]);
    }
    workspace.jj(&args)?;
    Ok(())
}

pub fn tool(plan_file: &Path, path: &str, input: &mut dyn Read, out: &mut dyn Write) -> Result<()> {
    let mut bytes = Vec::new();
    input.read_to_end(&mut bytes)?;
    let fixed = planned_runs(plan_file, path).and_then(|(language, runs)| fix::remove_runs(language, std::str::from_utf8(&bytes).ok()?, &runs));
    out.write_all(fixed.as_ref().map_or(&bytes[..], |fixed| fixed.text.as_bytes()))?;
    Ok(())
}

fn planned_runs(plan_file: &Path, path: &str) -> Option<(ast_grep_language::SupportLang, Vec<Run>)> {
    let mut plan: Plan = serde_json::from_slice(&std::fs::read(plan_file).ok()?).ok()?;
    Some((language_of(Path::new(path))?, plan.remove(path)?))
}

fn located(left: &[&Finding]) -> Vec<String> {
    let mut named: Vec<String> = left.iter().take(SHOWN).map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect();
    if left.len() > SHOWN {
        named.push(format!("+{} more", left.len() - SHOWN));
    }
    named
}

fn removal(report: &Report) -> Option<String> {
    (report.removed > 0).then(|| format!("removed {} in {}", plural(report.removed, "comment"), files_named(&report.files)))
}

fn unskipped<'r>(report: &'r Report, log: &Log, key: &Path) -> Vec<&'r Finding> {
    let skipped = log.skipped(key);
    report.left.iter().filter(|left| !skipped.contains(&left.fingerprint)).map(|left| &left.finding).collect()
}

pub fn after_commit(settings: &Settings, state_dir: &Path, dir: &Path) -> Result<Option<String>> {
    let Some(workspace) = Workspace::find(dir) else { return Ok(None) };
    let report = match fix_owned(settings, &workspace, state_dir, "all()") {
        Ok(Some(report)) => report,
        Ok(None) => return Ok(None),
        Err(error) => return Ok(Some(skipped(&error))),
    };
    let mut parts: Vec<String> = removal(&report).into_iter().collect();
    let left = unskipped(&report, &Log::new(state_dir), &workspace.key);
    if !left.is_empty() {
        parts.push(format!("{} (fix before pushing)", located(&left).join(", ")));
    }
    Ok((!parts.is_empty()).then(|| format!("ai-stack lint: {}", parts.join("; "))))
}

fn skipped(error: &anyhow::Error) -> String {
    format!("ai-stack lint: skipped ({})", format!("{error:#}").lines().next().unwrap_or_default())
}

pub fn before_push(settings: &Settings, state_dir: &Path, call: &Call, harness: &str) -> Option<Value> {
    let Action::Push { targets: Some(targets), dry_run: false } = &call.action else { return None };
    let workspace = Workspace::find(&call.dir)?;
    match push_check(settings, state_dir, &workspace, targets, call.skip.as_deref(), harness) {
        Ok(None) => None,
        Ok(Some(Decision::Allow(lines))) => (!lines.is_empty()).then(|| json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": lines.join("\n")}})),
        Ok(Some(Decision::Deny(lines))) => Some(json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": lines.join("\n")}})),
        Err(error) => Some(json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": skipped(&error)}})),
    }
}

enum Decision {
    Allow(Vec<String>),
    Deny(Vec<String>),
}

fn push_check(settings: &Settings, state_dir: &Path, workspace: &Workspace, targets: &str, reason: Option<&str>, harness: &str) -> Result<Option<Decision>> {
    let Some(report) = fix_owned(settings, workspace, state_dir, &format!("::({targets})"))? else { return Ok(None) };
    let log = Log::new(state_dir);
    let time = now();
    let mut lines = Vec::new();
    if log.rate(&workspace.key, settings.skip_alert, time).over(settings.skip_alert) {
        lines.push(HIGH_RATE.to_string());
    }
    lines.extend(removal(&report).map(|removed| format!("ai-stack lint: {removed}")));
    if reason == Some("") {
        lines.push("ai-stack lint: AI_STACK_LINT_SKIP needs a reason, so this push is checked as usual.".into());
    }
    let skipped = log.skipped(&workspace.key);
    let fresh: Vec<&Left> = report.left.iter().filter(|left| !skipped.contains(&left.fingerprint)).collect();
    let left: Vec<&Finding> = fresh.iter().map(|left| &left.finding).collect();
    let event = |kind, findings: Vec<String>, reason: Option<String>, fingerprints: Vec<String>| Event {
        time,
        kind,
        repo: workspace.key.clone(),
        harness: Some(harness.to_string()),
        head: Some(report.head.clone()),
        findings,
        reason,
        vcs: Some("jj".into()),
        change: Some(report.change.clone()),
        fingerprints,
    };
    let recorded = match reason.filter(|reason| !reason.is_empty()) {
        _ if left.is_empty() => (!log.has_change(&workspace.key, &report.change)).then(|| event(Kind::Checked, Vec::new(), None, Vec::new())),
        Some(reason) => {
            let mut files: Vec<&Path> = left.iter().map(|finding| finding.file.as_path()).collect();
            files.dedup();
            let limits = settings.skip;
            if files.len() > limits.files || left.len() > limits.findings {
                lines.push(format!(
                    "ai-stack lint: a skip must cover only the exception (at most {} file and {} findings; this push has {} and {}). Fix the rest, then push with the skip.",
                    limits.files,
                    limits.findings,
                    files.len(),
                    left.len()
                ));
                return Ok(Some(Decision::Deny(lines)));
            }
            let findings = sorted_names(&left);
            lines.push(skip_recorded(&findings, reason));
            Some(event(Kind::Skip, findings, Some(reason.to_string()), fresh.iter().map(|left| left.fingerprint.clone()).collect()))
        }
        None => {
            lines.extend(refusal(&left, "push"));
            return Ok(Some(Decision::Deny(lines)));
        }
    };
    if let Some(recorded) = recorded {
        if let Err(error) = log.record(&recorded)
            && recorded.kind == Kind::Skip
        {
            lines.pop();
            lines.push(format!("ai-stack lint: the skip could not be recorded ({}), so this push is refused.", format!("{error:#}").lines().next().unwrap_or_default()));
            return Ok(Some(Decision::Deny(lines)));
        }
        let _ = log.alert(&workspace.key, settings.skip_alert, time);
    }
    Ok(Some(Decision::Allow(lines)))
}

pub fn fix_here(settings: &Settings, state_dir: &Path, cwd: &Path, err: &mut dyn Write) -> Result<i32> {
    let Some(workspace) = Workspace::find(cwd) else { bail!("{} is not inside a jj workspace", cwd.display()) };
    let Some(report) = fix_owned(settings, &workspace, state_dir, "all()")? else { return Ok(0) };
    if let Some(removed) = removal(&report) {
        writeln!(err, "ai-stack lint: {removed}")?;
    }
    let left = unskipped(&report, &Log::new(state_dir), &workspace.key);
    if left.is_empty() {
        return Ok(0);
    }
    for line in refusal(&left, "push") {
        writeln!(err, "{line}")?;
    }
    Ok(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(commit: &str, change: &str, parents: &[&str]) -> Member {
        Member { commit: commit.into(), change: change.into(), parents: parents.iter().map(|parent| parent.to_string()).collect() }
    }

    #[test]
    fn owned_commits_split_into_runs_of_their_own_and_a_human_commit_between_them_starts_a_new_one() {
        let segment = |base: &str, head: &str, root: &str| Segment { base: base.into(), head: head.into(), root: root.into() };
        let members = [member("c3", "z3", &["h2"]), member("c1", "z1", &["b0"]), member("s4", "z4", &["c1"]), member("c5", "z5", &["c1"])];
        assert_eq!(segments(&members), [segment("h2", "c3", "z3"), segment("b0", "s4", "z1"), segment("b0", "c5", "z1")]);
        assert_eq!(roots(&members), ["c3", "c1"]);
        let merge = [member("m2", "y2", &["a", "b"]), member("n3", "y3", &["m2"])];
        assert_eq!(segments(&merge), [segment("m2", "n3", "y3")], "a merge is never diffed against one parent");
    }
}
