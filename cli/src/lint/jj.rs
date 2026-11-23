use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::LazyLock;

use anyhow::{Context as _, Result, bail};
use regex::Regex;
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};

use super::command::{Action, Call};
use super::commit::{Checkout, Git, HIGH_RATE, OnDisk, Source, Staged, Target, plural, refusal, skip_recorded, sorted_names};
use super::events::{Event, Kind, Log, now};
use super::fix::{self, Run};
use super::provenance::{self, Provenance};
use super::repo::{Attributes, Repo};
use super::rules::Rules;
use super::scan::{Engine, language_of};
use super::{Finding, Settings, Severity, files_named};

const TOOL: &str = "ai-stack-lint";
const SHOWN: usize = 5;
const UNPUBLISHED: &str = "mutable() & ~conflicts() & ~::remote_bookmarks()";
const MEMBER: &str = r#"commit_id ++ " " ++ change_id ++ " " ++ parents.map(|parent| parent.commit_id()).join(",") ++ "\n""#;
const OPERATION: &str = r#"id ++ " " ++ description ++ "\n""#;
const OPERATIONS_READ: &str = "50";
const SNAPSHOT: &str = "snapshot working copy";
const CONFLICT_PATHS: [&str; 2] = [".jjconflict-", "JJ-CONFLICT-README"];
const BUILT_ON: &str = "others built on it";
const UNDO: &str = "(jj undo reverts this fix first)";
const CHAINED: &str = "ai-stack lint: run jj git push as its own command so ai-stack lint can check what it sends.";

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

    fn command(&self) -> Command {
        let mut command = Command::new("jj");
        command.arg("-R").arg(&self.root).args(["--no-pager", "--color=never"]).stdin(Stdio::null());
        command
    }

    fn jj(&self, args: &[&str]) -> Result<String> {
        let out = self.command().arg("--quiet").args(args).output().context("cannot run jj")?;
        if !out.status.success() {
            bail!("jj {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn listed(&self, revset: &str, template: &str) -> Result<Vec<String>> {
        Ok(self.jj(&["--ignore-working-copy", "log", "--no-graph", "-r", revset, "-T", template])?.lines().map(str::to_string).collect())
    }

    fn changes(&self, revset: &str) -> Result<Vec<String>> {
        self.listed(revset, "change_id ++ \"\\n\"")
    }

    fn commits(&self, revset: &str) -> Result<Vec<String>> {
        self.listed(revset, "commit_id ++ \"\\n\"")
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
        let changes: Vec<String> = Provenance::new(state_dir, now()).owned(&self.root).into_iter().collect();
        any_change(&changes)
    }

    fn operation(&self) -> Result<String> {
        Ok(self.jj(&["--ignore-working-copy", "op", "log", "--no-graph", "-n", "1", "-T", "id"])?.trim().to_string())
    }

    fn finalised_since(&self, operation: &str) -> Result<bool> {
        let operations = self.jj(&["--ignore-working-copy", "op", "log", "--no-graph", "-n", OPERATIONS_READ, "-T", OPERATION])?;
        Ok(operations.lines().map(|line| line.split_once(' ').unwrap_or((line, ""))).take_while(|(id, _)| *id != operation).any(|(_, description)| description != SNAPSHOT))
    }

    fn pushed(&self, args: &[String]) -> Result<Vec<String>> {
        static TARGET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\bto ([0-9a-f]+)\]\s*$").unwrap());
        let out = self.command().args(args).arg("--dry-run").output().context("cannot run jj")?;
        if !out.status.success() {
            bail!("jj git push --dry-run: {}", String::from_utf8_lossy(&out.stderr).trim());
        }
        let printed = [out.stdout, out.stderr].concat();
        let commits: Vec<String> = String::from_utf8_lossy(&printed).lines().filter_map(|line| Some(TARGET.captures(line)?[1].to_string())).collect();
        if commits.is_empty() {
            return Ok(Vec::new());
        }
        self.changes(&commits.join(" | "))
    }
}

