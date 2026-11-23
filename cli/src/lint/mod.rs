mod commit;
mod events;
mod fix;
mod hook;
mod lines;
mod process;
mod repo;
mod rules;
mod scan;
mod settings;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Write;
use std::os::unix::fs::MetadataExt as _;
use std::ops::Range;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

pub use commit::{Env as CommitEnv, post_commit, pre_commit};
pub use events::now;
pub use hook::run as run_hook;
pub use lines::Baseline;
pub use settings::Settings;

use events::Log;
use repo::{Attributes, Repo, Repos};
use rules::Fix;
use scan::Engine;

pub const LOAD_ERROR: i32 = 2;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    #[default]
    Lines,
    Function,
    File,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Warning,
    Error,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Warning => "warning",
            Severity::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warning,
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Finding {
    #[serde(skip)]
    pub file: PathBuf,
    pub path: String,
    pub rule: String,
    pub severity: Severity,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub message: String,
    pub snippet: String,
    #[serde(skip)]
    pub bytes: Range<usize>,
    #[serde(skip)]
    pub fix: Option<Fix>,
}

pub fn state_dir(home: &Path) -> PathBuf {
    home.join(".local/state/ai-stack/lint")
}

pub fn settings(config_path: &Path, home: &Path, stack_override: Option<&Path>) -> Result<Settings> {
    let text = crate::config::read(config_path)?;
    let (stack, section) = crate::config::parse_lint(&text, home, stack_override).with_context(|| format!("reading [stack] and [lint] in {}", config_path.display()))?;
    let config_dir = config_path.parent().unwrap_or(Path::new("."));
    Settings::new(section, &stack, config_dir, home)
}

pub struct Request {
    pub cwd: PathBuf,
    pub paths: Vec<PathBuf>,
    pub base: String,
    pub scope: Option<Scope>,
    pub json: bool,
    pub fix: bool,
}

pub fn run(settings: &Settings, request: Request, out: &mut dyn Write, err: &mut dyn Write) -> Result<i32> {
    let rules = match settings.rules() {
        Ok(rules) => rules,
        Err(error) => {
            writeln!(err, "error: {error:#}")?;
            return Ok(LOAD_ERROR);
        }
    };
    let cwd = request.cwd;
    let paths = match (request.paths.is_empty(), Repo::discover(&cwd)) {
        (false, _) => request.paths,
        (true, Some(repo)) => vec![repo.root],
        (true, None) => {
            writeln!(err, "error: {} is not inside a git repository", cwd.display())?;
            return Ok(LOAD_ERROR);
        }
    };
    let mut groups: Vec<(Repo, Vec<PathBuf>)> = Vec::new();
    for path in paths {
        let absolute = crate::paths::normalize(&cwd.join(&path));
        if std::fs::symlink_metadata(&absolute).is_err() {
            writeln!(err, "error: {} does not exist", path.display())?;
            return Ok(LOAD_ERROR);
        }
        let dir = if absolute.is_dir() { absolute.clone() } else { absolute.parent().unwrap_or(&absolute).to_path_buf() };
        let Some(repo) = Repo::discover(&dir) else {
            writeln!(err, "error: {} is not inside a git repository", path.display())?;
            return Ok(LOAD_ERROR);
        };
        let spec = repo.root.join(repo.relative(&absolute).unwrap_or_default());
        match groups.iter_mut().find(|(known, _)| *known == repo) {
            Some((_, specs)) => specs.push(spec),
            None => groups.push((repo, vec![spec])),
        }
    }
    let mut files: Vec<(scan::Change, Baseline)> = Vec::new();
    let mut removed_text = String::new();
    for (repo, specs) in groups {
        match repo.changes(&request.base, request.fix) {
            Ok((changes, removed)) => {
                removed_text.push_str(&removed);
                for (path, baseline) in changes {
                    if specs.iter().any(|spec| path.starts_with(spec))
                        && !files.iter().any(|(known, _)| known.path == path)
                        && let Some(change) = scan::Change::read(path, &baseline)
                    {
                        files.push((change, baseline));
                    }
                }
            }
            Err(error) => {
                writeln!(err, "error: {error:#}")?;
                return Ok(LOAD_ERROR);
            }
        }
    }
    let engine = Engine { settings, rules: &rules, scope: request.scope, display: &cwd, attributes: Attributes::Worktree };
    let mut findings = engine.lint(files.iter().map(|(change, _)| change));
    if request.fix {
        let fixed = fix_worktree(&mut files, &findings, &removed_text, err)?;
        if fixed > 0 {
            findings = engine.lint(files.iter().map(|(change, _)| change));
        }
    }
    if request.json {
        writeln!(out, "{}", serde_json::json!({ "version": 1, "findings": findings }))?;
    } else {
        write!(out, "{}", text(&findings))?;
    }
    Ok(if findings.iter().any(|finding| finding.severity == Severity::Error) { 1 } else { 0 })
}

