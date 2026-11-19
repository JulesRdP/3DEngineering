// Visionneuse du plan : aperçu SVG net à tout zoom, zoom à la molette autour du curseur, déplacement en
// glissant, double-clic pour recadrer, plein écran, panneau d'aperçu 3D repliable à droite. Les vues du plan
// sont cliquables (surVue) : l'appli y pose la pièce en 3D (apparition3d.js), dans une couche placée sous les
// traits du dessin (.vis-3d) ; le vol depuis l'aperçu se dessine dans une couche qui couvre tout (.vis-vol).

// Zoom de facteur f autour du point (px, py) du cadre : ce point reste sous le curseur.
// État : zoom en px par mm, sx / sy = défilement du cadre en px.
export function zoomAutour({ zoom, sx, sy }, f, [px, py], [zmin, zmax]) {
  const z = Math.min(zmax, Math.max(zmin, zoom * f));
  const k = z / zoom;
  return { zoom: z, sx: (sx + px) * k - px, sy: (sy + py) * k - py };
}

// Vue du plan sous un point de la feuille (en mm), avec une marge pour attraper facilement les petites vues.
export function vueSous(vues, [x, y], marge = 4) {
  const dedans = (vues || []).filter(({ rect: r }) => x >= r.x - marge && x <= r.x + r.w + marge && y >= r.y - marge && y <= r.y + r.h + marge);
  // la plus petite qui contient le point (les marges peuvent se recouvrir)
  return dedans.sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0] || null;
}

