# A small inshore fishing boat: eight metres overall, out of the harbour in the
# morning and home the same day.
#
#   blender --background --python demo_fishing_boat.py -- demo_fishing_boat
#
# WHY THIS IS A LOFT
# ------------------
# A hull is the shape whose cross-section is genuinely known at every point
# along its length, and stating those sections IS the design: the flat run of
# the keel amidships, the turn of the bilge softening as it goes forward, the
# topsides flaring outward, and a sheer that dips a third of the way from the
# stern and sweeps up to a stem standing out of a curved forefoot. STATIONS
# below is that table and lib.loft() skins it. Pulling the same form out of a
# cube would mean arriving at every one of those numbers by loop cut and eye.
#
# The table then keeps paying. The rubbing strake is swept along the sheer it
# defines, the keel timber along the bottom it defines, the deck it defines is
# what the wheelhouse and every fitting stand on, and the paint follows the
# same curve. Nothing below the hull ever has to guess where the surface is.
#
# Blender is Z-up. +X is forward, +Y is the boat's port side.
import math
import os
import sys

import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
# the toolkit lives one directory up, in scripts/
sys.path.append(os.path.join(HERE, os.pardir, 'scripts'))
import lib                      # noqa: E402
from boxmodel import Form       # noqa: E402


# ---------------------------------------------------------------- the hull table
#
# One row per station, from transom to stem. Everything else in the file reads
# these six numbers through station().
#
#   half_beam  half the width at the top of the bulwark
#   flare      how much wider the sheer is than the hull at deck level; this is
#              the number that stops the topsides being parallel slabs
#   keel       bottom of the hull on the centreline: flat amidships, tucked up
#              at the transom, sweeping up through the forefoot to the stem
#   deck       the working deck, level aft and rising over the forepeak
#   sheer      top of the bulwark

#            x    half_beam  flare   keel   deck   sheer
STATIONS = (
    (-4.00,       1.06,      0.06,   1.00,  1.62,  2.34),
    (-3.70,       1.24,      0.07,   0.72,  1.62,  2.29),
    (-3.40,       1.34,      0.07,   0.50,  1.62,  2.24),
    (-3.00,       1.41,      0.08,   0.32,  1.62,  2.20),
    (-2.60,       1.44,      0.09,   0.24,  1.62,  2.17),
    (-2.00,       1.45,      0.10,   0.20,  1.62,  2.14),
    (-1.20,       1.45,      0.11,   0.18,  1.62,  2.12),
    (-0.40,       1.45,      0.11,   0.18,  1.62,  2.14),
    ( 0.40,       1.42,      0.12,   0.19,  1.62,  2.19),
    ( 1.20,       1.33,      0.14,   0.24,  1.63,  2.29),
    ( 2.00,       1.17,      0.18,   0.38,  1.70,  2.47),
    ( 2.60,       1.00,      0.21,   0.60,  1.79,  2.64),
    ( 3.10,       0.78,      0.24,   0.90,  1.92,  2.80),
    ( 3.45,       0.60,      0.24,   1.18,  2.04,  2.89),
    ( 3.70,       0.42,      0.20,   1.48,  2.20,  2.96),
    ( 3.88,       0.23,      0.13,   1.78,  2.38,  3.01),
    ( 4.00,       0.07,      0.04,   2.08,  2.55,  3.05),
)

# The bilge, as (half-beam, height) fractions of the section between the keel
# and the deck. Same curve at every station; the station's own numbers stretch
# it. Points bunch low, where the bilge actually turns.
BILGE = ((0.00, 0.000), (0.30, 0.030), (0.56, 0.100),
         (0.78, 0.230), (0.92, 0.390))

# The paint. Level along the run of the hull is what a real waterline is, but a
# boot top is *painted* to a fraction of the section so that it sweeps up at
# both ends and looks level when the boat is trimmed. Following the section is
# also what keeps the line smooth: it stays on one edge loop the whole way,
# instead of stepping from one loop to the next wherever they cross a plane.
BOOT_FRACTION = 0.55
BOOT_WIDTH = 0.13

