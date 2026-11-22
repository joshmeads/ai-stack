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

pub use hook::{HookEvent, config_error as hook_config_error, run as run_hook};
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
    #[serde(skip)]
    pub text: String,
    #[serde(skip)]
    pub occurrence: usize,
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
    let mut files: Vec<scan::Change> = Vec::new();
    for (repo, specs) in groups {
        match repo.changes(&request.base) {
            Ok(changes) => {
                for (path, baseline) in changes {
                    if specs.iter().any(|spec| path.starts_with(spec))
                        && !files.iter().any(|known| known.path == path)
                        && let Some(change) = scan::Change::read(path, &baseline)
                    {
                        files.push(change);
                    }
                }
            }
            Err(error) => {
                writeln!(err, "error: {error:#}")?;
                return Ok(LOAD_ERROR);
            }
        }
    }
    let engine = Engine { settings, rules: &rules, scope: request.scope, display: &cwd };
    let findings = engine.lint(&files);
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
        git_with(dir, &[], args);
    }

    pub(crate) fn git_dated(dir: &Path, date: &str, args: &[&str]) {
        git_with(dir, &[("GIT_AUTHOR_DATE", date), ("GIT_COMMITTER_DATE", date)], args);
    }

    fn git_with(dir: &Path, env: &[(&str, &str)], args: &[&str]) {
        let config = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main"];
        let output = Command::new("git").args(config).args(args).envs(env.iter().copied()).current_dir(dir).output().unwrap();
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
        let code = run(settings, Request { cwd: cwd.to_path_buf(), paths, base: base.into(), scope, json: true }, &mut out, &mut err).unwrap();
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
        let request = |path: PathBuf, base: &str| Request { cwd: root.clone(), paths: vec![path], base: base.into(), scope: None, json: true };
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
