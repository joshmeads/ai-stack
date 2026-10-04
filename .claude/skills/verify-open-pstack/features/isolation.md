# Disposable credential and run-state contract

The verifier uses run-owned provider/configuration state and explicitly selected caam credentials copied for the run. This is operational state separation, not a Seatbelt or macOS filesystem security boundary.

## Trusted parent

Run the publisher from a maintainer-reviewed trusted `main` checkout. Record that publisher revision separately from the PR's exact candidate SHA; never treat publisher code provenance as candidate proof. For PR #111 bootstrap, use the reviewed trusted publisher head while pinning all candidate evidence and status to PR #111's reviewed exact head.

Require explicit `--claude-account EMAIL` and `--codex-account EMAIL`; never infer or choose a default identity. A selected profile may be active in the operator's daily Claude or Codex use. Record selected account emails privately in the receipt.

For each selection, trusted-parent doctor must run `caam limits <tool> --format json`, using `claude` or `codex` as `<tool>`, and inspect the chosen `profile_name` for that provider. A mismatched profile fails closed. An unauthorized or expired result also fails closed and reports the exact manual repair command `caam add <tool> <account> --no-activate --force`. Never execute the repair automatically, switch identities, or fall back automatically.

Copy only `claude/<account>/.credentials.json` into run-owned `CLAUDE_CONFIG_DIR` and `codex/<account>/auth.json` into run-owned `CODEX_HOME`. Copy the complete recognized credential file, including refresh material needed by the native client. Never write refreshed state back to the caam vault. Missing/mismatched files, unknown credential formats, or unusable authentication fail closed. GitHub authentication and publication remain exclusively in the trusted parent.

## Candidate process state

- Preserve the operator's real `HOME`, `USER`, and `LOGNAME` for native-client compatibility and identity.
- Set `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `TMPDIR`, `GH_CONFIG_DIR`, XDG config/cache, and other configurable provider/GitHub/temp locations to run-owned directories.
- Disable global/system git configuration and credential helpers for candidate commands.
- Claude uses the explicit candidate plugin, empty settings, and project setting sources. Codex uses pinned local marketplace/plugin installation.
- Provider descendants inherit both run-owned provider config roots. Never pass GitHub publisher credentials or daily provider API keys.
- Never invoke login, activate or modify the vault, or copy daily provider configuration as fallback.

These controls do not deny a process access to real `HOME`, Keychain, or candidate sources. Do not claim Seatbelt enforcement, source write protection, Keychain/securityd denial, daily-home denial, or OS-backed secrecy. Provenance rechecks detect changed candidate/installed files but are not prevention.

## Setup boundary

Because `HOME` remains real, setup must not be exercised until config-home support in issue #120 merges. Until then, setup selection fails closed with exactly:

`setup exercise requires #120 (setup-pstack config-home)`

Do not redirect `HOME`, allow setup to write daily files, or replace this result with a mock.

## Public comment check

Register exact access/refresh/id-token values only from the copied, recognized credential fields. Immediately before a GitHub write, compare the rendered structured comment against those exact known values and refuse publication on a match. Do not use token-shape, prefix, entropy, regex, or other heuristic secrecy claims. Unknown credential layouts block before publication. Private raw evidence is not declared secret-free.

## Private evidence and cleanup

Create each output root fresh, outside the repository, with mode 0700; use private files beneath it. Retain raw transcripts, artifacts, receipts, and cleanup results in that private root through merge. Copied credential files are session state, not evidence: remove only the copied Claude `.credentials.json` and Codex `auth.json` files in run-owned config roots after native sessions on success or failure, including refreshes written to those same paths. Preserve candidate state and raw evidence. Cleanup failure blocks GitHub publication.

After merge, archive the retained evidence and let the operator delete only the named run root. Never modify the caam vault or daily provider files, and never recursively delete an operator directory.
