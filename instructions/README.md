# Global instructions

`ai-stack install` (and `diff`, `update`, `fleet update`) copies the files here into each harness's global instruction file, so they reach every machine through `git pull` and install.

- `common.md`: for every harness.
- `claude.md`: Claude Code only, written into `~/.claude/CLAUDE.md`.
- `codex.md`: Codex only, written into `~/.codex/AGENTS.md`.

Each harness gets one block between `<!-- ai-stack:instructions:begin -->` and `<!-- ai-stack:instructions:end -->`: `common.md`, a blank line, then its own file, each trimmed. A missing or blank file is skipped. When neither file exists for a harness, install removes the block from that harness's file. The text is inlined, never `@`-imported.

Text outside the managed blocks in the global files is never modified. Do not put `<!-- ai-stack:`, `<!-- pstack:` or `<!-- open-pstack:` in these files; install refuses a source that contains one.

This README is not copied anywhere.
