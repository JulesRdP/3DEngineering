// Dessin d'une imprimante (SVG) d'après sa marque et son modèle, ou sa photo si on en a déposé une.
// Le dessin suit l'état en direct : la pièce monte avec la progression, la buse rougeoie quand elle est chaude,
// le voyant prend la couleur de l'état. Dessins à nous (pas d'images de fabricant), couleurs = variables CSS.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// forme : porte_a_faux (un seul montant, bras en console : A1 mini) | portique (deux montants) | caisson (fermée) | cadre (cube ouvert)
export function forme(m) {
  const t = `${m.marque || ""} ${m.modele || ""} ${m.nom || ""}`.toLowerCase();
  if (/\b(p1s|x1|x1c|x1e|x1 carbon|h2d|kobra s1|k1 max|k1c|k2|bambu x)\b/.test(t)) return "caisson";
  if (/\bp1p\b|voron|\bk1\b/.test(t)) return "cadre";
  if (/\ba1 ?mini\b/.test(t)) return "porte_a_faux";   // l'A1 (sans « mini ») a deux montants : portique
  return "portique";
}

export const estMini = (m) => /mini|nano/.test(`${m.modele || ""} ${m.nom || ""}`.toLowerCase());

const VOYANT = { libre: "ok", terminee: "ok", impression: "info", preparation: "info", occupee: "info", pause: "warn", maintenance: "warn", erreur: "bad", hors_service: "bad" };

// Image d'une machine : sa photo si elle existe, sinon le dessin. e = état en direct (pilote), facultatif.
export function imageMachine(m, e = {}) {
  if (m.photo) return `<img class="imp-photo" src="${esc(m.photo)}" alt="${esc(m.nom)}">`;
  return dessin(m, e);
}

export function dessin(m, e = {}) {
  const etat = e.etat || (m.pilote === "manuel" ? m.statut_manuel : "") || "";
  const actif = ["impression", "pause", "preparation", "terminee", "occupee"].includes(etat);
  const p = etat === "terminee" ? 100 : etat === "occupee" ? 45 : Math.max(0, Math.min(100, Number(e.progression) || 0));
  const chaude = (Number(e.temp_buse) || 0) > 60 || ["impression", "preparation"].includes(etat);
  const f = forme(m);
  const voyant = VOYANT[etat] || "neutre";

  // géométrie commune (repère 120 × 100) : plateau à y = 74, pièce posée dessus
  const hPiece = actif ? 3 + 26 * (p / 100) : 0;
  const yPlateau = f === "caisson" || f === "cadre" ? 66 : 74;
  const yBuse = yPlateau - hPiece - 2;                 // bout de la buse juste au-dessus de la pièce
  const xTete = 60;
  const piece = actif ? `<rect class="imp-piece" x="${xTete - 9}" y="${yPlateau - hPiece}" width="18" height="${hPiece}" rx="1.5"/>` : "";
  const tete = (x, y) => `
    <g class="imp-tete">
      <rect x="${x - 8}" y="${y - 17}" width="16" height="13" rx="2.5"/>
      <rect class="imp-tete-face" x="${x - 5}" y="${y - 14}" width="10" height="4" rx="1"/>
      <path class="imp-buse ${chaude ? "chaude" : ""}" d="M${x - 3} ${y - 4} h6 l-2 4 h-2 z"/>
      ${chaude ? `<circle class="imp-lueur" cx="${x}" cy="${y + 0.5}" r="3.2"/>` : ""}
    </g>`;
  const plateau = (x, l) => `<rect class="imp-plateau" x="${x}" y="${yPlateau}" width="${l}" height="4" rx="1"/>
    <rect class="imp-plateau-lisere" x="${x + 2}" y="${yPlateau}" width="${l - 4}" height="1"/>`;
  const ecran = (x, y) => `<rect class="imp-ecran" x="${x}" y="${y}" width="13" height="7" rx="1.2"/><circle class="imp-voyant v-${voyant}" cx="${x + 10}" cy="${y + 3.5}" r="1.6"/>`;
  const bobine = (cx, cy, r = 9) => `<g class="imp-bobine"><circle cx="${cx}" cy="${cy}" r="${r}"/><circle class="imp-bobine-fil" cx="${cx}" cy="${cy}" r="${r - 2.5}"/><circle cx="${cx}" cy="${cy}" r="2.2"/></g>`;

  let corps = "";
  if (f === "porte_a_faux") {
    corps = `
      <rect class="imp-socle" x="10" y="80" width="100" height="10" rx="3"/>
      ${plateau(30, 68)}
      <rect class="imp-rail" x="30" y="78" width="68" height="2"/>
      <rect class="imp-montant" x="12" y="14" width="11" height="68" rx="2"/>
      ${bobine(17.5, 14)}
      <rect class="imp-bras" x="20" y="${yBuse - 15}" width="${xTete + 12 - 20}" height="6" rx="2"/>
      ${piece}${tete(xTete, yBuse)}
      ${ecran(92, 82)}`;
  } else if (f === "portique") {
    corps = `
      <rect class="imp-socle" x="10" y="80" width="100" height="10" rx="3"/>
      ${plateau(28, 64)}
      <rect class="imp-rail" x="28" y="78" width="64" height="2"/>
      <rect class="imp-montant" x="14" y="12" width="8" height="70" rx="2"/>
      <rect class="imp-montant" x="98" y="12" width="8" height="70" rx="2"/>
      <rect class="imp-bras" x="12" y="8" width="96" height="6" rx="2"/>
      ${bobine(60, 8, 7)}
      <rect class="imp-bras" x="18" y="${yBuse - 15}" width="84" height="5" rx="2"/>
      ${piece}${tete(xTete, yBuse)}
      ${ecran(14, 82)}`;
  } else {
    const ferme = f === "caisson";
    corps = `
      <rect class="imp-caisse" x="14" y="6" width="92" height="86" rx="5"/>
      <rect class="imp-interieur" x="20" y="12" width="80" height="64" rx="2"/>
      <rect class="imp-bras" x="20" y="${yBuse - 15}" width="80" height="4" rx="1.5"/>
      ${plateau(30, 60)}
      <rect class="imp-rail" x="58" y="${yPlateau + 4}" width="4" height="${76 - yPlateau - 4}"/>
      ${piece}${tete(xTete, yBuse)}
      ${ferme ? `<rect class="imp-vitre" x="20" y="12" width="80" height="64" rx="2"/><path class="imp-reflet" d="M28 16 l12 0 l-14 40 l-6 0 z"/>` : `<path class="imp-cadre" d="M20 12 v64 M100 12 v64 M20 12 h80"/>`}
      <rect class="imp-socle" x="14" y="78" width="92" height="14" rx="3"/>
      ${ecran(53.5, 81.5)}`;
  }
  const echelle = estMini(m) ? `transform="translate(9 9.5) scale(0.85)"` : "";
  return `<svg class="imp-dessin${etat === "impression" ? " en-impression" : ""}" viewBox="0 0 120 100" role="img" aria-label="${esc(`${m.marque || ""} ${m.modele || m.nom || ""}`.trim())}"><g ${echelle}>${corps}</g></svg>`;
}
