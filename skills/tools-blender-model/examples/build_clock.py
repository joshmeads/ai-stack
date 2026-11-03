# An English eight-day longcase clock, about 1780. Oak case, brass break-arch
# dial, swan-neck pediment. 2.10 m to the top of the centre finial.
#
#   blender --background --python build_clock.py
#
# Authored in millimetres, emitted in metres, so every literal below is a real
# dimension you could put a rule against.
#
# Blender is Z-up. The clock FACES +X. Its width runs along Y and its depth
# along X, so from the front camera (which stands at +X looking back) the
# viewer's right hand is +Y.
#
# ---------------------------------------------------------------------------
# WHAT IS GEOMETRY AND WHAT IS MATERIAL
#
# This pipeline has one flat PBR colour per material and no maps at all, so
# "texture" here means "a material boundary between two pieces of geometry".
# That makes the decision sharper than usual rather than vaguer:
#
#   geometry  anything that breaks the silhouette or catches the key light -
#             every moulding, the fielded panel, the column flutes, the
#             spandrel scrolls, the hand piercings, the finials.
#   geometry  ALSO every mark that has to be dark against a light ground -
#             the numerals, the minute ticks, the half-hour marks. On the real
#             clock these are engraved 0.3 mm and filled with black wax, and
#             the relief is invisible at a metre; it is the WAX you see. With
#             no albedo map the only way to place a dark mark on a silvered
#             ring is to put a dark solid there, so they are modelled proud by
#             0.35 mm and painted near-black. That is a pipeline constraint
#             driving a modelling decision, and it is worth saying out loud.
#   material  the sand-matted dial centre. Its grain is about 0.3 mm, which is
#             a quarter of a texel at 4096 and a fifth of a pixel at the hero
#             density. It cannot be resolved either way, so it is a roughness
#             difference and nothing else.
#   material  the wax polish on the case, the toning on the silvering.
#
# The engraved circles on the chapter ring are the interesting case: at 0.6 mm
# wide they are 0.43 px in the hero render, so as dark LINES they would only
# alias. They are cut instead as 0.4 mm steps in the ring's turned section,
# because a step is a normal discontinuity and shades at any resolution while a
# sub-pixel line does not.
# ---------------------------------------------------------------------------
import bpy
import bmesh
import math
import os
import sys

from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
for _cand in (os.environ.get('ART_LIB'), HERE, os.path.join(HERE, '..', 'scripts')):
    if _cand and os.path.exists(os.path.join(_cand, 'artconfig.py')):
        sys.path.insert(0, os.path.abspath(_cand))
        break

import artconfig as cfg     # noqa: E402
import lib                  # noqa: E402

MM = 0.001
NAME = 'longcase_clock'


# ================================================================ dimensions
#
# One block, in millimetres, because a clock case is a stack and every number
# in it is somebody else's datum. The vertical stack has to sum to 2100.

TOTAL_H = 2100.0

FOOT_H = 86.0                       # bracket feet
BASE_Z0, BASE_Z1 = 86.0, 118.0      # plinth base moulding: the dust seal
BASE_PROJ = 12.0

PLINTH_Z0, PLINTH_Z1 = 118.0, 470.0
CAP_Z0, CAP_Z1 = 470.0, 536.0       # plinth cap / base moulding
CAP_PROJ = 30.0                     # widest point of the ogee
CAP_PLINTH = 24.0                   # where the plinth face sits under it

TRUNK_Z0, TRUNK_Z1 = 536.0, 1288.0
TRUNK_W0, TRUNK_W1 = 336.0, 324.0   # waisted: it narrows as it rises

# The brief asks for 0.28. Carried up through the two overhangs it has to be
# carried through - the throat moulding projects 22 all round, and the cornice
# 30 - that gives a cornice 394 mm deep under a hood 500 mm wide, and pass 1
# photographed as a packing crate on a post. A moulding mitred at a corner has
# ONE projection, so the depth cannot be trimmed independently of the width;
# the only place to take it out is here. 250 puts the cornice at 356 x 500,
# which is a deep country case rather than a crate. Reported as a deviation.
TRUNK_D = 250.0

PLINTH_W = TRUNK_W0 + 2 * CAP_PLINTH
PLINTH_D = TRUNK_D + 2 * CAP_PLINTH

THROAT_Z0, THROAT_Z1 = 1288.0, 1372.0
# 22 put the moulding's top within a millimetre of the hood's own side face,
# and the two coplanar surfaces z-fought into a serrated line the whole length
# of the run. 16 leaves the hood a clean 7 mm overhang to cast onto it.
THROAT_PROJ = 16.0

HOOD_Z0, HOOD_Z1 = 1372.0, 1882.0
HOOD_W = 440.0
HOOD_D = TRUNK_D + 2 * 23.0         # clears the throat moulding's top
HOOD_WALL = 12.0

CORN_Z0, CORN_Z1 = 1882.0, 1948.0
CORN_PROJ = 30.0                    # -> 500 wide, the brief's number

WALL = 12.0                         # case board thickness

# --- the trunk door ---
DOOR_Z0, DOOR_Z1 = 548.0, 1232.0    # as low as the plinth cap allows, so the
DOOR_STILE = 45.0                   # bob clears the bottom rail
DOOR_T = 20.0

# Hinged on the +Y stile and swung 62 degrees, so it opens AWAY from the side
# the hero camera and the key light are on.
#
# Pass 2 hinged it on -Y and opened it 32. Both were wrong for the same reason:
# a door ajar sweeps across the front of its own opening, so from any viewpoint
# on the hinge side the door hides the very thing it is opened to show. The
# interior close-up came back as a full-frame picture of the back of the door.
# Hinge away from the camera and open it far enough to clear, and the pendulum,
# the weights, the backboard and the hinge knuckles are all in view at once.
DOOR_HINGE = 1.0                    # +1 = hinged on the +Y stile
DOOR_OPEN_DEG = 55.0
#
# 55 is not a taste call, it is where two curves cross. Swinging the door
# further OPEN uncovers more of the aperture (at 90 it covers none of it), but
# turns its face away from the camera until the fielded panel is edge-on and
# invisible - which is what 62 did. Worked through against the hero bearing,
# 55 leaves all but the hinge-side third of the opening clear AND still
# presents the panel at 55 degrees, where its field and crossbanding read.

# --- the dial ---
DIAL_W = 305.0                      # 12 inch, as an eight-day of this date is
DIAL_R = DIAL_W / 2.0               # arch radius = half the plate width
DIAL_Z0 = 1400.0                    # bottom edge of the plate
DIAL_CZ = DIAL_Z0 + DIAL_R          # the hand centre
# Front face of the plate. It has to leave room, IN FRONT of it, for the
# chapter ring, both hands, the collet, the glass and the door frame - and the
# hood got 38 mm shallower when the trunk depth came down. At the old 138 the
# glazing sat at x=134, which is BEHIND the plate: the brief's "glazed hood
# door, so you see the dial through glass" was failing outright, with the pane
# buried inside the movement.
DIAL_X = 114.0
DIAL_T = 3.0

CHAP_OUT, CHAP_IN = 143.0, 110.0    # chapter ring
CHAP_PROUD = 1.2
R_ARABIC = 136.0                    # minute numerals
R_TICK_OUT, R_TICK_IN = 131.5, 125.5
R_ROMAN = 117.5
R_HALFHOUR = 114.0

SEC_CV = 72.0                       # seconds dial, above the centre
SEC_R = 32.0
DATE_CV = -66.0                     # date aperture, below it
DATE_W, DATE_H = 27.0, 19.0
WIND_R = 62.0                       # winding squares, at IIII and VIII

HAND_H_LEN = 105.0                  # hour hand: to the inner edge of the ring
HAND_M_LEN = 134.0                  # minute hand: to the minute track
HAND_M_TAIL = 44.0                  # counterpoise

SHOW_H, SHOW_M, SHOW_S = 3.0, 47.0, 38.0    # the time it is telling

# --- the movement, seen through the open door ---
# A seconds-beating pendulum is 994 mm from suspension to bob centre and that
# is not negotiable - it is what makes the clock beat seconds. The suspension
# height IS negotiable, being a mounting detail: at 1604 the bob centre lands
# at 610, which puts the whole bob inside the door opening.
SUSPENSION_Z = 1612.0
PEND_LEN = 994.0
BOB_R, BOB_T = 66.0, 22.0
WEIGHT_R, WEIGHT_L = 29.0, 205.0

TAU = math.tau


def mm(*v):
    return tuple(x * MM for x in v)


# ================================================================ palette

def palette():
    """Two hundred and forty years of wax and hands. Nothing here is a fresh
    colour: the brass has gone warm and slightly dead, the silvering has toned
    to bone rather than white, and the oak is dark from polish rather than from
    stain."""
    return dict(
        # Pass 1 came out orange and pale - a new pine box, not a hall clock.
        # Two hundred years of wax and hands takes oak a long way down and a
        # long way towards brown.
        oak=lib.hexmat('oak', 0x513820, rough=0.31, clearcoat=0.30),
        oak_side=lib.hexmat('oak_side', 0x452F1B, rough=0.36, clearcoat=0.22),
        mahog=lib.hexmat('mahogany', 0x37170E, rough=0.27, clearcoat=0.42),
        # The inside of a case is DARK. At 0x6B573A it rendered brighter than
        # the brass hanging in front of it, and the flat lit backboard read
        # through the open door as a sheet of glass across the opening. Dark
        # unpolished deal puts the weights and the bob back in front of it,
        # where the eye should go.
        pine=lib.hexmat('pine_interior', 0x4A3B28, rough=0.92),
        # The spandrels and finials are cast and burnished; the dial GROUND is
        # sand-matted, and the applied work has to read LIGHTER than it.
        #
        # Reaching for that with low roughness and high metalness made it
        # darker instead. Under one sun and a flat sky, a smooth metal mirrors
        # the sky - a dim even grey - while a rough one scatters the sun back
        # at you, so polishing a brass in this rig makes it darker, not
        # brighter. The contrast has to be carried by base colour and a
        # MODERATE roughness rather than by polish.
        brass=lib.hexmat('brass', 0xDCB661, rough=0.34, metal=0.80),
        brass_matt=lib.hexmat('brass_matted', 0x9C8347, rough=0.70, metal=0.72),
        brass_dark=lib.hexmat('brass_dark', 0x8E6C2E, rough=0.40, metal=0.85),
        silver=lib.hexmat('silvered', 0xB7B0A0, rough=0.40, metal=0.32),
        ink=lib.hexmat('wax_black', 0x17130F, rough=0.55),
        blued=lib.hexmat('blued_steel', 0x232D4A, rough=0.30, metal=0.55),
        steel=lib.hexmat('steel', 0x6A6A70, rough=0.42, metal=0.75),
        # At alpha 0.14 the pane rendered as a milky wash and the dial behind
        # it was unreadable - which is the opposite of the brief's "so you see
        # the dial through glass". Old crown glass is nearly clear; what says
        # "glass" is the highlight, not the body, so the alpha goes almost to
        # nothing and the sheen is left to do the work.
        glass=lib.hexmat('glass', 0xAFC3BE, rough=0.02, metal=0.0, alpha=0.05),
    )


def paint(obj, mat):
    if obj is not None and mat is not None:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj


# ================================================================ the profile
# language
#
# A longcase clock is a stack of mouldings, so the sections have to be easy to
# write or they end up as chamfers. Each section is a list of (out, up) in
# millimetres: `out` is measured outward from the face the moulding is applied
# to, `up` from its bottom edge.
#
# Two curve verbs, named for the order the curve travels in rather than for a
# classical profile, because the same quadratic reads as an ovolo going out and
# as a cavetto coming in, and naming it for the shape gets it backwards half
# the time.

class Sec:
    def __init__(self, out=0.0, up=0.0):
        self.p = [(out, up)]

    def to(self, out, up):
        self.p.append((out, up))
        return self

    def by(self, dout, dup):
        o, u = self.p[-1]
        return self.to(o + dout, u + dup)

    def _bez(self, p1, pc, n):
        p0 = self.p[-1]
        for i in range(1, n + 1):
            t = i / float(n)
            s = 1.0 - t
            self.p.append((s * s * p0[0] + 2 * s * t * pc[0] + t * t * p1[0],
                           s * s * p0[1] + 2 * s * t * pc[1] + t * t * p1[1]))
        return self

    def out_first(self, out, up, n=6):
        """Leaves horizontally and arrives vertically. Convex when it travels
        outward (an ovolo), concave when it travels inward (a cavetto under a
        projecting member)."""
        return self._bez((out, up), (out, self.p[-1][1]), n)

    def up_first(self, out, up, n=6):
        """Leaves vertically and arrives horizontally. The other hand of the
        same quarter."""
        return self._bez((out, up), (self.p[-1][0], up), n)

    def ogee(self, out, up, n=5, reverse=False):
        """Cyma recta: convex below, concave above. `reverse` for a cyma
        reversa. Two quarters back to back, which is what one is."""
        o0, u0 = self.p[-1]
        mo, mu = (o0 + out) / 2.0, (u0 + up) / 2.0
        if reverse:
            self.up_first(mo, mu, n)
            return self.out_first(out, up, n)
        self.out_first(mo, mu, n)
        return self.up_first(out, up, n)

    def bead(self, r, n=10, extra=0.0):
        """A half-round astragal standing proud of the current face."""
        o0, u0 = self.p[-1]
        c = u0 + r
        for i in range(1, n + 1):
            a = -math.pi / 2 + math.pi * i / float(n)
            self.p.append((o0 + (r + extra) * math.cos(a), c + r * math.sin(a)))
        return self

    def close_back(self, back=-10.0):
        """Return to a face buried inside the carcase, so the section is a
        closed loop and the sweep is a solid. Never 0: a face coplanar with the
        case wall z-fights along the whole run."""
        top = self.p[-1][1]
        bot = self.p[0][1]
        self.p.append((back, top))
        self.p.append((back, bot))
        return self

    @property
    def pts(self):
        return list(self.p)


# ---- the profiles themselves ------------------------------------------------

def sec_plinth_cap():
    """Top of the plinth, reducing to the trunk. The moulding projects 6 mm
    beyond the plinth face before it sweeps back in, which is what stops the
    joint reading as a step.

    Pass 2 made the middle of this one 30 mm of sweep in a single arc, and it
    photographed as a smooth plastic ramp. A moulding is a SEQUENCE of members
    with fillets and quirks between them: the fillets are what catch the light
    as separate lines, and without them the raking light has nothing to break
    on."""
    s = Sec(CAP_PLINTH, 0.0)
    s.to(CAP_PLINTH, 4.0)
    s.out_first(CAP_PROJ, 11.0, 9)          # ovolo out over the plinth face
    s.to(CAP_PROJ, 15.0)                    # fillet
    s.to(CAP_PROJ - 1.5, 17.0)              # quirk
    s.out_first(16.0, 34.0, 11)              # upper half of the ogee, in and up
    s.to(14.0, 37.0)                        # fillet
    s.up_first(9.0, 48.0, 9)                # cavetto
    s.to(8.0, 51.0)                         # fillet
    s.bead(4.5)                             # astragal against the trunk
    s.to(4.0, 62.0)
    s.to(0.0, 66.0)
    return s.close_back().pts


def sec_base():
    """The dust seal: a small moulding round the foot of the plinth that closes
    the case to the floor and takes the bracket feet under it."""
    s = Sec(BASE_PROJ, 0.0)
    s.to(BASE_PROJ, 7.0)
    s.out_first(2.0, 26.0, 9)
    s.to(0.0, 30.0)
    s.to(0.0, 32.0)
    return s.close_back().pts


def sec_throat():
    """Under the hood: an astragal, a small cavetto, a quirk and the main
    cavetto that carries the hood's underside.

    Four members rather than pass 2's one 54 mm arc, which rendered as a
    featureless slope."""
    s = Sec(0.0, 0.0)
    s.to(1.5, 2.5)
    s.bead(4.0)                             # astragal at the foot
    s.to(3.5, 14.0)
    s.to(4.5, 18.0)                         # fillet
    s.up_first(8.0, 34.0, 9)                # a small cavetto
    s.to(8.5, 38.0)                         # fillet
    s.to(7.0, 41.0)                         # quirk
    s.up_first(14.0, 66.0, 11)               # the main cavetto
    s.to(15.0, 70.0)                        # fillet
    s.to(THROAT_PROJ, 74.0)
    s.to(THROAT_PROJ, 84.0)                 # square up under the hood
    return s.close_back().pts


def sec_cornice():
    """The hood cornice: 30 mm of projection built out of a cavetto, a fillet
    and an ogee, which is what a cornice is."""
    s = Sec(0.0, 0.0)
    s.to(0.0, 4.0)
    s.up_first(11.0, 24.0, 9)               # cavetto
    s.to(13.0, 28.0)
    s.ogee(28.0, 58.0, 8)                   # cyma recta
    s.to(CORN_PROJ, 62.0)
    s.to(CORN_PROJ, 66.0)
    return s.close_back().pts


def sec_bead(r=3.5, wing=4.0):
    """A cock bead: the small half-round run round a door opening. Applied
    work, so it stands proud of the face it is planted on."""
    s = Sec(0.0, 0.0)
    s.to(wing, 0.0)
    s.to(wing, 1.2)
    s.bead(r, 7)
    s.to(0.0, 1.2 + 2 * r)
    return s.close_back(-3.0).pts


def sec_astragal(r=2.6):
    """The glazing bar moulding round the hood door aperture."""
    s = Sec(0.0, 0.0)
    s.to(3.2, 0.0)
    s.to(3.2, 1.0)
    s.bead(r, 6)
    s.to(0.0, 1.0 + 2 * r)
    return s.close_back(-2.5).pts


def sec_swanneck():
    """The scroll's cross-section: `a` runs across the face of the board and
    `b` stands proud of it.

    A swan neck is a shaped BOARD with a moulding applied to its lower edge -
    so most of this section is a single flat face, with the members crowded
    into the last 14 mm at the inner edge.

    Both earlier attempts made it a dome sampled at even intervals, and both
    photographed as a fat brown rubber tube arched over the hood. The reason
    is shading, not shape: consecutive facets on a sampled dome differ by
    15-20 degrees, shade_auto's 40 degree threshold smooths every one of them,
    and the whole 50 mm width becomes one continuous highlight. A flat face
    meeting a fillet at ninety degrees cannot do that."""
    return [(-25.0, 0.0), (-25.0, 6.0),          # the lip, square edge
            (-21.5, 6.0), (-21.5, 9.5),          # fillet and quirk
            (-19.0, 12.0), (-16.5, 14.0),        # cavetto up to the face
            (-13.5, 15.2), (-11.0, 15.6),
            (18.0, 15.6),                        # THE FLAT BOARD FACE
            (21.5, 14.6), (25.0, 12.0),          # chamfer at the outer edge
            (25.0, 0.0),
            (25.0, -12.0), (-25.0, -12.0)]       # back, buried in the hood


# ================================================================ sweeping
#
# lib.sweep() takes one section per path point, which is what makes a real
# mitre possible: at a corner the section has to be stretched along the bisector
# by 1/cos(half the turn), or the moulding pinches inward and the corner reads
# as a crimp. lib.profile()'s uniform `scales` cannot express that, because it
# would scale the height too.

def mitred(section, path):
    """One section per path point, widened at the corners."""
    frames = lib.path_frames(path)
    out = []
    for i, (_o, _r, _u, t) in enumerate(frames):
        if 0 < i < len(frames) - 1:
            a = (Vector(path[i]) - Vector(path[i - 1])).normalized()
            b = (Vector(path[i + 1]) - Vector(path[i])).normalized()
            half = a.angle(b, 0.0) / 2.0
            k = 1.0 / max(0.2, math.cos(half))
        else:
            k = 1.0
        out.append([(sa * k, sb) for (sa, sb) in section])
    return out


def _corner_path(corners, eps=1.0, min_turn_deg=22.0):
    """Insert a point either side of every SHARP corner, so the frame there
    bisects cleanly and the mitre is only `eps` wide.

    Gentle turns are left alone. An arched glazing bar is twenty-six little
    turns of seven degrees each, and splitting every one of them would treble
    the path for a mitre factor of 1.002."""
    path = []
    n = len(corners)
    lim = math.radians(min_turn_deg)
    for i, c in enumerate(corners):
        c = Vector(c)
        if 0 < i < n - 1:
            a = (c - Vector(corners[i - 1])).normalized()
            b = (Vector(corners[i + 1]) - c).normalized()
            if a.angle(b, 0.0) > lim:
                path.append(tuple(c - a * eps))
                path.append(tuple(c))
                path.append(tuple(c + b * eps))
                continue
        path.append(tuple(c))
    return path


def case_moulding(name, section, w, d, z, mat, eps=1.0):
    """Run a moulding round the front and two sides of the case at height `z`,
    returning square at the back the way a real one does.

    Travelling back -> front along the -Y side, across the front, and back
    along the +Y side puts `right` (and so the section's +out) outward at every
    station. Verified in probe_sweep.py; get it backwards and the whole
    moulding is buried in the carcase."""
    hw, hd = w / 2.0, d / 2.0
    corners = [(-hd, -hw, z), (hd, -hw, z), (hd, hw, z), (-hd, hw, z)]
    path = _corner_path(corners, eps)
    sec = [(a * MM, b * MM) for (a, b) in section]
    obj = lib.sweep(name, [mm(*p) for p in path],
                    mitred(sec, [mm(*p) for p in path]), close=True)
    lib.shade_auto(obj, 34)
    return paint(obj, mat)