export class VisionneusePlan {
  constructor(zone, { apercuOuvert = true, feuilleSombre = true } = {}) {
    this.zone = zone;
    this.surVue = null;      // (vue | null) => …  : clic sur une vue (ou à côté)
    this.surZoom = null;     // () => …            : la feuille a changé de taille à l'écran
    this.surApercu = null;   // (ouvert) => …      : panneau d'aperçu 3D ouvert / replié
    zone.classList.add("visionneuse");
    zone.classList.toggle("feuille-sombre", feuilleSombre);   // traits clairs, sans fond (réglage)
    zone.innerHTML = `<div class="vis-barre">
        <button class="btn petit" data-vis="moins" title="Zoom arrière">−</button>
        <span class="vis-zoom"></span>
        <button class="btn petit" data-vis="plus" title="Zoom avant">+</button>
        <button class="btn petit" data-vis="ajuster" title="Voir toute la feuille (ou double-clic)">Ajuster</button>
        <button class="btn petit" data-vis="ecran" title="Plein écran (Échap pour sortir)">Plein écran</button>
        <button class="btn petit" data-vis="apercu" title="Afficher / replier l'aperçu 3D">Aperçu 3D</button>
        <span class="sous">molette : zoom · glisser : déplacer · clic sur une vue : la pièce en 3D</span>
      </div>
      <div class="vis-corps">
        <div class="vis-cadre"><div class="vis-feuille"><div class="vis-survol" hidden><span>3D</span></div></div></div>
        <aside class="vis-apercu"><div class="vis-apercu-titre">Aperçu 3D <span class="sous">glisser : tourner · molette : zoom</span></div><div class="vis-apercu-3d"></div></aside>
      </div>`;
    this.cadre = zone.querySelector(".vis-cadre");
    this.feuille = zone.querySelector(".vis-feuille");
    this.survol = zone.querySelector(".vis-survol");
    this.apercu = zone.querySelector(".vis-apercu-3d");
    this.etat = { zoom: 1, sx: 0, sy: 0 };
    this.basculerApercu(apercuOuvert, false);
    this.cadre.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = this.cadre.getBoundingClientRect();
      this.zoomer(Math.exp(-e.deltaY * 0.0015), [e.clientX - r.left, e.clientY - r.top]);
    }, { passive: false });
    let prise = null;
    this.cadre.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      prise = { x: e.clientX, y: e.clientY, sx: this.cadre.scrollLeft, sy: this.cadre.scrollTop, bouge: false };
      this.cadre.setPointerCapture?.(e.pointerId);
    });
    this.cadre.addEventListener("pointermove", (e) => {
      if (!prise) return this.survoler(e);
      if (Math.hypot(e.clientX - prise.x, e.clientY - prise.y) > 4) { prise.bouge = true; this.cadre.classList.add("prise"); }
      this.cadre.scrollLeft = prise.sx - (e.clientX - prise.x);
      this.cadre.scrollTop = prise.sy - (e.clientY - prise.y);
    });
    this.cadre.addEventListener("pointerup", (e) => {
      const clic = prise && !prise.bouge;
      prise = null;
      this.cadre.classList.remove("prise");
      if (clic) this.surVue?.(vueSous(this.vues, this.versMm(e)));
    });
    this.cadre.addEventListener("pointercancel", () => { prise = null; this.cadre.classList.remove("prise"); });
    this.cadre.addEventListener("pointerleave", () => (this.survol.hidden = true));
    this.cadre.addEventListener("dblclick", () => this.ajuster());
    this.cadre.addEventListener("scroll", () => this.surZoom?.());
    zone.querySelector('[data-vis="plus"]').onclick = () => this.zoomer(1.25);
    zone.querySelector('[data-vis="moins"]').onclick = () => this.zoomer(0.8);
    zone.querySelector('[data-vis="ajuster"]').onclick = () => this.ajuster();
    zone.querySelector('[data-vis="apercu"]').onclick = () => this.basculerApercu(!this.apercuOuvert);
    zone.querySelector('[data-vis="ecran"]').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : zone.requestFullscreen?.());
    document.addEventListener("fullscreenchange", () => {
      if (!document.body.contains(zone)) return;
      zone.querySelector('[data-vis="ecran"]').textContent = document.fullscreenElement === zone ? "Quitter le plein écran" : "Plein écran";
      requestAnimationFrame(() => this.ajuster());
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.contains(zone) && !document.fullscreenElement) this.surVue?.(null); });
  }

  basculerApercu(ouvert, prevenir = true) {
    this.apercuOuvert = ouvert;
    this.zone.classList.toggle("avec-apercu", ouvert);
    this.zone.querySelector('[data-vis="apercu"]').classList.toggle("prim", ouvert);
    if (prevenir) {
      this.surApercu?.(ouvert);
      requestAnimationFrame(() => this.ajuster());
    }
  }

  // point de la feuille (mm) sous un événement souris
  versMm(e) {
    const r = this.feuille.getBoundingClientRect();
    return [(e.clientX - r.left) / this.etat.zoom, (e.clientY - r.top) / this.etat.zoom];
  }

  survoler(e) {
    const v = vueSous(this.vues, this.versMm(e));
    this.survol.hidden = !v;
    this.cadre.classList.toggle("sur-vue", !!v);
    if (v) this.placerCalque(this.survol, v.rect, 2);
  }

  // place un élément HTML de la couche « feuille » sur un rectangle en mm
  placerCalque(el, r, marge = 0) {
    const z = this.etat.zoom;
    Object.assign(el.style, { left: `${(r.x - marge) * z}px`, top: `${(r.y - marge) * z}px`, width: `${(r.w + 2 * marge) * z}px`, height: `${(r.h + 2 * marge) * z}px` });
  }

  montrer(svg, largeurMm, hauteurMm, vues = []) {
    this.mm = [largeurMm, hauteurMm];
    this.vues = vues;
    // hors plein écran, le cadre prend les proportions de la feuille (pas de grand vide gris)
    if (!document.fullscreenElement) this.cadre.style.height = `${Math.round(Math.min(innerHeight * 0.8, this.cadre.clientWidth * (hauteurMm / largeurMm)) + 4)}px`;
    this.svg?.remove();
    this.feuille.insertAdjacentHTML("beforeend", svg);
    this.svg = this.feuille.querySelector("svg");
    this.survol.hidden = true;
    this.ajuster();
  }

  bornes() {
    const fit = Math.min(this.cadre.clientWidth / this.mm[0], this.cadre.clientHeight / this.mm[1]) || 1;
    return [fit * 0.5, 40];
  }

  ajuster() {
    if (!this.svg) return;
    // taille extérieure du cadre : la même avec ou sans barres de défilement (la feuille ajustée n'en a pas)
    const fit = Math.min((this.cadre.offsetWidth - 6) / this.mm[0], (this.cadre.offsetHeight - 6) / this.mm[1]) || 1;
    this.appliquer({ zoom: fit, sx: 0, sy: 0 });
  }

  zoomer(f, point) {
    if (!this.svg) return;
    const centre = point || [this.cadre.clientWidth / 2, this.cadre.clientHeight / 2];
    this.appliquer(zoomAutour({ zoom: this.etat.zoom, sx: this.cadre.scrollLeft, sy: this.cadre.scrollTop }, f, centre, this.bornes()));
  }

  appliquer(etat) {
    this.etat = etat;
    const [w, h] = [this.mm[0] * etat.zoom, this.mm[1] * etat.zoom];
    this.feuille.style.width = `${w}px`;
    this.feuille.style.height = `${h}px`;
    this.svg.setAttribute("width", `${w}px`);
    this.svg.setAttribute("height", `${h}px`);
    this.cadre.scrollLeft = etat.sx;
    this.cadre.scrollTop = etat.sy;
    this.survol.hidden = true;
    // 100 % = taille réelle à l'impression (96 px par pouce)
    this.zone.querySelector(".vis-zoom").textContent = `${Math.round((etat.zoom / (96 / 25.4)) * 100)} %`;
    this.surZoom?.();
  }
}
