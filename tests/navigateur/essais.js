// Tests du code navigateur (traceur, PDF, arêtes, mise en plan), lancés par tests/test_navigateur.py
// dans un Edge / Chrome sans fenêtre. Paramètres : ?v1=&v2=&cube=&tube= (identifiants des fichiers déposés).
// Résultat écrit dans la page : RESULTATS:[{nom, ok, message}]:FIN
import { Feuille, largeurTexte, hachurer } from "/static/traceur.js";
import { pdfDepuisFeuilles } from "/static/pdf.js";
import { preparerMaillage, aretesVue, section } from "/static/aretes.js";
import { dessinerPlan } from "/static/plan.js";
import { chargerObjet } from "/static/vision.js";
import * as THREE from "three";

const q = new URLSearchParams(location.search);
const resultats = [];
async function essai(nom, fn) {
  const t0 = performance.now();
  try { await fn(); resultats.push({ nom, ok: true, ms: Math.round(performance.now() - t0) }); }
  catch (e) { resultats.push({ nom, ok: false, message: String((e && e.stack) || e).slice(0, 1500) }); }
}
const vrai = (c, msg = "condition fausse") => { if (!c) throw new Error(msg); };
const egal = (a, b, msg = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); };
const proche = (a, b, tol, msg = "") => vrai(Math.abs(a - b) <= tol, `${msg} attendu ${b} ± ${tol}, obtenu ${a}`);

async function fichier(id) {
  const f = await (await fetch(`/api/fichiers/${id}`)).json();
  return { f, obj: await chargerObjet(`/api/fichiers/${id}/contenu`, f.type) };
}
async function plan(id, cartouche = {}) {
  const { f, obj } = await fichier(id);
  const feuilles = dessinerPlan([obj], { reperes: f.meta.reperes || [], formes: f.meta.formes, cartouche: { designation: f.nom, ...cartouche } });
  // « tout » : le contenu de toutes les feuilles réunies (une cote doit exister une fois sur l'ensemble du plan)
  const tout = { ops: feuilles.flatMap((F) => F.ops), infos: { cercles: feuilles.flatMap((F) => F.infos.cercles), coupes: feuilles.flatMap((F) => F.infos.coupes), reperes: feuilles.flatMap((F) => F.infos.reperes) } };
  return { f, feuilles, tout };
}
const longueur = (lignes) => lignes.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0), 0);
const textes = (F) => F.ops.filter((o) => o.t === "texte").map((o) => o.s);
const nombre = (F, s) => textes(F).filter((t) => t === s).length;

// boîte englobante d'un texte (angles 0 ou 90 uniquement dans nos plans)
function boite(o) {
  const w = largeurTexte(o.s, o.h, o.gras), h = o.h, d = 0.22 * h;
  if (Math.abs(o.angle) < 1) return [o.x, o.y - h, o.x + w, o.y + d];
  if (Math.abs(o.angle - 90) < 1) return [o.x - h, o.y - w, o.x + d, o.y];
  return null;
}

function lirePdf(octets) {
  const s = Array.from(octets, (b) => String.fromCharCode(b)).join("");
  vrai(s.startsWith("%PDF-1.4"), "entête PDF");
  const xref = +/startxref\s+(\d+)/.exec(s)[1];
  vrai(s.slice(xref, xref + 4) === "xref", "position de la table xref");
  const lignes = s.slice(xref).split("\n");
  const n = +lignes[1].split(" ")[1];
  for (let k = 1; k < n; k++) vrai(s.slice(+lignes[2 + k].slice(0, 10)).startsWith(`${k} 0 obj`), `objet ${k} mal référencé`);
  return { s, pages: (s.match(/\/Type \/Page /g) || []).length, boites: [...s.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [+m[1], +m[2]]) };
}

// ------------------------------------------------------------------ traceur

await essai("traceur : formats et orientation", () => {
  const a4 = new Feuille("A4", "portrait"), a3 = new Feuille("A3", "paysage");
  egal([a4.largeur, a4.hauteur], [210, 297]); egal([a3.largeur, a3.hauteur], [420, 297]);
});

await essai("traceur : largeur de texte proportionnelle et alignements", () => {
  const w = largeurTexte("Ø22,8", 3.5);
  vrai(w > 5 && w < 20, `largeur ${w}`);
  proche(largeurTexte("Ø22,8", 7), 2 * w, 1e-6);
  const F = new Feuille("A4", "portrait");
  F.texte(100, 50, "Ø22,8", { h: 3.5, align: "c" });
  F.texte(100, 60, "Ø22,8", { h: 3.5, align: "d" });
  proche(F.ops[0].x, 100 - w / 2, 1e-6); proche(F.ops[1].x, 100 - w, 1e-6);
  F.texte(100, 70, "AB", { h: 3.5, angle: 90, align: "g", v: "milieu" });
  proche(F.ops[2].x, 100 + 1.75, 1e-6, "texte vertical centré sur la ligne");
});

