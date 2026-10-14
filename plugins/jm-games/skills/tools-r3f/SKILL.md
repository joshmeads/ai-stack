---
name: tools-r3f
description: >-
  Production-grade governance for 3D web on React Three Fiber + Three.js +
  Zustand + Next.js. Treats the 3D canvas as a runtime GPU with explicit
  performance, accessibility and quality budgets, then enforces them in audit.
  Use when the user asks for a 3D scene, WebGL hero, 3D product configurator,
  scroll-driven 3D, a "production Awwwards-style" site, R3F, useFrame, drei,
  adaptive quality tiers, draw-call optimization, GLB/Draco/KTX2, or mentions
  Three.js in a React/Next.js project. Also triggers on "3D landing", "WebGL
  hero", "interactive product showcase", "scroll storytelling", "cinematic web
  experience", "WebGPU/TSL migration". Do NOT use for: CRUD dashboards without
  3D, static sites without WebGL, landing pages where a single image suffices
  (decorative 3D costs conversion on B2B funnels), or single-file vanilla HTML
  deliverables.
license: MIT
---

# jm-games:tools-r3f — production 3D web, audited

For WebGPU, TSL and RenderPipeline (three r180+), `jm-games:threejs` is checked against current source. Where this skill's WebGPU references disagree with it (`PostProcessing` vs `RenderPipeline`, where post nodes are imported from, `computeAsync`), follow `jm-games:threejs`.

A 3D scene is a runtime with a GPU budget, not a decorative animation library. The non-negotiable contract: 3D must be **progressive, observable, accessible, and always replaceable by a 2D fallback**. This skill turns that contract into concrete steps, hard rules, and an audit scorecard.

The standard fuses two lineages: the enterprise discipline of explicit budgets, deterministic state and lifecycle hygiene, and the cinematic craft of award-winning studios (Active Theory, Lusion, 14islands). Both already converged on the same conclusion: **measure, then polish**.

## Philosophy (read before code)

1. **DOM wins.** Data, forms, CTAs, navigation, tables: all in the DOM. The `<Canvas>` is isolated, client-only, lazy. A fully-WebGL homepage hurts SEO, accessibility, conversion and maintainability.
2. **Aesthetics over geometry.** An icosahedron with HDRI, ACESFilmic and bloom beats a 200k-triangle model lit wrong. Budget for lighting and post-processing first, geometry second.
3. **Lerp everything.** No value changes instantly: camera, rotation, hover, progress. Framerate-independent damping: `factor = 1 - Math.exp(-lambda * delta)`.
4. **Explicit GPU budgets.** Every experience declares draw calls, triangles, textures and max DPR. Enforced in QA, never left to chance.
5. **State at three speeds.** Business state in server/cache, UI state in Zustand, transient per-frame state in refs. Never reactive state at 60 FPS.
6. **Accessibility is non-negotiable.** `prefers-reduced-motion` honored, every critical function has a DOM equivalent, the canvas pauses off-viewport.

## SOTA stack (July 2026)

```
Next.js App Router + TypeScript (strict)
@react-three/fiber v9 + @react-three/drei + three (pin in package.json, never CDN)
zustand (UI state) + TanStack Query (server state). NEVER Redux.
@react-three/postprocessing (EffectComposer, Bloom, Vignette, Noise)
gltf-transform / gltfjsx / Draco / KTX2-Basis (asset pipeline)
GSAP + ScrollTrigger + Lenis: ONLY for scroll choreography (DOM motion: framer-motion)
WebGPU renderer + TSL: strategic watch, adopt only with a solid WebGL fallback
```

Version notes: R3F v9 applies `ACESFilmicToneMapping` and sRGB output by default. Do not override them — it is the "non-WebGL look" for free. `dispersion` on `MeshPhysicalMaterial` requires three >= r167. Pin exact versions in the project `package.json`; never silent upgrades.

## 6-step workflow (skipping a step produces a tech demo)

### Step 1 — Experience archetype

Pick one archetype and commit:

| Archetype | Pattern | Enterprise use |
|---|---|---|
| Object showcase | Hero object, camera orbit/zoom on scroll | Product page, configurator |
| Room walkthrough | Camera path on spline through interior | Real estate, hospitality |
| Vertical descent | Scroll = descent through layers | Case study, storytelling |
| Flyover | Camera traverses a landscape | Yacht/travel experience |
| Particle field | Points react to scroll/mouse | Atmospheric hero, brand |

If the user did not specify, ask which one. Do not invent new archetypes.

### Step 2 — Canvas architecture

Read `references/canvas-architecture.md`: CanvasShell with adaptive DPR, `frameloop="demand"` for passive scenes, lazy loading, 2D fallback, lifecycle and dispose, `three/` directory separated from `features/`.

### Step 3 — Asset pipeline

GLB is a compiled artifact: Blender (headless scripts: see the `jm-games:tools-blender-model` skill) -> GLB with Draco -> gltf-transform (KTX2) -> validate -> CDN. Low/mid/high LOD, `useGLTF` + gltfjsx for JSX graphs, nested `Suspense` for progressive loading. Details in the `jm-games:tools-blender-model` skill and `references/procedural-geometry.md` (code-only geometry is the default before AI generators).

