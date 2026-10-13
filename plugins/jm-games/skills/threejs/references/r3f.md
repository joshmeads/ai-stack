# react-three-fiber with WebGPURenderer

r3f v9 (9.8 in October 2026). Standard r3f practice (no `setState` in `useFrame`, `frameloop="demand"`, `<primitive>` is not auto-disposed) is assumed knowledge and left out.

## Setup

```tsx
import * as THREE from 'three/webgpu';
import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber';

declare module '@react-three/fiber' {
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}
extend(THREE); // registers node materials: <meshStandardNodeMaterial />

<Canvas
  gl={async (props) => {
    const renderer = new THREE.WebGPURenderer(props as any);
    await renderer.init();            // check renderer.backend.isWebGPUBackend here
    return renderer;
  }}
>
```

## WebGPU consequences inside r3f

- `RenderPipeline` works with r3f's loop, because three's internal rAF loop advances the node frame each browser frame. Render the pipeline in a `useFrame` with priority above 0; r3f then skips its own scene render.
- `frameloop="never"` with `advance()` for deterministic capture: pass nodes still advance only once per real browser frame, so several `advance()` calls in one frame reuse stale passes.
- `{on && <pointLight />}` changes the light set and recompiles every lit material on each toggle. Keep lights mounted and set `intensity={on ? 2 : 0}`.
- Changing `<instancedMesh args={[geometry, material, capacity]}>` recreates the mesh, and a new object or capacity compiles new pipelines. Allocate maximum capacity once and change `mesh.count`.
- Node materials built inline in JSX or recreated per render repeat node building and can compile new pipelines. Build TSL graphs in `useMemo` and drive them through uniform refs.
