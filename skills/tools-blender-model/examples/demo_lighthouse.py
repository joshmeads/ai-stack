# A lighthouse and the keeper's cottage at its foot.
#
#   blender --background --python demo_lighthouse.py -- demo_lighthouse
#   blender --background --python shots.py           -- demo_lighthouse
#
# Every dimension below is metres, Z up, with the tower's axis on the world
# origin and the model sitting on z = 0.
#
# The tower is a run of frustums stacked up a radius curve rather than one
# cone, because the two things that make a lighthouse read are the concave
# batter of the shaft and the gallery that oversails it — a straight cone with
# a hat on is a chimney. The cottage shell is grown as one mesh so the gable
# ends come out of the walls rather than being propped against them.
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# the toolkit lives one directory up, in scripts/
sys.path.append(os.path.join(HERE, os.pardir, 'scripts'))

import boxmodel                                              # noqa: E402
import lib                                                   # noqa: E402


# ---------------------------------------------------------------- the tower

TOWER_SEG = 16          # sides on the shaft; enough to read as round at 900 px
LANTERN_SEG = 12        # sides on the lantern, one astragal per corner

R_FOOT = 2.04           # splayed base, at the ground
R_PLINTH = 1.89         # top of the splayed base
R_BASE = 1.86           # bottom of the painted shaft
R_NECK = 1.06           # top of the shaft, under the gallery
Z_PLINTH = 0.55
Z_NECK = 8.35
BATTER = 1.18           # >1 curves the shaft in; 1.0 would be a plain cone.
                        # Much past this the width all goes in the bottom
                        # third and the tower reads as a decanter.

BANDS = 5               # livery bands, alternating, white at the bottom and top
BAND_STEPS = 2          # frustums per band, so the curve survives the banding

Z_DECK = 8.85           # gallery deck underside
Z_DECK_TOP = 9.02
# The deck has to oversail the lantern by enough that daylight shows between
# the rail and the glass; without that margin the gallery reads as a collar.
R_DECK = 1.98
R_CORBEL = 1.72         # the flare that carries the deck off the shaft
RAIL_R = 1.92
RAIL_POSTS = 12
Z_KICK_TOP = 9.22       # top of the solid kick plate; the open rail starts here
Z_RAIL_TOP = 10.00

Z_PEDESTAL = 9.52       # solid base of the lantern room
Z_GLAZE_LO = 9.64
Z_GLAZE_HI = 10.72
R_GLAZE = 1.08
Z_ROOF_LO = 10.86
Z_ROOF_HI = 11.55
R_ROOF = 1.30
R_ROOF_TIP = 0.13
ROOF_STEPS = 4
Z_TOP = 12.25           # the finial, and 7.00 times a 1.75 m figure

DOOR_AZ = math.radians(-45.0)   # the entrance faces the hero camera


def shaft_radius(z):
    """The batter of the shaft: concave, so it flares at the foot rather than
    running out in a straight line."""
    t = (z - Z_PLINTH) / (Z_NECK - Z_PLINTH)
    return R_NECK + (R_BASE - R_NECK) * (1.0 - t) ** BATTER


def roof_radius(t):
    """A shallow dome for the lantern roof, fullest at the eaves."""
    return R_ROOF_TIP + (R_ROOF - R_ROOF_TIP) * math.cos(t * math.pi / 2) ** 0.6


def paint(obj, mat):
    """Give a part its own material.

    merge_into() is called without one, so the joined mesh keeps every colour
    its pieces were painted with."""
    obj.data.materials.append(mat)
    return obj


def on_skin(name, az, radius, z, size, mat, chamfer=0.0):
    """A slab lying against the tower at a bearing.

    Its local +X points out of the tower, so `size` reads as
    (thickness, width, height)."""
    return paint(lib.box(name, size,
                         loc=(math.cos(az) * radius, math.sin(az) * radius, z),
                         rot=(0.0, 0.0, az), chamfer=chamfer), mat)


