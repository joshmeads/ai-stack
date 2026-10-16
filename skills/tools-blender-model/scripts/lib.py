# Shared modelling helpers. Nothing is built here.
#
# These wrap the Blender API so build scripts read as descriptions of shapes,
# and centralise the things that are easy to get wrong: sRGB colours converted
# to linear, consistent shading, part origins on the joint they rotate about,
# and a glTF export that lands where the app loads from.
#
# Everything project-specific lives in artconfig.py. Edit that, not this.
#
# AXES. Blender is Z-up. The glTF exporter is called with export_yup=True,
# which maps Blender (x, y, z) to glTF (x, z, -y):
#
#     Blender +X  ->  glTF +X    forward
#     Blender +Z  ->  glTF +Y    up
#     Blender +Y  ->  glTF -Z    left
#
# Model with Z up: heights go in Z.
import bpy
import bmesh
import math
import mathutils
import os

import artconfig as cfg

OUT = cfg.OUT


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Materials and meshes survive a scene reset by name, so clear them too or
    # a later build reuses an earlier build's materials.
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


# ---------------------------------------------------------------- colour

def srgb(hex_value, alpha=1.0):
    """0xRRGGBB authored as sRGB -> linear RGBA, which is what Blender wants.

    Every `Base Color` socket is linear. Passing sRGB byte values straight in
    lifts every mid-tone by most of a stop. The transfer function is the sRGB
    one, not a 2.2 gamma; they differ near black by enough to matter."""
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(((hex_value >> 16) & 255) / 255.0),
            lin(((hex_value >> 8) & 255) / 255.0),
            lin((hex_value & 255) / 255.0),
            alpha)


# ---------------------------------------------------------------- materials

def material(name, rgba, rough=0.72, metal=0.0, emissive=0.0, alpha=1.0,
             clearcoat=0.0):
    """A Principled BSDF, which is what glTF PBR is defined against, so these
    values reach the engine unchanged.

    Cached by name: two calls with the same name return the same material,
    which is why reset() clears them between builds."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):   # 5.x materials always have a node tree
        m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    if len(rgba) == 3:
        rgba = (rgba[0], rgba[1], rgba[2], alpha)
    b.inputs['Base Color'].default_value = rgba
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Alpha' in b.inputs:
        b.inputs['Alpha'].default_value = alpha
    if alpha < 1.0:
        if hasattr(m, 'surface_render_method'):   # EEVEE Next (4.2+); blend_method is legacy
            m.surface_render_method = 'BLENDED'
        else:
            m.blend_method = 'BLEND'
    if clearcoat and 'Coat Weight' in b.inputs:
        # Lacquer over paint: a sheen that roughness alone cannot express.
        b.inputs['Coat Weight'].default_value = clearcoat
        b.inputs['Coat Roughness'].default_value = 0.08
    if emissive > 0:
        b.inputs['Emission Color'].default_value = rgba
        b.inputs['Emission Strength'].default_value = emissive
    return m


def hexmat(name, hex_value, **kw):
    """`material` taking a palette hex directly, so srgb() cannot be forgotten
    at a call site."""
    alpha = kw.get('alpha', 1.0)
    return material(name, srgb(hex_value, alpha), **kw)


# ---------------------------------------------------------------- primitives

def _new(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj, mesh


def _finish(obj, mesh, loc, rot, scale=(1, 1, 1), smooth=None):
    obj.location = loc
    obj.rotation_euler = rot
    obj.scale = scale
    for p in mesh.polygons:
        p.use_smooth = cfg.SMOOTH_DEFAULT if smooth is None else smooth
    return obj


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), chamfer=0.0, taper=1.0,
        segments=1, shear=0.0, smooth=None):
    """A chamfered box, optionally narrowed at the top or sheared along Y.

    `taper` may be one factor for both plan axes, or `(x, y)` to batter one and
    leave the other square — which is what a wall wants, and what a single
    factor silently gets wrong.

    A visible chamfer catches the key light and gives the form an edge to sit
    on, which is most of what separates a modelled shape from a stretched
    cube."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    # A scalar taper narrows BOTH plan axes, which is wrong for anything that
    # batters in one direction only. A wall module battered across its
    # thickness also lost thirty percent of its LENGTH at the top, so a kit of
    # nine stood foot to foot with their tops 0.6 m apart and would not tile.
    # Pass a pair to taper one axis and leave the other alone.
    tx, ty = taper if isinstance(taper, (tuple, list)) else (taper, taper)
    if tx != 1.0 or ty != 1.0:
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x *= tx
                v.co.y *= ty
    if shear:
        for v in bm.verts:
            v.co.y += v.co.z * shear
    if chamfer > 0:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                        offset=chamfer, segments=segments, affect='EDGES',
                        profile=0.5, clamp_overlap=True)
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot, smooth=smooth)


