# A 1960s European sports car: the engine under a very long bonnet, the cabin
# pushed right back over the rear axle, and a roof that falls away into a short
# tail.
#
#   blender --background --python demo_sports_car.py -- demo_sports_car
#   blender --background --python shots.py           -- demo_sports_car
#
# WHY THIS IS A LOFT
# ------------------
# The other demonstration models are architecture: a tower, a shed on a hull, a
# machine assembled out of castings. This one is a single formed surface, and
# almost nothing about it is a box. Its cross-section is known at every point
# along the length — the mouth at the nose, the wings swelling over the front
# wheels, the waist tucking in between the axles, the haunch swelling again over
# the rear, the tail drawing back down — so BODY below is that table and
# lib.loft() skins it. Pulling this out of a cube would mean arriving at all of
# it by loop cut and eye, and the one thing the shape cannot survive is being
# approximate.
#
# The table keeps paying afterwards. The wheel arches are a column in it, so
# they are cut by the same surface they interrupt rather than punched through
# it later. The chrome sill is swept along the line the table defines. The
# glasshouse sits on the height the table reports at the exact half-width the
# side glass stands on, so there is no gap and no step. Nothing above or below
# the skin has to guess where the skin is.
#
# WHAT MAKES IT READ AS THIS CAR AND NOT A HATCHBACK
# --------------------------------------------------
# Proportion, and only proportion. 2.24 m of the 4.37 m overall — a shade over
# half — is ahead of the foot of the windscreen, and 1.11 m is behind the back
# of the roof. Front to back the car is nothing like symmetric, and that
# asymmetry is doing more work than every chrome fitting on it put together. It
# is also low: 1.21 m to the roof is 0.69 of the 1.75 m scale figure, so the
# roof passes under a standing person's shoulder.
#
# AXES. Blender is Z-up and the exporter maps it to glTF's Y-up. Here:
# +X is forward, +Y is the car's left, +Z is up. Right-hand drive, so the
# steering wheel is at -Y.
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# the toolkit lives one directory up, in scripts/
sys.path.append(os.path.join(HERE, os.pardir, 'scripts'))
import lib                      # noqa: E402
from boxmodel import Form       # noqa: E402


# ---------------------------------------------------------------- the body table
#
# One row per station, nose to tail. Every other part of the car reads these
# six numbers through station().
#
#   hw     maximum half width, at the waist line. This column alone is the
#          wing-swell-waist-swell plan shape, and it is what top.png shows.
#   topw   half width where the flank turns over onto the top surface. Much
#          narrower than hw over the wheels: that difference IS the wing.
#   topc   height of the top surface on the centreline — bonnet, scuttle, deck.
#   crown  how far above topc the shoulder stands. Zero down the middle of the
#          car and largest over the axles, which is what makes the wing crowns
#          and the rear haunch instead of a flat lid.
#   floor  underside of the car on the centreline.
#   sill   bottom edge of the outer skin. Down at the rocker between the axles
#          and lifted clear of the tyre over them, so this column is the wheel
#          arch: an opening in the surface, not a hole cut in it afterwards.

