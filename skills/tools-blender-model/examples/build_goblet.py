# A ceremonial goblet with a dragon wound round the stem, its wings the handles.
#
#   blender --background --python build_goblet.py
#
# Authored in millimetres and emitted in metres. The object is 200 mm tall, so
# every literal below is a real dimension you could put a rule against.
#
# Blender is Z-up. Heights go in Z. The goblet's axis is the Z axis and almost
# everything is placed in cylindrical coordinates about it, because a dragon
# coiled round a stem is only describable that way.
import bpy
import bmesh
import math
import os
import sys

from mathutils import Vector, Matrix, kdtree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(HERE)

import artconfig as cfg     # noqa: E402
import lib                  # noqa: E402

MM = 0.001
TAU = math.tau

NAME = 'goblet_dragon'


# ================================================================ palette

GOLD = 0xDCA843
GOLD_DEEP = 0xA9761F
SILVER = 0xCBD2D9
ENAMEL = 0x8E1B2C
GARNET = 0x780F1C
GLASS = 0xC9E4DF


def palette():
    return dict(
        gold=lib.hexmat('gold', GOLD, rough=0.24, metal=0.78),
        gold_deep=lib.hexmat('gold_deep', GOLD_DEEP, rough=0.42, metal=0.70),
        silver=lib.hexmat('silver_gilt', SILVER, rough=0.20, metal=0.85),
        enamel=lib.hexmat('enamel_red', ENAMEL, rough=0.13, metal=0.0,
                          clearcoat=0.9),
        garnet=lib.hexmat('garnet', GARNET, rough=0.07, metal=0.0,
                          emissive=0.30),
        glass=lib.hexmat('glass', GLASS, rough=0.04, metal=0.0, alpha=0.24),
    )


# ================================================================ local helpers
#
# Everything in this block is something lib.py does not have. Kept together and
# named so the report can say exactly what had to be written by hand.

def catmull(ctrl, n):
    """Resample a control polyline into a smooth curve of n points.

    Hand-authored control points are the only sane way to describe a dragon's
    spine, and a polyline through them is faceted. lib.py has no curve."""
    p = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    segs = len(ctrl) - 1
    out = []
    for i in range(n):
        t = i / (n - 1) * segs
        k = min(int(t), segs - 1)
        f = t - k
        a, b, c, d = p[k], p[k + 1], p[k + 2], p[k + 3]
        out.append(tuple(
            0.5 * (2 * b[j]
                   + (-a[j] + c[j]) * f
                   + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * f * f
                   + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * f ** 3)
            for j in range(len(b))))
    return out


def lerp_schedule(schedule, u):
    """Piecewise-linear lookup over [(u, value), ...]."""
    if u <= schedule[0][0]:
        return schedule[0][1]
    for (u0, v0), (u1, v1) in zip(schedule, schedule[1:]):
        if u <= u1:
            f = (u - u0) / max(1e-9, u1 - u0)
            return v0 + (v1 - v0) * f
    return schedule[-1][1]


def cyl_pt(theta_deg, r_mm, z_mm):
    """Cylindrical (degrees, mm, mm) to world metres."""
    a = math.radians(theta_deg)
    return (math.cos(a) * r_mm * MM, math.sin(a) * r_mm * MM, z_mm * MM)


def frame_at(path, i):
    """The (tangent, radial, up) frame lib.profile builds internally.

    Duplicated here because lib.profile does not hand it back, and nothing can
    be attached to a swept body -- a leg, a wing, a crest, a head -- without
    knowing where its surface faces."""
    nxt = path[min(i + 1, len(path) - 1)]
    prv = path[max(i - 1, 0)]
    t = (Vector(nxt) - Vector(prv))
    if t.length < 1e-9:
        t = Vector((1, 0, 0))
    t.normalize()
    up = Vector((0, 0, 1))
    r = t.cross(up)
    if r.length < 1e-6:
        r = Vector((0, 1, 0))
    r.normalize()
    u = r.cross(t)
    return t, r, u


def sheet(name, grid, thickness, smooth=True):
    """Thicken a parametric surface patch into a two-sided shell with a rim.

    A wing membrane is a surface, not a solid, and lib.py has no way to give a
    surface thickness. `grid` is rows of Vectors."""
    nu, nv = len(grid), len(grid[0])
    norm = [[None] * nv for _ in range(nu)]
    for i in range(nu):
        for j in range(nv):
            du = (Vector(grid[min(i + 1, nu - 1)][j])
                  - Vector(grid[max(i - 1, 0)][j]))
            dv = (Vector(grid[i][min(j + 1, nv - 1)])
                  - Vector(grid[i][max(j - 1, 0)]))
            n = du.cross(dv)
            norm[i][j] = n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))

    obj, mesh = lib._new(name)
    bm = bmesh.new()
    h = thickness * 0.5
    top = [[bm.verts.new(Vector(grid[i][j]) + norm[i][j] * h)
            for j in range(nv)] for i in range(nu)]
    bot = [[bm.verts.new(Vector(grid[i][j]) - norm[i][j] * h)
            for j in range(nv)] for i in range(nu)]

    def quad(a, b, c, d):
        if len({v.co.to_tuple(6) for v in (a, b, c, d)}) < 3:
            return
        try:
            bm.faces.new((a, b, c, d))
        except ValueError:
            pass

    for i in range(nu - 1):
        for j in range(nv - 1):
            quad(top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j])
            quad(bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1])
    for i in range(nu - 1):
        quad(top[i][0], top[i + 1][0], bot[i + 1][0], bot[i][0])
        quad(top[i][nv - 1], bot[i][nv - 1], bot[i + 1][nv - 1], top[i + 1][nv - 1])
    for j in range(nv - 1):
        quad(top[0][j], bot[0][j], bot[0][j + 1], top[0][j + 1])
        quad(top[nu - 1][j], top[nu - 1][j + 1], bot[nu - 1][j + 1], bot[nu - 1][j])

    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # A shell with boundary edges is not closed, and lib.boolean's EXACT solver
    # quietly does nothing to it -- which is how pass 2 shipped wings with no
    # aperture and a face count that barely moved.
    open_edges = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    if open_edges:
        print('  WARNING sheet %s has %d non-manifold edges; booleans on it '
              'will not work' % (name, open_edges))
    bm.to_mesh(mesh)
    bm.free()
    return lib._finish(obj, mesh, (0, 0, 0), (0, 0, 0), smooth=smooth)