BULWARK_T = 0.085             # thickness of the bulwark, and of its cap rail


def station(x):
    """The six numbers of the hull table at any point along the length."""
    if x <= STATIONS[0][0]:
        return STATIONS[0][1:]
    for a, b in zip(STATIONS, STATIONS[1:]):
        if x <= b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            return tuple(av + (bv - av) * t for av, bv in zip(a[1:], b[1:]))
    return STATIONS[-1][1:]


def deck_z(x):
    return station(x)[3]


def sheer_z(x):
    return station(x)[4]


def boot_z(x):
    """Height of the boot top's lower edge at station x."""
    _, _, keel, deck, _ = station(x)
    return keel + BOOT_FRACTION * (deck - keel)


def outer_y(x, drop):
    """Half beam on the outside of the bulwark, `drop` metres below the sheer.

    Between deck level and the sheer the topside is the straight flared run, so
    this is where a strake, a fender or a chainplate lands on the skin."""
    half, flare, _, deck, sheer = station(x)
    t = min(1.0, max(0.0, (sheer - drop - deck) / max(1e-6, sheer - deck)))
    return (half - flare) + flare * t


def hull_section(half, flare, keel, deck, sheer):
    """One closed ring, wound from the keel out to port, over the bulwark,
    across the deck and back down the starboard side.

    The ring encloses the solid part of the boat: hull below the deck, and the
    two bulwark walls standing on it. Every station has the same 22 points, so
    they loft together whatever the section is doing."""
    w = half - flare                       # half beam at deck level
    t = min(BULWARK_T, w * 0.45)           # collapses with the section at the stem
    h = deck - keel
    fy, fz = BILGE[-1]
    z_bilge, y_bilge = keel + fz * h, w * fy

    def on_topside(z):
        k = (z - z_bilge) / max(1e-6, deck - z_bilge)
        return y_bilge + (w - y_bilge) * k

    boot_lo = keel + BOOT_FRACTION * h
    boot_hi = min(boot_lo + BOOT_WIDTH, deck - 0.08)

    port = [(w * a, keel + b * h) for a, b in BILGE]
    port += [(on_topside(boot_lo), boot_lo),
             (on_topside(boot_hi), boot_hi),
             (w, deck),                    # deck-level corner of the topside
             (half, sheer),                # outboard top of the bulwark
             (half - t, sheer),            # inboard top of the bulwark
             (w - t, deck)]                # foot of the bulwark, on deck
    starboard = [(-y, z) for y, z in reversed(port)][:-1]
    return port + [(0.0, deck + 0.05 * min(1.0, w))] + starboard


def hull(paint):
    obj = lib.loft('hull', [(row[0], hull_section(*row[1:])) for row in STATIONS])
    # Painted per face rather than per object: the hull is one surface, so the
    # antifouling, the boot top, the deck and the bulwarks cannot be separate
    # meshes. Later rules win, so this list reads outermost-last.
    lib.repaint(obj, [
        (paint['topside'], lambda c: True),
        (paint['antifoul'], lambda c: c.z < boot_z(c.x)),
        (paint['boot'], lambda c: boot_z(c.x) <= c.z <= boot_z(c.x) + BOOT_WIDTH + 0.02),
        (paint['bulwark'], lambda c, n: c.z > deck_z(c.x) + 0.03 and n.y * c.y < -0.15),
        (paint['deck'], lambda c, n: n.z > 0.55 and abs(c.z - deck_z(c.x)) < 0.12),
        (paint['caprail'], lambda c, n: n.z > 0.45 and c.z > deck_z(c.x) + 0.16),
    ])
    # A hull flows; artconfig's flat default would break it into facets. The
    # threshold keeps the chine at the deck and the corners of the bulwark hard.
    return lib.shade_auto(obj, 34)


