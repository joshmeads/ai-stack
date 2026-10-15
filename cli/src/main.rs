mod blocks;
mod config;
mod exec;
mod fleet;
mod install;
mod manifest;
mod models;
mod paths;
mod plan;
mod plugins;
mod render;
mod skills;
mod tui;

use std::fs;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, anyhow, bail};
use clap::{Parser, Subcommand};

use crate::config::{Config, Provider, Stack};
use crate::install::Options;
use crate::models::{ModelReport, Status};
use crate::plan::Plan;
use crate::plugins::SystemRunner;

#[derive(Parser)]
#[command(name = "ai-stack", version, about = "Install and update the jm:stack agent configuration")]
struct Cli {
    /// Config file (default: <home>/.config/ai-stack/config.toml).
    #[arg(long, global = true, value_name = "PATH")]
    config: Option<PathBuf>,
    /// Home directory (default: $HOME).
    #[arg(long, global = true, value_name = "DIR")]
    home: Option<PathBuf>,
    /// Stack checkout to use instead of `stack.path` from the config.
    #[arg(long, global = true, value_name = "DIR")]
    stack: Option<PathBuf>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Write the default config file.
    Init {
        /// Overwrite an existing config file.
        #[arg(long)]
        force: bool,
    },
    /// Print the install plan with diffs. Runs only the harness CLIs' read-only `plugin list`
    /// queries. Exit 0 when nothing would change, 1 otherwise.
    Diff {
        /// Also plan moving non-kept skills into the backup and removing non-kept plugins.
        #[arg(long)]
        clean: bool,
    },
    /// Count the skills and plugins that `--clean` would move or remove. Read-only, like `diff`.
    Stray {
        /// Print `{"skills":N,"plugins":M,"skill_names":[...],"plugin_ids":[...]}` on one line.
        #[arg(long)]
        json: bool,
    },
    /// Review the install plan and apply it.
    Install {
        /// Apply without review.
        #[arg(long)]
        yes: bool,
        /// Replace an unmanaged model sheet (backed up first).
        #[arg(long)]
        force: bool,
        /// Print the plan instead of opening the review screen.
        #[arg(long)]
        plain: bool,
        /// Move skills not in [clean] keep_skills into the backup and remove plugins not in
        /// [clean] keep_plugins.
        #[arg(long)]
        clean: bool,
    },
    /// Pull the stack checkout (it must be on the branch pulled), check models, then install.
    Update {
        /// Apply without review.
        #[arg(long)]
        yes: bool,
        /// Print the plan instead of opening the review screen.
        #[arg(long)]
        plain: bool,
        /// Bump configured models to newer versions in the same family.
        #[arg(long)]
        bump_models: bool,
        /// Pull this branch instead of `stack.branch` for this run. The config is not changed.
        #[arg(long, value_name = "BRANCH")]
        branch: Option<String>,
    },
    /// Report configured models against the provider catalogs.
    Models {
        /// Rewrite config model IDs to the newest version in the same family.
        #[arg(long)]
        bump: bool,
    },
    /// Skills vendored from external git repos, recorded in <stack>/manifest.toml.
    Skills {
        #[command(subcommand)]
        command: SkillsCommand,
    },
    /// Machines in <config dir>/fleet.toml that stack updates are pushed to.
    Fleet {
        #[command(subcommand)]
        command: FleetCommand,
    },
}

