"""Base SQLite de l'atelier : projets, fichiers (avec variations), machines, filaments, presets, impressions."""
import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS projets (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    description TEXT DEFAULT '',
    statut TEXT DEFAULT 'en_cours',          -- idee | en_cours | termine | archive
    tags TEXT DEFAULT '',                     -- séparés par des virgules
    lien_cao TEXT DEFAULT '',                 -- lien Onshape, Fusion...
    cree TEXT, modifie TEXT
);
CREATE TABLE IF NOT EXISTS fichiers (
    id INTEGER PRIMARY KEY,
    projet_id INTEGER NOT NULL REFERENCES projets(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    type TEXT,                                -- stl | 3mf | step | gcode | fs | pdf | image | autre
    role TEXT DEFAULT 'piece',                -- piece | plan | source | gcode | photo | autre
    chemin TEXT NOT NULL,                     -- relatif au dossier data/fichiers
    taille INTEGER, sha256 TEXT,
    parent_id INTEGER REFERENCES fichiers(id) ON DELETE SET NULL,  -- variation de...
    variante TEXT DEFAULT '',                 -- libellé de la variation (« V7 clips », « jeu 0,4 »...)
    notes TEXT DEFAULT '',
    meta TEXT DEFAULT '{}',                   -- JSON : dimensions, volume, triangles, réglages 3MF...
    cree TEXT
);
CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    marque TEXT DEFAULT '', modele TEXT DEFAULT '',
    techno TEXT DEFAULT 'fdm',                -- fdm | resine
    volume_x REAL, volume_y REAL, volume_z REAL,
    buse REAL DEFAULT 0.4,
    pilote TEXT DEFAULT 'manuel',             -- manuel | bambu_lan | moonraker
    adresse TEXT DEFAULT '', numero_serie TEXT DEFAULT '', code_acces TEXT DEFAULT '',
    statut_manuel TEXT DEFAULT 'libre',       -- libre | occupee | maintenance | hors_service
    notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS filaments (
    id INTEGER PRIMARY KEY,
    matiere TEXT NOT NULL,                    -- PLA, PETG, ABS, ASA, TPU, résine...
    marque TEXT DEFAULT '', couleur TEXT DEFAULT '', couleur_hex TEXT DEFAULT '#cccccc',
    diametre REAL DEFAULT 1.75, densite REAL DEFAULT 1.24,
    temp_buse INTEGER, temp_plateau INTEGER,
    stock_g REAL DEFAULT 1000, prix_kg REAL DEFAULT 20,
    notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    machine_id INTEGER REFERENCES machines(id) ON DELETE CASCADE,
    filament_id INTEGER REFERENCES filaments(id) ON DELETE SET NULL,
    hauteur_couche REAL DEFAULT 0.2, remplissage INTEGER DEFAULT 15, motif TEXT DEFAULT 'gyroid',
    parois INTEGER DEFAULT 2, vitesse INTEGER, temp_buse INTEGER, temp_plateau INTEGER,
    supports TEXT DEFAULT 'non',              -- non | arbre | normal | contact plateau
    adherence TEXT DEFAULT 'aucune',          -- aucune | bordure | radeau
    notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS impressions (
    id INTEGER PRIMARY KEY,
    fichier_id INTEGER REFERENCES fichiers(id) ON DELETE SET NULL,
    machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
    preset_id INTEGER REFERENCES presets(id) ON DELETE SET NULL,
    filament_id INTEGER REFERENCES filaments(id) ON DELETE SET NULL,
    quantite INTEGER DEFAULT 1,
    debut TEXT, duree_min REAL, grammes REAL,
    resultat TEXT DEFAULT 'prevue',           -- prevue | en_cours | reussie | ratee | annulee
    stock_deduit INTEGER DEFAULT 0,           -- 1 quand les grammes ont été retirés du stock de filament
    notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS reglages (         -- voir reglages.py ; clé absente = valeur par défaut
    cle TEXT PRIMARY KEY,
    valeur TEXT NOT NULL                      -- JSON
);
"""


def maintenant():
    return datetime.now().isoformat(timespec="seconds")


class Base:
    """Petite couche au-dessus de sqlite3 (un verrou suffit pour un atelier)."""

    def __init__(self, chemin: Path):
        chemin.parent.mkdir(parents=True, exist_ok=True)
        self.cx = sqlite3.connect(chemin, check_same_thread=False)
        self.cx.row_factory = sqlite3.Row
        self.cx.execute("PRAGMA foreign_keys = ON")
        self.cx.executescript(SCHEMA)
        self.verrou = threading.Lock()

    def tous(self, sql, params=()):
        with self.verrou:
            return [self._dict(r) for r in self.cx.execute(sql, params).fetchall()]

    def un(self, sql, params=()):
        with self.verrou:
            r = self.cx.execute(sql, params).fetchone()
        return self._dict(r) if r else None

    def executer(self, sql, params=()):
        with self.verrou:
            cur = self.cx.execute(sql, params)
            self.cx.commit()
            return cur.lastrowid

    def inserer(self, table, valeurs: dict):
        cols = ", ".join(valeurs)
        marques = ", ".join("?" for _ in valeurs)
        return self.executer(f"INSERT INTO {table} ({cols}) VALUES ({marques})", tuple(valeurs.values()))

    def modifier(self, table, ident, valeurs: dict):
        if not valeurs:
            return
        sets = ", ".join(f"{c} = ?" for c in valeurs)
        self.executer(f"UPDATE {table} SET {sets} WHERE id = ?", (*valeurs.values(), ident))

    def supprimer(self, table, ident):
        self.executer(f"DELETE FROM {table} WHERE id = ?", (ident,))

    @staticmethod
    def _dict(r):
        d = dict(r)
        if "meta" in d and isinstance(d["meta"], str):
            try:
                d["meta"] = json.loads(d["meta"] or "{}")
            except json.JSONDecodeError:
                d["meta"] = {}
        return d
