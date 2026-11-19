"""Modèle CAO d'une imprimante (STEP, assemblage) → « jumeau » en traits pour la page de la machine.

Garde les vraies arêtes de la CAO (pas de triangles) : arêtes vives et arêtes douces (raccords tangents, tracées plus
pâles), sans les coutures des cylindres. Range chaque pièce de l'assemblage dans un groupe mobile (plateau, portique,
tête) ou fixe, repère la pointe de la buse et le dessus de la plaque, et écrit data/modeles/<clé>.traits.json, lu
par static/jumeau3d.js (clé = « marque-modele », ex. bambu-lab-a1 : la même que l'image du modèle).

Il faut OpenCascade, hors des dépendances de l'appli (gros paquet, utile seulement ici) :

    python -m venv .venv-cao && .venv-cao/bin/pip install "cadquery-ocp==7.7.2"
    .venv-cao/bin/python -m outils.step_en_traits imprimante.step bambu-lab-a1 \\
        --plateau heatbed,buildplate --portique "x axis" --tete toolhead --plaque buildplate

Les pièces sont désignées par un morceau de leur nom dans le STEP (sans tenir compte des majuscules) ; le script
liste les noms trouvés. Repère attendu dans le STEP (celui de l'A1, exporté de SolidWorks) : y vers le haut, plateau qui
avance et recule sur z, tête qui va de gauche à droite sur x (imprimante à plateau mobile). Autre repère ou autre
cinématique (CoreXY, caisson) : à ajouter ici et dans static/jumeau3d.js.
"""
import argparse
import json
import math
import os
from pathlib import Path


def lire_assemblage(chemin):
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDataStd import TDataStd_Name
    from OCP.TDF import TDF_Label, TDF_LabelSequence
    from OCP.TDocStd import TDocStd_Document
    from OCP.XCAFDoc import XCAFDoc_DocumentTool

    doc = TDocStd_Document(TCollection_ExtendedString("atelier3d"))
    lecteur = STEPCAFControl_Reader()
    lecteur.SetNameMode(True)
    if lecteur.ReadFile(str(chemin)) != 1:
        raise SystemExit(f"STEP illisible : {chemin}")
    lecteur.Transfer(doc)
    outil = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())

    def nom(label):
        n = TDataStd_Name()
        return n.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(), n) else "?"

    racines = TDF_LabelSequence()
    outil.GetFreeShapes(racines)
    pieces = []
    for i in range(1, racines.Length() + 1):
        comps = TDF_LabelSequence()
        outil.GetComponents_s(racines.Value(i), comps, False)
        if comps.Length() == 0:  # pièce seule, pas un assemblage
            pieces.append((nom(racines.Value(i)), outil.GetShape_s(racines.Value(i))))
        for j in range(1, comps.Length() + 1):
            comp, ref = comps.Value(j), TDF_Label()
            nom_piece = nom(ref) if outil.GetReferredShape_s(comp, ref) else nom(comp)
            pieces.append((nom_piece, outil.GetShape_s(comp)))  # forme placée dans l'assemblage
    return pieces