pub fn text(findings: &[Finding]) -> String {
    let mut text = String::new();
    for finding in findings {
        text.push_str(&format!(
            "{}:{}:{} {} {}: {}\n    {}\n",
            finding.path,
            finding.line,
            finding.column,
            finding.severity.as_str(),
            finding.rule,
            finding.message,
            finding.snippet.trim()
        ));
    }
    text
}

fn fix_worktree(files: &mut Vec<(scan::Change, Baseline)>, findings: &[Finding], removed_text: &str, err: &mut dyn Write) -> Result<usize> {
    let fixable = |finding: &&Finding| finding.severity == Severity::Error && finding.fix.is_some();
    let mut repos = Repos::default();
    let mut by_repo: Vec<(Repo, Vec<PathBuf>)> = Vec::new();
    for (change, _) in files.iter().filter(|(change, _)| findings.iter().filter(fixable).any(|finding| finding.file == change.path)) {
        let Some(repo) = repos.of(&change.path) else { continue };
        let Some(rel) = repo.relative(&change.path) else { continue };
        match by_repo.iter_mut().find(|(known, _)| *known == repo) {
            Some((_, rels)) => rels.push(rel),
            None => by_repo.push((repo, vec![rel])),
        }
    }
    let mut eligible: HashMap<PathBuf, (&Repo, PathBuf)> = HashMap::new();
    for (repo, rels) in &by_repo {
        let filtered = repo.filtered(rels, &Attributes::Worktree)?;
        let flagged = repo.flagged(rels, None);
        eligible.extend(rels.iter().filter(|rel| !filtered.contains(*rel) && !flagged.contains(*rel)).map(|rel| (repo.root.join(rel), (repo, rel.clone()))));
    }
    let mut removed = 0;
    let mut names = Vec::new();
    let mut restored: HashSet<PathBuf> = HashSet::new();
    for (change, baseline) in files.iter_mut() {
        let Some((repo, rel)) = eligible.get(&change.path) else { continue };
        let found: Vec<&Finding> = findings.iter().filter(fixable).filter(|finding| finding.file == change.path).collect();
        let (Some(first), Some(language)) = (found.first(), scan::language_of(&change.path)) else { continue };
        let single_link = std::fs::symlink_metadata(&change.path).is_ok_and(|meta| meta.is_file() && meta.nlink() == 1);
        if !single_link || fix::generated_or_vendored(rel, &change.source) {
            continue;
        }
        let ranges: Vec<Range<usize>> = found.iter().map(|finding| finding.bytes.clone()).collect();
        let head = repo.head().map(|head| repo.blob_at(&head, rel)).transpose()?.flatten().map(|blob| String::from_utf8_lossy(&blob).into_owned());
        let prior = fix::Prior { file: head.as_deref(), removed: removed_text };
        let Some(fixed) = fix::remove_new_plain_comments(language, &change.source, &ranges, &prior) else { continue };
        if std::fs::read_to_string(&change.path).ok().as_deref() != Some(change.source.as_str()) {
            writeln!(err, "ai-stack lint: {} changed while it was checked, so it was left alone", first.path)?;
            continue;
        }
        std::fs::OpenOptions::new().write(true).truncate(true).open(&change.path)?.write_all(fixed.text.as_bytes())?;
        removed += fixed.removed.len();
        names.push(first.path.clone());
        match scan::Change::new(change.path.clone(), fixed.text, baseline) {
            Some(rescanned) => *change = rescanned,
            None => {
                restored.insert(change.path.clone());
            }
        }
    }
    files.retain(|(change, _)| !restored.contains(&change.path));
    if removed > 0 {
        writeln!(err, "ai-stack lint: removed {removed} comment{} in {}", if removed == 1 { "" } else { "s" }, names.join(", "))?;
    }
    Ok(removed)
}