await essai("traceur : hachures dans la zone, pas dans le trou", () => {
  const carre = [[0, 0], [20, 0], [20, 20], [0, 20]], trou = [[8, 8], [12, 8], [12, 12], [8, 12]];
  const segs = hachurer([carre, trou], 2, 45);
  vrai(segs.length > 10, "trop peu de hachures");
  for (const [p, q] of segs) for (const [x, y] of [p, q]) vrai(x > -1e-6 && x < 20 + 1e-6 && y > -1e-6 && y < 20 + 1e-6, "hachure hors zone");
  for (const [p, q] of segs) {
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    vrai(!(m[0] > 8.01 && m[0] < 11.99 && m[1] > 8.01 && m[1] < 11.99), "hachure dans le trou");
  }
});

await essai("traceur : rendu canvas à la bonne taille", () => {
  const F = new Feuille("A3", "paysage");
  F.segment(10, 10, 100, 10); F.texte(20, 20, "Échelle 1:1");
  const c = F.rendreCanvas(2);
  egal([c.width, c.height], [840, 594]);
});

// ------------------------------------------------------------------ PDF

await essai("PDF : structure, formats des pages, caractères WinAnsi", async () => {
  const a = new Feuille("A3", "paysage"), b = new Feuille("A4", "portrait");
  a.segment(10, 10, 50, 50, { motif: "interrompu" }); a.texte(30, 30, "Ø22,8 ± 0,1 – 45°");
  b.fleche(20, 20, 0); b.cercle(50, 50, 10);
  const { s, pages, boites } = lirePdf(new Uint8Array(await pdfDepuisFeuilles([a, b], { titre: "Pièce é" }).arrayBuffer()));
  egal(pages, 2, "pages");
  proche(boites[0][0], 1190.55, 0.01); proche(boites[0][1], 841.89, 0.01); proche(boites[1][0], 595.28, 0.01);
  vrai(s.includes("/BaseFont /Helvetica"), "police");
  vrai(s.includes("\xd822,8 \xb1 0,1 \x96 45\xb0"), "Ø ± – ° codés en WinAnsi");
  vrai(/\[8\.504 2\.126\] 0 d/.test(s), "motif interrompu en points");
});

// ------------------------------------------------------------------ arêtes

const rendu = new THREE.WebGLRenderer({ antialias: false });
const vueFace = { f: [0, 1, 0], u: [0, 0, 1], r: [1, 0, 0] }, vueDessus = { f: [0, 0, -1], u: [0, 1, 0], r: [1, 0, 0] };

await essai("arêtes : cube vu de face = contour seul, rien de caché", async () => {
  const { obj } = await fichier(q.get("cube"));
  const m = preparerMaillage([obj]);
  const a = aretesVue(m, vueFace, rendu);
  proche(longueur(a.vues), 40, 0.05, "périmètre vu");
  proche(longueur(a.cachees), 0, 0.05, "arêtes cachées");
});

await essai("arêtes : tube vu de dessus = deux cercles ; de face, trou caché", async () => {
  const { obj } = await fichier(q.get("tube"));
  const m = preparerMaillage([obj]);
  const dessus = aretesVue(m, vueDessus, rendu);
  proche(longueur(dessus.vues), 2 * Math.PI * 13, 0.5, "cercles Ø20 + Ø6");
  proche(longueur(dessus.cachees), 0, 0.05);
  const face = aretesVue(m, vueFace, rendu);
  proche(longueur(face.vues), 2 * (20 + 8), 0.2, "contour du tube");
  proche(longueur(face.cachees), 2 * 8, 0.2, "génératrices du trou");
  const coupe = section(m, { n: [1, 0, 0], c: 0 }, vueFace);
  egal(coupe.length, 2, "deux zones coupées");
});

// ------------------------------------------------------------------ mise en plan

// cotes attendues du support NEMA 17 V1 (toutes nécessaires pour refaire la pièce)
const COTES_V1 = ["14,5", "30", "45,5", "60", "15,5", "31", "46,5", "5", "15", "22", "38", "45", "55", "16", "26", "34", "44", "6", "18", "42", "46", "48", "50", "56"];

await essai("plan V1 : deux feuilles à 2:1 (face + coupe, puis vue B + iso)", async () => {
  const { feuilles, tout: F } = await plan(q.get("v1"));
  egal(feuilles.map((x) => [x.format, x.largeur]), [["A3", 420], ["A3", 420]]);
  for (const x of feuilles) vrai(textes(x).includes("2:1"), "échelle 2:1 sur chaque feuille");
  egal(nombre(feuilles[0], "A–A"), 1, "coupe sur la feuille 1");
  egal(feuilles[0].ops.filter((o) => o.t === "texte" && o.s === "A" && o.h >= 5).length, 2, "lettres du trait de coupe (hors repérage du cadre)");
  egal(F.ops.filter((o) => o.t === "texte" && o.s === "B" && o.h >= 5).length, 2, "flèche de référence B et titre de la vue B");
  vrai(textes(feuilles[0]).includes("Vue B (dessus) : feuille 2"), "renvoi vers la feuille 2");
  vrai(F.ops.some((o) => o.t === "trait" && o.motif && o.motif.length === 2), "arêtes cachées en interrompu");
  vrai(F.ops.some((o) => o.t === "trait" && o.motif && o.motif.length === 4), "axes en mixte");
  vrai(F.ops.filter((o) => o.t === "trait" && o.ep === 0.25 && o.pts.length === 2).length > 40, "hachures et cotes");
});

