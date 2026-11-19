// Visionneuse 3D (three.js) : une ou plusieurs pièces, axe Z vers le haut comme dans les trancheurs,
// repères numérotés posés en cliquant sur la pièce.
// Styles d'affichage comme dans un logiciel de CAO (ombré, ombré avec arêtes, lignes cachées supprimées ou
// apparentes, filaire), couleur, contraste et reflets : barre en haut à droite de la vue. Les valeurs par défaut
// sont des réglages de l'atelier (section Vue 3D) ; ce qu'on change dans la barre est retenu par ce navigateur.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { preparerMaillage } from "./aretes.js";

export const PALETTE = [0xe0661b, 0x2f6fb0, 0x2f8a4c, 0x9b59b6, 0xc08a12, 0x16a3a3, 0xc2392f, 0x7f8c8d];
const GRIS_CAO = 0xa7b1bd;

const cache = new Map();
export async function chargerObjet(url, type) {
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      const donnees = await (await fetch(url)).arrayBuffer();
      if (type === "stl") {
        const geo = new STLLoader().parse(donnees);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo);
      }
      // Le chargeur 3MF ne calcule pas de normales (il compte sur le « flatShading » de ses propres matériaux) ;
      // or on remplace ces matériaux : sans normales, l'éclairage ne marche pas et la pièce sort toute noire.
      // On calcule donc des normales par face, comme pour un STL (arêtes vives nettes, reliefs visibles).
      const obj = new ThreeMFLoader().parse(donnees);
      obj.traverse((o) => {
        if (!o.isMesh || o.geometry.attributes.normal) return;
        if (o.geometry.index) o.geometry = o.geometry.toNonIndexed();
        o.geometry.computeVertexNormals();
      });
      return obj;
    })());
  }
  return (await cache.get(url)).clone();
}

// ------------------------------------------------------------------ options d'affichage

export const STYLES = [
  ["ombre", "Ombré"],
  ["ombre_aretes", "Ombré avec arêtes"],
  ["sans_cachees", "Lignes cachées supprimées"],
  ["cachees", "Lignes cachées apparentes"],
  ["filaire", "Filaire"],
];
export const COULEURS = [["piece", "Couleur des pièces", "Couleur"], ["gris", "Gris CAO", "Gris CAO"]];   // clé, réglage, bouton
// mêmes valeurs que les réglages vue3d.* (atelier3d/reglages.py), pour une vue créée sans réglages
export const AFFICHAGE_DEFAUT = { style: "ombre_aretes", couleur: "piece", contraste: 50, reflets: 30 };

const CLE_LOCALE = "atelier3d.affichage3d";
const vues = new Set();
let defautsAtelier = { ...AFFICHAGE_DEFAUT };

function lireLocal() {
  try { return JSON.parse(localStorage.getItem(CLE_LOCALE) || "{}") || {}; } catch { return {}; }
}
function ecrireLocal(o) {
  try { o ? localStorage.setItem(CLE_LOCALE, JSON.stringify(o)) : localStorage.removeItem(CLE_LOCALE); } catch { /* stockage bloqué */ }
}
function valide(o) {
  const r = {};
  if (STYLES.some(([k]) => k === o.style)) r.style = o.style;
  if (COULEURS.some(([k]) => k === o.couleur)) r.couleur = o.couleur;
  for (const k of ["contraste", "reflets"]) if (Number.isFinite(o[k])) r[k] = Math.max(0, Math.min(100, o[k]));
  return r;
}
/** Affichage en vigueur : réglages de l'atelier, puis ce que ce navigateur a choisi dans la barre. */
export function affichageCourant() {
  return { ...defautsAtelier, ...valide(lireLocal()) };
}
/** Valeurs par défaut de l'atelier (réglages vue3d.*) ; toutes les vues ouvertes suivent. */
export function definirDefauts(d) {
  defautsAtelier = { ...AFFICHAGE_DEFAUT, ...valide(d || {}) };
  for (const v of vues) v.appliquerAffichage();
}
/** Changement fait dans la barre (null : revenir aux valeurs de l'atelier) ; toutes les vues ouvertes suivent. */
export function changerAffichage(changement) {
  ecrireLocal(changement === null ? null : valide({ ...lireLocal(), ...changement }));
  for (const v of vues) v.appliquerAffichage();
}

