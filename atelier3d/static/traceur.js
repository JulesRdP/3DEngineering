// Traceur : primitives de dessin en mm sur une feuille (origine en haut à gauche, y vers le bas),
// rendues sur canvas (aperçu, PNG) ou en PDF vectoriel (pdf.js).
// Traits ISO 128 (paire 0,5 / 0,25 mm), écriture ISO 3098 (hauteur h = hauteur des majuscules),
// police Helvetica en PDF, mesurée avec Arial dans le navigateur (mêmes largeurs de caractères).

export const FORMATS = { A4: [210, 297], A3: [420, 297], A2: [594, 420] };
export const EP = { fort: 0.5, fin: 0.25, cadre: 0.7 };
// motifs en mm pour d = 0,25 : interrompu 12d / 3d, mixte fin 24d / 3d / point / 3d
export const MOTIFS = { continu: null, interrompu: [3, 0.75], mixte: [6, 0.75, 0.5, 0.75] };
const HAUTEUR_MAJ = 0.716;            // hauteur des capitales d'Helvetica / Arial, en em
const POLICE = "Arial, Helvetica, sans-serif";

let mesureur = null;
export function largeurTexte(s, h, gras = false) {
  if (!mesureur) mesureur = document.createElement("canvas").getContext("2d");
  mesureur.font = `${gras ? "bold " : ""}100px ${POLICE}`;
  return (mesureur.measureText(s).width / 100) * (h / HAUTEUR_MAJ);
}

export class Feuille {
  constructor(format, orientation = "paysage") {
    const [a, b] = FORMATS[format];
    [this.largeur, this.hauteur] = orientation === "portrait" ? [Math.min(a, b), Math.max(a, b)] : [Math.max(a, b), Math.min(a, b)];
    this.format = format;
    this.ops = [];
  }

  // Données pures (JSON) : un plan généré est gardé sur le serveur et réaffiché sans être recalculé.
  donnees() {
    return { format: this.format, largeur: this.largeur, hauteur: this.hauteur, titre: this.titre || "", infos: this.infos || {}, ops: this.ops };
  }

  static depuisDonnees(d) {
    const F = Object.create(Feuille.prototype);
    return Object.assign(F, { format: d.format, largeur: d.largeur, hauteur: d.hauteur, titre: d.titre, infos: d.infos, ops: d.ops });
  }

  trait(pts, { ep = EP.fin, motif = "continu", ferme = false } = {}) {
    if (pts.length >= 2) this.ops.push({ t: "trait", pts, ep, motif: typeof motif === "string" ? MOTIFS[motif] : motif, ferme });
  }

  segment(x1, y1, x2, y2, opts) { this.trait([[x1, y1], [x2, y2]], opts); }

