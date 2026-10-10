# GDD template

Copy these headings into `GDD.md`. Under each heading, write concrete rules with numbers, not descriptions. Delete any heading that does not apply. The example lines show the level of precision to aim for.

```markdown
# <Game name> — game design document

Source of truth for the build. Only the user changes scope; record every change in the changelog at the bottom.

## Pitch
One or two sentences. Reference: <game/film/image>, used for <look | feel | rules>.

## Brief requirements
Only when the game comes from a written brief or prompt. Copy each explicit requirement in the brief's own words. These are fixed: the design may add to them but must not contradict or replace any of them.
- "<requirement>" → <GDD section or tier item that satisfies it>

## References
Each reference gets a heading that says what it is for and one line on which element to take from it.
- `refs/<file>.png`: target look for <area>.
- <Ruleset/edition/source>: implement exactly / loosely as stated per rule below.

## Core loop
- Verbs, win and lose conditions, session length, ending.
- Outline from opening to play to ending, including restart.
- Example: "Clear the formation before fuel runs out. Fuel drops in 8 equal steps over 90 s and refills at wave start and on respawn."

## Player
- What the player controls.
- Attributes that change during play, and how each change is shown on screen.
- Pick-ups, power-ups or unlocks, and what each does. Write "None" when there are none; do not invent them.

## Rules and numbers
Every gameplay number lives here and in one config module in the code (for example `src/config.ts`).
- Example: "Max 2 player shots on screen. Enemy fire interval ≥ 0.5 s at wave 1, −0.03 s per wave, floor 0.2 s."

## Controls and feel
- Bindings per device.
- Feel targets with numbers: turn rate, acceleration, smoothing, hit stop frames.
- Example: "Turn rate 90°/s; input ease-in 0.25 s; 3-frame hit stop on kills."

## Camera
- Type, distance, field of view, behaviour on turns and obstacles.
- Rule: the player is fully in frame at all times, including free look.

## World and content
- Layout, stages or biomes, landmarks, transitions.
- Rule: no floating, sunken, see-through or flickering objects; no hard colour seams between areas.

## Art direction
- Style, palette, lighting, time of day.
- Asset sources: CC0 libraries, headless Blender scripts and `image_gen` artwork, logged in `ASSETS.md`.
- Quality bar: matches `refs/` at similar cameras. QA puts each capture next to its reference (`web-game-qa` `scripts/compare.cjs` when installed). It treats differences the pipeline could close as defects: light colour and direction, glow, palette, and prop density.
- Defect list: <the user's "would look bad if" answers>.
- Mood: the feeling the art and audio together should create.
- Variety: every repeated prop, hazard, tile or enemy has at least 3 variants, and identical neighbours never sit side by side.
- Depth: for side or top-down 2D views, at least three depth layers (background, midground, play layer); for 3D, near, mid and far detail.
- Levels: when there are several levels or areas, each has its own palette or lighting change.

## Audio
- Music, sound effects, generation method, start-after-input, toggles, pause behaviour.

## Screens and UI
- Screen list with contents and primary action. HUD layout.
- Every changing attribute from **Player** appears on the HUD or is shown another way.
- Interaction prompts: how the game shows that an action is available.
- Win and lose screens: what the player sees and how to restart.
- Text rule: no flavour text or taglines unless listed here.

## Tech stack
- Language, engine, renderer, pinned versions, package manager, tools, test tools, deploy target, remote.

## Architecture
- Module boundaries, deterministic core, state machine states and transitions, events, save/load, modes and query parameters.

## Performance
- Target hardware, resolution, FPS, quality tiers, measurement method.

## Scope and definition of done
### Tier 1 (must ship, in order)
- <feature>: <player-visible acceptance>
### Tier 2
### Tier 3
Rules:
- Never break a lower tier to work on a higher one.
- Unfinished features are hidden behind flags, not left broken.
- A tier is done when QA passes every item in it on the integration branch.

## Out of scope
- <explicit list>

## Assumptions
Decisions made with the model's judgement at the user's request. The user may override any of them.
- <decision> — <one-line reason>

## Changelog
- <date>: <scope change requested by the user>
```
