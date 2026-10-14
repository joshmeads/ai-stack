# jm

Personal plugins for Claude Code and Codex, maintained at [joshmeads/ai-stack](https://github.com/joshmeads/ai-stack). The repository is a marketplace named `jm` with three plugins, plus the `ai-stack` CLI that installs them.

| Plugin | Shown as | What it is |
| --- | --- | --- |
| `jm-stack` | `jm-stack:how`, `jm-stack:poteto-mode`, … | [Open Pstack](https://github.com/ericlitman/open-pstack), the Claude Code and Codex port of Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/main/pstack), renamed jm:stack and set up for the models below. Everything else is upstream's. |
| `jm-games` | `jm-games:threejs`, `jm-games:art-iteration` | three.js and react-three-fiber facts, and a loop for visual work judged against reference images. |
| `jm-tools` | `jm-tools:handoff`, `jm-tools:try-to-break-it`, `jm-tools:visual-evidence`, `jm-tools:host-static` | Hand off work to a fresh session, try to break a change before calling it done, capture before/after UI evidence, and host a static build at an unlisted URL. |

## Install

Build the CLI, create the config, preview, then install:

```sh
cargo install --path cli
ai-stack init
ai-stack diff
ai-stack install
```

`ai-stack install` does two things for each harness:

1. It writes the files that differ between Claude Code and Codex: the jm:stack model sheet and a short routing block in `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`.
2. It adds this checkout as the `jm` marketplace and installs `jm-stack`, `jm-games`, and `jm-tools` with each harness's own plugin commands.

It also removes what older ai-stack installs left behind. Every file it changes is backed up under `~/.local/state/ai-stack/backups/`. `ai-stack update` pulls this checkout and installs again. `ai-stack install --clean` (or `c` in the review screen) also moves every skill outside the `[clean] keep_skills` list into the backup and uninstalls every plugin outside `keep_plugins`, so only this install and the keep lists remain; preview it with `ai-stack diff --clean`. See [cli/README.md](cli/README.md) for the details.

## Models

Each harness stays on its own provider's models, except for major reviews.

| Work | Codex | Claude Code |
| --- | --- | --- |
| Lead (the model you talk to) | Sol 6.1, high | Opus 5.5, high |
| Implementation, explanation, swarm workers | Sol 6.1, medium | Opus 5.5, medium |
| Hardest tasks | Sol 6.1, xhigh | Opus 5.5, high |
| Exploration (`how`) | Luna, xhigh | Haiku 5.5, xhigh |
| Judgment, judging, review | Sol 6.1, xhigh | Opus 5.5, xhigh |
| Major review (`interrogate`) | Sol 6.1 and Opus 5.5, xhigh | Opus 5.5 and Sol 6.1, xhigh |

A major review happens after a design is settled and before a pull request. It pairs both providers, so in each harness one reviewer runs through the other provider's CLI, which may ask for your approval. Haiku is kept under 100k tokens of context, where its price is lowest; you set its compaction in Claude Code.

The choices come from Artificial Analysis's intelligence, cost, and time-per-task data, picking points on each provider's Pareto line. Change them in `~/.config/ai-stack/config.toml` and run `ai-stack install`.

## Upstream

jm:stack follows Open Pstack. Merge its updates explicitly:

```sh
git fetch upstream main
git merge upstream/main
```

Read [UPSTREAM.md](UPSTREAM.md) before changing content that came from pstack. [README-OPEN-PSTACK.md](README-OPEN-PSTACK.md) is Open Pstack's own README, and [README-UPSTREAM.md](README-UPSTREAM.md) is Lauren Tan's original.

## Credits

jm:stack is pstack under a new name. Lauren Tan ([@poteto](https://x.com/poteto)) created [pstack](https://github.com/cursor/plugins/tree/main/pstack) from the skills she uses at Cursor. [Open Pstack](https://github.com/ericlitman/open-pstack), maintained by Eric Litman, ported it to Claude Code and Codex, building on Michael Denyer's [pstack-claude](https://github.com/michael-denyer/pstack-claude).

## License

MIT, except where a plugin or skill says otherwise. See [NOTICE.md](NOTICE.md) and the preserved license files.
