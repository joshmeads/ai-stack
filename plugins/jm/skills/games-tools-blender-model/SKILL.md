---
name: games:tools:blender-model
description: Build or fix a 3D model in Blender (prop, vehicle, building, character or scenery) as parametric Python that exports to glTF for a browser game. Works a build, render, look, fix loop with headless Blender rather than writing geometry blind, then has the result reviewed from the renders alone. Use for any request to make, change or improve a 3D model, mesh, or game asset.
---

# Making a model that reads

Adapted for Codex from AlexConnolly/agent-skills (MIT, commit bd3beb8). The builder
and reviewer instructions live in `references/model-smith.md` and
`references/model-critic.md`.

## Rule one: build in a loop, one model at a time

Follow `references/model-smith.md` for every model: build, render with
`scripts/shots.py`, open the contact sheet, decide what to improve, repeat.
One model per loop. If subagents are available, give each model its own
subagent with the brief and `references/model-smith.md`, so the many renders
stay out of the main conversation. Several unrelated models can run in
parallel, one subagent each.

The work is iterative improvement, about five rounds per model at the default
effort, and the loop is mostly images. Run inline, it fills the context of
everything else, and renders start getting skipped to save room. That is when
bad models get made.

## Rule two: something that has not seen the code has to look at it

When the builder reports finished, review the result before accepting it,
following `references/model-critic.md`. The reviewer gets the same brief and the
contact sheet directory, and nothing else. It must not see the build script.
If subagents are available, use a fresh subagent for this. Otherwise, review the
contact sheets yourself before reopening the script, judging only what the
pictures show.

If the review returns NEEDS WORK, apply its findings and go round again.

This is not ceremony. A builder is the worst-placed reader of its own model:
having written a function called `wheelhouse()`, it perceives a wheelhouse, and
an open question like "what is wrong with this?" comes back anchored on the
overall impression, while an entire absent structure goes unmentioned. A
reviewer that has only seen the pictures has no such anchor.

One demo shipped four passes with a cottage that had no walls, because its
window frames and roof still drew a plausible house from every angle.

## Before the first model in a project

The toolkit needs to be reachable from the build script, and `artconfig.py`
needs your project's numbers in it. Either copy `scripts/` into the project as
`art/`, or add it to `sys.path`. Then set, in `artconfig.py`:

| Setting | What it is |
|---|---|
| `OUT` | where `.glb` files must land for your app to load them |
| `UNITS_PER_M`, `FIGURE_H` | what one unit means, and how tall your character is |
| `GRID_MAJOR` | your tile or block size, if you have one |
| `HERO_*` | your app's camera angle, if it is fixed |
| `SMALL_RENDERS` | the pixels-per-metre the object is actually seen at |
| `SMOOTH_DEFAULT`, `CYL_SEGMENTS` | far-off toon look, or close-up |

`OUT` is the one that fails silently. Point it somewhere the app does not load
from and every render shows you the previous build while you "fix" a model that
was already correct.

## Effort

Say how hard to push. It is passed straight to the agent, and it changes not
just how many passes it runs but **which defects it acts on**:

| | Passes | Acts on | Use when |
|---|---|---|---|
| `low` | 2–3 | Structural only — missing, wrong size, does not read, fails in silhouette | Background props, blockouts, anything seen briefly or far away |
| `medium` *(default)* | 5 | Anything nameable in a specific view | Most work |
| `high` | 8+ | Anything it cannot argue against — the burden flips to justifying *not* fixing | Hero assets, close-ups, the thing the whole scene is about |

Low effort is not "worse", it is a different instruction: it tells the agent to
report cosmetic defects rather than spend passes on them. Fifty background rocks
at high effort is a waste; the one object the camera lands on at low effort is a
false economy.

The brief audit runs in full at every level. A missing structure is structural
whatever the effort, and low effort is where it is most likely to slip past.

    /blender-model a wayside cross, waist high, seen at 22 m --effort low

## What to put in the brief

