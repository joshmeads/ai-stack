# ai-stack CLI

`ai-stack` sets up this repository's `pstack` plugin and standalone skills in Claude Code (`~/.claude`) and Codex (`~/.codex`) from one config file. For each enabled harness it:

1. adds the stack checkout as the local `jm` plugin marketplace and installs every plugin its marketplace manifest lists (it must list `pstack`) through the harness's own CLI, removing any other installed `jm` plugin the checkout no longer lists;
2. links each skill of the global groups in `<stack>/stack.toml` into the harness's user skill folder (see [Skills and groups](#skills-and-groups));
3. writes the pstack model sheet `<home>/pstack-models.md` and wires it into `CLAUDE.md` (an `@` import) or `AGENTS.md` (a mirror of the sheet);
4. writes one `ai-stack:routing` block into `CLAUDE.md` or `AGENTS.md`;
5. writes your own global instructions from `<stack>/instructions/` into an `ai-stack:instructions` block in the same file, including Anthropic guidance for Claude (see [Global instructions](#global-instructions));
6. registers the `ai-stack lint` hooks in `settings.json` or `hooks.json` (see [Lint](#lint));
7. removes what older ai-stack installs left behind.

It shows the plan before changing anything, backs up every file or link it replaces or removes, and is idempotent: a second run reports `No changes.` Installation for Cursor and OpenCode is not handled.

An enabled harness is skipped when its CLI (`claude` or `codex`) is not executable on `PATH`. `diff` and `install` print one skip notice per missing CLI. The other harness still installs. A skipped harness gets no file edits, skill links, plugin commands or removals, including with `--clean`, except that an available harness continues to manage shared skill folders. If every enabled harness is missing its CLI, these commands exit successfully with nothing to do. Explicitly disabled harnesses do not get skip protection from independently configured clean roots. Detection checks execute access for the current user once per command, before planning, without running either CLI. Commands spawn the absolute paths captured then. A planning query that cannot start a detected CLI is a conflict, so apply makes no changes. A file write that resolves through an alias into a skipped harness's routes is a conflict naming both paths.

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
| `ai-stack init [--force]` | Write the default config to `~/.config/ai-stack/config.toml`, with both harnesses enabled, and print what was detected. Missing CLIs are skipped at runtime. Refuses to overwrite unless `--force`. |
| `ai-stack diff [--clean]` | Print the install plan with unified diffs and the plugin commands it would run. Exit 0 when nothing would change, 1 when changes or conflicts are pending. It runs only the read-only `plugin marketplace list --json` and `plugin list --json` queries. `--clean` adds the clean actions (see [Clean](#clean)). |
| `ai-stack stray [--json]` | Report the stray skills and the plugins `--clean` would remove: `skills: N  plugins: M`, then each stray skill (as a `~/` path) and plugin id, indented. A stray skill is an entry `--clean` would move or one in a skill link's way, including one `keep_skills` matches, so `stray` names every entry that blocks an install. ai-stack's own skill links and `jm` plugins are never stray. `--json` prints `{"skills":N,"plugins":M,"skill_names":[...],"plugin_ids":[...]}` on one line. Runs only the same read-only queries as `diff`, and never reads a stray tree in full or runs `git`; never writes. Exit 0. |
| `ai-stack install [--yes] [--force] [--plain] [--clean]` | Build the plan, review it in the TUI (or print it with `--plain`), then apply. `--yes` applies without review. `--force` replaces an unmanaged `pstack-models.md` and moves a stray skill out of a skill link's way, after backing them up. `--clean` also removes skills and plugins outside the keep lists. Conflicts are printed and never applied. |
| `ai-stack update [--yes] [--force] [--plain] [--bump-models] [--branch B]` | Run `git pull --ff-only <remote> <branch>` in the stack checkout, check models, then install. The config resolves its families against the pulled family table. `--bump-models` rewrites the config as `models --bump` does, after the pull and before the model check. `--force` means the same as `install --force`. `--branch` pulls that branch instead of `stack.branch` for this run only; the config is not changed. It refuses when the checkout is on another branch or a detached HEAD, naming both and suggesting `ai-stack update --branch <current>` or `git switch <branch>`, so a pull never merges one branch into another. If the pull changed files under `cli/`, it exits 3 before checking models or installing: nothing was installed. Rebuild with `cargo install --path <stack>/cli`, then rerun the same command, preserving flags such as `--branch` and `--stack`; it never rebuilds itself. |
| `ai-stack models [--bump]` | Report each configured model against its provider catalog: `codex debug models` for Codex, run with `CODEX_HOME` set to `[harness.codex].home` even when that harness is disabled, and the Anthropic Models API or models page for Claude. A model reports `missing` when the catalog does not list it, `newer: <id>` when the catalog lists a newer model of its family, and `current` otherwise. On a family, `newer` means the stack's model registry needs a release edit; on a pinned `id`, it means the pin is behind, and `--bump` turns the pin into its family. A Claude rolling alias such as `opus`, as a family or a pinned `id`, reports `current` whenever the Anthropic catalog loads, because Claude Code resolves it. A catalog that cannot be read reports `unknown: <reason>`. `--bump` first rewrites the config's exact models as families, in `[models.*] id` and in Claude and Codex `[sheet.*]` lanes (`id = "gpt-6.1-sol"` becomes `family = "sol"`, `codex:gpt-6.1-sol@medium` becomes `codex:sol@medium`). It reads `[models.<alias>]` tables and inline tables, single lanes and arrays, and basic or literal strings, keeps each string's quote style, comments and layout, and changes no other key or string. It writes nothing unless the result loads; when an entry has no family, it names that entry and leaves the file unchanged. Run it once to migrate a config from before families. |
| `ai-stack skills add <SOURCE> <PATH> --group GROUP [--ref REF] [--move NAME] [--process-script PATH \| --process-prompt TEXT] [--name NAME]` | Vendor the skill directory `PATH` from the git repo `SOURCE` into `<stack>/skills/`, record it in [`stack.toml`](#vendored-skills) and add it to the existing group `GROUP`. Refuses when the group does not exist, when another entry already installs that name, or when the directory exists; every argument is checked before any network call. A source whose directory has no `SKILL.md` file after the process steps is refused, and the stack is left unchanged. |
| `ai-stack groups [--json]` | Print each group in `stack.toml`: whether it is global, its skills after includes, and an estimated token cost; then the global set (the union of the global groups, each skill once). See [Skills and groups](#skills-and-groups). Read-only; exit 0. |
| `ai-stack skills status` | Print `name  installed-name  <commit>  current \| behind: <latest> \| missing \| unknown: <reason>` per vendored skill. `missing` means the installed directory is gone; `skills update` rebuilds it. Exit 0 when every entry is current, 1 otherwise. A network error is `unknown`. |
| `ai-stack skills update [NAME...] [--ref REF] [--reprocess] [--force]` | Rebuild the named entries (default all) whose upstream ref moved. `--ref` retargets the named entries to another upstream branch or tag and records it. `--reprocess` rebuilds every selected entry even when upstream has not moved, from the commit its ref names now; when the ref cannot be resolved (offline, or the branch is gone) it rebuilds from the pinned `commit` and says so. A missing skill directory is always rebuilt. Refuses to replace a skill directory with uncommitted, untracked or ignored files unless `--force`; a directory gitignored as a whole is download-only and is always replaced. One failure does not stop the rest; exit 1 if any failed. |
| `ai-stack private init \| seal [--stage] \| open [--force] [--hook] \| check` | Manage the gitignored `private/` folder and its encrypted copy `private.age`, in the git repository of the current directory (or `--stack`). `init` sets `core.hooksPath` to `.githooks` and opens the bundle. `seal` encrypts `private/` for the keys in `private.recipients` when it changed. `open` decrypts it with the key from `fnox get AI_STACK_PRIVATE_KEY`, and refuses to overwrite changes that are not sealed unless `--force`. `check` reads pre-push lines on stdin and exits 1 when an outgoing commit holds a `private/` path, a private skill name or a word in `private/guard.txt`. See [Private skills](../skills/README.md#private-skills). |
| `ai-stack lint [PATH...] [--base REV] [--scope lines \| function \| file] [--json]` | Lint the lines changed since the merge base of `REV` (default `HEAD`) and `HEAD`, in the repository of each `PATH` (default: the whole repository of the current directory, from any subdirectory). Prints `path:line:col severity rule: message` and the source line. `--json` prints `{"version":1,"findings":[...]}`. Exit 0 with no error findings, 1 with any, 2 when the config or the rules cannot be loaded, a `PATH` does not exist, or `REV` cannot be resolved. See [Lint](#lint). |
| `ai-stack lint rules [--json]` | List every loaded rule per language, its source file, and its severity in the project of the current directory. Exit 0, or 2 on a load error. |
| `ai-stack lint hook <claude \| codex> <pre-edit \| post-edit \| stop \| prompt>` | The hook command that `install` registers. Reads the hook payload on stdin, answers on stdout and always exits 0. |
| `ai-stack auth status [--json]` | Report local Claude Code, Codex, Cursor Agent and OpenCode login status. Read-only; exit 0 even when a provider is unavailable. |
| `ai-stack fleet auth [--json]` | Report those providers on every enabled fleet machine. Exit 0 when every machine reports successfully and every installed provider is logged in with no expired access token that lacks a refresh token; otherwise 1. |
| `ai-stack fleet login <MACHINE> <PROVIDER>` | Run a supported provider’s headless login on one fleet machine through your terminal, then print its status. Requires terminal stdin and stdout; exit 0 only when login succeeds and the provider reports logged in. |
| `ai-stack fleet init [--force]` | Write a commented `fleet.toml` beside the config file. |
| `ai-stack fleet status` | Print `machine  <branch>  <commit>  current \| behind \| ahead \| different \| unknown (fetch first) \| detached \| unreachable: <reason>`, comparing each machine's stack commit with the remote tip of its own branch, then, for each reachable machine, `  stray: N skills, M plugins` from `<bin> stray --json` on that machine, or `  stray: unavailable (<reason>)` when it fails (for example an older ai-stack there). Exit 0 when all are current; the stray line never changes it. |
| `ai-stack fleet update [--yes] [--branch B]` | Run `<bin> --stack <stack> update --yes --plain --branch <B>` on every enabled machine, `B` being `--branch` or that machine's current branch. A remote rebuild exit reports `rebuild needed on <machine>` and makes fleet exit 1. Without `--yes`, print the commands and exit 1. |
| `ai-stack fleet switch <BRANCH> [MACHINE...] [--yes]` | On the named machines (default all enabled): fetch `BRANCH`, check it out (creating a tracking branch when needed), then update with `--branch BRANCH`. If the checkout changes `cli/`, stop before update and report `now on <BRANCH>; rebuild needed on <machine>`; rebuild there and rerun the same fleet command. Without `--yes`, print the commands and exit 1. |

Global flags, valid on every command:

- `--config <PATH>`: config file. Default `<home>/.config/ai-stack/config.toml`.
- `--home <DIR>`: home directory. Default `$HOME`.
- `--stack <DIR>`: use this checkout instead of `stack.path` from the config. Links and hooks into the configured checkout are still ai-stack's: a skill link a global group wants is repointed to the override, and the rest are removed as leftovers. The next install without `--stack` repoints the links back, because a link to `<checkout>/skills/<name>` of any checkout with a `stack.toml` counts as ai-stack's in a skill folder.
- `--version`.

Exit codes: 0 for success, 1 for pending changes that were not applied, conflicts, or a declined review, 3 when an update needs a CLI rebuild before installing, and a non-zero error exit for failures such as an unreadable config, a failed `git pull` or a failed plugin command.

The rebuild check covers only the pull that brings a `cli/` change (and, for `fleet switch`, the checkout change). It does not record a pending rebuild or compare the running binary with the checkout. Rerunning without rebuilding can proceed with the stale binary, so rebuild before retrying. Fleet commands return 1 when any machine needs a rebuild and keep processing the others.

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

`config.default.toml` in `cli/` is the reference for `ai-stack init`. Init writes it unchanged with both harnesses enabled and prints CLI detection results. Missing CLIs are skipped at runtime, so installing one needs no config change.

- `[stack]`: `path` is the checkout of `joshmeads/ai-stack`. `remote` and `branch` are used by `update`. `legacy_paths` lists older checkout roots. `~` is expanded and relative paths resolve against the invocation directory.
- `[harness.claude]`, `[harness.codex]`: `home` and `enabled`. A disabled harness produces no harness work or skip notice; independently configured clean roots still apply. An enabled harness whose CLI is missing is skipped with a notice.
- `[models.<alias>]`: exactly one of `family` or `id`, optional `efforts` (the efforts a route on this model may name; it must then name one), and optional `context` (usable context in tokens). `family` is a Claude or Codex family in the stack's model registry: `fable`, `opus`, `haiku`, `sonnet`, `sol`, `astra`, `terra` or `luna`. The routing block names the family's current model, such as `gpt-6.2-sol`, or Claude's rolling alias, such as `opus`. ai-stack reads the families from `plugins/pstack/skills/poteto-mode/references/model-families.json` in the stack checkout (`stack.path`, or `--stack`), which `registry/render.ts --write` generates from the pstack registry; a config does not load without that file. A model release edits the registry and regenerates the file, so `ai-stack update` moves every machine to the new model with no config edit and no CLI rebuild. `id` pins an exact model the registry knows: a family's current model or a kept predecessor, such as `gpt-6.1-sol`. Any other id, such as `gpt-6.12-sol` or `claude-opus-5-5`, is a load error. `provider` (`anthropic` or `openai`) is optional and comes from the model; a `provider` that disagrees is a load error. The defaults define `sol`, `astra`, `terra`, `opus` and `haiku` as families, with `haiku` at 100000. The owner sets Haiku's compaction in Claude Code at 100k because Anthropic bills the whole request at 5x past 100k tokens; ai-stack only states the limit in the routing block. `ai-stack models` checks these models against the provider catalogs.
- `[leads]`, `[review]`: one `"alias@effort"` route per harness. The lead is described in the routing block; install does not change either CLI's default model. The review model is named in the routing block and used by the `art-iteration` skill's critic.
- `[sheet.claude]`, `[sheet.codex]`: the 15 pstack model-sheet rows for that harness. Each lane is a provider-qualified descriptor `<provider>:<family>@<effort>`, such as `codex:sol@medium`, an exact `<provider>:<model>@<effort>` from the pstack provider-dispatch reference, such as `codex:gpt-6.1-sol@medium`, or `inherit-parent` / `auto`. The sheet that install writes names a family's current model (`codex:gpt-6.2-sol@medium`) and an exact model as written. The loader accepts the providers, families, current models, kept predecessors and efforts in the family table, which the pstack model catalog lists. A model the table does not list, such as `codex:gpt-6.12-sol`, is a load error. Providers the table marks read-only (today `devin`, `opencode`, `dsh`, `amp`, `agy`, `cursor` and `pi`) fit only rows that do not write files. `pi` also takes any `openrouter/<id>` model at efforts `low` to `max`, where `<id>` uses only letters, digits and `._~:/-`; the loader checks only that shape, and the runner's preflight decides availability at dispatch. `arena runners` is one of those rows, because a read-only family's seat returns its candidate to the parent. The rows that write files (`feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `hardest tasks`, `architect runners`, `swarm workers`) refuse them, as `/setup-stack` does. The four panel rows (`arena runners`, `arena cross-judge pool`, `architect runners`, `interrogate reviewers`) accept arrays. The Why and Reflect rows must be `inherit-parent` or `auto`, because those roles need the parent's MCP servers.

- `[skills]`: `prompt_runner`, the argv that runs a `type = "prompt"` process step, with the prompt appended as the last argument. Default `["claude", "-p", "--permission-mode", "acceptEdits"]`. A config without `[skills]` gets the default.
- `[lint]` and `[[lint.project]]`: see [Lint](#lint). `ai-stack lint` reads only `[stack]` and `[lint]`, so a config whose other tables do not load still lints.
- `[clean]`: what `--clean` keeps. `skill_roots` (default `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, resolved against `--home`), `keep_skills` (globs over entry names) and `keep_plugins` (globs over `name@marketplace`; the defaults keep `github@claude-plugins-official`, `chrome-devtools-mcp@claude-plugins-official` and Codex's built-in `*@openai-*`). `--clean` never touches a `jm` plugin: install owns that marketplace. Globs use `*` and `?`. A config without `[clean]`, or without one of its keys, gets the defaults that `init` writes.

A config from an older ai-stack (with `[roles]`, `[stack.models]` or `[install]`) is rejected with a message to run `ai-stack init --force` and re-apply your edits.

Upgrade note: Arena's judge must come from a provider other than the harness running it, and your config overrides the default sheet. When a harness's `arena cross-judge pool` has no such entry (`inherit-parent` and `auto` do not count), Arena skips its judge, so `diff` and `install` print a note naming the row. Add a lane from the other provider to that row, such as `"arena cross-judge pool" = ["codex:astra@xhigh", "claude:opus@xhigh"]` in `[sheet.claude]`.

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
  - `ai-stack:routing`: the lead, that pstack delegates through the sheet, when to run a major review with `interrogate` (after a design is settled and before a pull request or, without one, before calling a non-trivial change done; never for questions, assessments or trivial edits), each model's context cap, that a cross-provider lane may need approval and is reported as single-provider if refused, and the review model for `art-iteration`.
  - `ai-stack:instructions`: your global instructions, including Anthropic guidance from `instructions/claude.md` for Claude only (see [Global instructions](#global-instructions)).
  - Claude: `ai-stack:pstack-models` holding `@<absolute path to pstack-models.md>`. Other `@` lines that import the same sheet are removed so the import appears once.
  - Codex: the exact sheet bytes between `<!-- pstack:models:begin -->` and `<!-- pstack:models:end -->`.
- **Standalone skills.** A symlink `<folder>/<name>` -> `<stack>/skills/<name>` for every skill of the global groups, in the harness's user skill folder (see [Skills and groups](#skills-and-groups)).
- **Plugins.** `claude plugin marketplace add <stack>` and `claude plugin install pstack@jm`, or `codex plugin marketplace add <stack>` and `codex plugin add pstack@jm`. ai-stack owns the `jm` marketplace, so an installed `<name>@jm` that the stack's marketplace manifest no longer lists (the retired `jm-games` and `jm-tools`) is removed by every install, the same way `--clean` removes a plugin (user-scope uninstall, disable for a `synced` Claude plugin, `codex plugin remove`). No CLI can reinstall it from a marketplace that dropped it, so its `removed-plugins.json` entry has `"reinstall": null` and a `note` naming the newest stack commit whose marketplace manifest lists it and whose copy of the plugin's directory still holds its skills. Apply works the commit out from the stack's git history when it writes the record; `diff` and `stray` never run `git`. A step is skipped when the CLI's `list --json` output shows it done: the `jm` marketplace already points at the stack checkout, and the plugin is installed at the version the checkout declares. Both CLIs record an installed version; a mismatch with the plugin's `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json` plans `claude plugin update pstack@jm --scope user` or `codex plugin add pstack@jm`. Claude's marketplace-entry version is not used. Only a Claude user-scope install (or an older listing without scope) satisfies this check; a project, local or synced install does not replace the global user install. Updating a disabled plugin preserves its disabled state. A `jm` marketplace from another source is a conflict. When the harness home is not the CLI's default, the command sets `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. Commands run after every file change, because the CLIs edit `settings.json` and `config.toml` themselves.
- **Lint hooks.** Claude's `settings.json` and Codex's `hooks.json` get one `<abs ai-stack> lint hook <harness> <event>` command each for `PreToolUse` and `PostToolUse` (matcher `Edit|Write` for Claude, `apply_patch` for Codex), `Stop` and `UserPromptSubmit` (`prompt`). A `SubagentStop` entry from an older install is kept and repointed. See [Lint](#lint).
- **Leftovers of older installs.**
  - Symlinks in `<home>/skills` and `<home>/agents` that point into the stack or a legacy root. When one of those folders is a user skill folder (Claude's `<home>/skills`, or a `~/.codex/skills` that links to `~/.agents/skills`), the skill links decide instead.
  - Role agent files older ai-stack builds wrote (`agents/*.md` containing the managed marker, `agents/*.toml` starting with it).
  - Every `ai-stack:<name>` block other than `instructions`, `routing` and `pstack-models`, including the old `ai-stack:anthropic-guidance` block, and the `open-pstack:local` block.
  - In Claude's `settings.json`, hook commands that run `<root>/plugins/pstack/hooks/session-start` with bash or `<root>/scripts/task-context.py` with python3, for the stack or a legacy root. Other commands in the same group stay. A malformed `settings.json` is reported as a conflict and never rewritten.

Other skills, agents, links and files are left alone unless `--clean` is on, or `--force` moves a stray skill out of a link's way.

## Global instructions

Your own global instructions live in the stack repo, so `git pull` and install carry them to every machine:

- `<stack>/instructions/common.md`: every harness.
- `<stack>/instructions/claude.md`, `<stack>/instructions/codex.md`: one harness each. The Claude file carries the Anthropic guidance; it is never included for Codex.

Install writes one `ai-stack:instructions` block into `CLAUDE.md` and `AGENTS.md`: `common.md`, a blank line, then the harness's own file, each trimmed; a missing or blank file is skipped. The text is inlined, never `@`-imported. Editing a source changes only that block on the next install; when neither file exists for a harness, the block is removed. Text outside the managed blocks is never modified. A source containing `<!-- ai-stack:`, `<!-- pstack:` or `<!-- open-pstack:` is a conflict, because it would corrupt the file. There is no separate command: `diff`, `install`, `update` and `fleet update` pick it up.

## Clean

`--clean` (off by default) leaves only this install plus the `[clean]` keep lists. With it on, the plan also:

- **Moves skills into the backup.** Every entry of each skill root (directory, file or symlink, including a dangling symlink) that no `keep_skills` glob matches moves into the run's backup directory at its home-relative path, for example `<backup>/home/.agents/skills/old-skill`. Symlinks move as symlinks and are never followed. Nothing is deleted. Entries whose name starts with `.` (Codex's `.system`, `.DS_Store`) and `synced` (app-managed) are always kept. ai-stack's own links are never moved: the skill links and leftover cleanup keep, repoint or unlink them. A stray skill at a name a global group links is moved, then linked over, with no `--force` needed; one that `keep_skills` matches stays a conflict until `--force`. A skill root reached through several spellings (a symlinked folder) is read once, so each entry moves once.
- **Removes plugins.** Every plugin in the `plugin list --json` output that no `keep_plugins` glob matches is removed with `claude plugin uninstall <id>` or `codex plugin remove <id>`. These run before the jm install commands. Marketplaces are left alone. Claude Code cannot uninstall a plugin synced from your claude.ai account (`<name>@synced`), so clean disables it with `claude plugin disable <id>` instead and warns that the app may sync it back; remove it on claude.ai to keep it gone. A Claude plugin installed in project or local scope is reported and left in place.
- **Records the removals.** Apply writes `removed-plugins.json` in the backup directory, listing each removed plugin with the command that removed it and the command that restores it (`claude plugin install <id>`, `claude plugin enable <id>` or `codex plugin add <id>`), and prints its path. A retired `jm` plugin, which every install removes, has `"reinstall": null` and a `note` instead.

`stray` uses the same harness detection as install and prints skip notices to stderr, keeping `--json` stdout parseable. Cleanup-only folders inside a skipped harness's routes are excluded, including symlink aliases. In active folders, individual entries that hold or route into a skipped harness are left alone and do not count as strays. A skill folder shared with an available harness still serves that harness, including links and cleanup of unrelated entries.

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
- Every link install makes or removes is recorded in `<home>/.local/state/ai-stack/links.json`, as link path and target. A symlink in those folders is ai-stack's when that file records it with the same target, or when its target lies in the stack or a legacy root. So a link made by `install --stack <other checkout>` stays ai-stack's after that checkout is deleted, and a link into any other repo is not, whatever that repo holds. A missing or unreadable `links.json` records nothing; it never stops an install.
- A target is resolved through the filesystem up to its last component, which is kept as written: a link to `<stack>/skills/<name>` is ai-stack's even when that skill directory is itself a symlink elsewhere. Symlinks along the way are followed even when what they point at is missing, so a link whose path runs through a symlink out of the stack is not ai-stack's. The stack through a symlinked path, or `/tmp` against `/private/tmp`, is the same stack. A correct link is left alone, a wrong one is repointed, and one for a skill no longer in the global set is unlinked.
- Anything else at a linked name (a directory, a file, or a link pointing elsewhere) is a stray skill in the way. It is a conflict naming the path. `install --force` moves it into the backup, then links. Nothing is deleted.
- A skill folder that resolves inside the stack or a legacy root (for example `~/.claude/skills` -> `<stack>/skills`, also during `--stack <other>`, when the configured checkout is a legacy root) is a conflict, even with `--force`, because moving its entries would move a checkout's own skills. So is a folder entry that holds a checkout, such as a stack cloned to `~/.claude/skills/source`. A user skill folder that is a symlink to a missing directory (an unmounted volume) is a conflict naming the target.
- Apply re-checks that each skill folder still resolves to the directory it planned against, with the same device and inode, before it changes an entry there.
- On a case-insensitive disk a stray at `HANDOFF` is the entry at `handoff`. It moves into the backup under its own name, `HANDOFF`.
- `ai-stack groups` estimates what a group costs in context at about four characters per token over each skill's frontmatter `name` and `description`, rounded up per group. `--json` prints one line:

```json
{"version":1,"groups":[{"name":"games","global":true,"includes":["threejs"],"skills":["game-gdd","game-mvp","threejs","tools-r3f"],"missing":[],"tokens":812}],"global":{"skills":["game-gdd","game-mvp","threejs","tools-r3f"],"missing":[],"tokens":812}}
```

`version` is the shape's version. `groups` lists every group in name order with its resolved `skills`, sorted, and `missing`, the vendored ones not built yet; `global` is the union of the global groups, each skill counted once. [DESIGN.md](DESIGN.md#skills) defines the fields.

## Vendored skills

`stack.toml` also records every skill the stack vendors from an external git repo, as `[[skill]]` entries. It is checked into the stack repo, so `git pull` (and `ai-stack update`) carries it to every machine. `ai-stack skills add` and `update` edit the file as it is when they write, with three operations: add a member to a group's `skills`, append a `[[skill]]` entry, and set `ref` and `commit` on one named entry. Hand edits made while a command runs survive, and so do comments, key order and multi-line arrays. Groups may be tables, dotted keys or inline tables, and entries an array of tables or an array of inline tables. A shape the operations cannot edit is an error, and an edit whose result does not validate or lacks the change writes nothing. A symlinked `stack.toml` is written through and keeps its mode. When `skills add` cannot record the new skill, it removes the directory it just installed. Editing by hand is fine (groups and a multi-step `process` are written by hand); the next command validates the file before using it.

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
- The loader rejects a `path` or `dest` that is absolute or has `.` or `..` components (except `path = "."`), a `dest` with a `.git` component or inside `skills/` in any letter case, a `dest` that resolves on disk into `.git`, into `skills/` (other than `skills` itself) or out of the stack, a `name` or `move` that is not letters, digits, `.`, `_` and `-` or starts with `.`, a script path that is absolute or has `.` or `..`, a prompt starting with `-`, two entries that install the same directory and two entries that share a name or installed name. Names that differ only by case count as the same, in entries and in groups, because a case-insensitive disk holds one directory for both.
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
- `update` keeps every machine on its own branch, so a machine sitting on a test branch updates that branch. It passes `--stack <stack>`, so the update pulls the same checkout `status` and `switch` use. If a pull changes `cli/`, that machine stops before checking models or installing and reports `rebuild needed on <machine>`; rebuild there and rerun the same fleet update command. A machine on a detached HEAD is skipped and reported. A `local = true` machine without `bin` runs this ai-stack binary with the `--config` and `--home` given to this run.
- `switch` never forces. It refuses a checkout with uncommitted tracked changes, runs `git fetch <remote> +refs/heads/<BRANCH>:refs/remotes/<remote>/<BRANCH>`, then `git switch <BRANCH>`, falling back to `git switch -c <BRANCH> --track <remote>/<BRANCH>`, then checks `git diff --name-only <before switch> HEAD -- cli`. If the checkout changed `cli/`, it reports `now on <BRANCH>; rebuild needed on <machine>` and skips update: nothing was installed. Rebuild there and rerun the same fleet switch command. Otherwise it runs `<bin> --stack <stack> update --yes --plain --branch <BRANCH>`, which also stops if its pull changes `cli/`. If the update fails after the switch, the failure says the machine is now on `<BRANCH>`.
- Branch names are checked before use (no `HEAD`, `refs/` prefix, leading `-` or `+`, whitespace, control characters, `..` or other characters git refuses). A failing machine is reported with its stderr and the next one still runs. There is no timeout and no retry. `fleet update` does not run `skills update`.
- `update` and `switch` never pass `--force`, so a machine with stray skills in a link's way stops with a conflict there. Run `ai-stack install --force` on that machine once.

## Lint

`ai-stack lint` checks agent-written code with [ast-grep](https://ast-grep.github.io) rules, and reports a finding only when it touches a line the agent changed. It runs from user-level agent hooks, so no repository gets a config file, a git hook or a dependency.

### Owned lines

Owned lines come from a line diff. Line endings do not count, so a CRLF to LF change owns nothing, a file whose only change is its line endings is not changed at all, and appending to a file without a final newline owns only the new line.

- **Hooks.** The baseline is the repository as it was when the agent's turn began. A turn starts when you send a prompt and ends at the next one. The first `pre-edit` of a turn that names any file in a repository, code or not, records that repository's HEAD commit, the time, and the content of every dirty or untracked file that is not ignored, so lines a human wrote before the turn, staged or not, are never owned. Owned lines are the lines that differ from that baseline, found with the same `git diff -M` as the CLI. A formatter that reflows the agent's lines, a rename through the shell, a commit, a Codex move and an edit that failed all need no special handling: what is on disk at the stop is compared with what was there when the turn began. When HEAD moved during the turn, through a pull, rebase, merge or checkout, or a merge, rebase or cherry-pick is in progress, the hooks first lint and then, for each file with a finding, ask `git blame` who wrote its owned lines. A commit is the agent's when the reflog of HEAD or of the branch, after the baseline, shows it was made here: a commit (amend and merge included), a rebase pick, reword, edit, squash, fixup or continue, a cherry-pick or a revert. An owned line blamed to any other commit is not owned; an uncommitted line stays owned. A file whose differences from the baseline all come from other commits is not changed at all, so a pulled deletion or a pulled new file is not linted, even with `scope = "file"`. Without a reflog, a commit is the agent's when its committer time is not before the baseline. A blame that fails is a git error in that repository (see below), never a reason to own every line. A turn that ends without a stop, after Esc or an API error, still ends at the next prompt, so a human's edits between turns are never owned.
- **CLI.** The baseline is the file at `git merge-base REV HEAD`. The CLI copies the index, adds untracked files to the copy with `git add --intent-to-add`, and runs `git diff -M` against the merge base, so renames are detected the way git detects them, edits included, and one deleted file pairs with at most one new file. Renames are paired over the whole repository before PATH narrows the result, so linting one file agrees with linting the repository. A renamed file's baseline is its old path, so a pure rename owns nothing. A new file has an absent baseline, and a file removed from the index but still on disk compares against the merge base. Submodule entries are skipped, and a changed submodule is linted from the parent repository against the commit the parent records, with no merge base inside the submodule. In a repository with no commit, every tracked and untracked file has an absent baseline. Paths are kept as bytes, so names that are not UTF-8 work.

`ai-stack lint` and the hooks write nothing into the repository: the copied index and any new git objects go to a temporary directory or the hook state folder, so split-index repositories and read-only object stores work. They never read the repository's index, or a submodule's, in place, so git does not touch a split index's shared file, and every git call runs with `core.hooksPath=/dev/null`, so no git hook fires. Attributes come from the working tree and the copied index, so a `.gitattributes` outside a sparse checkout still counts. An expanded `ident` keyword (`$Id: ... $`) compares equal to `$Id$`; other clean and smudge filters are not applied.

`scope` widens the owned lines: `lines` (default) keeps them, `function` adds the innermost enclosing function of each owned line, and `file` lints the whole file, including a file whose edit only deleted lines. Files that `.gitattributes` marks `linguist-generated` or `linguist-vendored` are skipped, and so are symlinks. Each file is checked in its own repository, so submodules, other worktrees and other repositories work. Rules run only on syntax nodes that touch the widened owned lines, so a one-line edit in a large legacy file stays fast.

### Rules

Rules load from `<stack>/lint/rules/*.yml`, which `ai-stack update` pulls, and from `<config dir>/lint/rules/*.yml` for your own. A missing `<stack>/lint/rules` is a load error; a missing `<config dir>/lint/rules` is not. A rule is one ast-grep YAML document with these additions:

- `language` takes one name or a list, such as `[TypeScript, Tsx, JavaScript]`. The loader makes one rule per language. The compiled-in languages are TypeScript, Tsx, JavaScript, Rust, Python and Go. Any other language is a load error naming the rule.
- One `id` can have several documents in one file, for example one per language or per variant. The same `id` and language in two files is a load error.
- `metadata.unless_file` and `metadata.when_file` are regexes over the whole file. The rule is skipped when `unless_file` matches or `when_file` does not. Use them for file-level facts, such as `vi.useFakeTimers(` being called anywhere.
- `metadata.allow_license_header: true` drops matches inside the file's leading block of comments when one of them contains `Copyright`, `SPDX-License-Identifier` or `License`. `metadata.allow_in` is a regex over the whole file, and a match whose bytes lie inside one of its matches is dropped, such as a comment in a PEP 723 `# /// script` block. It excuses only the bytes it matches, not the rest of their lines. Both are computed once per file.
- A relational rule with `stopBy: end` that searches for the file's root node (`program`, `module` or `source_file`), or a `follows` or `precedes` with `stopBy: end`, re-walks the file or a run of siblings for every candidate node. A test refuses both in a shipped rule. Checking the direct parent with `inside: { kind: program }` is cheap and allowed.
- ast-grep suppression comments (`ast-grep-ignore`) do not hide findings from `ai-stack lint`.
- `metadata.default_off: true` (or `severity: off`) leaves the rule off until `[lint] enable` names it.
- `files` and `ignores` match paths relative to the repository root.

The shipped rules, ported from [landmines](https://github.com/interfere-inc/landmines):

| Rule | Languages | Default |
| --- | --- | --- |
| `no-comments` | ts, tsx, js, rust, python, go | error. Allows tool directives (including ESLint `/* global */`, `/* exported */` and `/* eslint-env */`, and `@vitest-environment` or `@jest-environment` docblocks), shebangs, license headers (any comment with `Copyright` or `SPDX-License-Identifier:`, and a leading comment block at the top of a file that contains `Copyright`, `SPDX-License-Identifier` or `License`), a single-line `WARNING:` or `SAFETY:` comment, doc comments on exported or `pub` items, Rust `//!` and `/*!` inner docs, Rust doc comments on clap `Parser`, `Subcommand`, `Args` and `ValueEnum` types, which generate `--help`, JSDoc blocks that carry types (`@type`, `@typedef`, `@template`, `@satisfies`, `@import`, `@callback`, or `@param`, `@returns` and `@property` with `{type}`) in JavaScript files, PEP 723 `# /// script` blocks, Go doc comments on exported names, interface methods and names in grouped `const`, `var` and `type` declarations, a Go cgo preamble directly before `import "C"`, and Go `// Output:` and `// Unordered output:` comments in `Example` functions. Python docstrings are not checked. |
| `no-fixed-sleep` | ts, tsx, js, python, rust | error. In test bodies only. TS and JS skip files that call `vi.useFakeTimers(`. Python counts only in test files (`test_*.py`, `*_test.py`, `conftest.py`, `tests/`, `test/`). |
| `no-flake-masking` | ts, tsx, js, python | error. Test retries and raised test timeouts. The `test: { retry, testTimeout, hookTimeout }` options count only in `vite.config.*` and `vitest.config.*` files. Python flaky and timeout markers count anywhere, and `reruns=`, `reruns_delay=` and `max_runs=` only in test files (`test_*.py`, `*_test.py`, `conftest.py`, `tests/`). |
| `no-unsignaled-poll` | ts, tsx, js | error. `expect.poll` and `vi.waitFor` on mock calls, lengths and sizes. |
| `no-test-doubles` | ts, tsx, js | error. Matches mock method names, with no scope analysis. |
| `no-lint-suppression` | ts, tsx, js, rust, python, go | warning. New `eslint-disable`, `@ts-ignore`, `#[allow(...)]`, `# type: ignore`, `# noqa` and `//nolint`. An `ast-grep-ignore` comment is an error. |
| `test-file-names` | path | error. New files only. Built in. |
| `no-explicit-return-types` | ts, tsx | off. |

Each rule has a fixture in `<stack>/lint/tests/<rule>[.<variant>].<ext>`. The name after `<rule>.` is the fixture's path for `files` and `ignores`, so `no-flake-masking.vitest.config.ts` tests the rules limited to Vitest config files. A line containing `@hit` must match, and no other line may. A `.js` fixture also runs as TypeScript and Tsx, and a `.ts` fixture also runs as Tsx.

### Configuration

```toml
[lint]
enabled = true
scope = "lines"
disable = []
enable = ["no-explicit-return-types"]
severity = { "no-lint-suppression" = "warning" }
ignore = ["**/vendor/**", "**/node_modules/**"]

[[lint.project]]
path = "~/Documents/Projects/@joshmeads/ai-stack"
paths = { "no-comments" = ["cli/**", "skills/devtools-perf/**"] }
ignore = ["plugins/t3stack/**"]
scope = "lines"
enabled = true
```

- `disable` and `enable` name rule ids and apply to every language of the id. `severity` sets `error`, `warning` or `off` per id, and turns on a default-off rule.
- `ignore` globs skip files. The default ignores `vendor` and `node_modules` directories.
- `[[lint.project]]` matches the repository of its `path`, identified by `git rev-parse --git-common-dir` (its parent when it is a `.git` folder), so it also covers that repository's linked worktrees, including those of a `--separate-git-dir` checkout. `paths` limits a rule to the listed globs, `ignore` skips more files, and `scope` and `enabled` override the global values for the project.

### Hooks

`ai-stack install` registers the hooks for Claude Code in `~/.claude/settings.json` and for Codex in `~/.codex/hooks.json`:

| Event | Command | Effect |
| --- | --- | --- |
| `PreToolUse` | `lint hook <harness> pre-edit` | Records the turn's baseline of each repository that holds a file the edit names, unless the turn already has one: Claude's `tool_input.file_path`, or the `*** Add File:`, `*** Update File:`, `*** Delete File:` and `*** Move to:` lines of a Codex `apply_patch`. Saves nothing for a project whose `[[lint.project]]` sets `enabled = false`. Prints nothing. |
| `PostToolUse` | `lint hook <harness> post-edit` | Lints the owned lines of the edited files and returns the findings to the agent as `additionalContext`, with each rule's message stated once. The whole report stays within Claude Code's 10,000-character limit: rule messages take at most half of it, findings with their locations fill the rest, and "and N more" counts the findings and the messages left out. Records the baseline first when the turn has none, so that edit owns nothing. Never blocks. |
| `Stop` | `lint hook <harness> stop` | Lints the owned lines of every repository with a baseline in this turn. New error findings block the stop with `{"decision":"block"}`, and the turn continues. Warnings never block. A stop never ends the turn. |
| `UserPromptSubmit` | `lint hook <harness> prompt` | Ends the session's turn: deletes its baselines, its stop state and its acknowledgments. Keeps the turn for a Codex prompt whose `turn_id` is the turn's own, and while a background stop marker exists (see below). Runs even when lint is disabled, and prints nothing. |

Claude Code and Codex send the lead's `session_id` from a subagent too, so a subagent's edits share the lead's turn baseline and are checked at the lead's stop. A stop that carries `agent_id` or `hook_event_name: "SubagentStop"` is silent, and so is a prompt that carries `agent_id`. Codex also sends a `turn_id`; a lead hook whose `turn_id` differs from the one the turn recorded starts a new turn, as a prompt does. Codex runs `UserPromptSubmit` for a message the user types while a turn runs, with that turn's `turn_id`, so such a steer keeps the turn. Claude Code does not document whether it runs `UserPromptSubmit` for a message sent mid-turn; if it does, that message ends the turn like any prompt.

When Claude Code's stop lists a running `subagent`, `teammate` or `workflow` in `background_tasks`, the stop does not block. It names the errors found so far in a `systemMessage` instead, and leaves a marker in the session folder. While the marker exists, a prompt keeps the turn, so the prompt Claude Code sends when the background agent reports back does not end it, and the next lead stop checks the lead's and the background agent's edits together and can block. That next stop, when no background agent runs, removes the marker. The cost: a prompt you send yourself right after such a stop also keeps the turn, so the agent's next stop also owns lines changed between the two turns.

The turn baseline gives up three things. Another actor, a second agent session or a human, who edits the same checkout during the turn is checked as if the agent wrote those lines; the loop guard below lets such a finding go after one unchanged retry. A commit made in this checkout during the turn is the agent's, even when someone else made it there. Edits the agent made through its shell before its first edit-tool call of the turn fall into the baseline and are not checked; run `ai-stack lint` to check them. A file outside any git repository is not checked by the hooks.

The stop hook gives up on a finding the agent keeps. When Claude Code or Codex reports `stop_hook_active` and the blocking findings are the same as on the last block, or after 3 blocks in a row, the stop is allowed and a `systemMessage` names the findings for you. Those findings never block again in the turn; a new finding does. A finding is identified by its rule, the file's absolute path, the whole matched text, and how many copies of that text come before it in the file. So a `cd` or a moved line does not revive an acknowledged finding, while a new copy of an acknowledged comment, or a different block that starts the same way, still blocks. An acknowledgment ends when its finding is gone at a stop, so a finding that comes back blocks again. Only the stop hook writes stop state.

Hooks fail open: an error exits 0 without blocking, and a config error, such as an unknown `[lint]` key, or a rule load error, such as a missing `<stack>/lint/rules`, is shown once per session as a `systemMessage`. A git error in one repository, such as a file that vanished while it was being listed, is shown once per turn as a `systemMessage`, and the other repositories are still checked. `[lint] enabled = false` makes every hook call but `prompt` a silent no-op, and install still keeps the hook entries. A session's state lives in `~/.local/state/ai-stack/lint/<session_id>/`; the turn baselines, including copies of the dirty files up to 2 MB each, are under `turn/` and are deleted when the turn ends. A dirty file larger than 2 MB, or a symlink, is not checked for the rest of that turn. Every hook call marks its session folder as used, and a session folder unused for 14 days is deleted when a new session starts. No hook sets a timeout.

Install appends each missing hook group at the end of its event's list, and a missing event after the existing events, and never removes or reorders an entry. A `SubagentStop` entry from an older install stays where it is and is repointed like the others, but install never adds one. A hook command carries the `--home` and `--config` the install ran with when they differ from the defaults, and its `--stack` when given or when `[stack] path` is relative, so the hook reads the same config and rules from any working directory. When the `ai-stack` binary moves or those flags change, install rewrites only the command string of its own entry. An entry is ai-stack's when its command's first word, unquoted or in single or double quotes, has the base name `ai-stack`, then any `--config`, `--home` or `--stack` flags with their values, and then exactly `lint hook <harness> <event>`. Codex keys hook trust by file, event and position, so this keeps your own hooks and the lint hooks trusted. Codex asks you once, in its startup review, to trust the new hooks, and again after the command string changes. ai-stack never writes trust entries.

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
private/               gitignored private groups (private/stack.toml) and skills
private.age            private/, encrypted for the keys in private.recipients
.githooks/             hooks that seal, open and guard private/
lint/rules/            ast-grep rules for `ai-stack lint`
lint/tests/            one fixture per rule, `@hit` on each line that must match
cli/
  Cargo.toml
  config.default.toml  reference config written by `ai-stack init`
  fleet.default.toml   fleet template written by `ai-stack fleet init`
  src/
    main.rs     commands, git pull, model reports
    config.rs   config schema, validation, sheet descriptor rules
    exec.rs     process seam for git, ssh, scripts and prompt runners; shell quoting
    stackfile.rs stack.toml schema: groups, vendored skills, validation, group resolution, private merge
    private.rs  private/ bundle: seal, open and the pre-push check
    skills.rs   skills add, status, update and the install pipeline
    groups.rs   ai-stack groups: resolved members and token estimates
    fleet.rs    fleet file, status, auth, login, drift, update and switch
    drift.rs    pure comparison of flattened config keys
    auth.rs     provider descriptors and login argv, status parsers, safe expiry readers
    render.rs   model sheet and routing block text
    blocks.rs   marker-bounded blocks in instruction files
    install.rs  the plan: sheet, blocks (including instructions), settings and lint hooks
    lint/       ai-stack lint: owned lines, rule loading, scanning, settings, hooks
    links.rs    skill folders: canonical index, link ownership, links, leftovers, strays
    ledger.rs   links.json: the skill links ai-stack made
    paths.rs    ~ expansion, lexical normalize, resolve through the filesystem
    plugins.rs  marketplace and plugin commands, runner seam
    plan.rs     actions, diffs, backups, atomic apply
    models.rs   provider catalogs and --bump
    tui.rs      review screen
```