  cercle(cx, cy, r, opts) {
    const n = Math.max(24, Math.min(144, Math.round(r * 6)));
    this.trait(Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]), { ...opts, ferme: true });
  }

  remplir(chemins) { this.ops.push({ t: "remplir", chemins }); }

  disque(cx, cy, r) {
    this.remplir([Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos((Math.PI * i) / 12), cy + r * Math.sin((Math.PI * i) / 12)])]);
  }

  // Flèche de cote fermée et pleine : pointe en (x, y), dirigée selon l'angle a (radians, repère feuille).
  fleche(x, y, a, longueur = 2.5, demi = 0.45) {
    const c = Math.cos(a), s = Math.sin(a);
    this.remplir([[[x, y], [x - c * longueur - s * demi, y - s * longueur + c * demi], [x - c * longueur + s * demi, y - s * longueur - c * demi]]]);
  }

  // Texte : (x, y) = point d'ancrage ; align g / c / d le long du texte ; v base / milieu / haut ;
  // angle en degrés dans le sens trigonométrique (90 = lu de bas en haut, depuis la droite de la feuille).
  texte(x, y, s, { h = 3.5, angle = 0, align = "g", v = "base", gras = false } = {}) {
    s = String(s);
    const w = largeurTexte(s, h, gras);
    const dx = align === "c" ? -w / 2 : align === "d" ? -w : 0;
    const dy = v === "milieu" ? h / 2 : v === "haut" ? h : 0;     // vers le bas de la ligne d'écriture
    const a = (angle * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    // repère du texte : u le long de la ligne (vers la droite, tourné), n vers le bas de la ligne
    const bx = x + dx * c + dy * sn, by = y - dx * sn + dy * c;
    this.ops.push({ t: "texte", x: bx, y: by, s, h, angle, gras });
    return w;
  }

  // Texte mêlant chaînes et symboles de cotation ISO 129 : { sym: "lamage" | "prof" | "fraisure" }.
  texteRiche(x, y, morceaux, { h = 3.5, align = "g" } = {}) {
    const larg = (m) => (typeof m === "string" ? largeurTexte(m, h) : h * 1.05);
    const total = morceaux.reduce((s, m) => s + larg(m), 0);
    let cx = align === "c" ? x - total / 2 : align === "d" ? x - total : x;
    for (const m of morceaux) {
      if (typeof m === "string") this.texte(cx, y, m, { h });
      else this.symbole(m.sym, cx + 0.1 * h, y, h);
      cx += larg(m);
    }
    return total;
  }

  symbole(nom, x, y, h) {
    const w = 0.8 * h, o = { ep: h / 10 };
    if (nom === "lamage") this.trait([[x, y - h], [x, y], [x + w, y], [x + w, y - h]], o);
    else if (nom === "prof") {
      this.segment(x + w / 2, y - h, x + w / 2, y, o);
      this.trait([[x + w / 2 - w * 0.3, y - h * 0.35], [x + w / 2, y], [x + w / 2 + w * 0.3, y - h * 0.35]], o);
      this.segment(x, y, x + w, y, o);
    } else if (nom === "fraisure") this.trait([[x, y - h], [x + w / 2, y], [x + w, y - h]], o);
  }

  // Même dessin en SVG (unités = mm) : net à tous les niveaux de zoom de l'aperçu.
  rendreSVG() {
    const n = (v) => Math.round(v * 1000) / 1000;
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const pts = (l) => l.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.largeur} ${this.hauteur}" width="${this.largeur}mm" height="${this.hauteur}mm">`,
      `<rect class="fond" width="${this.largeur}" height="${this.hauteur}" fill="#fff"/>`,
      `<g fill="none" stroke="#000" stroke-linejoin="round">`];
    for (const op of this.ops) {
      if (op.t === "trait") {
        const dash = op.motif ? ` stroke-dasharray="${op.motif.join(" ")}"` : "";
        parts.push(`<${op.ferme ? "polygon" : "polyline"} points="${pts(op.pts)}" stroke-width="${op.ep}"${dash}/>`);
      }
    }
    parts.push(`</g><g fill="#000" stroke="none">`);
    for (const op of this.ops) {
      if (op.t === "remplir") parts.push(`<path fill-rule="evenodd" d="${op.chemins.map((c) => `M${pts(c)}Z`).join("")}"/>`);
      else if (op.t === "texte") {
        const rot = op.angle ? ` transform="rotate(${n(-op.angle)} ${n(op.x)} ${n(op.y)})"` : "";
        parts.push(`<text x="${n(op.x)}" y="${n(op.y)}" font-family="${POLICE}" font-size="${n(op.h / HAUTEUR_MAJ)}"${op.gras ? ' font-weight="bold"' : ""}${rot}>${esc(op.s)}</text>`);
      }
    }
    parts.push("</g></svg>");
    return parts.join("");
  }

  rendreCanvas(pxmm, { fond = "#ffffff" } = {}) {
    const toile = document.createElement("canvas");
    toile.width = Math.round(this.largeur * pxmm);
    toile.height = Math.round(this.hauteur * pxmm);
    const ctx = toile.getContext("2d");
    ctx.fillStyle = fond; ctx.fillRect(0, 0, toile.width, toile.height);
    ctx.scale(pxmm, pxmm);
    ctx.lineCap = "butt"; ctx.lineJoin = "round";
    ctx.strokeStyle = "#000"; ctx.fillStyle = "#000";
    for (const op of this.ops) {
      if (op.t === "trait") {
        // en dessous d'un pixel, le trait fin deviendrait gris pâle à l'écran
        ctx.lineWidth = Math.max(op.ep, 0.9 / pxmm);
        ctx.setLineDash(op.motif || []);
        ctx.beginPath();
        op.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (op.ferme) ctx.closePath();
        ctx.stroke();
      } else if (op.t === "remplir") {
        ctx.beginPath();
        for (const ch of op.chemins) { ch.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
        ctx.fill("evenodd");
      } else if (op.t === "texte") {
        ctx.save();
        ctx.translate(op.x, op.y);
        ctx.rotate((-op.angle * Math.PI) / 180);
        ctx.font = `${op.gras ? "bold " : ""}${op.h / HAUTEUR_MAJ}px ${POLICE}`;
        ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
        ctx.fillText(op.s, 0, 0);
        ctx.restore();
      }
    }
    ctx.setLineDash([]);
    return toile;
  }
}

// Hachures à 45° (ou autre angle) d'une zone définie par des contours fermés (règle pair-impair) :
// renvoie des segments, à tracer en trait fin.
export function hachurer(contours, pas = 2.5, angleDeg = 45) {
  const a = (angleDeg * Math.PI) / 180, d = [Math.cos(a), -Math.sin(a)], n = [Math.sin(a), Math.cos(a)];
  const cotes = [];
  let nmin = Infinity, nmax = -Infinity;
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const p = c[i], q = c[(i + 1) % c.length];
      cotes.push([p, q]);
      const k = p[0] * n[0] + p[1] * n[1];
      nmin = Math.min(nmin, k); nmax = Math.max(nmax, k);
    }
  }
  const segs = [];
  for (let k = Math.ceil(nmin / pas) * pas; k <= nmax; k += pas) {
    const ts = [];
    for (const [p, q] of cotes) {
      const kp = p[0] * n[0] + p[1] * n[1] - k, kq = q[0] * n[0] + q[1] * n[1] - k;
      if ((kp < 0) === (kq < 0)) continue;
      const t = kp / (kp - kq);
      const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
      ts.push(x * d[0] + y * d[1]);
    }
    ts.sort((u, v) => u - v);
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const p0 = [n[0] * k + d[0] * ts[i], n[1] * k + d[1] * ts[i]];
      const p1 = [n[0] * k + d[0] * ts[i + 1], n[1] * k + d[1] * ts[i + 1]];
      segs.push([p0, p1]);
    }
  }
  return segs;
}