The agent knows the loop. It does not know your intent, and it cannot infer
your taste. **Write more than you think you need to.** A paragraph gets you a
generic object; a detailed brief with a named art style and an explicit feature
list gets you the thing you were picturing.

This is not just a quality nicety. The agent's critique step audits the brief
one required element at a time, so **a brief with no feature list gives the
audit nothing to check** — and a model whose missing parts nobody enumerated is
exactly the model that ships with a wall or a cabin absent.

Give it:

- **What the thing is, and what it has to communicate.** "A tent. It has to say
  soldiers live here, not that a keep was built here." The second half is the
  part that does the work.
- **The art style, named.** Faceted low-poly read from a distance, or formed
  and smooth-shaded at arm's length? Stylised or accurate? Say what it should
  look like *as art* — a period, a game, a reference, a palette — not just what
  object it is. "A real Welsh castle, not a fantasy one" is worth a paragraph
  of adjectives.
- **The features you expect to see, as a list.** Name them. "A wall-walk with
  crenellations, a gatehouse, three towers of differing condition, a keep."
  Each becomes a line the agent must prove against a named render before it is
  allowed to stop.
- **How big, against a person.** "Waist high", "twice a man at the ridge" — not
  a number you guessed. If the project has a real figure height, say what it is
  and where it is defined.
- **Where it goes** — placed by hand, scattered, carried, instanced in its
  hundreds — and what it will sit next to.
- **The camera it is read from.** Detail below a fifth of a figure is wasted on
  a model seen from a long way up, and the defaults in `artconfig.py` assume a
  distant one.
- **Anything it must not be.** "Not a keep." "Not another woodpile." "Not a
  bathtub — if the topsides come out as parallel slab sides, keep working."
  Naming the failure mode is the single most effective line in a brief.

## Faceting that reads as a style, not a broken mesh

Stylised low-poly is a few large planes with crisp edges and consistent
shading. Random vertex noise followed by decimation and flat shading gives the
opposite: a confetti of small triangles that each catch the light differently,
which reads as a broken mesh at any distance. For rocks, cliffs and other
faceted forms:

- Shape with planes: cut a block with a handful of bisect or boolean planes,
  or fracture it into chunks (cell fracture), then cut a few secondary bevels.
  Do not displace with high-frequency noise.
- Merge coplanar and near-coplanar faces (limited dissolve around 5-10
  degrees) so every visible facet is a deliberate plane. At the gameplay
  camera a facet should span a clear part of the silhouette, not a few pixels.
- Shade smooth with split normals at a sharp angle (about 30-40 degrees): the
  big planes stay flat and crisp, tiny angle changes stop flickering.
- Put fine detail (cracks, grain, strata) in textures, normal maps or the
  material, not in geometry.
- Check a close-up render: alternating light and dark slivers inside one face
  of the rock mean the facets are noise, not design.

`scripts/rock_kit.py` builds a starting kit this way (convex hulls of random
points, a few plane cuts, merged faces, thin bevels, split normals) and
renders a lit contact sheet:

```sh
blender --background --python scripts/rock_kit.py -- --out art/rocks --kind cliff --count 4 --seed 1 --sheet
```

Kinds: `boulder`, `slab`, `spire`, `cliff` (stacked strata shelves) and
`column` (basalt prisms). Use it as a base and adapt shapes and proportions
to the concept; look at the sheet before exporting more.

## Work out the fidelity budget before you model anything

One object gets one UV square, so the detail it can ever carry is fixed before
a single vertex exists. The formula is not the obvious one:

```
texels per metre  ≈  map size × sqrt(packing efficiency) / sqrt(total SURFACE AREA)
```

**Surface area, not longest edge**, because a wall module has two faces, two
ends, a walk and a parapet — its area is far larger than its footprint
suggests.

And **packing efficiency**, which is a property of the object, not a constant.
`smart_project` fills about **a third** of the UV square on a model of
thousands of small irregular islands, and about **two thirds** on one made of
large flat rectangular panels. Measured: a castle wall module packed at 31.9%,
a longcase clock at 66.1% — so the same formula gives the clock twice the
density of the naive estimate. Measure it rather than assume a figure.

