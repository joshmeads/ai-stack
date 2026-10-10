# A farm tractor. The toolkit's demonstration model.
#
#   blender --background --python demo_tractor.py -- demo_tractor
#   blender --background --python shots.py -- demo_tractor
#
# WHAT MAKES A TRACTOR READ AS A TRACTOR
# --------------------------------------
# One thing, before anything else: the back wheels are enormous and the front
# wheels are small. 1.90 m against 1.33 m is nearly half as big again. Every
# other cue — the long bonnet, the cab set back over the rear axle, the stack
# up one flank, the linkage hanging off the tail — is secondary to that one,
# and if the wheels come out matched the silhouette reads as a truck however
# good the rest is. So the wheels are placed first and everything else is
# arranged around them.
#
# The body is ONE mesh grown from a single cube (see boxmodel.py). Bonnet,
# firewall, cab and rear housing are extrusions of each other, so the surface
# is continuous and the outline is one line rather than a stack of colliding
# solids. The wheels, mudguards, stack and linkage are separate objects because
# on the machine they are bolted on, and they should read as bolted on.
#
# Each wheel hangs off its own empty at the axle centre, so an engine can find
# it by name and turn it.
#
# It comes out 4.49 long, 2.49 wide and 2.88 to the cab roof — about two and a
# half times the height of a 1.75 m person at the nose, and two thirds again
# taller than one at the roof.
#
# AXES. Blender is Z-up and the exporter maps it to glTF's Y-up. Here:
# +X is forward, +Y is the machine's left, +Z is up.
import bmesh
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# the toolkit lives one directory up, in scripts/
sys.path.append(os.path.join(HERE, os.pardir, 'scripts'))
import lib                      # noqa: E402
from boxmodel import Form       # noqa: E402


# ---------------------------------------------------------------- dimensions
#
# Named rather than inlined because most of them are load bearing twice over:
# the rear axle height IS the rear tyre radius, and the overall width is set by
# the outer face of the rear tyre and nothing else.
#
# Only numbers something actually reads are here. Overall length and nose
# position are results of the extrusion chain below rather than inputs to it,
# and a constant nobody reads is free to drift away from the shape it claims to
# describe without anything failing.

WIDTH, HEIGHT = 2.49, 2.88

REAR_R, REAR_W = 0.95, 0.42         # 1.90 m diameter
FRONT_R, FRONT_W = 0.665, 0.32      # 1.33 m diameter
REAR_AXLE_X = -1.14
FRONT_AXLE_X = 1.36                 # 2.50 m wheelbase
REAR_TRACK_Y = WIDTH / 2 - REAR_W / 2
FRONT_TRACK_Y = 0.86                # the front track is narrower, as in life

SKIRT_Z = 1.06                      # chassis line: paint above, dark below
CAB_FLOOR_Z = 1.80                  # bottom of the glass, top of the plinth
CAB_TOP_Z = 2.74                    # cab shell; the roof slab takes it to 2.88
ROOF_T = HEIGHT - CAB_TOP_Z
CAB_HALF_W = 0.635


# ---------------------------------------------------------------- palette

def palette():
    return dict(
        paint=lib.hexmat('paint', 0xB03A2E, rough=0.40, clearcoat=0.55),
        chassis=lib.hexmat('chassis', 0x3C4148, rough=0.70),
        steel=lib.hexmat('steel', 0x8D949C, rough=0.42, metal=0.65),
        rubber=lib.hexmat('rubber', 0x22252A, rough=0.90),
        rim=lib.hexmat('rim', 0xD9CFB2, rough=0.55),
        glass=lib.hexmat('glass', 0x86AEC4, rough=0.10, alpha=0.44),
        lamp=lib.hexmat('lamp', 0xFFEBA8, rough=0.25, emissive=1.4),
        seat=lib.hexmat('seat', 0x2B2E33, rough=0.85),
    )


