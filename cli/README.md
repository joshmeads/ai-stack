# ai-stack CLI

`ai-stack` sets up this repository's `jm-stack` plugin and standalone skills in Claude Code (`~/.claude`) and Codex (`~/.codex`) from one config file. For each enabled harness it:

1. adds the stack checkout as the local `jm` plugin marketplace and installs `jm-stack` through the harness's own CLI, removing any other installed `jm` plugin the checkout no longer lists;
2. links each skill of the global groups in `<stack>/stack.toml` into the harness's user skill folder (see [Skills and groups](#skills-and-groups));
3. writes the jm:stack model sheet `<home>/pstack-models.md` and wires it into `CLAUDE.md` (an `@` import) or `AGENTS.md` (a mirror of the sheet);
4. writes one `ai-stack:routing` block into `CLAUDE.md` or `AGENTS.md`;
5. writes your own global instructions from `<stack>/instructions/` into the same file (see [Global instructions](#global-instructions));
6. removes what older ai-stack installs left behind.

It shows the plan before changing anything, backs up every file or link it replaces or removes, and is idempotent: a second run reports `No changes.` Installation for Cursor and OpenCode is not handled.

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
| `ai-stack config show [--json]` | Print effective config as sorted dotted keys, preserving paths as written. Read-only; exit 0. |
| `ai-stack fleet drift [--ignore KEY]... [--json]` | Compare every enabled machine with local config; exit 0 when all are in sync, otherwise 1. |
| `ai-stack init [--force]` | Write the default config to `~/.config/ai-stack/config.toml`. Refuses to overwrite unless `--force`. |
| `ai-stack diff [--clean]` | Print the install plan with unified diffs and the plugin commands it would run. Exit 0 when nothing would change, 1 when changes or conflicts are pending. It runs only the read-only `plugin marketplace list --json` and `plugin list --json` queries. `--clean` adds the clean actions (see [Clean](#clean)). |
| `ai-stack stray [--json]` | Report the stray skills and the plugins `--clean` would remove: `skills: N  plugins: M`, then each stray skill (as a `~/` path) and plugin id, indented. A stray skill is an entry `--clean` would move or one in a skill link's way, including one `keep_skills` matches, so `stray` names every entry that blocks an install. ai-stack's own skill links and `jm` plugins are never stray. `--json` prints `{"skills":N,"plugins":M,"skill_names":[...],"plugin_ids":[...]}` on one line. Runs only the same read-only queries as `diff`; never writes. Exit 0. |
| `ai-stack install [--yes] [--force] [--plain] [--clean]` | Build the plan, review it in the TUI (or print it with `--plain`), then apply. `--yes` applies without review. `--force` replaces an unmanaged `pstack-models.md` and moves a stray skill out of a skill link's way, after backing them up. `--clean` also removes skills and plugins outside the keep lists. Conflicts are printed and never applied. |
| `ai-stack update [--yes] [--plain] [--bump-models] [--branch B]` | Run `git pull --ff-only <remote> <branch>` in the stack checkout, check models, then install. `--branch` pulls that branch instead of `stack.branch` for this run only; the config is not changed. It refuses when the checkout is on another branch or a detached HEAD, naming both and suggesting `ai-stack update --branch <current>` or `git switch <branch>`, so a pull never merges one branch into another. If the pull changed files under `cli/`, it prints a note to rebuild with `cargo install --path <stack>/cli`; it never rebuilds itself. |
| `ai-stack models [--bump]` | Report each configured model as `current`, `newer: <id>`, `missing` or `unknown: <reason>`. `--bump` rewrites config IDs to the newest model in the same family. |
| `ai-stack skills add <SOURCE> <PATH> --group GROUP [--ref REF] [--move NAME] [--process-script PATH \| --process-prompt TEXT] [--name NAME]` | Vendor the skill directory `PATH` from the git repo `SOURCE` into `<stack>/skills/`, record it in [`stack.toml`](#vendored-skills) and add it to the existing group `GROUP`. Refuses when the group does not exist, when another entry already installs that name, or when the directory exists; every argument is checked before any network call. A source whose directory has no `SKILL.md` file after the process steps is refused, and the stack is left unchanged. |
| `ai-stack groups [--json]` | Print each group in `stack.toml`: whether it is global, its skills after includes, and an estimated token cost; then the global set (the union of the global groups, each skill once). See [Skills and groups](#skills-and-groups). Read-only; exit 0. |
| `ai-stack skills status` | Print `name  installed-name  <commit>  current \| behind: <latest> \| missing \| unknown: <reason>` per vendored skill. `missing` means the installed directory is gone; `skills update` rebuilds it. Exit 0 when every entry is current, 1 otherwise. A network error is `unknown`. |
| `ai-stack skills update [NAME...] [--ref REF] [--reprocess] [--force]` | Rebuild the named entries (default all) whose upstream ref moved. `--ref` retargets the named entries to another upstream branch or tag and records it. `--reprocess` rebuilds every selected entry even when upstream has not moved, from the commit its ref names now; when the ref cannot be resolved (offline, or the branch is gone) it rebuilds from the pinned `commit` and says so. A missing skill directory is always rebuilt. Refuses to replace a skill directory with uncommitted, untracked or ignored files unless `--force`. One failure does not stop the rest; exit 1 if any failed. |
| `ai-stack auth status [--json]` | Report local Claude Code, Codex, Cursor Agent and OpenCode login status. Read-only; exit 0 even when a provider is unavailable. |
| `ai-stack fleet auth [--json]` | Report those providers on every enabled fleet machine. Exit 0 when every machine reports successfully and every installed provider is logged in with no expired access token that lacks a refresh token; otherwise 1. |
| `ai-stack fleet login <MACHINE> <PROVIDER>` | Run a supported provider’s headless login on one fleet machine through your terminal, then print its status. Requires terminal stdin and stdout; exit 0 only when login succeeds and the provider reports logged in. |
| `ai-stack fleet init [--force]` | Write a commented `fleet.toml` beside the config file. |
| `ai-stack fleet status` | Print `machine  <branch>  <commit>  current \| behind \| ahead \| different \| unknown (fetch first) \| detached \| unreachable: <reason>`, comparing each machine's stack commit with the remote tip of its own branch, then, for each reachable machine, `  stray: N skills, M plugins` from `<bin> stray --json` on that machine, or `  stray: unavailable (<reason>)` when it fails (for example an older ai-stack there). Exit 0 when all are current; the stray line never changes it. |
| `ai-stack fleet update [--yes] [--branch B]` | Run `<bin> --stack <stack> update --yes --plain --branch <B>` on every enabled machine, `B` being `--branch` or that machine's current branch. Without `--yes`, print the commands and exit 1. |
| `ai-stack fleet switch <BRANCH> [MACHINE...] [--yes]` | On the named machines (default all enabled): fetch `BRANCH`, check it out (creating a tracking branch when needed), then update with `--branch BRANCH`. Without `--yes`, print the commands and exit 1. |

Global flags, valid on every command:

- `--config <PATH>`: config file. Default `<home>/.config/ai-stack/config.toml`.
- `--home <DIR>`: home directory. Default `$HOME`.
- `--stack <DIR>`: use this checkout instead of `stack.path` from the config. Links and hooks into the configured checkout are still ai-stack's: a skill link a global group wants is repointed to the override, and the rest are removed as leftovers. The next install without `--stack` repoints the links back, because a link to `<checkout>/skills/<name>` of any checkout with a `stack.toml` counts as ai-stack's in a skill folder.
- `--version`.

Exit codes: 0 for success, 1 for pending changes that were not applied, conflicts, or a declined review, and a non-zero error exit for failures such as an unreadable config, a failed `git pull` or a failed plugin command.

## Login status

`ai-stack auth status` checks binaries on `PATH`, then runs `claude auth status --json`, `codex login status`, `cursor-agent status --format json` and `opencode auth list`. Each provider reports `logged in`, `logged out`, `not installed` or `unknown (<reason>)` independently. OpenCode reports whether provider credentials are configured; this does not validate them with a server. These commands never log in or out. They run without a timeout.

Expiry is an access-token deadline, not the lifetime of the account or subscription. Codex can report the numeric `exp` claim from the access-token JWT in `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`, following symlinks). Claude on Linux can report `claudeAiOauth.expiresAt` from `$CLAUDE_CONFIG_DIR/.credentials.json` (default `~/.claude/.credentials.json`). Claude on macOS uses the keychain, which ai-stack never queries. Cursor and OpenCode expiry is unknown; OpenCode may have several independent provider credentials. Missing, unreadable or unfamiliar credential files also leave expiry unknown, with no expiry text.

Known expiry prints a UTC date and `access token expires in Nd`, or `access token expired` when the deadline has passed. A status command that says logged in remains logged in even when its access token has expired. `refresh available` appears alongside expiry only when the file or CLI explicitly indicates a refresh token exists; ai-stack does not refresh it or predict whether refresh will succeed.

`--json` emits one line with `providers`, each containing `id`, `state` (`logged_in`, `logged_out`, `not_installed`, `unknown`) and optional `account`, `expires_at` (Unix seconds), `expiry_source`, `refresh_available`, or `reason`. Secrets are never read into output: credential readers extract only expiry and refresh presence, and provider diagnostics are reduced to fixed reasons rather than echoing raw command output or credential parsing errors.

`ai-stack fleet auth` uses the same local binary selection and SSH quoting as `fleet status`, running `<bin> auth status --json` on each enabled machine. Older binaries report `unavailable`; SSH transport failures report `unreachable`. `--json` emits `{"machines":[{"machine":"name","providers":[...]},{"machine":"old","error":"unavailable (...)"}]}`. Missing providers do not fail the check; logged-out, unknown, expired (with no refresh token), unavailable or unreachable results do. An expired access token with a refresh token present does not, because the CLI renews it itself. Unknown expiry alone does not fail it. Local auth status needs no ai-stack config file; fleet auth uses the normal fleet config.

## Logging in over the fleet

```sh
ai-stack fleet login cachy codex
ai-stack fleet login cachy cursor
ai-stack fleet login cachy opencode
```

Choose a machine name from `fleet.toml` and a provider id: `claude`, `codex`, `cursor` or `opencode`. A disabled machine is allowed with a warning. ai-stack checks that the provider is installed on the target's `PATH`, prints what will run and where, and connects the provider directly to your terminal. Open the printed URL in a browser on your own device, then paste a code into the same terminal if prompted, or finish the device authorization in your browser. After the process exits, ai-stack prints that provider's status, including account and expiry when available. Login must exit successfully and the follow-up status must say `logged in` for exit 0; other results exit 1. SSH exit 255 reports `unreachable`.

The initial deployment uses LAN machines. Remote login requires SSH key authentication already working and the host key already trusted. It runs `ssh -tt -o BatchMode=yes <dest> -- <one shell-quoted command line>` with inherited stdin, stdout and stderr. BatchMode prevents password prompts; `-tt` allocates the remote terminal. Both stdin and stdout must be terminals, so piping or redirecting either is refused. A `local = true` entry runs the same login argv directly. The status checks use the same `<bin>` selection as `fleet auth`; the target needs an ai-stack binary that supports `auth status --json`.

| Provider id | Headless login argv | Browser on another device |
| --- | --- | --- |
| `codex` | `codex login --device-auth` | Device authorization; avoids the default localhost callback. |
| `cursor` | `env NO_OPEN_BROWSER=1 cursor-agent login` | Prints the login URL without opening a browser on the target. |
| `opencode` | `opencode auth login` | In its menus, choose OpenAI, then **ChatGPT Pro/Plus (headless)** for device authorization. Choose a headless method when using another provider; browser callback methods require a browser on the target. |
| `claude` | `claude auth login` | Prints a login URL and asks for the code to be pasted back. Taken from the owner's experience of the flow, not exercised by ai-stack's tests; if a machine's Claude version instead waits on a localhost callback, the login fails and the status check says so. |

The provider owns credential storage. Login codes and tokens never pass through ai-stack's application code: inherited terminal streams go directly to the provider (through SSH for remote machines). ai-stack does not capture login output, parse URLs, read codes, forward tokens, or store credentials. The read-only status checks retain the expiry handling described above. There is no new daemon, port, timeout or retry added by ai-stack.

## Config

`config.default.toml` in `cli/` is the reference that `ai-stack init` writes.

- `[stack]`: `path` is the checkout of `joshmeads/ai-stack`. `remote` and `branch` are used by `update`. `legacy_paths` lists older checkout roots. `~` is expanded and relative paths resolve against the invocation directory.
- `[harness.claude]`, `[harness.codex]`: `home` and `enabled`. A disabled harness is skipped entirely.
- `[models.<alias>]`: `provider` (`anthropic` or `openai`), the exact model `id`, optional `efforts` (the efforts a route on this model may name; it must then name one), and optional `context` (usable context in tokens). The defaults define `sol`, `luna`, `opus` and `haiku`, with `haiku` at 100000. The owner sets Haiku's compaction in Claude Code at 100k because Anthropic bills the whole request at 5x past 100k tokens; ai-stack only states the limit in the routing block. `ai-stack models` checks these IDs against the provider catalogs.
- `[leads]`, `[review]`: one `"alias@effort"` route per harness. The lead is described in the routing block; install does not change either CLI's default model. The review model is named in the routing block and used by the `art-iteration` skill's critic.
- `[sheet.claude]`, `[sheet.codex]`: the 15 jm:stack model-sheet rows for that harness. Each lane is a provider-qualified descriptor `<provider>:<model>@<effort>` from the jm-stack provider-dispatch reference, or `inherit-parent` / `auto`. The loader accepts providers `claude` (models `opus`, `haiku`, `fable`) and `codex` (models `gpt-6.1-sol`, `gpt-6-luna`), efforts `low` to `max`, and `ultra` for `gpt-6.1-sol` only. The four panel rows (`arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`) accept arrays. The Why and Reflect rows must be `inherit-parent` or `auto`, because those roles need the parent's MCP servers.

- `[skills]`: `prompt_runner`, the argv that runs a `type = "prompt"` process step, with the prompt appended as the last argument. Default `["claude", "-p", "--permission-mode", "acceptEdits"]`. A config without `[skills]` gets the default.
- `[clean]`: what `--clean` keeps. `skill_roots` (default `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, resolved against `--home`), `keep_skills` (globs over entry names) and `keep_plugins` (globs over `name@marketplace`; the defaults keep `github@claude-plugins-official`, `chrome-devtools-mcp@claude-plugins-official` and Codex's built-in `*@openai-*`). `--clean` never touches a `jm` plugin: install owns that marketplace. Globs use `*` and `?`. A config without `[clean]`, or without one of its keys, gets the defaults that `init` writes.

A config from an older ai-stack (with `[roles]`, `[stack.models]` or `[install]`) is rejected with a message to run `ai-stack init --force` and re-apply your edits.

## Config drift

`ai-stack config show` prints effective `config.toml` settings as sorted dotted keys with scalar or JSON-array values. `--json` prints one object. Defaults are filled in, including omitted `[clean]` settings, and disabled harness settings are included. Paths retain their spelling in the file (`~` is unexpanded). Only the config schema is included: this config holds no secrets, and credential files, harness configuration files and `fleet.toml` are never flattened. Nothing is written. The invocation's `--stack` override does not change this view of the stored config.

`ai-stack fleet drift` uses the local effective config as its reference and runs `<bin> config show --json` on every enabled machine through the same local/SSH transport as fleet status. Local commands inherit explicit `--home` / `--config` flags; custom binaries and remote `~/` paths use the existing quoting. Like the status command's stray query, this query does not pass `--stack`, because it compares stored settings.

Ignore patterns are merged from repeatable `--ignore KEY` flags, `[drift] ignore` in `fleet.toml`, and `drift_ignore` on each machine. They match dotted keys with `*` (any characters) and `?` (one character). The fleet template ignores `stack.path` and `harness.*.home`; an existing fleet without `[drift]` ignores nothing by default.

```toml
[drift]
ignore = ["stack.path", "harness.*.home"]

[machine.cachy]
ssh = "cachy"
drift_ignore = ["clean.skill_roots"]
```

Text reports `in sync` or `N keys differ`, followed by each differing key's local and remote values; missing keys show `(absent)`. `(N ignored)` counts differing keys removed by ignores, once per key. Patterns matching no keys are allowed. Older binaries or malformed output report `unavailable (<reason>)`; transport failures report `unreachable: <reason>`. Exit 0 requires every enabled machine in sync after ignores; drift, unavailable or unreachable results exit 1.

`--json` emits `{"machines":{"cachy":{"state":"drift","keys":[{"key":"stack.remote","local":"origin","remote":"upstream"}],"ignored":0}}}`. States are `in_sync`, `drift`, `unavailable` and `unreachable`; failures carry `reason` instead of `keys` and `ignored`. A missing side of a key is JSON `null`.

## What install manages

Per enabled harness, with `<home>` the harness home:

- **Model sheet.** `<home>/pstack-models.md`, whose first line is `<!-- Managed by ai-stack. ... -->`. setup-stack treats a sheet with that first line as installer-owned. An existing sheet without it (for example one setup-stack wrote) is a conflict unless `--force`.
- **Instruction file** (`CLAUDE.md` or `AGENTS.md`). Your text outside the managed blocks stays. Install writes:
  - `ai-stack:routing`: the lead, that jm:stack delegates through the sheet, when to run a major review with `interrogate` (after a design is settled and before a pull request or, without one, before calling a non-trivial change done; never for questions, assessments or trivial edits), each model's context cap, that a cross-provider lane may need approval and is reported as single-provider if refused, and the review model for `art-iteration`.
  - `ai-stack:instructions`: your global instructions (see [Global instructions](#global-instructions)).
  - Claude: `ai-stack:pstack-models` holding `@<absolute path to pstack-models.md>`. Other `@` lines that import the same sheet are removed so the import appears once.
  - Codex: the exact sheet bytes between `<!-- pstack:models:begin -->` and `<!-- pstack:models:end -->`.
- **Standalone skills.** A symlink `<folder>/<name>` -> `<stack>/skills/<name>` for every skill of the global groups, in the harness's user skill folder (see [Skills and groups](#skills-and-groups)).
- **Plugins.** `claude plugin marketplace add <stack>` and `claude plugin install jm-stack@jm`, or `codex plugin marketplace add <stack>` and `codex plugin add jm-stack@jm`. ai-stack owns the `jm` marketplace, so an installed `<name>@jm` that the stack's marketplace manifest no longer lists (the retired `jm-games` and `jm-tools`) is removed by every install, the same way `--clean` removes a plugin (user-scope uninstall, disable for a `synced` Claude plugin, `codex plugin remove`). No CLI can reinstall it from a marketplace that dropped it, so its `removed-plugins.json` entry has `"reinstall": null` and a `note` naming the last stack commit whose marketplace manifest lists it. A step is skipped when the CLI's `list --json` output shows it done: the `jm` marketplace already points at the stack checkout, and the plugin is installed (for Codex, at the version the checkout declares, because Codex installs a copy). A `jm` marketplace from another source is a conflict. When the harness home is not the CLI's default, the command sets `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. Commands run after every file change, because the CLIs edit `settings.json` and `config.toml` themselves.
- **Leftovers of older installs.**
  - Symlinks in `<home>/skills` and `<home>/agents` that point into the stack or a legacy root. When one of those folders is a user skill folder (Claude's `<home>/skills`, or a `~/.codex/skills` that links to `~/.agents/skills`), the skill links decide instead.
  - Role agent files older ai-stack builds wrote (`agents/*.md` containing the managed marker, `agents/*.toml` starting with it).
  - Every `ai-stack:<name>` block other than `instructions`, `routing`, `pstack-models` and Claude's `anthropic-guidance`, and the `open-pstack:local` block.
  - In Claude's `settings.json`, hook commands that run `<root>/plugins/pstack/hooks/session-start` with bash or `<root>/scripts/task-context.py` with python3, for the stack or a legacy root. Other commands in the same group stay. A malformed `settings.json` is reported as a conflict and never rewritten.

Other skills, agents, links and files are left alone unless `--clean` is on, or `--force` moves a stray skill out of a link's way.

## Global instructions

Your own global instructions live in the stack repo, so `git pull` and install carry them to every machine:

- `<stack>/instructions/common.md`: every harness.
- `<stack>/instructions/claude.md`, `<stack>/instructions/codex.md`: one harness each.

Install writes one `ai-stack:instructions` block into `CLAUDE.md` and `AGENTS.md`: `common.md`, a blank line, then the harness's own file, each trimmed; a missing or blank file is skipped. The text is inlined, never `@`-imported. Editing a source changes only that block on the next install; when neither file exists for a harness, the block is removed. Text outside the managed blocks is never modified. A source containing `<!-- ai-stack:`, `<!-- pstack:` or `<!-- open-pstack:` is a conflict, because it would corrupt the file. There is no separate command: `diff`, `install`, `update` and `fleet update` pick it up.

## Clean

`--clean` (off by default) leaves only this install plus the `[clean]` keep lists. With it on, the plan also:

- **Moves skills into the backup.** Every entry of each skill root (directory, file or symlink, including a dangling symlink) that no `keep_skills` glob matches moves into the run's backup directory at its home-relative path, for example `<backup>/home/.agents/skills/old-skill`. Symlinks move as symlinks and are never followed. Nothing is deleted. Entries whose name starts with `.` (Codex's `.system`, `.DS_Store`) and `synced` (app-managed) are always kept. ai-stack's own links are never moved: the skill links and leftover cleanup keep, repoint or unlink them. A stray skill at a name a global group links is moved, then linked over, with no `--force` needed; one that `keep_skills` matches stays a conflict until `--force`. A skill root reached through several spellings (a symlinked folder) is read once, so each entry moves once.
- **Removes plugins.** Every plugin in the `plugin list --json` output that no `keep_plugins` glob matches is removed with `claude plugin uninstall <id>` or `codex plugin remove <id>`. These run before the jm install commands. Marketplaces are left alone. Claude Code cannot uninstall a plugin synced from your claude.ai account (`<name>@synced`), so clean disables it with `claude plugin disable <id>` instead and warns that the app may sync it back; remove it on claude.ai to keep it gone. A Claude plugin installed in project or local scope is reported and left in place.
- **Records the removals.** Apply writes `removed-plugins.json` in the backup directory, listing each removed plugin with the command that removed it and the command that restores it (`claude plugin install <id>`, `claude plugin enable <id>` or `codex plugin add <id>`), and prints its path. A retired `jm` plugin, which every install removes, has `"reinstall": null` and a `note` instead.

In the review screen, `c` toggles clean and re-plans. The clean actions appear in their own `Clean (N)` section, and the footer shows `c clean: on` or `off`. `--plain` prints the same section, and `--yes` applies the plan with clean as the flag set it. After `install --clean`, `diff --clean` reports `No changes.`

## Skills and groups

Standalone skills live flat in `<stack>/skills/<name>/`, each with a `SKILL.md`, under plain names unique across the stack. `<stack>/stack.toml` sorts them into groups:

```toml
[groups.threejs]
global = true
skills = ["threejs", "tools-r3f"]

[groups.games]
global = true                 # on for every harness on every machine (default false)
includes = ["threejs"]        # optional: other groups whose skills this group also turns on
skills = ["game-gdd", "game-mvp"]
```

- Every install reads `stack.toml` and refuses to plan when it is invalid. Each error names the file and the offending key. A group or skill name is letters, digits, `.`, `_` and `-`, not starting with `.`. Every member of a group is a directory `skills/<name>/` with a `SKILL.md`. Every directory in `skills/` belongs to at least one group. An include names an existing group, and includes never form a cycle. A skill appears once per group.
- The global set is the union of the global groups, with includes followed. For each enabled harness, install links each of those skills into the harness's user skill folder: Claude Code `<claude home>/skills`, Codex `<home>/.agents/skills`. Each link is `<folder>/<name>` -> `<stack>/skills/<name>`, absolute.
- Every skill folder is resolved through the filesystem first, so two spellings of one directory are one folder: a `~/.claude/skills` that links to `~/.agents/skills`, or a `~/.codex/skills` that links there, is planned once and settles to `No changes.`
- A symlink in those folders is ai-stack's when its target, resolved through the filesystem, lies in the stack or a legacy root, or is `<checkout>/skills/<name>` of a checkout with a `stack.toml`. The stack through a symlinked path, or `/tmp` against `/private/tmp`, is the same stack. A link whose path runs through a symlink out of the stack is not ai-stack's. A correct link is left alone, a wrong one is repointed, and one for a skill no longer in the global set is unlinked.
- Anything else at a linked name (a directory, a file, or a link pointing elsewhere) is a stray skill in the way. It is a conflict naming the path. `install --force` moves it into the backup, then links. Nothing is deleted.
- A skill folder that resolves inside the stack (for example `~/.claude/skills` -> `<stack>/skills`) is a conflict, even with `--force`, because moving its entries would move the stack's own skills. Two global skills whose names differ only by case are a conflict too.
- `ai-stack groups` estimates what a group costs in context at about four characters per token over each skill's frontmatter `name` and `description`, rounded up per group. `--json` prints one line:

```json
{"version":1,"groups":[{"name":"games","global":true,"includes":["threejs"],"skills":["game-gdd","game-mvp","threejs","tools-r3f"],"missing":[],"tokens":812}],"global":{"skills":["game-gdd","game-mvp","threejs","tools-r3f"],"missing":[],"tokens":812}}
```

`version` is the shape's version. `groups` lists every group in name order with its resolved `skills`, sorted, and `missing`, the vendored ones not built yet; `global` is the union of the global groups, each skill counted once. [DESIGN.md](DESIGN.md#skills) defines the fields.

## Vendored skills

`stack.toml` also records every skill the stack vendors from an external git repo, as `[[skill]]` entries. It is checked into the stack repo, so `git pull` (and `ai-stack update`) carries it to every machine. `ai-stack skills add` and `update` edit it in place: they change only the group arrays and `[[skill]]` values that differ, so comments, key order and multi-line arrays survive. Editing by hand is fine (groups and a multi-step `process` are written by hand); the next command validates the file before using it.

```toml
[[skill]]
name = "grill-with-docs"                 # upstream skill directory name
source = "https://github.com/mattpocock/skills"
path = "skills/grill-with-docs"          # skill directory inside the source repo
ref = "main"                             # upstream branch or tag tracked (default "HEAD")
commit = "<40-hex>"                      # upstream commit installed
dest = "skills"                          # parent directory in the stack; the default, so usually left out
move = "grill-docs"                      # optional installed name; also rewrites SKILL.md's `name:`
process = [
  { type = "script", input = "scripts/strip-emdashes.sh" },
  { type = "prompt", input = "Rewrite in a terse style." },
]
```

- `ref` is what `status` and `update` compare against. To try another upstream branch, run `ai-stack skills update --ref <branch> <name>`; it rebuilds from that branch and records the new `ref`. A 40-hex `ref` pins a commit.
- `source` is a git URL or a local path; `skills add` stores a local path as its absolute path. `path = "."` vendors a whole repo whose root is the skill; `.git` is never copied.
- `process` is one table or an array; steps run in order every time the skill is pulled in or rebuilt. A `script` step runs `sh <stack>/<script> <staged skill dir>` in that directory; the script path must be relative to the stack root, so the manifest works on every machine. A `prompt` step runs `[skills] prompt_runner` with the prompt as its last argument in the staged directory, without a shell. Both run arbitrary code or agents by design; review what you add.
- The pipeline: fetch the commit into a temp repo (`git init`, `git fetch --depth 1 <source> <commit>`, `git checkout FETCH_HEAD -- <path>`; never kept), refuse the skill if its directory is a symlink or contains one anywhere, copy it into a staging directory under `<stack>/.ai-stack/stage/`, apply `move`, run the steps, then swap it in: the old directory is renamed into `.ai-stack/stage/`, the staged one is renamed into place, and the old one is deleted. A failing step leaves the installed skill untouched. Between the two renames the skill is briefly absent; a crash there leaves the old tree in `.ai-stack/stage/`, and every `skills` command clears that directory when it starts. `.ai-stack/` is git-ignored.
- A vendored skill installed into `skills/` is a standalone skill, so a group must list its installed name. Until `skills update` builds it, a missing vendored skill is allowed in a group; install skips it with a note.
- `dest` is `skills` for a standalone skill, which a group lists. A hand-written entry may vendor a skill elsewhere, such as into a plugin's skill directory, but never into a subdirectory of `skills/`, where every directory is a standalone skill. `skills add` has no `--dest`.
- The loader rejects a `path` or `dest` that is absolute or has `.` or `..` components (except `path = "."`), a `dest` with a `.git` component or inside `skills/`, a `name` or `move` that is not letters, digits, `.`, `_` and `-` or starts with `.`, a script path that is absolute or has `.` or `..`, a prompt starting with `-`, two entries that install the same directory and two entries that share a name or installed name. Names that differ only by case count as the same, in entries and in groups, because a case-insensitive disk holds one directory for both.
- Typical flow: run `skills update` on one machine, review and commit the result with `stack.toml`, push, then `ai-stack fleet update`.

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

- `status` reads each machine's branch and commit (`git -C <stack> rev-parse HEAD --abbrev-ref HEAD`), looks up each distinct branch's tip once with `git ls-remote <remote> refs/heads/<branch>` from this machine, and reports `current`, `behind` (the commit is an ancestor of the tip in this machine's checkout), `ahead` (the tip is an ancestor of the commit), `different` (diverged), `unknown (fetch first)` (this machine's checkout lacks one of the commits), `detached` or `unreachable` (including output that is not a commit).
- `update` keeps every machine on its own branch, so a machine sitting on a test branch updates that branch. It passes `--stack <stack>`, so the update pulls the same checkout `status` and `switch` use. A machine on a detached HEAD is skipped and reported. A `local = true` machine without `bin` runs this ai-stack binary with the `--config` and `--home` given to this run.
- `switch` never forces. It refuses a checkout with uncommitted tracked changes, runs `git fetch <remote> +refs/heads/<BRANCH>:refs/remotes/<remote>/<BRANCH>`, then `git switch <BRANCH>`, falling back to `git switch -c <BRANCH> --track <remote>/<BRANCH>`, then `<bin> --stack <stack> update --yes --plain --branch <BRANCH>`. If the update fails after the switch, the failure says the machine is now on `<BRANCH>`.
- Branch names are checked before use (no `HEAD`, `refs/` prefix, leading `-` or `+`, whitespace, control characters, `..` or other characters git refuses). A failing machine is reported with its stderr and the next one still runs. There is no timeout and no retry. `fleet update` does not run `skills update`.

## Safety

- Apply re-reads every target before making any change. If a file changed since review, apply refuses the whole plan.
- Backups go to `<home>/.local/state/ai-stack/backups/<unix-time>/`, with a numbered suffix for a same-second collision. Home-relative paths go under `home/` and other absolute paths under `abs/`. An occupied backup destination stops apply.
- Harness homes are normalized when the config loads, and apply refuses any target whose backup path would contain `..`.
- Every file write goes to a new temp file beside the target, created exclusively with an unpredictable name, then renamed over the target. A rewritten file keeps its permissions, so a `0600` `settings.json`, `CLAUDE.md` or `AGENTS.md` stays `0600`.
- When `CLAUDE.md`, `AGENTS.md` or `settings.json` is a symlink (for example into a dotfiles repo), install writes through to the link's target and keeps the link.

## Layout

```
instructions/          global instructions sources (common.md, claude.md, codex.md)
skills/                standalone skills, one directory each
stack.toml             skill groups and vendored skills
cli/
  Cargo.toml
  config.default.toml  reference config written by `ai-stack init`
  fleet.default.toml   fleet template written by `ai-stack fleet init`
  src/
    main.rs     commands, git pull, model reports
    config.rs   config schema, validation, sheet descriptor rules
    exec.rs     process seam for git, ssh, scripts and prompt runners; shell quoting
    stackfile.rs stack.toml schema: groups, vendored skills, validation, group resolution
    skills.rs   skills add, status, update and the install pipeline
    groups.rs   ai-stack groups: resolved members and token estimates
    fleet.rs    fleet file, status, auth, login, drift, update and switch
    drift.rs    pure comparison of flattened config keys
    auth.rs     provider descriptors and login argv, status parsers, safe expiry readers
    render.rs   model sheet and routing block text
    blocks.rs   marker-bounded blocks in instruction files
    install.rs  the plan: sheet, blocks (including instructions), settings hooks
    links.rs    skill folders: canonical index, link ownership, links, leftovers, strays
    paths.rs    ~ expansion, lexical normalize, resolve through the filesystem
    plugins.rs  marketplace and plugin commands, runner seam
    plan.rs     actions, diffs, backups, atomic apply
    models.rs   provider catalogs and --bump
    tui.rs      review screen
```
