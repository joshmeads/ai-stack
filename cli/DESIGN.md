# ai-stack CLI design

The CLI turns one config into a per-harness setup of the stack: the `jm` plugin marketplace with its one plugin, `jm-stack`, and the standalone skills of the global groups in `stack.toml`. The plugin carries jm:stack's skills, agents and hooks; the CLI writes only what differs per user and per harness (the model sheet, the routing block and the owner's global instructions), installs the plugin, links the standalone skills, and cleans up after older installs. It has one install mode: edit in place, idempotently, with `--force` for an unmanaged model sheet or a stray skill in a skill link's way.

## Commands

- `config show [--json]`: print sorted, flattened effective config without writing.
- `init [--force]`: write `config.default.toml` unchanged to the config path with both harnesses enabled, and print detection results. Runtime detection skips missing CLIs.
- `diff [--clean]`: build the plan and print it. Exit 0 when empty, 1 otherwise. Runs only the read-only plugin `list --json` queries.
- `stray [--json]`: build the plan with `clean: true` and report `Plan::stray`: the skill folder entries `links` classified as stray (see Skill folders), as sorted home-relative paths, and the ids of the commands with `clean` set. ai-stack's own links and the removal of stale `jm` plugins never count. Install conflicts and stray counts come from the same classification. It plans with `Options::report`, so no stray tree is fingerprinted and no `git` runs; `apply` refuses a report plan. Same read-only queries as `diff`; exit 0.
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

`install::plan(cfg, opts, runner)` first filters enabled harnesses through `Runner::available`, adding a skip notice to `warnings` for each missing CLI. A command-scoped `SystemRunner` snapshots executable availability on `PATH` once, using the same check as auth; TUI replans and apply reuse it. Tests inject availability through `FakeRunner`. The effective config excludes missing harnesses. Skill-folder planning excludes cleanup folders that overlap their homes or skill folders, resolving aliases; user skill folders shared with an available harness retain their active role. If every enabled harness is skipped, the plan is empty and succeeds. Explicitly disabled harnesses get no skip protection from independently configured clean roots. Otherwise it loads and validates `<stack>/stack.toml` (an invalid file fails the plan), builds `links::Owner` once, then returns a `Plan` of file actions (`Write`, `Remove`, `Unlink`, `ReplaceWithFile`, `MoveToBackup`, `Link`), plugin `commands`, `conflicts`, `warnings` and `stray`. For each available enabled harness:

1. **Sheet.** `<home>/pstack-models.md` from `render::sheet`. First line `render::MANAGED_MD`; setup-stack's managed-sheet check matches its `<!-- Managed by ai-stack` prefix. Absent or managed: write if changed. A symlink into the stack or a legacy root (`Owner::owns`): replace. Anything else: conflict, or replace with `--force`.
2. **Instruction file** (`Harness::instruction_file`). Resolve a symlink to its target (write-through). Validate markers. Remove `open-pstack:local` and every `ai-stack:*` block except `instructions`, `routing`, `pstack-models` and Claude's `anthropic-guidance`. Claude: remove other `@` lines that resolve to this sheet. Upsert `instructions` from `<stack>/instructions/common.md` and `<stack>/instructions/<Harness::instructions_stem>.md` (each trimmed, blank or absent skipped, joined by a blank line), or remove it when both are absent; a source containing an `<!-- ai-stack:`, `<!-- pstack:` or `<!-- open-pstack:` marker is a conflict naming the file. The text is always inlined, never `@`-imported, so every harness gets the same mechanism. Upsert `routing` (`render::routing`). Claude: upsert `pstack-models` with `@<abs sheet path>`. Codex: upsert the `pstack:models` mirror with the exact sheet bytes.
3. **Claude settings.json.** Write-through as above. Unparsable JSON is a conflict and the file is untouched. Remove hook commands that exactly match the old forms (`bash <root>/plugins/pstack/hooks/session-start`, optionally quoted and followed by `| sed 's/pstack://g'`; `python3 <root>/scripts/task-context.py`, optionally quoted) for the stack or a legacy root. A group loses only those commands; a group or event list emptied by the removal is dropped. Written only when something was removed.

Then, once for all harnesses:

