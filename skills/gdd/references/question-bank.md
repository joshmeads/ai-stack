# Question bank

Use this to build the open-question list. Ask only what the user has not already answered. Each area notes the failure it prevents.

## 1. Pitch and reference
- One-sentence pitch. Who is the player, and what do they do?
- Is there a written brief or prompt? Which of its requirements are fixed?
- Reference games, films or images. Which parts of each are wanted: look, feel, rules, structure?
- What should the first 30 seconds feel like?

## 2. Core loop and rules
- Player verbs. Win and lose conditions. Session length. The ending.
- Exact numbers: lives, health, speed, damage, fire rate, limits on screen, scoring and bonuses.
- What the player controls. Attributes that change during play (health, fuel, ammo), and how each change is shown.
- Pick-ups, power-ups or unlocks, if any, and what each does.
- Difficulty progression. Is it configurable, and is it derivable for any level?
- **Named rulesets or IP.** Which edition or source, and faithful or loose? *(A "BattleTech rules" request once became an original simplified ruleset.)*
- **How the core mechanic behaves physically.** For example, does the tow line pull the boat? *(It once did not.)*

## 3. Controls and feel
- Devices: keyboard, mouse, gamepad, touch. Exact bindings, including arrows as well as WASD.
- Snappy or floaty? Name a reference game, plus turn rate, acceleration and input smoothing. *(Twitchy steering and over-snappy flight were rejected.)*
- Juice: hit stop, flashes, shake, score pop-ups. Reduced-motion behaviour.
- Pause, settings, remapping.

## 4. Camera
- Type (chase, top-down, orthographic, first person), distance, field of view.
- **The player must stay in frame:** bends, obstacles, free look, recovery. *(A camera once hid the log and pulled the view away from it.)*
- Cinematic or demo cameras.

## 5. World and content
- Size, layout, biomes or stages, landmarks. Procedural or authored. Finite or infinite, and what happens at the edge.
- What must never happen: floating or sunken objects, see-through surfaces, hard colour seams between areas, LOD popping. *(All of these shipped in earlier games.)*

## 6. Art direction and quality bar
- Style: pixel, stylised, painterly, realistic. Palette, lighting, time of day.
- Reference images. If there are none, offer concept images from `image_gen`.
- "What would make you call it awful?" Record the answers as a defect list.
- The overall mood the art and audio should create.
- Assets: CC0 libraries, Blender scripts and `image_gen` are allowed by default. Are binary files allowed in the repository, or must everything be generated at runtime?
- Resolution and scaling (for example, crisp integer scaling for pixel art).

## 7. Audio
- Music style and adaptivity. Sound-effect list.
- Generated at runtime or files.
- Starts after first input. Separate music and sound-effect toggles.
- Behaviour on pause.

## 8. Screens, UI and text
- Screens: title, pause, settings, game over, results, loading.
- HUD contents and positions.
- How the game shows that an action or interaction is available.
- Win and lose screens: what the player sees and how they restart.
- Wordless play?
- **Flavour text:** none unless the user asks. *(Unrequested taglines were rejected.)*
- Fonts.

## 9. Stack and platform
- Language, engine, renderer (WebGPU or WebGL, and whether a fallback is allowed), versions to pin.
- Package manager, build, lint and format tools. Test tools.
- Hosting and deploy target. Repository and remote.

## 10. Performance
- Target hardware, resolution, FPS, quality tiers.
- How it is measured: moving gameplay, p95/p99 frame time, or average FPS.

## 11. Architecture
- Deterministic core: fixed timestep, seeded RNG, no DOM or renderer in the simulation.
- Explicit state machine and its states. Events emitted by the core.
- Save and load: what is saved, when, and where.
- Modes: demo or attract, benchmark, debug query parameters (hitboxes, invulnerability, skip level).

## 12. Scope and done
- Tier 1, 2 and 3 features, each with player-visible acceptance.
- Out-of-scope list.
- Deadline or turnaround.
- When the user will play it.

## 13. Process
- Orchestrator model: `gpt-6.1-sol` or `gpt-6-astra`, high. Implementers: `gpt-6.1-sol` high. QA and reviews: `gpt-6-astra` high.
- Parallelism. Remote and push rights. Deploy rights.
- Notes files: NOTES.md, DECISIONS.md, JOSH.md for blockers.