def wedge(name, size, loc=(0, 0, 0), rot=(0, 0, 0), pinch=0.15, smooth=None):
    """A box pinched to a ridge along +Y: crests, keels, blades, prows."""
    obj = box(name, size, loc, rot, smooth=smooth)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        if v.co.y > 0:
            v.co.x *= pinch
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def cyl(name, r1, r2, h, loc=(0, 0, 0), rot=(0, 0, 0), segments=None,
        chamfer=0.0, smooth=None):
    obj, mesh = _new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
                          segments=cfg.CYL_SEGMENTS if segments is None else segments,
                          radius1=r1, radius2=r2, depth=h)
    if chamfer > 0:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                        offset=chamfer, segments=1, affect='EDGES', profile=0.5,
                        clamp_overlap=True)
    bm.to_mesh(mesh)
    bm.free()
    obj = _finish(obj, mesh, loc, rot, smooth=smooth)
    if cfg.SMOOTH_DEFAULT if smooth is None else smooth:
        # Round the barrel but keep the end caps crisp; a smoothed cap reads as
        # a dent.
        for p in obj.data.polygons:
            p.use_smooth = abs(p.normal.z) < 0.9
    return obj


def tube(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), segments=None, smooth=None):
    return cyl(name, r, r, h, loc, rot, segments=segments, smooth=smooth)


def sphere(name, r, loc=(0, 0, 0), rot=(0, 0, 0), subdiv=1, scale=(1, 1, 1),
           smooth=None):
    obj, mesh = _new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot, scale, smooth=smooth)


def plate(name, w, d, t, loc=(0, 0, 0), rot=(0, 0, 0), chamfer=0.03):
    """A thin slab with its edges cut: armour, panelling, signage."""
    return box(name, (w, d, t), loc, rot, chamfer=chamfer)


def ring(name, r_in, r_out, w, loc=(0, 0, 0), rot=(0, 0, 0), segments=9,
         smooth=None):
    """An annulus with thickness: a wheel rim, a collar, a hoop.

    A cylinder cannot stand in for this — it is solid, and the hole is most of
    what reads. Four quads a segment: outer, inner, and the two faces."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    rows = [[bm.verts.new((math.cos(i / segments * math.tau) * r,
                           math.sin(i / segments * math.tau) * r, z))
             for i in range(segments)]
            for r in (r_out, r_in) for z in (w / 2, -w / 2)]
    ot, ob, it, ib = rows
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((ot[i], ot[j], ob[j], ob[i]))
        bm.faces.new((ib[i], ib[j], it[j], it[i]))
        bm.faces.new((it[i], it[j], ot[j], ot[i]))
        bm.faces.new((ob[i], ob[j], ib[j], ib[i]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot, smooth=smooth)


def torus(name, r_major, r_minor, loc=(0, 0, 0), rot=(0, 0, 0),
          major_seg=20, minor_seg=10, smooth=None):
    obj, mesh = _new(name)
    bm = bmesh.new()
    for i in range(major_seg):
        a = i / major_seg * math.tau
        for j in range(minor_seg):
            b = j / minor_seg * math.tau
            bm.verts.new((
                (r_major + r_minor * math.cos(b)) * math.cos(a),
                (r_major + r_minor * math.cos(b)) * math.sin(a),
                r_minor * math.sin(b)))
    bm.verts.ensure_lookup_table()
    for i in range(major_seg):
        for j in range(minor_seg):
            a0 = i * minor_seg + j
            a1 = i * minor_seg + (j + 1) % minor_seg
            b0 = ((i + 1) % major_seg) * minor_seg + j
            b1 = ((i + 1) % major_seg) * minor_seg + (j + 1) % minor_seg
            bm.faces.new((bm.verts[a0], bm.verts[b0], bm.verts[b1], bm.verts[a1]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot, smooth=True if smooth is None else smooth)


# ---------------------------------------------------------------- swept forms
#
# Anything whose cross-section is known at every station along a line is a
# sweep or a loft. Stating the sections is shorter and more accurate than
# pulling the shape out of a box.

def revolve(name, outline, segments=48, close_outline=True, smooth=None,
            arc=math.tau):
    """Spin a 2D outline around the Z axis.

    `outline` is [(r, z), ...] — radius out from the axis, height up it. The
    natural way to describe anything turned on a lathe: a goblet, a bottle, a
    finial, a wheel hub, a column base.

    With `close_outline` the outline is treated as a closed loop, so an outline
    that goes up the outside of a bowl, over the rim and back down the inside
    produces a real thin-walled shell rather than a solid lump. A point at
    r=0 becomes a pole and is welded.

    `arc` less than a full turn leaves it open, for a section cut away."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    full = abs(arc - math.tau) < 1e-9
    rings = []
    steps = segments if full else segments + 1
    for i in range(steps):
        a = (i / segments) * arc
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * ca, r * sa, z)) for (r, z) in outline])
    n = len(outline)
    last = len(rings) if full else len(rings) - 1
    for i in range(last):
        r0 = rings[i]
        r1 = rings[(i + 1) % len(rings)]
        for j in range(n if close_outline else n - 1):
            k = (j + 1) % n
            quad = (r0[j], r0[k], r1[k], r1[j])
            # A point on the axis is the same vertex on every ring, so the
            # quad there collapses to a triangle; remove_doubles below welds
            # it and bmesh will not accept the degenerate face meanwhile.
            if len({v.co.to_tuple(5) for v in quad}) < 3:
                continue
            try:
                bm.faces.new(quad)
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, (0, 0, 0), (0, 0, 0),
                   smooth=True if smooth is None else smooth)


