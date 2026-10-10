---
name: games-mvp
description: >
  Stage 2 of a browser game: build the playable MVP from the approved GDD.md
  and concept style, with the look matched to the chosen concept first and the
  core loop playable end to end, then host it on ChatGPT Sites and record the
  live URL. Use after games-mini-gdd once a style is chosen, when asked to
  build the MVP, first playable or prototype of a designed game, or when this
  skill is invoked.
---

# MVP (stage: MVP)

Read `games-delivery` (the delivery contract) first; its MVP scope, quality
bar, hygiene and README rules all apply. Then read `GDD.md`,
`docs/gdd-full.md`, `REQUIREMENTS.md`, `AGENTS.md` and `refs/`.

If `GDD.md` has no chosen style, stop: the user has to pick one in
`games-mini-gdd` first.

## Skills to use

| Need | Skill |
| --- | --- |
| Phaser 4 | `games-tools-phaser` |
| three.js look (assets, camera, framing, lighting) | `games-tools-threejs-look` |
| three.js gameplay, UI, debugging | `games-tools-threejs-gameplay`, `games-tools-threejs-ui`, `games-tools-threejs-debug` |
| React Three Fiber | `games-tools-r3f`, `games-tools-postprocessing` |
| 3D models | `games-tools-blender-model` |
| Sound and music | `games-tools-audio` |
| Running, checking and comparing the game | `games-tools-web-qa` |
| Hosting | `sites` (ChatGPT Sites plugin) |

Follow `AGENTS.md` for roles, models, worktrees and independent QA. The MVP is
tier 1 of `docs/gdd-full.md` plus the contract's required features at a basic
level.

## 1. Set up

Create the project with the stack and pinned versions from the GDD: `dev`,
`build` and `package` scripts, lockfile, `.gitignore`, and skeletons of
`README.md` (the contract's exact sections), `DEPLOY.md`, `BUILD_LOG.md` and
`ASSETS.md`. Set the bundler's base path to relative (`base: './'` in Vite) so
the build works from any host path.

## 2. Look slice first

Before content grows, build the approved `refs/` gameplay frame as a playable
scene: the real player, a stretch of the world, the HUD and the light, made the
way the engine's look skill describes (generated art, Blender models, shaders,
CC0 assets, mixed as the result needs). Work in rounds of a few minutes. After
each round, capture at 1920x1080 at the reference's camera, compare with
`games-tools-web-qa` (side by side, `--grid 5` for composition, `--crop` on the
player, light sources and edges; for 3D, measured camera values), commit, and
keep the latest capture in `shots/look/`.

Time-box it: the look slice gets about a third of the MVP session (or 45
minutes, whichever is shorter). The MVP has to show the direction, not finish
it. Move on when the capture reads as the approved style at a glance: same
palette and light direction, same composition and framing, real modelled or
generated assets (no placeholders in the main view). List the remaining
differences in `shots/look/REVIEW.md`; `games-final` closes them. Look QA in
this stage judges against that bar, not against every closable difference.

Keep generated originals and model scripts in the repository so later rounds
and the final stage reuse them instead of regenerating.

## 3. Core loop end to end

Build the loop the GDD describes, in the approved style: title/start screen,
on-screen controls, the core loop, win/lose or scoring, visual and audio
feedback, pause, and restart without reload. Placeholder polish is acceptable
for secondary pieces; the main view keeps the look from step 2.

## 4. Test and fix

After each significant change, run the game, capture it with Playwright, look
at the captures and play the main loop. Use the `games-tools-web-qa` probe at
the game's native size, 1280x720 and 1920x1080. Check movement, collisions,
scoring, progression, restart, window resize, focus loss and rapid input. Zero
console errors on load and during play. Fix what is broken or unclear; do not
stop at the first working version.

## 5. Host on ChatGPT Sites

Use the `sites` skill to publish the static build (`static.directory` set to
the build output, for example `dist`). Commit `.openai/hosting.json` with the
Site's `project_id`; the final stage updates this same Site.

New Sites start private. Choose the audience the task needs (reviewers must be
able to open the URL); if the task or the user does not say who should see it,
publish privately and ask before widening it. If the Sites tools are not
available in the session, record the blocker in `DEPLOY.md`, tell the user,
and finish everything else.

Record in `DEPLOY.md`: URL, deploy date and time, `project_id`, saved version
ID, audience and the commit deployed. Put the URL and date under **Live build**
in `README.md`. Open the live URL and check that it loads and plays when the
audience allows an automated browser; otherwise say it needs a signed-in
check.

## 6. Clean-state check and handover

1. Copy the project to a temporary folder without `node_modules` and build
   output, follow the README's install and run steps exactly, and play it.
2. Run `package`; open the zip's file list and confirm it holds source,
   assets, README, manifest and lockfile, and no `node_modules`, caches,
   credentials, `.git` or `submission/`.
3. Update `README.md`, `REQUIREMENTS.md` (MVP status per row), `BUILD_LOG.md`
   and `ASSETS.md`.
4. Report: what was built, requirements status, known issues, the live URL,
   and next steps: collect feedback (`feedback` skill writes `FEEDBACK.md`),
   then `games-final`.