def weld(obj, dist=1e-6):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=dist)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def plane_moulding(name, section, loop, x, mat, eps=1.0):
    """The same, for a moulding lying in the plane of the dial - a door
    surround, a glazing bar, an arched hood door.

    `loop` is the corners of a CLOSED polygon as [(u, v), ...] in world
    millimetres: u is world Y (across), v is world Z (up). The path is built
    FLAT in the horizontal build plane and the finished object is stood up
    afterwards.

    That indirection is not fussiness. lib.path_frames() references world up,
    so a path lying in a vertical plane has no defined roll: its straight
    vertical legs take their azimuth from whatever crumb of horizontal
    component their neighbours happen to leave, and probe_sweep.py measures the
    frame swinging a full 90 degrees between two stations on ONE straight leg.
    Swept upright, this moulding would face sideways at the foot of the stile
    and forwards at its head."""
    pts = list(loop)

    # Start and finish at the MIDDLE of an edge rather than at a corner:
    # _corner_path only mitres interior points, so a loop that begins on a
    # corner leaves that one corner butted while the other three are mitred.
    mid0 = ((pts[0][0] + pts[1][0]) / 2.0, (pts[0][1] + pts[1][1]) / 2.0)
    ring = [mid0] + pts[1:] + [pts[0], mid0]

    # build space: x = -v, y = u, z = the section's projection
    build = [(-v * MM, u * MM, 0.0) for (u, v) in ring]

    # Wind it so `right` comes out pointing AWAY from the middle of the loop,
    # because the section's +out has to be outward. Backwards, and the whole
    # moulding is buried in the face it is planted on.
    cu = sum(u for (u, _v) in pts) / len(pts) * MM
    cv = sum(v for (_u, v) in pts) / len(pts) * MM
    frames = lib.path_frames(build)
    o, r, _u2, _t = frames[len(frames) // 2]
    if r.dot(Vector((o.x + cv, o.y - cu, 0.0))) < 0:
        build = list(reversed(build))

    path = _corner_path(build, eps * MM)
    sec = [(a * MM, b * MM) for (a, b) in section]
    obj = lib.sweep(name, path, mitred(sec, path), close=False)
    weld(obj)
    lib.shade_auto(obj, 34)
    obj.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    obj.location = (x * MM, 0.0, 0.0)
    return paint(obj, mat)


# ================================================================ dial space
#
# Everything on the dial is authored as (u across, v up) about the hand centre,
# and placed by one matrix, so a numeral, a spandrel and a hand all use the
# same two numbers.

_DIALBASE = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))).to_4x4()


def dial_place(obj, u, v, spin=0.0, x=None):
    """Put `obj` on the dial at (u, v), spun by `spin` radians about the dial's
    own normal. `obj` is assumed to have been authored flat in the XY plane
    reading along +X, which is what lib.text() hands back."""
    m = (Matrix.Translation(((DIAL_X if x is None else x) * MM,
                             u * MM, DIAL_CZ * MM + v * MM))
         @ Matrix.Rotation(spin, 4, 'X')
         @ _DIALBASE)
    obj.matrix_world = m
    return obj


def hour_angle(h):
    """Where hour `h` sits, and how far its numeral has to be turned.

    English dials set the hour numerals RADIALLY - VI at the bottom is upside
    down. Getting this wrong is the single most obvious way to draw a clock
    that has never been looked at."""
    th = h / 12.0 * TAU
    return math.sin(th), math.cos(th), -th


# ================================================================ text
#
# lib.text() findings, measured in probe_text.py and probe_text2.py, are all
# worked around here rather than in lib.py, since this is a build script.

def glyphs(name, body, size, depth, mat):
    """lib.text(), welded and re-centred on its own ink.

    Two things it does that a dial cannot live with:

    * the mesh comes back with every outline vertex DOUBLED - 'VIII' is 76
      vertices that weld to 38, and until they are welded the mesh has 76
      boundary edges, so it is not closed and lib.cut() would refuse it.
    * align='CENTER' centres on the typographic em box, not on the ink, so
      every numeral sits 0.55 mm high at 14 mm and 'VIII' is 0.5 mm off centre
      horizontally. Twelve numerals all hanging half a millimetre above their
      true radius reads as a chapter ring that has slipped."""
    obj = lib.text(name, body, size=size * MM, depth=depth * MM, mat=mat)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bm.to_mesh(obj.data)
    bm.free()
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    if xs:
        cx = (min(xs) + max(xs)) / 2.0
        cy = (min(ys) + max(ys)) / 2.0
        for v in obj.data.vertices:
            v.co.x -= cx
            v.co.y -= cy
    return obj


ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V',
         'VI', 'VII', 'VIII', 'IX', 'X', 'XI']


# ================================================================ small shapes

def rounded_rect(w, h, r, n=4):
    """A rectangle with radiused corners, as an outline."""
    hw, hh = w / 2.0 - r, h / 2.0 - r
    pts = []
    for cx, cy, a0 in ((hw, -hh, -math.pi / 2), (hw, hh, 0.0),
                       (-hw, hh, math.pi / 2), (-hw, -hh, math.pi)):
        for i in range(n + 1):
            a = a0 + i / float(n) * (math.pi / 2)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def arch_outline(w, base_v, square_h, n=26):
    """The break-arch dial plate, and the hood door that follows it: a square
    with a semicircle of half its width sitting on top."""
    hw = w / 2.0
    pts = [(-hw, base_v), (hw, base_v), (hw, base_v + square_h)]
    for i in range(1, n):
        a = i / float(n) * math.pi
        pts.append((hw * math.cos(a), base_v + square_h + hw * math.sin(a)))
    pts.append((-hw, base_v + square_h))
    return pts


def taper_rect(wb, wt, z0, z1):
    """The waisted trunk's front outline: wider at the foot than at the head."""
    return [(-wb / 2.0, z0), (wb / 2.0, z0), (wt / 2.0, z1), (-wt / 2.0, z1)]


def trunk_w(z):
    """The trunk narrows as it rises. Everything planted on it has to ask."""
    t = (z - TRUNK_Z0) / (TRUNK_Z1 - TRUNK_Z0)
    return TRUNK_W0 + (TRUNK_W1 - TRUNK_W0) * min(1.0, max(0.0, t))


def yz_prism(name, outline, depth, x, mat, smooth=None):
    """A slab facing the front: outline in (u, v) = (Y, Z), extruded along X."""
    obj = lib.prism(name, [(u * MM, v * MM) for (u, v) in outline],
                    depth * MM, loc=(x * MM, 0, 0), plane='yz', smooth=smooth)
    return paint(obj, mat)


def dial_prism(name, outline, depth, x, mat, smooth=None):
    """The same, but authored about the dial centre."""
    return yz_prism(name, [(u, DIAL_CZ + v) for (u, v) in outline],
                    depth, x, mat, smooth=smooth)


def to_dial(obj, x):
    """Stand an object authored flat in the build XY plane up into the dial
    plane at depth `x`. Local +Z becomes world +X."""
    obj.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    obj.location = (x * MM, 0.0, 0.0)
    return obj


def dial_sweep(name, section, uv_path, x, mat, scales=None, close=True,
               smooth=True):
    """A moulded run lying in the plane of the front, given as (u, v) points in
    world millimetres - u is world Y, v is world Z. Same flat-authoring trick
    as plane_moulding, but for an OPEN path: a spandrel scroll or a swan neck
    rather than a closed frame."""
    build = [(-v * MM, u * MM, 0.0) for (u, v) in uv_path]
    sec = [(a * MM, b * MM) for (a, b) in section]
    if scales is None:
        secs = [sec] * len(build)
    else:
        secs = [[(a * k, b * k) for (a, b) in sec] for k in scales]
    obj = lib.sweep(name, build, secs, close=close, smooth=smooth)
    lib.shade_auto(obj, 40)
    return paint(to_dial(obj, x), mat)


# ================================================================ the case
#
# Three parts, as the brief says and as a real one is: a plinth, a waisted
# trunk with a door, and a hood that lifts off forwards. Every junction between
# them is a moulding, and each part is a real box with real wall thickness -
# hollowed with a boolean rather than faked, so the inside of the trunk is
# there to be seen when the door is open.

def feet(mat):
    """Ogee bracket feet, four of them, with a shaped apron between the front
    pair. A bracket foot is a flat board with a cyma cut into its inner edge,
    and two of them mitre at each corner - which is how they are made."""
    made = []
    hw = (PLINTH_W + 2 * BASE_PROJ) / 2.0
    hd = (PLINTH_D + 2 * BASE_PROJ) / 2.0

    def bracket(length):
        s = Sec(0.0, 0.0)
        s.to(length, 0.0)
        s.to(length, 20.0)
        s.ogee(26.0, FOOT_H - 3.0, 8, reverse=True)
        s.to(19.0, FOOT_H)
        s.to(0.0, FOOT_H)
        return s.pts

    for sy in (-1, 1):
        for sx in (-1, 1):
            o = bracket(94.0)
            made.append(yz_prism('foot_f%d%d' % (sx, sy),
                                 [(sy * (hw - a), b) for (a, b) in o],
                                 19.0, sx * (hd - 9.5), mat, smooth=False))
            side = lib.prism('foot_s%d%d' % (sx, sy),
                             [((sx * (hd - a)) * MM, b * MM) for (a, b) in o],
                             19.0 * MM, loc=(0, sy * (hw - 9.5) * MM, 0),
                             plane='xz', smooth=False)
            made.append(paint(side, mat))

    span = hw - 94.0
    ap = [(-span, 0.0), (span, 0.0)]
    for i in range(26, -1, -1):
        t = i / 26.0
        u = -span + 2 * span * t
        v = -32.0 * (math.cos(t * TAU * 1.5) * 0.28 + 0.72) * \
            (math.sin(math.pi * t) ** 0.42)
        ap.append((u, v))
    made.append(yz_prism('foot_apron', [(u, BASE_Z0 + v) for (u, v) in ap],
                         17.0, hd - 9.0, mat, smooth=False))
    return made


def fielded_panel(name, w, h, cu, cv, x, mats, band=22.0, field=7.0,
                  wood=None):
    """A raised-and-fielded panel: a flat field standing proud of a bevelled
    margin, with a quirk at the outer edge.

    lib.loft() is exactly the right verb. The section is known at every station
    and the stations run along X, which is the direction the panel stands proud
    in. Four of them: the outline, the top of the quirk, the top of the bevel,
    and the flat of the field."""
    outer = rounded_rect(w, h, 12.0, 3)
    inner = rounded_rect(w - 2 * band, h - 2 * band, 9.0, 3)

    def ring(pts):
        return [((cu + u) * MM, (cv + v) * MM) for (u, v) in pts]

    st = [(x * MM, ring(outer)),
          ((x + 2.0) * MM, ring(outer)),
          ((x + field - 2.0) * MM, ring(inner)),
          ((x + field) * MM, ring(inner))]
    obj = lib.loft(name, st, cap_ends=True, smooth=False)
    lib.shade_auto(obj, 30)
    paint(obj, wood or mats['oak'])

    made = [obj]
    ow = w + 2 * band * 0.85
    oh = h + 2 * band * 0.85
    b = band * 0.85
    for i, (dw, dh, du, dv) in enumerate((
            (ow, b, 0.0, (oh - b) / 2.0),
            (ow, b, 0.0, -(oh - b) / 2.0),
            (b, oh - 2 * b, (ow - b) / 2.0, 0.0),
            (b, oh - 2 * b, -(ow - b) / 2.0, 0.0))):
        made.append(yz_prism(
            '%s_band%d' % (name, i),
            [(cu + du + sx * dw / 2.0, cv + dv + sy * dh / 2.0)
             for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))],
            2.2, x + 1.1, mats['mahog'], smooth=False))
    return made


def plinth(mats):
    """A panelled plinth. Its fielded panel answers the one on the trunk door,
    which is how these cases are put together."""
    made = []
    body = lib.box('plinth_body',
                   mm(PLINTH_D, PLINTH_W, PLINTH_Z1 - PLINTH_Z0),
                   loc=mm(0, 0, (PLINTH_Z0 + PLINTH_Z1) / 2.0), smooth=False)
    made.append(paint(body, mats['oak']))
    pw = PLINTH_W - 104.0
    ph = (PLINTH_Z1 - PLINTH_Z0) - 104.0
    cz = (PLINTH_Z0 + PLINTH_Z1) / 2.0
    made += fielded_panel('plinth_panel', pw, ph, 0.0, cz,
                          PLINTH_D / 2.0, mats, band=20.0, field=6.0)
    return made


