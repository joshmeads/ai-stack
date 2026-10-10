# Polish chain — from a correct scene to an award-level experience

The order is non-negotiable: **lighting/HDRI -> tone mapping -> hero materials -> post chain -> motion -> grain -> audio**. Each step assumes the previous one. Skipping the order produces a "tech demo" look.

## 1. Lighting

Physical units (three r160+, `useLegacyLights=false` by default): DirectionalLight in lux (sun 50,000-100,000), PointLight in candela (~1700 for a 100W bulb, `power = intensity * 4pi`), SpotLight ~10,000 cd (`power = intensity * pi`), RectAreaLight in nits. Hard rule: **physical intensities require active tone mapping**, otherwise everything burns.

Light budget: mobile 3-4 lights / 1 shadow caster; desktop 8-16 lights / 2-3 shadows. PointLight with shadows **never on mobile**: shadow draw calls are `objects * 6 * point lights` (100 objects + 2 PointLights = 1200 shadow draw calls). Even with HDRI, keep one DirectionalLight for the shadow direction.

Shadow tuning: `mapSize` 2048 (tier: 512 mobile -> 4096 hero desktop), `bias: -0.0001`, `normalBias: 0.02`, `radius` widens the `PCFShadowMap` filter (1 = default, 2-4 = softer edges; it has no effect with `BasicShadowMap`). The first quality lever: tighten the shadow camera's orthographic frustum to the minimum necessary. Static scene: `shadowMap.autoUpdate = false` and `shadowMap.needsUpdate = true` only when something changes. Gotcha: `light.target` must be added to the scene; `shadowMap.type` is not changeable after the first render.

Fake shadows where they suffice: drei `ContactShadows` (with `frames={Infinity}` **only** when needed — otherwise it renders every frame for nothing), `AccumulativeShadows` + `RandomizedLight` (`temporal frames={100}`) for a studio look.

## 2. IBL / HDRI

`scene.environment` is the single most impactful change: drei `<Environment preset="city">` runs PMREM internally. For controlled studio highlights: `<Lightformer>` inside `<Environment>`. Scene controls: `backgroundBlurriness` (0-1), `backgroundIntensity`, `backgroundRotation`. Non-negotiable rule: **`metalness > 0` without envMap = black blob**. Prefer compressed HDRI (KTX2/EXR half-float) over `.hdr` RGBE. Vanilla under the hood: `pmremGenerator.fromEquirectangular(tex).texture`, then `tex.dispose()` and `pmremGenerator.dispose()`.

## 3. Tone mapping

R3F v9 default: `ACESFilmicToneMapping` + sRGB output — do not touch. Alternatives: AgX (r160+, cleaner highlights, more modern look), Neutral (r162, color fidelity for UI/product). Structural rule: the post chain works in HDR, tone mapping closes it. With `@react-three/postprocessing`: leave the renderer without tone mapping (`flat` or the composer default) and put `<ToneMapping>` as the **last** effect.

## 4. Post chain (@react-three/postprocessing)

There are three **incompatible** systems — never mix them (different buffer formats): the built-in `EffectComposer` of three, `postprocessing` by pmndrs (what `@react-three/postprocessing` uses), and `PostProcessing` WebGPU/TSL. In R3F v9 the production choice is pmndrs.

Canonical setup:

```tsx
<EffectComposer multisampling={4} frameBufferType={HalfFloatType}>
  <Bloom mipmapBlur intensity={0.45} luminanceThreshold={0.82} luminanceSmoothing={0.4} />
  <Vignette eskil={false} offset={0.3} darkness={0.6} />
  <Noise opacity={0.05} />
  <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
</EffectComposer>
```

`multisampling={4}` = native MSAA on the WebGL2 render target (better than FXAA/SMAA); `0` on mobile. `HalfFloatType` is mandatory for correct HDR bloom. Pass order: geometric effects (GTAO > SSAO) -> Bloom -> DoF -> grading/LUT -> AA/ToneMapping last. Pass budget: mobile 2-3, desktop 4-6; bloom resolution 0.5x, SSAO 0.25-0.5x, DoF full.

