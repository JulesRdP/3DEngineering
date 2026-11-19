// Arêtes d'un maillage pour la mise en plan : arêtes vives, contours apparents des surfaces courbes,
// tri vues / cachées par une carte de profondeur rendue en WebGL, sections planes (pour les coupes).
// Une vue est définie par f (direction du regard), u (haut de l'écran) et r = f × u (droite de l'écran) ;
// un point p de la pièce se projette en (p·r, p·u), sa profondeur est p·f.
import * as THREE from "three";

const VIVE = Math.cos((30 * Math.PI) / 180);   // au-delà de 30° entre facettes : arête dessinée

const ps = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const pv = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const projeter = (p, vue) => [ps(p, vue.r), ps(p, vue.u)];

export function preparerMaillage(objets) {
  const index = new Map(), pts = [], faces = [];
  const a = new THREE.Vector3();
  const sommet = (v) => {
    const k = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
    let i = index.get(k);
    if (i === undefined) { i = pts.length; index.set(k, i); pts.push([v.x, v.y, v.z]); }
    return i;
  };
  for (const obj of objets) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, idx = o.geometry.index;
      const nb = idx ? idx.count : pos.count;
      for (let i = 0; i < nb; i += 3) {
        const t = [0, 1, 2].map((k) => sommet(a.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld)));
        if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) faces.push(t);
      }
    });
  }
  const normales = faces.map(([i, j, k]) => {
    const e1 = pts[j].map((v, m) => v - pts[i][m]), e2 = pts[k].map((v, m) => v - pts[i][m]);
    const n = pv(e1, e2), l = Math.hypot(...n) || 1;
    return n.map((v) => v / l);
  });
  const parArete = new Map();
  faces.forEach((t, f) => {
    for (let k = 0; k < 3; k++) {
      const i = t[k], j = t[(k + 1) % 3];
      const cle = i < j ? i * pts.length + j : j * pts.length + i;
      const e = parArete.get(cle);
      if (e) e.push(f); else parArete.set(cle, [Math.min(i, j), Math.max(i, j), f]);
    }
  });
  const aretes = [];
  for (const [i, j, f1, f2, ...autres] of parArete.values()) {
    const vive = f2 === undefined || autres.length > 0 || ps(normales[f1], normales[f2]) < VIVE;
    aretes.push({ i, j, f1, f2: f2 ?? -1, vive });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
  geo.setIndex(faces.flat());
  const boite = { min: [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), max: [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))) };
  return { pts, faces, normales, aretes, geo, boite };
}

// ------------------------------------------------------------------ carte de profondeur