4. **Skill folders** (`links::plan`, below).
5. **Plugins** (`plugins::plan`, after all file actions). Check that the stack's harness manifest (`.claude-plugin/marketplace.json` or `.agents/plugins/marketplace.json`) names `jm` and lists every plugin in `PLUGINS` (only `jm-stack`); otherwise conflict. When the harness home does not exist yet, plan every command. Otherwise query `plugin marketplace list --json`: absent means add the marketplace and install every plugin; another source is a conflict; the stack means query `plugin list --json`. Every installed `<name>@jm` the manifest does not list gets a removal (`plan_removal`, shared with `--clean`, with `clean: false`) before the installs. Its `undo` is `Restore::Retired`, because no CLI can reinstall a plugin its marketplace dropped. Apply turns it into a note when it writes `removed-plugins.json` (`retired_note`): the newest commit on HEAD's history whose harness manifest lists the plugin and whose tree has a `SKILL.md` under the plugin's source directory. A commit that lists the plugin after its skills moved out cannot restore it, so for `jm-games` and `jm-tools` the note names the parent of `8b08520`. A `git log -S` check skips the walk for a plugin no commit ever named. Then install each missing plugin, plus, for Codex, each whose installed version differs from the checkout's `.codex-plugin/plugin.json`. A missing CLI is skipped before planning; a failed query from an available CLI is a warning and plans every command (both CLIs treat repeats as no-ops). `CLAUDE_CONFIG_DIR` / `CODEX_HOME` is set on a command only when the harness home differs from what the CLI would use.

With `--clean` (`Options::clean`), `links::plan` adds the stray moves, and `plugins::plan_clean` adds an uninstall (Claude user scope), disable (Claude `synced` scope, which the CLI cannot uninstall) or `codex plugin remove` for every listed plugin `Clean::keeps_plugin` rejects, except `jm` plugins, which step 5 owns. Those commands carry `Restore::Command` undo args and `clean: true`, and come before every install command. Apply records every command with an `undo` in `removed-plugins.json` in the backup dir.

### Skill folders

`links.rs` owns every skill folder ai-stack touches. `index` resolves each folder once with `paths::resolve` and merges folders that resolve alike, keeping the first spelling for actions and the union of their roles: `links` (each harness's user skill folder, `Harness::skill_folder`), `leftover` (each harness's `<home>/skills` and `<home>/agents`), `agents` (`<home>/agents`) and `clean` (each `[clean] skill_roots` entry). A symlinked `~/.codex/skills`, or a `~/.claude/skills` that is `~/.agents/skills`, is one folder with several roles, so no entry is planned twice.

`paths::resolve` has lstat semantics. It walks the path one component at a time, replaces each existing symlink with its target even when that target is missing (at most 40 times, then the rest is taken as written), resolves `..` against what it has resolved so far, keeps missing components as written, and finally canonicalizes the existing prefix, which also gives a case-insensitive disk's spelling. The skill folders, link ownership, the sheet import check and old hook commands all use it, so `/tmp` and `/private/tmp` match everywhere.

`Owner` holds the stack and the legacy roots, resolved once, and the ledger. `target_of` resolves a link target's parent and keeps its last component as written, so a link to `<stack>/skills/<name>` stays a link into the stack when that skill directory is itself a symlink, while `<stack>/escape/../x` leaves through `escape` even when `escape` dangles. A link is ours when the ledger records its path with the same target text, or when `target_of` lies inside the stack or a legacy root.

The ledger is `<home>/.local/state/ai-stack/links.json` (`ledger.rs`): `{"version":1,"links":{<link path>:<target text>}}`, keyed by the folder's resolved path joined with the entry's name. Apply records each `Link` it makes and drops each path it unlinks or moves, applying those changes to the file as it is then, so entries apply did not touch stay, and writes it atomically, also after a failed action. A missing, unreadable or malformed ledger records nothing and never blocks a plan. It is what keeps a link made by `install --stack <other>` ours after that checkout is deleted, and what keeps a link into an unrelated repo stray.

