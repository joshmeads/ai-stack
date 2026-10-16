# State management: the three-speed model

Zustand coordinates UI and scene. It must not become the channel that updates meshes at 60 FPS.

| Class | Examples | Where it lives | Frequency |
|---|---|---|---|
| Business state | Product configuration, permissions, workflow, API data, saveable selection | Domain store / server cache (TanStack Query) | Event-driven |
| UI state | Open modal, active panel, selected object, camera preset | Zustand | Low/medium |
| Transient 3D state | Rotations, lerps, pointer hover, time, particles, camera smoothing | `useRef`, `useFrame`, Three.js objects | Every frame |

## Per-domain store (slice pattern)

No giant `useAppStore`: one slice per bounded context, middleware applied where slices combine.

```ts
// src/features/scene/store/types.ts
export type QualityTier = 'low' | 'medium' | 'high'
export type CameraPreset = 'overview' | 'detail' | 'presentation'

export type SceneSlice = {
  selectedNodeId: string | null
  hoveredNodeId: string | null
  cameraPreset: CameraPreset
  qualityTier: QualityTier
  setSelectedNode: (id: string | null) => void
  setHoveredNode: (id: string | null) => void
  setCameraPreset: (preset: CameraPreset) => void
  setQualityTier: (tier: QualityTier) => void
}

export type UiSlice = {
  activePanel: 'overview' | 'details' | 'settings'
  inspectorOpen: boolean
  setActivePanel: (panel: UiSlice['activePanel']) => void
  setInspectorOpen: (open: boolean) => void
}

export type AppStore = SceneSlice & UiSlice
```

```ts
// src/features/scene/store/app-store.ts
import { create } from 'zustand'
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware'
import type { StateCreator } from 'zustand'
import type { AppStore, SceneSlice, UiSlice } from './types'

// Slices must declare the middleware they run inside, outermost first, or
// set(partial, replace, actionName) fails to typecheck (TS2554).
type Mw = [
  ['zustand/devtools', never],
  ['zustand/subscribeWithSelector', never],
  ['zustand/persist', unknown],
]

const createSceneSlice: StateCreator<AppStore, Mw, [], SceneSlice> = (set) => ({
  selectedNodeId: null,
  hoveredNodeId: null,
  cameraPreset: 'overview',
  qualityTier: 'medium',
  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }, false, 'scene/select'),
  setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }, false, 'scene/hover'),
  setCameraPreset: (cameraPreset) => set({ cameraPreset }, false, 'scene/cameraPreset'),
  setQualityTier: (qualityTier) => set({ qualityTier }, false, 'scene/qualityTier'),
})

const createUiSlice: StateCreator<AppStore, Mw, [], UiSlice> = (set) => ({
  activePanel: 'overview',
  inspectorOpen: false,
  setActivePanel: (activePanel) => set({ activePanel }, false, 'ui/setActivePanel'),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }, false, 'ui/setInspectorOpen'),
})

export const useAppStore = create<AppStore>()(
  devtools(
    subscribeWithSelector(
      persist(
        (...a) => ({ ...createSceneSlice(...a), ...createUiSlice(...a) }),
        {
          name: 'studio-3d',
          partialize: (state) => ({
            cameraPreset: state.cameraPreset,
            activePanel: state.activePanel,
            qualityTier: state.qualityTier,
          }),
        },
      ),
    ),
    { name: 'Studio 3D' },
  ),
)
```

`persist` is only for restorable preferences: never Three.js models, tokens, sensitive data or transient values.

## Narrow selectors

```tsx
// Good: re-render only when the selected node changes
const selectedNodeId = useAppStore((s) => s.selectedNodeId)

// Good: action, stable reference
const setSelectedNode = useAppStore((s) => s.setSelectedNode)

// Forbidden: subscribing to the whole store
const store = useAppStore()
```

For multiple fields, `useShallow` keeps a stable reference:

```tsx
import { useShallow } from 'zustand/react/shallow'

const { selectedNodeId, cameraPreset } = useAppStore(
  useShallow((s) => ({
    selectedNodeId: s.selectedNodeId,
    cameraPreset: s.cameraPreset,
  })),
)
```

## Store-scene bridge

The scene reads the target from the store, interpolates locally, and never writes to the store on every frame:

```tsx
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { useAppStore } from '../store/app-store'
import type { CameraPreset } from '../store/types'

const CAMERA_POSITIONS: Record<CameraPreset, THREE.Vector3> = {
  overview: new THREE.Vector3(0, 2, 8),
  detail: new THREE.Vector3(2, 1, 3),
  presentation: new THREE.Vector3(0, 0.5, 5),
}

export function SceneCamera() {
  const preset = useAppStore((s) => s.cameraPreset)
  const target = useRef(new THREE.Vector3())

  useFrame(({ camera }, delta) => {
    target.current.copy(CAMERA_POSITIONS[preset])
    camera.position.lerp(target.current, 1 - Math.exp(-5 * delta))
    camera.lookAt(0, 0, 0)
  })

  return null
}
```

The store changes only on preset change; motion happens in the R3F runtime. This is the correct way to connect React state to continuous animation.

## Imperative access

For high-frequency input (drag, controls, WebSocket, telemetry, scroll): vanilla API without subscribing React.

```ts
// Outside React or in high-frequency callbacks
useAppStore.getState().setSelectedNode(nodeId)

// React to one field with subscribeWithSelector
useAppStore.subscribe(
  (s) => s.selectedNodeId,
  (id) => telemetry.track('select', { id }),
)
```

Use `transient` updates for ephemeral per-frame values (hover scale, press state): mutate refs directly, no store write, no re-render.

## Anti-corruption: what never goes in the store

- Three.js objects, geometries, materials, textures — keep them in refs/module scope.
- Per-frame numeric state — use refs.
- Sensitive tokens or data — use TanStack Query / server cache.
- Anything you would not serialize to `JSON.stringify` cleanly.