#            x       hw     topw   topc   crown  floor  sill
BODY = (
    # The front cap is the face the mouth is cut in, so it is sized to hold
    # the mouth and no larger. Taper the nose past that and the oval has
    # nowhere to sit: it ends up inside the bodywork, and the front of the car
    # loses the one feature everything else on it is arranged around.
    ( 2.150,  0.374, 0.234, 0.620, 0.006, 0.384, 0.394),
    ( 2.090,  0.436, 0.280, 0.648, 0.011, 0.342, 0.354),
    ( 2.030,  0.482, 0.322, 0.668, 0.014, 0.318, 0.330),
    ( 1.870,  0.578, 0.402, 0.706, 0.022, 0.262, 0.274),
    ( 1.740,  0.652, 0.462, 0.734, 0.030, 0.226, 0.240),
    ( 1.660,  0.694, 0.494, 0.749, 0.036, 0.212, 0.240),   # front arch opens
    ( 1.500,  0.760, 0.542, 0.771, 0.045, 0.198, 0.560),
    ( 1.280,  0.825, 0.582, 0.798, 0.052, 0.184, 0.674),   # front axle
    ( 1.060,  0.788, 0.618, 0.822, 0.038, 0.174, 0.560),
    ( 0.900,  0.756, 0.638, 0.832, 0.024, 0.170, 0.240),   # front arch closes
    ( 0.820,  0.746, 0.646, 0.838, 0.018, 0.169, 0.198),
    ( 0.480,  0.732, 0.660, 0.850, 0.012, 0.167, 0.188),
    ( 0.040,  0.727, 0.668, 0.862, 0.010, 0.166, 0.186),
    (-0.420,  0.731, 0.670, 0.872, 0.011, 0.167, 0.188),
    (-0.760,  0.752, 0.658, 0.879, 0.022, 0.170, 0.240),   # rear arch opens
    (-0.920,  0.786, 0.644, 0.883, 0.036, 0.174, 0.570),
    (-1.140,  0.825, 0.624, 0.886, 0.052, 0.180, 0.692),   # rear axle
    (-1.360,  0.796, 0.594, 0.883, 0.038, 0.190, 0.570),
    (-1.520,  0.766, 0.566, 0.876, 0.026, 0.202, 0.240),   # rear arch closes
    (-1.620,  0.744, 0.548, 0.870, 0.020, 0.212, 0.222),
    (-1.800,  0.694, 0.512, 0.840, 0.016, 0.244, 0.256),
    (-1.960,  0.622, 0.458, 0.806, 0.012, 0.292, 0.304),
    (-2.070,  0.540, 0.392, 0.762, 0.008, 0.348, 0.360),
    (-2.135,  0.470, 0.325, 0.718, 0.005, 0.404, 0.416),
)

NOSE_X, TAIL_X = BODY[0][0], BODY[-1][0]

# Where the widest point of the section sits, as a fraction of the way from the
# floor to the top. Constant, so the crease it draws down the flank is a smooth
# line rather than something that wanders with the section depth.
WAIST_F = 0.44

FRONT_AXLE_X, REAR_AXLE_X = 1.280, -1.140     # 2.42 m wheelbase
FRONT_R, FRONT_W = 0.315, 0.185
REAR_R, REAR_W = 0.325, 0.205                 # a little fatter at the back
# Wide enough that the tyre nearly fills the arch. Tucked in, the wings
# overhang the wheels by a hand's width on each side and the car reads as a
# body resting on castors rather than as something sitting on its tyres.
FRONT_TRACK_Y, REAR_TRACK_Y = 0.652, 0.660


def station(x):
    """The six numbers of the body table at any point along the length."""
    if x >= BODY[0][0]:
        return BODY[0][1:]
    for a, b in zip(BODY, BODY[1:]):
        if x >= b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            return tuple(av + (bv - av) * t for av, bv in zip(a[1:], b[1:]))
    return BODY[-1][1:]


def waist_z(topc, floor, sill):
    """Height of the widest point. Held clear of the arch opening, so over a
    wheel the fullest part of the wing is above the arch lip rather than
    somewhere inside the wheel."""
    return max(floor + WAIST_F * (topc - floor), sill + 0.045)


def body_section(hw, topw, topc, crown, floor, sill):
    """One closed ring, wound from the underside centre out to port, up the
    flank, over the top and back down the starboard side.

    Sixteen points at every station, whatever the section is doing, so they
    loft together. The arch is the two points at `sill`: level with the floor
    they lie flat and the underside runs out to the rocker in one line; lifted,
    they open a hollow over the tyre with an inner wall and a soffit."""
    pan = min(0.42, hw * 0.56)             # underside, inboard of the tyre
    skin = hw * 0.945                      # half width at the bottom of the skin
    waist = waist_z(topc, floor, sill)
    top = topc + crown                     # the shoulder, over the wing crown
    port = [
        (0.0,           floor),
        (pan,           floor),
        (pan + 0.05,    sill),             # inner wall of the wheel arch
        (skin,          sill),             # arch soffit / bottom of the rocker
        (hw,            waist),            # widest point of the whole car
        (hw * 0.95,     waist + 0.55 * (top - waist)),
        (topw,          top),              # shoulder
        (topw * 0.62,   topc + crown * 0.35),
        (0.0,           topc),
    ]
    return port + [(-y, z) for y, z in reversed(port[1:-1])]


