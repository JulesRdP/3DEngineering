// Mise en plan d'une pièce selon les règles du dessin industriel (ISO 128, 129, 5456, 5457, 7200) :
// - projection européenne : vue de face, vue de dessus placée dessous, vue de gauche placée à droite ;
//   la vue de gauche devient une coupe A–A par l'axe d'un perçage quand la pièce en a qui y seraient cachés ;
// - arêtes vues en trait fort, cachées en trait fin interrompu, axes en trait fin mixte, hachures fines à 45° ;
// - cotation en cotes d'origine (datum = faces mini de la pièce), chaque cote une seule fois, dans la vue où
//   l'élément est vu en vraie grandeur ; diamètres, lamages, rayons, chanfreins indiqués par des lignes de repère ;
// - format A4 portrait ou A3 paysage, échelle normalisée, cadre avec repérage, cartouche, symbole de projection.
// Les formes (trous, oblongs, arrondis, faces planes) viennent de l'analyse du maillage (meta.formes, formes.py).
import * as THREE from "three";
import { Feuille, EP, largeurTexte, hachurer } from "/static/traceur.js";
import { preparerMaillage, aretesVue, section, pv } from "/static/aretes.js";

const H_COTE = 3.5;
const AXES = ["X", "Y", "Z"];
const ps = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a) => a.map((v) => -v);
const parallele = (a, b) => Math.abs(ps(a, b)) > 0.9998;
const indiceAxe = (d) => [0, 1, 2].find((k) => Math.abs(d[k]) > 0.99999) ?? -1;
export const fmt = (v) => (Math.abs(v) < 0.005 ? 0 : v).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const texteEchelle = (s) => (s >= 1 ? `${fmt(s)}:1` : `1:${fmt(1 / s)}`);
const vueDepuis = (f, u) => ({ f, u, r: pv(f, u) });
const pointAxe = (f, t) => (f.centre ?? f.c1).map((c, i) => c + (t - f.debut) * f.axe[i]);

// ------------------------------------------------------------------ formes regroupées

function grouperFormes(formes) {
  const groupes = [];
  const ajouter = (type, cle, it) => {
    let g = groupes.find((x) => x.type === type && x.cle === cle);
    if (!g) groupes.push((g = { type, cle, items: [] }));
    g.items.push(it);
  };
  for (const p of formes.percages || []) {
    ajouter("percage", JSON.stringify([p.axe, p.etages.map((e) => [e.r.toFixed(2), (e.fin - e.debut).toFixed(2)]), p.ouvert_debut, p.ouvert_fin]), p);
  }
  for (const o of formes.oblongs || []) ajouter("oblong", JSON.stringify([o.axe, o.r.toFixed(2), o.entraxe.toFixed(2)]), o);
  for (const b of formes.bossages || []) ajouter("bossage", JSON.stringify([b.axe, b.r.toFixed(2)]), b);
  for (const a of formes.arrondis || []) ajouter("arrondi", JSON.stringify([a.axe, a.r.toFixed(2), a.angle >= 179]), a);
  return groupes;
}

// Texte d'indication (lignes de morceaux pour texteRiche), selon ISO 129 : Ø, lamage ⌴, profondeur ↧.
function indication(g) {
  const n = g.items.length, q = n > 1 ? `${n}× ` : "";
  const it = g.items[0];
  if (g.type === "percage") {
    const et = it.etages, principal = et.reduce((a, b) => (b.r < a.r ? b : a));
    const l1 = [`${q}Ø${fmt(2 * principal.r)}`];
    if (!it.traversant) l1.push(" ", { sym: "prof" }, fmt(principal.fin - principal.debut));
    const lignes = [l1];
    for (const e of et) if (e !== principal) lignes.push([{ sym: "lamage" }, `Ø${fmt(2 * e.r)} `, { sym: "prof" }, fmt(e.fin - e.debut)]);
    return lignes;
  }
  if (g.type === "oblong") return [[`${q}oblong ${fmt(2 * it.r)} × ${fmt(it.entraxe + 2 * it.r)}`]];
  if (g.type === "bossage") return [[`${q}Ø${fmt(2 * it.r)}`]];
  return [[`${q}R${fmt(it.r)}`]];
}

// ------------------------------------------------------------------ choix des vues

function choisirVues(formes, groupes) {
  // vue de face horizontale (Z en haut) : celle qui montre le plus de formes en vraie grandeur, puis la plus grande face
  const score = (f) => groupes.reduce((s, g) => s + g.items.filter((it) => parallele(it.axe, f)).length * (g.type === "arrondi" ? 0.3 : 1), 0);
  const u = [0, 0, 1];
  const cands = [[0, 1, 0], [1, 0, 0]];
  const f = cands.reduce((a, b) => (score(b) > score(a) ? b : a));
  const face = vueDepuis(f, u);
  const dessus = vueDepuis(neg(u), f);
  const gauche = vueDepuis(face.r, u);
  return { face, dessus, gauche };
}

// Coupe A–A à la place de la vue de gauche : par l'axe du plus grand perçage caché dans cette vue.
function choisirCoupe(groupes, gauche) {
  let mieux = null;
  for (const g of groupes.filter((x) => x.type === "percage")) {
    for (const p of g.items) {
      if (Math.abs(ps(p.axe, gauche.f)) > 1e-4 || indiceAxe(p.axe) < 0) continue;
      const r = Math.max(...p.etages.map((e) => e.r));
      if (!mieux || r > mieux.r) mieux = { r, c: ps(p.centre, gauche.f) };
    }
  }
  return mieux ? { n: gauche.f, c: mieux.c, lettre: "A" } : null;
}

// ------------------------------------------------------------------ cotation : répartition sans doublon

