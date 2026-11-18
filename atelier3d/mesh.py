"""Analyse des fichiers 3D sans dépendance : STL (binaire/ASCII) et 3MF (y compris projets Bambu Studio / OrcaSlicer).

Renvoie dimensions, volume, surface, nombre de triangles, et pour les 3MF la miniature et les réglages enregistrés.
"""
import json
import re
import struct
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

IDENTITE = (1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)  # matrice 3MF : m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32


def _transformer(p, m):
    x, y, z = p
    return (x * m[0] + y * m[3] + z * m[6] + m[9],
            x * m[1] + y * m[4] + z * m[7] + m[10],
            x * m[2] + y * m[5] + z * m[8] + m[11])


def _composer(a, b):
    """Matrice qui applique a puis b."""
    r = []
    for i in range(3):
        for j in range(3):
            r.append(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j])
    t = _transformer((a[9], a[10], a[11]), b)
    return tuple(r) + t


def _bilan(triangles):
    """triangles : itérable de (p1, p2, p3). Calcule boîte, volume signé et surface."""
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    vol = 0.0
    surf = 0.0
    n = 0
    for a, b, c in triangles:
        n += 1
        for p in (a, b, c):
            for i in range(3):
                if p[i] < mn[i]:
                    mn[i] = p[i]
                if p[i] > mx[i]:
                    mx[i] = p[i]
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        cx = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        surf += 0.5 * (cx[0] ** 2 + cx[1] ** 2 + cx[2] ** 2) ** 0.5
    if n == 0:
        return {"triangles": 0}
    return {
        "triangles": n,
        "min": [round(v, 3) for v in mn],
        "max": [round(v, 3) for v in mx],
        "dimensions": [round(mx[i] - mn[i], 2) for i in range(3)],
        "volume_mm3": round(abs(vol), 1),
        "surface_mm2": round(surf, 1),
    }


# ---------------------------------------------------------------- miniature (rendu logiciel)

def _png(largeur, hauteur, pixels):
    """pixels : bytearray RGBA ligne par ligne."""
    import zlib
    brut = b"".join(b"\x00" + bytes(pixels[y * largeur * 4:(y + 1) * largeur * 4]) for y in range(hauteur))

    def bloc(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + bloc(b"IHDR", struct.pack(">IIBBBBB", largeur, hauteur, 8, 6, 0, 0, 0))
            + bloc(b"IDAT", zlib.compress(brut, 6)) + bloc(b"IEND", b""))


def miniature(triangles, largeur=320, hauteur=240, couleur=(224, 102, 27), max_tri=150000):
    """Vue isométrique ombrée (Z vers le haut), fond transparent, tampon de profondeur."""
    import math
    tris = list(triangles)
    if not tris:
        return None
    if len(tris) > max_tri:
        tris = tris[::math.ceil(len(tris) / max_tri)]
    # caméra placée devant à droite et au-dessus (comme la visionneuse) : direction vers la caméra = vue
    az, el = math.radians(-45), math.radians(30)
    vue = (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))
    f = (-vue[0], -vue[1], -vue[2])                               # regard
    ex = (f[1], -f[0], 0.0)                                       # droite écran = regard × Z
    n_ex = math.hypot(ex[0], ex[1])
    ex = (ex[0] / n_ex, ex[1] / n_ex, 0.0)
    ey = (ex[1] * f[2] - ex[2] * f[1], ex[2] * f[0] - ex[0] * f[2], ex[0] * f[1] - ex[1] * f[0])  # haut écran = droite × regard
    lum = (0.35, -0.55, 0.76)

    def proj(p):
        return (p[0] * ex[0] + p[1] * ex[1] + p[2] * ex[2], p[0] * ey[0] + p[1] * ey[1] + p[2] * ey[2],
                p[0] * vue[0] + p[1] * vue[1] + p[2] * vue[2])
    pts = [tuple(proj(p) for p in t) for t in tris]
    xs = [p[0] for t in pts for p in t]
    ys = [p[1] for t in pts for p in t]
    mx, Mx, my, My = min(xs), max(xs), min(ys), max(ys)
    ech = 0.9 * min(largeur / max(Mx - mx, 1e-9), hauteur / max(My - my, 1e-9))
    ox = (largeur - (Mx - mx) * ech) / 2 - mx * ech
    oy = (hauteur - (My - my) * ech) / 2 + My * ech
    prof = [float("-inf")] * (largeur * hauteur)
    px = bytearray(largeur * hauteur * 4)
    for t3, t in zip(tris, pts):
        a, b, c = t3
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        ln = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2) or 1
        n = (n[0] / ln, n[1] / ln, n[2] / ln)
        face_vue = n[0] * vue[0] + n[1] * vue[1] + n[2] * vue[2]
        k = 0.35 + 0.65 * max(0.0, n[0] * lum[0] + n[1] * lum[1] + n[2] * lum[2])
        if face_vue < 0:  # face arrière (maillage non fermé) : plus sombre
            k *= 0.5
        col = (int(couleur[0] * k), int(couleur[1] * k), int(couleur[2] * k))
        (x0, y0, z0), (x1, y1, z1), (x2, y2, z2) = [(p[0] * ech + ox, oy - p[1] * ech, p[2]) for p in t]
        aire = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
        if abs(aire) < 1e-12:
            continue
        for yy in range(max(0, int(min(y0, y1, y2))), min(hauteur - 1, int(max(y0, y1, y2)) + 1) + 1):
            for xx in range(max(0, int(min(x0, x1, x2))), min(largeur - 1, int(max(x0, x1, x2)) + 1) + 1):
                cx, cy = xx + 0.5, yy + 0.5
                w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) / aire
                w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / aire
                w2 = 1 - w0 - w1
                if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
                    continue
                z = w0 * z0 + w1 * z1 + w2 * z2
                i = yy * largeur + xx
                if z > prof[i]:
                    prof[i] = z
                    px[i * 4:i * 4 + 4] = bytes((*col, 255))
    return _png(largeur, hauteur, px)


