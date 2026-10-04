# Installed skill invocation

## Sub-features

Every registry skill is its own required feature. Include changed arguments, routing, consumed references, helper actions, and removal behavior. Principle leaves are model-invocable, not slash-menu entries. `project-skill` separately verifies this repository-local skill's discovery.

## How to get to it (user POV)

In a fresh Claude session invoke `/pstack:<name>`. In Codex use the installed skill selector or `$<name>`. Invoke principle leaves through the model's native skill tool. For self-test invoke `/verify-open-pstack` in Claude and `$verify-open-pstack` in Codex.

## Driving it with verify-open-pstack

Launch the prepared harness with real `HOME`, `USER`, and `LOGNAME`; run-owned `TMPDIR`, GitHub/XDG/config/cache paths, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME`; and no publisher credentials. Use trusted-parent copies of complete recognized credentials for explicitly selected caam accounts so native refresh can work; selected profiles may be active in daily use. Trusted-parent doctor must run `caam limits <tool> --format json` and inspect the chosen `profile_name` for each provider. Unauthorized or expired results fail closed with the exact manual repair command `caam add <tool> <account> --no-activate --force`; the verifier never executes repair automatically. No login, daily-provider fallback, or vault writeback is allowed.

For each selected name, use a disposable fixture appropriate to its documented input, invoke the installed surface, and exercise every changed sub-feature. Observe native tool/skill loading and a concrete fixture effect, not the assistant saying it passed. Save the raw transcript and an artifact showing the actual result (diff, generated file, tool receipt, or UI capture) under the private mode-0700 evidence root. Include input, expected result, observed result, and each changed sub-feature in the operator review.

For `project-skill`, invoke the discovered skill and ask it to run `verify.sh doctor --candidate --output <fresh-run-owned-directory>`; candidate mode must not probe caam or publisher authentication. Forbid recursive `run` and publication. Preserve the native invocation transcript plus `doctor.json`, checking the canonical executable path and immutable source provenance belong to the pinned project skill. The Codex symlink and Claude canonical directory must both be discovered in fresh sessions. If candidate mode is unavailable, stop; do not substitute trusted-parent doctor.

## Gotchas

A generic prompt about a skill is not native invocation evidence. A list of discovered skills is not behavioral proof. Environment/config separation does not establish Seatbelt, daily-home, Keychain, or source-write denial, and no such claim belongs in evidence. If an invocation would merge, queue, release, mutate a PR, or write daily state, use a safe disposable fixture or record failure; do not weaken the gate. Never use the child verifier to publish a comment or status.
