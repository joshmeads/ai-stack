# ai-stack CLI design

The CLI turns one config into a per-harness setup of the stack: the `jm` plugin marketplace with its one plugin, `jm-stack`, and the standalone skills of the global groups in `stack.toml`. The plugin carries jm:stack's skills, agents and hooks; the CLI writes only what differs per user and per harness (the model sheet, the routing block and the owner's global instructions), installs the plugin, links the standalone skills, and cleans up after older installs. It has one install mode: edit in place, idempotently, with `--force` for an unmanaged model sheet.

## Commands

- `config show [--json]`: print sorted, flattened effective config without writing.
- `init [--force]`: write `config.default.toml` to the config path.
- `diff [--clean]`: build the plan and print it. Exit 0 when empty, 1 otherwise. Runs only the read-only plugin `list --json` queries.
- `stray [--json]`: build the plan with `clean: true` and report only its clean lines (`Plan::stray`, via `Plan::is_clean`): skill-root entries as home-relative paths and plugin ids. Clean lines are `MoveToBackup { clean: true }` actions and commands with `clean` set, so ai-stack's own links, the `--force` moves and the removal of stale `jm` plugins never count. Same read-only queries as `diff`; exit 0.
- `install [--yes] [--force] [--plain] [--clean]`: plan, review (TUI, or plain text plus a y/N prompt), apply. The TUI's `c` toggles clean and re-plans.
- `update [--yes] [--plain] [--bump-models] [--branch B]`: `git pull --ff-only <remote> <branch>` in the stack (`--branch` overrides `stack.branch` for the run), after checking `git symbolic-ref --short HEAD` names that branch (a detached HEAD or another branch is refused), print the rebuild note when `cli/` changed, report models, optionally bump, then install.
- `models [--bump]`: compare model IDs with the provider catalogs (`codex debug models`; the Anthropic Models API or docs page) and optionally rewrite newer IDs in place.
- `skills add|status|update`: vendored skills in `<stack>/stack.toml` (see Skills).
- `groups [--json]`: each group's `global` flag and resolved skills, with a token estimate, then the global set (see Skills).
- `auth status [--json]`: local AI CLI login status, without loading config (see Login status).
- `fleet login <MACHINE> <PROVIDER>`: run one provider’s headless login with inherited terminal streams, then report its status (see Fleet login).
- `fleet init|status|auth|drift|update|switch`: machines in `<config dir>/fleet.toml` (see Fleet).

## Config

- `[stack]`: `path`, `remote`, `branch`, `legacy_paths`. `--stack` replaces `path` and moves the configured path into the legacy roots.
- `[harness.<name>]`: `home`, `enabled`.
- `[models.<alias>]`: `provider` (`anthropic` | `openai`), `id`, optional `efforts`, optional `context`.
- `[leads]`, `[review]`: `"alias@effort"` per harness; effort required, and it must be in the model's `efforts` when set.
- `[skills]`: `prompt_runner` argv, default `claude -p --permission-mode acceptEdits`; optional.
- `[sheet.claude]`, `[sheet.codex]`: all 15 rows, lanes as descriptors. The accepted rows, panel rows, parent-only rows and the model matrix (provider, model, selectable efforts) live in constants at the top of `config.rs`, kept in step with `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md`. Sheet descriptors are not tied to `[models]`: the sheet uses the plugin's spelling (Claude rolling aliases such as `opus`, Codex model slugs), while `[models]` holds exact IDs for the catalog check.

`config::flat` validates with the normal loader, then serializes the parsed `ConfigFile` with serde defaults filled in and flattens its tables into `drift::Flat` (`BTreeMap<String, serde_json::Value>`). This uses the file schema because resolved `Config` expands paths and drops disabled harnesses. Paths stay exactly as written, including `~`; absent optional model fields stay absent. Only `config.toml` sections are flattened. This config contains no secrets. `--stack` is an execution override and does not alter the stored-config view.

## Plan

`install::plan(cfg, opts, runner)` loads and validates `<stack>/stack.toml` (an invalid file fails the plan), then returns a `Plan` of file actions (`Write`, `Remove`, `Unlink`, `ReplaceWithFile`, `MoveToBackup`, `Link`), plugin `commands`, `conflicts` and `warnings`. For each enabled harness:

1. **Sheet.** `<home>/pstack-models.md` from `render::sheet`. First line `render::MANAGED_MD`; setup-stack's managed-sheet check matches its `<!-- Managed by ai-stack` prefix. Absent or managed: write if changed. A symlink into the stack or a legacy root: replace. Anything else: conflict, or replace with `--force`.
2. **Instruction file** (`Harness::instruction_file`). Resolve a symlink to its target (write-through). Validate markers. Remove `open-pstack:local` and every `ai-stack:*` block except `instructions`, `routing`, `pstack-models` and Claude's `anthropic-guidance`. Claude: remove other `@` lines that resolve to this sheet. Upsert `instructions` from `<stack>/instructions/common.md` and `<stack>/instructions/<Harness::instructions_stem>.md` (each trimmed, blank or absent skipped, joined by a blank line), or remove it when both are absent; a source containing an `<!-- ai-stack:`, `<!-- pstack:` or `<!-- open-pstack:` marker is a conflict naming the file. The text is always inlined, never `@`-imported, so every harness gets the same mechanism. Upsert `routing` (`render::routing`). Claude: upsert `pstack-models` with `@<abs sheet path>`. Codex: upsert the `pstack:models` mirror with the exact sheet bytes.
3. **Claude settings.json.** Write-through as above. Unparsable JSON is a conflict and the file is untouched. Remove hook commands that exactly match the old forms (`bash <root>/plugins/pstack/hooks/session-start`, optionally quoted and followed by `| sed 's/pstack://g'`; `python3 <root>/scripts/task-context.py`, optionally quoted) for the stack or a legacy root. A group loses only those commands; a group or event list emptied by the removal is dropped. Written only when something was removed.
4. **Leftovers.** In `<home>/skills/` and `<home>/agents/`, unlink symlinks resolving into the stack or a legacy root, and remove role agent files carrying the managed marker. A directory that is the harness's user skill folder (Claude's `skills/`) is left to step 5.

After the harness loop, `--clean` plans its skill moves (below). Then:

5. **Skill links** (`plan_skill_links`). The enabled skills are `StackFile::global_skills()` whose `skills/<name>/` exists; a missing one (a vendored skill not built yet) is a warning. Each harness's folder is `Harness::skill_folder`; a folder reached twice (compared canonicalized) is planned once. In the folder, a symlink resolving into the stack or a legacy root (`owned_link`) whose name is not enabled is an `Unlink`. For each enabled name: absent is `Link { replacing: None }`; a link whose target is exactly `<stack>/skills/<name>` is no action; another owned link is `Link { replacing: Some(old target) }`; anything else (directory, file, a link elsewhere) is a stray skill in the way. That is a conflict naming the path, unless `--clean` already moves it, or `--force` adds `MoveToBackup { clean: false }` before the `Link`.
6. **Plugins** (`plugins::plan`, after all file actions). Check that the stack's harness manifest (`.claude-plugin/marketplace.json` or `.agents/plugins/marketplace.json`) names `jm` and lists every plugin in `PLUGINS` (only `jm-stack`); otherwise conflict. When the harness home does not exist yet, plan every command. Otherwise query `plugin marketplace list --json`: absent means add the marketplace and install every plugin; another source is a conflict; the stack means query `plugin list --json`. Every installed `<name>@jm` the manifest does not list gets a removal (`plan_removal`, shared with `--clean`, with `undo` args and `clean: false`) before the installs. Then install each missing plugin, plus, for Codex, each whose installed version differs from the checkout's `.codex-plugin/plugin.json`. A missing CLI is a conflict; a failed query is a warning and plans every command (both CLIs treat repeats as no-ops). `CLAUDE_CONFIG_DIR` / `CODEX_HOME` is set on a command only when the harness home differs from what the CLI would use.

