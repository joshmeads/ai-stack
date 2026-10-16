# A modular ruined castle: 27,118 triangles, 71 x 61 x 28 m, eight
# build-render-look cycles.
#
# Built as a capability test - can parametric code hold together at this scale,
# and does ageing expressed purely as GEOMETRY read as ageing? Both answers are
# yes, with one caveat: ageing reads when it is STRUCTURAL (a wall top slumping
# course by course, a tower broken into independent staves of unequal height,
# crenellations missing teeth in runs) and not when it is surface noise. The
# per-vertex face roughness in here is invisible at every distance.
#
# It needs a retuned artconfig.py. The shipped defaults assume a prop, not a
# building:
#
#     GRID_STEP  = 5.0     # checker_grid derives its extent as STEP * 9, so
#     GRID_MAJOR = 10.0    # the default laid an 18 m mat under a 66 m building
#     CYL_SEGMENTS = 12
#     RES = 1000
#     TRI_BUDGET = 60000
#     SUN_FROM = (25.0, -85.0, 70.0)   # so +Y is genuinely never lit
#
# NOTE ON FIDELITY: baked to a 4096 map this comes out at 14.7 texels per
# metre. That is fine at the isometric game camera it was built for and far
# too coarse to walk up to - see the fidelity budget section of SKILL.md. A
# building at close range has to be a modular kit, not one object.
#
# A half-ruined Welsh march castle, still lived in.
#
#   blender --background --python build_castle.py -- castle
#   blender --background --python shots.py        -- castle
#
# Metres, Z up, the enclosure centred on the world origin. +Y is north, so +Y
# faces never see the sun (see SUN_FROM in artconfig) and are where moss goes.
#
# Everything here is parametric. There is one curtain-wall function, one drum
# function, one crenellation function, one prism function for the timber
# buildings, and one rubble function; the castle is those called with numbers.
# Nothing is authored stone by stone, because at this size that does not fit in
# a head or a context window.
#
# The ageing is geometry, not texture. Three techniques, in order of how much
# they earn:
#
#   1. A shared top-surface function per wall run. Form.warp() scales every
#      vertex's Z by surface(u) / Z_BUILD, and the merlons and the parapet sill
#      are *placed* at surface(u) too. One function, so the crenellations sit
#      on the slumped wall instead of hovering over where it used to be.
#   2. Broken masonry as a ring of staves of unequal height, not a cylinder
#      with a lid. A jagged rim and a hollow interior fall out of it for free,
#      and the floor ledges inside are then visible from above.
#   3. Deterministic pseudo-noise from the coordinates, everywhere. Same seed,
#      same castle, and no two merlons the same.
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(HERE)

import lib                                                   # noqa: E402
from boxmodel import Form                                    # noqa: E402

TAU = math.tau


# ---------------------------------------------------------------- the plan
#
# Outer face of the curtain. 60 x 45 m, which is Conwy's inner ward with a bit
# more room, and about four Welsh acres of nothing much.
OX, OY = 30.0, 22.5
WT = 2.4                        # curtain thickness
CX, CY = OX - WT / 2, OY - WT / 2       # wall centrelines
# 10.2 m to the wall-walk, not the 8 m this started at. Eight metres over a
# sixty metre frontage renders as a garden wall: the first contact sheet read
# as a walled paddock with sheds in it. Conwy's curtain is 10-12 m, and that
# ratio is what makes an enclosure read as defensible rather than agricultural.
Z_BUILD = 10.20                 # nominal wall-walk height before slumping
SILL_H, SILL_T = 0.55, 0.86     # the low parapet the merlons stand on
# Merlons an accurate 1.6 m wide on a 2.35 m pitch, so the crenel is a 0.75 m
# slot. Narrower merlons are also accurate and read as fence pickets.
MERLON_H, MERLON_W, MERLON_T = 1.80, 1.62, 0.86
PITCH = 2.35                    # merlon centres

CUT_U = 1.35                    # masonry patch size along a wall
COURSE = 0.62                   # the height a wall loses when it loses a course
# Deliberately not evenly spaced. The cuts exist so repaint() has faces small
# enough to put moss on part of a wall, and the moss is banded along the foot,
# so that is where the resolution is spent: the bottom three metres get rows
# half a metre deep and the rest of the wall gets rows of a metre and a half.
# Even spacing put the same number of faces on the dry twelfth course as on the
# wet first one, and the base band came out four patches tall for the whole
# perimeter.
Z_FRACS = (0.045, 0.09, 0.14, 0.20, 0.27, 0.35, 0.44, 0.55, 0.67, 0.79, 0.90)

GATE_X = 6.0                    # gatehouse centre on the south wall
# The drums are splayed to GATE_R + 0.62 at the foot, so their centres have to
# stand more than that off the axis or the towers eat the passage they are
# there to guard. At 4.95 they closed it to 1.9 m and the gate read as a
# cottage door in a cliff.
GATE_HALF = 5.60                # drum centres either side of it
GATE_R = 3.40
GATE_TOP = 15.20
GATE_Y = -OY - 1.30             # drums project this far out

KEEP_C = (-9.5, 6.5)
KEEP_W, KEEP_D = 17.0, 14.5
KEEP_WALL = 18.60               # top of the keep's own wall
KEEP_MERLON = 20.35
# Parapet at 20.35 is the number the brief asked for; the corner turrets go a
# storey higher and the roof ridge sits between the two, because in silhouette
# a keep needs three steps to read as a keep rather than as one more box.
KEEP_TURRET = 23.40
KEEP_RIDGE = 22.05


# ---------------------------------------------------------------- noise
#
# Sums of sines rather than random(): a field, so neighbouring stones agree
# with each other. Reproducible from the coordinates alone, which means the
# merlon placed at u and the wall warped at u get the same answer.

def n1(u, s=0.0):
    """Coherent 1D noise, roughly -1..1, wavelength about 7 m at the low end."""
    return (math.sin(u * 0.913 + s * 1.7) * 0.55
            + math.sin(u * 2.310 + s * 4.1 + 1.3) * 0.30
            + math.sin(u * 5.770 + s * 2.9 + 2.7) * 0.15)


def n3(x, y, z, s=0.0):
    """Coherent 3D blobs, roughly -1..1. Patch size about 2 m, which is the
    size a patch of moss actually is."""
    v = (math.sin(x * 0.42 + s) * math.cos(y * 0.37 - s * 0.7)
         + math.sin(z * 0.63 + x * 0.21 + s * 1.9) * 0.70
         + math.sin((x + y) * 0.85 - z * 0.31 + s * 3.3) * 0.45)
    return v / 2.15


def piecewise(pts):
    """Linear interpolation through (u, value) knots, clamped at both ends."""
    pts = sorted(pts)

    def f(u):
        if u <= pts[0][0]:
            return pts[0][1]
        if u >= pts[-1][0]:
            return pts[-1][1]
        for (a, va), (b, vb) in zip(pts, pts[1:]):
            if a <= u <= b:
                return va + (vb - va) * (u - a) / (b - a)
        return pts[-1][1]
    return f


# ---------------------------------------------------------------- materials

def palette():
    return {
        # Two ages of stone. The difference has to survive being lit from one
        # side, so it is value as well as hue: the repair is a stop lighter and
        # a touch cooler than the weathered original.
        'old': lib.hexmat('stone_old', 0x8A8073, rough=0.93),
        # Three tones of the same stone, not one. With no texture and no vertex
        # colour, tonal variation between faces is the only thing that can say
        # "coursed rubble" rather than "cast concrete", and one flat colour over
        # forty metres of curtain wall says the second every time.
        'dark': lib.hexmat('stone_damp', 0x69624F, rough=0.96),
        'pale': lib.hexmat('stone_pale', 0x9E9484, rough=0.90),
        'new': lib.hexmat('stone_new', 0xAEA492, rough=0.86),
        'rubble': lib.hexmat('rubble', 0x7C7466, rough=0.96),
        # Both of these started far greener. Close up, a saturated green on a
        # 1.7 m quad reads as a tile of paint, because that is exactly what it
        # is; pulled back towards the stone it reads as staining instead. The
        # colour is doing the work the texture cannot.
        'moss': lib.hexmat('moss', 0x59613F, rough=0.97),
        'lichen': lib.hexmat('lichen', 0x8F8B76, rough=0.95),
        'earth': lib.hexmat('earth', 0x86795E, rough=0.98),
        'timber': lib.hexmat('timber', 0x5B4732, rough=0.88),
        'timber_d': lib.hexmat('timber_dark', 0x3B2E22, rough=0.85),
        'thatch': lib.hexmat('thatch', 0x9A8451, rough=0.95),
        'slate': lib.hexmat('slate', 0x545750, rough=0.78),
        'iron': lib.hexmat('iron', 0x2E3236, rough=0.55, metal=0.5),
        'dark_hole': lib.hexmat('opening', 0x1A1815, rough=0.98),
        'banner': lib.hexmat('banner', 0xA0322B, rough=0.80),
        'smoke': lib.hexmat('smoke', 0xE4E6E2, rough=1.0, alpha=0.34),
    }