# ---------------------------------------------------------------- swept timber

def rubbing_strake(x_end, side):
    """The gunwale band, swept along the sheer with lib.profile().

    profile() frames the section against world up, so for a path running
    forward the section's first axis points to starboard: negating it for the
    port side is what puts both bands on the outside of the boat."""
    xs = [row[0] for row in STATIONS if row[0] <= x_end]
    path = [(x, side * outer_y(x, 0.20), sheer_z(x) - 0.20) for x in xs]
    outboard = -side
    section = [(outboard * -0.02, 0.10), (outboard * 0.06, 0.075),
               (outboard * 0.10, 0.0), (outboard * 0.06, -0.075),
               (outboard * -0.02, -0.10)]
    return lib.profile('strake_%s' % ('p' if side > 0 else 's'), section, path,
                       close=True)


def keel_timber():
    """The keel and the deadwood forward of it, swept along the hull bottom.

    Same idea as the strake and the same reason: the path is already in the
    table, so the timber lands on the hull instead of near it."""
    x0, x1 = -3.45, 3.60
    xs = [x0] + [row[0] for row in STATIONS if x0 < row[0] < x1] + [x1]
    path = [(x, 0.0, station(x)[2] - 0.08) for x in xs]
    return lib.profile('keel', lib.rect_section(0.20, 0.20), path, close=True,
                       smooth=False)


def strut(name, a, b, r, r_top=None, segments=6):
    """A cylinder between two points: a mast, a boom, a stay, a fender rope.

    Stating both ends and deriving the rotation is what keeps a raked spar and
    the things hung off it in agreement; an Euler written by hand does not."""
    a, b = mathutils.Vector(a), mathutils.Vector(b)
    d = b - a
    return lib.cyl(name, r, r if r_top is None else r_top, d.length,
                   loc=tuple((a + b) / 2),
                   rot=d.to_track_quat('Z', 'Y').to_euler(), segments=segments)


# ---------------------------------------------------------------- above deck

WH_X0, WH_X1 = -3.10, -0.50   # wheelhouse, set aft over the engine
WH_HALF = 1.02
WH_TOP = 3.60
WH_KNUCKLE = 2.86             # where the vertical front becomes the windscreen
WH_RAKE = 0.26
ROOF_Z = WH_TOP + 0.05

MAST_X = -0.15                # stepped on deck just forward of the wheelhouse
MAST_TOP = 7.87               # four and a half times a person, at the truck
MAST_RAKE = 0.42              # how far aft the truck stands over the heel


def mast_x(z):
    """Where the mast is at a given height. It rakes aft, so the crosstrees,
    the gooseneck and every stay have to rake with it."""
    heel = deck_z(MAST_X)
    return MAST_X - MAST_RAKE * (z - heel) / (MAST_TOP - heel)


def wheelhouse():
    """Grown from a cube, because unlike the hull it is a box with things done
    to it: tumblehome in the sides and a windscreen raked back off a knuckle."""
    deck = deck_z(WH_X0)
    f = Form(size=(WH_X1 - WH_X0, WH_HALF * 2, WH_TOP - deck),
             at=((WH_X0 + WH_X1) / 2, 0.0, (deck + WH_TOP) / 2))
    f.cut_at('z', [WH_KNUCKLE])
    f.taper(deck, WH_TOP, 1.0, 0.94, axes='y')
    f.warp(lambda x, y, z: (
        x - WH_RAKE * max(0.0, z - WH_KNUCKLE) / (WH_TOP - WH_KNUCKLE)
        if x > WH_X1 - 0.05 else x, y, z))
    f.bevel(0.03, min_angle=20)
    return f.build('wheelhouse')