def see_through(mat):
    """Make an alpha material actually blend in EEVEE.

    lib.material sets the legacy `blend_method`; the current real-time engine
    reads `surface_render_method` instead, and left on its default the glass
    renders as an opaque pane."""
    if hasattr(mat, 'surface_render_method'):
        mat.surface_render_method = 'BLENDED'
    return mat


# ---------------------------------------------------------------- helpers

def paint(obj, mat):
    """Give one object one material, so a later merge can keep them apart."""
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def slice_at(form, z):
    """Cut a ring into a grown form at a constant height, moving nothing.

    A face is one colour, and the bonnet flank is a single quad from the belly
    to the top, so a paint threshold cannot put a chassis line across it. The
    ring exists purely to give repaint() an edge to work to. bisect_plane puts
    the new vertices exactly on the plane by construction and leaves every
    other vertex where it was."""
    bm = form.bm
    bmesh.ops.bisect_plane(
        bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=(0, 0, z), plane_no=(0, 0, 1),
        clear_inner=False, clear_outer=False)
    bm.normal_update()
    return form


def square_ring(form, faces, z, x_rear, x_front, half_w):
    """Square off the ring of vertices at the open top of an extrusion.

    The cab is pulled out of the top of the rear body, and that top is neither
    flat nor parallel-sided — it slopes down towards the tail and narrows.
    Extruded as-is the cab inherits both, so the roof comes out wedged and the
    walls splay all the way up, which reads as a grain hopper rather than a
    cab. Telling each ring where it belongs keeps the flare in the plinth,
    below the glass, and leaves the glazed part a near-parallel box.

    The ring is taken from the faces the extrude returned rather than by a
    height threshold: the bonnet top and the plinth top land within a few
    centimetres of each other, and a threshold picks up whichever of them the
    last edit happened to move."""
    verts = list({v for f in faces for v in f.verts})
    xs = [v.co.x for v in verts]
    lo, hi = min(xs), max(xs)
    for v in verts:
        t = (v.co.x - lo) / max(1e-6, hi - lo)
        v.co.x = x_rear + (x_front - x_rear) * t
        v.co.y = math.copysign(half_w, v.co.y)
        v.co.z = z
    form.bm.normal_update()
    return form


def wheel(name, r, width, x, y, segments, bars, parent, pal):
    """One wheel — tyre, rim, hub and tread bars — under an empty at the axle.

    The tyre is an annulus and not a disc: the rim has to sit inside it in a
    different colour, and that pale centre inside a dark ring is most of what
    stops a wheel reading as a hole punched in the machine.

    `segments` must be a multiple of four so a vertex lands at bottom dead
    centre; with an odd count the flat of a facet carries the weight and the
    wheel hovers a centimetre above the ground."""
    hub = lib.part(name, loc=(x, y, r), parent=parent)
    lie_down = (math.pi / 2, 0, 0)          # the wheel's axis onto world Y
    pieces = [
        paint(lib.ring(name + '_tyre', r * 0.50, r, width,
                       loc=(x, y, r), rot=lie_down, segments=segments),
              pal['rubber']),
        paint(lib.cyl(name + '_rim', r * 0.53, r * 0.53, width * 0.58,
                      loc=(x, y, r), rot=lie_down, segments=segments),
              pal['rim']),
        paint(lib.cyl(name + '_hub', r * 0.18, r * 0.15, width * 0.80,
                      loc=(x, y, r), rot=lie_down, segments=6),
              pal['steel']),
    ]
    # Tread bars, stepping side to side across the tyre. The zig-zag down the
    # edge of the wheel is the agricultural cue, and it is the one piece of
    # detail here that survives to the smallest render as a ragged outline
    # rather than a smooth car tyre. Held just inside the tyre radius so a bar
    # at the bottom of the wheel never pushes the model under the ground.
    for k in range(bars):
        a = (k + 0.5) / bars * math.tau
        rr = r - 0.030
        pieces.append(paint(lib.box(
            name + '_bar%d' % k, (0.085, width * 0.50, 0.075),
            loc=(x + math.cos(a) * rr,
                 y + (width * 0.20 if k % 2 else -width * 0.20),
                 r + math.sin(a) * rr),
            rot=(0, -(a + math.pi / 2), 0)), pal['rubber']))
    lib.merge_into(name + '_mesh', pieces, hub)
    return hub


