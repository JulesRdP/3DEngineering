// Atelier 3D : interface (page unique, routes dans le #hash).
import { imageMachine } from "/static/imprimantes.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const page = $("#page");

// ------------------------------------------------------------------ utilitaires
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nb = (v, d = 1) => (v === null || v === undefined || v === "" ? "–" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d }));
const octets = (n) => (n > 1e6 ? nb(n / 1e6) + " Mo" : nb(n / 1e3, 0) + " ko");
const date = (s) => (s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "–");
const heure = (s) => { const d = new Date(s); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : date(s); };
const heureLocale = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const duree = (min) => (min ? (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}` : `${Math.round(min)} min`) : "–");

async function api(chemin, options = {}) {
  const opts = { ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch("/api/" + chemin, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

const THREE_DEG = (d) => (d * Math.PI) / 180;

// ---- réglages communs à l'atelier (liste rangée et valeurs par défaut : atelier3d/reglages.py)
let reglagesCache = null;
async function reglages(recharger = false) {
  if (!reglagesCache || recharger) reglagesCache = await api("reglages");
  return reglagesCache;
}
const reglage = async (cle) => (await reglages()).valeurs[cle];

// module de la vue 3D, avec l'affichage par défaut de l'atelier (réglages vue3d.*, libellés → clés de vision.js)
async function vision3d() {
  const [mod, { valeurs: r }] = await Promise.all([import("/static/vision.js"), reglages()]);
  const cle = (liste, libelle) => liste.find(([, l]) => l === libelle)?.[0];
  mod.definirDefauts({
    style: cle(mod.STYLES, r["vue3d.affichage.style"]), couleur: cle(mod.COULEURS, r["vue3d.affichage.couleur"]),
    contraste: r["vue3d.affichage.contraste"], reflets: r["vue3d.affichage.reflets"],
  });
  return mod;
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

const STATUTS_PROJET = { idee: ["Idée", "p-neutre"], en_cours: ["En cours", "p-info"], termine: ["Terminé", "p-ok"], archive: ["Archivé", "p-neutre"] };
const RESULTATS = { prevue: ["Prévue", "p-neutre"], en_cours: ["En cours", "p-info"], reussie: ["Réussie", "p-ok"], ratee: ["Ratée", "p-bad"], annulee: ["Annulée", "p-neutre"] };
const ETATS_MACHINE = {
  libre: "p-ok", terminee: "p-ok", impression: "p-info", preparation: "p-info", pause: "p-warn", occupee: "p-info",
  maintenance: "p-warn", erreur: "p-bad", hors_service: "p-bad",
};
const LIBELLES_ETAT = {
  libre: "Libre", terminee: "Terminée", impression: "En impression", preparation: "Préparation", pause: "En pause", occupee: "Occupée",
  maintenance: "Maintenance", erreur: "Erreur", hors_service: "Hors service", incomplete: "À configurer", deconnectee: "Déconnectée",
  "connexion...": "Connexion…", connectee: "Connectée", manuel: "Manuel", inconnu: "Inconnu", inconnue: "Inconnu", "arret demande": "Arrêt demandé",
};
const libelleEtat = (e) => LIBELLES_ETAT[e] || String(e || "inconnu").replace(/_/g, " ");
const ROLES = { piece: "Pièces à imprimer", plan: "Plans et documents", source: "Sources CAO", gcode: "Fichiers tranchés", photo: "Photos", autre: "Autres" };
const pastille = (paire) => `<span class="pastille ${paire[1]}">${esc(paire[0])}</span>`;

// ------------------------------------------------------------------ formulaires génériques
// champ : { k, l, t: text|number|select|textarea|color|password|datetime, options: [[val, libellé]], aide, large, pas }
function champHtml(c, v) {
  const val = v ?? c.defaut ?? "";
  let entree;
  if (c.t === "select") {
    entree = `<select name="${c.k}">${(c.options || []).map(([o, l]) => `<option value="${esc(o)}" ${String(o) === String(val) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  } else if (c.t === "textarea") {
    entree = `<textarea name="${c.k}" rows="3" placeholder="${esc(c.ph || "")}">${esc(val)}</textarea>`;
  } else if (c.t === "fichiers") {
    entree = `<input name="${c.k}" type="file" multiple ${c.accept ? `accept="${esc(c.accept)}"` : ""}>`;
  } else {
    const type = { number: "number", color: "color", password: "password", datetime: "datetime-local" }[c.t] || "text";
    const extra = c.t === "number" ? `step="${c.pas || "any"}"` : "";
    const liste = c.liste ? `list="dl-${c.k}"` : "";
    const dl = c.liste ? `<datalist id="dl-${c.k}">${c.liste.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
    entree = `<input name="${c.k}" type="${type}" value="${esc(val)}" ${extra} ${liste} ${c.requis ? "required" : ""} placeholder="${esc(c.ph || "")}">${dl}`;
  }
  return `<label class="champ ${c.large ? "large" : ""}">${esc(c.l)}${entree}${c.aide ? `<span class="aide">${esc(c.aide)}</span>` : ""}</label>`;
}

function formulaire({ titre, champs, valeurs = {}, valider = "Enregistrer", surChange, supprimer }) {
  return new Promise((resoudre) => {
    const d = $("#modale");
    d.innerHTML = `<form method="dialog">
      <h2>${esc(titre)}</h2>
      <div class="grille-form">${champs.map((c) => champHtml(c, valeurs[c.k])).join("")}</div>
      <div class="bas">
        ${supprimer ? `<button type="button" class="btn danger" data-suppr style="margin-right:auto">Supprimer</button>` : ""}
        <button type="button" class="btn" data-annuler>Annuler</button>
        <button class="btn prim" value="ok">${esc(valider)}</button>
      </div></form>`;
    const f = $("form", d);
    const lire = () => {
      const o = {};
      for (const c of champs) {
        const el = f.elements[c.k];
        if (!el) continue;
        o[c.k] = c.t === "fichiers" ? [...el.files] : c.t === "number" && el.value !== "" ? Number(el.value) : el.value;
      }
      return o;
    };
    if (surChange) f.addEventListener("change", (e) => surChange(e.target.name, lire(), f));
    $("[data-annuler]", d).onclick = () => { d.close(); resoudre(null); };
    if (supprimer) $("[data-suppr]", d).onclick = () => { d.close(); resoudre({ __supprimer: true }); };
    f.onsubmit = (e) => { e.preventDefault(); d.close(); resoudre(lire()); };
    d.onclose = fermeture(d, () => resoudre(null));
    // champ fichiers pré-rempli (fichiers déposés sur la page avant d'ouvrir le formulaire)
    for (const c of champs.filter((c) => c.t === "fichiers" && valeurs[c.k]?.length)) {
      const dt = new DataTransfer();
      for (const fi of valeurs[c.k]) dt.items.add(fi);
      f.elements[c.k].files = dt.files;
    }
    d.showModal();
  });
}

function confirmer(message) {
  return new Promise((resoudre) => {
    const d = $("#modale");
    d.innerHTML = `<form method="dialog"><h2>Confirmer</h2><p>${esc(message)}</p>
      <div class="bas"><button type="button" class="btn" data-non>Annuler</button><button class="btn prim danger" value="ok">Confirmer</button></div></form>`;
    $("[data-non]", d).onclick = () => { d.close(); resoudre(false); };
    $("form", d).onsubmit = (e) => { e.preventDefault(); d.close(); resoudre(true); };
    d.onclose = fermeture(d, () => resoudre(false));
    d.showModal();
  });
}

// L'événement « close » d'une <dialog> est différé (tâche). Quand un formulaire enchaîne sur une confirmation
// (bouton Supprimer), la même boîte est déjà rouverte quand ce « close » peut arriver : selon le navigateur, il
// annulerait aussitôt la confirmation. On l'ignore donc si la boîte est de nouveau ouverte.
function fermeture(d, annuler) {
  return () => { if (!d.open) annuler(); };
}

// ------------------------------------------------------------------ définitions des formulaires
const MODELES_MACHINE = {
  "Bambu Lab A1 mini": { marque: "Bambu Lab", modele: "A1 mini", volume_x: 180, volume_y: 180, volume_z: 180, pilote: "bambu_lan" },
  "Bambu Lab A1": { marque: "Bambu Lab", modele: "A1", volume_x: 256, volume_y: 256, volume_z: 256, pilote: "bambu_lan" },
  "Bambu Lab P1S": { marque: "Bambu Lab", modele: "P1S", volume_x: 256, volume_y: 256, volume_z: 256, pilote: "bambu_lan" },
  "Bambu Lab P1P": { marque: "Bambu Lab", modele: "P1P", volume_x: 256, volume_y: 256, volume_z: 256, pilote: "bambu_lan" },
  "Bambu Lab X1 Carbon": { marque: "Bambu Lab", modele: "X1 Carbon", volume_x: 256, volume_y: 256, volume_z: 256, pilote: "bambu_lan" },
  "Anycubic Kobra X": { marque: "Anycubic", modele: "Kobra X", pilote: "manuel" },
  "Anycubic Kobra 3": { marque: "Anycubic", modele: "Kobra 3", volume_x: 250, volume_y: 250, volume_z: 260, pilote: "manuel" },
};
const MATIERES = {
  PLA: { densite: 1.24, temp_buse: 215, temp_plateau: 60 }, PETG: { densite: 1.27, temp_buse: 245, temp_plateau: 75 },
  ABS: { densite: 1.04, temp_buse: 255, temp_plateau: 100 }, ASA: { densite: 1.07, temp_buse: 260, temp_plateau: 100 },
  TPU: { densite: 1.21, temp_buse: 225, temp_plateau: 40 }, "PA (nylon)": { densite: 1.14, temp_buse: 270, temp_plateau: 90 },
  "PLA-CF": { densite: 1.29, temp_buse: 220, temp_plateau: 60 }, "PETG-CF": { densite: 1.30, temp_buse: 250, temp_plateau: 75 },
  "Résine": { densite: 1.1 },
};

const champsProjet = () => [
  { k: "nom", l: "Nom du projet", requis: true },
  { k: "statut", l: "Statut", t: "select", options: Object.entries(STATUTS_PROJET).map(([k, v]) => [k, v[0]]), defaut: "en_cours" },
  { k: "tags", l: "Étiquettes", ph: "robot, outillage, G1-D", aide: "séparées par des virgules" },
  { k: "lien_cao", l: "Lien CAO", ph: "https://cad.onshape.com/..." },
  { k: "description", l: "Description", t: "textarea", large: true },
];
const champsMachine = () => [
  { k: "__modele", l: "Modèle connu (pré-remplit)", t: "select", options: [["", "—"], ...Object.keys(MODELES_MACHINE).map((m) => [m, m])] },
  { k: "nom", l: "Nom", requis: true, ph: "P1S du labo" },
  { k: "marque", l: "Marque" }, { k: "modele", l: "Modèle" },
  { k: "techno", l: "Technologie", t: "select", options: [["fdm", "Filament (FDM)"], ["resine", "Résine"]] },
  { k: "volume_x", l: "Volume X (mm)", t: "number" }, { k: "volume_y", l: "Volume Y (mm)", t: "number" }, { k: "volume_z", l: "Volume Z (mm)", t: "number" },
  { k: "buse", l: "Buse (mm)", t: "number", defaut: 0.4 },
  { k: "pilote", l: "Connexion", t: "select", options: [["manuel", "Aucune (état manuel)"], ["bambu_lan", "Bambu Lab réseau local"], ["moonraker", "Klipper / Moonraker"]] },
  { k: "adresse", l: "Adresse IP", ph: "192.168.1.50" },
  { k: "numero_serie", l: "Numéro de série", aide: "Bambu : Paramètres > Appareil" },
  { k: "code_acces", l: "Code d'accès", t: "password", aide: "Bambu : écran > Réseau > Code d'accès. Vide = inchangé" },
  { k: "statut_manuel", l: "État manuel", t: "select", options: [["libre", "Libre"], ["occupee", "Occupée"], ["maintenance", "Maintenance"], ["hors_service", "Hors service"]] },
  { k: "notes", l: "Notes", t: "textarea", large: true },
];
const champsFilament = () => [
  { k: "matiere", l: "Matière", requis: true, liste: Object.keys(MATIERES), defaut: "PLA" },
  { k: "marque", l: "Marque", ph: "Bambu, Anycubic, Prusament..." }, { k: "couleur", l: "Couleur" },
  { k: "couleur_hex", l: "Teinte", t: "color", defaut: "#cccccc" },
  { k: "diametre", l: "Diamètre (mm)", t: "number", defaut: 1.75 }, { k: "densite", l: "Densité (g/cm³)", t: "number", defaut: 1.24 },
  { k: "temp_buse", l: "Temp. buse (°C)", t: "number" }, { k: "temp_plateau", l: "Temp. plateau (°C)", t: "number" },
  { k: "stock_g", l: "Stock (g)", t: "number", defaut: 1000 }, { k: "prix_kg", l: "Prix (€/kg)", t: "number", defaut: 20 },
  { k: "notes", l: "Notes", t: "textarea", large: true },
];
async function champsPreset() {
  const [machines, filaments] = await Promise.all([api("machines"), api("filaments")]);
  return [
    { k: "nom", l: "Nom", requis: true, ph: "PLA solide 0.2" },
    { k: "machine_id", l: "Machine", t: "select", options: [["", "—"], ...machines.map((m) => [m.id, m.nom])] },
    { k: "filament_id", l: "Filament", t: "select", options: [["", "—"], ...filaments.map((f) => [f.id, `${f.matiere} ${f.marque} ${f.couleur}`])] },
    { k: "hauteur_couche", l: "Hauteur de couche (mm)", t: "number", defaut: 0.2 },
    { k: "remplissage", l: "Remplissage (%)", t: "number", defaut: 15 },
    { k: "motif", l: "Motif de remplissage", liste: ["gyroid", "grille", "nid d'abeille", "cubique", "lignes", "3D honeycomb"], defaut: "gyroid" },
    { k: "parois", l: "Parois", t: "number", defaut: 2 },
    { k: "vitesse", l: "Vitesse (mm/s)", t: "number" },
    { k: "temp_buse", l: "Temp. buse (°C)", t: "number" }, { k: "temp_plateau", l: "Temp. plateau (°C)", t: "number" },
    { k: "supports", l: "Supports", t: "select", options: [["non", "Aucun"], ["arbre", "Arbre"], ["normal", "Normaux"], ["contact plateau", "Au contact du plateau"]] },
    { k: "adherence", l: "Adhérence", t: "select", options: [["aucune", "Aucune"], ["bordure", "Bordure"], ["radeau", "Radeau"]] },
    { k: "notes", l: "Notes (orientation, réglages trancheur...)", t: "textarea", large: true },
  ];
}
async function champsImpression() {
  const [fichiers, machines, presets, filaments] = await Promise.all([api("fichiers"), api("machines"), api("presets"), api("filaments")]);
  return [
    { k: "fichier_id", l: "Fichier", t: "select", large: true, options: [["", "—"], ...fichiers.filter((f) => ["piece", "gcode"].includes(f.role)).map((f) => [f.id, `${f.projet} / ${f.nom}${f.variante ? " (" + f.variante + ")" : ""}`])] },
    { k: "machine_id", l: "Machine", t: "select", options: [["", "—"], ...machines.map((m) => [m.id, m.nom])] },
    { k: "preset_id", l: "Preset", t: "select", options: [["", "—"], ...presets.map((p) => [p.id, p.nom])] },
    { k: "filament_id", l: "Filament", t: "select", options: [["", "—"], ...filaments.map((f) => [f.id, `${f.matiere} ${f.marque} ${f.couleur}`])] },
    { k: "quantite", l: "Quantité", t: "number", defaut: 1, pas: 1 },
    { k: "resultat", l: "Résultat", t: "select", options: Object.entries(RESULTATS).map(([k, v]) => [k, v[0]]), defaut: "prevue" },
    { k: "debut", l: "Date", t: "datetime" },
    { k: "duree_min", l: "Durée (min)", t: "number" },
    { k: "grammes", l: "Filament utilisé (g / pièce)", t: "number", aide: "retiré du stock quand l'impression est réussie ou ratée" },
    { k: "notes", l: "Notes (défauts, réglages à changer...)", t: "textarea", large: true },
  ];
}

// ------------------------------------------------------------------ actions communes
async function editer(table, champs, ligne, apres) {
  const valeurs = { ...(ligne || {}) };
  if (table === "machines") valeurs.code_acces = "";
  const surChange = async (nom, v, f) => {
    if (nom === "__modele" && MODELES_MACHINE[v.__modele]) {
      for (const [k, val] of Object.entries(MODELES_MACHINE[v.__modele])) if (f.elements[k]) f.elements[k].value = val;
      if (!f.elements.nom.value) f.elements.nom.value = v.__modele;
    }
    if (nom === "matiere" && MATIERES[v.matiere]) {
      for (const [k, val] of Object.entries(MATIERES[v.matiere])) if (f.elements[k]) f.elements[k].value = val;
    }
    if (table === "impressions" && nom === "preset_id" && v.preset_id) {
      const p = await api("presets/" + v.preset_id);
      if (p.filament_id) f.elements.filament_id.value = p.filament_id;
      if (p.machine_id) f.elements.machine_id.value = p.machine_id;
    }
    if (table === "impressions" && ["fichier_id", "filament_id"].includes(nom) && v.fichier_id && !f.elements.grammes.value) {
      const c = await api(`fichiers/${v.fichier_id}/compatibilite`);
      const e = c.estimation.find((x) => String(x.filament_id) === String(f.elements.filament_id.value)) || c.estimation[0];
      if (e) f.elements.grammes.value = e.grammes;
    }
    if (table === "presets" && nom === "filament_id" && v.filament_id) {
      const fil = await api("filaments/" + v.filament_id);
      if (!f.elements.temp_buse.value && fil.temp_buse) f.elements.temp_buse.value = fil.temp_buse;
      if (!f.elements.temp_plateau.value && fil.temp_plateau) f.elements.temp_plateau.value = fil.temp_plateau;
    }
  };
  const titre = { projets: "projet", machines: "machine", filaments: "filament", presets: "preset", impressions: "impression" }[table];
  const r = await formulaire({ titre: (ligne?.id ? "Modifier le " : "Nouveau ") + titre, champs, valeurs, surChange, supprimer: !!ligne?.id });
  if (!r) return;
  try {
    if (r.__supprimer) {
      if (!(await confirmer(`Supprimer définitivement ce ${titre} ?`))) return;
      await api(`${table}/${ligne.id}`, { method: "DELETE" });
      toast("Supprimé");
      return apres?.(null);
    }
    delete r.__modele;
    const res = ligne?.id ? await api(`${table}/${ligne.id}`, { method: "PUT", body: r }) : await api(table, { method: "POST", body: r });
    toast("Enregistré");
    apres?.(res);
  } catch (e) { toast("Erreur : " + e.message); }
}

// ------------------------------------------------------------------ pages
const pages = {};
let minuterie = null;

pages[""] = async () => {
  const [t, machines, etats] = await Promise.all([api("tableau"), api("machines"), api("etat-machines")]);
  page.innerHTML = `
    <div class="entete"><div><h1>Tableau de bord</h1><div class="sous">Vue d'ensemble de l'atelier</div></div>
      <div class="actions"><button class="btn" data-nouv-imp>Planifier une impression</button><a class="btn prim" href="#/projets?nouveau">Nouveau projet</a></div></div>
    <div class="chiffres">
      <div class="chiffre"><b>${t.projets}</b><span>projets actifs</span></div>
      <div class="chiffre"><b>${t.fichiers}</b><span>fichiers</span></div>
      <div class="chiffre"><b>${t.impressions}</b><span>impressions notées</span></div>
      <div class="chiffre"><b>${t.taux_reussite ?? "–"}${t.taux_reussite !== null ? " %" : ""}</b><span>réussite</span></div>
      <div class="chiffre"><b>${nb(t.grammes / 1000, 2)} kg</b><span>filament consommé</span></div>
      <div class="chiffre"><b>${nb(t.cout, 2)} €</b><span>coût matière</span></div>
    </div>
    <div class="deux">
      <div class="pile">
        <section class="carte"><h2>Machines</h2><div class="grille-imp" id="cartes-machines">${machines.length ? "" : `<div class="vide">Aucune machine. <a href="#/machines">Ajouter une imprimante</a></div>`}</div></section>
        <section class="carte"><h2>Dernières impressions</h2>${tableImpressions(t.recentes)}</section>
      </div>
      <div class="pile">
        <section class="carte"><h2>En cours et à imprimer</h2>${t.a_imprimer.length ? `<div class="liste-fichiers">${t.a_imprimer.map((i) => `
          <a class="ligne-fichier" href="${i.fichier_id ? "#/fichier/" + i.fichier_id : "#/impressions"}"><span class="ico">${i.quantite > 1 ? "×" + i.quantite : "1"}</span>
          <span><div class="nom">${esc(i.fichier_nom || "fichier ?")}</div><div class="info">${esc(i.machine_nom || "machine à choisir")}${i.resultat === "en_cours" && i.debut ? " · depuis " + heure(i.debut) : ""}</div></span>${boutonsSuivi(i)}</a>`).join("")}</div>` : `<div class="vide">Rien en attente</div>`}</section>
        <section class="carte"><h2>Stock bas (&lt; 200 g)</h2>${t.stock_bas.length ? t.stock_bas.map((f) => `<div style="padding:4px 0"><span class="pastille-couleur" style="background:${esc(f.couleur_hex)}"></span>${esc(f.matiere)} ${esc(f.marque)} ${esc(f.couleur)} <span class="pastille p-warn">${nb(f.stock_g, 0)} g</span></div>`).join("") : `<div class="vide">Stock correct</div>`}</section>
      </div>
    </div>`;
  $("[data-nouv-imp]").onclick = async () => editer("impressions", await champsImpression(), null, () => route());
  const enCoursSur = (m) => t.a_imprimer.find((i) => i.machine_id === m.id && i.resultat === "en_cours");
  const rendreMachines = (etats) => { if (machines.length) majCartesMachines($("#cartes-machines"), machines, etats, enCoursSur); };
  rendreMachines(etats);
  minuterie = setInterval(async () => rendreMachines(await api("etat-machines")), 4000);
};

// ---- imprimantes : carte (dessin ou photo, nom, modèle, état) ; un clic ouvre la page de la machine
const volumeTexte = (m) => (m.volume_x ? `${nb(m.volume_x, 0)} × ${nb(m.volume_y, 0)} × ${nb(m.volume_z, 0)} mm` : "volume non renseigné");
const detailImpression = (e) => [e.reste_min ? "reste " + duree(e.reste_min) : "", e.couche ? `couche ${e.couche} / ${e.couches}` : ""].filter(Boolean).join(" · ");
const etatDe = (m, e = {}) => e.etat || e.connexion || "inconnu";

function carteMachine(m, e = {}, imp = null) {
  return `<a class="carte-imp" href="#/machine/${m.id}" data-machine="${m.id}">
    <div class="vignette">${vignetteMachine(m, e)}</div>
    <div class="corps">${corpsCarteMachine(m, e, imp)}</div></a>`;
}
const vignetteMachine = (m, e = {}) => imageMachine(m, e);
function corpsCarteMachine(m, e = {}, imp = null) {
  const enCours = ["impression", "pause", "preparation"].includes(e.etat);
  const modele = [m.marque, m.modele].filter(Boolean).join(" ") || "Modèle non renseigné";
  return `<h3>${esc(m.nom)}</h3><div class="modele">${esc(modele)}</div>
    <div><span class="pastille ${ETATS_MACHINE[etatDe(m, e)] || "p-neutre"}">${esc(libelleEtat(etatDe(m, e)))}</span></div>
    ${enCours ? `<div class="travail"><span>${esc(e.travail || "Impression")}</span><b>${e.progression ?? 0} %</b></div>
      <div class="jauge"><i style="width:${e.progression || 0}%"></i></div>
      <div class="detail">${detailImpression(e)}</div>`
    : imp ? `<div class="imp-manuelle"><span>${esc(imp.fichier_nom || "Impression")}${imp.debut ? ` · depuis ${heure(imp.debut)}` : ""}</span>${boutonsSuivi(imp)}</div>`
    : `<div class="detail">${e.message ? esc(e.message) : esc(volumeTexte(m))}</div>`}
    ${e.code_erreur ? `<div class="pastille p-bad" style="margin-top:6px">erreur ${esc(e.code_erreur)}</div>` : ""}`;
}
// Met les cartes à jour sans tout redessiner (le dessin n'est remplacé que s'il change : animations fluides).
function majCartesMachines(conteneur, machines, etats, enCoursSur = () => null) {
  if (!conteneur.querySelector("[data-machine]")) {
    conteneur.innerHTML = machines.map((m) => carteMachine(m, etats[m.id], enCoursSur(m))).join("");
    return;
  }
  for (const m of machines) {
    const carte = conteneur.querySelector(`[data-machine="${m.id}"]`);
    if (!carte) continue;
    const v = vignetteMachine(m, etats[m.id]), c = corpsCarteMachine(m, etats[m.id], enCoursSur(m));
    if (carte.dataset.v !== v) { $(".vignette", carte).innerHTML = v; carte.dataset.v = v; }
    if (carte.dataset.c !== c) { $(".corps", carte).innerHTML = c; carte.dataset.c = c; }
  }
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-cmd]");
  if (!b) return;
  if (b.dataset.cmd === "arreter" && !(await confirmer("Arrêter l'impression en cours ? Elle ne pourra pas être reprise."))) return;
  try { await api(`machines/${b.dataset.id}/commande/${b.dataset.cmd}`, { method: "POST" }); toast("Commande envoyée"); }
  catch (e) { toast("Erreur : " + e.message); }
});