def path_frames(path):
    """The orientation of a path at each of its points.

    Returns [(origin, right, up, tangent), ...]. Sweeping is only half the
    problem: anything attached to a swept form — a limb on a body, a fitting on
    a pipe — needs to know which way the surface faces there, and without this
    every caller ends up reimplementing the framing maths from `profile`."""
    out = []
    for i, p in enumerate(path):
        nxt = path[min(i + 1, len(path) - 1)]
        prv = path[max(i - 1, 0)]
        t = mathutils.Vector((nxt[0] - prv[0], nxt[1] - prv[1], nxt[2] - prv[2]))
        if t.length < 1e-9:
            t = mathutils.Vector((1.0, 0.0, 0.0))
        t.normalize()
        up = mathutils.Vector((0.0, 0.0, 1.0))
        r = t.cross(up)
        # The test has to be RELATIVE to the tangent, not an absolute epsilon.
        #
        # t is unit length, so |t x up| is the sine of the angle away from
        # vertical, and 0.05 is about three degrees. A 1e-6 guard catches only
        # the exactly-vertical case and misses the nearly-vertical one, which
        # is the one that occurs: a straight leg whose neighbours differ by a
        # millimetre has a horizontal component near 0.0016, sails past the
        # epsilon, and then supplies the entire azimuth. Measured on such a
        # leg, the frame swung ninety degrees between consecutive stations.
        if r.length < 0.05:
            # The path is running straight up, so it is parallel to the
            # reference and the cross product collapses. Falling back to a
            # fixed axis is not enough on its own: neighbouring rings then pick
            # DIFFERENT fallbacks as the tangent wobbles either side of
            # vertical, the frame snaps forty-five degrees between them, and
            # the sweep shows a hard bright pinch partway along. Carrying the
            # previous frame forward keeps it continuous.
            r = (out[-1][1] if out else mathutils.Vector((0.0, 1.0, 0.0)))
            r = r - t * r.dot(t)
            if r.length < 1e-6:
                r = mathutils.Vector((1.0, 0.0, 0.0))
        r.normalize()
        u = r.cross(t)
        out.append((mathutils.Vector(p), r, u, t))
    return out