Selective bloom: `<SelectiveBloom selection={ref}>` or emissive with `toneMapped={false}` to push past 1.0 and be caught by the threshold. Parameters: intensity 0.5-2 (hero ~0.45), threshold 0.8-1, radius 0.4-1 (mipmapBlur does the rest).

WebGPU/TSL path (bloom, dof, ssr, ssgi, traa, lut3D): see `webgpu-tsl-api.md`. Full vanilla pass signatures: `postprocessing-passes-api.md`.

## 5. Hero materials

`meshPhysicalMaterial` covers all premium: glass `transmission: 1, thickness: 0.5, ior: 1.5, roughness: 0` + `dispersion` (three >= r167, costs an extra pass); car paint `metalness: 0.9, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.1`; sheen for fabrics, iridescence for oil-slick. Drei alternatives: `MeshTransmissionMaterial` (chromatic aberration, distortion, thickness — cheap and beautiful glass), `MeshReflectorMaterial` (blur, mixStrength, depthScale — floors). Utilities: `polygonOffset` against z-fighting; `alphaTest` instead of `transparent` for foliage/decals (avoids sort issues).

Color-space discipline (the #1 production error): `map`/emissive in sRGB, normal/roughness/metalness/AO **never** sRGB (NoColorSpace/Linear). Since r151 the second UV channel is `uv1` (not `uv2`), since r152 `texture.channel`. `texture.anisotropy = renderer.capabilities.getMaxAnisotropy()` for floors/roads.

## 6. Motion (DOM + 3D)

Stack: Lenis owns the scroll, ScrollTrigger reads from Lenis, `scroll-behavior: smooth` removed from CSS. In Next.js: dynamic import `ssr: false` for Canvas/GSAP, gate `matchMedia('(prefers-reduced-motion: reduce)')` before starting Lenis/GSAP/WebGL, full cleanup on unmount (geometry/material/renderer dispose). Scroll/pointer handlers write only variables consumed by a loop (rAF/useFrame), never do work in the handler.

Numbers, not tastes: stagger window 40-80ms for UI, 80-140ms for hero/editorial reveals; **never do important reveals opacity-only** — fade always paired with translate/scale/mask/clip-path ("fade with movement"); linear easing only for spinners, marquees, progress; concrete springs: snappy `stiffness 300 / damping 20` (cards, modals), fluid `stiffness 150 / damping 15 / mass 0.5` (hover, cursor), heavy `stiffness 100 / damping 30` (hero reveals).

Three motion layers, always: primary action (what the user triggered), secondary follow-through (elements that chase it), ambient background life (drift, slow particles). In 3D: damping `1 - Math.exp(-8 * delta)` (~0.06-0.1 at 60fps), hierarchical parallax (foreground moves more than background, motion distance follows hierarchy), scroll-driven camera via drei `ScrollControls` or a manual rig. Custom cursor: optional, never default on corporate sites.

## 7. Type & palette (DOM overlay)

Premium 3D dies with generic typography. A scale with extreme contrast: 12 caption / 16 body / 24 h3 / 48 h2 / 80+ display. Distinctive font pairings per domain (Syne, Outfit, Archivo, Sora, Bricolage Grotesque, Fraunces, Instrument Serif); veto Inter as the default; zero tracking, polish via weight/size/contrast; variable font axes animatable on scroll. Deliberately extreme radii: 0, 8 or 9999px — never mix 4 and 12 randomly. Spacing on a 4/8px baseline.

Palette: at most 2 accent colors per project, a monochrome base + a single "pop" for interactives, algorithmic WCAG AA 4.5:1 verification. Four starting palettes: Dark & Neon, Studio Monochrome, Nature Dark, High Contrast Warm. Glassmorphism (`backdrop-filter`) sparingly: overuse kills the effect.

## 8. Audio (optional)

Howler.js, mandatory gate on user gesture, ambient at -18/-24dB under the mix, persistent mute in localStorage, OFF by default on mobile. Never autoplay.

## Polish self-audit (before "done")

No `position: absolute` on text inside fixed-height containers (flexbox + `margin-top: auto`); overlapping cards with managed z-index and `opacity: 0` on inactive ones; padding >= 1rem in panels; contrast protection on colored backgrounds (text-shadow or semi-opaque background); `prefers-reduced-motion` tested; the look holds at DPR 1 and reduced post chain (medium tier).