function tableImpressions(liste, avecFichier = true) {
  if (!liste.length) return `<div class="vide">Aucune impression notée</div>`;
  return `<div class="tab-cont"><table><thead><tr><th>Date</th>${avecFichier ? "<th>Fichier</th>" : ""}<th>Machine</th><th>Qté</th><th>Durée</th><th>Matière</th><th>Résultat</th></tr></thead><tbody>
    ${liste.map((i) => `<tr class="cliquable" data-imp="${i.id}"><td class="num">${date(i.debut)}</td>${avecFichier ? `<td>${esc(i.fichier_nom || "–")}</td>` : ""}
      <td>${esc(i.machine_nom || "–")}</td><td class="num">${i.quantite || 1}</td><td class="num">${duree(i.duree_min)}</td>
      <td class="num">${i.grammes ? nb(i.grammes) + " g" : "–"}</td><td>${boutonsSuivi(i) || pastille(RESULTATS[i.resultat] || [i.resultat, "p-neutre"])}</td></tr>`).join("")}
    </tbody></table></div>`;
}

// ---- suivi en un clic : prévue → « Lancer » ; en cours → « Réussie » / « Ratée »
function boutonsSuivi(i) {
  if (i.resultat === "prevue") return `<span class="suivi"><button class="btn petit" data-suivi="lancer" data-id="${i.id}">Lancer</button></span>`;
  if (i.resultat === "en_cours") return `<span class="suivi"><button class="btn petit ok" data-suivi="reussie" data-id="${i.id}">Réussie</button><button class="btn petit danger" data-suivi="ratee" data-id="${i.id}">Ratée</button></span>`;
  return "";
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-suivi]");
  if (!b) return;
  ev.preventDefault();
  ev.stopPropagation();
  const id = b.dataset.id;
  try {
    if (b.dataset.suivi === "lancer") {
      await api(`impressions/${id}/lancer`, { method: "POST" });
      toast("Impression lancée");
    } else {
      const corps = { resultat: b.dataset.suivi };
      if (b.dataset.suivi === "ratee") {
        const r = await formulaire({ titre: "Impression ratée", valider: "Noter ratée", champs: [{ k: "notes", l: "Qu'est-ce qui a raté ? (facultatif)", t: "textarea", large: true, ph: "décollement, spaghetti, buse bouchée…" }] });
        if (!r) return;
        corps.notes = r.notes;
      }
      const i = await api(`impressions/${id}/terminer`, { method: "POST", body: corps });
      const g = i.stock_deduit && i.grammes ? ` · ${nb(i.grammes * (i.quantite || 1), 0)} g retirés du stock` : "";
      toast((corps.resultat === "reussie" ? "Réussie" : "Ratée") + g);
    }
    route();
  } catch (e) { toast("Erreur : " + e.message); }
}, true);

