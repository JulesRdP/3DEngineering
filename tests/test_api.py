"""Chaque route de l'API : comportement nominal et refus attendus."""
import io
import runpy
import zipfile

from conftest import NEMA_V1, cube_stl, deposer


def test_crud_generique(client):
    for table, corps, champ, nouveau in [
        ("projets", {"nom": "P"}, "description", "texte"),
        ("machines", {"nom": "M", "volume_x": 200, "volume_y": 200, "volume_z": 200}, "notes", "ok"),
        ("filaments", {"matiere": "PETG"}, "couleur", "noir"),
        ("presets", {"nom": "rapide"}, "remplissage", 20),
        ("impressions", {"resultat": "prevue"}, "notes", "file"),
    ]:
        cree = client.post(f"/api/{table}", json={**corps, "champ_inconnu": "ignoré"}).json()
        assert "champ_inconnu" not in cree
        assert client.get(f"/api/{table}/{cree['id']}").status_code == 200
        assert client.put(f"/api/{table}/{cree['id']}", json={champ: nouveau}).json()[champ] == nouveau
        assert any(x["id"] == cree["id"] for x in client.get(f"/api/{table}").json())
        assert client.delete(f"/api/{table}/{cree['id']}").json()["ok"]
        assert client.get(f"/api/{table}/{cree['id']}").status_code == 404
        assert client.put(f"/api/{table}/999", json={}).status_code == 404


def test_champ_numerique_vide_devient_null(client):
    m = client.post("/api/machines", json={"nom": "M", "volume_x": ""}).json()
    assert m["volume_x"] is None and m["nom"] == "M"


def test_code_acces_jamais_renvoye_et_conserve(client):
    m = client.post("/api/machines", json={"nom": "X1", "pilote": "manuel", "code_acces": "1234"}).json()
    assert "code_acces" not in m and m["code_acces_renseigne"]
    m = client.put(f"/api/machines/{m['id']}", json={"code_acces": "", "notes": "x"}).json()
    assert m["code_acces_renseigne"]   # champ vide = on garde l'ancien code
    assert all("code_acces" not in x for x in client.get("/api/machines").json())


def test_commande_machine(client):
    m = client.post("/api/machines", json={"nom": "Manuelle", "pilote": "manuel", "statut_manuel": "occupee"}).json()
    assert client.get("/api/etat-machines").json()[str(m["id"])] == {"connexion": "manuel", "etat": "occupee"}
    assert client.post(f"/api/machines/{m['id']}/commande/pause").status_code == 400
    assert client.post("/api/machines/999/commande/pause").status_code == 404


def test_stock_deduit_une_seule_fois_et_ratee(client):
    fil = client.post("/api/filaments", json={"matiere": "PLA", "stock_g": 100}).json()
    i = client.post("/api/impressions", json={"filament_id": fil["id"], "grammes": 10, "resultat": "en_cours"}).json()
    assert client.get(f"/api/filaments/{fil['id']}").json()["stock_g"] == 100   # pas encore terminée
    client.put(f"/api/impressions/{i['id']}", json={"resultat": "ratee"})
    client.put(f"/api/impressions/{i['id']}", json={"resultat": "reussie"})
    assert client.get(f"/api/filaments/{fil['id']}").json()["stock_g"] == 90
    t = client.get("/api/tableau").json()
    assert t["stock_bas"][0]["id"] == fil["id"] and t["taux_reussite"] == 100


def test_fichiers_depot_contenu_miniature_suppression(client):
    p = client.post("/api/projets", json={"nom": "F"}).json()
    f = deposer(client, p["id"], "../../piège nom?.stl", cube_stl())
    assert "/" not in f["nom"] and "?" not in f["nom"] and f["type"] == "stl" and len(f["sha256"]) == 64
    assert client.get(f"/api/fichiers/{f['id']}/contenu").content == cube_stl()
    assert client.get(f"/api/fichiers/{f['id']}/contenu?telecharger=true").headers["content-disposition"].startswith("attachment")
    assert client.get(f"/api/fichiers/{f['id']}/miniature").headers["content-type"] == "image/png"
    assert any(x["id"] == f["id"] for x in client.get(f"/api/projets/{p['id']}/fichiers").json())
    assert any(x["id"] == f["id"] for x in client.get("/api/fichiers").json())
    chemin = client.module.FICHIERS / f["chemin"]
    assert chemin.exists()
    assert client.put(f"/api/fichiers/{f['id']}", json={"parent_id": f["id"]}).status_code == 400
    assert client.put(f"/api/fichiers/{f['id']}", json={"role": "plan", "notes": "n"}).json()["role"] == "plan"
    assert client.delete(f"/api/fichiers/{f['id']}").json()["ok"]
    assert not chemin.exists()
    assert client.get(f"/api/fichiers/{f['id']}/miniature").status_code == 404


def test_fichier_absent_du_disque(client):
    p = client.post("/api/projets", json={"nom": "F"}).json()
    f = deposer(client, p["id"], "c.stl", cube_stl())
    (client.module.FICHIERS / f["chemin"]).unlink()
    assert client.get(f"/api/fichiers/{f['id']}/contenu").status_code == 410


def test_types_et_roles_au_depot(client):
    p = client.post("/api/projets", json={"nom": "Types"}).json()
    for nom, typ, role in [("a.step", "step", "source"), ("b.gcode", "gcode", "gcode"), ("c.pdf", "pdf", "plan"),
                           ("d.png", "image", "plan"), ("e.fs", "fs", "source"), ("f.xyz", "autre", "autre")]:
        f = deposer(client, p["id"], nom, b"; contenu\n")
        assert (f["type"], f["role"]) == (typ, role), nom


