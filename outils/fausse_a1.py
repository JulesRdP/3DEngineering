"""Fausse Bambu Lab A1 : imprimante simulée en mode réseau local, pour essayer l'appli sans vraie Bambu.

Comme une vraie : serveur MQTT chiffré (TLS, certificat auto-signé), utilisateur « bblp », mot de passe = code
d'accès, état publié sur device/<n° de série>/report, commandes reçues sur device/<n° de série>/request
(pushall, pause, resume, stop, project_file). Elle enchaîne toute seule des impressions fictives :
attente → préparation (chauffe) → impression (couches, progression) → terminée → attente…

    .venv/bin/python -m outils.fausse_a1                     # port 8883, impression de 10 min
    .venv/bin/python -m outils.fausse_a1 --duree 120 --attente 20 --port 8884

Dans l'appli : machine pilote « bambu_lan », adresse 127.0.0.1 (ou 127.0.0.1:8884, ou l'IP du PC qui la fait
tourner), numéro de série et code d'accès affichés au lancement.

MQTT 3.1.1 réduit au nécessaire (QoS 0/1, pas de rétention), sans dépendance. outils/fausse_a1.pem est une clé
jetable publique, faite pour ce simulateur seulement.
"""
import argparse
import asyncio
import json
import ssl
import threading
import time
from pathlib import Path

CERTIFICAT = Path(__file__).with_suffix(".pem")
SERIE = "0309CA000000A1F"
CODE = "12345678"
TRAVAUX = ["support_nema17_v1", "poignee_dex1_support", "cube_calibration", "boitier_capteur"]


class Imprimante:
    """L'état simulé, avancé par avancer(dt). Clés et valeurs comme dans les rapports d'une vraie A1."""

    def __init__(self, duree=600, attente=30, couches=150):
        self.duree, self.attente, self.couches = duree, attente, couches
        self.etat = "IDLE"
        self.depuis = 0.0          # secondes passées dans l'état courant
        self.fait = 0.0            # secondes d'impression effectuées (hors pause)
        self.travail = ""
        self.n = 0
        self.buse, self.plateau = 25.0, 25.0
        self.consigne_buse, self.consigne_plateau = 0, 0
        self.verrou = threading.Lock()

    def lancer(self, nom=None):
        self.travail = nom or TRAVAUX[self.n % len(TRAVAUX)]
        self.n += 1
        self.fait = 0.0
        self._passer("PREPARE")
        self.consigne_buse, self.consigne_plateau = 220, 65

    def _passer(self, etat):
        self.etat, self.depuis = etat, 0.0

    def commande(self, cmd, charge):
        with self.verrou:
            if cmd == "pause" and self.etat in ("RUNNING", "PREPARE"):
                self._passer("PAUSE")
            elif cmd == "resume" and self.etat == "PAUSE":
                self._passer("RUNNING")
            elif cmd == "stop" and self.etat in ("RUNNING", "PREPARE", "PAUSE"):
                self._passer("IDLE")
                self.consigne_buse = self.consigne_plateau = 0
            elif cmd == "project_file" and self.etat in ("IDLE", "FINISH"):
                self.lancer(charge.get("subtask_name") or Path(charge.get("url", "")).stem or None)

    def avancer(self, dt):
        with self.verrou:
            self.depuis += dt
            if self.etat in ("IDLE", "FINISH") and self.attente and self.depuis >= self.attente:
                self.lancer()
            elif self.etat == "PREPARE" and self.depuis >= min(10, self.duree / 6):
                self._passer("RUNNING")
            elif self.etat == "RUNNING":
                self.fait += dt
                if self.fait >= self.duree:
                    self._passer("FINISH")
                    self.consigne_buse = self.consigne_plateau = 0
            # températures : rapprochement exponentiel de la consigne (ou de l'ambiante)
            for attr, cible in (("buse", self.consigne_buse or 25), ("plateau", self.consigne_plateau or 25)):
                v = getattr(self, attr)
                setattr(self, attr, v + (cible - v) * min(1, dt / 4))

    def rapport(self):
        with self.verrou:
            pc = 100 if self.etat == "FINISH" else int(100 * min(1, self.fait / self.duree)) if self.travail else 0
            return {"print": {
                "command": "push_status", "sequence_id": str(int(time.time())),
                "gcode_state": self.etat, "subtask_name": self.travail,
                "mc_percent": pc, "mc_remaining_time": max(0, round((self.duree - self.fait) / 60)) if self.etat in ("RUNNING", "PAUSE", "PREPARE") else 0,
                "layer_num": int(self.couches * pc / 100), "total_layer_num": self.couches if self.travail else 0,
                "nozzle_temper": round(self.buse, 1), "nozzle_target_temper": self.consigne_buse,
                "bed_temper": round(self.plateau, 1), "bed_target_temper": self.consigne_plateau,
                "wifi_signal": "-48dBm", "print_error": 0,
            }}


# ------------------------------------------------------------------ MQTT minimal

def _long(n):
    out = bytearray()
    while True:
        n, o = divmod(n, 128)
        out.append(o | (128 if n else 0))
        if not n:
            return bytes(out)


def _chaine(s):
    b = s.encode()
    return len(b).to_bytes(2, "big") + b


def _publier(sujet, charge: bytes):
    corps = _chaine(sujet) + charge
    return bytes([0x30]) + _long(len(corps)) + corps


async def _lire_paquet(r):
    entete = (await r.readexactly(1))[0]
    n, mult = 0, 1
    while True:
        o = (await r.readexactly(1))[0]
        n += (o & 127) * mult
        mult *= 128
        if not o & 128:
            break
    return entete, await r.readexactly(n)