def top_z(x, y):
    """Height of the top surface at a point on it.

    Anything that stands on the bodywork — the bonnet blister, the glasshouse,
    a mirror — is placed through this rather than by eye, which is the only
    reason those parts land on the skin instead of near it."""
    _, topw, topc, crown, _, _ = station(x)
    pts = ((0.0, topc),
           (topw * 0.62, topc + crown * 0.35),
           (topw, topc + crown))
    a = min(abs(y), topw)
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if a <= y1:
            t = (a - y0) / max(1e-6, y1 - y0)
            return z0 + (z1 - z0) * t
    return pts[-1][1]


def flank_y(x, z):
    """Half width of the outer skin at a height on the flank.

    The companion to top_z(), and for the same reason: a vent, a handle or a
    chrome blade placed off this lands on the skin, where one placed by eye
    lands a centimetre inside it and disappears, or a centimetre outside it and
    floats."""
    hw, topw, topc, crown, floor, sill = station(x)
    waist = waist_z(topc, floor, sill)
    top = topc + crown
    pts = ((hw * 0.945, sill),
           (hw, waist),
           (hw * 0.95, waist + 0.55 * (top - waist)),
           (topw, top))
    if z <= pts[0][1]:
        return pts[0][0]
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if z <= z1:
            t = (z - z0) / max(1e-6, z1 - z0)
            return y0 + (y1 - y0) * t
    return pts[-1][0]


def arch_open(x):
    """True where the sill column has lifted clear of the rocker — used to tell
    the shadowed inside of a wheel arch from the painted flank above it."""
    return station(x)[-1] > 0.30


def body(pal):
    obj = lib.loft('body', [(row[0], body_section(*row[1:])) for row in BODY],
                   smooth=False)
    # One surface, so the arch linings and the underbody cannot be separate
    # meshes; they are face assignments. Later rules win, so this reads
    # outermost-last.
    lib.repaint(obj, [
        (pal['paint'], lambda c: True),
        # Everything the light never reaches: the floor pan, and the soffit,
        # lip and lining of each arch. Without this the arch is a green tunnel
        # and the wheel loses the dark surround that says it is set into the
        # car. The arch threshold is slacker than the underbody one because the
        # soffit is steeply raked where it climbs over the tyre, and a rule
        # tight enough for a flat floor leaves the mouth of each arch painted.
        (pal['shadow'], lambda c, n: n.z < -0.50 and c.z < 0.45),
        (pal['shadow'], lambda c, n: n.z < -0.28 and arch_open(c.x)),
        (pal['shadow'], lambda c, n: n.y * c.y < -0.35 and c.z < 0.80),
    ])
    return obj


# ---------------------------------------------------------------- the glasshouse
#
# A second loft, sharing the first one's surface as its floor. Separate because
# the cabin genuinely is a separate element on a car of this shape — it is
# glass sitting on paint — and because the two want different colours on
# different faces.
#
#   x    w    hi
# hi equal to the base means the ring has collapsed flat: at the scuttle that
# is the foot of the windscreen, at the back it is where the roof runs out into
# the deck. The sweep between a collapsed ring and a full one is the screen, so
# the wraparound comes out of the same table as everything else.

GLASS = (
    (-0.060, 0.605, None),        # foot of the windscreen
    (-0.240, 0.600, 1.045),
    (-0.460, 0.585, 1.172),       # top of the screen, front of the roof
    (-0.740, 0.570, 1.198),
    (-1.080, 0.558, 1.186),       # back of the roof
    (-1.300, 0.545, 1.126),
    (-1.500, 0.522, 1.030),
    (-1.720, 0.480, None),        # the roofline runs out into the rear deck
)

