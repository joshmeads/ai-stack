# Box modelling: one mesh, grown.
#
# The name is the starting point, not the ceiling. You begin with a single cube
# and pull the form out of it — extrude a face to make a limb, inset before
# extruding so the limb has a shoulder rather than a stump, loop cut where the
# form needs to bend, bevel the edges that catch the light. The surface stays
# connected throughout, so the silhouette is one line rather than a stack of
# intersecting solids, and triangles go into shape rather than into geometry
# buried inside other geometry.
#
# Not everything is a grown form. Anything whose cross-section is known at
# every station — a hull, a pipe, a handrail — is a loft or a sweep. Use
# lib.loft() and lib.profile() for those.
import bpy
import bmesh
import math
from mathutils import Vector, Matrix

import artconfig as cfg

DIRS = {
    '+x': (1, 0, 0), '-x': (-1, 0, 0),
    '+y': (0, 1, 0), '-y': (0, -1, 0),
    '+z': (0, 0, 1), '-z': (0, 0, -1),
}


class Form:
    """One mesh, grown.

    Faces are selected by where they point and where they are, so build scripts
    read as "take the face on the outside of the chest and pull an arm out of
    it" rather than as a list of hard-coded coordinates."""

    def __init__(self, size=(1, 1, 1), at=(0, 0, 0)):
        self.bm = bmesh.new()
        bmesh.ops.create_cube(self.bm, size=1.0)
        # `size` is the full extent, matching lib.box() — not the half extent
        # bmesh.ops.create_cube takes.
        for v in self.bm.verts:
            v.co.x = v.co.x * size[0] + at[0]
            v.co.y = v.co.y * size[1] + at[1]
            v.co.z = v.co.z * size[2] + at[2]
        self._smooth = cfg.SMOOTH_DEFAULT

    # ------------------------------------------------------------ selection

    def faces(self, normal=None, above=None, below=None,
              xmin=None, xmax=None, ymin=None, ymax=None, tol=0.5):
        out = []
        # Raise rather than fall through. An unrecognised direction name would
        # otherwise disable the filter and silently match every face in the
        # mesh, which looks like a modelling mistake rather than a typo.
        if normal is not None and normal not in DIRS:
            raise KeyError('unknown face direction %r; expected one of %s'
                           % (normal, ', '.join(sorted(DIRS))))
        want = DIRS.get(normal) if normal else None
        for f in self.bm.faces:
            if want:
                n = f.normal
                if n.x * want[0] + n.y * want[1] + n.z * want[2] < tol:
                    continue
            c = f.calc_center_median()
            if above is not None and c.z < above: continue
            if below is not None and c.z > below: continue
            if xmin is not None and c.x < xmin: continue
            if xmax is not None and c.x > xmax: continue
            if ymin is not None and c.y < ymin: continue
            if ymax is not None and c.y > ymax: continue
            out.append(f)
        return out

    def face(self, **kw):
        f = self.faces(**kw)
        return f[:1]

    # ------------------------------------------------------------ growing

    def extrude(self, faces, move=(0, 0, 0), scale=None):
        """Pull faces out. The returned faces are what you extrude from next,
        so a limb is a chain of these and stays one continuous surface."""
        if not faces:
            return []
        res = bmesh.ops.extrude_face_region(self.bm, geom=list(faces))
        verts = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
        new = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
        bmesh.ops.translate(self.bm, verts=verts, vec=Vector(move))
        if scale:
            mid = Vector((0, 0, 0))
            for v in verts:
                mid += v.co
            mid /= max(1, len(verts))
            bmesh.ops.scale(self.bm, verts=verts, vec=Vector(scale),
                            space=Matrix.Translation(-mid))
        # The faces we grew from are interior now. Leaving them puts a wall
        # across the middle of the limb.
        bmesh.ops.delete(self.bm, geom=list(faces), context='FACES')
        return new

    def inset(self, faces, thickness=0.05, depth=0.0):
        """Shrink a face inside itself before extruding, so the extrusion
        starts from a smaller face and there is a shelf where the limb meets
        the body.

        Returns the shrunk *inner* faces, which is what you extrude next.
        bmesh's own inset_region returns the opposite — the ring of new rim
        faces — so this deliberately returns the retained originals instead."""
        if not faces:
            return []
        keep = list(faces)
        bmesh.ops.inset_region(
            self.bm, faces=keep, thickness=thickness, depth=depth,
            use_even_offset=True)
        return [f for f in keep if f.is_valid]

    def grow(self, faces, steps):
        """A chain of extrusions: [(move, scale), ...]."""
        cur = faces
        for move, scale in steps:
            cur = self.extrude(cur, move, scale)
        return cur

    # ------------------------------------------------------------ shaping

    def cut(self, axis=2, cuts=1):
        """Loop cuts evenly spaced across the mesh. Use `cut_at` when you know
        where the shape actually changes."""
        i = {'x': 0, 'y': 1, 'z': 2}.get(axis, axis)
        edges = [e for e in self.bm.edges
                 if abs((e.verts[1].co - e.verts[0].co)[i]) > 1e-5]
        if edges:
            bmesh.ops.subdivide_edges(self.bm, edges=edges, cuts=cuts,
                                      use_grid_fill=True)
        return self

    def cut_at(self, axis, positions):
        """Loop cuts at chosen coordinates rather than evenly spaced.

        Even subdivision spends most of its edges where the form is parallel
        and leaves too few where it curves."""
        i = {'x': 0, 'y': 1, 'z': 2}[axis]
        for p in sorted(positions):
            edges = [e for e in self.bm.edges
                     if (e.verts[0].co[i] - p) * (e.verts[1].co[i] - p) < -1e-9]
            if not edges:
                continue
            res = bmesh.ops.subdivide_edges(self.bm, edges=edges, cuts=1,
                                            use_grid_fill=True)
            self.bm.verts.ensure_lookup_table()
            # subdivide puts the new ring at the midpoint; snap it onto the
            # requested station.
            #
            # Take the new vertices from the operator's own return value. The
            # obvious alternative — diffing the vertex set against one captured
            # beforehand — silently destroys the mesh: subdivide_edges
            # invalidates the old BMVert wrappers, so every vertex tests as new
            # and the snap flattens the whole form onto the station.
            for v in res.get('geom_inner', ()):
                if isinstance(v, bmesh.types.BMVert):
                    v.co[i] = p
        return self

    def bevel(self, amount=0.02, segments=1, min_angle=None):
        """Chamfer the edges. `min_angle`, in degrees, skips any edge whose two
        faces already meet nearly flush — a chain of tapered extrusions has a
        ring of near-flush edges at every joint, and chamfering those is
        invisible but costs as much as chamfering the corners that carry the
        silhouette."""
        geom = list(self.bm.verts) + list(self.bm.edges) + list(self.bm.faces)
        if min_angle is not None:
            lim = math.radians(min_angle)
            edges = [e for e in self.bm.edges
                     if len(e.link_faces) != 2 or e.calc_face_angle(0.0) >= lim]
            geom = list({v for e in edges for v in e.verts}) + edges
        bmesh.ops.bevel(
            self.bm, geom=geom,
            offset=amount, segments=segments, affect='EDGES', profile=0.5,
            clamp_overlap=True)
        return self

    def taper(self, lo, hi, at_lo=1.0, at_hi=1.0, axes='xy'):
        """Scale X and Y as a function of height, between z=lo and z=hi."""
        for v in self.bm.verts:
            if v.co.z < lo or v.co.z > hi:
                continue
            t = (v.co.z - lo) / max(1e-6, hi - lo)
            k = at_lo + (at_hi - at_lo) * t
            if 'x' in axes: v.co.x *= k
            if 'y' in axes: v.co.y *= k
        self.bm.normal_update()
        return self

    def bend(self, lo, hi, amount, axis='y'):
        """Lean everything above z=lo over, quadratically with height."""
        for v in self.bm.verts:
            if v.co.z < lo:
                continue
            t = min(1.0, (v.co.z - lo) / max(1e-6, hi - lo))
            if axis == 'y':
                v.co.y += amount * t * t
            else:
                v.co.x += amount * t * t
        self.bm.normal_update()
        return self

    def warp(self, fn):
        """Move every vertex through an arbitrary function of its position.

        `taper` and `bend` key off Z, which suits anything that stands up. For
        a form that lies down — a hull whose section changes along its length —
        this takes the whole vertex instead."""
        for v in self.bm.verts:
            x, y, z = fn(v.co.x, v.co.y, v.co.z)
            v.co.x, v.co.y, v.co.z = x, y, z
        self.bm.normal_update()
        return self

    def move(self, faces, vec):
        verts = list({v for f in faces for v in f.verts})
        if verts:
            bmesh.ops.translate(self.bm, verts=verts, vec=Vector(vec))
        return self

    def scale_faces(self, faces, vec):
        verts = list({v for f in faces for v in f.verts})
        if not verts:
            return self
        mid = Vector((0, 0, 0))
        for v in verts:
            mid += v.co
        mid /= len(verts)
        bmesh.ops.scale(self.bm, verts=verts, vec=Vector(vec),
                        space=Matrix.Translation(-mid))
        return self

    def mirror(self, axis='x'):
        """Discard the negative half and replace it with a reflection of the
        positive half, so one side is modelled and the other is exact."""
        i = {'x': 0, 'y': 1, 'z': 2}[axis]
        dead = [f for f in self.bm.faces if f.calc_center_median()[i] < -1e-4]
        if dead:
            bmesh.ops.delete(self.bm, geom=dead, context='FACES')
        res = bmesh.ops.duplicate(
            self.bm,
            geom=list(self.bm.verts) + list(self.bm.edges) + list(self.bm.faces))
        dv = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
        df = [g for g in res['geom'] if isinstance(g, bmesh.types.BMFace)]
        vec = [1, 1, 1]
        vec[i] = -1
        bmesh.ops.scale(self.bm, verts=dv, vec=Vector(vec))
        bmesh.ops.reverse_faces(self.bm, faces=df)
        bmesh.ops.remove_doubles(self.bm, verts=list(self.bm.verts), dist=1e-4)
        return self

    def smooth(self, on=True):
        self._smooth = on
        return self

    def build(self, name, mat=None, parent=None):
        bmesh.ops.recalc_face_normals(self.bm, faces=list(self.bm.faces))
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        for p in mesh.polygons:
            p.use_smooth = self._smooth
        if mat:
            obj.data.materials.append(mat)
        if parent:
            # matrix_world is stale until the depsgraph is evaluated, so
            # inverting it first gives the identity and displaces the child.
            bpy.context.view_layer.update()
            obj.parent = parent
            obj.matrix_parent_inverse = parent.matrix_world.inverted()
        return obj