#[derive(Subcommand)]
enum FleetCommand {
    /// Write a commented fleet.toml template beside the config file.
    Init {
        /// Overwrite an existing fleet file.
        #[arg(long)]
        force: bool,
    },
    /// Print each machine's stack branch and commit against that branch's remote tip. Exit 0
    /// when every machine is current.
    Status,
    /// Run `<bin> update --yes --plain --branch <B>` on every enabled machine.
    Update {
        /// Run the commands; without it they are only printed.
        #[arg(long)]
        yes: bool,
        /// Branch to pull everywhere (default: each machine's current branch).
        #[arg(long, value_name = "BRANCH")]
        branch: Option<String>,
    },
    /// Fetch and check out BRANCH in the stack checkout, then update, on the named machines.
    Switch {
        branch: String,
        /// Machines to switch (default: every enabled machine).
        machines: Vec<String>,
        /// Run the commands; without it they are only printed.
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Subcommand)]
enum SkillsCommand {
    /// Vendor a skill directory from a git repo and record it in the manifest.
    Add {
        /// Git URL or path of the upstream repo. A local path is stored as its absolute path.
        source: String,
        /// Directory of the skill inside the upstream repo, or `.` for the repo root.
        path: String,
        /// Upstream branch or tag to track (or a 40-hex commit to pin). To test another
        /// upstream branch later, run `skills update --ref <branch> <name>`.
        #[arg(long = "ref", value_name = "REF", default_value = manifest::DEFAULT_REF)]
        git_ref: String,
        /// Parent directory inside the stack.
        #[arg(long, value_name = "DIR", default_value = manifest::DEFAULT_DEST)]
        dest: String,
        /// Install under this directory name and rewrite SKILL.md's `name:` to it.
        #[arg(long = "move", value_name = "NAME")]
        rename: Option<String>,
        /// Script run as `sh <script> <staged skill dir>` on every pull.
        #[arg(long, value_name = "PATH", conflicts_with = "process_prompt")]
        process_script: Option<String>,
        /// Prompt run through [skills] prompt_runner in the staged skill dir on every pull.
        #[arg(long, value_name = "TEXT")]
        process_prompt: Option<String>,
        /// Manifest name (default: the last component of PATH).
        #[arg(long)]
        name: Option<String>,
    },
    /// Compare each entry's commit with its upstream ref. Exit 0 when all are current.
    Status,
    /// Rebuild entries whose upstream moved. Exit 1 when any failed.
    Update {
        /// Entries to update, by name or installed name (default: all).
        names: Vec<String>,
        /// Retarget the named entries to this upstream branch or tag and record it as their `ref`.
        #[arg(long = "ref", value_name = "REF")]
        git_ref: Option<String>,
        /// Rebuild even when upstream has not moved, e.g. after editing a process step. Uses the
        /// pinned commit when the ref cannot be resolved.
        #[arg(long)]
        reprocess: bool,
        /// Replace an installed skill that has uncommitted changes.
        #[arg(long)]
        force: bool,
    },
}

/// Paths and overrides shared by every command.
struct Context {
    home: PathBuf,
    config_path: PathBuf,
    stack_override: Option<PathBuf>,
    /// The explicit `--config` / `--home` flags, for a local fleet machine.
    explicit_flags: Vec<String>,
}

/// Model catalogs fetched once per run. Errors are kept as text for the reports.
struct Catalogs {
    openai: Result<Vec<String>, String>,
    anthropic: Result<Vec<String>, String>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let ctx = resolve_context(&cli)?;
    let code = match cli.command {
        Commands::Init { force } => cmd_init(&ctx, force)?,
        Commands::Diff { clean } => cmd_diff(&ctx, clean)?,
        Commands::Stray { json } => cmd_stray(&ctx, json)?,
        Commands::Install { yes, force, plain, clean } => cmd_install(&ctx, yes, Options { force, clean }, plain)?,
        Commands::Update { yes, plain, bump_models, branch } => cmd_update(&ctx, yes, plain, bump_models, branch)?,
        Commands::Models { bump } => cmd_models(&ctx, bump)?,
        Commands::Skills { command } => cmd_skills(&ctx, command)?,
        Commands::Fleet { command } => cmd_fleet(&ctx, command)?,
    };
    io::stdout().flush()?;
    std::process::exit(code);
}

fn resolve_context(cli: &Cli) -> Result<Context> {
    let home = match &cli.home {
        Some(home) => home.clone(),
        None => std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| anyhow!("HOME is not set; pass --home"))?,
    };
    let config_path = cli
        .config
        .clone()
        .unwrap_or_else(|| home.join(".config/ai-stack/config.toml"));
    let mut explicit_flags = Vec::new();
    for (flag, value) in [("--config", &cli.config), ("--home", &cli.home)] {
        if let Some(value) = value {
            explicit_flags.extend([flag.to_string(), std::path::absolute(value)?.to_string_lossy().into_owned()]);
        }
    }
    Ok(Context { home: paths::normalize(&std::path::absolute(home)?), config_path, stack_override: cli.stack.clone(), explicit_flags })
}

fn load_config(ctx: &Context) -> Result<Config> {
    let mut cfg = config::load(&ctx.config_path, &ctx.home)?;
    if let Some(stack) = &ctx.stack_override {
        cfg.stack.configured = stack.to_string_lossy().into_owned();
        let configured = std::mem::replace(&mut cfg.stack.path, paths::absolute(&cfg.stack.configured, &ctx.home)?);
        // Links and hooks into the configured checkout are still ours to remove.
        cfg.stack.legacy_paths.push(configured);
    }
    Ok(cfg)
}