def frame_matrix(origin, fwd, up):
    """A world matrix taking local +X to `fwd` and local +Z to `up`
    orthogonalised against it."""
    x = Vector(fwd).normalized()
    z = Vector(up)
    z = (z - x * z.dot(x))
    z.normalize()
    y = z.cross(x)
    return Matrix((
        (x.x, y.x, z.x, origin[0]),
        (x.y, y.y, z.y, origin[1]),
        (x.z, y.z, z.z, origin[2]),
        (0.0, 0.0, 0.0, 1.0)))


def oval(n, height=1.0, belly=1.0, phase=0.0):
    """A closed section for lib.profile, unit radius, to be driven by `scales`.

    In lib.profile's frame the first coordinate points radially out from the Z
    axis and the second points up, so `belly` flattens the side that presses
    against the stem."""
    pts = []
    for i in range(n):
        f = i / n * TAU + phase
        a = math.cos(f)
        b = math.sin(f) * height
        if a < 0.0:
            a *= belly
        pts.append((a, b))
    return pts


# ================================================================ the vessel

# One continuous piece of turned metal: foot, moulded bead, stem, knop and the
# seat the glass drops into. (r, z) in mm; closed by lib.revolve.
COLUMN = [
    (0.0, 0.0),
    (33.0, 0.0),
    (38.6, 0.8),
    (42.0, 2.4),
    (43.0, 5.0),        # the moulded bead, widest point, clear of the ground
    (42.2, 7.6),
    (39.2, 9.4),
    (35.2, 10.2),       # the bead rolls back under itself
    (32.6, 10.8),       # a real reentrant, so the moulding casts a shadow
    (32.4, 12.6),
    (28.0, 16.0),
    (21.5, 20.5),
    (16.0, 24.5),
    (12.4, 28.0),
    (10.8, 31.0),
    (11.7, 33.2),       # astragal at the foot of the stem
    (12.4, 34.8),
    (11.0, 36.6),
    (8.4, 39.0),
    (7.2, 44.0),
    (6.8, 56.0),        # the waist, the narrowest the dragon has to clear
    (6.9, 68.0),
    (7.6, 76.0),
    (9.4, 81.0),
    (12.6, 84.5),
    (14.2, 88.0),       # the knop / mount collar
    (13.4, 91.0),
    (11.4, 93.4),
    (12.2, 95.4),
    (14.6, 97.6),
    (15.2, 99.5),       # the lip of the seat
    (14.0, 98.6),
    (13.6, 96.6),
    (9.0, 95.2),
    (0.0, 95.0),
]

# The glass. Up the outside, across the rim, and back down the inside: a real
# shell with two surfaces and a floor, not a solid lump.
# The glass. Up the outside, across the rim, and back down the inside: a real
# shell with two surfaces and a floor, not a solid lump.
#
# 75 mm tall, 90 mm across, seated at z=96 and rimmed at 171, which leaves the
# dragon's head room to crest it. Pass 4 got that height by scaling a taller
# outline, which flattened the ogee into a straight cone and read as a martini
# glass; this is authored at its real height, with the concave-then-flaring
# wall a tulip actually has.
BOWL_OUTER = [
    (0.0, 96.0),
    (9.5, 96.0),
    (12.6, 97.8),
    (13.6, 101.0),      # the collet that sits in the seat
    (12.4, 105.0),      # a real waist: the wall draws IN before it flares
    (12.2, 110.0),
    (13.2, 115.0),
    (15.6, 120.0),
    (19.0, 125.0),
    (23.2, 130.0),
    (27.8, 135.0),
    (32.2, 140.0),
    (36.2, 145.0),
    (39.6, 150.0),
    (42.2, 155.0),
    (43.8, 160.0),
    (44.4, 164.0),
    (44.2, 167.0),      # the curve turns back in
    (45.0, 171.0),      # and everts again at the lip
]
BOWL_INNER = [
    (43.4, 171.0),
    (42.6, 167.0),
    (42.8, 164.0),
    (42.2, 160.0),
    (40.6, 155.0),
    (38.0, 150.0),
    (34.6, 145.0),
    (30.6, 140.0),
    (26.2, 135.0),
    (21.6, 130.0),
    (17.4, 125.0),
    (14.0, 120.0),
    (11.6, 115.0),
    (10.6, 110.0),
    (10.8, 105.0),
    (10.0, 101.6),
    (6.0, 100.6),
    (0.0, 100.2),       # the floor of the cup, 4.2 mm above its underside
]

# A gilt band clamping the rim: what the wingtips grip, and what makes the
# wings structural rather than stuck on.
RIM_MOUNT = [
    (44.4, 158.0),
    (45.8, 161.0),
    (46.3, 165.0),
    (46.0, 169.5),
    (45.4, 173.0),
    (42.6, 173.0),
    (42.3, 169.5),
    (43.0, 165.0),
    (43.2, 161.0),
    (43.4, 158.0),
]


def bowl_outer_r(z_mm):
    """Outer radius of the glass at a height, for clearance checks."""
    prof = BOWL_OUTER
    if z_mm <= prof[0][1]:
        return prof[0][0]
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        if z_mm <= z1:
            f = (z_mm - z0) / max(1e-9, z1 - z0)
            return r0 + (r1 - r0) * f
    return prof[-1][0]


def column_r(z_mm):
    """Outer radius of the metal column at a height, on the way up."""
    best = 0.0
    for (r0, z0), (r1, z1) in zip(COLUMN, COLUMN[1:]):
        if min(z0, z1) - 1e-9 <= z_mm <= max(z0, z1) + 1e-9:
            f = (z_mm - z0) / (z1 - z0) if abs(z1 - z0) > 1e-9 else 0.0
            best = max(best, r0 + (r1 - r0) * f)
    return best