### Step 4 — Polish chain (in this order)

Read `references/polish-chain.md`. Order matters:

1. HDRI as `scene.environment` (drei `<Environment>`)
2. Lighting: one `DirectionalLight` per shadow direction even with HDRI
3. Post-processing: `@react-three/postprocessing` (Bloom -> Vignette -> Noise/grain last)
4. Hero materials: `meshPhysicalMaterial` with transmission + dispersion for glass
5. Scroll timeline: GSAP ScrollTrigger + Lenis, Lenis owns the scroll
6. Custom cursor (optional, premium signature)
7. Film grain as the final composite layer, intensity ~0.05

### Step 5 — State

Read `references/state-management.md`: three-speed model, slice per bounded context, narrow selectors with `useShallow`, store-scene bridge (the store holds intents/targets, Three.js owns the physical state), vanilla store for fast signals, named semantic commands.

### Step 6 — Audit

Read `references/quality-governance.md`. Before declaring done:

- Lighthouse Performance >= 85 desktop, >= 70 mobile; FCP < 1.8s, LCP < 2.5s
- 60fps desktop, 30fps floor on mid Android; DPR capped
- Draw call / triangle budget respected (table in quality-governance)
- GLB Draco-compressed, textures KTX2 where possible
- Zero allocations in `useFrame`, zero `setState` in the loop
- `prefers-reduced-motion` tested, 2D fallback verified
- Real devices tested: mobile Safari, mid Android Chrome, integrated-GPU laptop, high-DPI desktop

## Hard rules — never do these

Long form in `references/anti-patterns.md`.

1. No `setState` or store update in `useFrame`. Ref + mutation + `delta`.
2. No per-frame allocations (`new Vector3()`, arrays, materials in the loop). Reuse via ref/useMemo/module scope.
3. No `metalness > 0` without an environment map. Result: black blobs.
4. No uncapped DPR. `dpr={[1, 1.5]}` baseline, 2 only on high tier.
5. No uncompressed GLB. Draco or Meshopt mandatory.
6. No `OrbitControls` in production. Camera scroll-driven or rig driven.
7. No frame-count animations. Only `delta` time; at 144Hz and 30Hz motion must be identical.
8. No CSS scroll + JS scroll mix. Lenis owns the scroll, ScrollTrigger reads from Lenis, `scroll-behavior: smooth` removed.
9. No per-frame raycast over the whole scene. Small array of interactable meshes.
10. No mount/unmount of heavy scenes in transitions. `visible` + asset reuse.
11. No Three.js objects in persisted Zustand. Persist only restorable preferences.
12. No autoplay audio. Gate on user gesture, persistent mute, OFF by default on mobile.
13. No 3D where an image suffices. Decorative 3D on B2B funnels costs conversion and adds no trust.

## Reference files (load on demand, not all at once)

Core (written for this skill, enterprise standard):
- `references/canvas-architecture.md` — CanvasShell, adaptive quality, lifecycle, fallback, project structure
- `references/state-management.md` — three-speed model, Zustand slices, scene bridge, runtime store
- `references/polish-chain.md` — physical lighting, HDRI/Lightformer, ACES/AgX/Neutral, pmndrs post chain, hero materials, motion (Lenis+ScrollTrigger, spring, stagger), type/palette, audio
- `references/quality-governance.md` — GPU budgets, renderer.info thresholds, Core Web Vitals, quality profiles, telemetry, context loss, 88/100 audit scorecard
- `references/anti-patterns.md` — WRONG/WHY/CORRECT merged + symptom -> cause -> fix diagnostic table
- `references/performance-diagnosis.md` — diagnostic flowchart, instancing/BatchedMesh decision tree, cost/benefit levers in order, raycasting

Asset and shader (MIT, derived from public awwwards-3d references):
- `references/procedural-geometry.md` — code-only geometry (primitives, displacement, math shapes)
- `references/shaders.md` — GLSL building blocks + production `onBeforeCompile` appendix (cache key, dissolve edge glow)
- Blender modeling and GLB export: use the `jm-games:tools-blender-model` skill
- `scripts/export_glb.py` — headless Blender -> Draco GLB export (+ `--meshopt` flag)

Vendor API reference (kept with attribution + errata headers, see CREDITS.md):
- `references/webgpu-tsl-api.md` — full TSL/NodeMaterial table (errata: import from `three/tsl`, r181 sync)
- `references/postprocessing-passes-api.md` — 27+ vanilla pass signatures (note: OutputPass, never GammaCorrectionShader)
- `references/three-migration-r170-r183.md` — r170 -> r183 breaking changes

## When stuck

- Flat or black material: missing HDRI. Step 4, item 1.
- Bad performance: cut post-processing passes before geometry. quality-governance.md.
- Janky scroll: Lenis not wired to ScrollTrigger. polish-chain.md.
- Continuous re-renders: state in the wrong place. state-management.md, three-speed table.
- "Works but does not feel premium": you skipped Step 4. Go back and apply in order.
