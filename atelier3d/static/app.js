// Atelier 3D : interface (page unique, routes dans le #hash).

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const page = $("#page");

// ------------------------------------------------------------------ utilitaires
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nb = (v, d = 1) => (v === null || v === undefined || v === "" ? "–" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d }));
const octets = (n) => (n > 1e6 ? nb(n / 1e6) + " Mo" : nb(n / 1e3, 0) + " ko");
const date = (s) => (s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "–");
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
    entree = `<textarea name="${c.k}" rows="3">${esc(val)}</textarea>`;
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
        o[c.k] = c.t === "number" && el.value !== "" ? Number(el.value) : el.value;
      }
      return o;
    };
    if (surChange) f.addEventListener("change", (e) => surChange(e.target.name, lire(), f));
    $("[data-annuler]", d).onclick = () => { d.close(); resoudre(null); };
    if (supprimer) $("[data-suppr]", d).onclick = () => { d.close(); resoudre({ __supprimer: true }); };
    f.onsubmit = (e) => { e.preventDefault(); d.close(); resoudre(lire()); };
    d.onclose = () => resoudre(null);
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
    d.onclose = () => resoudre(false);
    d.showModal();
  });
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
        <section class="carte"><h2>Machines</h2><div class="grille" id="cartes-machines">${machines.length ? "" : `<div class="vide">Aucune machine. <a href="#/machines">Ajouter une imprimante</a></div>`}</div></section>
        <section class="carte"><h2>Dernières impressions</h2>${tableImpressions(t.recentes)}</section>
      </div>
      <div class="pile">
        <section class="carte"><h2>File d'attente</h2>${t.a_imprimer.length ? `<div class="liste-fichiers">${t.a_imprimer.map((i) => `
          <a class="ligne-fichier" href="#/impressions"><span class="ico">${i.quantite > 1 ? "×" + i.quantite : "1"}</span>
          <span><div class="nom">${esc(i.fichier_nom || "fichier ?")}</div><div class="info">${esc(i.machine_nom || "machine à choisir")}</div></span>${pastille(RESULTATS[i.resultat])}</a>`).join("")}</div>` : `<div class="vide">Rien en attente</div>`}</section>
        <section class="carte"><h2>Stock bas (&lt; 200 g)</h2>${t.stock_bas.length ? t.stock_bas.map((f) => `<div style="padding:4px 0"><span class="pastille-couleur" style="background:${esc(f.couleur_hex)}"></span>${esc(f.matiere)} ${esc(f.marque)} ${esc(f.couleur)} <span class="pastille p-warn">${nb(f.stock_g, 0)} g</span></div>`).join("") : `<div class="vide">Stock correct</div>`}</section>
      </div>
    </div>`;
  $("[data-nouv-imp]").onclick = async () => editer("impressions", await champsImpression(), null, () => route());
  const rendreMachines = (etats) => { if (machines.length) $("#cartes-machines").innerHTML = machines.map((m) => carteMachine(m, etats[m.id])).join(""); };
  rendreMachines(etats);
  minuterie = setInterval(async () => rendreMachines(await api("etat-machines")), 4000);
};

function carteMachine(m, e = {}) {
  const etat = e.etat || e.connexion || "inconnu";
  const enCours = ["impression", "pause", "preparation"].includes(e.etat);
  const vol = m.volume_x ? `${nb(m.volume_x, 0)} × ${nb(m.volume_y, 0)} × ${nb(m.volume_z, 0)} mm` : "volume non renseigné";
  return `<div class="carte machine">
    <div class="tete"><div><h3>${esc(m.nom)}</h3><div class="sous">${esc(m.marque)} ${esc(m.modele)} · ${vol}</div></div>
    <span class="pastille ${ETATS_MACHINE[etat] || "p-neutre"}">${esc(etat.replace("_", " "))}</span></div>
    ${enCours ? `<div class="jauge"><i style="width:${e.progression || 0}%"></i></div>
      <div style="font-size:13px">${esc(e.travail || "")} · ${e.progression ?? 0} %${e.reste_min ? " · reste " + duree(e.reste_min) : ""}${e.couche ? ` · couche ${e.couche}/${e.couches}` : ""}</div>` : ""}
    ${e.temp_buse !== undefined ? `<div class="temp"><span>buse ${nb(e.temp_buse, 0)}/${nb(e.consigne_buse, 0)} °C</span><span>plateau ${nb(e.temp_plateau, 0)}/${nb(e.consigne_plateau, 0)} °C</span></div>` : ""}
    ${e.message ? `<div class="sous" style="margin-top:6px">${esc(e.message)}</div>` : ""}
    ${e.code_erreur ? `<div class="pastille p-bad" style="margin-top:6px">erreur ${esc(e.code_erreur)}</div>` : ""}
    ${enCours && m.pilote !== "manuel" ? `<div class="actions" style="margin-top:10px">
      ${e.etat === "pause" ? `<button class="btn petit" data-cmd="reprendre" data-id="${m.id}">Reprendre</button>` : `<button class="btn petit" data-cmd="pause" data-id="${m.id}">Pause</button>`}
      <button class="btn petit danger" data-cmd="arreter" data-id="${m.id}">Arrêter</button></div>` : ""}
  </div>`;
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
      <td class="num">${i.grammes ? nb(i.grammes) + " g" : "–"}</td><td>${pastille(RESULTATS[i.resultat] || [i.resultat, "p-neutre"])}</td></tr>`).join("")}
    </tbody></table></div>`;
}
document.addEventListener("click", async (ev) => {
  const tr = ev.target.closest("[data-imp]");
  if (!tr) return;
  const imp = await api("impressions/" + tr.dataset.imp);
  editer("impressions", await champsImpression(), imp, () => route());
});

// ---- projets
pages.projets = async (params) => {
  const q = params.get("q") || "";
  const projets = await api("projets?q=" + encodeURIComponent(q));
  page.innerHTML = `
    <div class="entete"><div><h1>Projets</h1><div class="sous">${projets.length} projet(s)</div></div>
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
  const creer = () => editer("projets", champsProjet(), null, (p) => p && (location.hash = "#/projet/" + p.id));
  $("#nouv").onclick = creer;
  if (params.has("nouveau")) creer();
};

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
      <div class="actions">${p.lien_cao ? `<a class="btn" href="${esc(p.lien_cao)}" target="_blank" rel="noopener">Ouvrir la CAO</a>` : ""}<button class="btn" id="modif">Modifier</button></div></div>
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
  const { Vue3D, PALETTE } = await import("/static/vision.js");
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
        ${["piece", "gcode"].includes(f.role) ? `<button class="btn prim" id="imprimer">Planifier l'impression</button>` : ""}
      </div></div>
    <div class="deux">
      <div class="pile">
        ${["stl", "3mf"].includes(f.type) ? `<div class="onglets" id="onglets"><button class="actif" data-onglet="3d">Vue 3D</button><button data-onglet="plan">Plan</button></div>` : ""}
        <div id="panneau-3d"><div class="vision" id="vision"><div class="calque" id="calque"></div></div>
          ${["stl", "3mf"].includes(f.type) ? `<section class="carte" style="margin-top:12px"><div class="entete" style="margin-bottom:8px"><h2 style="margin:0">Repères</h2>
            <button class="btn petit" id="poser">Poser un repère</button></div><div id="liste-reperes"></div></section>` : ""}</div>
        <div id="panneau-plan" hidden><div class="carte"><div class="actions" style="margin-bottom:10px">
          <button class="btn" id="plan-png">Télécharger le plan (PNG)</button><button class="btn" id="plan-garder">Enregistrer dans le projet</button>
          <span class="sous">Vues à l'échelle commune, cotes d'encombrement, repères de la vue 3D.</span></div><div id="plan-toile" class="plan-toile"></div></div></div>
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
  const { Vue3D } = await import("/static/vision.js");
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
  let toile = null;
  const sansExt = f.nom.replace(/\.(stl|3mf)$/i, "");
  const genererPlan = async () => {
    const { dessinerPlan } = await import("/static/plan.js");
    const p = await api("projets/" + f.projet_id);
    toile = dessinerPlan(vue.visibles(), { titre: sansExt + (f.variante ? ` (${f.variante})` : ""), projet: p.nom, reperes });
    $("#plan-toile").replaceChildren(toile);
  };
  $$("[data-onglet]").forEach((b) => (b.onclick = async () => {
    $$("[data-onglet]").forEach((x) => x.classList.toggle("actif", x === b));
    const plan = b.dataset.onglet === "plan";
    $("#panneau-3d").hidden = plan;
    $("#panneau-plan").hidden = !plan;
    if (plan) await genererPlan();
  }));
  $("#plan-png").onclick = () => {
    const a = document.createElement("a");
    a.href = toile.toDataURL("image/png");
    a.download = `plan-${sansExt}.png`;
    a.click();
  };
  $("#plan-garder").onclick = () => toile.toBlob(async (blob) => {
    const fd = new FormData();
    fd.append("fichiers", blob, `plan-${sansExt}.png`);
    fd.append("role", "plan"); fd.append("parent_id", f.id); fd.append("variante", "plan");
    await api(`projets/${f.projet_id}/fichiers`, { method: "POST", body: fd });
    toast("Plan enregistré dans le projet (Plans et documents)");
  }, "image/png");
  if (new URLSearchParams(location.hash.split("?")[1] || "").has("plan")) $('[data-onglet="plan"]').click();
}