def paint(obj, mat):
    obj.data.materials.append(mat)
    return obj


def unrotated_first(objs):
    """Put an axis-aligned part at the head of a merge group.

    merge_into() joins everything into parts[0] and the result keeps that
    object's rotation. shots.py measures the model from the eight corners of
    each object's local bound_box pushed through its matrix, which for a
    rotated object is not a tight box -- so a group that happened to begin with
    a box on a bearing reported the castle as 88 m across instead of 70 and
    every framed shot zoomed out by a quarter to fit a model that was not
    there."""
    for i, o in enumerate(objs):
        if max(abs(a) for a in o.rotation_euler) < 1e-9:
            return objs[i:i + 1] + objs[:i] + objs[i + 1:]
    return objs


# ---------------------------------------------------------------- primitives

def on_ring(name, c, az, radius, z, size, mat, tilt=0.0):
    """A slab lying against a round tower at a bearing; local +X points out."""
    return paint(lib.box(name, size,
                         loc=(c[0] + math.cos(az) * radius,
                              c[1] + math.sin(az) * radius, z),
                         rot=(0.0, tilt, az)), mat)


def slab(name, size, at, step=(2.2, 2.2, 1.8), warp=None):
    """A cube cut into a grid of masonry-sized patches and then deformed.

    The cutting is not for shape. It is so repaint() has faces small enough to
    put moss on part of a wall rather than all of it."""
    f = Form(size=size, at=at)
    for i, axis in enumerate('xyz'):
        n = max(1, int(round(size[i] / step[i])))
        if n < 2:
            continue
        lo = at[i] - size[i] / 2
        f.cut_at(axis, [lo + size[i] * k / n for k in range(1, n)])
    if warp:
        f.warp(warp)
    return f


def prism(name, section, centre, length, yaw, mat, stations=3):
    """A building as one solid: a (y, z) section swept along its own length.

    Walls and roof in one mesh, so the eaves are a fold in a surface and not
    two boxes that nearly meet. repaint() separates thatch from wall by normal
    afterwards."""
    hx = length / 2.0
    xs = [-hx + length * i / (stations - 1.0) for i in range(stations)]
    obj = lib.loft(name, [(x, list(section)) for x in xs], smooth=False)
    obj.location = (centre[0], centre[1], centre[2])
    obj.rotation_euler = (0.0, 0.0, yaw)
    return paint(obj, mat)


def gable_section(span, z_eave, z_ridge):
    h = span / 2.0
    return [(-h, 0.0), (h, 0.0), (h, z_eave), (0.0, z_ridge), (-h, z_eave)]


def shed_section(span, z_back, z_front):
    h = span / 2.0
    return [(-h, 0.0), (h, 0.0), (h, z_front), (-h, z_back)]


def voussoir_arch(name, centre, r, thickness, depth, n, mat):
    """A round arch as wedge stones. Cheaper than a boolean and it reads as
    masonry rather than as a hole punched in a wall."""
    cx, cy, cz = centre
    out = []
    arc = r * math.pi / n * 1.22
    for i in range(n):
        a = math.pi * (i + 0.5) / n
        out.append(paint(lib.box('%s%02d' % (name, i), (arc, depth, thickness),
                                 loc=(cx + math.cos(a) * r, cy,
                                      cz + math.sin(a) * r),
                                 rot=(0.0, math.pi / 2 - a, 0.0)), mat))
    return out


def rubble(name, c, radius, count, peak, rng, mats, spread=1.0):
    """A fallen heap. Stones sit on a cone of height `peak`, sizes drawn from
    the same seeded stream so the pile is the same pile every build."""
    out = []
    for i in range(count):
        a = rng.random() * TAU
        d = radius * math.sqrt(rng.random()) * spread
        s = rng.uniform(0.42, 1.05) * (1.20 - 0.5 * d / max(0.1, radius))
        sx, sy, sz = (min(1.9, s * rng.uniform(0.7, 1.6)),
                      min(1.9, s * rng.uniform(0.7, 1.6)),
                      s * rng.uniform(0.45, 0.95))
        mound = peak * max(0.0, 1.0 - d / max(0.1, radius)) ** 1.35
        z = max(sz * 0.5 + 0.30 * max(sx, sy), mound * rng.uniform(0.15, 1.0))
        out.append(paint(lib.box('%s%02d' % (name, i), (sx, sy, sz),
                                 loc=(c[0] + math.cos(a) * d,
                                      c[1] + math.sin(a) * d, z),
                                 rot=(rng.uniform(-0.28, 0.28),
                                      rng.uniform(-0.28, 0.28),
                                      rng.random() * TAU)),
                         mats[rng.randrange(len(mats))]))
    return out


# ---------------------------------------------------------------- curtain wall