def column_z(r_mm, z_max=34.0):
    """Height of the column's upper surface at a radius: where the tail lies
    when it is resting on the spreading foot rather than floating over it.

    `z_max` matters. Without it the search also matches the bowl seat at the
    top of the stem, where the outline passes back through the same radii, and
    the tail gets lifted 70 mm up the goblet."""
    best = None
    for (r0, z0), (r1, z1) in zip(COLUMN, COLUMN[1:]):
        if max(z0, z1) > z_max:
            continue
        if min(r0, r1) - 1e-9 <= r_mm <= max(r0, r1) + 1e-9:
            f = (r_mm - r0) / (r1 - r0) if abs(r1 - r0) > 1e-9 else 0.0
            z = z0 + (z1 - z0) * f
            best = z if best is None else max(best, z)
    return 0.0 if best is None else best


def build_vessel(mat):
    seg = 96
    column = lib.revolve('column', [(r * MM, z * MM) for (r, z) in COLUMN],
                         segments=seg)
    lib.attach(column, None, mat['gold'])

    bowl = lib.revolve('bowl_glass',
                       [(r * MM, z * MM) for (r, z) in BOWL_OUTER + BOWL_INNER],
                       segments=seg)
    lib.attach(bowl, None, mat['glass'])

    rim = lib.revolve('rim_mount', [(r * MM, z * MM) for (r, z) in RIM_MOUNT],
                      segments=seg)
    lib.attach(rim, None, mat['gold'])

    # Turned metal has arrises. Smooth-shading the whole lathe made the foot a
    # dome and lost every moulding on it; a sharp-edge threshold keeps the
    # sweeps flowing and creases the fillets between them.
    lib.shade_auto(column, angle_deg=33)
    lib.shade_auto(rim, angle_deg=33)
    lib.shade_auto(bowl, angle_deg=42)
    return column, bowl, rim


# ================================================================ the dragon

# The spine, in unwrapped (theta degrees, radius mm, height mm). Theta only
# ever increases: the coil has one direction and keeps it. The tail tip is at
# -620 and the base of the skull at 316, so the creature makes two and a half
# turns in all and one and a half of those are round the stem itself.
#
# Landmarks: -395 the tail leaves the foot and takes the stem; 115 the top of
# the coil; 135 the shoulder; 316 the base of the skull, which faces the hero
# camera at 315 while the shoulder sits opposite it at 135.
SPINE = [
    (-640, 34.5, 16.0),     # tail tip, flicked up off the foot
    (-608, 39.5, 11.6),
    (-575, 41.0, 9.6),      # right out onto the moulded bead
    (-535, 37.5, 12.2),
    (-490, 30.0, 17.2),
    (-455, 22.5, 22.4),
    (-425, 16.4, 27.5),
    (-395, 13.2, 33.5),     # onto the stem
    (-320, 12.9, 41.0),
    (-245, 12.4, 49.0),
    (-170, 12.2, 57.0),
    (-95, 12.3, 64.5),
    (-20, 12.7, 72.0),
    (55, 13.6, 79.5),
    (115, 17.2, 86.5),      # top of the coil, over the knop
    (135, 19.6, 95.0),      # shoulder
    (165, 22.6, 105.0),
    (215, 27.0, 118.0),
    (268, 31.5, 129.0),
    (300, 39.0, 148.0),
    (318, 43.0, 158.0),
    (338, 46.0, 166.0),     # base of the skull, clear above the rim
]

# Body radius as a fraction of the spine's length, in mm.
GIRTH = [
    (0.000, 0.7),
    (0.030, 1.7),
    (0.080, 2.9),
    (0.150, 3.9),
    (0.260, 4.7),
    (0.400, 5.3),
    (0.540, 5.6),
    (0.640, 5.7),
    (0.700, 5.9),           # the chest, thickest
    (0.760, 5.6),
    (0.810, 4.9),
    (0.880, 4.3),
    (1.000, 4.0),
]

SPINE_N = 300
SPINE_SECTION = 22


def spine_path():
    """The spine, resampled and then conformed to whatever it is wrapped round.

    Hand-authored radii cannot track a turned profile that changes every few
    millimetres: pass 1 had the body buried 4.2 mm inside the stem in one place
    and grazing the glass in another. So the radius of every station over the
    stem is taken from the column's own outline plus the girth there, which is
    what "wrapped round" actually means."""
    cyl = catmull([(t, r, z) for (t, r, z) in SPINE], SPINE_N)
    out = []
    for i, (t, r, z) in enumerate(cyl):
        g = lerp_schedule(GIRTH, i / (SPINE_N - 1))
        if 30.0 < z < 97.0:
            r = max(r, column_r(z) + g * 0.90 + 0.35)
        if z >= 99.0:
            r = max(r, bowl_outer_r(z) + g + 1.6)
        if z < 30.0:
            # The tail rests on the foot instead of hovering over it.
            z = max(z, column_z(r) + g * 0.80)
        out.append((t, r, z))
    return [cyl_pt(*p) for p in out], out


def emboss_scales(obj, path, n_section, amp=0.55, rows=2.4):
    """Overlapping scales, embossed into the swept body after the fact.

    lib.profile sweeps ONE section and scales it, so the section cannot change
    shape from station to station and there is no way to ask for scales while
    it sweeps. The vertices come out ring by ring in path order, so they can be
    pushed out afterwards: a sawtooth that ramps out along the body and drops
    at every seam, staggered on alternate columns, faded off on the belly."""
    verts = obj.data.vertices
    if len(verts) != len(path) * n_section:
        print('  WARNING scale emboss skipped: %d verts, expected %d'
              % (len(verts), len(path) * n_section))
        return obj
    for i in range(len(path)):
        c = Vector(path[i])
        for j in range(n_section):
            w = max(0.0, math.cos(j / n_section * TAU)) ** 0.55
            if w < 1e-3:
                continue
            v = verts[i * n_section + j]
            d = Vector(v.co) - c
            if d.length < 1e-9:
                continue
            ramp = (i / rows + (0.5 if (j % 2) else 0.0)) % 1.0
            v.co = c + d.normalized() * (d.length + amp * MM * w * ramp)
    lib.shade_auto(obj, angle_deg=24)
    return obj


def build_body(mat):
    path, cylp = spine_path()
    scales = [lerp_schedule(GIRTH, i / (SPINE_N - 1)) * MM
              for i in range(SPINE_N)]
    body = lib.profile('dragon_body',
                       oval(SPINE_SECTION, height=1.12, belly=0.82),
                       path, close=True, scales=scales)
    lib.attach(body, None, mat['gold'])
    emboss_scales(body, path, SPINE_SECTION)
    return body, path, cylp, scales