fn any_change(changes: &[String]) -> Option<String> {
    let mut changes: Vec<&String> = changes.iter().filter(|change| !change.is_empty() && change.bytes().all(|byte| byte.is_ascii_lowercase())).collect();
    changes.sort();
    changes.dedup();
    (!changes.is_empty()).then(|| changes.iter().map(|change| format!("change_id({change})")).collect::<Vec<_>>().join(" | "))
}

pub fn locate(dir: &Path) -> Option<Repo> {
    let git = Repo::discover(dir);
    match Workspace::find(dir) {
        Some(workspace) if git.as_ref().is_none_or(|git| !git.root.starts_with(&workspace.root)) => Some(workspace.repo()),
        _ => git,
    }
}

pub fn stage(settings: &Settings, state_dir: &Path, calls: &[&Call]) -> Result<()> {
    let mut staged: Vec<(Workspace, Vec<String>)> = Vec::new();
    for call in calls {
        let Action::Commit { owns } = &call.action else { continue };
        let Some(workspace) = Workspace::find(&call.dir) else { continue };
        if !workspace.checked(settings) {
            continue;
        }
        let changes = workspace.changes(owns).or_else(|_| workspace.changes("@"))?;
        match staged.iter_mut().find(|(known, _)| known.root == workspace.root) {
            Some((_, known)) => known.extend(changes),
            None => staged.push((workspace, changes)),
        }
    }
    let provenance = Provenance::new(state_dir, now());
    for (workspace, mut changes) in staged {
        changes.sort();
        changes.dedup();
        provenance.stage_owned(&workspace.root, &provenance::Staged { operation: workspace.operation()?, changes })?;
    }
    Ok(())
}

fn confirm(workspace: &Workspace, state_dir: &Path) -> Result<Vec<String>> {
    let provenance = Provenance::new(state_dir, now());
    let Some(staged) = provenance.take_staged(&workspace.root) else { return Ok(Vec::new()) };
    if !workspace.finalised_since(&staged.operation)? {
        return Ok(Vec::new());
    }
    provenance.record_owned(&workspace.root, &staged.changes)?;
    Ok(staged.changes)
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
    commits: Vec<String>,
    changes: Vec<String>,
}

