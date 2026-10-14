# Everything about this pipeline that is true of your project and not of mine.
#
# Keeping the project-specific numbers here means lib.py and shots.py stay
# identical across projects, so a fix to either is a fix everywhere.
#
# Edit this file. Do not edit lib.py or shots.py.
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))


# ---------------------------------------------------------------- where things go

# Where exported .glb files land. Getting this wrong fails silently: point it
# somewhere the app does not load from and every render shows the previous
# build. ART_OUT overrides it, for CI and for trying a build without touching
# the app's assets.
OUT = os.environ.get('ART_OUT') or os.path.join(ROOT, 'public', 'models')

# Where contact sheets land, one directory per model.
SHOTS = os.environ.get('ART_SHOTS') or os.path.join(HERE, 'shots')


# ---------------------------------------------------------------- scale

# What one Blender unit means. Model in real metres and leave this at 1.0
# unless your engine says otherwise — a game whose character is 3.0 units tall
# would set UNITS_PER_M = 3.0 / 1.75.
UNITS_PER_M = 1.0

# The height of the contact sheet's scale figure, in world units. Set it to
# whatever your app's character actually is; a human is 1.75 m.
FIGURE_H = 1.75 * UNITS_PER_M

# The grid drawn on the ground. STEP is the fine check; MAJOR is the heavier
# line, and should be your tile or block size if you have one.
GRID_STEP = 1.0 * UNITS_PER_M
GRID_MAJOR = 4.0 * UNITS_PER_M


# ---------------------------------------------------------------- the hero shot

# The angle your app looks from. With a fixed camera, put its real numbers here
# and the hero shot stops approximating what the player sees and becomes it.
#
# The defaults are true isometric — atan(1/sqrt(2)) elevation, 45 azimuth —
# which is the classic 2:1 game projection and a fair stand-in for a free
# orbit camera.
HERO_ELEVATION_DEG = 35.264389682754654
HERO_AZIMUTH_DEG = 45.0

# Orthographic if your camera is. A perspective app should set this False and
# set HERO_LENS.
HERO_ORTHOGRAPHIC = True
HERO_LENS = 45.0

# How far the hero camera stands off, in world units. None derives it from the
# model's size. Under an orthographic camera distance only has to clear the
# geometry, so a large floor is harmless; under a PERSPECTIVE one it sets the
# framing, and a floor of 60 renders a 200 mm object about four pixels tall.
# Set it explicitly for anything much smaller or larger than a metre.
HERO_DISTANCE = None

# Azimuth offsets for the four hero renders, standing in for the object turning
# under a camera that does not. Catches a model composed for one corner. Use
# (0.0,) if the object never rotates.
HERO_HEADINGS = (0.0, 90.0, 180.0, 270.0)


# ---------------------------------------------------------------- small renders

# Pixels per metre at the sizes the object is actually seen at. Each is
# rendered for real at that size and then blown up nearest-neighbour, so the
# upscale adds no information.
#
# Derive these from your app: a 1080 px viewport spanning 64 tiles of 4 m is
# 1080 / (64 * 4) = 4.2 px per metre.
#
# (label, pixels-per-metre, upscale factor). Set to () to skip.
SMALL_RENDERS = (
    ('60px', 15.0, 6),
    ('12px', 4.2, 14),
)


# ---------------------------------------------------------------- look

RES = 900                 # the big shots, square

# Flat shading suits a low-poly look seen from a distance: at forty pixels a
# smooth normal is mush, and a toon ramp wants facets to break against. Set
# True for anything the player stands next to.
SMOOTH_DEFAULT = False

# Sides on a cylinder when the call site does not say. 8 for a far-off toon
# look, 16 or 24 for anything seen close up.
CYL_SEGMENTS = 8

# Contact sheet colours only. Nothing here reaches an exported model.
SKY = 0x9DB0C0
SUN = 0xFFF4E0
GROUND = 0x8CA36B
GROUND_ALT = 0x9DB27C     # the dark squares of the checker
GRID_LINE = 0xBFAF8E      # the major lines
FIGURE = 0x6F8CA6

SUN_ENERGY = 3.1

# Where the key light comes from, in Blender's Z-up coordinates. Match your
# app's directional light. A Y-up engine's light at (60, 100, 40) is
# (60, -40, 100) here.
SUN_FROM = (60.0, -40.0, 100.0)


# ---------------------------------------------------------------- export

# glTF is Y-up and Blender is Z-up, so the exporter rotates on the way out:
# Blender (x, y, z) becomes glTF (x, z, -y). Model with Z up. Leave True unless
# you are exporting for something that wants Z-up.
EXPORT_YUP = True

# Warn when a model exceeds this many triangles. None disables the check.
TRI_BUDGET = None