def trunk(mats):
    """The waist. Tapered in width, hollow, with a real opening for the door.

    Hollowed by subtracting an inner prism that pokes out through the top, so
    what is left is a case with a bottom and no lid - still a closed surface,
    so the door opening can be cut out of it afterwards."""
    outer = taper_rect(TRUNK_W0, TRUNK_W1, TRUNK_Z0, TRUNK_Z1 + 2.0)
    body = yz_prism('trunk', outer, TRUNK_D, 0.0, mats['oak'], smooth=False)

    inner = taper_rect(TRUNK_W0 - 2 * WALL, TRUNK_W1 - 2 * WALL,
                       TRUNK_Z0 + WALL, TRUNK_Z1 + 60.0)
    tool = yz_prism('_hollow', inner, TRUNK_D - 2 * WALL, 0.0, mats['pine'],
                    smooth=False)
    lib.cut(body, tool)

    ow0 = trunk_w(DOOR_Z0) - 2 * DOOR_STILE
    ow1 = trunk_w(DOOR_Z1) - 2 * DOOR_STILE
    cutter = yz_prism('_dooropening', taper_rect(ow0, ow1, DOOR_Z0, DOOR_Z1),
                      TRUNK_D * 2.0, 0.0, mats['pine'], smooth=False)
    lib.cut(body, cutter)
    lib.shade_auto(body, 30)
    return body


def trunk_interior(mats):
    """What the open door shows: a backboard with a board joint down it, the
    cheeks the movement sits on, and the seatboard. Without these the door
    opens onto a void and the case reads as scenery."""
    made = []
    made.append(yz_prism(
        'tk_backboard',
        taper_rect(TRUNK_W0 - 2 * WALL - 1.0, TRUNK_W1 - 2 * WALL - 1.0,
                   TRUNK_Z0 + WALL, TRUNK_Z1),
        10.0, -TRUNK_D / 2.0 + WALL + 5.0, mats['pine'], smooth=False))
    made.append(yz_prism('tk_backjoint',
                         [(-2.0, TRUNK_Z0 + WALL), (2.0, TRUNK_Z0 + WALL),
                          (2.0, TRUNK_Z1), (-2.0, TRUNK_Z1)],
                         2.0, -TRUNK_D / 2.0 + WALL + 10.5, mats['oak_side'],
                         smooth=False))
    for sy in (-1, 1):
        c = lib.box('tk_cheek%d' % sy,
                    mm(TRUNK_D - 2 * WALL - 14.0, 16.0, 120.0),
                    loc=mm(0, sy * (TRUNK_W1 / 2.0 - WALL - 9.0),
                           TRUNK_Z1 - 64.0), smooth=False)
        made.append(paint(c, mats['pine']))
    seat = lib.box('tk_seatboard',
                   mm(TRUNK_D - 2 * WALL - 22.0, TRUNK_W1 - 2 * WALL - 8.0,
                      14.0),
                   loc=mm(-6.0, 0, TRUNK_Z1 - 3.0), smooth=False)
    made.append(paint(seat, mats['pine']))
    return made


def hinge(name, u, v, x, mats, side=1.0):
    """A brass butt hinge: two leaves and a knuckle of five parts. Sixty
    millimetres of model, and the difference between a door and a painted
    rectangle. `side` is which way the leaf runs from the knuckle."""
    made = [paint(lib.box(name + '_leaf', mm(2.2, 32.0, 50.0),
                          loc=mm(x, u + side * 16.0, v), smooth=False),
                  mats['brass'])]
    for i in range(5):
        made.append(paint(lib.cyl(name + '_k%d' % i, 4.0 * MM, 4.0 * MM,
                                  9.4 * MM, loc=mm(x, u, v - 23.0 + i * 11.5),
                                  segments=12), mats['brass']))
    made.append(paint(lib.cyl(name + '_pin', 1.5 * MM, 1.5 * MM, 54.0 * MM,
                              loc=mm(x, u, v), segments=8), mats['steel']))
    return made


def escutcheon(name, u, v, x, mats):
    """The keyhole plate, with a real keyhole through it. A printed one falls
    apart the moment the light rakes across it."""
    o = [(0.0, 15.0), (7.0, 12.0), (9.0, 0.0), (7.0, -13.0), (0.0, -17.0),
         (-7.0, -13.0), (-9.0, 0.0), (-7.0, 12.0)]
    plate = yz_prism(name, [(u + a, v + b) for (a, b) in o], 2.0, x,
                     mats['brass'])
    key = lib.cyl(name + '_h', 2.6 * MM, 2.6 * MM, 20.0 * MM,
                  loc=mm(x, u, v + 3.0), rot=(0, math.pi / 2, 0), segments=10)
    paint(key, mats['ink'])
    lib.cut(plate, key)
    return plate


def trunk_door(mats):
    """Ajar on its hinges. A shut door would hide the pendulum, the weights,
    the hinge knuckles and the thickness of its own panel - four of the
    brief's items behind one board."""
    made = []
    w0 = trunk_w(DOOR_Z0) - 2 * DOOR_STILE - 3.0
    w1 = trunk_w(DOOR_Z1) - 2 * DOOR_STILE - 3.0
    z0, z1 = DOOR_Z0 + 1.5, DOOR_Z1 - 1.5
    xface = TRUNK_D / 2.0 - 1.0

    made.append(yz_prism('door_board', taper_rect(w0, w1, z0, z1), DOOR_T,
                         xface - DOOR_T / 2.0, mats['oak'], smooth=False))
    cv = (z0 + z1) / 2.0
    made += fielded_panel('door_panel', min(w0, w1) - 58.0, (z1 - z0) - 66.0,
                          0.0, cv, xface, mats, band=26.0, field=8.0)

    hy = DOOR_HINGE * w0 / 2.0
    for hz in (z0 + 96.0, z1 - 96.0):
        made += hinge('door_hinge%d' % int(hz), hy, hz, xface - DOOR_T, mats,
                      side=-DOOR_HINGE)
    made.append(escutcheon('door_escutcheon', -DOOR_HINGE * (w1 / 2.0 - 28.0),
                           cv + 46.0, xface + 0.5, mats))

    bpy.context.view_layer.update()
    pivot = Vector(((TRUNK_D / 2.0) * MM, hy * MM, 0.0))
    rot = (Matrix.Translation(pivot)
           @ Matrix.Rotation(math.radians(DOOR_OPEN_DEG), 4, 'Z')
           @ Matrix.Translation(-pivot))
    for o in made:
        o.matrix_world = rot @ o.matrix_world
    return made


def door_surround(mats):
    """The cock bead run round the door opening, mitred at its corners. The
    opening tapers with the waist, so the bead does too."""
    ow0 = trunk_w(DOOR_Z0) - 2 * DOOR_STILE
    ow1 = trunk_w(DOOR_Z1) - 2 * DOOR_STILE
    loop = [(-ow0 / 2.0 - 3.0, DOOR_Z0 - 3.0), (ow0 / 2.0 + 3.0, DOOR_Z0 - 3.0),
            (ow1 / 2.0 + 3.0, DOOR_Z1 + 3.0), (-ow1 / 2.0 - 3.0, DOOR_Z1 + 3.0)]
    return plane_moulding('door_bead', sec_bead(3.2, 3.0), loop,
                          TRUNK_D / 2.0, mats['oak'], eps=0.8)


# ================================================================ the hood
#
# A box that lifts off forwards, wider than the trunk it stands on, with a
# glazed arched door, a turned column at each front corner and a swan-neck
# pediment over a full cornice.

APER_W = 296.0                       # the opening the dial is seen through
APER_Z0 = 1404.0
APER_SPRING = 1705.0                 # where the arch springs = top of the
APER_R = APER_W / 2.0                # dial's square part, so they agree
HDOOR_FRAME = 22.0
COL_U = 196.0                        # column centres
COL_X = 172.0
COL_Z0, COL_Z1 = 1378.0, 1876.0


def sec_glazing_bar():
    """The hood door stile, in section: a flat back, an outer edge, and an
    astragal on the front lip with a rebate behind it for the glass. Run round
    the arched aperture as one mitred sweep, so the frame and its moulding are
    the same piece of wood - which is what they are."""
    return [(0.0, 0.0), (HDOOR_FRAME, 0.0), (HDOOR_FRAME, 22.0),
            (10.0, 22.0), (10.0, 18.5), (7.0, 19.5), (4.6, 22.0),
            (2.2, 21.4), (1.1, 18.8), (1.1, 13.0), (0.0, 13.0)]


def aperture_loop(inset=0.0):
    """The arched opening, as a closed loop in world (u, v)."""
    r = APER_R - inset
    pts = [(-r, APER_Z0 + inset), (r, APER_Z0 + inset), (r, APER_SPRING)]
    for i in range(1, 22):
        a = i / 22.0 * math.pi
        pts.append((r * math.cos(a), APER_SPRING + r * math.sin(a)))
    pts.append((-r, APER_SPRING))
    return pts


def hood_shell(mats):
    """Hollowed by subtracting a tool that leaves a front board, two sides and
    a top, and exits through the back and the bottom - which is how a real hood
    is open, so it can be lifted off over the movement."""
    body = lib.box('hood', mm(HOOD_D, HOOD_W, HOOD_Z1 - HOOD_Z0),
                   loc=mm(0, 0, (HOOD_Z0 + HOOD_Z1) / 2.0), smooth=False)
    paint(body, mats['oak'])
    tool = lib.box('_hoodhollow',
                   mm(HOOD_D, HOOD_W - 2 * HOOD_WALL, HOOD_Z1 - HOOD_Z0),
                   loc=mm(-HOOD_WALL - 2.0, 0,
                          (HOOD_Z0 + HOOD_Z1) / 2.0 - HOOD_WALL - 30.0),
                   smooth=False)
    paint(tool, mats['pine'])
    lib.cut(body, tool)

    # A shallow sunk panel in each side of the hood. The sides are the largest
    # unarticulated surface on the clock and they sit at eye level; a 3 mm
    # recess with a crisp arris costs 40 triangles and gives the raking light
    # something to break on.
    for sy in (-1, 1):
        rec = lib.box('_hoodpanel%d' % sy,
                      mm(HOOD_D - 78.0, 40.0, HOOD_Z1 - HOOD_Z0 - 96.0),
                      loc=mm(-6.0, sy * (HOOD_W / 2.0 + 20.0 - 3.0),
                             (HOOD_Z0 + HOOD_Z1) / 2.0 - 6.0),
                      chamfer=2.5 * MM, smooth=False)
        paint(rec, mats['oak_side'])
        lib.cut(body, rec)

    ap = lib.prism('_hoodaper',
                   [(u * MM, v * MM) for (u, v) in aperture_loop()],
                   HOOD_D * 3.0 * MM, loc=(0, 0, 0), plane='yz', smooth=False)
    paint(ap, mats['pine'])
    lib.cut(body, ap)
    lib.shade_auto(body, 30)
    return body


