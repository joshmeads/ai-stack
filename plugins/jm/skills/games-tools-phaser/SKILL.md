---
name: games-tools-phaser
description: >
  Build or fix a Phaser 4 browser game using the official Phaser skills that
  ship inside the project's node_modules/phaser/skills, plus verified fixes for
  pitfalls those docs miss (lost key taps, per-step collision callbacks,
  frame-rate-dependent camera follow, registry events, hit-stop timing). Use
  for any Phaser task: scenes, config, Arcade physics, input, cameras, tweens,
  particles, audio, tilemaps, UI, or Phaser 3 to 4 migration.
---

# Phaser 4

Phaser 4 ships its own agent skills in the npm package, written against the
same source you are running. Read those instead of relying on memory or old
Phaser 3 tutorials.

## 1. Confirm the version

```sh
grep '"version"' node_modules/phaser/package.json   # expect 4.x
ls node_modules/phaser/skills
```

If Phaser is not installed yet, install it first (`npm install phaser@^4`). For a
Phaser 3 project, read `v3-to-v4-migration` before changing anything and do not
silently upgrade.

## 2. Read the official skill for the task

Each file is 15-24 KB. Read **at most two** per task, the closest match first:

| Task | Read `node_modules/phaser/skills/<folder>/SKILL.md` |
| --- | --- |
| Game config, renderer, scale, boot | `game-setup-and-config`, `scale-and-responsive` |
| Scenes, transitions, HUD scene, data between scenes | `scenes`, `data-manager` |
| Movement, gravity, collision, overlap, groups | `physics-arcade`, `groups-and-containers` |
| Keyboard, mouse, touch, gamepad | `input-keyboard-mouse-touch` |
| Follow, shake, fade, zoom, minimap | `cameras` |
| Tweens and easing | `tweens` |
| Particles and bursts | `particles` |
| Sprites, images, sprite sheets, animation | `sprites-and-images`, `animations` |
| Text, bitmap text, UI labels | `text-and-bitmaptext` |
| Sound and music | `audio-and-sound` |
| Tilemaps (Tiled), tile collision | `tilemaps` |
| Timers, delayed calls, time scale | `time-and-timers` |
| Loading assets, progress bar | `loading-assets` |
| Shapes, graphics, render textures | `graphics-and-shapes`, `render-textures` |
| Filters, post FX, lighting | `filters-and-postfx`, `v4-new-features` |
| Events | `events-system` |
| Matter physics (rigid bodies, joints) | `physics-matter` |
| Phaser 3 code or tutorials | `v3-to-v4-migration` |

Some official files link to siblings with paths like `../tilemaps.md`; the real
path is `../tilemaps/SKILL.md`.

## 3. Pitfalls the official skills miss

Each was reproduced on Phaser 4.2.1.

1. **Short key taps are lost.** `Key.js` clears `_justDown` and `isDown` on
   keyup, so a tap that starts and ends between two frames is invisible to both
   `JustDown` and `isDown` (0 of 10 synthetic taps registered). Latch presses
   from the keyboard event and consume them in `update`:
   ```js
   create() {
     this.jumpQueued = false;
     this.input.keyboard.on('keydown-SPACE', () => { this.jumpQueued = true; });
   }
   update() {
     if (this.jumpQueued) { this.jumpQueued = false; this.tryJump(); }
   }
   ```
   Keys created with `addKey` / `createCursorKeys` are captured by default, so the
   page does not scroll; other keys scroll it unless you `addCapture` them.