fn cmd_init(ctx: &Context, force: bool) -> Result<i32> {
    init_at(&ctx.config_path, config::default_config_text(), force)?;
    println!("Wrote {}", ctx.config_path.display());
    Ok(0)
}

/// Writes `text` to `path`, refusing to overwrite unless `force`.
fn init_at(path: &Path, text: &str, force: bool) -> Result<()> {
    if path.exists() && !force {
        bail!("{} already exists; pass --force to overwrite it", path.display());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("cannot create {}", parent.display()))?;
    }
    fs::write(path, text).with_context(|| format!("cannot write {}", path.display()))
}

fn cmd_diff(ctx: &Context, clean: bool) -> Result<i32> {
    let cfg = load_config(ctx)?;
    let plan = install::plan(&cfg, Options { clean, ..Options::default() }, &SystemRunner)?;
    print!("{}", plan.render_text(&ctx.home));
    Ok(if plan.is_empty() { 0 } else { 1 })
}

fn cmd_stray(ctx: &Context, json: bool) -> Result<i32> {
    let cfg = load_config(ctx)?;
    let stray = install::plan(&cfg, Options { clean: true, ..Options::default() }, &SystemRunner)?.stray(&ctx.home);
    if json {
        println!("{}", serde_json::to_string(&stray)?);
    } else {
        print!("{}", stray.text());
    }
    Ok(0)
}

fn cmd_install(ctx: &Context, yes: bool, opts: Options, plain: bool) -> Result<i32> {
    let cfg = load_config(ctx)?;
    install_flow(ctx, &cfg, opts, yes, plain, &[])
}

/// Builds the plan, then reviews, confirms and applies it. Returns the exit code.
fn install_flow(
    ctx: &Context,
    cfg: &Config,
    opts: Options,
    yes: bool,
    plain: bool,
    models: &[ModelReport],
) -> Result<i32> {
    let plan = install::plan(cfg, opts, &SystemRunner)?;
    if plan.is_empty() {
        for warning in &plan.warnings { println!("{warning}"); }
        println!("Nothing to install.");
        return Ok(0);
    }
    if !plan.conflicts.is_empty() {
        print!("{}", plan.render_text(&ctx.home));
        return Ok(1);
    }

    let approved = if yes {
        for warning in &plan.warnings { println!("{warning}"); }
        Some(plan)
    } else if plain || !io::stdout().is_terminal() {
        print!("{}", plan.render_text(&ctx.home));
        if !io::stdin().is_terminal() {
            println!("Re-run with --yes to apply.");
            return Ok(1);
        }
        confirm("Apply these changes? [y/N] ")?.then_some(plan)
    } else {
        // The review screen can toggle --clean, which re-plans.
        let mut replan = |clean| install::plan(cfg, Options { clean, ..opts }, &SystemRunner);
        tui::review(plan, opts.clean, models, &ctx.home, &mut replan)?
    };
    let Some(plan) = approved else {
        println!("Not applied.");
        return Ok(1);
    };
    apply_plan(ctx, &plan)
}

fn confirm(prompt: &str) -> Result<bool> {
    print!("{prompt}");
    io::stdout().flush()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line).context("cannot read the answer")?;
    Ok(matches!(line.trim().to_ascii_lowercase().as_str(), "y" | "yes"))
}

fn apply_plan(ctx: &Context, plan: &Plan) -> Result<i32> {
    let report = plan::apply(plan, &ctx.home.join(".local/state/ai-stack/backups"), &SystemRunner)?;
    println!("Applied {} change(s).", report.applied);
    if let Some(dir) = report.backup_dir {
        println!("Backups: {}", dir.display());
    }
    if let Some(manifest) = report.manifest {
        println!("Removed plugins and their reinstall commands: {}", manifest.display());
    }
    Ok(0)
}

