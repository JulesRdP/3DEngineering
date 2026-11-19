// PDF vectoriel à partir des feuilles du traceur (traceur.js), sans dépendance.
// Une page par feuille, à la taille réelle du format ; police Helvetica (codage WinAnsi).

const PT = 72 / 25.4;
const n = (v) => (Math.round(v * 1000) / 1000).toString();

// Caractères hors Latin-1 présents dans WinAnsi
const WINANSI = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "œ": 0x9c, "Œ": 0x8c };

function octetsWinAnsi(s) {
  const out = [];
  for (const ch of s) {
    let c = WINANSI[ch] ?? ch.charCodeAt(0);
    if (c > 255) c = 0x3f; // « ? » pour ce que Helvetica ne sait pas écrire
    if (c === 0x28 || c === 0x29 || c === 0x5c) out.push(0x5c);
    out.push(c);
  }
  return out;
}

function contenuPage(f) {
  const H = f.hauteur;
  const parts = [];           // morceaux : chaînes ASCII ou tableaux d'octets
  const P = (x, y) => `${n(x * PT)} ${n((H - y) * PT)}`;
  parts.push("1 J 1 j 0 g 0 G\n");
  for (const op of f.ops) {
    if (op.t === "trait") {
      const motif = op.motif ? `[${op.motif.map((v) => n(v * PT)).join(" ")}] 0 d` : "[] 0 d";
      let s = `${n(op.ep * PT)} w 0 J ${motif}\n${P(...op.pts[0])} m`;
      for (let i = 1; i < op.pts.length; i++) s += ` ${P(...op.pts[i])} l`;
      parts.push(s + (op.ferme ? " s\n" : " S\n"));
    } else if (op.t === "remplir") {
      let s = "";
      for (const ch of op.chemins) s += `${P(...ch[0])} m ${ch.slice(1).map((p) => `${P(...p)} l`).join(" ")} h `;
      parts.push(s + "f*\n");
    } else if (op.t === "texte") {
      const a = (op.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const taille = (op.h / 0.716) * PT;
      parts.push(`BT /${op.gras ? "F2" : "F1"} ${n(taille)} Tf ${n(c)} ${n(s)} ${n(-s)} ${n(c)} ${P(op.x, op.y)} Tm (`);
      parts.push(octetsWinAnsi(op.s));
      parts.push(") Tj ET\n");
    }
  }
  const enc = new TextEncoder();
  const morceaux = parts.map((p) => (typeof p === "string" ? enc.encode(p) : Uint8Array.from(p)));
  const total = morceaux.reduce((s, m) => s + m.length, 0);
  const flux = new Uint8Array(total);
  let k = 0;
  for (const m of morceaux) { flux.set(m, k); k += m.length; }
  return flux;
}

export function pdfDepuisFeuilles(feuilles, { titre = "" } = {}) {
  const enc = new TextEncoder();
  const morceaux = [], decalages = [];
  let pos = 0;
  const ecrire = (x) => {
    const b = typeof x === "string" ? enc.encode(x) : x;
    morceaux.push(b);
    pos += b.length;
  };
  const objet = (num, ...parties) => {
    decalages[num] = pos;
    ecrire(`${num} 0 obj\n`);
    parties.forEach(ecrire);
    ecrire("\nendobj\n");
  };
  const pages = feuilles.map((_, i) => 6 + i * 2);
  ecrire("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  objet(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objet(2, `<< /Type /Pages /Count ${feuilles.length} /Kids [${pages.map((p) => `${p} 0 R`).join(" ")}] >>`);
  objet(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objet(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const titreAscii = titre.normalize("NFD").replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "");
  objet(5, `<< /Title (${titreAscii}) /Producer (Atelier 3D) >>`);
  feuilles.forEach((f, i) => {
    const p = pages[i];
    const flux = contenuPage(f);
    objet(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(f.largeur * PT)} ${n(f.hauteur * PT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${p + 1} 0 R >>`);
    objet(p + 1, `<< /Length ${flux.length} >>\nstream\n`, flux, "\nendstream");
  });
  const total = 6 + feuilles.length * 2;
  const xref = pos;
  ecrire(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) ecrire(`${String(decalages[k]).padStart(10, "0")} 00000 n \n`);
  ecrire(`trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(morceaux, { type: "application/pdf" });
}
