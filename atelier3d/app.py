"""Atelier 3D : serveur web local (FastAPI) pour les projets d'impression 3D de l'équipe."""
import hashlib
import json
import os
import re
import shutil
import threading
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import reglages
from .db import Base, maintenant
from .machines import Parc
from .mesh import ROLES, analyser, type_fichier

ICI = Path(__file__).parent
DONNEES = Path(os.environ.get("ATELIER3D_DONNEES", ICI.parent / "data"))
FICHIERS = DONNEES / "fichiers"
MINIATURES = DONNEES / "miniatures"
PHOTOS_MACHINES = DONNEES / "machines"   # photo de chaque imprimante (facultative) : <machine_id>.<ext>
IMAGES_MODELES = DONNEES / "modeles"     # image d'un modèle, pour toutes ses machines : <marque-modele>.<ext>
PLANS = DONNEES / "plans"          # plans générés par le navigateur, gardés : <fichier_id>.json

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


@app.middleware("http")
async def sans_cache_perime(requete, appel):
    """Interface et miniatures : le navigateur revérifie à chaque fois (réponse 304 si rien n'a changé).
    Sans cela, il gardait d'anciens modules JS après une mise à jour de l'appli, même après Ctrl+F5."""
    reponse = await appel(requete)
    chemin = requete.url.path
    if chemin == "/" or chemin.startswith("/static/") or chemin.endswith("/miniature"):
        reponse.headers["Cache-Control"] = "no-cache"
    return reponse


app.add_middleware(GZipMiddleware, minimum_size=20000)   # traits des jumeaux 3D (JSON ~1 Mo → ~300 ko)
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
    """Le code d'accès ne repart pas vers le navigateur, on indique juste s'il est renseigné.
    Ajoute l'adresse de la photo de la machine (avec sa date, pour ne pas revoir l'ancienne) ou None."""
    m = dict(m)
    m["code_acces_renseigne"] = bool(m.pop("code_acces", ""))
    photo = _photo_machine(m["id"])
    cle = cle_modele(m.get("marque"), m.get("modele"))
    image = _image_modele(cle) if cle else None
    m["photo_propre"] = bool(photo)
    traits = IMAGES_MODELES / f"{cle}.traits.json" if cle else None
    m["jumeau"] = f"/api/modeles/{cle}/traits?v={int(traits.stat().st_mtime)}" if traits and traits.exists() else None
    m["cle_modele"] = cle
    m["photo"] = (f"/api/machines/{m['id']}/photo?v={int(photo.stat().st_mtime)}" if photo
                  else f"/api/modeles/{cle}/image?v={int(image.stat().st_mtime)}" if image else None)
    return m


def cle_modele(marque, modele):
    """« Bambu Lab » + « A1 mini » → « bambu-lab-a1-mini » (vide si le modèle n'est pas renseigné)."""
    if not (modele or "").strip():
        return ""
    return re.sub(r"[^a-z0-9]+", "-", f"{marque or ''} {modele}".lower()).strip("-")


def _image_modele(cle):
    return next((p for p in IMAGES_MODELES.glob(f"{cle}.*") if p.suffix in FORMATS_PHOTO), None) \
        if IMAGES_MODELES.exists() and re.fullmatch(r"[a-z0-9-]+", cle or "") else None


FORMATS_PHOTO = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def _photo_machine(ident):
    return next((p for p in PHOTOS_MACHINES.glob(f"{ident}.*") if p.suffix in FORMATS_PHOTO), None) \
        if PHOTOS_MACHINES.exists() else None


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
        if table == "machines" and (photo := _photo_machine(ident)):
            photo.unlink()
        if apres:
            apres(ident)
        return {"ok": True}