class FausseA1:
    def __init__(self, port=8883, serie=SERIE, code=CODE, hote="0.0.0.0", duree=600, attente=30, periode=1.0):
        self.port, self.serie, self.code, self.hote, self.periode = port, serie, code, hote, periode
        self.imprimante = Imprimante(duree=duree, attente=attente)
        self.clients = set()
        self.boucle = None
        self.pret = threading.Event()

    # -- un client (le pilote de l'appli)
    async def _client(self, r, w):
        abonne = False
        try:
            entete, corps = await _lire_paquet(r)
            if entete >> 4 != 1:
                return
            i = 2 + int.from_bytes(corps[:2], "big") + 1  # nom du protocole + niveau
            drapeaux = corps[i]
            i += 3  # drapeaux + keepalive
            champs = []
            while i < len(corps):
                n = int.from_bytes(corps[i:i + 2], "big")
                champs.append(corps[i + 2:i + 2 + n].decode(errors="replace"))
                i += 2 + n
            champs = champs[1:]  # identifiant du client
            if drapeaux & 0x04:
                champs = champs[2:]  # testament (sujet + message)
            utilisateur = champs.pop(0) if drapeaux & 0x80 else ""
            mdp = champs.pop(0) if drapeaux & 0x40 else ""
            if utilisateur != "bblp" or mdp != self.code:
                w.write(b"\x20\x02\x00\x05")  # refusé : non autorisé
                await w.drain()
                return
            w.write(b"\x20\x02\x00\x00")
            self.clients.add(w)
            while True:
                entete, corps = await _lire_paquet(r)
                genre = entete >> 4
                if genre == 8:  # SUBSCRIBE
                    ident, i, accords = corps[:2], 2, bytearray()
                    while i < len(corps):
                        n = int.from_bytes(corps[i:i + 2], "big")
                        sujet = corps[i + 2:i + 2 + n].decode()
                        abonne |= sujet in (f"device/{self.serie}/report", f"device/{self.serie}/#", "#")
                        accords.append(0)
                        i += 3 + n
                    w.write(bytes([0x90]) + _long(2 + len(accords)) + ident + accords)
                    w.abonne = abonne
                elif genre == 3:  # PUBLISH
                    qos = (entete >> 1) & 3
                    n = int.from_bytes(corps[:2], "big")
                    sujet, i = corps[2:2 + n].decode(), 2 + n
                    if qos:
                        w.write(b"\x40\x02" + corps[i:i + 2])
                        i += 2
                    if sujet == f"device/{self.serie}/request":
                        self._requete(w, corps[i:])
                elif genre == 12:  # PINGREQ
                    w.write(b"\xd0\x00")
                elif genre == 14:  # DISCONNECT
                    return
                await w.drain()
        except (asyncio.IncompleteReadError, ConnectionError, ssl.SSLError):
            pass
        finally:
            self.clients.discard(w)
            w.close()

    def _requete(self, w, charge):
        try:
            d = json.loads(charge)
        except ValueError:
            return
        if d.get("pushing", {}).get("command") == "pushall":
            self._envoyer(w)
        cmd = d.get("print", {}).get("command")
        if cmd:
            self.imprimante.commande(cmd, d["print"])
            for c in list(self.clients):
                self._envoyer(c)

    def _envoyer(self, w):
        if getattr(w, "abonne", False) and not w.is_closing():
            w.write(_publier(f"device/{self.serie}/report", json.dumps(self.imprimante.rapport()).encode()))

    async def _horloge(self):
        avant = time.monotonic()
        while True:
            await asyncio.sleep(self.periode)
            t = time.monotonic()
            self.imprimante.avancer(t - avant)
            avant = t
            for c in list(self.clients):
                self._envoyer(c)

    async def servir(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERTIFICAT)
        srv = await asyncio.start_server(self._client, self.hote, self.port, ssl=ctx)
        self.port = srv.sockets[0].getsockname()[1]  # port 0 = choisi par le système (tests)
        self.boucle = asyncio.get_running_loop()
        self.pret.set()
        async with srv:
            await asyncio.gather(srv.serve_forever(), self._horloge())

    # -- pour les tests : dans un fil, arrêtable
    def demarrer_en_fond(self):
        fil = threading.Thread(target=lambda: asyncio.run(self._servir_arretable()), daemon=True)
        fil.start()
        self.pret.wait(10)
        return self

    async def _servir_arretable(self):
        self._tache = asyncio.current_task()
        try:
            await self.servir()
        except asyncio.CancelledError:
            pass

    def arreter(self):
        if self.boucle:
            self.boucle.call_soon_threadsafe(self._tache.cancel)


def main():
    a = argparse.ArgumentParser(description="Fausse Bambu Lab A1 (MQTT LAN simulé)")
    a.add_argument("--port", type=int, default=8883)
    a.add_argument("--serie", default=SERIE)
    a.add_argument("--code", default=CODE)
    a.add_argument("--duree", type=float, default=600, help="durée d'une impression fictive, en secondes")
    a.add_argument("--attente", type=float, default=30, help="pause entre deux impressions (0 = n'en lance pas seule)")
    o = a.parse_args()
    s = FausseA1(port=o.port, serie=o.serie, code=o.code, duree=o.duree, attente=o.attente)
    print(f"Fausse A1 sur le port {o.port}\n  adresse : 127.0.0.1{'' if o.port == 8883 else ':' + str(o.port)} (ou l'IP de ce PC)"
          f"\n  n° de série : {o.serie}\n  code d'accès : {o.code}\nCtrl+C pour arrêter.")
    try:
        asyncio.run(s.servir())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