def tower(mat):
    parts = []

    # --- splayed foot and the banded shaft -------------------------------
    parts.append(paint(lib.cyl('foot', R_FOOT, R_PLINTH, Z_PLINTH,
                               loc=(0, 0, Z_PLINTH / 2), segments=TOWER_SEG,
                               smooth=True), mat['stone']))

    n = BANDS * BAND_STEPS
    for i in range(n):
        z0 = Z_PLINTH + (Z_NECK - Z_PLINTH) * i / n
        z1 = Z_PLINTH + (Z_NECK - Z_PLINTH) * (i + 1) / n
        livery = mat['red'] if (i // BAND_STEPS) % 2 else mat['white']
        parts.append(paint(lib.cyl('shaft%02d' % i,
                                   shaft_radius(z0), shaft_radius(z1), z1 - z0,
                                   loc=(0, 0, (z0 + z1) / 2),
                                   segments=TOWER_SEG, smooth=True), livery))

    # --- entrance porch, stair windows -----------------------------------
    parts.append(on_skin('porch', DOOR_AZ, 1.96, 1.17, (0.86, 1.30, 2.34),
                         mat['white'], chamfer=0.04))
    parts.append(on_skin('porch_cap', DOOR_AZ, 1.96, 2.41, (1.00, 1.48, 0.14),
                         mat['stone'], chamfer=0.03))
    parts.append(on_skin('door', DOOR_AZ, 2.44, 0.98, (0.10, 0.80, 1.96),
                         mat['trim2']))
    parts.append(on_skin('step', DOOR_AZ, 2.55, 0.07, (0.42, 1.10, 0.14),
                         mat['stone'], chamfer=0.02))

    for i, z in enumerate((3.20, 5.10, 7.00)):
        r = shaft_radius(z)
        parts.append(on_skin('winsill%d' % i, DOOR_AZ, r + 0.02, z,
                             (0.10, 0.44, 0.74), mat['stone']))
        parts.append(on_skin('win%d' % i, DOOR_AZ, r + 0.07, z,
                             (0.06, 0.28, 0.56), mat['glass']))

    # --- gallery: corbel, deck, kick plate, open rail ---------------------
    parts.append(paint(lib.cyl('corbel', shaft_radius(Z_NECK), R_CORBEL,
                               Z_DECK - Z_NECK,
                               loc=(0, 0, (Z_NECK + Z_DECK) / 2),
                               segments=TOWER_SEG, smooth=True), mat['stone']))
    parts.append(paint(lib.cyl('deck', R_DECK, R_DECK, Z_DECK_TOP - Z_DECK,
                               loc=(0, 0, (Z_DECK + Z_DECK_TOP) / 2),
                               segments=TOWER_SEG, smooth=True), mat['metal']))
    parts.append(paint(lib.ring('kickplate', R_DECK - 0.08, R_DECK,
                                Z_KICK_TOP - Z_DECK_TOP,
                                loc=(0, 0, (Z_DECK_TOP + Z_KICK_TOP) / 2),
                                segments=TOWER_SEG), mat['metal']))

    post_h = Z_RAIL_TOP - Z_KICK_TOP
    for i in range(RAIL_POSTS):
        parts.append(on_skin('post%02d' % i, math.tau * i / RAIL_POSTS, RAIL_R,
                             Z_KICK_TOP + post_h / 2, (0.10, 0.09, post_h),
                             mat['metal']))
    parts.append(paint(lib.ring('rail_mid', RAIL_R - 0.05, RAIL_R + 0.05, 0.06,
                                loc=(0, 0, Z_KICK_TOP + post_h * 0.5),
                                segments=TOWER_SEG * 2), mat['metal']))
    parts.append(paint(lib.ring('rail_top', RAIL_R - 0.09, RAIL_R + 0.09, 0.09,
                                loc=(0, 0, Z_RAIL_TOP + 0.045),
                                segments=TOWER_SEG * 2), mat['metal']))

    # --- lantern room -----------------------------------------------------
    # White, not gunmetal: the railing is dark, and a dark rail against a dark
    # lantern base loses every gap between the posts.
    parts.append(paint(lib.cyl('pedestal', 1.14, 1.12, Z_PEDESTAL - Z_DECK_TOP,
                               loc=(0, 0, (Z_DECK_TOP + Z_PEDESTAL) / 2),
                               segments=LANTERN_SEG, smooth=True), mat['white']))
    parts.append(paint(lib.ring('frame_lo', R_GLAZE - 0.08, R_GLAZE + 0.10, 0.12,
                                loc=(0, 0, Z_PEDESTAL + 0.06),
                                segments=LANTERN_SEG), mat['metal']))
    parts.append(paint(lib.cyl('glazing', R_GLAZE, R_GLAZE,
                               Z_GLAZE_HI - Z_GLAZE_LO,
                               loc=(0, 0, (Z_GLAZE_LO + Z_GLAZE_HI) / 2),
                               segments=LANTERN_SEG, smooth=False), mat['glow']))
    for i in range(LANTERN_SEG):
        parts.append(on_skin('astragal%02d' % i, math.tau * i / LANTERN_SEG,
                             R_GLAZE, (Z_GLAZE_LO + Z_GLAZE_HI) / 2,
                             (0.10, 0.09, Z_GLAZE_HI - Z_GLAZE_LO),
                             mat['metal']))
    parts.append(paint(lib.ring('frame_hi', R_GLAZE - 0.08, R_GLAZE + 0.12, 0.14,
                                loc=(0, 0, Z_GLAZE_HI + 0.07),
                                segments=LANTERN_SEG), mat['metal']))

    # --- roof and finial ---------------------------------------------------
    for i in range(ROOF_STEPS):
        t0, t1 = i / ROOF_STEPS, (i + 1) / ROOF_STEPS
        z0 = Z_ROOF_LO + (Z_ROOF_HI - Z_ROOF_LO) * t0
        z1 = Z_ROOF_LO + (Z_ROOF_HI - Z_ROOF_LO) * t1
        parts.append(paint(lib.cyl('roof%d' % i, roof_radius(t0), roof_radius(t1),
                                   z1 - z0, loc=(0, 0, (z0 + z1) / 2),
                                   segments=TOWER_SEG, smooth=True),
                           mat['roof']))
    parts.append(paint(lib.ring('drip', R_ROOF - 0.14, R_ROOF + 0.08, 0.10,
                                loc=(0, 0, Z_ROOF_LO + 0.06),
                                segments=TOWER_SEG), mat['metal']))
    parts.append(paint(lib.cyl('cowl', 0.19, 0.15, 0.15,
                               loc=(0, 0, Z_ROOF_HI + 0.075), segments=8,
                               smooth=True), mat['metal']))
    parts.append(paint(lib.sphere('ball', 0.17, loc=(0, 0, 11.80), subdiv=1,
                                  smooth=True), mat['metal']))
    parts.append(paint(lib.cyl('spike', 0.055, 0.014, Z_TOP - 11.90,
                               loc=(0, 0, (11.90 + Z_TOP) / 2), segments=6,
                               smooth=True), mat['metal']))
    return parts


# ---------------------------------------------------------------- the cottage

COT_X, COT_Y = -5.40, -3.90
# Turned off broadside. Square to the hero camera the ridge runs exactly along
# the screen horizon, the gable never appears, and the cottage outlines as a
# plain rectangle; a few degrees of yaw buys the front elevation and the gable
# end in the same view.
COT_YAW = math.radians(18.0)

COT_LEN = 6.00                  # along the ridge
COT_DEPTH = 4.20
COT_EAVES = 2.30                # about a man's reach
COT_RIDGE = 3.60                # masonry gable apex; the roof slab sits on it
ROOF_T = 0.14                   # slab thickness, measured vertically
EAVE_Y = 0.30                   # overhang at the eaves
EAVE_X = 0.30                   # overhang at the gable ends
COT_WALL_Y = COT_DEPTH / 2


def at(x, y, z):
    """Cottage-local metres in world coordinates."""
    c, s = math.cos(COT_YAW), math.sin(COT_YAW)
    return (COT_X + x * c - y * s, COT_Y + x * s + y * c, z)


def cbox(name, size, loc, mat, chamfer=0.0):
    return paint(lib.box(name, size, loc=at(*loc), rot=(0.0, 0.0, COT_YAW),
                         chamfer=chamfer), mat)


def cottage(mat):
    parts = []

    parts.append(cbox('base_course', (COT_LEN + 0.24, COT_DEPTH + 0.24, 0.36),
                      (0, 0, 0.18), mat['stone'], chamfer=0.03))

    # The walls and both gables are one grown surface: a cube with a loop cut
    # down the ridge line, then everything on that line lifted.
    rise = COT_RIDGE - COT_EAVES
    shell = boxmodel.Form(size=(COT_LEN, COT_DEPTH, COT_EAVES),
                          at=(0, 0, COT_EAVES / 2))
    shell.cut('y', 1)
    shell.warp(lambda x, y, z:
               (x, y, z + rise * (1.0 - abs(y) / COT_WALL_Y))
               if z > COT_EAVES - 1e-4 else (x, y, z))
    shell.bevel(0.03, min_angle=20)
    walls = shell.build('cottage_shell', mat['wall'])
    walls.location = (COT_X, COT_Y, 0.0)
    walls.rotation_euler = (0.0, 0.0, COT_YAW)
    parts.append(walls)

    # One slab per pitch, each lofted along the ridge with its underside on the
    # gable line and running past it to make the overhang.
    #
    # Two slabs rather than one: a slab of constant vertical thickness spanning
    # the ridge has a chevron section, and a chevron is not convex. loft() caps
    # its ends with a single n-gon, and a non-convex n-gon fans out into
    # triangles that cover the opening it is supposed to surround — which fills
    # the gable with a solid slate triangle two metres wide. Each pitch on its
    # own is a parallelogram, and caps correctly.
    z_eave = COT_EAVES - rise * EAVE_Y / COT_WALL_Y
    y_eave = COT_WALL_Y + EAVE_Y
    half = COT_LEN / 2 + EAVE_X
    for side in (-1, 1):
        pitch = [(side * y_eave, z_eave), (0.0, COT_RIDGE),
                 (0.0, COT_RIDGE + ROOF_T), (side * y_eave, z_eave + ROOF_T)]
        slab = lib.loft('cottage_roof%d' % (side + 1),
                        [(-half, pitch), (half, pitch)], smooth=False)
        slab.location = (COT_X, COT_Y, 0.0)
        slab.rotation_euler = (0.0, 0.0, COT_YAW)
        parts.append(paint(slab, mat['slate']))

    # Flush with the barge boards. Any longer and it hangs off the gable as a
    # loose blade with daylight under it.
    parts.append(cbox('ridge_cap', (COT_LEN + 2 * EAVE_X, 0.26, 0.11),
                      (0, 0, COT_RIDGE + ROOF_T - 0.02), mat['slate'],
                      chamfer=0.02))

    # Chimney on the ridge line at the far gable, so it breaks the roof rather
    # than standing beside it.
    parts.append(cbox('chimney', (0.78, 0.78, 4.40), (2.35, 0, 2.20),
                      mat['stone'], chamfer=0.03))
    parts.append(cbox('chimney_cap', (0.98, 0.98, 0.16), (2.35, 0, 4.48),
                      mat['stone'], chamfer=0.03))

    # Front elevation: door under a canopy, two windows.
    front = -COT_WALL_Y
    parts.append(cbox('door_frame', (1.16, 0.12, 2.28), (-1.85, front, 1.14),
                      mat['trim']))
    parts.append(cbox('door', (0.94, 0.10, 2.04), (-1.85, front - 0.07, 1.02),
                      mat['trim2']))
    # The hood and its posts stay inside the eaves line. Projecting past it put
    # a lit gap through the building in the flat-black shot.
    parts.append(cbox('canopy', (1.72, 0.56, 0.12), (-1.85, front - 0.14, 2.36),
                      mat['slate'], chamfer=0.02))
    for s in (-1, 1):
        parts.append(cbox('canopy_post%d' % (s + 1),
                          (0.09, 0.09, 2.30), (-1.85 + s * 0.72, front - 0.26, 1.15),
                          mat['trim']))
    parts.append(cbox('doorstep', (1.40, 0.50, 0.12),
                      (-1.85, front - 0.26, 0.06), mat['stone'], chamfer=0.02))

    for i, x in enumerate((0.20, 2.00)):
        parts.append(cbox('cwin%d_frame' % i, (1.06, 0.10, 1.26),
                          (x, front, 1.52), mat['trim']))
        parts.append(cbox('cwin%d' % i, (0.86, 0.08, 1.06),
                          (x, front - 0.05, 1.52), mat['glass']))
        parts.append(cbox('cwin%d_sill' % i, (1.22, 0.18, 0.09),
                          (x, front - 0.05, 0.86), mat['stone'], chamfer=0.02))

    # The back gets the same treatment as the front. At two of the four
    # headings it is the only elevation the camera sees, and a bare wall there
    # is what "composed for one corner" looks like.
    back = COT_WALL_Y
    parts.append(cbox('back_door_frame', (1.16, 0.12, 2.28), (-0.10, back, 1.14),
                      mat['trim']))
    parts.append(cbox('back_door', (0.94, 0.10, 2.04), (-0.10, back + 0.07, 1.02),
                      mat['trim2']))
    parts.append(cbox('back_step', (1.30, 0.44, 0.12), (-0.10, back + 0.24, 0.06),
                      mat['stone'], chamfer=0.02))
    for i, x in enumerate((-2.00, 1.70)):
        parts.append(cbox('bwin%d_frame' % i, (1.06, 0.10, 1.26),
                          (x, back, 1.52), mat['trim']))
        parts.append(cbox('bwin%d' % i, (0.86, 0.08, 1.06),
                          (x, back + 0.05, 1.52), mat['glass']))
        parts.append(cbox('bwin%d_sill' % i, (1.22, 0.18, 0.09),
                          (x, back + 0.05, 0.86), mat['stone'], chamfer=0.02))
    # In the gable that faces the tower, so the yaw above buys a lit window
    # rather than a blank triangle.
    parts.append(cbox('gable_light', (0.12, 0.80, 0.80),
                      (COT_LEN / 2, 0, 2.80), mat['trim']))
    parts.append(cbox('gable_glass', (0.08, 0.60, 0.60),
                      (COT_LEN / 2 + 0.05, 0, 2.80), mat['glass']))
    return parts


# ---------------------------------------------------------------- the yard

def yard_wall(mat):
    """A low wall from the tower's plinth to the cottage's front corner.

    Two buildings standing apart on open ground read as two props that happen
    to share a render. The wall between them makes it one working station, and
    its pale coping carries the eye from one to the other at sizes where no
    other detail survives."""
    bx, by, _ = at(COT_LEN / 2 + 0.10, -COT_WALL_Y, 0.0)
    d = math.hypot(bx, by)
    ax, ay = bx / d * (R_FOOT - 0.15), by / d * (R_FOOT - 0.15)
    mx, my = (ax + bx) / 2, (ay + by) / 2
    span = math.hypot(bx - ax, by - ay)
    yaw = math.atan2(by - ay, bx - ax)
    return [
        paint(lib.box('yard_wall', (span, 0.34, 0.62), loc=(mx, my, 0.31),
                      rot=(0.0, 0.0, yaw), chamfer=0.03), mat['stone']),
        paint(lib.box('yard_coping', (span + 0.06, 0.44, 0.10),
                      loc=(mx, my, 0.66), rot=(0.0, 0.0, yaw), chamfer=0.02),
              mat['trim']),
    ]


# ---------------------------------------------------------------- assembly

def palette():
    return {
        'stone': lib.hexmat('stone', 0x9A9187, rough=0.88),
        'white': lib.hexmat('tower_white', 0xF4F1E8, rough=0.44, clearcoat=0.25),
        'red': lib.hexmat('tower_red', 0xB8382C, rough=0.44, clearcoat=0.25),
        'roof': lib.hexmat('lantern_roof', 0x8E2A22, rough=0.40, clearcoat=0.3),
        'metal': lib.hexmat('gunmetal', 0x33383D, rough=0.42, metal=0.55),
        # The lantern is lit: an emissive pane reads as a working light at any
        # size, where clear glass over an interior lamp reads as a grey disc
        # the moment the model is smaller than a hundred pixels.
        'glow': lib.hexmat('lantern_glow', 0xFFE7B0, rough=0.25, emissive=2.2),
        'wall': lib.hexmat('cottage_wall', 0xEFE6D4, rough=0.85),
        # Light enough that the roof does not out-weigh the tower. A darker
        # slate is the heaviest mass in the hero shot and pulls the eye off
        # the light, which is the one thing the model has to say.
        'slate': lib.hexmat('slate', 0x59626E, rough=0.62),
        'trim': lib.hexmat('trim', 0xE8E2D4, rough=0.55),
        'trim2': lib.hexmat('joinery', 0x2E4A3C, rough=0.45),
        'glass': lib.hexmat('window', 0x2A3742, rough=0.16, metal=0.2),
    }


def build():
    mat = palette()
    root = lib.part('lighthouse')
    lib.merge_into('tower', tower(mat), parent=root)
    lib.merge_into('cottage', cottage(mat), parent=root)
    lib.merge_into('yard_wall', yard_wall(mat), parent=root)


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def main():
    args = argv()
    name = args[0] if args else 'demo_lighthouse'
    report = []
    lib.reset()
    build()
    lib.export(name, report)
    lib.summarise(report)


main()
