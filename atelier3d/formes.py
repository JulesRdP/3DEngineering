"""Reconnaissance des formes d'une pièce maillée (STL / 3MF), pour coter les plans.

Un STL ne contient que des triangles : on y retrouve les faces planes et les surfaces cylindriques
(trous, lamages, bossages, oblongs, congés), quel que soit l'axe. Principe :
- les triangles coplanaires voisins forment des « facettes » ;
- entre deux facettes d'un cylindre, l'arête commune est une génératrice : une droite parallèle à l'axe,
  qui se projette en un point du cercle. On enchaîne ces génératrices de facette en facette, on découpe la
  chaîne là où le cercle change (passage à un plan tangent, à un autre rayon) et on ajuste un cercle par arc.
Les valeurs sont mesurées sur le maillage : exactes si les sommets sont sur le cercle (export CAO habituel).
"""
import math

ARETE_VIVE = math.cos(math.radians(35))   # au-delà de 35° entre facettes : arête vive, pas un cylindre
COPLAN = math.cos(math.radians(0.02))   # facettes d'un cylindre très finement découpé : jusqu'à ~0,03° d'écart
PARALLELE = math.cos(math.radians(1))
MAX_TRIANGLES = 200000


def _sous(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _pv(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _ps(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norme(a):
    return math.sqrt(_ps(a, a))


def _unit(a):
    n = _norme(a) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def _canon(d):
    """Sens conventionnel d'un axe (composante dominante positive) et alignement exact sur X, Y, Z si proche."""
    i = max(range(3), key=lambda k: abs(d[k]))
    if d[i] < 0:
        d = (-d[0], -d[1], -d[2])
    if abs(d[i]) > 0.99999:
        d = tuple(1.0 if k == i else 0.0 for k in range(3))
    return d


def _base(d):
    """Deux vecteurs unitaires orthogonaux à d."""
    a = (1.0, 0.0, 0.0) if abs(d[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = _unit(_pv(d, a))
    return u, _pv(d, u)


def _r(v, n=4):
    return round(v, n) + 0.0


def _rv(v, n=4):
    return [_r(x, n) for x in v]


class _Ensembles:
    def __init__(self, n):
        self.p = list(range(n))

    def trouver(self, i):
        while self.p[i] != i:
            self.p[i] = self.p[self.p[i]]
            i = self.p[i]
        return i

    def unir(self, a, b):
        a, b = self.trouver(a), self.trouver(b)
        if a != b:
            self.p[b] = a


def _cercle3(p, q, r):
    """Cercle passant par trois points 2D : (cx, cy, rayon) ou None s'ils sont alignés."""
    ax, ay = p
    bx, by = q
    cx, cy = r
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None
    a2, b2, c2 = ax * ax + ay * ay, bx * bx + by * by, cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    return ux, uy, math.hypot(ax - ux, ay - uy)


def _ajuster_cercle(pts):
    """Moindres carrés (méthode de Kåsa) sur des points recentrés : (cx, cy, rayon, écart max)."""
    mx = sum(p[0] for p in pts) / len(pts)
    my = sum(p[1] for p in pts) / len(pts)
    suu = suv = svv = suuu = svvv = suvv = svuu = 0.0
    for x, y in pts:
        u, v = x - mx, y - my
        suu += u * u
        suv += u * v
        svv += v * v
        suuu += u * u * u
        svvv += v * v * v
        suvv += u * v * v
        svuu += v * u * u
    det = suu * svv - suv * suv
    if abs(det) < 1e-18:
        return None
    b1 = 0.5 * (suuu + suvv)
    b2 = 0.5 * (svvv + svuu)
    uc = (b1 * svv - b2 * suv) / det
    vc = (suu * b2 - suv * b1) / det
    cx, cy = uc + mx, vc + my
    r = sum(math.hypot(x - cx, y - cy) for x, y in pts) / len(pts)
    ecart = max(abs(math.hypot(x - cx, y - cy) - r) for x, y in pts)
    return cx, cy, r, ecart


def _dans_solide(q, faces, pts):
    """Point dans le volume ? Parité des intersections d'un rayon (Möller-Trumbore)."""
    d = (0.5377, 0.6011, 0.5911)
    n = 0
    for ia, ib, ic in faces:
        a, b, c = pts[ia], pts[ib], pts[ic]
        e1, e2 = _sous(b, a), _sous(c, a)
        h = _pv(d, e2)
        det = _ps(e1, h)
        if abs(det) < 1e-12:
            continue
        s = _sous(q, a)
        u = _ps(s, h) / det
        if u < 0 or u > 1:
            continue
        w = _pv(s, e1)
        v = _ps(d, w) / det
        if v < 0 or u + v > 1:
            continue
        if _ps(e2, w) / det > 1e-9:
            n += 1
    return n % 2 == 1


def reconnaitre(triangles):
    """triangles : liste de (p1, p2, p3). Renvoie le dictionnaire des formes, ou None si trop gros / vide."""
    if not triangles or len(triangles) > MAX_TRIANGLES:
        return None

    # --- soudure des sommets, normales
    index, pts, faces, normales, aires = {}, [], [], [], []

    def sommet(p):
        k = (round(p[0] * 1e4), round(p[1] * 1e4), round(p[2] * 1e4))
        i = index.get(k)
        if i is None:
            i = index[k] = len(pts)
            pts.append((float(p[0]), float(p[1]), float(p[2])))
        return i

    for a, b, c in triangles:
        ia, ib, ic = sommet(a), sommet(b), sommet(c)
        if ia == ib or ib == ic or ia == ic:
            continue
        n = _pv(_sous(pts[ib], pts[ia]), _sous(pts[ic], pts[ia]))
        ln = _norme(n)
        if ln < 1e-12:
            continue
        faces.append((ia, ib, ic))
        normales.append((n[0] / ln, n[1] / ln, n[2] / ln))
        aires.append(ln / 2)
    if not faces:
        return None
    surface = sum(aires)

    aretes = {}
    for f, (ia, ib, ic) in enumerate(faces):
        for s, t in ((ia, ib), (ib, ic), (ic, ia)):
            aretes.setdefault((s, t) if s < t else (t, s), []).append(f)

    # --- facettes : triangles coplanaires voisins
    ens = _Ensembles(len(faces))
    for fs in aretes.values():
        if len(fs) == 2 and _ps(normales[fs[0]], normales[fs[1]]) > COPLAN:
            ens.unir(fs[0], fs[1])
    fac_de = [ens.trouver(f) for f in range(len(faces))]
    facettes = {}
    for f, k in enumerate(fac_de):
        e = facettes.setdefault(k, {"aire": 0.0, "n": [0.0, 0.0, 0.0], "c": [0.0, 0.0, 0.0], "grand": (0.0, f), "faces": []})
        e["faces"].append(f)
        a = aires[f]
        e["aire"] += a
        for i in range(3):
            e["n"][i] += normales[f][i] * a
            e["c"][i] += sum(pts[v][i] for v in faces[f]) / 3 * a
        if a > e["grand"][0]:
            e["grand"] = (a, f)
    for e in facettes.values():
        e["n"] = _unit(e["n"])
        e["c"] = tuple(x / e["aire"] for x in e["c"])

    # --- génératrices : arêtes douces entre deux facettes différentes, regroupées par paire de facettes
    lignes = {}
    for (s, t), fs in aretes.items():
        if len(fs) != 2:
            continue
        ka, kb = fac_de[fs[0]], fac_de[fs[1]]
        if ka == kb:
            continue
        ps = _ps(facettes[ka]["n"], facettes[kb]["n"])
        if ps > COPLAN or ps < ARETE_VIVE:
            continue
        lignes.setdefault((min(ka, kb), max(ka, kb)), []).append((s, t))
    gen = {}
    for cle, segs in lignes.items():
        long_seg = max(segs, key=lambda st: _norme(_sous(pts[st[1]], pts[st[0]])))
        d = _unit(_sous(pts[long_seg[1]], pts[long_seg[0]]))
        if any(abs(_ps(_unit(_sous(pts[t], pts[s])), d)) < PARALLELE for s, t in segs):
            continue  # arête commune pas droite : pas une génératrice de cylindre
        gen[cle] = {"d": d, "p": pts[long_seg[0]], "bouts": [pts[v] for st in segs for v in st]}

    # --- enchaînement : une facette qui porte exactement deux génératrices parallèles relie les deux
    par_facette = {}
    for cle in gen:
        for k in cle:
            par_facette.setdefault(k, []).append(cle)
    voisins = {cle: {} for cle in gen}
    for k, ls in par_facette.items():
        groupes = []
        for l in ls:
            for g in groupes:
                if abs(_ps(gen[g[0]]["d"], gen[l]["d"])) > PARALLELE:
                    g.append(l)
                    break
            else:
                groupes.append([l])
        for g in groupes:
            if len(g) == 2:
                voisins[g[0]][k] = g[1]
                voisins[g[1]][k] = g[0]

    vu = set()

    def marcher(l0):
        seq, via = [l0], []
        vu.add(l0)
        if not voisins[l0]:
            return seq, via, False
        k, suiv = next(iter(voisins[l0].items()))
        while True:
            if suiv == l0:
                return seq, via + [k], True
            if suiv in vu:
                return seq, via, False
            via.append(k)
            seq.append(suiv)
            vu.add(suiv)
            autres = [(kk, l) for kk, l in voisins[suiv].items() if kk != k]
            if not autres:
                return seq, via, False
            k, suiv = autres[0]

    chaines = [marcher(l) for l in gen if len(voisins[l]) <= 1 and l not in vu]
    chaines += [marcher(l) for l in gen if l not in vu]

    # --- arcs de cercle le long des chaînes
    arcs, courbes = [], set()
    for seq, via, cyclique in chaines:
        if len(seq) < 3:
            continue
        d0 = gen[seq[0]]["d"]
        ds = [gen[l]["d"] if _ps(gen[l]["d"], d0) > 0 else tuple(-x for x in gen[l]["d"]) for l in seq]
        d = _canon(_unit(tuple(sum(v[i] for v in ds) for i in range(3))))
        if any(abs(_ps(v, d)) < PARALLELE for v in ds):
            continue
        u, v = _base(d)
        p2 = [(_ps(gen[l]["p"], u), _ps(gen[l]["p"], v)) for l in seq]
        n = len(p2)
        ordre = list(range(n)) if cyclique else list(range(1, n - 1))
        cercles = {i: _cercle3(p2[i - 1], p2[i], p2[(i + 1) % n]) for i in ordre}

        def pareil(a, b):
            if a is None or b is None:
                return False
            tol = max(0.05, 0.02 * max(a[2], b[2]))
            return abs(a[2] - b[2]) < tol and math.hypot(a[0] - b[0], a[1] - b[1]) < tol

        if cyclique:  # démarrer sur une rupture, s'il y en a une
            ruptures = [i for i in ordre if not pareil(cercles[i], cercles[(i - 1) % n])]
            if ruptures:
                k0 = ruptures[0]
                ordre = ordre[k0:] + ordre[:k0]
        groupes, courant = [], []
        for i in ordre:
            if courant and pareil(cercles[courant[0]], cercles[i]):
                courant.append(i)
            else:
                if courant:
                    groupes.append(courant)
                courant = [i] if cercles[i] else []
        if courant:
            groupes.append(courant)
        complet = cyclique and len(groupes) == 1 and len(groupes[0]) == n
        for g in groupes:
            idx = list(range(n)) if complet else [g[0] - 1] + g + [g[-1] + 1]
            idx = [i % n for i in idx]
            fit = _ajuster_cercle([p2[i] for i in idx])
            if not fit:
                continue
            cx, cy, r, ecart = fit
            if r < 0.2 or r > 5000 or ecart > max(0.02, 0.003 * r):
                continue
            angles = [math.atan2(p2[i][1] - cy, p2[i][0] - cx) for i in idx]
            if complet:
                ouverture = 360.0
            else:
                tour = 0.0
                for a, b in zip(angles, angles[1:]):
                    tour += (b - a + math.pi) % (2 * math.pi) - math.pi
                ouverture = abs(math.degrees(tour))
            if ouverture < 20:
                continue
            ts = [_ps(p, d) for i in idx for p in gen[seq[i]]["bouts"]]
            debut, fin = min(ts), max(ts)
            # facette au milieu de l'arc : sa normale dit si la matière est dehors (creux) ou dedans (bossage)
            k = via[min(len(via) - 1, idx[len(idx) // 2 - 1])] if via else seq[0][0]
            fc = facettes[k]
            centre3 = tuple(cx * u[i] + cy * v[i] for i in range(3))
            rad = _sous(fc["c"], centre3)
            rad = _sous(rad, tuple(_ps(rad, d) * x for x in d))
            creux = _ps(fc["n"], rad) < 0
            am = sum(angles) / len(angles) if complet else angles[len(angles) // 2]
            milieu = tuple(math.cos(am) * u[i] + math.sin(am) * v[i] for i in range(3))
            arcs.append({"axe": d, "c2": (cx, cy), "u": u, "v": v, "r": r, "debut": debut, "fin": fin,
                         "creux": creux, "angle": ouverture, "milieu": milieu})
            # facettes de cet arc : ce ne sont pas des faces planes de la pièce
            for j in range(len(idx) if complet else len(idx) - 1):
                if idx[j] < len(via):
                    courbes.add(via[idx[j]])

    # --- fusion des arcs d'un même cylindre (chaîne coupée par une autre forme)
    fusion = []
    for a in arcs:
        for b in fusion:
            if (_ps(a["axe"], b["axe"]) > PARALLELE and a["creux"] == b["creux"] and abs(a["r"] - b["r"]) < max(0.02, 0.003 * a["r"])
                    and math.hypot(_ps(_axe_point(a), b["u"]) - b["c2"][0], _ps(_axe_point(a), b["v"]) - b["c2"][1]) < 0.05
                    and a["debut"] < b["fin"] + 0.05 and b["debut"] < a["fin"] + 0.05 and b["angle"] < 359):
                b["angle"] = min(360.0, b["angle"] + a["angle"])
                b["debut"], b["fin"] = min(a["debut"], b["debut"]), max(a["fin"], b["fin"])
                break
        else:
            fusion.append(dict(a))
    for a in fusion:
        if a["angle"] >= 350:
            a["angle"] = 360.0

    pleins = [a for a in fusion if a["angle"] == 360.0]
    partiels = [a for a in fusion if a["angle"] < 360.0]

    # --- oblongs : deux demi-cylindres creux de même rayon qui se tournent le dos
    oblongs, pris = [], set()
    for i, a in enumerate(partiels):
        if i in pris or not a["creux"] or not 170 <= a["angle"] <= 190:
            continue
        for j in range(i + 1, len(partiels)):
            b = partiels[j]
            if j in pris or not b["creux"] or not 170 <= b["angle"] <= 190:
                continue
            if (_ps(a["axe"], b["axe"]) > PARALLELE and abs(a["r"] - b["r"]) < 0.02 and abs(a["debut"] - b["debut"]) < 0.05
                    and abs(a["fin"] - b["fin"]) < 0.05 and _ps(a["milieu"], b["milieu"]) < -0.999):
                pa, pb = _axe_point(a), _axe_point(b)
                ecart = _sous(pa, pb)
                if _ps(ecart, a["milieu"]) > 0:
                    pris.update((i, j))
                    oblongs.append({"axe": _rv(a["axe"], 6), "c1": _rv(_point(b, b["debut"])), "c2": _rv(_point(a, a["debut"])),
                                    "r": _r(a["r"]), "entraxe": _r(_norme(ecart)), "debut": _r(a["debut"]), "fin": _r(a["fin"])})
                    break
    arrondis = [{"axe": _rv(a["axe"], 6), "centre": _rv(_point(a, a["debut"])), "r": _r(a["r"]), "angle": _r(a["angle"], 1),
                 "debut": _r(a["debut"]), "fin": _r(a["fin"]), "creux": a["creux"], "milieu": _rv(a["milieu"], 5)}
                for i, a in enumerate(partiels) if i not in pris]

    # --- perçages : cylindres pleins creux coaxiaux qui se suivent (trou + lamage...)
    percages = []
    for a in sorted((a for a in pleins if a["creux"]), key=lambda a: a["debut"]):
        for p in percages:
            b = p["etages"][-1]
            if (_ps(a["axe"], b["axe"]) > PARALLELE and abs(a["debut"] - b["fin"]) < 0.1
                    and math.hypot(_ps(_axe_point(a), b["u"]) - b["c2"][0], _ps(_axe_point(a), b["v"]) - b["c2"][1]) < 0.05):
                p["etages"].append(a)
                break
        else:
            percages.append({"etages": [a]})
    sortie_percages = []
    for p in percages[:80]:
        e0, e1 = p["etages"][0], p["etages"][-1]
        d = e0["axe"]
        ouvert_debut = not _dans_solide(_point(e0, e0["debut"] - 0.3), faces, pts)
        ouvert_fin = not _dans_solide(_point(e1, e1["fin"] + 0.3), faces, pts)
        sortie_percages.append({
            "axe": _rv(d, 6), "centre": _rv(_point(e0, e0["debut"])), "debut": _r(e0["debut"]), "fin": _r(e1["fin"]),
            "etages": [{"r": _r(e["r"]), "debut": _r(e["debut"]), "fin": _r(e["fin"])} for e in p["etages"]],
            "ouvert_debut": ouvert_debut, "ouvert_fin": ouvert_fin, "traversant": ouvert_debut and ouvert_fin})
    bossages = [{"axe": _rv(a["axe"], 6), "centre": _rv(_point(a, a["debut"])), "r": _r(a["r"]), "debut": _r(a["debut"]),
                 "fin": _r(a["fin"])} for a in pleins if not a["creux"]]

    # --- faces planes significatives
    plans = []
    for cle, e in sorted(facettes.items(), key=lambda ke: -ke[1]["aire"]):
        if e["aire"] < 0.002 * surface or len(plans) >= 200:
            break
        if cle in courbes:   # facette d'un cylindre reconnu
            continue
        n = e["n"]
        i = max(range(3), key=lambda k: abs(n[k]))
        if abs(n[i]) > 0.99999:
            n = tuple((1.0 if n[i] > 0 else -1.0) if k == i else 0.0 for k in range(3))
        f = e["grand"][1]
        point = tuple(sum(pts[v][k] for v in faces[f]) / 3 for k in range(3))
        sommets = [pts[v] for g in e["faces"] for v in faces[g]]
        plans.append({"n": _rv(n, 6), "d": _r(_ps(n, point)), "aire": _r(e["aire"], 1), "point": _rv(point),
                      "min": _rv([min(p[k] for p in sommets) for k in range(3)]),
                      "max": _rv([max(p[k] for p in sommets) for k in range(3)])})

    return {"version": 1, "percages": sortie_percages, "bossages": bossages[:80], "oblongs": oblongs[:80],
            "arrondis": arrondis[:200], "plans": plans}


def _axe_point(a):
    """Point de l'axe d'un arc à t = 0 (coordonnées 3D)."""
    return tuple(a["c2"][0] * a["u"][i] + a["c2"][1] * a["v"][i] for i in range(3))


def _point(a, t):
    p = _axe_point(a)
    return tuple(p[i] + t * a["axe"][i] for i in range(3))
