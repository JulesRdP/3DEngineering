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

- **Projets** : création avec le modèle 3D d'emblée (champ du formulaire, ou modèle glissé sur la page Projets :
  le projet prend son nom et s'ouvre sur la pièce), fiche, étiquettes, lien CAO, dépôt de fichiers par glisser-déposer, rangement par rôle
  (pièces, plans, sources, G-code, photos), arbre des variations.
- **Fichiers** : dimensions, volume, surface, triangles et miniature calculés au dépôt. Pour un 3MF de
  Bambu Studio / OrcaSlicer : imprimante, profils, couche, remplissage, durée et poids estimés.
  « Sur quelles machines ? » compare la pièce au volume de chaque imprimante (rentre / à tourner / trop grand).
  Estimation matière et coût par filament.
- **Repères et plans** : dans la vue 3D d'une pièce, « Poser un repère » puis clic sur la pièce pour numéroter une
  zone (nom + réglage). L'onglet « Plan » produit un dessin de définition selon les normes du dessin industriel :
  - projection européenne : vue de face, vue de dessus dessous, vue de gauche à droite (remplacée par une coupe
    A–A hachurée par l'axe d'un perçage quand il y en a) ; vue isométrique en illustration ;
  - traits ISO 128 : arêtes vues en trait fort, cachées en interrompu fin, axes en mixte fin ;
  - cotation en cotes d'origine depuis les faces de la pièce, chaque cote une seule fois, dans la vue où la forme
    est vue en vraie grandeur ; Ø, lamages (⌴ ↧), oblongs, rayons et chanfreins indiqués par lignes de repère ;
  - plusieurs feuilles quand cela permet une plus grande échelle : face + coupe sur la feuille 1, vue de dessus
    (désignée par une flèche de référence) et vue isométrique sur la feuille 2 ;
  - aperçu net à tout zoom : molette pour zoomer autour du curseur, glisser pour se déplacer, double-clic pour
    revoir la feuille entière, bouton plein écran ;
  - aperçu 3D manipulable à côté du plan ; clic sur une vue du plan : la pièce sort de l'aperçu, fait un tour
    complet et se pose exactement sous le dessin de cette vue (même orientation, échelle et position ; coupée
    pour une coupe), puis y retourne après le délai réglé (nouveau clic, clic à côté ou Échap : tout de suite) ;
  - format A4 portrait ou A3 paysage, échelle normalisée (la plus grande qui tient), cadre avec zones de repérage,
    cartouche (désignation, n° de plan, matière, masse, échelle, symbole de projection, tolérances ISO 2768…)
    rempli avec le bouton « Cartouche… ».

  Les trous, oblongs et arrondis sont reconnus dans le maillage au dépôt (quel que soit l'axe). Les cotes sont
  mesurées sur le STL / 3MF : exactes pour un export CAO ; cônes (fraisures) et surfaces libres non reconnus.
  PDF vectoriel téléchargeable ou rangé dans « Plans et documents » du projet. Après une mise à jour, lancer
  `outils.reanalyser` pour les fichiers déjà déposés.
- **Aperçu 3D du projet** : toutes les pièces dans une même scène, dans leur position CAO (dernières versions cochées).
- **Machines** : pilote `bambu_lan` (MQTT TLS port 8883, IP + numéro de série + code d'accès), `moonraker`
  (Klipper) ou `manuel`. Pause / reprise / arrêt depuis l'appli.
- **Filaments** : stock en grammes, déduit automatiquement quand une impression est notée réussie ou ratée.
- **Presets** : réglages éprouvés par couple machine × filament, copiables en fiche texte.
- **Journal** : file d'attente, historique, taux de réussite, consommation et coût.
- **Réglages** : page rangée par sections (Plans, Général…), avec recherche ; valeurs communes à tous les postes,
  enregistrées dès qu'on les change (animation de la pièce 3D, aperçu, cartouche par défaut, seuil de stock bas…).

## Outils

    .venv/bin/python -m outils.importer_poignee   # premier remplissage (machines, filaments, projet Poignée Dex1)
    .venv/bin/python -m outils.reanalyser         # recalcule dimensions, miniatures et formes

## Tests

    tester.bat          # Windows (./tester.sh ailleurs) : toute la batterie, environ une minute

À faire passer avant chaque commit ; pour que Git le fasse tout seul : `git config core.hooksPath .githooks`.
Couvre chaque route de l'API, l'analyse des fichiers, la reconnaissance des formes (avec deux pièces de
référence aux cotes connues) et, dans un Edge / Chrome sans fenêtre, le dessin des plans (toutes les cotes
attendues, sans doublon ni chevauchement), le PDF et chaque page de l'interface.

## Limites connues

- Pas de comptes ni de mot de passe : à n'ouvrir que sur le réseau local. Les codes d'accès Bambu sont
  stockés en clair dans `data/atelier.db` (jamais renvoyés au navigateur).
- Anycubic d'origine : pas d'API locale ouverte, état manuel (Klipper/Rinkhals : pilote `moonraker`).
- Pas de tranchage intégré ni d'envoi de fichier aux imprimantes (prévu plus tard).
