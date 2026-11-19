"""Parcours de bout en bout par l'API : projets, fichiers, variations, compatibilité, impressions, stock."""
from conftest import attendre_analyse, cube_3mf, cube_stl, deposer, png_uni


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


def test_3mf_miniature_dans_le_style_de_l_atelier(client):
    """La vignette enregistrée dans le 3MF (SolidWorks, Bambu Studio...) ne remplace pas notre rendu :
    toutes les miniatures ont le même style (pièce orange ombrée sur fond transparent)."""
    from atelier3d.mesh import miniature, triangles_3mf
    import io
    import zipfile
    etrangere = png_uni()
    contenu = cube_3mf(vignette=etrangere)
    p = client.post("/api/projets", json={"nom": "3MF SolidWorks"}).json()
    f = deposer(client, p["id"], "piece.3mf", contenu)
    assert f["meta"]["miniature"] is True
    mini = client.get(f"/api/fichiers/{f['id']}/miniature").content
    assert mini != etrangere, "la vignette du logiciel d'origine a été reprise telle quelle"
    tris = list(triangles_3mf(zipfile.ZipFile(io.BytesIO(contenu))))
    assert mini == miniature(tris), "même rendu que pour un STL"


def test_3mf_sans_geometrie_garde_sa_vignette(client):
    """Faute de géométrie lisible, la vignette du fichier vaut mieux que pas de miniature du tout."""
    etrangere = png_uni((0, 200, 0))
    p = client.post("/api/projets", json={"nom": "3MF vide"}).json()
    f = deposer(client, p["id"], "vide.3mf", cube_3mf(vignette=etrangere, geometrie=False))
    assert client.get(f"/api/fichiers/{f['id']}/miniature").content == etrangere


def test_suppression_projet_importe(client):
    """Un projet créé par import (modèle 3D + fichier CAO) se supprime avec ses fichiers et miniatures."""
    A = client.module
    p = client.post("/api/projets", json={"nom": "SupportCasque"}).json()
    f1 = deposer(client, p["id"], "Support.3MF", cube_3mf(vignette=png_uni()))
    f2 = deposer(client, p["id"], "Support.SLDPRT", b"pas un vrai SolidWorks")
    imp = client.post("/api/impressions", json={"fichier_id": f1["id"], "resultat": "prevue"}).json()
    disque = [A.FICHIERS / f["chemin"] for f in (f1, f2)]
    assert all(c.exists() for c in disque) and (A.MINIATURES / f"{f1['id']}.png").exists()
    assert client.delete(f"/api/projets/{p['id']}").json() == {"ok": True}
    assert client.get(f"/api/projets/{p['id']}").status_code == 404
    assert all(client.get(f"/api/fichiers/{f['id']}").status_code == 404 for f in (f1, f2))
    assert not any(c.exists() for c in disque) and not (A.MINIATURES / f"{f1['id']}.png").exists()
    assert client.get(f"/api/impressions/{imp['id']}").json()["fichier_id"] is None, "l'historique d'impression reste"


def test_machine_bambu_incomplete(client):
    m = client.post("/api/machines", json={"nom": "P1S", "pilote": "bambu_lan"}).json()
    etat = client.get("/api/etat-machines").json()[str(m["id"])]
    assert etat["connexion"] == "incomplete"