ROOF_X0, ROOF_X1 = -1.160, -0.420     # the painted panel between the screens


def glass_base(x, w):
    """Where the side glass stands. Sunk a little into the bodywork, so the two
    surfaces overlap rather than meeting on a line that daylight can find."""
    return top_z(x, w) - 0.030


def glass_section(w, lo, hi):
    live = 1.0 if hi - lo > 0.02 else 0.0
    port = [
        (0.0,        lo),
        (w,          lo),
        (w * 0.985,  lo + 0.78 * (hi - lo)),     # tumblehome: the glass leans in
        (w * 0.80,   hi - 0.012 * live),         # cant rail
        (w * 0.46,   hi),
        (0.0,        hi + 0.008 * live),         # crown of the roof
    ]
    return port + [(-y, z) for y, z in reversed(port[1:-1])]


def glasshouse(pal):
    stations = []
    for x, w, hi in GLASS:
        lo = glass_base(x, w)
        stations.append((x, glass_section(w, lo, hi if hi else lo)))
    obj = lib.loft('glasshouse', stations, smooth=False)
    lib.repaint(obj, [
        (pal['glass'], lambda c: True),
        # The roof is painted, and it is the only part of this mesh that is. An
        # unbroken glass shell from scuttle to deck reads as a bubble car. The
        # threshold is low enough to take in the cant rail as well as the flat
        # of the roof: a bright band of glass left running along the top edge
        # of the cabin is the same mistake in miniature, and it is the one that
        # shows from above.
        (pal['paint'], lambda c, n: n.z > 0.40 and ROOF_X0 < c.x < ROOF_X1),
    ])
    return obj


# ---------------------------------------------------------------- swept chrome

def sweep(name, path, half_w, half_h, side):
    """A chrome blade swept along a line on the body.

    profile() frames its section against world up, so for a path running
    forward the section's first axis points to starboard; negating it for the
    left-hand side is what puts both blades on the outside of the car."""
    outboard = -side
    section = [(0.0, half_h), (outboard * half_w, half_h * 0.45),
               (outboard * half_w, -half_h * 0.45), (0.0, -half_h)]
    return lib.profile(name, section, path, close=True, smooth=False)


def sill_blade(side):
    """The chrome rocker moulding, between the two arches.

    Swept along the sill the body table already defines, so it follows the
    rocker instead of cutting across it, and it draws the one horizontal line
    on a car that is otherwise all curves. Thin: a broad bright plank down
    there reads as a running board off a much older, much heavier car."""
    path = []
    for x in sorted(row[0] for row in BODY if -0.680 <= row[0] <= 0.830):
        z = station(x)[-1] + 0.050
        path.append((x, side * flank_y(x, z), z))
    return sweep('sill_%d' % (side > 0), path, 0.028, 0.020, side)


def waist_blade(side):
    """The bright strip along the foot of the side glass. Same trick as the
    sill: the path is the line the glasshouse stands on, so it cannot drift off
    it."""
    path = []
    for x, w, hi in reversed(GLASS):
        path.append((x, side * (w + 0.008), glass_base(x, w) + 0.006))
    return sweep('waist_%d' % (side > 0), path, 0.018, 0.014, side)


def screen_pillar(side):
    """The chrome frame up the outer edge of the windscreen."""
    x0, w0, _ = GLASS[0]
    x1, w1, hi1 = GLASS[1]
    x2, w2, hi2 = GLASS[2]
    path = [(x2, side * w2 * 0.885, hi2 - 0.014),
            (x1, side * w1 * 0.965, hi1 - 0.190),
            (x0, side * w0, glass_base(x0, w0) + 0.010)]
    return sweep('apillar_%d' % (side > 0), path, 0.021, 0.019, side)