def test_gcode_duree_et_poids(client):
    p = client.post("/api/projets", json={"nom": "G"}).json()
    g = b"G1 X0\n; estimated printing time (normal mode) = 1h 2m\n; total filament weight [g] : 12.5\n"
    f = deposer(client, p["id"], "piece.gcode", g)
    assert f["meta"]["poids_estime_g"] == 12.5 and f["meta"]["duree_texte"] == "1h 2m"


def test_compatibilite_rotation_et_estimation(client):
    p = client.post("/api/projets", json={"nom": "C"}).json()
    client.post("/api/machines", json={"nom": "Etroite", "volume_x": 70, "volume_y": 70, "volume_z": 50})
    client.post("/api/filaments", json={"matiere": "PLA", "densite": 1.24, "prix_kg": 20, "stock_g": 1})
    f = deposer(client, p["id"], "support.stl", NEMA_V1.read_bytes())          # 60 × 50 × 56 : à tourner
    c = client.get(f"/api/fichiers/{f['id']}/compatibilite").json()
    assert c["machines"][0]["verdict"] == "tourner"
    e = c["estimation"][0]
    assert e["grammes"] > 0 and e["cout"] > 0 and e["stock_suffisant"] is False


def test_reperes_validation(client):
    p = client.post("/api/projets", json={"nom": "R"}).json()
    f = deposer(client, p["id"], "c.stl", cube_stl())
    ok = client.put(f"/api/fichiers/{f['id']}/reperes", json={"reperes": [{"pos": [1, 2, 3], "texte": "tenon", "valeur": "0,3"}]}).json()
    assert ok == [{"n": 1, "pos": [1, 2, 3], "texte": "tenon", "valeur": "0,3"}]
    assert client.put(f"/api/fichiers/{f['id']}/reperes", json={"reperes": [{"pos": [1, 2]}]}).status_code == 400
    assert client.put(f"/api/fichiers/{f['id']}/reperes", json={"reperes": [{"pos": [1, "x", 3]}]}).status_code == 400


def test_cartouche(client):
    p = client.post("/api/projets", json={"nom": "Cart"}).json()
    f = deposer(client, p["id"], "c.stl", cube_stl())
    fil = client.post("/api/filaments", json={"matiere": "PETG", "marque": "Prusa", "couleur": "noir"}).json()
    r = client.put(f"/api/fichiers/{f['id']}/cartouche", json={"dessinateur": "J. R.", "filament_id": fil["id"], "inconnu": "x", "indice": ""}).json()
    assert r == {"dessinateur": "J. R.", "filament_id": str(fil["id"]), "matiere": "PETG Prusa noir"}
    assert client.get(f"/api/fichiers/{f['id']}").json()["meta"]["cartouche"]["dessinateur"] == "J. R."
    assert client.put(f"/api/fichiers/{f['id']}/cartouche", json={"filament_id": 999}).status_code == 400
    assert client.put("/api/fichiers/999/cartouche", json={}).status_code == 404


def test_reanalyse_garde_reperes_et_cartouche(client):
    p = client.post("/api/projets", json={"nom": "Re"}).json()
    f = deposer(client, p["id"], "c.stl", cube_stl())
    client.put(f"/api/fichiers/{f['id']}/reperes", json={"reperes": [{"pos": [0, 0, 0], "texte": "coin"}]})
    client.put(f"/api/fichiers/{f['id']}/cartouche", json={"numero": "PL-1"})
    runpy.run_module("outils.reanalyser", run_name="__main__")
    meta = client.get(f"/api/fichiers/{f['id']}").json()["meta"]
    assert meta["reperes"][0]["texte"] == "coin" and meta["cartouche"]["numero"] == "PL-1" and "formes" in meta


def test_sauvegarde_zip(client):
    p = client.post("/api/projets", json={"nom": "S"}).json()
    deposer(client, p["id"], "c.stl", cube_stl())
    r = client.get("/api/sauvegarde")
    noms = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert "atelier.db" in noms and any(n.endswith("c.stl") for n in noms)


def test_pages_statiques(client):
    assert "Atelier 3D" in client.get("/").text
    for f in ["app.js", "plan.js", "traceur.js", "aretes.js", "pdf.js", "vision.js", "style.css"]:
        assert client.get(f"/static/{f}").status_code == 200, f


def test_interface_jamais_perimee_dans_le_navigateur(client):
    """Après une mise à jour, le navigateur doit revérifier les modules JS et les miniatures (sinon il garde
    l'ancien code : pièce 3MF noire même après correction)."""
    from conftest import cube_stl, deposer
    p = client.post("/api/projets", json={"nom": "Cache"}).json()
    f = deposer(client, p["id"], "cube.stl", cube_stl())
    for url in ["/", "/static/app.js", "/static/vision.js", "/static/style.css", f"/api/fichiers/{f['id']}/miniature"]:
        r = client.get(url)
        assert r.status_code == 200 and r.headers.get("cache-control") == "no-cache", url
    etag = client.get("/static/vision.js").headers["etag"]
    assert client.get("/static/vision.js", headers={"If-None-Match": etag}).status_code == 304, "rien n'a changé : 304"
    assert "no-cache" not in client.get(f"/api/fichiers/{f['id']}/contenu").headers.get("cache-control", "")
