# WebGPU + TSL — strategic path

WebGPU is not the default: it is the upgrade path when WebGL2 becomes the bottleneck. Roadmap rule: **solid WebGL first (the rest of this skill), then WebGPU with a working fallback**.

## When to migrate (concrete criteria)

- More than ~50,000 particles or compute simulations (flocking, fluids, cloth)
- Draw-call-heavy scenes where WebGL CPU overhead dominates
- Heavy post-processing (SSGI, SSR, quality TAA) at full resolution
- Expected gain: 2-10x on compute workloads; little or none on simple scenes

If no criterion is met: stay on WebGL2, the complexity cost does not pay back.

## Browser support (July 2026, corrected matrix)

Chrome/Edge 113+; Firefox 141+ (Windows) / 145+ (macOS ARM); Safari 26+ (since September 2025). Enough coverage for adoption **with fallback**, never without. Use `forceWebGL: true` to test the fallback path in CI.

## Canonical setup

```ts
import * as THREE from 'three/webgpu';
import { WebGPU } from 'three/webgpu';

if (!WebGPU.isAvailable()) { /* fall back to WebGLRenderer */ }
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: false });
await renderer.init();
```

In R3F v9:

```tsx
<Canvas gl={async (props) => { const r = new WebGPURenderer(props); await r.init(); return r; }}>
```

## Hard rules

1. **Never GLSL/ShaderMaterial with WebGPU**: TSL / NodeMaterial only. GLSL does not compile on WebGPU.
2. **Never EffectComposer**: post-processing via the `PostProcessing` class + TSL nodes (`pass(scene, camera)` entry, `renderOutput()` final node).
3. **Import TSL always from `three/tsl`** (`compute`, `storage`, `If`, `uniform`, nodes) — not from `three/webgpu`.
4. **Never a tiny JS `if` in TSL**: always `If(cond, ...)`. JS is compile-time, TSL is the GPU graph.
5. **`setAnimationLoop`, never manual rAF** (in R3F: handled by the Canvas).
6. Since three **r181** `render()`/`compute()` are synchronous; `renderAsync`/`computeAsync` are deprecated. Before r181: `await computeAsync()` before any dependent render.

## Essential TSL

NodeMaterial inputs: `colorNode`, `positionNode`, `normalNode`, `emissiveNode`, `castShadowNode`, `dispersionNode`, `transmissionNode`, `anisotropyNode`... Chainable type system, `uniform().onFrameUpdate(fn)`, `toVar/toConst/varying/vertexStage`, `hash/range` for deterministic random, atomics and workgroup barrier for compute (`instancedArray`, `storageTexture`, `workgroupArray` — shared memory 10-100x faster). Full method and node table: `webgpu-tsl-api.md`.

TSL post-processing (signatures): `bloom(node, strength, radius, threshold)`, `dof(node, viewZ, focusDistance, focalLength, bokehScale)`, `ssr`, `ssgi`, `traa`, `lut3D` — 25 effects total; see `webgpu-tsl-api.md`.

## Incremental migration

Do not rewrite: one scene at a time, behind a feature flag. Renderer chosen at runtime (WebGPU -> WebGL2 fallback), TSL materials written to degrade to WebGL2 NodeMaterial where possible. Breaking changes r170->r183 (PCFSoftShadowMap deprecated on WebGLRenderer in r182 -> PCFShadowMap; `colorBufferType` -> `outputBufferType` on WebGPU; TSL `PI2` -> `TWO_PI`; PBR indirect specular brighter in r181 -> reduce shadow bias in r183): full checklist in `three-migration-r170-r183.md`.