// Lancer tout de suite une impression du fichier : formulaire court, machine et filament repris de la dernière fois.
async function lancerImpression(f, compat) {
  const [machines, filaments] = await Promise.all([api("machines"), api("filaments")]);
  const derniere = f.impressions.find((i) => i.machine_id || i.filament_id) || {};
  const compatible = compat.machines.find((c) => c.verdict === "ok" || c.verdict === "tourner");
  const machine_id = derniere.machine_id || compatible?.id || machines[0]?.id;
  const filament_id = derniere.filament_id || compat.estimation[0]?.filament_id;
  const estimation = (fid) => compat.estimation.find((e) => String(e.filament_id) === String(fid))?.grammes;
  const verdict = (id) => compat.machines.find((c) => c.id === id)?.verdict;
  const r = await formulaire({
    titre: "Lancer une impression", valider: "Lancer maintenant",
    valeurs: { machine_id, filament_id, quantite: 1, grammes: f.meta?.reglages_3mf?.poids_estime_g || estimation(filament_id) },
    champs: [
      { k: "machine_id", l: "Machine", t: "select", options: machines.map((m) => [m.id, m.nom + (verdict(m.id) === "trop_grand" ? " (trop petite)" : "")]) },
      { k: "filament_id", l: "Filament", t: "select", options: [["", "—"], ...filaments.map((x) => [x.id, `${x.matiere} ${x.marque} ${x.couleur}`.trim()])] },
      { k: "quantite", l: "Quantité", t: "number", pas: 1 },
      { k: "grammes", l: "Filament (g / pièce)", t: "number", aide: "retiré du stock à la fin, réussie ou ratée" },
      { k: "notes", l: "Notes", t: "textarea", large: true },
    ],
    surChange: (nom, v, form) => { if (nom === "filament_id" && !f.meta?.reglages_3mf?.poids_estime_g) form.elements.grammes.value = estimation(v.filament_id) ?? form.elements.grammes.value; },
  });
  if (!r) return;
  try {
    await api("impressions", { method: "POST", body: { ...r, fichier_id: f.id, resultat: "en_cours" } });
    toast("Impression lancée : « Réussie » ou « Ratée » à la fin, depuis le tableau de bord");
    route();
  } catch (e) { toast("Erreur : " + e.message); }
}

document.addEventListener("click", async (ev) => {
  const tr = ev.target.closest("[data-imp]");
  if (!tr || ev.target.closest("[data-suivi]")) return;
  const imp = await api("impressions/" + tr.dataset.imp);
  editer("impressions", await champsImpression(), imp, () => route());
});

// ---- projets
pages.projets = async (params) => {
  const q = params.get("q") || "";
  const projets = await api("projets?q=" + encodeURIComponent(q));
  page.innerHTML = `
    <div class="entete"><div><h1>Projets</h1><div class="sous">${projets.length} projet(s) · glisser un modèle 3D sur la page pour créer un projet</div></div>
      <div class="actions"><input class="recherche" type="search" placeholder="Rechercher (nom, étiquette, fichier)" value="${esc(q)}" id="rech"><button class="btn prim" id="nouv">Nouveau projet</button></div></div>
    <div class="grille">${projets.map((p) => `
      <a class="carte projet" href="#/projet/${p.id}">
        <div class="vignette">${p.fichier_vitrine ? `<img src="/api/fichiers/${p.fichier_vitrine}/miniature" alt="" onerror="this.replaceWith(document.createTextNode('${p.nb_fichiers} fichier(s)'))">` : `${p.nb_fichiers} fichier(s)`}</div>
        <div class="corps"><h3>${esc(p.nom)}</h3>
          <div class="actions" style="justify-content:space-between">${pastille(STATUTS_PROJET[p.statut] || [p.statut, "p-neutre"])}<span class="sous">${date(p.modifie)}</span></div>
          ${p.tags ? `<div class="etiquettes">${p.tags.split(",").filter((t) => t.trim()).map((t) => `<span class="etiq">${esc(t.trim())}</span>`).join("")}</div>` : ""}
        </div></a>`).join("") || `<div class="vide">Aucun projet${q ? " pour cette recherche" : ""}.</div>`}</div>`;
  let attente;
  $("#rech").oninput = (e) => { clearTimeout(attente); attente = setTimeout(() => (location.hash = "#/projets?q=" + encodeURIComponent(e.target.value)), 350); };
  $("#nouv").onclick = () => creerProjet();
  if (params.has("nouveau")) creerProjet();
  // glisser un modèle 3D n'importe où sur la page : nouveau projet à son nom, avec le fichier
  page.ondragover = (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); page.classList.add("depot-actif"); } };
  page.ondragleave = (e) => { if (!page.contains(e.relatedTarget)) page.classList.remove("depot-actif"); };
  page.ondrop = (e) => {
    e.preventDefault();
    page.classList.remove("depot-actif");
    const fichiers = [...e.dataTransfer.files];
    if (fichiers.length) creerProjet({ nom: nomDepuisFichier(fichiers), fichiers });
  };
};

// ---- création d'un projet, avec ses modèles 3D et autres fichiers d'emblée
const FORMATS_DEPOT = ".stl,.3mf,.obj,.step,.stp,.f3d,.scad,.fs,.gcode,.bgcode,.pdf,.png,.jpg,.jpeg,.webp,.svg";
const MODELES_3D = ["stl", "3mf", "obj"];