def build_crest(mat, path, scales):
    """A serrated dorsal fin, standing off the back all the way down the tail.

    The back faces radially outward from the goblet's axis, so the crest is
    built on the +radial side of lib.profile's own frame."""
    rows = []
    lo, hi = 8, SPINE_N - 4
    for i in range(lo, hi):
        u = (i - lo) / (hi - lo - 1)
        t, r, up = frame_at(path, i)
        base = Vector(path[i]) + r * (scales[i] * 0.88)
        # A sawtooth that rises slowly and drops sharply: each bay is a spine
        # raked backwards, not a symmetric tooth.
        bays = 16.0
        ph = (u * bays) % 1.0
        saw = ph ** 0.62
        env = lerp_schedule([(0.00, 0.0), (0.05, 0.55), (0.24, 1.0),
                             (0.88, 1.0), (0.97, 0.8), (1.00, 0.0)], u)
        h = (1.4 + 9.0 * saw) * env * MM
        rows.append([base, base + r * h])
    fin = sheet('dragon_crest', rows, 1.25 * MM)
    lib.attach(fin, None, mat['gold_deep'])
    return fin


# --------------------------------------------------------------- head

SKULL = [
    # (x, half-width, top z, bottom z) in mm, local: +X forward, +Z dorsal
    (0.0, 8.6, 9.0, -7.4),
    (3.0, 9.8, 10.8, -7.8),
    (8.0, 10.5, 11.4, -7.9),    # brow ridge, standing well over the eye
    (13.0, 10.4, 9.8, -7.6),    # eye
    (18.0, 8.8, 7.2, -7.0),
    (24.0, 7.0, 5.2, -6.4),
    (31.0, 5.9, 3.8, -6.0),
    (38.0, 5.0, 2.4, -5.8),
    (43.0, 4.2, 1.2, -5.6),
    (46.0, 3.0, -0.2, -5.2),
    (47.6, 0.7, -2.2, -4.4),    # the nose, tipped down
]

# The jaw stops short of the nose, so the snout overhangs it. A jaw that runs
# the full length of the skull is a crocodile.
JAW = [
    (0.5, 7.6, -7.6, -14.4),
    (5.0, 8.5, -7.6, -15.0),
    (12.0, 8.2, -7.4, -14.4),
    (20.0, 7.0, -7.2, -13.0),
    (28.0, 5.8, -7.0, -11.6),
    (36.0, 4.7, -6.8, -10.2),
    (42.0, 3.8, -6.6, -9.2),
    (45.0, 2.5, -6.4, -8.2),
    (46.2, 0.7, -6.0, -6.8),
]


def section_from(w, top, bot, n=14, flat_bottom=0.0):
    """A closed (y, z) ring for lib.loft from a width and two heights."""
    cz = (top + bot) * 0.5
    hz = (top - bot) * 0.5
    pts = []
    for i in range(n):
        f = i / n * TAU
        y = math.cos(f) * w
        s = math.sin(f)
        z = cz + s * hz
        if flat_bottom and s < 0:
            z = cz + s * hz * (1.0 - flat_bottom * abs(math.cos(f)) * 0)
        pts.append((y * MM, z * MM))
    return pts


def _band(table, x, col):
    """Interpolate one column of SKULL/JAW at a station along the muzzle."""
    if x <= table[0][0]:
        return table[0][col]
    for a, b in zip(table, table[1:]):
        if x <= b[0]:
            f = (x - a[0]) / max(1e-9, b[0] - a[0])
            return a[col] + (b[col] - a[col]) * f
    return table[-1][col]


# The skull is authored 47.6 mm long and then foreshortened. A head that long
# on a neck that looks along the rim swings out on a tangent: pass 3 put the
# muzzle at r=73 mm, wider than the wings. Shorter is also more heraldic --
# a blunt-nosed beast rather than a crocodile.
HX = 0.73

JAW_OPEN_DEG = 24.0
JAW_HINGE = (1.0 * HX, -9.6)    # (x, z) in head-local mm, x already scaled


def _jaw_world(x, z):
    """Where a point on the closed jaw ends up once the jaw is swung open."""
    a = math.radians(JAW_OPEN_DEG)
    dx, dz = x - JAW_HINGE[0], z - JAW_HINGE[1]
    return (JAW_HINGE[0] + dx * math.cos(a) + dz * math.sin(a),
            JAW_HINGE[1] - dx * math.sin(a) + dz * math.cos(a))


