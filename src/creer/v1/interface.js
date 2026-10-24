/*
 * Page publique « Crée ton parfum » : affichage et clics.
 * Toute la logique (règles, curseurs, kit, code) vient des modules testés :
 * moteur.js, configurateur.js et fabrication.js.
 */
import { creerConfigurateur, lienPaiement } from "./configurateur.js";
import { creerFabrication } from "./fabrication.js";

const racine = document.getElementById("cp-app");
const BASE = new URL("./", import.meta.url); // dossier /creer/ du site
const CLE_CODE = "olfa-creer-code";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = v => `${String(Math.round(v * 10) / 10).replace(".", ",")} %`;
const memo = {
  lire(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  ecrire(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* navigation privée */ } },
};

let D, conf, atelier, moteur, N, REC, R, B;
const S = {
  ecran: "accueil",
  reponses: {},
  propositions: [],
  mode: "guide",
  recette: null, curseurs: { fraicheur: 0, douceur: 0, intensite: 0 }, ajout: null,
  expert: { notes: {}, concentration: 18 },
  fixe: null,
  res: null,
  ia: null,
};

const AMBIANCES = [["fraiche", "Fraîche"], ["florale", "Florale"], ["boisee", "Boisée"], ["chaude", "Chaude"], ["gourmande", "Gourmande"]];
const MOMENTS = [["jour", "Le jour"], ["soir", "Le soir"]];
const SAISONS = [["printemps", "Printemps"], ["ete", "Été"], ["automne", "Automne"], ["hiver", "Hiver"]];
const INTENSITES = [["douce", "Douce"], ["intense", "Intense"]];
const ETAGE_NOM = { tete: "Tête", coeur: "Cœur", fond: "Fond" };

// ---------- calcul ----------
function calculer() {
  if (S.fixe) S.res = moteur.ajuster(S.fixe);
  else if (S.mode === "guide") S.res = S.recette ? conf.formuleGuidee(S.recette, S.curseurs, S.ajout) : null;
  else S.res = Object.keys(S.expert.notes).length
    ? moteur.ajuster({ mode: "expert", concentration: S.expert.concentration, notes: S.expert.notes }) : null;
  S.ia = null;
}

function proposerExpert() {
  const ids = Object.keys(S.expert.notes);
  if (ids.length >= R.nombre_notes.min) {
    const p = moteur.proposer(ids, { concentration: S.expert.concentration });
    if (p.ok) S.expert.notes = { ...p.formule.notes };
  }
  calculer();
}

// ---------- petits morceaux d'affichage ----------
const choix = (groupe, options, valeur) => `<div class="cp-chips" role="radiogroup">${options.map(([v, t]) =>
  `<button type="button" class="chip cp-chip${valeur === v ? " on" : ""}" role="radio" aria-checked="${valeur === v}" data-action="repondre" data-groupe="${groupe}" data-valeur="${v}">${esc(t)}</button>`).join("")}</div>`;

const selectNotes = (nom, valeur, vide) => `<select class="cp-select" data-action="repondre-select" data-groupe="${nom}">
  <option value="">${esc(vide)}</option>${Object.entries(N).filter(([, n]) => n.actif !== false)
    .map(([id, n]) => `<option value="${id}"${valeur === id ? " selected" : ""}>${esc(n.nom)}</option>`).join("")}</select>`;

function messages(res) {
  if (!res) return "";
  const bloc = (cls, items) => items.length ? `<div class="cp-alerte ${cls}"><ul>${items.map(m => `<li>${esc(m.message)}</li>`).join("")}</ul></div>` : "";
  return bloc("erreur", res.erreurs) + aides(res) + bloc("attention", res.avertissements) + bloc("info", res.corrections.filter(c => c.code !== "concentration"));
}

// Mode expert : les notes qui règlent un manque, à ajouter en un clic.
function aides(res) {
  if (S.mode !== "expert" || S.fixe) return "";
  return conf.suggestions({ mode: "expert", concentration: S.expert.concentration, notes: S.expert.notes }, res).map(s =>
    `<div class="cp-aide"><p>${esc(s.titre)}</p><div class="cp-chips">${s.notes.map(n =>
      `<button type="button" class="chip cp-chip" data-action="note" data-id="${n.id}">+ ${esc(n.nom)}</button>`).join("")}</div></div>`).join("");
}