pub fn skips(state_dir: &Path, days: u32, now: u64, out: &mut dyn Write) -> Result<i32> {
    let since = now.saturating_sub(u64::from(days) * 24 * 60 * 60);
    let events: Vec<events::Event> = Log::new(state_dir).read().into_iter().filter(|event| event.time >= since).collect();
    let mut repos: Vec<&Path> = events.iter().map(|event| event.repo.as_path()).collect();
    repos.sort();
    repos.dedup();
    let commits: u32 = repos.iter().map(|repo| events::Rate::of(&events, repo, since).commits).sum();
    writeln!(out, "{commits} agent commits in {} repositories in the last {days} days", repos.len())?;
    repos.retain(|repo| events.iter().any(|event| event.repo == *repo && event.kind != events::Kind::Checked));
    for repo in repos {
        let mine: Vec<&events::Event> = events.iter().filter(|event| event.repo == repo).collect();
        let rate = events::Rate::of(&events, repo, since);
        let count = |kind| mine.iter().filter(|event| event.kind == kind).count();
        writeln!(out, "{}: {} commits, {} skips, {} bypasses", repo.display(), rate.commits, count(events::Kind::Skip), count(events::Kind::Bypassed))?;
        let flagged: Vec<&&events::Event> = mine.iter().filter(|event| event.kind != events::Kind::Checked).collect();
        let mut rules: BTreeMap<String, usize> = BTreeMap::new();
        let mut harnesses: BTreeMap<String, usize> = BTreeMap::new();
        for event in &flagged {
            for finding in &event.findings {
                *rules.entry(finding.rsplit(' ').next().unwrap_or_default().to_string()).or_default() += 1;
            }
            *harnesses.entry(event.harness.clone().unwrap_or_else(|| "unknown".into())).or_default() += 1;
        }
        let tally = |counts: &BTreeMap<String, usize>| counts.iter().map(|(name, count)| format!("{name} {count}")).collect::<Vec<_>>().join(", ");
        if !rules.is_empty() {
            writeln!(out, "  rules: {}", tally(&rules))?;
        }
        if !harnesses.is_empty() {
            writeln!(out, "  harnesses: {}", tally(&harnesses))?;
        }
        for event in flagged {
            let when = time::OffsetDateTime::from_unix_timestamp(i64::try_from(event.time).unwrap_or(0)).map(|at| at.date().to_string()).unwrap_or_default();
            let what = match event.kind {
                events::Kind::Skip => format!("skip: {}", event.reason.as_deref().unwrap_or_default()),
                _ => "bypassed the check".to_string(),
            };
            writeln!(out, "  {when} {} {} {what} [{}]", event.harness.as_deref().unwrap_or("unknown"), event.head.as_deref().map_or("", |head| &head[..head.len().min(12)]), event.findings.join(", "))?;
        }
    }
    Ok(0)
}

#[derive(Serialize)]
struct Listed {
    id: String,
    language: String,
    severity: Option<Severity>,
    source: String,
}