def build_head(mat, origin, fwd, dorsal, pitch_deg=0.0, roll_deg=0.0):
    parts = []

    skull = lib.loft('skull', [(x * HX * MM, section_from(w, t, b))
                               for (x, w, t, b) in SKULL])
    lib.attach(skull, None, mat['gold'])
    parts.append(skull)

    jaw = lib.loft('jaw', [(x * HX * MM, section_from(w, t, b))
                           for (x, w, t, b) in JAW])
    # Swing the jaw open about the hinge behind the last tooth. Pass 1 had this
    # sign inverted, which rotated the jaw up inside the skull and left the
    # head a smooth teardrop with no mouth at all.
    hinge = Vector((JAW_HINGE[0] * MM, 0.0, JAW_HINGE[1] * MM))
    jaw.matrix_world = (Matrix.Translation(hinge)
                        @ Matrix.Rotation(math.radians(JAW_OPEN_DEG), 4, 'Y')
                        @ Matrix.Translation(-hinge))
    lib.attach(jaw, None, mat['gold'])
    parts.append(jaw)

    for side in (1, -1):
        # Horns: off the back of the brow, swept back, out and up, with a
        # kick at the tip. 30 mm long -- as long as the muzzle, or they read
        # as bumps.
        ctrl = [(2.0, 4.6 * side, 6.6),
                (-2.0, 7.0 * side, 13.0),
                (-6.0, 8.8 * side, 20.0),
                (-11.0, 9.0 * side, 27.0),
                (-16.0, 8.0 * side, 32.0),
                (-19.0, 6.6 * side, 36.0)]
        p = [(x * HX * MM, y * MM, z * MM) for (x, y, z) in catmull(ctrl, 26)]
        sc = [lerp_schedule([(0.0, 3.5), (0.30, 2.6), (0.70, 1.5), (1.0, 0.22)],
                            i / 25) * MM for i in range(26)]
        horn = lib.profile('horn_%d' % side, oval(10, height=0.85), p,
                           close=True, scales=sc)
        lib.attach(horn, None, mat['gold_deep'])
        parts.append(horn)

        # A short swept-back cheek frill. Pass 2 ran this out to 20 mm on the
        # same backward line as the horn, which gave the head four matching
        # tentacles instead of two horns and two cheeks.
        ctrl = [(1.0, 7.4 * side, -3.0),
                (-4.0, 9.6 * side, -1.6),
                (-9.0, 10.4 * side, 0.6)]
        p = [(x * HX * MM, y * MM, z * MM) for (x, y, z) in catmull(ctrl, 12)]
        sc = [lerp_schedule([(0.0, 2.6), (0.6, 1.7), (1.0, 0.3)],
                            i / 11) * MM for i in range(12)]
        frill = lib.profile('frill_%d' % side, oval(8, height=0.32), p,
                            close=True, scales=sc)
        lib.attach(frill, None, mat['gold_deep'])
        parts.append(frill)

        # Eye and brow, both set OUTSIDE the skull's own half width. Pass 1
        # authored them at y=7.4 where the skull is 10.0 wide, so every one of
        # them was buried and the head had no face.
        ew = _band(SKULL, 13.4, 1)
        brow = lib.sphere('brow_%d' % side, 1.0,
                          loc=(0, 0, 0), subdiv=2)
        brow.matrix_world = (
            Matrix.Translation((12.2 * HX * MM, (ew - 1.2) * side * MM, 4.6 * MM))
            @ Matrix.Diagonal((5.6 * MM, 2.6 * MM, 2.0 * MM, 1.0)))
        lib.attach(brow, None, mat['gold'])
        parts.append(brow)

        eye = lib.sphere('eye_%d' % side, 1.0, loc=(0, 0, 0), subdiv=3)
        eye.matrix_world = (
            Matrix.Translation((13.8 * HX * MM, (ew - 0.4) * side * MM, 1.6 * MM))
            @ Matrix.Diagonal((2.9 * MM, 2.4 * MM, 2.5 * MM, 1.0)))
        lib.attach(eye, None, mat['garnet'])
        parts.append(eye)

        # Teeth, set on the tooth row itself: the upper ones hang from the
        # palate line, the lower ones stand up out of the opened jaw.
        for k, tx in enumerate((9.0, 16.0, 23.0, 30.0, 37.0, 43.0)):
            w = _band(SKULL, tx, 1) - 1.3
            zb = _band(SKULL, tx, 3)
            tl = lerp_schedule([(9.0, 3.6), (21.0, 4.2), (33.0, 3.0),
                                (44.0, 1.8)], tx)
            t = lib.cyl('tooth_u%d_%d' % (k, side), 1.25 * MM, 0.02 * MM,
                        tl * MM,
                        loc=(tx * HX * MM, w * side * MM, (zb - tl * 0.42) * MM),
                        rot=(math.pi, 0, 0), segments=6)
            lib.attach(t, None, mat['silver'])
            parts.append(t)
        for k, tx in enumerate((12.0, 20.0, 28.0, 36.0, 43.0)):
            w = _band(JAW, tx, 1) - 1.2
            zt = _band(JAW, tx, 2)
            tl = lerp_schedule([(11.0, 3.4), (25.0, 3.8), (39.0, 2.4),
                                (45.0, 1.5)], tx)
            wx, wz = _jaw_world(tx * HX, zt)
            t = lib.cyl('tooth_l%d_%d' % (k, side), 1.15 * MM, 0.02 * MM,
                        tl * MM,
                        loc=(wx * MM, w * side * MM, (wz + tl * 0.42) * MM),
                        rot=(0, math.radians(JAW_OPEN_DEG), 0),
                        segments=6)
            lib.attach(t, None, mat['silver'])
            parts.append(t)

        # Nostril flare on the ridge of the muzzle.
        nw = _band(SKULL, 42.0, 1)
        n = lib.sphere('nostril_%d' % side, 1.0, loc=(0, 0, 0), subdiv=2)
        n.matrix_world = (
            Matrix.Translation((42.0 * HX * MM, (nw - 0.9) * side * MM, 0.6 * MM))
            @ Matrix.Diagonal((2.4 * MM, 1.5 * MM, 1.4 * MM, 1.0)))
        lib.attach(n, None, mat['gold_deep'])
        parts.append(n)

    # Take the whole assembly onto the neck. matrix_world is stale on a freshly
    # created object until the depsgraph runs, so the local transforms have to
    # be read after an explicit update or every part lands on the origin.
    f = Vector(fwd).normalized()
    d = Vector(dorsal)
    d = (d - f * d.dot(f)).normalized()
    side_ax = d.cross(f)
    if pitch_deg:
        q = Matrix.Rotation(math.radians(pitch_deg), 3, side_ax)
        f, d = q @ f, q @ d
    if roll_deg:
        q = Matrix.Rotation(math.radians(roll_deg), 3, f)
        d = q @ d
    bpy.context.view_layer.update()
    locals_ = [p.matrix_world.copy() for p in parts]
    M = frame_matrix(origin, f, d)
    for p, m in zip(parts, locals_):
        p.matrix_world = M @ m
    return parts


# --------------------------------------------------------------- legs