def wheelhouse_trim(paint):
    """Glass on the raked front and the tumbled-home sides, and the door aft.

    The rake angle comes from the same two constants the Form was warped by,
    so the panels cannot drift off the face they belong to."""
    ang = math.atan2(WH_RAKE, WH_TOP - WH_KNUCKLE)
    zc = WH_KNUCKLE + 0.40
    xf = WH_X1 - WH_RAKE * (zc - WH_KNUCKLE) / (WH_TOP - WH_KNUCKLE)
    out = []
    for i, y in enumerate((0.0, 0.63, -0.63)):
        out.append(lib.box('screen%d' % i, (0.05, 0.56, 0.52),
                           loc=(xf + 0.03 * math.cos(ang), y,
                                zc + 0.03 * math.sin(ang)),
                           rot=(0.0, -ang, 0.0)))
    # Two lights a side with a mullion between them. One long pane reads as a
    # hole cut in the wheelhouse rather than as windows.
    for i, y in enumerate((1.0, -1.0)):
        for j, x in enumerate((-0.95, -1.75)):
            out.append(lib.box('sidelight%d%d' % (i, j), (0.62, 0.05, 0.46),
                               loc=(x, y, WH_KNUCKLE + 0.28)))
    out.append(lib.box('doorlight', (0.05, 0.44, 0.40),
                       loc=(WH_X0 - 0.075, -0.52, WH_KNUCKLE + 0.20)))
    for o in out:
        lib.attach(o, None, paint['glass'])
    # The door reads from astern, which is two of the four hero headings; an
    # unbroken white panel back there is the tell that nobody goes inside.
    deck = deck_z(WH_X0)
    top = WH_KNUCKLE + 0.44
    out.append(lib.attach(
        lib.box('door', (0.06, 0.68, top - deck), chamfer=0.02,
                loc=(WH_X0 - 0.04, -0.52, (deck + top) / 2)),
        None, paint['timber']))
    return out


def rig(paint):
    """Mast, derrick and standing rigging. The mast is stepped just forward of
    the wheelhouse and the boom tops up over the working deck."""
    heel = deck_z(MAST_X)
    mast = strut('mast', (MAST_X, 0.0, heel), (mast_x(MAST_TOP), 0.0, MAST_TOP),
                 0.115, 0.055, segments=8)
    trees = lib.box('crosstrees', (0.07, 1.45, 0.06), loc=(mast_x(5.60), 0.0, 5.60))
    boom = strut('boom', (mast_x(3.42) + 0.16, 0.0, 3.42), (2.95, 0.0, 4.12),
                 0.065, segments=8)
    # The crosstrees lead the list, not the mast. merge_into() joins everything
    # into the first part, so the merged object inherits that part's rotation —
    # and a rotated object's bounding box over-reports its own size, which
    # quietly mis-frames every shot in the contact sheet.
    parts = [lib.attach(o, None, paint['timber']) for o in (trees, mast, boom)]

    rigging = [strut('lift', (mast_x(6.55), 0.0, 6.55), (2.98, 0.0, 4.16), 0.022)]
    for i, side in enumerate((1, -1)):
        head = (mast_x(5.58), side * 0.70, 5.58)
        rigging.append(strut('shroud_a%d' % i, head,
                             (-1.55, side * outer_y(-1.55, 0.06), sheer_z(-1.55)), 0.020))
        rigging.append(strut('shroud_f%d' % i, head,
                             (1.15, side * outer_y(1.15, 0.06), sheer_z(1.15)), 0.020))
    for o in rigging:
        lib.attach(o, None, paint['wire'])
    return parts + rigging


