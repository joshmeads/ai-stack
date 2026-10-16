# Performance

Numbers come from Apple M3 Pro and RTX 5080 runs on three r186. They show the size of an effect, not targets.

## Measuring frame time

**`renderer.resolveTimestampsAsync('render')` is not frame time.** On Apple GPUs it sums overlapping pass intervals: about 18 passes read 85–240 ms for frames that took 8–20 ms. On NVIDIA it read about 0.3 ms for 4–7 ms frames. Decisions made from these numbers were wrong.

**Headless Chrome on macOS caps rAF near 30 Hz**, even on an empty page; every toggle read exactly 30.0 fps.

**WebGL2 on ANGLE-Metal has no usable GPU timer.**

**Fenced batch method:**

```js
const N = 40;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  renderer._nodes.nodeFrame.update(); // private API; without it, pass nodes reuse their first result
  renderFrame();
}
await renderer.backend.device.queue.onSubmittedWorkDone();
const msPerFrame = (performance.now() - t0) / N;
```

Without `nodeFrame.update()`, `PassNode`s and bloom render once per browser frame, so a tight loop measures almost nothing (1.79 ms per frame read, 10.05 ms real). `_nodes` is private; recheck it after upgrades.

**`renderer.info`:** `render.drawCalls` counts draws and `calls` counts `render()` invocations. It auto-resets each animation frame. To sum across several manual renders, set `info.autoReset = false` and call `info.reset()` once per frame.

`performance.now()` resolution is 100 µs unless the page is cross-origin isolated (about 5 µs). A Playwright `page.route` can add COOP/COEP headers for benchmarks.

## Measured surprises

- Depth of field, GTAO, and screen-space reflections each cost more than bloom, lens flare, grading, grain, chromatic aberration, FXAA, and sharpen combined; that whole display stack held 60 fps at 1080p. Disabling DOF alone took a game from 55–57 to 60 fps.
- Transparent `DoubleSide` materials draw twice (back faces, then front faces) unless `material.forceSinglePass = true`.
- A fixed pool of four point lights cost about 2–3% GPU on WebGPU.

## Shader compile stutter

A first draw with a new material, geometry layout, light set, or render-target format compiles a pipeline: 100–1000 ms hitches (one first frame took 969 ms).

**Causes during play that are easy to miss:**
- Light set changes. Lit pipelines are keyed on light ids and `castShadow`. Keep a fixed light pool and park unused lights at intensity 0.
- New `InstancedMesh` objects or changed capacity. The render-object cache is keyed on object identity and capacity shapes the layout; new meshes per streamed chunk caused 66 ms frames. Allocate maximum capacity once and change `.count`.
- Rebuilt node graphs whose generated source differs.

**Warm-up that actually covers play:**
1. Set instanced meshes to `count = 1`. A count of 0 skips the draw and the compile.
2. Disable frustum culling or use a camera that sees everything; culled objects are not compiled.
3. Render through the real post chain into targets of the real format, for example `new RenderTarget(4, 4, { type: HalfFloatType, samples: 0 })`. A different format compiles again on the first real frame.
4. Wait one `requestAnimationFrame` between renders, because pass nodes re-render once per browser frame.
5. Warm compute separately with `compileComputeAsync(node)` or one `computeAsync()`.
6. Restore counts, culling, and targets, render once more, and do not change camera layers during warm-up.

`renderer.compileAsync(scene, camera)` alone left 53 pipelines compiling after init in one build.

**Count late pipelines and fail tests on any** (there is no public compile callback, and `renderer.info` totals do not say when a compile happened):

```js
await renderer.init();
const backend = renderer.backend;
let warm = false, late = 0;
for (const name of ['createProgram', 'createRenderPipeline', 'createComputePipeline']) {
  const original = backend[name];
  if (typeof original !== 'function') continue;
  backend[name] = (...args) => { if (warm) late++; return original.apply(backend, args); };
}
// warm up, then: warm = true; play; assert late === 0
```

## Buffers and instancing

- With `WebGPURenderer` (either backend), `DynamicDrawUsage` uploads the attribute on every render whether it changed or not: the pending update ranges if any, otherwise the whole buffer. Classic `WebGLRenderer` uploads only on a version change. For sparse writes, keep `StaticDrawUsage`:
  ```js
  attr.clearUpdateRanges();
  attr.addUpdateRange(firstDirty * itemSize, (lastDirty - firstDirty + 1) * itemSize);
  attr.needsUpdate = true;
  ```
  `addUpdateRange` allocates an object per call, and ranges pile up if nothing renders.
- `InstancedBufferGeometry.instanceCount` defaults to `Infinity`. Always set it.
- GPU buffers are keyed on `attribute.data`. Call `geometry.dispose()` before swapping in a larger `InterleavedBuffer`, or the old buffer leaks.
- GPU-driven draw counts on WebGPU: `geometry.setIndirect(new IndirectStorageBufferAttribute(...))` with a compacted alive list. WebGL2 has no indirect draws; draw full capacity and collapse dead instances in the vertex shader.
- Moving a uniform write from a new scalar `.value` to a mutated persistent vector cut allocation sharply (see `tsl.md`).
