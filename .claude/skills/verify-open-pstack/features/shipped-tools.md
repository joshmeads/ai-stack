# Shipped CLI tools from installed workflows

## Sub-features

`orch` state transitions, `watch-pr` observations, `check-plan` verdict boundaries, read-only worktree audit, and `show-me-your-work` logging. Exercise every tool and branch touched by selected paths; shared package changes select all tools.

## How to get to it (user POV)

Invoke the installed `poteto-mode` parent for orchestration/watch/plan/audit, or installed `show-me-your-work` for evidence logging, through each harness's native skill surface.

## Driving it with verify-open-pstack

Use the candidate's installed help and documented arguments. Create fixture state/output under the private run root; use an explicitly named safe test PR where remote reads are required. Have the native installed workflow drive the changed tool, then inspect its real structured output and persisted state. For the audit assert no mutation; for logging check the written TSV and escaping; for orchestration check the stored transition; for watch/plan preserve the observed result and verdict. Retain native transcripts and these state artifacts. Label any direct helper invocation `local CLI` separately. Document every touched tool and changed branch in the operator-reviewed observation.

`bootstrap.ts` changes require its real shipped-tool consumers, `orch` and `watch-pr`, including their clean dependency bootstrap path. They do not select the unrelated external runner.

## Gotchas

A mock test is not live proof. Never perform any PR write from a candidate process or edit daily workflow state as a fixture. Do not infer a successful remote read from an empty response. Candidate tools and descendants retain real `HOME`, `USER`, and `LOGNAME` but use run-owned provider/GitHub/XDG/config/cache/temp paths and explicitly selected caam credentials; the selected profiles may be active in daily use. They do not receive publisher credentials. Trusted-parent doctor runs `caam limits <tool> --format json` and inspects the chosen `profile_name` for each provider. Unauthorized or expired results fail closed with the exact manual repair command `caam add <tool> <account> --no-activate --force`; never execute repair automatically. This does not claim OS denial of daily-home or Keychain access. Missing required access fails the feature; preserve its private reason and publish only the bounded structured exact-SHA result.