def build_leg(mat, name, hip, hip_frame, reach, spread, size=1.0, grip_r=8.0):
    """One clawed leg from a point on the body to a grip on the column.

    `hip` is a world point, `hip_frame` the (tangent, radial, up) there.
    `reach` is where the foot lands, in world metres."""
    t, r, up = hip_frame
    parts = []
    hipv = Vector(hip)
    footv = Vector(reach)

    knee = (hipv * 0.42 + footv * 0.58) + (r * (10.0 * size * MM)
                                           + up * spread * (7.0 * size * MM))
    ctrl = [tuple(hipv),
            tuple(hipv * 0.72 + knee * 0.28 + r * (3.0 * size * MM)),
            tuple(knee),
            tuple(knee * 0.45 + footv * 0.55),
            tuple(footv)]
    p = catmull(ctrl, 24)
    sc = [lerp_schedule([(0.0, 4.2), (0.30, 3.2), (0.55, 2.3), (0.80, 1.9),
                         (1.0, 1.9)], i / 23) * size * MM for i in range(24)]
    limb = lib.profile(name, oval(12, height=1.05), p, close=True, scales=sc)
    lib.attach(limb, None, mat['gold'])
    parts.append(limb)

    # The foot itself, and three claws hooked round the column.
    pad = lib.sphere(name + '_pad', 2.6 * size * MM, loc=tuple(footv),
                     subdiv=2, scale=(1.3, 1.1, 0.8))
    lib.attach(pad, None, mat['gold'])
    parts.append(pad)

    axis_out = Vector((footv.x, footv.y, 0.0))
    if axis_out.length < 1e-9:
        axis_out = Vector((1, 0, 0))
    axis_out.normalize()
    tang = Vector((-axis_out.y, axis_out.x, 0.0))
    for k, ang in enumerate((-46.0, 0.0, 46.0)):
        a = math.radians(ang)
        d = (tang * math.sin(a) + Vector((0, 0, 1)) * math.cos(a) * 0.55
             - axis_out * 0.55).normalized()
        ctrl = [tuple(footv + d * (1.4 * size * MM)),
                tuple(footv + d * (4.0 * size * MM)
                      - axis_out * (1.6 * size * MM)),
                tuple(footv + d * (5.6 * size * MM)
                      - axis_out * (4.4 * size * MM)),
                tuple(footv + d * (5.2 * size * MM)
                      - axis_out * (6.6 * size * MM))]
        p = catmull(ctrl, 12)
        sc = [lerp_schedule([(0.0, 1.5), (0.55, 1.0), (1.0, 0.12)],
                            i / 11) * size * MM for i in range(12)]
        claw = lib.profile('%s_claw%d' % (name, k), oval(8), p, close=True,
                           scales=sc)
        lib.attach(claw, None, mat['silver'])
        parts.append(claw)
    return parts


# --------------------------------------------------------------- wings

# Leading edge and trailing edge of one wing, as (theta offset from the
# shoulder, radius mm, height mm). The wing sweeps ninety degrees round the
# goblet and lands on the rim mount, so shoulder and wingtip are two real
# attachment points with the bowl between them.
# Pass 1 ran the leading edge out to 50 mm against a 45 mm bowl, so the
# membrane lay flat on the glass and top.png showed the wings almost entirely
# inside the rim: decoration, not handles. These stand the wing off to 62 mm,
# which puts 20 to 38 mm of daylight between the membrane and the glass -- a
# gap you can get a hand into -- and swings the tips round to +/-100 degrees so
# one wing sits on each side of the front rather than both behind it.
# The projection matters as much as the size. A wing wrapped round the goblet
# at radius R only reaches R on the screen where it is 90 degrees from the
# camera; pass 3 put its widest point 128 degrees away, so 61 mm of wing
# projected to 48 mm and vanished inside a 46 mm bowl. The bulge is now at
# -82 degrees from the shoulder, which is 90 degrees from the hero camera, and
# it stands 14 mm proud of the rim there.
WING_LEAD = [
    (0.0, 22.0, 100.0),     # shoulder: attachment one
    (-20.0, 38.0, 112.0),
    (-42.0, 52.0, 126.0),
    (-64.0, 62.0, 142.0),
    (-82.0, 63.0, 157.0),   # widest, square on to the camera
    (-97.0, 47.5, 167.0),   # rim mount: attachment two
]
WING_TRAIL = [
    (0.0, 17.0, 90.0),
    (-26.0, 36.0, 92.0),
    (-52.0, 48.0, 98.0),
    (-74.0, 56.0, 112.0),
    (-90.0, 58.0, 136.0),
    # NOT the same point as the leading edge's tip. A chord that closes to zero
    # collapses the last grid row to a point, every quad there is rejected as
    # degenerate, and the shell is left with a hole -- which makes it
    # non-manifold and makes every boolean on it a no-op.
    (-97.0, 46.5, 164.0),
]

WING_SWEEP = -97.0
WING_U = 36
WING_V = 10


def wing_curves(theta_shoulder, sign, n):
    lead = catmull(WING_LEAD, n)
    trail = catmull(WING_TRAIL, n)
    out = []
    for i in range(n):
        u = i / (n - 1)
        lt, lr, lz = lead[i]
        tt, tr, tz = trail[i]
        # Three scalloped bays between the ribs: the trailing edge is pulled in
        # at the notches and hangs at the finger tips.
        ph = (u * 3.0) % 1.0
        chord = 0.46 + 0.54 * math.sin(math.pi * ph)
        out.append((
            (theta_shoulder + lt * sign, lr, lz),
            (theta_shoulder + (lt + (tt - lt) * chord) * sign,
             lr + (tr - lr) * chord,
             lz + (tz - lz) * chord)))
    return out