def hood_backboard(mats):
    """Closes the back of the hood, so the rear view is a case and not a shot
    of the inside of the dial."""
    return yz_prism('hood_back',
                    [(-200.0, TRUNK_Z1 - 10.0), (200.0, TRUNK_Z1 - 10.0),
                     (200.0, HOOD_Z1 - HOOD_WALL), (-200.0, HOOD_Z1 - HOOD_WALL)],
                    10.0, -TRUNK_D / 2.0 + WALL + 5.0, mats['pine'], smooth=False)


def hood_door(mats):
    """Frame and glass. The aperture is 4.5 mm smaller than the dial plate all
    round, so the frame laps the edge of the plate the way the real one does
    instead of leaving a slot into the hood."""
    made = []
    frame = plane_moulding('hood_door', sec_glazing_bar(), aperture_loop(),
                           HOOD_D / 2.0 - 22.0, mats['oak'], eps=1.0)
    made.append(frame)
    # In the rebate at the BACK of the frame, which is where a hood door's
    # glass is held, and 6 mm clear in front of the tip of the minute hand.
    glass = lib.prism('hood_glass',
                      [(u * MM, v * MM) for (u, v) in aperture_loop(-4.0)],
                      2.0 * MM, loc=((HOOD_D / 2.0 - 21.0) * MM, 0, 0),
                      plane='yz', smooth=False)
    made.append(paint(glass, mats['glass']))
    for hz in (APER_Z0 + 60.0, APER_SPRING + 60.0):
        made += hinge('hood_hinge%d' % int(hz), -APER_R - HDOOR_FRAME + 4.0,
                      hz, HOOD_D / 2.0 - 24.0, mats)
    return made


def turned_column(name, u, x, z0, z1, r, mats, flutes=8, segments=48):
    """A hood column: moulded base, entasised shaft, moulded capital, and the
    shaft fluted.

    The flutes are 3 mm wide and 1.1 mm deep. They are geometry and not a
    material because they break the highlight running down a 32 mm cylinder -
    at a metre that highlight is the only thing telling you the column is
    round, and eight interruptions in it is the whole read."""
    h = z1 - z0
    o = []
    for (rr, zz) in ((0.0, 0.0), (1.20, 0.0), (1.20, 0.012), (1.02, 0.022),
                     (1.10, 0.030), (0.96, 0.040), (1.04, 0.048),
                     (0.98, 0.056), (1.00, 0.062)):
        o.append((rr * r, zz * h))
    # shaft, with a little entasis: fattest at a third of its height
    for i in range(9):
        t = i / 8.0
        zz = 0.062 + t * (0.878 - 0.062)
        swell = 1.0 + 0.045 * math.sin(math.pi * min(1.0, t * 1.25)) - 0.075 * t
        o.append((0.96 * r * swell, zz * h))
    for (rr, zz) in ((0.99, 0.884), (0.93, 0.892), (1.03, 0.902),
                     (1.06, 0.918), (0.99, 0.930), (1.06, 0.942),
                     (1.18, 0.962), (1.20, 0.984), (1.20, 1.0), (0.0, 1.0)):
        o.append((rr * r, zz * h))

    obj = lib.revolve(name, [(a * MM, b * MM) for (a, b) in o],
                      segments=segments)
    zf0 = z0 + 0.075 * h
    zf1 = z0 + 0.870 * h

    def flute(co, nrm):
        z = co.z / MM + z0
        if not (zf0 < z < zf1):
            return 0.0
        # fade the groove out at both ends so it stops like a real flute
        end = min(1.0, (z - zf0) / 26.0, (zf1 - z) / 26.0)
        if end <= 0:
            return 0.0
        a = math.atan2(co.y, co.x)
        g = math.cos(a * flutes)
        if g <= 0.0:
            return 0.0
        return -1.15 * MM * (g ** 0.55) * end

    lib.displace(obj, flute)
    obj.location = mm(x, u, z0)
    lib.shade_auto(obj, 46)
    return paint(obj, mats['mahog'])


def column_metal(name, u, x, z, r, mats):
    """Brass cap and base rings. Provincial hoods almost always have them, and
    they are what stops a column reading as a dowel."""
    return paint(lib.cyl(name, r * MM, r * MM, 7.0 * MM, loc=mm(x, u, z),
                         segments=32), mats['brass'])


def hood_columns(mats):
    made = []
    for s in (-1, 1):
        made.append(turned_column('hcol%d' % s, s * COL_U, COL_X,
                                  COL_Z0, COL_Z1, 16.0, mats))
        made.append(column_metal('hcap%d' % s, s * COL_U, COL_X,
                                 COL_Z1 - 5.0, 19.5, mats))
        made.append(column_metal('hbase%d' % s, s * COL_U, COL_X,
                                 COL_Z0 + 4.0, 19.5, mats))
        # rear quarter columns, set into the back corners of the hood
        made.append(turned_column('hrear%d' % s, s * (HOOD_W / 2.0 - 11.0),
                                  -HOOD_D / 2.0 + 11.0, COL_Z0, COL_Z1, 11.0,
                                  mats, flutes=6, segments=24))
    return made


def cornice(mats):
    # A bead round the head of the hood, under the cornice. Provincial hoods
    # carry a frieze member here and without it the cornice springs straight
    # off a bare board.
    made = [case_moulding('hood_frieze', sec_bead(3.6, 3.5), HOOD_W, HOOD_D,
                          CORN_Z0 - 15.0, mats['oak']),
            case_moulding('cornice', sec_cornice(), HOOD_W, HOOD_D,
                          CORN_Z0, mats['oak'])]
    made.append(paint(lib.box('cornice_top',
                              mm(HOOD_D + 2 * CORN_PROJ - 26.0,
                                 HOOD_W + 2 * CORN_PROJ - 26.0, 8.0),
                              loc=mm(0, 0, CORN_Z1 - 4.0), smooth=False),
                      mats['oak_side']))
    return made


# ---------------------------------------------------------------- pediment

def swan_neck(mats):
    """Two S-curved scrolls rising from the cornice corners to spiral eyes
    either side of the centre finial, with a brass patera at each eye.

    Swept along a Catmull-Rom path, authored flat and stood up - the curve
    passes through vertical near the eye, which is exactly where framing
    against world up gives out."""
    made = []
    for s in (-1, 1):
        # Springs from the top of the cornice at the outer end (buried a
        # little, so it grows out of it rather than resting on it), and curls
        # into a spiral eye at the inner end where the patera sits. Pass 1 ran
        # out to 232, which with a 48 mm band put the scroll 6 mm proud of the
        # cornice it is supposed to stand on.
        # The eyes curl at u=+-84, not +-50. Tighter than that and the two
        # scrolls close to a 70 mm gap at the centre - narrower than the
        # centre finial's own plinth - so the scrolls swallowed the finial
        # they are supposed to frame, and its spire vanished behind them.
        ctrl = [(s * 218.0, 1942.0), (s * 204.0, 1982.0), (s * 178.0, 2016.0),
                (s * 142.0, 2040.0), (s * 110.0, 2048.0), (s * 88.0, 2042.0),
                (s * 76.0, 2028.0), (s * 74.0, 2012.0), (s * 84.0, 2004.0),
                (s * 96.0, 2010.0)]
        path = lib.catmull(ctrl, n=7)
        scales = []
        for i in range(len(path)):
            t = i / float(len(path) - 1)
            scales.append(1.0 - 0.34 * t ** 1.5)
        made.append(dial_sweep('swanneck%d' % s, sec_swanneck(),
                               [(p[0], p[1]) for p in path],
                               HOOD_D / 2.0 + CORN_PROJ - 14.0, mats['oak'],
                               scales=scales, close=True))
        made.append(patera('patera%d' % s, s * 84.0, 2016.0,
                           HOOD_D / 2.0 + CORN_PROJ - 1.0, mats))
    return made


def patera(name, u, v, x, mats):
    """A cast brass rosette at the scroll's eye.

    Turned in concentric steps rather than displaced into petals. Six petals
    at 0.55 mm on a 15 mm disc were too shallow to read as petals and too
    deep to be nothing: they came out as a shading starburst, so the paterae
    photographed as little gold pinwheels. Concentric steps read as a rosette
    at any size, which is what this has to survive - it is 8 px across in the
    hero shot."""
    o = [(0.0, 0.0), (15.0, 0.0), (15.0, 1.6), (12.6, 2.4), (12.6, 3.6),
         (9.4, 4.2), (9.4, 5.4), (6.2, 5.9), (6.2, 6.8), (3.0, 7.4),
         (0.0, 7.8)]
    obj = lib.revolve(name, [(a * MM, b * MM) for (a, b) in o], segments=40)
    obj.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    obj.location = mm(x, u, v)
    lib.shade_auto(obj, 30)
    return paint(obj, mats['brass'])


def finial(name, u, x, z, height, mats, r=1.0):
    """A turned brass finial: moulded foot, vase, collar and spire. Straight
    off lib.revolve, which is the verb this shape was named for."""
    k = height / 108.0
    o = [(0.0, 0.0), (25.0, 0.0), (25.0, 5.0), (17.0, 9.0), (19.0, 13.0),
         (13.0, 17.0), (15.0, 21.0), (21.0, 27.0), (25.0, 36.0), (24.0, 45.0),
         (19.0, 54.0), (12.0, 61.0), (9.0, 65.0), (12.0, 69.0), (8.0, 74.0),
         (10.0, 79.0), (7.0, 85.0), (4.5, 94.0), (2.2, 102.0), (0.0, 108.0)]
    obj = lib.revolve(name, [(a * r * k * MM, b * k * MM) for (a, b) in o],
                      segments=44)
    obj.location = mm(x, u, z)
    lib.shade_auto(obj, 44)
    return paint(obj, mats['brass'])


def pediment(mats):
    made = []
    # the centre plinth block, moulded, carrying the tall finial
    # Forward on the cornice, where they actually stand - over the columns
    # for the pair and on the centre front for the tall one - rather than
    # halfway back along the hood top, 164 mm behind the swan necks and
    # therefore permanently behind them.
    FX = 118.0
    made.append(paint(lib.box('fin_block_c', mm(64.0, 64.0, 40.0),
                              loc=mm(FX, 0, CORN_Z1 + 20.0), chamfer=3.0 * MM,
                              smooth=False), mats['oak']))
    made.append(finial('finial_c', 0.0, FX, CORN_Z1 + 40.0,
                       TOTAL_H - (CORN_Z1 + 40.0), mats))
    for s in (-1, 1):
        made.append(paint(lib.box('fin_block%d' % s, mm(58.0, 58.0, 30.0),
                                  loc=mm(FX, s * 198.0, CORN_Z1 + 15.0),
                                  chamfer=3.0 * MM, smooth=False),
                          mats['oak']))
        made.append(finial('finial%d' % s, s * 198.0, FX, CORN_Z1 + 30.0,
                           92.0, mats, r=0.86))
    made += swan_neck(mats)
    return made


# ================================================================ the dial
#
# A 12 inch break-arch brass dial: matted ground, applied silvered chapter
# ring, cast spandrels, seconds and date, and a signed boss in the arch. All of
# it authored about the hand centre in (u, v) millimetres.
#
# The whole plate is matted brass and everything APPLIED to it is polished -
# that is the right way round, and it is what gives the dial its two tones
# without a texture map.

