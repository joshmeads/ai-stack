---
name: try-to-break
description: >
  Try to break a feature, change or integration on purpose, and report what
  failed with reproducible evidence. Use when asked to try to break something,
  test adversarially, look for logic, state or security failures, or check an
  integration branch before merge. Works for web apps and games, native and
  desktop apps, CLIs and APIs. Not a style or architecture review.
---

# Try to break it

Normal verification shows the intended path works. This skill attacks the
paths around it: bad input, wrong order, repeated or interrupted actions,
missing permissions, failing dependencies. Scale the effort to the change; a
one-line fix gets a few targeted attempts, a new feature or an integration
branch gets more.

Before acting, read and follow
`/home/me/.local/share/open-pstack/skills/task-discipline/SKILL.md` for scope,
autonomy, tests and model routing. A standalone invocation only reports; it
does not change product code.

## 1. Decide what must hold

Read the request, the diff or revision, the relevant code and contracts, and
the real entry points (UI, API routes, CLI commands, game input). Treat green
tests and an implementer's summary as leads, not proof.

Write down the few rules that matter, in one line each. For example: "only the
owner can delete a project"; "a level-complete screen awards the bonus once";
"a crash mid-save leaves the old save intact". For an integration branch, add
the rules that only show up when features combine (shared state, ordering,
two features writing the same thing).

## 2. Pick attacks

Choose the attacks a real user, a hostile user or a bad network would trigger
against those rules. Pick by impact, not by list:

| Lens | Examples |
| --- | --- |
| Permissions and input | another user's ID in the URL; script or path tricks in a text field reaching a query, the DOM or the filesystem |
| Repetition and order | double-click submit; replay a request after a lost response; two tabs editing the same record; pressing jump and pause in the same frame |
| Interruption | close the window mid-write; kill a CLI halfway, then rerun it; go offline and reconnect with stale edits; tab away mid-transition |
| Bad state | restart from the results screen during the fade; resize during a level load; a value at its limit (0 lives, full inventory, empty list) |
| Dependencies | the API returns 500 or times out; an asset fails to load; storage is full |
| Load | rapid input for 30 seconds; a large file; many items on screen, if performance matters |

Only use attacks the actual behaviour makes plausible.

## 3. Run them safely

Exercise the real code through its real entry points: existing tests, a
scratch probe script, the UI or API, or injected faults. For browser games,
the `games:tools:web-qa` probe can script rapid input, focus loss and resize.

- Run disruptive attempts only against local or synthetic environments, with
  bounded retries, data sizes and concurrency, and clean up afterwards.
- Never touch production, third-party systems or real users' records, and
  never send real messages or make real purchases, without explicit
  permission.
- If an essential check needs access you do not have, finish the rest and name
  exactly what is missing. Never fake the result or quietly swap in a mock.

## 4. Record evidence

For each attempt that matters: revision and environment, steps or command,
expected versus actual result, and the relevant code location or output. Keep
four kinds separate:

- **Broken:** observed failure with a reproduction.
- **Suspected:** a specific code or contract concern you could not confirm,
  and the check that would confirm it.
- **Held:** the attempt behaved correctly under the tested conditions.
- **Not tried:** a relevant path you did not exercise, and why.

Report only what you saw or can point to. No hypothetical vulnerability lists.
Zero failures is a valid result; it is not a guarantee.

## 5. Fix or hand back

- Standalone: report, do not fix.
- Inside an already authorised build: send confirmed failures in the requested
  behaviour back for repair, then rerun the failing attempt and the normal
  checks it touches.
- Pre-existing problems outside the change: list them as follow-ups.

Keep scratch probes out of the repository unless the user asked for tests or
the repository already keeps tests of that kind.

## Report

```markdown
## Try to break: <feature or branch> @ <revision>
Rules checked: <the one-line rules from step 1>

Broken
1. <severity> <what broke> — steps: ... — expected ... got ... — <file:line or output>

Suspected
- <concern> — would confirm with: ...

Held: <attempts that passed, one line each>
Not tried: <path> — <reason>
```
