# Anti-patterns — WRONG / WHY / CORRECT

Each entry has a code-review tell (how you spot it in review), why it is wrong, and the fix. Merged from public R3F/Three.js best-practice references and field-tested review notes. See CREDITS.md for sources.

## React loop and state

**`setState` or store update inside `useFrame`** — WHY: React re-render at 60fps, the loop dies. CORRECT: ref + mutation + `delta`; intents via the store bridge (see state-management.md).

**Per-frame allocations** (`new Vector3()`, `new Color()`, arrays, objects in the loop) — WHY: GC pauses = jank. CORRECT: reuse objects via ref/useMemo/module scope.

**Frame-count-based animations** (`rotation.y += 0.01`) — WHY: at 144Hz it runs 2.4x faster than at 60Hz. CORRECT: always `delta` time; damping `1 - Math.exp(-lambda * delta)`.

**Polling the outside world with `setInterval` + `setState`** — WHY: per-frame re-render, the opposite of the transient pattern. CORRECT: `useFrame` + imperative subscribe; if you need a real ECS, this is not a 3D hero (wrong domain).

**`useFrame(cb, priority > 0)` without knowing it disables automatic rendering** — WHY: black screen if no subscriber calls `gl.render`. CORRECT: priority is only for ordering (physics -100, camera follow +100); the last subscriber renders.

**Mutations in `frameloop="demand"` without `invalidate()`** — WHY: they never appear on screen. CORRECT: call `invalidate()` after every mutation. To pause a per-frame effect, early-return inside `useFrame` (`if (!active) return`) or unmount the component; `useFrame`'s second argument is a numeric render priority, not an on/off switch. Games that animate continuously should use `frameloop="always"` instead.

## R3F structure

**`args` that change identity** (`args={[new ...]}` inline) — WHY: recreates the Three.js object on every render. CORRECT: stable args, or props on an existing object.

**Mount/unmount of heavy scenes during transitions** — WHY: recompiles shaders, reloads assets. CORRECT: `visible` + asset reuse, `dispose={null}` if managed elsewhere.

**Per-frame raycast over the whole scene** — WHY: O(n) on complex meshes. CORRECT: a small array of interactables, `raycast={() => null}` to exclude, drei `Bvh`/`meshBounds`, invisible collision proxy meshes.

**`OrbitControls` in production** — WHY: looks like a demo. CORRECT: camera scroll-driven or rig driven. In dev: always set `makeDefault` on controls (without it, R3F events break).

**`TransformControls` without disabling OrbitControls during drag** — WHY: drag is impossible. CORRECT: drei handles it if both have `makeDefault`.

**`ContactShadows` with `frames={Infinity}` by default** — WHY: renders every frame for nothing. CORRECT: `frames={1}`, or `Infinity` only if the scene actually moves.

## Post-processing and color pipeline

**`GammaCorrectionShader` as the final pass** — WHY: with `outputColorSpace = SRGBColorSpace` (r152+) it is double gamma -> washed colors. CORRECT: `OutputPass` (r154+), or `<ToneMapping>` last in pmndrs.

**AA before effects** — WHY: antialiases bloom halos. CORRECT: composer MSAA (`multisampling`) or SMAA **after** effects.

**`renderer.render()` + `composer.render()` together** — WHY: double render per frame. CORRECT: only the composer.

**Bloom without tone mapping / without HalfFloatType** — WHY: HDR clamped, bloom invisible or blown-out. CORRECT: `frameBufferType={HalfFloatType}`, ToneMapping last.

**`composer.setSize` forgotten on resize** — WHY: wrong blur/post after resize. CORRECT: R3F handles it; vanilla -> resize handler that updates composer + FXAA uniform + bloom resolution.

**Composer never disposed** — WHY: render-target leak. CORRECT: dispose in cleanup.

**`logarithmicDepthBuffer` with post-processing** — WHY: incompatible with depth-based passes (SSAO/DoF). CORRECT: tight near/far ratio.

## Materials and textures

**`metalness > 0` without an environment map** — WHY: black blobs. CORRECT: `<Environment>` always before metallic materials.

**sRGB on normal/roughness/metalness/AO maps** — WHY: broken shading. CORRECT: sRGB only on albedo/emissive.

**`geometry.setAttribute('uv2', ...)`** — WHY: dead since r151. CORRECT: `uv1`, or `texture.channel = 1` (r152+).

**`material.needsUpdate = true` every frame** — WHY: continuous shader recompilation. CORRECT: only when a define changes; for dynamic uniforms use `onBeforeCompile` + `userData.shader.uniforms`.

**`transparent` where `alphaTest` suffices** — WHY: sort issues, halos. CORRECT: `alphaTest: 0.5` for cutouts.

**Importing `ContactShadows` from `three/examples`** — WHY: it does not exist, it is a drei component. Error seen in public skills: do not propagate it.

## Performance and assets

**1000 single meshes instead of instancing/batching** — WHY: draw-call explosion. CORRECT: > 100 copies always InstancedMesh; > 10k with spatial subdivision or `BatchedMesh` (r159+); frustum culling on InstancedMesh operates on the whole group's bounding sphere -> split by area.

**Uncompressed GLB / Draco and Meshopt together** — WHY: 5-10x weight; KHR_draco and EXT_meshopt are mutually exclusive (even via gltfpack). CORRECT: pick one; pipeline in model-optimization.md.

**Uncapped DPR** — WHY: 4x pixels on retina for zero perceived gain. CORRECT: `dpr={[1, 1.5]}`, 2 only on high tier.

**Shadows on PointLight on mobile** — WHY: 6x cost per light. CORRECT: fake contact shadow with a gradient plane.

**`shadowMap.type` changed after the first render** — WHY: no effect / crash. CORRECT: decide up front.

**Three.js objects in Zustand `persist`** — WHY: impossible serialization, zombie state. CORRECT: `partialize` only preferences (quality tier, muted, motion reduction).

## Physics (Rapier)

**`mesh.position.copy(body.translation())`** — WHY: Rapier returns a plain `{x,y,z}`, `.copy()` fails silently or loses precision. CORRECT: `.set(pos.x, pos.y, pos.z)` (or `useRapier` hooks).

**`colliders="trimesh"` on dynamic bodies** — WHY: unstable and very slow. CORRECT: trimesh only for static bodies; dynamic concave -> `convexHull`.

**WASM never freed** (raw rapier) — WHY: WASM is not GC-managed = guaranteed leak. CORRECT: `world.free()` and `eventQueue.free()` in cleanup.

## Rendering diagnostics: symptom -> cause -> fix

| Symptom | Likely cause | Fix |
|---|---|---|
| Black screen | Missing envMap on metal; camera inside near plane; composer+renderer double render | Environment; near 0.1; composer only |
| Washed/faded colors | Double gamma; missing tone mapping with physical lights | OutputPass; ToneMapping last |
| Z-fighting | Coplanar planes | `polygonOffset`, offset 0.001, tight near/far |
| Bad transparency sorting | `transparent` on cutouts | `alphaTest`; `depthWrite: false` consciously |
| Banding on normal maps | ETC1S on normals | UASTC for normal maps only |
| Invisible bloom | Threshold > emissive, or LDR buffer | HalfFloat, `toneMapped={false}` on emissive |
| FPS drops after minutes | Leak: counters growing | Dispose audit (12-slot texture) |
| Black shader after refactor | Program cache with `onBeforeCompile` | `material.customProgramCacheKey` |