function pyramideHtml(formule) {
  const p = conf.pyramide(formule);
  const parts = Object.fromEntries(["tete", "coeur", "fond"].map(e => [e, p[e].reduce((s, n) => s + n.pct, 0)]));
  // triangle découpé en 3 bandes ; l'opacité suit la part de chaque étage
  const bande = (y1, y2, e) => {
    const x = y => (y - 8) / 200 * 110;
    const op = 0.18 + parts[e] / 100 * 1.2;
    return `<polygon points="${120 - x(y1)},${y1} ${120 + x(y1)},${y1} ${120 + x(y2)},${y2} ${120 - x(y2)},${y2}" fill="var(--gold)" fill-opacity="${Math.min(0.9, op).toFixed(2)}"/>`;
  };
  return `<div class="cp-pyr"><svg viewBox="0 0 240 212" aria-hidden="true">${bande(8, 70, "tete")}${bande(74, 138, "coeur")}${bande(142, 208, "fond")}</svg>
    <ul>${["tete", "coeur", "fond"].map(e => `<li><b>${ETAGE_NOM[e]} · ${pct(parts[e])}</b><span>${p[e].map(n => `${esc(n.nom)} ${pct(n.pct)}`).join(", ")}</span></li>`).join("")}</ul></div>`;
}

function roueHtml(formule) {
  const r = conf.roue(formule);
  const n = r.familles.length, pas = 360 / n;
  const pt = (rayon, deg) => { const a = (deg - 90) * Math.PI / 180; return [(Math.cos(a) * rayon).toFixed(1), (Math.sin(a) * rayon).toFixed(1)]; };
  const segments = r.familles.map(f => {
    const [a1, a2] = [f.angle - pas / 2 + 1, f.angle + pas / 2 - 1];
    const [x1, y1] = pt(96, a1), [x2, y2] = pt(96, a2), [x3, y3] = pt(58, a2), [x4, y4] = pt(58, a1);
    const [tx, ty] = pt(77, f.angle);
    const op = (0.1 + f.part / 100 * 0.9).toFixed(2);
    return `<path d="M${x1},${y1} A96,96 0 0 1 ${x2},${y2} L${x3},${y3} A58,58 0 0 0 ${x4},${y4} Z" fill="var(--gold)" fill-opacity="${op}"/>
      <text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" class="${f.part >= 35 ? "fort" : ""}">${esc(f.nom)}</text>`;
  }).join("");
  const [mx, my] = pt(r.force * 50, r.angle);
  return `<div class="cp-roue"><svg viewBox="-104 -104 208 208" role="img" aria-label="Roue des familles : dominante ${esc(R.equilibre[r.dominante].nom)}">
    ${segments}<circle r="54" fill="none" stroke="var(--line-2)"/><circle cx="${mx}" cy="${my}" r="7" fill="var(--ivory)" stroke="var(--bg)" stroke-width="2"/></svg>
    <p>${r.familles.filter(f => f.part > 0).sort((a, b) => b.part - a.part).map(f => `${esc(f.nom)} ${pct(f.part)}`).join(" · ")}</p></div>`;
}

function friseHtml(formule) {
  return `<ol class="cp-frise">${conf.frise(formule).map(m => `<li><b>${esc(m.moment)}</b><span>${m.notes.map(n => esc(n.nom)).join(", ") || "presque plus rien"}</span></li>`).join("")}</ol>`;
}

