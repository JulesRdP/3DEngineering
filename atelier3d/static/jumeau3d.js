// Jumeau 3D d'une imprimante, tout en traits (arêtes de la CAO, outils/step_en_traits.py), façon écran de contrôle.
// La pièce en cours se construit sur le plateau à la hauteur atteinte ; la tête, l'axe X et le plateau bougent
// pendant l'impression. Repère du modèle : y vers le haut, plateau qui avance et recule sur z, tête sur x.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { chargerObjet } from "/static/vision.js";

const COULEUR_TRAITS = 0x6fd6ff;
const COULEUR_PIECE = 0xff8a3d;

const cacheTraits = new Map();
const chargerTraits = (url) => {
  if (!cacheTraits.has(url)) cacheTraits.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error("modèle 3D absent"); return r.json(); }));
  return cacheTraits.get(url);
};

function segments(liste, materiau) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(liste), 3));
  return new THREE.LineSegments(geo, materiau);
}

const lisser = (actuel, cible, dt, vitesse = 4) => actuel + (cible - actuel) * Math.min(1, dt * vitesse);

export class JumeauImprimante {
  static async creer(conteneur, urlTraits) {
    const donnees = await chargerTraits(urlTraits);
    return new JumeauImprimante(conteneur, donnees);
  }

  constructor(conteneur, d) {
    this.conteneur = conteneur;
    this.d = d;
    this.etat = {};
    this.h = 60;              // hauteur de la buse au-dessus de la plaque (mm), lissée
    this.pos = { x: 0, z: 0 }; // point de la plaque sous la buse (par rapport au centre de la plaque), lissé
    this.t = 0;

    const r = (this.rendu = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    r.localClippingEnabled = true;
    conteneur.append(r.domElement);
    const scene = (this.scene = new THREE.Scene());

    const mat = (opacite, couleur = COULEUR_TRAITS) => new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: opacite,
      blending: THREE.AdditiveBlending, depthWrite: false });
    this.mats = { vives: mat(0.8), douces: mat(0.22) };
    this.groupes = {};
    for (const g of ["fixe", "plateau", "portique", "tete"]) scene.add((this.groupes[g] = new THREE.Group()));
    for (const p of d.pieces) {
      const g = this.groupes[p.groupe] || this.groupes.fixe;
      if (p.vives.length) g.add(segments(p.vives, this.mats.vives));
      if (p.douces.length) g.add(segments(p.douces, this.mats.douces));
    }

    // boîte de la machine (au repos) : sol, caméra, grille
    const boite = new THREE.Box3().setFromObject(scene);
    const taille = boite.getSize(new THREE.Vector3()), centre = boite.getCenter(new THREE.Vector3());
    const grille = new THREE.GridHelper(Math.max(taille.x, taille.z) * 2.2, 22, COULEUR_TRAITS, COULEUR_TRAITS);
    grille.material.transparent = true; grille.material.opacity = 0.07; grille.material.depthWrite = false;
    grille.position.set(centre.x, boite.min.y, centre.z);
    scene.add(grille);

