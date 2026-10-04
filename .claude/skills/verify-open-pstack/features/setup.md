# Setup and model configuration

## Sub-features

Installed setup invocation, harness-to-provider mapping, generated routing/model preferences, unavailable-provider handling, and changed configuration references.

## How to get to it (user POV)

The intended installed entries are `/pstack:setup-pstack` in Claude and `$setup-pstack` in Codex. The installed instructions are the authority for setup inputs, but the verifier must not invoke them against the operator's real `HOME` before config-home support exists.

## Driving it with verify-open-pstack

Setup is mandatory fail-closed until setup-pstack config-home support in issue #120 merges. For every selected setup exercise, record exactly:

`setup exercise requires #120 (setup-pstack config-home)`

Stop that verification run. Do not invoke setup, redirect `HOME`, permit writes to daily paths, use a mock, or accept a generated file from a direct CLI test as substitute evidence.

After #120 merges, use its explicit config-home to target run-owned state while retaining real `HOME`, `USER`, and `LOGNAME`. Exercise each changed setup branch with explicit requested model/provider inputs, retain the native invocation transcript and generated configuration file, and invoke a consuming installed skill to observe the configured route. Confirm all setup writes remain under the explicit run-owned config home.

## Gotchas

`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, XDG/GitHub config, and temp paths are run-owned, but `HOME` is intentionally real. That is why setup cannot run safely before #120. Supply operator-pre-authenticated normal-login directories with `--claude-config <dir>` and `--codex-home <dir>`; selected accounts may be active in daily use. Copy only `.credentials.json` and `auth.json` into run-owned provider roots, preserving refresh material. Do not copy other daily configuration, log in, or write credentials back to source directories. Trusted-parent doctor validates sources with `claude auth status` under the supplied `CLAUDE_CONFIG_DIR` and `codex login status` under the supplied `CODEX_HOME`; authentication failures fail closed with `CLAUDE_CONFIG_DIR=<dir> claude auth login` or `CODEX_HOME=<dir> codex login`, which the verifier never executes automatically. Generated configuration by itself does not prove the consuming surface.
