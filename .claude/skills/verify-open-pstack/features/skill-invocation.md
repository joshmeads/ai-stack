# Installed skill invocation

## Sub-features

Every registry skill is its own required feature. Include changed arguments, routing, consumed references, helper actions, and removal behavior. Principle leaves are model-invocable, not slash-menu entries. `project-skill` separately verifies this repository-local skill's discovery.

## How to get to it (user POV)

In a fresh Claude session invoke `/pstack:<name>`. In Codex use the installed skill selector or `$<name>`. Invoke principle leaves through the model's native skill tool. For self-test invoke `/verify-open-pstack` in Claude and `$verify-open-pstack` in Codex.

## Driving it with verify-open-pstack

Launch with real `HOME`, `USER`, and `LOGNAME`, run-owned temporary/GitHub state, and no publisher credentials. Claude uses normal operator login/config with `claude --plugin-dir <exact-head checkout>/plugins/pstack --settings '{"enabledPlugins":{"pstack@open-pstack":false}}'`. Codex installs the exact-head candidate in a run-owned `CODEX_HOME` with `auth.json` symlinked to the daily `${CODEX_HOME:-$HOME/.codex}/auth.json`. Missing file-based auth fails closed. No source flags, credential reading/copying, or extra login; see `isolation.md`.

For each selected name, use a disposable fixture appropriate to its documented input, invoke the installed surface, and exercise every changed sub-feature. Observe native tool/skill loading and a concrete fixture effect, not the assistant saying it passed. Save the raw transcript and an artifact showing the actual result (diff, generated file, tool receipt, or UI capture) under the private mode-0700 evidence root.

For `project-skill`, invoke the discovered skill and ask it to run `verify.sh doctor --candidate --output <fresh-run-owned-directory>`; candidate mode must not inspect source credentials or probe publisher authentication. Forbid recursive `run` and publication. Preserve the native invocation transcript plus `doctor.json`, checking the canonical executable path and immutable source provenance belong to the pinned project skill. The Codex symlink and Claude canonical directory must both be discovered in fresh sessions. If candidate mode is unavailable, stop; do not substitute trusted-parent doctor.

## Gotchas

A generic prompt about a skill is not native invocation evidence. A list of discovered skills is not behavioral proof. Environment/config separation does not establish Seatbelt, daily-home, Keychain, or source-write denial, and no such claim belongs in evidence. If an invocation would merge, queue, release, mutate a PR, or write daily state, use a safe disposable fixture or record failure; do not weaken the gate. Never use the child verifier to publish a comment or status.

## Headless

`recipes.ts` gives every `skill-invocation:<name>` one default case: a disposable Git fixture holding a small task in `TASK.md`, a native invocation (`/pstack:<name>` in Claude, the Skill tool for principle leaves, `$pstack:<name>` in Codex), and an instruction to write the result to `result.md` in the fixture. It asserts that the native record shows the `pstack:<name>` skill load and that the session wrote a nonempty `result.md`. Skills whose normal use would push, merge, post, or write daily state override it: `fix-ci`, `babysit`, and `make-pr-easy-to-review` run against a local fixture with no remote and assert a local effect, and `automate-me` writes its draft into the fixture instead of the daily skills folder. `setup-pstack` uses the setup recipe. `project-skill` runs from the candidate checkout and asserts the skill load, the doctor command, and the canonical-path `doctor.json`.

`reflect` has two cases in each harness that exercise step 1 only, against run-owned synthetic transcripts with metadata before the opening user message. The prompts name the opening prompt and, for Codex, the known chat ID and a fixture-only `CODEX_HOME`, or, for Claude, the fixture's per-project directory. They do not name the resolver or the transcript file, so the installed active-transcript mapping must lead the session there. In `locate-transcript` the transcript's opener matches. The case asserts the opening-message metadata and that no digest was written. In `digest-fallback` the opener differs, and the case asserts a nonblank digest of at most 2,000 words. For Codex, a completed command must be one plain invocation of the installed resolver with the chat ID, optionally inside one `sh -c` wrapper and with the fixture `CODEX_HOME` prefix. It may contain no chaining, redirect, expansion, comment, or line continuation. The case parses that command's output as the harness captured it, requires the exact resolver JSON, and rejects any opener or fixture message text in it. A report file the model writes is not evidence. For Claude in `locate-transcript`, a completed parent tool call, such as `Read` or `Bash`, must return a per-run nonce that appears only in the fixture transcript and never in the prompt. Echoed paths, reads of the resolver's source, failed or pending tools, and altered commands do not count. These cases do not exercise reviewer fan-out, synthesis, or skill edits.
