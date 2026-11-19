"""Reconnaissance des formes dans les maillages (atelier3d/formes.py).

Les pièces de référence (tests/donnees/support_nema17_v*.stl) fixent toutes les valeurs attendues :
si l'une change, c'est une régression (ou une amélioration à reporter ici en connaissance de cause)."""
import math
import time

import pytest

from atelier3d.formes import reconnaitre
from atelier3d.mesh import analyser, triangles_stl
from conftest import NEMA_V1, NEMA_V2, revolution


def formes_de(chemin):
    return reconnaitre(list(triangles_stl(chemin.read_bytes())))


def resume_percages(f):
    return sorted((tuple(round(v, 2) for v in p["centre"]), tuple(p["axe"]),
                   tuple((round(2 * e["r"], 2), round(e["fin"] - e["debut"], 2)) for e in p["etages"]), p["traversant"])
                  for p in f["percages"])


# ------------------------------------------------------------------ pièces de référence

def test_nema_v1_percages():
    f = formes_de(NEMA_V1)
    assert resume_percages(f) == sorted([
        ((0, 0, 31), (0, 1, 0), ((22.8, 6.0),), True),                       # alésage de centrage
        *[((x, 0, z), (0, 1, 0), ((3.4, 3.0), (6.5, 3.0)), True)            # 4 × M3 lamés côté +Y
          for x in (-15.5, 15.5) for z in (15.5, 46.5)],
    ])


def test_nema_v1_oblongs_arrondis_plans():
    f = formes_de(NEMA_V1)
    oblongs = sorted((tuple(o["c1"]), tuple(o["c2"]), o["r"], o["entraxe"], o["fin"] - o["debut"]) for o in f["oblongs"])
    assert oblongs == sorted(((x, y, 0.0), (x, y + 10, 0.0), 2.75, 10.0, 6.0) for x in (-15.0, 15.0) for y in (16.0, 34.0))
    arrondis = sorted((tuple(a["axe"]), a["r"], a["angle"], a["creux"]) for a in f["arrondis"])
    assert arrondis == sorted([((1.0, 0.0, 0.0), 4.0, 90.0, True)] + [((0.0, 0.0, 1.0), 4.0, 90.0, True)] * 4)
    assert f["bossages"] == []
    # faces principales : dessous, devant, dessus de semelle, arrière de la plaque, flancs, chanfreins à 45°
    niveaux = {(tuple(p["n"]), p["d"]) for p in f["plans"]}
    for attendu in [((0, 0, -1), 0), ((0, -1, 0), 0), ((0, 0, 1), 6), ((0, 1, 0), 6), ((1, 0, 0), 30), ((-1, 0, 0), 30),
                    ((0, 1, 0), 50), ((0, 0, 1), 56), ((1, 0, 0), -25), ((-1, 0, 0), -25)]:
        assert attendu in niveaux, attendu
    assert sum(1 for p in f["plans"] if abs(abs(p["n"][0]) - 0.707107) < 1e-5 and abs(p["n"][2] - 0.707107) < 1e-5) == 2


def test_nema_v2_variation():
    f = formes_de(NEMA_V2)
    assert [(round(2 * e["r"], 2), round(e["fin"] - e["debut"], 2)) for p in f["percages"] if p["centre"][2] == 31 for e in p["etages"]] == [(22.8, 8.0)]
    assert sorted({(o["entraxe"], o["fin"] - o["debut"]) for o in f["oblongs"]}) == [(16.0, 8.0)]
    encoche = [a for a in f["arrondis"] if a["axe"] == [0.0, 1.0, 0.0]]
    assert len(encoche) == 1 and encoche[0]["r"] == 4 and encoche[0]["angle"] == 180 and encoche[0]["centre"] == [0.0, 0.0, 52.0]


