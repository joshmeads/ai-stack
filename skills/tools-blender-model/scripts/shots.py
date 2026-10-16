# Renders the exported glb from the angles that decide whether a model works.
#
#   blender --background --python shots.py -- <model-name>
#
# Writes a contact sheet to cfg.SHOTS/<model-name>/:
#
#   iso_a..d.png        the app's own projection, at four object headings
#   iso_clean.png       the same, without the grid and the scale figure
#   silhouette.png      flat black on white
#   iso_<n>px[_xN].png  rendered at the real pixels-per-metre, upscaled
#   front/side/top.png  orthographic
#   three_quarter.png   perspective
#
# It renders the exported file rather than the live Blender scene deliberately:
# the axis convention only goes wrong at export, so rendering the scene would
# hide that class of fault entirely.
import bpy
import bmesh
import sys
import os
import math
import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(HERE)
import artconfig as cfg     # noqa: E402
import lib                  # noqa: E402


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_render():
    sc = bpy.context.scene
    # The engine identifier has changed across Blender versions and a wrong one
    # is a hard error at frame zero, so ask what is available.
    avail = [i.identifier for i in
             sc.render.bl_rna.properties['engine'].enum_items]
    for cand in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH'):
        if cand in avail:
            sc.render.engine = cand
            break
    print('ENGINE', sc.render.engine, '/ available:', ','.join(avail))
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    # Standard, not AgX. Real-time engines default to no tone mapping, so AgX
    # would show a desaturated model the app will never draw.
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    try:
        sc.eevee.taa_render_samples = 24
    except AttributeError:
        pass


def world_colour(hex_value, strength=0.85, name='shotworld'):
    # read_factory_settings(use_empty=True) leaves scene.world as None.
    #
    # `name` exists so a caller that needs a different sky temporarily gets its
    # own datablock. Reusing one and recolouring it would mutate the sky every
    # other shot is rendered against, and putting the original back on the
    # scene afterwards would not undo it.
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    bpy.context.scene.world = w
    if bpy.app.version < (5, 0, 0):
        w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = lib.srgb(hex_value)
    bg.inputs['Strength'].default_value = strength
    return w


def sun():
    """Aimed at the origin from cfg.SUN_FROM, which should match the app's key
    light — otherwise judgements about which panel catches the light are about
    a scene that does not exist."""
    d = bpy.data.lights.new('sun', type='SUN')
    d.energy = cfg.SUN_ENERGY
    d.color = lib.srgb(cfg.SUN)[:3]
    d.angle = math.radians(3.0)
    o = bpy.data.objects.new('sun', d)
    v = mathutils.Vector((0, 0, 0)) - mathutils.Vector(cfg.SUN_FROM)
    o.rotation_euler = v.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.collection.objects.link(o)
    return o


def ground(size=120):
    """The surface the model stands on. A model floating in empty sky hides
    whether it sits on the ground correctly."""
    mesh = bpy.data.meshes.new('ground')
    obj = bpy.data.objects.new('ground', mesh)
    bpy.context.collection.objects.link(obj)
    mesh.from_pydata([(-size, -size, 0), (size, -size, 0),
                      (size, size, 0), (-size, size, 0)], [], [(0, 1, 2, 3)])
    obj.data.materials.append(lib.hexmat('_ground', cfg.GROUND, rough=0.95))
    return obj


