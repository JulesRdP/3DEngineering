"""Refait l'analyse (dimensions, volume, miniature) de tous les fichiers. Usage : .venv/bin/python -m outils.reanalyser"""
import json

from atelier3d import app as A
from atelier3d.mesh import analyser

for f in A.db.tous("SELECT * FROM fichiers"):
    chemin = A.FICHIERS / f["chemin"]
    if not chemin.exists():
        continue
    meta, mini = analyser(chemin, f["type"])
    if mini:
        A.MINIATURES.mkdir(parents=True, exist_ok=True)
        (A.MINIATURES / f"{f['id']}.png").write_bytes(mini)
        meta["miniature"] = True
    for cle in ("reperes", "cartouche"):  # saisis à la main : on les garde
        if f["meta"].get(cle):
            meta[cle] = f["meta"][cle]
    meta["analyse"] = "faite"
    A.db.modifier("fichiers", f["id"], {"meta": json.dumps(meta)})
    print(f["id"], f["nom"], "miniature" if mini else "")
