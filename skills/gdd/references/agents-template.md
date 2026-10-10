# AGENTS.md template

Copy everything below the line into the game's `AGENTS.md`, then fill in the **Project** section.

---

# <Game name> agent instructions

`GDD.md` is the source of truth. Read it, and `~/.local/share/open-pstack/skills/task-discipline/SKILL.md`, before any work. Pass both to every subagent.

The models in **Roles** are the user's choice for this project. They replace task-discipline's model table, including its Opus and fallback rows. Use a different model only when the assigned one is unavailable. Record the evidence in NOTES.md and the substitute in JOSH.md.

## Project
- Stack and pinned versions: <…>
- Commands: install `<…>`, dev `<…>`, build `<…>`, test `<…>`, capture `<…>`, FPS `<…>`
- Dev ports: <…> (never use another project's port; never test a server you did not start)
- Remote: <…>. Deploy target: <…>

## Setup (orchestrator, before any feature work)
1. If the folder is not a git repository, run `git init -b main` and commit the existing files.
2. Create the `integration` branch from `main`. Add `.worktrees/` and `qa/` to `.gitignore`.
3. Check that git works from inside a worktree: create one, commit a test file there, then delete both. If the sandbox makes `.git` read-only, request escalation or put the problem in `JOSH.md`. Do not invent a copy-based workaround.
4. Check free disk space and that the dev port is free.

## Roles
All work runs through one orchestrator and its subagents. Only the orchestrator spawns agents; subagents cannot spawn their own.

| Role | Model | Does | Never does |
| --- | --- | --- | --- |
| Orchestrator (main session) | `gpt-6.1-sol` or `gpt-6-astra`, high | Writes PLAN.md, splits work into tasks, creates worktrees, spawns implementers and QA, merges branches that passed QA, keeps JOSH.md and HANDOFF.md | Writes feature code itself, beyond small integration fixes; merges anything QA has not passed |
| Implementer (`.codex/agents/implementer.toml`) | `gpt-6.1-sol`, high | One task, in its own worktree, on its own branch | Touches another worktree, `integration` or `main`; declares its own task done |
| QA (`.codex/agents/qa.toml`) | `gpt-6-astra`, high | Decides whether a task or a tier is done; runs the game, captures, probes and tests itself | Edits source files; passes work because "it's close" |

## Workflow
1. **Plan.** The orchestrator writes `PLAN.md` (at most 200 lines): module boundaries, types, state shape, events, and the task list. Each task names its files, dependencies and acceptance, copied from the GDD. Tasks that run in parallel touch disjoint files. Split each tier into 2–4 tasks that can run at once, for example simulation and rules, rendering and art, and UI and audio. Never put a whole tier in one task.
2. **Worktree per task.** `git worktree add .worktrees/<task> -b task/<task> integration`. The orchestrator gives the implementer the absolute worktree path. The implementer runs every command from that path.
3. **Implement.** The implementer builds the task, commits on its branch, and returns: what changed, how to see it, and its own check results.
4. **QA the task.** The orchestrator spawns a fresh QA agent on the task branch, with the task's acceptance criteria. QA returns `PASS` or `FAIL` with a numbered defect list and evidence (capture paths, probe output, steps to reproduce).
   - On `FAIL`, the orchestrator sends the defect list back to an implementer on the same worktree. Repeat until `PASS`.
   - Only QA decides that a task is done.
5. **Merge.** On `PASS`, the orchestrator merges the task branch into `integration`, runs the build and tests, and removes the worktree.
6. **Play-test QA.** After each merge batch, a QA agent plays `integration` through at least three full runs, to game over and to the ending. It looks for stuck states, broken transitions, the defect list in the GDD, and regressions in lower tiers. Its defects become new tasks.
7. **Tier done.** When QA passes every item of a tier on `integration`, the orchestrator merges `integration` into `main`. `main` is runnable at all times.
8. **Parallelism.** Run independent tasks at the same time, up to the configured thread limit. Run only one GPU benchmark or recording at a time.

## Priorities, in order
1. What the player sees and feels: visuals, controls, camera, audio, game feel.
2. The game runs end to end with no stuck points or errors.
3. Everything else: tooling, telemetry, docs, tests.
Work on a lower priority only when it directly unblocks a higher one. No task or milestone consists only of harnesses, contracts, telemetry or "evidence".

Look work uses the engine's look skill when it is installed: `jm:games-tools-threejs-look` for three.js, and the "Look and feel" section of `jm:games-tools-phaser` for Phaser. QA uses the look review in `jm:games-tools-web-qa`. Compare captures against `refs/` at the same camera.

## Do what was asked, literally
- If the GDD names a ruleset, game, technique or reference, implement exactly that. Do not substitute a simpler "inspired" version. If you cannot, write it in JOSH.md and continue with everything else.
- Add no features, mechanics, UI panels, flavour text, taglines or copy that the GDD does not list. Do not borrow ideas from other projects.
- Build the core mechanic for real before polish.
- When the design pivots, delete the old code paths and types. Do not map new state onto old structures.

## Assets
These are allowed without asking:
- CC0 libraries: Poly Haven, ambientCG, Kenney, CC0 OpenGameArt;
- headless Blender scripts (`blender -b -P <script>`);
- artwork generated with the built-in `image_gen` tool (`imagegen` skill).

Record each asset in `ASSETS.md` with one line: source URL or generator, licence. Prefer these to primitive procedural shapes whenever the GDD's quality bar is high. Follow the GDD if it restricts binary files.

## Fix defects when you see them
- Every user complaint and every item on the GDD defect list is a defect to fix now, not one to record "for a later milestone".
- If a capture shows any of these, fix it before continuing:
  - floating or sunken objects;
  - see-through or flickering surfaces, or z-fighting;
  - LOD popping;
  - hard colour seams between areas;
  - repeating texture or dot patterns;
  - meshes missing from gameplay cameras (culling, back faces, LOD seams);
  - the camera losing the player;
  - visible debug UI;
  - placeholder shapes.
- Never hide a problem by removing or shrinking the feature. Fix the geometry or the algorithm. If a parameter clamp is the only way, list it in JOSH.md as an open defect.

## Judge screenshots honestly
- After each visual change, capture the affected views at gameplay cameras across the whole game: start, middle, late and ending.
- For every capture, write the three worst things a player would notice. "Inspected" without a defect list is not a review.
- Compare against `refs/` at a similar camera. If it is clearly worse, the task is not done.

## Check feel with numbers
- Physics, control and camera changes need a small real-time probe script. It logs speed, heading, contacts and FPS during scripted play.
- Gameplay numbers must agree with each other:
  - real gravity;
  - turn radius against the size of what the player has to stay inside;
  - objects placed on sampled ground;
  - impulses applied once per contact, not once per physics step.

## Prove the work is connected
A feature is not done until it is imported and reachable from the entry point, and visible in a capture from a gameplay camera. Written but unwired code is not done.

## Verification budget
- **Per task:** one capture set of the affected views, and one FPS check of 60 seconds or less.
- **Per tier:** one full run per quality level.
- **Missing hardware:** checks that need absent hardware or software (a physical gamepad, a specific GPU, a browser that is not installed) are "verify if available; otherwise report as unverified". They never block a tier, QA verdict or merge to `main`.
- **Do not build, unless the GDD asks:** build-identity or dirty-diff hashes, clean-clone reinstall checks, byte-reproducible exports, licence ledgers with saved web pages, corrupted-file tests, or repeated full-length real-time runs.
- **No log polling.** Start a long command, do other work, then read the result once.
- **Before FPS runs,** check disk space, other GPU jobs and that the machine is on power. Discard numbers taken under contention.

## Tests and docs
- **Tests** cover rules and simulation logic, plus a determinism check if the core is deterministic. Do not tune stock values or use fixtures to make a test pass.
- **NOTES.md and DECISIONS.md:** short bullets per decision, deviation or failed approach. No measurement dumps, hashes or tool-version lists. Delete stale entries.
- **JOSH.md:** only blockers that need the user. Make every other decision yourself.
- **Code comments:** none unless the code would mislead without one.

## Git
- Commit at every working state, with a message naming the system changed. At the end of a session, nothing is left uncommitted or unwired.
- Push `main` and `integration` after each tier and confirm the remote has them (`git ls-remote`).
- Keep screenshots and videos out of git, except a small final set in `shots/final/`.

## Stopping and status
- Keep working until every tier passes QA. Do not stop because a milestone ended, context is half used, or a session boundary feels natural. Stop only at a hard limit you actually hit, and name it.
- "Blocked" is not "done". Report blocked items separately and keep doing unblocked work.
- Update `HANDOFF.md` after each merge: what passed QA, open defects, how to resume. A crash then loses nothing.
- Report status as "QA passed" or "QA failed: <defects>". Never claim the user has accepted the look or feel.
