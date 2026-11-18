"""Connexion aux imprimantes.

- bambu_lan : Bambu Lab (A1, A1 mini, P1, X1) en mode réseau local, MQTT TLS port 8883, utilisateur « bblp »,
  mot de passe = code d'accès affiché sur l'écran de l'imprimante, numéro de série requis.
- moonraker : imprimantes Klipper (y compris Anycubic passées sous Rinkhals / Klipper), API HTTP Moonraker.
- manuel    : pas de connexion, l'état se règle à la main (Anycubic d'origine, résine...).
"""
import json
import ssl
import threading
import time

import httpx

try:
    import paho.mqtt.client as mqtt
except ImportError:  # l'appli reste utilisable sans paho
    mqtt = None


ETATS_BAMBU = {"IDLE": "libre", "FINISH": "terminee", "RUNNING": "impression", "PAUSE": "pause",
               "FAILED": "erreur", "PREPARE": "preparation", "SLICING": "preparation"}


class PiloteBambu:
    def __init__(self, machine):
        self.m = machine
        self.etat = {"connexion": "deconnectee"}
        self.client = None
        self.verrou = threading.Lock()

    def demarrer(self):
        if mqtt is None:
            self.etat = {"connexion": "erreur", "message": "paho-mqtt absent"}
            return
        if not (self.m.get("adresse") and self.m.get("numero_serie") and self.m.get("code_acces")):
            self.etat = {"connexion": "incomplete", "message": "adresse IP, numéro de série et code d'accès requis"}
            return
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"atelier3d-{self.m['id']}-{int(time.time())}")
        c.username_pw_set("bblp", self.m["code_acces"])
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # certificat auto-signé de l'imprimante
        c.tls_set_context(ctx)
        c.on_connect = self._connecte
        c.on_message = self._message
        c.on_disconnect = lambda *a: self._maj({"connexion": "deconnectee"})
        c.reconnect_delay_set(5, 60)
        self.client = c
        self.etat = {"connexion": "connexion..."}
        try:
            c.connect_async(self.m["adresse"], 8883, keepalive=30)
            c.loop_start()
        except Exception as e:
            self.etat = {"connexion": "erreur", "message": str(e)}

    def arreter(self):
        if self.client:
            self.client.loop_stop()
            try:
                self.client.disconnect()
            except Exception:
                pass

    def _connecte(self, client, userdata, flags, rc, props=None):
        if rc != 0:
            self._maj({"connexion": "erreur", "message": f"refus MQTT ({rc}) : vérifier le code d'accès"})
            return
        sn = self.m["numero_serie"]
        client.subscribe(f"device/{sn}/report")
        self._envoyer({"pushing": {"sequence_id": "0", "command": "pushall"}})
        self._maj({"connexion": "connectee"})

    def _message(self, client, userdata, msg):
        try:
            p = json.loads(msg.payload).get("print", {})
        except ValueError:
            return
        maj = {}
        if "gcode_state" in p:
            maj["etat"] = ETATS_BAMBU.get(p["gcode_state"], p["gcode_state"].lower())
        for cle, nom in [("mc_percent", "progression"), ("mc_remaining_time", "reste_min"),
                         ("nozzle_temper", "temp_buse"), ("nozzle_target_temper", "consigne_buse"),
                         ("bed_temper", "temp_plateau"), ("bed_target_temper", "consigne_plateau"),
                         ("subtask_name", "travail"), ("layer_num", "couche"), ("total_layer_num", "couches"),
                         ("wifi_signal", "wifi")]:
            if cle in p:
                maj[nom] = p[cle]
        if "print_error" in p and p["print_error"]:
            maj["code_erreur"] = p["print_error"]
        if maj:
            maj["vu"] = time.time()
            self._maj(maj)

    def _maj(self, d):
        with self.verrou:
            self.etat = {**self.etat, **d}

    def _envoyer(self, charge):
        if self.client:
            self.client.publish(f"device/{self.m['numero_serie']}/request", json.dumps(charge))

    def commande(self, action):
        cmd = {"pause": "pause", "reprendre": "resume", "arreter": "stop"}.get(action)
        if not cmd:
            raise ValueError("action inconnue")
        self._envoyer({"print": {"sequence_id": "0", "command": cmd}})
        if action == "arreter":
            self._maj({"etat": "arret demande"})

    def lire(self):
        with self.verrou:
            return dict(self.etat)