def deck_gear(paint):
    """What makes it a working boat rather than a hull with a shed on it:
    fenders over the side, boxes for the catch, a hauler, a hatch."""
    parts = []

    def add(obj, mat):
        parts.append(lib.attach(obj, None, mat))
        return obj

    # The fish hold, amidships where the weight belongs: a raised coaming with
    # a timber cover over it. This is the fitting that stops the working deck
    # reading as an empty trough from above, which is most of what separates a
    # fishing boat from a bathtub with a shed on it.
    add(lib.box('hold_coaming', (1.26, 1.14, 0.24), chamfer=0.02,
                loc=(0.78, 0.0, deck_z(0.78) + 0.12)), paint['bulwark'])
    add(lib.box('hold_cover', (1.34, 1.22, 0.10), chamfer=0.03,
                loc=(0.78, 0.0, deck_z(0.78) + 0.29)), paint['timber'])

    # A coaming across the deck at the break of the foredeck, so the well and
    # the foredeck read as two spaces rather than one long trough.
    add(lib.box('breakwater', (0.11, 1.86, 0.28), chamfer=0.02,
                loc=(1.95, 0.0, deck_z(1.95) + 0.14)), paint['bulwark'])

    # Fish boxes, stacked high enough to break the sheer line: anything below
    # the bulwark simply is not there once the boat is sixty pixels long.
    for i, (x, y, n) in enumerate(((-0.12, 0.86, 3), (1.60, 0.78, 2), (0.05, -0.90, 2))):
        for k in range(n):
            add(lib.box('box%d%d' % (i, k), (0.62, 0.42, 0.27), chamfer=0.02,
                        loc=(x, y, deck_z(x) + 0.135 + k * 0.275)),
                paint['crate'])

    # Creels stowed on the aft deck, between the wheelhouse and the transom.
    for i, side in enumerate((1, -1)):
        for k in range(2):
            add(lib.box('creel%d%d' % (i, k), (0.52, 0.44, 0.38), chamfer=0.03,
                        loc=(-3.55, side * 0.52, deck_z(-3.55) + 0.19 + k * 0.39)),
                paint['creel'])

    # Pot hauler on the starboard side, where the gear comes aboard.
    add(lib.box('hauler_base', (0.30, 0.30, 0.16), chamfer=0.02,
                loc=(0.72, -0.98, deck_z(0.72) + 0.08)), paint['steel'])
    add(lib.cyl('hauler_drum', 0.19, 0.15, 0.30, loc=(0.72, -0.98, deck_z(0.72) + 0.31),
                segments=10), paint['rust'])

    # Foredeck: hatch, samson post, a coil of rope.
    add(lib.box('fore_hatch', (0.66, 0.66, 0.15), chamfer=0.02,
                loc=(2.45, 0.0, deck_z(2.45) + 0.08)), paint['timber'])
    add(lib.box('samson', (0.14, 0.14, 0.64), chamfer=0.02,
                loc=(3.05, 0.0, deck_z(3.05) + 0.32)), paint['timber'])
    add(lib.torus('coil', 0.25, 0.05, loc=(2.72, 0.40, deck_z(2.72) + 0.06),
                  major_seg=12, minor_seg=6), paint['rope'])
    # Mooring bitts stand on the cap rail, not inboard of it: placed by eye they
    # float over the deck, so they are placed off the table like everything else.
    for i, side in enumerate((1, -1)):
        add(lib.box('bitt%d' % i, (0.13, 0.13, 0.40), chamfer=0.02,
                    loc=(-3.86, side * (station(-3.86)[0] - 0.045),
                         sheer_z(-3.86) + 0.06)), paint['timber'])

    # Tyres over the side, hung off the cap rail and resting on the topside.
    for i, x in enumerate((-2.30, -0.40, 1.30)):
        for j, side in enumerate((1, -1)):
            y = side * (outer_y(x, 0.42) + 0.075)
            z = sheer_z(x) - 0.42
            add(lib.torus('fender%d%d' % (i, j), 0.23, 0.07, loc=(x, y, z),
                          rot=(math.pi / 2, 0.0, 0.0), major_seg=10, minor_seg=6),
                paint['rubber'])
            add(strut('lash%d%d' % (i, j), (x, side * (station(x)[0] - 0.05), sheer_z(x)),
                      (x, y, z + 0.26), 0.016), paint['rope'])

    # Floats lashed to the wheelhouse front, out of the way of the deck.
    for i, side in enumerate((1, -1)):
        add(lib.sphere('float%d' % i, 0.21, subdiv=1, scale=(1.0, 1.0, 0.85),
                       loc=(WH_X1 + 0.22, side * 0.76, 2.05)), paint['buoy'])

    # Roof: exhaust up the aft corner, a scanner and a whip aerial. The stack
    # is deliberately stubby and thick — a thin one is indistinguishable from
    # the aerial once the boat is only sixty pixels long.
    add(lib.cyl('stack', 0.10, 0.09, 0.72, loc=(-2.86, 0.68, ROOF_Z + 0.36),
                segments=8), paint['rust'])
    add(lib.box('stack_cap', (0.26, 0.26, 0.07), chamfer=0.02,
                loc=(-2.86, 0.68, ROOF_Z + 0.75)), paint['steel'])
    add(lib.box('scanner_post', (0.10, 0.10, 0.34), loc=(-1.85, 0.0, ROOF_Z + 0.17)),
        paint['steel'])
    add(lib.box('scanner', (0.18, 0.66, 0.11), chamfer=0.02,
                loc=(-1.85, 0.0, ROOF_Z + 0.40)), paint['steel'])
    add(strut('aerial', (-1.20, 0.86, ROOF_Z), (-1.34, 0.96, ROOF_Z + 1.45), 0.022),
        paint['wire'])

    # Navigation lights: red to port, green to starboard.
    for name, side, mat in (('port', 1, paint['portlight']),
                            ('stbd', -1, paint['stbdlight'])):
        add(lib.box('nav_%s' % name, (0.10, 0.09, 0.15),
                    loc=(WH_X1 - 0.18, side * 1.02, 3.24)), mat)
    return parts


