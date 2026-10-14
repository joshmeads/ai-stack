# A twin-lens reflex camera of the Rolleiflex kind, on a desk.
#
#   blender --background --python build_tlr.py -- tlr
#   blender --background --python shots.py  -- tlr
#
# This is a deliberate stress test of the toolkit: a hand-sized, hard-surface,
# close-up object whose character is mostly SURFACE (leatherette grain, chrome,
# black enamel, coated glass) rather than shape.
#
# AXES. Blender is Z-up. Here:
#   +X  out of the lens, towards the subject   (the "front")
#   +Y  the camera's own left, which is the VIEWER's right in the front ortho
#   +Z  up; the baseplate sits on z = 0
import bpy
import bmesh
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(HERE)
import mathutils                # noqa: E402
import lib                      # noqa: E402

TAU = math.tau


# ---------------------------------------------------------------- dimensions
#
# Real Rolleiflex 2.8F: 102 wide x 97 deep x 145 tall with the hood folded.
# Built here with the hood ERECT, which is the form that reads as a TLR, so the
# height goes to ~192. Everything in metres.

W_HALF = 0.0478        # leatherette body half-width  (96 mm across)
X_BACK = -0.0432       # back of the body
X_FRONT = 0.0345       # front of the body, where the focusing panel starts

Z_BASE = 0.0060        # top of the chrome baseplate
Z_BODY = 0.1100        # top of the leatherette
Z_DECK = 0.1205        # the recessed deck the ground glass lies in
Z_TOP = 0.1240         # top of the chrome rim = the hood hinge line
Z_HOOD = 0.1770        # top of the erect rear flap

PANEL_X = 0.0405       # face of the black enamel focusing panel
BEZEL_X = 0.0375       # face of its chrome surround

TAKE_Z = 0.0360        # taking lens axis
VIEW_Z = 0.0855        # viewing lens axis
TAKE_R = 0.0225        # outer radius of the taking bezel
VIEW_R = 0.0205

KNOB_X = -0.0040       # the focus / wind axis, in X
KNOB_Z = 0.0580

SEG = 64               # segments on anything round and prominent


# ---------------------------------------------------------------- palette

def palette():
    return dict(
        # Leatherette. Flat black with a broken specular is the closest a
        # material-only pipeline gets; the grain has to be geometry (see
        # pebble()) because there are no UVs and so no normal map.
        hide=lib.hexmat('hide', 0x1A1918, rough=0.80),
        enamel=lib.hexmat('enamel', 0x121213, rough=0.19, clearcoat=0.45),
        # A finder hood is painted sheet, not piano lacquer: at gloss 0.17
        # it mirrored the sky and read as moulded plastic.
        hoodpaint=lib.hexmat('hoodpaint', 0x161617, rough=0.42),
        chrome=lib.hexmat('chrome', 0xEDF0F4, rough=0.055, metal=1.0),
        satin=lib.hexmat('satin', 0xC6CAD0, rough=0.26, metal=1.0),
        steel=lib.hexmat('steel', 0x7C8288, rough=0.34, metal=0.9),
        glass=lib.hexmat('glass', 0x0B1220, rough=0.030, clearcoat=1.0),
        coat=lib.hexmat('coat', 0x2A1C3A, rough=0.045, clearcoat=1.0),
        screen=lib.hexmat('screen', 0x8E9189, rough=0.78),
        ink=lib.hexmat('ink', 0xF4F4F0, rough=0.42),
        red=lib.hexmat('red', 0x8C1D18, rough=0.35),
        felt=lib.hexmat('felt', 0x0A0A0A, rough=0.95),
    )