function visualisation(res) {
  if (!res) return `<div class="cp-vide">Choisis tes notes : le parfum s'affichera ici.</div>`;
  const f = res.formule;
  const desc = S.ia || conf.decrire(f);
  const boutonIa = B.worker ? `<button type="button" class="cp-lien" data-action="ia">${S.ia ? "Autre description" : "Décris-le autrement"}</button>` : "";
  return `<div class="cp-visu${res.ok ? "" : " flou"}">
    <p class="cp-desc">${esc(desc)}</p>${boutonIa}
    <h3>Pyramide</h3>${pyramideHtml(f)}
    <h3>Famille</h3>${roueHtml(f)}
    <h3>Sur la peau</h3>${friseHtml(f)}
    <p class="cp-note">Estimation : la tenue réelle dépend de ta peau.</p>
  </div>`;
}

function commande(res) {
  if (!res || !res.ok) return "";
  const f = res.formule;
  const produits = [
    { cle: "kit", code: atelier.encoder(f, "kit"), titre: "Kit d'échantillons", detail: `3 × ${R.kit.flacon_ml} ml : plus fraîche, standard, plus intense. ${B.kit_deduit}` },
    { cle: "flacon_50", code: atelier.encoder(f, 50), titre: "Flacon 50 ml", detail: "Ta formule, préparée à la main." },
    { cle: "flacon_100", code: atelier.encoder(f, 100), titre: "Flacon 100 ml", detail: "Ta formule, préparée à la main." },
  ];
  return `<section class="cp-commande"><h2 class="cp-h2">Commander</h2>
    <p class="sub">Délai : ${esc(B.delai)}. Le parfum repose avant l'envoi pour que les notes se lient.</p>
    <div class="cp-produits">${produits.map(p => {
      const lien = lienPaiement(B, p.cle, p.code);
      const prix = B.prix_eur[p.cle] != null ? `${B.prix_eur[p.cle]} €` : "";
      return `<div class="cp-produit"><h3>${esc(p.titre)}</h3><p class="cp-prix">${esc(prix)}</p><p>${esc(p.detail)}</p>
        ${lien ? `<a class="btn" href="${esc(lien)}" data-action="payer" data-code="${esc(p.code)}" rel="noopener">Commander</a>` : `<span class="btn cp-off" aria-disabled="true">Bientôt disponible</span>`}</div>`;
    }).join("")}</div>
    <p class="cp-code">Ton code de formule : <b>${esc(atelier.encoder(f, null))}</b><br>Garde-le : il permet de recommander exactement le même parfum.</p>
  </section>`;
}

// ---------- écrans ----------
function ecranAccueil() {
  return `<div class="cp-portes">
    <button type="button" class="cp-porte" data-action="porte" data-mode="guide"><span class="tag">Recommandé</span><b>Je me laisse guider</b><span>5 questions, puis une recette testée à ajuster avec 3 curseurs.</span></button>
    <button type="button" class="cp-porte" data-action="porte" data-mode="expert"><span class="tag">Expert</span><b>Je compose note par note</b><span>De 3 à 7 notes parmi ${Object.values(N).filter(n => n.actif !== false).length}. L'outil écarte celles qui jurent.</span></button>
  </div>
  <form class="cp-recommander" data-action="recommander">
    <label for="cp-code-saisi">Tu as déjà un code de formule ?</label>
    <div><input id="cp-code-saisi" class="cp-input" autocomplete="off" spellcheck="false" placeholder="R03-BER15-…-C18" value="${esc(memo.lire(CLE_CODE) || "")}"><button class="chip cp-chip" type="submit">Recommander ma formule</button></div>
    <p class="cp-retour" id="cp-retour" aria-live="polite"></p>
  </form>`;
}

function ecranQuestions() {
  const r = S.reponses;
  return `<form class="cp-questions" data-action="voir-recettes">
    <fieldset><legend>1. Quelle ambiance ?</legend>${choix("ambiance", AMBIANCES, r.ambiance)}</fieldset>
    <fieldset><legend>2. Pour quand ?</legend>${choix("moment", MOMENTS, r.moment)}</fieldset>
    <fieldset><legend>3. Quelle saison ?</legend>${choix("saison", SAISONS, r.saison)}</fieldset>
    <fieldset><legend>4. Quelle intensité ?</legend>${choix("intensite", INTENSITES, r.intensite)}</fieldset>
    <fieldset><legend>5. Une note que tu adores, une que tu détestes ?</legend>
      <div class="cp-deux"><label>J'adore ${selectNotes("adoree", r.adoree, "Pas d'idée")}</label><label>Je déteste ${selectNotes("detestee", r.detestee, "Rien de spécial")}</label></div></fieldset>
    <div class="cp-actions"><button type="button" class="cp-lien" data-action="accueil">← Retour</button><button class="btn" type="submit"${r.ambiance ? "" : " disabled"}>Voir mes recettes</button></div>
  </form>`;
}

