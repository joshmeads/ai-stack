# Runner and provider dispatch

## Sub-features

Strict argument validation, parent/provider routing, external child launch, prompt delivery, output and receipt persistence, and failure reporting; inspect the diff for which branches changed.

## How to get to it (user POV)

Invoke the installed parent workflow (`poteto-mode`, `arena`, or `swarm` as documented by the candidate) in the fresh native harness. Have that parent dispatch its documented external-provider lane.

## Driving it with verify-open-pstack

Read the candidate's `pstack-runner --help` and installed mapping through the native skill. Use a run-owned fixture and fresh output/receipt paths. Exercise all changed provider lanes without changing parent routing. Retain the native parent/child transcript, provider receipt, output, and concrete fixture effect. Confirm provider/model/effort/access mode match the requested route and output belongs to this invocation. Exercise changed invalid-input/failure branches as well. Keep direct runner tests in a separately labeled local-CLI artifact, never as the installed-harness result.

## Gotchas

Every external-provider child retains real `HOME`, `USER`, and `LOGNAME` while inheriting run-owned `TMPDIR`, `GH_CONFIG_DIR`, XDG/config/cache paths, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME`. This state separation is not an OS access-denial guarantee. Never let Claude→Codex or Codex→Claude fall back to daily provider configuration, and never pass publisher credentials.

Supply operator-pre-authenticated normal-login directories with `--claude-config <dir>` and `--codex-home <dir>`. The trusted parent copies only complete recognized `.credentials.json` and `auth.json` files so native refresh can work, and removes only those copied credential files (including refreshes written to those paths) during cleanup without writing back to source directories or deleting raw evidence. A selected account may be active in daily use. Trusted-parent doctor validates the supplied directories with `claude auth status` under the source `CLAUDE_CONFIG_DIR` and `codex login status` under the source `CODEX_HOME`; missing or unusable authentication is a failure, not a skip or weaker-model fallback. Authentication failures report `CLAUDE_CONFIG_DIR=<dir> claude auth login` or `CODEX_HOME=<dir> codex login`; never execute login automatically. Do not add implicit timeouts. A model assertion that a child ran is insufficient; inspect the actual receipt and output. Never reuse output from another SHA or run.