function repartirCotes(vues, formes, groupes, boite) {
  const items = [];   // { k, val, cands: [{ v, prio }], ancre: (vue) => point 3D d'où part la ligne de rappel }
  const ajouter = (k, val, cands, ancre) => { if (cands.length) items.push({ k, val, cands, ancre }); };
  const axesVue = (V) => [indiceAxe(V.vue.r), indiceAxe(V.vue.u)];

  // centres des formes vues en vraie grandeur (cercles), ou coupées par leur axe dans une coupe
  for (const g of groupes) {
    for (const it of g.items) {
      if (g.type === "arrondi" && it.angle < 179) continue;          // congé : le rayon suffit
      const centres = g.type === "oblong" ? [it.c1, it.c2] : [pointAxe(it, it.debut)];
      const rayon = g.type === "percage" ? Math.max(...it.etages.map((e) => e.r)) : it.r;
      for (const c of centres) {
        for (const k of [0, 1, 2]) {
          if (Math.abs(it.axe[k]) > 0.5) continue;
          const cands = [];
          vues.forEach((V, vi) => {
            if (!axesVue(V).includes(k)) return;
            if (parallele(it.axe, V.vue.f) && V.voitForme(it)) cands.push({ v: vi, prio: 3 });
            else if (V.coupe && Math.abs(ps(it.axe, V.coupe.n)) < 1e-4 && Math.abs(ps(c, V.coupe.n) - V.coupe.c) < 0.01) cands.push({ v: vi, prio: 2 });
          });
          ajouter(k, c[k], cands, () => [{ p: c, r: rayon }]);
        }
      }
    }
  }
  // faces planes perpendiculaires à un axe : vues par la tranche, ou coupées
  for (const p of formes.plans || []) {
    const k = indiceAxe(p.n);
    const inclinee = k < 0;
    const cands = [];
    vues.forEach((V, vi) => {
      if (Math.abs(ps(p.n, V.vue.f)) > 1e-4) return;
      const coupee = V.coupe && ps(p.min, V.coupe.n) <= V.coupe.c + 0.01 && ps(p.max, V.coupe.n) >= V.coupe.c - 0.01;
      if (coupee) cands.push({ v: vi, prio: 2.5 });
      else if (V.voitPlan(p)) cands.push({ v: vi, prio: 1 });
    });
    // face vue nulle part (poche au dos, rainure intérieure…) : cotée sur ses traits cachés plutôt que pas du tout
    if (!cands.length) vues.forEach((V, vi) => { if (Math.abs(ps(p.n, V.vue.f)) < 1e-4) cands.push({ v: vi, prio: 0.2 }); });
    // flancs d'un oblong : évidents (centre + largeur suffisent)
    if (!inclinee && (formes.oblongs || []).some((o) => Math.abs(ps(o.axe, p.n)) < 1e-4
      && [o.c1, o.c2].some((c) => Math.abs(Math.abs(p.point[k] - c[k]) - o.r) < 0.01))) continue;
    if (!inclinee) {
      ajouter(k, p.point[k], cands.filter((c) => axesVue(vues[c.v]).includes(k)), () => [{ p: p.min, r: 0 }, { p: p.max, r: 0 }]);
    } else {
      // face inclinée : on cote ses extrémités ; un chanfrein à 45° est indiqué à part
      const ks = [0, 1, 2].filter((i) => Math.abs(p.n[i]) > 1e-4);
      if (ks.length === 2 && Math.abs(Math.abs(p.n[ks[0]]) - Math.abs(p.n[ks[1]])) < 1e-3) continue;
      if (ks.length !== 2) continue;
      for (const kk of ks) for (const val of [p.min[kk], p.max[kk]]) {
        // extrémité de la face : point du plan où la coordonnée kk vaut val
        const autre = ks.find((i) => i !== kk);
        const q = p.point.slice();
        q[kk] = val;
        q[autre] = p.point[autre] - (p.n[kk] * (val - p.point[kk])) / p.n[autre];
        ajouter(kk, val, cands.filter((c) => axesVue(vues[c.v]).includes(kk)), () => [{ p: q, r: 0 }]);
      }
    }
  }
  // encombrement, au cas où un bord ne serait pas une face plane
  for (const k of [0, 1, 2]) for (const val of [boite.min[k], boite.max[k]]) {
    ajouter(k, val, vues.map((V, vi) => ({ v: vi, prio: 0.5 })).filter((c) => axesVue(vues[c.v]).includes(k)), null);
  }

  // une valeur par axe n'est cotée qu'une fois : dans la meilleure vue
  const pris = new Map();   // "k|val" -> vue
  const compte = vues.map(() => [0, 0, 0]);
  items.sort((a, b) => Math.max(...b.cands.map((c) => c.prio)) - Math.max(...a.cands.map((c) => c.prio)));
  for (const it of items) {
    const cle = `${it.k}|${Math.round(it.val * 100)}`;
    if (pris.has(cle)) {
      // même valeur portée par une autre forme : ses points d'attache servent aussi (on prendra le plus proche)
      const deja = pris.get(cle);
      if (it.ancre && it.cands.some((c) => c.v === deja.v)) deja.cote.ancres.push(...it.ancre(vues[deja.v]));
      continue;
    }
    const meilleure = Math.max(...it.cands.map((c) => c.prio));
    const choix = it.cands.filter((c) => c.prio === meilleure).sort((a, b) => compte[b.v][it.k] - compte[a.v][it.k] || a.v - b.v)[0];
    compte[choix.v][it.k]++;
    const V = vues[choix.v];
    const sens = indiceAxe(V.vue.r) === it.k ? "h" : "v";
    const cote = { val: it.val - boite.min[it.k], monde: it.val, ancres: it.ancre ? it.ancre(V) : [] };
    V.cotes[sens].push(cote);
    pris.set(cle, { v: choix.v, cote });
  }
  // l'origine (0) accompagne toute série de cotes
  for (const V of vues) for (const sens of ["h", "v"]) {
    const k = indiceAxe(sens === "h" ? V.vue.r : V.vue.u);
    if (V.cotes[sens].length && !V.cotes[sens].some((c) => Math.abs(c.val) < 0.005)) V.cotes[sens].push({ val: 0, monde: boite.min[k], ancres: [] });
  }
}

// ------------------------------------------------------------------ contrôle : le plan suffit-il à refaire la pièce ?
//
// Chaque sommet de la pièce, sur chaque axe, doit être donné par le plan : soit sa coordonnée est une cote
// (cotes d'origine, donc une valeur lue directement), soit le sommet appartient à une forme indiquée et située
// (trou, oblong, bossage, arrondi : Ø ou R + centre coté ; chanfrein « a × 45° »). Ce qui manque est ajouté
// (dans une vue qui le montre, sinon sur les traits cachés) ; ce qui ne peut pas l'être est signalé.

const TOL_COTE = 0.011;

function niveauxCotes(vues) {
  const L = [[], [], []];
  for (const V of vues) for (const sens of ["h", "v"]) {
    const k = indiceAxe(sens === "h" ? V.vue.r : V.vue.u);
    for (const c of V.cotes[sens]) L[k].push(c.monde);
  }
  return L;
}
const estCote = (L, k, v) => L[k].some((x) => Math.abs(x - v) < TOL_COTE);

// Le sommet p est-il sur la surface de cette forme (cylindre de l'un de ses rayons, entre ses extrémités) ?
function surForme(p, g, it) {
  const base = it.centre ?? it.c1, a = it.axe;
  const d = p.map((v, i) => v - base[i]);
  const t = ps(d, a);
  const lo = Math.min(it.debut, it.fin) - it.debut, hi = Math.max(it.debut, it.fin) - it.debut;
  if (t < lo - TOL_COTE || t > hi + TOL_COTE) return false;
  const q = d.map((v, i) => v - t * a[i]);   // dans le plan perpendiculaire à l'axe, depuis le centre
  let dist = Math.hypot(...q);
  if (g.type === "oblong") {
    const e = it.c2.map((v, i) => v - it.c1[i]), l2 = ps(e, e) || 1e-12;
    const s = Math.max(0, Math.min(1, ps(q, e) / l2));
    dist = Math.hypot(...q.map((v, i) => v - s * e[i]));
  }
  const rayons = g.type === "percage" ? it.etages.map((e) => e.r) : [it.r];
  return rayons.some((r) => Math.abs(dist - r) < 0.02 + r * 0.003);
}