def checker_grid(half=None, z=0.004):
    """A checker at GRID_STEP with the GRID_MAJOR boundaries drawn over it.

    Real quads, not loose edges: EEVEE does not render loose edges at all, so
    an edge-based ruler is invisible in every shot it appears in."""
    step = cfg.GRID_STEP
    major = cfg.GRID_MAJOR
    half = half or step * 9
    mesh = bpy.data.meshes.new('grid')
    obj = bpy.data.objects.new('grid', mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    n = max(1, int(half / step))
    dark = []
    for i in range(-n, n):
        for j in range(-n, n):
            x0, y0 = i * step, j * step
            bm.faces.new([bm.verts.new((x0, y0, z)),
                          bm.verts.new((x0 + step, y0, z)),
                          bm.verts.new((x0 + step, y0 + step, z)),
                          bm.verts.new((x0, y0 + step, z))])
            dark.append((i + j) % 2 == 0)
    nsq = len(dark)
    w = step * 0.05
    m = max(1, int(half / major))
    for k in range(-m, m + 1):
        p = k * major
        for (ax, ay), (bx, by) in (((-half, p - w), (half, p + w)),
                                   ((p - w, -half), (p + w, half))):
            bm.faces.new([bm.verts.new((ax, ay, z + 0.002)),
                          bm.verts.new((bx, ay, z + 0.002)),
                          bm.verts.new((bx, by, z + 0.002)),
                          bm.verts.new((ax, by, z + 0.002))])
    bm.to_mesh(mesh)
    bm.free()
    for nm, hexv in (('_grid_a', cfg.GROUND), ('_grid_b', cfg.GROUND_ALT),
                     ('_grid_line', cfg.GRID_LINE)):
        obj.data.materials.append(lib.hexmat(nm, hexv, rough=0.95))
    for i, p in enumerate(mesh.polygons):
        p.material_index = 2 if i >= nsq else (1 if dark[i] else 0)
        p.use_smooth = False
    return obj


def scale_figure(at=(0, 0, 0)):
    """A person of cfg.FIGURE_H, in parts that sum to exactly that. Proportions
    are fractions of total height, so it stays correct at any scale."""
    h = cfg.FIGURE_H
    parts = [
        (0.206, 0.114, 0.491, 0.246),   # legs
        (0.251, 0.137, 0.297, 0.640),   # torso
        (0.114, 0.114, 0.137, 0.857),   # head
    ]
    objs = []
    m = lib.hexmat('_figure', cfg.FIGURE, rough=0.9)
    for i, (w, d, ph, cz) in enumerate(parts):
        me = bpy.data.meshes.new('fig%d' % i)
        ob = bpy.data.objects.new('fig%d' % i, me)
        bpy.context.collection.objects.link(ob)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x = v.co.x * w * h + at[0]
            v.co.y = v.co.y * d * h + at[1]
            v.co.z = v.co.z * ph * h + cz * h + at[2]
        bm.to_mesh(me)
        bm.free()
        ob.data.materials.append(m)
        for p in me.polygons:
            p.use_smooth = False
        objs.append(ob)
    return objs


def load_glb(name):
    path = os.path.join(cfg.OUT, name + '.glb')
    if not os.path.exists(path):
        raise SystemExit('no such model: ' + path)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o not in before]


def bounds(objs):
    """The true world-space extent, measured from the vertices.

    Not from `bound_box`: that is the object's *local* axis-aligned box, and
    transforming its eight corners through a rotation gives the box around the
    rotated box, which is larger than the box around the mesh. A group whose
    first member happens to sit on a bearing then over-reports — enough to
    print the wrong dimensions and to frame every shot zoomed out to fit a
    model that is not there."""
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in objs:
        if o.type != 'MESH':
            continue
        m = o.matrix_world
        for v in o.data.vertices:
            w = m @ v.co
            for i in range(3):
                if w[i] < lo[i]:
                    lo[i] = w[i]
                if w[i] > hi[i]:
                    hi[i] = w[i]
    return lo, hi


def triangles(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons)
               for o in objs if o.type == 'MESH')


def camera(loc, look, lens=45, ortho=None):
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    cam.clip_start = 0.05
    cam.clip_end = 5000
    if ortho:
        cam.type = 'ORTHO'
        cam.ortho_scale = ortho
    ob = bpy.data.objects.new('cam', cam)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    # Derive the rotation from the look vector rather than composing an Euler
    # by hand, which is easy to get subtly and invisibly wrong.
    d = mathutils.Vector(look) - mathutils.Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return ob


def hero_camera(target, ortho, azimuth_deg, distance):
    """The app's camera.

    A Y-up engine builds its offset as (cos el * sin az, sin el, cos el * cos
    az). glTF +Z is Blender -Y, so the same unit vector here is
    (cos el * sin az, -cos el * cos az, sin el)."""
    el = math.radians(cfg.HERO_ELEVATION_DEG)
    az = math.radians(azimuth_deg)
    off = mathutils.Vector((math.cos(el) * math.sin(az),
                            -math.cos(el) * math.cos(az),
                            math.sin(el)))
    loc = mathutils.Vector(target) + off * distance
    if cfg.HERO_ORTHOGRAPHIC:
        return camera(loc, target, ortho=ortho)
    return camera(loc, target, lens=cfg.HERO_LENS)