class PiloteMoonraker:
    """Interrogé à la demande (pas de fil permanent)."""

    def __init__(self, machine):
        self.m = machine

    def demarrer(self):
        pass

    def arreter(self):
        pass

    def _url(self, chemin):
        adr = self.m.get("adresse", "")
        if not adr.startswith("http"):
            adr = "http://" + adr
        return adr.rstrip("/") + chemin

    def lire(self):
        if not self.m.get("adresse"):
            return {"connexion": "incomplete", "message": "adresse requise"}
        try:
            r = httpx.get(self._url("/printer/objects/query?print_stats&display_status&extruder&heater_bed"), timeout=3)
            s = r.json()["result"]["status"]
            ps = s.get("print_stats", {})
            etat = {"standby": "libre", "printing": "impression", "paused": "pause", "complete": "terminee",
                    "error": "erreur", "cancelled": "libre"}.get(ps.get("state"), ps.get("state"))
            return {"connexion": "connectee", "etat": etat, "travail": ps.get("filename"),
                    "progression": round(100 * s.get("display_status", {}).get("progress", 0)),
                    "temp_buse": s.get("extruder", {}).get("temperature"),
                    "consigne_buse": s.get("extruder", {}).get("target"),
                    "temp_plateau": s.get("heater_bed", {}).get("temperature"),
                    "consigne_plateau": s.get("heater_bed", {}).get("target"), "vu": time.time()}
        except Exception as e:
            return {"connexion": "erreur", "message": str(e)[:150]}

    def commande(self, action):
        chemin = {"pause": "/printer/print/pause", "reprendre": "/printer/print/resume",
                  "arreter": "/printer/print/cancel"}.get(action)
        if not chemin:
            raise ValueError("action inconnue")
        httpx.post(self._url(chemin), timeout=5)


class PiloteManuel:
    def __init__(self, machine):
        self.m = machine

    def demarrer(self):
        pass

    def arreter(self):
        pass

    def lire(self):
        return {"connexion": "manuel", "etat": self.m.get("statut_manuel", "libre")}

    def commande(self, action):
        raise ValueError("machine sans connexion : commande impossible")


PILOTES = {"bambu_lan": PiloteBambu, "moonraker": PiloteMoonraker, "manuel": PiloteManuel}


class Parc:
    """Garde un pilote par machine et le relance quand sa fiche change."""

    def __init__(self):
        self.pilotes = {}
        self.verrou = threading.Lock()

    def synchroniser(self, machines):
        with self.verrou:
            vus = set()
            for m in machines:
                vus.add(m["id"])
                cle = (m["pilote"], m.get("adresse"), m.get("numero_serie"), m.get("code_acces"), m.get("statut_manuel"))
                actuel = self.pilotes.get(m["id"])
                if actuel and actuel[0] == cle:
                    continue
                if actuel:
                    actuel[1].arreter()
                p = PILOTES.get(m["pilote"], PiloteManuel)(m)
                p.demarrer()
                self.pilotes[m["id"]] = (cle, p)
            for mid in list(self.pilotes):
                if mid not in vus:
                    self.pilotes.pop(mid)[1].arreter()

    def etat(self, mid):
        p = self.pilotes.get(mid)
        return p[1].lire() if p else {"connexion": "inconnue"}

    def commande(self, mid, action):
        p = self.pilotes.get(mid)
        if not p:
            raise ValueError("machine inconnue")
        p[1].commande(action)

    def tout_arreter(self):
        for _, p in self.pilotes.values():
            p.arreter()