fn segments(members: &[Member]) -> Vec<Segment> {
    let by_commit: HashMap<&str, &Member> = members.iter().map(|member| (member.commit.as_str(), member)).collect();
    let below: HashSet<&str> = members.iter().flat_map(|member| member.parents.iter().map(String::as_str)).collect();
    let alone = |member: &Member, base: &str| Segment { base: base.into(), head: member.commit.clone(), commits: vec![member.commit.clone()], changes: vec![member.change.clone()] };
    let mut segments: Vec<Segment> = Vec::new();
    for head in members.iter().filter(|member| !below.contains(member.commit.as_str())) {
        let mut chain = vec![head];
        while let [parent] = &chain[chain.len() - 1].parents[..]
            && let Some(next) = by_commit.get(parent.as_str())
        {
            chain.push(next);
        }
        let found: Vec<Segment> = match &chain[chain.len() - 1].parents[..] {
            [base] => vec![Segment {
                base: base.clone(),
                head: head.commit.clone(),
                commits: chain.iter().map(|member| member.commit.clone()).collect(),
                changes: chain.iter().map(|member| member.change.clone()).collect(),
            }],
            _ => chain.iter().filter_map(|member| match &member.parents[..] {
                [base] => Some(alone(member, base)),
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

struct Left {
    finding: Finding,
    fingerprint: String,
}

fn fingerprinted(mut findings: Vec<Finding>) -> Vec<Left> {
    findings.sort_by(|a, b| (&a.path, a.line, a.column, &a.rule).cmp(&(&b.path, b.line, b.column, &b.rule)));
    let mut seen: HashMap<(String, String, String), usize> = HashMap::new();
    findings
        .into_iter()
        .map(|finding| {
            let occurrence = seen.entry((finding.rule.clone(), finding.path.clone(), finding.snippet.trim().to_string())).or_default();
            let digest = Sha256::new().chain_update(&finding.rule).chain_update([0]).chain_update(&finding.path).chain_update([0]).chain_update(finding.snippet.trim()).chain_update([0]).chain_update(occurrence.to_string()).finalize();
            *occurrence += 1;
            Left { fingerprint: digest.iter().take(16).map(|byte| format!("{byte:02x}")).collect(), finding }
        })
        .collect()
}

fn own_files(staged: Vec<Staged>) -> Vec<Staged> {
    staged.into_iter().filter(|file| !file.rel.components().any(|part| part.as_os_str().to_str().is_some_and(|part| CONFLICT_PATHS.iter().any(|conflict| part.starts_with(conflict))))).collect()
}

struct Lint<'a> {
    settings: &'a Settings,
    workspace: &'a Workspace,
    store: PathBuf,
    checkout: Checkout,
    empty_tree: String,
    rules: Rules,
    provenance: Provenance,
}

impl<'a> Lint<'a> {
    fn open(settings: &'a Settings, workspace: &'a Workspace, state_dir: &Path) -> Result<Lint<'a>> {
        let store = crate::paths::resolve(Path::new(workspace.jj(&["git", "root"])?.trim()));
        let checkout = Checkout { git: Git::of_store(workspace.root.clone(), store.clone()), repo: workspace.repo() };
        let empty_tree = checkout.git.empty_tree()?;
        Ok(Lint { settings, workspace, store, checkout, empty_tree, rules: settings.rules()?, provenance: Provenance::new(state_dir, now()) })
    }

    fn base(&self, base: &str) -> String {
        if base.bytes().all(|byte| byte == b'0') { self.empty_tree.clone() } else { base.to_string() }
    }

    fn attributes(&self, commit: &str) -> Attributes {
        Attributes::Tree { git_dir: self.store.clone(), commit: commit.to_string() }
    }

    fn engine(&self, commit: &str) -> Engine<'_> {
        Engine { settings: self.settings, rules: &self.rules, scope: None, display: &self.workspace.root, attributes: self.attributes(commit), repo: Some(&self.checkout.repo) }
    }

    fn diff(&self, base: &str, head: &str) -> Result<Vec<Staged>> {
        Ok(own_files(self.checkout.staged(&self.base(base), &Target::Commit(head))?))
    }

    fn unfixable(&self, base: &str, head: &str) -> Result<Vec<Finding>> {
        let staged = self.diff(base, head)?;
        Ok(self.engine(head).lint(&self.checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error && finding.fix.is_none()).collect())
    }

    fn planned(&self, segment: &Segment) -> Result<Plan> {
        let base = self.base(&segment.base);
        let staged = self.diff(&segment.base, &segment.head)?;
        let fixable: Vec<Finding> = self.engine(&segment.head).lint(&self.checkout.changes(&staged)).into_iter().filter(|finding| finding.severity == Severity::Error && finding.fix.is_some()).collect();
        let source = Source { base: &base, target: Target::Commit(&segment.head), attributes: self.attributes(&segment.head), on_disk: OnDisk::Links };
        let mut plan = Plan::new();
        for deletion in self.checkout.deletions(&staged, &fixable.iter().collect::<Vec<_>>(), &source, &self.provenance)? {
            let (Some(path), Some(language)) = (deletion.file.rel.to_str(), language_of(&deletion.file.rel)) else { continue };
            let everywhere = fix::runs(language, &deletion.file.source);
            let count = |runs: &[Run], run: &Run| runs.iter().filter(|other| *other == run).count();
            let runs: Vec<Run> = deletion.fixed.runs.iter().filter(|run| count(&everywhere, run) == count(&deletion.fixed.runs, run)).cloned().collect();
            if !runs.is_empty() {
                plan.insert(path.to_string(), runs);
            }
        }
        Ok(plan)
    }
}

fn comments(runs: &[Run]) -> usize {
    runs.iter().map(Vec::len).sum()
}

struct Blocked {
    changes: Vec<String>,
    comments: usize,
}

struct Outcome<'a> {
    lint: Lint<'a>,
    members: Vec<Member>,
    removed: usize,
    files: Vec<String>,
    blocked: Vec<Blocked>,
    left: Vec<Left>,
}

impl Outcome<'_> {
    fn summary(&self, kept: usize) -> Option<String> {
        let mut parts = Vec::new();
        if self.removed > 0 {
            parts.push(format!("removed {} in {}", plural(self.removed, "comment"), files_named(&self.files)));
        }
        if kept > 0 {
            parts.push(format!("kept {} ({BUILT_ON})", plural(kept, "comment")));
        }
        (!parts.is_empty()).then(|| parts.join("; "))
    }

    fn all_kept(&self) -> usize {
        self.blocked.iter().map(|blocked| blocked.comments).sum()
    }

    fn newest(&self) -> Result<&Member> {
        self.members.first().context("jj listed no commits")
    }
}