With `--clean` (`Options::clean`), after the harness loop and before the skill links: every `[clean] skill_roots` entry that `Clean::keeps_skill` rejects, that no earlier action touches, and that is not an owned link becomes a `MoveToBackup { clean: true }` action. A stray at an enabled name is moved this way, so step 5 links over it without a conflict. `plugins::plan_clean` adds an uninstall (Claude user scope), disable (Claude `synced` scope, which the CLI cannot uninstall) or `codex plugin remove` for every listed plugin `Clean::keeps_plugin` rejects, except `jm` plugins, which step 6 owns. Those commands carry `undo` args and `clean: true`, come before every install command, and apply records every command with `undo` in `removed-plugins.json` in the backup dir.

The `Runner` trait is the seam for the CLIs. `SystemRunner` runs the binaries from `PATH` with stdin closed; tests use `plugins::fake::FakeRunner`, which keeps marketplace and plugin state and answers the list queries in each CLI's JSON shape.

## Apply

`plan::apply(plan, backup_root, runner)` refuses on conflicts, re-verifies every file action against the state it was planned from, backs up each existing target under `<backup_root>/<unix-time>[-n]/{home,abs}/`, applies the file actions, then runs the commands in order. A `Link` verifies that the path still holds `replacing` (nothing, or the old link), except a `Link { replacing: None }` at a path an earlier `MoveToBackup` in the plan frees, which that move verifies. A repointed link is copied into the backup before it is replaced; a new link creates its folder. A failed command stops apply with its stderr; the file changes already made stay, and the next run plans only what remains.

## Skills

`stackfile.rs` owns `<stack>/stack.toml`. `StackFile` is `groups: BTreeMap<GroupName, Group>` plus the vendored `skills: Vec<Skill>` (`[[skill]]`). `Name` (aliased `GroupName` and `SkillName`) is validated when parsed, so it is always one safe path component. A `Group` has `global` (default false), `includes` and `skills`. `resolve(groups, roots)` is the pure closure over `includes`, returning each skill once; `global_skills()` resolves every global group. `validate()` checks the file alone: vendored entries (below), unknown includes, include cycles (reported as `a -> b -> a`), a skill listed twice in one group, and that every vendored skill installed into `skills/` (`Skill::is_standalone`) is a group member. `check_skills_dir(stack)` checks it against the tree: every member is `skills/<name>/` with `SKILL.md` (a vendored member may be missing), and every non-dot directory in `skills/` is in a group. `load` runs both and prefixes errors with the file path; an absent file is an empty one. Every error names the offending key, such as `[groups.games] includes` or `[[skill]] "grill"`.

The `[[skill]]` schema is (`name`, `source`, `path`, `ref`, `commit`, `dest`, `move`, `process` as one-or-many `{type, input}`) and its validation: `[A-Za-z0-9._-]+` not starting with `.` for `name` and `move`; plain relative components for `path` (or exactly `.`), `dest` (no `.git` component) and script inputs; no prompt starting with `-`; a valid git ref; one entry per installed directory and per name or installed name. The file is rewritten whole by `skills add` and `update`; hand edits to values survive, comments do not. The default `dest` is `skills`. There is no stack-level stamp; the stack's own history is its git log.

`skills.rs` resolves a ref with `git ls-remote` (peeled tag, exact name, `refs/heads/`, `refs/tags/`; a 40-hex ref is used as is), fetches the commit into a throwaway repo, refuses the skill when its path or any ancestor is a symlink or any symlink exists in its tree (`.git` skipped), stages the copy in `<stack>/.ai-stack/stage/` (same filesystem as every target, git-ignored), applies `move` to the directory name and the frontmatter `name:` line, runs the process steps in order with the staging directory as cwd, then swaps with two renames: the old target into a reserved directory in the stage, the staged copy into place. The skill is absent for the moment between them; a crash there leaves the old tree in `.ai-stack/stage/`. If the second rename fails the old tree is renamed back; if that also fails it is kept and its path is in the error. Every `skills` subcommand clears `.ai-stack/stage/` first. `add` requires `--group`, an existing group; it refuses a `dest` other than `skills`, resolves the commit, appends the installed name to the group's `skills`, then validates the file once; a local source is stored canonicalized. `update` rebuilds a missing target without the guard, otherwise checks `git status --porcelain --untracked-files=all --ignored=matching -- <target>` before replacing anything, keeps going after a failed entry, and writes the manifest once at the end. `--ref` changes the tracked ref of the named entries; `--reprocess` falls back to the pinned commit when the unchanged ref cannot be resolved. `status` reports `missing` for an absent target.