function controlerCotation(m, vues, formes, groupes, boite, { completer = true } = {}) {
  const axesVue = (V) => [indiceAxe(V.vue.r), indiceAxe(V.vue.u)];
  const chanfreins = (formes.plans || []).filter((p) => p.indique && indiceAxe(p.n) < 0);
  const formesIndiquees = groupes.filter((g) => g.indique).flatMap((g) => g.items.map((it) => ({ g, it })));
  const nonIndiquees = new Set();

  // Seuls les vrais coins comptent : sommets où des arêtes vives changent de direction. Un sommet au milieu d'une
  // arête droite ou d'une face plane (découpage du maillage) n'a pas de position à donner.
  const dirs = m.pts.map(() => []);
  for (const e of m.aretes) {
    if (!e.vive) continue;
    const a = m.pts[e.i], b = m.pts[e.j], d = b.map((v, i) => v - a[i]), l = Math.hypot(...d) || 1;
    dirs[e.i].push(d.map((v) => v / l)); dirs[e.j].push(d.map((v) => -v / l));
  }
  const coins = m.pts.filter((_, i) => dirs[i].length && !(dirs[i].length === 2 && ps(dirs[i][0], dirs[i][1]) < -0.99999));
  // face tangente à une forme ronde située (flancs d'une encoche en U, d'un oblong) : centre ± rayon
  const tangente = (p, k, L) => formesIndiquees.some(({ g, it }) => Math.abs(it.axe[k]) < 0.5 && g.type !== "percage"
    && (g.type === "oblong" ? [it.c1, it.c2] : [pointAxe(it, it.debut)]).some((c) => estCote(L, k, c[k]) && Math.abs(Math.abs(p[k] - c[k]) - it.r) < TOL_COTE));

  const manques = (L) => {
    const parNiveau = new Map();   // "k|val" -> { k, val, sommets }
    for (const p of coins) {
      // formes sur lesquelles se trouve ce sommet (leurs centres doivent être cotés, eux)
      const sur = formesIndiquees.filter(({ g, it }) => surForme(p, g, it));
      for (let k = 0; k < 3; k++) {
        if (estCote(L, k, p[k]) || tangente(p, k, L)) continue;
        if (sur.length) {
          // sur une forme indiquée : la coordonnée découle de son centre et de son rayon (ou de sa profondeur) ;
          // un congé est situé par les faces qu'il raccorde, une autre forme par son centre coté
          const situee = sur.find(({ g, it }) => g.type === "arrondi" && it.angle < 179
            || [0, 1, 2].every((kk) => Math.abs(it.axe[kk]) > 0.5 || (g.type === "oblong" ? [it.c1, it.c2] : [pointAxe(it, it.debut)]).every((c) => estCote(L, kk, c[kk]))));
          if (situee) continue;
        }
        if (chanfreins.some((c) => Math.abs(c.n[k]) > 1e-4 && Math.abs(ps(p.map((v, i) => v - c.point[i]), c.n)) < TOL_COTE
          && p.every((v, i) => v >= c.min[i] - TOL_COTE && v <= c.max[i] + TOL_COTE))) continue;
        const cle = `${k}|${Math.round(p[k] * 100)}`;
        if (!parNiveau.has(cle)) parNiveau.set(cle, { k, val: Math.round(p[k] * 100) / 100, sommets: [] });
        parNiveau.get(cle).sommets.push(p);
      }
    }
    return [...parNiveau.values()];
  };

  // sommets d'une forme reconnue mais jamais indiquée (aucune vue ne la montre en vraie grandeur)
  for (const g of groupes.filter((x) => !x.indique)) nonIndiquees.add(indication(g).map((l) => l.filter((x) => typeof x === "string").join("")).join(" "));

  const ajoutees = [];
  let L = niveauxCotes(vues);
  if (completer) {
    for (const n of manques(L)) {
      if (estCote(L, n.k, n.val)) continue;
      // la vue qui montre ce niveau en trait plein, sinon celle qui a le moins de cotes sur cet axe
      const cands = vues.filter((V) => axesVue(V).includes(n.k));
      const vu = (V) => n.sommets.some((p) => V.aretes.voit(p.map((c, i) => c - V.vue.f[i] * 0.02)));
      const sens = (V) => (indiceAxe(V.vue.r) === n.k ? "h" : "v");
      const V = cands.find(vu) || cands.sort((a, b) => a.cotes[sens(a)].length - b.cotes[sens(b)].length)[0];
      V.cotes[sens(V)].push({ val: n.val - boite.min[n.k], monde: n.val, ancres: n.sommets.slice(0, 40).map((p) => ({ p, r: 0 })) });
      L[n.k].push(n.val);
      ajoutees.push({ axe: AXES[n.k], val: n.val - boite.min[n.k], vue: V.nom, cachee: !vu(V), exemple: n.sommets[0] });
    }
    L = niveauxCotes(vues);
  }
  const manquantes = manques(L).map((n) => ({ axe: AXES[n.k], val: n.val - boite.min[n.k] }));
  return {
    complet: !manquantes.length && !nonIndiquees.size,
    niveaux: L.reduce((s, l) => s + new Set(l.map((v) => Math.round(v * 100))).size, 0),
    ajoutees, manquantes, nonIndiquees: [...nonIndiquees],
  };
}

// ------------------------------------------------------------------ dessin d'une vue

function etendueVue(vue, boite) {
  const us = [], vs = [];
  for (const x of [boite.min[0], boite.max[0]]) for (const y of [boite.min[1], boite.max[1]]) for (const z of [boite.min[2], boite.max[2]]) {
    us.push(ps([x, y, z], vue.r)); vs.push(ps([x, y, z], vue.u));
  }
  return { umin: Math.min(...us), umax: Math.max(...us), vmin: Math.min(...vs), vmax: Math.max(...vs) };
}

// Place-holder géométrique d'une vue sur la feuille : X = ox + u·s, Y = oy − v·s.
function placer(V, x, y, s) {
  V.s = s;
  V.ox = x - V.e.umin * s;
  V.oy = y + V.e.vmax * s;
  V.rect = { x, y, w: (V.e.umax - V.e.umin) * s, h: (V.e.vmax - V.e.vmin) * s };
}
const versFeuille = (V, p) => [V.ox + ps(p, V.vue.r) * V.s, V.oy - ps(p, V.vue.u) * V.s];
const uvVersFeuille = (V, [u, v]) => [V.ox + u * V.s, V.oy - v * V.s];

// Cotation en cotes d'origine sur un côté de la vue (haut, bas, gauche, droite).
function coterOrigine(F, V, sens, cote) {
  const liste = V.cotes[sens];
  if (!liste.length) return;
  const { x, y, w, h } = V.rect;
  const horiz = sens === "h";
  const k = indiceAxe(horiz ? V.vue.r : V.vue.u);
  const pos = (c) => { const p = [0, 0, 0]; p[k] = c.monde; return horiz ? V.ox + ps(p, V.vue.r) * V.s : V.oy - ps(p, V.vue.u) * V.s; };
  const tri = [...new Map(liste.map((c) => [Math.round(c.val * 100), c])).values()].map((c) => ({ ...c, p: pos(c) })).sort((a, b) => a.p - b.p);
  const origine = tri.find((c) => Math.abs(c.val) < 0.005);
  const decal = V.decal?.[sens] ?? 8;
  const ligne = cote === "haut" ? y - decal : cote === "bas" ? y + h + decal : cote === "gauche" ? x - decal : x + w + decal;
  const versExt = cote === "haut" || cote === "gauche" ? -1 : 1;
  // positions des textes, écartées si les cotes sont serrées
  const ecart = H_COTE + 1.2;
  const pt = tri.map((c) => c.p);
  for (let iter = 0; iter < 200; iter++) {      // on écarte deux à deux les valeurs trop proches
    let bouge = false;
    for (let i = 0; i + 1 < pt.length; i++) {
      const manque = ecart - (pt[i + 1] - pt[i]);
      if (manque > 0.01) { pt[i] -= manque / 2; pt[i + 1] += manque / 2; bouge = true; }
    }
    if (!bouge) break;
  }
  // ligne de cote
  const a = tri[0].p, b = tri[tri.length - 1].p;
  if (horiz) F.segment(a, ligne, b, ligne, { ep: EP.fin }); else F.segment(ligne, a, ligne, b, { ep: EP.fin });
  tri.forEach((c, i) => {
    // ligne de rappel : depuis l'élément (centre, face) ou le bord de la vue, jusqu'à 2 mm au-delà de la ligne de cote
    // (pour une face : son extrémité la plus proche de la ligne de cote)
    // (cercle : depuis son bord côté ligne de cote ; on garde le point d'attache le plus proche de la ligne)
    let d0 = (horiz ? (cote === "haut" ? y : y + h) : (cote === "gauche" ? x : x + w)) + versExt;
    if (c.ancres.length) {
      const departs = c.ancres.map(({ p, r }) => {
        const q = versFeuille(V, p), t = horiz ? q[1] : q[0];
        return t + Math.sign(ligne - t) * (r * V.s + 1);
      });
      d0 = departs.reduce((a, b) => (Math.abs(b - ligne) < Math.abs(a - ligne) ? b : a));
    }
    const d1 = ligne + versExt * 2;
    if (horiz) F.segment(c.p, d0, c.p, d1, { ep: EP.fin }); else F.segment(d0, c.p, d1, c.p, { ep: EP.fin });
    // origine : petit cercle ; sinon flèche orientée depuis l'origine
    if (c === origine) {
      if (horiz) F.cercle(c.p, ligne, 1, { ep: EP.fin }); else F.cercle(ligne, c.p, 1, { ep: EP.fin });
    } else {
      const dir = Math.sign(c.p - (origine ? origine.p : a)) || 1;
      if (horiz) F.fleche(c.p, ligne, dir > 0 ? 0 : Math.PI); else F.fleche(ligne, c.p, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    // valeur au bout de la ligne de rappel (décalée par un petit coude si besoin)
    const t0 = ligne + versExt * 2, t1 = ligne + versExt * 3.5;
    if (Math.abs(pt[i] - c.p) > 0.05) {
      if (horiz) F.segment(c.p, t0, pt[i], t1, { ep: EP.fin }); else F.segment(t0, c.p, t1, pt[i], { ep: EP.fin });
    }
    const txt = fmt(c.val);
    if (horiz) F.texte(pt[i] + H_COTE / 2, t1 + versExt * 0.6, txt, { h: H_COTE, angle: 90, align: cote === "haut" ? "g" : "d", v: "base" });
    else F.texte(t1 + versExt * 0.6, pt[i] + H_COTE / 2, txt, { h: H_COTE, align: cote === "gauche" ? "d" : "g", v: "base" });
  });
}

function placeCotes(V, sens) {
  const liste = V.cotes[sens];
  if (!liste.length) return 0;
  const largeur = Math.max(...liste.map((c) => largeurTexte(fmt(c.val), H_COTE)));
  return (V.decal?.[sens] ?? 8) + 4.5 + largeur + 2;
}

// Lignes de repère vers les formes : flèche sur le contour, épaulement, texte.
function indications(F, V, liste, cote) {
  if (!liste.length) return;
  for (const it of liste) {
    it.pt = versFeuille(V, it.p3);
    if (it.c3) { it.centre = versFeuille(V, it.c3); it.rayon = it.r3 * V.s; }
  }
  const { x, y, w, h } = V.rect;
  const hauteurBloc = (it) => it.lignes.length * (H_COTE + 2.2);
  if (cote === "droite") {
    const xc = x + w + V.margeDroiteCotes + 6;
    liste.sort((a, b) => a.pt[1] - b.pt[1]);
    // yy = ligne de base de la dernière ligne (l'épaulement est juste dessous) ; un bloc commence sous le précédent
    let epaulement = -Infinity;
    // la ligne de repère ne doit pas passer sur un trou : on décale le texte jusqu'à trouver un passage libre
    const libre = (it, yy) => F.infos.cercles.every((c) => (it.centre && Math.hypot(c.c[0] - it.centre[0], c.c[1] - it.centre[1]) < 0.01)
      || distanceSegment(c.c, it.pt, [xc - 1, yy + 1.2]) > c.r + 0.6);
    for (const it of liste) {
      const mini = epaulement + 2.5 + H_COTE + (it.lignes.length - 1) * (H_COTE + 2.2);
      const base = Math.max(it.pt[1], mini);
      const essais = [0, -3, 3, -6, 6, -9, 9, -12, 12, -16, 16].map((d) => base + d).filter((yy) => yy >= mini);
      const yy = essais.find((v) => libre(it, v)) ?? base;
      epaulement = yy + 1.2;
      dessinerRepere(F, it, xc, yy, "g");
    }
  } else {
    // sous la vue, chaque texte à l'aplomb de sa forme : ligne de repère courte et presque verticale
    let yc = y + h + V.margeBasCotes + 8, xmin = -Infinity;
    liste.sort((a, b) => a.pt[0] - b.pt[0]);
    for (const it of liste) {
      const xt = Math.max(it.pt[0] + 3, xmin);
      dessinerRepere(F, it, xt, yc, "g");
      xmin = xt + largeurIndication(it) + 4;
    }
  }
}

function distanceSegment(p, a, b) {
  const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2));
  return Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1]));
}

