# Standalone skills

Each folder here is one standalone skill, installed under its plain name. `stack.toml` at the stack root puts every skill in at least one group, and `ai-stack install` links the skills of the global groups into each harness's user skill folder (`~/.claude/skills` and `~/.agents/skills`). `ai-stack groups` lists the groups, their members and an estimated token cost.

## Game stages

A browser game moves through three stage skills. Each one reads `game-delivery` first.

| Skill | Use |
| --- | --- |
| `game-gdd` | Interview the user and write a game design document, plus the `AGENTS.md` and Codex agent files the build follows; or a short mini-GDD. |
| `game-mini-gdd` | Stage 1: turn a task prompt into a condensed GDD, `REQUIREMENTS.md` and 3-4 concept styles, then stop for the user to pick one. |
| `game-mvp` | Stage 2: build the playable MVP from the approved GDD and concept style, and host it. |
| `game-final` | Stage 3: apply all feedback, finish the game, package the submission and update the hosted build. |
| `game-delivery` | The delivery contract the stage skills follow: fidelity to the prompt, scope per stage, hosting, README sections, end-of-session routine. |
| `feather-prep` | Prepare a Codex-built web game for an OpenAI Feather submission, locally; the user does every Feather action by hand. |

## Engine and asset tools

| Skill | Use |
| --- | --- |
| `threejs` | Version-specific facts for three.js r180+ (WebGPURenderer, TSL, RenderPipeline, WebGL2 fallback) and react-three-fiber v9. |
| `tools-threejs-scene` | Stand up a three.js scene: import maps, renderer, render loop, resize, OrbitControls. |
| `tools-threejs-materials` | Materials, lights, shadows and environment maps in three.js. |
| `tools-threejs-gltf` | Load glTF/GLB models and play their animations, including DRACO, Meshopt and KTX2. |
| `tools-threejs-gameplay` | Build playable three.js game systems: scaffold, loops, levels, input, camera, physics, game feel. |
| `tools-threejs-look` | Art direction and visual quality for three.js games, with a visual scorecard. |
| `tools-threejs-procedural` | Production procedural meshes in three.js and their quality checks. |
| `tools-threejs-ui` | HUDs, menus, overlays and touch UI for three.js games. |
| `tools-threejs-debug` | Debug and profile three.js games. |
| `tools-r3f` | Production React Three Fiber work with performance, accessibility and quality budgets. |
| `tools-postprocessing` | Post-processing with the pmndrs `postprocessing` package in vanilla three.js. |
| `tools-phaser` | Phaser 4 games, using the official skills in `node_modules/phaser/skills` plus verified pitfall fixes. |
| `tools-audio` | Web Audio for browser games: buses, ducking, SFX variation, adaptive music. |
| `tools-blender-model` | Build or fix a 3D model as parametric Blender Python, exported to glTF, with a render-only review. |
| `tools-web-qa` | Decide whether a browser game works, from evidence gathered by running it. |
| `art-iteration` | Iterate a visual deliverable against reference images until an image-only critic passes it. |

The `art-iteration` critic runs on the review model named in the routing block of your global instructions. The final critique also asks the other provider through its CLI.

## Working tools

| Skill | Use |
| --- | --- |
| `handoff` | Write a continuation packet so work can resume in a fresh session. |
| `try-to-break` | Try to break a change on purpose and report what fails, with evidence. |
| `visual-evidence` | Take matching before/after screenshots of a UI change. |
| `devtools-perf` | Measure CPU and memory per action or route in the browser and on a Node or Next.js server, over the Chrome DevTools Protocol. |
| `host-static` | Host a built static folder at an unlisted games.joshmeads.dev URL. |
| `feedback` | Record the user's feedback on the current project in `FEEDBACK.md`, newest first. |
| `codex-session-export` | Find and export the Codex sessions that contributed to a project, with their metadata. |

## Credits

Several tool skills are adapted from third-party skills. Each keeps its licence file, and the skill names and cross-references were changed for this stack. [NOTICE.md](../NOTICE.md) has the details.

| Skill | Copyright | Licence |
| --- | --- | --- |
| `tools-audio`, `tools-threejs-gltf`, `tools-threejs-materials`, `tools-threejs-scene` | 2026 Abhishek Barali and the awesome-gamedev-agent-skills contributors | Apache-2.0 |
| `tools-blender-model` (from AlexConnolly/agent-skills, commit bd3beb8) | 2026 Alex Connolly | MIT |
| `tools-r3f` | 2026 Ciro Autuori; vendored references from Impertio-Studio/Three.js-Claude-Skill-Package and emalorenzo/three-agent-skills (see its `CREDITS.md`) | MIT |
| `tools-threejs-debug`, `tools-threejs-gameplay`, `tools-threejs-look`, `tools-threejs-ui` | 2026 Majid Manzarpour | MIT |
| `tools-threejs-procedural` | 2026 Scott Sun | MIT |

License: MIT, except the Apache-2.0 skills above (SPDX: `MIT AND Apache-2.0`).