`groups.rs` builds the `groups --json` report from `stack.toml` and each member's `SKILL.md` frontmatter (`frontmatter_value` reads plain, quoted and `>` / `|` block values). A budget is `ceil(chars / 4)`, with `chars` summed over the `name` and `description` values of the skills counted; a missing `SKILL.md` counts zero. The JSON shape is stable, because the Swift app reads it ([ADR 0002](../docs/adr/0002-swift-app-drives-the-cli.md)):

```json
{"groups":[{"name":"games","global":true,"includes":["threejs"],"skills":["game-gdd","threejs"],"tokens":812}],"global":{"skills":["game-gdd","threejs"],"tokens":812}}
```

`groups` is in name order; each `skills` list is the group's resolved members, sorted; `global` is the union of the global groups, each skill once. New fields may be added; existing ones keep their meaning.

### Codex user skill folder

`Harness::skill_folder` uses `~/.agents/skills` for Codex. Checked on 2026-10-16 against codex-cli 0.160.0 on the Mac: with a throwaway `HOME` and `CODEX_HOME`, `codex debug prompt-input` listed skills from both `$CODEX_HOME/skills` and `$HOME/.agents/skills` in its skill roots table, including a skill that was a symlink to a directory elsewhere. The bundled skill-installer text still names `$CODEX_HOME/skills`. ai-stack links into `~/.agents/skills` only, so a skill never appears twice.

## Fleet

`fleet.rs` loads enabled machines, each with exactly one of `ssh` / `local = true`; login also loads disabled machines and warns when one is selected. It builds each command as words, where path words keep a leading `~/` unquoted for the remote shell and everything else goes through `exec::shell_quote`. `status` requires a 40-hex commit line (otherwise `unreachable: unexpected output`), caches one `ls-remote` per distinct branch and checks ancestry both ways with `git merge-base --is-ancestor` in the local checkout (`behind`, `ahead`, `different`; exit 128, a missing object, is `unknown (fetch first)`); for each reachable machine it also runs `<bin> stray --json` through the same path and prints its counts, or `unavailable (<reason>)` when that fails or does not parse, without affecting the exit code. `update` resolves each machine's branch unless `--branch` is given, skips a detached HEAD, and runs `<bin> --stack <machine stack> update ...` so it pulls the checkout `status` reads. A local machine without `bin` runs `current_exe()` with the parent's explicit `--config` / `--home`. `switch` runs a dirty check, `fetch <remote> +refs/heads/<B>:refs/remotes/<remote>/<B>`, `switch <B>` with a `switch -c <B> --track` fallback, then update, per machine; an update failure after the switch says the machine is now on `<B>`. Without `--yes`, `update` and `switch` print and run nothing.

All git, ssh, script and prompt invocations, including `update`'s pull, go through `exec::Exec` (`SystemExec`, stdin closed except for fleet login’s interactive run); fleet and pull tests use `exec::fake::FakeExec`, skills tests use real `git` on local repos. The harness plugin CLIs keep their own `plugins::Runner`, because each command carries per-harness env (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). Branch arguments go through `exec::check_branch` (a `check_ref` that also rejects `HEAD`, `refs/` and a leading `+`); skill refs through `check_ref`.

`fleet drift [--ignore KEY]... [--json]` queries `<bin> config show --json` with `ai_stack` and `invocation`, preserving explicit local flags and local/SSH path quoting. As with status's stray query, no `--stack` is added: the comparison is between stored effective settings. `[drift] ignore` and each machine's `drift_ignore` are combined at fleet load, then merged with CLI patterns. `drift::drift` compares the union of sorted keys using the same `config::glob` matcher as clean keep lists; only differing ignored keys are counted. Missing sides serialize as null. Every enabled machine is reported; command failures or malformed flat JSON are unavailable, failed process launches or SSH exit 255 are unreachable. Exit 0 requires all reports in sync. JSON is keyed by machine name with state, keys and ignored count, or a failure reason. No timeout, retry or fallback is added.

## Login status