fn cmd_update(ctx: &Context, yes: bool, plain: bool, bump: bool, branch: Option<String>) -> Result<i32> {
    let mut cfg = load_config(ctx)?;
    let mut stack = cfg.stack.clone();
    if let Some(branch) = branch {
        exec::check_branch(&branch)?;
        stack.branch = branch;
    }
    if git_pull(&exec::SystemExec, &stack)? {
        println!(
            "note: this pull changed files under cli/. The installed ai-stack binary is not rebuilt automatically; rebuild it with `cargo install --path {}`.",
            cfg.stack.path.join("cli").display()
        );
    }

    let catalogs = fetch_catalogs();
    let mut reports = check_models(&cfg, &catalogs);
    print_reports(&reports);
    if bump && bump_models(&ctx.config_path, &reports)? > 0 {
        cfg = load_config(ctx)?;
        reports = check_models(&cfg, &catalogs);
    }

    install_flow(ctx, &cfg, Options::default(), yes, plain, &reports)
}

/// Fast-forwards the stack checkout from its configured remote and branch, refusing when the
/// checkout is on another branch. Returns whether the pull changed any file under `cli/`.
fn git_pull(exec: &dyn exec::Exec, stack: &Stack) -> Result<bool> {
    let current = exec.run("git", &git_args(stack, &["symbolic-ref", "-q", "--short", "HEAD"]), None).map_err(|err| anyhow!("cannot run git: {err}"))?;
    let current = current.ok.then(|| current.stdout.trim().to_string()).filter(|branch| !branch.is_empty());
    match current {
        None => bail!(
            "{} is on a detached HEAD, not {}; run `git switch {}` there first",
            stack.path.display(),
            stack.branch,
            stack.branch
        ),
        Some(current) if current != stack.branch => bail!(
            "{} is on branch {current}, not {}; run `ai-stack update --branch {current}` to update it, or `git switch {}` there first",
            stack.path.display(),
            stack.branch,
            stack.branch
        ),
        Some(_) => {}
    }
    let before = git_head(exec, stack)?;
    print!("{}", exec::check(exec, "git", &git_args(stack, &["pull", "--ff-only", &stack.remote, &stack.branch]), None)?);
    let after = git_head(exec, stack)?;
    if before == after {
        return Ok(false);
    }
    let diff = exec::check(exec, "git", &git_args(stack, &["diff", "--name-only", &before, &after, "--", "cli"]), None)?;
    Ok(!diff.trim().is_empty())
}

fn git_head(exec: &dyn exec::Exec, stack: &Stack) -> Result<String> {
    Ok(exec::check(exec, "git", &git_args(stack, &["rev-parse", "HEAD"]), None)?.trim().to_string())
}

fn git_args(stack: &Stack, args: &[&str]) -> Vec<String> {
    ["-C".to_string(), stack.path.to_string_lossy().into_owned()].into_iter().chain(args.iter().map(|arg| arg.to_string())).collect()
}

fn cmd_skills(ctx: &Context, command: SkillsCommand) -> Result<i32> {
    let cfg = load_config(ctx)?;
    let skills = skills::Skills { exec: &exec::SystemExec, stack: &cfg.stack.path, prompt_runner: &cfg.prompt_runner };
    let mut out = io::stdout();
    match command {
        SkillsCommand::Add { source, path, git_ref, dest, rename, process_script, process_prompt, name } => {
            let process = match (process_script, process_prompt) {
                (Some(input), _) => vec![manifest::Step { kind: manifest::StepKind::Script, input }],
                (_, Some(input)) => vec![manifest::Step { kind: manifest::StepKind::Prompt, input }],
                _ => Vec::new(),
            };
            skills.add(skills::Add { source, path, git_ref, dest, rename, process, name }, &mut out)?;
            Ok(0)
        }
        SkillsCommand::Status => skills.status(&mut out),
        SkillsCommand::Update { names, git_ref, reprocess, force } => skills.update(skills::Update { names: &names, git_ref, reprocess, force }, &mut out),
    }
}

fn cmd_fleet(ctx: &Context, command: FleetCommand) -> Result<i32> {
    let path = ctx.config_path.with_file_name("fleet.toml");
    if let FleetCommand::Init { force } = command {
        init_at(&path, fleet::default_text(), force)?;
        println!("Wrote {}", path.display());
        return Ok(0);
    }
    let cfg = load_config(ctx)?;
    let self_bin = std::env::current_exe().context("cannot find this ai-stack binary")?.to_string_lossy().into_owned();
    let fleet = fleet::Fleet {
        exec: &exec::SystemExec,
        home: &ctx.home,
        local_stack: &cfg.stack.path,
        remote: &cfg.stack.remote,
        machines: fleet::load(&path, &cfg.stack.configured)?,
        self_bin: &self_bin,
        local_flags: &ctx.explicit_flags,
    };
    let mut out = io::stdout();
    match command {
        FleetCommand::Init { .. } => unreachable!("handled above"),
        FleetCommand::Status => fleet.status(&mut out),
        FleetCommand::Update { yes, branch } => fleet.update(branch.as_deref(), yes, &mut out),
        FleetCommand::Switch { branch, machines, yes } => fleet.switch(&branch, &machines, yes, &mut out),
    }
}

