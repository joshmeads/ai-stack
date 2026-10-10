---
name: games-tools-web-qa
description: >
  Decide whether a browser game actually works, using evidence from the running
  game: clean-checkout run from the README, headless Chromium probe for errors,
  liveness, input response and page scrolling, mechanic-by-mechanic checks,
  screenshots, and a pass/fail report. Use when asked to QA, playtest, verify,
  accept or "check it works" for a web game (Phaser, three.js, R3F, PixiJS,
  PlayCanvas, Godot web export, or plain canvas/DOM).
---

# Web game QA

A game is done when a player can load it from its instructions, play the core
loop, win or lose, and restart, with no errors and nothing visibly broken.
Reading the code does not establish any of that. Every verdict in this skill
rests on something observed in the running game: a screenshot, a state value,
a console line, or a probe report.

## 1. Run it the way a reviewer will

1. Copy the project to a fresh temporary folder, leaving out `node_modules`,
   build output and caches.
2. Follow the README literally: install, build, start. Do not use knowledge
   the README does not give. Every step that fails or needs a guess is a
   defect in the README.
3. Note the runtime versions, the exact commands and the local URL. These go
   in the report.

## 2. Probe the running game

`scripts/probe.cjs` drives the game in headless Chromium and writes
`report.json` plus numbered screenshots. `scripts/compare.cjs` (section 3b)
uses the same Playwright install.

Install Playwright once, outside the game project so its dependencies do not
change:

```sh
npm install --prefix ~/.cache/web-game-qa playwright
npx --prefix ~/.cache/web-game-qa playwright install chromium
export NODE_PATH=~/.cache/web-game-qa/node_modules
```

Then run, with steps that match the game's controls:

```sh
node scripts/probe.cjs --url http://127.0.0.1:5173 --out qa/probe-1 \
  --steps "key:Enter:100,wait:500,key:ArrowRight:800,key:Space:100,wait:1000" \
  --state "JSON.stringify(window.__game?.state)"
```

- Steps: `wait:MS`, `key:KEY:HOLD_MS` (Playwright key names: `ArrowLeft`,
  `Space`, `KeyW`, `Enter`, `Escape`), `type:TEXT`, `click:FX:FY` (fractions
  of the viewport).
- `--state` evaluates an expression after each step. If the game exposes no
  readable state, ask whether a read-only debug hook (for example
  `window.__game` behind `?debug`) can be added. Otherwise rely on
  screenshots.
- `--viewport 1920x1080` checks other sizes. Probe the game's own logical
  size and the common desktop windows 1280x720 and 1920x1080: letterboxing,
  borders and scaling defects only appear when the window is larger than the
  game, so a capture at the native size alone hides them.

The probe reports:

| Finding | Meaning |
| --- | --- |
| uncaught page error, console errors | Defect unless the error is outside the game and harmless; say which. |
| failed request | Missing asset, wrong path, or a network dependency the game must not have. |
| `animatesWithoutInput: false` | The screen is static before input. A defect when the game should animate (render loop stopped, demand rendering, crash on start). |
| no key step changed the screen or state | Input is not reaching the game: focus, key names, or a broken handler. |
| a step scrolled the page | Game keys are not captured (`preventDefault` missing); the page jumps while playing. |
| `frames` | Frame-time distribution. Headless runs use software rendering, so compare runs with each other, not with a target FPS. |

To measure brightness or colour, read pixels from the probe's screenshots (or
`page.screenshot()`), not by copying the WebGL canvas into a 2D canvas: WebGL
clears its buffer after each frame unless the game sets
`preserveDrawingBuffer`, so a copied canvas reads as black.

Open the screenshots and look at them. A probe that passes on a black canvas
or a stretched, cropped or unstyled screen is not a pass.

## 3. Check each mechanic

Write a checklist from the game's design document or brief, then for each item
produce the input that exercises it and the evidence that it worked:

- **Movement:** each control moves the player the way the controls text says.
- **Collisions:** drive into an obstacle, a wall, an enemy. The game reacts as
  designed, with no passing through or sticking.
- **Scoring:** a scoring action changes the score exactly once, by the stated
  amount.
- **Progression:** levels, waves or difficulty advance as stated.
- **Lose and win:** both conditions can be reached and show their screens.
- **Restart:** restarting resets every piece of state: score, timer, position,
  entities, music.
- **Pause and focus:** pause freezes play; leaving the tab or window does not
  leave keys stuck down.
- **Audio:** starts after the first input (browsers block autoplay) and obeys
  any toggle.
- **Feedback:** every action has visible or audible feedback; controls are
  shown somewhere in the game.

Where a mechanic cannot be driven by the probe, play it in a headed browser,
or describe exactly what was not checked. Never mark it passed.

## 3b. Review the look, not only the rules

Working mechanics with a flat, repetitive look is the most common gap between a
"done" build and a polished game. For each capture at the start, middle and
late part of every level, name the three most visible look problems a player
would notice, or say there are none. Score each 0-3:

| Area | 3 means |
| --- | --- |
| Silhouettes | Player, hazards and pickups read instantly; hazards come in several distinct shapes, not one mesh or tile repeated |
| Depth and lighting | Foreground, middle and background layers; lighting that sets mood and separates gameplay objects from scenery |
| Variety | Each level or section changes palette, lighting or set dressing; nothing visibly repeats side by side |
| Feedback | Collect, hit, death and boost or dash each have their own visual and audio response |
| UI | HUD and menus match the game's style, never overlap the action, and stay readable at both viewports; no stray borders or frames around the game at desktop window sizes |

Anything below 2 is a defect for the look work, with the capture path as
evidence. For three.js games, use the 10-category scorecard in
`games-tools-threejs-look` as well when that skill is installed.

Two comparisons make the scores concrete. `scripts/compare.cjs` tiles images
into one labelled sheet and prints each image's average colour, brightness
and warmth (red minus blue):

```sh
node scripts/compare.cjs --out qa/look/levels.png --cols 3 \
  qa/look/l1-start.png qa/look/l1-mid.png qa/look/l1-late.png \
  qa/look/l2-start.png qa/look/l2-mid.png qa/look/l2-late.png
```

- **Against the references.** When `refs/` has concept frames, put each next
  to a capture of the same moment and camera, and open the sheet. List the
  differences in camera height, angle and field of view, measured on both
  images (horizon height and hero bounding box as percentages of the frame,
  how much of the hero's top is visible, how the hero and props are turned), light colour and direction (which side of
  each object is lit, rim light, haze), where light and glow fall, contrast,
  palette, and density of props and set dressing. A difference the
  build could close with its own pipeline is a defect (for example, the
  reference shows a warm glow around the player's lantern and the build shows
  a cool, flat reveal). Detail beyond what the engine and art pipeline can
  produce is not a defect; say which differences are of that kind. A look
  task does not pass while a closable difference a player would notice in the
  first seconds remains, unless the stage or task sets a lower bar (an MVP or
  prototype passes on matching style, light and composition, with the rest
  listed for later) (a dark or empty background where the reference shows
  a lit cave or sky, missing set dressing, wrong light colour), whatever the
  scores say. Check `ASSETS.md` too: when the gap is in art that is all
  drawn by code while the reference is painted or modelled, say so and suggest
  which available tool (image generation, Blender, shaders, CC0 assets) would
  get closer.
- **Composition.** Add `--grid 5` to the reference comparison: it prints a
  coarse brightness grid per image. Compare where the dark framing masses, the
  bright open areas and the focal point sit. A capture whose big shapes are in
  different places reads as a different picture even when every object
  matches, so report it as a defect with the two grids as evidence. In a
  moving game, judge composition at the referenced moments and key set
  pieces, not at every frame.
- **Up close.** A full-frame sheet hides local light and edges. Run the
  comparison again with `--crop FX,FY,FW,FH` (fractions of the frame) on the
  same region of reference and capture: the player and any light source it
  carries, a place where terrain pieces meet or end, and one prop or hazard.
  Light that the reference pools on nearby surfaces shows up in the crop's
  brightness and warmth; a crop that is cooler or darker around the light is
  a missing glow, not a style choice. Hard rectangular cut-offs, seams and
  repeated pieces show up at the edges. On a near 3D object, many small
  triangles of alternating brightness inside what should be one surface are
  broken faceting, not a style: report it.
- **Across levels.** One sheet with start, middle and late captures of every
  level. If two levels are hard to tell apart at thumbnail size, or their
  average brightness and warmth differ by only a few points, Variety is below
  2. Averages cover the whole frame, so local light (a lantern, a sunlit edge)
  still has to be judged by eye on the sheet.

## 4. Report

```markdown
## QA report: <game> <commit or build>
Run: <commands>, <URL>, <browser and version>, <viewport(s)>
README: <works as written | steps that failed>

| Check | Result | Evidence |
| --- | --- | --- |
| Loads without errors | PASS | qa/probe-1/report.json (0 errors) |
| Restart resets score | FAIL | 07-end.png shows score 300 after restart |

Remaining issues (for disclosure):
- <issue, how to reproduce, severity>
Not checked:
- <item and why>
```

## Rules

- Evidence or it did not happen. "Should work" and "the code handles it" are
  not results.
- Do not fix a failed check by weakening the game: shrinking a feature,
  removing an obstacle, or hiding the broken part. Report it, or fix the
  cause.
- Re-run the full probe after every fix, not only the step that failed.
- Remaining issues are listed plainly in the report. If there are none, write
  "None".
- Checks that need hardware or software you do not have (a physical gamepad,
  a specific GPU, a browser that is not installed) are reported as
  "unverified: <reason>". They never block a pass of the checks you can run,
  and they are never reported as passed. Cover what you can with a substitute
  (a scripted gamepad, the local GPU) and name it as a substitute.