def dial_plate(mats):
    """The plate, with real holes: two winding squares and the date aperture.

    The holes are cut rather than painted on. lib.cut transfers the tool's
    material to the faces it makes, so painting the tool black gives the
    winding holes a dark reveal at the call site, which is most of what makes
    them read as holes rather than as discs."""
    plate = yz_prism('dial_plate',
                     arch_outline(DIAL_W, DIAL_Z0, DIAL_W),
                     DIAL_T, DIAL_X - DIAL_T / 2.0, mats['brass_matt'],
                     smooth=False)

    for s in (-1, 1):
        th = s * math.radians(120.0)
        u, v = WIND_R * math.sin(th), WIND_R * math.cos(th)
        w = lib.cyl('_wind%d' % s, 5.6 * MM, 5.6 * MM, 40.0 * MM,
                    loc=mm(DIAL_X, u, DIAL_CZ + v), rot=(0, math.pi / 2, 0),
                    segments=16)
        paint(w, mats['ink'])
        lib.cut(plate, w)

    d = lib.box('_date', mm(40.0, DATE_W, DATE_H),
                loc=mm(DIAL_X, 0, DIAL_CZ + DATE_CV), chamfer=2.6 * MM,
                smooth=False)
    paint(d, mats['ink'])
    lib.cut(plate, d)

    c = lib.cyl('_centre', 4.5 * MM, 4.5 * MM, 40.0 * MM,
                loc=mm(DIAL_X, 0, DIAL_CZ), rot=(0, math.pi / 2, 0),
                segments=12)
    paint(c, mats['ink'])
    lib.cut(plate, c)
    return plate


def face_ring(name, outline, x, v, mats, mat, segments=96):
    """A turned ring standing on the dial. Authored as a lathe outline in
    (radius, forward) and then stood on its side, because a chapter ring IS a
    turning - and its steps are the only way this pipeline can draw the
    engraved circles on it."""
    obj = lib.revolve(name, [(a * MM, b * MM) for (a, b) in outline],
                      segments=segments)
    obj.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    obj.location = mm(x, 0.0, DIAL_CZ + v)
    lib.shade_auto(obj, 40)
    return paint(obj, mat)


def chapter_ring(mats):
    """Silvered, applied, 1.2 mm proud.

    The bands are cut as 0.35 mm steps in the turning rather than drawn as
    engraved circles. A real engraved circle is 0.6 mm wide, which is 0.43 px
    in the hero render and 0.9 of a texel at 4096 - as a line it could only
    alias. As a step it is a normal discontinuity, and those shade at any
    resolution."""
    o = [(CHAP_IN, 0.0), (CHAP_IN, CHAP_PROUD),
         (R_TICK_IN, CHAP_PROUD), (R_TICK_IN, CHAP_PROUD - 0.35),
         (R_TICK_OUT, CHAP_PROUD - 0.35), (R_TICK_OUT, CHAP_PROUD),
         (139.5, CHAP_PROUD), (140.5, CHAP_PROUD + 0.3),
         (CHAP_OUT, CHAP_PROUD + 0.3), (CHAP_OUT, 0.0)]
    return face_ring('chapter_ring', o, DIAL_X, 0.0, mats, mats['silver'], 144)


def dial_marks(mats):
    """Minute ticks, five-minute ticks and half-hour marks.

    These are geometry for a reason worth stating: on the real dial they are
    engraved 0.3 mm and filled with black wax, and at a metre you see the wax,
    not the relief. With no albedo map, a dark mark on a light ring can only be
    a dark solid, so they stand 0.35 mm proud and are painted near-black.
    A 0.7 mm tick is sub-pixel at the hero density - which is correct. On a
    real dial the minute track reads as a fine grey band, not as sixty lines."""
    made = []
    TRACK = CHAP_PROUD - 0.35        # the recessed minute band
    T = 0.35                         # how proud a mark stands

    def slab(name, pts, base):
        # +0.05 clear of the face it sits on: a mark whose back is exactly
        # coplanar with the ring z-fights along its whole length, and sixty of
        # them flickering is the loudest artefact on the dial.
        return yz_prism(name, [(u, DIAL_CZ + v) for (u, v) in pts], T,
                        DIAL_X + base + 0.05 + T / 2.0, mats['ink'],
                        smooth=False)

    def bar(name, r0, r1, w, th, base):
        u0, v0 = math.sin(th), math.cos(th)
        pts = [(rr * u0 + ss * w / 2.0 * v0, rr * v0 - ss * w / 2.0 * u0)
               for (rr, ss) in ((r0, -1), (r1, -1), (r1, 1), (r0, 1))]
        return slab(name, pts, base)

    for i in range(60):
        th = i / 60.0 * TAU
        if i % 5 == 0:
            made.append(bar('tick5_%d' % i, R_TICK_IN, R_TICK_OUT, 1.5, th,
                            TRACK))
        else:
            made.append(bar('tick_%d' % i, R_TICK_IN + 1.6, R_TICK_OUT, 0.75,
                            th, TRACK))

    for i in range(12):
        th = (i + 0.5) / 12.0 * TAU
        u0, v0 = math.sin(th), math.cos(th)
        pts = [(rr * u0 + ss * 2.6 * v0, rr * v0 - ss * 2.6 * u0)
               for (rr, ss) in ((R_HALFHOUR - 4.5, 0), (R_HALFHOUR, -1),
                                (R_HALFHOUR + 4.5, 0), (R_HALFHOUR, 1))]
        made.append(slab('half_%d' % i, pts, CHAP_PROUD))
    return made


def dial_numerals(mats):
    """The numerals, and lib.text()'s first real outing.

    English dials set them RADIALLY, so VI at the bottom is upside down.
    Getting that wrong is the surest sign of a clock nobody looked at."""
    made = []
    zf = DIAL_X + CHAP_PROUD + 0.4
    for h in range(12):
        su, sv, spin = hour_angle(h)
        g = glyphs('roman_%d' % h, ROMAN[h], 15.0, 0.55, mats['ink'])
        made.append(dial_place(g, R_ROMAN * su, R_ROMAN * sv, spin, x=zf))
    for i in range(12):
        n = 60 if i == 0 else i * 5
        su, sv, spin = hour_angle(i)
        g = glyphs('arab_%d' % n, str(n), 7.0, 0.5, mats['ink'])
        made.append(dial_place(g, R_ARABIC * su, R_ARABIC * sv, spin, x=zf))
    return made


def seconds_dial(mats):
    """The subsidiary seconds: a sunk silvered ring below XII, with a track,
    numerals every five and its own small blued hand."""
    made = []
    o = [(0.0, 1.0), (29.0, 1.0), (30.2, 1.35), (SEC_R, 1.35),
         (SEC_R, 0.0), (0.0, 0.0)]
    made.append(face_ring('seconds_ring', o, DIAL_X, SEC_CV, mats,
                          mats['silver'], 56))
    flat = DIAL_X + 1.0              # the sunk face the marks sit on
    T = 0.3
    for i in range(60):
        th = i / 60.0 * TAU
        u0, v0 = math.sin(th), math.cos(th)
        r0, r1, w = (25.0, 29.5, 0.9) if i % 5 == 0 else (27.4, 29.5, 0.5)
        pts = [(rr * u0 + ss * w / 2.0 * v0, rr * v0 - ss * w / 2.0 * u0)
               for (rr, ss) in ((r0, -1), (r1, -1), (r1, 1), (r0, 1))]
        made.append(yz_prism('sectick_%d' % i,
                             [(u, DIAL_CZ + SEC_CV + v) for (u, v) in pts],
                             T, flat + 0.05 + T / 2.0, mats['ink'],
                             smooth=False))
    for i in range(12):
        n = 60 if i == 0 else i * 5
        su, sv, spin = hour_angle(i)
        g = glyphs('sec_%d' % n, str(n), 5.4, 0.45, mats['ink'])
        made.append(dial_place(g, 20.5 * su, SEC_CV + 20.5 * sv, spin,
                               x=flat + 0.05 + 0.45 / 2.0))
    made.append(paint(lib.cyl('sec_collet', 2.6 * MM, 2.6 * MM, 3.0 * MM,
                              loc=mm(DIAL_X + 3.0, 0, DIAL_CZ + SEC_CV),
                              rot=(0, math.pi / 2, 0), segments=14),
                      mats['brass']))
    made.append(seconds_hand(mats))
    return made


def date_disc(mats):
    """Behind the aperture, carrying the numbers round its rim. Only one shows,
    but its neighbours have to be there or the aperture is a lit box."""
    made = []
    # The disc sits just behind the plate; its FRONT face is what shows.
    front = DIAL_X - DIAL_T - 0.8
    step = math.atan2(DATE_W + 3.0, abs(DATE_CV))

    # Only the segment behind the aperture, not a full ring. A full one passes
    # straight behind the two winding holes at r=62, and pass 2 rendered them
    # as pale silver discs instead of holes - the date ring was showing through
    # them.
    w = 2.2 * step
    seg = []
    for i in range(13):                       # outer edge, sweeping one way
        a = math.pi - w + 2 * w * i / 12.0
        seg.append((84.0 * math.sin(a), 84.0 * math.cos(a)))
    for i in range(13):                       # inner edge, back the other way
        a = math.pi + w - 2 * w * i / 12.0
        seg.append((46.0 * math.sin(a), 46.0 * math.cos(a)))
    made.append(dial_prism('date_disc', seg, 1.2, front - 0.6, mats['silver'],
                           smooth=False))

    for k, n in ((-1, 16), (0, 17), (1, 18)):
        th = math.pi + k * step
        u, v = abs(DATE_CV) * math.sin(th), abs(DATE_CV) * math.cos(th)
        g = glyphs('date_%d' % n, str(n), 11.0, 0.4, mats['ink'])
        # The numbers must read UPRIGHT in the aperture, so their tops point
        # towards the hand centre, not away from it. spin = -th put them
        # radially like the hour numerals and "17" came out upside down.
        made.append(dial_place(g, u, v, math.pi - th, x=front + 0.25))
    return made


# ---------------------------------------------------------------- ornament

ARM = 88.0          # how far a spandrel runs along the dial edge


def _wrap(a):
    while a > math.pi:
        a -= TAU
    while a < -math.pi:
        a += TAU
    return a


def span_outline(su, sv, e, arm, r_in, scallop, lobes=4, n=29):
    """The crescent a spandrel occupies: two arms down the edges of the plate
    from the corner, and a scalloped inner edge hugging the chapter ring."""
    d = math.atan2(sv, su)
    P = (su * e, sv * (e - arm))
    Q = (su * (e - arm), sv * e)
    aP = _wrap(math.atan2(P[1], P[0]) - d)
    aQ = _wrap(math.atan2(Q[1], Q[0]) - d)
    rP = math.hypot(*P)
    out = [P, (su * e, sv * e), Q]
    for i in range(n):
        t = i / float(n - 1)
        a = d + aQ + (aP - aQ) * t
        ease = min(1.0, t / 0.14, (1.0 - t) / 0.14)
        r = rP + (r_in - rP) * ease + scallop * math.sin(t * math.pi * lobes) * ease
        out.append((r * math.cos(a), r * math.sin(a)))
    return out


