# Credits

This skill consolidates, refactors, and audits material from several public
three.js / React Three Fiber references. Where vendor API reference files were
preserved verbatim (with errata), the upstream source and license are listed
below. All upstream material is MIT-licensed or publicly released for reuse.

## Vendor API reference files (verbatim + errata)

### `references/webgpu-tsl-api.md`

- **Source**: [Impertio-Studio/Three.js-Claude-Skill-Package](https://github.com/Impertio-Studio/Three.js-Claude-Skill-Package)
  — `threejs-impl-webgpu/references/methods.md`
- **License**: MIT (see upstream repo)
- **Errata applied (July 2026)**: TSL imports (`compute`, `storage`, nodes) come
  from `three/tsl`, not `three/webgpu`; browser matrix corrected; since three
  r181 `render()` / `compute()` are synchronous and the `*Async` variants are
  deprecated; post-processing entry point is `pass(scene, camera)` with
  `renderOutput()` as the final node.

### `references/postprocessing-passes-api.md`

- **Source**: [Impertio-Studio/Three.js-Claude-Skill-Package](https://github.com/Impertio-Studio/Three.js-Claude-Skill-Package)
  — `threejs-impl-post-processing/references/methods.md`
- **License**: MIT (see upstream repo)
- **Notes**: Since three r154+ the final pass is `OutputPass` (never
  `GammaCorrectionShader`); in R3F v9 use `@react-three/postprocessing` (pmndrs).

### `references/three-migration-r170-r183.md`

- **Source**: [emalorenzo/three-agent-skills](https://github.com/emalorenzo/three-agent-skills)
  — `three-best-practices/rules/migration-checklist.md`
- **License**: MIT (see upstream repo)

## Core references (rewritten for this skill)

The following files are written for this skill, synthesizing production
experience and public R3F / Three.js best-practice references (3d-tips,
3d-zustand, awwwards-3d hard rules, pmndrs ecosystem docs). They are not derived
from a single upstream file:

- `references/canvas-architecture.md`
- `references/state-management.md`
- `references/polish-chain.md`
- `references/quality-governance.md`
- `references/anti-patterns.md`
- `references/performance-diagnosis.md`
- `references/model-optimization.md`
- `references/physics-rapier.md`
- `references/webgpu-tsl.md`

## Asset and shader building blocks (MIT)

- `references/procedural-geometry.md`
- `references/shaders.md`
- `references/blender-pipeline.md`
- `scripts/export_glb.py`

Derived from public awwwards-3d reference material released under MIT.

## Ecosystems referenced

- [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) — the
  R3F renderer and ecosystem.
- [pmndrs/drei](https://github.com/pmndrs/drei) — R3F helpers.
- [pmndrs/react-postprocessing](https://github.com/pmndrs/react-postprocessing) —
  post-processing for R3F.
- [pmndrs/react-three-a11y](https://github.com/pmndrs/react-three-a11y) —
  accessibility tooling for R3F.
- [14islands/r3f-scroll-rig](https://github.com/14islands/r3f-scroll-rig) —
  scroll synchronization reference.
- [darkroomengineering/lenis](https://github.com/darkroomengineering/lenis) —
  smooth scroll.

If any attribution is missing or incorrect, please open an issue or a pull
request. Attribution corrections are welcome.
