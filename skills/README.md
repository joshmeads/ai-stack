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

## Engineering

The `engineering` group is vendored from [mattpocock/skills](https://github.com/mattpocock/skills) and [t3dotgg/tstack](https://github.com/t3dotgg/tstack). `stack.toml` records the source and commit of each skill, and `ai-stack skills update` pulls newer commits. Run `setup-matt-pocock-skills` once in a repo before the ticket skills.

| Skill | Use |
| --- | --- |
| `grilling` | Grill the user relentlessly about a plan, decision or idea. |
| `grill-me` | A relentless interview to sharpen a plan or design. |
| `grill-with-docs` | The same interview, writing ADRs and the glossary as it goes. |
| `domain-modeling` | Build and sharpen the domain model, `GLOSSARY.md` and ADRs. |
| `to-spec` | Turn the current conversation into a spec on the issue tracker, with no interview. |
| `to-tickets` | Break a plan or spec into tracer-bullet tickets with blocking edges. |
| `triage` | Move issues and external PRs through triage roles and write agent-ready briefs. |
| `wayfinder` | Plan a very large piece of work as a map of decision tickets and resolve them one at a time. |
| `to-questionnaire` | Turn a decision you cannot fully answer into a questionnaire for someone else. |
| `wait-what` | Say that the last message did not land and have it re-pitched. |
| `wizard` | Generate an interactive bash wizard for steps only a human can do. |
| `writing-for-agents` | Reference for writing skills, `AGENTS.md` and `CLAUDE.md`. |
| `improve-codebase-architecture` | Find deepening opportunities, show them as an HTML report, then grill through one. |
| `codebase-design` | Shared vocabulary for deep modules, seams and adapters. |
| `implement-spec` | Implement a spec and its tickets on an integration branch with fresh subagents. |
| `setup-matt-pocock-skills` | Set up the issue tracker, triage labels and domain doc layout for a repo. |
| `retro` | Run a retrospective on a coding session. |
| `research` | Investigate a question against primary sources and save the findings as Markdown. |
| `compact-handoff` | Compact the conversation into a handoff document (upstream `handoff`; `handoff` above is a different skill). |
| `modernize` | Bring an old PR up to date, or recommend closing it. |
| `takeover` | Take over a PR, branch or thread and finish it while keeping credit. |
| `leaving-pr-comments` | Mark every comment posted on the user's behalf with an attribution note. |

## Writing

The `writing` group is vendored from [mattpocock/skills](https://github.com/mattpocock/skills).

| Skill | Use |
| --- | --- |
| `writing-fragments` | Explore: mine raw fragments for a piece, with no structure yet. |
| `writing-shape` | Exploit: shape the raw material into an article, paragraph by paragraph. |
| `writing-beats` | Exploit: assemble the raw material into a journey of beats. |
| `tutor` | Teach a topic over several sessions in a workspace (upstream `teach`; `jm-stack:teach` is a different skill). |

`takeover`, `implement-spec`, `wayfinder`, `tutor`, `compact-handoff`, `break`, `variant` and `diagram-design` are patched by scripts in `scripts/skill-patches/`, so their edits survive `skills update`.

## Design

The `design` group is vendored from [jakubkrehel/skills](https://github.com/jakubkrehel/skills), [Leonxlnx/imagegen-skills](https://github.com/Leonxlnx/imagegen-skills), [meodai/skill.color-expert](https://github.com/meodai/skill.color-expert), and [jakubkrehel/oklch-skill](https://github.com/jakubkrehel/oklch-skill). `better-interface` runs the other `better-*` skills as one review.

| Skill | Use |
| --- | --- |
| `better-accessibility` | Check a project against accessibility standards and best practices. |
| `better-colors` | Build a color system: palettes, semantic tokens, format conversion, contrast checks. |
| `better-interface` | One review across accessibility, layout, writing, typography, color and UI polish. |
| `better-layout` | Grouping, alignment, reading order, progressive disclosure. |
| `better-typography` | Type scale, spacing, sizing, variable fonts, OpenType features, wrapping, truncation. |
| `better-ui` | UI polish: concentric radius, optical alignment, surface depth, icons, hit areas. |
| `better-writing` | Improve product copy. |
| `break` | Stress a component or page with hostile content and states, and report what visibly broke. |
| `explain-interface` | Explain how something on the web was built, layer by layer. |
| `interface-review` | Review a change, pull request or branch against the `better-*` standards. |
| `variant` | Produce design alternatives for a piece of UI without ranking them. |
| `brandkit` | Generate brand-guidelines boards, logo systems and identity decks as images. |
| `color-expert` | Color science, palette generation, naming, conversions, accessibility, and print or pigment color. |
| `oklch-skill` | OKLCH colors for web projects, including palettes, contrast, gamut handling, and Tailwind themes. |

## Archived

The `archived` group is vendored but disabled: its skills aren't linked into any harness, so they cost no context. To turn one back on, move it to a global group in `stack.toml` and run `ai-stack install`. `better-ui` and the other `better-*` skills replace `make-interfaces-feel-better`. `design-taste-frontend` covers `redesign-existing-projects`, which upstream retired along with `full-output-enforcement`; those two stay pinned to the last upstream commit that had them.

| Skill | Use |
| --- | --- |
| `redesign-existing-projects` | Upgrade an existing site or app to a higher design standard. |
| `full-output-enforcement` | Stop an agent truncating its output or leaving placeholders. |
| `make-interfaces-feel-better` | Design engineering details that make an interface feel polished. |

## Diagrams

The `diagrams` group is vendored from [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design), [tt-a1i/archify](https://github.com/tt-a1i/archify), and [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy).

| Skill | Use |
| --- | --- |
| `diagram-design` | Branded diagrams and charts as HTML, SVG or PNG, with draw.io, Mermaid and Excalidraw import. |
| `archify` | Validated interactive architecture, workflow, sequence, data, and timing diagrams as standalone HTML. |
| `anatomy` | Interactive isometric SVG illustrations that explain technical ideas through physical objects. |

## Cua

The `cua` group is vendored from [trycua/cua](https://github.com/trycua/cua).

| Skill | Use |
| --- | --- |
| `cua-driver` | Drive a native GUI app on macOS, Windows or Linux through the `cua-driver` CLI or MCP server. |
| `cua-sandboxes` | Create, use and clean up disposable Linux or macOS computers with the `cua` CLI or SDK. |
| `cua-spaces` | Work inside Cua Spaces through the cua MCP server: run commands, move files, show windows. |
| `cua-volume` | Use the Cua Volume shared by every Space and agent, for files that outlive a Space. |
| `gui-automation` | Test, fill and screenshot a GUI through the `cua` CLI on VMs, containers and local machines. |

## Credits

Several tool skills are adapted from third-party skills. The tool skills below keep their licence files, and the skill names and cross-references were changed for this stack. [NOTICE.md](../NOTICE.md) has the details, including the sources, commits and licences of the engineering, writing, design, diagram and cua skills.

| Skill | Copyright | Licence |
| --- | --- | --- |
| `tools-audio`, `tools-threejs-gltf`, `tools-threejs-materials`, `tools-threejs-scene` | 2026 Abhishek Barali and the awesome-gamedev-agent-skills contributors | Apache-2.0 |
| `tools-blender-model` (from AlexConnolly/agent-skills, commit bd3beb8) | 2026 Alex Connolly | MIT |
| `tools-r3f` | 2026 Ciro Autuori; vendored references from Impertio-Studio/Three.js-Claude-Skill-Package and emalorenzo/three-agent-skills (see its `CREDITS.md`) | MIT |
| `tools-threejs-debug`, `tools-threejs-gameplay`, `tools-threejs-look`, `tools-threejs-ui` | 2026 Majid Manzarpour | MIT |
| `tools-threejs-procedural` | 2026 Scott Sun | MIT |

Original skills are MIT. Vendored skills retain their source licenses and notices; see [NOTICE.md](../NOTICE.md).
