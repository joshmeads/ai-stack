mod hook;
mod owned;
mod repo;
mod rules;
mod scan;
mod settings;

use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde::{Deserialize, Serialize};

pub use hook::{HookEvent, run as run_hook};
pub use owned::{Baseline, Owned};
pub use settings::Settings;

use repo::Repo;
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
}

pub fn settings(config_path: &Path, home: &Path, stack_override: Option<&Path>) -> Result<Settings> {
    let text = crate::config::read(config_path)?;
    let (stack, section) = crate::config::parse_lint(&text, home, stack_override).with_context(|| format!("reading [stack] and [lint] in {}", config_path.display()))?;
    let config_dir = config_path.parent().unwrap_or(Path::new("."));
    Settings::new(section, &stack, config_dir, home)
}

pub struct Request {
    pub paths: Vec<PathBuf>,
    pub base: String,
    pub scope: Option<Scope>,
    pub json: bool,
}

pub fn run(settings: &Settings, request: Request, out: &mut dyn Write, err: &mut dyn Write) -> Result<i32> {
    let rules = match settings.rules() {
        Ok(rules) => rules,
        Err(error) => {
            writeln!(err, "error: {error:#}")?;
            return Ok(LOAD_ERROR);
        }
    };
    let cwd = std::env::current_dir()?;
    let paths = if request.paths.is_empty() { vec![cwd.clone()] } else { request.paths };
    let mut groups: Vec<(Repo, Vec<PathBuf>)> = Vec::new();
    for path in paths {
        let absolute = crate::paths::normalize(&std::path::absolute(&path)?);
        if std::fs::symlink_metadata(&absolute).is_err() {
            writeln!(err, "error: {} does not exist", path.display())?;
            return Ok(LOAD_ERROR);
        }
        let dir = if absolute.is_dir() { absolute.clone() } else { absolute.parent().unwrap_or(&absolute).to_path_buf() };
        let Some(repo) = Repo::discover(&dir) else {
            writeln!(err, "error: {} is not inside a git repository", path.display())?;
            return Ok(LOAD_ERROR);
        };
        let rel = repo.relative(&absolute).unwrap_or_default();
        match groups.iter_mut().find(|(known, _)| *known == repo) {
            Some((_, specs)) => specs.push(rel),
            None => groups.push((repo, vec![rel])),
        }
    }
    let mut files = Vec::new();
    for (repo, specs) in groups {
        let wanted = |rel: &Path| scan::language_of(rel).is_some() && specs.iter().any(|spec| rel.starts_with(spec));
        match repo.changes(&request.base, wanted) {
            Ok(changes) => files.extend(changes.into_iter().map(|(rel, baseline)| (repo.root.join(rel), baseline))),
            Err(error) => {
                writeln!(err, "error: {error:#}")?;
                return Ok(LOAD_ERROR);
            }
        }
    }
    let engine = Engine { settings, rules: &rules, scope: request.scope, display: &cwd };
    let findings = engine.lint(files);
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
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = run(settings, Request { paths: vec![path.to_path_buf()], base: base.into(), scope, json: true }, &mut out, &mut err).unwrap();
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
    fn cli_lints_only_what_changed_widens_on_request_and_owns_nothing_a_rename_carried() {
        let tmp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(tmp.path()).unwrap();
        let settings = settings(&root.join("home"), LintSection::default());
        let repo = root.join("repo");
        put(&repo.join("a.ts"), "// legacy prose\nexport const a = 1;\n");
        put(&repo.join("legacy.spec.ts"), "// legacy\nexport {};\n");
        put(&repo.join("c.ts"), "// legacy\nexport function f() {\n  // kept\n  return 1;\n}\n");
        put(&repo.join("d.ts"), "// legacy d\nexport const d = 1;\n");
        put(&repo.join("gone.ts"), "// legacy gone\nexport const gone = 1;\n");
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

        let (code, lines) = lint(&settings, &repo, "HEAD", None);
        assert_eq!(lines, [
            found("empty.spec.ts", 1, "test-file-names"),
            found("new.spec.ts", 1, "test-file-names"),
            found("new.spec.ts", 1, "no-comments"),
            found("test-\u{fffd}.py", 1, "no-comments"),
        ]);
        assert_eq!(code, 1);
        assert_eq!(lint(&settings, &repo.join("gone.ts"), "HEAD", Some(Scope::File)).1, [found("gone.ts", 1, "no-comments")], "a file whose edit only deleted lines is scanned whole");
        for bad in [Request { paths: vec![repo.join("missing.ts")], base: "HEAD".into(), scope: None, json: true }, Request { paths: vec![repo.clone()], base: "absent".into(), scope: None, json: true }] {
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