def traits(forme, deflexion=0.15, mini=0.6):
    """Segments [x,y,z, x,y,z, …] des arêtes vives et des arêtes douces d'une forme."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GCPnts import GCPnts_AbscissaPoint, GCPnts_TangentialDeflection
    from OCP.GeomAbs import GeomAbs_C0, GeomAbs_Line
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
    from OCP.TopExp import TopExp
    from OCP.TopoDS import TopoDS
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape

    carte = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(forme, TopAbs_EDGE, TopAbs_FACE, carte)
    vives, douces = [], []
    for i in range(1, carte.Extent() + 1):
        arete = TopoDS.Edge_s(carte.FindKey(i))
        if BRep_Tool.Degenerated_s(arete):
            continue
        faces = []
        for f in carte.FindFromIndex(i):
            if not any(f.IsSame(g) for g in faces):
                faces.append(f)
        if len(faces) == 1 and BRep_Tool.IsClosed_s(arete, TopoDS.Face_s(faces[0])):
            continue  # couture d'un cylindre, d'un tore, d'une sphère : pas une vraie arête
        courbe = BRepAdaptor_Curve(arete)
        try:
            if GCPnts_AbscissaPoint.Length_s(courbe) < mini:
                continue  # détails minuscules (filets, gravures) : du bruit à cette échelle
        except Exception:
            continue
        douce = len(faces) == 2 and BRep_Tool.Continuity_s(arete, TopoDS.Face_s(faces[0]), TopoDS.Face_s(faces[1])) != GeomAbs_C0
        if courbe.GetType() == GeomAbs_Line:
            pts = [courbe.Value(courbe.FirstParameter()), courbe.Value(courbe.LastParameter())]
        else:
            d = GCPnts_TangentialDeflection(courbe, math.radians(12), deflexion)
            pts = [d.Value(k) for k in range(1, d.NbPoints() + 1)]
        cible = douces if douce else vives
        for a, b in zip(pts, pts[1:]):
            cible += [round(a.X(), 1), round(a.Y(), 1), round(a.Z(), 1), round(b.X(), 1), round(b.Y(), 1), round(b.Z(), 1)]
    return vives, douces


def points(segments):
    return [segments[i:i + 3] for i in range(0, len(segments), 3)]


def main():
    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument("step")
    a.add_argument("cle", help="marque-modele, ex. bambu-lab-a1 (comme l'image du modèle)")
    a.add_argument("--plateau", default="heatbed,buildplate,bed", help="pièces qui bougent avec le plateau")
    a.add_argument("--portique", default="x axis,gantry", help="pièces qui montent et descendent (axe X)")
    a.add_argument("--tete", default="toolhead,hotend", help="pièces de la tête d'impression")
    a.add_argument("--plaque", default="buildplate,plate", help="pièce dont le dessus est la surface d'impression")
    a.add_argument("--volume", default="256,256,256", help="volume d'impression x,y,z en mm")
    a.add_argument("--sortie", help="fichier de sortie (défaut : data/modeles/<clé>.traits.json)")
    o = a.parse_args()

    groupe_de = lambda n: next((g for g, motifs in (("tete", o.tete), ("portique", o.portique), ("plateau", o.plateau))
                                if any(m.strip().lower() in n.lower() for m in motifs.split(",") if m.strip())), "fixe")
    haut = 1  # y vers le haut
    pieces, buse, plaque = [], None, None
    for nom, forme in lire_assemblage(o.step):
        vives, douces = traits(forme)
        groupe = groupe_de(nom)
        pieces.append({"nom": nom, "groupe": groupe, "vives": vives, "douces": douces})
        print(f"  {nom:40s} → {groupe:9s} {len(vives) // 6:6d} arêtes vives, {len(douces) // 6:5d} douces")
        pts = points(vives + douces)
        if groupe == "tete" and pts:  # pointe de la buse : le plus bas de la tête
            bas = min(p[haut] for p in pts)
            pointe = [p for p in pts if p[haut] < bas + 0.6]
            buse = [round(sum(p[k] for p in pointe) / len(pointe), 2) for k in range(3)]
        if pts and any(m.strip().lower() in nom.lower() for m in o.plaque.split(",") if m.strip()):
            mins = [min(p[k] for p in pts) for k in range(3)]
            maxs = [max(p[k] for p in pts) for k in range(3)]
            plaque = {"haut": maxs[haut], "centre": [round((mins[k] + maxs[k]) / 2, 2) for k in range(3)]}
    if not buse or not plaque:
        raise SystemExit("tête ou plaque introuvable : voir les noms ci-dessus et les options --tete / --plaque")
    sortie = Path(o.sortie or Path(os.environ.get("ATELIER3D_DONNEES", Path(__file__).parent.parent / "data")) / "modeles" / f"{o.cle}.traits.json")
    sortie.parent.mkdir(parents=True, exist_ok=True)
    sortie.write_text(json.dumps({
        "version": 1, "source": Path(o.step).name, "haut": "y", "axe_plateau": "z",
        "volume": [float(v) for v in o.volume.split(",")], "buse": buse, "plaque": plaque, "pieces": pieces,
    }, separators=(",", ":")))
    print(f"→ {sortie} ({sortie.stat().st_size // 1024} ko) ; buse {buse}, dessus de la plaque {plaque['haut']}")


if __name__ == "__main__":
    main()