await essai("plan V1 : toutes les cotes nécessaires, sans doublon ni cote évidente", async () => {
  const F = (await plan(q.get("v1"))).tout;
  for (const c of COTES_V1) vrai(textes(F).includes(c), `cote ${c} absente`);
  for (const c of ["14,5", "45,5", "15,5", "46,5", "31", "60", "56", "48", "42"]) egal(nombre(F, c), 1, `cote ${c} :`);
  for (const c of ["12,25", "17,75", "42,25", "47,75"]) egal(nombre(F, c), 0, `flanc d'oblong ${c} coté :`);
});

await essai("plan V1 : indications Ø, lamage, oblongs, rayons, chanfreins", async () => {
  const F = (await plan(q.get("v1"))).tout;
  for (const t of ["Ø22,8", "4× Ø3,4", "Ø6,5 ", "4× oblong 5,5 × 15,5", "4× R4", "R4", "2× 6,01 × 45°"]) egal(nombre(F, t), 1, `« ${t} » :`);
});

for (const cle of ["v1", "v2", "cube", "tube"]) {
  await essai(`plan ${cle} : aucun texte ne se chevauche`, async () => {
    for (const [k, F] of (await plan(q.get(cle))).feuilles.entries()) {
      const bs = F.ops.filter((o) => o.t === "texte").map((o) => ({ s: o.s, b: boite(o) })).filter((x) => x.b);
      const conflits = [];
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i].b, b = bs[j].b, m = 0.15;
        if (a[0] + m < b[2] && b[0] + m < a[2] && a[1] + m < b[3] && b[1] + m < a[3]) conflits.push(`${bs[i].s} / ${bs[j].s}`);
      }
      egal(conflits, [], `feuille ${k + 1}, chevauchements :`);
    }
  });

  await essai(`plan ${cle} : tout dans la feuille, rien sur le cartouche`, async () => {
    for (const F of (await plan(q.get(cle))).feuilles) {
      for (const o of F.ops) for (const [x, y] of o.pts || (o.chemins || []).flat()) vrai(x >= 0 && x <= F.largeur && y >= 0 && y <= F.hauteur, "hors feuille");
      const c = { x0: F.largeur - 10 - 180 + 1, y0: F.hauteur - 10 - 36 + 1, x1: F.largeur - 11, y1: F.hauteur - 11 };
      const dedans = F.ops.filter((o) => o.t === "trait" && o.ep === 0.5 && o.pts.some(([x, y]) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1));
      egal(dedans.length, 0, "traits forts dans le cartouche :");
    }
  });
}

// point dans un des contours (pair-impair) ?
const dansContours = (p, contours) => {
  let d = false;
  for (const c of contours) for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    if ((c[i][1] > p[1]) !== (c[j][1] > p[1]) && p[0] < ((c[j][0] - c[i][0]) * (p[1] - c[i][1])) / (c[j][1] - c[i][1]) + c[i][0]) d = !d;
  }
  return d;
};
const distSegment = (p, a, b) => {
  const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2));
  return Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1]));
};

for (const cle of ["v1", "v2"]) {
  await essai(`plan ${cle} : aucun trait fin continu ne traverse un trou`, async () => {
    const { feuilles, tout } = await plan(q.get(cle));
    vrai(tout.infos.cercles.length >= 5, "cercles des trous");
    const fautes = [];
    for (const F of feuilles) for (const o of F.ops) {
      if (o.t !== "trait" || o.motif || o.ep !== 0.25) continue;   // lignes de rappel, de cote, de repère, hachures
      for (let i = 0; i + 1 < o.pts.length; i++) for (const c of F.infos.cercles) {
        if (distSegment(c.c, o.pts[i], o.pts[i + 1]) < c.r - 0.3) fautes.push(`trait ${JSON.stringify(o.pts.map((p) => p.map((v) => +v.toFixed(1))))} dans le trou en ${c.c.map((v) => v.toFixed(1))}`);
      }
    }
    egal(fautes.slice(0, 5), [], "traits dans des trous :");
  });

  await essai(`plan ${cle} : rien de dessiné sur la matière coupée, sauf hachures`, async () => {
    const { feuilles, tout } = await plan(q.get(cle));
    vrai(tout.infos.coupes.length === 1, "une coupe");
    for (const F of feuilles) for (const zones of F.infos.coupes) {
      const fautes = F.ops.filter((o) => o.t === "trait" && o.ep === 0.5 && o.pts.some((p, i) => i && dansContours([(p[0] + o.pts[i - 1][0]) / 2, (p[1] + o.pts[i - 1][1]) / 2], zones)
        && zones.every((z) => z.every((a, k) => distSegment([(p[0] + o.pts[i - 1][0]) / 2, (p[1] + o.pts[i - 1][1]) / 2], a, z[(k + 1) % z.length]) > 0.1))));
      egal(fautes.length, 0, "arêtes vues tracées sur la coupe :");
    }
  });

  await essai(`plan ${cle} : flèches de Ø sur le cercle, dans l'axe du centre`, async () => {
    const F = (await plan(q.get(cle))).tout;
    const ronds = F.infos.reperes.filter((r) => r.centre);
    vrai(ronds.length >= 2, "indications de Ø");
    for (const r of ronds) {
      proche(Math.hypot(r.pointe[0] - r.centre[0], r.pointe[1] - r.centre[1]), r.rayon, 0.01, `pointe de « ${r.texte} » hors du cercle :`);
      const a1 = Math.atan2(r.vers[1] - r.centre[1], r.vers[0] - r.centre[0]), a2 = Math.atan2(r.pointe[1] - r.centre[1], r.pointe[0] - r.centre[0]);
      proche(a1, a2, 0.01, `« ${r.texte} » pas radiale :`);
    }
  });
}

