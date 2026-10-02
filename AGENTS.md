# open-pstack

Track all durable work in this repository's GitHub Issues. Do not create a parallel Linear queue. Read `UPSTREAM.md` before changing upstream-derived content.

Cursor's `cursor/plugins/pstack` tree is the content upstream. Keep one shared skill tree for Claude Code and Codex; adapt harness primitives at the existing mapping boundaries instead of forking skills or adding compatibility layers. The parent harness resolves provider routing once. Children do not detect or reroute themselves.

Before opening a pull request, run the Bun tests, strict typecheck, static invariants, and plugin validation.

Nothing merges, tags, releases, or rolls out until the exact candidate is installed and the changed behavior passes a live test from the real user surface in every affected harness. Unit tests, validators, source inspection, and self-reports do not satisfy this gate. Record the installed version, surface, action, and observed result in the pull request template. A pull request without that evidence remains a draft.

For Open Pstack PRs, use the shared repository-local `.claude/skills/verify-open-pstack/` skill (Codex: `.agents/skills/verify-open-pstack`). Run its independent Bun tests/typecheck separately from the shipped package. The Mac operator runs `scripts/verify.sh doctor`, then `scripts/verify.sh run --pr <number> --self-test --output <fresh-absolute-external-directory>`; read the skill's Launch section for separate probe/live output directories. Builders leave delivery PRs draft and do not publish the gate. The helper requires isolated candidate installs in both harnesses, operator-reviewed native-surface evidence, and an exact-head `live-gate` targeting the evidence comment before readiness. Every new head, including a queue-created head, needs a fresh run; never hand-post a replacement status. This helper does not queue or merge.

Do not add an implicit runtime timeout or a weaker-model fallback.
