# ai-stack CLI

`ai-stack` sets up this repository's `jm` plugins in Claude Code (`~/.claude`) and Codex (`~/.codex`) from one config file. For each enabled harness it:

1. adds the stack checkout as the local `jm` plugin marketplace and installs `jm-stack`, `jm-games` and `jm-tools` through the harness's own CLI;
2. writes the jm:stack model sheet `<home>/pstack-models.md` and wires it into `CLAUDE.md` (an `@` import) or `AGENTS.md` (a mirror of the sheet);
3. writes one `ai-stack:routing` block into `CLAUDE.md` or `AGENTS.md`;
4. removes what older ai-stack installs left behind.

It shows the plan before changing anything, backs up every file or link it replaces or removes, and is idempotent: a second run reports `No changes.` Cursor is not handled.

## Build and install

From the repository root:

```sh
cargo install --path cli
```

This puts `ai-stack` on your `PATH`. Rebuild with the same command after changing the CLI.

## First run

```sh
ai-stack init          # writes ~/.config/ai-stack/config.toml
$EDITOR ~/.config/ai-stack/config.toml
ai-stack diff          # prints the plan; exit 0 means nothing would change
ai-stack install       # reviews the plan in a terminal screen, then applies it
```

Restart Claude Code and Codex sessions after the first install.

## Commands