def test_analyse_complete_nema():
    meta, mini = analyser(NEMA_V1, "stl")
    assert meta["dimensions"] == [60, 50, 56] and meta["triangles"] == 3794
    assert abs(meta["volume_mm3"] - 36069.5) < 1 and mini.startswith(b"\x89PNG")
    assert len(meta["formes"]["percages"]) == 5


# ------------------------------------------------------------------ pièces générées

def test_formes_tube_incline():
    """Tube Ø20 / Ø6 × 8, axe incliné quelconque : perçage traversant et bossage retrouvés, axe compris."""
    ax, ay, az = math.radians(25), math.radians(-40), math.radians(10)
    rx = [[1, 0, 0], [0, math.cos(ax), -math.sin(ax)], [0, math.sin(ax), math.cos(ax)]]
    ry = [[math.cos(ay), 0, math.sin(ay)], [0, 1, 0], [-math.sin(ay), 0, math.cos(ay)]]
    rz = [[math.cos(az), -math.sin(az), 0], [math.sin(az), math.cos(az), 0], [0, 0, 1]]
    mul = lambda a, b: [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    rot = mul(rz, mul(ry, rx))
    f = reconnaitre(revolution([(3, 0), (10, 0), (10, 8), (3, 8)], rotation=rot, decalage=(5, -2, 7)))
    axe = [rot[i][2] for i in range(3)]
    assert len(f["percages"]) == 1 and len(f["bossages"]) == 1
    p, b = f["percages"][0], f["bossages"][0]
    assert abs(2 * p["etages"][0]["r"] - 6) < 0.01 and p["traversant"]
    assert abs(abs(sum(p["axe"][i] * axe[i] for i in range(3))) - 1) < 1e-6
    assert abs(p["fin"] - p["debut"] - 8) < 0.01
    assert abs(2 * b["r"] - 20) < 0.01


def test_facettes_de_cylindre_pas_des_faces_planes():
    """Les facettes d'un cylindre reconnu ne sont pas listées comme faces planes (sinon elles seraient cotées)."""
    f = reconnaitre(revolution([(3, 0), (10, 0), (10, 8), (3, 8)]))
    assert sorted((tuple(p["n"]), p["d"]) for p in f["plans"]) == [((0.0, 0.0, -1.0), 0.0), ((0.0, 0.0, 1.0), 8.0)]


@pytest.mark.parametrize("segments", [12, 2000])
def test_formes_finesse_du_maillage(segments):
    """Cylindre grossier (30° par facette) ou très fin (0,18°) : même diamètre retrouvé."""
    f = reconnaitre(revolution([(3, 0), (10, 0), (10, 8), (3, 8)], n=segments))
    assert [round(2 * e["r"], 3) for p in f["percages"] for e in p["etages"]] == [6]


def test_formes_trou_borgne_et_lamage():
    """Cylindre Ø30 × 12 avec trou Ø6 lamé Ø11 sur 4, borgne (fond à 10 de la face) : étages et profondeur."""
    f = reconnaitre(revolution([(0, 0), (15, 0), (15, 12), (5.5, 12), (5.5, 8), (3, 8), (3, 2), (0, 2)]))
    (p,) = f["percages"]
    assert [(round(2 * e["r"], 2), round(e["fin"] - e["debut"], 2)) for e in p["etages"]] == [(6, 6), (11, 4)]
    assert not p["traversant"] and p["ouvert_fin"] and not p["ouvert_debut"]


def test_formes_sans_cylindre_et_cas_limites():
    from conftest import cube_stl
    f = reconnaitre(list(triangles_stl(cube_stl())))
    assert f["percages"] == f["oblongs"] == f["arrondis"] == f["bossages"] == [] and len(f["plans"]) == 6
    assert reconnaitre([]) is None


def test_formes_rapide_sur_gros_maillage():
    t = revolution([(3, 0), (10, 0), (10, 8), (3, 8)], n=12500)   # 100 000 triangles
    t0 = time.time()
    f = reconnaitre(t)
    assert len(f["percages"]) == 1 and time.time() - t0 < 15