// Pièce de studio photo très simple (murs gris, panneaux lumineux) : donne des reflets aux pièces brillantes.
function environnementStudio(rendu) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x3c4148, side: THREE.BackSide })));
  const panneau = (x, y, z, l, h, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(l, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panneau(0, 0, 4.9, 5, 5, 4);       // plafond (Z vers le haut)
  panneau(-4.9, -1.5, 1, 2.5, 5, 3); // grande boîte à lumière à gauche
  panneau(4.9, 2, 0.5, 1.5, 4, 2);   // lumière d'appoint à droite
  panneau(0, -4.9, -1, 6, 1, 1.5);   // bandeau bas
  const pmrem = new THREE.PMREMGenerator(rendu);
  const env = pmrem.fromScene(s, 0.04).texture;
  pmrem.dispose();
  s.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return env;
}

const ICONES = {
  ombre: `<path d="M12 3 20 7.5 12 12 4 7.5Z" fill="currentColor" opacity=".55"/><path d="M4 7.5 12 12v9l-8-4.5Z" fill="currentColor" opacity=".9"/><path d="M20 7.5 12 12v9l8-4.5Z" fill="currentColor" opacity=".3"/>`,
  ombre_aretes: `<path d="M12 3 20 7.5 12 12 4 7.5Z" fill="currentColor" opacity=".45"/><path d="M4 7.5 12 12v9l-8-4.5Z" fill="currentColor" opacity=".8"/><path d="M20 7.5 12 12v9l8-4.5Z" fill="currentColor" opacity=".25"/><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Zm0 9v9M4 7.5 12 12l8-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  sans_cachees: `<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Zm0 9v9M4 7.5 12 12l8-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  cachees: `<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Zm0 9v9M4 7.5 12 12l8-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 12.5V3.5m0 9-7.5 4M12 12.5l7.5 4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2" opacity=".6" transform="translate(0 -.5)"/>`,
  filaire: `<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Zm0 9v9M4 7.5 12 12l8-4.5M12 3v9m-8 4.5L12 12l8 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  options: `<path d="M4 7h10m4 0h2M4 17h2m4 0h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
};
const icone = (nom) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${ICONES[nom]}</svg>`;

// ------------------------------------------------------------------ vue

export class Vue3D {
  // options : barre (bool, barre de styles d'affichage ; false pour un petit aperçu)
  constructor(zone, calque, { barre = true } = {}) {
    this.zone = zone;
    this.calque = calque;
    this.objets = new Map();
    this.couleurs = new Map();
    this.materiaux = new Map();
    this.traits = new Map();
    this.reperes = [];
    this.sombre = matchMedia("(prefers-color-scheme: dark)").matches;
    this.rendu = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.rendu.setPixelRatio(Math.min(devicePixelRatio, 2));
    zone.prepend(this.rendu.domElement);
    this.etiquettes = document.createElement("div");
    this.etiquettes.className = "etiquettes-3d";
    zone.append(this.etiquettes);
    this.scene = new THREE.Scene();
    try { this.environnement = environnementStudio(this.rendu); } catch { this.environnement = null; }
    this.scene.environment = this.environnement;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.camera);
    // Éclairage attaché à la caméra, comme en CAO : quel que soit l'angle de vue, la lumière principale vient
    // d'en haut à gauche, les faces tournées d'un autre côté sont plus sombres et les reliefs se lisent.
    this.ciel = new THREE.HemisphereLight(0xffffff, this.sombre ? 0x30343a : 0x8899aa, 1);
    this.ciel.position.set(0, 0, 1);
    this.scene.add(this.ciel);
    const cible = new THREE.Object3D();
    cible.position.set(0, 0, -10);
    this.camera.add(cible);
    this.principale = new THREE.DirectionalLight(0xffffff, 1);
    this.principale.position.set(-6, 8, 6);
    this.appoint = new THREE.DirectionalLight(0xffffff, 1);
    this.appoint.position.set(8, -2, 3);
    for (const l of [this.principale, this.appoint]) { l.target = cible; this.camera.add(l); }
    this.decor = new THREE.Group();
    this.scene.add(this.decor);
    this.ctl = new OrbitControls(this.camera, this.rendu.domElement);
    this.ctl.enableDamping = true;
    this.obs = new ResizeObserver(() => this.ajuster());
    this.obs.observe(zone);
    this.ajuster();
    if (barre) this.construireBarre();
    vues.add(this);
    this.appliquerAffichage();
    this.vivant = true;
    const boucle = () => {
      if (!this.vivant) return;
      if (!document.body.contains(this.rendu.domElement)) return this.detruire();
      this.ctl.update();
      this.majSilhouettes();
      this.rendu.render(this.scene, this.camera);
      this.placerEtiquettes();
      requestAnimationFrame(boucle);
    };
    boucle();
  }

  ajuster() {
    const w = this.zone.clientWidth, h = this.zone.clientHeight;
    if (!w || !h) return;
    this.rendu.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async ajouter(cle, url, type, couleur = PALETTE[0]) {
    if (this.objets.has(cle)) return this.basculer(cle, true);
    const obj = await chargerObjet(url, type);
    const mat = new THREE.MeshStandardMaterial({ color: couleur, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    obj.traverse((o) => { if (o.isMesh) o.material = mat; });
    obj.userData.cle = cle;
    this.objets.set(cle, obj);
    this.couleurs.set(cle, couleur);
    this.materiaux.set(cle, mat);
    this.scene.add(obj);
    this.appliquerAffichage();
  }

  basculer(cle, visible) {
    const o = this.objets.get(cle);
    if (o) o.visible = visible;
    const t = this.traits.get(cle);
    if (t) t.groupe.visible = visible && this.affichage?.style !== "ombre";
    this.oeil = null;   // contours de la pièce réaffichée à recalculer
  }

  visibles() {
    return [...this.objets.values()].filter((o) => o.visible);
  }

  boite() {
    const b = new THREE.Box3();
    for (const o of this.visibles()) b.expandByObject(o);
    return b;
  }

  cadrer() {
    const boite = this.boite();
    this.decor.clear();
    if (boite.isEmpty()) { this.calque.textContent = "rien à afficher"; return; }
    const taille = boite.getSize(new THREE.Vector3());
    const centre = boite.getCenter(new THREE.Vector3());
    const r = Math.max(taille.x, taille.y, taille.z) || 10;
    const pas = r > 400 ? 50 : 10;
    const etendue = Math.ceil((r * 1.6) / pas) * pas;
    const grille = new THREE.GridHelper(etendue, etendue / pas, this.sombre ? 0x555555 : 0xaaaaaa, this.sombre ? 0x333333 : 0xdddddd);
    grille.rotation.x = Math.PI / 2;
    grille.position.set(centre.x, centre.y, boite.min.z);
    this.decor.add(grille);
    const axes = new THREE.AxesHelper(r * 0.2);
    axes.position.copy(boite.min);
    this.decor.add(axes);
    this.ctl.target.copy(centre);
    this.camera.position.set(centre.x + r * 1.3, centre.y - r * 1.6, centre.z + r * 1.1);
    this.calque.textContent = `${taille.x.toFixed(1)} × ${taille.y.toFixed(1)} × ${taille.z.toFixed(1)} mm · glisser pour tourner, clic droit pour déplacer, molette pour zoomer`;
  }

  // ------------------------------------------------------------------ styles d'affichage

  appliquerAffichage() {
    const a = (this.affichage = affichageCourant());
    const c = a.contraste / 100, k = a.reflets / 100;
    // contraste : la lumière diffuse baisse, la lumière principale monte (faces opposées plus sombres)
    // (exposition dosée pour que la face la mieux éclairée ne sature pas : sinon tout est du même orange)
    this.ciel.intensity = 0.95 - 0.8 * c;
    this.principale.intensity = 0.75 + 1.0 * c;
    this.appoint.intensity = 0.45 - 0.42 * c;
    const traits = a.style !== "ombre";
    const faces = a.style === "ombre" || a.style === "ombre_aretes";
    for (const [cle, mat] of this.materiaux) {
      mat.color.set(a.couleur === "gris" ? GRIS_CAO : this.couleurs.get(cle));
      mat.roughness = 0.92 - 0.7 * k;
      mat.metalness = 0.04 + 0.12 * k;
      mat.envMapIntensity = this.environnement ? 0.15 + 1.1 * k : 0;
      // lignes cachées / filaire : la pièce n'est pas peinte ; elle remplit seulement la profondeur (pour cacher
      // les traits de l'arrière), sauf en filaire où tout se voit
      mat.colorWrite = faces;
      mat.depthWrite = a.style !== "filaire";
      mat.needsUpdate = true;
    }
    for (const cle of this.objets.keys()) {
      if (traits && !this.traits.has(cle)) this.preparerTraits(cle);
      const t = this.traits.get(cle);
      if (!t) continue;
      t.groupe.visible = traits && this.objets.get(cle).visible;
      const couleurTrait = a.style === "ombre_aretes" ? 0x15181b : this.sombre ? 0xd6e0ea : 0x1d2329;
      for (const m of [t.matVu, t.matCache]) m.color.setHex(couleurTrait);
      t.matVu.opacity = a.style === "ombre_aretes" ? 0.75 : 1;
      t.cachees.forEach((l) => (l.visible = a.style === "cachees"));
    }
    this.oeil = null;   // silhouettes à recalculer
    if (this.barre) this.majBarre();
  }

  // Arêtes vives (fixes) et contours apparents des surfaces courbes (selon l'endroit d'où on regarde).
  preparerTraits(cle) {
    const obj = this.objets.get(cle);
    let m;
    try { obj.updateMatrixWorld(true); m = preparerMaillage([obj]); } catch { return; }
    const P = m.pts;
    const vives = m.aretes.filter((e) => e.vive);
    const lisses = m.aretes.filter((e) => !e.vive && e.f2 >= 0);
    const r = Math.max(...m.boite.max.map((v, i) => v - m.boite.min[i]), 1);
    const matVu = new THREE.LineBasicMaterial({ transparent: true });
    // traits cachés : en tirets, seulement là où une face est devant (profondeur « plus loin que »)
    const matCache = new THREE.LineDashedMaterial({ dashSize: r * 0.014, gapSize: r * 0.01, transparent: true, opacity: 0.45, depthFunc: THREE.GreaterDepth, depthWrite: false });
    const segments = (n) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      g.setAttribute("lineDistance", new THREE.BufferAttribute(new Float32Array(n * 2), 1));
      return g;
    };
    const remplir = (g, liste, n = liste.length) => {
      const pos = g.attributes.position.array, dist = g.attributes.lineDistance.array;
      for (let s = 0; s < n; s++) {
        const a = P[liste[s].i], b = P[liste[s].j];
        pos.set(a, s * 6); pos.set(b, s * 6 + 3);
        dist[s * 2] = 0; dist[s * 2 + 1] = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      }
      g.setDrawRange(0, n * 2);
      g.attributes.position.needsUpdate = g.attributes.lineDistance.needsUpdate = true;
      g.computeBoundingSphere();
    };
    const gVives = segments(vives.length);
    remplir(gVives, vives);
    const gSil = segments(lisses.length);
    gSil.setDrawRange(0, 0);
    const groupe = new THREE.Group();
    const cachees = [new THREE.LineSegments(gVives, matCache), new THREE.LineSegments(gSil, matCache)];
    for (const l of [new THREE.LineSegments(gVives, matVu), new THREE.LineSegments(gSil, matVu), ...cachees]) {
      l.renderOrder = 1;
      l.frustumCulled = false;
      groupe.add(l);
    }
    this.scene.add(groupe);
    this.traits.set(cle, { groupe, matVu, matCache, cachees, P, N: m.normales, lisses, gSil, remplir, tampon: new Array(lisses.length) });
  }

  // Contour apparent : arête entre une facette tournée vers l'œil et une facette tournée de l'autre côté.
  majSilhouettes() {
    if (!this.affichage || this.affichage.style === "ombre" || !this.traits.size) return;
    const oeil = this.camera.position;
    if (this.oeil && this.oeil.distanceToSquared(oeil) < 1e-8) return;
    this.oeil = oeil.clone();
    const ex = oeil.x, ey = oeil.y, ez = oeil.z;
    for (const t of this.traits.values()) {
      if (!t.groupe.visible) continue;
      let n = 0;
      for (const e of t.lisses) {
        const p = t.P[e.i], a = t.N[e.f1], b = t.N[e.f2];
        const vx = ex - p[0], vy = ey - p[1], vz = ez - p[2];
        const s1 = a[0] * vx + a[1] * vy + a[2] * vz, s2 = b[0] * vx + b[1] * vy + b[2] * vz;
        if ((s1 > 0) !== (s2 > 0)) t.tampon[n++] = e;
      }
      t.remplir(t.gSil, t.tampon, n);
    }
  }

  // ------------------------------------------------------------------ barre d'affichage

  construireBarre() {
    const b = (this.barre = document.createElement("div"));
    b.className = "affichage-3d";
    b.innerHTML = `<div class="styles-3d" role="group" aria-label="Style d'affichage">
        ${STYLES.map(([k, l]) => `<button type="button" data-style="${k}" title="${l}" aria-label="${l}">${icone(k)}</button>`).join("")}
        <button type="button" data-options title="Couleur, contraste, reflets" aria-label="Couleur, contraste, reflets" aria-expanded="false">${icone("options")}</button>
      </div>
      <div class="panneau-affichage" hidden>
        <div class="segments" role="group" aria-label="Couleur">${COULEURS.map(([k, l, court]) => `<button type="button" data-couleur="${k}" title="${l}">${court}</button>`).join("")}</div>
        <label>Contraste des reliefs <span data-val="contraste"></span><input type="range" min="0" max="100" step="5" data-curseur="contraste"></label>
        <label>Reflets <span data-val="reflets"></span><input type="range" min="0" max="100" step="5" data-curseur="reflets"></label>
        <button type="button" class="lien" data-atelier>Revenir aux réglages de l'atelier</button>
      </div>`;
    this.zone.append(b);
    const panneau = b.querySelector(".panneau-affichage"), bouton = b.querySelector("[data-options]");
    b.querySelectorAll("[data-style]").forEach((x) => (x.onclick = () => changerAffichage({ style: x.dataset.style })));
    b.querySelectorAll("[data-couleur]").forEach((x) => (x.onclick = () => changerAffichage({ couleur: x.dataset.couleur })));
    b.querySelectorAll("[data-curseur]").forEach((x) => (x.oninput = () => changerAffichage({ [x.dataset.curseur]: +x.value })));
    b.querySelector("[data-atelier]").onclick = () => changerAffichage(null);
    bouton.onclick = () => { panneau.hidden = !panneau.hidden; bouton.setAttribute("aria-expanded", String(!panneau.hidden)); };
    // un glisser sur la barre ne fait pas tourner la pièce
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  majBarre() {
    const a = this.affichage, b = this.barre;
    b.querySelectorAll("[data-style]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.style === a.style)));
    b.querySelectorAll("[data-couleur]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.couleur === a.couleur)));
    for (const k of ["contraste", "reflets"]) {
      const c = b.querySelector(`[data-curseur="${k}"]`);
      if (document.activeElement !== c) c.value = a[k];
      b.querySelector(`[data-val="${k}"]`).textContent = `${a[k]} %`;
    }
  }

  // ------------------------------------------------------------------ repères
  definirReperes(liste) {
    this.reperes = liste || [];
    this.etiquettes.innerHTML = this.reperes.map((r) => `<span class="repere" title="${String(r.texte).replace(/"/g, "&quot;")}">${r.n}</span>`).join("");
  }

  placerEtiquettes() {
    const w = this.zone.clientWidth, h = this.zone.clientHeight;
    const v = new THREE.Vector3();
    [...this.etiquettes.children].forEach((el, i) => {
      const r = this.reperes[i];
      v.set(...r.pos).project(this.camera);
      const dehors = v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      el.style.display = dehors ? "none" : "";
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    });
  }

  // mode pose : un clic (sans glisser) sur la pièce renvoie le point 3D touché
  activerPose(surPoint) {
    const el = this.rendu.domElement;
    el.style.cursor = surPoint ? "crosshair" : "";
    if (this._bas) el.removeEventListener("pointerdown", this._bas);
    if (this._haut) el.removeEventListener("pointerup", this._haut);
    this._bas = this._haut = null;
    if (!surPoint) return;
    let depart = null;
    this._bas = (e) => (depart = [e.clientX, e.clientY]);
    this._haut = (e) => {
      if (!depart || Math.hypot(e.clientX - depart[0], e.clientY - depart[1]) > 4) return; // c'était une rotation
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const touche = ray.intersectObjects(this.visibles(), true)[0];
      if (touche) surPoint(touche.point.toArray().map((x) => Math.round(x * 100) / 100));
    };
    el.addEventListener("pointerdown", this._bas);
    el.addEventListener("pointerup", this._haut);
  }

  detruire() {
    this.vivant = false;
    vues.delete(this);
    this.obs.disconnect();
    this.ctl.dispose();
    this.environnement?.dispose();
    this.rendu.dispose();
  }
}
