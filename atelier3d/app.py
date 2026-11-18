"""Atelier 3D : serveur web local (FastAPI) pour les projets d'impression 3D de l'équipe."""
import hashlib
import json
import os
import re
import shutil
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .db import Base, maintenant
from .machines import Parc
from .mesh import ROLES, analyser, type_fichier

ICI = Path(__file__).parent
DONNEES = Path(os.environ.get("ATELIER3D_DONNEES", ICI.parent / "data"))
FICHIERS = DONNEES / "fichiers"
MINIATURES = DONNEES / "miniatures"

db = Base(DONNEES / "atelier.db")
parc = Parc()


def _synchro_parc():
    parc.synchroniser(db.tous("SELECT * FROM machines"))


@asynccontextmanager
async def cycle(app):
    FICHIERS.mkdir(parents=True, exist_ok=True)
    MINIATURES.mkdir(parents=True, exist_ok=True)
    _synchro_parc()
    yield
    parc.tout_arreter()


app = FastAPI(title="Atelier 3D", lifespan=cycle)
app.mount("/static", StaticFiles(directory=ICI / "static"), name="static")


@app.get("/")
def accueil():
    return FileResponse(ICI / "static" / "index.html")


# ------------------------------------------------------------------ outils

CHAMPS = {
    "projets": ["nom", "description", "statut", "tags", "lien_cao"],
    "machines": ["nom", "marque", "modele", "techno", "volume_x", "volume_y", "volume_z", "buse", "pilote",
                 "adresse", "numero_serie", "code_acces", "statut_manuel", "notes"],
    "filaments": ["matiere", "marque", "couleur", "couleur_hex", "diametre", "densite", "temp_buse",
                  "temp_plateau", "stock_g", "prix_kg", "notes"],
    "presets": ["nom", "machine_id", "filament_id", "hauteur_couche", "remplissage", "motif", "parois", "vitesse",
                "temp_buse", "temp_plateau", "supports", "adherence", "notes"],
    "impressions": ["fichier_id", "machine_id", "preset_id", "filament_id", "quantite", "debut", "duree_min",
                    "grammes", "resultat", "notes"],
    "fichiers": ["nom", "role", "parent_id", "variante", "notes"],
}


TEXTES = {"nom", "description", "statut", "tags", "lien_cao", "marque", "modele", "techno", "pilote", "adresse",
          "numero_serie", "code_acces", "statut_manuel", "notes", "matiere", "couleur", "couleur_hex", "motif",
          "supports", "adherence", "resultat", "role", "variante"}


def _filtrer(table, corps: dict):
    """Garde les champs connus ; un champ numérique laissé vide devient NULL."""
    return {k: (None if v == "" and k not in TEXTES else v) for k, v in corps.items() if k in CHAMPS[table]}


def _existe(table, ident):
    ligne = db.un(f"SELECT * FROM {table} WHERE id = ?", (ident,))
    if not ligne:
        raise HTTPException(404, f"{table[:-1]} {ident} introuvable")
    return ligne


def _masquer(m):
    """Le code d'accès ne repart pas vers le navigateur, on indique juste s'il est renseigné."""
    m = dict(m)
    m["code_acces_renseigne"] = bool(m.pop("code_acces", ""))
    return m


# ------------------------------------------------------------------ CRUD générique (sauf fichiers)

def _crud(table, ordre="id DESC", sortie=lambda x: x, apres=None):
    @app.get(f"/api/{table}")
    def lister():
        return [sortie(r) for r in db.tous(f"SELECT * FROM {table} ORDER BY {ordre}")]

    @app.get(f"/api/{table}/{{ident}}")
    def lire(ident: int):
        return sortie(_existe(table, ident))

    @app.post(f"/api/{table}")
    def creer(corps: dict):
        vals = _filtrer(table, corps)
        if table == "projets":
            vals.update(cree=maintenant(), modifie=maintenant())
        ident = db.inserer(table, vals)
        if apres:
            apres(ident)
        return sortie(_existe(table, ident))

    @app.put(f"/api/{table}/{{ident}}")
    def maj(ident: int, corps: dict):
        _existe(table, ident)
        vals = _filtrer(table, corps)
        if table == "machines" and not vals.get("code_acces"):
            vals.pop("code_acces", None)  # champ laissé vide = on garde l'ancien code
        if table == "projets":
            vals["modifie"] = maintenant()
        db.modifier(table, ident, vals)
        if apres:
            apres(ident)
        return sortie(_existe(table, ident))

    @app.delete(f"/api/{table}/{{ident}}")
    def suppr(ident: int):
        _existe(table, ident)
        if table == "projets":
            for f in db.tous("SELECT * FROM fichiers WHERE projet_id = ?", (ident,)):
                _effacer_fichier_disque(f)
        db.supprimer(table, ident)
        if table == "machines":
            _synchro_parc()
        return {"ok": True}