fn cmd_models(ctx: &Context, bump: bool) -> Result<i32> {
    let cfg = load_config(ctx)?;
    let catalogs = fetch_catalogs();
    let reports = check_models(&cfg, &catalogs);
    print_reports(&reports);
    if bump {
        bump_models(&ctx.config_path, &reports)?;
    }
    Ok(0)
}

fn fetch_catalogs() -> Catalogs {
    Catalogs {
        openai: models::openai_catalog().map_err(|e| format!("{e:#}")),
        anthropic: models::anthropic_catalog().map_err(|e| format!("{e:#}")),
    }
}

fn check_models(cfg: &Config, catalogs: &Catalogs) -> Vec<ModelReport> {
    models::check(
        cfg,
        catalogs.openai.as_deref().map_err(String::as_str),
        catalogs.anthropic.as_deref().map_err(String::as_str),
    )
}

fn print_reports(reports: &[ModelReport]) {
    for report in reports {
        println!(
            "{}  {}  {}  {}",
            report.alias,
            report.id,
            provider_name(report.provider),
            status_text(&report.status)
        );
    }
}

fn provider_name(provider: Provider) -> &'static str {
    match provider {
        Provider::Anthropic => "anthropic",
        Provider::Openai => "openai",
    }
}

fn status_text(status: &Status) -> String {
    match status {
        Status::Current => "current".to_string(),
        Status::Newer { latest } => format!("newer: {latest}"),
        Status::Missing => "missing".to_string(),
        Status::Unknown(reason) => format!("unknown: {reason}"),
    }
}

/// Rewrites every model with a newer version in the config file, in one write.
/// Returns how many models were bumped.
fn bump_models(config_path: &Path, reports: &[ModelReport]) -> Result<usize> {
    let newer: Vec<(&ModelReport, &str)> = reports
        .iter()
        .filter_map(|report| match &report.status {
            Status::Newer { latest } => Some((report, latest.as_str())),
            _ => None,
        })
        .collect();
    if newer.is_empty() {
        return Ok(0);
    }
    let mut text = fs::read_to_string(config_path)
        .with_context(|| format!("cannot read {}", config_path.display()))?;
    for (report, latest) in &newer {
        text = models::bump(&text, &report.alias, latest)?;
    }
    fs::write(config_path, text).with_context(|| format!("cannot write {}", config_path.display()))?;
    for (report, latest) in &newer {
        println!("bumped {}: {} -> {}", report.alias, report.id, latest);
    }
    Ok(newer.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_refuses_a_checkout_on_another_branch_or_detached() {
        use crate::exec::fake::{FakeExec, fail, ok};
        let stack = Stack { path: "/s".into(), configured: "/s".into(), remote: "origin".into(), branch: "main".into(), legacy_paths: Vec::new() };
        let exec = FakeExec::new(|line| if line.contains("symbolic-ref") { ok("test\n") } else { ok("") });
        let err = format!("{:#}", git_pull(&exec, &stack).unwrap_err());
        assert!(err.contains("on branch test, not main") && err.contains("ai-stack update --branch test") && err.contains("git switch main"), "{err}");
        assert_eq!(*exec.calls.borrow(), ["git -C /s symbolic-ref -q --short HEAD"]);

        let exec = FakeExec::new(|_| fail(""));
        assert!(format!("{:#}", git_pull(&exec, &stack).unwrap_err()).contains("detached HEAD"));

        let exec = FakeExec::new(|line| if line.contains("symbolic-ref") { ok("main\n") } else { ok("abc\n") });
        assert!(!git_pull(&exec, &stack).unwrap());
        assert!(exec.calls.borrow().contains(&"git -C /s pull --ff-only origin main".to_string()));
    }

    #[test]
    fn init_writes_default_config_and_refuses_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".config/ai-stack/config.toml");

        let text = config::default_config_text();
        init_at(&path, text, false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), text);

        let err = init_at(&path, text, false).unwrap_err();
        assert!(err.to_string().contains("--force"), "{err}");
        init_at(&path, text, true).unwrap();
    }
}
