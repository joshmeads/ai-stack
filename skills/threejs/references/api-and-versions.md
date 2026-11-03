# API names and versions

Verified against three r186.1 source unless a line names another version.

## Imports

- `three/webgpu`: `WebGPURenderer`, node materials, `RenderPipeline`, `Node`, `BlendMode`, `RenderTarget`, `QuadMesh`, storage attributes.
- `three/tsl`: TSL functions, including `output` (a real export, used as `mrt({ output, ... })`, despite notes claiming it is missing).
- `three/addons/tsl/display/<Name>.js`: post nodes.
- `three` and `three/webgpu` share `three.core.js`, so core classes such as `PointLight` are the same objects from either entry point.
- pmndrs `postprocessing` and `EffectComposer` work only with `WebGLRenderer`.

## Renames and removals, r180–r186

| Old | New | Since |
| --- | --- | --- |
| `renderAsync`, `clearAsync`, `hasFeatureAsync`, `initTextureAsync` | `await renderer.init()` once, then the sync method | r181 (deprecated) |
| `renderer.waitForGPU()` | Removed (logs an error). For a completion fence, await a readback or, on WebGPU, `renderer.backend.device.queue.onSubmittedWorkDone()`. `computeAsync()` only awaits `init()` and submits; it does not wait for the GPU | r181–r186 |
| `PostProcessing` | `RenderPipeline` | r183 (old name warns) |
| `getColorBufferType()` | `getOutputBufferType()` | r182 |
| `PI2` | `TWO_PI` | r181 |
| `atan2(y, x)` | `atan(y, x)` | no `atan2` export |
| `ReflectorNode` `resolution` | `resolutionScale` | r180 |
| `addNodeElement` | removed | gone in r186 |

## Backend detection

```js
const renderer = new WebGPURenderer({ antialias: false });
await renderer.init();
const isWebGPU = renderer.backend.isWebGPUBackend === true;
```

- `renderer.isWebGPURenderer` is true even on the WebGL2 fallback.
- A failed WebGPU init replaces `renderer.backend`. Read or wrap backend methods only after `init()`.
- `forceWebGL: true` forces the WebGL2 backend for testing.
- On WebGL, `hasFeature()` only understands three's mapped names such as `'timestamp-query'`. `hasFeature('EXT_color_buffer_float')` returns false even when the extension exists, which produced a false "no HDR" result. Use `renderer.getContext().getExtension(...)`.

## Typings gaps in `@types/three` 0.186

The runtime is right; cast at the call site.

- TSL generics reject many valid mixed `vec`/`float` expressions. One workable approach is an untyped re-export of TSL for shader files.
- `Node` is exported from `three/webgpu`, not `three/tsl`.
- `dof`, `fxaa`, `film`, and `traa` results are not assignable to `Node<'vec4'>`. `TRAANode.getTextureNode` exists at runtime but not in the types.
- `ao(depth, null, camera)` needs a cast for `null`. `Fn(...).compute(...)` is mistyped. `backend.isWebGPUBackend` is untyped.
- `MeshStandardNodeMaterial` is not assignable to `MeshStandardMaterial`.

## Geometry utilities

`mergeGeometries` requires every input to be indexed or every input non-indexed. `RoundedBoxGeometry` is non-indexed, so convert the other pieces with `toNonIndexed()`.

## r180-only bugs

Fixed or changed by r186; relevant only if a project is pinned to r180:

- Instance matrices went into a uniform buffer when count ≤ 1000, assuming a 64 KB limit. Some Chrome WebGL2 contexts allow 16 KB, so a 512-instance batch failed. Use capacity > 1000 to force the attribute path.
- A shader error during WebGPU `compileAsync` could hang forever; the pipeline promise had no reject path.
- Changing `minFilter`/`magFilter` on a live WebGPU texture did not rebuild its sampler. Set filters before first use.
- Geometry uploads ran before node updates, so a freshly spawned `StaticDrawUsage` instance drew one frame with stale matrices.
- Disposing a compute node kept its storage buffers. Free them with `renderer.backend.destroyAttribute(attr)` when `renderer.backend.has(attr)`.
- `compileAsync` ran `updateBefore` hooks with no framebuffer bound, and `viewportTexture` copies crashed WebGL2 there. Skip framebuffer copies during warm-up.
- `viewportSharedTexture` used an 8-bit copy target, and copying from a half-float HDR target failed. Use `viewportTexture` with a half-float `FramebufferTexture`.