fn fix_owned<'a>(settings: &'a Settings, workspace: &'a Workspace, state_dir: &Path, within: &str) -> Result<Option<Outcome<'a>>> {
    if !workspace.checked(settings) {
        return Ok(None);
    }
    let Some(owned) = workspace.owned(state_dir) else { return Ok(None) };
    let scope = format!("({owned}) & ({within}) & {UNPUBLISHED}");
    let members = workspace.members(&scope)?;
    if members.is_empty() {
        return Ok(None);
    }
    let lint = Lint::open(settings, workspace, state_dir)?;

    let mut candidates = Vec::new();
    for segment in segments(&members) {
        let plan = lint.planned(&segment)?;
        if plan.is_empty() {
            continue;
        }
        let paths: Vec<String> = plan.keys().map(|path| format!("root-file:{}", serde_json::to_string(path).unwrap_or_default())).collect();
        let roots = workspace.commits(&format!("roots(({}) & files({}))", segment.commits.join(" | "), paths.join(" | ")))?;
        candidates.push((segment, plan, roots));
    }
    let mut roots: Vec<&String> = candidates.iter().flat_map(|(_, _, roots)| roots).collect();
    roots.sort();
    roots.dedup();
    let blocked_roots: HashSet<String> = match roots.is_empty() {
        true => HashSet::new(),
        false => {
            let any = roots.iter().map(|root| root.as_str()).collect::<Vec<_>>().join(" | ");
            workspace.commits(&format!("({any}) & ::((descendants({any}) ~ ({owned})) ~ @)"))?.into_iter().collect()
        }
    };

    let mut plan = Plan::new();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut fix_roots: Vec<String> = Vec::new();
    let mut blocked = Vec::new();
    for (segment, runs, roots) in candidates {
        if roots.is_empty() {
            continue;
        }
        if roots.iter().any(|root| blocked_roots.contains(root)) {
            blocked.push(Blocked { changes: segment.changes, comments: runs.values().map(|runs| comments(runs)).sum() });
            continue;
        }
        for (path, runs) in runs {
            let count = counts.entry(path.clone()).or_default();
            *count = (*count).max(comments(&runs));
            let planned = plan.entry(path).or_default();
            for run in runs {
                if !planned.contains(&run) {
                    planned.push(run);
                }
            }
        }
        for root in roots {
            if !fix_roots.contains(&root) {
                fix_roots.push(root);
            }
        }
    }
    let files = plan.keys().map(|path| lint.checkout.display(Path::new(path))).collect();
    let members = if plan.is_empty() {
        members
    } else {
        apply(workspace, state_dir, &fix_roots, &plan)?;
        workspace.members(&scope)?
    };

    let mut left = Vec::new();
    let mut seen = HashSet::new();
    for segment in segments(&members) {
        for item in fingerprinted(lint.unfixable(&segment.base, &segment.head)?) {
            if seen.insert(item.fingerprint.clone()) {
                left.push(item);
            }
        }
    }
    left.sort_by(|a, b| (&a.finding.path, a.finding.line, a.finding.column, &a.finding.rule).cmp(&(&b.finding.path, b.finding.line, b.finding.column, &b.finding.rule)));
    Ok(Some(Outcome { lint, members, removed: counts.values().sum(), files, blocked, left }))
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

fn located(left: &[&Finding]) -> String {
    let mut named: Vec<String> = left.iter().take(SHOWN).map(|finding| format!("{}:{} {}", finding.path, finding.line, finding.rule)).collect();
    if left.len() > SHOWN {
        named.push(format!("+{} more", left.len() - SHOWN));
    }
    named.join(", ")
}

fn unskipped<'r>(left: &'r [Left], log: &Log, key: &Path) -> Vec<&'r Left> {
    let skipped = log.skipped(key);
    left.iter().filter(|left| !skipped.contains(&left.fingerprint)).collect()
}