`read` classifies each entry of a folder once, skipping dot entries: `Ours` (a link `Owner` claims, with its target text and resolved target), `Protected` (a directory or file whose resolved path holds the stack or a legacy root), `ManagedAgent` (in an agents folder, a regular file with `render::MANAGED_MD` or a first line of `render::MANAGED_TOML`) or `Stray`. The wanted names are `StackFile::global_skills()` whose `skills/<name>/` exists (a missing one is a warning) in a `links` folder, and none elsewhere. The entry at a wanted name is found by exact name, else by lstat device and inode, so a case-insensitive disk's `HANDOFF` is the entry at `handoff`; a displaced entry keeps that on-disk path for its backup and the action text. `plan_folder` then derives every action:

| Entry | Action |
| --- | --- |
| Ours, wanted, `target_of` is `<stack>/skills/<name>` resolved, same name | none |
| Ours, wanted, other target or other on-disk name | `Link { displaces: OwnLink { entry, target } }` |
| Ours, not wanted, in a `links` or `leftover` folder | `Unlink` |
| ManagedAgent | `Remove` |
| Protected | conflict naming the entry and the checkout it holds |
| Stray, wanted | in `Plan::stray`; a conflict, unless `--clean` moves it (a `clean` folder and `keep_skills` does not match) or `--force`: `Link { displaces: Stray { entry, fingerprint, clean } }` |
| Stray, not wanted, in a `clean` folder, not kept | in `Plan::stray`; with `--clean`, `MoveToBackup { clean: true }` |
| Wanted name absent | `Link { displaces: Nothing }` |

Before any of that, a folder that resolves inside the stack or any legacy root (including the configured checkout during `--stack`) is a conflict and gets no action: `~/.claude/skills -> <stack>/skills` would otherwise move a checkout's own sources. A `links` folder with wanted skills that does not exist because it, or an ancestor, is a symlink to a missing directory is a conflict naming that target. Within a folder the actions run in entry order, then the links in name order. Every folder-entry action carries the folder's `Anchor`: its resolved path and its device and inode (none when it did not exist yet).

The `Runner` trait is the seam for the CLIs. `SystemRunner` runs the binaries from `PATH` with stdin closed; tests use `plugins::fake::FakeRunner`, which keeps marketplace and plugin state and answers the list queries in each CLI's JSON shape.

## Apply

`plan::apply(plan, backup_root, runner)` refuses on conflicts and on a report plan, re-verifies every file action against the state it was planned from (for a folder-entry action, also that its folder still resolves to the anchored path and is the anchored directory, checked again right before the action runs), backs up each existing target under `<backup_root>/<unix-time>[-n]/{home,abs}/`, applies the file actions, then runs the commands in order. A `Link` verifies what it displaces (`Displaced::Nothing`: the path is absent; `OwnLink`: the same link target at `entry`; `Stray`: the same lstat fingerprint at `entry`) and backs it up as part of the same action: a repointed link is copied into the backup, a stray is moved there, both under the entry's on-disk name. A new link creates its folder. Apply then updates the ledger with the links it made and removed. A failed command stops apply with its stderr; the file changes already made stay, and the next run plans only what remains.

## Skills

`stackfile.rs` owns `<stack>/stack.toml`. `StackFile` is `groups: BTreeMap<GroupName, Group>` plus the vendored `skills: Vec<Skill>` (`[[skill]]`). `Name` (aliased `GroupName` and `SkillName`) is validated when parsed, so it is always one safe path component; `Skill::name` and `Skill::rename` are `SkillName` too, and the CLI parses `--name` and `--move` into it. A `Group` has `global` (default false), `includes` and `skills`. `resolve(groups, roots)` is the pure closure over `includes`, returning each skill once; `global_skills()` resolves every global group. `validate()` checks the file alone: vendored entries (below), unknown includes, include cycles (reported as `a -> b -> a`), a skill listed twice in one group, two members anywhere that differ only by case, and that every vendored skill installed into `skills/` (`Skill::is_standalone`) is a group member. `check_skills_dir(stack)` checks it against the tree: every member is `skills/<name>/` with `SKILL.md` (a vendored member may be missing), and every non-dot directory in `skills/` is in a group. `load` runs both and prefixes errors with the file path; an absent file is an empty one. Every error names the offending key, such as `[groups.games] includes` or `[[skill]] "grill"`. A test loads the repo's own `stack.toml` against its `skills/`.

