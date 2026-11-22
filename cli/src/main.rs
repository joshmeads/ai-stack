mod auth;
mod blocks;
mod config;
mod drift;
mod exec;
mod fleet;
mod groups;
mod incident;
mod install;
mod ledger;
mod links;
mod lint;
mod models;
mod paths;
mod plan;
mod plugins;
mod private;
mod render;
mod skills;
mod stackfile;
mod tui;

use std::fs;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result, anyhow, bail};
use clap::{Parser, Subcommand};

use crate::config::{Config, Harness, Stack};
use crate::install::Options;
use crate::models::{ModelReport, Status};
use crate::plan::Plan;
use crate::plugins::SystemRunner;

const REBUILD_NEEDED: i32 = 3;

#[derive(Parser)]
#[command(name = "ai-stack", version, about = "Install and update the pstack agent configuration")]
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
    /// Submit a confirmed material incident through an isolated small worker.
    Incident {
        #[command(subcommand)]
        command: IncidentCommand,
    },
    /// Print this machine's effective configuration.
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// Report local AI CLI login status.
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
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
    /// Report the stray skills (what `--clean` moves and what sits where a skill link goes) and
    /// the plugins `--clean` removes. Read-only, like `diff`.
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
        /// Replace an unmanaged model sheet, and move a stray skill in a skill link's way, each
        /// into the backup first.
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
    /// Exit 3 before checking models or installing if this pull changes cli/; rebuild and rerun.
    Update {
        /// Apply without review.
        #[arg(long)]
        yes: bool,
        /// Replace an unmanaged model sheet, and move a stray skill in a skill link's way, each
        /// into the backup first.
        #[arg(long)]
        force: bool,
        /// Print the plan instead of opening the review screen.
        #[arg(long)]
        plain: bool,
        /// Rewrite exact model IDs in the config as their families before updating.
        #[arg(long)]
        bump_models: bool,
        /// Pull this branch instead of `stack.branch` for this run. The config is not changed.
        #[arg(long, value_name = "BRANCH")]
        branch: Option<String>,
    },
    /// Report configured models against the provider catalogs. `newer: <id>` on a family means
    /// the stack's model registry lags the catalog; on a pinned id, the pin is behind.
    Models {
        /// Rewrite exact model IDs in [models.*] and [sheet.*] as their families, then report.
        #[arg(long)]
        bump: bool,
    },
    /// Skills vendored from external git repos, recorded in <stack>/stack.toml.
    Skills {
        #[command(subcommand)]
        command: SkillsCommand,
    },
    /// Each skill group in <stack>/stack.toml: global or not, its skills after includes, and
    /// an estimated token cost of their names and descriptions.
    Groups {
        /// Print the report as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Machines in <config dir>/fleet.toml that stack updates are pushed to.
    Fleet {
        #[command(subcommand)]
        command: FleetCommand,
    },
    /// The gitignored private/ folder (private/stack.toml and private/skills/), committed only
    /// as the age-encrypted private.age. Runs on the git repository of the current directory.
    Private {
        #[command(subcommand)]
        command: PrivateCommand,
    },
    /// Lint only the lines changed since the merge base with REV, using the ast-grep rules in
    /// <stack>/lint/rules and <config dir>/lint/rules. Exit 0 with no errors, 1 with errors, 2
    /// when the rules or the paths cannot be loaded.
    #[command(args_conflicts_with_subcommands = true)]
    Lint {
        #[command(subcommand)]
        command: Option<LintCommand>,
        /// Files or directories to lint (default: the repository of the current directory).
        paths: Vec<PathBuf>,
        /// Revision whose merge base with HEAD is the baseline.
        #[arg(long, value_name = "REV", default_value = "HEAD")]
        base: String,
        /// Widen the changed lines to their enclosing function or the whole file (default: [lint] scope).
        #[arg(long, value_enum)]
        scope: Option<lint::Scope>,
        /// Print `{"version":1,"findings":[...]}`.
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum LintCommand {
    /// List every loaded rule per language, its source file and its severity in this project.
    Rules {
        #[arg(long)]
        json: bool,
    },
    /// Agent hook entry point that `ai-stack install` registers: reads the hook payload on
    /// stdin, answers on stdout and always exits 0.
    Hook { harness: Harness, event: lint::HookEvent },
}

#[derive(Subcommand)]
enum PrivateCommand {
    /// Point this clone's git hooks at .githooks/, then open private.age.
    Init,
    /// Encrypt private/ into private.age for the keys in private.recipients, when it changed.
    Seal {
        /// Also stage private.age (the pre-commit hook passes this).
        #[arg(long)]
        stage: bool,
    },
    /// Decrypt private.age into private/ with the key from `fnox get AI_STACK_PRIVATE_KEY`.
    Open {
        /// Replace private/ even when it has changes that are not sealed.
        #[arg(long)]
        force: bool,
        /// Warn instead of failing (the checkout and merge hooks pass this).
        #[arg(long)]
        hook: bool,
    },
    /// Read pre-push ref lines on stdin and exit 1 when an outgoing commit holds a private/
    /// path, a private skill name or a word in private/guard.txt.
    Check,
}

#[derive(Subcommand)]
enum IncidentCommand {
    /// Create the shared private log if missing; preserve an existing log.
    Init,
    /// Record a delivered-code bug, substantially off-course work, or an evidenced recurring mistake.
    #[command(long_about = incident::HELP)]
    Record {
        /// JSON payload file, or - for stdin. Keep the saved payload for retries.
        #[arg(long, value_name = "PATH")]
        file: PathBuf,
    },
}

#[derive(Subcommand)]
enum ConfigCommand {
    Show {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum AuthCommand {
    /// Check installed AI CLIs without logging in or out.
    Status {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand)]
enum FleetCommand {
    /// Log in to an AI CLI on one fleet machine through this terminal.
    Login { machine: String, provider: String },
    /// Compare effective configuration with this machine.
    Drift {
        #[arg(long, value_name = "KEY")]
        ignore: Vec<String>,
        #[arg(long)]
        json: bool,
    },
    /// Report AI CLI login status on every enabled machine.
    Auth {
        #[arg(long)]
        json: bool,
    },
    /// Write a commented fleet.toml template beside the config file.
    Init {
        /// Overwrite an existing fleet file.
        #[arg(long)]
        force: bool,
    },
    /// Print each machine's stack branch and commit against that branch's remote tip. Exit 0
    /// when every machine is current.
    Status,
    /// Run `<bin> --stack <stack> update --yes --plain --branch <B>` on every enabled machine.
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
    /// Vendor a skill directory from a git repo into a group and record it in stack.toml.
    Add {
        /// Git URL or path of the upstream repo. A local path is stored as its absolute path.
        source: String,
        /// Directory of the skill inside the upstream repo, or `.` for the repo root.
        path: String,
        /// Upstream branch or tag to track (or a 40-hex commit to pin). To test another
        /// upstream branch later, run `skills update --ref <branch> <name>`.
        #[arg(long = "ref", value_name = "REF", default_value = stackfile::DEFAULT_REF)]
        git_ref: String,
        /// Existing group in stack.toml that the skill joins.
        #[arg(long, value_name = "GROUP")]
        group: String,
        /// Install under this directory name and rewrite SKILL.md's `name:` to it.
        #[arg(long = "move", value_name = "NAME", value_parser = skill_name)]
        rename: Option<stackfile::SkillName>,
        /// Script run as `sh <script> <staged skill dir>` on every pull.
        #[arg(long, value_name = "PATH", conflicts_with = "process_prompt")]
        process_script: Option<String>,
        /// Prompt run through [skills] prompt_runner in the staged skill dir on every pull.
        #[arg(long, value_name = "TEXT")]
        process_prompt: Option<String>,
        /// Entry name in stack.toml (default: the last component of PATH).
        #[arg(long, value_parser = skill_name)]
        name: Option<stackfile::SkillName>,
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

fn skill_name(text: &str) -> Result<stackfile::SkillName> {
    stackfile::SkillName::try_from(text)
}

struct Context {
    home: PathBuf,
    config_path: PathBuf,
    stack_override: Option<PathBuf>,
    explicit_flags: Vec<String>,
    hook_flags: Vec<String>,
}

struct Catalogs {
    openai: Result<Vec<String>, String>,
    anthropic: Result<Vec<String>, String>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let ctx = resolve_context(&cli)?;
    let code = match cli.command {
        Commands::Incident { command: IncidentCommand::Init } => incident::initialize(&load_config(&ctx)?),
        Commands::Incident { command: IncidentCommand::Record { file } } => incident::run(&load_config(&ctx)?, &file),
        Commands::Auth { command: AuthCommand::Status { json } } => {
            let status = auth::collect(&exec::SystemExec, &ctx.home, |name| std::env::var_os(name).map(PathBuf::from));
            auth::write_status(&status, json, auth::now(), &mut io::stdout())?;
            0
        },
        Commands::Config { command: ConfigCommand::Show { json } } => {
            write_config(ctx_flat(&ctx)?, json, &mut io::stdout())?;
            0
        },
        Commands::Init { force } => cmd_init(&ctx, force)?,
        Commands::Diff { clean } => cmd_diff(&ctx, clean)?,
        Commands::Stray { json } => cmd_stray(&ctx, json)?,
        Commands::Install { yes, force, plain, clean } => cmd_install(&ctx, yes, Options { force, clean, report: false }, plain)?,
        Commands::Update { yes, force, plain, bump_models, branch } => cmd_update(&ctx, yes, force, plain, bump_models, branch)?,
        Commands::Models { bump } => cmd_models(&ctx, bump)?,
        Commands::Skills { command } => cmd_skills(&ctx, command)?,
        Commands::Groups { json } => cmd_groups(&ctx, json)?,
        Commands::Fleet { command } => cmd_fleet(&ctx, command)?,
        Commands::Private { command } => cmd_private(&ctx, command)?,
        Commands::Lint { command, paths, base, scope, json } => cmd_lint(&ctx, command, lint::Request { cwd: std::env::current_dir()?, paths, base, scope, json })?,
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
    let home = paths::normalize(&std::path::absolute(home)?);
    let absolute = |path: &Path| std::path::absolute(path).map(|path| paths::normalize(&path));
    let env_home = std::env::var_os("HOME").map(|home| absolute(Path::new(&home))).transpose()?;
    let config = absolute(&config_path)?;
    let mut hook_flags = Vec::new();
    for (flag, value) in [
        ("--home", (env_home.as_ref() != Some(&home)).then(|| home.clone())),
        ("--config", (config != home.join(".config/ai-stack/config.toml")).then_some(config)),
        ("--stack", cli.stack.as_deref().map(absolute).transpose()?),
    ] {
        if let Some(value) = value {
            hook_flags.extend([flag.to_string(), value.to_string_lossy().into_owned()]);
        }
    }
    Ok(Context { home, config_path, stack_override: cli.stack.clone(), explicit_flags, hook_flags })
}

fn load_config(ctx: &Context) -> Result<Config> {
    let mut cfg = config::load(&ctx.config_path, &ctx.home, ctx.stack_override.as_deref())?;
    cfg.exe_flags = ctx.hook_flags.clone();
    let relative_stack = !cfg.stack.configured.starts_with('~') && Path::new(&cfg.stack.configured).is_relative();
    if relative_stack && ctx.stack_override.is_none() {
        cfg.exe_flags.extend(["--stack".to_string(), cfg.stack.path.to_string_lossy().into_owned()]);
    }
    Ok(cfg)
}

fn ctx_flat(ctx: &Context) -> Result<drift::Flat> {
    config::flat(&config::read(&ctx.config_path)?, &ctx.home, ctx.stack_override.as_deref())
}

fn write_config(flat: drift::Flat, json: bool, out: &mut dyn Write) -> Result<()> {
    if json {
        writeln!(out, "{}", serde_json::to_string(&flat)?)?;
    } else {
        for (key, value) in flat { writeln!(out, "{key} = {}", drift::value(Some(&value)))?; }
    }
    Ok(())
}

fn cmd_init(ctx: &Context, force: bool) -> Result<i32> {
    let detected = init_config_at(&ctx.config_path, force, &SystemRunner::detect())?;
    println!("Wrote {}", ctx.config_path.display());
    for (harness, available) in detected {
        let id = harness.as_str();
        let status = if available { "found" } else { "not found" };
        let suffix = if available { "" } else { "; it will be skipped until installed" };
        println!("{}: `{id}` {status} on PATH{suffix}", harness.name());
    }
    Ok(0)
}

fn init_config_at(path: &Path, force: bool, runner: &dyn plugins::Runner) -> Result<Vec<(Harness, bool)>> {
    let detected: Vec<_> = Harness::ALL.into_iter().map(|harness| (harness, runner.available(harness))).collect();
    init_at(path, config::default_config_text(), force)?;
    Ok(detected)
}

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
    let plan = install::plan(&cfg, Options { clean, ..Options::default() }, &SystemRunner::detect())?;
    print!("{}", plan.render_text(&ctx.home));
    Ok(if plan.is_empty() { 0 } else { 1 })
}

fn cmd_stray(ctx: &Context, json: bool) -> Result<i32> {
    let cfg = load_config(ctx)?;
    let plan = install::plan(&cfg, Options { clean: true, report: true, ..Options::default() }, &SystemRunner::detect())?;
    for warning in &plan.warnings { eprintln!("{warning}"); }
    let stray = plan.stray(&ctx.home);
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

fn install_flow(
    ctx: &Context,
    cfg: &Config,
    opts: Options,
    yes: bool,
    plain: bool,
    models: &[ModelReport],
) -> Result<i32> {
    let runner = SystemRunner::detect();
    let plan = install::plan(cfg, opts, &runner)?;
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
        let mut replan = |clean| install::plan(cfg, Options { clean, ..opts }, &runner);
        tui::review(plan, opts.clean, models, &ctx.home, &mut replan)?
    };
    let Some(plan) = approved else {
        println!("Not applied.");
        return Ok(1);
    };
    apply_plan(ctx, &plan, &runner)
}

fn confirm(prompt: &str) -> Result<bool> {
    print!("{prompt}");
    io::stdout().flush()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line).context("cannot read the answer")?;
    Ok(matches!(line.trim().to_ascii_lowercase().as_str(), "y" | "yes"))
}

fn apply_plan(ctx: &Context, plan: &Plan, runner: &dyn plugins::Runner) -> Result<i32> {
    let report = plan::apply(plan, &ctx.home.join(".local/state/ai-stack/backups"), runner)?;
    println!("Applied {} change(s).", report.applied);
    if let Some(dir) = report.backup_dir {
        println!("Backups: {}", dir.display());
    }
    if let Some(manifest) = report.manifest {
        println!("Removed plugins and their reinstall commands: {}", manifest.display());
    }
    Ok(0)
}

fn cmd_update(ctx: &Context, yes: bool, force: bool, plain: bool, bump: bool, branch: Option<String>) -> Result<i32> {
    let mut stack = config::parse(&config::read(&ctx.config_path)?, &ctx.home, ctx.stack_override.as_deref())?.stack().clone();
    if let Some(branch) = branch {
        exec::check_branch(&branch)?;
        stack.branch = branch;
    }
    if git_pull(&exec::SystemExec, &stack)? {
        println!(
            "note: this pull changed files under cli/. Nothing was installed. Rebuild with `cargo install --path {}`, then rerun the same command.",
            exec::shell_quote(&stack.path.join("cli").to_string_lossy())
        );
        return Ok(REBUILD_NEEDED);
    }
    if bump {
        bump_config(ctx)?;
    }
    let cfg = load_config(ctx)?;

    let catalogs = fetch_catalogs(&cfg);
    let reports = check_models(&cfg, &catalogs);
    print_reports(&reports);

    install_flow(ctx, &cfg, Options { force, ..Options::default() }, yes, plain, &reports)
}

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
        SkillsCommand::Add { source, path, git_ref, group, rename, process_script, process_prompt, name } => {
            let process = match (process_script, process_prompt) {
                (Some(input), _) => vec![stackfile::Step { kind: stackfile::StepKind::Script, input }],
                (_, Some(input)) => vec![stackfile::Step { kind: stackfile::StepKind::Prompt, input }],
                _ => Vec::new(),
            };
            skills.add(skills::Add { source, path, git_ref, rename, process, name, group }, &mut out)?;
            Ok(0)
        }
        SkillsCommand::Status => skills.status(&mut out),
        SkillsCommand::Update { names, git_ref, reprocess, force } => skills.update(skills::Update { names: &names, git_ref, reprocess, force }, &mut out),
    }
}

fn cmd_private(ctx: &Context, command: PrivateCommand) -> Result<i32> {
    let dir = match &ctx.stack_override {
        Some(stack) => stack.clone(),
        None => std::env::current_dir()?,
    };
    let private = private::Private::locate(&exec::SystemExec, &dir, private::fnox_key_command())?;
    let mut out = io::stdout();
    match command {
        PrivateCommand::Init => private.init(&mut out).map(|()| 0),
        PrivateCommand::Seal { stage } => private.seal(stage, &mut out).map(|()| 0),
        PrivateCommand::Open { force, hook } => match private.open(force, &mut out) {
            Ok(_) => Ok(0),
            Err(err) if hook => {
                eprintln!("warning: private.age was not opened: {err:#}");
                Ok(0)
            }
            Err(err) => Err(err),
        },
        PrivateCommand::Check => private.check(&mut io::stdin().lock(), &mut io::stderr()),
    }
}

fn cmd_lint(ctx: &Context, command: Option<LintCommand>, request: lint::Request) -> Result<i32> {
    let settings = lint::settings(&ctx.config_path, &ctx.home, ctx.stack_override.as_deref());
    if let Some(LintCommand::Hook { harness, event }) = command {
        let mut input = String::new();
        let reply = io::Read::read_to_string(&mut io::stdin(), &mut input).map_err(anyhow::Error::from).and_then(|_| match settings {
            Ok(settings) => lint::run_hook(harness, event, &settings, &input),
            Err(error) => Ok(lint::hook_config_error(&lint::state_dir(&ctx.home), event, &input, &error)),
        });
        match reply {
            Ok(Some(json)) => println!("{json}"),
            Ok(None) => {}
            Err(err) => eprintln!("ai-stack lint hook: {err:#}"),
        }
        return Ok(0);
    }
    let settings = match settings {
        Ok(settings) => settings,
        Err(err) => {
            eprintln!("error: {err:#}");
            return Ok(lint::LOAD_ERROR);
        }
    };
    let (mut out, mut err) = (io::stdout(), io::stderr());
    match command {
        Some(LintCommand::Rules { json }) => lint::list(&settings, json, &mut out, &mut err),
        _ => lint::run(&settings, request, &mut out, &mut err),
    }
}

fn cmd_groups(ctx: &Context, json: bool) -> Result<i32> {
    let cfg = load_config(ctx)?;
    let report = groups::report(&cfg.stack.path, &stackfile::load(&cfg.stack.path)?)?;
    if json {
        println!("{}", serde_json::to_string(&report)?);
    } else {
        print!("{}", report.text());
    }
    Ok(0)
}

fn cmd_fleet(ctx: &Context, command: FleetCommand) -> Result<i32> {
    let path = ctx.config_path.with_file_name("fleet.toml");
    if let FleetCommand::Init { force } = command {
        init_at(&path, fleet::default_text(), force)?;
        println!("Wrote {}", path.display());
        return Ok(0);
    }
    let stack = config::parse(&config::read(&ctx.config_path)?, &ctx.home, ctx.stack_override.as_deref())?.stack().clone();
    let self_bin = std::env::current_exe().context("cannot find this ai-stack binary")?.to_string_lossy().into_owned();
    let fleet = fleet::Fleet {
        exec: &exec::SystemExec,
        home: &ctx.home,
        local_stack: &stack.path,
        remote: &stack.remote,
        machines: fleet::load(&path, &stack.configured, matches!(command, FleetCommand::Login { .. }))?,
        self_bin: &self_bin,
        local_flags: &ctx.explicit_flags,
    };
    let mut out = io::stdout();
    match command {
        FleetCommand::Init { .. } => unreachable!("handled above"),
        FleetCommand::Login { machine, provider } => fleet.login(&machine, &provider, io::stdin().is_terminal() && io::stdout().is_terminal(), auth::now(), &mut out),
        FleetCommand::Status => fleet.status(&mut out),
        FleetCommand::Drift { ignore, json } => fleet.drift(&ctx_flat(ctx)?, &ignore, json, &mut out),
        FleetCommand::Auth { json } => fleet.auth(json, auth::now(), &mut out),
        FleetCommand::Update { yes, branch } => fleet.update(branch.as_deref(), yes, &mut out),
        FleetCommand::Switch { branch, machines, yes } => fleet.switch(&branch, &machines, yes, &mut out),
    }
}

fn cmd_models(ctx: &Context, bump: bool) -> Result<i32> {
    if bump {
        bump_config(ctx)?;
    }
    let cfg = load_config(ctx)?;
    let catalogs = fetch_catalogs(&cfg);
    print_reports(&check_models(&cfg, &catalogs));
    Ok(0)
}

fn fetch_catalogs(cfg: &Config) -> Catalogs {
    Catalogs {
        openai: models::openai_catalog(&cfg.codex_home).map_err(|e| format!("{e:#}")),
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
            report.provider.as_str(),
            status_text(&report.status)
        );
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

fn bump_config(ctx: &Context) -> Result<()> {
    let text = config::read(&ctx.config_path)?;
    let registry = config::Registry::load(&config::parse(&text, &ctx.home, ctx.stack_override.as_deref())?.stack().path)?;
    let bumped = models::bump(&text, &ctx.home, &registry)?;
    if bumped.changes.is_empty() {
        println!("bump: the config already names families");
        return Ok(());
    }
    fs::write(&ctx.config_path, bumped.text).with_context(|| format!("cannot write {}", ctx.config_path.display()))?;
    for change in &bumped.changes {
        println!("bumped {change}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fleet_login_requires_machine_and_provider() {
        assert!(matches!(Cli::try_parse_from(["ai-stack", "fleet", "login", "box", "codex"]).unwrap().command,
            Commands::Fleet { command: FleetCommand::Login { machine, provider } } if machine == "box" && provider == "codex"));
        assert!(Cli::try_parse_from(["ai-stack", "fleet", "login"]).is_err());
    }

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
    fn init_keeps_defaults_reports_detection_and_preserves_existing_config() {
        use crate::plugins::fake::FakeRunner;

        for missing in [vec![], vec![Harness::Claude], vec![Harness::Codex], Harness::ALL.to_vec()] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("config.toml");
            let runner = FakeRunner { missing: missing.iter().copied().collect(), ..FakeRunner::default() };
            let detected = init_config_at(&path, false, &runner).unwrap();
            let text = fs::read_to_string(&path).unwrap();
            let cfg = config::test_config(&text, dir.path()).unwrap();
            assert_eq!(text, config::default_config_text());
            for (harness, available) in detected {
                assert_eq!(available, !missing.contains(&harness));
                assert!(cfg.harnesses.iter().any(|hc| hc.harness == harness));
            }
            fs::write(&path, "owner's config\n").unwrap();
            assert!(init_config_at(&path, false, &runner).unwrap_err().to_string().contains("--force"));
            assert_eq!(fs::read_to_string(&path).unwrap(), "owner's config\n");
            init_config_at(&path, true, &runner).unwrap();
            assert_eq!(fs::read_to_string(&path).unwrap(), text);
        }
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

#[cfg(test)]
mod config_show_tests {
    use super::*;

    #[test]
    fn config_show_json_is_sorted_and_fills_omitted_defaults() {
        let fixture = tempfile::tempdir().unwrap();
        let path = fixture.path().join("config.toml");
        let text = config::default_config_text();
        fs::write(&path, text).unwrap();
        let stack = fixture.path().join("override");
        fs::create_dir_all(stack.join(config::FAMILIES_FILE).parent().unwrap()).unwrap();
        fs::write(stack.join(config::FAMILIES_FILE), include_str!("../tests/fixtures/model-families.json")).unwrap();
        let ctx = Context { home: fixture.path().into(), config_path: path.clone(), stack_override: Some(stack.clone()), explicit_flags: vec![], hook_flags: vec![] };
        let expected = ctx_flat(&ctx).unwrap();
        fs::write(&path, &text[..text.find("[clean]").unwrap()]).unwrap();
        assert_eq!(ctx_flat(&ctx).unwrap(), expected);
        assert_eq!(expected["harness.codex.home"], "~/.codex");
        assert_eq!(expected["stack.path"], "~/Documents/Projects/@joshmeads/ai-stack");
        assert!(expected["sheet.claude.arena runners"].is_array());
        assert!(!expected.contains_key("home"));
        let disabled = config::flat(&text.replace("enabled = true", "enabled = false"), fixture.path(), Some(&stack)).unwrap();
        assert_eq!(disabled["harness.codex.enabled"], false);
        assert_eq!(disabled["harness.codex.home"], "~/.codex");
        let mut out = Vec::new();
        write_config(expected.clone(), true, &mut out).unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(parsed.as_object().unwrap().keys().collect::<Vec<_>>(), expected.keys().collect::<Vec<_>>());
        assert!(matches!(Cli::try_parse_from(["ai-stack", "config", "show", "--json"]).unwrap().command, Commands::Config { command: ConfigCommand::Show { json: true } }));
        assert!(matches!(Cli::try_parse_from(["ai-stack", "fleet", "drift", "--ignore", "stack.*", "--ignore", "harness.*"]).unwrap().command, Commands::Fleet { command: FleetCommand::Drift { ignore, .. } } if ignore.len() == 2));
    }
}
