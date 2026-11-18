import io
import struct
import time
import zipfile

import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ATELIER3D_DONNEES", str(tmp_path))
    import importlib

    import atelier3d.app as A
    importlib.reload(A)
    from fastapi.testclient import TestClient
    with TestClient(A.app) as c:
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


def cube_3mf():
    pts = "".join(f'<vertex x="{x}" y="{y}" z="{z}"/>' for x, y, z in
                  [(0, 0, 0), (20, 0, 0), (20, 20, 0), (0, 20, 0), (0, 0, 5), (20, 0, 5), (20, 20, 5), (0, 20, 5)])
    tris = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in
                   [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)])
    modele = (f'<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
              f'<resources><object id="1" type="model"><mesh><vertices>{pts}</vertices><triangles>{tris}</triangles></mesh></object></resources>'
              f'<build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 100 0"/></build></model>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("3D/3dmodel.model", modele)
        z.writestr("Metadata/project_settings.config", '{"printer_model": "Bambu Lab A1 mini", "layer_height": "0.2"}')
    return buf.getvalue()


def attendre_analyse(client, fid):
    for _ in range(50):
        f = client.get(f"/api/fichiers/{fid}").json()
        if f["meta"].get("analyse") == "faite":
            return f
        time.sleep(0.1)
    raise AssertionError("analyse non terminée")


def test_parcours_complet(client):
    p = client.post("/api/projets", json={"nom": "Essai", "tags": "test"}).json()
    m = client.post("/api/machines", json={"nom": "A1 mini", "volume_x": 180, "volume_y": 180, "volume_z": 180,
                                           "code_acces": "secret"}).json()
    assert "code_acces" not in m and m["code_acces_renseigne"]
    fil = client.post("/api/filaments", json={"matiere": "PLA", "densite": 1.24, "stock_g": 100, "prix_kg": 20}).json()

    r = client.post(f"/api/projets/{p['id']}/fichiers", files=[("fichiers", ("cube.stl", cube_stl(), "model/stl"))])
    fid = r.json()[0]["id"]
    f = attendre_analyse(client, fid)
    assert f["meta"]["dimensions"] == [10, 10, 10]
    assert abs(f["meta"]["volume_mm3"] - 1000) < 0.1
    assert f["role"] == "piece"

    # variation
    r = client.post(f"/api/projets/{p['id']}/fichiers", data={"parent_id": str(fid), "variante": "plus grand"},
                    files=[("fichiers", ("cube2.stl", cube_stl(300), "model/stl"))])
    v = attendre_analyse(client, r.json()[0]["id"])
    assert v["parent_id"] == fid
    assert client.get(f"/api/fichiers/{fid}").json()["variantes"][0]["variante"] == "plus grand"

    # compatibilité : 10 mm rentre, 300 mm non
    assert client.get(f"/api/fichiers/{fid}/compatibilite").json()["machines"][0]["verdict"] == "ok"
    assert client.get(f"/api/fichiers/{v['id']}/compatibilite").json()["machines"][0]["verdict"] == "trop_grand"

    # impression réussie : stock déduit une seule fois
    i = client.post("/api/impressions", json={"fichier_id": fid, "machine_id": m["id"], "filament_id": fil["id"],
                                              "grammes": 30, "quantite": 2, "resultat": "reussie"}).json()
    client.put(f"/api/impressions/{i['id']}", json={"notes": "ok"})
    assert client.get(f"/api/filaments/{fil['id']}").json()["stock_g"] == 40
    t = client.get("/api/tableau").json()
    assert t["taux_reussite"] == 100 and t["grammes"] == 60 and t["cout"] == 1.2

    # recherche par nom de fichier
    assert [x["id"] for x in client.get("/api/projets?q=cube2").json()] == [p["id"]]

    # suppression du projet : fichiers effacés
    assert client.delete(f"/api/projets/{p['id']}").json()["ok"]
    assert client.get(f"/api/fichiers/{fid}").status_code == 404


def test_3mf_transforme_et_reglages(client):
    p = client.post("/api/projets", json={"nom": "3MF"}).json()
    r = client.post(f"/api/projets/{p['id']}/fichiers", files=[("fichiers", ("plaque.3mf", cube_3mf(), "model/3mf"))])
    f = attendre_analyse(client, r.json()[0]["id"])
    assert f["meta"]["dimensions"] == [20, 20, 5]
    assert f["meta"]["min"] == [100, 100, 0]
    assert f["meta"]["reglages_3mf"]["imprimante"] == "Bambu Lab A1 mini"


def test_machine_bambu_incomplete(client):
    m = client.post("/api/machines", json={"nom": "P1S", "pilote": "bambu_lan"}).json()
    etat = client.get("/api/etat-machines").json()[str(m["id"])]
    assert etat["connexion"] == "incomplete"
