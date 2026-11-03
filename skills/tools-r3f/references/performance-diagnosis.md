# Performance diagnosis — from symptom to cause

First tool, always: `renderer.info` (`render.calls`, `render.triangles`, `memory.geometries/textures`, `programs.length`). Do not optimize before reading these numbers. Target/warning/critical thresholds: quality-governance.md.

## Diagnostic flowchart

```
Low FPS?
+- draw calls > 200? --yes--> CPU-bound on submit: instancing/merge/BatchedMesh, fewer unique materials
|
+- triangles > 2M? --yes------> GPU vertex-bound: LOD, simplify, per-area frustum culling
|
+- programs.length high? -----> shader-variant explosion: unify materials, fewer dynamic defines
|
+- frame time ok but jank? ---> GC pauses: useFrame allocations, setState in the loop
|
+- memory counters growing? --> leak: missing dispose (geometry, material, 12-slot texture, render target)
|
+- JS heap grows? ------------> JS-side leak: listeners not removed, cache without eviction, circular refs
```

GPU-bound vs CPU-bound: drop DPR to 0.5 -> if FPS does not improve it is CPU/draw-call-bound; if it improves it is GPU/fill-bound (post-processing, overdraw, texture).

## Repeated geometry decision tree

- Few copies (< 100), same mesh: `MergedGeometry` (BufferGeometryUtils) if static, otherwise separate meshes
- > 100 copies: always `InstancedMesh` (or drei `<Merged>`/`<Instances>`)
- > 10,000 instances or different materials per instance: `BatchedMesh` (r159+)
- Frustum culling on InstancedMesh operates on the **whole group's bounding sphere**: split by area/zone, or culling never triggers

## Levers in cost/benefit order

1. Cut post-processing passes (zero cost, immediate benefit) — bloom at 0.5x res, SSAO off on mobile
2. Lower DPR (PerformanceMonitor / AdaptiveDpr)
3. Shadows: lower mapSize, fewer casters, `autoUpdate=false` on static scenes
4. LOD + per-area frustum culling
5. Instancing/batching/merge
6. Textures: KTX2, lower dimensions, selective anisotropy
7. Only as a last resort: rewrite geometry

## Raycasting

three-mesh-bvh (~100x on complex meshes), throttle hover to ~50ms (20fps is enough), filter via `layers`, GPU picking with `readRenderTargetPixels` for massive selection, Octree for capsule collision. In R3F: drei `Bvh` component, `raycast={() => null}` to exclude decorative meshes.

## Golden rule

Optimize for the worst device of the declared tier (mid Android for mobile, integrated GPU for desktop). "It runs at 120fps on my M4" is not a metric.
