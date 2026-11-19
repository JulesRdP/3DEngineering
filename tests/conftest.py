"""Outils communs aux tests : client API sur un dossier de données temporaire, pièces générées, pièces de référence."""
import io
import math
import struct
import time
import zipfile
from pathlib import Path

import pytest

DONNEES = Path(__file__).parent / "donnees"
NEMA_V1 = DONNEES / "support_nema17_v1.stl"
NEMA_V2 = DONNEES / "support_nema17_v2.stl"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ATELIER3D_DONNEES", str(tmp_path))
    import importlib

    import atelier3d.app as A
    importlib.reload(A)
    from fastapi.testclient import TestClient
    with TestClient(A.app) as c:
        c.module = A
        yield c


def cube_stl(cote=10.0):
    """Cube binaire, 12 triangles, normales sortantes."""
    s = cote
    v = [(0, 0, 0), (s, 0, 0), (s, s, 0), (0, s, 0), (0, 0, s), (s, 0, s), (s, s, s), (0, s, s)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4),
             (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    out = bytearray(b"\0" * 80) + struct.pack("<I", len(faces))
    for a, b, c in faces:
        out += struct.pack("<12fH", 0, 0, 0, *v[a], *v[b], *v[c], 0)
    return bytes(out)


def png_uni(couleur=(0, 0, 255), taille=4):
    """Petite image PNG d'une seule couleur (vignette « étrangère » glissée dans un 3MF)."""
    import zlib
    brut = b"".join(b"\0" + bytes(couleur) * taille for _ in range(taille))
    bloc = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + bloc(b"IHDR", struct.pack(">IIBBBBB", taille, taille, 8, 2, 0, 0, 0))
            + bloc(b"IDAT", zlib.compress(brut)) + bloc(b"IEND", b""))


def cube_3mf(vignette=None, geometrie=True):
    """vignette : PNG enregistré dans Metadata/ comme le font SolidWorks ou Bambu Studio."""
    pts = "".join(f'<vertex x="{x}" y="{y}" z="{z}"/>' for x, y, z in
                  [(0, 0, 0), (20, 0, 0), (20, 20, 0), (0, 20, 0), (0, 0, 5), (20, 0, 5), (20, 20, 5), (0, 20, 5)])
    tris = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in
                   [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)])
    modele = (f'<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
              f'<resources><object id="1" type="model"><mesh><vertices>{pts}</vertices><triangles>{tris}</triangles></mesh></object></resources>'
              f'<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 100 0"/></build></model>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        if geometrie:
            z.writestr("3D/3dmodel.model", modele)
        z.writestr("Metadata/project_settings.config", '{"printer_model": "Bambu Lab A1 mini", "layer_height": "0.2"}')
        if vignette:
            z.writestr("Metadata/thumbnail.png", vignette)
    return buf.getvalue()


def revolution(profil, n=48, rotation=None, decalage=(0, 0, 0)):
    """Solide de révolution autour de Z à partir d'un profil fermé [(r, z)...], normales sortantes.
    rotation : matrice 3×3 optionnelle (pour tester un axe incliné)."""
    tris = []
    for (r0, z0), (r1, z1) in zip(profil, profil[1:] + profil[:1]):
        sortante = (z1 - z0, -(r1 - r0))  # normale du profil (r, z), parcouru dans le sens trigonométrique
        for i in range(n):
            a, b = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            p = lambda r, z, t: (r * math.cos(t), r * math.sin(t), z)
            quad = [p(r0, z0, a), p(r1, z1, a), p(r1, z1, b), p(r0, z0, b)]
            m = (a + b) / 2
            attendu = (sortante[0] * math.cos(m), sortante[0] * math.sin(m), sortante[1])
            for t in ([quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]):
                u = [t[1][k] - t[0][k] for k in range(3)]
                v = [t[2][k] - t[0][k] for k in range(3)]
                nrm = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
                if sum(c * c for c in nrm) < 1e-12:
                    continue  # triangle dégénéré sur l'axe
                if sum(nrm[k] * attendu[k] for k in range(3)) < 0:
                    t = [t[0], t[2], t[1]]
                tris.append(t)
    if rotation:
        tris = [[tuple(sum(rotation[i][k] * q[k] for k in range(3)) + decalage[i] for i in range(3)) for q in t] for t in tris]
    return tris


def stl_binaire(tris):
    out = bytearray(b"\0" * 80) + struct.pack("<I", len(tris))
    for a, b, c in tris:
        out += struct.pack("<12fH", 0, 0, 0, *a, *b, *c, 0)
    return bytes(out)


def attendre_analyse(client, fid):
    for _ in range(100):
        f = client.get(f"/api/fichiers/{fid}").json()
        if f["meta"].get("analyse") == "faite":
            return f
        time.sleep(0.1)
    raise AssertionError("analyse non terminée")


def deposer(client, projet_id, nom, contenu, **champs):
    r = client.post(f"/api/projets/{projet_id}/fichiers", data={k: str(v) for k, v in champs.items()},
                    files=[("fichiers", (nom, contenu, "application/octet-stream"))])
    assert r.status_code == 200, r.text
    return attendre_analyse(client, r.json()[0]["id"])