The `[[skill]]` schema is (`name`, `source`, `path`, `ref`, `commit`, `dest`, `move`, `process` as one-or-many `{type, input}`) and its validation: `[A-Za-z0-9._-]+` not starting with `.` for `name` and `move`; plain relative components for `path` (or exactly `.`), `dest` (no `.git` component, and inside `skills/` only as `skills` itself, both compared without case) and script inputs; no prompt starting with `-`; a valid git ref; one entry per installed directory and per name or installed name, compared without case. The default `dest` is `skills`, which makes a standalone skill. Another `dest` vendors a skill where a plugin reads it; only a hand-written entry has one. `check_dests(stack)` resolves `<stack>/<dest>` with `paths::resolve` and refuses one outside the stack, inside `.git`, or inside `skills/` unless `dest` is exactly `skills`; `load` and `skills add` run it, so a symlink or `.GIT` spelling cannot reach git's refs. `edit(stack, ops)` is the only writer. Its operations are `Op::AddMember` (append to `[groups.<g>] skills`), `Op::PushSkill` (append a `[[skill]]`) and `Op::SetSkill` (set `ref` and `commit` on one named entry). They apply with `toml_edit` to the text read at write time, so concurrent edits to other keys survive. Groups may be tables, dotted keys or inline tables; entries may be an array of tables or an array of inline tables; any other shape is an error. The result must parse, validate and show each operation's change, or nothing is written. The write goes through `paths::write_through` and `plan::write_atomic` with the file's mode. A value keeps its comment. An item appended to a multi-line array goes on its own line with the last item's indentation, the last item gets a comma, and a comment that trailed it stays on its line. A new entry leaves out `ref` and `dest` at their defaults. There is no stack-level stamp; the stack's own history is its git log.

`skills.rs` resolves a ref with `git ls-remote` (peeled tag, exact name, `refs/heads/`, `refs/tags/`; a 40-hex ref is used as is), fetches the commit into a throwaway repo, refuses the skill when its path or any ancestor is a symlink or any symlink exists in its tree (`.git` skipped), stages the copy in `<stack>/.ai-stack/stage/` (same filesystem as every target, git-ignored), applies `move` to the directory name and the frontmatter `name:` line, runs the process steps in order with the staging directory as cwd, then swaps with two renames: the old target into a reserved directory in the stage, the staged copy into place. The skill is absent for the moment between them; a crash there leaves the old tree in `.ai-stack/stage/`. If the second rename fails the old tree is renamed back; if that also fails it is kept and its path is in the error. After the process steps the staged directory must hold a regular-file `SKILL.md`, or the install fails before the swap. Every `skills` subcommand clears `.ai-stack/stage/` first. `add` requires `--group`, an existing group, and always installs into `skills/`. It validates the whole file with the new entry and member, the dests and the target with a placeholder commit before `git ls-remote` runs, then resolves the commit, installs, and records the skill with `AddMember` and `PushSkill`; when that edit fails it removes the directory it just installed. A local source is stored canonicalized. `update` rebuilds a missing target without the guard, otherwise checks `git status --porcelain --untracked-files=all --ignored=matching -- <target>` before replacing anything, keeps going after a failed entry, and records every changed entry with one `edit` of `SetSkill` operations at the end. `--ref` changes the tracked ref of the named entries; `--reprocess` falls back to the pinned commit when the unchanged ref cannot be resolved. `status` reports `missing` for an absent target.

`groups.rs` builds the `groups --json` report from `stack.toml` and each member's `SKILL.md` frontmatter (`frontmatter_value` reads plain, quoted and `>` / `|` block values). A budget is `ceil(chars / 4)`, with `chars` summed over the `name` and `description` values of the skills counted; a missing `SKILL.md` counts zero.

The JSON is the contract the Swift app reads ([ADR 0002](../docs/adr/0002-swift-app-drives-the-cli.md)), version 1:

```json
{"version":1,"groups":[{"name":"games","global":true,"includes":["threejs"],"skills":["game-gdd","grill","threejs"],"missing":["grill"],"tokens":812}],"global":{"skills":["game-gdd","grill","threejs"],"missing":["grill"],"tokens":812}}
```

