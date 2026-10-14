# jm-tools

Working tools for Claude Code and Codex, shipped in the `jm` marketplace.

| Skill | Use |
| --- | --- |
| `handoff` | Write a continuation packet so work can resume in a fresh session. |
| `try-to-break` | Try to break a change on purpose and report what fails, with evidence. |
| `visual-evidence` | Take matching before/after screenshots of a UI change. |
| `host-static` | Host a built static folder at an unlisted games.joshmeads.dev URL. |
| `feedback` | Record the user's feedback on the current project in `FEEDBACK.md`, newest first. |
| `codex-session-export` | Find and export the Codex sessions that contributed to a project, with their metadata. |

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
