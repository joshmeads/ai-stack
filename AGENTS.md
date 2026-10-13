# jm

This repository is the `jm` marketplace (`jm-stack`, `jm-games`, `jm-tools`) plus the `ai-stack` CLI in `cli/`. Track durable work in GitHub Issues on `joshmeads/ai-stack`.

`plugins/pstack/` is Open Pstack renamed jm:stack. Read `UPSTREAM.md` before changing it, keep upstream behaviour unless a change is listed there as a divergence, and merge upstream updates explicitly. Keep one shared skill tree for Claude Code and Codex; adapt harness differences at the existing mapping boundaries instead of forking skills. The parent harness resolves model routing once. Children do not detect or reroute themselves.

Before opening a pull request, run:

- `bun run test` and `bun run typecheck` in `plugins/pstack/skills/poteto-mode/scripts`
- `PSTACK_STATIC_ONLY=1 bash tests/skill-collision-repro.sh`
- `claude plugin validate` on the repository root and on each plugin directory
- `cargo test` in `cli/`

Before merging, install the exact candidate with `ai-stack install` and check the changed behaviour from the real Claude Code and Codex surfaces it affects. Record what you installed, where you tested, what you did, and what you saw in the pull request.

Do not add an implicit runtime timeout or a weaker-model fallback.