const SOMMETS = `varying vec3 vMonde;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vMonde = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAGMENTS = `uniform vec3 regard; uniform float wmin; uniform float wmax; uniform vec4 plan; uniform float coupe;
varying vec3 vMonde;
void main() {
  if (coupe > 0.5 && dot(vMonde, plan.xyz) < plan.w) discard;
  float d = clamp((dot(vMonde, regard) - wmin) / (wmax - wmin), 0.0, 0.9998);
  vec3 e = fract(d * vec3(1.0, 255.0, 65025.0));
  e -= e.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
  gl_FragColor = vec4(e, 1.0);
}`;

function carteProfondeur(m, vue, rendu, coupe) {
  const us = m.pts.map((p) => ps(p, vue.r)), vs = m.pts.map((p) => ps(p, vue.u)), ws = m.pts.map((p) => ps(p, vue.f));
  const du = Math.max(...us) - Math.min(...us), dv = Math.max(...vs) - Math.min(...vs);
  const R = Math.max(2, Math.min(24, 1600 / Math.max(du, dv, 1)));
  const marge = 4 / R;
  const umin = Math.min(...us) - marge, vmin = Math.min(...vs) - marge;
  const W = Math.min(4096, Math.ceil((du + 2 * marge) * R)), H = Math.min(4096, Math.ceil((dv + 2 * marge) * R));
  const umax = umin + W / R, vmax = vmin + H / R;
  const wmin = Math.min(...ws) - 1, wmax = Math.max(...ws) + 1;
  const recul = Math.max(du, dv, wmax - wmin) * 4 + 100;
  const cam = new THREE.OrthographicCamera(umin, umax, vmax, vmin, wmin + recul - 1, wmax + recul + 1);
  cam.position.set(...vue.f.map((v) => -v * recul));
  cam.up.set(...vue.u);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const mat = new THREE.ShaderMaterial({
    vertexShader: SOMMETS, fragmentShader: FRAGMENTS, side: THREE.DoubleSide,
    uniforms: { regard: { value: new THREE.Vector3(...vue.f) }, wmin: { value: wmin }, wmax: { value: wmax },
                plan: { value: coupe ? new THREE.Vector4(...coupe.n, coupe.c) : new THREE.Vector4() }, coupe: { value: coupe ? 1 : 0 } },
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(m.geo, mat));
  const cible = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  rendu.setRenderTarget(cible);
  rendu.setClearColor(0xffffff, 1);
  rendu.clear();
  rendu.render(scene, cam);
  const px = new Uint8Array(W * H * 4);
  rendu.readRenderTargetPixels(cible, 0, 0, W, H, px);
  rendu.setRenderTarget(null);
  cible.dispose(); mat.dispose();
  const prof = (i, j) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return Infinity;
    const k = (j * W + i) * 4;
    if (px[k] === 255 && px[k + 1] === 255 && px[k + 2] === 255) return Infinity;
    return wmin + (px[k] / 255 + px[k + 1] / 65025 + px[k + 2] / 16581375) * (wmax - wmin);
  };
  return { prof, R, umin, vmin };
}

// ------------------------------------------------------------------ arêtes d'une vue

// Segments 3D à dessiner dans la vue : arêtes vives + contours apparents (bord entre facette vue et facette de dos).
function candidats(m, vue) {
  const out = [];
  for (const e of m.aretes) {
    if (!e.vive) {
      const a = ps(m.normales[e.f1], vue.f), b = ps(m.normales[e.f2], vue.f);
      if (a * b > 0) continue;
    }
    out.push([m.pts[e.i], m.pts[e.j]]);
  }
  return out;
}

function decouperParCoupe(seg, coupe) {
  const [p, q] = seg;
  const dp = ps(p, coupe.n) - coupe.c, dq = ps(q, coupe.n) - coupe.c;
  if (dp < -1e-6 && dq < -1e-6) return null;
  if (Math.abs(dp) < 1e-6 && Math.abs(dq) < 1e-6) return null;  // dans le plan : remplacé par le contour de coupe
  if (dp >= -1e-6 && dq >= -1e-6) return seg;
  const t = dp / (dp - dq);
  const x = p.map((v, k) => v + (q[k] - v) * t);
  return dp < 0 ? [x, q] : [p, x];
}

// Renvoie { vues, cachees } : listes de polylignes en coordonnées de vue (mm pièce).
export function aretesVue(m, vue, rendu, { coupe = null } = {}) {
  const carte = carteProfondeur(m, vue, rendu, coupe);
  const { prof, R, umin, vmin } = carte;
  const vues = [], cachees = [];
  for (let seg of candidats(m, vue)) {
    if (coupe && !(seg = decouperParCoupe(seg, coupe))) continue;
    const [p, q] = seg;
    const a = [ps(p, vue.r), ps(p, vue.u), ps(p, vue.f)], b = [ps(q, vue.r), ps(q, vue.u), ps(q, vue.f)];
    const l2 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l2 < 0.01) continue;
    const n = Math.max(2, Math.ceil(l2 * R));
    const etat = new Array(n);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t, w = a[2] + (b[2] - a[2]) * t;
      const i = Math.floor((u - umin) * R), j = Math.floor((v - vmin) * R);
      const dc = prof(i, j);
      if (!isFinite(dc)) { etat[k] = true; continue; }
      let g = 0;
      for (const [x1, y1, x2, y2] of [[i - 1, j, i + 1, j], [i, j - 1, i, j + 1]]) {
        const d1 = prof(x1, y1), d2 = prof(x2, y2);
        g = Math.max(g, isFinite(d1) && isFinite(d2) ? (Math.abs(d1 - d2) * R) / 2 : 50);
      }
      etat[k] = w <= dc + 0.04 + (Math.min(g, 50) * 1.5) / R;
    }
    // un échantillon isolé (bruit de la carte) prend l'état de ses voisins
    for (let k = 0; k < n; k++) {
      const av = k ? etat[k - 1] : etat[k + 1], ap = k < n - 1 ? etat[k + 1] : etat[k - 1];
      if (av === ap && etat[k] !== av) etat[k] = av;
    }
    let debut = 0;
    for (let k = 1; k <= n; k++) {
      if (k < n && etat[k] === etat[debut]) continue;
      const t0 = debut / n, t1 = k / n;
      const s = [[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]];
      (etat[debut] ? vues : cachees).push(s);
      debut = k;
    }
  }
  // un point est vu si rien ne le masque (la pièce coupée, pour une coupe)
  const voit = (p) => {
    const dc = prof(Math.floor((ps(p, vue.r) - umin) * R), Math.floor((ps(p, vue.u) - vmin) * R));
    return !isFinite(dc) || ps(p, vue.f) <= dc + 0.05;
  };
  const fusion = fusionner(vues, cachees);
  return { vues: chainer(fusion.vues), cachees: chainer(fusion.cachees), voit };
}

// Segments superposés (arête avant et arrière d'une face vue par la tranche…) : on les fusionne, et on retire
// des arêtes cachées ce qui est déjà couvert par une arête vue. Sinon les tirets décalés forment un trait plein.
function fusionner(vues, cachees) {
  const parLigne = (segs) => {
    const m = new Map();
    for (const [p, q] of segs) {
      let a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      if (a < 0) a += Math.PI;
      if (a >= Math.PI - 1e-9) a = 0;
      const d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
      const cle = `${Math.round(a * 500)}|${Math.round((p[0] * n[0] + p[1] * n[1]) * 50)}`;
      const t0 = p[0] * d[0] + p[1] * d[1], t1 = q[0] * d[0] + q[1] * d[1];
      if (!m.has(cle)) m.set(cle, { d, n, off: p[0] * n[0] + p[1] * n[1], iv: [] });
      m.get(cle).iv.push([Math.min(t0, t1), Math.max(t0, t1)]);
    }
    for (const l of m.values()) {
      l.iv.sort((x, y) => x[0] - y[0]);
      const r = [];
      for (const iv of l.iv) {
        if (r.length && iv[0] <= r[r.length - 1][1] + 1e-4) r[r.length - 1][1] = Math.max(r[r.length - 1][1], iv[1]);
        else r.push(iv.slice());
      }
      l.iv = r;
    }
    return m;
  };
  const V = parLigne(vues), C = parLigne(cachees);
  for (const [cle, l] of C) {
    const couvre = V.get(cle);
    if (!couvre) continue;
    let reste = l.iv;
    for (const [a, b] of couvre.iv) {
      reste = reste.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, Math.max(x, a)], [Math.min(y, b), y]].filter(([s, e]) => e - s > 0.05)));
    }
    l.iv = reste;
  }
  const versSegs = (m) => [...m.values()].flatMap((l) => l.iv.map(([a, b]) => [
    [l.n[0] * l.off + l.d[0] * a, l.n[1] * l.off + l.d[1] * a], [l.n[0] * l.off + l.d[0] * b, l.n[1] * l.off + l.d[1] * b]]));
  return { vues: versSegs(V), cachees: versSegs(C) };
}

// Met bout à bout les segments qui se touchent (les tirets restent réguliers le long d'un cercle).
export function chainer(segs) {
  const cle = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const adj = new Map();
  segs.forEach((s, i) => s.forEach((p) => { const c = cle(p); if (!adj.has(c)) adj.set(c, []); adj.get(c).push(i); }));
  const pris = new Uint8Array(segs.length), res = [];
  const prolonger = (ligne, bout) => {
    for (;;) {
      const c = cle(bout);
      const j = (adj.get(c) || []).find((x) => !pris[x]);
      if (j === undefined) return;
      pris[j] = 1;
      bout = cle(segs[j][0]) === c ? segs[j][1] : segs[j][0];
      ligne.push(bout);
    }
  };
  // d'abord depuis les extrémités libres, puis les boucles
  const ordre = [...segs.keys()].sort((x, y) => Math.min(...segs[x].map((p) => adj.get(cle(p)).length)) - Math.min(...segs[y].map((p) => adj.get(cle(p)).length)));
  for (const i of ordre) {
    if (pris[i]) continue;
    pris[i] = 1;
    const ligne = [segs[i][0], segs[i][1]];
    prolonger(ligne, segs[i][1]);
    const avant = [segs[i][0]];
    prolonger(avant, segs[i][0]);
    res.push([...avant.slice(1).reverse(), ...ligne]);
  }
  return res;
}

// ------------------------------------------------------------------ sections

// Contours de la section par le plan p·n = c, en coordonnées de vue.
export function section(m, coupe, vue) {
  const c = coupe.c + 1e-4, segs = [];
  for (const [i, j, k] of m.faces) {
    const t = [m.pts[i], m.pts[j], m.pts[k]];
    const s = t.map((p) => ps(p, coupe.n) - c);
    const pts = [];
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3;
      if ((s[a] < 0) !== (s[b] < 0)) {
        const x = s[a] / (s[a] - s[b]);
        pts.push(projeter(t[a].map((v, d) => v + (t[b][d] - v) * x), vue));
      }
    }
    if (pts.length === 2) segs.push(pts);
  }
  return chainer(segs).filter((l) => l.length > 2);
}