| Command | Effect |
| --- | --- |
| `ai-stack init [--force]` | Write the default config to `~/.config/ai-stack/config.toml`. Refuses to overwrite unless `--force`. |
| `ai-stack diff [--clean]` | Print the install plan with unified diffs and the plugin commands it would run. Exit 0 when nothing would change, 1 when changes or conflicts are pending. It runs only the read-only `plugin marketplace list --json` and `plugin list --json` queries. `--clean` adds the clean actions (see [Clean](#clean)). |
| `ai-stack install [--yes] [--force] [--plain] [--clean]` | Build the plan, review it in the TUI (or print it with `--plain`), then apply. `--yes` applies without review. `--force` replaces an unmanaged `pstack-models.md`, after backing it up. `--clean` also removes skills and plugins outside the keep lists. Conflicts are printed and never applied. |
| `ai-stack update [--yes] [--plain] [--bump-models] [--branch B]` | Run `git pull --ff-only <remote> <branch>` in the stack checkout, check models, then install. `--branch` pulls that branch instead of `stack.branch` for this run only; the config is not changed. If the pull changed files under `cli/`, it prints a note to rebuild with `cargo install --path <stack>/cli`; it never rebuilds itself. |
| `ai-stack models [--bump]` | Report each configured model as `current`, `newer: <id>`, `missing` or `unknown: <reason>`. `--bump` rewrites config IDs to the newest model in the same family. |
| `ai-stack skills add <SOURCE> <PATH> [--ref REF] [--dest DIR] [--move NAME] [--process-script PATH \| --process-prompt TEXT] [--name NAME]` | Vendor the skill directory `PATH` from the git repo `SOURCE` into the stack and add it to the [manifest](#skills-manifest). Refuses when the manifest already installs that name in that `dest`, or the directory exists. |
| `ai-stack skills status` | Print `name  installed-name  <commit>  current \| behind: <latest> \| unknown: <reason>` per entry. Exit 0 when every entry is current, 1 otherwise. A network error is `unknown`. |
| `ai-stack skills update [NAME...] [--ref REF] [--reprocess] [--force]` | Rebuild the named entries (default all) whose upstream ref moved. `--ref` retargets the named entries to another upstream branch or tag and records it. `--reprocess` rebuilds from the pinned commit even when upstream has not moved. Refuses to replace a skill directory with uncommitted changes unless `--force`. One failure does not stop the rest; exit 1 if any failed. |
| `ai-stack fleet init [--force]` | Write a commented `fleet.toml` beside the config file. |
| `ai-stack fleet status` | Print `machine  <branch>  <commit>  current \| behind \| different \| detached \| unreachable: <reason>`, comparing each machine's stack commit with the remote tip of its own branch. Exit 0 when all are current. |
| `ai-stack fleet update [--yes] [--branch B]` | Run `<bin> update --yes --plain --branch <B>` on every enabled machine, `B` being `--branch` or that machine's current branch. Without `--yes`, print the commands and exit 1. |
| `ai-stack fleet switch <BRANCH> [MACHINE...] [--yes]` | On the named machines (default all enabled): fetch `BRANCH`, check it out (creating a tracking branch when needed), then update with `--branch BRANCH`. Without `--yes`, print the commands and exit 1. |

Global flags, valid on every command:

- `--config <PATH>`: config file. Default `<home>/.config/ai-stack/config.toml`.
- `--home <DIR>`: home directory. Default `$HOME`.
- `--stack <DIR>`: use this checkout instead of `stack.path` from the config. Links and hooks into the configured checkout are still treated as leftovers.
- `--version`.

Exit codes: 0 for success, 1 for pending changes that were not applied, conflicts, or a declined review, and a non-zero error exit for failures such as an unreadable config, a failed `git pull` or a failed plugin command.

## Config

`config.default.toml` in `cli/` is the reference that `ai-stack init` writes.

- `[stack]`: `path` is the checkout of `joshmeads/ai-stack`. `remote` and `branch` are used by `update`. `legacy_paths` lists older checkout roots. `~` is expanded and relative paths resolve against the invocation directory.
- `[harness.claude]`, `[harness.codex]`: `home` and `enabled`. A disabled harness is skipped entirely.
- `[models.<alias>]`: `provider` (`anthropic` or `openai`), the exact model `id`, optional `efforts` (the efforts a route on this model may name; it must then name one), and optional `context` (usable context in tokens). The defaults define `sol`, `luna`, `opus` and `haiku`, with `haiku` at 100000. The owner sets Haiku's compaction in Claude Code at 100k because Anthropic bills the whole request at 5x past 100k tokens; ai-stack only states the limit in the routing block. `ai-stack models` checks these IDs against the provider catalogs.
- `[leads]`, `[review]`: one `"alias@effort"` route per harness. The lead is described in the routing block; install does not change either CLI's default model. The review model is named in the routing block and used by jm-games' `art-iteration` critic.
- `[sheet.claude]`, `[sheet.codex]`: the 15 jm:stack model-sheet rows for that harness. Each lane is a provider-qualified descriptor `<provider>:<model>@<effort>` from the jm-stack provider-dispatch reference, or `inherit-parent` / `auto`. The loader accepts providers `claude` (models `opus`, `haiku`, `fable`) and `codex` (models `gpt-6.1-sol`, `gpt-6-luna`), efforts `low` to `max`, and `ultra` for `gpt-6.1-sol` only. The four panel rows (`arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`) accept arrays. The Why and Reflect rows must be `inherit-parent` or `auto`, because those roles need the parent's MCP servers.

- `[skills]`: `prompt_runner`, the argv that runs a `type = "prompt"` process step, with the prompt appended as the last argument. Default `["claude", "-p", "--permission-mode", "acceptEdits"]`. A config without `[skills]` gets the default.
- `[clean]`: what `--clean` keeps. `skill_roots` (default `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, resolved against `--home`), `keep_skills` (globs over entry names) and `keep_plugins` (globs over `name@marketplace`; the defaults keep `jm-*@jm`, `github@claude-plugins-official`, `chrome-devtools-mcp@claude-plugins-official` and Codex's built-in `*@openai-*`). Globs use `*` and `?`. A config without `[clean]`, or without one of its keys, gets the defaults that `init` writes.

A config from an older ai-stack (with `[roles]`, `[stack.models]` or `[install]`) is rejected with a message to run `ai-stack init --force` and re-apply your edits.

## What install manages

Per enabled harness, with `<home>` the harness home:

- **Model sheet.** `<home>/pstack-models.md`, whose first line is `<!-- Managed by ai-stack. ... -->`. setup-stack treats a sheet with that first line as installer-owned. An existing sheet without it (for example one setup-stack wrote) is a conflict unless `--force`.
- **Instruction file** (`CLAUDE.md` or `AGENTS.md`). Your text outside the managed blocks stays. Install writes:
  - `ai-stack:routing`: the lead, that jm:stack delegates through the sheet, when to run a major review with `interrogate` (after a design is settled and before a pull request or, without one, before calling a non-trivial change done; never for questions, assessments or trivial edits), each model's context cap, that a cross-provider lane may need approval and is reported as single-provider if refused, and the review model for `art-iteration`.
  - Claude: `ai-stack:pstack-models` holding `@<absolute path to pstack-models.md>`. Other `@` lines that import the same sheet are removed so the import appears once.
  - Codex: the exact sheet bytes between `<!-- pstack:models:begin -->` and `<!-- pstack:models:end -->`.
- **Plugins.** `claude plugin marketplace add <stack>` and `claude plugin install <name>@jm`, or `codex plugin marketplace add <stack>` and `codex plugin add <name>@jm`, for `jm-stack`, `jm-games` and `jm-tools`. A step is skipped when the CLI's `list --json` output shows it done: the `jm` marketplace already points at the stack checkout, and the plugin is installed (for Codex, at the version the checkout declares, because Codex installs a copy). A `jm` marketplace from another source is a conflict. When the harness home is not the CLI's default, the command sets `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. Commands run after every file change, because the CLIs edit `settings.json` and `config.toml` themselves.
- **Leftovers of older installs.**
  - Symlinks in `<home>/skills` and `<home>/agents` that point into the stack or a legacy root.
  - Role agent files older ai-stack builds wrote (`agents/*.md` containing the managed marker, `agents/*.toml` starting with it).
  - Every `ai-stack:<name>` block other than `routing` and `pstack-models`, and the `open-pstack:local` block.
  - In Claude's `settings.json`, hook commands that run `<root>/plugins/pstack/hooks/session-start` with bash or `<root>/scripts/task-context.py` with python3, for the stack or a legacy root. Other commands in the same group stay. A malformed `settings.json` is reported as a conflict and never rewritten.

Other skills, agents, links and files are left alone unless `--clean` is on.

## Clean

`--clean` (off by default) leaves only this install plus the `[clean]` keep lists. With it on, the plan also:

- **Moves skills into the backup.** Every entry of each skill root (directory, file or symlink, including a dangling symlink) that no `keep_skills` glob matches moves into the run's backup directory at its home-relative path, for example `<backup>/home/.agents/skills/old-skill`. Symlinks move as symlinks and are never followed. Nothing is deleted. Entries whose name starts with `.` (Codex's `.system`, `.DS_Store`) and `synced` (app-managed) are always kept. An entry the leftover cleanup already unlinks is not planned twice.
- **Removes plugins.** Every plugin in the `plugin list --json` output that no `keep_plugins` glob matches is removed with `claude plugin uninstall <id>` or `codex plugin remove <id>`. These run before the jm install commands. Marketplaces are left alone. Claude Code cannot uninstall a plugin synced from your claude.ai account (`<name>@synced`), so clean disables it with `claude plugin disable <id>` instead and warns that the app may sync it back; remove it on claude.ai to keep it gone. A Claude plugin installed in project or local scope is reported and left in place.
- **Records the removals.** Apply writes `removed-plugins.json` in the backup directory, listing each removed plugin with the command that removed it and the command that restores it (`claude plugin install <id>`, `claude plugin enable <id>` or `codex plugin add <id>`), and prints its path.

In the review screen, `c` toggles clean and re-plans. The clean actions appear in their own `Clean (N)` section, and the footer shows `c clean: on` or `off`. `--plain` prints the same section, and `--yes` applies the plan with clean as the flag set it. After `install --clean`, `diff --clean` reports `No changes.`

## Skills manifest

`<stack>/manifest.toml` records every skill the stack vendors from an external git repo. It is checked into the stack repo, so `git pull` (and `ai-stack update`) carries it to every machine. Only `ai-stack skills` writes it.

```toml
[[skill]]
name = "grill-with-docs"                 # upstream skill directory name
source = "https://github.com/mattpocock/skills"
path = "skills/grill-with-docs"          # skill directory inside the source repo
ref = "main"                             # upstream branch or tag tracked (default "HEAD")
commit = "<40-hex>"                      # upstream commit installed
dest = "plugins/jm-tools/skills"         # parent directory in the stack (this is the default)
move = "grill-docs"                      # optional installed name; also rewrites SKILL.md's `name:`
process = [
  { type = "script", input = "scripts/strip-emdashes.sh" },
  { type = "prompt", input = "Rewrite in a terse style." },
]
```

- `ref` is what `status` and `update` compare against. To try another upstream branch, run `ai-stack skills update --ref <branch> <name>`; it rebuilds from that branch and records the new `ref`. A 40-hex `ref` pins a commit.
- `process` is one table or an array; steps run in order every time the skill is pulled in or rebuilt. A `script` step runs `sh <script> <staged skill dir>` in that directory; a relative script path resolves against the stack root. A `prompt` step runs `[skills] prompt_runner` with the prompt as its last argument in the staged directory, without a shell. Both run arbitrary code or agents by design; review what you add.
- The pipeline: fetch the commit into a temp repo (`git init`, `git fetch --depth 1 <source> <commit>`, `git checkout FETCH_HEAD -- <path>`; never kept), copy the skill into a staging directory beside the target, apply `move`, run the steps, then swap the staging directory in by rename. A failing step leaves the installed skill untouched.
- The loader rejects a `name`, `move`, `path` or `dest` that is absolute or has `.` or `..` components, so a manifest cannot write outside the stack, and two entries that install the same directory.
- Typical flow: run `skills update` on one machine, review and commit the result with the manifest, push, then `ai-stack fleet update`.

## Fleet

`fleet.toml` beside the config file (default `~/.config/ai-stack/fleet.toml`) names the machines updates are pushed to. It is per owner and not in the repo.

```toml
[machine.cachy]
ssh = "cachy"            # ssh destination; or omit it and set local = true
stack = "~/Documents/Projects/@joshmeads/ai-stack"   # optional; default: this machine's stack.path as written
bin = "ai-stack"         # optional
enabled = true           # optional
```

Each machine sets exactly one of `ssh` or `local = true`. Remote commands run as `ssh -o BatchMode=yes <dest> -- <one shell-quoted command line>`, with a leading `~/` left unquoted so it expands on that machine. A non-interactive ssh shell may not have `~/.cargo/bin` on `PATH`; set `bin` to a full path then.

- `status` reads each machine's branch and commit (`git -C <stack> rev-parse HEAD --abbrev-ref HEAD`), looks up each distinct branch's tip once with `git ls-remote <remote> refs/heads/<branch>` from this machine, and reports `current`, `behind` (the commit is an ancestor of the tip in this machine's checkout), `different` (anything else, including a commit this machine does not have), `detached` or `unreachable`.
- `update` keeps every machine on its own branch, so a machine sitting on a test branch updates that branch. A machine on a detached HEAD is skipped and reported.
- `switch` never forces. It refuses a checkout with uncommitted tracked changes, runs `git fetch <remote> <BRANCH>`, then `git checkout <BRANCH>`, falling back to `git checkout -b <BRANCH> --track <remote>/<BRANCH>`, then `<bin> update --yes --plain --branch <BRANCH>`.
- Branch names are checked before use (no leading `-`, whitespace, control characters, `..` or other characters git refuses). A failing machine is reported with its stderr and the next one still runs. There is no timeout and no retry. `fleet update` does not run `skills update`.

## Safety

- Apply re-reads every target before making any change. If a file changed since review, apply refuses the whole plan.
- Backups go to `<home>/.local/state/ai-stack/backups/<unix-time>/`, with a numbered suffix for a same-second collision. Home-relative paths go under `home/` and other absolute paths under `abs/`. An occupied backup destination stops apply.
- Harness homes are normalized when the config loads, and apply refuses any target whose backup path would contain `..`.
- Every file write goes to a new temp file beside the target, created exclusively with an unpredictable name, then renamed over the target. A rewritten file keeps its permissions, so a `0600` `settings.json`, `CLAUDE.md` or `AGENTS.md` stays `0600`.
- When `CLAUDE.md`, `AGENTS.md` or `settings.json` is a symlink (for example into a dotfiles repo), install writes through to the link's target and keeps the link.

## Layout

```
cli/
  Cargo.toml
  config.default.toml  reference config written by `ai-stack init`
  fleet.default.toml   fleet template written by `ai-stack fleet init`
  src/
    main.rs     commands, git pull, model reports
    config.rs   config schema, validation, sheet descriptor rules
    exec.rs     process seam for git, ssh, scripts and prompt runners; shell quoting
    manifest.rs skills manifest schema and validation
    skills.rs   skills add, status, update and the install pipeline
    fleet.rs    fleet file, status, update and switch
    render.rs   model sheet and routing block text
    blocks.rs   marker-bounded blocks in instruction files
    install.rs  the per-harness plan: sheet, blocks, leftovers
    plugins.rs  marketplace and plugin commands, runner seam
    plan.rs     actions, diffs, backups, atomic apply
    models.rs   provider catalogs and --bump
    tui.rs      review screen
```