# ---------------------------------------------------------------- STL

def triangles_stl(donnees: bytes):
    if len(donnees) >= 84:
        n = struct.unpack_from("<I", donnees, 80)[0]
        if 84 + n * 50 == len(donnees):
            for i in range(n):
                f = struct.unpack_from("<12f", donnees, 84 + i * 50)
                yield f[3:6], f[6:9], f[9:12]
            return
    # ASCII
    pts = []
    for ligne in donnees.decode("utf-8", "replace").splitlines():
        ligne = ligne.strip()
        if ligne.startswith("vertex"):
            pts.append(tuple(float(v) for v in ligne.split()[1:4]))
            if len(pts) == 3:
                yield tuple(pts)
                pts = []


def analyser_stl(chemin: Path):
    return _bilan(triangles_stl(chemin.read_bytes()))


# ---------------------------------------------------------------- 3MF

def _nom_local(tag):
    return tag.rsplit("}", 1)[-1]


def _matrice(texte):
    if not texte:
        return IDENTITE
    v = [float(x) for x in texte.split()]
    return tuple(v) if len(v) == 12 else IDENTITE


def _lire_modele(xml_bytes):
    """Renvoie (objets, items) : objets[id] = {'mesh': (verts, tris)} ou {'composants': [(chemin, id, m)]}."""
    racine = ET.fromstring(xml_bytes)
    objets = {}
    items = []
    for el in racine.iter():
        nom = _nom_local(el.tag)
        if nom == "object":
            oid = el.get("id")
            mesh = None
            comps = []
            for sous in el:
                sn = _nom_local(sous.tag)
                if sn == "mesh":
                    verts = []
                    tris = []
                    for m in sous:
                        mn = _nom_local(m.tag)
                        if mn == "vertices":
                            verts = [(float(v.get("x")), float(v.get("y")), float(v.get("z"))) for v in m]
                        elif mn == "triangles":
                            tris = [(int(t.get("v1")), int(t.get("v2")), int(t.get("v3"))) for t in m]
                    mesh = (verts, tris)
                elif sn == "components":
                    for c in sous:
                        chemin = None
                        for k, v in c.attrib.items():
                            if _nom_local(k) == "path":
                                chemin = v
                        comps.append((chemin, c.get("objectid"), _matrice(c.get("transform"))))
            objets[oid] = {"mesh": mesh} if mesh else {"composants": comps}
        elif nom == "item":
            items.append((el.get("objectid"), _matrice(el.get("transform"))))
    return objets, items


def triangles_3mf(zf: zipfile.ZipFile):
    modeles = {}
    for n in zf.namelist():
        if n.lower().endswith(".model"):
            modeles["/" + n.lstrip("/")] = _lire_modele(zf.read(n))
    racine = "/3D/3dmodel.model"
    if racine not in modeles:
        racine = next(iter(modeles), None)
    if racine is None:
        return

    def parcourir(fichier, oid, m, profondeur=0):
        if profondeur > 10 or fichier not in modeles:
            return
        obj = modeles[fichier][0].get(oid)
        if not obj:
            return
        if "mesh" in obj:
            verts, tris = obj["mesh"]
            pts = [_transformer(p, m) for p in verts]
            for a, b, c in tris:
                yield pts[a], pts[b], pts[c]
        else:
            for chemin, cid, cm in obj["composants"]:
                yield from parcourir(chemin or fichier, cid, _composer(cm, m), profondeur + 1)

    for oid, m in modeles[racine][1]:
        yield from parcourir(racine, oid, m)


