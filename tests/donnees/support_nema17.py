"""Support moteur NEMA 17 en équerre, généré avec manifold3d. Sortie : STL binaire.

Source des pièces de référence des tests (support_nema17_v1.stl, support_nema17_v2.stl). Pas nécessaire pour
lancer les tests ; pour régénérer : pip install manifold3d numpy, puis
    python support_nema17.py support_nema17_v1.stl        (et ... support_nema17_v2.stl v2)
"""
import struct
import sys

import numpy as np
from manifold3d import CrossSection, Manifold

SEG = 64
V2 = len(sys.argv) > 2 and sys.argv[2] == "v2"
EP = 8.0 if V2 else 6.0     # épaisseur des plaques
L, P, H = 60.0, (62.0 if V2 else 50.0), 56.0  # largeur (X), profondeur semelle (Y), hauteur face moteur (Z)
REGLAGE = 16.0 if V2 else 10.0  # course des oblongs
OBLONGS_Y = (16, 38) if V2 else (16, 34)
CZ = 31.0           # hauteur de l'axe moteur


def cyl_z(r, h, x=0, y=0, z=0):
    return Manifold.cylinder(h, r, r, SEG).translate((x, y, z))


def cyl_y(r, h, x, y, z):
    """Cylindre d'axe Y, de y à y + h."""
    return Manifold.cylinder(h, r, r, SEG).rotate((-90, 0, 0)).translate((x, y, z))


def oblong(x, y0, y1, r, z0, h):
    return Manifold.batch_hull([cyl_z(r, h, x, y0, z0), cyl_z(r, h, x, y1, z0)])


def prisme_yz(points, x0, ep):
    """Polygone dans le plan (Y, Z) extrudé selon X de x0 à x0 + ep."""
    m = Manifold.extrude(CrossSection([points]), ep)          # (u, v, w) = (Y, Z, X)
    return m.warp_batch(lambda v: v[:, [2, 0, 1]]).translate((x0, 0, 0))


semelle = Manifold.cube((L, P, EP)).translate((-L / 2, 0, 0))
face = Manifold.cube((L, EP, H)).translate((-L / 2, 0, 0))
goussets = prisme_yz([(EP, EP), (P - 8, EP), (EP, H - 8)], -L / 2, 5) + \
           prisme_yz([(EP, EP), (P - 8, EP), (EP, H - 8)], L / 2 - 5, 5)
# congé de 4 mm dans l'angle intérieur
conge = Manifold.cube((L - 10, 4, 4)).translate((-L / 2 + 5, EP, EP)) - \
        Manifold.cylinder(L, 4, 4, SEG).rotate((0, 90, 0)).translate((-L / 2, EP + 4, EP + 4))

piece = semelle + face + goussets + conge

# face moteur : alésage de centrage Ø22,5 + 4 trous M3 entraxe 31 lamés côté vis
piece -= cyl_y(11.25 + 0.15, EP + 2, 0, -1, CZ)
for dx in (-15.5, 15.5):
    for dz in (-15.5, 15.5):
        piece -= cyl_y(1.7, EP + 2, dx, -1, CZ + dz)
        piece -= cyl_y(3.25, 3.5, dx, EP - 3.0, CZ + dz)

# semelle : 4 trous oblongs M5 (réglage de 10 mm) + poche d'allègement
for x in (-15, 15):
    for y0 in OBLONGS_Y:
        piece -= oblong(x, y0, y0 + REGLAGE, 2.75, -1, EP + 2)
if V2:  # encoche passe-câble en U dans le haut de la face
    piece -= Manifold.batch_hull([cyl_y(4, EP + 2, 0, -1, z) for z in (52, 62)])
piece -= Manifold.batch_hull([cyl_z(4, EP + 2, sx * 4, sy, -1) for sx in (-1, 1) for sy in (22, 42)])

# chanfreins des arêtes du haut de la face moteur
for sx in (-1, 1):
    piece -= Manifold.cube((8.5, EP + 2, 8.5), True).rotate((0, 45, 0)).translate((sx * L / 2, EP / 2, H))

mesh = piece.to_mesh()
v = np.asarray(mesh.vert_properties)[:, :3]
t = np.asarray(mesh.tri_verts)
with open(sys.argv[1], "wb") as f:
    f.write(b"Atelier 3D - support NEMA 17".ljust(80, b" ") + struct.pack("<I", len(t)))
    for a, b, c in t:
        n = np.cross(v[b] - v[a], v[c] - v[a])
        n = n / (np.linalg.norm(n) or 1)
        f.write(struct.pack("<12fH", *n, *v[a], *v[b], *v[c], 0))
print(len(t), "triangles, volume", round(piece.volume(), 1), "mm3, genre", piece.genus())