await essai("plan V1 : cartouche rempli sur chaque feuille, numérotées", async () => {
  const { feuilles } = await plan(q.get("v1"), { numero: "PL-42", matiere: "PETG", dessinateur: "J. R.", tolerance: "ISO 2768-m", masse: "45 g" });
  feuilles.forEach((F, i) => {
    for (const t of ["PL-42", "PETG", "J. R.", "ISO 2768-m", "45 g", "A3", `${i + 1} / ${feuilles.length}`, "mm", "Désignation", "Échelle"]) vrai(textes(F).includes(t), `feuille ${i + 1} : « ${t} » absent du cartouche`);
  });
});

await essai("plan V1 : PDF vectoriel valide, une page par feuille", async () => {
  const { feuilles } = await plan(q.get("v1"));
  const blob = pdfDepuisFeuilles(feuilles, { titre: "support" });
  const { pages, boites, s } = lirePdf(new Uint8Array(await blob.arrayBuffer()));
  egal(pages, feuilles.length); proche(boites[0][0], 1190.55, 0.01);
  vrai(!s.includes("/Subtype /Image"), "aucune image : tout est vectoriel");
  vrai(blob.size < 2e6, `PDF trop lourd : ${blob.size}`);
});

await essai("plan V2 : encoche, épaisseurs et semelle de la variation", async () => {
  const F = (await plan(q.get("v2"))).tout;
  for (const c of ["52", "62", "8", "54", "38", "32"]) vrai(textes(F).includes(c), `cote ${c} absente`);
  egal(nombre(F, "R4"), 2, "R4 (encoche et congé) :");
  vrai(textes(F).includes("4× oblong 5,5 × 21,5"), "oblongs de 16 mm de course");
});

await essai("plan cube : une seule feuille suffit, petite pièce agrandie, pas de coupe inutile", async () => {
  const { feuilles, tout: F } = await plan(q.get("cube"));
  egal(feuilles.length, 1, "feuilles :");
  vrai(textes(F).includes("5:1") || textes(F).includes("2:1"), "échelle d'agrandissement");
  egal(nombre(F, "A–A"), 0, "coupe");
  vrai(textes(F).includes("10"), "cote 10");
});

await essai("plan tube : trou vertical coupé, Ø du trou et du tube", async () => {
  const F = (await plan(q.get("tube"))).tout;
  egal(nombre(F, "A–A"), 1, "coupe par l'axe du trou");
  vrai(textes(F).includes("Ø6"), "Ø6"); vrai(textes(F).includes("Ø20"), "Ø20");
});

await essai("plan : génération en moins de 5 s", async () => {
  const t0 = performance.now();
  await plan(q.get("v1"));
  vrai(performance.now() - t0 < 5000, `${Math.round(performance.now() - t0)} ms`);
});

// ------------------------------------------------------------------ aperçu (SVG, zoom)

await essai("aperçu : SVG du plan complet et bien formé", async () => {
  const { feuilles } = await plan(q.get("v1"));
  for (const F of feuilles) {
    const svg = F.rendreSVG();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    vrai(!doc.querySelector("parsererror"), "SVG invalide");
    egal(doc.documentElement.getAttribute("viewBox"), `0 0 ${F.largeur} ${F.hauteur}`);
    egal(doc.querySelectorAll("text").length, F.ops.filter((o) => o.t === "texte").length, "textes");
    egal(doc.querySelectorAll("polyline, polygon").length, F.ops.filter((o) => o.t === "trait").length, "traits");
    vrai(svg.includes("Ø22,8") || F !== feuilles[0], "indication Ø22,8");
  }
});