`auth.rs` owns the const `PROVIDERS` descriptor table: id, display name, binary, headless login argv, read-only status argv, parser and optional expiry source (home environment variable, default directory, filename and reader). Add a provider with one table row and its parser, plus parser fixtures. The login column is the sole source of executable login argv; machine and provider inputs only select table entries. No logout command is implemented.

`Report` holds a provider id and `State`. `LoggedIn` alone carries account, expiry, source and optional refresh presence, so logged-out and absent providers cannot carry an expiry. The wire schema flattens these into `id`, `state`, and optional fields inside `{"providers":[...]}`; deserialization rejects unknown fields and invalid state combinations. Provider CLI output is parsed selectively because their schemas may grow. The `Exec` seam includes PATH availability, so tests use fakes without executing provider commands.

Claude uses `auth status --json`, Codex `login status` (including stderr), Cursor Agent `status --format json`, OpenCode `auth list` (ANSI stripped). OpenCode's configured-credential count means configured, not server-validated. Nonzero status exits may still convey a recognized logged-out result; other errors become fixed one-line unknown reasons and never stop the other providers. No timeout or retry is added. Local status exits 0 unless the command itself cannot run, such as an output-write failure.

Expiry readers return only numeric seconds and refresh presence. Codex decodes only its access JWT payload's numeric `exp`; Claude's Linux `claudeAiOauth.expiresAt` is milliseconds and is converted to seconds. File and decode errors collapse to `expiry unavailable`, with no path, token or JSON error included, and are omitted from reports. File resolution honors `CODEX_HOME` / `CLAUDE_CONFIG_DIR` and follows symlinks normally. Claude on macOS has no file reader and never invokes `security`. Cursor and OpenCode have no expiry reader; OpenCode's multiple independent credentials have no single access-token deadline. An expired access token does not override the status command's logged-in state. Refresh presence does not imply a successful future refresh.

`fleet auth [--json]` reuses `ai_stack` and `invocation` from fleet status, including explicit local `--config` / `--home`, custom binaries and remote path quoting; like status's stray query it does not add `--stack`. Each machine returns its local status JSON. Nonzero SSH exit 255 is unreachable, nonzero remote command exits and malformed, incomplete or duplicate-provider reports are unavailable. Raw stdout, stderr and deserialization errors are never echoed. Combined JSON is `{"machines":[{"machine":"name","providers":[...]},{"machine":"old","error":"unavailable (...)"}]}`. Exit 0 requires successful reports from every machine and every installed provider logged in without a known expired token that lacks a refresh token; unknown expiry is allowed, and an expired access token with a refresh token is healthy because the CLI renews it.

This uses the existing SSH transport: BatchMode, the owner's key authentication and LAN hosts. The remote side returns only status, never secrets. Credential files are read locally only to extract expiry and refresh presence; neither raw files nor tokens enter output, serialization or error text. Status checks invoke no keychain command, browser, login, logout or credential refresh.

## Fleet login

`fleet login <MACHINE> <PROVIDER>` resolves a named fleet entry, including disabled entries with a warning, and a provider id from `auth::PROVIDERS`. Unknown names list valid choices. stdin and stdout must both be terminals; the terminal check is injected into `Fleet::login` for fake-only tests.

The provider login column was checked against each installed Mac CLI's `--help`. Installed code was also inspected where help did not establish a headless flow:

| Provider | Login column | Headless mechanism |
| --- | --- | --- |
| Codex | `codex login --device-auth` | `--device-auth` selects device authorization instead of the default localhost callback. |
| Cursor Agent | `env NO_OPEN_BROWSER=1 cursor-agent login` | Login help documents `NO_OPEN_BROWSER`; `env` supplies it as static argv for both local and SSH execution. |
| OpenCode | `opencode auth login` | Its menu offers OpenAI → **ChatGPT Pro/Plus (headless)**. Installed code confirms device authorization and polling. The owner selects the provider and headless method; browser callback methods need a browser on the target. No extra flag is required to enter the menu. |
| Claude Code | `claude auth login` | The owner reports it prints a URL and asks for the code to be pasted back, which works through the ssh pass-through. An earlier inspection of an old installed build (2.1.63) suggested its CLI handler never read pasted input, but the Mac now has 2.1.301 and that inspection was not repeated, so this row is unverified by ai-stack. The follow-up status check reports the outcome either way. |