def underwater(paint):
    """Deadwood, rudder and screw. Everything below the boot top is painted
    with the same antifouling as the hull, so the stern gear reads as part of
    the boat rather than as a fitting bolted under it."""
    parts = [lib.attach(o, None, paint['antifoul']) for o in (
        lib.box('deadwood', (0.62, 0.16, 0.46), loc=(-3.52, 0.0, 0.52)),
        lib.box('rudder', (0.46, 0.09, 0.72), chamfer=0.02, loc=(-3.72, 0.0, 0.66)),
    )]
    gear = [lib.cyl('shaft', 0.05, 0.05, 0.36, loc=(-3.16, 0.0, 0.60),
                    rot=(0.0, math.pi / 2, 0.0), segments=6),
            lib.cyl('hub', 0.09, 0.07, 0.13, loc=(-3.34, 0.0, 0.60),
                    rot=(0.0, math.pi / 2, 0.0), segments=8)]
    for i in range(3):
        a = i * math.tau / 3
        gear.append(lib.box('blade%d' % i, (0.05, 0.13, 0.30), rot=(a, 0.0, 0.0),
                            loc=(-3.34, math.sin(a) * 0.17,
                                 0.60 + math.cos(a) * 0.17)))
    return parts + [lib.attach(o, None, paint['bronze']) for o in gear]


# ---------------------------------------------------------------- the model

