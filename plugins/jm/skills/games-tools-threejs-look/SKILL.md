---
name: games-tools-threejs-look
description: "Upgrade Three.js games from prototype visuals to premium browser graphics: art-direction critique, procedural model building, material and texture libraries, world prop kits, shaders, VFX, lighting and render pipeline, LOD and instancing, render budgets, and a 10-category visual scorecard. Use for the art direction and look of any new Three.js game from its first playable onward, and whenever a brief asks for polished, indie-quality, release-ready, premium, AAA, high-fidelity or showcase visuals, or screenshots still look basic, flat or repetitive."
---

# Three.js AAA Graphics Builder

Own the production graphics pass: turn basic screenshots into authored, high-density, performance-aware visuals.

## References

| File | Read it when |
| --- | --- |
| `references/visual-scorecard.md` | scoring visuals or making any premium/AAA/showcase claim |
| `references/authoring-recipes.md` | building hero, obstacle, reward, world-kit, or prop models; changing lighting, tone mapping, shadows, fog, post, or graphics architecture |
| `references/technical-art.md` | render budgets, material kits, VFX systems, instancing/LOD, imported asset cleanup, anything that could affect browser performance |
| `references/shader-cookbook.md` | custom shaders, `onBeforeCompile`, skies, or post-processing; use recipes as tested starting points and verify them against the project's Three.js version |

For a broad "still looks basic" or premium pass, read all four before implementing. A narrow graphics edit loads only its relevant references and checks; the requested style and scope override recipe defaults.

## Core rule

Glow does not make primitives look AAA. Build authored forms first, then materials, then lighting, then effects — in that order.

## Workflow

1. Capture or inspect active-play screenshots on the target viewports when a playable scene exists.
2. For an existing game, score the affected views and pick the weakest surfaces. For a new game, establish art direction, camera scale, material roles, and the hero target first; do not invent a before screenshot.
3. Add the graphics architecture the game is missing: material library, procedural textures and decals, model factories, world prop kit, VFX system, render pipeline, diagnostics.
4. Choose a source per surface by what gets closest to the concept frames, mixing tools freely (see **Asset sourcing**). The common failure is building everything from TypeScript geometry and noise: quick, but it usually reads as a prototype next to a painted concept, so compare before settling on it.
   Concept frames generated as targets must look like an in-game screenshot of this game at the gameplay camera, in its stated style, at a detail level real-time WebGL and the chosen assets can reach: ask for "a screenshot from a real-time browser game" with the HUD, not a matte painting or film still. A photoreal painting cannot be matched, so reviewers learn to ignore it.
   Inspect the concept/model before dependent generation or rigging. Finish one representative playable scene with actual assets and feedback before expanding the content kit.
5. Upgrade every weak visible surface, not only the hero: hazards, rewards, ground and track, foreground props, background layers, telegraphs, material variation, state VFX.
6. Match the camera and perspective of the concept frames before polishing surfaces. Measure both images, not by eye: the horizon line's height as a percentage of the frame, the hero's bounding box (centre and width as percentages), how much of the hero's top surface is visible (a camera above looks down onto it), and the size ratio between a near and a far object of the same kind (field of view). Write the numbers for the reference and the capture side by side, change the camera height, pitch, field of view and hero offset until they agree within a few percent, and record the final values. Then place objects so the view has depth: turn rocks, props and landmarks at varied yaw and tilt instead of square to the camera, stagger them at different distances along lines that converge toward the vanishing point, overlap near and far pieces, and let something cut the frame edge in the foreground. A hero seen exactly from behind and props lined up face-on read as flat cards. Bank or turn the hero slightly in idle so its form shows. Any painted backdrop must share the 3D horizon line and the sun position.
7. Frame it like the concept. Composition is what makes a concept look designed: study where its big masses sit and recreate that arrangement, not just its objects.
   - **Frame the edges.** Tall, close, dark masses on one or both sides (cliffs, pillars, trees, walls), usually unequal: one side taller and nearer than the other. They hold the eye inside the frame.
   - **Lead the eye.** Edges, ridges, rows of rocks and light falloff converge toward the focal area (the path ahead, the horizon point, the goal) and down onto the hero.
   - **Open the centre.** Keep the area the player reads (the path, hazards, the hero) open and comparatively bright; do not park large masses in the middle.
   - **Layer depth.** A dark foreground piece cutting a corner, mid-ground masses, then lighter, hazier distance.
   - **Check it by squinting:** `compare.cjs --grid 5` prints a coarse brightness grid for reference and capture. Where the reference has a dark column on one side or a bright centre, the capture should too; move, scale or add framing masses until the two grids have the same pattern.
   In a moving game not every frame can be composed, and should not be forced to be. Put framing into the level's visual design instead: placement rules that favour tall masses toward the edges and keep the path open, plus authored set pieces at the moments players linger on or remember (level start, reveals, checkpoints, the approach to a landmark) composed like the concept. Check those moments, not every frame.