const largeurIndication = (it) => Math.max(...it.lignes.map((l) => l.reduce((s, m) => s + (typeof m === "string" ? largeurTexte(m, H_COTE) : H_COTE * 1.05), 0)));

function dessinerRepere(F, it, xt, yt, align) {
  const largeur = largeurIndication(it);
  // ligne de repère : de la pointe (sur la forme) au début de l'épaulement, puis épaulement sous le texte
  const ex = xt - 1, ey = yt + 1.2;
  // sur un cercle, la ligne de repère est radiale : la pointe est sur le cercle, dans l'axe du centre
  if (it.centre) {
    const [cx, cy] = it.centre, l = Math.hypot(ex - cx, ey - cy) || 1;
    it.pt = [cx + ((ex - cx) / l) * it.rayon, cy + ((ey - cy) / l) * it.rayon];
  }
  const [px, py] = it.pt;
  F.infos.reperes.push({ pointe: [px, py], vers: [ex, ey], centre: it.centre || null, rayon: it.rayon || 0, texte: it.lignes[0].filter((m) => typeof m === "string").join("") });
  F.segment(px, py, ex, ey, { ep: EP.fin });
  F.segment(ex, ey, xt + largeur + 1, ey, { ep: EP.fin });
  const a = Math.atan2(py - ey, px - ex);
  if (it.fleche !== false) F.fleche(px, py, a); else F.disque(px, py, 0.5);
  // lignes empilées au-dessus de l'épaulement, la première en haut
  const n = it.lignes.length;
  it.lignes.forEach((l, i) => F.texteRiche(xt, yt - (n - 1 - i) * (H_COTE + 2.2), l, { h: H_COTE }));
}

// Traits d'axe : croix sur les cercles vus en vraie grandeur, axe le long des perçages vus de côté.
function axes(F, V, groupes) {
  const fait = new Set();
  const trace = (pts) => {
    const cle = pts.map((p) => p.map((v) => Math.round(v * 10)).join(",")).join(";");
    if (fait.has(cle)) return;
    fait.add(cle);
    F.trait(pts, { ep: EP.fin, motif: "mixte" });
  };
  for (const g of groupes) {
    for (const it of g.items) {
      if (g.type === "arrondi" && it.angle < 179) continue;
      const r = (g.type === "percage" ? Math.max(...it.etages.map((e) => e.r)) : it.r) * V.s + 3;
      if (V.coupe && ps(pointAxe(it, it.debut), V.coupe.n) < V.coupe.c - 0.01 && ps(pointAxe(it, it.fin), V.coupe.n) < V.coupe.c - 0.01) continue;
      if (parallele(it.axe, V.vue.f)) {
        const centres = g.type === "oblong" ? [it.c1, it.c2] : [pointAxe(it, it.debut)];
        if (g.type === "percage" && V.voitForme(it)) {
          // trou vu en vraie grandeur : son cercle d'entrée (pour les contrôles du plan)
          const entree = ps(pointAxe(it, it.debut), V.vue.f) < ps(pointAxe(it, it.fin), V.vue.f) ? it.etages[0] : it.etages[it.etages.length - 1];
          F.infos.cercles.push({ c: versFeuille(V, centres[0]), r: entree.r * V.s });
        }
        for (const c of centres) {
          const [cx, cy] = versFeuille(V, c);
          trace([[cx - r, cy], [cx + r, cy]]);
          trace([[cx, cy - r], [cx, cy + r]]);
        }
        if (g.type === "oblong") {
          const [x1, y1] = versFeuille(V, it.c1), [x2, y2] = versFeuille(V, it.c2);
          const l = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / l, uy = (y2 - y1) / l;
          trace([[x1 - ux * r, y1 - uy * r], [x2 + ux * r, y2 + uy * r]]);
        }
      } else if (Math.abs(ps(it.axe, V.vue.f)) < 1e-4 && g.type !== "arrondi" && g.type !== "oblong") {
        const [x1, y1] = versFeuille(V, pointAxe(it, it.debut)), [x2, y2] = versFeuille(V, pointAxe(it, it.fin));
        const l = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / l, uy = (y2 - y1) / l;
        trace([[x1 - ux * 3, y1 - uy * 3], [x2 + ux * 3, y2 + uy * 3]]);
      }
    }
  }
}