2. **Collider and overlap callbacks run every physics step** while bodies touch
   (60 calls per second standing in a hazard). Make reactions one-shot: disable
   the body, or keep a cooldown (`invulnerableUntil` on the sprite's data), or
   compare `body.touching` with `body.wasTouching`.
3. **`startFollow(target, roundPixels, lerpX, lerpY)` lerps per frame**, so
   follow speed changes with frame rate (same 22 frames to settle at 30 and 60
   fps). For frame-rate independent follow, convert per update:
   ```js
   const k = 1 - Math.pow(1 - 0.1, delta / 16.67);   // 0.1 = lerp at 60 fps
   this.cameras.main.setLerp(k, k);
   ```
4. **Registry events.** The first `registry.set(key, v)` emits only `setdata`;
   `changedata-<key>` fires on later changes. Draw the initial value yourself,
   and remove registry listeners on scene `shutdown` (the registry outlives the
   scene, so listeners stack on every restart).
5. **Hit-stop and slow motion.** `this.time.timeScale` slows timers too: a 60 ms
   `delayedCall` at time scale 0.05 took about 1.2 s. Restore normal speed with
   a wall-clock `setTimeout`, and remember `update(time, delta)` receives the
   unscaled delta, so multiply movement by `this.time.timeScale` during a freeze
   or the player keeps moving.
6. **Gamepads must report a changing `timestamp`.** Phaser ignores a pad whose
   timestamp does not advance; this only matters for synthetic test pads.
7. **Renderer.** Use `Phaser.AUTO` or `Phaser.WEBGL`. Canvas is deprecated in
   Phaser 4 and lacks the v4 rendering features; `Phaser.WEBGL` throws
   "Cannot create WebGL context, aborting." when WebGL is unavailable.
8. **Scenes are reused.** The constructor runs once; reset per-run state in
   `init()` and clean up listeners on `shutdown`.

## 4. Look and feel

Working mechanics in one repeated tile set reads as a prototype. Plan the look
from the first playable, as tasks of their own:

- **Concept frames.** When the design asks for generated concept frames, ask
  for an in-game screenshot at the gameplay camera and the game's resolution
  and style, with the HUD. They are the target: `games-tools-web-qa` compares
  captures with them side by side, and light colour, glow, palette and prop
  density the build could match but does not are defects.
- **Art source: whatever gets closest to the concept.** The goal is the
  look of the concept frames; choose the tool per asset by what reaches it
  best, and mix them. The common failure is drawing everything in code
  (Pillow shapes, Graphics calls, noise): it is quick but usually reads as a
  prototype next to a painted concept, so compare before settling on it.
  Tools available:
  - Codex's `image_gen` (`imagegen` skill), with the concept frames as style
    reference: painted parallax layers, tile sets, prop and hazard sheets,
    character frames. `transparent_background` gives cut-outs; `edit` fixes a
    frame that drifts off-model.
  - CC0 packs (Kenney, OpenGameArt) where one matches the style.
  - Headless Blender renders for things that must rotate or animate
    consistently.
  - Code for what it does well: palette snapping, atlas packing, masks,
    gradients, glows, particles, and pixel-exact tiles or animation frames.
  Pieces cut out of a concept frame are a style target, not level art: the
  game needs a modular kit (tiles, ledge ends, props, background layers that
  repeat or extend) that can build every level, and a HUD drawn from live
  values with a bitmap or pixel font, never a picture of a HUD.
  Keep originals in `assets/source/` and convert them with a committed
  script (scale to the pixel grid, snap to the palette, cut frames, pack
  atlases) so the art can be rebuilt. Record every file and its source or
  prompt in `ASSETS.md`.
- **Build the concept frame first.** Before content grows, assemble the
  scene of one concept frame in the engine from the generated kit, capture
  it at the same camera and compare it side by side (`games-tools-web-qa`). Iterate
  on that one scene until a player would call it the same game.
- **Framing.** Copy the concept's composition, not just its pieces: dark
  foreground silhouettes (roots, pillars, rock overhangs) on the frame edges
  and corners, usually heavier on one side; shapes and light that lead the eye
  to the player and the way forward; an open, readable middle band where play
  happens. A scrolling game cannot compose every frame; build framing into
  the level design instead, with placement rules for framing pieces (edge
  layer, spacing, never over the play band) and composed set pieces at key
  moments (level start, reveals, checkpoints, exits). Check those moments.
  `compare.cjs --grid 5` (games-tools-web-qa) compares the large light and dark
  masses of reference and capture.
- **Depth.** At least three parallax layers (far, middle, foreground framing)
  with different scroll factors and values, plus a gameplay layer that always
  reads clearly against them.
- **Light and colour.** Phaser 4 has per-object lighting (`setLighting`, see
  `v4-new-features`) and a filter/post-FX system (`filters-and-postfx`). Give
  each level its own palette shift, light colour or atmosphere, not just a new
  layout.
- **Darkness with a light source** (lantern, torch, flashlight). Verified on
  4.2.1: a low ambient level, lit objects, a warm point light that follows the
  player, and an optional additive halo so the light still reads over flat
  backgrounds.
  ```js
  this.lights.enable().setAmbientColor(0x0b0d16);          // how dark unlit areas are
  layer.setLighting(true); player.setLighting(true);        // opt in everything the light touches
  this.lamp = this.lights.addLight(x, y, 220, 0xffb04a, 2.2); // radius, warm colour, intensity
  this.halo = this.add.image(x, y, 'glow')                  // radial-gradient texture
    .setBlendMode(Phaser.BlendModes.ADD);
  // each update: this.lamp.setPosition(px, py); this.halo.setPosition(px, py);
  // shrink the light with fuel: this.lamp.setRadius(r); this.halo.setScale(r / 64);
  ```
  Unlit objects (UI, the halo itself) ignore the lights, so keep HUD text unlit.
  Check it with a cropped comparison around the player (`games-tools-web-qa`,
  `compare.cjs --crop`): the reference's warm pool on the ground and the
  player's near side must show in the capture's crop, not only a bright lamp
  sprite.
  The halo is what makes the light read as warm on dark, blue-grey tiles; the
  point light alone gives a cool, flat reveal. Small glowing props (fireflies,
  crystals, mushrooms) get their own small additive glow.
- **Feedback.** Particles (`particles`), tweens (`tweens`), camera shake or
  flash (`cameras`) and a distinct sound for every collect, hit, death and
  dash or jump. Short hit-stop follows pitfall 5 above.
- **Check it** with the look review in `games-tools-web-qa` at the start, middle and
  end of every level.

## 5. Verify in a browser

Use the `games-tools-web-qa` skill: build, run the game, and probe it in headless
Chromium. Phaser logs its banner (`Phaser v4.x (WebGL | Web Audio)`) on boot;
any other console error is a defect.