def hero_extent(lo, hi):
    """How much of the frame the model needs at the hero angle. Both plan axes
    foreshorten by 1/sqrt(2) at 45 degrees and height comes in at cos(el);
    framing off the raw bounding box instead wastes about a third of the
    frame."""
    el = math.radians(cfg.HERO_ELEVATION_DEG)
    plan = (hi[0] - lo[0] + hi[1] - lo[1]) / math.sqrt(2.0)
    vert = plan * math.sin(el) + (hi[2] - lo[2]) * math.cos(el)
    return plan, vert


def render(out, res=None, res_y=None):
    sc = bpy.context.scene
    sc.render.resolution_x = res or cfg.RES
    sc.render.resolution_y = res_y or res or cfg.RES
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('SHOT', out, '%dx%d' % (sc.render.resolution_x, sc.render.resolution_y))


def upscale(src, dst, factor):
    """Nearest-neighbour blow-up of a small render so it can be looked at. It
    adds no detail — every block is one real pixel of the render."""
    import numpy as np
    img = bpy.data.images.load(src)
    img.colorspace_settings.name = 'Non-Color'   # raw round trip, no double gamma
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    big = np.repeat(np.repeat(buf.reshape(h, w, 4), factor, axis=0), factor, axis=1)
    out = bpy.data.images.new('up', w * factor, h * factor, alpha=True)
    out.colorspace_settings.name = 'Non-Color'
    out.pixels.foreach_set(big.ravel())
    out.filepath_raw = dst
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(img)
    bpy.data.images.remove(out)
    print('SHOT', dst, '(x%d nearest of %dx%d)' % (factor, w, h))


def show(objs, on):
    for o in objs:
        o.hide_render = not on


class Silhouette:
    """Swap every material for flat black against a white world, restoring them
    on exit.

    Emission rather than a black diffuse: diffuse still picks up a specular
    highlight off the white world, which softens the one outline whose entire
    job is to be hard."""

    def __init__(self, objs):
        self.objs = [o for o in objs if o.type == 'MESH']
        self.stash = []

    def __enter__(self):
        m = bpy.data.materials.get('_silhouette')
        if not m:
            m = bpy.data.materials.new('_silhouette')
            if bpy.app.version < (5, 0, 0):
                m.use_nodes = True
            nt = m.node_tree
            for n in list(nt.nodes):
                if n.type != 'OUTPUT_MATERIAL':
                    nt.nodes.remove(n)
            out = nt.nodes['Material Output']
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = (0, 0, 0, 1)
            em.inputs['Strength'].default_value = 1.0
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        for o in self.objs:
            # Emptying the slot list zeroes every polygon's material_index, and
            # refilling it does not put them back — so the per-face assignments
            # have to be stashed alongside the slots or every multi-material
            # object comes out of here painted entirely in its first material,
            # for every shot rendered after this one.
            self.stash.append((o, list(o.data.materials),
                               [p.material_index for p in o.data.polygons]))
            o.data.materials.clear()
            o.data.materials.append(m)
        self.world = bpy.context.scene.world
        world_colour(0xFFFFFF, strength=1.0, name='shotworld_silhouette')
        return self

    def __exit__(self, *exc):
        for o, mats, indices in self.stash:
            o.data.materials.clear()
            for m in mats:
                o.data.materials.append(m)
            for p, i in zip(o.data.polygons, indices):
                p.material_index = i
        bpy.context.scene.world = self.world
        return False


