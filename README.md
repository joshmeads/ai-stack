# jm

Personal skills for Claude Code and Codex, maintained at [joshmeads/ai-stack](https://github.com/joshmeads/ai-stack). The repository is the stack: a marketplace named `jm` with three plugins, a folder of standalone skills, and the `ai-stack` CLI that installs both.

| Part | Shown as | What it is |
| --- | --- | --- |
| `pstack` plugin | `pstack:how`, `pstack:poteto-mode`, … | A Claude Code and Codex port of Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/main/pstack), set up for the models below. Everything else is upstream's. |
| `t3stack` plugin | `t3stack:file-pr`, `t3stack:full-send`, … | Theo Browne's [tstack](https://github.com/t3dotgg/tstack) skills for filing, babysitting and finishing PRs, vendored through `stack.toml`. |
| `pocock` plugin | `pocock:grill-me`, `pocock:wizard`, … | The [mattpocock/skills](https://github.com/mattpocock/skills) skills kept on by default, vendored through `stack.toml`. |
| Standalone skills in [`skills/`](skills/README.md) | `handoff`, `archify`, `game-gdd`, `threejs`, `to-spec`, … | Write a game design document and take a browser game from prompt to MVP to final build; three.js, react-three-fiber, Phaser, audio, Blender and web QA tools; a loop for visual work judged against reference images; working tools for handoffs, adversarial checks, visual evidence, performance profiling, static hosting and feedback; engineering skills for specs, tickets and triage; and writing skills. |

`stack.toml` sorts the standalone skills into groups. A global group's skills are installed for every harness, and only `core` is global; `ai-stack groups` lists the groups and their estimated token cost. Private skills live in a gitignored `private/` folder that the repository carries only encrypted, as `private.age`; see [Private skills](skills/README.md#private-skills).

## Install

Build the CLI, create the config, preview, then install:

```sh
cargo install --path cli
ai-stack private init
ai-stack init
ai-stack diff
ai-stack install
```

`ai-stack private init` turns on the repository's git hooks and opens `private.age`. A machine without a key in `private.recipients` skips it and installs only the public skills.

`ai-stack install` does three things for each harness:

1. It writes the files that differ between Claude Code and Codex: the pstack model sheet for that harness, a short routing block, and an instructions block in `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`. The instructions block inlines `instructions/common.md` and the harness's own file (`claude.md` or `codex.md`, which carries the Anthropic guidance text for Claude Code). See [instructions/README.md](instructions/README.md).
2. It adds this checkout as the `jm` marketplace and installs every plugin it lists (`pstack`, `t3stack` and `pocock`) with each harness's own plugin commands, and uninstalls any other `jm` plugin, such as the retired `jm-games` and `jm-tools`.
3. It links each skill of the global groups into `~/.claude/skills` (Claude Code) and `~/.agents/skills` (Codex) under its plain name.

It also removes what older ai-stack installs left behind. Every file it changes is backed up under `~/.local/state/ai-stack/backups/`. `ai-stack update` pulls this checkout and installs again. `ai-stack install --clean` (or `c` in the review screen) also moves every skill outside the `[clean] keep_skills` list into the backup and uninstalls every plugin outside `keep_plugins`, so only this install and the keep lists remain; preview it with `ai-stack diff --clean`. See [cli/README.md](cli/README.md) for the details.

Claude Code leaves auto-update off for third-party marketplaces, so `pstack` stays on the installed version until `ai-stack install` or `ai-stack update` refreshes it. The refresh happens when the version in the checkout changes.

### Updating another machine

On a machine that already has an install, run these in order:

1. Switch to this branch and pull it.
2. `cargo install --path cli`, so the binary matches `stack.toml`.
3. `ai-stack diff`
4. `ai-stack install --force`
5. Restart Claude Code and Codex sessions.

The first install needs `--force`, because it moves any hand-installed copy of a stack skill to the backup.

## Models

First-run role defaults use Opus and Sol, and Opus and Astra for reviews and the arena judge. In the shipped `ai-stack` sheet below, each harness stays on its own provider's models, except for major reviews, the arena judge and `arena runners`, which seats Opus and Sol and also Grok through Cursor and Gemini through agy.

Each entry is a model family. The [model catalog](plugins/pstack/skills/poteto-mode/references/model-catalog.md) gives each family's current model. A model release updates the catalog, not your config.

| Work | Codex | Claude Code |
| --- | --- | --- |
| Lead (the model you talk to) | Sol, high | Opus, high |
| Implementation, explanation, swarm workers | Sol, medium | Opus, medium |
| Hardest tasks | Astra, xhigh | Opus, high |
| Exploration (`how`) | Terra, xhigh | Haiku, xhigh |
| Judgment, review | Astra, xhigh | Opus, xhigh |
| Arena judge | Opus, xhigh | Astra, xhigh |
| Major review (`interrogate`) | Astra and Opus, xhigh | Opus and Astra, xhigh |

A major review happens after a design is settled and before a pull request. It pairs both providers, so in each harness one reviewer runs through the other provider's CLI, which may ask for your approval. Arena's judge always comes from the other provider, and an arena skips its judge when that CLI cannot run. Haiku is kept under 100k tokens of context, where its price is lowest; you set its compaction in Claude Code.

The choices come from Artificial Analysis's intelligence, cost, and time-per-task data, picking points on each provider's Pareto line. Change them in `~/.config/ai-stack/config.toml` and run `ai-stack install`.

Fable, Sonnet and Luna stay selectable in those sheets, unused by default. The plugin also keeps read-only lanes on OpenCode, Amp, Cursor CLI, Devin, Antigravity, DeepSeek Harness and `pi`, which reaches OpenRouter's models. `setup-stack` and ai-stack sheets can select them for roles that do not write files, including `arena runners`, where a read-only family returns its candidate to the parent. `read-only` limits the model's tools, not the CLI, so repository code may run in such a lane: each runs in its own throwaway worktree, and you should seat them only on repositories you trust. No first-run default uses them, the shipped `ai-stack` sheet uses them only for the Grok and Gemini `arena runners` seats, and Grok is available only as a Cursor lane on a row you choose. The [model catalog](plugins/pstack/skills/poteto-mode/references/model-catalog.md) lists every choice.

## Upstream

The `pstack` plugin follows Cursor's pstack. [UPSTREAM.md](UPSTREAM.md) says how to check for and merge its updates; read it before changing content that came from pstack. [README-UPSTREAM.md](README-UPSTREAM.md) is Lauren Tan's original README.

## Credits

Lauren Tan ([@poteto](https://x.com/poteto)) created [pstack](https://github.com/cursor/plugins/tree/main/pstack) from the skills she uses at Cursor.

Several standalone tool skills are adapted from other authors' MIT and Apache-2.0 skills; [skills/README.md](skills/README.md#credits) and [NOTICE.md](NOTICE.md) list them.

## License

MIT, except where a plugin or skill says otherwise. See [NOTICE.md](NOTICE.md) and the preserved license files.
