# Skills manager plan

ai-stack grows from an installer into the owner's skills manager: one stack repo as the source of every skill, groups that keep each harness's skill list short, a fleet that stays in sync from any machine, a full TUI, and later a Swift app. Vocabulary is in [`GLOSSARY.md`](../../GLOSSARY.md). Hard-to-reverse choices are in [`docs/adr/`](../adr/).

Sources compared: runkids/skillshare (one source, TUI, web UI, manual-only flag), beautyfree/skiller (screen layout, content hashes), xingkongliang/skills-manager (library separate from deployment, adopt), jeffreytse/grimoire (manifest and lock), go165/agent-skill-groups (groups with includes, context budget).

## Decisions

### Scope

- Personal tool for the owner's fleet. No marketplace or catalog browsing.
- Harnesses: Claude Code and Codex now, OpenCode next, Cursor later. Each harness stays one table row.
- Global skills first; per-project enabling later.

### Skills

- The stack is the one source. Anything ai-stack finds in a harness's skill folders that it does not own is a stray skill, offered for adopt (after a warning that shows what will move) or moved to backup.
- jm-stack stays a plugin. jm-games and jm-tools become standalone skills ([ADR 0001](../adr/0001-plugins-only-for-jm-stack.md)).
- Standalone skills live flat in `skills/<name>/`, under plain names unique across the stack. A clash on the way in is resolved with `move`.
- `stack.toml` replaces `manifest.toml`. It holds the `[[skill]]` entries for vendored skills and `[groups.<name>]` tables with `skills`, `includes` and `global`. The owner's own skills need no entry; their folder is the record. Every standalone skill must belong to at least one group.
- Adopt moves the folder into `skills/<name>/` and assigns a group (TUI prompt, or `--group`). With no known source it becomes the owner's own skill; with a source it becomes a vendored skill pinned to that commit.
- Vendored skills record a content hash after their process steps. `status` shows `modified` when the installed tree differs, and `update` refuses without `--force`.
- Manual-only is a per-skill property in the stack. ai-stack keeps `disable-model-invocation` in `SKILL.md` and `allow_implicit_invocation` in `agents/openai.yaml` in step.
- `~/.agents/other-skills` retires. Each collection is matched to its upstream first; skills in use become vendored skills, the rest stay upstream.

### Groups and projects

- Groups serve context budget and per-project enabling. There are no per-machine profiles: every machine gets the same global groups.
- The TUI and `ai-stack groups --json` show an estimated token cost per group and for the global set (about four characters per token over name and description).
- Project mode, later: a repo commits a small file listing groups; `ai-stack project sync` links those skills into the repo's `.claude/skills` and `.agents/skills` and lists the links in `.git/info/exclude`. Check that Codex reads `.agents/skills` from the working directory up to the repo root before building.
- A project can only add groups. It cannot hide a global skill, because harnesses always load user-level skills.

### Fleet

- `ai-stack publish` from any machine: generate a commit message from what changed, let the owner edit it, commit, push, then update every machine. It refuses when the checkout is behind the remote. Offline machines are skipped and reported.
- Pull on start: opening the TUI or running a command from a terminal fast-forwards the stack and installs if anything changed, at most once every 15 minutes. Fleet queries over ssh and `--json` calls never pull. A dirty or diverged checkout is skipped with a warning.
- Unpublished changes (uncommitted edits or unpushed commits) show as a one-line CLI hint and a TUI banner.
- A launchd job on the Mac runs the fleet's status, drift and login checks every few hours and posts a macOS notification when something is off. Any ai-stack command also shows a cached one-line fleet note when the last check is old.
- Upstream checks run when the Skills tab opens (one cached `git ls-remote` per source, `r` to refresh). No other background work.

### Interfaces

- TUI tabs, with one letter per action, `/` to filter, `?` for help, and nothing written until confirmed in Review:
  1. Skills: groups, source, pin state (current, behind, modified, missing), manual-only. Adopt, update, rename, set group, toggle manual.
  2. Groups: global on or off, members, budget.
  3. Fleet: branch and commit, behind or ahead, stray counts, login status, drift. Update, switch, login, publish.
  4. Review: the install plan.
- Swift app after the TUI, at parity, plus a menu bar icon for fleet sync state. It runs the CLI and reads `--json` ([ADR 0002](../adr/0002-swift-app-drives-the-cli.md)).

## Build order

Each step ends in a verified install.

1. Land the `skills-manifest` to `fleet-login` branch stack.
2. Standalone skills and groups: move jm-games and jm-tools out of plugins, add `stack.toml`, delete the duplicate top-level `skills/threejs`.
3. Adopt, then adopt `~/.agents/skills`.
4. Retire `~/.agents/other-skills`.
5. Content hashes and manual-only.
6. Full TUI, publish, pull on start, unpublished-change hints, the launchd check.
7. Project mode.
8. Swift app.