def profile(name, section, path, close=False, smooth=None, scales=None):
    """Sweep a 2D section along a 3D path: handrails, pipes, cables, gutters.

    `section` is [(a, b), ...] in the plane perpendicular to the path;
    `path` is [(x, y, z), ...].

    `scales`, one factor per path point, tapers the section as it goes — a
    tail, a horn, a rope under tension. Without it the sweep is a constant
    hose, which is right for a handrail and wrong for anything that grew: a
    constant-radius sweep IS a pipe cleaner, and that is the whole failure
    mode of a swept tree."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    rings = []
    # Shares path_frames() rather than framing inline, so the fix for
    # near-vertical paths applies here too. Three separate models hit that
    # before these were unified: a smoke plume with a bright pinch a third of
    # the way up, and a tree trunk that barber-poled because a path wandering
    # +x then -y then +x spun the section through half a turn.
    for i, (origin, right, up, _t) in enumerate(path_frames(path)):
        k = 1.0 if scales is None else scales[min(i, len(scales) - 1)]
        ring = []
        for (sa, sb) in section:
            ring.append(bm.verts.new(origin + right * (sa * k) + up * (sb * k)))
        rings.append(ring)
    n = len(section)
    for i in range(len(rings) - 1):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
    if close:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, (0, 0, 0), (0, 0, 0),
                   smooth=True if smooth is None else smooth)


def loft(name, stations, cap_ends=True, smooth=None):
    """Sweep a *changing* closed section along X. A hull is a loft, not a grown
    form.

    `stations` is [(x, [(y, z), ...]), ...] with the same number of points in
    every ring, wound consistently."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    rings = []
    for x, section in stations:
        rings.append([bm.verts.new((x, y, z)) for (y, z) in section])
    n = len(stations[0][1])
    for i in range(len(rings) - 1):
        for j in range(n):
            k = (j + 1) % n
            a, b = rings[i][j], rings[i][k]
            c, d = rings[i + 1][k], rings[i + 1][j]
            # Skip degenerate quads where the section pinches to a point.
            if (a.co - b.co).length < 1e-6 and (d.co - c.co).length < 1e-6:
                continue
            try:
                bm.faces.new((a, b, c, d))
            except ValueError:
                pass          # duplicate face at a pinched end
    if cap_ends:
        for r, flip in ((rings[0], True), (rings[-1], False)):
            try:
                bm.faces.new(list(reversed(r)) if flip else r)
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, (0, 0, 0), (0, 0, 0),
                   smooth=True if smooth is None else smooth)


def catmull(points, n=8, closed=False):
    """A smooth curve through control points, `n` segments between each pair.

    Every organic path is a handful of control points and a spline, and without
    one every build script writes its own in the first ten minutes. Catmull-Rom
    because it passes *through* its control points, so the numbers you type are
    the positions you get."""
    pts = [mathutils.Vector(p) for p in points]
    if len(pts) < 2:
        return [tuple(p) for p in pts]
    if closed:
        ring = pts
    else:
        # Duplicate the ends so the first and last spans are curved too, rather
        # than the spline starting at the second point.
        ring = [pts[0] + (pts[0] - pts[1])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    out = []
    count = len(pts) if closed else len(ring) - 3
    for i in range(count):
        p0 = ring[i % len(ring)]
        p1 = ring[(i + 1) % len(ring)]
        p2 = ring[(i + 2) % len(ring)]
        p3 = ring[(i + 3) % len(ring)]
        for s in range(n):
            t = s / float(n)
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1) + (-p0 + p2) * t
                                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)))
    if not closed:
        out.append(tuple(pts[-1]))
    return out


def array(build, n, step=None, radius=None, start=(0, 0, 0), axis='z',
          face_out=True, jitter=(0, 0, 0), turn=0.0, scale=0.0, seed=0):
    """Place `n` copies along a line or round a circle, with optional jitter.

    `build(i, position, angle)` returns one object. A third of most scene-
    dressing code is this loop written out again — fence posts, crenellations,
    balusters, rivets, a row of barrels.

    Give `step` for a line or `radius` for a ring. `jitter` displaces, `turn`
    rotates and `scale` varies size, all by up to the amount given, from a
    seeded random so the result is reproducible."""
    import random
    rng = random.Random(seed)
    made = []
    for i in range(n):
        if radius is not None:
            a = i / float(n) * math.tau
            pos = [start[0] + math.cos(a) * radius,
                   start[1] + math.sin(a) * radius,
                   start[2]]
            angle = a + (math.pi / 2 if face_out else 0.0)
        else:
            s = step or (1.0, 0.0, 0.0)
            pos = [start[j] + s[j] * i for j in range(3)]
            angle = 0.0
        pos = [pos[j] + rng.uniform(-jitter[j], jitter[j]) for j in range(3)]
        angle += rng.uniform(-turn, turn)
        obj = build(i, tuple(pos), angle)
        if obj is None:
            continue
        if scale:
            k = 1.0 + rng.uniform(-scale, scale)
            obj.scale = (obj.scale[0] * k, obj.scale[1] * k, obj.scale[2] * k)
        made.append(obj)
    return made