await essai("aperçu : le zoom à la molette garde le point sous le curseur", async () => {
  const { zoomAutour } = await import("/static/visionneuse.js");
  const avant = { zoom: 2, sx: 100, sy: 50 }, curseur = [300, 200];
  const apres = zoomAutour(avant, 1.5, curseur, [0.5, 40]);
  proche(apres.zoom, 3, 1e-9);
  // le point de la feuille sous le curseur (en mm) est le même avant et après
  for (const k of [0, 1]) proche((avant[k ? "sy" : "sx"] + curseur[k]) / avant.zoom, (apres[k ? "sy" : "sx"] + curseur[k]) / apres.zoom, 1e-9);
  egal(zoomAutour(avant, 1000, curseur, [0.5, 40]).zoom, 40, "zoom maximum");
  egal(zoomAutour(avant, 0.001, curseur, [0.5, 40]).zoom, 0.5, "zoom minimum");
});

await essai("aperçu : visionneuse (affichage, zoom, ajuster)", async () => {
  const { VisionneusePlan } = await import("/static/visionneuse.js");
  const zone = document.createElement("div");
  zone.style.width = "800px";
  document.body.append(zone);
  const v = new VisionneusePlan(zone);
  v.cadre.style.height = "500px";
  const F = (await plan(q.get("cube"))).feuilles[0];
  v.montrer(F.rendreSVG(), F.largeur, F.hauteur);
  const larg = () => parseFloat(v.svg.getAttribute("width"));
  const ajuste = larg();
  vrai(ajuste > 100 && ajuste <= 800, `largeur ajustée ${ajuste}`);
  v.zoomer(2);
  proche(larg(), ajuste * 2, 0.5, "zoom ×2");
  v.ajuster();
  proche(larg(), ajuste, 0.5, "retour à la feuille entière");
  for (const b of ["moins", "plus", "ajuster", "ecran"]) vrai(zone.querySelector(`[data-vis="${b}"]`), `bouton ${b}`);
  zone.remove();
});

// ------------------------------------------------------------------ pièce 3D posée sous une vue du plan

const surFeuille = (v, p) => [v.ox + (p[0] * v.r[0] + p[1] * v.r[1] + p[2] * v.r[2]) * v.s, v.oy - (p[0] * v.u[0] + p[1] * v.u[1] + p[2] * v.u[2]) * v.s];

await essai("plan V1 : chaque vue cliquable est décrite, et sa projection tombe sur le dessin", async () => {
  const { feuilles } = await plan(q.get("v1"));
  egal(feuilles.map((F) => F.infos.vues.map((v) => v.nom)), [["face", "coupe A–A"], ["dessus", "isométrique"]]);
  // l'axe de l'alésage (0 ; 0 ; 31) projeté avec les paramètres de la vue de face = centre du cercle dessiné
  const face = feuilles[0].infos.vues[0];
  const [x, y] = surFeuille(face, [0, 0, 31]);
  vrai(feuilles[0].infos.cercles.some((c) => Math.hypot(c.c[0] - x, c.c[1] - y) < 0.01 && Math.abs(c.r - 11.4 * face.s) < 0.01), "alésage introuvable à sa place");
  vrai(feuilles[0].infos.vues[1].coupe, "la coupe porte son plan");
});

await essai("aperçu : clic sur une vue (ou à côté)", async () => {
  const { vueSous, VisionneusePlan } = await import("/static/visionneuse.js");
  const { feuilles } = await plan(q.get("v1"));
  const vues = feuilles[0].infos.vues, r = vues[0].rect;
  egal(vueSous(vues, [r.x + r.w / 2, r.y + r.h / 2])?.nom, "face");
  egal(vueSous(vues, [r.x - 2, r.y + 5])?.nom, "face", "marge autour de la vue");
  egal(vueSous(vues, [5, 5]), null, "coin de la feuille");
  // vrai clic souris sur la visionneuse
  const zone = document.createElement("div");
  zone.style.width = "900px";
  document.body.append(zone);
  const v = new VisionneusePlan(zone);
  v.montrer(feuilles[0].rendreSVG(), feuilles[0].largeur, feuilles[0].hauteur, vues);
  let recu = "rien";
  v.surVue = (x) => (recu = x ? x.nom : null);
  const b = v.feuille.getBoundingClientRect(), z = v.etat.zoom;
  const ev = (type) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: b.left + (r.x + r.w / 2) * z, clientY: b.top + (r.y + r.h / 2) * z });
  v.cadre.dispatchEvent(ev("pointerdown")); v.cadre.dispatchEvent(ev("pointerup"));
  egal(recu, "face", "vue reçue au clic :");
  zone.remove();
});