- `version`: the shape's version. A change to an existing field's meaning bumps it; new fields do not.
- `groups`: every group in name order. `skills` is the group's resolved members after includes, sorted. `missing` is the vendored ones among them that `skills update` has not built yet; they count zero tokens and install skips them. `tokens` is the budget of `skills`.
- `global`: the union of the global groups, each skill once, with its own `missing` and `tokens`.

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
- **Stale plans are refused.** `Write`/`Remove` compare text, `Unlink` and a repointing `Link` compare the link target, folder-entry actions compare their folder's anchor, `ReplaceWithFile`, `MoveToBackup` and a `Link` over a stray compare an lstat fingerprint of the whole tree, and a new `Link` needs the path to be absent.
- **Skills stay inside the stack.** Manifest paths are validated at load and on every write, so no entry can address a directory outside the stack.
- **No upstream symlinks.** A vendored skill that is, sits under or contains a symlink is refused, so nothing upstream can point a copy or a `move` rewrite outside the stack.
- **Skill replace by rename.** A skill is built in `.ai-stack/stage/` and swapped in by two renames; a failed fetch, `move` or process step leaves the installed skill as it was.
- **Dirty guard.** `skills update` refuses to replace a skill directory with uncommitted, untracked or ignored files unless `--force`.
- **Branch guard.** `update` pulls only into a checkout already on the branch it pulls.
- **Process steps run arbitrary code by design.** Scripts and prompt runners run with the user's permissions in the staging directory.
- **Fleet never forces.** `switch` refuses a dirty checkout and never uses `-f` or `-B`; branch names are validated before they reach any command line.
- **Exact ownership.** Links count as ai-stack's only when the ledger records them with the same target or their target, resolved through the filesystem, lies in the stack or a legacy root; hooks only when the command resolves to one of the exact old forms for those roots; agent files only with the managed marker. In a user skill folder, an owned link a global group wants is kept or repointed, and only an owned link no group wants is unlinked. `--clean` and `stray` never count an owned link.
- **One decision per entry.** Each skill folder is resolved once and each entry classified once, so aliases of one folder never plan two actions for one entry, and `stray` and install conflicts read the same classification.
- **Checkouts are never skill folders.** A skill folder that resolves inside the stack or a legacy root, and a folder entry that holds one, are conflicts, even with `--force`.
- **Apply stays in the planned folder.** A folder-entry action is refused when its folder now resolves elsewhere or is another directory.
- **Stray skills are moved, never deleted.** A directory, file or foreign link at a name the stack links is a conflict. `--force` (or `--clean`, when `keep_skills` does not match it) moves it into the backup as part of the link.
- **The jm marketplace is ai-stack's.** A `jm` plugin the checkout no longer lists is removed on every install. `removed-plugins.json` records `"reinstall": null` and a note naming the last stack commit that lists it. Plugins from other marketplaces are only removed with `--clean`.
- **stack.toml is checked at the boundary.** Every command that reads it validates names, includes, membership and the `skills/` tree first, so a bad file plans nothing. `skills add` checks every argument before the network, and `add` and `update` write `stack.toml` only after a staged skill with a `SKILL.md` is in place, and `add` removes the new skill again when the write fails.

## Modules (`src/`)

- `main.rs`: CLI parsing, commands, `git pull`, model reports and bump.
- `config.rs`: schema, validation, descriptor rules.
- `render.rs`: sheet and routing text.
- `blocks.rs`: marker-bounded blocks.
- `install.rs`: the plan: the per-harness sheet, instruction blocks and settings hooks, then the skill folders and plugins.
- `links.rs`: skill folders: the canonical folder index, link ownership, entry classification, links, leftovers and strays.
- `plugins.rs`: plugin commands and the runner seam.
- `plan.rs`: actions, diffs, backups, apply.
- `paths.rs`: `~` expansion, lexical `normalize`, `resolve` through the filesystem with lstat semantics, and `write_through`.
- `ledger.rs`: `links.json`, the skill links ai-stack made.
- `models.rs`: catalogs and `--bump`.
- `exec.rs`: process seam, `shell_quote`, `check_ref`, `check_branch`, commit text helpers.
- `stackfile.rs`, `skills.rs`: `stack.toml` (groups and vendored skills) and the `skills` commands.
- `groups.rs`: the `groups` report and frontmatter reading.
- `fleet.rs`: fleet file and commands.
- `drift.rs`: flat config maps, pure key comparison and value rendering.
- `auth.rs`: provider table, login-status domain and wire reports, parsers, expiry readers and rendering.
- `tui.rs`: review screen.