def prism(name, outline, depth, loc=(0, 0, 0), rot=(0, 0, 0), plane='xz',
          smooth=None):
    """Extrude an arbitrary 2D outline into a slab.

    The shape between `loft` and `profile`: `loft` sweeps a closed section
    along X and `profile` sweeps a fixed section along a path, and neither can
    make a flat panel whose outline is just a shape you drew. Most sheet metal,
    every gable, bracket, gusset, sign board and leaf blade is one of these.

    `outline` is [(a, b), ...] wound consistently, in the plane named."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    i, j = {'xz': (0, 2), 'xy': (0, 1), 'yz': (1, 2)}[plane]
    k = 3 - i - j
    lo, hi = [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
    lo[k], hi[k] = -depth / 2.0, depth / 2.0
    rings = []
    for side in (lo, hi):
        ring = []
        for (a, b) in outline:
            co = [0.0, 0.0, 0.0]
            co[i], co[j], co[k] = a, b, side[k]
            ring.append(bm.verts.new(co))
        rings.append(ring)
    n = len(outline)
    for m in range(n):
        p = (m + 1) % n
        bm.faces.new((rings[0][m], rings[0][p], rings[1][p], rings[1][m]))
    try:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[1])
    except ValueError:
        # A self-intersecting outline cannot be capped with an n-gon. The walls
        # are still built, so say what happened rather than failing silently.
        print('WARNING prism %r: could not cap the ends, so the outline is '
              'probably self-intersecting' % name)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot, smooth=smooth)


def solidify(name, grid, thickness, smooth=None):
    """Give a parametric surface two sides and a rim.

    `grid` is a list of rows of points — a wing membrane, a sail, a leaf, a
    fin. Offsets each side along the surface normal and closes the border, so
    the result is a closed solid rather than a sheet with no thickness (which
    booleans refuse to cut and renderers shade wrongly from behind)."""
    rows, cols = len(grid), len(grid[0])
    obj, mesh = _new(name)
    bm = bmesh.new()

    def normal_at(r, c):
        p = mathutils.Vector(grid[r][c])
        du = mathutils.Vector(grid[r][min(c + 1, cols - 1)]) - \
            mathutils.Vector(grid[r][max(c - 1, 0)])
        dv = mathutils.Vector(grid[min(r + 1, rows - 1)][c]) - \
            mathutils.Vector(grid[max(r - 1, 0)][c])
        nrm = du.cross(dv)
        return nrm.normalized() if nrm.length > 1e-9 else \
            mathutils.Vector((0, 0, 1)), p

    faces = []
    for sign in (1.0, -1.0):
        layer = []
        for r in range(rows):
            row = []
            for c in range(cols):
                nrm, p = normal_at(r, c)
                row.append(bm.verts.new(p + nrm * (thickness / 2.0) * sign))
            layer.append(row)
        faces.append(layer)
    top, bot = faces
    for r in range(rows - 1):
        for c in range(cols - 1):
            bm.faces.new((top[r][c], top[r][c + 1], top[r + 1][c + 1], top[r + 1][c]))
            bm.faces.new((bot[r + 1][c], bot[r + 1][c + 1], bot[r][c + 1], bot[r][c]))
    for c in range(cols - 1):
        bm.faces.new((bot[0][c], bot[0][c + 1], top[0][c + 1], top[0][c]))
        bm.faces.new((top[rows - 1][c], top[rows - 1][c + 1],
                      bot[rows - 1][c + 1], bot[rows - 1][c]))
    for r in range(rows - 1):
        bm.faces.new((top[r][0], top[r + 1][0], bot[r + 1][0], bot[r][0]))
        bm.faces.new((bot[r][cols - 1], bot[r + 1][cols - 1],
                      top[r + 1][cols - 1], top[r][cols - 1]))
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, (0, 0, 0), (0, 0, 0), smooth=smooth)


def displace(obj, fn, cuts=0):
    """Move every vertex by a function of its position and normal.

    `fn(co, normal) -> offset vector`, or a float to move along the normal.
    Scales, rivets, bark, hammered metal, quilting — surface relief that has to
    be geometry because it breaks the silhouette, rather than a normal map that
    cannot.

    `cuts` subdivides first, since a displacement can only be as fine as the
    mesh under it."""
    if cuts:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts,
                                  use_grid_fill=True)
        bm.to_mesh(obj.data)
        bm.free()
    mesh = obj.data
    mesh.calc_normals_split() if hasattr(mesh, 'calc_normals_split') else None
    for v in mesh.vertices:
        out = fn(v.co.copy(), v.normal.copy())
        if isinstance(out, (int, float)):
            v.co = v.co + v.normal * out
        else:
            v.co = v.co + mathutils.Vector(out)
    return obj


def text(name, body, size=0.1, depth=0.01, align='CENTER', loc=(0, 0, 0),
         rot=(0, 0, 0), mat=None, resolution=4, weld=True):
    """Raised lettering, converted to a mesh.

    Small, and worth far more than its triangles on anything read close up — a
    nameplate or a dial legend is often what stops a well-made object reading
    as a toy.

    `resolution` is the curve resolution before conversion, and it matters more
    than it looks. Straight strokes are nearly free and curves are not: at a
    high resolution a dozen Roman numerals cost a few hundred triangles while a
    dozen Arabic ones cost several thousand. Lower it for small text.

    `depth` is always an extrusion toward +Z. There is no engraving mode — to
    engrave, build the text and cut it out with `lib.cut(surface, letters)`.

    `weld` merges the doubled vertices Blender's curve conversion leaves
    behind. Without it a glyph is not a closed surface — `VIII` comes back with
    seventy-six boundary edges that weld to thirty-eight vertices — and a
    boolean against it silently refuses to do anything.

    Centring is on the MESH BOUNDS, not the typographic em box. Blender centres
    on the em box, which leaves every glyph sitting high by its descender
    space; on a ring of twelve numerals that reads as a chapter ring that has
    slipped."""
    curve = bpy.data.curves.new(name, type='FONT')
    curve.body = body
    curve.size = size
    curve.align_x = align
    curve.align_y = 'CENTER'
    curve.extrude = abs(depth) / 2.0
    curve.resolution_u = max(1, int(resolution))
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    # The FONT datablock survives conversion by name and would otherwise
    # accumulate across a build with many labels.
    stale = bpy.data.curves.get(name)
    if stale is not None:
        bpy.data.curves.remove(stale)
    if weld and obj.data.vertices:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
    if align == 'CENTER' and obj.data.vertices:
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.y for v in obj.data.vertices]
        dx = (min(xs) + max(xs)) / 2.0
        dy = (min(ys) + max(ys)) / 2.0
        for v in obj.data.vertices:
            v.co.x -= dx
            v.co.y -= dy
    obj.location = loc
    obj.rotation_euler = rot
    if mat:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj

def sweep(name, path, sections, close=False, smooth=None):
    """Sweep a section that CHANGES along the path.

    `profile` scales one section uniformly, so a form that is round at one end,
    oval in the middle and keeled at the other has to pick one. This takes a
    list of sections, one per path point, each with the same point count and
    winding — so the shape itself can change, not just its size.

    Use `path_frames(path)` to work out where the surface faces if you need to
    attach anything to it."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    frames = path_frames(path)
    if len(sections) != len(path):
        raise ValueError('sweep needs one section per path point: got %d '
                         'sections for %d points' % (len(sections), len(path)))
    n = len(sections[0])
    rings = []
    for (origin, right, up, _t), section in zip(frames, sections):
        if len(section) != n:
            raise ValueError('every section must have the same point count; '
                             'got %d and %d' % (n, len(section)))
        rings.append([bm.verts.new(origin + right * a + up * b)
                      for (a, b) in section])
    for i in range(len(rings) - 1):
        for j in range(n):
            k = (j + 1) % n
            quad = (rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j])
            if len({v.co.to_tuple(5) for v in quad}) < 3:
                continue
            try:
                bm.faces.new(quad)
            except ValueError:
                pass
    if close:
        for r, flip in ((rings[0], True), (rings[-1], False)):
            try:
                bm.faces.new(list(reversed(r)) if flip else r)
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    # Honours SMOOTH_DEFAULT. A swept form is often organic and wants smoothing,
    # but forcing it here made faceted low-poly smoke read as bent rubber
    # tubing in a project whose every other surface was flat.
    return _finish(obj, mesh, (0, 0, 0), (0, 0, 0), smooth=smooth)