// Indications (Ø, lamage, R, chanfrein…) : chaque groupe une seule fois, dans la vue où il est vu en vraie grandeur.
function preparerIndications(vues, groupes, formes) {
  // l'exemplaire désigné est celui du côté où s'écrit le texte (droite, ou bas pour une coupe)
  const versTexte = (V, p) => (V.coteIndications === "bas" ? -ps(p, V.vue.u) : ps(p, V.vue.r));
  for (const g of groupes) {
    for (const V of vues) {
      const vus = g.items.filter((it) => parallele(it.axe, V.vue.f) && V.voitForme(it));
      if (!vus.length) continue;
      const tProche = (it) => (ps(pointAxe(it, it.debut), V.vue.f) < ps(pointAxe(it, it.fin), V.vue.f) ? it.debut : it.fin);
      const ancre = (it) => {
        const t = tProche(it);
        if (g.type === "arrondi") return { p3: pointAxe(it, t).map((c, i) => c + it.milieu[i] * it.r) };
        // cercle : la flèche touchera le cercle vu (étage côté observateur), dans l'axe du centre
        const r = g.type === "percage" ? (t === it.debut ? it.etages[0] : it.etages[it.etages.length - 1]).r : it.r;
        const c = g.type === "oblong" ? it.c2 : pointAxe(it, t);
        return { p3: c.map((v, i) => v + V.vue.r[i] * r), c3: c, r3: r };
      };
      const choisi = vus.map(ancre).reduce((a, b) => (versTexte(V, b.p3) > versTexte(V, a.p3) ? b : a));
      const lignes = indication({ ...g, items: vus.length === g.items.length ? g.items : vus });
      V.indications.push({ ...choisi, lignes });
      g.indique = true;
      break;
    }
  }
  // chanfreins à 45°, vus par la tranche
  const chanfreins = new Map();
  for (const p of formes.plans || []) {
    const ks = [0, 1, 2].filter((i) => Math.abs(p.n[i]) > 1e-4);
    if (ks.length !== 2 || Math.abs(Math.abs(p.n[ks[0]]) - Math.abs(p.n[ks[1]])) > 1e-3) continue;
    const a = p.max[ks[0]] - p.min[ks[0]], b = p.max[ks[1]] - p.min[ks[1]];
    for (const V of vues) {
      if (Math.abs(ps(p.n, V.vue.f)) > 1e-4 || V.coupe || !V.voitPlan(p)) continue;
      const cle = `${vues.indexOf(V)}|${a.toFixed(2)}|${b.toFixed(2)}`;
      const c = p.min.map((m, i) => (m + p.max[i]) / 2);
      if (!chanfreins.has(cle)) chanfreins.set(cle, { V, n: 0, a, b, c });
      const ch = chanfreins.get(cle);
      ch.n++;
      if (versTexte(V, c) > versTexte(V, ch.c)) ch.c = c;
      p.indique = true;   // pour le contrôle de cotation : ses arêtes sont données par « a × 45° »
      break;
    }
  }
  for (const { V, n, a, b, c } of chanfreins.values()) {
    V.indications.push({ p3: c, lignes: [[`${n > 1 ? n + "× " : ""}${Math.abs(a - b) < 0.01 ? fmt(a) + " × 45°" : fmt(a) + " × " + fmt(b)}`]] });
  }
}

// Diamètres des perçages coupés dont aucune vue ne montre le cercle : cote linéaire Ø dans la coupe.
function diametresEnCoupe(F, V, groupes) {
  if (!V.coupe) return;
  for (const g of groupes.filter((x) => x.type === "percage" && !x.indique)) {
    for (const p of g.items) {
      if (Math.abs(ps(p.axe, V.coupe.n)) > 1e-4 || Math.abs(ps(p.centre, V.coupe.n) - V.coupe.c) > 0.01) continue;
      const perp = pv(p.axe, V.coupe.n);
      p.etages.forEach((e) => {
        const m = pointAxe(p, (e.debut + e.fin) / 2);
        const [x1, y1] = versFeuille(V, m.map((v, i) => v - perp[i] * e.r)), [x2, y2] = versFeuille(V, m.map((v, i) => v + perp[i] * e.r));
        const a = Math.atan2(y2 - y1, x2 - x1);
        F.segment(x1, y1, x2, y2, { ep: EP.fin });
        F.fleche(x1, y1, a + Math.PI); F.fleche(x2, y2, a);
        const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1);
        F.texte((x1 + x2) / 2 + (vertical ? -1 : 0), (y1 + y2) / 2 - (vertical ? 0 : 1), `Ø${fmt(2 * e.r)}`, { h: H_COTE, angle: vertical ? 90 : 0, align: "c" });
      });
      g.indique = true;
      break;
    }
  }
}

// Point strictement à l'intérieur d'une zone coupée (règle pair-impair, à plus de 0,05 mm du contour) ?
function dansCoupe(p, contours) {
  let dedans = false;
  for (const c of contours) {
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const [xi, yi] = c[i], [xj, yj] = c[j];
      const l2 = (xj - xi) ** 2 + (yj - yi) ** 2 || 1e-12;
      const t = Math.max(0, Math.min(1, ((p[0] - xi) * (xj - xi) + (p[1] - yi) * (yj - yi)) / l2));
      if (Math.hypot(p[0] - xi - t * (xj - xi), p[1] - yi - t * (yj - yi)) < 0.05) return false;
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dedans = !dedans;
    }
  }
  return dedans;
}

// Dans une coupe, la matière coupée est devant : ce qui est derrière elle n'est pas vu.
function masquerDerriereCoupe(lignes, contours) {
  const out = [];
  for (const l of lignes) {
    let cour = [];
    for (let i = 0; i + 1 < l.length; i++) {
      const [a, b] = [l[i], l[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.3));
      for (let k = 0; k < n; k++) {
        const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const q = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
        if (dansCoupe([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], contours)) { if (cour.length > 1) out.push(cour); cour = []; continue; }
        if (!cour.length) cour.push(p);
        cour.push(q);
      }
    }
    if (cour.length > 1) out.push(cour);
  }
  return out;
}

function dessinerVue(F, V, groupes, rendu) {
  const pas = Math.max(1.5, Math.min(4, Math.max(V.rect.w, V.rect.h) / 30));
  if (V.coupe) V.aretes.vues = masquerDerriereCoupe(V.aretes.vues, V.contours);
  if (V.coupe) {
    const contours = V.contours.map((l) => l.map((p) => uvVersFeuille(V, p)));
    F.infos.coupes.push(contours);
    for (const [p, q] of hachurer(contours, pas, 45)) F.segment(p[0], p[1], q[0], q[1], { ep: EP.fin });
    for (const c of contours) F.trait(c, { ep: EP.fort, ferme: true });
  } else {
    for (const l of V.aretes.cachees) F.trait(l.map((p) => uvVersFeuille(V, p)), { ep: EP.fin, motif: "interrompu" });
  }
  for (const l of V.aretes.vues) F.trait(l.map((p) => uvVersFeuille(V, p)), { ep: EP.fort });
  axes(F, V, groupes);
}

// ------------------------------------------------------------------ cadre, cartouche

function cadre(F) {
  const g = 20, m = 10, W = F.largeur, H = F.hauteur;
  F.trait([[g, m], [W - m, m], [W - m, H - m], [g, H - m]], { ep: EP.cadre, ferme: true });
  // repères de centrage
  for (const [x1, y1, x2, y2] of [[W / 2, 0, W / 2, m + 5], [W / 2, H, W / 2, H - m - 5], [0, H / 2, g + 5, H / 2], [W, H / 2, W - m - 5, H / 2]]) F.segment(x1, y1, x2, y2, { ep: EP.cadre });
  // zones de repérage (chiffres en largeur, lettres en hauteur)
  const nx = Math.max(2, Math.round((W - g - m) / 50)), ny = Math.max(2, Math.round((H - 2 * m) / 50));
  const px = (W - g - m) / nx, py = (H - 2 * m) / ny;
  for (let i = 0; i < nx; i++) {
    if (i) { F.segment(g + i * px, 0 + 5, g + i * px, m, { ep: EP.fin }); F.segment(g + i * px, H - m, g + i * px, H - 5, { ep: EP.fin }); }
    F.texte(g + (i + 0.5) * px, m / 2, String(i + 1), { h: 2.5, align: "c", v: "milieu" });
    F.texte(g + (i + 0.5) * px, H - m / 2, String(i + 1), { h: 2.5, align: "c", v: "milieu" });
  }
  for (let j = 0; j < ny; j++) {
    const L = String.fromCharCode(65 + j);
    if (j) { F.segment(g - 5, m + j * py, g, m + j * py, { ep: EP.fin }); F.segment(W - m, m + j * py, W - 5, m + j * py, { ep: EP.fin }); }
    F.texte(g - 5 / 2 - 2.5, m + (j + 0.5) * py, L, { h: 2.5, align: "c", v: "milieu" });
    F.texte(W - m / 2, m + (j + 0.5) * py, L, { h: 2.5, align: "c", v: "milieu" });
  }
}

const CARTOUCHE = { w: 180, h: 36 };