// « support_moteur-v2.stl » → « support moteur v2 »
function nomDepuisFichier(fichiers) {
  const modele = fichiers.find((f) => /\.(stl|3mf|obj|step|stp)$/i.test(f.name)) || fichiers[0];
  return modele.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

async function creerProjet(prerempli = {}) {
  const r = await formulaire({
    titre: "Nouveau projet", valider: "Créer le projet", valeurs: { statut: "en_cours", ...prerempli },
    // le nom peut rester vide : il est alors tiré du modèle déposé
    champs: [...champsProjet().map((c) => (c.k === "nom" ? { ...c, requis: false, ph: "vide : nom du modèle 3D" } : c)), { k: "fichiers", l: "Modèle 3D et autres fichiers (facultatif)", t: "fichiers", accept: FORMATS_DEPOT, large: true,
      aide: "STL, 3MF, OBJ, STEP, G-code, plans PDF, photos… Analysés dès le dépôt (dimensions, formes, miniature)." }],
  });
  if (!r) return;
  const { fichiers = [], ...valeurs } = r;
  if (!valeurs.nom?.trim()) valeurs.nom = fichiers.length ? nomDepuisFichier(fichiers) : "Nouveau projet";
  try {
    const p = await api("projets", { method: "POST", body: valeurs });
    let deposes = [];
    if (fichiers.length) {
      const fd = new FormData();
      for (const fi of fichiers) fd.append("fichiers", fi);
      try { deposes = await api(`projets/${p.id}/fichiers`, { method: "POST", body: fd }); }
      catch (e) { toast(`Projet créé, mais dépôt des fichiers impossible : ${e.message}`); }
    }
    toast(`Projet « ${p.nom} » créé${deposes.length ? ` avec ${deposes.length} fichier(s)` : ""}`);
    // une seule pièce 3D : on l'ouvre directement (vue 3D, plan…), sinon la page du projet
    const pieces = deposes.filter((x) => MODELES_3D.includes(x.type));
    location.hash = pieces.length === 1 ? `#/fichier/${pieces[0].id}` : `#/projet/${p.id}`;
  } catch (e) { toast("Erreur : " + e.message); }
}

pages.projet = async (params, id) => {
  const [p, fichiers] = await Promise.all([api("projets/" + id), api(`projets/${id}/fichiers`)]);
  const parRole = {};
  for (const f of fichiers) (parRole[f.role] ||= []).push(f);
  const ids = new Set(fichiers.map((f) => f.id));
  const ligne = (f, prof = 0) => `
    <a class="ligne-fichier ${prof ? "enfant" : ""}" style="${prof ? `margin-left:${Math.min(prof, 5) * 18}px` : ""}" href="#/fichier/${f.id}">
      <span class="ico">${f.meta?.miniature ? `<img src="/api/fichiers/${f.id}/miniature" alt="">` : esc(f.type)}</span>
      <span style="min-width:0"><div class="nom">${esc(f.nom)} ${f.variante ? `<span class="etiq">${esc(f.variante)}</span>` : ""}</div>
        <div class="info">${f.meta?.dimensions ? f.meta.dimensions.map((d) => nb(d)).join(" × ") + " mm · " : ""}${octets(f.taille)} · ${date(f.cree)}</div></span>
      <span class="sous">${f.meta?.analyse === "en_cours" ? "analyse…" : ""}</span></a>`;
  const arbre = (liste) => {
    const racines = liste.filter((f) => !f.parent_id || !ids.has(f.parent_id));
    const enfants = (pid) => fichiers.filter((f) => f.parent_id === pid);
    const rec = (f, prof) => ligne(f, prof) + enfants(f.id).map((e) => rec(e, prof + 1)).join("");
    return racines.map((f) => rec(f, 0)).join("");
  };
  page.innerHTML = `
    <div class="fil"><a href="#/projets">Projets</a> /</div>
    <div class="entete"><div><h1>${esc(p.nom)}</h1><div class="sous">${pastille(STATUTS_PROJET[p.statut] || [p.statut, "p-neutre"])} · modifié le ${date(p.modifie)}</div></div>
      <div class="actions">${p.lien_cao ? `<a class="btn" href="${esc(p.lien_cao)}" target="_blank" rel="noopener">Ouvrir la CAO</a>` : ""}<button class="btn" id="modif">Modifier</button><button class="btn danger" id="suppr-projet">Supprimer</button></div></div>
    <div class="deux">
      <div class="pile">
        ${fichiers.some((f) => ["stl", "3mf"].includes(f.type)) ? `<section class="carte"><h2>Aperçu 3D du projet</h2>
          <div class="vision" id="vision-projet"><div class="calque" id="calque-projet"></div></div>
          <div class="choix-pieces" id="choix-pieces"></div>
          <div class="sous" style="margin-top:6px">Par défaut : les dernières versions de chaque pièce, assemblées dans leur position d'origine (repère CAO).</div></section>` : ""}
        ${Object.keys(ROLES).filter((r) => parRole[r]).map((r) => `<section class="carte"><h2>${ROLES[r]} <span class="sous">(${parRole[r].length})</span></h2><div class="liste-fichiers">${arbre(parRole[r])}</div></section>`).join("")
          || `<section class="carte"><div class="vide">Pas encore de fichier. Dépose tes STL, 3MF, plans PDF ou sources CAO à droite.</div></section>`}
      </div>
      <div class="pile">
        <section class="carte"><h2>Ajouter des fichiers</h2>
          <div class="grille-form" style="margin-bottom:10px">
            ${champHtml({ k: "role", l: "Ranger dans", t: "select", options: [["", "Automatique (selon le type)"], ...Object.entries(ROLES)] })}
            ${champHtml({ k: "parent_id", l: "Variation de", t: "select", options: [["", "— (nouveau fichier)"], ...fichiers.map((f) => [f.id, f.nom])] })}
            ${champHtml({ k: "variante", l: "Libellé de variation", ph: "ex. jeu 0,4 / V7 clips" })}
          </div>
          <div class="depot" id="depot">Glisse des fichiers ici ou clique pour choisir<br><span class="sous">STL, 3MF, STEP, G-code, PDF, images, FeatureScript…</span></div>
          <input type="file" id="choix" multiple hidden></section>
        ${p.description ? `<section class="carte"><h2>Description</h2><div style="white-space:pre-wrap">${esc(p.description)}</div></section>` : ""}
        ${p.tags ? `<section class="carte"><h2>Étiquettes</h2><div class="etiquettes">${p.tags.split(",").map((t) => `<a class="etiq" href="#/projets?q=${encodeURIComponent(t.trim())}">${esc(t.trim())}</a>`).join("")}</div></section>` : ""}
      </div>
    </div>`;
  $("#modif").onclick = () => editer("projets", champsProjet(), p, (r) => (r ? route() : (location.hash = "#/projets")));
  $("#suppr-projet").onclick = async () => {
    const n = fichiers.length;
    if (!(await confirmer(`Supprimer le projet « ${p.nom} »${n ? ` et ses ${n} fichier(s) (effacés du disque)` : ""} ? L'historique des impressions est conservé.`))) return;
    try {
      await api("projets/" + id, { method: "DELETE" });
      toast(`Projet « ${p.nom} » supprimé`);
      location.hash = "#/projets";
    } catch (e) { toast("Erreur : " + e.message); }
  };
  const envoyer = async (liste) => {
    if (!liste.length) return;
    const fd = new FormData();
    for (const f of liste) fd.append("fichiers", f);
    for (const k of ["role", "parent_id", "variante"]) fd.append(k, $(`[name=${k}]`).value);
    $("#depot").textContent = `Envoi de ${liste.length} fichier(s)…`;
    try { await api(`projets/${id}/fichiers`, { method: "POST", body: fd }); toast("Fichiers ajoutés"); } catch (e) { toast("Erreur : " + e.message); }
    route();
  };
  const depot = $("#depot");
  depot.onclick = () => $("#choix").click();
  $("#choix").onchange = (e) => envoyer([...e.target.files]);
  depot.ondragover = (e) => { e.preventDefault(); depot.classList.add("survol"); };
  depot.ondragleave = () => depot.classList.remove("survol");
  depot.ondrop = (e) => { e.preventDefault(); depot.classList.remove("survol"); envoyer([...e.dataTransfer.files]); };
  if (fichiers.some((f) => f.meta?.analyse === "en_cours")) minuterie = setTimeout(() => route(), 2500);
  else apercuProjet(fichiers);
};

async function apercuProjet(fichiers) {
  const zone = $("#vision-projet");
  if (!zone) return;
  const pieces = fichiers.filter((f) => ["stl", "3mf"].includes(f.type));
  const aDesEnfants = new Set(pieces.map((f) => f.parent_id).filter(Boolean));
  const { Vue3D, PALETTE } = await vision3d();
  const couleur = (i) => "#" + PALETTE[i % PALETTE.length].toString(16).padStart(6, "0");
  const vue = new Vue3D(zone, $("#calque-projet"));
  $("#choix-pieces").innerHTML = pieces.map((f, i) => `<label class="choix"><input type="checkbox" data-piece="${f.id}" ${aDesEnfants.has(f.id) ? "" : "checked"}>
    <span class="pastille-couleur" style="background:${couleur(i)}"></span>${esc(f.nom.replace(/\.(stl|3mf)$/i, ""))}${f.variante ? ` <span class="etiq">${esc(f.variante)}</span>` : ""}</label>`).join("");
  const maj = async () => {
    $("#calque-projet").textContent = "chargement…";
    await Promise.all(pieces.map(async (f, i) => {
      const coche = $(`[data-piece="${f.id}"]`).checked;
      if (coche) await vue.ajouter(f.id, `/api/fichiers/${f.id}/contenu`, f.type, PALETTE[i % PALETTE.length]);
      else vue.basculer(f.id, false);
    }));
    vue.cadrer();
  };
  $$("[data-piece]").forEach((c) => (c.onchange = maj));
  maj();
}

// ---- fichier
pages.fichier = async (params, id) => {
  const f = await api("fichiers/" + id);
  const [p, compat, parent] = await Promise.all([api("projets/" + f.projet_id), api(`fichiers/${id}/compatibilite`), f.parent_id ? api("fichiers/" + f.parent_id).catch(() => null) : null]);
  const m = f.meta || {};
  const r3 = m.reglages_3mf || {};
  const verdicts = { ok: ["rentre", "p-ok"], tourner: ["à tourner", "p-warn"], trop_grand: ["trop grand", "p-bad"], inconnu: ["?", "p-neutre"] };
  const machines = await api("machines");
  page.innerHTML = `
    <div class="fil"><a href="#/projets">Projets</a> / <a href="#/projet/${p.id}">${esc(p.nom)}</a> /</div>
    <div class="entete"><div><h1>${esc(f.nom)}</h1><div class="sous">${esc(ROLES[f.role] || f.role)}${f.variante ? " · variation « " + esc(f.variante) + " »" : ""}${parent ? ` · dérivé de <a href="#/fichier/${parent.id}">${esc(parent.nom)}</a>` : ""}</div></div>
      <div class="actions">
        <a class="btn" href="/api/fichiers/${id}/contenu?telecharger=true">Télécharger</a>
        <button class="btn" id="variation">Nouvelle variation</button>
        <button class="btn" id="modif">Modifier</button>
        ${["piece", "gcode"].includes(f.role) ? `<button class="btn" id="imprimer">Planifier</button><button class="btn prim" id="lancer">Lancer une impression</button>` : ""}
      </div></div>
    <div class="deux">
      <div class="pile">
        ${["stl", "3mf"].includes(f.type) ? `<div class="onglets" id="onglets"><button class="actif" data-onglet="3d">Vue 3D</button><button data-onglet="plan">Plan</button></div>` : ""}
        <div id="panneau-3d"><div class="vision" id="vision"><div class="calque" id="calque"></div></div>
          ${["stl", "3mf"].includes(f.type) ? `<section class="carte" style="margin-top:12px"><div class="entete" style="margin-bottom:8px"><h2 style="margin:0">Repères</h2>
            <button class="btn petit" id="poser">Poser un repère</button></div><div id="liste-reperes"></div></section>` : ""}</div>
        <div id="panneau-plan" hidden><div class="carte"><div class="actions" style="margin-bottom:10px">
          <button class="btn prim" id="plan-pdf">Télécharger le plan (PDF)</button><button class="btn" id="plan-png">PNG</button>
          <button class="btn" id="plan-garder">Enregistrer le PDF dans le projet</button><button class="btn" id="plan-cartouche">Cartouche…</button>
          <button class="btn" id="plan-generer">Régénérer</button></div>
          <div id="plan-etat" class="sous" style="margin-bottom:10px"></div>
          <div class="onglets" id="plan-feuilles" style="flex-wrap:wrap;margin-bottom:10px"></div>
          <div id="plan-controle" class="controle-plan" hidden></div>
          <div id="plan-toile" class="plan-toile"><div class="vide">Chargement…</div></div></div></div>
        ${f.notes ? `<section class="carte"><h2>Notes</h2><div style="white-space:pre-wrap">${esc(f.notes)}</div></section>` : ""}
        <section class="carte"><h2>Historique d'impression</h2>${tableImpressions(f.impressions.map((i) => ({ ...i, machine_nom: machines.find((x) => x.id === i.machine_id)?.nom })), false)}</section>
      </div>
      <div class="pile">
        <section class="carte"><h2>Caractéristiques</h2><dl class="infos">
          ${m.dimensions ? `<dt>Dimensions</dt><dd>${m.dimensions.map((d) => nb(d)).join(" × ")} mm</dd>` : ""}
          ${m.volume_mm3 ? `<dt>Volume</dt><dd>${nb(m.volume_mm3 / 1000, 1)} cm³</dd>` : ""}
          ${m.surface_mm2 ? `<dt>Surface</dt><dd>${nb(m.surface_mm2 / 100, 0)} cm²</dd>` : ""}
          ${m.triangles ? `<dt>Triangles</dt><dd>${nb(m.triangles, 0)}</dd>` : ""}
          ${Object.entries({ imprimante: "Imprimante (3MF)", profil_impression: "Profil d'impression", profil_filament: "Profil filament", hauteur_couche: "Couche", remplissage: "Remplissage", parois: "Parois", supports: "Supports" }).filter(([k]) => r3[k] !== undefined).map(([k, l]) => `<dt>${l}</dt><dd>${esc(k === "supports" ? (r3[k] === "1" ? "oui" : "non") : r3[k])}</dd>`).join("")}
          ${r3.duree_estimee_s || m.duree_texte ? `<dt>Durée estimée</dt><dd>${r3.duree_estimee_s ? duree(r3.duree_estimee_s / 60) : esc(m.duree_texte)}</dd>` : ""}
          ${r3.poids_estime_g || m.poids_estime_g ? `<dt>Poids (trancheur)</dt><dd>${nb(r3.poids_estime_g || m.poids_estime_g)} g</dd>` : ""}
          <dt>Taille</dt><dd>${octets(f.taille)}</dd><dt>Ajouté</dt><dd>${date(f.cree)}</dd><dt>Empreinte</dt><dd>${esc(f.sha256?.slice(0, 12))}</dd>
          ${m.erreur_analyse ? `<dt>Analyse</dt><dd>${esc(m.erreur_analyse)}</dd>` : ""}
        </dl></section>
        ${compat.dimensions ? `<section class="carte"><h2>Sur quelles machines ?</h2>${compat.machines.length ? `<table><tbody>${compat.machines.map((c) => `<tr><td>${esc(c.nom)}</td><td class="num">${c.volume[0] ? c.volume.map((v) => nb(v, 0)).join("×") : "?"}</td><td>${pastille(verdicts[c.verdict])}</td></tr>`).join("")}</tbody></table>` : `<div class="vide">Ajoute tes machines pour vérifier</div>`}</section>
        <section class="carte"><h2>Estimation matière <span class="sous">(2 parois, 15 % de remplissage)</span></h2>${compat.estimation.length ? `<table><tbody>${compat.estimation.map((e) => `<tr><td>${esc(e.filament)}</td><td class="num">${nb(e.grammes)} g</td><td class="num">${nb(e.cout, 2)} €</td><td>${e.stock_suffisant ? "" : pastille(["stock insuffisant", "p-warn"])}</td></tr>`).join("")}</tbody></table>` : `<div class="vide">Ajoute des filaments pour estimer</div>`}</section>` : ""}
        ${f.variantes.length ? `<section class="carte"><h2>Variations</h2><div class="liste-fichiers">${f.variantes.map((v) => `<a class="ligne-fichier" href="#/fichier/${v.id}"><span class="ico">var</span><span><div class="nom">${esc(v.nom)}</div><div class="info">${esc(v.variante)} · ${date(v.cree)}</div></span><span></span></a>`).join("")}</div></section>` : ""}
      </div>
    </div>`;
  $("#modif").onclick = async () => {
    const autres = (await api(`projets/${f.projet_id}/fichiers`)).filter((x) => x.id !== f.id);
    const r = await formulaire({
      titre: "Modifier le fichier", supprimer: true, valeurs: f, champs: [
        { k: "nom", l: "Nom" }, { k: "role", l: "Rangement", t: "select", options: Object.entries(ROLES) },
        { k: "parent_id", l: "Variation de", t: "select", options: [["", "—"], ...autres.map((x) => [x.id, x.nom])] },
        { k: "variante", l: "Libellé de variation" }, { k: "notes", l: "Notes", t: "textarea", large: true }],
    });
    if (!r) return;
    if (r.__supprimer) {
      if (await confirmer("Supprimer ce fichier du projet et du disque ?")) { await api("fichiers/" + id, { method: "DELETE" }); location.hash = "#/projet/" + f.projet_id; }
      return;
    }
    await api("fichiers/" + id, { method: "PUT", body: { ...r, parent_id: r.parent_id ? Number(r.parent_id) : null } });
    route();
  };
  $("#variation").onclick = () => {
    const entree = document.createElement("input");
    entree.type = "file";
    entree.onchange = async () => {
      const r = await formulaire({ titre: "Libellé de la variation", champs: [{ k: "variante", l: "Qu'est-ce qui change ?", ph: "jeu 0,4 mm, renfort, autre couleur…", requis: true }, { k: "notes", l: "Notes", t: "textarea", large: true }] });
      if (!r) return;
      const fd = new FormData();
      fd.append("fichiers", entree.files[0]);
      fd.append("parent_id", id); fd.append("variante", r.variante); fd.append("notes", r.notes); fd.append("role", f.role);
      const [nouv] = await api(`projets/${f.projet_id}/fichiers`, { method: "POST", body: fd });
      location.hash = "#/fichier/" + nouv.id;
    };
    entree.click();
  };
  $("#imprimer")?.addEventListener("click", async () => {
    const champs = await champsImpression();
    const ok = compat.machines.find((c) => c.verdict === "ok" || c.verdict === "tourner");
    editer("impressions", champs, { fichier_id: f.id, machine_id: ok?.id, resultat: "prevue", grammes: compat.estimation[0]?.grammes, quantite: 1 }, () => route());
  });
  $("#lancer")?.addEventListener("click", () => lancerImpression(f, compat));
  afficher(f, m);
  if (m.analyse === "en_cours") minuterie = setTimeout(() => route(), 2500);
};

