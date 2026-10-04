# Shipped CLI tools from installed workflows

## Sub-features

`orch` state transitions, `watch-pr` observations, `check-plan` verdict boundaries, read-only worktree audit, and `show-me-your-work` logging. Exercise every tool and branch touched by selected paths; shared package changes select all tools.

## How to get to it (user POV)

Invoke the installed `poteto-mode` parent for orchestration/watch/plan/audit, or installed `show-me-your-work` for evidence logging, through each harness's native skill surface.

## Driving it with verify-open-pstack

Use the candidate's installed help and documented arguments. Create fixture state/output under the private run root; use an explicitly named safe test PR where remote reads are required. Have the native installed workflow drive the changed tool, then inspect its real structured output and persisted state. For the audit assert no mutation; for logging check the written TSV and escaping; for orchestration check the stored transition; for watch/plan preserve the observed result and verdict. Retain native transcripts and these state artifacts. Label any direct helper invocation `local CLI` separately. Document every touched tool and changed branch in the operator-reviewed observation.

`bootstrap.ts` changes require its real shipped-tool consumers, `orch` and `watch-pr`, including their clean dependency bootstrap path. They do not select the unrelated external runner.

## Gotchas

A mock test is not live proof. Never perform any PR write from a candidate process or edit daily workflow state as a fixture. Do not infer a successful remote read from an empty response. Candidate tools and descendants retain real `HOME`, `USER`, and `LOGNAME` but use run-owned provider/GitHub/XDG/config/cache/temp paths. Supply operator-pre-authenticated normal-login directories with `--claude-config <dir>` and `--codex-home <dir>`; selected accounts may be active in daily use. Only complete recognized `.credentials.json` and `auth.json` files are copied, preserving refresh material without source writeback. Candidates do not receive publisher credentials. Trusted-parent doctor validates sources with `claude auth status` under the supplied `CLAUDE_CONFIG_DIR` and `codex login status` under the supplied `CODEX_HOME`. Authentication failures fail closed with `CLAUDE_CONFIG_DIR=<dir> claude auth login` or `CODEX_HOME=<dir> codex login`; never execute login automatically. This does not claim OS denial of daily-home or Keychain access. Missing required access fails the feature; preserve its private reason and publish only the bounded structured exact-SHA result.