function symboleProjection(F, x, y) {
  // méthode européenne (premier dièdre) : tronc de cône, puis sa vue de gauche placée à droite
  const o = { ep: EP.fin };
  F.trait([[x, y - 1.6], [x + 6, y - 3], [x + 6, y + 3], [x, y + 1.6]], { ...o, ferme: true });
  F.cercle(x + 11.5, y, 3, o); F.cercle(x + 11.5, y, 1.6, o);
  F.segment(x - 1, y, x + 15.5, y, { ep: EP.fin, motif: [2, 0.5, 0.3, 0.5] });
  F.segment(x + 11.5, y - 3.8, x + 11.5, y + 3.8, { ep: EP.fin, motif: [2, 0.5, 0.3, 0.5] });
}

function cartouche(F, c, k, n) {
  const x0 = F.largeur - 10 - CARTOUCHE.w, y0 = F.hauteur - 10 - CARTOUCHE.h, r = CARTOUCHE.h / 4;
  F.trait([[x0, y0], [x0 + CARTOUCHE.w, y0], [x0 + CARTOUCHE.w, y0 + CARTOUCHE.h], [x0, y0 + CARTOUCHE.h]], { ep: EP.fort, ferme: true });
  const case_ = (x, y, w, h, etiquette, valeur, { hv = H_COTE, gras = false } = {}) => {
    F.trait([[x0 + x, y0 + y], [x0 + x + w, y0 + y], [x0 + x + w, y0 + y + h], [x0 + x, y0 + y + h]], { ep: EP.fin, ferme: true });
    if (etiquette) F.texte(x0 + x + 1, y0 + y + 2.6, etiquette, { h: 1.8 });
    if (valeur !== undefined && valeur !== null && valeur !== "") {
      let t = String(valeur), hh = hv;
      while (largeurTexte(t, hh, gras) > w - 3 && hh > 2) hh -= 0.25;
      F.texte(x0 + x + 1.5, y0 + y + h - 1.6, t, { h: hh, gras });
    }
  };
  // colonne gauche : responsabilités et généralités
  case_(0, 0, 38, r, "Dessiné par", c.dessinateur);
  case_(38, 0, 22, r, "Date", c.date);
  case_(0, r, 38, r, "Vérifié par", c.verificateur);
  case_(38, r, 22, r, "Date", c.date_verif);
  case_(0, 2 * r, 60, r, "Tolérances générales", c.tolerance);
  case_(0, 3 * r, 30, r, "Unités", "mm");
  case_(30, 3 * r, 30, r, "Projection", "");
  symboleProjection(F, x0 + 42, y0 + 3 * r + 5.4);
  // centre : désignation, matière, numéro
  case_(60, 0, 80, 2 * r, "Désignation", c.designation, { hv: 5, gras: true });
  case_(60, 2 * r, 45, r, "Matière", c.matiere);
  case_(105, 2 * r, 35, r, "Masse", c.masse);
  case_(60, 3 * r, 55, r, "N° de plan", c.numero, { gras: true });
  case_(115, 3 * r, 25, r, "Indice", c.indice);
  // droite : organisme, projet, échelle, format, feuille
  case_(140, 0, 40, r, "", c.societe, { hv: 5, gras: true });
  case_(140, r, 40, r, "Projet", c.projet);
  case_(140, 2 * r, 20, r, "Échelle", c.echelle);
  case_(160, 2 * r, 20, r, "Format", F.format);
  case_(140, 3 * r, 40, r, "Feuille", `${k} / ${n}`);
}

// ------------------------------------------------------------------ mise en page

function essayerMiseEnPage(format, orientation, s, vues, ctx) {
  const F = { largeur: 0, hauteur: 0 };
  const [a, b] = format === "A4" ? [210, 297] : [420, 297];
  [F.largeur, F.hauteur] = orientation === "portrait" ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];
  const zone = { x0: 20 + 4, y0: 10 + 4, x1: F.largeur - 10 - 4, y1: F.hauteur - 10 - 4 };
  const cart = { x: F.largeur - 10 - CARTOUCHE.w - 4, y: F.hauteur - 10 - CARTOUCHE.h - 4 };
  const [Vf, Vd, Vg] = vues;
  const dim = (V) => [(V.e.umax - V.e.umin) * s, (V.e.vmax - V.e.vmin) * s];
  const [wf, hf] = dim(Vf), [wd, hd] = dim(Vd), [wg, hg] = dim(Vg);
  const indicLarg = (V) => (V.indications.length ? Math.max(...V.indications.map((i) => Math.max(...i.lignes.map((l) => l.reduce((t, m) => t + (typeof m === "string" ? largeurTexte(m, H_COTE) : H_COTE * 1.05), 0))))) + 10 : 0);
  const indicHaut = (V) => V.indications.reduce((t, i) => t + i.lignes.length * (H_COTE + 2.2) + 1.5, 0);
  const titreG = Vg.coupe ? 12 : 0;
  const gaucheCol = Math.max(placeCotes(Vf, "v"), placeCotes(Vd, "v"));
  const hautRang = Math.max(placeCotes(Vf, "h"), placeCotes(Vg, "h") + titreG);
  const x = zone.x0 + gaucheCol, y = zone.y0 + hautRang;
  const droiteF = Math.max(indicLarg(Vf), 14);
  const xg = x + wf + droiteF;
  const yd = y + hf + 14;
  const droiteG = placeCotes(Vg, "v");
  const basG = indicHaut(Vg) ? indicHaut(Vg) + 10 : 0;
  const basD = placeCotes(Vd, "h");
  const droiteD = indicLarg(Vd);
  const xmax = Math.max(xg + wg + droiteG, x + wd + droiteD);
  const ymaxD = yd + hd + basD, ymaxG = y + hg + basG;
  if (xmax > zone.x1 || Math.max(ymaxD, ymaxG) > zone.y1) return null;
  // rien ne doit empiéter sur le cartouche
  const touche = (x0, y0, x1, y1) => x1 > cart.x && y1 > cart.y && x0 < zone.x1 && y0 < zone.y1;
  if (touche(x - gaucheCol, yd, x + wd + droiteD, ymaxD) || touche(xg, y, xg + wg + droiteG, ymaxG)) return null;
  // on aère : décalage vers le centre, en laissant la droite à la vue isométrique, sans toucher le cartouche
  const gw = xmax - (x - gaucheCol), gh = Math.max(ymaxD, ymaxG) - (y - hautRang);
  let dx = Math.max(0, Math.min((zone.x1 - zone.x0 - gw) * 0.2, 40));
  let dy = Math.max(0, (Math.min(zone.y1, cart.y) - zone.y0 - gh) / 2);
  while (dy > 0 && (touche(x - gaucheCol + dx, yd + dy, x + wd + droiteD + dx, ymaxD + dy) || touche(xg + dx, y + dy, xg + wg + droiteG + dx, ymaxG + dy))) dy = Math.max(0, dy - 2);
  const libreX = Math.max(xg + wg + droiteG, x + wd + droiteD) + dx + 12;
  const libre = zone.x1 - libreX > 60 ? { x0: libreX, y0: zone.y0, x1: zone.x1, y1: cart.y - 4 }
    : { x0: x + wd + droiteD + dx + 10, y0: ymaxG + dy + 8, x1: zone.x1, y1: cart.y - 4 };
  return { format, orientation, s, F, pos: { f: [x + dx, y + dy], d: [x + dx, yd + dy], g: [xg + dx, y + dy] }, libre };
}

const FORMATS_ESSAYES = [["A4", "portrait"], ["A3", "paysage"]];   // au-delà de l'A4 : paysage (cours)

function zoneFeuille(format, orientation) {
  const [a, b] = format === "A4" ? [210, 297] : [420, 297];
  const [W, H] = orientation === "portrait" ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];
  return { W, H, zone: { x0: 24, y0: 14, x1: W - 14, y1: H - 14 }, cart: { x: W - 10 - CARTOUCHE.w - 4, y: H - 10 - CARTOUCHE.h - 4 } };
}
const touche = (z, x0, y0, x1, y1) => x1 > z.cart.x && y1 > z.cart.y && x0 < z.zone.x1 && y0 < z.zone.y1;
const indicLarg = (V) => (V.indications.length ? Math.max(...V.indications.map(largeurIndication)) + 10 : 0);
const indicHaut = (V) => V.indications.reduce((t, i) => t + i.lignes.length * (H_COTE + 2.2) + 1.5, 0);
const taille = (V, s) => [(V.e.umax - V.e.umin) * s, (V.e.vmax - V.e.vmin) * s];

