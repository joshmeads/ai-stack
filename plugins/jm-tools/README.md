# jm-tools

Working tools for Claude Code and Codex, shipped in the `jm` marketplace.

| Skill | Use |
| --- | --- |
| `handoff` | Write a continuation packet so work can resume in a fresh session. |
| `try-to-break-it` | Exercise a change adversarially and report reproducible evidence. |
| `visual-evidence` | Take matching before/after screenshots of a UI change. |
| `host-static` | Host a built static folder at an unlisted games.joshmeads.dev URL. |

## Install

The ai-stack CLI installs this plugin from the local `jm` marketplace. To install it by hand:

```sh
# Claude Code
/plugin marketplace add joshmeads/ai-stack
/plugin install jm-tools@jm
# Codex
codex plugin marketplace add joshmeads/ai-stack
codex plugin add jm-tools@jm
```

License: MIT.
