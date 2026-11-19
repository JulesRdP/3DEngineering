// Pièce 3D posée sous une vue du plan. Elle sort de l'aperçu 3D (dans l'orientation où on l'y a laissée),
// fait un tour complet en vol et se pose exactement sous le dessin de la vue : même direction de regard,
// même échelle, même position sur la feuille ; les traits du plan restent par-dessus. Pour une coupe, la
// pièce est coupée par le plan de coupe. Au bout du délai réglé (ou au second clic), elle retourne dans l'aperçu.
//
// Vue (plan.js, feuille.infos.vues) : un point p de la pièce est dessiné en X = ox + (p·r)·s, Y = oy − (p·u)·s
// (mm sur la feuille), en regardant selon f. Sur l'écran, avec le zoom z (px/mm) : X·z, Y·z depuis le coin de
// la feuille. Le vol se dessine dans une couche qui couvre la visionneuse, en pixels ; la pose finale y vaut
//   M1 = T(P1) · R1 · S(k1) · T(−c)   avec R1 de lignes (r, u, −f), k1 = s·z, c = centre de la pièce.
import * as THREE from "three";

const IDENTITE = new THREE.Quaternion();
const adoucir = (t) => 1 - (1 - t) ** 3;
const adoucir2 = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const HAUT_ECRAN = new THREE.Vector3(0, 1, 0);

function materiau(couleur) {
  return new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.45, metalness: 0.1, transparent: true, opacity: 0, side: THREE.DoubleSide });
}

function eclairer(scene) {
  const ciel = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.5);
  const soleil = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(ciel, soleil, soleil.target);
  return { ciel, soleil };
}

export class ApparitionPiece {
  // options : dureeVol (ms), tour (bool), effacement (ms, 0 = jamais), opacite (0–1), duree (ms, apparition sur
  // place quand il n'y a pas d'aperçu), source () => { rect, camera, objet } | null (l'aperçu 3D, s'il est ouvert)
  constructor(visionneuse, objets, options = {}) {
    this.vis = visionneuse;
    this.o = { dureeVol: 1600, tour: true, effacement: 0, opacite: 0.82, duree: 900, couleur: 0xe0661b, source: null, ...options };
    // --- couche posée dans la feuille (pièce à sa place, suit le zoom et le défilement)
    this.rendu = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.rendu.localClippingEnabled = true;
    this.rendu.setClearColor(0x000000, 0);
    this.toile = this.rendu.domElement;
    this.toile.className = "vis-3d";
    this.scene = new THREE.Scene();
    this.lum = eclairer(this.scene);
    this.mat = materiau(this.o.couleur);
    const boite = new THREE.Box3();
    for (const o of objets) { o.updateMatrixWorld(true); boite.expandByObject(o); }
    this.centre = boite.getCenter(new THREE.Vector3());
    this.rayon = boite.getSize(new THREE.Vector3()).length() / 2 || 10;
    // la pièce tourne autour de son centre : pivot au centre, maillages décalés d'autant
    this.pivot = new THREE.Group();
    this.pivot.position.copy(this.centre);
    // --- couche de vol (toute la visionneuse, en pixels)
    this.matVol = materiau(this.o.couleur);
    this.groupeVol = new THREE.Group();
    this.groupeVol.matrixAutoUpdate = false;
    for (const o of objets) {
      o.traverse((m) => {
        if (!m.isMesh) return;
        const c = new THREE.Mesh(m.geometry, this.mat);
        c.applyMatrix4(m.matrixWorld);
        c.position.sub(this.centre);
        this.pivot.add(c);
        const v = new THREE.Mesh(m.geometry, this.matVol);
        v.applyMatrix4(m.matrixWorld);
        this.groupeVol.add(v);
      });
    }
    this.scene.add(this.pivot);
    this.camera = new THREE.OrthographicCamera();
    this.vue = null;
    this.t = 0;
  }

  regler(options) { Object.assign(this.o, options); }

  // ------------------------------------------------------------------ montrer / cacher

  // Montre la pièce sous cette vue (un second clic sur la même vue la renvoie).
  montrer(vue) {
    clearTimeout(this.minuteur);
    if (this.vue && this.vue.nom === vue.nom && this.vue.rect.x === vue.rect.x && !this.enVol) return this.cacher();
    this.arreter();
    this.toile.remove();
    this.vue = vue;
    this.calerCamera(vue);
    const src = this.o.source?.();
    if (src && this.o.dureeVol > 0) {
      this.voler(vue, src, 1, () => this.poserEnPlace());
    } else {
      if (!this.toile.parentNode) this.vis.feuille.append(this.toile);
      this.t = 0;
      this.placer();
      this.animer(1, () => this.apresPose());
    }
  }

  cacher() {
    clearTimeout(this.minuteur);
    if (!this.vue) return;
    const src = this.o.source?.();
    if (src && this.o.dureeVol > 0) {
      const vue = this.vue;
      this.arreter();
      this.toile.remove();
      this.voler(vue, src, -1, () => this.retirer());
    } else this.animer(-1, () => this.retirer());
  }

