"""Tests du code qui tourne dans le navigateur (plan, PDF, arêtes, interface).

Démarre un vrai serveur sur un dossier de données temporaire, y dépose les pièces de test, puis ouvre
tests/navigateur/essais.html dans Edge ou Chrome sans fenêtre. Ignoré si aucun navigateur n'est trouvé
(variable ATELIER3D_NAVIGATEUR pour en indiquer un)."""
import html
import importlib
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import httpx
import pytest

from conftest import NEMA_V1, NEMA_V2, cube_stl, plaque_poche, revolution, stl_binaire


def trouver_navigateur():
    candidats = [os.environ.get("ATELIER3D_NAVIGATEUR"), shutil.which("msedge"), shutil.which("chrome"),
                 shutil.which("chromium"), shutil.which("google-chrome"), shutil.which("chromium-browser"),
                 r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Google\Chrome\Application\chrome.exe"]
    return next((c for c in candidats if c and Path(c).exists()), None)


NAVIGATEUR = trouver_navigateur()
pytestmark = pytest.mark.skipif(not NAVIGATEUR, reason="aucun navigateur Edge / Chrome trouvé")


@pytest.fixture(scope="module")
def serveur(tmp_path_factory):
    ancien = os.environ.get("ATELIER3D_DONNEES")
    os.environ["ATELIER3D_DONNEES"] = str(tmp_path_factory.mktemp("donnees"))
    import uvicorn
    from fastapi.staticfiles import StaticFiles

    import atelier3d.app as A
    importlib.reload(A)
    A.app.mount("/essais", StaticFiles(directory=Path(__file__).parent / "navigateur"), name="essais")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(A.app, host="127.0.0.1", port=port, log_level="warning"))
    fil = threading.Thread(target=srv.run, daemon=True)
    fil.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.1)
    base = f"http://127.0.0.1:{port}"
    ids = {}
    with httpx.Client(base_url=base, timeout=30) as c:
        p = c.post("/api/projets", json={"nom": "Tests navigateur"}).json()
        for cle, nom, contenu in [("v1", "support_nema17_v1.stl", NEMA_V1.read_bytes()), ("v2", "support_nema17_v2.stl", NEMA_V2.read_bytes()),
                                  ("cube", "cube.stl", cube_stl()), ("tube", "tube.stl", stl_binaire(revolution([(3, 0), (10, 0), (10, 8), (3, 8)]))),
                                  ("poche", "poche.stl", stl_binaire(plaque_poche()))]:
            ids[cle] = c.post(f"/api/projets/{p['id']}/fichiers", files=[("fichiers", (nom, contenu))]).json()[0]["id"]
        for fid in ids.values():
            for _ in range(200):
                if c.get(f"/api/fichiers/{fid}").json()["meta"].get("analyse") == "faite":
                    break
                time.sleep(0.1)
    yield base, ids
    srv.should_exit = True
    fil.join(10)
    if ancien is None:
        os.environ.pop("ATELIER3D_DONNEES", None)
    else:
        os.environ["ATELIER3D_DONNEES"] = ancien


def page(url, budget_ms=60000):
    """DOM de la page après exécution de ses scripts (navigateur sans fenêtre, profil jetable)."""
    with tempfile.TemporaryDirectory() as profil:
        r = subprocess.run([NAVIGATEUR, "--headless=new", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                            "--no-first-run", "--no-default-browser-check", f"--user-data-dir={profil}",
                            f"--virtual-time-budget={budget_ms}", "--dump-dom", url],
                           capture_output=True, timeout=240)
    return r.stdout.decode("utf-8", "replace")


def test_code_navigateur(serveur):
    base, ids = serveur
    dom = page(f"{base}/essais/essais.html?" + "&".join(f"{k}={v}" for k, v in ids.items()))
    m = re.search(r"RESULTATS:(.*?):FIN", dom, re.S)
    assert m, "la page de tests n'a pas abouti :\n" + dom[-3000:]
    resultats = json.loads(html.unescape(m.group(1)))
    echecs = [f"✗ {r['nom']}\n    {r['message']}" for r in resultats if not r["ok"]]
    assert len(resultats) >= 18, f"seulement {len(resultats)} tests exécutés"
    assert not echecs, f"{len(echecs)} / {len(resultats)} tests navigateur en échec :\n" + "\n".join(echecs)