def _apres_impression(ident):
    """Retire du stock les grammes d'une impression terminée (une seule fois)."""
    i = db.un("SELECT * FROM impressions WHERE id = ?", (ident,))
    if i and not i["stock_deduit"] and i["resultat"] in ("reussie", "ratee") and i["grammes"] and i["filament_id"]:
        total = i["grammes"] * (i["quantite"] or 1)
        db.executer("UPDATE filaments SET stock_g = MAX(0, stock_g - ?) WHERE id = ?", (total, i["filament_id"]))
        db.modifier("impressions", ident, {"stock_deduit": 1})


_crud("machines", "nom", sortie=_masquer, apres=lambda i: _synchro_parc())
_crud("filaments", "matiere, marque, couleur")
_crud("presets", "nom")
_crud("impressions", "COALESCE(debut, '') DESC, id DESC", apres=_apres_impression)


# ------------------------------------------------------------------ projets

@app.get("/api/projets")
def projets(q: str = ""):
    lignes = db.tous("""
        SELECT p.*, COUNT(f.id) AS nb_fichiers,
               (SELECT id FROM fichiers WHERE projet_id = p.id AND role = 'piece' ORDER BY id DESC LIMIT 1) AS fichier_vitrine
        FROM projets p LEFT JOIN fichiers f ON f.projet_id = p.id
        GROUP BY p.id ORDER BY p.modifie DESC""")
    if q:
        ql = q.lower()
        noms = {r["projet_id"] for r in db.tous("SELECT projet_id FROM fichiers WHERE lower(nom) LIKE ?", (f"%{ql}%",))}
        lignes = [p for p in lignes if ql in (p["nom"] + " " + p["tags"] + " " + p["description"]).lower() or p["id"] in noms]
    return lignes


_crud("projets", "modifie DESC")  # GET liste ci-dessus prioritaire (déclarée avant)


@app.get("/api/projets/{ident}/fichiers")
def fichiers_projet(ident: int):
    _existe("projets", ident)
    return db.tous("SELECT * FROM fichiers WHERE projet_id = ? ORDER BY role, nom, id", (ident,))


# ------------------------------------------------------------------ fichiers

def _nom_sur(nom):
    return re.sub(r"[^\w.\- ()+]", "_", Path(nom).name)[:150] or "fichier"


def _effacer_fichier_disque(f):
    chemin = FICHIERS / f["chemin"]
    autres = db.un("SELECT COUNT(*) AS n FROM fichiers WHERE chemin = ? AND id != ?", (f["chemin"], f["id"]))
    if chemin.exists() and not autres["n"]:
        chemin.unlink()
    (MINIATURES / f"{f['id']}.png").unlink(missing_ok=True)


def _analyser_plus_tard(fid, chemin, typ):
    def travail():
        meta, mini = analyser(chemin, typ)
        if mini:
            (MINIATURES / f"{fid}.png").write_bytes(mini)
            meta["miniature"] = True
        meta["analyse"] = "faite"
        db.modifier("fichiers", fid, {"meta": json.dumps(meta)})
    threading.Thread(target=travail, daemon=True).start()


def enregistrer_fichier(projet_id, nom, source, role="", parent_id=None, variante="", notes=""):
    """source : chemin d'un fichier ou objet fichier binaire. Utilisé par l'API et les scripts d'import."""
    _existe("projets", projet_id)
    nom = _nom_sur(nom)
    typ = type_fichier(nom)
    dossier = FICHIERS / str(projet_id)
    dossier.mkdir(parents=True, exist_ok=True)
    cible = dossier / f"{maintenant().replace(':', '')}_{nom}"
    n = 1
    while cible.exists():
        cible = dossier / f"{maintenant().replace(':', '')}-{n}_{nom}"
        n += 1
    h = hashlib.sha256()
    with open(cible, "wb") as out:
        src = open(source, "rb") if isinstance(source, (str, Path)) else source
        try:
            while bloc := src.read(1 << 20):
                h.update(bloc)
                out.write(bloc)
        finally:
            if isinstance(source, (str, Path)):
                src.close()
    fid = db.inserer("fichiers", {
        "projet_id": projet_id, "nom": nom, "type": typ, "role": role or ROLES.get(typ, "autre"),
        "chemin": str(cible.relative_to(FICHIERS)), "taille": cible.stat().st_size, "sha256": h.hexdigest(),
        "parent_id": parent_id or None, "variante": variante, "notes": notes,
        "meta": json.dumps({"analyse": "en_cours"}), "cree": maintenant()})
    db.modifier("projets", projet_id, {"modifie": maintenant()})
    _analyser_plus_tard(fid, cible, typ)
    return fid


