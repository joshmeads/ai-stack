---
name: games:final
description: >
  Stage 3 of a browser game: take the MVP to a complete, publishable game with
  all feedback in FEEDBACK.md applied, package the submission, update the same
  ChatGPT Site and verify the live build matches the local one. Use after
  games:mvp when asked for the final build, polish pass, release or
  submission build of a designed game, or when this skill is invoked.
---

# Final build (stage: FINAL)

Read `games:delivery` (the delivery contract) first; everything in it applies,
with the FINAL scope. Then read `GDD.md`, `docs/gdd-full.md`,
`REQUIREMENTS.md`, `AGENTS.md`, `DEPLOY.md`, `refs/` and `FEEDBACK.md` (or
`feedback.md`) if present. Use the same skills as `games:mvp` (see its table)
and follow `AGENTS.md` for roles, models, worktrees and independent QA.

If there is no MVP or no `DEPLOY.md` with a Site `project_id`, say so and ask
whether to run `games:mvp` first.

## 1. Turn feedback into requirements

Add every feedback point to `REQUIREMENTS.md`, newest entry first:

```markdown
## Feedback
| # | Date | Feedback (as written) | Change made | Status |
| --- | --- | --- | --- | --- |
```

All of it gets applied. Where a point conflicts with the task prompt, the
prompt wins: record the conflict in the table and tell the user.

## 2. Finish the game

- Every requirement row and every GDD tier is done; no placeholder art, debug
  UI, unwired code or half-finished feature remains. Anything cut is hidden,
  listed under Known issues, and reported.
- The contract's required features are complete: title/start screen, on-screen
  controls, core loop, win/lose or scoring, visual and audio feedback, pause,
  restart without reload.
- Look: every level and screen matches the approved style, not just the first
  view. Compose the key moments of each level (start, reveals, checkpoints,
  ending) like the concept frames, give each level its own palette or light
  where the GDD says so, and compare them with `games:tools:web-qa` as in the
  MVP stage.
- Feel: tune controls, camera, feedback and difficulty by playing, and record
  the tuned numbers in the GDD.

## 3. Final QA

Play complete runs through the normal menus: at least one win (or full
scoring run), one loss, and a restart from each end screen. Probe at the native
size, 1280x720 and 1920x1080. Check resize, focus loss, rapid input, pause in
every state, audio start and toggle, and zero console errors. Fix and rerun
until clean. Hardware you do not have is reported as unverified, not passed.

## 4. Package

1. Run `package` to create `submission/<game-name>.zip`. Check its file list:
   source, assets, README, manifest, lockfile and build output if the README
   needs it; no `node_modules`, caches, credentials, `.git` or `submission/`.
2. Save `submission/screenshot.png`: a real 1920x1080 gameplay capture from
   the final production build, showing the core loop with the HUD.

## 5. Update the same Site

Use the `sites` skill's existing-Site path with the `project_id` from
`.openai/hosting.json`; keep the Site's audience. Never create a second Site.

Verify the live build:

- Load the live URL, play the main loop briefly and check the console.
- Compare every file in the local build output with the live one (fetch each
  path and compare SHA-256). Any difference means the deployed build is not
  the local one: rebuild and redeploy.
- If the audience blocks an automated browser, confirm the deployed version
  was built from the packaged commit, and ask the user to open the URL
  signed in.

Update `DEPLOY.md` (date, version ID, commit, verification result) and the
README's **Live build** section.

## 6. Clean-state check and handover

1. From a fresh copy without `node_modules` and build output, follow the
   README's install and run steps exactly and play it.
2. Update `README.md` (every contract section, Known issues), `REQUIREMENTS.md`
   (every row and feedback item done, with where), `BUILD_LOG.md` and
   `ASSETS.md`.
3. Report: what changed since the MVP, requirements and feedback status, known
   issues, the live URL and its verification, and the submission files.
