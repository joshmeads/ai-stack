# SessionStart hook

## Sub-features

`hook:startup`: on a new session, the installed `hooks/hooks.json` runs `hooks/run-hook.cmd session-start`, which prints `hooks/session-start-context.md`, and the harness adds that text to the session context. Select it for any change under `plugins/pstack/hooks/**`. The `clear` and `compact` sources have no case yet.

## How to get to it (user POV)

Start a new Claude Code or Codex session with the plugin installed and enabled. Codex runs plugin hooks only after the user trusts them; a changed hook definition needs trusting again.

## Driving it with verify-open-pstack

Start one fresh headless session with a trivial prompt. Claude loads the candidate through `--plugin-dir`. Codex runs against the run-owned installation, and `--dangerously-bypass-hook-trust` lets the candidate's hook run for that invocation only, so the case does not exercise the trust prompt.

## Gotchas

A model saying it sees `You have pstack.` is not evidence. Running `session-start` directly is a local CLI test, not a hook run. Other installed plugins add their own SessionStart output; the case looks for the candidate's context file among them.

## Headless

The `hook:startup` recipe in `recipes.ts` has one case, `startup`, in each harness. It reads the installed `hooks/session-start-context.md` and requires the harness's own record to carry that text, trailing newlines aside. In Claude, the record is a stream-json `system` event with subtype `hook_response`, `hook_event` `SessionStart`, exit code 0 and outcome `success`, whose `stdout` Claude adds to context as plain text. In Codex, the JSON stream does not show hook output, so the record is a `developer` message in the session's rollout, which is the model input Codex built from the hook. The verifier writes the matched record text to `session-context.md` as the retained artifact. The model's reply is never read.

The Windows runner in `.github/workflows/windows-hooks.yml` is separate evidence beside the Mac live gate. On every pull request it runs the wrapper the way Codex runs `commandWindows`, with no login.