@app.post("/api/projets/{ident}/fichiers")
async def televerser(ident: int, fichiers: list[UploadFile] = File(...), role: str = Form(""),
                     parent_id: str = Form(""), variante: str = Form(""), notes: str = Form("")):
    ids = []
    for f in fichiers:
        ids.append(enregistrer_fichier(ident, f.filename, f.file, role, int(parent_id) if parent_id else None,
                                       variante, notes))
    return [db.un("SELECT * FROM fichiers WHERE id = ?", (i,)) for i in ids]


@app.get("/api/fichiers")
def tous_fichiers():
    """Liste courte de tous les fichiers (pour les menus de choix)."""
    return db.tous("""SELECT f.id, f.nom, f.type, f.role, f.variante, f.projet_id, p.nom AS projet
                      FROM fichiers f JOIN projets p ON p.id = f.projet_id ORDER BY p.nom, f.nom""")


@app.get("/api/fichiers/{ident}")
def fichier(ident: int):
    f = _existe("fichiers", ident)
    f["variantes"] = db.tous("SELECT id, nom, variante, cree FROM fichiers WHERE parent_id = ?", (ident,))
    f["impressions"] = db.tous("SELECT * FROM impressions WHERE fichier_id = ? ORDER BY id DESC", (ident,))
    return f


@app.put("/api/fichiers/{ident}")
def maj_fichier(ident: int, corps: dict):
    _existe("fichiers", ident)
    vals = _filtrer("fichiers", corps)
    if vals.get("parent_id") == ident:
        raise HTTPException(400, "un fichier ne peut pas être sa propre variation")
    db.modifier("fichiers", ident, vals)
    return _existe("fichiers", ident)


@app.put("/api/fichiers/{ident}/reperes")
def maj_reperes(ident: int, corps: dict):
    """Repères numérotés posés sur la pièce : [{n, pos: [x, y, z], texte, valeur}]."""
    f = _existe("fichiers", ident)
    propres = []
    for i, r in enumerate(corps.get("reperes", [])[:40]):
        pos = r.get("pos")
        if not (isinstance(pos, list) and len(pos) == 3 and all(isinstance(v, (int, float)) for v in pos)):
            raise HTTPException(400, "position de repère invalide")
        propres.append({"n": i + 1, "pos": pos, "texte": str(r.get("texte", ""))[:120], "valeur": str(r.get("valeur", ""))[:60]})
    meta = {**f["meta"], "reperes": propres}
    db.modifier("fichiers", ident, {"meta": json.dumps(meta)})
    return propres


@app.delete("/api/fichiers/{ident}")
def suppr_fichier(ident: int):
    f = _existe("fichiers", ident)
    _effacer_fichier_disque(f)
    db.supprimer("fichiers", ident)
    return {"ok": True}


@app.get("/api/fichiers/{ident}/contenu")
def contenu(ident: int, telecharger: bool = False):
    f = _existe("fichiers", ident)
    chemin = FICHIERS / f["chemin"]
    if not chemin.exists():
        raise HTTPException(410, "fichier absent du disque")
    if telecharger:
        return FileResponse(chemin, filename=f["nom"])
    return FileResponse(chemin)


@app.get("/api/fichiers/{ident}/miniature")
def miniature(ident: int):
    p = MINIATURES / f"{ident}.png"
    if not p.exists():
        return Response(status_code=404)
    return FileResponse(p, media_type="image/png")


def estimer_grammes(meta, densite=1.24, remplissage=15, parois=2):
    """Estimation grossière : coque (surface × épaisseur des parois) + remplissage du reste."""
    vol = meta.get("volume_mm3")
    surf = meta.get("surface_mm2")
    if not vol or not surf:
        return None
    coque = min(vol, surf * parois * 0.45)
    return round((coque + (vol - coque) * remplissage / 100) * densite / 1000, 1)