async function afficher(f, m) {
  const zone = $("#vision");
  const url = `/api/fichiers/${f.id}/contenu`;
  if (f.type === "image") { zone.insertAdjacentHTML("afterbegin", `<img class="plan" src="${url}" alt="${esc(f.nom)}">`); return; }
  if (f.type === "pdf") { zone.insertAdjacentHTML("afterbegin", `<iframe src="${url}" title="${esc(f.nom)}"></iframe>`); zone.style.aspectRatio = "3/4"; return; }
  if (["fs", "source", "autre"].includes(f.type) && f.taille < 400000) {
    const txt = await (await fetch(url)).text();
    zone.style.aspectRatio = "auto";
    zone.innerHTML = `<pre style="margin:0;padding:14px;max-height:70vh;overflow:auto;font-family:var(--mono);font-size:12px;white-space:pre">${esc(txt)}</pre>`;
    return;
  }
  if (!["stl", "3mf"].includes(f.type)) {
    zone.innerHTML = m.miniature ? `<img class="plan" src="/api/fichiers/${f.id}/miniature" alt="">` : `<div class="vide" style="padding-top:30%">Pas d'aperçu pour ce type de fichier</div>`;
    return;
  }
  const { Vue3D } = await vision3d();
  const vue = new Vue3D(zone, $("#calque"));
  try { await vue.ajouter(f.id, url, f.type); } catch (e) { $("#calque").textContent = "aperçu impossible : " + e.message; return; }
  vue.cadrer();
  let reperes = m.reperes || [];
  const enregistrer = async () => { reperes = await api(`fichiers/${f.id}/reperes`, { method: "PUT", body: { reperes } }); dessiner(); };
  const dessiner = () => {
    vue.definirReperes(reperes);
    $("#liste-reperes").innerHTML = reperes.length ? `<table><tbody>${reperes.map((r, i) => `<tr><td style="width:36px"><span class="repere statique">${r.n}</span></td>
      <td>${esc(r.texte)}</td><td class="num">${esc(r.valeur || "")}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn petit" data-rep-modif="${i}">Modifier</button> <button class="btn petit danger" data-rep-retirer="${i}">×</button></td></tr>`).join("")}</tbody></table>`
      : `<div class="sous">Clique sur « Poser un repère » puis sur la pièce pour numéroter une zone (ex. « tenon », « jeu des flasques »). Les repères apparaissent sur le plan.</div>`;
    $$("[data-rep-retirer]").forEach((b) => (b.onclick = () => { reperes = reperes.filter((_, i) => i !== +b.dataset.repRetirer); enregistrer(); }));
    $$("[data-rep-modif]").forEach((b) => (b.onclick = async () => {
      const r = reperes[+b.dataset.repModif];
      const v = await formulaire({ titre: `Repère ${r.n}`, valeurs: r, champs: [{ k: "texte", l: "Nom de la zone", requis: true }, { k: "valeur", l: "Valeur / réglage (facultatif)", ph: "ex. 0,5 mm" }] });
      if (v) { Object.assign(r, v); enregistrer(); }
    }));
  };
  dessiner();
  const bouton = $("#poser");
  let enPose = false;
  bouton.onclick = () => {
    enPose = !enPose;
    bouton.classList.toggle("prim", enPose);
    bouton.textContent = enPose ? "Clique sur la pièce… (Échap pour finir)" : "Poser un repère";
    vue.activerPose(enPose ? async (pos) => {
      const v = await formulaire({ titre: `Repère ${reperes.length + 1}`, champs: [{ k: "texte", l: "Nom de la zone", requis: true, ph: "tenon, flasque, clip…" }, { k: "valeur", l: "Valeur / réglage (facultatif)", ph: "ex. jeu 0,3 mm" }] });
      if (v) { reperes.push({ pos, ...v }); enregistrer(); }
    } : null);
  };
  document.addEventListener("keydown", function echap(e) {
    if (!document.body.contains(bouton)) return document.removeEventListener("keydown", echap);
    if (e.key === "Escape" && enPose && !$("#modale").open) bouton.click();
  });

  // onglet Plan : généré à la demande
  let feuilles = [], courante = 0, visionneuse = null, apparition = null, apercu3d = null, cartouche = m.cartouche || {};
  const sansExt = f.nom.replace(/\.(stl|3mf)$/i, "");
  // réglages de l'animation (page Réglages › Plans), relus à chaque clic : un changement s'applique tout de suite
  const optionsAnimation = async () => {
    const r = (await reglages()).valeurs;
    return { dureeVol: r["plans.piece.duree_vol"] * 1000, tour: r["plans.piece.tour"], effacement: r["plans.piece.effacement"] * 1000, opacite: r["plans.piece.opacite"] / 100 };
  };
  // aperçu 3D à côté du plan, manipulable ; la pièce en sort quand on clique sur une vue
  const ouvrirApercu = async () => {
    if (apercu3d || !visionneuse.apercuOuvert) return;
    const { Vue3D } = await vision3d();
    const calque = document.createElement("div");
    calque.className = "calque";
    visionneuse.apercu.append(calque);
    apercu3d = new Vue3D(visionneuse.apercu, calque, { barre: false });   // panneau étroit : il suit la vue principale
    await apercu3d.ajouter(f.id, `/api/fichiers/${f.id}/contenu`, f.type);
    apercu3d.cadrer();
    apercu3d.decor.visible = false;   // ni grille ni axes : la pièce flotte sur l'interface
    // cadrage : la sphère qui englobe la pièce tient dans le champ le plus étroit du panneau (étroit et haut)
    const cadrerApercu = () => {
      apercu3d.ajuster();
      const cam = apercu3d.camera, cible = apercu3d.ctl.target;
      const rayon = apercu3d.boite().getSize(cam.position.clone()).length() / 2 || 10;
      const demiV = THREE_DEG(cam.fov) / 2, demiH = Math.atan(Math.tan(demiV) * (cam.aspect || 1));
      const dist = (rayon * 1.1) / Math.sin(Math.min(demiV, demiH));
      cam.position.sub(cible).setLength(dist).add(cible);
      apercu3d.ctl.update();
      apercu3d.rendu.render(apercu3d.scene, cam);   // image tout de suite, sans attendre la boucle
    };
    cadrerApercu();
    new ResizeObserver(() => { if (visionneuse.apercu.clientWidth > 20 && !apparition?.enVol) cadrerApercu(); }).observe(visionneuse.apercu);
  };
  const montrerFeuille = async (i) => {
    courante = i;
    if (!visionneuse) {
      const { VisionneusePlan } = await import("/static/visionneuse.js");
      visionneuse = new VisionneusePlan($("#plan-toile"), { apercuOuvert: await reglage("plans.apercu.ouvert"), feuilleSombre: (await reglage("plans.ecran.feuille")) === "Sans fond" });
      // clic sur une vue du plan : la pièce sort de l'aperçu et vient se poser sous le dessin
      visionneuse.surVue = async (v) => {
        if (!v) return apparition?.cacher();
        if (!apparition) {
          const { ApparitionPiece } = await import("/static/apparition3d.js");
          apparition = new ApparitionPiece(visionneuse, vue.visibles(), {
            source: () => (visionneuse.apercuOuvert && apercu3d ? { rect: apercu3d.rendu.domElement.getBoundingClientRect(), camera: apercu3d.camera, objet: apercu3d.objets.get(f.id) } : null),
          });
        }
        apparition.regler(await optionsAnimation());
        apparition.montrer(v);
      };
      visionneuse.surZoom = () => apparition?.placer();
      visionneuse.surApercu = (ouvert) => { if (!ouvert) apparition?.retirer(); ouvrirApercu(); };
      ouvrirApercu();
    }
    apparition?.retirer();
    visionneuse.montrer(feuilles[i].rendreSVG(), feuilles[i].largeur, feuilles[i].hauteur, feuilles[i].infos?.vues || []);
    $$("#plan-feuilles button").forEach((b, k) => b.classList.toggle("actif", k === i));
  };
  // champs du cartouche : saisis (meta.cartouche) + déduits du fichier et du projet
  const infosCartouche = async () => {
    const [p, filaments, { valeurs: r }] = await Promise.all([api("projets/" + f.projet_id), api("filaments"), reglages()]);
    const fil = filaments.find((x) => String(x.id) === String(cartouche.filament_id));
    return {
      // valeurs par défaut de la page Réglages, puis celles saisies pour ce plan
      societe: r["plans.cartouche.societe"], tolerance: r["plans.cartouche.tolerance"], dessinateur: r["plans.cartouche.dessinateur"],
      indice: "A", numero: `A3D-${f.projet_id}-${f.id}`, ...cartouche,
      designation: sansExt + (f.variante ? ` (${f.variante})` : ""), projet: p.nom, date: new Date(f.cree).toLocaleDateString("fr-FR"),
      masse: fil && m.volume_mm3 ? `${nb((m.volume_mm3 / 1000) * (fil.densite || 1.24))} g (plein)` : "",
    };
  };
  // contrôle de cotation (plan.js) : le plan suffit-il à refaire la pièce ?
  const afficherControle = (c) => {
    const zone = $("#plan-controle");
    if (!c) { zone.hidden = true; return; }
    const liste = (l) => l.map((x) => `${x.axe} = ${nb(x.val, 2)}`).join(", ");
    const cachees = c.ajoutees.filter((x) => x.cachee);
    const details = [
      c.ajoutees.length ? `${c.ajoutees.length} cote(s) ajoutée(s) par le contrôle (${liste(c.ajoutees)})${cachees.length ? `, dont ${cachees.length} sur des traits cachés` : ""}.` : "",
      c.manquantes.length ? `Non cotés : ${liste(c.manquantes)}.` : "",
      c.nonIndiquees.length ? `Formes sans indication : ${c.nonIndiquees.map(esc).join(" ; ")}.` : "",
    ].filter(Boolean);
    zone.className = "controle-plan " + (c.complet ? "ok" : "attention");
    zone.innerHTML = `<b>${c.complet ? "✓ Cotation complète" : "⚠ Cotation incomplète"}</b> · ${c.niveaux} niveaux cotés : chaque sommet de la pièce est donné par une cote ou par une forme indiquée (Ø, R, chanfrein).${details.length ? `<div class="sous">${details.join(" ")}</div>` : ""}`;
    zone.hidden = false;
  };
  // Le plan n'est calculé que sur demande ; il est alors gardé sur le serveur et réaffiché tel quel ensuite.
  // Sa clé résume tout ce dont il dépend (fichier, repères, formes, cartouche, réglages des plans, code du dessin) :
  // si elle a changé, on le signale et on propose de le mettre à jour, sans recalcul d'office.
  const empreinte = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  let cleCode = null;
  const clePlan = async () => {
    cleCode ??= empreinte((await Promise.all(["plan", "aretes", "traceur"].map((n) => fetch(`/static/${n}.js`).then((r) => r.text())))).join(""));
    const r = (await reglages()).valeurs;
    const regl = Object.keys(r).filter((k) => k.startsWith("plans.") && !/^plans\.(piece|apercu|ecran)\./.test(k)).sort().map((k) => [k, r[k]]);
    return `${f.sha256}-${empreinte(JSON.stringify({ reperes, formes: m.formes || null, cartouche: await infosCartouche(), regl }))}-${cleCode}`;
  };
  const afficherFeuilles = async (liste) => {
    feuilles = liste;
    $("#plan-feuilles").innerHTML = feuilles.length > 1 ? feuilles.map((t, i) => `<button data-feuille="${i}">Feuille ${i + 1} · ${esc(t.titre || "")}</button>`).join("") : "";
    $$("#plan-feuilles button").forEach((b) => (b.onclick = () => montrerFeuille(+b.dataset.feuille)));
    afficherControle(feuilles[0].infos?.controle);
    await montrerFeuille(Math.min(courante, feuilles.length - 1));
  };
  const etatPlan = (html, libelle) => { $("#plan-etat").innerHTML = html; $("#plan-generer").textContent = libelle; };
  const genererPlan = async () => {
    etatPlan("Calcul du plan…", "Régénérer");
    await new Promise((ok) => setTimeout(ok, 20));   // laisser s'afficher le message
    const { dessinerPlan } = await import("/static/plan.js");
    const cle = await clePlan();
    await afficherFeuilles(dessinerPlan(vue.visibles(), { reperes, formes: m.formes, cartouche: await infosCartouche() }));
    try {
      await api(`fichiers/${f.id}/plan`, { method: "PUT", body: { cle, feuilles: feuilles.map((F) => F.donnees()) } });
      etatPlan(`Plan généré et enregistré le ${new Date().toLocaleString("fr-FR")} : il ne sera plus recalculé tant que la pièce ne change pas.`, "Régénérer");
    } catch (e) { etatPlan(`Plan affiché mais non enregistré : ${esc(e.message)}`, "Régénérer"); }
  };
  const ouvrirPlan = async () => {
    const garde = await api(`fichiers/${f.id}/plan`);
    if (!garde.feuilles) {
      feuilles = [];
      $("#plan-toile").innerHTML = `<div class="vide">Pas encore de plan pour cette pièce. Il est calculé une fois, à la demande, puis gardé.<br><br><button class="btn prim" id="plan-premier">Générer le plan</button></div>`;
      $("#plan-premier").onclick = () => genererPlan();
      etatPlan("", "Générer le plan");
      return;
    }
    const { Feuille } = await import("/static/traceur.js");
    await afficherFeuilles(garde.feuilles.map((d) => Feuille.depuisDonnees(d)));
    const quand = new Date(garde.cree).toLocaleString("fr-FR");
    if (garde.cle === (await clePlan())) etatPlan(`Plan enregistré le ${quand} (réaffiché sans recalcul).`, "Régénérer");
    else etatPlan(`<span class="pastille p-warn">à mettre à jour</span> la pièce, ses repères, le cartouche, les réglages ou le dessin ont changé depuis ce plan (${quand}).`, "Mettre à jour le plan");
  };
  $("#plan-generer").onclick = () => genererPlan();
  const exigerPlan = () => { if (!feuilles.length) { toast("Génère d'abord le plan"); return false; } return true; };
  const pdfPlan = async () => {
    const { pdfDepuisFeuilles } = await import("/static/pdf.js");
    return pdfDepuisFeuilles(feuilles, { titre: sansExt });
  };
  $("#plan-cartouche").onclick = async () => {
    const filaments = await api("filaments");
    const r = await formulaire({
      titre: "Cartouche du plan", valeurs: { ...(await infosCartouche()), ...cartouche }, champs: [
        { k: "dessinateur", l: "Dessiné par" }, { k: "verificateur", l: "Vérifié par" }, { k: "date_verif", l: "Date de vérification", ph: "jj/mm/aaaa" },
        { k: "filament_id", l: "Matière (filament, pour la masse)", t: "select", options: [["", "— saisie libre ci-dessous —"], ...filaments.map((x) => [x.id, `${x.matiere} ${x.marque} ${x.couleur}`.trim()])] },
        { k: "matiere", l: "Matière (texte)", ph: "PLA, PETG…" }, { k: "numero", l: "N° de plan" }, { k: "indice", l: "Indice de révision" },
        { k: "tolerance", l: "Tolérances générales", ph: "ISO 2768-m" }, { k: "societe", l: "Organisme" }],
    });
    if (!r) return;
    if (r.filament_id) delete r.matiere;   // la matière suit le filament choisi
    cartouche = await api(`fichiers/${f.id}/cartouche`, { method: "PUT", body: r });
    await genererPlan();
  };
  $$("[data-onglet]").forEach((b) => (b.onclick = async () => {
    $$("[data-onglet]").forEach((x) => x.classList.toggle("actif", x === b));
    const plan = b.dataset.onglet === "plan";
    $("#panneau-3d").hidden = plan;
    $("#panneau-plan").hidden = !plan;
    $(".deux", page)?.classList.toggle("plan-large", plan);   // le plan prend toute la largeur
    if (plan) await ouvrirPlan();
  }));
  const telecharger = (href, nom) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = nom;
    a.click();
  };
  $("#plan-png").onclick = () => exigerPlan() && telecharger(feuilles[courante].rendreCanvas(200 / 25.4).toDataURL("image/png"), `plan-${sansExt}${feuilles.length > 1 ? "-feuille" + (courante + 1) : ""}.png`);
  $("#plan-pdf").onclick = async () => {
    if (!exigerPlan()) return;
    const url = URL.createObjectURL(await pdfPlan());
    telecharger(url, `plan-${sansExt}.pdf`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  $("#plan-garder").onclick = async () => {
    if (!exigerPlan()) return;
    const fd = new FormData();
    fd.append("fichiers", await pdfPlan(), `plan-${sansExt}.pdf`);
    fd.append("role", "plan"); fd.append("parent_id", f.id); fd.append("variante", "plan");
    await api(`projets/${f.projet_id}/fichiers`, { method: "POST", body: fd });
    toast("Plan enregistré dans le projet (Plans et documents)");
  };
  // #/fichier/<id>?plan : ouvre l'onglet Plan ; ?plan=generer : le (re)calcule aussitôt
  const demande = new URLSearchParams(location.hash.split("?")[1] || "");
  if (demande.has("plan")) {
    $$("[data-onglet]").forEach((x) => x.classList.toggle("actif", x.dataset.onglet === "plan"));
    $("#panneau-3d").hidden = true; $("#panneau-plan").hidden = false;
    $(".deux", page)?.classList.add("plan-large");
    if (demande.get("plan") === "generer") await genererPlan(); else await ouvrirPlan();
  }
}

// ---- machines
pages.machines = async () => {
  const [machines, etats, imp] = await Promise.all([api("machines"), api("etat-machines"), api("impressions")]);
  const enCoursSur = (m) => imp.find((i) => i.machine_id === m.id && i.resultat === "en_cours");
  page.innerHTML = `
    <div class="entete"><div><h1>Machines</h1><div class="sous">${machines.length} imprimante${machines.length > 1 ? "s" : ""} · clic sur une machine pour l'ouvrir</div></div>
      <div class="actions"><button class="btn prim" id="nouv">Ajouter une machine</button></div></div>
    <div class="grille-imp" id="cartes">${machines.length ? "" : `<div class="vide">Aucune machine</div>`}</div>
    <section class="carte" style="margin-top:18px"><h2>Connecter une Bambu Lab</h2><div class="sous">Sur l'écran de l'imprimante : Réglages → Réseau → activer le mode « LAN » ou noter l'IP et le code d'accès.
      Le numéro de série est dans Réglages → Appareil (ou sur l'étiquette au dos). Le PC qui fait tourner l'atelier doit être sur le même réseau.
      Les Anycubic d'origine n'ont pas d'API locale ouverte : elles restent en état manuel, sauf si elles tournent sous Klipper (Rinkhals).</div></section>`;
  const rendre = (etats) => machines.length && majCartesMachines($("#cartes"), machines, etats, enCoursSur);
  rendre(etats);
  $("#nouv").onclick = () => editer("machines", champsMachine(), null, (m) => { if (m?.id) location.hash = "#/machine/" + m.id; else route(); });
  minuterie = setInterval(async () => rendre(await api("etat-machines")), 3000);
};

// ---- une machine : en ce moment, commandes, historique, statistiques, caractéristiques
pages.machine = async (params, id) => {
  const [m, etats, imp, fichiers, presets, filaments] = await Promise.all([api("machines/" + id), api("etat-machines"), api("impressions"),
    api("fichiers"), api("presets"), api("filaments")]);
  const nomFichier = (fid) => fichiers.find((f) => f.id === fid)?.nom;
  const nomFil = (fid) => { const f = filaments.find((x) => x.id === fid); return f ? `${f.matiere} ${f.marque} ${f.couleur}`.trim() : "–"; };
  const siennes = imp.filter((i) => i.machine_id === m.id).map((i) => ({ ...i, fichier_nom: nomFichier(i.fichier_id), machine_nom: m.nom }));
  const finies = siennes.filter((i) => ["reussie", "ratee"].includes(i.resultat));
  const reussite = finies.length ? Math.round((100 * finies.filter((i) => i.resultat === "reussie").length) / finies.length) : null;
  const heures = finies.reduce((t, i) => t + (i.duree_min || 0), 0) / 60;
  const grammes = finies.reduce((t, i) => t + (i.grammes || 0) * (i.quantite || 1), 0);
  const connexion = { bambu_lan: "Bambu Lab réseau local", moonraker: "Klipper / Moonraker", manuel: "Aucune (état manuel)" }[m.pilote] || m.pilote;
  const sesPresets = presets.filter((p) => p.machine_id === m.id);
  const titre = `
        <h1>${esc(m.nom)}</h1>
        <div class="sous">${esc([m.marque, m.modele].filter(Boolean).join(" ") || "Modèle non renseigné")} · ${esc(volumeTexte(m))} · buse ${nb(m.buse, 2)} mm</div>
        <div id="etat-tete" style="margin-top:10px"></div>`;
  const boutons = `
        <div class="actions" style="margin-top:14px">
          <button class="btn" id="modif">Modifier</button>
          ${m.cle_modele ? `<button class="btn" id="image-modele" title="Montrée pour toutes les ${esc(m.modele)} qui n'ont pas leur propre photo">Image du modèle ${esc(m.modele)}</button>` : ""}
          <button class="btn" id="photo">${m.photo_propre ? "Changer la photo de cette machine" : "Photo de cette machine"}</button>
          ${m.photo_propre ? `<button class="btn" id="sans-photo">Retirer sa photo</button>` : ""}
        </div>`;
  page.innerHTML = `
    <div class="fil"><a href="#/machines">Machines</a> /</div>
    ${m.jumeau ? `
    <div class="scene-imp">
      <div class="jumeau" id="jumeau"><div class="vide">Chargement du modèle 3D…</div></div>
      <aside class="panneau-imp">${titre}<div class="panneau-direct" id="direct"></div>${boutons}</aside>
    </div>` : `
    <div class="tete-imp">
      <div class="grande-vignette" id="vignette"></div>
      <div class="tete-imp-texte">${titre}${boutons}</div>
    </div>`}
    <div class="deux">
      <div class="pile">
        ${m.jumeau ? "" : `<section class="carte"><h2>En ce moment</h2><div id="direct"></div></section>`}
        <section class="carte"><h2>Historique</h2>${tableImpressions(siennes)}</section>
      </div>
      <div class="pile">
        <section class="carte"><h2>Statistiques</h2><div class="chiffres mini">
          <div class="chiffre"><b>${siennes.length}</b><span>impressions</span></div>
          <div class="chiffre"><b>${reussite ?? "–"}${reussite !== null ? " %" : ""}</b><span>réussite</span></div>
          <div class="chiffre"><b>${nb(heures, 1)} h</b><span>d'impression</span></div>
          <div class="chiffre"><b>${nb(grammes / 1000, 2)} kg</b><span>filament</span></div></div></section>
        <section class="carte"><h2>Caractéristiques</h2><dl class="infos">
          <dt>Marque</dt><dd>${esc(m.marque || "–")}</dd><dt>Modèle</dt><dd>${esc(m.modele || "–")}</dd>
          <dt>Technologie</dt><dd>${m.techno === "resine" ? "Résine" : "Filament (FDM)"}</dd>
          <dt>Volume</dt><dd>${esc(volumeTexte(m))}</dd><dt>Buse</dt><dd>${nb(m.buse, 2)} mm</dd>
          <dt>Connexion</dt><dd>${esc(connexion)}</dd>
          ${m.pilote !== "manuel" ? `<dt>Adresse</dt><dd>${esc(m.adresse || "–")}</dd>` : ""}
          ${m.pilote === "bambu_lan" ? `<dt>N° de série</dt><dd>${esc(m.numero_serie || "–")}</dd><dt>Code d'accès</dt><dd>${m.code_acces_renseigne ? "renseigné" : "manquant"}</dd>` : ""}
        </dl></section>
        <section class="carte"><h2>Presets</h2>${sesPresets.length ? `<div class="liste-fichiers">${sesPresets.map((p) => `<a class="ligne-fichier" href="#/presets"><span class="ico">${nb(p.hauteur_couche, 2)}</span><span><div class="nom">${esc(p.nom)}</div><div class="info">${esc(nomFil(p.filament_id))} · ${p.remplissage ?? "–"} % ${esc(p.motif || "")}</div></span><span></span></a>`).join("")}</div>` : `<div class="vide">Aucun preset pour cette machine. <a href="#/presets">Presets</a></div>`}</section>
        ${m.notes ? `<section class="carte"><h2>Notes</h2><div style="white-space:pre-wrap">${esc(m.notes)}</div></section>` : ""}
      </div>
    </div>`;

  const enCours = siennes.find((i) => i.resultat === "en_cours");
  // Jumeau 3D : la pièce sur le plateau = celle de l'impression notée en cours, sinon le fichier dont le nom
  // ressemble au travail annoncé par l'imprimante (« poignee_dex1_support » ↔ « Poignee Dex1 Support.stl »).
  let jumeau = null;
  const pieceImprimee = (e = {}) => {
    const modeles = fichiers.filter((f) => ["stl", "3mf"].includes(f.type));
    if (enCours?.fichier_id) return modeles.find((f) => f.id === enCours.fichier_id);
    const norm = (t) => String(t || "").toLowerCase().replace(/\.(stl|3mf|gcode)$/, "").replace(/[^a-z0-9]/g, "");
    const t = norm(e.travail);
    return t ? modeles.find((f) => norm(f.nom) === t) || modeles.find((f) => norm(f.nom).includes(t) || (t.length > 5 && t.includes(norm(f.nom)))) : null;
  };
  if (m.jumeau) {
    import("/static/jumeau3d.js").then(({ JumeauImprimante }) => JumeauImprimante.creer($("#jumeau"), m.jumeau)).then((j) => {
      if (!$("#jumeau")) return j.detruire();
      $("#jumeau .vide")?.remove();
      jumeau = j;
      rendre(dernier);
    }).catch((err) => { const z = $("#jumeau"); if (z) z.innerHTML = `<div class="vide">Modèle 3D indisponible : ${esc(err.message)}</div>`; });
  }
  let dernier = etats[m.id];
  const rendre = (e = {}) => {
    dernier = e;
    const etat = etatDe(m, e);
    if (jumeau) {
      jumeau.maj(m.pilote === "manuel" && enCours ? { etat: "impression", progression: 50 } : e);
      const f = ["impression", "pause", "preparation", "terminee"].includes(e.etat) || enCours ? pieceImprimee(e) : null;
      jumeau.piece(f ? `/api/fichiers/${f.id}/contenu` : null, f?.type);
    }
    const v = imageMachine(m, e);
    if ($("#vignette") && $("#vignette").dataset.v !== v) { $("#vignette").innerHTML = v; $("#vignette").dataset.v = v; }
    $("#etat-tete").innerHTML = `<span class="pastille grande ${ETATS_MACHINE[etat] || "p-neutre"}">${esc(libelleEtat(etat))}</span>
      ${e.message ? `<span class="sous" style="margin-left:8px">${esc(e.message)}</span>` : ""}`;
    $("#direct").innerHTML = directMachine(m, e, enCours);
  };
  rendre(etats[m.id]);
  minuterie = setInterval(async () => rendre((await api("etat-machines"))[m.id]), 3000);

  $("#modif").onclick = () => editer("machines", champsMachine(), m, (r) => (r ? route() : (location.hash = "#/machines")));
  const choisirImage = (chemin, message) => {
    const entree = Object.assign(document.createElement("input"), { type: "file", accept: "image/jpeg,image/png,image/webp" });
    entree.onchange = async () => {
      const fd = new FormData();
      fd.append("photo", entree.files[0]);
      try { await api(chemin, { method: "PUT", body: fd }); toast(message); route(); }
      catch (e) { toast("Erreur : " + e.message); }
    };
    entree.click();
  };
  $("#photo").onclick = () => choisirImage(`machines/${m.id}/photo`, "Photo enregistrée");
  $("#image-modele")?.addEventListener("click", () => choisirImage(`modeles/${m.cle_modele}/image`, `Image enregistrée pour toutes les ${m.modele}`));
  $("#sans-photo")?.addEventListener("click", async () => { await api(`machines/${m.id}/photo`, { method: "DELETE" }); route(); });
  $("#direct").onclick = async (ev) => {
    const b = ev.target.closest("[data-statut]");
    if (b) { await api("machines/" + m.id, { method: "PUT", body: { statut_manuel: b.dataset.statut } }); route(); }
    if (ev.target.closest("#lancer-ici")) lancerSurMachine(m, fichiers, filaments, siennes);
  };
};

function directMachine(m, e = {}, enCours = null) {
  const actif = ["impression", "pause", "preparation"].includes(e.etat);
  const temp = (nom, v, c) => (v === undefined ? "" : `<div class="temp-bloc"><span>${nom}</span><b>${nb(v, 0)} °C</b><small>consigne ${c ? nb(c, 0) + " °C" : "arrêt"}</small></div>`);
  const temps = e.temp_buse !== undefined ? `<div class="temps">${temp("Buse", e.temp_buse, e.consigne_buse)}${temp("Plateau", e.temp_plateau, e.consigne_plateau)}</div>` : "";
  if (m.pilote === "manuel") {
    const statuts = [["libre", "Libre"], ["maintenance", "Maintenance"], ["hors_service", "Hors service"]];
    return `${enCours ? `<div class="travail grand"><span>${esc(enCours.fichier_nom || "Impression")}</span><span class="sous">depuis ${heure(enCours.debut)}</span></div>
        <div class="actions" style="margin-top:10px">${boutonsSuivi(enCours)}</div>`
      : `<div class="sous">Machine sans connexion : son état se note ici.</div>
        <div class="actions" style="margin-top:10px"><button class="btn prim" id="lancer-ici">Lancer une impression</button></div>`}
      ${!enCours ? `<div class="segments" style="margin-top:14px">${statuts.map(([k, l]) => `<button class="${m.statut_manuel === k ? "actif" : ""}" data-statut="${k}">${l}</button>`).join("")}</div>` : ""}`;
  }
  if (!e.connexion || ["incomplete", "erreur", "deconnectee", "connexion..."].includes(e.connexion) && !e.etat)
    return `<div class="sous">${esc(e.message || libelleEtat(e.connexion))}</div>${e.connexion === "incomplete" ? `<div class="actions" style="margin-top:10px"><button class="btn" onclick="document.getElementById('modif').click()">Renseigner la connexion</button></div>` : ""}`;
  return `${actif || e.etat === "terminee" ? `<div class="travail grand"><span>${esc(e.travail || "Impression")}</span><b>${e.progression ?? 0} %</b></div>
      <div class="jauge grande"><i style="width:${e.progression || 0}%"></i></div>
      <div class="detail">${detailImpression(e)}</div>` : `<div class="sous">Aucune impression en cours.</div>`}
    ${temps}
    ${e.code_erreur ? `<div class="pastille p-bad" style="margin-top:8px">erreur ${esc(e.code_erreur)}</div>` : ""}
    ${actif ? `<div class="actions" style="margin-top:14px">
      ${e.etat === "pause" ? `<button class="btn prim" data-cmd="reprendre" data-id="${m.id}">Reprendre</button>` : `<button class="btn" data-cmd="pause" data-id="${m.id}">Pause</button>`}
      <button class="btn danger" data-cmd="arreter" data-id="${m.id}">Arrêter</button></div>` : ""}`;
}

// Lancer une impression sur cette machine (machine sans connexion) : choix de la pièce, filament repris d'avant.
async function lancerSurMachine(m, fichiers, filaments, siennes) {
  const pieces = fichiers.filter((f) => ["piece", "gcode"].includes(f.role));
  const derniere = siennes[0] || {};
  const r = await formulaire({
    titre: `Lancer une impression sur ${m.nom}`, valider: "Lancer maintenant",
    valeurs: { fichier_id: derniere.fichier_id, filament_id: derniere.filament_id, quantite: 1 },
    champs: [
      { k: "fichier_id", l: "Pièce", t: "select", large: true, options: [["", "—"], ...pieces.map((f) => [f.id, `${f.projet} / ${f.nom}${f.variante ? " (" + f.variante + ")" : ""}`])] },
      { k: "filament_id", l: "Filament", t: "select", options: [["", "—"], ...filaments.map((x) => [x.id, `${x.matiere} ${x.marque} ${x.couleur}`.trim()])] },
      { k: "quantite", l: "Quantité", t: "number", pas: 1 },
      { k: "grammes", l: "Filament (g / pièce)", t: "number", aide: "estimé d'après la pièce ; retiré du stock à la fin" },
      { k: "notes", l: "Notes", t: "textarea", large: true },
    ],
    surChange: async (nom, v, f) => {
      if (!["fichier_id", "filament_id"].includes(nom) || !v.fichier_id) return;
      const c = await api(`fichiers/${v.fichier_id}/compatibilite`);
      const e = c.estimation.find((x) => String(x.filament_id) === String(v.filament_id)) || c.estimation[0];
      if (e) f.elements.grammes.value = e.grammes;
    },
  });
  if (!r) return;
  try {
    await api("impressions", { method: "POST", body: { ...r, machine_id: m.id, resultat: "en_cours" } });
    toast("Impression lancée");
    route();
  } catch (e) { toast("Erreur : " + e.message); }
}

// ---- filaments
pages.filaments = async () => {
  const [fil, seuil] = await Promise.all([api("filaments"), reglage("general.filaments.stock_bas")]);
  page.innerHTML = `
    <div class="entete"><div><h1>Filaments</h1><div class="sous">Stock et caractéristiques · ${nb(fil.reduce((s, f) => s + (f.stock_g || 0), 0) / 1000, 2)} kg en stock</div></div>
      <div class="actions"><button class="btn prim" id="nouv">Ajouter un filament</button></div></div>
    <section class="carte"><div class="tab-cont"><table><thead><tr><th>Filament</th><th>Matière</th><th>Buse / plateau</th><th>Densité</th><th>Stock</th><th>Prix</th></tr></thead><tbody>
      ${fil.map((f) => `<tr class="cliquable" data-id="${f.id}"><td><span class="pastille-couleur" style="background:${esc(f.couleur_hex)}"></span>${esc(f.marque)} ${esc(f.couleur)}</td><td>${esc(f.matiere)}</td>
        <td class="num">${f.temp_buse ?? "–"} / ${f.temp_plateau ?? "–"} °C</td><td class="num">${nb(f.densite, 2)}</td>
        <td class="num">${nb(f.stock_g, 0)} g ${f.stock_g < seuil ? pastille(["bas", "p-warn"]) : ""}</td><td class="num">${nb(f.prix_kg, 2)} €/kg</td></tr>`).join("") || `<tr><td colspan="6" class="vide">Aucun filament</td></tr>`}
    </tbody></table></div></section>`;
  $("#nouv").onclick = () => editer("filaments", champsFilament(), null, () => route());
  $$("tr[data-id]").forEach((tr) => (tr.onclick = () => editer("filaments", champsFilament(), fil.find((x) => x.id == tr.dataset.id), () => route())));
};

// ---- presets
pages.presets = async () => {
  const [presets, machines, filaments] = await Promise.all([api("presets"), api("machines"), api("filaments")]);
  const nomM = (id) => machines.find((m) => m.id === id)?.nom || "Toutes machines";
  const nomF = (id) => { const f = filaments.find((x) => x.id === id); return f ? `${f.matiere} ${f.marque} ${f.couleur}` : "Tout filament"; };
  const groupes = {};
  for (const p of presets) (groupes[nomM(p.machine_id)] ||= []).push(p);
  page.innerHTML = `
    <div class="entete"><div><h1>Presets</h1><div class="sous">Réglages éprouvés par couple machine × filament, à reporter dans le trancheur</div></div>
      <div class="actions"><button class="btn prim" id="nouv">Nouveau preset</button></div></div>
    <div class="pile">${Object.entries(groupes).map(([m, liste]) => `<section class="carte"><h2>${esc(m)}</h2><div class="tab-cont"><table>
      <thead><tr><th>Preset</th><th>Filament</th><th>Couche</th><th>Remplissage</th><th>Parois</th><th>Températures</th><th>Supports</th><th></th></tr></thead><tbody>
      ${liste.map((p) => `<tr class="cliquable" data-id="${p.id}"><td><b>${esc(p.nom)}</b>${p.notes ? `<div class="sous">${esc(p.notes.slice(0, 80))}</div>` : ""}</td><td>${esc(nomF(p.filament_id))}</td>
        <td class="num">${nb(p.hauteur_couche, 2)} mm</td><td class="num">${p.remplissage ?? "–"} % ${esc(p.motif || "")}</td><td class="num">${p.parois ?? "–"}</td>
        <td class="num">${p.temp_buse ?? "–"} / ${p.temp_plateau ?? "–"} °C</td><td>${esc(p.supports)}${p.adherence !== "aucune" ? " · " + esc(p.adherence) : ""}</td>
        <td><button class="btn petit" data-copier="${p.id}">Copier</button></td></tr>`).join("")}</tbody></table></div></section>`).join("") || `<section class="carte"><div class="vide">Aucun preset. Crée par exemple « PLA standard 0,2 » pour chaque machine.</div></section>`}</div>`;
  const ch = await champsPreset();
  $("#nouv").onclick = () => editer("presets", ch, null, () => route());
  $$("tr[data-id]").forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest("[data-copier]")) editer("presets", ch, presets.find((x) => x.id == tr.dataset.id), () => route()); }));
  $$("[data-copier]").forEach((b) => (b.onclick = async () => {
    const p = presets.find((x) => x.id == b.dataset.copier);
    const texte = `${p.nom} — ${nomM(p.machine_id)} / ${nomF(p.filament_id)}\nCouche ${p.hauteur_couche} mm · remplissage ${p.remplissage} % ${p.motif} · ${p.parois} parois\nBuse ${p.temp_buse ?? "-"} °C · plateau ${p.temp_plateau ?? "-"} °C · vitesse ${p.vitesse ?? "-"} mm/s\nSupports : ${p.supports} · adhérence : ${p.adherence}${p.notes ? "\n" + p.notes : ""}`;
    try { await navigator.clipboard.writeText(texte); toast("Fiche copiée"); } catch { toast(texte); }
  }));
};

// ---- journal
pages.impressions = async () => {
  const [imp, fichiers, machines] = await Promise.all([api("impressions"), api("fichiers"), api("machines")]);
  const liste = imp.map((i) => ({ ...i, fichier_nom: fichiers.find((f) => f.id === i.fichier_id)?.nom, machine_nom: machines.find((m) => m.id === i.machine_id)?.nom }));
  page.innerHTML = `
    <div class="entete"><div><h1>Journal d'impression</h1><div class="sous">Chaque impression notée : machine, matière, durée, résultat. Les grammes sont retirés du stock à la fin.</div></div>
      <div class="actions"><button class="btn prim" id="nouv">Noter une impression</button></div></div>
    <section class="carte">${tableImpressions(liste)}</section>`;
  $("#nouv").onclick = async () => editer("impressions", await champsImpression(), { debut: heureLocale() }, () => route());
};

// ------------------------------------------------------------------ routeur
// ---- réglages : page construite depuis la liste du serveur, enregistrement à chaque changement
pages.reglages = async (params) => {
  const { sections, valeurs } = await reglages(true);
  const courante = sections.some((s) => s.id === params.get("section")) ? params.get("section") : sections[0].id;
  const defauts = Object.fromEntries(sections.flatMap((s) => s.groupes.flatMap((g) => g.reglages)).map((r) => [r.cle, r.defaut]));
  const champ = (r) => {
    const v = valeurs[r.cle], id = `r-${r.cle.replace(/\./g, "-")}`;
    if (r.type === "booleen") return `<label class="bascule"><input type="checkbox" id="${id}" data-cle="${r.cle}" ${v ? "checked" : ""}><span></span></label>`;
    if (r.type === "choix") return `<select id="${id}" data-cle="${r.cle}">${r.choix.map((c) => `<option ${c === v ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
    if (r.type === "nombre") return `<input type="number" id="${id}" data-cle="${r.cle}" value="${v}" min="${r.min}" max="${r.max}" step="${r.pas || "any"}"><span class="unite">${esc(r.unite || "")}</span>`;
    return `<input type="text" id="${id}" data-cle="${r.cle}" value="${esc(v)}" maxlength="${r.max || 200}">`;
  };
  const texteDefaut = (r) => (r.type === "booleen" ? (r.defaut ? "oui" : "non") : `${r.defaut}${r.unite ? " " + r.unite : ""}` || "vide");
  page.innerHTML = `
    <div class="entete"><div><h1>Réglages</h1><div class="sous">Communs à tous les postes de l'atelier · enregistrés dès qu'on les change</div></div>
      <div class="actions"><input type="search" id="cherche-reglage" placeholder="Chercher un réglage…" autocomplete="off"></div></div>
    <div class="reglages">
      <nav class="reglages-menu">${sections.map((s) => `<a href="#/reglages?section=${s.id}" data-section="${s.id}" class="${s.id === courante ? "actif" : ""}">${esc(s.titre)}<span>${s.groupes.reduce((n, g) => n + g.reglages.length, 0)}</span></a>`).join("")}</nav>
      <div class="reglages-contenu">${sections.map((s) => s.groupes.map((g) => `
        <section class="carte groupe-reglages" data-section="${s.id}">
          <h2>${esc(g.titre)}</h2>${g.aide ? `<div class="sous" style="margin:-6px 0 10px">${esc(g.aide)}</div>` : ""}
          ${g.reglages.map((r) => `<div class="reglage" data-cle="${r.cle}" data-texte="${esc((s.titre + " " + g.titre + " " + r.libelle + " " + (r.aide || "")).toLowerCase())}">
            <div class="reglage-libelle"><label for="r-${r.cle.replace(/\./g, "-")}">${esc(r.libelle)}</label>${r.aide ? `<div class="sous">${esc(r.aide)}</div>` : ""}</div>
            <div class="reglage-champ">${champ(r)}<button class="btn petit" data-defaut="${r.cle}" title="Revenir à la valeur par défaut (${esc(texteDefaut(r))})" ${valeurs[r.cle] === r.defaut ? "hidden" : ""}>↺</button></div>
          </div>`).join("")}
        </section>`).join("")).join("")}
        <div class="vide" id="aucun-reglage" hidden>Aucun réglage ne correspond.</div>
      </div>
    </div>`;
  // une section à la fois, ou tout ce qui correspond à la recherche
  const filtrer = () => {
    const q = $("#cherche-reglage").value.trim().toLowerCase();
    let visibles = 0;
    $$(".groupe-reglages").forEach((g) => {
      let n = 0;
      $$(".reglage", g).forEach((l) => { const ok = q ? l.dataset.texte.includes(q) : g.dataset.section === courante; l.hidden = !ok; n += ok; });
      g.hidden = !n;
      visibles += n;
    });
    $("#aucun-reglage").hidden = visibles > 0;
  };
  $("#cherche-reglage").oninput = filtrer;
  filtrer();
  const enregistrer = async (cle, valeur) => {
    try {
      const r = await api("reglages", { method: "PUT", body: { [cle]: valeur } });
      reglagesCache.valeurs = r.valeurs;
      const el = $(`[data-cle="${cle}"]`, page);
      if (el.type === "checkbox") el.checked = r.valeurs[cle]; else el.value = r.valeurs[cle];
      $(`[data-defaut="${cle}"]`).hidden = r.valeurs[cle] === defauts[cle];
      toast(valeur === null ? "Valeur par défaut rétablie" : "Réglage enregistré");
    } catch (e) {
      toast("Refusé : " + e.message);
      const el = $(`[data-cle="${cle}"]`, page);
      if (el.type === "checkbox") el.checked = reglagesCache.valeurs[cle]; else el.value = reglagesCache.valeurs[cle];
    }
  };
  $$("[data-cle]", page).forEach((el) => (el.onchange = () => enregistrer(el.dataset.cle, el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value)));
  $$("[data-defaut]").forEach((b) => (b.onclick = () => enregistrer(b.dataset.defaut, null)));
};

async function route() {
  clearInterval(minuterie); clearTimeout(minuterie);
  page.ondragover = page.ondragleave = page.ondrop = null;   // glisser-déposer propre à chaque page
  page.classList.remove("depot-actif");
  const [chemin, requete] = location.hash.replace(/^#\/?/, "").split("?");
  const [nom, id] = chemin.split("/");
  $$("nav.cote a[data-route]").forEach((a) => a.classList.toggle("actif", a.dataset.route === (nom === "projet" || nom === "fichier" ? "projets" : nom === "machine" ? "machines" : nom)));
  const fn = pages[nom] || pages[""];
  try { await fn(new URLSearchParams(requete || ""), id); }
  catch (e) { page.innerHTML = `<div class="carte vide">Erreur : ${esc(e.message)}</div>`; }
}
window.addEventListener("hashchange", route);
route();
