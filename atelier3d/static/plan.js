// Plan technique d'une pièce : 3 vues orthogonales à la même échelle + une vue en perspective,
// arêtes vives en noir, cotes d'encombrement, repères numérotés, cartouche. Rendu dans un canvas 2D exportable.
import * as THREE from "three";

const L = 1754, H = 1240;          // A4 paysage à 150 dpi
const MARGE = 40, CARTOUCHE = 190;
const ENCRE = "#1b1f1d", TRAIT_COTE = "#c4531a", GRIS = "#6b7570";

// vues : direction de la caméra (vers la pièce) et axe « haut » de l'écran ; axes cotés (h = horizontal, v = vertical)
const SELON = {
  0: { sous: "regard selon −X", pos: [1, 0, 0], haut: [0, 0, 1], h: 1, v: 2 },
  1: { sous: "regard selon +Y", pos: [0, -1, 0], haut: [0, 0, 1], h: 0, v: 2 },
  2: { sous: "regard selon −Z", pos: [0, 0, 1], haut: [0, 1, 0], h: 0, v: 1 },
};
const AXES = ["X", "Y", "Z"];

// La vue principale regarde la pièce selon sa plus petite dimension (elle montre la plus grande face).
function choisirVues(taille) {
  const ordre = [0, 1, 2].sort((a, b) => taille.getComponent(a) - taille.getComponent(b));
  return [
    { nom: "Vue principale", ...SELON[ordre[0]] },
    { nom: "Vue de côté", ...SELON[ordre[1]] },
    { nom: "Vue de dessus / dessous", ...SELON[ordre[2]] },
    { nom: "Perspective", sous: "", pos: [1, -1.2, 0.9], haut: [0, 0, 1], iso: true },
  ];
}

function preparerScene(objets) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3a0, 2.2));
  const soleil = new THREE.DirectionalLight(0xffffff, 0.9);
  soleil.position.set(1, -2, 3);
  scene.add(soleil);
  const peau = new THREE.MeshLambertMaterial({ color: 0xf1efe9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const trait = new THREE.LineBasicMaterial({ color: 0x1b1f1d });
  for (const obj of objets) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const m = new THREE.Mesh(o.geometry, peau);
      m.applyMatrix4(o.matrixWorld);
      scene.add(m);
      const aretes = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), trait);
      aretes.applyMatrix4(o.matrixWorld);
      scene.add(aretes);
    });
  }
  return scene;
}

function fleche(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-11, -4); ctx.lineTo(-11, 4); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function cote(ctx, x1, y1, x2, y2, texte, vertical) {
  ctx.strokeStyle = TRAIT_COTE; ctx.fillStyle = TRAIT_COTE; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  fleche(ctx, x2, y2, a);
  fleche(ctx, x1, y1, a + Math.PI);
  ctx.font = "600 19px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const w = ctx.measureText(texte).width + 10;
  ctx.save();
  ctx.translate(mx, my);
  if (vertical) ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(-w / 2, -12, w, 24);
  ctx.fillStyle = TRAIT_COTE; ctx.fillText(texte, 0, 1);
  ctx.restore();
}

function rappel(ctx, x1, y1, x2, y2) {
  ctx.strokeStyle = TRAIT_COTE; ctx.lineWidth = 0.8; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.setLineDash([]);
}

function pastilleRepere(ctx, x, y, n) {
  ctx.fillStyle = TRAIT_COTE;
  ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.font = "700 15px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(n), x, y + 1);
}

const fmt = (v) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

