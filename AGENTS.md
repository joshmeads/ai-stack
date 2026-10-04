# open-pstack

Track all durable work in this repository's GitHub Issues. Do not create a parallel Linear queue. Read `UPSTREAM.md` before changing upstream-derived content.

Cursor's `cursor/plugins/pstack` tree is the content upstream. Keep one shared skill tree for Claude Code and Codex; adapt harness primitives at the existing mapping boundaries instead of forking skills or adding compatibility layers. The parent harness resolves provider routing once. Children do not detect or reroute themselves.

Before opening a pull request, run the Bun tests, strict typecheck, static invariants, and plugin validation.

Nothing merges, tags, releases, or rolls out until the exact candidate is installed and the changed behavior passes a live test from the real user surface in every affected harness. Unit tests, validators, source inspection, and self-reports do not satisfy this gate. The record is the `live-gate` commit status on that exact head, which links an evidence comment naming the installed version, surface, action, and observed result. Mergify does not queue a pull request without it. A pull request may be ready for review before its live test, but every new head, including a queue-created head, needs its own.

Do not add an implicit runtime timeout or a weaker-model fallback.