def main():
    args = argv()
    if not args:
        raise SystemExit('usage: shots.py -- <model-name>')
    name = args[0]

    clear()
    setup_render()
    world_colour(cfg.SKY)
    sun()
    model = load_glb(name)
    lo, hi = bounds(model)
    ex, ey, ez = hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]
    cx, cy, cz = ((lo[i] + hi[i]) / 2 for i in range(3))
    tris = triangles(model)

    print('BOUNDS  %.3f long (x) x %.3f wide (y) x %.3f tall (z)' % (ex, ey, ez))
    print('        x %+.3f..%+.3f   y %+.3f..%+.3f   z %+.3f..%+.3f'
          % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    print('        %.2f x %.2f major grid squares at %.2f'
          % (ex / cfg.GRID_MAJOR, ey / cfg.GRID_MAJOR, cfg.GRID_MAJOR))
    print('        %.2f times the height of a %.2f figure'
          % (ez / cfg.FIGURE_H, cfg.FIGURE_H))
    print('TRIS    %d' % tris)
    if lo[2] < -0.02 * cfg.UNITS_PER_M:
        print('WARNING model is SUNK %.3f below z=0' % lo[2])
    if lo[2] > 0.05 * cfg.UNITS_PER_M:
        print('WARNING model FLOATS %.3f above z=0' % lo[2])

    g = ground()
    grid = checker_grid()
    # Ahead of the model, not beside it: the side camera looks along -Y, so a
    # figure offset in Y stands in front of the lens and hides the profile it
    # is there to measure.
    fig = scale_figure(at=(hi[0] + cfg.FIGURE_H * 0.45, cy, 0))
    size = max(ex, ey, ez)

    out = os.path.join(cfg.SHOTS, name)
    plan, vert = hero_extent(lo, hi)
    hero_ortho = max(plan, vert) * 1.15
    dist = getattr(cfg, 'HERO_DISTANCE', None)
    if dist is None:
        # Clear the geometry, but never so far that a small object under a
        # perspective camera renders as a speck.
        dist = max(size * 6.0, 4.0 * cfg.FIGURE_H)
    focus = (cx, cy, lo[2] + ez * 0.45)

    # ---- the hero set: the app's projection, four object headings ----
    show([grid], True)
    show(fig, True)
    for tag, az in zip('abcd', cfg.HERO_HEADINGS):
        hero_camera(focus, hero_ortho, cfg.HERO_AZIMUTH_DEG + az, dist)
        render(os.path.join(out, 'iso_%s.png' % tag))

    show([grid], False)
    show(fig, False)
    hero_camera(focus, hero_ortho, cfg.HERO_AZIMUTH_DEG, dist)
    render(os.path.join(out, 'iso_clean.png'))

    # ---- flat black: shape only, nothing to hide behind ----
    show([g], False)
    with Silhouette(model):
        hero_camera(focus, hero_ortho, cfg.HERO_AZIMUTH_DEG, dist)
        render(os.path.join(out, 'silhouette.png'))
    show([g], True)

    # ---- the same shot at the size the object is actually seen at ----
    # ortho_scale is the width of the view in metres, so res / ortho is exactly
    # pixels per metre.
    for tag, ppm, factor in cfg.SMALL_RENDERS:
        res = max(16, int(round(max(plan, vert) * 1.25 * ppm)))
        hero_camera(focus, res / ppm, cfg.HERO_AZIMUTH_DEG, dist)
        small = os.path.join(out, 'iso_%s.png' % tag)
        render(small, res)
        upscale(small, os.path.join(out, 'iso_%s_x%d.png' % (tag, factor)), factor)

    # ---- orthographic set: whether the shape is right ----
    show([grid], True)
    show(fig, True)
    d = max(size * 4, 10.0)

    camera((cx, cy - d, cz), (cx, cy, cz), ortho=max(ex, ez) * 1.45)
    render(os.path.join(out, 'side.png'))

    # The figure stands ahead of the model, straight down the barrel of the
    # front camera, so it is hidden for this one shot.
    show(fig, False)
    camera((cx + d, cy, cz), (cx, cy, cz), ortho=max(ey, ez) * 1.2)
    render(os.path.join(out, 'front.png'))
    show(fig, True)

    camera((cx, cy, cz + d), (cx, cy, cz), ortho=max(ex, ey) * 1.2)
    render(os.path.join(out, 'top.png'))

    # Perspective. Not a decision-making shot if the app has no perspective
    # camera, but the easiest place to see a bad join.
    camera((cx + size * 1.5, cy - size * 1.5, cz + size * 1.1),
           (cx, cy, cz * 0.85), lens=55)
    render(os.path.join(out, 'three_quarter.png'))

    print('BOUNDS  %.3f x %.3f x %.3f    TRIS %d' % (ex, ey, ez, tris))
    print('SHEET   %s' % out)


# Guarded so the module can be imported — by a test, or by a project that wants
# the camera and lighting helpers with a different shot list. Blender's
# --python runs a script as __main__, so the CLI behaviour is unchanged.
if __name__ == '__main__':
    main()
