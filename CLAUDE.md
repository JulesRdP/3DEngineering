# CLAUDE.md

Atelier 3D : appli web locale (réseau de l'atelier, sans comptes) pour gérer les projets d'impression 3D de
l'équipe. Voir README.md pour les fonctionnalités côté utilisateur.

## Commandes

Windows :

    lancer.bat                                   # crée .venv au premier lancement, sert sur http://<ip>:8030
    tester.bat                                   # TOUS les tests (serveur + navigateur), ~1 min
    tester.bat -k plan                           # seulement les tests dont le nom contient « plan »
    .venv\Scripts\python -m outils.reanalyser    # recalcule dimensions, miniatures et formes de tous les fichiers

Linux / macOS : `./lancer.sh`, `./tester.sh`, et `.venv/bin/python` au lieu de `.venv\Scripts\python`.
Variables : `HOTE`, `PORT` (lancement), `ATELIER3D_DONNEES` (dossier des données, `data/` par défaut).

## Architecture

- `atelier3d/app.py` : FastAPI. CRUD générique via `_crud(table, ...)` pour machines, filaments, presets,
  impressions, projets ; les champs modifiables de chaque table sont listés dans `CHAMPS` (un champ absent de
  `CHAMPS` est ignoré silencieusement). Les champs texte doivent aussi être dans `TEXTES`, sinon une chaîne
  vide devient NULL. Les fichiers ont leurs propres routes (dépôt, contenu, miniature, repères, compatibilité).
  Interface (`/`, `/static/…`) et miniatures servies en `Cache-Control: no-cache`, pour qu'une mise à jour soit
  vue sans vider le cache du navigateur.
- `atelier3d/db.py` : schéma SQLite (`SCHEMA`, `CREATE TABLE IF NOT EXISTS`) et petite classe `Base` (une
  connexion + un verrou). Pas de migrations : ajouter une colonne à une table existante demande un `ALTER TABLE`
  explicite, sinon les bases déjà créées ne l'auront pas. La colonne `meta` (JSON) est décodée automatiquement.
- `atelier3d/mesh.py` : analyse des fichiers déposés (STL, 3MF, G-code) en Python pur : dimensions, volume,
  surface, miniature PNG (toujours notre rendu, même pour un 3MF qui a sa propre vignette : style uniforme),
  réglages Bambu Studio / OrcaSlicer. Lancée dans un thread après le dépôt
  (`meta.analyse` passe de `en_cours` à `faite`).
- `atelier3d/formes.py` : reconnaissance des formes dans le maillage (trous et lamages, oblongs, bossages,
  arrondis, faces planes), quel que soit l'axe, stockée dans `meta.formes`. Les fichiers déjà en base n'ont
  ces formes qu'après `outils.reanalyser`. Seuils sensibles en tête du fichier (`COPLAN`, `ARETE_VIVE`).
- `atelier3d/reglages.py` : LA liste des réglages (sections › groupes › réglages : clé, type, bornes, défaut,
  aide), table `reglages` (clé → JSON). La page Réglages se construit seule depuis `/api/reglages` : un nouveau
  réglage = une ligne ici, lue par `reglages.valeur(db, cle)` (serveur) ou `reglage(cle)` (app.js). Clé rangée
  dans sa section (`plans.…`, `general.…`), vérifié par les tests.
- `atelier3d/machines.py` : un pilote par machine (`PiloteBambu` MQTT TLS, `PiloteMoonraker` HTTP,
  `PiloteManuel`), gérés par `Parc`, resynchronisé à chaque modification d'une machine.
- `atelier3d/static/` : interface page unique en JS vanilla (modules ES, routes dans `#hash`), three.js
  vendorisé dans `static/vendor/` (pas de npm, pas de build). `vision.js` = vue 3D ; `chargerObjet` calcule les
normales des 3MF (le chargeur three.js n'en fait pas, et nos matériaux remplacent les siens). Styles d'affichage
façon CAO (ombré, arêtes, lignes cachées, filaire ; couleur, contraste, reflets) : barre dans la vue, défauts =
réglages `vue3d.*`, choix de la barre retenu par navigateur (localStorage). Éclairage attaché à la caméra. Mise en plan :
  - `plan.js` : dessin industriel normalisé (ISO 128 traits, 129 cotation, 5456 projection européenne, 5457 cadre,
    7200 cartouche) — vues alignées face / dessus (dessous) / gauche (à droite, remplacée par une coupe A–A par
    l'axe d'un perçage), cotation en cotes d'origine sans doublon (`repartirCotes`), indications Ø / lamage / R /
    chanfrein, choix A4 portrait ou A3 paysage et échelle normalisée, vue isométrique. Données : `meta.formes`.
    Contrôle de cotation (`controlerCotation`) : chaque vrai coin de la pièce, sur chaque axe, doit être donné par
    une cote ou par une forme indiquée et située ; sinon la cote est ajoutée (au besoin sur traits cachés), et le
    bilan (`feuille.infos.controle`) s'affiche au-dessus du plan. Une face vue nulle part est cotée en caché.
  - `aretes.js` : arêtes vives + contours apparents, tri vues / cachées par carte de profondeur WebGL, sections.
    Une ou deux feuilles (`choisirMiseEnPage`) : deux si l'échelle y gagne (face + coupe, puis vue de dessus
    désignée par flèche de référence + iso).
  - `traceur.js` : primitives en mm (feuille), rendu SVG (aperçu) et canvas (PNG) ; `pdf.js` : PDF vectoriel.
  - `visionneuse.js` : aperçu SVG, zoom molette autour du curseur (`zoomAutour`), déplacement, plein écran,
    vues cliquables (`vueSous`, d'après `feuille.infos.vues` rempli par plan.js : rect, ox, oy, s, f, u, r, coupe).
  - `apparition3d.js` : pièce 3D posée sous la vue cliquée (caméra orthographique calée sur la projection
    de la vue, couche WebGL entre le fond blanc et les traits SVG). Elle vole depuis l'aperçu 3D (`poseVol` :
    interpolation entre la pose de l'aperçu et la pose exacte de la vue, tour complet) ; animations par
    `boucle()` (rAF + minuterie de secours). Options = réglages `plans.piece.*`.
  Règles de dessin tirées du cours de dessin industriel de l'utilisateur (BME, ISO) : les respecter.
- `outils/` : scripts lancés avec `python -m outils.<nom>`.
- `data/` (ignoré par git) : `atelier.db`, `fichiers/<projet_id>/`, `miniatures/<fichier_id>.png`.

## Conventions

- Tout est en français : code (noms de variables, fonctions, routes), commentaires, messages, interface.
- Dépendances minimales : pas de framework front, pas d'ORM, analyse 3D sans numpy.
- Le code d'accès Bambu ne doit jamais être renvoyé au navigateur (`_masquer`) ; un code vide lors d'une
  modification conserve l'ancien.

## Tests (non-régression)

**`tester.bat` doit passer en entier avant chaque commit** (crochet `.githooks/pre-commit`, activé par
`git config core.hooksPath .githooks`). Toute nouvelle fonctionnalité arrive avec ses tests ; un test qui casse
signale une régression : on corrige le code, on ne retouche un test que si le comportement attendu a changé
volontairement (et on le dit).

- `tests/conftest.py` : client API sur dossier temporaire, pièces générées (cube, solides de révolution),
  pièces de référence `tests/donnees/support_nema17_v1.stl` et `_v2.stl` (source : `support_nema17.py`).
- `test_atelier.py` : parcours de bout en bout (projet → fichier → variation → compatibilité → impression → stock).
- `test_api.py` : chaque route, cas nominaux et refus (404, 400, 410), cartouche, réanalyse, sauvegarde.
- `test_formes.py` : valeurs exactes reconnues sur les pièces de référence, axes inclinés, maillages grossiers
  ou très fins, trous borgnes, performance.
- `test_navigateur.py` : démarre un vrai serveur, ouvre `tests/navigateur/essais.html` dans Edge / Chrome sans
  fenêtre (traceur, PDF, arêtes, plan : cotes attendues présentes une seule fois, pas de cote évidente, pas de
  texte qui se chevauche, rien sur le cartouche…) et vérifie chaque page de l'interface. Ignoré sans navigateur
  (`ATELIER3D_NAVIGATEUR` pour en indiquer un).