@app.get("/api/fichiers/{ident}/compatibilite")
def compatibilite(ident: int):
    """Pour chaque machine : la pièce rentre-t-elle (en la tournant si besoin) ? + estimation matière et coût."""
    f = _existe("fichiers", ident)
    meta = f["meta"]
    dims = meta.get("dimensions")
    res = {"dimensions": dims, "machines": [], "estimation": []}
    for m in db.tous("SELECT * FROM machines ORDER BY nom"):
        vol = [m["volume_x"], m["volume_y"], m["volume_z"]]
        if not dims or None in vol:
            verdict, detail = "inconnu", "volume d'impression non renseigné" if dims else "pièce pas encore analysée"
        elif all(d <= v for d, v in zip(dims, vol)):
            verdict, detail = "ok", "rentre telle quelle"
        elif all(d <= v for d, v in zip(sorted(dims), sorted(vol))):
            verdict, detail = "tourner", "rentre en la faisant pivoter"
        else:
            verdict, detail = "trop_grand", "dépasse le volume d'impression"
        res["machines"].append({"id": m["id"], "nom": m["nom"], "volume": vol, "verdict": verdict, "detail": detail})
    for fil in db.tous("SELECT * FROM filaments ORDER BY matiere"):
        g = estimer_grammes(meta, fil["densite"] or 1.24)
        if g is not None:
            res["estimation"].append({"filament_id": fil["id"], "filament": f"{fil['matiere']} {fil['marque']} {fil['couleur']}".strip(),
                                      "grammes": g, "cout": round(g * (fil["prix_kg"] or 0) / 1000, 2),
                                      "stock_suffisant": (fil["stock_g"] or 0) >= g})
    return res


# ------------------------------------------------------------------ machines : état en direct

@app.get("/api/etat-machines")
def etat_machines():
    return {m["id"]: parc.etat(m["id"]) for m in db.tous("SELECT id FROM machines")}


@app.post("/api/machines/{ident}/commande/{action}")
def commande(ident: int, action: str):
    _existe("machines", ident)
    try:
        parc.commande(ident, action)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ------------------------------------------------------------------ tableau de bord

@app.get("/api/tableau")
def tableau():
    imp = db.tous("SELECT * FROM impressions")
    finies = [i for i in imp if i["resultat"] in ("reussie", "ratee")]
    reussies = [i for i in finies if i["resultat"] == "reussie"]
    prix = {f["id"]: f["prix_kg"] or 0 for f in db.tous("SELECT id, prix_kg FROM filaments")}
    grammes = sum((i["grammes"] or 0) * (i["quantite"] or 1) for i in finies)
    cout = sum((i["grammes"] or 0) * (i["quantite"] or 1) * prix.get(i["filament_id"], 0) / 1000 for i in finies)
    return {
        "projets": db.un("SELECT COUNT(*) n FROM projets WHERE statut != 'archive'")["n"],
        "fichiers": db.un("SELECT COUNT(*) n FROM fichiers")["n"],
        "machines": db.un("SELECT COUNT(*) n FROM machines")["n"],
        "impressions": len(imp),
        "taux_reussite": round(100 * len(reussies) / len(finies)) if finies else None,
        "grammes": round(grammes), "cout": round(cout, 2),
        "heures": round(sum((i["duree_min"] or 0) * 1 for i in finies) / 60, 1),
        "stock_bas": db.tous("SELECT * FROM filaments WHERE stock_g < 200 ORDER BY stock_g"),
        "a_imprimer": db.tous("""SELECT i.*, f.nom AS fichier_nom, m.nom AS machine_nom FROM impressions i
                                LEFT JOIN fichiers f ON f.id = i.fichier_id LEFT JOIN machines m ON m.id = i.machine_id
                                WHERE i.resultat IN ('prevue', 'en_cours') ORDER BY i.id"""),
        "recentes": db.tous("""SELECT i.*, f.nom AS fichier_nom, f.projet_id, m.nom AS machine_nom FROM impressions i
                              LEFT JOIN fichiers f ON f.id = i.fichier_id LEFT JOIN machines m ON m.id = i.machine_id
                              WHERE i.resultat NOT IN ('prevue', 'en_cours') ORDER BY COALESCE(i.debut, '') DESC, i.id DESC LIMIT 8"""),
    }


@app.get("/api/sauvegarde")
def sauvegarde():
    """Archive zip de tout le dossier data (base + fichiers)."""
    base = DONNEES.parent / "sauvegarde-atelier3d"
    archive = shutil.make_archive(str(base), "zip", DONNEES)
    return FileResponse(archive, filename=f"atelier3d-{maintenant()[:10]}.zip")