await essai("pièce 3D : se pose exactement sous la vue, puis repart", async () => {
  const { VisionneusePlan } = await import("/static/visionneuse.js");
  const { ApparitionPiece } = await import("/static/apparition3d.js");
  const { obj } = await fichier(q.get("v1"));
  const { feuilles } = await plan(q.get("v1"));
  const zone = document.createElement("div");
  zone.style.width = "900px";
  document.body.append(zone);
  const v = new VisionneusePlan(zone);
  v.montrer(feuilles[0].rendreSVG(), feuilles[0].largeur, feuilles[0].hauteur, feuilles[0].infos.vues);
  const a = new ApparitionPiece(v, [obj], { duree: 0 });
  for (const vue of feuilles[0].infos.vues) {
    a.montrer(vue);
    vrai(a.toile.parentNode === v.feuille, "couche 3D posée sur la feuille");
    proche(a.pivot.quaternion.angleTo(new THREE.Quaternion()), 0, 1e-6, "orientation finale = celle de la vue");
    proche(a.pivot.scale.x, 1, 1e-9, "échelle finale");
    // des points de la pièce, vus par la caméra 3D, tombent là où la vue les dessine (à 0,05 mm près)
    for (const p of [[0, 0, 31], [-30, 0, 0], [30, 50, 0], [-15.5, 6, 46.5]]) {
      const n = new THREE.Vector3(...p).project(a.camera);
      const z = a.zoneMm, mm = [z.x + ((n.x + 1) / 2) * z.w, z.y + ((1 - n.y) / 2) * z.h];
      const attendu = surFeuille(vue, p);
      vrai(Math.hypot(mm[0] - attendu[0], mm[1] - attendu[1]) < 0.05, `${vue.nom} : point ${p} en ${mm.map((t) => t.toFixed(2))}, attendu ${attendu.map((t) => t.toFixed(2))}`);
    }
    egal(a.mat.clippingPlanes.length, vue.coupe ? 1 : 0, `${vue.nom} : plan de coupe`);
    proche(parseFloat(a.toile.style.width), a.zoneMm.w * v.etat.zoom, 0.5, "taille de la couche à l'écran");
  }
  a.montrer(feuilles[0].infos.vues[1]);   // second clic sur la même vue : la pièce repart
  egal(a.toile.parentNode, null, "couche retirée");
  a.detruire();
  zone.remove();
});

await essai("pièce 3D : vol depuis l'aperçu, tour complet, pose exacte, effacement et retour", async () => {
  const { VisionneusePlan } = await import("/static/visionneuse.js");
  const { ApparitionPiece } = await import("/static/apparition3d.js");
  const { obj } = await fichier(q.get("v1"));
  const { feuilles } = await plan(q.get("v1"));
  const zone = document.createElement("div");
  zone.style.width = "1000px";
  document.body.append(zone);
  const v = new VisionneusePlan(zone, { apercuOuvert: true });
  v.montrer(feuilles[0].rendreSVG(), feuilles[0].largeur, feuilles[0].hauteur, feuilles[0].infos.vues);
  // aperçu simulé : caméra perspective qui regarde la pièce, dans un rectangle de l'écran
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  cam.position.set(120, -150, 110); cam.up.set(0, 0, 1); cam.lookAt(0, 25, 28); cam.updateMatrixWorld();
  const zr = zone.getBoundingClientRect();
  const rect = { left: zr.left + 700, top: zr.top + 60, width: 250, height: 250 };
  const objet = { visible: true };
  const a = new ApparitionPiece(v, [obj], { dureeVol: 60, effacement: 120, tour: true, source: () => ({ rect, camera: cam, objet }) });
  const vue = feuilles[0].infos.vues[0];
  // départ (e = 0) : le centre de la pièce est là où l'aperçu le montre
  const c = a.centre.clone(), ndc = c.clone().project(cam);
  const M0 = a.poseVol(vue, a.o.source(), 0), p0 = c.clone().applyMatrix4(M0);
  proche(p0.x, rect.left - zr.left + ((ndc.x + 1) / 2) * rect.width, 0.01, "départ x :");
  proche(-p0.y, rect.top - zr.top + ((1 - ndc.y) / 2) * rect.height, 0.01, "départ y :");
  // arrivée (e = 1) : chaque point tombe où la vue le dessine sur la feuille affichée
  const M1 = a.poseVol(vue, a.o.source(), 1), Fe = v.feuille.getBoundingClientRect(), z = v.etat.zoom;
  for (const p of [[0, 0, 31], [-30, 0, 0], [30, 50, 56]]) {
    const s = new THREE.Vector3(...p).applyMatrix4(M1), [X, Y] = surFeuille(vue, p);
    proche(s.x, Fe.left - zr.left + X * z, 0.01, `arrivée ${p} x :`);
    proche(-s.y, Fe.top - zr.top + Y * z, 0.01, `arrivée ${p} y :`);
  }
  // le tour complet change la pose en plein vol, pas aux extrémités
  const sansTour = new ApparitionPiece(v, [obj], { tour: false });
  const ecart = (A, B) => A.elements.reduce((s, x, i) => s + Math.abs(x - B.elements[i]), 0);
  vrai(ecart(a.poseVol(vue, a.o.source(), 0.5), sansTour.poseVol(vue, a.o.source(), 0.5)) > 1, "tour complet en vol");
  vrai(ecart(a.poseVol(vue, a.o.source(), 1), sansTour.poseVol(vue, a.o.source(), 1)) < 1e-6, "même pose à l'arrivée");
  // déroulé complet : la pièce quitte l'aperçu, se pose, s'efface après le délai et y retourne
  a.montrer(vue);
  egal(objet.visible, false, "la pièce a quitté l'aperçu");
  const t0 = performance.now();
  while (a.toile.parentNode !== v.feuille && performance.now() - t0 < 2000) await new Promise((ok) => setTimeout(ok, 10));
  vrai(a.toile.parentNode === v.feuille, `pièce posée dans la feuille après le vol (en vol : ${a.enVol}, ${Math.round(performance.now() - t0)} ms)`);
  await new Promise((ok) => setTimeout(ok, 400));
  egal(a.toile.parentNode, null, "effacée après le délai réglé");
  egal(objet.visible, true, "revenue dans l'aperçu");
  a.detruire(); sansTour.detruire();
  zone.remove();
});

