# Generate a kit of stylised rock pieces with deliberate planar faceting, export each
# as GLB and render a contact sheet lit by a low warm key and a cool fill.
#
#   blender --background --python rock_kit.py -- --out DIR [--kind boulder|slab|column|spire|cliff]
#           [--count 4] [--seed 1] [--cuts 9] [--size 4] [--sheet]
#
# The shapes come from a few large plane cuts (no noise displacement), coplanar faces are
# merged, edges get a thin bevel to catch rim light and normals are split at 25 degrees.
# Fine detail belongs in the game's material (triplanar texture, strata, edge wear).
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Vector, Matrix


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = {'out': None, 'kind': 'boulder', 'count': 4, 'seed': 1, 'cuts': 9, 'size': 4.0, 'sheet': False}
    i = 0
    while i < len(a):
        k = a[i].lstrip('-')
        if k == 'sheet':
            o['sheet'] = True
            i += 1
            continue
        o[k] = a[i + 1]
        i += 2
    if not o['out']:
        raise SystemExit('usage: rock_kit.py -- --out DIR [--kind boulder|slab|column|spire|cliff] [--count N] [--seed S] [--cuts N] [--size M] [--sheet]')
    o['count'], o['seed'], o['cuts'], o['size'] = int(o['count']), int(o['seed']), int(o['cuts']), float(o['size'])
    return o


def chip(bm, rng, cuts, extent):
    # Each cut removes everything beyond a random plane that clips one side or corner.
    for _ in range(cuts):
        n = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.7, 1))).normalized()
        reach = max((v.co.dot(n) for v in bm.verts), default=0)
        depth = rng.uniform(0.12, 0.32) * extent
        co = n * (reach - depth)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=n, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.edgeloop_fill(bm, edges=edges)
        bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)


def hull(bm, rng, sx, sy, sz, points=18, offset=Vector()):
    # Convex hull of random points inside an ellipsoid: irregular, naturally faceted.
    tmp = bmesh.new()
    for _ in range(points):
        while True:
            p = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
            if p.length <= 1:
                break
        p = p.normalized() * (0.75 + 0.25 * p.length)
        tmp.verts.new(Vector((p.x * sx / 2, p.y * sy / 2, p.z * sz / 2)) + offset)
    bmesh.ops.convex_hull(tmp, input=tmp.verts[:])
    mesh = bpy.data.meshes.new('tmp')
    tmp.to_mesh(mesh)
    tmp.free()
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)