def quarter_bumper(name, xs, z, side):
    """A short chrome blade wrapped round one corner of the car.

    Quarter bumpers, not a full-width blade: a bar across the whole nose is a
    saloon car's answer to a car park, and it would cut straight across the
    oval mouth that the front of this car is built around. The path is taken
    off flank_y(), so each blade hugs the corner it is on."""
    path = [(x, side * (flank_y(x, z) + 0.014), z) for x in xs]
    return sweep(name, path, 0.032, 0.030, side)


# ---------------------------------------------------------------- the wheels

def wheel(name, r, width, x, y, parent, pal):
    """One wire wheel, under an empty at the axle so an engine can turn it.

    Concentric bands, not a disc. A dark tyre with nothing inside it reads as a
    hole punched through the car at any size below about a hundred pixels, and
    a hole is worse than a wrong wheel. So: dark tyre, a pale rim inside it, a
    shadowed field where sixty wire spokes would be, and a chrome spinner in
    the middle. Modelling the spokes themselves is worse than not: four of them
    is not a wire wheel and sixty is a flat grey disc at any size this is drawn
    at, whereas the bands read the whole way down.

    The tyre's segment count is a multiple of four so a vertex lands at bottom
    dead centre; with an odd count the flat of a facet carries the weight and
    the car hovers a centimetre off the ground."""
    hub = lib.part(name, loc=(x, y, r), parent=parent)
    at = dict(loc=(x, y, r), rot=(math.pi / 2, 0, 0))   # the axis onto world Y
    pieces = [
        paint(lib.ring(name + '_tyre', r * 0.720, r, width, segments=16, **at),
              pal['rubber']),
        paint(lib.cyl(name + '_rim', r * 0.740, r * 0.740, width * 0.42,
                      segments=12, **at), pal['wire']),
        # Standing proud of the rim disc rather than flush with it: sunk level
        # the spoke field is a colour on a plate, and one facet of shading
        # either way makes it vanish.
        paint(lib.ring(name + '_field', r * 0.260, r * 0.620, width * 0.54,
                       segments=10, **at), pal['spokefield']),
        paint(lib.cyl(name + '_spinner', r * 0.190, r * 0.155, width * 0.86,
                      segments=6, **at), pal['chrome']),
    ]
    lib.merge_into(name + '_mesh', pieces, hub)
    return hub


# ---------------------------------------------------------------- the nose

def grille(pal):
    """The oval mouth, and the only opening in the front of the car.

    A ring rather than a dark rectangle: an oval surround with daylight — well,
    shadow — inside it is the single most recognisable thing about this shape,
    and a painted-on patch loses it the moment the light moves."""
    parts = []
    # Set at the station where the nose is still full width rather than on the
    # rounded tip in front of it, so the mouth is a hole in the face of the car
    # and not a hoop hung off its point.
    gx = NOSE_X
    _, _, topc, _, floor, _ = station(gx)
    cz = (floor + topc) / 2 + 0.006

    parts.append(paint(lib.box('mouth', (0.11, 0.560, 0.180), chamfer=0.02,
                               loc=(gx - 0.046, 0.0, cz)), pal['shadow']))

    # lib.ring lies in its own XY plane with the hole along local Z. Rotated a
    # quarter turn about Y that axis points forward, local Y becomes world Y
    # and local X becomes world Z — so squashing local X is what makes the
    # circle an oval that is wide and shallow rather than tall and narrow.
    ring = lib.ring('grille_ring', 0.285, 0.325, 0.062, segments=10,
                    loc=(gx + 0.002, 0.0, cz), rot=(0.0, math.pi / 2, 0.0))
    ring.scale = (0.323, 1.0, 1.0)
    parts.append(paint(ring, pal['chrome']))

    for i, z in enumerate((-0.042, 0.0, 0.042)):
        parts.append(paint(lib.box('grille_bar%d' % i, (0.05, 0.530, 0.016),
                                   loc=(gx - 0.010, 0.0, cz + z)),
                           pal['chrome']))
    return parts