class Run:
    """One straight length of curtain.

    `top_pts` is the design height of the wall-walk along the run; `surface(u)`
    adds the slump noise on top of it and is the single source of truth for how
    tall the wall is at u. The Form is warped to it and the merlons stand on
    it, so they cannot drift apart."""

    def __init__(self, name, axis, v, out_sign, spans, top_pts, seed,
                 slump=0.24, bow=0.0, repaired=(), parapet_min=8.1, ruin=1.45):
        self.name = name
        self.axis = axis                     # the axis the run travels along
        self.v = v                           # its position on the other axis
        self.out = out_sign                  # which way is outside, on that axis
        self.spans = spans
        self.design = piecewise(top_pts)
        self.seed = seed
        self.slump = slump
        self.bow_amp = bow
        self.repaired = repaired
        self.parapet_min = parapet_min
        self.ruin = ruin
        self.u0 = min(s[0] for s in spans)
        self.u1 = max(s[1] for s in spans)

    # -- the two functions everything else is derived from ------------------

    def surface(self, u):
        z = self.design(u) + self.slump * n1(u * 0.62, self.seed)
        if z < self.parapet_min:
            # Below parapet height the wall has lost its facing, and a wall
            # that is coming apart does not weather to a smooth ramp -- it goes
            # course by course. Quantising to COURSE turns the straight slope
            # the second contact sheet showed into a flight of ragged steps,
            # which is the single change that made the breach read as collapse
            # rather than as a shape somebody modelled on purpose.
            t = min(1.0, (self.parapet_min - z) / 2.5)
            z += t * self.ruin * (n1(u * 1.35, self.seed + 13) * 0.70
                                  + n1(u * 3.10, self.seed + 17) * 0.42)
            z = COURSE * math.floor(z / COURSE + 0.5)
        return max(0.75, z)

    def bow(self, u):
        t = (u - self.u0) / max(1e-6, self.u1 - self.u0)
        return self.bow_amp * math.sin(math.pi * t) + 0.11 * n1(u * 0.31, self.seed + 5)

    def is_repaired(self, u):
        return any(a <= u <= b for a, b in self.repaired)

    # -- geometry -----------------------------------------------------------

    def _place(self, u, w_off, du, dw, dz, z):
        """(size, loc) for a box on this run, in run-local terms."""
        w = self.v + w_off + self.bow(u)
        if self.axis == 'x':
            return (du, dw, dz), (u, w, z)
        return (dw, du, dz), (w, u, z)

    def masonry(self, mats):
        out = []
        for si, (a, b) in enumerate(self.spans):
            length = b - a
            uc = (a + b) / 2.0
            if self.axis == 'x':
                size, at = (length, WT, Z_BUILD), (uc, self.v, Z_BUILD / 2)
            else:
                size, at = (WT, length, Z_BUILD), (self.v, uc, Z_BUILD / 2)
            f = Form(size=size, at=at)
            f.cut_at('z', [Z_BUILD * k for k in Z_FRACS])
            n = max(2, int(length / CUT_U))
            f.cut_at(self.axis, [a + length * i / n for i in range(1, n)])
            f.cut_at('y' if self.axis == 'x' else 'x', [self.v])
            f.warp(self._warp)
            obj = f.build('%s_wall%d' % (self.name, si))
            paint(obj, mats['old'])
            out.append(obj)
        return out

    def _warp(self, x, y, z):
        u, w = (x, y) if self.axis == 'x' else (y, x)
        k = self.surface(u) / Z_BUILD
        z2 = z * k
        d = w - self.v
        if abs(d) > 1e-6:
            s = 1.0 if d > 0 else -1.0
            # A batter at the foot and a rough face above it. The roughness is
            # keyed off height as well as position so the courses near the top,
            # which have lost their facing, are the ragged ones.
            batter = 0.42 * max(0.0, 1.0 - z2 / 3.4) ** 1.6
            rough = 0.085 * n1(u * 1.9 + z2 * 2.7, self.seed + s)
            worn = 0.16 * max(0.0, (z2 - self.surface(u) * 0.72)) * (1.0 if s * self.out > 0 else 0.4)
            w = self.v + s * (WT / 2.0 + batter + rough - worn)
        w += self.bow(u)
        return (u, w, z2) if self.axis == 'x' else (w, u, z2)

    def parapet(self, mats, rng):
        out = []
        for a, b in self.spans:
            i = 0
            u = a + PITCH * 0.5
            while u < b - 0.3:
                i += 1
                z = self.surface(u)
                fresh = self.is_repaired(u)
                if z >= self.parapet_min:
                    off = self.out * (WT / 2.0 - SILL_T / 2.0 + 0.06)
                    sh = SILL_H if fresh else SILL_H * (0.72 + 0.3 * abs(n1(u * 3.1, self.seed + 2)))
                    size, loc = self._place(u, off, PITCH * 1.02, SILL_T, sh,
                                            z + sh / 2.0)
                    out.append(paint(lib.box('%s_sill%02d' % (self.name, i),
                                             size, loc=loc),
                                     mats['new'] if fresh else mats['old']))
                    keep = True
                    if not fresh:
                        # Missing teeth, unevenly: a coherent field, so gaps
                        # come in runs of two and three the way they really do.
                        keep = n1(u * 1.45, self.seed + 9) < 0.30 and rng.random() > 0.16
                    if keep:
                        wear = 1.0 if fresh else (0.55 + 0.45 * (0.5 + 0.5 * n1(u * 2.2, self.seed + 3)))
                        mh = MERLON_H * wear
                        lean = 0.0 if fresh else 0.05 * n1(u * 4.3, self.seed + 7)
                        size, loc = self._place(u, off, MERLON_W, MERLON_T, mh,
                                                z + sh + mh / 2.0)
                        rot = (lean, 0, 0) if self.axis == 'y' else (0, lean, 0)
                        out.append(paint(lib.box('%s_mer%02d' % (self.name, i),
                                                 size, loc=loc, rot=rot,
                                                 chamfer=0.05),
                                         mats['new'] if fresh else mats['old']))
                elif z > 2.0:
                    # Below parapet height the wall is a broken stub: cap it
                    # with a couple of loose blocks instead of a clean edge.
                    if rng.random() < 0.55:
                        s = rng.uniform(0.5, 1.1)
                        size, loc = self._place(u + rng.uniform(-0.5, 0.5),
                                                rng.uniform(-0.5, 0.5),
                                                s * 1.4, s, s * 0.7, z + s * 0.3)
                        out.append(paint(lib.box('%s_cap%02d' % (self.name, i),
                                                 size, loc=loc,
                                                 rot=(0, 0, rng.random() * TAU)),
                                         mats['rubble']))
                u += PITCH
        return out

    def build(self, mats, rng):
        return self.masonry(mats) + self.parapet(mats, rng)


# ---------------------------------------------------------------- towers

def drum(name, c, r_base, r_top, z0, z1, mats, bands=7, seg=12, lean=0.0):
    """A round tower as a stack of frustums.

    A stack rather than one cone for two reasons: the batter can curve, and
    every band boundary is a horizontal edge loop, which is what gives moss and
    damp somewhere to sit."""
    out = []
    for i in range(bands):
        t0, t1 = i / bands, (i + 1) / bands
        za, zb = z0 + (z1 - z0) * t0, z0 + (z1 - z0) * t1
        ra = r_base + (r_top - r_base) * t0 ** 0.85
        rb = r_base + (r_top - r_base) * t1 ** 0.85
        dx, dy = lean * t0 * t0, lean * t0 * t0 * 0.4
        out.append(paint(lib.cyl('%s_b%d' % (name, i), ra, rb, zb - za,
                                 loc=(c[0] + dx, c[1] + dy, (za + zb) / 2),
                                 segments=seg),
                         mats['old']))
    return out


def string_course(name, c, r, z, mats, seg=12, depth=0.22, h=0.34):
    return paint(lib.ring(name, r - 0.05, r + depth, h, loc=(c[0], c[1], z),
                          segments=seg), mats['old'])


def ring_crenellate(name, c, r, z, mats, rng, count=12, miss=0.0, h=MERLON_H,
                    fresh=False, seed=0.0):
    """Crenellations round a tower head, with the same uneven-teeth rule as the
    straight runs so a repaired tower and a decayed wall do not read alike."""
    out = []
    out.append(paint(lib.ring('%s_sill' % name, r - 0.62, r + 0.10, SILL_H,
                              loc=(c[0], c[1], z + SILL_H / 2), segments=count),
                     mats['new'] if fresh else mats['old']))
    w = TAU * r / count * 0.62
    for i in range(count):
        az = TAU * (i + 0.5) / count
        if not fresh and (n1(i * 1.7, seed) > 0.42 or rng.random() < miss):
            continue
        wear = 1.0 if fresh else 0.55 + 0.45 * (0.5 + 0.5 * n1(i * 2.9, seed + 1))
        mh = h * wear
        out.append(on_ring('%s_m%02d' % (name, i), c, az, r - 0.30,
                           z + SILL_H + mh / 2, (MERLON_T, w, mh),
                           mats['new'] if fresh else mats['old'],
                           tilt=0.0 if fresh else 0.045 * n1(i * 5.1, seed + 2)))
    return out


def broken_drum(name, c, r, wall_t, z0, top_fn, mats, rng, staves=18,
                gash=None):
    """A tower snapped off: a ring of staves of unequal height, hollow, with
    the floor ledges left showing inside.

    This is the technique the whole brief turns on. A cylinder with an uneven
    lid still reads as a cylinder with a lid; a ring of separate uprights reads
    as a wall that has come apart, because the vertical joints are real."""
    out = []
    for i in range(staves):
        # Jitter the bearing, the radius and the width. Evenly spaced staves of
        # equal width read as a palisade -- the vertical joints line up like
        # planks. Three cheap perturbations are what turn them back into a wall
        # that has come apart along its own weaknesses.
        az = TAU * i / staves + 0.055 * n1(i * 1.9, 7)
        rr = r - wall_t / 2 + 0.17 * n1(i * 2.7, 9)
        w = TAU * r / staves * (1.10 + 0.40 * abs(n1(i * 3.7, 5)))
        h = top_fn(az)
        if gash and gash[0] <= (az % TAU) <= gash[1]:
            h = min(h, z0 + 1.15 + 0.9 * abs(n1(i * 3.3, 11)))
        h = z0 + COURSE * math.floor((h - z0) / COURSE + 0.5)
        if h - z0 < 0.25:
            continue
        # Each stave leans and thins with height: a broken wall is not plumb.
        out.append(on_ring('%s_s%02d' % (name, i), c, az, rr,
                           (z0 + h) / 2, (wall_t, w, h - z0), mats['old'],
                           tilt=0.045 * n1(i * 2.1, 3)))
        # A few stones still clinging to the top of each stave.
        if rng.random() < 0.45:
            s = rng.uniform(0.4, 0.85)
            out.append(on_ring('%s_t%02d' % (name, i), c,
                               az + rng.uniform(-0.1, 0.1),
                               rr + rng.uniform(-0.18, 0.18),
                               h + s * 0.35, (wall_t * 0.8, s * 1.5, s * 0.7),
                               mats['rubble'], tilt=rng.uniform(-0.2, 0.2)))
    return out


