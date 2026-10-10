# Model optimization — production GLB pipeline

A GLB is a compiled artifact, not a source. A 5-stage pipeline: **ASSESS -> MESH -> TEXTURE -> COMPRESS -> VALIDATE**. Zeroth rule: `gltf-transform inspect model.glb` ALWAYS before optimizing — you do not optimize what you have not measured.

## File budget

| Target | Weight | Triangles | Textures |
|---|---|---|---|
| Hero asset | <= 1MB | <= 30k | 1024px |
| Mobile page budget | <= 2MB | <= 50k | 1024px |
| Desktop / configurator | <= 5MB | <= 200k | 2048px |

## Mandatory transform order (gltf-transform)

`dedup -> flatten -> join -> weld -> simplify -> texture (KTX2) -> compress (Draco XOR Meshopt) -> prune -> quantize`

Inverting the order produces worse results or broken files. Typical command:

```bash
gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress ktx2
# or a manual pipeline for fine control:
gltf-transform dedup in.glb - | gltf-transform flatten - - | gltf-transform join - - | \
gltf-transform weld - - | gltf-transform simplify --ratio 0.5 --error 0.001 - - | \
gltf-transform uastc - - | gltf-transform meshopt - out.glb
```

## Hard rules (all verified)

1. **Draco XOR Meshopt, never together** — KHR_draco and EXT_meshopt_compression are mutually exclusive, even via gltfpack. For the web: Meshopt decodes faster (better for many assets), Draco compresses more (better for a few large assets). Pick one and document the choice.
2. **ETC1S for color/ORM/emissive; UASTC ONLY for normal maps.** ETC1S on normals = banding and faceted shading. UASTC everywhere on mobile = 8-16 bytes/texel -> OOM.
3. **Draco quantization bits**: position 14 (16 hero, 11 props), normal 10 (12 hero, 8 props), UV 12.
4. **Never simplify below 10% of triangles** without side-by-side visual validation.
5. **LOD chain**: ratio 1.0 / 0.5 / 0.25 / 0.10 with increasing error tolerance; at least -50% triangles between levels, or the LOD is useless.
6. **Never Draco-compress in the Blender export** (dated encoder): export a clean GLB (via `scripts/export_glb.py` or the standard addon), compress afterwards with gltf-transform.
7. **Never `join` meshes with independent animations** — it breaks bindings.
8. **DRACO/KTX2 decoders are created ONCE**, reused, then `.dispose()`d (WASM leak). Host in `/public/draco/` and `/public/basis/`, never a CDN in production.
9. **Never overwrite the original.** `assets/src/` (source) -> `public/models/` (artifact).

## Blender export (summary; headless scripts in the `games-tools-blender-model` skill)

+Y up, apply modifiers, apply transforms; named materials (gltfjsx uses them); no camera/lights in the production GLB; animations: bake and use speaking names.

## Validation (stage 5, never skipped)

`gltf-transform inspect out.glb`: expected draw calls, triangles, texture count/size within budget. Visual open in gltf.report or drei viewer: correct materials, healthy normals, no banding. Only then -> CDN/public.