def test_interface_onglet_plan(serveur):
    """La vraie page de l'appli : l'onglet Plan s'ouvre et affiche le plan, avec ses boutons."""
    base, ids = serveur
    dom = page(f"{base}/#/fichier/{ids['v1']}?plan")
    assert re.search(r'id="plan-toile"[\s\S]*?class="vis-cadre"[\s\S]*?class="vis-feuille"[\s\S]*?<svg', dom), "plan non affiché"
    assert 'class="vis-survol"' in dom, "calque de survol des vues (clic : pièce en 3D)"
    for bouton in ["plan-pdf", "plan-png", "plan-garder", "plan-cartouche"]:
        assert f'id="{bouton}"' in dom
    assert "Plein écran" in dom and 'data-vis="plus"' in dom, "visionneuse (zoom, plein écran)"
    assert dom.count('data-feuille="') == 2, "onglets des deux feuilles"
    assert "aperçu impossible" not in dom
    assert re.search(r'id="plan-controle" class="controle-plan ok"[^>]*><b>✓ Cotation complète</b>', dom), "bilan du contrôle de cotation"


def test_interface_reglages(serveur):
    """La page Réglages est construite depuis la liste du serveur : chaque réglage y a sa ligne et son champ."""
    from atelier3d.reglages import DEFINITIONS, SECTIONS
    base, _ = serveur
    dom = page(f"{base}/#/reglages", budget_ms=8000)
    for s in SECTIONS:
        assert f'data-section="{s["id"]}"' in dom
    for cle in DEFINITIONS:
        assert f'class="reglage" data-cle="{cle}"' in dom and f'id="r-{cle.replace(".", "-")}"' in dom, cle
    assert 'id="cherche-reglage"' in dom and 'data-route="reglages"' in dom


def test_interface_nouveau_projet_avec_modele(serveur):
    """Le formulaire « Nouveau projet » propose de téléverser le modèle 3D (et autres fichiers) dès la création."""
    base, _ = serveur
    dom = page(f"{base}/#/projets?nouveau", budget_ms=8000)
    assert re.search(r'<dialog id="modale"[^>]*open', dom), "formulaire ouvert"
    champ = re.search(r'<input name="fichiers" type="file" multiple(?:="")? accept="([^"]+)"', dom)
    assert champ, "champ de téléversement"
    for ext in [".stl", ".3mf", ".obj", ".step"]:
        assert ext in champ.group(1)
    assert "Créer le projet" in dom and "glisser un modèle 3D sur la page" in dom


def test_interface_barre_affichage_3d(serveur):
    """Page d'une pièce : la vue 3D a sa barre de styles d'affichage (comme en CAO) et ses options."""
    base, ids = serveur
    dom = page(f"{base}/#/fichier/{ids['v1']}", budget_ms=10000)
    barre = re.search(r'id="vision"[\s\S]*?class="affichage-3d"([\s\S]*?)class="panneau-affichage"', dom)
    assert barre, "barre d'affichage absente de la vue 3D"
    for style in ["ombre", "ombre_aretes", "sans_cachees", "cachees", "filaire"]:
        assert f'data-style="{style}"' in barre.group(1), style
    assert re.search(r'data-style="ombre_aretes"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-style="ombre_aretes"', dom), \
        "style par défaut de l'atelier : ombré avec arêtes"
    assert 'data-curseur="contraste"' in dom and 'data-curseur="reflets"' in dom and 'data-couleur="gris"' in dom


def test_interface_apercu_3d_a_cote_du_plan(serveur):
    base, ids = serveur
    dom = page(f"{base}/#/fichier/{ids['v1']}?plan")
    assert re.search(r'class="[^"]*\bvisionneuse\b[^"]*\bavec-apercu\b', dom), "aperçu 3D ouvert par défaut"
    assert re.search(r'class="vis-apercu-3d"><canvas', dom), "aperçu 3D affiché"


@pytest.mark.parametrize("route", ["", "projets", "projet/1", "machines", "filaments", "presets", "impressions", "reglages"])
def test_interface_pages(serveur, route):
    """Chaque page de l'appli se construit sans erreur."""
    base, _ = serveur
    dom = page(f"{base}/#/{route}", budget_ms=8000)
    assert 'id="page"' in dom
    contenu = re.search(r'<main[^>]*id="page"[^>]*>(.*?)</main>', dom, re.S)
    assert contenu and len(contenu.group(1).strip()) > 50, f"page « {route} » vide"
