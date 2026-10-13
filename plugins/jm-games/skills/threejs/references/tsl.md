# TSL and node materials

Verified on three r186. TSL builds a node graph in JavaScript that three compiles to WGSL or GLSL. Most bugs here come from the gap between how the JavaScript reads and the shader it generates.

## Control flow

**Mutations go inside `Fn()`.** `assign`, `addAssign`, `If`, and `Loop` outside `Fn()` throw `No stack defined for assign operation`.

**`If` chains as methods: `If(a, f).ElseIf(b, g).Else(h)`.** There are no standalone `Else`/`ElseIf` exports. `toVar` and `toVarying` are methods too.

**`.toVar()` a value before any branch if it is read both inside the branch and elsewhere.** TSL declares a shared subexpression where it is first built. If that is inside one branch, other reads get an unassigned variable: 0 on WebGPU, and on WebGL a build error `Cannot read properties of undefined (reading 'addToStack')`. Symptoms: effects render as squares, or vanish on one backend.

```js
mat.colorNode = Fn(() => {
  const r = length(uv().sub(0.5)).mul(2).toVar();   // shared: pin before branching
  const rgb = vec3(0).toVar();
  If(kind.lessThan(1.5), () => { rgb.assign(fire(r)); }).Else(() => { rgb.assign(smoke(r)); });
  return vec4(rgb, 1);
})();
```

**`select(cond, a, b)` compiles to if/else and has the same problem.** `.toVar()` shared inputs first, or choose with `mix(b, a, select(cond, float(1), float(0)))`. A mix evaluates both sides, so a NaN on the unused side still propagates.

**Uniform-gated `If` beat a branch-free uber shader.** Computing every feature and multiplying unused ones by 0 cost 19.8 ms GPU against 12.6 ms with `If` gating. A second MRT output that branches write must be an outer var placed first with `Stack(v)`:

```js
const distortion = vec4(0).toVar('vfxDistortion');
const color = Fn(() => {
  Stack(distortion);
  const n = float(0.5).toVar();
  If(featureOn.notEqual(0), () => { n.assign(texture(noiseTex, uv()).r); });
  return vec4(shade(n), 1);
})();
```

**A JavaScript loop that builds nodes inlines every iteration.** An 8-step bisection grew a vertex shader past 500 KB and crashed the WebGPU tab. Use TSL `Loop` or a closed form.

## Argument-order traps

- Chained `.mix()` uses the receiver as the weight: `t.mix(a, b)` is `mix(a, b, t)`. Chained `.smoothstep()` likewise: `x.smoothstep(lo, hi)` is `smoothstep(lo, hi, x)`. A noise generator written as `a.mix(b, t)` was wrong and still matched across both backends. Prefer the free functions.
- `smoothstep(e0, e1, x)` with `e0 > e1` is undefined in WGSL/GLSL and rendered nothing. Write `float(1).sub(smoothstep(lo, hi, x))`.
- `texture(tex, uv, level, bias)`: the third argument is the mip level. Passing a row index there caused a backend mismatch. Read tables with `textureLoad(tex, ivec2(x, y))`.
- `atan(y, x)` is the two-argument form; there is no `atan2` export. `PI2` is deprecated; use `TWO_PI`.

## Textures

- 32-bit float textures are not linearly filterable on WebGL2. Interpolate data tables yourself with two `textureLoad`s and `mix`, and keep `NearestFilter` and `generateMipmaps = false`.
- `Data3DTexture` needs `texture3D()`. `DataArrayTexture` layers are selected with `texture(arr, uv).depth(layer)`. Add `.level(0)` when sampling in the vertex stage so GLSL and WGSL agree.
- Inside non-uniform branches, compute gradients before the branch and sample with `texture(t, uv).grad(dx, dy)`.
- In compute, `texture(t).sample(uv)` compiles to an explicit level-0 sample and needs a filterable texture. Use `textureLoad` for float data. One mask read empty through `.sample()` and worked with `textureLoad`.
- WGSL `textureSample ... no matching overload` usually means a texture the graph samples was never supplied.
- MaterialX noise (`mx_noise_float`, `mx_worley_noise_float`, `mx_fractal_noise_float`) is in core TSL.

## Vertex stage

**`positionNode` is local space before model-view-projection; `vertexNode` replaces the whole clip-space output.** Billboards:

```js
const viewCenter = cameraViewMatrix.mul(vec4(worldPos, 1));
material.vertexNode = cameraProjectionMatrix.mul(vec4(viewCenter.xy.add(offset), viewCenter.z, 1));
```

**On an `InstancedMesh`, three applies the instance matrix first, then assigns your `positionNode` to `positionLocal`.**
- `positionLocal` inside `positionNode` already includes the instance transform. Build from it: `positionLocal.add(offset)`.
- A `positionNode` built only from `positionGeometry` (the raw vertex) drops the instance transform, and all instances collapse to the origin.
- Functions of `positionLocal`, such as `sin(positionLocal.x)`, vary with instance location; an instanced wiggle built that way drew streaks across the scene. Compute the displacement amount from `positionGeometry` and per-instance attributes, then add it to `positionLocal`.

**WebGPU allows 16 inter-stage locations and TSL gives every varying its own.** Error: `Vertex output variable ... has a location (16) that is too large`. Pack scalars: `varying(vec4(age, seed, alpha, erosion), 'vPacked')`. A `.toVar()` referenced by a varying can drag attributes and texture reads into extra varyings.

**A custom `normalNode` built from geometry normals ignores back-face flipping.** Fix inverted winding when generating the geometry.

## Properties that replace each other

- `opacityNode` replaces `material.opacity`, so fades through `.opacity` stop working. Use `material.opacityNode = materialOpacity.mul(mask)`.
- `mrtNode` is used only on the default output path and only while rendering into a render target. It is ignored when `fragmentNode` is set and when drawing to the canvas. With no pass-level MRT bound, the material MRT is used alone, and names the target cannot match produce an empty output struct (see the reflector case in `post-processing.md`). Use `colorNode`, or `outputNode` plus `mrtNode`.

## Uniforms

- Pipelines are cached by generated shader source. Rebuilding a graph repeats node building every time and compiles a new pipeline whenever the generated code differs. Change `uniform(...).value` instead.
- `uniform(camera.near).onRenderUpdate(() => camera.near)` refreshes a uniform automatically each render.
- Per-frame uniforms: keep a persistent vector and mutate it (`const v = new Vector2(); const clock = uniform(v).x;`, then `v.x = t`). Allocation fell from about 125 KB to 1.4 KB per 10k updates compared with assigning a new scalar `.value`.
- `screenUV` has a top-left origin on both backends. From NDC: `u = x * 0.5 + 0.5`, `v = 0.5 - y * 0.5`.

## Debugging

- `renderer.debug.getShaderAsync(scene, camera, mesh)` returns the generated shaders.
- `Node.captureStackTrace = true` (`Node` from `three/webgpu`) records which TSL line built each node.
