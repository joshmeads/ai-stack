# API reference

Four modules in `scripts/`. Import them from a build script that sits alongside
them, or add the directory to `sys.path`.

```python
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(HERE)
import artconfig as cfg
import lib
from boxmodel import Form
```

Blender is **Z-up**. Heights go in Z. The glTF exporter maps Blender
`(x, y, z)` to glTF `(x, z, -y)`, so Blender `+X` is forward, `+Z` is up, and
`+Y` is left.

---

## artconfig.py

Every project-specific number, in one place, so `lib.py` and `shots.py` stay
identical across projects. Edit this file, not those.

| Setting | Default | What it is |
|---|---|---|
| `OUT` | `../public/models` | Where `.glb` files land. Overridden by `$ART_OUT`. |
| `SHOTS` | `./shots` | Where contact sheets land. Overridden by `$ART_SHOTS`. |
| `UNITS_PER_M` | `1.0` | What one Blender unit means. |
| `FIGURE_H` | `1.75` | Height of the contact sheet's scale figure. |
| `GRID_STEP` / `GRID_MAJOR` | `1.0` / `4.0` | Fine and heavy grid lines. Set `GRID_MAJOR` to your tile size. |
| `HERO_ELEVATION_DEG` | `35.264…` | Your app's camera elevation. Default is true isometric. |
| `HERO_AZIMUTH_DEG` | `45.0` | Your app's camera azimuth. |
| `HERO_ORTHOGRAPHIC` | `True` | False for a perspective app; then set `HERO_LENS`. |
| `HERO_HEADINGS` | `(0, 90, 180, 270)` | Azimuth offsets for the four hero renders. |
| `SMALL_RENDERS` | 15 and 4.2 px/m | `(label, px-per-metre, upscale)`. `()` to skip. |
| `RES` | `900` | Resolution of the large shots. |
| `SMOOTH_DEFAULT` | `False` | Flat shading suits low-poly seen from distance. |
| `CYL_SEGMENTS` | `8` | Cylinder sides when unspecified. |
| `SKY`, `SUN`, `GROUND`, … | — | Contact sheet colours. Never reach an exported model. |
| `SUN_FROM` | `(60, -40, 100)` | Key light direction, Z-up. Match your app's. |
| `EXPORT_YUP` | `True` | glTF Y-up conversion on export. |
| `TRI_BUDGET` | `None` | Warn above this triangle count. |

`OUT` is the setting that fails silently — point it somewhere the app does not
load from and every render shows the previous build.

---

## boxmodel.py — `Form`

One mesh, grown from a cube. Faces are selected by where they point and where
they are, so scripts read as descriptions rather than coordinate lists.

```python
f = Form(size=(2.6, 2.1, 1.75), at=(0, 0, 0.875))   # size is the FULL extent
arm = f.inset(f.face(normal='+x'), thickness=0.3)   # shoulder, not a stump
f.extrude(arm, move=(0.6, 0, 0), scale=(1, 0.8, 0.8))
f.bevel(amount=0.03, min_angle=25)
obj = f.build('body', mat=some_material)
```

### Selection

| Method | Notes |
|---|---|
| `faces(normal=None, above=, below=, xmin=, xmax=, ymin=, ymax=, tol=0.5)` | `normal` is one of `+x -x +y -y +z -z`. An unknown name raises `KeyError` rather than silently matching everything. |
| `face(**kw)` | The first match, as a one-element list. |

### Growing

| Method | Notes |
|---|---|
| `extrude(faces, move, scale=None)` | Returns the new outer faces — extrude those next. The source faces are deleted, so a limb has no wall across its middle. |
| `inset(faces, thickness, depth=0)` | Returns the shrunk **inner** faces. Note this is the opposite of bmesh's own `inset_region`, which returns the rim. |
| `grow(faces, [(move, scale), …])` | A chain of extrusions. |

### Shaping

| Method | Notes |
|---|---|
| `cut(axis=2, cuts=1)` | Evenly spaced loop cuts. |
| `cut_at(axis, positions)` | Loop cuts at chosen coordinates. Prefer this where the form actually changes. |
| `bevel(amount, segments=1, min_angle=None)` | `min_angle` in degrees skips edges whose faces already meet nearly flush. |
| `taper(lo, hi, at_lo, at_hi, axes='xy')` | Scale X/Y as a function of height. |
| `bend(lo, hi, amount, axis='y')` | Lean everything above `lo` over, quadratically. |
| `warp(fn)` | `fn(x, y, z) -> (x, y, z)` on every vertex. For forms that lie down. |
| `mirror(axis='x')` | Model one side, get the other exactly. |
| `move(faces, vec)` / `scale_faces(faces, vec)` | Move or scale a selection. |
| `smooth(on=True)` | Override `SMOOTH_DEFAULT` for this form. |
| `build(name, mat=None, parent=None)` | Realise it as an object. |

---

## lib.py

### Colour and materials

| Function | Notes |
|---|---|
| `srgb(0xRRGGBB, alpha=1)` | sRGB → linear RGBA. Blender's Base Color socket is linear; passing sRGB bytes straight in lifts every mid-tone by most of a stop. |
| `material(name, rgba, rough, metal, emissive, alpha, clearcoat)` | Principled BSDF, cached by name. |
| `hexmat(name, 0xRRGGBB, **kw)` | `material` taking a palette hex, so `srgb()` cannot be forgotten. |
| `reset()` | Empty scene, and clear materials and meshes — they survive a scene reset by name. |