Measured on a 4 m castle wall module: dividing by extent instead of √area
over-estimates by **3.87×**, and ignoring the 31.9% packing over-estimates by a
further **1.77×**. Together **6.85×** — which is exactly the gap observed
between prediction and measurement.

What that buys you, on a 4096 map at the packing `smart_project` actually
delivers:

| Seen at | Target | Surface area affordable | ≈ a cube of side |
|---|---|---|---|
| Distant prop, 40 px on screen | 64 px/m | 1300 m² | 14.8 m |
| Normal game camera | 128 px/m | 330 m² | 7.4 m |
| Player walks up to it | 256 px/m | 82 m² | 3.7 m |
| In your face, hero render | 512 px/m | 20 m² | **1.8 m** |

**512 px/m on a single baked UV set is a prop-sized budget, not an
architecture-sized one.** At building scale the honest answer is tiling or
triplanar detail maps, which this pipeline does not have. A 4 m wall module is
a 256 px/m object at best, and only if it is unwrapped well.

Three measured data points to calibrate against, all at 4096: a 71 m castle
came out at **14.7 texels per metre**; a 4 m module of the same wall at
**145**, nine times denser; and a 2.1 m longcase clock at **1205**, which
clears a 512 hero target by 2.4× and reaches it at 2048.

That spread is the whole argument. Modularity delivers a large, real gain but
not a hero-render surface at architecture scale. A **prop** gets there
comfortably — and gets there twice over, because a prop of flat panels also
packs its UVs twice as well as a building does.

**Do not trust this table over a measurement.** After unwrapping, measure it:
texels per metre = map size × sqrt(total UV area ÷ total surface area), with UV
area summed from the mesh's UV polygons and surface area from `p.area` over its
polygons. The table tells you whether to attempt something; the measurement
tells you what you got.

**If the object exceeds its budget, it must be modular.** That is not a style
preference, it is the only way to buy detail — and it moved the distance at
which that wall stops being sharp from 85 m to 8.6 m.

### Building a kit rather than an object

When you go modular, decide these *before* modelling, and write them at the top
of the build script where the next person will find them:

- **The pitch.** One number every piece is a multiple of — 2 m, 4 m, whatever
  the world uses. Every module's footprint is `pitch × n`.
- **The connection face.** Which face mates, at what height, with what profile.
  A wall section and a gate section must present the same cross-section at the
  joint or the kit will not tile.
- **The origin convention.** Put it on the connection, not at the centre of
  mass, so placing a piece is setting a position on the grid rather than
  solving an offset.
- **Overlap, deliberately — but never coplanar.** A module exactly one pitch
  long opens a visible slot at every joint the moment any jitter or rotation is
  applied, so build it slightly longer. Plain overlap is not enough: two
  identical faces at the same place z-fight and flicker. Taper or step the
  overlapping ends so consecutive pieces touch on a single line and are
  strictly in front of or behind each other everywhere else. Drawing the last
  60 mm in by 2.5% is enough, and makes the joints invisible.
- **What varies and what does not.** Modules are seen many times. Anything
  distinctive — a particular crack, a bright object — reads as a repeat and is
  worse than no detail at all. Put the variety in a few pieces used once.

Then model **one** module properly, at full density, and only build the rest of
the kit once that one holds up in a close render. A kit built out before the
first piece is judged is eight pieces of the same mistake.

## What the loop is

The agent's own instructions carry it, but so you can tell whether it actually
did the work:

1. Check the thing does not already exist
2. Read the real dimensions out of the code, not out of comments
3. Author a `build_*.py` against `lib.py` / `boxmodel.py`, **Z-up**
4. `blender --background --python build_*.py -- <name>`
5. `blender --background --python shots.py -- <name>` and **Open and look at the
   renders** — the hero shot at four headings, the three orthographics, the
   flat-black silhouette, and the small ones at real pixel size