8. Light it like the concept. Lighting does more for the match than any texture:
   - **Key:** one directional light from the reference's sun or lamp position and colour, low and raking when the sun is low, with shadows on. It should light one side of every rock and leave the other side in shade.
   - **Fill:** a hemisphere or ambient light from the sky colour (usually the opposite temperature: cool sky against a warm sun), much weaker than the key, so shadow sides stay readable but clearly darker.
   - **Rim:** where silhouettes meet a bright sky, add back light (a second directional from behind, or a fresnel term in the material) so edges glow in the sun's colour.
   - **Atmosphere:** fog or distance haze tinted to the horizon colour, so far objects fade into the sky instead of staying dark. Sun disc with a soft glow, and bloom on the sun and emissive parts.
   - **Exposure:** ACES or AgX tone mapping and an exposure that keeps the brightest sky just below white.
   - **Local light:** emissive parts (engines, crystals, lanterns) cast a small point light on nearby surfaces.
   Evenly lit objects that look pasted onto the background mean the light is wrong, even when every texture is good. Measure it like the camera, with `games-tools-web-qa`'s `compare.cjs --crop` on the same regions of reference and capture: a near rock's lit side and its shaded side (brightness and warmth of each, and the difference between them), a rock edge against the sky (is there a bright rim in the sun's colour), and the sun (size and brightness of the glow around it). Write the numbers side by side and adjust key, fill, rim, fog and bloom until the lit/shade contrast and warmth agree within about 20%. When levels change time of day or mood, change the key colour and direction, fog, sky and exposure together.
9. Add event-driven VFX tied to gameplay state.
10. Re-score against the calibration anchors, citing screenshots from the `games-tools-web-qa` probe at fixed viewports. Keep going until every premium category is at least 2, or name the exact blocker.

## Asset sourcing

Do not call external generation services (paid image, 3D or audio APIs). The tools available are headless Blender (`games-tools-blender-model` skill; Blender is installed), custom shaders, Codex's built-in `image_gen` (`imagegen` skill), CC0 libraries (Poly Haven, ambientCG, Kenney) and code. Use your judgement per surface and combine them; the table lists options that have worked, not rules.

| Surface | Options that work well |
| --- | --- |
| Hero (vehicle, character, signature prop) | A Blender model with bevels, panel cuts and separate parts, UV-unwrapped and exported as GLB, inspected from a turntable render before import; trim and decal textures from `image_gen`. |
| Rocks, cliffs, terrain pieces | Poly Haven or ambientCG scans, or Blender scripts (displaced, cracked, decimated, with baked normal and AO); several distinct forms. Shader detail on top: triplanar texture, strata, edge wear, height tint. |
| Sky, sun, horizon, haze | A sky shader (gradient, sun disc and glow) with height fog and distance haze tinted to the concept; an `image_gen` panorama or backdrop painting on a far sphere or cards for distant formations. |
| Clouds, smoke, water, energy | Shaders (layered-noise billboards, soft particles, fresnel, scrolling noise) or `image_gen` cut-out sprites in an atlas. |
| Pickups and VFX | Shader materials (emissive core, fresnel rim, additive trails) and pooled particles. |
| Textures and decals | `image_gen` seamless textures or ambientCG, with normal and roughness derived in Blender or a script. |
| Collision proxies, instancing variation, repeated small props | Code. |

Keep generated originals and the Blender scripts in the repository so assets can be rebuilt. Log every asset's source, prompt or script, and licence in `ASSETS.md`.

Build the concept frame first: before the content kit grows, assemble the view of one concept frame in the engine with real assets, shaders and lighting, capture it at the same camera, and compare it side by side (`games-tools-web-qa`). Iterate on that one view until a player would call it the same game.

For animated assets inspect motion as well as silhouettes: locomotion, blend transitions, foot contacts, hit timing, and secondary motion in real gameplay. A focused independent critique may identify defects after a substantial pass; the lead remains responsible for the final score and integration.

## Report

Score before and after with one line of evidence per category, the surfaces you upgraded, files changed, screenshots, renderer diagnostics against the budget table, generated asset paths and task IDs, and what is still weak. Include imported-asset diagnostics (scale, bounds, collision proxy, clips) when generated 3D was used.
