"""Réglages de l'appli : une seule liste, rangée en sections et groupes, d'où la page Réglages est construite.

Pour ajouter un réglage : une ligne dans le bon groupe (clé unique « section.groupe.nom »), puis le lire avec
`valeur(db, cle)` côté serveur ou `reglage(cle)` côté navigateur. Les valeurs sont communes à tout l'atelier
(table `reglages`) ; une clé absente vaut sa valeur par défaut.
"""
import json

SECTIONS = [
    {"id": "plans", "titre": "Plans", "groupes": [
        {"titre": "Pièce 3D sous les vues", "aide": "Clic sur une vue du plan : la pièce sort de l'aperçu 3D et vient se poser sous le dessin.",
         "reglages": [
             {"cle": "plans.piece.duree_vol", "libelle": "Durée du vol vers la vue", "type": "nombre", "unite": "s",
              "min": 0, "max": 6, "pas": 0.1, "defaut": 1.6, "aide": "0 = la pièce apparaît directement à sa place."},
             {"cle": "plans.piece.tour", "libelle": "Tour complet pendant le vol", "type": "booleen", "defaut": True},
             {"cle": "plans.piece.effacement", "libelle": "Durée avant effacement de la pièce", "type": "nombre", "unite": "s",
              "min": 0, "max": 300, "pas": 1, "defaut": 8, "aide": "0 = elle reste jusqu'au prochain clic (ou Échap)."},
             {"cle": "plans.piece.opacite", "libelle": "Opacité de la pièce posée", "type": "nombre", "unite": "%",
              "min": 20, "max": 100, "pas": 5, "defaut": 80, "aide": "Plus faible, le dessin reste mieux lisible à travers."},
         ]},
        {"titre": "Affichage à l'écran", "reglages": [
            {"cle": "plans.ecran.feuille", "libelle": "Feuille à l'écran", "type": "choix", "defaut": "Sans fond",
             "choix": ["Sans fond", "Papier blanc"],
             "aide": "Sans fond : traits clairs sur l'interface sombre. Le PDF et le PNG restent sur papier blanc."},
            {"cle": "plans.apercu.ouvert", "libelle": "Panneau d'aperçu 3D ouvert à côté du plan", "type": "booleen", "defaut": True},
        ]},
        {"titre": "Cartouche par défaut", "aide": "Repris sur chaque nouveau plan ; modifiable plan par plan avec « Cartouche… ».",
         "reglages": [
             {"cle": "plans.cartouche.societe", "libelle": "Organisme", "type": "texte", "defaut": "Atelier 3D", "max": 40},
             {"cle": "plans.cartouche.dessinateur", "libelle": "Dessiné par", "type": "texte", "defaut": "", "max": 40},
             {"cle": "plans.cartouche.tolerance", "libelle": "Tolérances générales", "type": "choix", "defaut": "ISO 2768-m",
              "choix": ["ISO 2768-f", "ISO 2768-m", "ISO 2768-c", "ISO 2768-v", "ISO 2768-mK"],
              "aide": "f fine, m moyenne, c grossière, v très grossière (K : tolérances géométriques)."},
         ]},
    ]},
    {"id": "vue3d", "titre": "Vue 3D", "groupes": [
        {"titre": "Affichage par défaut",
         "aide": "Pour tout l'atelier. Chacun peut changer l'affichage avec la barre en haut à droite de la vue 3D : "
                 "ce choix est retenu par son navigateur (« Revenir aux réglages de l'atelier » pour l'oublier).",
         "reglages": [
             {"cle": "vue3d.affichage.style", "libelle": "Style d'affichage", "type": "choix", "defaut": "Ombré avec arêtes",
              "choix": ["Ombré", "Ombré avec arêtes", "Lignes cachées supprimées", "Lignes cachées apparentes", "Filaire"],
              "aide": "Comme dans un logiciel de CAO : les arêtes et contours soulignent les formes."},
             {"cle": "vue3d.affichage.couleur", "libelle": "Couleur des pièces", "type": "choix", "defaut": "Couleur des pièces",
              "choix": ["Couleur des pièces", "Gris CAO"], "aide": "Gris CAO : teinte neutre où les reliefs se lisent le mieux."},
             {"cle": "vue3d.affichage.contraste", "libelle": "Contraste des reliefs", "type": "nombre", "unite": "%",
              "min": 0, "max": 100, "pas": 5, "defaut": 50, "aide": "Plus fort : faces à l'ombre plus sombres, lumière plus directionnelle."},
             {"cle": "vue3d.affichage.reflets", "libelle": "Reflets", "type": "nombre", "unite": "%",
              "min": 0, "max": 100, "pas": 5, "defaut": 30, "aide": "0 = mat comme du PLA ; 100 = brillant, reflets de studio."},
         ]},
    ]},
    {"id": "general", "titre": "Général", "groupes": [
        {"titre": "Filaments", "reglages": [
            {"cle": "general.filaments.stock_bas", "libelle": "Seuil de stock bas", "type": "nombre", "unite": "g",
             "min": 0, "max": 5000, "pas": 10, "defaut": 200, "aide": "En dessous, le filament est signalé sur le tableau de bord."},
        ]},
    ]},
]

DEFINITIONS = {r["cle"]: r for s in SECTIONS for g in s["groupes"] for r in g["reglages"]}


def valider(cle, v):
    """Valeur propre pour ce réglage, ou ValueError avec un message lisible."""
    d = DEFINITIONS.get(cle)
    if not d:
        raise ValueError(f"réglage inconnu : {cle}")
    t = d["type"]
    if t == "booleen":
        if not isinstance(v, bool):
            raise ValueError(f"{d['libelle']} : oui ou non attendu")
        return v
    if t == "nombre":
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ValueError(f"{d['libelle']} : nombre attendu")
        if not d["min"] <= v <= d["max"]:
            raise ValueError(f"{d['libelle']} : entre {d['min']} et {d['max']} {d.get('unite', '')}".strip())
        return v
    if t == "choix":
        if v not in d["choix"]:
            raise ValueError(f"{d['libelle']} : valeur non proposée")
        return v
    if not isinstance(v, str) or len(v) > d.get("max", 200):
        raise ValueError(f"{d['libelle']} : texte de {d.get('max', 200)} caractères au plus")
    return v.strip()


def toutes(db):
    """Toutes les valeurs (enregistrées, sinon par défaut)."""
    enregistrees = {r["cle"]: json.loads(r["valeur"]) for r in db.tous("SELECT * FROM reglages")}
    return {cle: enregistrees.get(cle, d["defaut"]) for cle, d in DEFINITIONS.items()}


def valeur(db, cle):
    r = db.un("SELECT valeur FROM reglages WHERE cle = ?", (cle,))
    return json.loads(r["valeur"]) if r else DEFINITIONS[cle]["defaut"]


def modifier(db, changements: dict):
    """Applique {clé: valeur} (None = retour à la valeur par défaut), tout ou rien."""
    propres = {}
    for cle, v in changements.items():
        if cle not in DEFINITIONS:
            raise ValueError(f"réglage inconnu : {cle}")
        propres[cle] = None if v is None else valider(cle, v)
    for cle, v in propres.items():
        if v is None:
            db.executer("DELETE FROM reglages WHERE cle = ?", (cle,))
        else:
            db.executer("INSERT INTO reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
                        (cle, json.dumps(v)))
    return toutes(db)