def _apres_impression(ident):
    """Après chaque écriture d'une impression (ou sa suppression) : date de début d'une impression lancée,
    stock retiré une seule fois à la fin, état des machines sans connexion tenu à jour."""
    i = db.un("SELECT * FROM impressions WHERE id = ?", (ident,))
    if i and i["resultat"] == "en_cours" and not i["debut"]:
        db.modifier("impressions", ident, {"debut": maintenant()})
    if i and not i["stock_deduit"] and i["resultat"] in ("reussie", "ratee") and i["grammes"] and i["filament_id"]:
        total = i["grammes"] * (i["quantite"] or 1)
        db.executer("UPDATE filaments SET stock_g = MAX(0, stock_g - ?) WHERE id = ?", (total, i["filament_id"]))
        db.modifier("impressions", ident, {"stock_deduit": 1})
    _occupation_machines_manuelles()


def _occupation_machines_manuelles():
    """Une machine sans connexion est « occupée » tant qu'une impression y est en cours, « libre » ensuite.
    Maintenance et hors service ne sont jamais touchés."""
    change = False
    for m in db.tous("SELECT id, statut_manuel FROM machines WHERE pilote = 'manuel'"):
        occupee = db.un("SELECT 1 FROM impressions WHERE machine_id = ? AND resultat = 'en_cours'", (m["id"],))
        if m["statut_manuel"] not in ("libre", "occupee"):
            continue
        voulu = "occupee" if occupee else "libre"
        if voulu != m["statut_manuel"]:
            db.modifier("machines", m["id"], {"statut_manuel": voulu})
            change = True
    if change:
        _synchro_parc()


@app.get("/api/machines/{ident}/photo")
def photo_machine(ident: int):
    p = _photo_machine(ident)
    if not p:
        raise HTTPException(404, "pas de photo")
    return FileResponse(p, media_type=FORMATS_PHOTO[p.suffix])


@app.put("/api/machines/{ident}/photo")
async def deposer_photo_machine(ident: int, photo: UploadFile = File(...)):
    """Photo de l'imprimante (remplace le dessin) : JPEG, PNG ou WebP, 8 Mo au plus."""
    _existe("machines", ident)
    ext = _lire_image(photo, contenu := await photo.read())
    PHOTOS_MACHINES.mkdir(parents=True, exist_ok=True)
    if ancienne := _photo_machine(ident):
        ancienne.unlink()
    (PHOTOS_MACHINES / f"{ident}{ext}").write_bytes(contenu)
    return _masquer(_existe("machines", ident))


@app.delete("/api/machines/{ident}/photo")
def supprimer_photo_machine(ident: int):
    _existe("machines", ident)
    if p := _photo_machine(ident):
        p.unlink()
    return _masquer(_existe("machines", ident))


def _lire_image(photo: UploadFile, contenu: bytes):
    ext = Path(photo.filename or "").suffix.lower()
    if ext not in FORMATS_PHOTO:
        raise HTTPException(400, "image attendue : JPEG, PNG ou WebP")
    if len(contenu) > 8_000_000:
        raise HTTPException(400, "image trop lourde (8 Mo au plus)")
    return ".jpg" if ext == ".jpeg" else ext


@app.get("/api/modeles/{cle}/image")
def image_modele(cle: str):
    p = _image_modele(cle)
    if not p:
        raise HTTPException(404, "pas d'image pour ce modèle")
    return FileResponse(p, media_type=FORMATS_PHOTO[p.suffix])


@app.get("/api/modeles/{cle}/traits")
def traits_modele(cle: str):
    """Jumeau en traits du modèle (outils/step_en_traits.py) : arêtes CAO par pièce, groupes mobiles, buse, plaque."""
    p = IMAGES_MODELES / f"{cle}.traits.json"
    if not re.fullmatch(r"[a-z0-9-]+", cle) or not p.exists():
        raise HTTPException(404, "pas de modèle 3D pour ce modèle d'imprimante")
    return FileResponse(p, media_type="application/json")


@app.put("/api/modeles/{cle}/image")
async def deposer_image_modele(cle: str, photo: UploadFile = File(...)):
    """Image d'un modèle d'imprimante (de préférence sur fond transparent), montrée pour toutes ses machines
    qui n'ont pas leur propre photo."""
    if not re.fullmatch(r"[a-z0-9-]+", cle):
        raise HTTPException(400, "modèle invalide")
    ext = _lire_image(photo, contenu := await photo.read())
    IMAGES_MODELES.mkdir(parents=True, exist_ok=True)
    if ancienne := _image_modele(cle):
        ancienne.unlink()
    (IMAGES_MODELES / f"{cle}{ext}").write_bytes(contenu)
    return {"ok": True}