def spandrel(name, su, sv, x, mats):
    """A corner spandrel, built as a CASTING IN STEPPED PLATES.

    Pass 4 swept three round beads along its ribs, and an isolated diagnostic
    render (probe_span2.py, ribs painted red) showed them for what they were:
    red rubber piping laid round the rim. That is the pipe-cleaner failure the
    toolkit warns about for swept forms, and no re-routing of the paths was
    going to fix it, because a spandrel is not made of tubes.

    What a rococo spandrel is, at any distance you can actually see one, is a
    lobed PIERCED silhouette carrying two or three levels of stepped relief.
    So: a pierced ground plate, a smaller pierced plate stepped up off it,
    short flat ribs, and a domed boss at the corner. Every arris is crisp and
    there is not a round section in it.

    Everything is placed in (along, across) about the corner DIAGONAL rather
    than in polar coordinates about the hand centre. Pass 5 used the latter,
    and since the plate is square, swinging 19 degrees off the diagonal at
    radius 200 walked two of the three ribs clean off the dial - one of them
    32 mm below its bottom edge."""
    made = []
    d = math.atan2(sv, su)
    s = 1.0 if su * sv > 0 else -1.0
    ca, sa = math.cos(d), math.sin(d)

    def dpt(along, across=0.0):
        """`along` out from the hand centre down the corner diagonal;
        `across` perpendicular to it."""
        return (along * ca - across * sa * s, along * sa + across * ca * s)

    def pierce(target, holes, at_x):
        """Openwork: the matted ground showing through between the scrolls is
        most of what says casting rather than gold triangle."""
        for along, across, rad in holes:
            pu, pv = dpt(along, across)
            t = lib.cyl('_pierce', rad * MM, rad * MM, 30.0 * MM,
                        loc=mm(at_x, pu, DIAL_CZ + pv),
                        rot=(0, math.pi / 2, 0), segments=14)
            paint(t, mats['brass_matt'])
            lib.cut(target, t)

    ground = span_outline(su, sv, DIAL_R, ARM, 149.0, 8.5, 4)
    web = dial_prism(name + '_web', ground, 2.4, x - 1.2, mats['brass'],
                     smooth=False)
    # One hole list for BOTH tiers: a piercing in a casting goes straight
    # through. Piercing the two plates at slightly different centres left a
    # crescent of the lower tier showing inside every hole in the upper one,
    # and the four spandrels came back covered in Pac-Men.
    holes = ((181.0, 26.0, 8.0), (181.0, -26.0, 8.0),
             (163.0, 0.0, 7.5), (196.0, 0.0, 5.0))
    pierce(web, holes, x)
    made.append(web)

    # The upper tier is the ground outline scaled TOWARDS THE CORNER, which
    # keeps the two curves roughly parallel and cannot self-intersect. A true
    # normal-offset was tried first and folded itself inside out: the scallops
    # are 8.5 mm deep on a 35 mm wavelength, so a 9 mm inward offset turns
    # every concave lobe through itself and the plate collapsed to a sliver.
    cnr = (su * DIAL_R, sv * DIAL_R)
    upper = dial_prism(name + '_upper',
                       [(cnr[0] + (pu - cnr[0]) * 0.84,
                         cnr[1] + (pv - cnr[1]) * 0.84) for (pu, pv) in ground],
                       2.4, x + 0.9, mats['brass'], smooth=False)
    pierce(upper, holes, x + 0.9)
    made.append(upper)

    for tag, a0, c0, a1, c1, w in (('m', 197.0, 0.0, 168.0, 0.0, 10.0),
                                   ('p', 196.0, 7.0, 178.0, 21.0, 7.0),
                                   ('n', 196.0, -7.0, 178.0, -21.0, 7.0)):
        p0, p1 = dpt(a0, c0), dpt(a1, c1)
        vx, vy = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(vx, vy) or 1.0
        nx, ny = -vy / ln, vx / ln
        rib = [(p0[0] + nx * w * 0.40, p0[1] + ny * w * 0.40),
               (p1[0] + nx * w * 0.50, p1[1] + ny * w * 0.50),
               (p1[0] - nx * w * 0.50, p1[1] - ny * w * 0.50),
               (p0[0] - nx * w * 0.40, p0[1] - ny * w * 0.40)]
        made.append(dial_prism('%s_rib_%s' % (name, tag), rib, 2.2, x + 2.7,
                               mats['brass'], smooth=False))

    boss = lib.revolve(name + '_boss',
                       [(0.0, 0.0), (9.0 * MM, 0.0), (8.4 * MM, 1.4 * MM),
                        (6.0 * MM, 2.8 * MM), (0.0, 3.4 * MM)],
                       segments=20)
    bu, bv = dpt(201.0)
    boss.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    boss.location = mm(x + 1.6, bu, DIAL_CZ + bv)
    lib.shade_auto(boss, 40)
    made.append(paint(boss, mats['brass']))
    return made



def arch_ornament(name, su, x, mats):
    """The pair of smaller castings in the lower corners of the arch, flanking
    the boss.

    Built the same way as a corner spandrel - stepped pierced plates - for the
    same reason: the swept-bead version read as two gold squiggles, and at the
    size these are seen (about 30 px in the hero shot) a squiggle is just
    noise. Not a corner spandrel though: there is no corner up here, so the
    outline is a leaf fan rather than a crescent.

    It lives in the crescent bounded by three curves - the chapter ring below
    (r=143 from the hand centre), the arch above (r=152 from the arch centre)
    and the boss inboard. Pass 2 put it at v=158 with a 56 mm reach and it
    sprawled across the chapter ring."""
    made = []
    cu, cv = su * 116.0, 176.0
    d = math.radians(150.0 if su > 0 else 30.0)

    def at(r, a):
        return (cu + r * math.cos(d + a), cv + r * math.sin(d + a))

    leaf = []
    for i in range(19):
        t = i / 18.0
        a = -1.15 + 2.30 * t
        rr = 30.0 * (math.cos(a * 0.85) ** 1.4) * (1.0 + 0.16 * math.sin(a * 3.0))
        leaf.append(at(max(4.0, rr), a))

    web = dial_prism(name + '_web', leaf, 2.0, x - 1.0, mats['brass'],
                     smooth=False)
    for rr, aa, rad in ((21.0, 0.55, 3.4), (21.0, -0.55, 3.4), (17.0, 0.0, 3.0)):
        pu, pv = at(rr, aa)
        t = lib.cyl('_pierce', rad * MM, rad * MM, 30.0 * MM,
                    loc=mm(x, pu, DIAL_CZ + pv), rot=(0, math.pi / 2, 0),
                    segments=12)
        paint(t, mats['brass_matt'])
        lib.cut(web, t)
    made.append(web)

    made.append(dial_prism(name + '_upper',
                           [(cu + (pu - cu) * 0.68, cv + (pv - cv) * 0.68)
                            for (pu, pv) in leaf],
                           2.0, x + 0.8, mats['brass'], smooth=False))

    boss = lib.revolve(name + '_boss',
                       [(0.0, 0.0), (6.5 * MM, 0.0), (6.0 * MM, 1.2 * MM),
                        (4.2 * MM, 2.2 * MM), (0.0, 2.6 * MM)], segments=18)
    boss.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    boss.location = mm(x + 1.4, cu, DIAL_CZ + cv)
    lib.shade_auto(boss, 40)
    made.append(paint(boss, mats['brass']))
    return made


BOSS_CV = 218.0                      # boss centre, above the hand centre
BOSS_R = 60.0


def arch_boss(mats):
    """The signed boss: a silvered plate in the arch with the maker and his
    town on it. The one place on the whole clock somebody leans in to read.

    It has to sit clear of the chapter ring. Pass 2 centred it on the arch's
    springing at v=152, so with a 62 mm radius its lower half lay across the
    top of the ring and swallowed XII. The ring reaches v=143 on the centre
    line, so the boss centre goes up to 218 - which is where a real one is,
    roughly midway between the springing and the apex."""
    made = []
    o = [(0.0, 1.1), (BOSS_R - 6.0, 1.1), (BOSS_R - 4.5, 1.5),
         (BOSS_R - 2.0, 1.5), (BOSS_R, 0.9), (BOSS_R, 0.0), (0.0, 0.0)]
    made.append(face_ring('arch_boss', o, DIAL_X, BOSS_CV, mats,
                          mats['silver'], 72))
    made.append(dial_place(glyphs('maker', 'Jno. Wilkinson', 9.0, 0.5,
                                  mats['ink']), 0.0, BOSS_CV + 12.0, 0.0,
                           x=DIAL_X + 1.5))
    made.append(dial_place(glyphs('town', 'LANCASTER', 8.0, 0.5, mats['ink']),
                           0.0, BOSS_CV - 13.0, 0.0, x=DIAL_X + 1.5))
    return made


# ---------------------------------------------------------------- hands

def _mirror(half):
    return half + [(-u, v) for (u, v) in reversed(half[1:-1])]


def hand_blade(name, half, x, thick, mats, mat):
    return dial_prism(name, _mirror(half), thick, x, mat, smooth=False)


def minute_hand(mats):
    """Long, finely tapered, with a counterpoise tail past the centre. The
    counterpoise is not decoration - it is what balances the hand on its
    arbor, and its absence is one of the things that makes a drawn clock look
    drawn."""
    half = [(0.0, HAND_M_LEN), (1.9, HAND_M_LEN - 14.0), (2.6, 96.0),
            (4.2, 62.0), (3.1, 38.0), (6.4, 25.0), (3.8, 13.0), (8.6, 0.0),
            (3.8, -13.0), (6.8, -24.0), (4.6, -33.0), (8.2, -HAND_M_TAIL + 4.0),
            (0.0, -HAND_M_TAIL)]
    obj = hand_blade('hand_minute', half, DIAL_X + 4.1, 1.3, mats,
                     mats['blued'])
    pierce = lib.cyl('_pm', 3.1 * MM, 3.1 * MM, 12.0 * MM,
                     loc=mm(DIAL_X + 4.1, 0, DIAL_CZ + 25.0),
                     rot=(0, math.pi / 2, 0), segments=12)
    paint(pierce, mats['brass'])
    lib.cut(obj, pierce)
    th = SHOW_M / 60.0 * TAU
    spin(obj, -th)
    return obj


def hour_hand(mats):
    """Shorter, broader, pierced. It must not be the minute hand scaled - two
    hands of one outline is the commonest tell in a modelled clock."""
    half = [(0.0, HAND_H_LEN), (2.6, 99.0), (3.4, 80.0), (8.4, 66.0),
            (10.6, 52.0), (5.4, 41.0), (4.4, 27.0), (9.8, 15.0), (10.2, 0.0),
            (6.0, -11.0), (0.0, -15.0)]
    obj = hand_blade('hand_hour', half, DIAL_X + 2.2, 1.5, mats, mats['blued'])
    d = lib.box('_ph', mm(12.0, 7.6, 7.6),
                loc=mm(DIAL_X + 2.2, 0, DIAL_CZ + 57.0),
                rot=(math.radians(45), 0, 0), smooth=False)
    paint(d, mats['brass'])
    lib.cut(obj, d)
    th = (SHOW_H + SHOW_M / 60.0) / 12.0 * TAU
    spin(obj, -th)
    return obj


