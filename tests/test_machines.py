"""Pilote Bambu contre la fausse A1 (outils/fausse_a1.py) : connexion TLS, code d'accès, état, commandes."""
import time

import pytest

from atelier3d.machines import PiloteBambu
from outils.fausse_a1 import CODE, SERIE, FausseA1, Imprimante


def attendre(cond, delai=10):
    fin = time.time() + delai
    while time.time() < fin:
        if cond():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture
def a1():
    s = FausseA1(port=0, hote="127.0.0.1", duree=3, attente=0, periode=0.1).demarrer_en_fond()
    yield s
    s.arreter()


def pilote(a1, code=CODE):
    p = PiloteBambu({"id": 1, "adresse": f"127.0.0.1:{a1.port}", "numero_serie": SERIE, "code_acces": code})
    p.demarrer()
    return p


def test_etat_et_commandes(a1):
    p = pilote(a1)
    try:
        assert attendre(lambda: p.lire().get("etat") == "libre"), p.lire()
        assert p.lire()["connexion"] == "connectee"
        a1.imprimante.commande("project_file", {"subtask_name": "essai"})
        assert attendre(lambda: p.lire().get("etat") == "impression"), p.lire()
        p.commande("pause")
        assert attendre(lambda: p.lire().get("etat") == "pause"), p.lire()
        p.commande("reprendre")
        assert attendre(lambda: p.lire().get("etat") in ("impression", "terminee")), p.lire()
        assert attendre(lambda: p.lire().get("etat") == "terminee"), p.lire()
        e = p.lire()
        assert e["travail"] == "essai" and e["progression"] == 100 and e["couches"] > 0
        assert e["temp_buse"] > 25  # encore chaude juste après la fin
    finally:
        p.arreter()


def test_arret_demande(a1):
    p = pilote(a1)
    try:
        a1.imprimante.commande("project_file", {"subtask_name": "long"})
        assert attendre(lambda: p.lire().get("etat") == "impression"), p.lire()
        a1.imprimante.duree = 60
        p.commande("arreter")
        assert attendre(lambda: p.lire().get("etat") == "libre"), p.lire()
    finally:
        p.arreter()


def test_mauvais_code_refuse(a1):
    p = pilote(a1, code="00000000")
    try:
        assert attendre(lambda: p.lire().get("connexion") in ("erreur", "deconnectee") and "etat" not in p.lire())
        time.sleep(0.3)
        assert "etat" not in p.lire()
    finally:
        p.arreter()


def test_cycle_simule_seul():
    """Sans aucune commande, la fausse A1 enchaîne attente → préparation → impression → terminée."""
    i = Imprimante(duree=60, attente=5)
    vus = []
    for _ in range(200):
        i.avancer(0.5)
        e = i.rapport()["print"]["gcode_state"]
        if not vus or vus[-1] != e:
            vus.append(e)
    assert vus[:4] == ["IDLE", "PREPARE", "RUNNING", "FINISH"]
