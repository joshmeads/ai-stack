---
name: verify-open-pstack
description: Verify an Open Pstack PR's exact candidate head in native Claude Code and Codex sessions, retain operator-reviewed real-surface evidence, and publish the exact-SHA live gate.
---

# Verify Open Pstack

## Launch

This repository-local, non-shipped skill is shared with Codex through `.agents/skills/verify-open-pstack`. Verifier-changing PRs run from a checkout of their reviewed candidate head; all other PRs run from trusted `main`. The trusted parent owns GitHub reads and publication; candidate processes never receive publisher credentials. Its only GitHub writes are one structured evidence comment and `live-gate` status on the exact candidate SHA; it never queues or merges.

Install development dependencies separately when testing this skill; `verify.sh` does not install at runtime:

```sh
(cd .claude/skills/verify-open-pstack && bun install --frozen-lockfile --ignore-scripts)
```

Then run from the trusted publisher checkout:

```sh
PR=111 # supplied delivery PR number
SESSION="$(mktemp -d "${TMPDIR:-/tmp}/open-pstack-evidence.XXXXXX")"
EVIDENCE="$SESSION/live" # must not exist yet
.claude/skills/verify-open-pstack/scripts/verify.sh doctor --output "$SESSION/probe"
.claude/skills/verify-open-pstack/scripts/verify.sh run --pr "$PR" --self-test --output "$EVIDENCE"
```

Reuse the Claude Code and Codex logins you already have; no extra login or credential source flags. Omit `--self-test` for ordinary plugin verification; it is mandatory for this skill's delivery.

The publisher revision is recorded separately from the candidate SHA and must equal it when classification selects `project-skill`. Run those PRs from their reviewed candidate head; run all other PRs from trusted `main`. Use a fresh private output directory for every run. The verifier requires an open same-repository PR, pins exact head and base SHAs, classifies immutable Git objects, and rechecks them at phase and publication boundaries. Unknown paths abort; evidence never transfers to another head.

## Doctor

The parent doctor checks Bun, git, both native harness CLIs, and required capabilities. There are no credential-source flags or source-directory authentication checks. Candidate-mode doctor checks only candidate-safe capabilities, not publisher authentication. Capability checks do not prove installation or live behavior; missing requirements fail closed.

Candidates retain real `HOME`, `USER`, and `LOGNAME`. Claude uses normal operator config/login. Codex uses a run-owned `CODEX_HOME` with `auth.json` symlinked to the operator's `${CODEX_HOME:-$HOME/.codex}/auth.json`, resolving the daily home before overriding the environment. If that source file is absent, stop with a plain message that this tool needs file-based Codex auth; do not start login. Refresh writes through the symlink to the single existing login file.

Temporary, GitHub, and fixture state remain run-owned; Git configuration is disabled or run-owned. This is operational state separation, not an OS security boundary. Do not read, parse, or copy credential contents, register tokens, or check public comments against credentials. No extra login directories are needed.

## Drive

Read `features/README.md` and every selected feature document. Runtime instructions, consumed references, shipped tools, and installed assets require coverage on their actual consumers. Shared paths select consumers conservatively. `no runtime change` launches no harness unless `--self-test` is requested.

Create detached exact-head candidate checkouts and run-owned temporary/fixture state. Launch Claude with normal operator config/login and session-only `claude --plugin-dir <exact-head checkout>/plugins/pstack --settings '{"enabledPlugins":{"pstack@open-pstack":false}}'`. Codex installs the exact-head marketplace/plugin in its run-owned home with `codex plugin marketplace add … --ref <sha>` and `codex plugin add`. Verify candidate plugin and project-skill sources against immutable Git provenance before and after exercise; version strings alone are insufficient.

Candidate commands and provider descendants use the recorded native-login arrangement, never GitHub publisher credentials. No extra login, implicit timeout, or weaker-model fallback is permitted. If Claude's plugin flags fail to exclude installed pstack or Codex replaces the auth symlink instead of writing through it, stop and reopen the design.

For every selected feature, exercise changed sub-features on each actual consuming native surface and retain real native tool calls and concrete fixture effects. Asset consumers come from the pinned plugin manifests; the current `plugins/pstack/assets/logo.png` is consumed by the Codex manifest only and therefore requires the Codex installed surface, not an invented Claude asset exercise. Save raw transcripts and artifacts in the private run root. Require operator-reviewed surface, action, expected/observed result, and retained artifact paths. Model self-reports and direct CLI tests are not installed-harness evidence.

For setup only, snapshot real `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/pstack-models.md` and `CLAUDE.md`, including original absence, before exercise. Restore exact bytes or absence afterwards on success or failure and verify restoration before any publication. Restoration failure stops the run and publishes nothing.

For `project-skill`, invoke `/verify-open-pstack` in Claude and `$verify-open-pstack` in Codex. Ask the discovered pinned skill to run `verify.sh doctor --candidate --output <fresh-run-owned-directory>`. Preserve the invocation and canonical-path doctor output; forbid recursive verification or publication. This does not replace required plugin exercises.

## Evidence

Create a fresh private mode-0700 run root. Keep raw receipts, transcripts, artifacts, immutable source/installation provenance, and setup restoration results private through merge. Raw evidence is not a public artifact; after archival, only the operator deletes the named run root.

Before publication, revalidate retained transcript and artifact hashes. The trusted parent publishes one bounded, structured PR comment for the exact candidate SHA and sets `live-gate` on that same SHA with the comment URL as its target. It never edits the PR body, marks ready or draft, reverses a transition, or performs PR-state compensation. No other PR write is permitted. Head movement requires a fresh run and status on the new exact SHA.

Re-prompt operator `surface`, `action`, and `observed` values until each is printable ASCII without backtick or angle brackets and at most 160 characters. Publish accepted values verbatim using the shared predicate. Other unsafe fields remain omitted whole. Failure details remain private; never publish raw evidence or claim it is secret-free. Failed setup restoration forbids all publication.

## Cleanup

Quit native sessions normally. Verify any setup restoration before publication. Removing the Codex run home removes only its auth symlink, never the operator's target file. Preserve private raw evidence through merge, archive it afterwards, and let the operator delete only the named run root. No credential-copy cleanup or separate `~/.pstack-verify` login directories are needed. Do not kill unrelated processes.

## Helpers

- `scripts/verify.sh doctor --output <fresh-absolute-external-directory>`: parent capability report, no installation/publication.
- `scripts/verify.sh doctor --candidate --output <fresh-run-owned-directory>`: candidate-safe self-test probe; no publisher authentication probing.
- `scripts/verify.sh run --pr <positive-number> [--self-test] --output <fresh-absolute-external-directory>`: supervised exact-head verification; mapped exercises require an interactive terminal.
- `bun run test` and `bun run typecheck`: development checks after a separate frozen dependency install, not live proof.
- `features/registry.json`: maintained path ownership; unknown runtime paths block.

Read receipts as data, never shell input. Do not put credentials in prompts or public artifacts.

## Scripts
- scripts/cli.test.ts
- scripts/cli.ts
- scripts/core.test.ts
- scripts/core.ts
- scripts/doctor.ts
- scripts/github.ts
- scripts/harness.test.ts
- scripts/harness.ts
- scripts/io.test.ts
- scripts/io.ts
- scripts/isolation.test.ts
- scripts/isolation.ts
- scripts/provenance.test.ts
- scripts/provenance.ts
- scripts/types.ts
- scripts/verify.sh
- scripts/verify.test.ts
- scripts/verify.ts