// Feuille 1 de la variante à deux feuilles : vue de face + vue de gauche (ou coupe A–A) à sa droite.
function essayerFaceGauche(format, orientation, s, Vf, Vg) {
  const z = zoneFeuille(format, orientation);
  const [wf, hf] = taille(Vf, s), [wg, hg] = taille(Vg, s);
  const titreG = Vg.coupe ? 12 : 0, fleche = 14;   // place de la flèche de référence de la vue de dessus
  const gauche = placeCotes(Vf, "v");
  const haut = Math.max(placeCotes(Vf, "h") + fleche, placeCotes(Vg, "h") + titreG);
  const x = z.zone.x0 + gauche, y = z.zone.y0 + haut;
  const xg = x + wf + Math.max(indicLarg(Vf), 14);
  const basG = indicHaut(Vg) ? indicHaut(Vg) + 10 : 0;
  const xmax = xg + wg + placeCotes(Vg, "v"), ymax = Math.max(y + hf + 6, y + hg + basG);
  if (xmax > z.zone.x1 || ymax > z.zone.y1 || touche(z, x - gauche, y, xmax, ymax)) return null;
  const dx = Math.max(0, Math.min((z.zone.x1 - xmax) / 2, 40)), dy = Math.max(0, Math.min((z.cart.y - ymax) / 3, 30));
  return { format, orientation, s, pos: { f: [x + dx, y + dy], g: [xg + dx, y + dy] }, libre: null, fleche: true };
}

// Feuille 2 : la vue de dessus seule (désignée « B »), et la vue isométrique dans la place libre.
function essayerDessusSeule(format, orientation, s, Vd) {
  const z = zoneFeuille(format, orientation);
  const [wd, hd] = taille(Vd, s);
  const gauche = placeCotes(Vd, "v"), titre = 12;
  const x = z.zone.x0 + gauche, y = z.zone.y0 + titre + 4;
  const xmax = x + wd + indicLarg(Vd), ymax = y + hd + placeCotes(Vd, "h");
  if (xmax > z.zone.x1 || ymax > z.zone.y1 || touche(z, x - gauche, y, xmax, ymax)) return null;
  // la vue occupe la gauche, la vue isométrique la droite ; à défaut, l'iso va dessous
  if (z.zone.x1 - xmax > 140) {
    const dx = Math.min((z.zone.x1 - xmax) * 0.15, 40), dy = Math.max(0, Math.min((z.cart.y - ymax) / 3, 30));
    return { format, orientation, s, pos: { d: [x + dx, y + dy] }, libre: { x0: xmax + dx + 15, y0: z.zone.y0, x1: z.zone.x1, y1: z.cart.y - 4 } };
  }
  const libre = z.zone.x1 - xmax > 70 ? { x0: xmax + 10, y0: z.zone.y0, x1: z.zone.x1, y1: z.cart.y - 4 }
    : z.cart.y - ymax > 70 ? { x0: z.zone.x0, y0: ymax + 10, x1: z.zone.x1, y1: z.cart.y - 4 } : null;
  return { format, orientation, s, pos: { d: [x, y] }, libre };
}

// de la plus grande échelle normalisée à la plus petite : la première qui tient l'emporte
function ordreEchelles() {
  return [5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100];
}

// Une feuille si possible ; deux feuilles (face + coupe, puis dessus + iso) si cela permet une plus grande échelle.
function choisirMiseEnPage(vues, boite) {
  const [Vf, Vd, Vg] = vues;
  let une = null, deux = null;
  for (const s of ordreEchelles(boite)) {
    for (const [f, o] of FORMATS_ESSAYES) if (!une) une = essayerMiseEnPage(f, o, s, vues);
    if (une) break;
  }
  for (const s of ordreEchelles(boite)) {
    const f1 = FORMATS_ESSAYES.map(([f, o]) => essayerFaceGauche(f, o, s, Vf, Vg)).find(Boolean);
    const f2 = FORMATS_ESSAYES.map(([f, o]) => essayerDessusSeule(f, o, s, Vd)).find((m) => m && m.libre)
      || FORMATS_ESSAYES.map(([f, o]) => essayerDessusSeule(f, o, s, Vd)).find(Boolean);
    if (f1 && f2) { deux = [f1, f2]; break; }
  }
  if (deux && (!une || deux[0].s > une.s)) return deux;
  return [une || { format: "A3", orientation: "paysage", s: 1 / 100, pos: { f: [40, 40], d: [40, 150], g: [200, 40] }, libre: null }];
}

// ------------------------------------------------------------------ point d'entrée