Before login, `<bin> auth status --json` runs through the existing `ai_stack` and `invocation` path. This delegates the PATH-availability check to the target's `auth::collect`; `not_installed` stops the flow. Unavailable or unreachable status also stops it. The same query runs after the login process exits, and only the selected provider's `Report::text` is printed, preserving account and expiry information. Exit 0 requires both login exit 0 and follow-up `LoggedIn`. Other login exits still get a status check; an SSH exit 255 immediately reports unreachable. A process killed by a signal fails. No timeout, retry or fallback is added.

The channel is SSH. Remote login reuses `invocation`'s single shell-quoted command line and adds `-tt`, yielding `ssh -tt -o BatchMode=yes <dest> -- <line>`. Key authentication and host trust must already work; there are no password prompts. LAN-only is the initial deployment, not an enforced network restriction. Local entries run the static argv directly, without a shell. The `Exec::interactive` seam inherits stdin, stdout and stderr and returns only the exit code (`None` for a signal); ordinary `Exec::run` paths remain captured with stdin closed.

Pass-through lets the provider handle its own URL, prompts, device polling and credential storage without ai-stack scraping provider output or parsing URLs. Login streams are inherited directly by the child: ai-stack never sees an authorization code or token, never captures login output and never supplies a secret to the remote side. The provider exchanges credentials with its authentication service. ai-stack introduces no daemon, callback port, credential store or secret forwarding. Existing status queries still extract only safe expiry metadata as documented above.

## Adding a harness

Cursor and OpenCode are not handled. Adding a harness needs:

- a `Harness` variant in `config.rs` with `as_str`, `name`, `instruction_file`, `instructions_stem` and `skill_folder` arms (the compiler finds every other `match`);
- `[harness.<name>]`, `[leads]`, `[review]` and `[sheet.<name>]` entries (`HarnessSection`, `PerHarness`, `config.default.toml`) and its model-sheet wording in `render.rs`;
- plugin CLI wiring in `plugins.rs`: the marketplace manifest path, the install, list and remove commands and their JSON shapes, the home env var, and the fake runner;
- the harness's user skill folder for standalone skills in `skill_folder`, checked against the harness's own loader. A folder another harness already uses is linked once.

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
- **Exact ownership.** Links count as ai-stack's only when they resolve into the stack or a legacy root; hooks only when the command is one of the exact old forms for those roots; agent files only with the managed marker. In a user skill folder, an owned link a global group wants is kept or repointed, and only an owned link no group wants is unlinked. `--clean` and `stray` never count an owned link.
- **Stray skills are moved, never deleted.** A directory, file or foreign link at a name the stack links is a conflict. `--force` (or `--clean`) moves it into the backup first.
- **The jm marketplace is ai-stack's.** A `jm` plugin the checkout no longer lists is removed on every install, with its reinstall command in `removed-plugins.json`. Plugins from other marketplaces are only removed with `--clean`.
- **stack.toml is checked at the boundary.** Every command that reads it validates names, includes, membership and the `skills/` tree first, so a bad file plans nothing.

## Modules (`src/`)

- `main.rs`: CLI parsing, commands, `git pull`, model reports and bump.
- `config.rs`: schema, validation, descriptor rules.
- `render.rs`: sheet and routing text.
- `blocks.rs`: marker-bounded blocks.
- `install.rs`: the per-harness plan, including the instructions block and the skill links.
- `plugins.rs`: plugin commands and the runner seam.
- `plan.rs`: actions, diffs, backups, apply.
- `models.rs`: catalogs and `--bump`.
- `exec.rs`: process seam, `shell_quote`, `check_ref`, `check_branch`, commit text helpers.
- `stackfile.rs`, `skills.rs`: `stack.toml` (groups and vendored skills) and the `skills` commands.
- `groups.rs`: the `groups` report and frontmatter reading.
- `fleet.rs`: fleet file and commands.
- `drift.rs`: flat config maps, pure key comparison and value rendering.
- `auth.rs`: provider table, login-status domain and wire reports, parsers, expiry readers and rendering.
- `tui.rs`: review screen.
