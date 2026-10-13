# Materials, blending, and output

three-specific behavior verified on r186.

## Blending

One premultiplied blend draws additive and normal layers in a single batch. The shader outputs `vec4(color * coverage, coverage * (1 - additiveness))`:

```js
material.transparent = true;            // required: without it, CustomBlending lands in the opaque list
material.blending = CustomBlending;     // CustomBlending ignores premultipliedAlpha when choosing factors
material.blendSrc = OneFactor;      material.blendDst = OneMinusSrcAlphaFactor;
material.blendSrcAlpha = OneFactor; material.blendDstAlpha = OneMinusSrcAlphaFactor;
material.premultipliedAlpha = false;    // true multiplies RGB by alpha again: additive (alpha 0) output vanishes
material.depthWrite = false;
```

## Tone mapping and output

- If your output node tone maps and encodes sRGB itself, set `renderPipeline.outputColorTransform = false`, or three applies its own transform on top:
  ```js
  pipeline.outputColorTransform = false;
  pipeline.outputNode = Fn(() => vec4(sRGBTransferOETF(neutralToneMapping(hdr.rgb, exposure)), 1))();
  ```
- AgX shifted bright saturated light toward pastel (fire read peach, purple read lilac) and lifted shadows in a dark scene. `NeutralToneMapping` kept hue. Compare on identical frames before choosing.

## Transmission and refraction

- On `MeshPhysicalNodeMaterial`, `colorNode` multiplies the transmitted light; volume absorption comes from `attenuationColorNode` and `attenuationDistanceNode`. A color ramp in `colorNode` tinted everything behind the glass, and clear glass became a dark shell. Keep `colorNode` near white and put glow in `emissiveNode`.
- Use `side: FrontSide` for transmission on closed meshes. With `DoubleSide`, transmission is evaluated twice and back faces render as a black half-shell.
- Physical transmission samples `viewportOpaqueMipTexture` at an unguarded refracted UV, leaving black seams at grazing angles. Fade transmission there (`1 - smoothstep(0.84, 0.99, grazing)`), or use `viewportSafeUV` in custom refraction.
- `FramebufferTexture` defaults `minFilter` and `magFilter` to `NearestFilter`, so refraction looks stair-stepped. Set them before building the viewport node:
  ```js
  const fb = new FramebufferTexture();
  fb.type = HalfFloatType;
  fb.minFilter = fb.magFilter = LinearFilter;
  const sceneColor = viewportTexture(screenUV, null, fb);
  ```
- three's dispersion term is `(ior - 1) * dispersion * 0.025`, so dispersion values of 0–1 are invisible; visible values were around 0–10.

## Depth

- Soft fade toward geometry behind a surface: `saturate((sceneDistance - fragmentDistance) / fadeDistance)` with positive linear distances. `examples/jsm/tsl/utils/SoftParticles.js` implements it. With the sign inverted, a haze plane rendered as a tinted rectangle.
- Reconstruct normals from depth with `getNormalFromDepth(uv, depthTexture, inverseProjection)`. Screen derivatives of world position leak across silhouettes.

## Fog

`scene.fogNode` accepts a TSL fog node, which allows height fog instead of `FogExp2`.