def floor_lines(name, c, r, wall_t, zs, mats, seg=18):
    """The ledge each timber floor sat on, plus a stub of the joists. Without
    these the inside of a broken tower is a smooth pipe and reads as a cooling
    tower, not a building."""
    out = []
    for k, z in enumerate(zs):
        out.append(paint(lib.ring('%s_led%d' % (name, k),
                                  r - wall_t - 0.34, r - wall_t + 0.04, 0.30,
                                  loc=(c[0], c[1], z), segments=seg),
                         mats['dark']))
        for i in range(6):
            az = TAU * (i + 0.3 * k) / 6
            out.append(on_ring('%s_j%d%d' % (name, k, i), c, az,
                               r - wall_t - 0.55, z + 0.02,
                               (1.1, 0.24, 0.22), mats['timber_d']))
    return out


def square_turret(name, c, w, d, z_top, mats, rng, lean=0.0, seed=0.0):
    """The small corner turret: a leaning box with worn crenellations."""
    out = []

    def warp(x, y, z):
        t = max(0.0, z / z_top)
        batter = 0.34 * max(0.0, 1.0 - z / 3.0) ** 1.6
        dx = x - c[0]
        dy = y - c[1]
        sx = 1.0 if dx > 0 else -1.0
        sy = 1.0 if dy > 0 else -1.0
        rough = 0.075 * n1(x * 1.7 + y * 1.1 + z * 2.3, seed)
        return (c[0] + sx * (abs(dx) + batter + rough) + lean * t * t,
                c[1] + sy * (abs(dy) + batter + rough) + lean * t * t * 0.55,
                z * (1.0 + 0.012 * n1(x * 0.9 + y * 0.7, seed + 4)))

    f = slab(name, (w, d, z_top), (c[0], c[1], z_top / 2),
             step=(1.9, 1.9, 1.75), warp=warp)
    out.append(paint(f.build(name), mats['old']))
    # Crenellations on all four faces, driven by the same missing-teeth field.
    for side, (ax, sgn) in enumerate((('x', 1), ('x', -1), ('y', 1), ('y', -1))):
        span = d if ax == 'x' else w
        n = max(2, int(span / PITCH))
        for i in range(n):
            u = -span / 2 + span * (i + 0.5) / n
            if n1(u * 1.6 + side * 2.0, seed + 6) > 0.36:
                continue
            wear = 0.6 + 0.4 * (0.5 + 0.5 * n1(u * 2.7 + side, seed + 8))
            mh = MERLON_H * wear
            off = (w if ax == 'x' else d) / 2 - MERLON_T / 2 + 0.10
            if ax == 'x':
                size, loc = (MERLON_T, MERLON_W, mh), (c[0] + sgn * off, c[1] + u, z_top + mh / 2)
            else:
                size, loc = (MERLON_W, MERLON_T, mh), (c[0] + u, c[1] + sgn * off, z_top + mh / 2)
            loc = (loc[0] + lean, loc[1] + lean * 0.55, loc[2])
            out.append(paint(lib.box('%s_m%d%d' % (name, side, i), size,
                                     loc=loc, chamfer=0.05), mats['old']))
    return out


# ---------------------------------------------------------------- gatehouse


def gatehouse(mats, rng):
    """Twin drums, a round-arched passage between them, and a machicolated
    head. The only part of the castle that is unambiguously being kept up, so
    it is the control against which the ruin reads as ruined."""
    out = []
    gy = GATE_Y
    z_spring = 4.20
    z_arch_r = 1.66
    z_crown = z_spring + z_arch_r + 0.40
    for s in (-1, 1):
        c = (GATE_X + s * GATE_HALF, gy)
        out += drum('gt%d' % (s > 0), c, GATE_R + 0.62, GATE_R - 0.20, 0.0,
                    GATE_TOP, mats, bands=10)
        out.append(string_course('gt%d_sc' % (s > 0), c, GATE_R - 0.04, 7.30, mats))
        out += ring_crenellate('gt%d_cr' % (s > 0), c, GATE_R + 0.14, GATE_TOP,
                               mats, rng, count=12, fresh=True, h=1.60)
        for k, z in enumerate((5.0, 9.4, 12.6)):
            out.append(on_ring('gt%d_loop%d' % (s > 0, k), c,
                               -math.pi / 2 + s * 0.55, GATE_R - 0.32, z,
                               (0.44, 0.28, 1.45), mats['dark_hole']))
    # The block spanning the passage, from the crown of the arch up.
    blk = slab('gate_blk', (GATE_HALF * 2 + 1.3, 8.0, GATE_TOP - z_crown),
               (GATE_X, gy + 0.7, (GATE_TOP + z_crown) / 2), step=(1.9, 1.9, 1.7))
    out.append(paint(blk.build('gate_blk'), mats['new']))
    for s in (-1, 1):
        out.append(paint(lib.box('gate_pier%d' % (s > 0), (2.6, 8.0, z_crown),
                                 loc=(GATE_X + s * 2.96, gy + 0.7, z_crown / 2)),
                         mats['new']))
    out += voussoir_arch('gate_vs', (GATE_X, gy - 3.65, z_spring), z_arch_r,
                         0.60, 0.95, 9, mats['new'])
    out += voussoir_arch('gate_vsi', (GATE_X, gy + 4.65, z_spring), z_arch_r,
                         0.60, 0.95, 9, mats['old'])
    # The dark of the passage in two boxes, not one. A single box the full
    # height of the arch leaves its top corners standing outside the voussoirs,
    # which renders as two black triangles sitting on the springing.
    out.append(paint(lib.box('gate_void', (3.32, 7.8, z_spring),
                             loc=(GATE_X, gy + 0.7, z_spring / 2)),
                     mats['dark_hole']))
    out.append(paint(lib.box('gate_void_head', (2.30, 7.8, z_arch_r * 0.94),
                             loc=(GATE_X, gy + 0.7, z_spring + z_arch_r * 0.47)),
                     mats['dark_hole']))
    for s in (-1, 1):
        out.append(paint(lib.box('gate_leaf%d' % (s > 0), (1.64, 0.24, 5.60),
                                 loc=(GATE_X + s * 0.84, gy + 2.1, 2.80)),
                         mats['timber_d']))
    for i in range(7):
        out.append(paint(lib.box('gate_plank%d' % i, (0.18, 0.10, 5.40),
                                 loc=(GATE_X - 1.44 + i * 0.48, gy + 1.96, 2.72)),
                         mats['timber']))
    for i in range(8):
        out.append(paint(lib.box('pc_v%d' % i, (0.12, 0.12, 4.40),
                                 loc=(GATE_X - 1.44 + i * 0.41, gy - 2.90, 2.25)),
                         mats['iron']))
    for k, z in enumerate((1.2, 2.9, 4.2)):
        out.append(paint(lib.box('pc_h%d' % k, (3.24, 0.10, 0.12),
                                 loc=(GATE_X, gy - 2.90, z)), mats['iron']))
    # The front of the gatehouse was eleven metres of blank ashlar with a hole
    # at the bottom. A string course, the portcullis slot, two loops and a
    # shield panel is the smallest set of things that turns it into elevation.
    out.append(paint(lib.box('gate_string', (GATE_HALF * 2 + 1.5, 0.42, 0.44),
                             loc=(GATE_X, gy - 4.10, z_crown + 1.5),
                             chamfer=0.05), mats['old']))
    out.append(paint(lib.box('gate_slot', (3.34, 0.30, 0.34),
                             loc=(GATE_X, gy - 3.98, z_crown + 0.35)),
                     mats['dark_hole']))
    for s in (-1, 1):
        for k, z in enumerate((z_crown + 2.9, z_crown + 5.4)):
            out.append(paint(lib.box('gate_loop%d%d' % (s > 0, k),
                                     (0.40, 0.30, 1.55),
                                     loc=(GATE_X + s * 2.5, gy - 3.98, z)),
                             mats['dark_hole']))
    out.append(paint(lib.box('gate_shield', (1.5, 0.26, 1.7),
                             loc=(GATE_X, gy - 3.98, z_crown + 3.6),
                             chamfer=0.06), mats['old']))
    out.append(paint(lib.box('gate_shield_f', (1.0, 0.18, 1.2),
                             loc=(GATE_X, gy - 4.12, z_crown + 3.6)),
                     mats['banner']))
    # Machicolation: corbels and an oversailing parapet over the gate.
    for i in range(7):
        out.append(paint(lib.box('mach%d' % i, (0.44, 1.40, 0.68),
                                 loc=(GATE_X - 2.5 + i * 0.84, gy - 4.35,
                                      GATE_TOP - 0.10)), mats['new']))
    out.append(paint(lib.box('mach_par', (GATE_HALF * 2 + 1.5, 0.95, 1.55),
                             loc=(GATE_X, gy - 4.62, GATE_TOP + 1.02),
                             chamfer=0.06), mats['new']))
    out += [paint(lib.box('mach_m%d' % i, (1.28, 0.95, 1.35),
                          loc=(GATE_X - 4.5 + i * 1.80, gy - 4.62,
                               GATE_TOP + 2.47), chamfer=0.05), mats['new'])
            for i in range(6)]
    # The causeway up to the gate. Short: a long apron pushes the model bounds
    # out and shrinks the castle in every framed shot.
    out.append(paint(lib.box('causeway', (7.6, 3.8, 0.36),
                             loc=(GATE_X, gy - 5.8, 0.18)), mats['earth']))
    return out