def build_wing(mat, name, theta_shoulder, sign):
    curves = wing_curves(theta_shoulder, sign, WING_U)
    grid = []
    for i, (L, T) in enumerate(curves):
        u = i / (WING_U - 1)
        row = []
        Lv = Vector(cyl_pt(*L))
        Tv = Vector(cyl_pt(*T))
        for j in range(WING_V):
            v = j / (WING_V - 1)
            p = Lv + (Tv - Lv) * v
            # Billow: the membrane is a sail, not a flat plate. Pushed away
            # from the goblet's axis so it never cuts into the bowl.
            rad = Vector((p.x, p.y, 0.0))
            rad = rad.normalized() if rad.length > 1e-9 else Vector((1, 0, 0))
            bulge = math.sin(math.pi * v) * math.sin(math.pi * min(1.0, u * 1.1))
            row.append(p + rad * (bulge * 3.4 * MM))
        grid.append(row)

    memb = sheet(name + '_membrane', grid, 1.5 * MM)
    lib.attach(memb, None, mat['enamel'])

    parts = [memb]

    # Leading spar: root to elbow to wrist to the claw. This is what a hand
    # actually grips.
    lead_pts = [cyl_pt(theta_shoulder + t * sign, r, z)
                for (t, r, z) in catmull(WING_LEAD, 30)]
    sc = [lerp_schedule([(0.0, 3.4), (0.25, 2.7), (0.55, 2.2), (0.80, 1.7),
                         (1.0, 1.3)], i / 29) * MM for i in range(30)]
    spar = lib.profile(name + '_spar', oval(10, height=1.1), lead_pts,
                       close=True, scales=sc)
    lib.attach(spar, None, mat['gold'])
    parts.append(spar)

    # Ribs fanning from the elbow to the trailing-edge points.
    elbow_i = int(0.36 * (WING_U - 1))
    elbow = Vector(cyl_pt(*curves[elbow_i][0]))
    for k, ui in enumerate((0.52, 0.70, 0.88)):
        i = int(ui * (WING_U - 1))
        tip = Vector(cyl_pt(*curves[i][1]))
        mid = (elbow + tip) * 0.5
        rad = Vector((mid.x, mid.y, 0.0)).normalized()
        ctrl = [tuple(elbow), tuple(mid + rad * (1.6 * MM)), tuple(tip)]
        p = catmull(ctrl, 16)
        rsc = [lerp_schedule([(0.0, 1.9), (0.7, 1.3), (1.0, 0.7)],
                             i2 / 15) * MM for i2 in range(16)]
        rib = lib.profile('%s_rib%d' % (name, k), oval(8), p, close=True,
                          scales=rsc)
        lib.attach(rib, None, mat['gold'])
        parts.append(rib)

        # A small claw on each finger tip.
        d = (tip - mid).normalized()
        cctrl = [tuple(tip), tuple(tip + d * (2.2 * MM)
                                   - Vector((0, 0, 1)) * (0.8 * MM)),
                 tuple(tip + d * (3.4 * MM) - Vector((0, 0, 1)) * (2.6 * MM))]
        cp = catmull(cctrl, 10)
        csc = [lerp_schedule([(0.0, 1.0), (1.0, 0.1)], i2 / 9) * MM
               for i2 in range(10)]
        cl = lib.profile('%s_fclaw%d' % (name, k), oval(7), cp, close=True,
                         scales=csc)
        lib.attach(cl, None, mat['silver'])
        parts.append(cl)

    # Shoulder boss where the wing meets the body.
    root = Vector(cyl_pt(theta_shoulder, 19.0, 96.0))
    boss = lib.sphere(name + '_boss', 5.4 * MM, loc=tuple(root), subdiv=2,
                      scale=(1.0, 1.0, 0.85))
    lib.attach(boss, None, mat['gold'])
    parts.append(boss)

    # The wingtip hand, clamped on the rim mount: the second attachment.
    tipv = Vector(cyl_pt(theta_shoulder + WING_SWEEP * sign, 47.5, 167.0))
    hand = lib.sphere(name + '_hand', 3.6 * MM, loc=tuple(tipv), subdiv=2,
                      scale=(1.0, 1.2, 1.0))
    lib.attach(hand, None, mat['gold'])
    parts.append(hand)
    axis_out = Vector((tipv.x, tipv.y, 0.0)).normalized()
    tang = Vector((-axis_out.y, axis_out.x, 0.0))
    for k, ang in enumerate((-38.0, 0.0, 38.0)):
        a = math.radians(ang)
        d = (tang * math.sin(a) + Vector((0, 0, 1)) * math.cos(a)).normalized()
        ctrl = [tuple(tipv + d * (2.2 * MM)),
                tuple(tipv + d * (5.2 * MM) - axis_out * (1.4 * MM)),
                tuple(tipv + d * (6.4 * MM) - axis_out * (4.4 * MM))]
        p = catmull(ctrl, 12)
        sc2 = [lerp_schedule([(0.0, 1.4), (0.6, 0.9), (1.0, 0.1)],
                             i2 / 11) * MM for i2 in range(12)]
        cl = lib.profile('%s_tclaw%d' % (name, k), oval(8), p, close=True,
                         scales=sc2)
        lib.attach(cl, None, mat['silver'])
        parts.append(cl)

    return parts, curves


# The pierced tracery: three real openings per wing, one to a bay, biggest at
# the elbow where a hand goes. (u along the wing, v across the chord, and the
# two semi-axes of the opening in mm).
APERTURES = (
    (0.32, 0.48, 13.0, 8.5),
    (0.56, 0.50, 13.0, 9.0),
    (0.79, 0.52, 9.0, 6.0),
)


def pierce_wing(memb, curves, mat, name):
    """Cut the finger holes through the membrane and bead their edges.

    Without these the wings are decoration. Returns the beads."""
    beads = []
    for k, (u, v, ra, rb) in enumerate(APERTURES):
        i = int(u * (len(curves) - 1))
        L = Vector(cyl_pt(*curves[i][0]))
        T = Vector(cyl_pt(*curves[i][1]))
        c = L + (T - L) * v
        rad = Vector((c.x, c.y, 0.0)).normalized()
        # Follow the surface: one axis across the chord, the other along the
        # wing, the third straight through the membrane.
        along = (T - L).normalized()
        nxt = int(min(0.98, u + 0.10) * (len(curves) - 1))
        span = (Vector(cyl_pt(*curves[nxt][0])) - L)
        span = (span - along * span.dot(along)).normalized()
        # Never wider than the chord it sits in, or the cut opens a notch in
        # the trailing edge instead of a hole in the middle of the membrane.
        ra = min(ra, 0.33 * (T - L).length / MM)

        before = len(memb.data.polygons)
        frame = Matrix((
            (along.x, span.x, rad.x, c.x),
            (along.y, span.y, rad.y, c.y),
            (along.z, span.z, rad.z, c.z),
            (0, 0, 0, 1)))
        tool = lib.sphere('_aperture%d' % k, 1.0, subdiv=4)
        tool.matrix_world = frame @ Matrix.Diagonal(
            (ra * MM, rb * MM, 30.0 * MM, 1.0))
        lib.cut(memb, tool)
        print('  %s aperture %d: %.0f x %.0f mm opening at r=%.0f z=%.0f,'
              ' %d -> %d faces'
              % (name, k, ra * 2, rb * 2, math.hypot(c.x, c.y) / MM,
                 c.z / MM, before, len(memb.data.polygons)))

        bead = lib.torus('%s_bead%d' % (name, k), 1.0, 0.16,
                         major_seg=30, minor_seg=8)
        bead.matrix_world = frame @ Matrix.Diagonal(
            ((ra + 0.7) * MM, (rb + 0.7) * MM, 4.2 * MM, 1.0))
        lib.attach(bead, None, mat['gold'])
        beads.append(bead)
    lib.shade_auto(memb, angle_deg=30)
    return beads