def rounded_box(name, size, r_upright=0.02, r_horizontal=None, loc=(0, 0, 0),
                rot=(0, 0, 0), segments=2, smooth=None):
    """A box with independent fillet radii on the upright and horizontal edges.

    `box(chamfer=)` puts the same radius on all twelve edges, and almost no
    manufactured object is made that way — a case has a generous radius on its
    four corners and a tight one where the faces meet the top. One radius for
    everything is a large part of what makes a modelled object read as CG at
    close range.

    `r_horizontal` defaults to a quarter of `r_upright`."""
    if r_horizontal is None:
        r_horizontal = r_upright * 0.25
    obj, mesh = _new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]

    def bevel(vertical, amount):
        if amount <= 0:
            return
        edges = []
        for e in bm.edges:
            d = e.verts[1].co - e.verts[0].co
            is_upright = abs(d.z) > max(abs(d.x), abs(d.y))
            if is_upright == vertical:
                edges.append(e)
        if edges:
            bmesh.ops.bevel(
                bm, geom=list({v for e in edges for v in e.verts}) + edges,
                offset=amount, segments=segments, affect='EDGES', profile=0.5,
                clamp_overlap=True)

    # Uprights first: they are usually the larger radius, and bevelling the
    # large one into a mesh that already carries the small one gives a cleaner
    # corner than the other way round.
    bevel(True, r_upright)
    bevel(False, r_horizontal)
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot, smooth=smooth)