# ---------------------------------------------------------------- keep

def keep(mats, rng):
    """Square Norman keep with clasping corner turrets, a forebuilding, and a
    roof — the roof is what says somebody still lives here."""
    out = []
    kx, ky = KEEP_C

    def warp(x, y, z):
        dx, dy = x - kx, y - ky
        sx = 1.0 if dx > 0 else -1.0
        sy = 1.0 if dy > 0 else -1.0
        batter = 0.55 * max(0.0, 1.0 - z / 4.5) ** 1.5
        rough = 0.055 * n1(x * 1.3 + y * 0.9 + z * 2.1, 21)
        return (kx + sx * (abs(dx) + batter + rough),
                ky + sy * (abs(dy) + batter + rough), z)

    f = slab('keep', (KEEP_W, KEEP_D, KEEP_WALL), (kx, ky, KEEP_WALL / 2),
             step=(2.0, 2.0, 1.9), warp=warp)
    out.append(paint(f.build('keep'), mats['old']))

    # Pilaster buttresses on the long faces.
    for s in (-1, 1):
        out.append(paint(lib.box('keep_pil%d' % (s > 0), (1.8, 0.55, KEEP_WALL),
                                 loc=(kx, ky + s * (KEEP_D / 2 + 0.24),
                                      KEEP_WALL / 2)), mats['old']))

    # Clasping corner turrets, carried a storey above the parapet.
    for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        c = (kx + sx * (KEEP_W / 2 + 0.35), ky + sy * (KEEP_D / 2 + 0.35))
        t = slab('kt%d' % i, (3.5, 3.5, KEEP_TURRET), (c[0], c[1], KEEP_TURRET / 2),
                 step=(1.8, 1.8, 2.1),
                 warp=lambda x, y, z, c=c: (
                     c[0] + (1 if x > c[0] else -1) * (abs(x - c[0]) + 0.40 * max(0.0, 1 - z / 4.0) ** 1.5),
                     c[1] + (1 if y > c[1] else -1) * (abs(y - c[1]) + 0.40 * max(0.0, 1 - z / 4.0) ** 1.5),
                     z))
        out.append(paint(t.build('kt%d' % i), mats['old']))
        for side, (ax, sgn) in enumerate((('x', 1), ('x', -1), ('y', 1), ('y', -1))):
            off = 3.5 / 2 - 0.32
            # Three teeth a side, not one. A single merlon per face reads as
            # a chimney pot at any distance the whole castle fits in frame.
            for j in (-1, 0, 1):
                u = j * 1.15
                if ax == 'x':
                    size = (0.66, 0.90, 1.35)
                    loc = (c[0] + sgn * off, c[1] + u, KEEP_TURRET + 0.68)
                else:
                    size = (0.90, 0.66, 1.35)
                    loc = (c[0] + u, c[1] + sgn * off, KEEP_TURRET + 0.68)
                out.append(paint(lib.box('kt%d_m%d_%d' % (i, side, j + 1), size,
                                         loc=loc, chamfer=0.05), mats['old']))

    # Parapet between the turrets: kept up, so the teeth are all there.
    for ax, sgn, span in (('x', 1, KEEP_W), ('x', -1, KEEP_W),
                          ('y', 1, KEEP_D), ('y', -1, KEEP_D)):
        n = max(2, int((span - 3.0) / 2.05))
        for i in range(n):
            u = -(span - 3.0) / 2 + (span - 3.0) * (i + 0.5) / n
            off = (KEEP_D if ax == 'x' else KEEP_W) / 2 - 0.34
            mh = KEEP_MERLON - KEEP_WALL
            if ax == 'x':
                size = (1.35, 0.68, mh)
                loc = (kx + u, ky + sgn * off, KEEP_WALL + mh / 2)
                ssize = ((span - 3.0) / n * 1.02, 0.68, 0.42)
                sloc = (kx + u, ky + sgn * off, KEEP_WALL + 0.21)
            else:
                size = (0.68, 1.35, mh)
                loc = (kx + sgn * off, ky + u, KEEP_WALL + mh / 2)
                ssize = (0.68, (span - 3.0) / n * 1.02, 0.42)
                sloc = (kx + sgn * off, ky + u, KEEP_WALL + 0.21)
            out.append(paint(lib.box('kp_s%s%d%d' % (ax, sgn > 0, i), ssize,
                                     loc=sloc), mats['old']))
            out.append(paint(lib.box('kp_m%s%d%d' % (ax, sgn > 0, i), size,
                                     loc=(loc[0], loc[1], loc[2] + 0.42),
                                     chamfer=0.05), mats['old']))

    # The roof, sitting inside the parapet and showing over it.
    out.append(prism('keep_roof', gable_section(KEEP_D - 1.7, 0.0,
                                                KEEP_RIDGE - KEEP_WALL + 2.4),
                     (kx, ky, KEEP_WALL - 2.4), KEEP_W - 1.7, 0.0,
                     mats['slate'], stations=2))
    # Chimney and its smoke.
    ch = (kx - 5.4, ky + 2.6)
    out.append(paint(lib.box('keep_chim', (1.7, 1.7, KEEP_RIDGE + 1.3),
                             loc=(ch[0], ch[1], (KEEP_RIDGE + 1.3) / 2)),
                     mats['old']))
    out.append(paint(lib.box('keep_chimcap', (2.1, 2.1, 0.36),
                             loc=(ch[0], ch[1], KEEP_RIDGE + 1.44), chamfer=0.06),
                     mats['old']))
    out += smoke('keep_smoke', (ch[0], ch[1], KEEP_RIDGE + 1.5), mats, rng,
                 puffs=3, drift=(0.9, 1.6), rise=2.8, r0=0.30)

    # Forebuilding: the stair up to a first-floor door, the Norman arrangement.
    out.append(paint(lib.box('fore', (5.6, 5.0, 10.4),
                             loc=(kx + 2.2, ky - KEEP_D / 2 - 2.4, 5.2),
                             chamfer=0.05), mats['old']))
    out.append(prism('fore_roof', gable_section(5.2, 0.0, 1.9),
                     (kx + 2.2, ky - KEEP_D / 2 - 2.4, 10.4), 5.8,
                     math.pi / 2, mats['slate'], stations=2))
    for i in range(10):
        out.append(paint(lib.box('fore_st%d' % i, (2.0, 0.66, 0.52 * (i + 1)),
                                 loc=(kx + 6.1, ky - KEEP_D / 2 - 5.2 + i * 0.66,
                                      0.26 * (i + 1))), mats['old']))
    out.append(paint(lib.box('fore_door', (1.40, 0.30, 2.40),
                             loc=(kx + 2.2, ky - KEEP_D / 2 - 4.95, 6.3)),
                     mats['timber_d']))

    # Openings: slits low down, proper windows in the top storey where the
    # hall is, two of them shuttered and lit.
    for s in (-1, 1):
        for k, z in enumerate((5.4, 9.4)):
            for j in range(3):
                out.append(paint(lib.box('ksl%d%d%d' % (s > 0, k, j),
                                         (0.42, 0.32, 1.45),
                                         loc=(kx - 4.2 + j * 4.2,
                                              ky + s * (KEEP_D / 2 + 0.30), z)),
                                 mats['dark_hole']))
    for j in range(3):
        out.append(paint(lib.box('kwin%d' % j, (1.40, 0.34, 2.10),
                                 loc=(kx - 5.0 + j * 5.0, ky - KEEP_D / 2 - 0.32,
                                      14.5)), mats['dark_hole']))
        out.append(paint(lib.box('kwinsill%d' % j, (1.85, 0.54, 0.28),
                                 loc=(kx - 5.0 + j * 5.0, ky - KEEP_D / 2 - 0.36,
                                      13.32)), mats['new']))
    # A banner on the seaward turret.
    bx, by = kx + KEEP_W / 2 + 0.35, ky - KEEP_D / 2 - 0.35
    out.append(paint(lib.cyl('flagpole', 0.10, 0.08, 3.6,
                             loc=(bx, by, KEEP_TURRET + 2.6), segments=6),
                     mats['timber']))
    bf = Form(size=(0.06, 2.4, 1.7), at=(bx, by - 1.35, KEEP_TURRET + 3.3))
    bf.cut_at('y', [by - 1.35 + t for t in (-0.8, -0.4, 0.0, 0.4, 0.8)])
    bf.warp(lambda x, y, z: (x + 0.22 * math.sin((y - by) * 2.1 + z * 0.7), y, z))
    out.append(paint(bf.build('banner'), mats['banner']))
    return out