def paint(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


# ---------------------------------------------------------------- local helpers
#
# Everything in this block is something lib.py does not have. Each one is
# noted in the report.

def rounded_box(name, size, loc=(0, 0, 0), r_vert=0.006, seg_vert=6,
                r_horiz=0.0015, seg_horiz=2, smooth=True):
    """A box with a LARGE fillet on the four vertical edges and a SMALL one on
    the top and bottom rims.

    lib.box() has a single `chamfer` applied to every edge at once, which is
    the wrong shape for almost any manufactured body: a camera has a 7 mm
    corner radius and a 1.5 mm rim break, not one radius everywhere."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    if r_vert > 0:
        e = [x for x in bm.edges
             if abs((x.verts[1].co - x.verts[0].co).z) > 1e-6]
        bmesh.ops.bevel(bm, geom=e + list({v for x in e for v in x.verts}),
                        offset=r_vert, segments=seg_vert, affect='EDGES',
                        profile=0.5, clamp_overlap=True)
    if r_horiz > 0:
        e = [x for x in bm.edges
             if abs((x.verts[1].co - x.verts[0].co).z) < 1e-6]
        bmesh.ops.bevel(bm, geom=e + list({v for x in e for v in x.verts}),
                        offset=r_horiz, segments=seg_horiz, affect='EDGES',
                        profile=0.5, clamp_overlap=True)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj.location = loc
    for p in mesh.polygons:
        p.use_smooth = smooth
    if smooth:
        lib.shade_auto(obj, 32)
    return obj


def fluted_section(r, depth, flutes):
    """A knurled rim in plan: a triangle wave around the circle."""
    pts = []
    n = flutes * 2
    for i in range(n):
        a = i / n * TAU
        rr = r if i % 2 == 0 else r - depth
        pts.append((math.cos(a) * rr, math.sin(a) * rr))
    return pts


def fluted_disc(name, r, depth, flutes, y0, y1, x=0.0, z=0.0, ease=0.0008,
                smooth=False):
    """A milled knob. Swept along X by lib.loft, then stood on its side, so the
    axis ends up along Y — which is where a Rolleiflex's knobs point."""
    a, b = min(y0, y1), max(y0, y1)
    stations = []
    for t, k in ((0.0, 0.93), (ease, 1.0), (b - a - ease, 1.0), (b - a, 0.93)):
        sec = [(py * k, pz * k) for (py, pz) in
               fluted_section(r, depth, flutes)]
        stations.append((t, sec))
    obj = lib.loft(name, stations, cap_ends=True, smooth=smooth)
    obj.rotation_euler = (0.0, 0.0, math.radians(90))   # +X sweep -> +Y
    obj.location = (x, a, z)
    return obj


def disc(name, r1, r2, thick, y, x=KNOB_X, z=KNOB_Z, seg=SEG, smooth=True):
    """A cylinder with its axis along Y, positioned by its inner face."""
    return lib.cyl(name, r1, r2, thick, loc=(x, y + thick / 2, z),
                   rot=(math.radians(90), 0, 0), segments=seg, smooth=smooth)


def barrel(name, r1, r2, length, x, z, seg=SEG, chamfer=0.0, smooth=True):
    """A cylinder with its axis along X (the lens axis), positioned by its rear
    face. r1 is the rear radius, r2 the front."""
    return lib.cyl(name, r1, r2, length, loc=(x + length / 2, 0, z),
                   rot=(0, math.radians(90), 0), segments=seg,
                   chamfer=chamfer, smooth=smooth)


def ring_x(name, r_in, r_out, w, x, z, y=0.0, seg=SEG):
    """lib.ring, stood up so the hole faces forward."""
    o = lib.ring(name, r_in, r_out, w, loc=(x + w / 2, y, z),
                 rot=(0, math.radians(90), 0), segments=seg, smooth=True)
    return lib.shade_auto(o, 30)


def ring_y(name, r_in, r_out, w, y, x=KNOB_X, z=KNOB_Z, seg=SEG):
    """lib.ring with the hole facing sideways, positioned by its inner face."""
    o = lib.ring(name, r_in, r_out, w, loc=(x, y + w / 2, z),
                 rot=(math.radians(90), 0, 0), segments=seg, smooth=True)
    return lib.shade_auto(o, 30)


def frame(name, w, h, bar, thick, x, y=0.0, z=0.0):
    """A rectangular bezel, built from four bars.

    There is no boolean in the toolkit, so a window cannot be cut into a panel;
    it has to be surrounded by something proud of the panel instead."""
    out = []
    for i, (bw, bh, oy, oz) in enumerate((
            (w, bar, 0.0, h / 2 - bar / 2),
            (w, bar, 0.0, -(h / 2 - bar / 2)),
            (bar, h - 2 * bar, w / 2 - bar / 2, 0.0),
            (bar, h - 2 * bar, -(w / 2 - bar / 2), 0.0))):
        out.append(lib.box('%s_%d' % (name, i), (thick, bw, bh),
                           loc=(x + thick / 2, y + oy, z + oz),
                           chamfer=min(bar, thick) * 0.28, segments=2,
                           smooth=True))
    return out


def _hash2(i, j, seed):
    n = (i * 374761393 + j * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0 - 0.5


def grain_plate(name, w, h, cell, amp, loc, rot, seed=1, skirt=0.0012):
    """Leatherette, as GEOMETRY.

    With no UVs there is no normal map, so the only way to break a specular the
    way a grained hide does is to actually move the surface. This lays a flat-
    shaded irregular grid over a body panel: every quad gets its own normal, so
    the highlight scatters instead of sliding across a mirror.

    It is a poor substitute and the triangle cost says so — the cell size that
    would match real morocco grain (about 0.7 mm) is four times finer than
    anything affordable here."""
    nx = max(2, int(round(w / cell)))
    ny = max(2, int(round(h / cell)))
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    grid = []
    for i in range(nx + 1):
        row = []
        for j in range(ny + 1):
            x = -w / 2 + w * i / nx
            y = -h / 2 + h * j / ny
            edge = min(i, nx - i, j, ny - j)
            fade = min(1.0, edge / 1.5)
            d = amp * (_hash2(i, j, seed)
                       + 0.55 * _hash2(i // 3, j // 3, seed + 7))
            row.append(bm.verts.new((x, y, d * fade)))
        grid.append(row)
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((grid[i][j], grid[i + 1][j],
                          grid[i + 1][j + 1], grid[i][j + 1]))
    # A skirt round the border so the panel reads as applied covering with a
    # cut edge, rather than as a floating sheet.
    if skirt > 0:
        ring = ([(i, 0) for i in range(nx + 1)]
                + [(nx, j) for j in range(1, ny + 1)]
                + [(i, ny) for i in range(nx - 1, -1, -1)]
                + [(0, j) for j in range(ny - 1, 0, -1)])
        low = [bm.verts.new((grid[i][j].co.x, grid[i][j].co.y, -skirt))
               for (i, j) in ring]
        for k in range(len(ring)):
            a, b = ring[k], ring[(k + 1) % len(ring)]
            bm.faces.new((grid[a[0]][a[1]], low[k],
                          low[(k + 1) % len(ring)], grid[b[0]][b[1]]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj.location = loc
    obj.rotation_euler = rot
    for pg in mesh.polygons:
        pg.use_smooth = False
    return obj


def plate_xz(name, poly, y0, y1):
    """A flat panel whose OUTLINE is given in the XZ plane, extruded in Y.

    lib.loft sweeps sections along X, so it cannot make a leaf whose front and
    rear edges are not vertical — which is what every folded-in hood flap is.
    Stating the outline directly is the only way to get one."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for (x, z) in poly]
    b = [bm.verts.new((x, y1, z)) for (x, z) in poly]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    for pg in mesh.polygons:
        pg.use_smooth = False
    return obj


def frame_z(name, w_x, w_y, bar, thick, z, x=0.0, y=0.0):
    """The same bezel lying flat, thickness in Z: the rim round the screen."""
    out = []
    for i, (bx, by, ox, oy) in enumerate((
            (w_x, bar, 0.0, w_y / 2 - bar / 2),
            (w_x, bar, 0.0, -(w_y / 2 - bar / 2)),
            (bar, w_y - 2 * bar, w_x / 2 - bar / 2, 0.0),
            (bar, w_y - 2 * bar, -(w_x / 2 - bar / 2), 0.0))):
        out.append(lib.box('%s_%d' % (name, i), (bx, by, thick),
                           loc=(x + ox, y + oy, z + thick / 2),
                           chamfer=min(bar, thick) * 0.28, segments=2,
                           smooth=True))
    return out


def text_mesh(name, body, size, loc, rot, depth=0.00022, res=4, spacing=1.0):
    """Raised lettering.

    The only way to put a word on a model without UVs. It costs real triangles
    and it is the reason the nameplate exists at all."""
    cu = bpy.data.curves.new(name, type='FONT')
    cu.body = body
    cu.size = size
    cu.extrude = depth
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.resolution_u = res
    cu.space_character = spacing
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    ob.rotation_euler = rot
    ob.location = loc
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


FACE_X = (math.radians(90), 0.0, math.radians(90))    # text lying on a +X face
FACE_Y = (math.radians(90), 0.0, math.radians(180))   # text on a +Y face


def text_ring(name, body, r, size, x, z, arc_deg, depth=0.00012, res=2):
    """Engraving wrapped round a lens bezel, one glyph at a time.

    Blender can put text on a curve; the toolkit has no way to ask for it, so
    each character is its own converted font object rotated about the lens
    axis. It is the single most convincing close-up detail available without a
    texture, and it costs about 200 triangles a letter."""
    out = []
    n = len(body)
    step = math.radians(arc_deg) / max(1, n - 1)
    base = mathutils.Euler(FACE_X, 'XYZ').to_matrix()
    for i, ch in enumerate(body):
        if ch == ' ':
            continue
        a = math.radians(arc_deg) / 2 - i * step
        ob = text_mesh('%s_%d' % (name, i), ch, size,
                       (x, -r * math.sin(a), z + r * math.cos(a)),
                       FACE_X, depth=depth, res=res)
        m = mathutils.Matrix.Rotation(a, 3, 'X') @ base
        ob.rotation_euler = m.to_euler('XYZ')
        out.append(ob)
    return out


# ---------------------------------------------------------------- the body

def body(p):
    out = []

    base = rounded_box('baseplate', (0.0785, 0.0976, Z_BASE),
                       loc=(-0.00435, 0, Z_BASE / 2),
                       r_vert=0.0075, seg_vert=7, r_horiz=0.0012)
    out.append(paint(base, p['satin']))

    shell = rounded_box('shell', (0.0777, 2 * W_HALF, Z_BODY - Z_BASE),
                        loc=(-0.00435, 0, (Z_BASE + Z_BODY) / 2),
                        r_vert=0.0070, seg_vert=8, r_horiz=0.0010)
    out.append(paint(shell, p['hide']))

    top = rounded_box('topplate', (0.0785, 0.0976, Z_DECK - Z_BODY),
                      loc=(-0.00435, 0, (Z_BODY + Z_DECK) / 2),
                      r_vert=0.0075, seg_vert=7, r_horiz=0.0012)
    # The deck INSIDE the hood is flocked black, not chrome. top.png showed a
    # 10 mm chrome margin round the ground glass, which is where a real camera
    # is at its blackest.
    out.append(lib.repaint(top, [(p['satin'], lambda c: True),
                                 (p['felt'], lambda c, n: n.z > 0.5)]))

    # The seam where the film back meets the shell, top and bottom.
    for zc in (Z_BASE + 0.0015, Z_BODY - 0.0015):
        out.append(paint(lib.box('trim_%d' % int(zc * 1e4),
                                 (0.0745, 0.0951, 0.0012),
                                 loc=(-0.00435, 0, zc), chamfer=0.0004,
                                 segments=2, smooth=True), p['satin']))

    # The film back itself, proud of the shell so its outline reads. A recessed
    # seam would need a boolean; a proud panel is the only way to draw an edge.
    door = rounded_box('door', (0.0022, 0.0870, 0.0930),
                       loc=(X_BACK - 0.0008, 0, (Z_BASE + Z_BODY) / 2 + 0.0010),
                       r_vert=0.0060, seg_vert=6, r_horiz=0.0006)
    out.append(paint(door, p['hide']))

    catch = lib.box('catch', (0.0030, 0.0070, 0.0180),
                    loc=(X_BACK - 0.0026, W_HALF - 0.0090, 0.0580),
                    chamfer=0.0010, segments=3, smooth=True)
    out.append(paint(catch, p['satin']))

    bush = disc('bush', 0.0055, 0.0055, 0.0030, 0.0, x=KNOB_X, z=0.0015,
                seg=32)
    bush.rotation_euler = (0, 0, 0)
    bush.location = (KNOB_X, 0.0, 0.0015)
    out.append(paint(bush, p['steel']))

    out += hide_panels(p)
    return out


def hide_panels(p):
    """The grained covering on the three flat faces of the shell."""
    out = []
    zc = (Z_BASE + Z_BODY) / 2 + 0.0006
    zh = (Z_BODY - Z_BASE) - 0.0055
    cell, amp = 0.0021, 0.00019
    for s, y in (('l', W_HALF), ('r', -W_HALF)):
        k = 1.0 if y > 0 else -1.0
        out.append(paint(grain_plate(
            'hide_' + s, 0.0668, zh, cell, amp,
            (-0.00435, y + 0.0002 * k, zc),
            (math.radians(-90 * k), 0, 0), seed=3 if k > 0 else 11),
            p['hide']))
    # On the back the covering goes on the film door, not the shell.
    out.append(paint(grain_plate(
        'hide_back', 0.0870, 0.0730, cell, amp,
        (X_BACK - 0.0021, 0, 0.0590), (0, math.radians(-90), 0), seed=23),
        p['hide']))
    return out


# ---------------------------------------------------------------- front panel

def front(p):
    out = []

    bezel = rounded_box('panel_bezel', (BEZEL_X - X_FRONT + 0.004, 0.0876, 0.0985),
                        loc=((X_FRONT + BEZEL_X) / 2 - 0.002, 0, 0.0595),
                        r_vert=0.0055, seg_vert=6, r_horiz=0.0009)
    out.append(paint(bezel, p['satin']))

    panel = rounded_box('panel', (PANEL_X - BEZEL_X + 0.004, 0.0828, 0.0937),
                        loc=((BEZEL_X + PANEL_X) / 2 - 0.002, 0, 0.0595),
                        r_vert=0.0045, seg_vert=6, r_horiz=0.0007)
    out.append(paint(panel, p['enamel']))

    out += lens(p, 'take', TAKE_Z, TAKE_R, 0.0055, 0.0148,
                'Zeiss Planar 2.8/80')
    out += lens(p, 'view', VIEW_Z, VIEW_R, 0.0044, 0.0132,
                'Heidosmat 2.8/80')

    # The readout slot between the lenses: aperture on the left, speed on the
    # right, both behind one chrome surround.
    # It has to clear both bezels: the first attempt was 8.6 mm tall in a
    # 6.5 mm gap and interpenetrated them both, which front.png showed at once.
    zw = (TAKE_Z + TAKE_R + VIEW_Z - VIEW_R) / 2
    out += [paint(o, p['chrome'])
            for o in frame('readout', 0.0360, 0.0058, 0.0010, 0.0020,
                           PANEL_X, 0.0, zw)]
    win = lib.box('readout_glass', (0.0011, 0.0342, 0.0040),
                  loc=(PANEL_X + 0.00055, 0, zw), chamfer=0.0002, segments=1,
                  smooth=True)
    out.append(paint(win, p['felt']))
    # Aperture window on the viewer's left of the slot, speed on the right,
    # which is how a 2.8F is laid out.
    out.append(paint(text_mesh('t_ap', '2.8', 0.0027,
                               (PANEL_X + 0.0012, -0.0084, zw), FACE_X,
                               depth=0.00010, res=3), p['ink']))
    out.append(paint(text_mesh('t_sp', '500', 0.0027,
                               (PANEL_X + 0.0012, 0.0084, zw), FACE_X,
                               depth=0.00010, res=3), p['ink']))

    # The two setting wheels, one either side of the slot.
    for s, y in (('l', 0.0292), ('r', -0.0292)):
        out.append(paint(fluted_disc('wheel_' + s, 0.0075, 0.0006, 30,
                                     y - 0.0026, y + 0.0026,
                                     x=PANEL_X - 0.0055, z=zw + 0.0006,
                                     ease=0.0004), p['satin']))

    # Shutter release, bottom right as you face the camera: a plunger in a
    # collar rather than the L-shaped tab of the first pass, which front.png
    # showed reading as an accident.
    out.append(paint(ring_x('release_collar', 0.0044, 0.0059, 0.0020,
                            PANEL_X - 0.0006, 0.0190, y=0.0300, seg=36),
                     p['steel']))
    rel = disc('release', 0.0044, 0.0040, 0.0044, 0.0, seg=32)
    rel.rotation_euler = (0, math.radians(90), 0)
    rel.location = (PANEL_X + 0.0006, 0.0300, 0.0190)
    out.append(paint(rel, p['chrome']))

    # Flash sync socket, bottom left.
    soc = disc('socket', 0.0040, 0.0036, 0.0026, 0.0, seg=28)
    soc.rotation_euler = (0, math.radians(90), 0)
    soc.location = (PANEL_X + 0.0008, -0.0300, 0.0175)
    out.append(paint(soc, p['satin']))

    return out


def lens(p, tag, z, r_out, proud, r_glass, engraving=''):
    """One lens, built as nested TUBES so you can see down the barrel.

    The first attempt stacked solid cylinders, which reads perfectly as code
    and renders as a chrome plug: the front element was buried behind the front
    cap of the barrel in front of it. Only lib.ring makes a hole."""
    out = []
    x0 = PANEL_X - 0.0020
    x_bay = x0 + 0.0050
    x_bez = x_bay + proud

    shoulder = barrel(tag + '_shoulder', r_out, r_out, 0.0050, x0, z)
    out.append(paint(shoulder, p['enamel']))

    # The bayonet flange: outermost, and the widest thing on the front.
    bay = ring_x(tag + '_bay', r_out - 0.0058, r_out, 0.0040, x_bay, z)
    out.append(paint(bay, p['chrome']))

    # The engraved rim, standing proud of the flange.
    bez = ring_x(tag + '_bezel', r_glass, r_out - 0.0058, proud, x_bay, z)
    out.append(paint(bez, p['chrome']))

    # The barrel wall behind it, so the bore is a dark tunnel and not daylight.
    throat = ring_x(tag + '_throat', r_glass - 0.0014, r_glass, 0.0100,
                    x0 - 0.0010, z)
    out.append(paint(throat, p['felt']))

    # The front element, set back inside the rim where it catches one highlight.
    apex = x_bez - 0.0026
    half = r_glass * 0.30
    el = lib.sphere(tag + '_glass', r_glass - 0.0019, subdiv=3,
                    loc=(apex - half, 0, z), scale=(0.30, 1, 1), smooth=True)
    out.append(paint(el, p['coat'] if tag == 'take' else p['glass']))

    if engraving:
        r_eng = r_out - 0.0029
        for o in text_ring(tag + '_eng', engraving, r_eng,
                           0.0026, x_bay + 0.0041, z, 132.0):
            out.append(paint(o, p['ink']))

    return out


# ---------------------------------------------------------------- the knobs

def knobs(p):
    out = []

    # Focus, camera's left (+Y): the big milled wheel with the EV dial on it.
    out.append(paint(disc('focus_boss', 0.0170, 0.0170, 0.0022, W_HALF),
                     p['satin']))
    out.append(paint(fluted_disc('focus_knurl', 0.0238, 0.0009, 60,
                                 W_HALF + 0.0022, W_HALF + 0.0052,
                                 x=KNOB_X, z=KNOB_Z), p['satin']))
    # An annulus, not a disc. As a solid disc its front face was coplanar with
    # the EV dial laid on top of it and the two z-fought, which iso_c.png
    # showed as a smeared puddle where the knob should be.
    out.append(paint(ring_y('focus_face', 0.0182, 0.0238, 0.0010,
                            W_HALF + 0.0052), p['satin']))
    out.append(paint(disc('focus_dial', 0.0180, 0.0180, 0.0006,
                          W_HALF + 0.0052), p['felt']))
    out.append(paint(disc('focus_hub', 0.0062, 0.0058, 0.0026,
                          W_HALF + 0.0054), p['chrome']))
    for i in range(12):
        a = i / 12 * TAU
        t = lib.box('fmark%d' % i, (0.0030, 0.0006, 0.0004),
                    loc=(KNOB_X + math.cos(a) * 0.0146,
                         W_HALF + 0.0060,
                         KNOB_Z + math.sin(a) * 0.0146),
                    rot=(math.radians(90), a, 0), smooth=True)
        out.append(paint(t, p['ink']))

    # Wind crank, camera's right (-Y). Built as a raised rim around a sunken
    # floor so the arm sits IN the plate: side.png showed the flat-disc version
    # reading as a doorknob, and a recess is the thing that fixes it. With no
    # boolean the recess is a ring standing on a disc.
    # fluted_disc is a lofted SOLID with capped ends, so the first version of
    # this — knurled ring in front, arm behind it — hid the entire crank behind
    # the knurl's own end cap, which side.png showed as a blank milled disc.
    # The knurled body has to be the base and the lip the thing in front of it.
    out.append(paint(fluted_disc('crank_knurl', 0.0216, 0.0007, 54,
                                 -W_HALF - 0.0052, -W_HALF,
                                 x=KNOB_X, z=KNOB_Z, ease=0.0005),
                     p['satin']))
    out.append(paint(ring_y('crank_lip', 0.0178, 0.0214, 0.0030,
                            -W_HALF - 0.0052), p['satin']))
    out.append(paint(disc('crank_hub', 0.0060, 0.0056, 0.0026,
                          -W_HALF - 0.0054), p['chrome']))
    aa = math.radians(-38)
    arm_l = 0.0244
    cx = KNOB_X + math.cos(aa) * arm_l / 2
    cz = KNOB_Z + math.sin(aa) * arm_l / 2
    arm = lib.box('crank_arm', (arm_l, 0.0022, 0.0054),
                  loc=(cx, -W_HALF - 0.0063, cz),
                  rot=(0, -aa, 0), chamfer=0.0007, segments=3, smooth=True)
    out.append(paint(arm, p['chrome']))
    tipx = KNOB_X + math.cos(aa) * arm_l
    tipz = KNOB_Z + math.sin(aa) * arm_l
    out.append(paint(fluted_disc('crank_knob', 0.0042, 0.0004, 20,
                                 -W_HALF - 0.0110, -W_HALF - 0.0056,
                                 x=tipx, z=tipz, ease=0.0006), p['satin']))
    out.append(paint(disc('crank_cap', 0.0042, 0.0036, 0.0008,
                          -W_HALF - 0.0118, x=tipx, z=tipz, seg=28),
                     p['chrome']))

    # Exposure counter, above the crank.
    out.append(paint(disc('counter', 0.0068, 0.0068, 0.0018,
                          -W_HALF - 0.0018, x=-0.0180, z=0.0900, seg=40),
                     p['satin']))
    out.append(paint(disc('counter_win', 0.0050, 0.0050, 0.0006,
                          -W_HALF - 0.0032, x=-0.0180, z=0.0900, seg=32),
                     p['felt']))

    # Strap lugs.
    for s, y in (('l', W_HALF), ('r', -W_HALF)):
        k = 1.0 if y > 0 else -1.0
        out.append(paint(lib.box('lug_' + s, (0.0090, 0.0030, 0.0058),
                                 loc=(0.0080, y + 0.0015 * k, 0.0980),
                                 chamfer=0.0010, segments=3, smooth=True),
                         p['satin']))
    return out


# ---------------------------------------------------------------- finder hood

def hood(p):
    out = []
    t = 0.0008
    y_out = 0.0435
    x_f, x_r = 0.0332, -0.0424

    # The rim standing on the deck: it is what makes the ground glass sit in a
    # recess rather than on a shelf, which is the only way to get a recess
    # without a boolean.
    out += [paint(o, p['satin'])
            for o in frame_z('rim', x_f - x_r + 2 * t, 2 * (y_out + t), 0.0042,
                             Z_TOP - Z_DECK, Z_DECK,
                             x=(x_f + x_r) / 2, y=0.0)]

    scr = lib.box('screen', (0.0600, 0.0600, 0.0014),
                  loc=((x_f + x_r) / 2, 0, Z_DECK + 0.0007),
                  chamfer=0.0003, smooth=False)
    out.append(paint(scr, p['screen']))

    # The flaps. Their INNER faces are flock black on a real camera and were
    # rendering as polished silver here, because one glossy material on a
    # single-thickness sheet mirrors the sky off the inside as happily as the
    # outside. lib.repaint with a normal test is the fix.
    def sheet(o, inward):
        return lib.repaint(o, [(p['hoodpaint'], lambda c: True),
                               (p['felt'], inward)])

    # Both hinged flaps lean IN at the top. A hood whose four leaves are dead
    # vertical reads as an open carton, which is exactly what iso_a.png showed;
    # three degrees of taper is what makes it a folding finder.
    lean = math.radians(3.2)
    hr = Z_HOOD - Z_TOP
    rear = lib.box('flap_rear', (t, 2 * y_out, hr),
                   loc=(x_r + t / 2 + hr / 2 * math.sin(lean), 0,
                        Z_TOP + hr / 2 * math.cos(lean)),
                   rot=(0, lean, 0),
                   chamfer=0.00035, segments=2, smooth=True)
    out.append(sheet(rear, lambda c, n: n.x > 0.5))

    z_front = Z_TOP + 0.0355
    hf = z_front - Z_TOP
    frnt = lib.box('flap_front', (t, 2 * y_out, hf),
                   loc=(x_f - t / 2 - hf / 2 * math.sin(lean), 0,
                        Z_TOP + hf / 2 * math.cos(lean)),
                   rot=(0, -lean, 0),
                   chamfer=0.00035, segments=2, smooth=True)
    out.append(sheet(frnt, lambda c, n: n.x < -0.5))
    x_r_top = x_r + t / 2 + hr * math.sin(lean)
    x_f_top = x_f - t / 2 - hf * math.sin(lean)
    z_front = Z_TOP + hf * math.cos(lean)

    # The rolled lip along the top of each hinged flap. Sheet steel this thin
    # is always turned over at the edge, and the highlight it catches is most
    # of what says "pressed metal" rather than "extruded slab".
    z_rear = Z_TOP + hr * math.cos(lean)
    out.append(paint(lib.cyl('lip_rear', t * 0.9, t * 0.9, 2 * y_out,
                             loc=(x_r_top, 0, z_rear),
                             rot=(math.radians(90), 0, 0), segments=10),
                     p['hoodpaint']))
    out.append(paint(lib.cyl('lip_front', t * 0.9, t * 0.9, 2 * y_out,
                             loc=(x_f_top, 0, z_front),
                             rot=(math.radians(90), 0, 0), segments=10),
                     p['hoodpaint']))

    # Side flaps: trapezoids with a STRAIGHT sloping top, pulled back from both
    # corners so the hood reads as four separate hinged leaves instead of the
    # sealed carton the first pass produced.
    gap = 0.0009
    poly = [(x_r + t + gap, Z_TOP),
            (x_f - t - gap, Z_TOP),
            (x_f_top - gap, z_front - 0.0030),
            (x_r_top + gap, z_rear - 0.0050)]
    for s, y in (('l', y_out), ('r', -y_out)):
        k = 1.0 if y > 0 else -1.0
        fl = plate_xz('flap_' + s, poly, y - t * k, y)
        out.append(lib.repaint(fl, [(p['hoodpaint'], lambda c: True),
                                    (p['felt'],
                                     (lambda c, n, k=k: n.y * k < -0.5))]))

    # Magnifier, stowed flat against the (now leaning) rear flap.
    dm = hr - 0.0210
    mx = x_r + t / 2 + dm * math.sin(lean) + 0.0012 * math.cos(lean)
    mz = Z_TOP + dm * math.cos(lean)
    mag = lib.box('mag_plate', (0.0010, 0.0290, 0.0330),
                  loc=(mx, 0, mz), rot=(0, lean, 0),
                  chamfer=0.0004, segments=2, smooth=True)
    out.append(paint(mag, p['satin']))
    for nm, mat, r_in, r_out, w, off in (
            ('mag_glass', p['glass'], 0.0, 0.0110, 0.0012, 0.0007),
            ('mag_ring', p['chrome'], 0.0110, 0.0126, 0.0016, 0.0005)):
        if r_in:
            o = ring_x(nm, r_in, r_out, w, 0.0, 0.0, seg=40)
        else:
            o = barrel(nm, r_out, r_out, w, 0.0, 0.0, seg=40)
        # ring_x/barrel already carry a 90-degree turn to stand the disc up.
        # Assigning rotation_euler here replaces it rather than adding to it,
        # which laid the magnifier flat and pushed it out through the flap.
        o.rotation_euler = (0, math.radians(90) + lean, 0)
        o.location = (mx + (off + w / 2) * math.cos(lean), 0,
                      mz - (off + w / 2) * math.sin(lean))
        out.append(paint(o, mat))

    # Sports-finder cut-out in the front flap, faked as a proud frame because
    # there is no boolean to cut one.
    # frame() lays its four bars in one plane at a fixed x. The flap is no
    # longer vertical, so the square has to be built on the flap's own axes or
    # the bottom bar sinks inside it — which is exactly what front.png showed
    # after the lean went in.
    ds, sw, bar, sth = 0.0230, 0.0230, 0.0018, 0.0010
    ux, uz = -math.sin(lean), math.cos(lean)          # up, along the flap
    nx, nz = math.cos(lean), math.sin(lean)           # out of the flap
    ox = x_f - t / 2 + ds * ux + (t / 2 + sth / 2) * nx
    oz = Z_TOP + ds * uz + (t / 2 + sth / 2) * nz
    for i, (bw, bh, dy, dv) in enumerate((
            (sw, bar, 0.0, sw / 2 - bar / 2),
            (sw, bar, 0.0, -(sw / 2 - bar / 2)),
            (bar, sw - 2 * bar, sw / 2 - bar / 2, 0.0),
            (bar, sw - 2 * bar, -(sw / 2 - bar / 2), 0.0))):
        out.append(paint(lib.box('sport_%d' % i, (sth, bw, bh),
                                 loc=(ox + dv * ux, dy, oz + dv * uz),
                                 rot=(0, -lean, 0), chamfer=0.0003,
                                 segments=2, smooth=True), p['satin']))

    return out


# ---------------------------------------------------------------- nameplate

def nameplate(p):
    out = []
    x0 = 0.0347
    zc = (Z_BODY + Z_DECK) / 2
    plate = lib.box('nameplate', (0.0016, 0.0480, 0.0082),
                    loc=(x0 + 0.0008, 0, zc),
                    chamfer=0.0005, segments=3, smooth=True)
    out.append(paint(plate, p['satin']))
    out.append(paint(text_mesh('name', 'Rolleiflex', 0.0046,
                               (x0 + 0.0017, 0, zc), FACE_X,
                               depth=0.00016, res=4), p['ink']))
    return out


# ---------------------------------------------------------------- assemble

def main():
    lib.reset()
    p = palette()
    parts = body(p) + front(p) + knobs(p) + hood(p) + nameplate(p)
    if os.environ.get('ART_DEBUG'):
        # matrix_world is stale until the depsgraph runs, so the most recently
        # created object reports as sitting at the origin without this.
        bpy.context.view_layer.update()
        for o in parts:
            zs = [(o.matrix_world @ v.co).z for v in o.data.vertices]
            ys = [(o.matrix_world @ v.co).y for v in o.data.vertices]
            xs = [(o.matrix_world @ v.co).x for v in o.data.vertices]
            print('PART %-18s x %+.4f..%+.4f  y %+.4f..%+.4f  z %+.4f..%+.4f'
                  % (o.name, min(xs), max(xs), min(ys), max(ys),
                     min(zs), max(zs)))
    root = lib.part('tlr')
    lib.merge_into('tlr_body', parts, root)

    name = (sys.argv[sys.argv.index('--') + 1:] or ['tlr'])[0]
    report = []
    lib.export(name, report)
    lib.summarise(report)


main()
