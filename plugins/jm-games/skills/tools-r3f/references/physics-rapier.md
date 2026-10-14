# Physics — Rapier in production

Honest premise: a 3D hero almost never needs physics. If it does (a configurator with physical drag, playful scenes, stackable objects), the production choice is **Rapier**.

## Engine decision tree

| | Rapier | cannon-es |
|---|---|---|
| Use | production | prototyping |
| Bodies | 100 - 10,000+ | < 100 |
| Determinism | yes | no |
| CCD | yes | no |
| Weight | ~300-600KB WASM, async init | ~100KB, sync init |

Rule: always Rapier in production; cannon-es only for throwaway prototypes.

## @react-three/rapier setup

```tsx
<Physics timeStep="vary" interpolate updatePriority={-50}>
  <RigidBody colliders="cuboid">...</RigidBody>
</Physics>
```

`timeStep="vary"` follows the framerate (smooth); `"vary"` + `interpolate` avoids judder. `updatePriority={-50}` = physics before render (see priority rules in anti-patterns.md). For determinism: `timeStep={1/60}`.

## Verified gotchas (all from real review)

1. **Rapier returns a plain `{x, y, z}`**: NEVER `mesh.position.copy(body.translation())` — always `mesh.position.set(pos.x, pos.y, pos.z)`. (cannon-es is instead compatible with `.copy()`, another reason not to mix the two worlds.)
2. **`colliders="trimesh"` ONLY for static bodies.** Dynamic concave -> `convexHull`. Dynamic trimesh = unstable and very slow.
3. **`world.step()` takes no arguments in Rapier** (internal fixed 1/60); in cannon it is `world.step(fixed, delta, maxSubSteps=3)`.
4. **CCD** for fast bodies (projectiles, fast drag): `.setCcdEnabled(true)` — otherwise tunneling through colliders.
5. **WASM is not GC-managed**: with raw rapier ALWAYS `world.free()` and `eventQueue.free()` in cleanup. @react-three/rapier manages its instance cleanup, but watch for multiple instances / HMR.
6. Collision events: `EventQueue` with `drainCollisionEvents` / `drainContactForceEvents` — drain on every step, never accumulate.
7. Sensors for trigger zones (no physical response): `sensor` + `onIntersectionEnter`.
8. Character controller: kinematic body + `useRapier` world access; do not reinvent with a dynamic body + constraints.

## Integration with our stack

Physics is a source of physical state: it lives inside the Canvas, never in the Zustand store. If a physics event must reach the UI (score, game state), pass it through the bridge's semantic commands (state-management.md), throttled or on-change, never per-frame. Bodies leaving the world: clean up by removing the `RigidBody`, do not let them fall forever (they simulate forever).
