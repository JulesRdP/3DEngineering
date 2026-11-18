# Atelier 3D

Appli web locale pour l'impression 3D de l'équipe : projets, fichiers (STL, 3MF, STEP, G-code, PDF, FeatureScript)
avec variations, visionneuse 3D, machines (état en direct des Bambu Lab en réseau local), filaments, presets
machine × filament et journal d'impression.

## Lancer

    ./lancer.sh            # Linux / macOS
    lancer.bat             # Windows (double-clic possible)

Puis http://<ip-du-pc>:8030 depuis n'importe quel poste du réseau. Python 3 doit être installé.

Les données (base SQLite + fichiers + miniatures) sont dans `data/`. Sauvegarde : lien en bas du menu.

## Ce que fait l'appli

- **Projets** : fiche, étiquettes, lien CAO, dépôt de fichiers par glisser-déposer, rangement par rôle
  (pièces, plans, sources, G-code, photos), arbre des variations.
- **Fichiers** : dimensions, volume, surface, triangles et miniature calculés au dépôt. Pour un 3MF de
  Bambu Studio / OrcaSlicer : imprimante, profils, couche, remplissage, durée et poids estimés.
  « Sur quelles machines ? » compare la pièce au volume de chaque imprimante (rentre / à tourner / trop grand).
  Estimation matière et coût par filament.
- **Repères et plans** : dans la vue 3D d'une pièce, « Poser un repère » puis clic sur la pièce pour numéroter une
  zone (nom + réglage). L'onglet « Plan » génère une planche A4 : vue principale (plus grande face), côté, dessus,
  perspective, à l'échelle commune, cotes d'encombrement, repères et cartouche ; PNG téléchargeable ou rangé
  dans « Plans et documents » du projet.
- **Aperçu 3D du projet** : toutes les pièces dans une même scène, dans leur position CAO (dernières versions cochées).
- **Machines** : pilote `bambu_lan` (MQTT TLS port 8883, IP + numéro de série + code d'accès), `moonraker`
  (Klipper) ou `manuel`. Pause / reprise / arrêt depuis l'appli.
- **Filaments** : stock en grammes, déduit automatiquement quand une impression est notée réussie ou ratée.
- **Presets** : réglages éprouvés par couple machine × filament, copiables en fiche texte.
- **Journal** : file d'attente, historique, taux de réussite, consommation et coût.

## Outils

    .venv/bin/python -m outils.importer_poignee   # premier remplissage (machines, filaments, projet Poignée Dex1)
    .venv/bin/python -m outils.reanalyser         # recalcule dimensions et miniatures
    .venv/bin/python -m pytest -q tests

## Limites connues

- Pas de comptes ni de mot de passe : à n'ouvrir que sur le réseau local. Les codes d'accès Bambu sont
  stockés en clair dans `data/atelier.db` (jamais renvoyés au navigateur).
- Anycubic d'origine : pas d'API locale ouverte, état manuel (Klipper/Rinkhals : pilote `moonraker`).
- Pas de tranchage intégré ni d'envoi de fichier aux imprimantes (prévu plus tard).
