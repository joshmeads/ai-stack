---
name: games-mini-gdd
description: >
  Stage 1 of a browser game: turn the task prompt into a condensed GDD.md
  (500-700 words), REQUIREMENTS.md and 3-4 concept styles generated with image
  generation, then stop for the user to pick a style. Runs the full gdd skill
  first and condenses its result. No game code. Use when starting a new game
  from a prompt or brief, when asked for a mini GDD or game concept options, or
  when this skill is invoked.
---

# Mini GDD (stage: GDD)

Before anything else, read `games-delivery` (the delivery contract). Its GDD
stage scope applies here. This stage writes no game code.

## 1. Requirements first

Create `REQUIREMENTS.md`:

```markdown
# Requirements

| # | Requirement (prompt's own words) | Where implemented | Status |
| --- | --- | --- | --- |
| R1 | "..." | GDD.md: Core loop | designed |

## Design decisions
- <decision the prompt left open> — <one-line reason>
```

Copy every explicit requirement from the prompt verbatim, one per row,
including style, 2D/3D, controls, platform and anything "in the style of X".
Later stages fill in the "Where implemented" column with code and features.

## 2. Full design with the gdd skill

Run the `gdd` skill in its full format, with two changes:

- Write its GDD to `docs/gdd-full.md`, not `GDD.md`. Keep its `AGENTS.md`,
  `.codex/agents/` and `.gitignore`; the MVP and final stages build from them.
- Keep the interview short. Ask only about choices that change the core loop or
  the scope and that the prompt leaves open; decide the rest and record each
  decision in `REQUIREMENTS.md` under "Design decisions" and in the gdd
  Assumptions. If the user is not available, decide everything. The one
  mandatory stop in this stage is the style choice in step 5.
- Skip gdd's own concept-frame step; step 3 below replaces it.

## 3. Concept styles

Generate 3-4 clearly different visual styles with the built-in `image_gen` tool
(`imagegen` skill). All must fit the prompt: if it fixes 2D or 3D or names a
style, vary within that (palette, lighting, era, material, line and shading
language); otherwise also vary the rendering approach (for example pixel art,
painted 2D, low-poly 3D, toon-shaded 3D).

For each style, save to `concepts/<style-name>/`:

- `gameplay.png`: a key gameplay moment as an in-game screenshot at the
  gameplay camera, with the HUD. Draw it at a detail level the chosen engine
  and asset pipeline can actually reach; not a matte painting or film still.
- `characters.png`: the player character, main hazards or enemies, pickups and
  key props on a plain background.
- `ui.png`: the title screen or a menu, in the same style.
- `prompt.md`: the prompts used.

Look at every image. Regenerate any that misses the prompt, shows text you did
not ask for, or looks like a different game from its siblings. A style named
after a technique must show it plainly (a "cel" or "toon" style needs visible
flat colour bands and outlines; "pixel art" needs a visible pixel grid), and
the styles must be told apart at thumbnail size.

Then check each style against the build pipeline. For every visible element
of its `gameplay.png` (surface detail, light effects such as glowing cracks or
god rays, foliage, water, particles, UI), name how it would be made: generated
sprite or texture, Blender model, shader, CC0 asset or code. If an element has
no realistic source, regenerate the frame without it. Grade production cost
from that list, not from the style's name: a frame that needs sculpted
surface detail, many unique hero assets or several custom shaders is High,
even if it looks like the others.

## 4. Condense into GDD.md

Write `GDD.md` from `docs/gdd-full.md`: 500-700 words, never more than about
1,000 (check with `wc -w GDD.md`). Keep the full document's key numbers; cut
explanation, not decisions. Structure:

```markdown
# <Game name>

<Concept: what the game is, who it is for, what makes it fun, and how it meets
the prompt.>

<Core loop: what the player does every few seconds and every few minutes; how
they win, lose or score; how a run starts, ends and restarts.>

<Controls: every input and its action, with the feel targets that matter.>

<Art and audio direction: look, palette, lighting, camera, sound and music; the
chosen style once picked.>

<Scope and features: what the MVP proves and what the final build adds.>

<Risks: what could make it slip or look bad, and how the plan handles each.>

## Concept options
### <Style name> (`concepts/<style-name>/`)
Look · palette · why it fits · production cost (pipeline and tools: generated
sprites, Blender models, shaders, CC0 assets; relative effort; risk).

## Chosen style
Pending: waiting for the user's choice.
```

Open each of the six paragraphs with its label in bold (**Concept.**, **Core
loop.**, **Controls.**, **Art and audio.**, **Scope.**, **Risks.**) so the
document scans. Each concept option takes 40-70 words.

## 5. Log, commit, stop

1. `BUILD_LOG.md`: dated lines for the tools used (Codex `image_gen` for the
   concepts) and what for. `ASSETS.md`: every concept image with path, how it
   was made and the tool.
2. Commit `GDD.md`, `REQUIREMENTS.md`, `docs/`, `concepts/`, `BUILD_LOG.md`,
   `ASSETS.md` and the gdd build files, with the user's git identity.
3. Stop and ask the user to pick a style. Show each style's name, its
   `gameplay.png` path and one line on its look and cost, and give your
   recommendation with the reason. Do not continue until they choose.

## 6. After the user picks

1. Replace "Pending" under **Chosen style** with the choice, the date and any
   adjustments the user asked for. Update the art direction paragraph and
   `docs/gdd-full.md` to match.
2. Copy the chosen style's images into `refs/` as the build's visual target,
   with a `refs/README.md` line saying the user approved them on that date.
3. Commit, then tell the user the next stage is `games-mvp`.