def _reglages_trancheur(zf: zipfile.ZipFile):
    """Réglages enregistrés par Bambu Studio / OrcaSlicer (si présents)."""
    out = {}
    noms = zf.namelist()
    if "Metadata/project_settings.config" in noms:
        try:
            cfg = json.loads(zf.read("Metadata/project_settings.config"))

            def premier(v):
                return v[0] if isinstance(v, list) and v else v

            for cle, nom in [("printer_model", "imprimante"), ("printer_settings_id", "profil_imprimante"),
                             ("print_settings_id", "profil_impression"), ("filament_settings_id", "profil_filament"),
                             ("filament_type", "filament"), ("layer_height", "hauteur_couche"),
                             ("sparse_infill_density", "remplissage"), ("nozzle_diameter", "buse"),
                             ("wall_loops", "parois"), ("enable_support", "supports")]:
                if cle in cfg:
                    out[nom] = premier(cfg[cle])
        except (ValueError, KeyError):
            pass
    if "Metadata/slice_info.config" in noms:
        try:
            r = ET.fromstring(zf.read("Metadata/slice_info.config"))
            for plate in r.iter("plate"):
                for md in plate.iter("metadata"):
                    if md.get("key") == "prediction":
                        out["duree_estimee_s"] = int(float(md.get("value")))
                    elif md.get("key") == "weight":
                        out["poids_estime_g"] = float(md.get("value"))
                break
        except ET.ParseError:
            pass
    if "Metadata/model_settings.config" in noms:
        try:
            r = ET.fromstring(zf.read("Metadata/model_settings.config"))
            out["plateaux"] = len(list(r.iter("plate"))) or None
        except ET.ParseError:
            pass
    return {k: v for k, v in out.items() if v not in (None, "")}


def miniature_3mf(zf: zipfile.ZipFile):
    noms = zf.namelist()
    for cand in ["Metadata/plate_1.png", "Metadata/thumbnail.png", "Metadata/plate_1_small.png"]:
        if cand in noms:
            return zf.read(cand)
    for n in noms:
        if n.lower().startswith("metadata/") and n.lower().endswith(".png"):
            return zf.read(n)
    return None


def analyser_3mf(chemin: Path):
    with zipfile.ZipFile(chemin) as zf:
        tris = list(triangles_3mf(zf))
        bilan = _bilan(tris)
        reglages = _reglages_trancheur(zf)
        if reglages:
            bilan["reglages_3mf"] = reglages
        return bilan, miniature_3mf(zf) or miniature(tris)


# ---------------------------------------------------------------- G-code

def analyser_gcode(chemin: Path):
    """Lit les commentaires de fin de fichier des trancheurs courants (durée, filament)."""
    meta = {}
    with open(chemin, "rb") as f:
        f.seek(0, 2)
        taille = f.tell()
        f.seek(max(0, taille - 60000))
        fin = f.read().decode("utf-8", "replace")
        f.seek(0)
        debut = f.read(20000).decode("utf-8", "replace")
    texte = debut + "\n" + fin
    m = re.search(r"total filament weight \[g\]\s*:\s*([\d.]+)|filament used \[g\]\s*=\s*([\d.]+)", texte)
    if m:
        meta["poids_estime_g"] = float(m.group(1) or m.group(2))
    m = re.search(r"estimated printing time.*?=\s*(.+)|model printing time:\s*([^;\n]+)", texte)
    if m:
        meta["duree_texte"] = (m.group(1) or m.group(2)).strip()
    m = re.search(r";\s*printer_model\s*=\s*(.+)", texte)
    if m:
        meta["imprimante"] = m.group(1).strip()
    return meta


# ---------------------------------------------------------------- aiguillage

TYPES = {
    ".stl": "stl", ".3mf": "3mf", ".step": "step", ".stp": "step", ".gcode": "gcode", ".bgcode": "gcode",
    ".fs": "fs", ".scad": "source", ".f3d": "source", ".pdf": "pdf",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".svg": "image",
    ".obj": "obj", ".pwmx": "resine", ".pwma": "resine", ".pws": "resine",
}
ROLES = {"stl": "piece", "3mf": "piece", "obj": "piece", "step": "source", "fs": "source", "source": "source",
         "gcode": "gcode", "resine": "gcode", "pdf": "plan", "image": "plan"}


def type_fichier(nom: str):
    return TYPES.get(Path(nom).suffix.lower(), "autre")


def analyser(chemin: Path, typ: str):
    """Renvoie (meta, miniature_png_ou_None). Ne lève pas : une erreur est notée dans meta."""
    try:
        if typ == "stl":
            tris = list(triangles_stl(chemin.read_bytes()))
            return _bilan(tris), miniature(tris)
        if typ == "3mf":
            return analyser_3mf(chemin)
        if typ == "gcode" and chemin.suffix.lower() == ".gcode":
            return analyser_gcode(chemin), None
    except Exception as e:  # fichier abîmé : on le garde quand même
        return {"erreur_analyse": str(e)[:200]}, None
    return {}, None
