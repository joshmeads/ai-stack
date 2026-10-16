---
name: threejs
description: Version-specific facts and gotchas for three.js r180+ (WebGPURenderer, TSL node materials, RenderPipeline, WebGL2 fallback) and react-three-fiber v9 that models get wrong from training data. Use when writing, reviewing, or debugging three.js or r3f code, TSL shaders, post-processing, GPU particles, or headless WebGPU capture.
---

# three.js

This skill holds only what a capable model is likely to get wrong: APIs that changed after common training data, three-internal behavior, error messages and their real causes, and measured results that contradict intuition. General graphics, game-dev, and React knowledge is left out. Every item was hit in real WebGPU/TSL builds on three r180–r186 and checked against r186.1 source. r186 was the latest release in October 2026.

## Before writing code

1. Read the installed version: `grep '"version"' node_modules/three/package.json`. `require('three/package.json')` throws, because three's exports map omits it. If the version is not r186, treat names here as unverified.
2. Grep every TSL function, node class, and addon signature before using it; do not write them from memory:
   - TSL: `node_modules/three/src/Three.TSL.js`
   - Classes: `node_modules/three/src/Three.WebGPU.js`
   - Post nodes: `node_modules/three/examples/jsm/tsl/display/` (import from `three/addons/tsl/display/<Name>.js`)
3. When a shader misbehaves, read what TSL generated: `await renderer.debug.getShaderAsync(scene, camera, mesh)`.

## Facts most often gotten wrong

- `await renderer.init()` once, then the synchronous `render()`. `renderAsync()` is deprecated since r181. `PostProcessing` is `RenderPipeline` since r183.
- `renderer.isWebGPURenderer` is true on the WebGL2 fallback too. Read `renderer.backend.isWebGPUBackend` after `init()`.
- Lit-material pipelines are keyed on the scene's light set (light ids and `castShadow`). Adding, removing, or re-shadowing a light recompiles every lit material. Keep a fixed pool and set unused lights to intensity 0.
- `renderer.resolveTimestampsAsync()` is not a valid frame time (it over-counts on Apple and under-counts on NVIDIA), and headless Chrome caps rAF near 30 Hz. See `performance.md` for the method that works.
- Chained TSL `t.mix(a, b)` means `mix(a, b, t)`: the receiver is the weight.

## References

| File | Read when |
| --- | --- |
| `references/api-and-versions.md` | Any task: renames, backend detection, typings gaps, r180-only bugs |
| `references/tsl.md` | Writing or debugging TSL, node materials, or compute |
| `references/webgpu-vs-webgl.md` | Supporting both backends, compute on WebGL2, attribute and varying limits, readback |
| `references/performance.md` | Measuring frame time, compile stutter and warm-up, buffer uploads, instancing |
| `references/materials-and-output.md` | Blending, tone mapping output, transmission and refraction, depth effects |
| `references/post-processing.md` | `RenderPipeline`, passes, MRT, depth, GTAO, reflectors, black canvas after adding a pass |
| `references/testing-and-capture.md` | Headless WebGPU in Playwright, frame capture, video encoding |
| `references/r3f.md` | react-three-fiber with `WebGPURenderer` |
| `references/troubleshooting.md` | You have a symptom and need the likely cause |