def headlamps(pal):
    """Faired into the wing tops under a cover, the way a fast car of this
    period carried them, rather than standing on stalks.

    Set on the wing rather than in the nose: it is the pair of blisters either
    side of a low mouth that dates the car, and they are also what stops the
    front three-quarter view being one unbroken green sweep."""
    parts = []
    for i, side in enumerate((1, -1)):
        x, y = 1.885, side * 0.352
        z = top_z(x, y) - 0.034
        parts.append(paint(lib.cyl('lamp_pod%d' % i, 0.104, 0.098, 0.200,
                                   loc=(x, y, z), rot=(0.0, math.pi / 2, 0.0),
                                   segments=8), pal['paint']))
        # A chrome ring standing proud of the pod, and the lens set behind it.
        # Flush with the paint the bezel is a change of colour on a curve and
        # the lamp reads as a white smear on the wing; standing out, it catches
        # its own highlight and the lamp becomes a fitting.
        parts.append(paint(lib.cyl('lamp_rim%d' % i, 0.101, 0.101, 0.030,
                                   loc=(x + 0.104, y, z),
                                   rot=(0.0, math.pi / 2, 0.0), segments=8),
                           pal['chrome']))
        parts.append(paint(lib.cyl('lamp_lens%d' % i, 0.082, 0.074, 0.024,
                                   loc=(x + 0.108, y, z),
                                   rot=(0.0, math.pi / 2, 0.0), segments=8),
                           pal['lamp']))
    return parts


def bonnet_blister(pal):
    """The power bulge down the middle of the bonnet.

    Grown and warped rather than lofted, because it is not a section swept
    along a path — it is a patch of the bonnet lifted away from the surface
    underneath it, and warp() takes the whole vertex, so the underside can be
    laid straight onto top_z() while the top rides above it."""
    x0, x1 = 0.300, 1.930
    half, rise = 0.255, 0.062
    f = Form(size=(x1 - x0, half * 2, 0.20), at=((x0 + x1) / 2, 0.0, 0.80))
    f.cut_at('x', [0.60, 0.90, 1.20, 1.50, 1.74])
    f.cut_at('y', [-0.120, 0.120])

    def blister(x, y, z):
        t = min(1.0, max(0.0, (x - x0) / (x1 - x0)))
        # Runs out to nothing at both ends. A blister that stops square is a
        # box on the bonnet, which is the one thing it must not be.
        along = math.sin(t * math.pi) ** 1.2
        across = 1.0 - (abs(y) / half) ** 2
        skin = top_z(x, y)
        if z > 0.80:
            return (x, y, skin + rise * along * across)
        return (x, y, skin - 0.060)
    f.warp(blister)
    f.bevel(0.012, min_angle=18)
    return [paint(f.build('bonnet_blister'), pal['paint'])]


# ---------------------------------------------------------------- the tail

def tail(pal):
    parts = []
    # On the tail panel, straddling the end of the body rather than sunk into
    # the flank ahead of it: the tail draws in sharply over the last 200 mm, so
    # a lamp placed a hand's width forward of the end is inside the car.
    for i, side in enumerate((1, -1)):
        parts.append(paint(lib.box('taillamp%d' % i, (0.045, 0.150, 0.070),
                                   chamfer=0.010,
                                   loc=(TAIL_X - 0.010, side * 0.300, 0.640)),
                           pal['taillamp']))
    # Twin pipes under the tail, close in to the centreline rather than out at
    # the corners: paired and together is what says one engine with two
    # silencers, which is the noise the shape is promising.
    for i, side in enumerate((1, -1)):
        parts.append(paint(lib.cyl('exhaust%d' % i, 0.048, 0.052, 0.320,
                                   loc=(-2.030, side * 0.135, 0.318),
                                   rot=(0.0, math.pi / 2, 0.0), segments=8),
                           pal['chrome']))
    return parts


# ---------------------------------------------------------------- the cabin