    // lueur de la buse (chaude)
    const tex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,170,90,1)"); gr.addColorStop(0.35, "rgba(255,110,40,.55)"); gr.addColorStop(1, "rgba(255,90,20,0)");
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.lueur = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.lueur.scale.setScalar(26);
    this.lueur.position.set(...d.buse);
    this.groupes.tete.add(this.lueur);

    // pièce imprimée : posée au centre de la plaque, suit le plateau
    this.support = new THREE.Group();
    this.support.position.set(d.plaque.centre[0], d.plaque.haut, d.plaque.centre[2]);
    this.groupes.plateau.add(this.support);
    this.coupe = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    this.matPiece = new THREE.LineBasicMaterial({ color: COULEUR_PIECE, transparent: true, opacity: 0.95, clippingPlanes: [this.coupe] });
    this.matFantome = new THREE.LineBasicMaterial({ color: COULEUR_PIECE, transparent: true, opacity: 0.13, depthWrite: false });
    this.matCouche = new THREE.LineBasicMaterial({ color: 0xffd2a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    this.empreinte = { x: 0, z: 0, ax: 15, az: 15, hauteur: 0 };

    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
    const dist = taille.length() * 1.2;
    this.camera.position.set(centre.x + dist * 0.45, centre.y + dist * 0.42, centre.z + dist * 0.78);
    this.controles = new OrbitControls(this.camera, r.domElement);
    this.controles.target.copy(centre).setY(centre.y * 0.75);
    this.controles.enableDamping = true;
    this.controles.autoRotate = true;
    this.controles.autoRotateSpeed = 0.35;
    this.controles.addEventListener("start", () => (this.controles.autoRotate = false));
    this.controles.update();

    this.hud = document.createElement("div");
    this.hud.className = "jumeau-hud";
    conteneur.append(this.hud);

    this.taille = new ResizeObserver(() => this._dimensionner());
    this.taille.observe(conteneur);
    this._dimensionner();
    this.horloge = performance.now();
    const boucle = () => {
      if (!this.conteneur.isConnected) return this.detruire();
      this._animer();
      this.rendu.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(boucle);
    };
    boucle();
  }

  _dimensionner() {
    const { clientWidth: l, clientHeight: h } = this.conteneur;
    if (!l || !h) return;
    this.rendu.setSize(l, h, false);
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
  }

  // État en direct (pilote) : etat, progression, couche, couches, temp_buse. hauteurPiece : hauteur réelle connue.
  maj(etat = {}) { this.etat = etat || {}; }

  // Pièce en cours d'impression (STL / 3MF de l'atelier), ou null.
  async piece(url, type) {
    if (url === this.urlPiece) return;
    this.urlPiece = url;
    this.support.clear();
    if (!url) return;
    let objet;
    try { objet = await chargerObjet(url, type); } catch { return; }
    if (url !== this.urlPiece) return;
    objet.updateMatrixWorld(true);
    const brut = [];
    objet.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      geo.rotateX(-Math.PI / 2); // CAO z vers le haut → y vers le haut
      brut.push(geo);
    });
    if (!brut.length) return;
    const boite = new THREE.Box3();
    for (const g of brut) { g.computeBoundingBox(); boite.union(g.boundingBox); }
    const c = boite.getCenter(new THREE.Vector3());
    const groupe = new THREE.Group();
    for (const g of brut) {
      g.translate(-c.x, -boite.min.y, -c.z);
      const aretes = new THREE.EdgesGeometry(g, 25);
      groupe.add(new THREE.LineSegments(aretes, this.matFantome), new THREE.LineSegments(aretes, this.matPiece));
    }
    const t = boite.getSize(new THREE.Vector3());
    this.empreinte = { x: 0, z: 0, ax: Math.max(4, t.x / 2), az: Math.max(4, t.z / 2), hauteur: t.y };
    // contour de la couche en cours : un cadre lumineux à la hauteur atteinte
    const cadre = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(t.x + 2, 0.01, t.z + 2)), this.matCouche);
    this.cadreCouche = cadre;
    groupe.add(cadre);
    this.support.add(groupe);
  }

  _animer() {
    const maintenant = performance.now(), dt = Math.min(0.1, (maintenant - this.horloge) / 1000);
    this.horloge = maintenant;
    const e = this.etat, d = this.d;
    const imprime = e.etat === "impression", enPause = e.etat === "pause";
    const actif = imprime || enPause || e.etat === "preparation";
    const p = Math.max(0, Math.min(100, Number(e.progression) || 0)) / 100;
    const hPiece = this.empreinte.hauteur || (e.couches ? e.couches * 0.2 : 30);
    const hAtteinte = e.etat === "terminee" ? hPiece : actif ? (this.empreinte.hauteur ? hPiece * p : (Number(e.couche) || 0) * 0.2) : 0;

    // trajectoire : la buse balaie l'empreinte de la pièce à la hauteur atteinte (figure de Lissajous)
    if (imprime) this.t += dt;
    let cibleX = 0, cibleZ = 0, cibleH = Math.max(hAtteinte + 0.3, 0.3);
    if (imprime) {
      cibleX = this.empreinte.x + this.empreinte.ax * Math.sin(this.t * 2.3);
      cibleZ = this.empreinte.z + this.empreinte.az * Math.sin(this.t * 1.7 + 0.8);
    } else if (!enPause) {
      cibleH = Math.max(hAtteinte + 25, 60);   // au repos : buse relevée, tête et plateau au centre
    }
    if (!enPause) {
      const v = imprime ? 9 : 2.5;
      this.pos.x = lisser(this.pos.x, cibleX, dt, v);
      this.pos.z = lisser(this.pos.z, cibleZ, dt, v);
      this.h = lisser(this.h, cibleH, dt, imprime ? 6 : 1.5);
    }
    const dy = d.plaque.haut + this.h - d.buse[1];
    this.groupes.portique.position.y = dy;
    this.groupes.tete.position.set(d.plaque.centre[0] + this.pos.x - d.buse[0], dy, 0);
    this.groupes.plateau.position.z = d.buse[2] - d.plaque.centre[2] - this.pos.z;
    this.coupe.constant = d.plaque.haut + hAtteinte;       // plan de coupe en coordonnées du monde (y)
    if (this.cadreCouche) { this.cadreCouche.position.y = hAtteinte; this.cadreCouche.visible = actif && hAtteinte > 0.05; }

    const chaude = (Number(e.temp_buse) || 0) > 60 || imprime;
    this.lueur.visible = chaude;
    if (chaude) this.lueur.material.opacity = 0.65 + 0.3 * Math.sin(maintenant / 260);
    this.mats.vives.opacity = actif ? 0.85 : 0.6;

    const hud = [`Z ${(actif || e.etat === "terminee" ? hAtteinte : 0).toFixed(2)} mm`];
    if (e.couches) hud.push(`couche ${e.couche ?? 0} / ${e.couches}`);
    if (e.temp_buse !== undefined) hud.push(`buse ${Math.round(e.temp_buse)} °C`, `plateau ${Math.round(e.temp_plateau)} °C`);
    const texte = hud.join("   ·   ");
    if (this.hud.textContent !== texte) this.hud.textContent = texte;
    this.controles.update();
  }

  detruire() {
    cancelAnimationFrame(this.raf);
    this.taille.disconnect();
    this.controles.dispose();
    this.scene.traverse((o) => o.geometry?.dispose());
    this.rendu.dispose();
  }
}