function ecranRecettes() {
  return `<div class="cp-recettes">${S.propositions.map(p => {
    const r = REC[p.id];
    const notes = Object.keys(r.notes).map(id => N[id].nom.toLowerCase()).join(", ");
    return `<article class="cp-recette"><p class="tag">${esc(R.equilibre[r.famille].nom)}</p><h3>${esc(r.nom)}</h3><p>${esc(notes)}</p>
      ${p.ajout ? `<p class="cp-note">+ ${esc(N[p.ajout].nom.toLowerCase())}, ta note préférée</p>` : ""}
      <button class="btn" type="button" data-action="prendre" data-id="${p.id}" data-ajout="${p.ajout || ""}">Partir de celle-ci</button></article>`;
  }).join("") || `<p>Aucune recette ne correspond : essaie d'autres réponses.</p>`}</div>
  <div class="cp-actions"><button type="button" class="cp-lien" data-action="questions">← Modifier mes réponses</button></div>`;
}

function controlesGuide() {
  const r = REC[S.recette];
  const curseur = (cle, gauche, droite) => `<label class="cp-curseur"><span><em>${gauche}</em><em>${droite}</em></span>
    <input type="range" min="-1" max="1" step="0.1" value="${S.curseurs[cle]}" data-action="curseur" data-cle="${cle}"></label>`;
  const possibles = conf.notesAjoutables(S.recette, S.reponses); // jamais la note détestée
  return `<p class="tag">Recette ${esc(S.recette)}</p><h2 class="cp-h2">${esc(r.nom)}</h2>
    ${curseur("fraicheur", "Plus frais", "Plus chaud")}
    ${curseur("douceur", "Plus sec", "Plus doux")}
    ${curseur("intensite", "Plus léger", "Plus intense")}
    <label class="cp-ajout">Ajouter une note
      <select class="cp-select" data-action="ajout"><option value="">Aucune</option>${possibles.map(n => `<option value="${n.id}"${S.ajout === n.id ? " selected" : ""}>${esc(n.nom)}</option>`).join("")}</select></label>
    <div class="cp-actions"><button type="button" class="cp-lien" data-action="recettes">← Autres recettes</button><button type="button" class="cp-lien" data-action="reinitialiser">Revenir à la recette</button></div>`;
}

function controlesExpert() {
  const ids = Object.keys(S.expert.notes);
  const compat = Object.fromEntries(moteur.notesCompatibles({ mode: "expert", notes: S.expert.notes }).map(n => [n.id, n]));
  const h = moteur.harmonie(ids);
  const jauge = h == null ? "" : `<div class="cp-jauge"><span>Harmonie</span><div><i style="width:${Math.round(h / 3 * 100)}%"></i></div><b>${h < R.matrice.moyenne_min ? "fragile" : h < 2.4 ? "harmonieuse" : "très harmonieuse"}</b></div>`;
  const groupe = e => `<div class="cp-etage"><b>${ETAGE_NOM[e]}</b><div class="cp-chips">${Object.entries(N).filter(([, n]) => n.actif !== false && n.etage === e).map(([id, n]) => {
    const pris = ids.includes(id), c = compat[id], off = !pris && c && !c.possible;
    return `<button type="button" class="chip cp-chip${pris ? " on" : ""}${off ? " off" : ""}" data-action="note" data-id="${id}" aria-pressed="${pris}"${off ? ` aria-disabled="true" title="${esc(c.raison)}"` : ""}>${esc(n.nom)}</button>`;
  }).join("")}</div></div>`;
  const doses = S.res && ids.length ? `<div class="cp-doses">${ids.map(id => `<label class="cp-curseur"><span><em>${esc(N[id].nom)}</em><em>${pct(S.res.formule.notes[id] ?? 0)}</em></span>
    <input type="range" min="0" max="40" step="1" value="${Math.round(S.expert.notes[id] ?? 0)}" data-action="dose" data-id="${id}"></label>`).join("")}
    <label class="cp-curseur"><span><em>Concentration</em><em>${pct(S.expert.concentration)}</em></span>
    <input type="range" min="${R.concentration.min}" max="${R.concentration.max}" step="0.5" value="${S.expert.concentration}" data-action="concentration"></label></div>` : "";
  return `<p class="tag">Mode expert</p><h2 class="cp-h2">Tes notes</h2><p class="sub">De ${R.nombre_notes.min} à ${R.nombre_notes.max} notes. Les notes grisées jurent avec ton choix.</p>
    ${["tete", "coeur", "fond"].map(groupe).join("")}${jauge}${doses}
    <div class="cp-actions"><button type="button" class="cp-lien" data-action="accueil">← Retour</button></div>`;
}

function controlesFixe() {
  return `<p class="tag">Ta formule</p><h2 class="cp-h2">${S.fixe.recette ? esc(REC[S.fixe.recette].nom) : "Formule libre"}</h2>
    <p class="sub">La formule de ton code, à l'identique.</p>
    <div class="cp-actions"><button type="button" class="cp-lien" data-action="accueil">← Retour</button>${S.fixe.recette ? `<button type="button" class="cp-lien" data-action="prendre" data-id="${S.fixe.recette}" data-ajout="">Repartir de cette recette</button>` : ""}</div>`;
}

function ecranAtelier() {
  const ctrl = S.fixe ? controlesFixe() : S.mode === "guide" ? controlesGuide() : controlesExpert();
  return `<div class="cp-atelier"><div class="cp-ctrl">${ctrl}<div id="cp-messages">${messages(S.res)}</div></div>
    <div class="cp-droite" id="cp-visu">${visualisation(S.res)}</div></div><div id="cp-commande">${commande(S.res)}</div>`;
}

function afficher() {
  const ecrans = { accueil: ecranAccueil, questions: ecranQuestions, recettes: ecranRecettes, atelier: ecranAtelier };
  racine.innerHTML = ecrans[S.ecran]();
}

// Pendant qu'on fait glisser un curseur : on ne redessine que le résultat, pas les curseurs.
function afficherResultat() {
  const m = document.getElementById("cp-messages"), v = document.getElementById("cp-visu"), c = document.getElementById("cp-commande");
  if (m) m.innerHTML = messages(S.res);
  if (v) v.innerHTML = visualisation(S.res);
  if (c) c.innerHTML = commande(S.res);
  if (S.mode === "expert" && S.res) document.querySelectorAll('[data-action="dose"]').forEach(el => {
    const lab = el.parentElement.querySelector("span em:last-child");
    if (lab) lab.textContent = pct(S.res.formule.notes[el.dataset.id] ?? 0);
  });
}

const aller = ecran => { S.ecran = ecran; afficher(); racine.scrollIntoView({ behavior: "smooth", block: "start" }); };

// ---------- clics ----------
racine.addEventListener("click", e => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "FORM" || el.tagName === "SELECT" || el.tagName === "INPUT") return;
  const a = el.dataset.action;
  if (a === "porte") {
    S.mode = el.dataset.mode; S.fixe = null;
    if (S.mode === "guide") aller("questions");
    else { S.expert = { notes: {}, concentration: R.concentration.defaut }; calculer(); aller("atelier"); }
  } else if (a === "accueil") aller("accueil");
  else if (a === "questions") aller("questions");
  else if (a === "recettes") aller(S.propositions.length ? "recettes" : "questions");
  else if (a === "repondre") {
    S.reponses[el.dataset.groupe] = S.reponses[el.dataset.groupe] === el.dataset.valeur ? undefined : el.dataset.valeur;
    afficher();
  } else if (a === "prendre") {
    S.mode = "guide"; S.fixe = null; S.recette = el.dataset.id; S.ajout = el.dataset.ajout || null;
    S.curseurs = { fraicheur: 0, douceur: 0, intensite: 0 };
    calculer(); aller("atelier");
  } else if (a === "reinitialiser") { S.curseurs = { fraicheur: 0, douceur: 0, intensite: 0 }; S.ajout = null; calculer(); afficher(); }
  else if (a === "note") {
    if (el.getAttribute("aria-disabled") === "true") return;
    const id = el.dataset.id;
    if (S.expert.notes[id] !== undefined) delete S.expert.notes[id]; else S.expert.notes[id] = 0;
    proposerExpert(); afficher();
  } else if (a === "payer") memo.ecrire(CLE_CODE, el.dataset.code.replace(/-(KIT|V\d+)$/, ""));
  else if (a === "ia") demanderIa();
});

racine.addEventListener("input", e => {
  const el = e.target, a = el.dataset.action;
  if (a === "curseur") { S.curseurs[el.dataset.cle] = Number(el.value); calculer(); afficherResultat(); }
  else if (a === "dose") { S.expert.notes[el.dataset.id] = Number(el.value); calculer(); afficherResultat(); }
  else if (a === "concentration") { S.expert.concentration = Number(el.value); calculer(); afficherResultat(); }
});

racine.addEventListener("change", e => {
  const el = e.target, a = el.dataset.action;
  if (a === "repondre-select") { S.reponses[el.dataset.groupe] = el.value || undefined; }
  else if (a === "ajout") { S.ajout = el.value || null; calculer(); afficher(); }
  else if (a === "dose" || a === "concentration") {
    // l'outil a remis le total à 100 % : les curseurs reprennent les doses réelles
    if (S.res && S.res.ok) S.expert.notes = { ...S.res.formule.notes };
    afficher();
  }
});

racine.addEventListener("submit", e => {
  e.preventDefault();
  const a = e.target.dataset.action;
  if (a === "voir-recettes") { S.propositions = conf.choisirRecettes(S.reponses); aller("recettes"); }
  else if (a === "recommander") {
    const code = document.getElementById("cp-code-saisi").value;
    const lu = atelier.decoder(code, { volumeFacultatif: true });
    const retour = document.getElementById("cp-retour");
    if (!lu.ok) { retour.textContent = lu.erreurs.map(x => x.message).join(" "); return; }
    const v = moteur.verifier(lu.formule);
    if (!v.ok) { retour.textContent = "Cette formule ne peut plus être préparée telle quelle : " + v.erreurs[0].message; return; }
    S.fixe = { ...lu.formule, famille: v.famille }; S.mode = lu.formule.mode;
    calculer(); aller("atelier");
  }
});

// Description par IA (programme Cloudflare) : facultative, la phrase préécrite reste si ça échoue.
async function demanderIa() {
  if (!B.worker || !S.res || !S.res.ok) return;
  const code = atelier.encoder(S.res.formule, null);
  try {
    const r = await fetch(new URL("description", B.worker.endsWith("/") ? B.worker : B.worker + "/"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
    });
    const j = await r.json();
    if (j && j.texte && S.res && atelier.encoder(S.res.formule, null) === code) { S.ia = j.texte; afficherResultat(); }
  } catch (err) { /* on garde la description préécrite */ }
}

// ---------- démarrage ----------
try {
  D = await fetch(new URL("donnees.json", BASE), { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  conf = creerConfigurateur(D); atelier = creerFabrication(D); moteur = conf.moteur;
  N = D.notes.notes; REC = D.recettes.recettes; R = D.regles; B = D.boutique || { liens_stripe: {}, prix_eur: {}, delai: "", kit_deduit: "" };
  S.expert.concentration = R.concentration.defaut;
  afficher();
} catch (err) {
  racine.innerHTML = `<div class="cp-alerte erreur"><p>L'outil n'a pas pu se charger. Recharge la page.</p></div>`;
}
