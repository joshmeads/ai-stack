# open-pstack

Track all durable work in this repository's GitHub Issues. Do not create a parallel Linear queue. Read `UPSTREAM.md` before changing upstream-derived content.

Cursor's `cursor/plugins/pstack` tree is the content upstream. Keep one shared skill tree for Claude Code and Codex; adapt harness primitives at the existing mapping boundaries instead of forking skills or adding compatibility layers. The parent harness resolves provider routing once. Children do not detect or reroute themselves.

Before opening a pull request, run the Bun tests, strict typecheck, static invariants, and plugin validation.

Nothing merges, tags, releases, or rolls out until the exact candidate is installed and the changed behavior passes a live test from the real user surface in every affected harness. Unit tests, validators, source inspection, and self-reports do not satisfy this gate. The record is the `live-gate` commit status on that exact head, which links an evidence comment naming the installed version, surface, action, and observed result. Mergify does not queue a pull request without it. A pull request may be ready for review before its live test, but every new head, including a queue-created head, needs its own.

For Open Pstack PRs, use the shared repository-local `.claude/skills/verify-open-pstack/` skill (Codex: `.agents/skills/verify-open-pstack`). Run the reviewed verifier from trusted `main`, recording the publisher revision separately from the candidate SHA. Read Launch for the explicit inactive caam account options and separate private probe/live directories. Candidate processes and provider children retain real `HOME`/`USER`/`LOGNAME` with both provider config roots and temporary state run-owned; full disposable credential copies retain native refresh material and are never written back to the vault. Cleanup removes only copied credential files and preserves mode-0700 raw evidence through merge. Setup coverage fails closed with `setup exercise requires #120 (setup-pstack config-home)` until #120 merges. Publication is one structured evidence comment plus exact-SHA `live-gate`, with exact copied-secret checks on the public comment only. No PR-body, ready/draft, reversal, or compensation writes, publisher-code attestation, or OS filesystem-denial claims are permitted. Builders do not publish the gate, queue, or merge.

Do not add an implicit runtime timeout or a weaker-model fallback.