fn too_wide(settings: &Settings, left: &[&Finding]) -> Option<(usize, usize)> {
    let files: HashSet<&Path> = left.iter().map(|finding| finding.file.as_path()).collect();
    let limits = settings.skip;
    (files.len() > limits.files || left.len() > limits.findings).then_some((files.len(), left.len()))
}

fn skipped(error: &anyhow::Error) -> String {
    format!("ai-stack lint: skipped ({})", format!("{error:#}").lines().next().unwrap_or_default())
}

struct Recorder<'a> {
    log: Log,
    workspace: &'a Workspace,
    harness: &'a str,
    time: u64,
}

impl Recorder<'_> {
    fn event(&self, kind: Kind, member: &Member, findings: Vec<String>, reason: Option<&str>, fingerprints: Vec<String>) -> Event {
        Event {
            time: self.time,
            kind,
            repo: self.workspace.key.clone(),
            harness: Some(self.harness.to_string()),
            head: Some(member.commit.clone()),
            findings,
            reason: reason.map(str::to_string),
            vcs: Some("jj".into()),
            change: Some(member.change.clone()),
            fingerprints,
        }
    }

    fn checked(&self, member: &Member) {
        if !self.log.has_change(&self.workspace.key, &member.change) {
            let _ = self.log.record(&self.event(Kind::Checked, member, Vec::new(), None, Vec::new()));
        }
    }

    fn skip(&self, settings: &Settings, member: &Member, left: &[&Left], reason: &str) -> Result<String> {
        let findings = sorted_names(&left.iter().map(|left| &left.finding).collect::<Vec<_>>());
        self.log.record(&self.event(Kind::Skip, member, findings.clone(), Some(reason), left.iter().map(|left| left.fingerprint.clone()).collect()))?;
        let _ = self.log.alert(&self.workspace.key, settings.skip_alert, self.time);
        Ok(skip_recorded(&findings, reason))
    }
}

pub fn after_commit(settings: &Settings, state_dir: &Path, dir: &Path, skip: Option<&str>, harness: &str) -> Result<Option<String>> {
    let Some(workspace) = Workspace::find(dir) else { return Ok(None) };
    if !workspace.checked(settings) {
        return Ok(None);
    }
    let finalised = match confirm(&workspace, state_dir) {
        Ok(finalised) if finalised.is_empty() => return Ok(None),
        Ok(finalised) => finalised,
        Err(error) => return Ok(Some(skipped(&error))),
    };
    let outcome = match fix_owned(settings, &workspace, state_dir, "all()") {
        Ok(Some(outcome)) => outcome,
        Ok(None) => return Ok(None),
        Err(error) => return Ok(Some(skipped(&error))),
    };
    let recorder = Recorder { log: Log::new(state_dir), workspace: &workspace, harness, time: now() };
    Ok(finalised_report(settings, &outcome, &finalised, skip, &recorder).unwrap_or_else(|error| Some(skipped(&error))))
}

