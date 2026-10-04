---
name: verify-open-pstack
description: Verify an Open Pstack PR's exact candidate head in native Claude Code and Codex sessions, retain operator-reviewed real-surface evidence, and publish the exact-SHA live gate.
---

# Verify Open Pstack

## Launch

This repository-local, non-shipped skill is shared with Codex through `.agents/skills/verify-open-pstack`. Run the reviewed verifier from a trusted `main` checkout. The trusted parent owns GitHub reads and publication; candidate processes never receive publisher credentials. Its only GitHub writes are one structured evidence comment and `live-gate` status on the exact candidate SHA; it never queues or merges.

Install development dependencies separately when testing this skill; `verify.sh` does not install at runtime:

```sh
(cd .claude/skills/verify-open-pstack && bun install --frozen-lockfile --ignore-scripts)
```

Then run from the trusted publisher checkout:

```sh
PR=111 # supplied delivery PR number
CLAUDE_SOURCE='/absolute/path/to/authenticated/claude-config'
CODEX_SOURCE='/absolute/path/to/authenticated/codex-home'
SESSION="$(mktemp -d "${TMPDIR:-/tmp}/open-pstack-evidence.XXXXXX")"
EVIDENCE="$SESSION/live" # must not exist yet
.claude/skills/verify-open-pstack/scripts/verify.sh doctor \
  --claude-config "$CLAUDE_SOURCE" --codex-home "$CODEX_SOURCE" --output "$SESSION/probe"
.claude/skills/verify-open-pstack/scripts/verify.sh run --pr "$PR" --self-test \
  --claude-config "$CLAUDE_SOURCE" --codex-home "$CODEX_SOURCE" --output "$EVIDENCE"
```

Replace both placeholders with existing operator-pre-authenticated normal-login configuration directories. Selection is explicit; a selected account may be active in daily use. No profile manager or maintainer-specific infrastructure is required. Authenticate those directories manually before verification; the verifier never starts a login flow. Omit `--self-test` for ordinary plugin verification; it is mandatory for this skill's delivery.

The trusted `main` publisher revision is recorded separately from the PR's candidate SHA. PR #111 bootstrap must use the maintainer-reviewed trusted publisher head, while all candidate installation, classification, evidence, comments, and `live-gate` status remain bound to PR #111's exact candidate SHA. Use a fresh private output directory for every run. The verifier requires an open same-repository PR, pins exact head and base SHAs, classifies immutable Git objects, and rechecks them at phase and publication boundaries. Unknown paths abort; evidence never transfers to another head.

## Doctor

The trusted-parent doctor checks Bun, git, both native harness CLIs, and the capabilities needed by the run. It requires both supplied source directories to exist and validates their authentication with `CLAUDE_CONFIG_DIR=<dir> claude auth status` and `CODEX_HOME=<dir> codex login status`. Unauthorized, expired, missing, or unusable authentication fails closed with the corresponding manual login command: `CLAUDE_CONFIG_DIR=<dir> claude auth login` or `CODEX_HOME=<dir> codex login`. The verifier never executes login or repairs credentials automatically. Candidate-mode doctor checks only candidate-safe capabilities and does not inspect source credentials or publisher authentication. Capability and authentication checks do not prove installation or live behavior; missing requirements fail closed.

Candidates retain the operator's real `HOME`, `USER`, and `LOGNAME`. `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `TMPDIR`, `GH_CONFIG_DIR`, and other XDG/config/cache locations are run-owned. Git configuration is disabled or run-owned. This separation is operational isolation, not an OS security boundary: the verifier makes no Seatbelt, source-protection, Keychain-denial, daily-home secrecy, or Mac filesystem-denial claim.

The trusted parent copies only `.credentials.json` from `--claude-config <dir>` into run-owned `CLAUDE_CONFIG_DIR` and `auth.json` from `--codex-home <dir>` into run-owned `CODEX_HOME`. It does not copy settings or other source-directory state. Complete recognized credential files retain their refresh material so native clients can refresh during the session; refreshed copies are never written back to the source directories. Missing files, unknown credential formats, or unusable authentication fail closed. Never log in, repair credentials automatically, or fall back to daily provider configuration.