def mudguard(name, cx, cz, y, r_in, r_out, width, a0, a1, segs=8):
    """A rectangular section swept round an arc over a wheel.

    A ring cannot stand in for this. A guard that closes underneath the wheel
    is a wheel arch with no wheel in it; it has to stop short of the horizontal
    at both ends, which makes it an open sweep with a cap on each end."""
    r_mid = (r_in + r_out) / 2
    path = [(cx + math.cos(math.radians(a)) * r_mid, y,
             cz + math.sin(math.radians(a)) * r_mid)
            for a in (a0 + (a1 - a0) * i / segs for i in range(segs + 1))]
    return lib.profile(name, lib.rect_section(width, r_out - r_in), path,
                       close=True, smooth=False)


# ---------------------------------------------------------------- the tractor

def build(name, report):
    lib.reset()
    pal = palette()
    see_through(pal['glass'])

    root = lib.part(name)

    # ---- body: one mesh, grown front to back ----
    # Start at the middle of the bonnet, the piece every other section is a
    # deviation from. The bonnet is deliberately NARROW — 0.84 against the
    # cab's 1.27. If the two match, the bonnet and the rear mudguard merge into
    # one slab down the flank and the machine loses its waist.
    #
    # Its top also has to clear the front tyre by a good margin. Level with the
    # tyre, the eye reads the tyre as the taller of the two, the front wheel
    # stops looking small, and that is the one comparison the whole silhouette
    # rests on.
    f = Form(size=(1.55, 0.84, 0.75), at=(1.15, 0.0, 1.245))
    # The nose: shorter, narrower and dropped, so the bonnet slopes away and
    # the driver can see the ground ahead of the front wheels.
    f.extrude(f.faces(normal='+x'), move=(0.355, 0, -0.06), scale=(1, 0.88, 0.80))
    # The firewall, widening and lifting into the front of the cab.
    f.extrude(f.faces(normal='-x'), move=(-0.50, 0, 0.03), scale=(1, 1.20, 1.14))
    # The block the cab stands on, straddling the rear axle.
    f.extrude(f.faces(normal='-x'), move=(-0.80, 0, -0.02), scale=(1, 1.00, 0.94))
    # The rear housing, drawing in so the linkage has somewhere to hang from.
    f.extrude(f.faces(normal='-x'), move=(-0.72, 0, -0.09), scale=(1, 0.80, 0.82))

    # The cab, pulled straight up out of the two rearmost top faces. Nearly all
    # of the widening happens in the plinth, under the glass.
    top = f.faces(normal='+z', xmax=-0.10)
    plinth = f.extrude(f.inset(top, thickness=0.05), move=(0, 0, 0.16))
    square_ring(f, plinth, CAB_FLOOR_Z, -1.62, -0.22, 0.66)
    cab = f.extrude(plinth, move=(0, 0, CAB_TOP_Z - CAB_FLOOR_Z))
    square_ring(f, cab, CAB_TOP_Z, -1.66, -0.30, CAB_HALF_W)
    # The roof, in two steps: a fascia overhanging on every side, then a cap
    # drawn back in above it. The overhang throws the shadow that tells the
    # glass below it that it is glass, and the taper keeps the largest single
    # surface on the machine from reading as a plate laid on top of a box.
    fascia = f.extrude(cab, move=(0, 0, ROOF_T * 0.64), scale=(1.08, 1.14, 1.0))
    f.extrude(fascia, move=(0, 0, ROOF_T * 0.36), scale=(0.90, 0.86, 1.0))

    slice_at(f, SKIRT_Z)

    # Two segments, because the body is where the triangles belong: the bonnet
    # and the cab are what a player sees at sixty pixels. min_angle skips the
    # near-flush edges left behind by the tapered extrusions — chamfering those
    # is invisible and costs as much as chamfering the corner rails that
    # actually carry the silhouette.
    f.bevel(0.04, segments=2, min_angle=15)
    body = f.build('body', None, root)

    # Painted by where the face is, because it is all one mesh. A cab modelled
    # as a separate object is a cab that can drift off the machine it is on.
    lib.repaint(body, [
        (pal['paint'], lambda c: True),
        (pal['chassis'], lambda c: c.z < SKIRT_Z),
        (pal['glass'], lambda c: CAB_FLOOR_Z + 0.10 < c.z < CAB_TOP_Z - 0.04),
        (pal['paint'], lambda c: c.z >= CAB_TOP_Z - 0.04),
    ])

    # ---- wheels: the whole point of the shape ----
    # Each one parents itself to the root as it is made, and nothing else here
    # refers to them again — they are addressed from outside, by name.
    for side, y in (('left', REAR_TRACK_Y), ('right', -REAR_TRACK_Y)):
        wheel('wheel_rear_' + side, REAR_R, REAR_W,
              REAR_AXLE_X, y, 16, 12, root, pal)
    for side, y in (('left', FRONT_TRACK_Y), ('right', -FRONT_TRACK_Y)):
        wheel('wheel_front_' + side, FRONT_R, FRONT_W,
              FRONT_AXLE_X, y, 12, 8, root, pal)

    # ---- rear mudguards ----
    # Close-fitting, thin, and starting well above the horizontal. Held off the
    # tyre a guard reads as a hoop hovering in mid-air; carried down towards
    # the horizontal it reaches past the wheel and hangs off nothing. And every
    # centimetre of bodywork over the wheel is a centimetre less of the dark
    # circle that says this is the big end of the machine.
    # Kept narrow, and stopped short of the horizontal at the back. Carried
    # further round, the trailing end swings clear of the tyre behind it and
    # reads in the silhouette as a loose blade with daylight underneath.
    guard_w = REAR_W + 0.14
    guard_y = WIDTH / 2 - guard_w / 2
    guards = [mudguard('guard_%s' % s, REAR_AXLE_X, REAR_R, y,
                       REAR_R + 0.02, REAR_R + 0.11, guard_w, 33, 142, segs=8)
              for s, y in (('left', guard_y), ('right', -guard_y))]
    # The steered wheels are left bare. Real machines of this class do carry
    # small front guards, and they are the wrong thing here: a hoop of bodywork
    # over the front tyre adds most of the height difference back and the two
    # ends of the machine start to look the same size, which is the one
    # comparison the whole silhouette is built on.

    # ---- exhaust, up the right flank of the bonnet ----
    # The machine's right is -Y. Set well forward of the cab, not tucked against
    # it: standing in front of the windscreen the stack is absorbed into the
    # cab's outline and stops being a shape at all. Out on the bonnet it has a
    # metre of clear air above the panel and it is the one vertical line on a
    # machine that is otherwise all horizontals. Fatter than scale on purpose —
    # a true 100 mm stack is under a pixel at the size this is drawn.
    # Far enough forward that it clears the roof overhang in projection as well
    # as in plan. The roof reaches further out over the flank than the cab wall
    # does, and a stack tucked inside that overhang is inside the machine's
    # outline at the hero angle even though nothing is actually in front of it.
    ex_x, ex_y = 1.05, -0.465
    stack = [
        lib.cyl('exhaust_box', 0.098, 0.090, 0.54, loc=(ex_x, ex_y, 1.40), segments=8),
        lib.cyl('exhaust_pipe', 0.066, 0.056, 1.00, loc=(ex_x, ex_y, 2.08), segments=8),
        lib.cyl('exhaust_cap', 0.084, 0.084, 0.07, loc=(ex_x, ex_y, 2.61), segments=8),
    ]

    # ---- cab interior ----
    # Glass with nothing behind it is a coloured panel. A seat and a wheel cost
    # almost nothing and are the difference between a cab you look through and
    # a cab you look at.
    column_dir = (-0.20, 0.30)
    column_a = math.atan2(column_dir[0], column_dir[1])
    inside = [
        paint(lib.box('seat_pan', (0.46, 0.48, 0.16), loc=(-1.16, 0, 1.93),
                      chamfer=0.03), pal['seat']),
        paint(lib.box('seat_back', (0.14, 0.46, 0.52), loc=(-1.40, 0, 2.21),
                      rot=(0, -0.16, 0), chamfer=0.03), pal['seat']),
        # Kept low, narrow, and back under the steering wheel where a console
        # belongs. Pushed forward against the windscreen it projects clear of
        # the cab when the machine is seen from behind, and a dark slab that
        # appears to be sitting on the bonnet is worse than no dashboard.
        paint(lib.box('dash', (0.20, 0.66, 0.12), loc=(-0.54, 0, 1.90),
                      chamfer=0.02), pal['chassis']),
        paint(lib.cyl('steer_column', 0.035, 0.030, 0.36,
                      loc=(-0.52, 0, 2.11), rot=(0, column_a, 0), segments=6),
              pal['chassis']),
        paint(lib.torus('steer_wheel', 0.155, 0.022, loc=(-0.62, 0, 2.26),
                        rot=(0, column_a, 0), major_seg=12, minor_seg=5),
              pal['chassis']),
    ]

    # The cab's corner posts. Without them the glass band runs unbroken round
    # all four sides and the cab reads as a lantern rather than as a structure
    # holding a roof up.
    posts = [lib.box('post_%s%s' % (e, s), (0.10, 0.10, CAB_TOP_Z - CAB_FLOOR_Z),
                     loc=(x, y, (CAB_FLOOR_Z + CAB_TOP_Z) / 2), rot=(0, tilt, 0))
             for e, x, tilt in (('front', -0.27, -0.08), ('rear', -1.63, -0.04))
             for s, y in (('l', CAB_HALF_W - 0.02), ('r', -(CAB_HALF_W - 0.02)))]

    # ---- running gear ----
    gear = [
        lib.box('front_axle', (0.16, 1.42, 0.16), loc=(FRONT_AXLE_X, 0, FRONT_R)),
        lib.box('front_pivot', (0.54, 0.34, 0.26), loc=(FRONT_AXLE_X, 0, 0.86),
                chamfer=0.03),
        # The frame rail under the bonnet. Without it the bonnet runs to the
        # nose as one unbroken mass and the machine loses its waist — it starts
        # to read as a pickup with a cab on the back.
        lib.box('frame', (1.52, 0.44, 0.20), loc=(1.28, 0, 0.80), chamfer=0.03),
        # A grille set into the nose rather than the whole nose face painted
        # dark: lip to lip, the front reads as an open mouth and swallows the
        # headlights standing on it.
        lib.box('grille', (0.05, 0.46, 0.24), loc=(2.265, 0, 1.24)),
        # Louvres down the bonnet flanks. Nearly two metres of unbroken panel
        # between the nose and the cab is the longest flat run on the machine
        # and it is what makes a bonnet look like a crate lid. Narrow and
        # upright, never wide: a broad dark rectangle on the side of a bonnet
        # reads as a window, which puts a second cab where the engine is.
    ] + [
        lib.box('louvre%s%d' % (s, i), (0.09, 0.03, 0.26),
                loc=(1.30 + i * 0.20, sy * 0.425, 1.40))
        for s, sy in (('l', 1.0), ('r', -1.0)) for i in range(3)
    ] + [
        # Cast weights on the nose. They are what a tractor carries instead of
        # a bumper, and the ribs give the front something to catch light on.
        lib.box('weight_block', (0.22, 0.68, 0.30), loc=(2.14, 0, 0.88),
                chamfer=0.02),
        # The three point linkage, and the casting it all hangs from. Built
        # heavier than scale: at this size the real sections come out as grey
        # chopsticks behind the tail, and the linkage is the thing that says
        # this machine pulls implements.
        #
        # Every arm has to visibly spring from something. The rear tyre hides
        # the span between the casting and the point where the arms clear it,
        # so arms sized off the real machine emerge from behind the wheel with
        # no root and read as debris caught under the back axle. The casting is
        # therefore sized to reach the body above and the arms below, and the
        # mast is there so the top link starts somewhere too.
        lib.box('rear_casting', (0.36, 0.72, 0.60), loc=(-1.80, 0, 0.86),
                chamfer=0.04),
        lib.box('link_mast', (0.14, 0.18, 0.36), loc=(-1.73, 0, 1.22),
                chamfer=0.02),
        # The power take-off. One short shaft on the centreline is the most
        # recognisable thing on the back of a tractor.
        lib.cyl('pto_shaft', 0.075, 0.070, 0.22, loc=(-2.05, 0, 0.72),
                rot=(0, math.pi / 2, 0), segments=8),
        lib.box('top_link', (0.44, 0.12, 0.11), loc=(-1.92, 0, 1.25),
                rot=(0, math.radians(-24), 0)),
    ]
    for i, y in enumerate((0.40, -0.40)):
        gear.append(lib.box('lower_link%d' % i, (0.62, 0.16, 0.12),
                            loc=(-1.86, y, 0.62), rot=(0, math.radians(-14), 0)))
        gear.append(lib.box('link_ball%d' % i, (0.15, 0.20, 0.17),
                            loc=(-2.12, y * 1.08, 0.52)))
        # A ladder, not a floating plate. One tread hanging under the door
        # reads as a modelling mistake; two treads on a stringer that reaches
        # the cab floor read as the way you get in.
        sy = math.copysign(1.0, y)
        gear.append(lib.box('step_rail%d' % i, (0.07, 0.05, 0.82),
                            loc=(-0.32, sy * 0.545, 0.88)))
        for k, z in enumerate((0.50, 0.86)):
            gear.append(lib.box('step%d%d' % (i, k), (0.28, 0.20, 0.045),
                                loc=(-0.32, sy * 0.62, z)))

    # ---- lamps ----
    lamps = [lib.box('head%d' % i, (0.05, 0.12, 0.10), loc=(2.262, y, 1.34))
             for i, y in enumerate((0.30, -0.30))]
    # Work lamps in the roof fascia, not on top of it. Standing on the roof
    # they are four bright specks on a coloured square, which is exactly what
    # they look like at the size this is drawn.
    lamps += [lib.box('work%d' % i, (0.05, 0.14, 0.07), loc=(-0.255, y, 2.78))
              for i, y in enumerate((0.46, -0.46))]
    lamps += [lib.box('tail%d' % i, (0.05, 0.14, 0.07), loc=(-1.705, y, 2.78))
              for i, y in enumerate((0.44, -0.44))]

    lib.merge_into('mudguards', guards, root, pal['paint'])
    lib.merge_into('exhaust', stack, root, pal['steel'])
    lib.merge_into('cab_posts', posts, root, pal['paint'])
    lib.merge_into('interior', inside, root)
    lib.merge_into('running_gear', gear, root, pal['chassis'])
    lib.merge_into('lamps', lamps, root, pal['lamp'])

    lib.export(name, report)


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def main():
    args = argv()
    report = []
    build(args[0] if args else 'demo_tractor', report)
    lib.summarise(report)


main()
