---
name: verify-open-pstack
description: Verify an Open Pstack PR's exact head in isolated Claude Code and Codex sessions, retain operator-reviewed real-surface evidence, and publish the live gate.
---

# Verify Open Pstack

## Launch

This is a repository-local, non-shipped skill shared with Codex through `.agents/skills/verify-open-pstack`. Run from a trusted checkout on the operator's Mac. Never run a candidate's arbitrary scripts with GitHub credentials. Review this verifier before using it; it creates GitHub comments/statuses and can mark a draft ready. It never queues or merges.

```sh
(cd .claude/skills/verify-open-pstack && bun install --frozen-lockfile)
PR=123 # supplied delivery PR number
SESSION="$(mktemp -d "${TMPDIR:-/tmp}/open-pstack-evidence.XXXXXX")"
EVIDENCE="$SESSION/live" # must not exist yet
.claude/skills/verify-open-pstack/scripts/verify.sh doctor --output "$SESSION/probe"
.claude/skills/verify-open-pstack/scripts/verify.sh run --pr "$PR" --self-test --output "$EVIDENCE"
```

Omit `--self-test` for ordinary plugin verification; it is mandatory for this skill's own delivery. Use a new evidence directory for every run, even if the head is unchanged. A previous run cannot resume or transfer success. The helper pins the open, same-repository PR's 40-character head SHA, fetches that exact object, classifies old/new changed paths, and checks the head at every boundary and around publication. Unknown paths abort.

## Doctor

Requires Darwin, Bun, gh authentication, both harness CLIs, and operator access to every selected provider. `doctor` writes `doctor.json` outside the checkout. It checks the supported isolation flags but does not claim that installation or live behavior works.

The approved October 2 Mac probe (issue #90, comment 5961645184) reported Darwin, Claude Code 2.1.283, codex-cli 0.160.0, Bun 1.4.0, gh 2.97.0. Selected interfaces: Claude `--plugin-dir`, `--settings`, `--setting-sources`, `CLAUDE_CONFIG_DIR`; Codex local `plugin marketplace add`/`plugin add`, `CODEX_HOME`. Each harness also receives a run-owned `HOME`. Installation/provenance checks validate those choices during the actual run. Missing interfaces or authentication fail closed: never use a daily install.

## Drive

Read `features/README.md` and each selected feature document. Runtime markdown and consumed references are runtime. Shared paths select all consumers conservatively. `no runtime change` launches no harness unless the separate `--self-test` was requested.

The runner creates a detached exact-head candidate, separate homes and fixture workspaces, and executable launchers. Claude loads the candidate with its explicit plugin directory; Codex installs the candidate's local marketplace into its isolated home. The installed trees must match the candidate's content digest; a shared version string is insufficient. Fresh fixture sessions discover the canonical project skill and Codex link copied from this head.

The operator authenticates only these isolated homes when needed, using the printed launcher with `auth login` (Claude) or `login` (Codex); do not copy daily auth/configuration. GitHub tokens and daily provider secrets are excluded from harness subprocess environments. A missing configured provider remains a feature failure. Never add a timeout or weaker-model fallback.

For each selected feature in **each** harness, the runner opens a fresh native session with instructions from the feature map. Use a safe disposable fixture, exercise all changed sub-features, and observe actual tool calls and effects. Save and redact the native transcript and result artifacts outside the checkout. The runner asks for the surface, action, observed result, transcript path, and artifact paths, then requires explicit operator approval. Empty or missing evidence fails. A model's assertion that it passed does not count. Direct CLI proof is supplemental and must be labeled separately.

For `--self-test`, invoke this discovered project skill in both sessions and run `doctor` into a child evidence directory; save invocation traces and that output. Do not recursively run verification or publish from those sessions. This self-test cannot replace plugin-runtime exercises.

## Evidence

Retain `doctor.json`, `receipt.json`, installed provenance, redacted transcripts, artifacts, and cleanup outcome in `$EVIDENCE`. Artifact content is hashed before publication. The helper rechecks installation digests and artifact hashes after exercises. The PR comment includes `Live evidence:`, head SHA, installed version/location/tree, surface/action/observed result, artifact hashes, and failure or `no runtime change`.

Only complete evidence publishes `live-gate=success` on the pinned SHA, targeting the evidence-comment URL; only then may this run mark a draft ready. Failure records its reason and, where possible, publishes failure against that same SHA. A changed head aborts; detected post-write races withdraw old-head success and restore draft if this run made it ready. GitHub mutations are not atomic; failed compensation is recorded prominently. Never attach the old run to a new head.

The builder opens this delivery as a draft and does **not** run publication. The Mac operator supplies live evidence. Workflow changes require explicit operator queue submission. If Mergify creates another head, rerun on it; never hand-post a replacement status or reuse an old receipt. Queue policy/recovery is outside this skill.

## Cleanup

The runner leaves all run-owned state and evidence intact; it does not delete daily state or kill unrelated processes. Quit spawned native sessions normally. After reviewing and archiving evidence, the operator may remove only this run's candidate/homes/workspaces. Record that action in the retained receipt's cleanup field; retain redacted transcripts and artifact hashes. No implicit cleanup or runtime timeout.

## Helpers

- `scripts/verify.sh doctor --output <absolute-external-directory>`: capability report, no installation/publication.
- `scripts/verify.sh run --pr <positive-number> [--self-test] --output <absolute-external-directory>`: supervised exact-head live verification and publication. Requires an interactive terminal for mapped exercises.
- `bun run test` and `bun run typecheck` in this skill directory: orchestration tests and strict types; not live proof.
- `features/registry.json`: maintained path ownership; unknown runtime paths block rather than guessing.

Read receipts as data, never shell input. Do not put secrets in prompts/artifacts. All external commands use argument arrays; PR metadata is never evaluated as code.