  // retrait immédiat (changement de feuille, nouveau plan) ; la pièce de l'aperçu réapparaît
  retirer() {
    this.arreter();
    clearTimeout(this.minuteur);
    this.toile.remove();
    this.vol?.remove();
    const objet = this.o.source?.()?.objet || this.objetCache;
    if (objet) objet.visible = true;
    this.vue = null;
    this.t = 0;
  }

  arreter() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.secours);
    this.enVol = false;
  }

  // Boucle d'animation : une image par rafraîchissement d'écran. Si le navigateur n'en donne pas (onglet en
  // arrière-plan…), une minuterie termine l'animation à l'heure prévue : la pièce ne reste jamais figée en vol.
  boucle(duree, image, fin) {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.secours);
    const debut = performance.now();
    let termine = false;
    const pas = (forcer) => {
      if (termine) return;
      const t = forcer || duree <= 0 ? 1 : Math.min(1, (performance.now() - debut) / duree);
      image(t);
      if (t < 1) { this.raf = requestAnimationFrame(() => pas(false)); return; }
      termine = true;
      cancelAnimationFrame(this.raf);
      clearTimeout(this.secours);
      fin?.();
    };
    this.secours = setTimeout(() => pas(true), duree + 60);
    pas(false);
  }

  apresPose() {
    clearTimeout(this.minuteur);
    if (this.o.effacement > 0) this.minuteur = setTimeout(() => this.cacher(), this.o.effacement);
  }

  poserEnPlace() {
    this.vol?.remove();
    this.vis.feuille.append(this.toile);
    this.t = 1;
    this.poser(1);
    this.placer();
    this.apresPose();
  }

  // ------------------------------------------------------------------ pièce posée dans la feuille

  calerCamera(vue) {
    const [f, u, r] = [vue.f, vue.u, vue.r].map((a) => new THREE.Vector3(...a));
    // couche posée sur la vue, avec de la marge pour la rotation d'apparition sur place
    const m = Math.max(vue.rect.w, vue.rect.h) * 0.3 + 10;
    const z = (this.zoneMm = { x: vue.rect.x - m, y: vue.rect.y - m, w: vue.rect.w + 2 * m, h: vue.rect.h + 2 * m });
    // repère écran x = (p − c)·r, y = (p − c)·u ; le centre c tombe en (Xc, Yc) sur la feuille
    const c = this.centre;
    const Xc = vue.ox + c.dot(r) * vue.s, Yc = vue.oy - c.dot(u) * vue.s;
    Object.assign(this.camera, {
      left: (z.x - Xc) / vue.s, right: (z.x + z.w - Xc) / vue.s, top: (Yc - z.y) / vue.s, bottom: (Yc - z.y - z.h) / vue.s,
      near: 0.1, far: this.rayon * 40 + 200,
    });
    this.camera.position.copy(c).addScaledVector(f, -(this.rayon * 20 + 100));
    this.camera.up.copy(u);
    this.camera.lookAt(c);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // lumière venant de l'observateur, un peu d'en haut à gauche (comme pendant le vol)
    this.lum.soleil.position.copy(c).addScaledVector(f, -4).addScaledVector(u, 2).addScaledVector(r, -1.5);
    this.lum.soleil.target.position.copy(c);
    this.lum.ciel.position.copy(u);
    this.mat.clippingPlanes = vue.coupe ? [new THREE.Plane(new THREE.Vector3(...vue.coupe.n), -vue.coupe.c)] : [];
    this.mat.needsUpdate = true;
    // apparition sur place (sans aperçu) : de trois-quarts, puis rotation jusqu'à la vue
    this.q0 = new THREE.Quaternion().setFromAxisAngle(u, -0.95).multiply(new THREE.Quaternion().setFromAxisAngle(r, 0.65));
    this.axeTour = u;
  }

  // (re)cale la couche sur la feuille après un zoom
  placer() {
    if (!this.vue || this.enVol) return;
    this.vis.placerCalque(this.toile, this.zoneMm);
    const z = this.vis.etat.zoom, w = this.zoneMm.w * z, h = this.zoneMm.h * z;
    this.rendu.setPixelRatio(Math.min(devicePixelRatio || 1, 4096 / Math.max(w, h, 1)));
    this.rendu.setSize(w, h, false);
    this.dessiner();
  }

  poser(t) {
    const e = adoucir(t);
    this.pivot.quaternion.slerpQuaternions(this.q0, IDENTITE, e);
    if (this.o.tour) this.pivot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.axeTour, 2 * Math.PI * e));
    this.pivot.scale.setScalar(1 + 0.18 * (1 - e));
    this.mat.opacity = this.o.opacite * Math.min(1, t * 1.8);
  }

  animer(sens, fin) {
    const depart = this.t, reste = sens > 0 ? 1 - depart : depart;
    this.boucle(this.o.duree * reste, (a) => {
      this.t = sens > 0 ? depart + a * reste : depart - a * reste;
      this.poser(this.t);
      this.dessiner();
    }, fin);
  }

  dessiner() {
    if (this.vue) this.rendu.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ vol entre l'aperçu et la vue

  // Pose de la pièce dans la couche de vol (pixels, origine = coin haut-gauche de la visionneuse, y vers le haut
  // négatif) pour l'avancement e : 0 = comme dans l'aperçu, 1 = exactement sous la vue.
  poseVol(vue, src, e) {
    const Z = this.vis.zone.getBoundingClientRect(), Fe = this.vis.feuille.getBoundingClientRect(), z = this.vis.etat.zoom;
    const c = this.centre;
    const [f, u, r] = [vue.f, vue.u, vue.r].map((a) => new THREE.Vector3(...a));
    // arrivée
    const k1 = vue.s * z;
    const a = Fe.left - Z.left + vue.ox * z, b = Fe.top - Z.top + vue.oy * z;
    const P1 = new THREE.Vector3(a + k1 * c.dot(r), -(b - k1 * c.dot(u)), 0);
    const q1 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(r.x, r.y, r.z, 0, u.x, u.y, u.z, 0, -f.x, -f.y, -f.z, 0, 0, 0, 0, 1));
    // départ : la pièce telle que la montre l'aperçu (orientation de sa caméra, taille apparente, position)
    const R = src.rect, cam = src.camera;
    cam.updateMatrixWorld();
    const q0 = cam.quaternion.clone().invert();
    const ndc = c.clone().project(cam);
    const P0 = new THREE.Vector3(R.left - Z.left + ((ndc.x + 1) / 2) * R.width, -(R.top - Z.top + ((1 - ndc.y) / 2) * R.height), 0);
    const avant = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const dist = Math.max(1e-3, c.clone().sub(cam.position).dot(avant));
    const k0 = cam.isPerspectiveCamera ? R.height / (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) : R.height / (cam.top - cam.bottom);
    // interpolation : trajectoire en arc, échelle géométrique, rotation + tour complet autour de la verticale
    const q = new THREE.Quaternion().slerpQuaternions(q0, q1, e);
    if (this.o.tour) q.premultiply(new THREE.Quaternion().setFromAxisAngle(HAUT_ECRAN, 2 * Math.PI * e));
    const k = k0 * (k1 / k0) ** e;
    const P = P0.clone().lerp(P1, e);
    P.y += Math.sin(Math.PI * e) * 0.25 * P0.distanceTo(P1);
    return new THREE.Matrix4().makeTranslation(P.x, P.y, P.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeScale(k, k, k))
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  }

  preparerVol() {
    if (this.vol) return;
    this.renduVol = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renduVol.localClippingEnabled = true;
    this.renduVol.setClearColor(0x000000, 0);
    this.vol = this.renduVol.domElement;
    this.vol.className = "vis-vol";
    this.sceneVol = new THREE.Scene();
    const { ciel, soleil } = eclairer(this.sceneVol);
    ciel.position.set(0, 1, 0);
    soleil.position.set(-1.5, 2, 4);
    this.sceneVol.add(this.groupeVol);
    this.cameraVol = new THREE.OrthographicCamera(0, 1, 0, -1, -1e6, 1e6);
  }

  voler(vue, src, sens, fin) {
    this.preparerVol();
    if (!this.vol.parentNode) this.vis.zone.append(this.vol);
    this.objetCache = src.objet;
    if (src.objet) src.objet.visible = false;     // la pièce quitte l'aperçu
    const planCoupe = vue.coupe ? new THREE.Plane(new THREE.Vector3(...vue.coupe.n), -vue.coupe.c) : null;
    this.matVol.clippingPlanes = planCoupe ? [planCoupe.clone()] : [];
    this.matVol.needsUpdate = true;   // le nombre de plans de coupe change le shader
    this.enVol = true;
    this.boucle(this.o.dureeVol, (t) => {
      const W = this.vis.zone.clientWidth, H = this.vis.zone.clientHeight;
      if (this.vol.width !== Math.round(W * (devicePixelRatio || 1))) {
        this.renduVol.setPixelRatio(devicePixelRatio || 1);
        this.renduVol.setSize(W, H, false);
        Object.assign(this.cameraVol, { left: 0, right: W, top: 0, bottom: -H });
        this.cameraVol.updateProjectionMatrix();
      }
      const e = adoucir2(sens > 0 ? t : 1 - t);
      const M = this.poseVol(vue, src, e);
      this.groupeVol.matrix.copy(M);
      this.groupeVol.matrixWorldNeedsUpdate = true;
      this.matVol.clippingPlanes = planCoupe ? [planCoupe.clone().applyMatrix4(M)] : [];
      this.matVol.opacity = 1 + (this.o.opacite - 1) * e;
      this.renduVol.render(this.sceneVol, this.cameraVol);
    }, () => {
      this.enVol = false;
      if (sens < 0 && src.objet) src.objet.visible = true;   // retour dans l'aperçu
      fin?.();
    });
  }

  detruire() {
    this.retirer();
    this.rendu.dispose();
    this.renduVol?.dispose();
  }
}