def interior(pal):
    """Two seats, a dash and a wheel.

    Glass with nothing behind it is a coloured panel, and on this car the
    inside is half the argument: tan hide under a dark green roof is the part
    that says it cost money."""
    parts = []
    for i, side in enumerate((1, -1)):
        parts.append(paint(lib.box('seat_pan%d' % i, (0.440, 0.400, 0.090),
                                   chamfer=0.03,
                                   loc=(-0.760, side * 0.265, 0.900)),
                           pal['hide']))
        # Kept clear of the roof by more than the rake can eat. Sized off the
        # seat rather than off the headroom, the top corner of a reclined
        # squab stands proud of the cant rail and two tan blocks appear on the
        # outside of the roof, which shows in top.png and nowhere else.
        parts.append(paint(lib.box('seat_back%d' % i, (0.105, 0.370, 0.255),
                                   chamfer=0.03, rot=(0.0, -0.20, 0.0),
                                   loc=(-0.985, side * 0.265, 0.995)),
                           pal['hide']))
    parts.append(paint(lib.box('dash', (0.170, 0.980, 0.070), chamfer=0.02,
                               loc=(-0.215, 0.0, 0.880)), pal['trim']))
    parts.append(paint(lib.box('tunnel', (1.000, 0.230, 0.140), chamfer=0.03,
                               loc=(-0.660, 0.0, 0.895)), pal['trim']))
    rake = 0.42
    parts.append(paint(lib.cyl('column', 0.024, 0.020, 0.210,
                               loc=(-0.420, -0.300, 0.940),
                               rot=(0.0, math.pi / 2 - rake, 0.0), segments=6),
                       pal['trim']))
    parts.append(paint(lib.torus('steering_wheel', 0.132, 0.015,
                                 loc=(-0.520, -0.300, 0.982),
                                 rot=(0.0, math.pi / 2 - rake, 0.0),
                                 major_seg=8, minor_seg=4), pal['hide']))
    return parts


# ---------------------------------------------------------------- flank fittings

def flank(pal):
    parts = []
    for i, side in enumerate((1, -1)):
        # A vent behind the front arch. Three slots, upright and narrow: a
        # broad dark rectangle on the side of a car reads as a window, which
        # puts a second cabin where the engine is.
        for k in range(3):
            x = 0.770 - k * 0.072
            parts.append(paint(lib.box('vent%d%d' % (i, k), (0.026, 0.046, 0.140),
                                       loc=(x, side * flank_y(x, 0.660), 0.660)),
                               pal['chrome']))
        x = -0.520
        parts.append(paint(lib.box('handle%d' % i, (0.115, 0.050, 0.032),
                                   chamfer=0.010,
                                   loc=(x, side * (flank_y(x, 0.782) + 0.008),
                                        0.782)),
                           pal['chrome']))
        # A mirror on each wing, where they belong on a car whose doors are
        # mostly behind the driver. Short stalk, fat head: a scale-correct
        # mirror is a grey hair standing on the wing and reads as an aerial, so
        # the stalk is barely there and the head is deliberately oversized.
        x, y = 1.180, side * 0.548
        z = top_z(x, y)
        parts.append(paint(lib.cyl('mirror_stalk%d' % i, 0.020, 0.018, 0.048,
                                   loc=(x, y, z + 0.022), segments=5),
                           pal['chrome']))
        parts.append(paint(lib.box('mirror_head%d' % i, (0.052, 0.130, 0.078),
                                   chamfer=0.014, rot=(0.0, 0.0, side * -0.22),
                                   loc=(x, y, z + 0.082)), pal['chrome']))
    return parts


def brightwork(pal):
    """Everything chrome that is swept rather than placed."""
    parts = []
    for side in (1, -1):
        parts.append(sill_blade(side))
        parts.append(waist_blade(side))
        parts.append(screen_pillar(side))
        parts.append(quarter_bumper('front_bumper_%d' % (side > 0),
                                    (1.870, 2.010, 2.100), 0.520, side))
        parts.append(quarter_bumper('rear_bumper_%d' % (side > 0),
                                    (-1.860, -2.010, -2.110), 0.600, side))
    x2, w2, hi2 = GLASS[2]
    parts.append(lib.box('screen_header', (0.052, w2 * 1.70, 0.024),
                         chamfer=0.008, loc=(x2 - 0.002, 0.0, hi2 + 0.002)))
    for o in parts:
        paint(o, pal['chrome'])
    return parts