def circle_section(r, segments=10):
    return [(math.cos(i / segments * math.tau) * r,
             math.sin(i / segments * math.tau) * r) for i in range(segments)]


def rect_section(w, h):
    return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]


# ---------------------------------------------------------------- booleans
#
# A window, a doorway, a recess, a slot: the difference between a hole cut in a
# surface and a frame stuck on top of it. Faking those with proud geometry
# works at a distance and falls apart at a grazing angle.

def boolean(target, tool, op='DIFFERENCE', solver='EXACT', keep_tool=False,
            transfer_material=True):
    """Cut, fuse or intersect `target` with `tool`, in place.

    The tool is consumed unless `keep_tool`. With `transfer_material`, faces
    created by the cut take the *tool's* material — so a hole reveals whatever
    the tool was painted, which is usually what makes it read as a hole rather
    than a black rectangle.

    Evaluates the depsgraph rather than applying the modifier through an
    operator: `bpy.ops.object.modifier_apply` depends on an active object and a
    window context that a background render does not have.

    The EXACT solver expects closed input. A target with boundary edges will
    produce something, but not reliably what you asked for."""
    before = len(target.data.polygons)
    open_edges = _boundary_edge_count(target)
    m = target.modifiers.new('_bool', 'BOOLEAN')
    m.object = tool
    m.operation = op
    m.solver = solver
    if transfer_material and hasattr(m, 'material_mode'):
        m.material_mode = 'TRANSFER'
    # The modifier is evaluated against the tool's world matrix, which is stale
    # until the depsgraph catches up with wherever the tool was just placed.
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(target.evaluated_get(dg))
    target.modifiers.remove(m)
    old = target.data
    target.data = mesh
    bpy.data.meshes.remove(old)
    if not keep_tool:
        bpy.data.objects.remove(tool, do_unlink=True)
    # A boolean against a mesh with holes in it does not fail, it quietly does
    # nothing — and a no-op that looks like success costs a whole pass before
    # anyone notices the window was never cut.
    if len(target.data.polygons) == before:
        print('WARNING boolean %s on %r changed nothing (%d faces before and '
              'after)' % (op, target.name, before))
        if open_edges:
            print('        the target has %d boundary edges; the EXACT solver '
                  'needs a closed surface' % open_edges)
        else:
            print('        check the tool actually overlaps the target')
    return target