await essai("aperçu : couches 3D sans fond (le plan reste visible pendant le vol)", async () => {
  const { VisionneusePlan } = await import("/static/visionneuse.js");
  const { ApparitionPiece } = await import("/static/apparition3d.js");
  const { obj } = await fichier(q.get("cube"));
  const F = (await plan(q.get("cube"))).feuilles[0];
  // même contexte que dans l'appli : la visionneuse est montée dans #plan-toile.plan-toile
  const zone = document.createElement("div");
  zone.id = "plan-toile"; zone.className = "plan-toile"; zone.style.width = "900px";
  document.body.append(zone);
  const v = new VisionneusePlan(zone, { feuilleSombre: true });
  v.montrer(F.rendreSVG(), F.largeur, F.hauteur, F.infos.vues);
  const a = new ApparitionPiece(v, [obj], { duree: 0 });
  a.preparerVol(); zone.append(a.vol);
  a.montrer(F.infos.vues[0]);
  const transparent = (el) => ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(el).backgroundColor);
  vrai(transparent(a.vol), `couche de vol : fond ${getComputedStyle(a.vol).backgroundColor}`);
  vrai(transparent(a.toile), `pièce posée : fond ${getComputedStyle(a.toile).backgroundColor}`);
  vrai(transparent(v.feuille) && transparent(v.cadre), "feuille sans fond à l'écran");
  const c = document.createElement("canvas"); v.apercu.append(c);
  vrai(transparent(c), `aperçu 3D : fond ${getComputedStyle(c).backgroundColor}`);
  // traits du plan en clair sur fond sombre (le SVG lui-même garde son encre noire pour l'export)
  egal(getComputedStyle(v.svg.querySelector("g")).stroke, "rgb(214, 224, 234)", "encre des traits à l'écran");
  a.detruire(); zone.remove();
});

// ------------------------------------------------------------------ modèles 3MF et interface

