# CLAUDE.md

Atelier 3D : appli web locale (réseau de l'atelier, sans comptes) pour gérer les projets d'impression 3D de
l'équipe. Voir README.md pour les fonctionnalités côté utilisateur.

## Commandes

Windows :

    lancer.bat                                   # crée .venv au premier lancement, sert sur http://<ip>:8030
    .venv\Scripts\python -m pytest -q tests
    .venv\Scripts\python -m outils.reanalyser    # recalcule dimensions et miniatures de tous les fichiers

Linux / macOS : `./lancer.sh`, et `.venv/bin/python` au lieu de `.venv\Scripts\python`.
Variables : `HOTE`, `PORT` (lancement), `ATELIER3D_DONNEES` (dossier des données, `data/` par défaut).

## Architecture

- `atelier3d/app.py` : FastAPI. CRUD générique via `_crud(table, ...)` pour machines, filaments, presets,
  impressions, projets ; les champs modifiables de chaque table sont listés dans `CHAMPS` (un champ absent de
  `CHAMPS` est ignoré silencieusement). Les champs texte doivent aussi être dans `TEXTES`, sinon une chaîne
  vide devient NULL. Les fichiers ont leurs propres routes (dépôt, contenu, miniature, repères, compatibilité).
- `atelier3d/db.py` : schéma SQLite (`SCHEMA`, `CREATE TABLE IF NOT EXISTS`) et petite classe `Base` (une
  connexion + un verrou). Pas de migrations : ajouter une colonne à une table existante demande un `ALTER TABLE`
  explicite, sinon les bases déjà créées ne l'auront pas. La colonne `meta` (JSON) est décodée automatiquement.
- `atelier3d/mesh.py` : analyse des fichiers déposés (STL, 3MF, G-code) en Python pur : dimensions, volume,
  surface, miniature PNG, réglages Bambu Studio / OrcaSlicer. Lancée dans un thread après le dépôt
  (`meta.analyse` passe de `en_cours` à `faite`).
- `atelier3d/machines.py` : un pilote par machine (`PiloteBambu` MQTT TLS, `PiloteMoonraker` HTTP,
  `PiloteManuel`), gérés par `Parc`, resynchronisé à chaque modification d'une machine.
- `atelier3d/static/` : interface page unique en JS vanilla (modules ES, routes dans `#hash`), three.js
  vendorisé dans `static/vendor/` (pas de npm, pas de build). `plan.js` = planches A4, `vision.js` = vue 3D.
- `outils/` : scripts lancés avec `python -m outils.<nom>`.
- `data/` (ignoré par git) : `atelier.db`, `fichiers/<projet_id>/`, `miniatures/<fichier_id>.png`.

## Conventions

- Tout est en français : code (noms de variables, fonctions, routes), commentaires, messages, interface.
- Dépendances minimales : pas de framework front, pas d'ORM, analyse 3D sans numpy.
- Le code d'accès Bambu ne doit jamais être renvoyé au navigateur (`_masquer`) ; un code vide lors d'une
  modification conserve l'ancien.
- Les tests (`tests/test_atelier.py`) passent par l'API avec `TestClient` et un dossier de données temporaire ;
  ajouter un test de parcours pour toute nouvelle route.