pub fn list(settings: &Settings, json: bool, out: &mut dyn Write, err: &mut dyn Write) -> Result<i32> {
    let rules = match settings.rules() {
        Ok(rules) => rules,
        Err(error) => {
            writeln!(err, "error: {error:#}")?;
            return Ok(LOAD_ERROR);
        }
    };
    let repo = Repo::discover(&std::env::current_dir()?);
    let policy = settings.policy(repo.as_ref());
    let mut listed: Vec<Listed> = rules
        .rules
        .iter()
        .map(|rule| Listed {
            id: rule.key.id.clone(),
            language: rule.key.language.to_string(),
            severity: policy.severity(&rule.key.id, rule.base, rule.default_off),
            source: rule.source.to_string_lossy().into_owned(),
        })
        .collect();
    listed.push(Listed { id: scan::TEST_FILE_NAMES.into(), language: "path".into(), severity: policy.severity(scan::TEST_FILE_NAMES, Some(Severity::Error), false), source: "built in".into() });
    listed.sort_by(|a, b| (&a.id, &a.language).cmp(&(&b.id, &b.language)));
    if json {
        writeln!(out, "{}", serde_json::to_string(&listed)?)?;
    } else {
        for rule in &listed {
            writeln!(out, "{}  {}  {}  {}", rule.id, rule.language, rule.severity.map_or("off", Severity::as_str), rule.source)?;
        }
        writeln!(out, "{} rule(s) for {} project", listed.len(), repo.map_or_else(|| "no".to_string(), |repo| repo.project_key.display().to_string()))?;
    }
    Ok(0)
}

#[cfg(test)]
pub(crate) mod tests {
    use std::os::unix::ffi::OsStrExt as _;
    use std::process::Command;

    use super::*;
    use crate::config::{LintProject, LintSection, Stack};

    pub(crate) fn git(dir: &Path, args: &[&str]) {
        let config = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main"];
        let output = Command::new("git").args(config).args(args).current_dir(dir).output().unwrap();
        assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    }

