# Installed skill invocation

## Sub-features

Every registry skill is its own required feature. Include changed arguments, routing, consumed references, helper actions, and removal behavior. Principle leaves are model-invocable, not slash-menu entries. `project-skill` separately verifies this repository-local skill's discovery.

## How to get to it (user POV)

In a fresh Claude session invoke `/pstack:<name>`. In Codex use the installed skill selector or `$<name>`. Invoke principle leaves through the model's native skill tool. For self-test invoke `/verify-open-pstack` in Claude and `$verify-open-pstack` in Codex.

## Driving it with verify-open-pstack

Launch the prepared harness with real `HOME`, `USER`, and `LOGNAME`; run-owned `TMPDIR`, GitHub/XDG/config/cache paths, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME`; and no publisher credentials. Supply operator-pre-authenticated normal-login directories with `--claude-config <dir>` and `--codex-home <dir>`; selected accounts may be active in daily use. Use trusted-parent copies of only complete recognized `.credentials.json` and `auth.json` files, retaining refresh material. Trusted-parent doctor validates sources with `claude auth status` under the supplied `CLAUDE_CONFIG_DIR` and `codex login status` under the supplied `CODEX_HOME`. Authentication failures fail closed with `CLAUDE_CONFIG_DIR=<dir> claude auth login` or `CODEX_HOME=<dir> codex login`; the verifier never executes login automatically. No candidate login, daily-provider fallback, or source-credential writeback is allowed.

For each selected name, use a disposable fixture appropriate to its documented input, invoke the installed surface, and exercise every changed sub-feature. Observe native tool/skill loading and a concrete fixture effect, not the assistant saying it passed. Save the raw transcript and an artifact showing the actual result (diff, generated file, tool receipt, or UI capture) under the private mode-0700 evidence root. Include input, expected result, observed result, and each changed sub-feature in the operator review.

For `project-skill`, invoke the discovered skill and ask it to run `verify.sh doctor --candidate --output <fresh-run-owned-directory>`; candidate mode must not inspect source credentials or probe publisher authentication. Forbid recursive `run` and publication. Preserve the native invocation transcript plus `doctor.json`, checking the canonical executable path and immutable source provenance belong to the pinned project skill. The Codex symlink and Claude canonical directory must both be discovered in fresh sessions. If candidate mode is unavailable, stop; do not substitute trusted-parent doctor.

## Gotchas

A generic prompt about a skill is not native invocation evidence. A list of discovered skills is not behavioral proof. Environment/config separation does not establish Seatbelt, daily-home, Keychain, or source-write denial, and no such claim belongs in evidence. If an invocation would merge, queue, release, mutate a PR, or write daily state, use a safe disposable fixture or record failure; do not weaken the gate. Never use the child verifier to publish a comment or status.