@app.delete("/api/modeles/{cle}/image")
def supprimer_image_modele(cle: str):
    if p := _image_modele(cle):
        p.unlink()
    return {"ok": True}


@app.post("/api/impressions/{ident}/lancer")
def lancer_impression(ident: int):
    """Une impression prévue part sur sa machine maintenant."""
    i = _existe("impressions", ident)
    if i["resultat"] != "prevue":
        raise HTTPException(400, "seule une impression prévue peut être lancée")
    db.modifier("impressions", ident, {"resultat": "en_cours", "debut": maintenant()})
    _apres_impression(ident)
    return _existe("impressions", ident)


@app.post("/api/impressions/{ident}/terminer")
def terminer_impression(ident: int, corps: dict):
    """Fin d'une impression en un clic : {resultat: reussie | ratee | annulee, notes?}.
    Durée laissée vide = estimation du trancheur (3MF) si elle existe, sinon temps écoulé depuis le début."""
    i = _existe("impressions", ident)
    resultat = corps.get("resultat")
    if resultat not in ("reussie", "ratee", "annulee"):
        raise HTTPException(400, "résultat attendu : reussie, ratee ou annulee")
    if i["resultat"] not in ("prevue", "en_cours"):
        raise HTTPException(400, "impression déjà terminée")
    vals = {"resultat": resultat}
    if corps.get("notes"):
        vals["notes"] = "\n".join(x for x in (i["notes"], corps["notes"].strip()) if x)
    if i["duree_min"] is None and i["resultat"] == "en_cours" and resultat != "annulee":
        f = db.un("SELECT meta FROM fichiers WHERE id = ?", (i["fichier_id"],)) if i["fichier_id"] else None
        estime = ((f or {}).get("meta") or {}).get("reglages_3mf", {}).get("duree_estimee_s")
        if estime:
            vals["duree_min"] = round(estime / 60 * (i["quantite"] or 1))
        elif i["debut"]:
            try:
                vals["duree_min"] = max(1, round((datetime.now() - datetime.fromisoformat(i["debut"])).total_seconds() / 60))
            except ValueError:
                pass
    db.modifier("impressions", ident, vals)
    _apres_impression(ident)
    return _existe("impressions", ident)


@app.put("/api/machines/ordre")
def ordonner_machines(corps: dict):
    """{ids: [id, …]} dans l'ordre voulu (glisser-déposer) ; les machines absentes de la liste passent après."""
    ids = corps.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        raise HTTPException(400, "ids attendu : liste d'identifiants")
    connues = {m["id"] for m in db.tous("SELECT id FROM machines")}
    if set(ids) - connues:
        raise HTTPException(404, f"machine(s) inconnue(s) : {sorted(set(ids) - connues)}")
    db.executer("UPDATE machines SET ordre = NULL")
    for rang, i in enumerate(dict.fromkeys(ids)):
        db.modifier("machines", i, {"ordre": rang})
    return [_masquer(m) for m in db.tous(f"SELECT * FROM machines ORDER BY {ORDRE_MACHINES}")]


ORDRE_MACHINES = "ordre IS NULL, ordre, nom"
_crud("machines", ORDRE_MACHINES, sortie=_masquer, apres=lambda i: _synchro_parc())
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
    (PLANS / f"{int(f['id'])}.json").unlink(missing_ok=True)


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


CARTOUCHE = ["dessinateur", "verificateur", "date_verif", "matiere", "filament_id", "numero", "indice", "tolerance", "societe"]


PLAN_MAX_OCTETS = 40_000_000


@app.get("/api/fichiers/{ident}/plan")
def plan_garde(ident: int):
    """Plan déjà généré pour ce fichier : {cle, cree, feuilles: [données du traceur]}, ou {} s'il n'y en a pas.
    La clé (calculée par le navigateur) dit avec quoi il a été fait : s'il ne correspond plus, l'interface propose
    de le mettre à jour au lieu de le recalculer d'office."""
    _existe("fichiers", ident)
    chemin = PLANS / f"{ident}.json"
    return Response(chemin.read_bytes() if chemin.exists() else b"{}", media_type="application/json")