### Primitives

`box(name, size, loc, rot, chamfer, taper, segments, shear, smooth)` ·
`wedge(…, pinch)` · `cyl(name, r1, r2, h, …)` · `tube(name, r, h, …)` ·
`sphere(name, r, …, subdiv)` · `plate(name, w, d, t, …)` ·
`ring(name, r_in, r_out, w, …)` · `torus(name, r_major, r_minor, …)`

`ring` is an annulus with a real hole. A cylinder cannot stand in for a wheel
rim — the hole is most of what reads.

### Swept forms

| Function | Notes |
|---|---|
| `profile(name, section, path, close=False, scales=None)` | Sweep a 2D section along a 3D path. Handrails, pipes, cables, gutters. `scales`, one factor per path point, tapers it — a tail, a horn, a rope under tension; without it the sweep is a constant hose. The section is framed against world up, so a path that loops over vertical will twist. |
| `revolve(name, outline, segments=48, close_outline=True, arc=τ)` | Spin a 2D outline round Z. `outline` is `[(r, z), …]`. Anything turned on a lathe — a goblet, a bottle, a finial, a column base. With `close_outline`, an outline that runs up the outside, over a rim and back down the inside gives a real thin-walled shell rather than a solid. A point at `r=0` becomes a welded pole. |
| `loft(name, stations, cap_ends=True)` | Sweep a *changing* closed section along X. `stations` is `[(x, [(y, z), …]), …]`, same point count and winding at every station. |
| `circle_section(r, segments)` · `rect_section(w, h)` | Section helpers. |

Grow a `Form` when the surface is continuous. Loft or sweep when the section is
known at every station.

### Booleans

A window, a doorway, a recess, a slot: the difference between a hole cut in a
surface and a frame stuck on top of it. Faking those with proud geometry works
at a distance and falls apart at a grazing angle.

| Function | Notes |
|---|---|
| `boolean(target, tool, op, solver='EXACT', keep_tool=False, transfer_material=True)` | Cuts in place and consumes the tool. Evaluates the depsgraph rather than applying a modifier through an operator, which needs a window context a background render does not have. |
| `cut(target, tool)` · `fuse(target, tool)` · `intersect(target, tool)` | `DIFFERENCE`, `UNION`, `INTERSECT`. |
| `hole(target, size, loc, rot, mat, through='y')` | A rectangular opening. The `through` axis is stretched so the tool passes clear of both faces — a tool stopping flush with a surface leaves a zero-thickness sliver the solver has to guess about. |

`transfer_material` gives faces created by the cut the **tool's** material, so
painting the tool a shade darker than the wall makes the reveal read as depth
with nothing extra at the call site.

`fuse` is not `merge_into`: that only groups meshes, while this removes the
interior walls where two solids overlap and leaves one continuous surface.

The EXACT solver expects closed input. A target with boundary edges produces
something, but not reliably what you asked for.

### Hierarchy

| Function | Notes |
|---|---|
| `part(name, loc, parent=None)` | An empty at a joint. Its origin is the pivot, so an arm's part sits at the shoulder. |
| `attach(obj, parent, mat=None)` | Parent without moving. Everything is authored in world coordinates. |
| `merge_into(name, parts, parent=None, mat=None)` | Join meshes into one. **The join preserves each part's materials, including per-face ones. Passing `mat` replaces all of them** — leave it out when the parts are already painted. |
| `repaint(obj, [(mat, test), …])` | Per-face materials on one mesh. Rules apply in order, so the list reads outermost-last. `test` takes the face centre, or `(centre, normal)` if it accepts two arguments. |
| `shade_auto(obj, angle_deg=38)` | Smooth shading with a sharp-edge threshold, so a panel flows and a hard corner does not. |

### Export

| Function | Notes |
|---|---|
| `export(name, report=None)` | Writes `<OUT>/<name>.glb`. Appends `(name, tris, floor, top, bytes)` to `report`. |
| `summarise(report, budget=None)` | Prints the table and flags `OVER BUDGET`, `SUNK` and `FLOATING`. |

---

## shots.py

```
blender --background --python shots.py -- <model-name>
```

Renders the **exported glb**, not the live scene — the axis convention only
goes wrong at export, so rendering the scene would hide that whole class of
fault. Writes to `<SHOTS>/<model-name>/`:

| File | What it is for |
|---|---|
| `iso_a.png` … `iso_d.png` | The app's own projection at four object headings. The decision-making shots. |
| `iso_clean.png` | The same, without the grid and the figure. |
| `silhouette.png` | Flat black on white. If the shape does not read here it will not read at distance. |
| `iso_<n>px.png` + `_xN` | Rendered at the real pixels-per-metre, then upscaled nearest-neighbour. The upscale adds no information — that is the point. |
| `front.png`, `side.png`, `top.png` | Orthographic. Proportion, symmetry, ground contact. |
| `three_quarter.png` | Perspective. Where a bad join is easiest to see. |

It also prints the bounding box in metres, in major grid squares, and as a
multiple of the figure height, plus the triangle count and a warning if the
model is sunk into or floating above the ground.

The scale figure is the single most useful thing in the sheet. Sizing errors do
not show up in code and do not show up in an isolated render; they show up next
to a person.
