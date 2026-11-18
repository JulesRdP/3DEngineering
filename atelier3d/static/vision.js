// Visionneuse 3D (three.js) : une ou plusieurs pièces, axe Z vers le haut comme dans les trancheurs,
// repères numérotés posés en cliquant sur la pièce.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";

export const PALETTE = [0xe0661b, 0x2f6fb0, 0x2f8a4c, 0x9b59b6, 0xc08a12, 0x16a3a3, 0xc2392f, 0x7f8c8d];

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
      return new ThreeMFLoader().parse(donnees);
    })());
  }
  return (await cache.get(url)).clone();
}

export class Vue3D {
  constructor(zone, calque) {
    this.zone = zone;
    this.calque = calque;
    this.objets = new Map();
    this.reperes = [];
    this.sombre = matchMedia("(prefers-color-scheme: dark)").matches;
    this.rendu = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.rendu.setPixelRatio(Math.min(devicePixelRatio, 2));
    zone.prepend(this.rendu.domElement);
    this.etiquettes = document.createElement("div");
    this.etiquettes.className = "etiquettes-3d";
    zone.append(this.etiquettes);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    this.camera.up.set(0, 0, 1);
    this.scene.add(new THREE.HemisphereLight(0xffffff, this.sombre ? 0x222222 : 0x8899aa, 1.6));
    const soleil = new THREE.DirectionalLight(0xffffff, 1.6);
    soleil.position.set(1, -1.5, 2);
    this.scene.add(soleil);
    this.decor = new THREE.Group();
    this.scene.add(this.decor);
    this.ctl = new OrbitControls(this.camera, this.rendu.domElement);
    this.ctl.enableDamping = true;
    this.obs = new ResizeObserver(() => this.ajuster());
    this.obs.observe(zone);
    this.ajuster();
    this.vivant = true;
    const boucle = () => {
      if (!this.vivant) return;
      if (!document.body.contains(this.rendu.domElement)) return this.detruire();
      this.ctl.update();
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
    const mat = new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.55, metalness: 0.05 });
    obj.traverse((o) => { if (o.isMesh) o.material = mat; });
    obj.userData.cle = cle;
    this.objets.set(cle, obj);
    this.scene.add(obj);
  }

  basculer(cle, visible) {
    const o = this.objets.get(cle);
    if (o) o.visible = visible;
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

  // ---- repères
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
    this.obs.disconnect();
    this.ctl.dispose();
    this.rendu.dispose();
  }
}
