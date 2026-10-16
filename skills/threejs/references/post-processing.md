# Post-processing with RenderPipeline

For `WebGPURenderer` on three r186.

## Basic shape

```js
import { RenderPipeline } from 'three/webgpu';                 // PostProcessing before r183
import { pass, mrt, output, velocity, convertToTexture } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const pipeline = new RenderPipeline(renderer);
const scenePass = pass(scene, camera);                    // half-float target; color texture is 'output'
scenePass.setMRT(mrt({ output, velocity }));              // only if something reads velocity
const color = scenePass.getTextureNode('output');
pipeline.outputNode = color.add(bloom(color, 0.2, 0.1, 1.0));
renderer.setAnimationLoop(() => pipeline.render());
```

r186 factory signatures (grep the installed addon before relying on them):
- `bloom(node, strength, radius, threshold)`
- `ao(depthNode, normalNode, camera)`
- `traa(beautyNode, depthNode, velocityNode, camera)`
- `dof(node, viewZNode, focusDistance, focalLength, bokehScale)`
- `chromaticAberration(node, strength, center, scale)`
- `lensflare(node, params)`: `params` values must be nodes
- `fxaa(node)`

Notes:
- Nodes that need a texture input call `convertToTexture`. A pass texture passes through unchanged; a computed expression gets its own hidden render-to-texture pass.
- `getTextureNode('name')` creates an extra MRT attachment. A pass MRT without `output` blanks the color.

## Pass nodes advance once per browser frame

`renderer.init()` starts an internal rAF loop that advances the node frame once per browser frame, with or without `setAnimationLoop`. A `PassNode` renders its scene once per node frame, so several `pipeline.render()` calls within one browser frame reuse the first result. For warm-up and capture, wait a frame between renders:

```js
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
await nextFrame(); pipeline.render();
```

## Black canvas: MSAA sample mismatch

three runs `setup()` only on `PassNode`s whose texture some output reads. A pass nothing reads keeps 1 MSAA sample; if a 4-sample pass shares its depth, WebGPU fails validation every frame (`depth stencil attachment ... sample count (1) does not match`) and the canvas is black. If your pass renders another pass or shares its depth, call that pass's `setup(builder)` from yours. Debug probes that change what the output reads can trigger this.

## A material cannot sample its own pass's depth

WebGPU rejects the usage; WebGL reports "Feedback loop formed". Copy depth to an R32F target once per frame:

```js
const depthCopy = new RenderTarget(w, h, { type: FloatType, format: RedFormat, depthBuffer: false,
  minFilter: NearestFilter, magFilter: NearestFilter });
const copyMaterial = new NodeMaterial();
copyMaterial.colorNode = vec4(texture(scenePass.getTextureNode('depth'), screenUV).r, 0, 0, 1);
const quad = new QuadMesh(copyMaterial);
const prev = renderer.getRenderTarget();
renderer.setRenderTarget(depthCopy); quad.render(renderer); renderer.setRenderTarget(prev);
```

## MRT and transparent objects

- Per-material MRT outputs other than color default to `NoBlending`. Transparent objects then overwrite velocity and normals, causing TRAA smears and rectangular bright blocks in GTAO. Use material blending:
  ```js
  import { BlendMode, MaterialBlending } from 'three/webgpu';
  material.mrtNode = mrt({ velocity: vec4(0) }).setBlendMode('velocity', new BlendMode(MaterialBlending));
  ```
- Blend modes and clear colors for pass outputs go on the pass MRT: `pass.setMRT(mrt({...}).setBlendMode('name', blend).setClearColor('name', 0x000000, 0))`.
- A material with `mrtNode` fails in passes without MRT, such as a reflector's virtual render: WGSL `structures must have at least one member`. Keep it off the reflection layer, or set the MRT only when one is bound:
  ```js
  class FxMaterial extends NodeMaterial {
    passMrt = null;
    setup(builder) {
      this.mrtNode = builder.renderer.getMRT() !== null ? this.passMrt : null;
      return super.setup(builder);
    }
  }
  ```
- If transparents still corrupt normals, drop the normal MRT and let GTAO reconstruct normals from depth: `ao(scenePass.getTextureNode('depth'), null, camera)`.

## GTAO

- `aoPass.useTemporalFiltering = true`, and remap faint AO: `smoothstep(0.3, 0.9, aoPass.getTextureNode().r)`.
- GTAO needs a single-sample depth texture.

## ReflectorNode

- The virtual camera copies the main camera's layers. Exclude objects from reflections with:
  ```js
  camera.layers.enable(1); rain.layers.set(1);
  reflection.reflector.getVirtualCamera(camera).layers.disable(1);
  ```
  Excluding minor and distant objects cut peak triangles from 21M to 7.7M.
- `getDepthNode()` throws unless the reflector was created with `{ depth: true }`. The oblique near plane makes `perspectiveDepthToViewZ` on reflector depth wrong.

## Transparent overlay passes

A pass clear paints `scene.background`. To render a pass onto transparent black, set `scene.background` and `scene.backgroundNode` to null and the clear color to (0, 0, 0, 0) for that pass, and restore them in `finally`.
