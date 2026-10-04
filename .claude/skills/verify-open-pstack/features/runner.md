# Runner and provider dispatch

## Sub-features

Strict argument validation, parent/provider routing, external child launch, prompt delivery, output and receipt persistence, and failure reporting; inspect the diff for which branches changed.

## How to get to it (user POV)

Invoke the installed parent workflow (`poteto-mode`, `arena`, or `swarm` as documented by the candidate) in the fresh native harness. Have that parent dispatch its documented external-provider lane.

## Driving it with verify-open-pstack

Read the candidate's `pstack-runner --help` and installed mapping through the native skill. Use a run-owned fixture and fresh output/receipt paths. Exercise all changed provider lanes without changing parent routing. Retain the native parent/child transcript, provider receipt, output, and concrete fixture effect. Confirm provider/model/effort/access mode match the requested route and output belongs to this invocation. Exercise changed invalid-input/failure branches as well. Keep direct runner tests in a separately labeled local-CLI artifact, never as the installed-harness result.

## Gotchas

Every external-provider child retains real `HOME`, `USER`, and `LOGNAME` while inheriting run-owned `TMPDIR`, `GH_CONFIG_DIR`, XDG/config/cache paths, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME`. This state separation is not an OS access-denial guarantee. Never let Claude→Codex or Codex→Claude fall back to daily provider configuration, and never pass publisher credentials.

The trusted parent copies complete recognized credential files for explicitly selected caam accounts so native refresh can work, and removes only the copied credential files (including refreshes written to those paths) during cleanup without writing back to the vault or deleting raw evidence. A selected account may be active in daily use. Trusted-parent doctor runs `caam limits <tool> --format json` and inspects the chosen `profile_name` for each provider; a mismatch, missing provider, or unusable authentication is a failure, not a skip or weaker-model fallback. Unauthorized or expired results fail closed with the exact manual repair command `caam add <tool> <account> --no-activate --force`; never execute it automatically. Do not add implicit timeouts. A model assertion that a child ran is insufficient; inspect the actual receipt and output. Never reuse output from another SHA or run.
