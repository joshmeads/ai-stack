# ai-stack CLI design

The CLI turns one config into a per-harness setup of the `jm` plugin marketplace. The plugins carry the skills, agents and hooks; the CLI writes only what differs per user and per harness (the model sheet, the routing block and the owner's global instructions), installs the plugins, and cleans up after older installs. It has one install mode: edit in place, idempotently, with `--force` for an unmanaged model sheet.

## Commands

- `init [--force]`: write `config.default.toml` to the config path.
- `diff [--clean]`: build the plan and print it. Exit 0 when empty, 1 otherwise. Runs only the read-only plugin `list --json` queries.
- `stray [--json]`: build the plan with `clean: true` and report only its clean lines (`Plan::stray`, via `Plan::is_clean`): skill-root entries as home-relative paths and plugin ids. Same read-only queries as `diff`; exit 0.
- `install [--yes] [--force] [--plain] [--clean]`: plan, review (TUI, or plain text plus a y/N prompt), apply. The TUI's `c` toggles clean and re-plans.
- `update [--yes] [--plain] [--bump-models] [--branch B]`: `git pull --ff-only <remote> <branch>` in the stack (`--branch` overrides `stack.branch` for the run), after checking `git symbolic-ref --short HEAD` names that branch (a detached HEAD or another branch is refused), print the rebuild note when `cli/` changed, report models, optionally bump, then install.
- `models [--bump]`: compare model IDs with the provider catalogs (`codex debug models`; the Anthropic Models API or docs page) and optionally rewrite newer IDs in place.
- `skills add|status|update`: vendored skills in `<stack>/manifest.toml` (see Skills).
- `auth status [--json]`: local AI CLI login status, without loading config (see Login status).
- `fleet init|status|auth|update|switch`: machines in `<config dir>/fleet.toml` (see Fleet).

## Config

- `[stack]`: `path`, `remote`, `branch`, `legacy_paths`. `--stack` replaces `path` and moves the configured path into the legacy roots.
- `[harness.<name>]`: `home`, `enabled`.
- `[models.<alias>]`: `provider` (`anthropic` | `openai`), `id`, optional `efforts`, optional `context`.
- `[leads]`, `[review]`: `"alias@effort"` per harness; effort required, and it must be in the model's `efforts` when set.
- `[skills]`: `prompt_runner` argv, default `claude -p --permission-mode acceptEdits`; optional.
- `[sheet.claude]`, `[sheet.codex]`: all 15 rows, lanes as descriptors. The accepted rows, panel rows, parent-only rows and the model matrix (provider, model, selectable efforts) live in constants at the top of `config.rs`, kept in step with `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md`. Sheet descriptors are not tied to `[models]`: the sheet uses the plugin's spelling (Claude rolling aliases such as `opus`, Codex model slugs), while `[models]` holds exact IDs for the catalog check.

## Plan

`install::plan(cfg, opts, runner)` returns a `Plan` of file actions (`Write`, `Remove`, `Unlink`, `ReplaceWithFile`, `MoveToBackup`), plugin `commands`, `conflicts` and `warnings`. For each enabled harness:

1. **Sheet.** `<home>/pstack-models.md` from `render::sheet`. First line `render::MANAGED_MD`; setup-stack's managed-sheet check matches its `<!-- Managed by ai-stack` prefix. Absent or managed: write if changed. A symlink into the stack or a legacy root: replace. Anything else: conflict, or replace with `--force`.
2. **Instruction file** (`Harness::instruction_file`). Resolve a symlink to its target (write-through). Validate markers. Remove `open-pstack:local` and every `ai-stack:*` block except `instructions`, `routing`, `pstack-models` and Claude's `anthropic-guidance`. Claude: remove other `@` lines that resolve to this sheet. Upsert `instructions` from `<stack>/instructions/common.md` and `<stack>/instructions/<Harness::instructions_stem>.md` (each trimmed, blank or absent skipped, joined by a blank line), or remove it when both are absent; a source containing an `<!-- ai-stack:`, `<!-- pstack:` or `<!-- open-pstack:` marker is a conflict naming the file. The text is always inlined, never `@`-imported, so every harness gets the same mechanism. Upsert `routing` (`render::routing`). Claude: upsert `pstack-models` with `@<abs sheet path>`. Codex: upsert the `pstack:models` mirror with the exact sheet bytes.
3. **Claude settings.json.** Write-through as above. Unparsable JSON is a conflict and the file is untouched. Remove hook commands that exactly match the old forms (`bash <root>/plugins/pstack/hooks/session-start`, optionally quoted and followed by `| sed 's/pstack://g'`; `python3 <root>/scripts/task-context.py`, optionally quoted) for the stack or a legacy root. A group loses only those commands; a group or event list emptied by the removal is dropped. Written only when something was removed.
4. **Leftovers.** In `skills/` and `agents/`, unlink symlinks resolving into the stack or a legacy root, and remove role agent files carrying the managed marker.
5. **Plugins** (`plugins::plan`, after all harnesses' file actions). Check that the stack's harness manifest (`.claude-plugin/marketplace.json` or `.agents/plugins/marketplace.json`) names `jm` and lists the three plugins; otherwise conflict. When the harness home does not exist yet, plan every command. Otherwise query `plugin marketplace list --json`: absent means add the marketplace and install every plugin; another source is a conflict; the stack means query `plugin list --json` and install each missing plugin, plus, for Codex, each whose installed version differs from the checkout's `.codex-plugin/plugin.json`. A missing CLI is a conflict; a failed query is a warning and plans every command (both CLIs treat repeats as no-ops). `CLAUDE_CONFIG_DIR` / `CODEX_HOME` is set on a command only when the harness home differs from what the CLI would use.

With `--clean` (`Options::clean`), after the harness loop: every `[clean] skill_roots` entry that `Clean::keeps_skill` rejects and no earlier action touches becomes a `MoveToBackup` action, and `plugins::plan_clean` adds an uninstall (Claude user scope), disable (Claude `synced` scope, which the CLI cannot uninstall) or `codex plugin remove` for every listed plugin `Clean::keeps_plugin` rejects. Those commands carry `undo` args, come before every install command, and apply records them in `removed-plugins.json` in the backup dir.

The `Runner` trait is the seam for the CLIs. `SystemRunner` runs the binaries from `PATH` with stdin closed; tests use `plugins::fake::FakeRunner`, which keeps marketplace and plugin state and answers the list queries in each CLI's JSON shape.

## Apply

`plan::apply(plan, backup_root, runner)` refuses on conflicts, re-verifies every file action against the state it was planned from, backs up each existing target under `<backup_root>/<unix-time>[-n]/{home,abs}/`, applies the file actions, then runs the commands in order. A failed command stops apply with its stderr; the file changes already made stay, and the next run plans only what remains.

## Skills

`manifest.rs` holds the `[[skill]]` schema (`name`, `source`, `path`, `ref`, `commit`, `dest`, `move`, `process` as one-or-many `{type, input}`) and its validation: `[A-Za-z0-9._-]+` not starting with `.` for `name` and `move`; plain relative components for `path` (or exactly `.`), `dest` (no `.git` component) and script inputs; no prompt starting with `-`; a valid git ref; one entry per installed directory and per name or installed name. The file is rewritten whole by `skills add` and `update`; hand edits to values survive, comments do not. There is no stack-level stamp; the stack's own history is its git log.

`skills.rs` resolves a ref with `git ls-remote` (peeled tag, exact name, `refs/heads/`, `refs/tags/`; a 40-hex ref is used as is), fetches the commit into a throwaway repo, refuses the skill when its path or any ancestor is a symlink or any symlink exists in its tree (`.git` skipped), stages the copy in `<stack>/.ai-stack/stage/` (same filesystem as every target, git-ignored), applies `move` to the directory name and the frontmatter `name:` line, runs the process steps in order with the staging directory as cwd, then swaps with two renames: the old target into a reserved directory in the stage, the staged copy into place. The skill is absent for the moment between them; a crash there leaves the old tree in `.ai-stack/stage/`. If the second rename fails the old tree is renamed back; if that also fails it is kept and its path is in the error. Every `skills` subcommand clears `.ai-stack/stage/` first. `add` resolves the commit, then validates the entry once; a local source is stored canonicalized. `update` rebuilds a missing target without the guard, otherwise checks `git status --porcelain --untracked-files=all --ignored=matching -- <target>` before replacing anything, keeps going after a failed entry, and writes the manifest once at the end. `--ref` changes the tracked ref of the named entries; `--reprocess` falls back to the pinned commit when the unchanged ref cannot be resolved. `status` reports `missing` for an absent target.

## Fleet

`fleet.rs` loads enabled machines (exactly one of `ssh` / `local = true`) and builds each command as words, where path words keep a leading `~/` unquoted for the remote shell and everything else goes through `exec::shell_quote`. `status` requires a 40-hex commit line (otherwise `unreachable: unexpected output`), caches one `ls-remote` per distinct branch and checks ancestry both ways with `git merge-base --is-ancestor` in the local checkout (`behind`, `ahead`, `different`; exit 128, a missing object, is `unknown (fetch first)`); for each reachable machine it also runs `<bin> stray --json` through the same path and prints its counts, or `unavailable (<reason>)` when that fails or does not parse, without affecting the exit code. `update` resolves each machine's branch unless `--branch` is given, skips a detached HEAD, and runs `<bin> --stack <machine stack> update ...` so it pulls the checkout `status` reads. A local machine without `bin` runs `current_exe()` with the parent's explicit `--config` / `--home`. `switch` runs a dirty check, `fetch <remote> +refs/heads/<B>:refs/remotes/<remote>/<B>`, `switch <B>` with a `switch -c <B> --track` fallback, then update, per machine; an update failure after the switch says the machine is now on `<B>`. Without `--yes`, `update` and `switch` print and run nothing.

All git, ssh, script and prompt invocations, including `update`'s pull, go through `exec::Exec` (`SystemExec`, stdin closed); fleet and pull tests use `exec::fake::FakeExec`, skills tests use real `git` on local repos. The harness plugin CLIs keep their own `plugins::Runner`, because each command carries per-harness env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). Branch arguments go through `exec::check_branch` (a `check_ref` that also rejects `HEAD`, `refs/` and a leading `+`); skill refs through `check_ref`.

## Login status

`auth.rs` owns the const `PROVIDERS` descriptor table: id, display name, binary, read-only status argv, parser and optional expiry source (home environment variable, default directory, filename and reader). Add a provider with one table row and its parser, plus parser fixtures. A future login workflow can add a column to this table; no login or logout command is implemented here.

`Report` holds a provider id and `State`. `LoggedIn` alone carries account, expiry, source and optional refresh presence, so logged-out and absent providers cannot carry an expiry. The wire schema flattens these into `id`, `state`, and optional fields inside `{"providers":[...]}`; deserialization rejects unknown fields and invalid state combinations. Provider CLI output is parsed selectively because their schemas may grow. The `Exec` seam includes PATH availability, so tests use fakes without executing provider commands.

Claude uses `auth status --json`, Codex `login status` (including stderr), Cursor Agent `status --format json`, OpenCode `auth list` (ANSI stripped). OpenCode's configured-credential count means configured, not server-validated. Nonzero status exits may still convey a recognized logged-out result; other errors become fixed one-line unknown reasons and never stop the other providers. No timeout or retry is added. Local status exits 0 unless the command itself cannot run, such as an output-write failure.

Expiry readers return only numeric seconds and refresh presence. Codex decodes only its access JWT payload's numeric `exp`; Claude's Linux `claudeAiOauth.expiresAt` is milliseconds and is converted to seconds. File and decode errors collapse to `expiry unavailable`, with no path, token or JSON error included, and are omitted from reports. File resolution honors `CODEX_HOME` / `CLAUDE_CONFIG_DIR` and follows symlinks normally. Claude on macOS has no file reader and never invokes `security`. Cursor and OpenCode have no expiry reader; OpenCode's multiple independent credentials have no single access-token deadline. An expired access token does not override the status command's logged-in state. Refresh presence does not imply a successful future refresh.

`fleet auth [--json]` reuses `ai_stack` and `invocation` from fleet status, including explicit local `--config` / `--home`, custom binaries and remote path quoting; like status's stray query it does not add `--stack`. Each machine returns its local status JSON. Nonzero SSH exit 255 is unreachable, nonzero remote command exits and malformed, incomplete or duplicate-provider reports are unavailable. Raw stdout, stderr and deserialization errors are never echoed. Combined JSON is `{"machines":[{"machine":"name","providers":[...]},{"machine":"old","error":"unavailable (...)"}]}`. Exit 0 requires successful reports from every machine and every installed provider logged in without a known expired token; unknown expiry is allowed.

This uses the existing SSH transport: BatchMode, the owner's key authentication and LAN hosts. The remote side returns only status, never secrets. Credential files are read locally only to extract expiry and refresh presence; neither raw files nor tokens enter output, serialization or error text. No keychain command, browser, login, logout or credential refresh is invoked.

## Adding a harness

Cursor and OpenCode are not handled. Adding a harness needs:

- a `Harness` variant in `config.rs` with `as_str`, `name`, `instruction_file` and `instructions_stem` arms (the compiler finds every other `match`);
- `[harness.<name>]`, `[leads]`, `[review]` and `[sheet.<name>]` entries (`HarnessSection`, `PerHarness`, `config.default.toml`) and its model-sheet wording in `render.rs`;
- plugin CLI wiring in `plugins.rs`: the marketplace manifest path, the install, list and remove commands and their JSON shapes, the home env var, and the fake runner.

OpenCode reads `~/.config/opencode/AGENTS.md`, so it can reuse the block writer with that home and file name. Cursor keeps global rules as `.mdc` files with frontmatter in a rules directory, so it needs a file writer for whole managed files rather than a block in a markdown file.

## Safety guarantees

- **Atomic writes with the original mode.** A temp file is created exclusively beside the target (`tempfile::Builder`, random name), given the target's permissions when it exists, written, and renamed over the target.
- **No escaping backups.** Harness homes are normalized at load; a target whose home-relative or absolute backup path has `..`, `.` or no file name is refused.
- **Stale plans are refused.** `Write`/`Remove` compare text, `Unlink` compares the link target, `ReplaceWithFile` compares an lstat fingerprint of the whole tree.
- **Skills stay inside the stack.** Manifest paths are validated at load and on every write, so no entry can address a directory outside the stack.
- **No upstream symlinks.** A vendored skill that is, sits under or contains a symlink is refused, so nothing upstream can point a copy or a `move` rewrite outside the stack.
- **Skill replace by rename.** A skill is built in `.ai-stack/stage/` and swapped in by two renames; a failed fetch, `move` or process step leaves the installed skill as it was.
- **Dirty guard.** `skills update` refuses to replace a skill directory with uncommitted, untracked or ignored files unless `--force`.
- **Branch guard.** `update` pulls only into a checkout already on the branch it pulls.
- **Process steps run arbitrary code by design.** Scripts and prompt runners run with the user's permissions in the staging directory.
- **Fleet never forces.** `switch` refuses a dirty checkout and never uses `-f` or `-B`; branch names are validated before they reach any command line.
- **Exact ownership.** Links count as ai-stack's only when they resolve into the stack or a legacy root; hooks only when the command is one of the exact old forms for those roots; agent files only with the managed marker.

## Modules (`src/`)

- `main.rs`: CLI parsing, commands, `git pull`, model reports and bump.
- `config.rs`: schema, validation, descriptor rules.
- `render.rs`: sheet and routing text.
- `blocks.rs`: marker-bounded blocks.
- `install.rs`: the per-harness plan, including the instructions block.
- `plugins.rs`: plugin commands and the runner seam.
- `plan.rs`: actions, diffs, backups, apply.
- `models.rs`: catalogs and `--bump`.
- `exec.rs`: process seam, `shell_quote`, `check_ref`, `check_branch`, commit text helpers.
- `manifest.rs`, `skills.rs`: skills manifest and commands.
- `fleet.rs`: fleet file and commands.
- `auth.rs`: provider table, login-status domain and wire reports, parsers, expiry readers and rendering.
- `tui.rs`: review screen.