@app.put("/api/fichiers/{ident}/plan")
def garder_plan(ident: int, corps: dict):
    _existe("fichiers", ident)
    cle, feuilles = corps.get("cle"), corps.get("feuilles")
    if not isinstance(cle, str) or not cle or not isinstance(feuilles, list) or not 1 <= len(feuilles) <= 10:
        raise HTTPException(400, "clé et 1 à 10 feuilles attendues")
    if not all(isinstance(F, dict) and isinstance(F.get("ops"), list) for F in feuilles):
        raise HTTPException(400, "feuille invalide")
    donnees = json.dumps({"cle": cle[:300], "cree": maintenant(), "feuilles": feuilles}, separators=(",", ":")).encode()
    if len(donnees) > PLAN_MAX_OCTETS:
        raise HTTPException(413, "plan trop volumineux")
    PLANS.mkdir(parents=True, exist_ok=True)
    temp = PLANS / f"{ident}.json.tmp"
    temp.write_bytes(donnees)
    temp.replace(PLANS / f"{ident}.json")
    return {"cle": cle[:300], "octets": len(donnees)}


@app.put("/api/fichiers/{ident}/cartouche")
def maj_cartouche(ident: int, corps: dict):
    """Champs du cartouche du plan (texte court) ; la masse se déduit du filament choisi."""
    f = _existe("fichiers", ident)
    propres = {k: str(corps[k])[:80] for k in CARTOUCHE if corps.get(k) not in (None, "")}
    if "filament_id" in propres:
        fil = db.un("SELECT * FROM filaments WHERE id = ?", (int(propres["filament_id"]),))
        if not fil:
            raise HTTPException(400, "filament inconnu")
        propres.setdefault("matiere", f"{fil['matiere']} {fil['marque']} {fil['couleur']}".strip())
    db.modifier("fichiers", ident, {"meta": json.dumps({**f["meta"], "cartouche": propres})})
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
    for m in db.tous(f"SELECT * FROM machines ORDER BY {ORDRE_MACHINES}"):
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
        "stock_bas": db.tous("SELECT * FROM filaments WHERE stock_g < ? ORDER BY stock_g",
                             (reglages.valeur(db, "general.filaments.stock_bas"),)),
        "a_imprimer": db.tous("""SELECT i.*, f.nom AS fichier_nom, m.nom AS machine_nom FROM impressions i
                                LEFT JOIN fichiers f ON f.id = i.fichier_id LEFT JOIN machines m ON m.id = i.machine_id
                                WHERE i.resultat IN ('prevue', 'en_cours') ORDER BY i.id"""),
        "recentes": db.tous("""SELECT i.*, f.nom AS fichier_nom, f.projet_id, m.nom AS machine_nom FROM impressions i
                              LEFT JOIN fichiers f ON f.id = i.fichier_id LEFT JOIN machines m ON m.id = i.machine_id
                              WHERE i.resultat NOT IN ('prevue', 'en_cours') ORDER BY COALESCE(i.debut, '') DESC, i.id DESC LIMIT 8"""),
    }


# ------------------------------------------------------------------ réglages

@app.get("/api/reglages")
def lire_reglages():
    """La liste rangée des réglages (pour construire la page) et leurs valeurs actuelles."""
    return {"sections": reglages.SECTIONS, "valeurs": reglages.toutes(db)}


@app.put("/api/reglages")
def maj_reglages(corps: dict):
    """{clé: valeur} ; null remet la valeur par défaut. Tout est refusé si une valeur est invalide."""
    try:
        return {"valeurs": reglages.modifier(db, corps)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/sauvegarde")
def sauvegarde():
    """Archive zip de tout le dossier data (base + fichiers)."""
    base = DONNEES.parent / "sauvegarde-atelier3d"
    archive = shutil.make_archive(str(base), "zip", DONNEES)
    return FileResponse(archive, filename=f"atelier3d-{maintenant()[:10]}.zip")