def block(bm, sx, sy, sz, offset=Vector()):
    m = Matrix.Translation(offset) @ Matrix.Diagonal((sx, sy, sz, 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def prism(bm, radius, height, sides, offset):
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=radius, radius2=radius * 0.97,
                              depth=height, matrix=Matrix.Translation(offset + Vector((0, 0, height / 2))))
    return r


def build(kind, rng, cuts, size):
    bm = bmesh.new()
    if kind == 'boulder':
        hull(bm, rng, size * rng.uniform(0.9, 1.3), size * rng.uniform(0.7, 1.0), size * rng.uniform(0.6, 0.9), points=rng.randint(14, 22))
        chip(bm, rng, max(2, cuts // 3), size)
    elif kind == 'slab':
        hull(bm, rng, size * 1.7, size * rng.uniform(0.9, 1.2), size * rng.uniform(0.35, 0.5), points=rng.randint(16, 24))
        chip(bm, rng, max(2, cuts // 3), size)
    elif kind == 'spire':
        hull(bm, rng, size * 0.8, size * 0.7, size * rng.uniform(2.4, 3.2), points=rng.randint(16, 24), offset=Vector((0, 0, size)))
        chip(bm, rng, max(3, cuts // 2), size * 0.8)
    elif kind == 'cliff':
        # Stacked shelves of differing depth: strata read as a fractured cliff face.
        z = 0.0
        for _ in range(rng.randint(3, 5)):
            h = size * rng.uniform(0.45, 0.8)
            hull(bm, rng, size * rng.uniform(1.6, 2.4), size * rng.uniform(0.9, 1.4), h, points=rng.randint(12, 18),
                 offset=Vector((rng.uniform(-0.25, 0.25) * size, rng.uniform(-0.2, 0.2) * size, z + h / 2)))
            z += h * 0.5
    elif kind == 'column':
        # Basalt cluster: hexagonal prisms of differing heights with slanted, chipped tops.
        for i in range(rng.randint(5, 8)):
            ang = i * 2.4
            rad = 0 if i == 0 else size * 0.33 * math.sqrt(i)
            off = Vector((math.cos(ang) * rad, math.sin(ang) * rad, rng.uniform(-0.3, 0.3) * size))
            h = size * rng.uniform(1.4, 2.8)
            sub = bmesh.new()
            prism(sub, size * rng.uniform(0.28, 0.36), h, 6, off)
            n = Vector((rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), 1)).normalized()
            top = max(v.co.z for v in sub.verts)
            res = bmesh.ops.bisect_plane(sub, geom=sub.verts[:] + sub.edges[:] + sub.faces[:],
                                         plane_co=Vector((off.x, off.y, top - rng.uniform(0.05, 0.3) * size)),
                                         plane_no=n, clear_outer=True)
            edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
            if edges:
                bmesh.ops.edgeloop_fill(sub, edges=edges)
            mesh = bpy.data.meshes.new('tmp')
            sub.to_mesh(mesh)
            sub.free()
            bm.from_mesh(mesh)
            bpy.data.meshes.remove(mesh)
    else:
        raise SystemExit(f'unknown kind {kind}')
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(6), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def make_object(name, bm, size):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bev = obj.modifiers.new('bevel', 'BEVEL')
    bev.width = size * 0.008
    bev.segments = 1
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(40)
    bpy.ops.object.modifier_apply(modifier='bevel')
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(25))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    mat = bpy.data.materials.get('rock') or bpy.data.materials.new('rock')
    mat.diffuse_color = (0.16, 0.15, 0.15, 1)
    bsdf = mat.node_tree.nodes.get('Principled BSDF') if mat.node_tree else None
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (0.16, 0.15, 0.15, 1)
        bsdf.inputs['Roughness'].default_value = 0.85
    obj.data.materials.append(mat)
    obj.select_set(False)
    return obj


def export(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_apply=True)
    obj.select_set(False)


def render_sheet(objs, path, size):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'CYCLES'
    if sc.render.engine == 'CYCLES':
        sc.cycles.samples = 32
    sc.render.resolution_x, sc.render.resolution_y = 1600, 520
    sc.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.18, 0.2, 0.3, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    sc.world = world
    spacing = size * 2.6
    for i, o in enumerate(objs):
        o.location = Vector(((i - (len(objs) - 1) / 2) * spacing, 0, 0))
    sun = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
    sun.data.energy = 4.0
    sun.data.color = (1.0, 0.62, 0.32)
    sun.rotation_euler = (math.radians(70), 0, math.radians(-60))
    bpy.context.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    bpy.context.view_layer.update()
    zs = [(o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box]
    zmid, zspan = (max(zs) + min(zs)) / 2, max(zs) - min(zs)
    cam.data.ortho_scale = max(spacing * len(objs) * 1.05, zspan * 1600 / 520 * 1.15)
    cam.location = (0, -size * 12, zmid + size * 12 * math.tan(math.radians(15)))
    cam.rotation_euler = (math.radians(75), 0, 0)
    bpy.context.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    o = args()
    os.makedirs(o['out'], exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(o['seed'])
    objs = []
    for i in range(o['count']):
        name = f"{o['kind']}_{i:02d}"
        obj = make_object(name, build(o['kind'], rng, o['cuts'], o['size']), o['size'])
        export(obj, os.path.join(o['out'], name + '.glb'))
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        print(f'{name}: {tris} triangles, {len(obj.data.polygons)} faces')
        objs.append(obj)
    if o['sheet']:
        render_sheet(objs, os.path.join(o['out'], f"{o['kind']}-sheet.png"), o['size'])
        print('sheet:', os.path.join(o['out'], f"{o['kind']}-sheet.png"))


main()
