# Canvas architecture (R3F enterprise)

The `<Canvas>` lives behind a client-side boundary, loaded lazily, with a functional 2D fallback. Mission-critical UI (data, forms, CTAs, navigation) stays in the DOM.

## Project structure

```
app/                      # Next.js routes
features/
  product/                # business UI (DOM)
  dashboard/
three/
  CanvasShell.tsx         # canvas config and capability detection
  scenes/                 # one scene per route/use case
  components/             # meshes, models, lights
  systems/                # input, animation, quality policy
  assets/                 # GLB, KTX2, HDR
  telemetry/              # fps, draw calls, GPU/error reporting
components/
  ThreeFallback.tsx       # HTML/SVG/static equivalent
```

One scene per route/use case, explicit lifecycle, clear asset ownership. Never a global Canvas that accumulates models, textures and event listeners across navigations.

## CanvasShell baseline

```tsx
'use client'

import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useState, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  // 'always' for games and anything animating every frame;
  // 'demand' for mostly static viewers (call invalidate() after changes).
  frameloop?: 'always' | 'demand'
}

export function CanvasShell({ children, frameloop = 'always' }: Props) {
  const [dpr, setDpr] = useState(1.5)

  return (
    <Canvas
      dpr={dpr}
      frameloop={frameloop}
      performance={{ min: 0.5, debounce: 250 }}
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: 'high-performance',
      }}
    >
      <PerformanceMonitor
        flipflops={3}
        onIncline={() => setDpr(Math.min(1.5, window.devicePixelRatio))}
        onDecline={() => setDpr(1)}
        onFallback={() => setDpr(1)}
      />
      {children}
    </Canvas>
  )
}
```

Choose `frameloop` by content, not by habit. With `frameloop="demand"` R3F renders
only after `invalidate()` or a prop change, and **`useFrame` callbacks do not run
between renders**, so a continuously animated component (like `Orb` below) stays
frozen. Games, character scenes and anything with a running loop use `"always"`.
A static product viewer uses `"demand"` and calls `invalidate()` from input
handlers and finished loads; for a short animation there, call `invalidate()` from
inside `useFrame` until it settles, then stop.

## Lazy + fallback

```tsx
'use client'

import dynamic from 'next/dynamic'
import { ThreeFallback } from '@/components/ThreeFallback'

const HeroScene = dynamic(() => import('@/three/scenes/HeroScene'), {
  ssr: false,
  loading: () => <ThreeFallback />,
})

export function HeroSection() {
  const reduced = usePrefersReducedMotion()
  if (reduced) return <ThreeFallback />
  return <HeroScene />
}
```

The fallback branch must also cover: no WebGL support, `prefers-reduced-motion`, `save-data`.

## State and animation: the correct loop

React orchestrates structure and slow state. `useFrame` updates Three.js references imperatively, independent of frame rate:

```tsx
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useRef } from 'react'

export function Orb({ active }: { active: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  const target = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    if (!ref.current) return
    target.current.set(active ? 0.35 : 0, 0, 0)
    ref.current.position.lerp(target.current, 1 - Math.exp(-8 * delta))
    ref.current.rotation.y += delta * 0.15
  })

  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1, 3]} />
      <meshStandardMaterial color="#D87946" roughness={0.3} />
    </mesh>
  )
}
```

Never call `setState()` inside `useFrame`, in fast intervals or in `pointermove`: it triggers useless React renders. Use refs, non-reactive store access, and `delta` for consistent velocity across refresh rates.

## Lifecycle and memory

GPU memory and the WebGL context are production resources:

- Manually created objects (render targets, geometries, materials, textures, post-processing, custom loaders) must be released with `.dispose()`. R3F manages declarative resources, not imperative ones.
- Do not mount/unmount heavy scenes during transitions or wizard steps: keep them mounted, use `visible`, pre-load and reuse assets. Shaders, materials, lights and buffers need compilation.
- Do not allocate `Vector3`, `Color`, materials, geometries or arrays in `useFrame`: reuse via `useRef`, `useMemo` or module scope to avoid GC pressure.
- Do not abuse `dispose={null}`: only when you have established the model is intentionally shared and the lifecycle is managed elsewhere.

## Adaptive rendering

An explicit QualityPolicy, not scattered `if`s across the scene:

```ts
type QualityTier = 'low' | 'medium' | 'high'

type QualitySettings = {
  dprMax: number
  shadows: boolean
  postprocessing: boolean
  textureLod: 'low' | 'mid' | 'high'
  particleCount: number
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low:    { dprMax: 1,   shadows: false, postprocessing: false, textureLod: 'low',  particleCount: 0 },
  medium: { dprMax: 1.5, shadows: false, postprocessing: false, textureLod: 'mid',  particleCount: 200 },
  high:   { dprMax: 2,   shadows: true,  postprocessing: true,  textureLod: 'high', particleCount: 600 },
}
```

During interaction (drag, orbit, scroll) temporarily reduce DPR, shadows and post-processing via `useThree().performance.regress()`. The call alone changes nothing: wire `performance.current` to real rendering decisions.

## Asset pipeline (summary)

- glTF/GLB is the standard format; every asset is a compiled artifact, not an export "as is".
- Clean meshes, UVs, standard PBR materials; strip unused nodes/animations/materials/textures.
- The bottleneck is almost always draw-call count, not triangles: reduce materials and textures per model.
- LOD: low for first paint, mid for normal use, high only on capable hardware.
- Draco/Meshopt for geometry, KTX2/Basis for textures. Pipeline: Blender -> `scripts/export_glb.py` -> gltf-transform -> validate -> CDN.
- `useGLTF` + gltfjsx for reusable JSX graphs; R3F caches by URL, so models are shareable across the tree.
- Nested `Suspense`: low-quality fallback first, then progressive upgrade.
- Repeated objects: `InstancedMesh` (or drei `<Merged>`/`<Instances>`), thousands of instances in one draw call.
