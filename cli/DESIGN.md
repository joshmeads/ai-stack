# ai-stack CLI design

The CLI turns one config into a per-harness setup of the `jm` plugin marketplace. The plugins carry the skills, agents and hooks; the CLI writes only what differs per user and per harness (the model sheet and the routing block), installs the plugins, and cleans up after older installs. It has one install mode: edit in place, idempotently, with `--force` for an unmanaged model sheet.

## Commands

- `init [--force]`: write `config.default.toml` to the config path.
- `diff [--clean]`: build the plan and print it. Exit 0 when empty, 1 otherwise. Runs only the read-only plugin `list --json` queries.
- `install [--yes] [--force] [--plain] [--clean]`: plan, review (TUI, or plain text plus a y/N prompt), apply. The TUI's `c` toggles clean and re-plans.
- `update [--yes] [--plain] [--bump-models]`: `git pull --ff-only <remote> <branch>` in the stack, print the rebuild note when `cli/` changed, report models, optionally bump, then install.
- `models [--bump]`: compare model IDs with the provider catalogs (`codex debug models`; the Anthropic Models API or docs page) and optionally rewrite newer IDs in place.

## Config

- `[stack]`: `path`, `remote`, `branch`, `legacy_paths`. `--stack` replaces `path` and moves the configured path into the legacy roots.
- `[harness.<name>]`: `home`, `enabled`.
- `[models.<alias>]`: `provider` (`anthropic` | `openai`), `id`, optional `efforts`, optional `context`.
- `[leads]`, `[review]`: `"alias@effort"` per harness; effort required, and it must be in the model's `efforts` when set.
- `[sheet.claude]`, `[sheet.codex]`: all 15 rows, lanes as descriptors. The accepted rows, panel rows, parent-only rows and the model matrix (provider, model, selectable efforts) live in constants at the top of `config.rs`, kept in step with `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md`. Sheet descriptors are not tied to `[models]`: the sheet uses the plugin's spelling (Claude rolling aliases such as `opus`, Codex model slugs), while `[models]` holds exact IDs for the catalog check.

## Plan

`install::plan(cfg, opts, runner)` returns a `Plan` of file actions (`Write`, `Remove`, `Unlink`, `ReplaceWithFile`, `MoveToBackup`), plugin `commands`, `conflicts` and `warnings`. For each enabled harness:

1. **Sheet.** `<home>/pstack-models.md` from `render::sheet`. First line `render::MANAGED_MD`; setup-stack's managed-sheet check matches its `<!-- Managed by ai-stack` prefix. Absent or managed: write if changed. A symlink into the stack or a legacy root: replace. Anything else: conflict, or replace with `--force`.
2. **Instruction file.** Resolve a symlink to its target (write-through). Validate markers. Remove `open-pstack:local` and every `ai-stack:*` block except `routing` and `pstack-models`. Claude: remove other `@` lines that resolve to this sheet. Upsert `routing` (`render::routing`). Claude: upsert `pstack-models` with `@<abs sheet path>`. Codex: upsert the `pstack:models` mirror with the exact sheet bytes.
3. **Claude settings.json.** Write-through as above. Unparsable JSON is a conflict and the file is untouched. Remove hook commands that exactly match the old forms (`bash <root>/plugins/pstack/hooks/session-start`, optionally quoted and followed by `| sed 's/pstack://g'`; `python3 <root>/scripts/task-context.py`, optionally quoted) for the stack or a legacy root. A group loses only those commands; a group or event list emptied by the removal is dropped. Written only when something was removed.
4. **Leftovers.** In `skills/` and `agents/`, unlink symlinks resolving into the stack or a legacy root, and remove role agent files carrying the managed marker.
5. **Plugins** (`plugins::plan`, after all harnesses' file actions). Check that the stack's harness manifest (`.claude-plugin/marketplace.json` or `.agents/plugins/marketplace.json`) names `jm` and lists the three plugins; otherwise conflict. When the harness home does not exist yet, plan every command. Otherwise query `plugin marketplace list --json`: absent means add the marketplace and install every plugin; another source is a conflict; the stack means query `plugin list --json` and install each missing plugin, plus, for Codex, each whose installed version differs from the checkout's `.codex-plugin/plugin.json`. A missing CLI is a conflict; a failed query is a warning and plans every command (both CLIs treat repeats as no-ops). `CLAUDE_CONFIG_DIR` / `CODEX_HOME` is set on a command only when the harness home differs from what the CLI would use.

With `--clean` (`Options::clean`), after the harness loop: every `[clean] skill_roots` entry that `Clean::keeps_skill` rejects and no earlier action touches becomes a `MoveToBackup` action, and `plugins::plan_clean` adds an uninstall (Claude user scope), disable (Claude `synced` scope, which the CLI cannot uninstall) or `codex plugin remove` for every listed plugin `Clean::keeps_plugin` rejects. Those commands carry `undo` args, come before every install command, and apply records them in `removed-plugins.json` in the backup dir.

The `Runner` trait is the seam for the CLIs. `SystemRunner` runs the binaries from `PATH` with stdin closed; tests use `plugins::fake::FakeRunner`, which keeps marketplace and plugin state and answers the list queries in each CLI's JSON shape.

## Apply

`plan::apply(plan, backup_root, runner)` refuses on conflicts, re-verifies every file action against the state it was planned from, backs up each existing target under `<backup_root>/<unix-time>[-n]/{home,abs}/`, applies the file actions, then runs the commands in order. A failed command stops apply with its stderr; the file changes already made stay, and the next run plans only what remains.

## Safety guarantees

- **Atomic writes with the original mode.** A temp file is created exclusively beside the target (`tempfile::Builder`, random name), given the target's permissions when it exists, written, and renamed over the target.
- **No escaping backups.** Harness homes are normalized at load; a target whose home-relative or absolute backup path has `..`, `.` or no file name is refused.
- **Stale plans are refused.** `Write`/`Remove` compare text, `Unlink` compares the link target, `ReplaceWithFile` compares an lstat fingerprint of the whole tree.
- **Exact ownership.** Links count as ai-stack's only when they resolve into the stack or a legacy root; hooks only when the command is one of the exact old forms for those roots; agent files only with the managed marker.

## Modules (`src/`)

- `main.rs`: CLI parsing, commands, `git pull`, model reports and bump.
- `config.rs`: schema, validation, descriptor rules.
- `render.rs`: sheet and routing text.
- `blocks.rs`: marker-bounded blocks.
- `install.rs`: the per-harness plan.
- `plugins.rs`: plugin commands and the runner seam.
- `plan.rs`: actions, diffs, backups, apply.
- `models.rs`: catalogs and `--bump`.
- `tui.rs`: review screen.