const attendre = async (cond, msg, ms = 10000) => {
  for (let t = 0; t < ms; t += 50) {
    const r = await cond();
    if (r) return r;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  throw new Error("délai dépassé : " + msg);
};
async function nouveauProjet(nom) {
  return (await fetch("/api/projets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nom }) })).json();
}

await essai("3MF : pièce éclairée avec ses reliefs (normales par face), pas toute noire", async () => {
  // 3MF indexé, sans normales, comme ceux exportés par SolidWorks : c'est ce cas qui sortait noir
  const { zipSync, strToU8 } = await import("/static/vendor/three/addons/libs/fflate.module.js");
  const pts = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 8], [20, 0, 8], [20, 20, 8], [0, 20, 8]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const modele = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${pts.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices><triangles>${faces.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("")}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
  const zip = zipSync({ "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`), "3D/3dmodel.model": strToU8(modele),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`) });
  const p = await nouveauProjet("Essai 3MF");
  const fd = new FormData(); fd.append("fichiers", new Blob([zip]), "bloc.3mf");
  const [f] = await (await fetch(`/api/projets/${p.id}/fichiers`, { method: "POST", body: fd })).json();
  const obj = await chargerObjet(`/api/fichiers/${f.id}/contenu`, "3mf");
  let maillages = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    maillages++;
    const n = o.geometry.attributes.normal;
    vrai(n, "pas de normales : la pièce est rendue noire");
    egal(n.count, 36, "une normale par sommet de chaque face (arêtes vives)");
    for (let i = 0; i < n.count; i++) proche(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1, 1e-4, "normale unitaire");
  });
  egal(maillages, 1, "maillages");
  // rendu réel dans la vue 3D de l'appli : la pièce est claire, et ses faces n'ont pas toutes la même teinte
  const { Vue3D } = await import("/static/vision.js");
  const zone = document.createElement("div"); zone.style.cssText = "width:200px;height:150px;position:relative";
  const calque = document.createElement("div"); zone.append(calque); document.body.append(zone);
  const v = new Vue3D(zone, calque);
  v.ajuster();
  await v.ajouter("bloc", `/api/fichiers/${f.id}/contenu`, "3mf");
  v.cadrer(); v.decor.clear(); v.ctl.update();
  v.rendu.render(v.scene, v.camera);
  const gl = v.rendu.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const teintes = new Set(); let somme = 0, nb = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 250) continue;
    somme += px[i]; nb++; teintes.add(px[i] >> 3);
  }
  vrai(nb > 500, `pièce absente du rendu (${nb} px)`);
  vrai(somme / nb > 90, `pièce trop sombre : rouge moyen ${Math.round(somme / nb)}`);
  vrai(teintes.size >= 3, `faces toutes de la même teinte (${teintes.size}) : reliefs invisibles`);
  v.detruire(); zone.remove();
  await fetch(`/api/projets/${p.id}`, { method: "DELETE" });
});

await essai("interface : les miniatures restent dans la vignette des cartes de projet", async () => {
  const cadre = document.createElement("iframe");
  cadre.style.cssText = "width:1400px;height:900px";
  cadre.src = "/#/projets";
  document.body.append(cadre);
  const imgs = await attendre(() => {
    const l = [...(cadre.contentDocument?.querySelectorAll(".projet .vignette img") || [])];
    return l.length && l.every((i) => i.complete && i.naturalWidth) ? l : null;
  }, "miniatures chargées");
  for (const img of imgs) {
    const v = img.closest(".vignette").getBoundingClientRect(), r = img.getBoundingClientRect();
    vrai(r.top >= v.top - 0.5 && r.bottom <= v.bottom + 0.5 && r.left >= v.left - 0.5 && r.right <= v.right + 0.5,
      `miniature ${Math.round(r.width)}×${Math.round(r.height)} déborde de sa vignette ${Math.round(v.width)}×${Math.round(v.height)}`);
    proche(v.height, v.width * 10 / 16, 1, "vignette au format 16/10");
  }
  cadre.remove();
});

await essai("interface : supprimer un projet (Modifier › Supprimer › Confirmer)", async () => {
  const p = await nouveauProjet("Projet à supprimer");
  const cadre = document.createElement("iframe");
  cadre.style.cssText = "width:1200px;height:800px";
  cadre.src = `/#/projet/${p.id}`;
  document.body.append(cadre);
  const doc = () => cadre.contentDocument;
  const bouton = await attendre(() => doc()?.querySelector("#modif"), "bouton Modifier");
  bouton.click();
  (await attendre(() => doc().querySelector("#modale[open] [data-suppr]"), "bouton Supprimer du formulaire")).click();
  const confirmer = await attendre(() => doc().querySelector("#modale[open] .btn.prim.danger"), "boîte de confirmation");
  // laisser passer l'événement « close » différé du formulaire (c'est lui qui annulait la confirmation)
  await new Promise((ok) => setTimeout(ok, 200));
  vrai(doc().querySelector("#modale").open, "la confirmation s'est refermée toute seule");
  confirmer.click();
  await attendre(async () => (await fetch(`/api/projets/${p.id}`)).status === 404, "le projet n'a pas été supprimé");
  await attendre(() => cadre.contentWindow.location.hash === "#/projets", "retour à la liste des projets");
  cadre.remove();
});

await essai("interface : bouton Supprimer de la page projet (projet importé avec ses fichiers)", async () => {
  const p = await nouveauProjet("Import à supprimer");
  const fd = new FormData();
  fd.append("fichiers", new Blob([await (await fetch(`/api/fichiers/${q.get("cube")}/contenu`)).arrayBuffer()]), "Piece.stl");
  fd.append("fichiers", new Blob(["pas un vrai SolidWorks"]), "Piece.SLDPRT");
  const deposes = await (await fetch(`/api/projets/${p.id}/fichiers`, { method: "POST", body: fd })).json();
  const cadre = document.createElement("iframe");
  cadre.style.cssText = "width:1200px;height:800px";
  cadre.src = `/#/projet/${p.id}`;
  document.body.append(cadre);
  const doc = () => cadre.contentDocument;
  (await attendre(() => doc()?.querySelector("#suppr-projet"), "bouton Supprimer visible sur la page projet")).click();
  const boite = await attendre(() => doc().querySelector("#modale[open]"), "boîte de confirmation");
  vrai(/2 fichier\(s\)/.test(boite.textContent), "la confirmation annonce les fichiers supprimés : " + boite.textContent);
  boite.querySelector(".btn.prim.danger").click();
  await attendre(async () => (await fetch(`/api/projets/${p.id}`)).status === 404, "le projet n'a pas été supprimé");
  for (const f of deposes) egal((await fetch(`/api/fichiers/${f.id}`)).status, 404, `fichier ${f.nom}`);
  await attendre(() => cadre.contentWindow.location.hash === "#/projets", "retour à la liste des projets");
  cadre.remove();
});

rendu.dispose();
document.getElementById("sortie").textContent = "RESULTATS:" + JSON.stringify(resultats) + ":FIN";
