# Symptom to cause

Symptoms from real builds whose cause was not the obvious one. Dump the generated shader (`renderer.debug.getShaderAsync`) before guessing twice.

## Black, blank, or missing

| Symptom | Cause | See |
| --- | --- | --- |
| Canvas black after adding or changing a pass; sample count mismatch error | A pass nothing reads stays at 1 MSAA sample while a 4-sample pass shares its depth | `post-processing.md` |
| Captured WebGL frames black | Canvas read after an `await` | `testing-and-capture.md` |
| Value reads 0 on WebGPU, or WebGL throws `reading 'addToStack'` | Node shared across `If`/`select` branches without `.toVar()` | `tsl.md` |
| Nothing renders from a falloff | `smoothstep` with `e0 > e1` | `tsl.md` |
| Additive particles invisible | `premultipliedAlpha = true` on a premultiplying shader | `materials-and-output.md` |
| Custom-blended material drawn opaque | `transparent` not set with `CustomBlending` | `materials-and-output.md` |
| Instances collapse to the origin | `positionNode` built only from `positionGeometry` | `tsl.md` |
| WebGL2 compute writes only slot 0 | `instanceIndex` kernel on a non-instanced storage attribute | `webgpu-vs-webgl.md` |
| Compute texture read empty | `.sample()` on a non-filterable texture | `tsl.md` |
| Fade via `material.opacity` stopped working | `opacityNode` replaces it | `tsl.md` |
| Material MRT output ignored | `fragmentNode` set, or drawing to the canvas | `tsl.md` |
| WGSL `structures must have at least one member` | Material `mrtNode` in a pass without MRT (reflector) | `post-processing.md` |
| WGSL `textureSample ... no matching overload` | A sampled texture was never supplied | `tsl.md` |
| `Vertex output variable ... location (16) is too large` | Too many varyings | `tsl.md` |
| "Feedback loop formed" or texture usage error on depth | Material samples its own pass's depth | `post-processing.md` |
| Points are 1 px on WebGPU | WebGPU ignores point size | `webgpu-vs-webgl.md` |
| Stale post image in capture or benchmark | Several renders in one browser frame | `post-processing.md` |
| `No stack defined for assign operation` | `assign`/`If` outside `Fn()` | `tsl.md` |

## Wrong look

| Symptom | Cause | See |
| --- | --- | --- |
| Gradient wrong but identical on both backends | Chained `.mix()`/`.smoothstep()` argument order | `tsl.md` |
| Washed-out or double-gamma output | Custom tone map without `outputColorTransform = false` | `materials-and-output.md` |
| Fire looks peach, purple looks lilac | AgX tone mapping | `materials-and-output.md` |
| Blocky refraction | `FramebufferTexture` defaults to nearest filtering | `materials-and-output.md` |
| Clear glass is a dark shell or tints the background | Color in `colorNode` on transmission; use attenuation nodes | `materials-and-output.md` |
| Black half-shell or seams on glass | `DoubleSide` transmission, or grazing refracted UVs | `materials-and-output.md` |
| Rectangular bright blocks in AO, TRAA smears behind particles | Transparent objects writing MRT normals/velocity with `NoBlending` | `post-processing.md` |
| Instanced vertex animation draws streaks | Displacement derived from `positionLocal`, which varies per instance | `tsl.md` |
| Data texture lookups differ between backends | Float textures unfilterable on WebGL2; third `texture()` argument is mip level | `tsl.md` |

## Performance and backend

| Symptom | Cause | See |
| --- | --- | --- |
| Hitch when a light toggles | Light set is part of the lit pipeline key | `performance.md` |
| Hitch when streaming chunks | New `InstancedMesh` objects or capacities | `performance.md` |
| Hitch on first appearance despite `compileAsync` | Warm-up missed counts, culling, target format, post chain, or compute | `performance.md` |
| GPU time reads 85–240 ms on a smooth scene | `resolveTimestampsAsync` sums overlapping passes on Apple | `performance.md` |
| Headless fps exactly 30 | Headless rAF cap | `performance.md` |
| Benchmark impossibly fast | Pass nodes not re-rendering within one frame | `performance.md` |
| Upload cost every frame on idle buffers | `DynamicDrawUsage` under `WebGPURenderer` | `performance.md` |
| Memory grows when a buffer is resized | Old `InterleavedBuffer` not disposed before swap | `performance.md` |
| WebGPU branch runs on WebGL | `isWebGPURenderer` checked instead of `backend.isWebGPUBackend` | `api-and-versions.md` |
| False "no HDR" on WebGL | `hasFeature` with a raw extension name | `api-and-versions.md` |
| Null adapter on a Linux laptop | `powerPreference: 'high-performance'` on hybrid GPUs | `webgpu-vs-webgl.md` |