6. Name the specific defect in the specific view
7. Patch that part; do not regenerate the function
8. Repeat. **Five passes minimum**, none counted unless a render was opened
9. Check it in place, at the distance the app draws it

## Why it is built this way

Three things are load-bearing, and they come from published work on getting
language models to produce decent geometry rather than from taste:

**Code is the model, not a mesh.** Parametric Python that a person can read and
re-run beats an exported blob: it can be edited in place, diffed, reviewed, and
regenerated at a new size. (3D-GPT; LL3M.)

**The render is the feedback, and there is no substitute.** Systems that render
the object and feed the picture back before editing produce dramatically better
results than ones that write geometry open-loop. LL3M uses multiple views and a
critic pass for exactly this. `shots.py` is that, minus the second model: the
agent renders and looks at its own work, because current models can see, and
the pipelines that needed a separate vision model to do the looking were
working around a limitation that no longer exists.

**Localised edits beat regeneration.** LL3M found that without the previous
code in context, refinement produces a fundamentally different asset rather
than a corrected one. Hence step 7.

**Play to the shape of the tool.** Language models are good at hard-surface,
architectural, primitive-assembly geometry and weak at organic form. Chunky
low-poly, vehicles, buildings and props are squarely in the first category. Do
not try to sculpt a face.

## What this toolkit cannot do

Know this before you start, so you do not spend passes discovering it:

- **No UVs and no textures.** Every surface is one flat PBR colour. There are
  no normal, roughness or albedo maps and no vertex colours.
- **No scatter, particle system or geometry nodes.** Instancing is a `for`
  loop placing real meshes.
- **No displacement or subdivision modifiers.** Shaping is destructive bmesh
  work: `warp`, `taper`, `bend`, `cut_at`, `bevel`.
- **No HDRI or global illumination** in the contact sheet. One sun, one flat
  sky, tuned for reading a silhouette rather than for a beauty render.

So **photorealism is out of scope**, and so is anything whose character lives
in its surface rather than its shape — leather, rust, moss, wood grain, dirt,
wear. If a brief asks for those, say so plainly and build the form well; what
you are producing is either a stylised asset or a blockout for a texturing
pipeline, and both are worth doing properly.

Irregularity and decay *can* be expressed geometrically. `Form.warp()` takes an
arbitrary per-vertex function, so a slumped wall line, a bowed tower or
crenellations eroded to uneven stumps are all reachable — deterministic
pseudo-noise from the coordinates keeps them reproducible. `repaint()` takes a
`(centre, normal)` test, so surfaces that face a particular way can take a
different colour. That is the honest extent of it.

## What is in the toolkit

`scripts/`, all documented in [reference.md](reference.md):

- **`boxmodel.py`** — `Form`, one mesh grown from a cube: extrude, inset, loop
  cut, bevel, taper, bend, warp, mirror. For anything organic or continuous.
- **`lib.py`** — primitives (`box`, `cyl`, `ring`, `torus`, `wedge`), swept
  forms (`profile`, `loft`), materials with correct sRGB→linear conversion,
  node hierarchy for animated parts, and glTF export with a triangle and
  ground-contact report.
- **`shots.py`** — the contact sheet. Fourteen renders per model.
- **`artconfig.py`** — every project-specific number, in one file.

Grow a form when the surface is continuous. Loft or sweep when the section is
known at every station — a hull, a pipe, a handrail. Trying to pull a boat out
of a cube with loop cuts fights the tool the whole way.

## Sources

- [LL3M: Large Language 3D Modelers](https://arxiv.org/html/2508.08228v1) —
  multi-view render → critique → refine, code as representation, shared code
  context for localised edits.
- [3D-GPT: Procedural 3D Modeling with LLMs](https://arxiv.org/abs/2310.12945)
  — procedural code over direct mesh generation.
- Blender Studio, *Step by Step — Low Poly Character Creation* — the box
  modelling workflow `boxmodel.py` implements.