# ---------------------------------------------------------------- assembly

def palette():
    return dict(
        # One saturated colour and nothing else competing with it. Racing
        # green, because green against this much chrome is the combination that
        # reads as expensive, and because it holds its value against grass —
        # which is what this is going to be photographed on.
        paint=lib.hexmat('car_paint', 0x1D6647, rough=0.26, clearcoat=0.70),
        shadow=lib.hexmat('car_shadow', 0x1E2227, rough=0.90),
        chrome=lib.hexmat('car_chrome', 0xC6CCD2, rough=0.24, metal=0.88),
        rubber=lib.hexmat('car_rubber', 0x212428, rough=0.92),
        wire=lib.hexmat('car_wire', 0xD9D3C2, rough=0.40, metal=0.35),
        spokefield=lib.hexmat('car_spokefield', 0x6B6759, rough=0.72),
        # Dark, and only just translucent. Paler glass lets so much of the
        # interior through that the cabin reads as open — the car comes out a
        # roadster with a chrome hoop over it, which is a different car. This
        # is enough to show tan hide behind the screen and no more.
        glass=lib.hexmat('car_glass', 0x2A3B45, rough=0.07, alpha=0.74,
                         clearcoat=0.55),
        hide=lib.hexmat('car_hide', 0x8A5F3A, rough=0.60),
        trim=lib.hexmat('car_trim', 0x2A2C30, rough=0.70),
        # Barely lit. The key light alone already drives a pale lens close to
        # clipping, so emission on top of it puts a block of pure white on the
        # nose next to a chrome bezel that is doing the same thing — two
        # clipped highlights side by side read as one blown patch, and at
        # twelve pixels that patch is a third of the front of the car. This is
        # enough to keep the lenses warm against the chrome around them.
        lamp=lib.hexmat('car_lamp', 0xF3DCA6, rough=0.22, emissive=0.18),
        taillamp=lib.hexmat('car_taillamp', 0xC4342A, rough=0.28, emissive=0.9),
    )


def paint(obj, mat):
    """Give one object one material, so a later merge can keep them apart."""
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def see_through(mat):
    """Make an alpha material actually blend in EEVEE.

    lib.material sets the legacy `blend_method`; the current real-time engine
    reads `surface_render_method` instead, and left on its default the glass
    renders as an opaque pane and the interior behind it is wasted."""
    if hasattr(mat, 'surface_render_method'):
        mat.surface_render_method = 'BLENDED'
    return mat


def build(name, report):
    lib.reset()
    pal = palette()
    see_through(pal['glass'])

    root = lib.part(name)

    lib.merge_into('body', [body(pal)] + bonnet_blister(pal), root)
    lib.merge_into('glasshouse', [glasshouse(pal)], root)
    lib.merge_into('brightwork', brightwork(pal) + grille(pal) + flank(pal), root)
    lib.merge_into('lamps', headlamps(pal) + tail(pal), root)
    lib.merge_into('interior', interior(pal), root)

    for side, y in (('left', FRONT_TRACK_Y), ('right', -FRONT_TRACK_Y)):
        wheel('wheel_front_' + side, FRONT_R, FRONT_W,
              FRONT_AXLE_X, y, root, pal)
    for side, y in (('left', REAR_TRACK_Y), ('right', -REAR_TRACK_Y)):
        wheel('wheel_rear_' + side, REAR_R, REAR_W,
              REAR_AXLE_X, y, root, pal)

    lib.export(name, report)


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def main():
    args = argv()
    report = []
    build(args[0] if args else 'demo_sports_car', report)
    lib.summarise(report)


main()
