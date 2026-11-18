"""Premier remplissage : machines de l'atelier, filaments, et le projet « Poignée Dex1 » avec ses fichiers.

Usage : .venv/bin/python -m outils.importer_poignee   (depuis ~/atelier3d, serveur arrêté ou non)
Relançable : ne recrée pas ce qui existe déjà (repère par nom).
"""
import time
from pathlib import Path

from atelier3d import app as A

TELE = Path.home() / "Téléchargements"
SOURCES = Path.home() / "poignee-dex1"


def un(table, nom_col, nom, valeurs):
    ligne = A.db.un(f"SELECT * FROM {table} WHERE {nom_col} = ?", (nom,))
    if ligne:
        return ligne["id"]
    return A.db.inserer(table, {nom_col: nom, **valeurs})


def main():
    A.FICHIERS.mkdir(parents=True, exist_ok=True)
    A.MINIATURES.mkdir(parents=True, exist_ok=True)

    # Machines vues dans les 3MF du poste (code d'accès et IP à compléter dans l'appli)
    un("machines", "nom", "Bambu A1 mini", {"marque": "Bambu Lab", "modele": "A1 mini", "volume_x": 180, "volume_y": 180,
                                           "volume_z": 180, "pilote": "bambu_lan", "notes": "IP, numéro de série et code d'accès à renseigner"})
    un("machines", "nom", "Bambu P1S", {"marque": "Bambu Lab", "modele": "P1S", "volume_x": 256, "volume_y": 256,
                                       "volume_z": 256, "pilote": "bambu_lan", "notes": "IP, numéro de série et code d'accès à renseigner"})
    un("machines", "nom", "Anycubic Kobra X", {"marque": "Anycubic", "modele": "Kobra X", "pilote": "manuel",
                                              "notes": "volume d'impression à renseigner"})
    pla = un("filaments", "couleur", "Basic (à préciser)", {"matiere": "PLA", "marque": "Bambu", "couleur_hex": "#f0f0f0",
                                                            "densite": 1.24, "temp_buse": 220, "temp_plateau": 60, "stock_g": 1000, "prix_kg": 20})
    un("filaments", "couleur", "Anycubic (à préciser)", {"matiere": "PLA", "marque": "Anycubic", "couleur_hex": "#333333",
                                                         "densite": 1.24, "temp_buse": 210, "temp_plateau": 60, "stock_g": 1000, "prix_kg": 18})

    if A.db.un("SELECT id FROM projets WHERE nom = ?", ("Poignée Dex1",)):
        print("Projet déjà importé")
        return
    pid = A.db.inserer("projets", {
        "nom": "Poignée Dex1", "statut": "en_cours", "tags": "G1-D, pince Dex1-1, calibration, outillage",
        "lien_cao": "https://cad.onshape.com/documents/3f07e602ca2414a811c2ff32/w/cad2624262c039e12ee01976",
        "description": "Poignée moulée sur la pince Unitree Dex1-1 fermée (tenon dans la fenêtre des mors, flasques, nez).\n"
                       "Réglages validés : jeu 1,9 · retrait 2 · paroi 3 · flasques 0,5 · tenon +1,5.\n"
                       "V7 : plateau de calibration 200 × 200 (empreinte papier 180,05 × 2) monté sur glissière avec clé de butée "
                       "et deux clips à demi-boule.",
        "cree": A.maintenant(), "modifie": A.maintenant()})

    def ajout(chemin, **kw):
        if chemin.exists():
            return A.enregistrer_fichier(pid, chemin.name, chemin, **kw)
        print("absent :", chemin)

    # Pièces : la lignée de la poignée seule, puis la raquette et ses deux pièces séparées
    precedent = None
    for i, nom in enumerate(["Part Studio 1 - Poignee Dex1.stl"] + [f"Part Studio 1 - Poignee Dex1 ({n}).stl" for n in range(1, 5)]):
        fid = ajout(TELE / nom, parent_id=precedent, variante="" if i == 0 else f"essai {i + 1}",
                    notes="Réglages validés (la pince tient parfaitement)" if i == 4 else "")
        precedent = fid or precedent
    raquette = ajout(TELE / "Part Studio 1 - Poignee Dex1 Raquette.stl", parent_id=precedent, variante="raquette d'un bloc",
                     notes="Trop grande pour l'imprimante : remplacée par Support + Plateau")
    ajout(TELE / "Part Studio 1 - Poignee Dex1 Support.stl", parent_id=raquette, variante="support à glissière")
    ajout(TELE / "Part Studio 1 - Plateau calibration.stl", parent_id=raquette, variante="plateau séparé")
    # Sources FeatureScript
    for v in ["v3_base", "v7"]:
        ajout(SOURCES / f"poignee_dex1_{v}.fs", notes="FeatureScript Onshape")
    A.db.inserer("presets", {"nom": "PLA pièces fonctionnelles", "filament_id": pla, "hauteur_couche": 0.2, "remplissage": 30,
                             "motif": "gyroid", "parois": 3, "temp_buse": 220, "temp_plateau": 60, "supports": "non",
                             "adherence": "aucune", "notes": "Poignée : imprimer couchée sur une flasque. Support : languettes dans le plan du plateau."})
    time.sleep(3)  # laisser finir les analyses en arrière-plan
    print("Projet importé :", pid)


if __name__ == "__main__":
    main()