# ================================================================ assembly

def build():
    lib.reset()
    mat = palette()
    report = []

    column, bowl, rim = build_vessel(mat)
    body, path, cylp, scales = build_body(mat)
    crest = build_crest(mat, path, scales)

    # --- head, off the end of the neck ---
    # Pass 2 pointed the head straight up. A 48 mm skull on a vertical neck
    # puts its "back" downwards, so the horns and frills swept down beside the
    # throat and side.png read as four tentacles hanging off a manatee.
    #
    # Turning the head to look ALONG the rim instead fixes three things at
    # once: the skull's length is spent going round the goblet rather than out
    # from it, the horns trail back over the neck where horns belong, and the
    # width axis points radially -- so a viewer standing outside the goblet
    # sees the head in true profile, which is how metalwork presents a beast.
    head_origin = Vector(path[-1])
    rad_end = Vector((head_origin.x, head_origin.y, 0.0)).normalized()
    tang_end = Vector((-rad_end.y, rad_end.x, 0.0))
    fwd = (tang_end * 0.40 + Vector((0, 0, 1)) * 0.91
           + rad_end * 0.08).normalized()
    head = build_head(mat, tuple(head_origin), tuple(fwd), (0.0, 0.0, 1.0),
                      pitch_deg=0.0, roll_deg=-14.0)

    # --- legs ---
    legs = []
    # Control point indices, not guessed fractions. Pass 1 put the forelegs at
    # 0.78 of the spine, which after the extra tail point lands halfway up the
    # THROAT: side.png showed a limb growing out of the neck and reaching down
    # across the bowl. P15 is the shoulder and P10/P11 are on the coil.
    n = len(SPINE) - 1
    fore_i = int(round(14.6 / n * (SPINE_N - 1)))
    hind_i = int(round(10.4 / n * (SPINE_N - 1)))
    for idx, dtheta, reach_r, reach_z, size in (
            (fore_i, 40.0, 13.5, 86.0, 1.0),
            (fore_i, -34.0, 13.5, 81.0, 1.0),
            (hind_i, 44.0, 7.4, 52.0, 0.80),
            (hind_i, -40.0, 7.4, 46.0, 0.80)):
        hip = Vector(path[idx])
        fr = frame_at(path, idx)
        th = math.degrees(math.atan2(hip.y, hip.x))
        reach = Vector(cyl_pt(th + dtheta, reach_r, reach_z))
        legs += build_leg(mat, 'leg_%d_%d' % (idx, int(dtheta)),
                          tuple(hip), fr, tuple(reach),
                          spread=1.0 if dtheta > 0 else -1.0, size=size)

    # --- wings ---
    theta_shoulder = 135.0
    wing_a, curves_a = build_wing(mat, 'wing_a', theta_shoulder, 1.0)
    wing_b, curves_b = build_wing(mat, 'wing_b', theta_shoulder, -1.0)
    beads = (pierce_wing(wing_a[0], curves_a, mat, 'wing_a')
             + pierce_wing(wing_b[0], curves_b, mat, 'wing_b'))

    # --- report the numbers a picture will not tell me ---
    print('--- clearances (mm) ---')
    worst = 1e9
    for i in range(SPINE_N):
        th, r, z = cylp[i]
        gap = r - scales[i] / MM - column_r(z)
        if 30 < z < 96:
            worst = min(worst, gap)
    print('body-to-column minimum gap over the stem: %+.2f' % worst)
    wb, wat = 1e9, None
    for i in range(SPINE_N):
        th, r, z = cylp[i]
        if z > 100:
            gap = r - scales[i] / MM - bowl_outer_r(z)
            if gap < wb:
                wb, wat = gap, (i, r, z, bowl_outer_r(z), scales[i] / MM)
    print('neck-to-glass minimum gap:                %+.2f  at %s' % (wb, wat))
    turns = (SPINE[-1][0] - SPINE[0][0]) / 360.0
    stem = (115.0 - (-395.0)) / 360.0
    print('spiral: %.2f turns total, %.2f of them round the stem' % (turns, stem))
    mz = max((p.matrix_world @ v.co).z for p in head if p.type == 'MESH'
             for v in p.data.vertices) / MM
    mr = max(math.hypot((p.matrix_world @ v.co).x, (p.matrix_world @ v.co).y)
             for p in head if p.type == 'MESH' for v in p.data.vertices) / MM
    print('head reaches z=%.1f mm (glass rim at 197.6), out to r=%.1f mm' % (mz, mr))

    # --- prove the wings are attached at two points, not one ---
    def _tree(obj):
        t = kdtree.KDTree(len(obj.data.vertices))
        for i, v in enumerate(obj.data.vertices):
            t.insert(v.co, i)
        t.balance()
        return t

    tbody, trim = _tree(body), _tree(rim)
    for nm, parts in (('wing_a', wing_a), ('wing_b', wing_b)):
        db = min(tbody.find(v.co)[2] for o in parts for v in o.data.vertices)
        dr = min(trim.find(v.co)[2] for o in parts for v in o.data.vertices)
        print('%s touches the dragon body at %.2f mm and the rim mount at '
              '%.2f mm' % (nm, db / MM, dr / MM))

    print('material groups: %s'
          % ', '.join(sorted({m.name for o in bpy.context.scene.objects
                              if o.type == 'MESH' for m in o.data.materials})))

    # --- material groups ---
    glass_grp = lib.merge_into('bowl_glass', [bowl])
    metal_grp = lib.merge_into('vessel_metal', [column, rim])
    dragon_grp = lib.merge_into(
        'dragon', [body, crest] + head + legs + wing_a + wing_b + beads)

    lib.export(NAME, report)
    lib.summarise(report)
    return glass_grp, metal_grp, dragon_grp


if __name__ == '__main__':
    build()