def fishing_boat(name, report):
    lib.reset()
    paint = {
        'topside': lib.hexmat('boat_topside', 0x2B5C88, rough=0.40, clearcoat=0.30),
        'boot': lib.hexmat('boat_boot', 0x14181E, rough=0.45),
        'antifoul': lib.hexmat('boat_antifoul', 0x7A3527, rough=0.80),
        # Dark enough to hold against the cream bulwarks. Matched in value they
        # merge, and the whole inside of the boat reads as one pale trough.
        'deck': lib.hexmat('boat_deck', 0x6C7663, rough=0.92),
        'bulwark': lib.hexmat('boat_bulwark', 0xD7CFBB, rough=0.75),
        'caprail': lib.hexmat('boat_caprail', 0x8A5F31, rough=0.45, clearcoat=0.35),
        'house': lib.hexmat('boat_house', 0xE8E3D6, rough=0.50, clearcoat=0.20),
        'timber': lib.hexmat('boat_timber', 0x8A5F31, rough=0.50, clearcoat=0.30),
        'glass': lib.hexmat('boat_glass', 0x28323C, rough=0.12, clearcoat=0.60),
        'steel': lib.hexmat('boat_steel', 0x9AA0A6, rough=0.42, metal=0.75),
        # Standing rigging is matt and dark on purpose: a metallic wire catches
        # the key light along its whole length and draws a hard white line
        # right across the hero shot.
        'wire': lib.hexmat('boat_wire', 0x474D55, rough=0.70, metal=0.20),
        'bronze': lib.hexmat('boat_bronze', 0x7E6437, rough=0.45, metal=0.80),
        'rubber': lib.hexmat('boat_rubber', 0x2A2A2D, rough=0.95),
        'rope': lib.hexmat('boat_rope', 0xC6B183, rough=0.95),
        'creel': lib.hexmat('boat_creel', 0x74765A, rough=0.96),
        'rust': lib.hexmat('boat_rust', 0xA8442A, rough=0.85),
        'crate': lib.hexmat('boat_crate', 0x2E7A9C, rough=0.70),
        'buoy': lib.hexmat('boat_buoy', 0xE2622A, rough=0.65),
        'portlight': lib.hexmat('boat_portlight', 0xC63A2E, rough=0.30, emissive=0.6),
        'stbdlight': lib.hexmat('boat_stbdlight', 0x2E9A55, rough=0.30, emissive=0.6),
    }

    root = lib.part('boat')

    lib.merge_into('hull', [hull(paint)], root)
    # The stem band caps the two strakes where they run out at the bow and the
    # transom band closes them off aft; without those the swept bands stop in
    # mid-air at both ends. Both are placed off the same sheer the strakes were
    # swept along, which is the only reason they meet it.
    aft = STATIONS[0][0]
    lib.merge_into('strakes',
                   [rubbing_strake(3.88, 1), rubbing_strake(3.88, -1),
                    lib.box('stem_band', (0.26, 0.20, 0.74), chamfer=0.03,
                            loc=(3.87, 0.0, 2.58)),
                    lib.box('transom_band',
                            (0.09, outer_y(aft, 0.20) * 2.0, 0.17), chamfer=0.02,
                            loc=(aft - 0.03, 0.0, sheer_z(aft) - 0.20))],
                   root, paint['caprail'])
    keel = lib.attach(keel_timber(), None, paint['antifoul'])
    lib.merge_into('keel', [keel] + underwater(paint), root)

    house = lib.attach(wheelhouse(), None, paint['house'])
    roof = lib.attach(lib.box('roof', (WH_X1 - WH_X0 + 0.10, WH_HALF * 2.02, 0.10),
                              chamfer=0.03,
                              loc=((WH_X0 + WH_X1) / 2 - 0.09, 0.0, ROOF_Z)),
                      None, paint['timber'])
    lib.merge_into('house', [house, roof] + wheelhouse_trim(paint), root)

    lib.merge_into('rig', rig(paint), root)
    lib.merge_into('gear', deck_gear(paint), root)

    lib.export(name, report)


MODELS = {'demo_fishing_boat': fishing_boat}


def main():
    a = sys.argv
    args = a[a.index('--') + 1:] if '--' in a else []
    names = list(MODELS) if not args or args[0] == 'all' else args
    report = []
    for n in names:
        if n not in MODELS:
            raise SystemExit('no such model: %s (have %s)' % (n, ', '.join(MODELS)))
        MODELS[n](n, report)
    lib.summarise(report)


main()