    pub(crate) fn put(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    pub(crate) fn settings(home: &Path, section: LintSection) -> Settings {
        let stack = Stack {
            path: Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf(),
            configured: String::new(),
            remote: "origin".into(),
            branch: "main".into(),
            legacy_paths: Vec::new(),
        };
        Settings::new(section, &stack, &home.join(".config/ai-stack"), home).unwrap()
    }

    fn lint(settings: &Settings, path: &Path, base: &str, scope: Option<Scope>) -> (i32, Vec<(String, u32, String)>) {
        lint_from(settings, Path::new("/"), vec![path.to_path_buf()], base, scope)
    }

    fn lint_from(settings: &Settings, cwd: &Path, paths: Vec<PathBuf>, base: &str, scope: Option<Scope>) -> (i32, Vec<(String, u32, String)>) {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run(settings, Request { cwd: cwd.to_path_buf(), paths, base: base.into(), scope, json: true, fix: false }, &mut out, &mut err).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&out).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&err)));
        let findings = value["findings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|finding| {
                let name = Path::new(finding["path"].as_str().unwrap()).file_name().unwrap().to_string_lossy().into_owned();
                (name, finding["line"].as_u64().unwrap() as u32, finding["rule"].as_str().unwrap().to_string())
            })
            .collect();
        (code, findings)
    }

    fn found(name: &str, line: u32, rule: &str) -> (String, u32, String) {
        (name.to_string(), line, rule.to_string())
    }

    #[test]
    fn cli_lints_only_what_changed_widens_on_request_and_owns_only_what_a_rename_or_removal_changed() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let settings = settings(&root.join("home"), LintSection::default());
        let repo = root.join("repo");
        put(&repo.join("a.ts"), "// legacy prose\nexport const a = 1;\n");
        put(&repo.join("legacy.spec.ts"), "// legacy\nexport {};\n");
        put(&repo.join("c.ts"), "// legacy\nexport function f() {\n  // kept\n  return 1;\n}\n");
        put(&repo.join("d.ts"), "// legacy d\nexport const d = 1;\n");
        put(&repo.join("gone.ts"), "// legacy gone\nexport const gone = 1;\n");
        let legacy: String = std::iter::once("// legacy prose a human wrote\n".to_string()).chain((1..=10).map(|n| format!("export const v{n} = {n};\n"))).collect();
        put(&repo.join("src/old.ts"), &legacy);
        put(&repo.join("h.ts"), "export const h = 1;\n");
        put(&repo.join("keep.ts"), "// pre-existing\nexport const k = 1;\n");
        git(&repo, &["init", "-q"]);
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-qm", "base"]);
        git(&repo, &["mv", "a.ts", "b.ts"]);
        git(&repo, &["mv", "legacy.spec.ts", "moved.spec.ts"]);
        std::fs::rename(repo.join("d.ts"), repo.join("e.spec.ts")).unwrap();
        std::os::unix::fs::symlink("c.ts", repo.join("alias.ts")).unwrap();
        put(&repo.join("c.ts"), "// legacy\nexport function f() {\n  // kept\n  return 2;\n}\n");
        put(&repo.join("gone.ts"), "// legacy gone\n");
        put(&repo.join("new.spec.ts"), "export const n = 1; // agent prose\n");
        put(&repo.join("empty.spec.ts"), "");
        std::fs::write(repo.join(std::ffi::OsStr::from_bytes(b"test-\xff.py")), "# agent prose\n").unwrap();
        std::fs::remove_file(repo.join("src/old.ts")).unwrap();
        put(&repo.join("src/new.ts"), &legacy.replace("v5 = 5;", "v5 = 50;"));
        std::fs::rename(repo.join("h.ts"), repo.join("h1.spec.ts")).unwrap();
        std::fs::copy(repo.join("h1.spec.ts"), repo.join("h2.spec.ts")).unwrap();
        git(&repo, &["rm", "-q", "--cached", "keep.ts"]);
        put(&repo.join("keep.ts"), "// pre-existing\nexport const k = 2;\n");

        let (code, lines) = lint(&settings, &repo, "HEAD", None);
        let (copies, lines): (Vec<_>, Vec<_>) = lines.into_iter().partition(|(name, ..)| name.starts_with("h"));
        assert!(matches!(&copies[..], [(_, 1, rule)] if rule == "test-file-names"), "one deleted file exempts only one of its copies: {copies:?}");
        for copy in ["h1.spec.ts", "h2.spec.ts"] {
            let alone = lint(&settings, &repo.join(copy), "HEAD", None).1;
            assert_eq!(alone, copies.iter().filter(|(name, ..)| name == copy).cloned().collect::<Vec<_>>(), "renames pair over the whole repository before PATH narrows it");
        }
        assert_eq!(lines, [
            found("empty.spec.ts", 1, "test-file-names"),
            found("new.spec.ts", 1, "test-file-names"),
            found("new.spec.ts", 1, "no-comments"),
            found("test-\u{fffd}.py", 1, "no-comments"),
        ]);
        assert_eq!(code, 1);
        assert_eq!(lint(&settings, &repo.join("gone.ts"), "HEAD", Some(Scope::File)).1, [found("gone.ts", 1, "no-comments")], "a file whose edit only deleted lines is scanned whole");
        let request = |path: PathBuf, base: &str| Request { cwd: root.clone(), paths: vec![path], base: base.into(), scope: None, json: true, fix: false };
        for bad in [request(repo.join("missing.ts"), "HEAD"), request(repo.clone(), "absent")] {
            assert_eq!(run(&settings, bad, &mut Vec::new(), &mut Vec::new()).unwrap(), LOAD_ERROR);
        }
        let fresh = root.join("fresh");
        put(&fresh.join("staged.ts"), "export const s = 1; // staged prose\n");
        git(&fresh, &["init", "-q"]);
        git(&fresh, &["add", "-A"]);
        put(&fresh.join("untracked.ts"), "// untracked prose\n");
        assert_eq!(lint(&settings, &fresh, "HEAD", None), (1, vec![found("staged.ts", 1, "no-comments"), found("untracked.ts", 1, "no-comments")]), "a repository with no commit lints its files as new");
        let (_, function) = lint(&settings, &repo.join("c.ts"), "HEAD", Some(Scope::Function));
        assert_eq!(function, [found("c.ts", 3, "no-comments")]);
        let (_, file) = lint(&settings, &repo.join("c.ts"), "HEAD", Some(Scope::File));
        assert_eq!(file, [found("c.ts", 1, "no-comments"), found("c.ts", 3, "no-comments")]);
        let (code, none) = lint(&settings, &repo.join("b.ts"), "HEAD", Some(Scope::Function));
        assert_eq!((code, none), (0, vec![]));
    }

    #[test]
    fn cli_lints_the_whole_repository_by_default_and_follows_changed_submodules() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let settings_with = settings;
        let settings = settings_with(&root.join("home"), LintSection::default());
        let upstream = root.join("upstream");
        put(&upstream.join("a.ts"), "export {};\n");
        git(&upstream, &["init", "-q"]);
        git(&upstream, &["add", "-A"]);
        git(&upstream, &["commit", "-qm", "base"]);
        let repo = root.join("repo");
        put(&repo.join("web/w.ts"), "export const w = 1;\n");
        put(&repo.join("cli/c.ts"), "export const c = 1;\n");
        git(&repo, &["init", "-q"]);
        for name in ["vendorlib", "oldlib"] {
            git(&repo, &["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream.to_str().unwrap(), name]);
        }
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-qm", "base"]);
        put(&repo.join("web/w.ts"), "export const w = 2; // prose in web\n");
        put(&repo.join("vendorlib/a.ts"), "export {}; // edited in the submodule\n");
        git(&repo, &["rm", "-q", "oldlib"]);

        let both = (1, vec![found("a.ts", 1, "no-comments"), found("w.ts", 1, "no-comments")]);
        assert_eq!(lint_from(&settings, &repo.join("cli"), Vec::new(), "HEAD", None), both, "from a subdirectory with no PATH");
        assert_eq!(lint_from(&settings, &repo, vec![repo.join("vendorlib")], "HEAD", None), (1, vec![found("a.ts", 1, "no-comments")]));

        put(&upstream.join("a.ts"), "export {}; // older prose\n");
        git(&upstream, &["commit", "-qam", "older"]);
        let older = String::from_utf8(Command::new("git").args(["rev-parse", "HEAD"]).current_dir(&upstream).output().unwrap().stdout).unwrap();
        put(&upstream.join("a.ts"), "export {};\n");
        git(&upstream, &["commit", "-qam", "newer"]);
        let rolled = root.join("rolled");
        std::fs::create_dir_all(&rolled).unwrap();
        git(&rolled, &["init", "-q"]);
        git(&rolled, &["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream.to_str().unwrap(), "lib"]);
        git(&rolled, &["commit", "-qm", "records the newer commit"]);
        git(&rolled.join("lib"), &["checkout", "-q", older.trim()]);
        assert_eq!(lint(&settings, &rolled, "HEAD", None), (1, vec![found("a.ts", 1, "no-comments")]), "a submodule's baseline is the commit its parent records");

        let primary = root.join("primary");
        std::fs::create_dir_all(&primary).unwrap();
        git(&primary, &["init", "-q", "--separate-git-dir", root.join("store").to_str().unwrap()]);
        put(&primary.join("a.ts"), "export {};\n");
        git(&primary, &["add", "-A"]);
        git(&primary, &["commit", "-qm", "base"]);
        git(&primary, &["worktree", "add", "-q", "-b", "second", root.join("secondary").to_str().unwrap()]);
        let off = LintProject { path: primary.to_string_lossy().into_owned(), paths: Default::default(), ignore: Vec::new(), scope: None, enabled: Some(false) };
        let off = settings_with(&root.join("home"), LintSection { project: vec![off], ..LintSection::default() });
        for checkout in [primary.clone(), root.join("secondary")] {
            put(&checkout.join("a.ts"), "export {}; // new\n");
            assert_eq!(lint(&settings, &checkout, "HEAD", None).0, 1);
            assert_eq!(lint(&off, &checkout, "HEAD", None), (0, vec![]), "a project set by its main checkout covers {}", checkout.display());
        }
    }

    #[test]
    fn allowances_excuse_exactly_the_bytes_they_match() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let home = root.join("home");
        let rule = "id: console-local\nlanguage: TypeScript\nmessage: use the logger\nseverity: error\nmetadata:\n  allow_in: 'console.log\\(1\\)'\nrule:\n  pattern: console.log($A)\n";
        put(&home.join(".config/ai-stack/lint/rules/console.yml"), rule);
        let settings = settings(&home, LintSection::default());
        let repo = root.join("repo");
        put(&repo.join("a.ts"), "console.log(1); console.log(2);\nconsole.log(3);\n");
        put(&repo.join("script.py"), "# /// script\r\n# requires-python = \">=3.11\"\r\n# ///\r\nprint(42)\r\n");
        git(&repo, &["init", "-q"]);
        assert_eq!(lint(&settings, &repo, "HEAD", None), (1, vec![found("a.ts", 1, "console-local"), found("a.ts", 2, "console-local")]));
    }

    #[test]
    fn base_is_the_merge_base_so_lines_the_other_branch_changed_are_not_owned() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let settings = settings(&root.join("home"), LintSection::default());
        let repo = root.join("repo");
        put(&repo.join("x.ts"), "// one\nconst a = 1;\nconst b = 2;\n");
        git(&repo, &["init", "-q"]);
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-qm", "base"]);
        git(&repo, &["switch", "-qc", "feature"]);
        put(&repo.join("x.ts"), "// one\nconst a = 1;\nconst b = 3; // feature\n");
        git(&repo, &["commit", "-qam", "feature"]);
        git(&repo, &["switch", "-q", "main"]);
        put(&repo.join("x.ts"), "const a = 1;\nconst b = 2;\n");
        git(&repo, &["commit", "-qam", "main moves on"]);
        git(&repo, &["switch", "-q", "feature"]);
        assert_eq!(lint(&settings, &repo, "main", None).1, [found("x.ts", 3, "no-comments")]);
    }

    #[test]
    fn project_settings_follow_the_main_checkout_into_linked_worktrees() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let repo = root.join("repo");
        put(&repo.join("README"), "x\n");
        git(&repo, &["init", "-q"]);
        git(&repo, &["add", "-A"]);
        git(&repo, &["commit", "-qm", "base"]);
        git(&repo, &["worktree", "add", "-q", "-b", "agent", root.join("worktree").to_str().unwrap()]);
        let worktree = root.join("worktree");
        put(&worktree.join("cli/a.ts"), "export const a = 1; // owned code\n");
        put(&worktree.join("plugins/b.ts"), "export const b = 1; // upstream code\n");
        let project = LintProject {
            path: repo.to_string_lossy().into_owned(),
            paths: [("no-comments".to_string(), vec!["cli/**".to_string()])].into(),
            ignore: Vec::new(),
            scope: None,
            enabled: None,
        };
        let scoped = settings(&root.join("home"), LintSection { project: vec![project.clone()], ..LintSection::default() });
        assert_eq!(lint(&scoped, &worktree, "HEAD", None).1, [found("a.ts", 1, "no-comments")]);
        let off = settings(&root.join("home"), LintSection { project: vec![LintProject { enabled: Some(false), ..project }], ..LintSection::default() });
        assert_eq!(lint(&off, &worktree, "HEAD", None), (0, vec![]));
    }
}