def seconds_hand(mats):
    """Offset onto the subsidiary dial's own centre before it is spun.

    dial_prism authors about the HAND centre, so pass 3 built this 26 mm blade
    at the middle of the main dial and then rotated it about the seconds
    centre - which swung it out to the chapter ring, where it read as a stray
    blue splinter beside the Arabic 5."""
    half = [(0.0, 26.0), (1.0, 18.0), (1.4, 4.0), (2.6, 0.0), (1.4, -3.0),
            (2.4, -7.0), (0.0, -9.0)]
    at_sec = [(u, SEC_CV + v) for (u, v) in _mirror(half)]
    obj = dial_prism('hand_seconds', at_sec, 0.8, DIAL_X + 2.6,
                     mats['blued'], smooth=False)
    th = SHOW_S / 60.0 * TAU
    spin(obj, -th, cv=SEC_CV)
    return obj


def spin(obj, ang, cv=0.0):
    """Turn something authored pointing at XII about the dial centre."""
    bpy.context.view_layer.update()
    p = Vector((0.0, 0.0, (DIAL_CZ + cv) * MM))
    obj.matrix_world = (Matrix.Translation(p) @ Matrix.Rotation(ang, 4, 'X')
                        @ Matrix.Translation(-p) @ obj.matrix_world)
    return obj


def dial(mats):
    made = [dial_plate(mats), chapter_ring(mats)]
    made += dial_marks(mats)
    made += dial_numerals(mats)
    made += seconds_dial(mats)
    made += date_disc(mats)
    made += arch_boss(mats)
    for su in (-1, 1):
        for sv in (-1, 1):
            made += spandrel('spandrel%d%d' % (su, sv), su, sv,
                             DIAL_X + 1.4, mats)
    for su in (-1, 1):
        made += arch_ornament('archspan%d' % su, su, DIAL_X + 1.4, mats)
    made.append(hour_hand(mats))
    made.append(minute_hand(mats))
    made.append(paint(lib.cyl('hand_collet', 7.0 * MM, 5.4 * MM, 4.0 * MM,
                              loc=mm(DIAL_X + 5.4, 0, DIAL_CZ),
                              rot=(0, math.pi / 2, 0), segments=18),
                      mats['brass']))
    return made


# ================================================================ the movement
#
# What an open trunk door shows. A seconds-beating pendulum is 994 mm from its
# suspension to the centre of the bob, which is not negotiable: it is what
# makes the clock beat seconds, and it puts the bob low in the trunk whether
# that is convenient or not.

BOB_CZ = SUSPENSION_Z - PEND_LEN
PEND_X = -78.0
WT_X = -6.0
WT_U = 66.0


def pendulum(mats):
    made = []
    rod_top = SUSPENSION_Z
    rod_bot = BOB_CZ - 4.0
    made.append(paint(lib.cyl('pend_rod', 1.7 * MM, 1.7 * MM,
                              (rod_top - rod_bot) * MM,
                              loc=mm(PEND_X, 0, (rod_top + rod_bot) / 2.0),
                              segments=10), mats['steel']))
    o = [(0.0, 0.0), (22.0, 0.6), (42.0, 2.6), (57.0, 6.4), (64.0, 9.6),
         (BOB_R, 11.0), (64.0, 12.4), (57.0, 15.6), (42.0, 19.4),
         (22.0, 21.4), (0.0, BOB_T)]
    bob = lib.revolve('pend_bob', [(a * MM, b * MM) for (a, b) in o],
                      segments=60)
    bob.rotation_euler = (0.0, math.pi / 2.0, 0.0)
    bob.location = mm(PEND_X + BOB_T / 2.0, 0, BOB_CZ)
    lib.shade_auto(bob, 42)
    made.append(paint(bob, mats['brass']))
    # the rating nut under it
    made.append(paint(lib.cyl('pend_nut', 6.5 * MM, 5.0 * MM, 9.0 * MM,
                              loc=mm(PEND_X, 0, BOB_CZ - BOB_R - 6.0),
                              segments=14), mats['brass']))
    return made


def weights(mats):
    """Two of them, an eight-day clock having a going train and a striking
    train, hung at different heights because they are never wound level."""
    made = []
    o = [(0.0, 0.0), (19.0, 2.0), (27.0, 8.0), (WEIGHT_R, 17.0),
         (WEIGHT_R, WEIGHT_L - 17.0), (27.0, WEIGHT_L - 8.0),
         (19.0, WEIGHT_L - 2.0), (0.0, WEIGHT_L)]
    for s, top in ((-1, 942.0), (1, 1002.0)):
        w = lib.revolve('weight%d' % s, [(a * MM, b * MM) for (a, b) in o],
                        segments=28)
        w.location = mm(WT_X, s * WT_U, top - WEIGHT_L)
        lib.shade_auto(w, 40)
        made.append(paint(w, mats['brass_dark']))
        made.append(paint(lib.ring('pulley%d' % s, 5.0 * MM, 13.0 * MM,
                                   7.0 * MM,
                                   loc=mm(WT_X, s * WT_U, top + 15.0),
                                   rot=(math.pi / 2, 0, 0), segments=16),
                          mats['brass']))
        for dx in (-11.0, 11.0):
            made.append(paint(lib.cyl('line%d_%d' % (s, int(dx)),
                                      1.0 * MM, 1.0 * MM,
                                      (1360.0 - top - 15.0) * MM,
                                      loc=mm(WT_X + dx, s * WT_U,
                                             (top + 15.0 + 1360.0) / 2.0),
                                      segments=6), mats['pine']))
        made.append(paint(lib.cyl('hook%d' % s, 1.6 * MM, 1.6 * MM,
                                  20.0 * MM,
                                  loc=mm(WT_X, s * WT_U, top + 5.0),
                                  segments=8), mats['steel']))
    return made


# ================================================================ build

def build():
    lib.reset()
    m = palette()
    report = []

    case = []
    case += feet(m['oak_side'])
    case.append(case_moulding('base_mould', sec_base(), PLINTH_W, PLINTH_D,
                              BASE_Z0, m['oak']))
    case += plinth(m)
    case.append(case_moulding('plinth_cap', sec_plinth_cap(),
                              TRUNK_W0, TRUNK_D, CAP_Z0, m['oak']))
    case.append(trunk(m))
    case.append(door_surround(m))
    case.append(case_moulding('throat_mould', sec_throat(),
                              trunk_w(THROAT_Z0), TRUNK_D, THROAT_Z0, m['oak']))
    case.append(hood_shell(m))
    case += cornice(m)

    interior = trunk_interior(m) + [hood_backboard(m)]
    door = trunk_door(m)
    hood = hood_columns(m) + hood_door(m) + pediment(m)
    face = dial(m)
    movement = pendulum(m) + weights(m)

    # ---- the numbers a picture will not tell me -------------------------
    print('--- the vertical stack (mm) ---')
    for label, a, b in (('bracket feet', 0.0, FOOT_H),
                        ('base moulding', BASE_Z0, BASE_Z1),
                        ('plinth', PLINTH_Z0, PLINTH_Z1),
                        ('plinth cap', CAP_Z0, CAP_Z1),
                        ('trunk', TRUNK_Z0, TRUNK_Z1),
                        ('throat moulding', THROAT_Z0, THROAT_Z1),
                        ('hood', HOOD_Z0, HOOD_Z1),
                        ('cornice', CORN_Z0, CORN_Z1),
                        ('pediment + finial', CORN_Z1, TOTAL_H)):
        print('   %-18s %7.1f -> %7.1f   %6.1f' % (label, a, b, b - a))
    print('   %-18s %7.1f' % ('TOTAL', TOTAL_H))

    print('--- the overhangs, which the brief says must all be mouldings ---')
    print('   plinth  %6.1f wide over a trunk of %6.1f   step %5.1f each side'
          % (PLINTH_W, TRUNK_W0, (PLINTH_W - TRUNK_W0) / 2.0))
    print('   hood    %6.1f wide over a trunk of %6.1f   step %5.1f each side'
          % (HOOD_W, TRUNK_W1, (HOOD_W - TRUNK_W1) / 2.0))
    print('   cornice %6.1f wide over a hood  of %6.1f   step %5.1f each side'
          % (HOOD_W + 2 * CORN_PROJ, HOOD_W, CORN_PROJ))
    print('   waist tapers %.1f -> %.1f over %.0f mm'
          % (TRUNK_W0, TRUNK_W1, TRUNK_Z1 - TRUNK_Z0))

    print('--- the dial ---')
    print('   plate %.0f across, %.1f tall to the arch, centre at z=%.1f'
          % (DIAL_W, DIAL_R * 3.0, DIAL_CZ))
    print('   chapter ring %.0f/%.0f, Roman at r=%.1f, Arabic at r=%.1f'
          % (CHAP_OUT * 2, CHAP_IN * 2, R_ROMAN, R_ARABIC))
    print('   reading %d:%02d:%02d' % (SHOW_H, SHOW_M, SHOW_S))

    # The vertical stack is obvious in every render; the DEPTH stack is not,
    # and it is where a real fault hid for four passes - the glazing ended up
    # behind the dial when the hood got shallower, so the clock was being
    # "seen through glass" that was inside the movement.
    print('--- the depth stack, front of the hood backwards (mm) ---')
    hood_front = HOOD_D / 2.0
    glass_x = hood_front - 21.0
    hand_front = DIAL_X + 5.4 + 2.0
    for label, xx in (('hood door, front face', hood_front),
                      ('hood door, back face', hood_front - 22.0),
                      ('glass', glass_x),
                      ('minute hand + collet, front', hand_front),
                      ('chapter ring, front', DIAL_X + CHAP_PROUD),
                      ('dial plate, front', DIAL_X),
                      ('dial plate, back', DIAL_X - DIAL_T)):
        print('   %-30s x = %+7.1f' % (label, xx))
    gap = glass_x - hand_front
    print('   glass clears the hands by %+.1f mm  %s'
          % (gap, 'OK' if gap > 1.0 else 'FAIL - the dial is in front of its '
             'own glazing'))

    print('--- the movement ---')
    print('   suspension z=%.0f, pendulum %.0f long, bob centre z=%.0f'
          % (SUSPENSION_Z, PEND_LEN, BOB_CZ))
    print('   door opening z=%.0f..%.0f, so the bob shows from %.0f to %.0f'
          % (DOOR_Z0, DOOR_Z1, BOB_CZ - BOB_R, BOB_CZ + BOB_R))
    if BOB_CZ - BOB_R < DOOR_Z0:
        print('   WARNING the bottom of the bob is below the door opening')

    print('--- against a %.2f m figure ---' % cfg.FIGURE_H)
    print('   %.3f m overall = %.2f x the figure; the dial centre is at %.3f m,'
          % (TOTAL_H * MM, TOTAL_H * MM / cfg.FIGURE_H, DIAL_CZ * MM))
    print('   which is %.3f m above a %.2f m eye line'
          % (DIAL_CZ * MM - 1.60, 1.60))

    # ---- group by material family, for sane draw calls ------------------
    groups = [
        lib.merge_into('clock_case', case),
        lib.merge_into('clock_door', door),
        lib.merge_into('clock_hood', hood),
        lib.merge_into('clock_dial', face),
        lib.merge_into('clock_movement', movement),
        lib.merge_into('clock_interior', interior),
    ]
    for g in groups:
        if g is not None:
            n = sum(len(p.vertices) - 2 for p in g.data.polygons)
            print('GROUP %-18s %6d tris  %d materials'
                  % (g.name, n, len(g.data.materials)))

    lib.export(NAME, report)
    lib.summarise(report)
    return groups


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


if __name__ == '__main__':
    build()