export function dessinerPlan(objets, { reperes = [], formes = null, cartouche: infos = {} } = {}) {
  const m = preparerMaillage(objets);
  const boite = m.boite;
  formes = formes || { percages: [], oblongs: [], bossages: [], arrondis: [], plans: [] };
  const groupes = grouperFormes(formes);
  const { face, dessus, gauche } = choisirVues(formes, groupes);
  const coupe = choisirCoupe(groupes, gauche);

  const rendu = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: false });
  const vues = [
    { nom: "face", vue: face },
    { nom: "dessus", vue: dessus },
    { nom: "gauche", vue: gauche, coupe },
  ];
  for (const V of vues) {
    V.e = etendueVue(V.vue, boite);
    V.aretes = aretesVue(m, V.vue, rendu, { coupe: V.coupe });
    if (V.coupe) V.contours = section(m, V.coupe, V.vue);
    V.cotes = { h: [], v: [] };
    V.indications = [];
    // une forme est vue en vraie grandeur si son entrée côté observateur n'est pas masquée
    V.voitForme = (it) => {
      if (V.coupe && Math.max(ps(pointAxe(it, it.debut), V.coupe.n), ps(pointAxe(it, it.fin), V.coupe.n)) < V.coupe.c - 0.01) return false;
      const t = ps(pointAxe(it, it.debut), V.vue.f) < ps(pointAxe(it, it.fin), V.vue.f) ? it.debut : it.fin;
      if (it.etages && !(t === it.debut ? it.ouvert_debut : it.ouvert_fin)) return false;
      let p = pointAxe(it, t);
      if (it.milieu && it.angle < 359) p = p.map((c, i) => c + it.milieu[i] * it.r * (it.creux ? 0.9 : 1.1));
      if (!it.etages && !it.c1 && !it.milieu) p = p.map((c, i) => c - V.vue.f[i] * 0.05);   // bossage : face d'extrémité
      return V.aretes.voit(p.map((c, i) => c - V.vue.f[i] * 0.02));
    };
    V.voitPlan = (p) => {
      const kf = indiceAxe(V.vue.f), sf = Math.sign(V.vue.f[kf]);
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const q = p.point.map((c, i) => {
          if (i === kf) return (sf < 0 ? p.max[i] : p.min[i]) - sf * 0.02;
          if (Math.abs(p.n[i]) < 1e-6) return p.min[i] + t * (p.max[i] - p.min[i]);
          return c + p.n[i] * 0.02;
        });
        if (V.aretes.voit(q)) return true;
      }
      return false;
    };
  }
  repartirCotes(vues, formes, groupes, boite);
  for (const V of vues) V.coteIndications = V.coupe ? "bas" : "droite";
  preparerIndications(vues, groupes, formes);
  const controle = controlerCotation(m, vues, formes, groupes, boite);
  // le trait de coupe (flèches, lettres) dépasse au-dessus de la vue de face : cotes plus loin
  if (coupe) vues[0].decal = { h: 16 };

  const mises = choisirMiseEnPage(vues, boite);
  const feuilles = mises.map((mep) => {
    const F = new Feuille(mep.format, mep.orientation);
    F.infos = { cercles: [], coupes: [], reperes: [], controle };   // géométrie utile aux contrôles automatiques du plan
    F.mep = mep;
    cadre(F);
    return F;
  });
  const [Vf, Vd, Vg] = vues;
  const F = feuilles[0], FD = feuilles[feuilles.length - 1];
  const mep = mises[0];
  placer(Vf, ...mep.pos.f, mep.s);
  placer(Vg, ...mep.pos.g, mep.s);
  placer(Vd, ...mises[mises.length - 1].pos.d, mep.s);
  Vf.feuille = F; Vg.feuille = F; Vd.feuille = FD;
  // où et comment chaque vue est dessinée : sert à poser la pièce 3D exactement sous la vue cliquée
  const infoVue = (V, nom) => ({ nom, rect: { ...V.rect }, ox: V.ox, oy: V.oy, s: V.s, f: V.vue.f, u: V.vue.u, r: V.vue.r,
    coupe: V.coupe ? { n: V.coupe.n, c: V.coupe.c } : null });
  F.infos.vues = [infoVue(Vf, "face"), infoVue(Vg, coupe ? "coupe A–A" : "gauche")];
  FD.infos.vues = FD.infos.vues || [];
  if (FD === F) F.infos.vues.push(infoVue(Vd, "dessus")); else FD.infos.vues = [infoVue(Vd, "dessus")];
  Vf.margeDroiteCotes = 0; Vd.margeDroiteCotes = 0; Vg.margeBasCotes = 0;
  for (const V of vues) dessinerVue(V.feuille, V, groupes, rendu);
  // cotes : vue de face en haut et à gauche, dessus en bas et à gauche, gauche (coupe) en haut et à droite
  coterOrigine(F, Vf, "h", "haut"); coterOrigine(F, Vf, "v", "gauche");
  coterOrigine(FD, Vd, "h", "bas"); coterOrigine(FD, Vd, "v", "gauche");
  coterOrigine(F, Vg, "h", "haut"); coterOrigine(F, Vg, "v", "droite");
  diametresEnCoupe(F, Vg, groupes);
  indications(F, Vf, Vf.indications, "droite");
  indications(FD, Vd, Vd.indications, "droite");
  indications(F, Vg, Vg.indications, Vg.coteIndications);
  const hl = mep.format === "A4" ? 5 : 7;

  // vue de dessus sur une autre feuille : flèche de référence « B » au-dessus de la vue de face (ISO 128-30)
  if (FD !== F) {
    const lettre = coupe ? "B" : "A";
    const x = Vf.rect.x + Vf.rect.w * 0.8, y1 = Vf.rect.y - placeCotes(Vf, "h") - 2, y0 = y1 - 10;
    F.segment(x, y0, x, y1, { ep: EP.fin });
    F.fleche(x, y1, Math.PI / 2, 3, 0.6);
    F.texte(x + 2 + hl * 0.1, y0 + hl * 0.2, lettre, { h: hl, v: "milieu" });
    FD.texte(Vd.rect.x + Vd.rect.w / 2, Vd.rect.y - 6, lettre, { h: hl, align: "c" });
    F.notes = [`Vue ${lettre} (dessus) : feuille 2`];
    FD.notes = [`Vue ${lettre} : vue de dessus, désignée sur la feuille 1`];
    F.titre = coupe ? "Face, coupe A–A" : "Face, gauche";
    FD.titre = `Vue ${lettre} (dessus), iso`;
  }

  // trait de coupe sur la vue de face, titre de la coupe
  if (coupe) {
    const p0 = boite.min.map((v, i) => (Math.abs(coupe.n[i]) > 0.5 ? coupe.c * Math.sign(coupe.n[i]) : v));
    const p1 = boite.max.map((v, i) => (Math.abs(coupe.n[i]) > 0.5 ? coupe.c * Math.sign(coupe.n[i]) : v));
    let [xa, ya] = versFeuille(Vf, p0), [xb, yb] = versFeuille(Vf, p1);
    const l = Math.hypot(xb - xa, yb - ya), ux = (xb - xa) / l, uy = (yb - ya) / l;
    xa -= ux * 4; ya -= uy * 4; xb += ux * 4; yb += uy * 4;
    F.segment(xa, ya, xb, yb, { ep: EP.fin, motif: "mixte" });
    const [dx, dy] = (() => { const q = versFeuille(Vf, coupe.n.map((v) => v * 10)), o = versFeuille(Vf, [0, 0, 0]); const n = Math.hypot(q[0] - o[0], q[1] - o[1]); return [(q[0] - o[0]) / n, (q[1] - o[1]) / n]; })();
    // traits forts aux extrémités, flèches dans le sens d'observation, lettres
    for (const [x, y, s] of [[xa, ya, 1], [xb, yb, -1]]) {
      F.segment(x, y, x + ux * s * 6, y + uy * s * 6, { ep: EP.cadre });
      F.segment(x + ux * s * 2, y + uy * s * 2, x + ux * s * 2 + dx * 8, y + uy * s * 2 + dy * 8, { ep: EP.fin });
      F.fleche(x + ux * s * 2 + dx * 8, y + uy * s * 2 + dy * 8, Math.atan2(dy, dx), 3, 0.6);
      // lettre au-dessus de la flèche, côté extérieur (loin de la pièce)
      F.texte(x + ux * s * 2 + dx * 4.5 - ux * s * (hl / 2 + 1.2), y + uy * s * 2 + dy * 4.5 - uy * s * (hl / 2 + 1.2), coupe.lettre, { h: hl, align: "c", v: "milieu" });
    }
    F.texte(Vg.rect.x + Vg.rect.w / 2, Vg.rect.y - placeCotes(Vg, "h") - 3, `${coupe.lettre}–${coupe.lettre}`, { h: hl, align: "c" });
  }

  // vue isométrique dans la place libre (dernière feuille), sans cotes (illustration)
  const libre = mises[mises.length - 1].libre;
  if (libre) {
    const F = FD, mep = { libre };
    // regard depuis l'avant, la droite et le dessus de la vue de face
    const fi = normaliser(face.f.map((v, i) => v - face.r[i] - face.u[i]));
    const ri = normaliser(pv(fi, [0, 0, 1]));
    const iso = { f: fi, r: ri, u: pv(ri, fi) };
    const e = etendueVue(iso, boite);
    const W = mep.libre.x1 - mep.libre.x0, H = mep.libre.y1 - mep.libre.y0;
    const si = Math.min(W / (e.umax - e.umin), H / (e.vmax - e.vmin)) * 0.85;
    if (si * Math.max(e.umax - e.umin, e.vmax - e.vmin) >= 30) {
      const Vi = { vue: iso, e };
      placer(Vi, mep.libre.x0 + (W - (e.umax - e.umin) * si) / 2, mep.libre.y0 + (H - (e.vmax - e.vmin) * si) / 2, si);
      Vi.aretes = aretesVue(m, iso, rendu);
      F.infos.vues.push({ nom: "isométrique", rect: { ...Vi.rect }, ox: Vi.ox, oy: Vi.oy, s: Vi.s, f: iso.f, u: iso.u, r: iso.r, coupe: null });
      for (const l of Vi.aretes.vues) F.trait(l.map((p) => uvVersFeuille(Vi, p)), { ep: EP.fort });
      for (const r of reperes) {
        const [px, py] = versFeuille(Vi, r.pos);
        F.segment(px, py, px + 8, py - 8, { ep: EP.fin }); F.disque(px, py, 0.5);
        F.cercle(px + 11, py - 11, 4, { ep: EP.fin });
        F.texte(px + 11, py - 11, String(r.n), { h: 3.5, align: "c", v: "milieu" });
      }
    }
  }
  rendu.dispose();

  // notes au-dessus du cartouche : renvois entre feuilles, repères posés à la main
  feuilles.forEach((Fx, i) => {
    const lignes = [...(Fx.notes || []), ...(i === feuilles.length - 1 && reperes.length ? ["Repères :", ...reperes.map((r) => `${r.n} — ${r.texte}${r.valeur ? " : " + r.valeur : ""}`)] : [])];
    let y = Fx.hauteur - 10 - CARTOUCHE.h - 4 - (lignes.length - 1) * 5.5;
    for (const l of lignes) { Fx.texte(Fx.largeur - 10 - CARTOUCHE.w, y, l, { h: 3.5, gras: l === "Repères :" }); y += 5.5; }
    cartouche(Fx, { ...infos, echelle: texteEchelle(mep.s) }, i + 1, feuilles.length);
  });
  return feuilles;
}

function normaliser(a) { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); }