// ---- machines
pages.machines = async () => {
  const [machines, etats] = await Promise.all([api("machines"), api("etat-machines")]);
  page.innerHTML = `
    <div class="entete"><div><h1>Machines</h1><div class="sous">État en direct des imprimantes connectées (Bambu réseau local, Klipper)</div></div>
      <div class="actions"><button class="btn prim" id="nouv">Ajouter une machine</button></div></div>
    <div class="grille" id="cartes"></div>
    <section class="carte" style="margin-top:18px"><h2>Connecter une Bambu Lab</h2><div class="sous">Sur l'écran de l'imprimante : Réglages → Réseau → activer le mode « LAN » ou noter l'IP et le code d'accès.
      Le numéro de série est dans Réglages → Appareil (ou sur l'étiquette au dos). Le PC qui fait tourner l'atelier doit être sur le même réseau.
      Les Anycubic d'origine n'ont pas d'API locale ouverte : elles restent en état manuel, sauf si elles tournent sous Klipper (Rinkhals).</div></section>`;
  const rendre = (etats) => {
    $("#cartes").innerHTML = machines.map((m) => `<div>${carteMachine(m, etats[m.id])}<div class="actions" style="margin-top:6px"><button class="btn petit" data-modif="${m.id}">Modifier</button></div></div>`).join("") || `<div class="vide">Aucune machine</div>`;
    $$("[data-modif]").forEach((b) => (b.onclick = () => editer("machines", champsMachine(), machines.find((x) => x.id == b.dataset.modif), () => route())));
  };
  rendre(etats);
  $("#nouv").onclick = () => editer("machines", champsMachine(), null, () => route());
  minuterie = setInterval(async () => rendre(await api("etat-machines")), 3000);
};