export function dessinerPlan(objets, { titre = "", projet = "", reperes = [], note = "" } = {}) {
  const toile = document.createElement("canvas");
  toile.width = L; toile.height = H;
  const ctx = toile.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, L, H);

  const scene = preparerScene(objets);
  const boite = new THREE.Box3().setFromObject(scene);
  const taille = boite.getSize(new THREE.Vector3());
  const centre = boite.getCenter(new THREE.Vector3());
  const rayon = taille.length() / 2 || 10;
  const VUES = choisirVues(taille);

  // cadres des 4 vues (grille 2 × 2)
  const zoneH = H - 2 * MARGE - CARTOUCHE;
  const cw = (L - 2 * MARGE) / 2, ch = zoneH / 2;
  const cadres = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => ({ x: MARGE + i * cw, y: MARGE + j * ch, w: cw, h: ch }));
  const PAD = 70; // place pour les cotes

  // échelle commune aux trois vues orthogonales (mm → px)
  const dimsVue = VUES.slice(0, 3).map((v) => [taille.getComponent(v.h), taille.getComponent(v.v)]);
  const echelle = Math.min(...dimsVue.map(([a, b]) => Math.min((cw - 2 * PAD) / Math.max(a, 1e-6), (ch - 2 * PAD - 30) / Math.max(b, 1e-6))));

  const rendu = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  rendu.setPixelRatio(1);
  rendu.setClearColor(0xffffff, 1);
  rendu.setSize(cw, ch, false);

  VUES.forEach((vue, k) => {
    const c = cadres[k];
    const demiW = cw / 2 / (vue.iso ? Math.min((cw - 60) / (2 * rayon), (ch - 80) / (2 * rayon)) : echelle);
    const demiH = ch / 2 / (vue.iso ? Math.min((cw - 60) / (2 * rayon), (ch - 80) / (2 * rayon)) : echelle);
    const cam = new THREE.OrthographicCamera(-demiW, demiW, demiH, -demiH, 0.1, rayon * 20);
    const dir = new THREE.Vector3(...vue.pos).normalize();
    cam.position.copy(centre).addScaledVector(dir, rayon * 5);
    cam.up.set(...vue.haut);
    cam.lookAt(centre);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    rendu.render(scene, cam);
    ctx.drawImage(rendu.domElement, c.x, c.y);

    const versPx = (p) => {
      const v = new THREE.Vector3(...p).project(cam);
      return [c.x + ((v.x + 1) / 2) * cw, c.y + ((1 - v.y) / 2) * ch];
    };

    // titre de la vue
    ctx.fillStyle = ENCRE; ctx.font = "600 20px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(vue.nom, c.x + 14, c.y + 12);
    const largeurNom = ctx.measureText(vue.nom).width;
    ctx.fillStyle = GRIS; ctx.font = "15px system-ui, sans-serif";
    ctx.fillText(vue.sous, c.x + 14 + largeurNom + 10, c.y + 15);

    if (!vue.iso) {
      // cotes d'encombrement : coins de la boîte projetés
      const coins = [];
      for (const x of [boite.min.x, boite.max.x]) for (const y of [boite.min.y, boite.max.y]) for (const z of [boite.min.z, boite.max.z]) coins.push(versPx([x, y, z]));
      const xs = coins.map((p) => p[0]), ys = coins.map((p) => p[1]);
      const gx = Math.min(...xs), dx = Math.max(...xs), hy = Math.min(...ys), by = Math.max(...ys);
      const yc = by + 34, xc = gx - 34;
      rappel(ctx, gx, by + 4, gx, yc + 8); rappel(ctx, dx, by + 4, dx, yc + 8);
      cote(ctx, gx, yc, dx, yc, `${fmt(taille.getComponent(vue.h))}`, false);
      rappel(ctx, gx - 4, hy, xc - 8, hy); rappel(ctx, gx - 4, by, xc - 8, by);
      cote(ctx, xc, by, xc, hy, `${fmt(taille.getComponent(vue.v))}`, true);
      // petit repère d'axes
      ctx.fillStyle = GRIS; ctx.font = "13px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillText(`→ ${AXES[vue.h]}   ↑ ${AXES[vue.v]}`, c.x + cw - 12, c.y + ch - 8);
    }
    // repères : sur la perspective et la vue de face
    if (vue.iso || k === 0) {
      for (const r of reperes) {
        const [px, py] = versPx(r.pos);
        const [ex, ey] = [px + 34, py - 34];
        ctx.strokeStyle = TRAIT_COTE; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = TRAIT_COTE; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
        pastilleRepere(ctx, ex, ey, r.n);
      }
    }
  });
  rendu.dispose();

  // séparations des vues
  ctx.strokeStyle = "#c9cfcb"; ctx.lineWidth = 1;
  ctx.strokeRect(MARGE, MARGE, L - 2 * MARGE, zoneH);
  ctx.beginPath();
  ctx.moveTo(MARGE + cw, MARGE); ctx.lineTo(MARGE + cw, MARGE + zoneH);
  ctx.moveTo(MARGE, MARGE + ch); ctx.lineTo(L - MARGE, MARGE + ch);
  ctx.stroke();

  // cartouche
  const yC = H - MARGE - CARTOUCHE + 14, hC = CARTOUCHE - 14;
  ctx.strokeStyle = ENCRE; ctx.lineWidth = 2;
  ctx.strokeRect(MARGE, yC, L - 2 * MARGE, hC);
  const xInfo = L - MARGE - 560;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xInfo, yC); ctx.lineTo(xInfo, yC + hC); ctx.stroke();
  // repères (légende) à gauche
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillStyle = ENCRE; ctx.font = "600 17px system-ui, sans-serif";
  ctx.fillText(reperes.length ? "Repères" : "Notes", MARGE + 16, yC + 12);
  ctx.font = "15px system-ui, sans-serif";
  const colW = (xInfo - MARGE - 32) / 2;
  if (reperes.length) {
    reperes.slice(0, 12).forEach((r, i) => {
      const x = MARGE + 16 + Math.floor(i / 6) * colW, y = yC + 42 + (i % 6) * 22;
      pastilleRepere(ctx, x + 10, y + 9, r.n);
      ctx.fillStyle = ENCRE; ctx.font = "15px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      let t = r.texte + (r.valeur ? ` : ${r.valeur}` : "");
      while (ctx.measureText(t).width > colW - 40 && t.length > 4) t = t.slice(0, -2);
      ctx.fillText(t, x + 30, y);
    });
  } else {
    ctx.fillStyle = GRIS;
    ctx.fillText(note || "Aucun repère. Dans la vue 3D, « Poser un repère » puis clic sur la pièce.", MARGE + 16, yC + 42);
  }
  // informations à droite
  const lignes = [
    ["Pièce", titre], ["Projet", projet],
    ["Encombrement", `${fmt(taille.x)} × ${fmt(taille.y)} × ${fmt(taille.z)} mm (X × Y × Z)`],
    ["Échelle", (() => { const r = echelle / (150 / 25.4); return `${r >= 1 ? fmt(r) + ":1" : "1:" + fmt(1 / r)} (A4 imprimé à 100 %)`; })()],
    ["Date", new Date().toLocaleDateString("fr-FR")],
  ];
  lignes.forEach(([k, v], i) => {
    const y = yC + 14 + i * 32;
    ctx.fillStyle = GRIS; ctx.font = "14px system-ui, sans-serif"; ctx.fillText(k, xInfo + 16, y + 2);
    ctx.fillStyle = ENCRE; ctx.font = i === 0 ? "700 19px system-ui, sans-serif" : "16px system-ui, sans-serif";
    let t = String(v);
    while (ctx.measureText(t).width > 400 && t.length > 4) t = t.slice(0, -2);
    ctx.fillText(t, xInfo + 140, y);
  });
  ctx.fillStyle = GRIS; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "right";
  ctx.fillText("Atelier 3D · cotes en mm · arêtes vives > 25°", L - MARGE - 12, yC + hC - 22);
  return toile;
}