fn finalised_report(settings: &Settings, outcome: &Outcome, finalised: &[String], skip: Option<&str>, recorder: &Recorder) -> Result<Option<String>> {
    let heads: Vec<&Member> = outcome.members.iter().filter(|member| finalised.contains(&member.change)).collect();
    let mut findings = Vec::new();
    for member in &heads {
        if let [parent] = &member.parents[..] {
            findings.extend(outcome.lint.unfixable(parent, &member.commit)?);
        }
    }
    let findings = fingerprinted(findings);
    let fresh = unskipped(&findings, &recorder.log, &recorder.workspace.key);
    let left: Vec<&Finding> = fresh.iter().map(|left| &left.finding).collect();
    let kept = outcome.blocked.iter().filter(|blocked| blocked.changes.iter().any(|change| finalised.contains(change))).map(|blocked| blocked.comments).sum();
    let mut parts: Vec<String> = outcome.summary(kept).into_iter().collect();
    let mut notes = Vec::new();
    let reason = skip.filter(|reason| !reason.is_empty());
    if skip == Some("") && !left.is_empty() {
        notes.push("ai-stack lint: AI_STACK_LINT_SKIP needs a reason, so nothing was skipped.".to_string());
    }
    match (heads.first(), reason) {
        (None, _) => {}
        (Some(_), _) if left.is_empty() => heads.iter().for_each(|member| recorder.checked(member)),
        (Some(member), Some(reason)) => match too_wide(settings, &left) {
            Some((files, count)) => {
                parts.push(format!("{} (fix before pushing)", located(&left)));
                notes.push(format!(
                    "ai-stack lint: a skip must cover only the exception (at most {} file and {} findings; this change has {files} and {count}), so it was not recorded.",
                    settings.skip.files, settings.skip.findings
                ));
            }
            None => match recorder.skip(settings, member, &fresh, reason) {
                Ok(recorded) => notes.push(recorded),
                Err(error) => {
                    parts.push(format!("{} (fix before pushing)", located(&left)));
                    notes.push(format!("ai-stack lint: the skip could not be recorded ({}).", format!("{error:#}").lines().next().unwrap_or_default()));
                }
            },
        },
        (Some(_), None) => parts.push(format!("{} (fix before pushing)", located(&left))),
    }
    let mut lines = Vec::new();
    if !parts.is_empty() {
        let undo = if outcome.removed > 0 { format!(" {UNDO}") } else { String::new() };
        lines.push(format!("ai-stack lint: {}{undo}", parts.join("; ")));
    }
    lines.extend(notes);
    Ok((!lines.is_empty()).then(|| lines.join("\n")))
}

fn deny(lines: &[String]) -> Value {
    json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": lines.join("\n")}})
}