## Drive

Read `features/README.md` and every selected feature document. Runtime instructions, consumed references, shipped tools, and installed assets require coverage on their actual consumers. Shared paths select consumers conservatively. `no runtime change` launches no harness unless `--self-test` is requested.

Create detached exact-head candidate checkouts, run-owned provider/config/temp roots, and fixture workspaces. Claude loads the explicit candidate plugin with candidate settings; Codex installs the pinned local marketplace/plugin. Verify installed plugin and project-skill sources against immutable candidate Git provenance before and after exercise. Version strings alone are insufficient.

Every candidate command and external-provider descendant uses the recorded candidate environment. Candidate processes receive disposable provider credentials only, never GitHub publisher credentials. No candidate login, source-credential writeback, implicit timeout, or weaker-model fallback is permitted.

For every selected feature, exercise changed sub-features on each actual consuming native surface and retain real native tool calls and concrete fixture effects. Asset consumers come from the pinned plugin manifests; the current `plugins/pstack/assets/logo.png` is consumed by the Codex manifest only and therefore requires the Codex installed surface, not an invented Claude asset exercise. Save raw transcripts and artifacts in the private run root. Require operator-reviewed surface, action, expected/observed result, and retained artifact paths. Model self-reports and direct CLI tests are not installed-harness evidence.

Setup is currently fail-closed. Until setup-pstack config-home support in issue #120 merges, record exactly `setup exercise requires #120 (setup-pstack config-home)` and do not invoke setup against real `HOME`.

For `project-skill`, invoke `/verify-open-pstack` in Claude and `$verify-open-pstack` in Codex. Ask the discovered pinned skill to run `verify.sh doctor --candidate --output <fresh-run-owned-directory>`. Preserve the invocation and canonical-path doctor output; forbid recursive verification or publication. This does not replace required plugin exercises.

## Evidence

Create the requested run root as a private mode-0700 directory. Keep raw receipts, transcripts, artifacts, selected credential-source paths, immutable source/installation provenance, and credential-cleanup outcome private in that root. Raw evidence may contain operational details and is not a public artifact. Keep it through merge; after the merged evidence is archived, only the operator deletes the named run root. Never retain copied credential files as evidence.

Before publication, revalidate retained transcript and artifact hashes. The trusted parent publishes one bounded, structured PR comment for the exact candidate SHA and sets `live-gate` on that same SHA with the comment URL as its target. It never edits the PR body, marks ready or draft, reverses a transition, or performs PR-state compensation. No other PR write is permitted. Head movement requires a fresh run and status on the new exact SHA.

The public-comment guard compares the rendered comment against the exact credential values registered from the copied known credential fields. It does not use token-shape heuristics and does not claim that arbitrary private raw evidence is secret-free. Unknown credential formats fail before publication. Failure details remain private; the public failure comment is bounded and the exact candidate SHA receives failure status only after disposable credential cleanup succeeds.

## Cleanup

Quit native sessions normally and remove only the copied disposable Claude `.credentials.json` and Codex `auth.json` files on success or failure, including refreshes written to those same run-owned paths. Preserve candidate state and raw evidence. Record cleanup outcome; failed credential cleanup blocks publication. Never modify the supplied source credential files or daily provider files. Preserve the private mode-0700 raw evidence root through merge, archive it after merge, and let the operator delete only the named run root. Do not kill unrelated processes.

## Helpers

- `scripts/verify.sh doctor --claude-config <dir> --codex-home <dir> --output <fresh-absolute-external-directory>`: trusted-parent capability and source-authentication report, no installation/publication.
- `scripts/verify.sh doctor --candidate --output <fresh-run-owned-directory>`: candidate-safe self-test probe; no source-credential or publisher authentication probing.
- `scripts/verify.sh run --pr <positive-number> --claude-config <dir> --codex-home <dir> [--self-test] --output <fresh-absolute-external-directory>`: supervised exact-head verification; mapped exercises require an interactive terminal.
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
