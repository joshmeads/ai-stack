# Isolation contract and approved operator probe

The operator's read-only Mac probe is retained in issue #90 comment 5961645184; plan approval is comment 5961649164. On 2026-10-02 it reported Darwin, Claude Code 2.1.283, codex-cli 0.160.0, Bun 1.4.0, and gh 2.97.0. This is capability evidence, not proof of an installed candidate.

Selected interfaces:
- Claude: a fresh `HOME` and `CLAUDE_CONFIG_DIR`, candidate `--plugin-dir`, explicit empty `--settings`, and empty `--setting-sources`. No daily plugin/configuration state is copied.
- Codex: a fresh `HOME` and `CODEX_HOME`; add the pinned checkout as a local marketplace with `codex plugin marketplace add <checkout> --json`, then `codex plugin add pstack@open-pstack --json`. Start a new interactive task after installation. Do not use the daily profile.
- Both: a fresh candidate checkout, run-owned state, minimal inherited environment, interactive login inside isolated state or operator-provided provider credentials, and fresh native sessions. The publisher's GitHub credentials are never passed to the candidate or either harness.

Phase 3 checks these CLI flags at runtime and verifies the installed plugin file tree against the pinned checkout. If either interface is absent or its installed tree cannot be established, stop. A help probe cannot substitute for actual installation/discovery. The build sandbox cannot supply the required Mac surface proof; delivery remains a draft for the operator's doctor and self-test.

`doctor` records versions/help without installing or reading daily credentials. `run` uses the approved interfaces only after a passing doctor and an exact-head pin. Evidence remains outside the checkout. Cleanup is explicit operator removal of the named run-owned state after reviewing the receipt; never clean up a daily home.
