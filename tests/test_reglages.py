"""Réglages : valeurs par défaut, modification, refus, retour au défaut, effet sur l'appli."""
from atelier3d.reglages import DEFINITIONS, SECTIONS


def test_liste_bien_rangee():
    cles = [r["cle"] for s in SECTIONS for g in s["groupes"] for r in g["reglages"]]
    assert len(cles) == len(set(cles)), "clé en double"
    for s in SECTIONS:
        assert s["id"] and s["titre"] and s["groupes"]
        for g in s["groupes"]:
            for r in g["reglages"]:
                assert r["cle"].startswith(s["id"] + "."), f"{r['cle']} pas rangée dans sa section"
                assert r["type"] in ("nombre", "booleen", "texte", "choix") and r["libelle"]
                if r["type"] == "nombre":
                    assert r["min"] <= r["defaut"] <= r["max"]
                if r["type"] == "choix":
                    assert r["defaut"] in r["choix"]


def test_valeurs_par_defaut(client):
    r = client.get("/api/reglages").json()
    assert r["sections"][0]["id"] == "plans"
    assert r["valeurs"] == {cle: d["defaut"] for cle, d in DEFINITIONS.items()}


def test_modifier_et_revenir_au_defaut(client):
    v = client.put("/api/reglages", json={"plans.piece.effacement": 3, "plans.piece.tour": False, "plans.cartouche.societe": "  Labo  "}).json()["valeurs"]
    assert v["plans.piece.effacement"] == 3 and v["plans.piece.tour"] is False and v["plans.cartouche.societe"] == "Labo"
    assert client.get("/api/reglages").json()["valeurs"]["plans.piece.effacement"] == 3
    v = client.put("/api/reglages", json={"plans.piece.effacement": None}).json()["valeurs"]
    assert v["plans.piece.effacement"] == DEFINITIONS["plans.piece.effacement"]["defaut"]


def test_refus_tout_ou_rien(client):
    for corps in [{"inconnu.x": 1}, {"inconnu.x": None}, {"plans.piece.duree_vol": 99}, {"plans.piece.duree_vol": "vite"},
                  {"plans.piece.tour": 1}, {"plans.cartouche.tolerance": "ISO 9999"}, {"plans.cartouche.societe": "x" * 41}]:
        assert client.put("/api/reglages", json=corps).status_code == 400, corps
    # une valeur fausse dans le lot : rien n'est enregistré
    assert client.put("/api/reglages", json={"plans.piece.effacement": 5, "plans.piece.duree_vol": -1}).status_code == 400
    assert client.get("/api/reglages").json()["valeurs"]["plans.piece.effacement"] == DEFINITIONS["plans.piece.effacement"]["defaut"]


def test_seuil_de_stock_bas_utilise_par_le_tableau(client):
    fil = client.post("/api/filaments", json={"matiere": "PLA", "stock_g": 300}).json()
    assert client.get("/api/tableau").json()["stock_bas"] == []
    client.put("/api/reglages", json={"general.filaments.stock_bas": 500})
    assert [f["id"] for f in client.get("/api/tableau").json()["stock_bas"]] == [fil["id"]]
