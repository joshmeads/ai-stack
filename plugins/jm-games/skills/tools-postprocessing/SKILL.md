---
name: tools-postprocessing
description: Add or fix post-processing in a vanilla Three.js game that uses the pmndrs `postprocessing` package (EffectComposer, RenderPass, EffectPass, bloom, tone mapping, SMAA, vignette, chromatic aberration, depth of field). Use when a project depends on `postprocessing`, or when the user asks for bloom, glow, color grading, or screen effects in a plain Three.js project. Not for `three/addons/postprocessing` or React Three Fiber.
---

# pmndrs postprocessing in vanilla Three.js

## Check the installed version first

Read the project's `package.json` for the `postprocessing` and `three` versions,
then confirm class names and constructor options against the installed package
before writing code:

- `node_modules/postprocessing/README.md`
- the typings named by `types` in `node_modules/postprocessing/package.json`
  (for 6.39 this is `build/types/index.d.cts`)

The official docs are at https://pmndrs.github.io/postprocessing/ and
https://github.com/pmndrs/postprocessing/wiki. If an option below is missing
from the installed typings, follow the typings.

## Rules

1. **Import from `postprocessing`, never mix with `three/addons/postprocessing`.**
   Both export a class named `EffectComposer`; they are not interchangeable.
2. **Merge effects into one `EffectPass`.** Pass several effects to a single
   `new EffectPass(camera, effectA, effectB, ...)`. Each extra pass costs a
   full-screen draw; one pass per effect is the most common performance mistake.
3. **Set the renderer up for post-processing.** The README recommends creating
   the `WebGLRenderer` with `powerPreference: "high-performance"`,
   `antialias: false`, `stencil: false`, and `depth: false`, because the
   composer owns those buffers.
4. **Use a half-float frame buffer for HDR effects.** Bloom and tone mapping need
   values above 1: create the composer with `frameBufferType: HalfFloatType`.
5. **Render through the composer.** Replace `renderer.render(scene, camera)` with
   `composer.render(delta)` in the game loop, call `composer.setSize(w, h)` on
   resize, and `composer.dispose()` (plus effect disposal) on teardown.
6. **Choose the bloom method deliberately.**
   - Threshold bloom: `BloomEffect` with a `luminanceThreshold` near 1, and give
     glowing materials HDR emissive or color values above 1. Set
     `toneMapped = false` on materials that must glow past white.
   - Object-selected bloom: `new SelectiveBloomEffect(scene, camera, options)`
     (same options as `BloomEffect`), then `effect.selection.add(mesh)` for each
     glowing mesh. The selection works by putting objects on a dedicated render
     layer, so do not reuse that layer for anything else.
   Do not use the older layer-darkening technique from three.js examples.
7. **Tone map once, at the end.** Add `ToneMappingEffect` as the last effect in
   the final `EffectPass`, with its mode set explicitly (for example
   `new ToneMappingEffect({ mode: ToneMappingMode.AGX })`; the default is
   `ACES_FILMIC`), and confirm the renderer's own tone mapping is not also
   applied, or colors wash out or double-darken.
8. **Antialias in the composer.** With `antialias: false` on the renderer, add
   `SMAAEffect` to the final pass, or use the composer's `multisampling` option
   on WebGL2.

## Verify

Run the game, take a screenshot before and after the change, and check:
highlights are not clipped or banded, glowing objects bloom and nothing else
does, edges are antialiased, and frame time did not jump. Tone mapping
compresses whites on purpose: a pure white surface renders around 226/255 with
ACES, so judge brightness against the intended look, not against 255. Log `composer.passes.length`; for most
games it should be two (render pass plus one effect pass).