pub fn before_push(settings: &Settings, state_dir: &Path, call: &Call, harness: &str) -> Option<Value> {
    let Action::Push { args, dry_run: false, chained } = &call.action else { return None };
    let workspace = Workspace::find(&call.dir)?;
    if !workspace.checked(settings) {
        return None;
    }
    if *chained {
        return Some(deny(&[CHAINED.to_string()]));
    }
    let targets = workspace.pushed(args).ok()?;
    let within = format!("::({})", any_change(&targets)?);
    match push_check(settings, state_dir, &workspace, &within, call.skip.as_deref(), harness) {
        Ok(None) => None,
        Ok(Some(Decision::Allow(lines))) => (!lines.is_empty()).then(|| json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": lines.join("\n")}})),
        Ok(Some(Decision::Deny(lines))) => Some(deny(&lines)),
        Err(error) => Some(json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": skipped(&error)}})),
    }
}

enum Decision {
    Allow(Vec<String>),
    Deny(Vec<String>),
}

fn push_check(settings: &Settings, state_dir: &Path, workspace: &Workspace, within: &str, reason: Option<&str>, harness: &str) -> Result<Option<Decision>> {
    let Some(outcome) = fix_owned(settings, workspace, state_dir, within)? else { return Ok(None) };
    let recorder = Recorder { log: Log::new(state_dir), workspace, harness, time: now() };
    let mut lines = Vec::new();
    if recorder.log.rate(&workspace.key, settings.skip_alert, recorder.time).over(settings.skip_alert) {
        lines.push(HIGH_RATE.to_string());
    }
    lines.extend(outcome.summary(outcome.all_kept()).map(|summary| format!("ai-stack lint: {summary}")));
    if reason == Some("") {
        lines.push("ai-stack lint: AI_STACK_LINT_SKIP needs a reason, so this push is checked as usual.".into());
    }
    let fresh = unskipped(&outcome.left, &recorder.log, &workspace.key);
    let left: Vec<&Finding> = fresh.iter().map(|left| &left.finding).collect();
    let newest = outcome.newest()?;
    match reason.filter(|reason| !reason.is_empty()) {
        _ if left.is_empty() => recorder.checked(newest),
        Some(reason) => {
            if let Some((files, count)) = too_wide(settings, &left) {
                lines.push(format!(
                    "ai-stack lint: a skip must cover only the exception (at most {} file and {} findings; this push has {files} and {count}). Fix the rest, then push with the skip.",
                    settings.skip.files, settings.skip.findings
                ));
                return Ok(Some(Decision::Deny(lines)));
            }
            match recorder.skip(settings, newest, &fresh, reason) {
                Ok(recorded) => lines.push(recorded),
                Err(error) => {
                    lines.push(format!("ai-stack lint: the skip could not be recorded ({}), so this push is refused.", format!("{error:#}").lines().next().unwrap_or_default()));
                    return Ok(Some(Decision::Deny(lines)));
                }
            }
        }
        None => {
            lines.extend(refusal(&left, "push"));
            return Ok(Some(Decision::Deny(lines)));
        }
    }
    Ok(Some(Decision::Allow(lines)))
}

pub fn fix_here(settings: &Settings, state_dir: &Path, cwd: &Path, err: &mut dyn Write) -> Result<i32> {
    let Some(workspace) = Workspace::find(cwd) else { bail!("{} is not inside a jj workspace", cwd.display()) };
    let Some(outcome) = fix_owned(settings, &workspace, state_dir, "all()")? else { return Ok(0) };
    if let Some(summary) = outcome.summary(outcome.all_kept()) {
        writeln!(err, "ai-stack lint: {summary}")?;
    }
    let left: Vec<&Finding> = unskipped(&outcome.left, &Log::new(state_dir), &workspace.key).into_iter().map(|left| &left.finding).collect();
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
        let shape = |members: &[Member]| -> Vec<(String, String, String)> { segments(members).into_iter().map(|segment| (segment.base, segment.head, segment.changes.join(","))).collect() };
        let triple = |base: &str, head: &str, changes: &str| (base.to_string(), head.to_string(), changes.to_string());
        let members = [member("c3", "z3", &["h2"]), member("c1", "z1", &["b0"]), member("s4", "z4", &["c1"]), member("c5", "z5", &["c1"])];
        assert_eq!(shape(&members), [triple("h2", "c3", "z3"), triple("b0", "s4", "z4,z1"), triple("b0", "c5", "z5,z1")]);
        let merge = [member("m2", "y2", &["a", "b"]), member("n3", "y3", &["m2"])];
        assert_eq!(shape(&merge), [triple("m2", "n3", "y3")], "a merge is never diffed against one parent");
    }

    #[test]
    fn identical_findings_are_each_counted_and_keep_their_own_fingerprint() {
        let finding = |line: u32, snippet: &str| Finding {
            file: PathBuf::from("/w/a.test.ts"),
            path: "a.test.ts".into(),
            rule: "no-fixed-sleep".into(),
            severity: Severity::Error,
            line,
            column: 3,
            end_line: line,
            message: String::new(),
            snippet: snippet.into(),
            bytes: 0..0,
            fix: None,
        };
        let sleep = "  await sleep(100);";
        let left = fingerprinted(vec![finding(12, sleep), finding(2, sleep), finding(7, "await sleep(100);"), finding(9, "await sleep(5);")]);
        assert_eq!(left.iter().map(|left| left.finding.line).collect::<Vec<_>>(), [2, 7, 9, 12]);
        let prints: HashSet<&String> = left.iter().map(|left| &left.fingerprint).collect();
        assert_eq!(prints.len(), 4, "each occurrence of the same line is its own finding");
        let again = fingerprinted(vec![finding(40, sleep), finding(30, sleep)]);
        assert_eq!((&again[0].fingerprint, &again[1].fingerprint), (&left[0].fingerprint, &left[1].fingerprint), "a fingerprint follows the occurrence, not the line number");
    }
}