def _boundary_edge_count(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    n = len([e for e in bm.edges if len(e.link_faces) < 2])
    bm.free()
    return n


def cut(target, tool, **kw):
    """Subtract `tool` from `target`."""
    return boolean(target, tool, 'DIFFERENCE', **kw)


def fuse(target, tool, **kw):
    """Merge `tool` into `target` as one continuous surface. Unlike
    merge_into(), which only groups meshes, this removes the interior walls
    where the two solids overlap."""
    return boolean(target, tool, 'UNION', **kw)


def intersect(target, tool, **kw):
    """Keep only the volume the two share."""
    return boolean(target, tool, 'INTERSECT', **kw)


def hole(target, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, through='y'):
    """Cut a rectangular opening through `target`.

    `size` is the opening; the axis named by `through` is stretched so the tool
    passes clear of both faces — a tool that stops flush with a surface leaves
    a zero-thickness sliver the solver has to guess about.

    `mat` paints the reveal, and is usually a shade darker than the wall."""
    s = list(size)
    s[{'x': 0, 'y': 1, 'z': 2}[through]] *= 4.0
    tool = box('_cut', s, loc, rot)
    if mat:
        attach(tool, None, mat)
    return cut(target, tool)


# ---------------------------------------------------------------- hierarchy
#
# A model that animates exports as a tree of named nodes. The animator drives
# it by name, so those names are a contract with the app.

def part(name, loc=(0, 0, 0), parent=None):
    """An empty at a joint. Its origin is the pivot the animator rotates about,
    so an arm's `part` sits at the shoulder and the meshes hang below it."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.08
    bpy.context.collection.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e


def attach(obj, parent, mat=None):
    """Parent a mesh to a part without moving it. Everything is authored in
    world coordinates and the parent's origin is subtracted here.

    A note for anything placed after a glTF IMPORT rather than built here: the
    importer leaves nodes in QUATERNION rotation mode, and assigning
    `rotation_euler` to such an object is silently ignored — the value is
    stored and never used. Set `rotation_mode = 'XYZ'` first, or write
    `rotation_quaternion`. It looks exactly like a placement bug."""
    if mat:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    if parent:
        # Setting an empty's location does not update its matrix_world until
        # the depsgraph is evaluated, so inverting it first yields the identity
        # and displaces the child by its parent's position.
        bpy.context.view_layer.update()
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def merge_into(name, parts, parent=None, mat=None):
    """Join a bag of meshes into one and hang it off a part: fewer draw calls
    and fewer nodes, for everything that does not move on its own.

    The join preserves each part's own materials, including per-face ones from
    repaint(). Passing `mat` replaces all of them with the single material
    given, so leave it out whenever the parts are already painted."""
    parts = [p for p in parts if p is not None]
    if not parts:
        return None
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    # A join leaves the origin wherever the active object's was. Reset it to
    # the world origin so the parenting above is predictable.
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return attach(obj, parent, mat)


def repaint(obj, rules, only=None):
    """Per-face materials on a grown mesh.

    A form grown out of another is the same mesh, so a second colour on it
    cannot be a second object; it has to be a face assignment. Rules are
    (material, test) applied in order, so a later rule wins where they overlap
    and the list reads outermost-last.

    `test` takes the face centre, or (centre, normal) if it accepts two
    arguments — painting a deck but not a side wall needs the normal.

    `only` restricts painting to faces already wearing one of the named
    materials. Without it a rule that says "moss below two metres" will happily
    put moss on an oak gate leaf and an iron portcullis bar, and the only way
    round it is to partition the whole build by material before joining —
    which forces every model to be material-aware for a reason that has
    nothing to do with the model."""
    slot = {}
    for mat, _ in rules:
        if mat.name not in slot:
            obj.data.materials.append(mat)
            slot[mat.name] = len(obj.data.materials) - 1
    prepared = []
    for mat, test in rules:
        try:
            nargs = test.__code__.co_argcount
        except AttributeError:
            nargs = 1
        prepared.append((mat, test, nargs >= 2))
    keep = None
    if only is not None:
        names = {only} if isinstance(only, str) else set(only)
        keep = {i for i, m in enumerate(obj.data.materials) if m and m.name in names}
        if not keep:
            print('WARNING repaint(only=%s): %r wears none of those materials, '
                  'so nothing was painted' % (sorted(names), obj.name))
            return obj
    for p in obj.data.polygons:
        if keep is not None and p.material_index not in keep:
            continue
        for mat, test, wants_normal in prepared:
            if test(p.center, p.normal) if wants_normal else test(p.center):
                p.material_index = slot[mat.name]
    return obj


def shade_auto(obj, angle_deg=38):
    """Smooth shading with a sharp-edge threshold, so a formed panel flows and
    the hard corner between two panels does not."""
    mesh = obj.data
    for p in mesh.polygons:
        p.use_smooth = True
    bm = bmesh.new()
    bm.from_mesh(mesh)
    lim = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim:
            e.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    return obj


# ---------------------------------------------------------------- export

def export(name, report=None):
    """Write <name>.glb to cfg.OUT and record what came out.

    The floor and top heights are reported because a model whose lowest vertex
    is off zero sits sunk into or floating above the ground in the app, and
    nothing in the Blender scene shows that."""
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=cfg.EXPORT_YUP, export_cameras=False,
        export_lights=False, export_extras=False,
        export_normals=True, export_tangents=False,
    )
    if report is not None:
        tris = 0
        lo, hi = 1e9, -1e9
        for o in bpy.context.scene.objects:
            if o.type != 'MESH':
                continue
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
            for v in o.data.vertices:
                z = (o.matrix_world @ v.co).z
                lo = min(lo, z)
                hi = max(hi, z)
        report.append((name, tris, lo, hi, os.path.getsize(path)))
    return path


def summarise(report, budget=None):
    budget = cfg.TRI_BUDGET if budget is None else budget
    print('=== exported ===')
    worst = 0
    for name, tris, lo, hi, size in sorted(report):
        flag = ''
        if budget and tris > budget:
            flag += '  OVER BUDGET (%d)' % budget
        if lo < -0.02:
            flag += '  SUNK %.2f' % lo
        if lo > 0.05:
            flag += '  FLOATING %.2f' % lo
        worst = max(worst, tris)
        print('%-26s %6d tris  %7.1f KB   floor %+.2f  top %+.2f%s'
              % (name, tris, size / 1024.0, lo, hi, flag))
    print('%d models, heaviest %d tris, %d tris total'
          % (len(report), worst, sum(r[1] for r in report)))