// ---- filaments
pages.filaments = async () => {
  const fil = await api("filaments");
  page.innerHTML = `
    <div class="entete"><div><h1>Filaments</h1><div class="sous">Stock et caractéristiques · ${nb(fil.reduce((s, f) => s + (f.stock_g || 0), 0) / 1000, 2)} kg en stock</div></div>
      <div class="actions"><button class="btn prim" id="nouv">Ajouter un filament</button></div></div>
    <section class="carte"><div class="tab-cont"><table><thead><tr><th>Filament</th><th>Matière</th><th>Buse / plateau</th><th>Densité</th><th>Stock</th><th>Prix</th></tr></thead><tbody>
      ${fil.map((f) => `<tr class="cliquable" data-id="${f.id}"><td><span class="pastille-couleur" style="background:${esc(f.couleur_hex)}"></span>${esc(f.marque)} ${esc(f.couleur)}</td><td>${esc(f.matiere)}</td>
        <td class="num">${f.temp_buse ?? "–"} / ${f.temp_plateau ?? "–"} °C</td><td class="num">${nb(f.densite, 2)}</td>
        <td class="num">${nb(f.stock_g, 0)} g ${f.stock_g < 200 ? pastille(["bas", "p-warn"]) : ""}</td><td class="num">${nb(f.prix_kg, 2)} €/kg</td></tr>`).join("") || `<tr><td colspan="6" class="vide">Aucun filament</td></tr>`}
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
  $("#nouv").onclick = async () => editer("impressions", await champsImpression(), { debut: new Date().toISOString().slice(0, 16) }, () => route());
};

// ------------------------------------------------------------------ routeur
async function route() {
  clearInterval(minuterie); clearTimeout(minuterie);
  const [chemin, requete] = location.hash.replace(/^#\/?/, "").split("?");
  const [nom, id] = chemin.split("/");
  $$("nav.cote a[data-route]").forEach((a) => a.classList.toggle("actif", a.dataset.route === (nom === "projet" || nom === "fichier" ? "projets" : nom)));
  const fn = pages[nom] || pages[""];
  try { await fn(new URLSearchParams(requete || ""), id); }
  catch (e) { page.innerHTML = `<div class="carte vide">Erreur : ${esc(e.message)}</div>`; }
}
window.addEventListener("hashchange", route);
route();