# ---------------------------------------------------------------- courtyard


def smoke(name, at, mats, rng, puffs=3, drift=(1.0, 1.7), rise=2.6, r0=0.24):
    """A wisp. A few flattened icospheres on a drifting, widening line.

    Kept deliberately short. The first version rose 6 m and added eight metres
    to the model bounding box, which the contact sheet frames off -- the castle
    lost a quarter of its size in every shot to a puff of grey."""
    out = []
    for i in range(puffs):
        t = (i + 1) / puffs
        r = r0 + 0.46 * t ** 1.2
        out.append(paint(lib.sphere('%s%d' % (name, i), r,
                                    loc=(at[0] + drift[0] * t ** 1.6 + 0.28 * n1(i * 2.0, 13),
                                         at[1] + drift[1] * t ** 1.6,
                                         at[2] + 0.7 + rise * t ** 0.85),
                                    subdiv=1, scale=(1.0, 1.0, 0.62),
                                    smooth=True),
                         mats['smoke']))
    return out



def courtyard(mats, rng):
    """The ward. An empty ward is the difference between a castle and a
    monument: the first pass had fifty-five metres of bare earth in it and read
    as a car park with a wall round it."""
    out = []
    inner_x, inner_y = OX - WT, OY - WT
    out.append(paint(lib.box('ward', (2 * inner_x + 0.6, 2 * inner_y + 0.6, 0.22),
                             loc=(0, 0, 0.09)), mats['earth']))
    # A trodden way from the gate to the keep forebuilding, a shade lighter.
    out.append(paint(lib.box('track', (5.4, 26.0, 0.10),
                             loc=(GATE_X - 1.0, -8.0, 0.25)), mats['rubble']))
    out.append(paint(lib.box('track2', (17.0, 4.6, 0.10),
                             loc=(-2.0, 3.4, 0.25), rot=(0, 0, 0.16)),
                     mats['rubble']))

    # The hall, against the west wall: stone below, timber gable above, thatch.
    hall_c = (-inner_x + 4.0, -7.5)
    out.append(prism('hall', gable_section(7.6, 4.6, 8.9),
                     (hall_c[0], hall_c[1], 0.16), 16.0, math.pi / 2,
                     mats['thatch'], stations=4))
    out.append(paint(lib.box('hall_base', (7.2, 15.6, 3.3),
                             loc=(hall_c[0], hall_c[1], 1.65)), mats['old']))
    for i in range(5):
        out.append(paint(lib.box('hall_post%d' % i, (0.30, 0.30, 4.7),
                                 loc=(hall_c[0] + 3.72, hall_c[1] - 6.4 + i * 3.2,
                                      2.35)), mats['timber']))
        out.append(paint(lib.box('hall_win%d' % i, (0.28, 1.05, 1.40),
                                 loc=(hall_c[0] + 3.92, hall_c[1] - 4.8 + i * 3.2,
                                      5.6)), mats['dark_hole']))
    out.append(paint(lib.box('hall_door', (0.32, 1.70, 2.60),
                             loc=(hall_c[0] + 3.95, hall_c[1] + 1.2, 1.48)),
                     mats['timber_d']))
    out += smoke('hall_smoke', (hall_c[0] - 1.2, hall_c[1] + 4.0, 8.9), mats,
                 rng, puffs=3, drift=(0.6, 1.1), rise=2.0, r0=0.22)

    # A long stable range down the inside of the north wall, and a chapel.
    st_y = inner_y - 3.2
    out.append(prism('stable', shed_section(6.0, 5.6, 3.4),
                     (-4.0, st_y, 0.16), 20.0, math.pi, mats['thatch'],
                     stations=4))
    for i in range(7):
        out.append(paint(lib.box('stable_p%d' % i, (0.28, 0.28, 3.4),
                                 loc=(-13.6 + i * 3.2, st_y - 3.0, 1.70)),
                         mats['timber']))
        out.append(paint(lib.box('stable_d%d' % i, (1.30, 0.24, 2.30),
                                 loc=(-12.0 + i * 3.2, st_y - 2.95, 1.15)),
                         mats['timber_d']))
    out.append(prism('chapel', gable_section(5.4, 3.6, 6.4),
                     (14.0, 11.0, 0.16), 9.5, math.pi / 2, mats['slate'],
                     stations=3))
    out.append(paint(lib.box('chapel_base', (5.0, 9.2, 3.2),
                             loc=(14.0, 11.0, 1.60)), mats['old']))
    out.append(paint(lib.box('chapel_e', (0.30, 1.20, 2.40),
                             loc=(11.4, 11.0, 3.2)), mats['dark_hole']))

    # Two timber lean-tos against the inside of the south wall.
    for k, (lx, ln, back, front) in enumerate(((-15.5, 9.0, 5.4, 3.0),
                                               (19.0, 7.0, 4.9, 2.8))):
        ly = -inner_y + 2.5
        out.append(prism('lean%d' % k, shed_section(5.0, back, front),
                         (lx, ly, 0.16), ln, 0.0, mats['timber'], stations=3))
        for i in range(int(ln / 2.2) + 1):
            out.append(paint(lib.box('lean%d_p%d' % (k, i), (0.26, 0.26, front),
                                     loc=(lx - ln / 2 + i * 2.2, ly + 2.5,
                                          front / 2)), mats['timber_d']))
    # The bake-house oven against the near lean-to, and its fire.
    out.append(paint(lib.cyl('oven', 1.30, 0.95, 1.90, loc=(23.6, -16.6, 0.95),
                             segments=10), mats['old']))
    out.append(paint(lib.box('oven_flue', (0.62, 0.62, 1.30),
                             loc=(23.6, -16.6, 2.45)), mats['old']))
    out += smoke('oven_smoke', (23.6, -16.6, 3.1), mats, rng, puffs=3,
                 drift=(0.6, 1.2), rise=2.2, r0=0.20)

    # A stair up to the wall-walk, against the inside of the south wall.
    for i in range(11):
        out.append(paint(lib.box('walkstair%d' % i, (1.6, 1.5, 0.95 * (i + 1)),
                                 loc=(-2.2 + i * 1.62, -inner_y + 0.9,
                                      0.475 * (i + 1))), mats['old']))

    # Garden beds behind the hall: four raised strips and a fence.
    for i in range(4):
        out.append(paint(lib.box('bed%d' % i, (6.5, 1.35, 0.34),
                                 loc=(-18.0, -18.5 + i * 1.9, 0.28)),
                         mats['timber']))
    # Man-sized clutter. This is what makes the wall behind it read as forty
    # feet high; nothing else in the model does that job.
    for i in range(16):
        out.append(paint(lib.cyl('log%d' % i, 0.20, 0.19, 2.3,
                                 loc=(13.4 + (i % 4) * 0.44, -13.6 + (i // 4) * 0.46,
                                      0.30 + (i // 4) * 0.42),
                                 rot=(0, math.pi / 2, 0.06 * (i % 3)), segments=6),
                         mats['timber']))
    out.append(paint(lib.ring('well', 1.10, 1.55, 1.05, loc=(1.5, -1.0, 0.62),
                              segments=10), mats['old']))
    for s in (-1, 1):
        out.append(paint(lib.box('well_p%d' % (s > 0), (0.22, 0.22, 2.6),
                                 loc=(1.5 + s * 1.3, -1.0, 1.40)), mats['timber']))
    out.append(paint(lib.box('well_beam', (3.1, 0.22, 0.22),
                             loc=(1.5, -1.0, 2.80)), mats['timber']))
    for k, (cx, cy, yaw) in enumerate(((-2.0, -12.5, 0.5), (9.5, 4.0, -1.1))):
        out.append(paint(lib.box('cart%d_bed' % k, (2.8, 1.6, 0.44),
                                 loc=(cx, cy, 1.10), rot=(0, 0, yaw)),
                         mats['timber']))
        out.append(paint(lib.box('cart%d_shaft' % k, (2.4, 0.16, 0.16),
                                 loc=(cx + 2.4 * math.cos(yaw),
                                      cy + 2.4 * math.sin(yaw), 0.95),
                                 rot=(0, 0, yaw)), mats['timber']))
        for s in (-1, 1):
            out.append(paint(lib.ring('cart%d_w%d' % (k, s > 0), 0.54, 0.70, 0.16,
                                      loc=(cx - s * 0.9 * math.sin(yaw),
                                           cy + s * 0.9 * math.cos(yaw), 0.74),
                                      rot=(math.pi / 2, 0, yaw), segments=10),
                             mats['timber_d']))
    # A midden and a pen of hurdles in the far corner.
    out.append(paint(lib.box('midden', (3.4, 2.6, 0.7), loc=(-22.0, 14.0, 0.35),
                             rot=(0, 0, 0.3)), mats['earth']))
    for i in range(9):
        a = TAU * i / 9
        out.append(paint(lib.box('pen%d' % i, (0.14, 2.4, 1.05),
                                 loc=(-21.0 + math.cos(a) * 3.6,
                                      9.0 + math.sin(a) * 3.6, 0.55),
                                 rot=(0, 0, a)), mats['timber']))
    return out


# ---------------------------------------------------------------- assembly

def curtain_runs():
    """The four sides. The east wall is the one that has come down, and it is
    the one the hero camera looks straight at."""
    return [
        Run('south', 'x', -CY, -1,
            spans=[(-CX, GATE_X - GATE_HALF + 1.6), (GATE_X + GATE_HALF - 1.6, CX)],
            top_pts=[(-CX, 9.55), (-24, 9.85), (-22.5, 10.35), (-4.0, 10.35),
                     (-2.0, 9.70), (6, 9.60), (14, 10.05), (CX, 9.60)],
            seed=1.0, slump=0.28, bow=0.16,
            repaired=[(-22.5, -3.5)]),
        Run('north', 'x', CY, 1, spans=[(-CX, CX)],
            top_pts=[(-CX, 9.30), (-19, 9.85), (-11, 8.30), (-6, 8.05),
                     (-1, 9.10), (10, 9.75), (20, 9.25), (CX, 9.60)],
            seed=2.0, slump=0.38, bow=-0.26),
        Run('east', 'y', CX, 1, spans=[(-CY, CY)],
            # The collapse: the wall falls away to a stub between y = -1 and
            # y = +7 and picks up again, lower, beyond it.
            top_pts=[(-CY, 10.30), (-8.0, 9.90), (-4.0, 7.60), (-1.5, 3.10),
                     (0.5, 1.55), (3.5, 1.40), (5.5, 3.40), (8.0, 6.60),
                     (11.0, 8.05), (17.0, 7.60), (CY, 8.10)],
            seed=3.0, slump=0.30, bow=0.34, ruin=1.75),
        Run('west', 'y', -CX, -1, spans=[(-CY, CY)],
            top_pts=[(-CY, 9.60), (-10, 10.15), (2, 9.50), (12, 9.90), (CY, 9.40)],
            seed=4.0, slump=0.28, bow=-0.16),
    ]


def towers(mats, rng):
    out = []
    # SE: the great tower. Biggest, best kept, nearest the hero camera.
    se = (CX, -CY)
    out += drum('se', se, 5.15, 4.35, 0.0, 19.40, mats, bands=13)
    out.append(string_course('se_sc1', se, 4.68, 6.60, mats))
    out.append(string_course('se_sc2', se, 4.48, 13.00, mats))
    out += ring_crenellate('se_cr', se, 4.55, 19.40, mats, rng, count=14,
                           miss=0.12, seed=31.0)
    for k, z in enumerate((4.1, 8.6, 13.8)):
        out.append(on_ring('se_loop%d' % k, se, -0.9 + k * 0.35, 4.35, z,
                           (0.45, 0.30, 1.60), mats['dark_hole']))

    # A square mural tower on the south curtain, west of the gate. It breaks
    # the long straight run, and in silhouette it is the only thing that
    # interrupts the near edge of the enclosure -- from 35 degrees up, the near
    # half of a walled enclosure is a solid mass and only projections show.
    sm = (-14.0, -CY - 1.1)
    out += square_turret('sm', sm, 5.2, 5.2, 12.30, mats, rng, lean=0.0,
                         seed=61.0)

    # A half-round mural tower on the west curtain. Fifty-seven metres of
    # unbroken wall is the one stretch of the outline with nothing happening
    # in it, and the silhouette shows that as a ruled line.
    wm = (-CX + 0.9, -1.0)
    out += drum('wm', wm, 3.35, 2.95, 0.0, 12.60, mats, bands=9)
    out += ring_crenellate('wm_cr', wm, 3.10, 12.60, mats, rng, count=11,
                           miss=0.10, seed=53.0)

    # NE: the broken one.
    ne = (CX, CY)
    out += drum('ne', ne, 4.70, 4.35, 0.0, 3.60, mats, bands=4)
    # cos(az + 0.75) peaks at the north-west and bottoms at the south-east,
    # which is the quarter the hero camera stands in: the tower is tallest on
    # the side you see against the sky and lowest on the side you look into.
    # Broken open away from the camera, it read as a cylinder with an untidy
    # lid in every shot on the sheet.
    out += broken_drum('ne', ne, 4.42, 1.45, 3.50,
                       lambda az: 9.1 + 2.6 * (0.5 + 0.5 * n1(az * 3.0, 17.0))
                       + 3.3 * math.cos(az + 0.75),
                       mats, rng, staves=18, gash=(5.05, 6.28))
    # No ledge above the lowest part of the rim: a floor line higher than the
    # wall that carried it renders as a hoop floating over the ruin, with its
    # joist stubs poking into open air.
    out += floor_lines('ne', ne, 4.42, 1.45, (3.50, 7.60), mats)
    out.append(paint(lib.cyl('ne_fill', 3.1, 2.8, 0.5, loc=(ne[0], ne[1], 3.25),
                             segments=14), mats['rubble']))
    out += rubble('ne_rub', (ne[0] + 1.8, ne[1] + 1.7), 5.6, 40, 3.0, rng,
                  [mats['rubble'], mats['old'], mats['dark']])

    # NW: a small square turret, out of plumb.
    nw = (-CX, CY)
    out += square_turret('nw', nw, 6.4, 6.4, 14.00, mats, rng, lean=0.40,
                         seed=41.0)
    out += rubble('nw_rub', (nw[0] - 1.3, nw[1] + 1.4), 3.4, 14, 1.2, rng,
                  [mats['rubble'], mats['old']])

    # SW: barely a tower any more. A knee-high ring and a heap.
    sw = (-CX, -CY)
    out += broken_drum('sw', sw, 4.05, 1.35, 0.04,
                       lambda az: 2.1 + 2.3 * (0.5 + 0.5 * n1(az * 2.4, 23.0)),
                       mats, rng, staves=16, gash=(2.4, 4.1))
    out += rubble('sw_rub', (sw[0] - 0.8, sw[1] - 1.1), 5.0, 30, 2.0, rng,
                  [mats['rubble'], mats['old'], mats['dark']])

    # The spoil from the east wall's collapse, inside and out.
    out += rubble('ec_out', (OX + 1.6, 2.0), 4.8, 42, 3.1, rng,
                  [mats['rubble'], mats['old'], mats['dark']])
    out += rubble('ec_in', (OX - WT - 2.6, 2.0), 5.0, 28, 2.2, rng,
                  [mats['rubble'], mats['old']])
    return out


# ---------------------------------------------------------------- moss


def stone_rules(mats):
    """Everything painted onto the masonry after it is joined into one mesh.

    Six rules, applied in order so the later ones win:

      patched / bleached   two other tones of the same stone in coherent
                blocks -- one build campaign against another, a wall that has
                been robbed and made up, a face that has taken the weather.
                Without these the curtain is one flat grey for forty metres.
      plinth    damp staining in the first metre and a half. Cheap, and it is
                what stops the walls looking like they were set down on the
                grass this morning.
      repaired  the rebuilt stretch of the south wall, in clean lighter stone,
                on the wall *face* and not only on its crenellations
      lichen    a barely-green grey, high and dry, on tops and north faces
      moss      dark olive, low and wet

    Three things had to be learned here by looking at renders, and they are the
    whole of what this toolkit can do about weathering.

    The arithmetic. n3() is close to uniform on -1..1, so a threshold p covers
    about (p+1)/2 of the faces offered to it. Pass one ran p near zero on every
    horizontal and every north face and came out over ninety per cent covered:
    the north-west turret rendered as a solid green block. Pass two
    overcorrected to almost nothing.

    The distribution, which matters more than the amount. Growth scattered
    evenly over a wall reads as confetti, because each patch is exactly one
    1.7 x 1.3 m quad and a lone green quad is a tile, not a plant. Growth
    banded along the foot and under the ledges reads as growth, because that is
    where the eye expects it and because neighbouring faces join into a run.
    So the ambient term is near zero and the weight is on height and facing.

    And the camera. Moss placed where moss actually grows -- the north side --
    is invisible from a hero camera looking at the south and east faces, which
    is most of what the contact sheet judges. Correct is not the same as
    legible. The tonal rules above are what carry the age on the sunlit faces;
    the green only ever does the shaded ones."""

    def maintained(c):
        # The rebuilt south stretch and the gatehouse are kept up. The contrast
        # is the entire point of having them. The boundary is deliberately
        # ragged: a straight vertical edge between old and new stone reads as
        # masking tape.
        edge = 1.6 * n3(c.x * 0.9, c.z * 0.9, 0.0, 7.7)
        if c.y < -OY + 2.4 and -23.5 + edge < c.x < -2.5 + edge:
            return True
        return c.y < -OY - 0.8 and -0.5 < c.x < 12.5

    def patched(c, n):
        return n3(c.x * 0.42, c.y * 0.42, c.z * 0.75, 5.1) < -0.30

    def bleached(c, n):
        return n3(c.x * 0.63, c.y * 0.63, c.z * 0.5, 9.4) > 0.34

    def plinth(c, n):
        if c.z > 2.4:
            return False
        return n3(c.x * 1.1, c.y * 1.1, c.z * 1.6, 3.7) < 0.55 - 0.42 * c.z

    def repaired(c, n):
        edge = 1.6 * n3(c.x * 0.9, c.z * 0.9, 0.0, 7.7)
        return c.y < -OY + 2.4 and -23.2 + edge < c.x < -3.2 + edge

    def lichen(c, n):
        if maintained(c):
            return False
        p = -0.94
        p += 0.36 * max(0.0, n.z - 0.2)          # ledges, string courses, tops
        p += 0.34 * max(0.0, n.y)                # the side that never dries
        p += 0.30 * min(1.0, max(0.0, (c.z - 7.0) / 9.0))
        return n3(c.x * 0.8, c.y * 0.8, c.z * 0.7, 2.4) < min(p, 0.0)

    def moss(c, n):
        if maintained(c):
            return False
        p = -0.92
        p += 0.98 * math.exp(-max(0.0, c.z - 0.5) / 2.9)   # the wet foot
        p += 0.56 * max(0.0, n.y)                          # north faces
        p += 0.30 * max(0.0, n.z - 0.30)                   # ledges and tops
        p -= 0.42 * max(0.0, -n.y)                         # the sunlit south
        # A merlon is one face deep. Once a rule fires on it the whole
        # block is green, and a solid green block reads as paint no matter
        # how defensible the rule was, so growth is damped with height.
        p -= 0.34 * min(1.0, max(0.0, (c.z - 8.0) / 6.0))
        return n3(c.x * 0.7, c.y * 0.7, c.z * 0.55, 0.0) < min(p, 0.24)

    return [(mats['dark'], patched), (mats['pale'], bleached),
            (mats['dark'], plinth), (mats['new'], repaired),
            (mats['lichen'], lichen), (mats['moss'], moss)]


# ---------------------------------------------------------------- build

def build():
    mats = palette()
    rng = random.Random(20250908)
    root = lib.part('castle')

    parts = []
    for run in curtain_runs():
        parts += run.build(mats, rng)
    parts += towers(mats, rng)
    parts += gatehouse(mats, rng)
    parts += keep(mats, rng)

    # Split by what each part is made of before joining. repaint() tests a face
    # by position and normal, and cannot tell that the face it is about to
    # paint with moss is an oak gate leaf or an iron portcullis bar -- so the
    # non-stone fittings are joined into their own object and never offered to
    # the rules at all.
    stone_mats = {mats[k].name for k in ('old', 'dark', 'pale', 'new', 'rubble')}
    masonry = [o for o in parts
               if o.data.materials and o.data.materials[0].name in stone_mats]

    # Smoke goes in its own group, and it is the only group a texturing pass
    # must leave alone.
    #
    # Its material is translucent (alpha 0.34). A bake replaces the material
    # with image maps wired into a fresh Principled, which has no alpha, so a
    # skinned castle comes back with solid pale-grey cubes sitting over its
    # roofs. In daylight that reads as clumsy; at night it is the brightest
    # thing in frame. Separating it here is what lets the skin pass skip it.
    vapour = [o for o in parts
              if o.data.materials and o.data.materials[0].name == mats['smoke'].name]
    done = set(masonry) | set(vapour)
    fittings = [o for o in parts if o not in done]

    joined = lib.merge_into('masonry', unrotated_first(masonry), parent=root)
    lib.repaint(joined, stone_rules(mats))
    lib.merge_into('fittings', unrotated_first(fittings), parent=root)
    lib.merge_into('ward', unrotated_first(courtyard(mats, rng)), parent=root)
    if vapour:
        lib.merge_into('vapour', unrotated_first(vapour), parent=root)


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def main():
    args = argv()
    name = args[0] if args else 'castle'
    report = []
    lib.reset()
    build()
    lib.export(name, report)
    lib.summarise(report)


main()
