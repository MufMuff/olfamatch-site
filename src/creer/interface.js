/*
 * Page publique « Crée ton parfum » V2 : affichage et clics (téléphone d'abord, un choix par écran).
 * Toute la logique vient des modules testés : moteur.js (harmonie + sécurité) et portes.js.
 * Le programme Cloudflare (boutique.json → worker) enregistre le code, écrit l'explication par IA
 * et crée le paiement : c'est lui qui décide, la page ne fait qu'afficher.
 * Le nom d'un parfum de marque (porte P1) reste dans cette page : il n'est jamais envoyé.
 */
import { creerMoteur, ETAGES } from "./moteur.js";
import { creerPortes, sansAccent } from "./portes.js";

const racine = document.getElementById("cp-app");
const BASE = new URL("./", import.meta.url);
const CLE_CODE = "olfa-creer-code";
const NOM_ETAGE = { tete: "Tête", coeur: "Cœur", fond: "Fond" };
const FORMATS = [["kit", "Kit d'échantillons", "3 × 2 ml pour essayer"], ["50", "Flacon 50 ml", "Eau de parfum"], ["100", "Flacon 100 ml", "Eau de parfum"]];
const CLE_PRIX = { kit: "kit", "50": "flacon_50", "100": "flacon_100" };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = v => `${String(Math.round(v * 10) / 10).replace(".", ",")} %`;
const euros = v => `${String(v).replace(".", ",")} €`;
const memo = {
  lire(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  ecrire(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* navigation privée */ } },
};

let D, M, P, B, N;
const S = {
  ecran: "accueil", porte: null, pile: [],
  formule: null, base: null, curseurs: { fraicheur: 0, douceur: 0, intensite: 0 },
  quiz: { reponses: {}, i: 0, detestee: "" }, recettes: [], titreRecettes: "",
  p1: { recherche: "", slug: null, couverture: null, proposition: null, etages: null },
  p4: { famille: null },
  p5: { etage: "tete" },
  confirme: false, format: "100",
  serveur: { code: null, prix: null, vente: null, erreur: null, cle: null },
  ia: { texte: null, cle: null },
  comprendre: { texte: "", attente: false, erreur: null },
  rappel: { texte: "", erreur: null },
};

// ---------------- programme Cloudflare ----------------

const WORKER = () => (B.worker || "").replace(/\/+$/, "");
async function api(chemin, { methode = "POST", corps } = {}) {
  if (!WORKER()) return { ok: false, statut: 0, donnees: { erreur: "Programme Cloudflare pas encore relié." } };
  try {
    const r = await fetch(`${WORKER()}${chemin}`, {
      method: methode, headers: { "Content-Type": "application/json" }, body: corps ? JSON.stringify(corps) : undefined,
    });
    return { ok: r.ok, statut: r.status, donnees: await r.json().catch(() => ({})) };
  } catch (e) {
    return { ok: false, statut: 0, donnees: { erreur: "Connexion impossible : réessaie dans un instant." } };
  }
}

// ---------------- navigation ----------------

const ETAPES = {
  P1: ["p1-recherche", "p1-notes", "p1-reglages", "recap"],
  P2: ["p2-ambiances", "p2-recettes", "p2-reglages", "recap"],
  P3: ["p3-question", "p3-detestee", "p3-recettes", "p3-reglages", "recap"],
  P4: ["p4-catalogue", "p4-fiche", "recap"],
  P5: ["p5-notes", "p5-doses", "recap"],
};

function aller(ecran) {
  S.pile.push({ ecran: S.ecran, quizI: S.quiz.i });
  S.ecran = ecran;
  rendre(true);
}
function retour() {
  const prec = S.pile.pop();
  if (!prec) return;
  S.ecran = prec.ecran;
  S.quiz.i = prec.quizI;
  rendre(true);
}
function accueil() {
  Object.assign(S, { ecran: "accueil", porte: null, pile: [], formule: null, base: null, confirme: false, recettes: [] });
  S.curseurs = { fraicheur: 0, douceur: 0, intensite: 0 };
  S.quiz = { reponses: {}, i: 0, detestee: "" };
  rendre(true);
}

function progression() {
  if (!S.porte) return "";
  const etapes = ETAPES[S.porte];
  let i = etapes.indexOf(S.ecran), n = etapes.length;
  if (S.porte === "P3") { n = etapes.length + 5; i = S.ecran === "p3-question" ? S.quiz.i : i + 5; }
  const p = Math.round(((i + 1) / n) * 100);
  return `<div class="cp-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-label="Avancement"><i style="width:${p}%"></i></div>`;
}

// ---------------- petits morceaux d'affichage ----------------

const bouton = (texte, action, extra = "", cls = "btn") => `<button type="button" class="${cls}" data-action="${action}" ${extra}>${texte}</button>`;
const alerte = (cls, items) => (items && items.length ? `<div class="cp-alerte ${cls}"><ul>${items.map(m => `<li>${esc(m)}</li>`).join("")}</ul></div>` : "");

function jaugeHarmonie(h) {
  return `<div class="cp-jauge ${h.libelle}"><span>Harmonie</span><div><i style="width:${Math.max(3, h.score)}%"></i></div><b>${Math.round(h.score)}<small>/100</small> · ${esc(h.texte)}</b></div>`;
}
function jaugeMarge(marge) {
  const m = Math.max(0, Math.round(marge * 100));
  return `<div class="cp-jauge marge${m <= 5 ? " limite" : ""}"><span>Marge de sécurité</span><div><i style="width:${Math.max(3, m)}%"></i></div><b>${m <= 0 ? "à la limite" : `${m} %`}</b></div>`;
}

function pyramideHtml(formule) {
  const p = P.pyramide(formule), parts = P.partsEtages(formule);
  return `<div class="cp-pyr" aria-label="Pyramide du parfum">${ETAGES.map(e => `<div class="cp-pyr-${e}"><b>${NOM_ETAGE[e]} · ${pct(parts[e])}</b><span>${p[e].map(n => esc(n.nom)).join(" · ") || "—"}</span></div>`).join("")}</div>`;
}

function carteRecette(r) {
  return `<button type="button" class="cp-carte" data-action="recette" data-code="${r.code}"><b>${esc(r.nom)}</b><span>${esc(r.nom_structure)}</span>
<em>${r.notes.slice(0, 5).map(n => esc(n.nom)).join(", ")}${r.notes.length > 5 ? "…" : ""}</em></button>`;
}

function curseur(nom, libelle, valeur, { min = -1, max = 1, pas = 0.1, gauche = "", droite = "", sortie = "" } = {}) {
  return `<label class="cp-curseur"><span>${esc(libelle)}<output data-sortie="${nom}">${esc(sortie)}</output></span>
<input type="range" min="${min}" max="${max}" step="${pas}" value="${valeur}" data-curseur="${nom}" aria-label="${esc(libelle)}">
${gauche || droite ? `<span class="cp-bornes"><i>${esc(gauche)}</i><i>${esc(droite)}</i></span>` : ""}</label>`;
}

// ---------------- écrans ----------------

function ecranAccueil() {
  const portes = P.portesVisibles().map(p => `<button type="button" class="cp-porte" data-action="porte" data-porte="${p.id}"><b>${esc(p.titre)}</b><span>${esc(p.texte)}</span></button>`).join("");
  const rappel = WORKER() ? `<form class="cp-rappel" data-action="rappel"><label for="cp-code">Tu as déjà un code de formule ?</label>
<div><input id="cp-code" class="cp-input" name="code" placeholder="OLF-XXXXX-XXXXX" autocomplete="off" value="${esc(S.rappel.texte || memo.lire(CLE_CODE) || "")}">
<button class="btn ghost" type="submit">Retrouver</button></div>${S.rappel.erreur ? `<p class="cp-retour">${esc(S.rappel.erreur)}</p>` : ""}</form>` : "";
  return { corps: `<h2 class="cp-h2">Par où veux-tu commencer ?</h2><div class="cp-portes">${portes}</div>${rappel}`, bas: "" };
}

// ----- P1 -----
function ecranP1Recherche() {
  const liste = P.parfumsInspiration(D.parfums_inspiration || []);
  const q = sansAccent(S.p1.recherche);
  const trouves = q.length >= 2 ? liste.filter(p => sansAccent(`${p.nom} ${p.marque}`).includes(q)).slice(0, 8) : [];
  const acc = D.accords || {};
  return {
    corps: `<h2 class="cp-h2">Un parfum que tu aimes</h2>
<label class="cp-champ"><span>Son nom</span><input class="cp-input" data-champ="recherche" value="${esc(S.p1.recherche)}" placeholder="Tape au moins 2 lettres" autocomplete="off"></label>
<div class="cp-liste" role="listbox">${trouves.map(p => `<button type="button" role="option" class="cp-ligne" data-action="parfum" data-slug="${esc(p.slug)}"><b>${esc(p.nom)}</b> <span>${esc(p.marque)}</span></button>`).join("")}
${q.length >= 2 && !trouves.length ? `<p class="cp-note">Aucun parfum trouvé avec ses notes publiées.${Object.keys(acc).length ? "" : ""}</p>` : ""}</div>
<p class="cp-note">On n'affiche que des faits : les notes publiées du parfum, et celles que l'outil sait préparer.</p>`,
    bas: "",
  };
}

function ecranP1Notes() {
  const cv = S.p1.couverture, prop = S.p1.proposition;
  const etage = e => (cv.etages[e] || []).map(n => `<li class="${n.couverte ? "on" : "off"}">${n.couverte ? "✓" : "–"} ${esc(n.nom)}</li>`).join("");
  return {
    corps: `<h2 class="cp-h2">Notes publiées</h2>
<div class="cp-publiees">${ETAGES.map(e => `<div><b>${NOM_ETAGE[e]}</b><ul>${etage(e) || "<li class=\"off\">—</li>"}</ul></div>`).join("")}</div>
<p class="cp-couvre">L'outil couvre <b>${cv.couvertes} note${cv.couvertes > 1 ? "s" : ""} sur ${cv.total}</b>.</p>
${cv.a_verifier ? `<p class="cp-note">Notes publiées en cours de vérification.</p>` : ""}
${prop ? `<h3>Ta formule de départ</h3>${pyramideHtml(prop.formule)}${jaugeHarmonie(M.harmonie(prop.formule))}
${prop.ajoutees.length ? `<p class="cp-note">Ajoutées pour équilibrer : ${prop.ajoutees.map(c => esc(N.get(c).nom)).join(", ")}.</p>` : ""}` : `<p class="cp-note">Pas assez de notes couvertes pour proposer une formule.</p>`}`,
    bas: prop ? bouton("Régler", "suivant") : "",
  };
}

function ecranP1Reglages() {
  const e = S.p1.etages, f = S.formule;
  return {
    corps: `<h2 class="cp-h2">Tes réglages</h2>
${ETAGES.map(x => curseur(`etage-${x}`, NOM_ETAGE[x], Math.round(e[x]), { min: 0, max: 80, pas: 1, sortie: pct(P.partsEtages(f)[x]) })).join("")}
${curseur("concentration", "Intensité", f.concentration, { min: M.plages().concentration.min, max: M.plages().concentration.max, pas: 1, gauche: "légère", droite: "intense", sortie: pct(f.concentration) })}
<div data-zone="direct">${pyramideHtml(f)}${jaugeHarmonie(M.harmonie(f))}</div>`,
    bas: bouton("Voir le récap", "recap"),
  };
}

// ----- P2 -----
function ecranP2Ambiances() {
  const cartes = P.ambiances().map(a => `<button type="button" class="cp-carte amb amb-${esc(a.id)}" data-action="ambiance" data-id="${esc(a.id)}"><b>${esc(a.nom)}</b><span>${esc(a.texte)}</span></button>`).join("");
  const ia = WORKER() && D.features.ia_active ? `<form class="cp-mots" data-action="comprendre"><label for="cp-mots">Ou décris-le avec tes mots</label>
<textarea id="cp-mots" class="cp-input" name="texte" rows="3" maxlength="${D.regles.ia?.texte_max || 400}" placeholder="Ex. : frais et boisé, pour l'été, pas trop sucré">${esc(S.comprendre.texte)}</textarea>
<button class="btn ghost" type="submit"${S.comprendre.attente ? " disabled" : ""}>${S.comprendre.attente ? "Un instant…" : "Proposer des recettes"}</button>
${S.comprendre.erreur ? `<p class="cp-retour">${esc(S.comprendre.erreur)}</p>` : ""}</form>` : "";
  return { corps: `<h2 class="cp-h2">Quelle ambiance ?</h2><div class="cp-cartes">${cartes}</div>${ia}`, bas: "" };
}

function ecranRecettes() {
  return {
    corps: `<h2 class="cp-h2">${esc(S.titreRecettes || "Choisis ta recette")}</h2>
${S.recettes.length ? `<div class="cp-cartes">${S.recettes.map(carteRecette).join("")}</div>` : `<p class="cp-vide">Aucune recette disponible pour ce choix pour le moment.</p>`}`,
    bas: "",
  };
}

function ecranReglages({ intensite = true } = {}) {
  const f = S.formule, c = S.curseurs;
  return {
    corps: `<h2 class="cp-h2">À ton goût</h2>
${curseur("fraicheur", "Fraîcheur", c.fraicheur, { gauche: "plus frais", droite: "plus chaud" })}
${curseur("douceur", "Douceur", c.douceur, { gauche: "plus sec", droite: "plus doux" })}
${intensite ? curseur("intensite", "Intensité", c.intensite, { gauche: "plus léger", droite: "plus intense", sortie: pct(f.concentration) }) : ""}
<div data-zone="direct">${pyramideHtml(f)}${jaugeHarmonie(M.harmonie(f))}</div>`,
    bas: bouton("Voir le récap", "recap"),
  };
}

// ----- P3 -----
function ecranP3Question() {
  const q = P.quiz()[S.quiz.i];
  return {
    corps: `<p class="cp-etape">Question ${S.quiz.i + 1} sur 6</p><h2 class="cp-h2">${esc(q.question)}</h2>
<div class="cp-choix">${q.reponses.map(r => `<button type="button" class="cp-option${S.quiz.reponses[q.id] === r.id ? " on" : ""}" data-action="reponse" data-q="${q.id}" data-r="${r.id}">${esc(r.texte)}</button>`).join("")}</div>`,
    bas: "",
  };
}

function ecranP3Detestee() {
  const opts = P.notesDisponibles().map(c => N.get(c)).sort((a, b) => a.nom.localeCompare(b.nom))
    .map(n => `<option value="${n.code}"${S.quiz.detestee === n.code ? " selected" : ""}>${esc(n.nom)}</option>`).join("");
  return {
    corps: `<h2 class="cp-h2">Une note que tu n'aimes pas ?</h2>
<label class="cp-champ"><span>On l'écartera des recettes</span><select class="cp-input" data-champ="detestee"><option value="">Aucune</option>${opts}</select></label>`,
    bas: bouton("Voir mes pistes", "suivant"),
  };
}

// ----- P4 -----
function ecranP4Catalogue() {
  const fam = P.familles();
  const liste = P.catalogue(S.p4.famille);
  return {
    corps: `<h2 class="cp-h2">Recettes de base</h2>
<div class="cp-chips">${[["", "Toutes"], ...fam.map(f => [f.id, f.nom])].map(([id, nom]) =>
      `<button type="button" class="chip cp-chip${(S.p4.famille || "") === id ? " on" : ""}" data-action="famille" data-id="${id}">${esc(nom)}</button>`).join("")}</div>
<div class="cp-cartes">${liste.map(carteRecette).join("")}</div>`,
    bas: "",
  };
}

function ecranP4Fiche() {
  const f = S.formule;
  const lignes = ETAGES.flatMap(e => P.pyramide(f)[e].map(n => {
    const remp = P.remplacants(f, n.code).slice(0, 8);
    return `<li class="cp-modif"><span class="cp-modif-nom"><b>${esc(n.nom)}</b><i>${NOM_ETAGE[e]} · ${pct(n.pct)}</i></span>
<span class="cp-modif-act">${bouton("−5", "moins", `data-code="${n.code}" aria-label="Moins de ${esc(n.nom)}"`, "cp-mini")}${bouton("+5", "plus", `data-code="${n.code}" aria-label="Plus de ${esc(n.nom)}"`, "cp-mini")}
<select class="cp-mini" data-remplacer="${n.code}" aria-label="Remplacer ${esc(n.nom)}"><option value="">Remplacer…</option>${remp.map(r => `<option value="${r.code}">${esc(r.nom)}</option>`).join("")}</select></span></li>`;
  })).join("");
  return {
    corps: `<h2 class="cp-h2">${esc(S.titreRecettes)}</h2>${jaugeHarmonie(M.harmonie(f))}
<ul class="cp-modifs">${lignes}</ul><p class="cp-note">Chaque changement est recalculé tout de suite : les autres notes s'ajustent pour rester à 100 %.</p>`,
    bas: bouton("Voir le récap", "recap"),
  };
}

// ----- P5 -----
function ecranP5Notes() {
  const f = S.formule, pe = P.notesParEtage(), n = Object.keys(f.notes).length;
  const { min, max } = M.plages().nombre_notes;
  return {
    corps: `<h2 class="cp-h2">Choisis tes notes</h2>
<div class="cp-onglets" role="tablist">${ETAGES.map(e => `<button type="button" role="tab" aria-selected="${S.p5.etage === e}" class="cp-onglet${S.p5.etage === e ? " on" : ""}" data-action="onglet" data-etage="${e}">${NOM_ETAGE[e]} <small>${Object.keys(f.notes).filter(c => N.get(c).etage === e).length}</small></button>`).join("")}</div>
<div class="cp-chips">${pe[S.p5.etage].map(x => `<button type="button" class="chip cp-chip${x.code in f.notes ? " on" : ""}" data-action="note" data-code="${x.code}" aria-pressed="${x.code in f.notes}">${esc(x.nom)}</button>`).join("")}</div>
<p class="cp-compte">${n} note${n > 1 ? "s" : ""} choisie${n > 1 ? "s" : ""} · entre ${min} et ${max}</p>`,
    bas: bouton("Doser", "suivant", n < min || n > max ? "disabled" : ""),
  };
}

function ecranP5Doses() {
  const f = S.formule, s = M.securite(f), h = M.harmonie(f);
  const lignes = Object.keys(f.notes).sort((a, b) => ETAGES.indexOf(N.get(a).etage) - ETAGES.indexOf(N.get(b).etage) || f.notes[b] - f.notes[a]).map(c => {
    const lim = M.limitesNote(f, c) || { min: 0.5, max: 100 };
    return curseur(`note-${c}`, N.get(c).nom, f.notes[c], { min: 0.5, max: Math.max(0.5, lim.max), pas: 0.5, sortie: pct(f.notes[c]) });
  }).join("");
  const sug = P.suggestions(f).map(x => `<div class="cp-aide"><p>${esc(x.titre)}</p><div class="cp-chips">${x.notes.map(n => bouton(`+ ${esc(n.nom)}`, "note", `data-code="${n.code}"`, "chip cp-chip")).join("")}</div></div>`).join("");
  return {
    corps: `<h2 class="cp-h2">Tes doses</h2><div data-zone="jauges">${jaugeHarmonie(h)}${jaugeMarge(s.marge_min)}</div>${sug}
${lignes}${curseur("concentration", "Intensité", f.concentration, { min: M.plages().concentration.min, max: M.plages().concentration.max, pas: 1, gauche: "légère", droite: "intense", sortie: pct(f.concentration) })}
<p class="cp-note">Les curseurs s'arrêtent à la limite de sécurité de chaque note ; les autres s'ajustent pour rester à 100 %.</p>`,
    bas: bouton("Voir le récap", "recap"),
  };
}

// ----- Récap -----
function ecranRecap() {
  const f = S.formule;
  const r = P.recap(f, { porte: S.porte || "P5", confirme: S.confirme });
  const prix = S.serveur.prix || B.prix_eur || {};
  const venteOuverte = B.vente_active === true && S.serveur.vente !== false && WORKER();
  const ok = r.conforme && (r.commande === "oui");
  const formats = FORMATS.map(([id, nom, detail]) => `<label class="cp-format${S.format === id ? " on" : ""}"><input type="radio" name="format" value="${id}" data-champ="format"${S.format === id ? " checked" : ""}>
<b>${esc(nom)}</b><span>${esc(detail)}</span><em>${prix[CLE_PRIX[id]] != null ? euros(prix[CLE_PRIX[id]]) : ""}</em></label>`).join("");
  const texte = S.ia.texte || r.description;
  return {
    corps: `<h2 class="cp-h2">Ton parfum</h2>${pyramideHtml(f)}${jaugeHarmonie(r.harmonie)}
<p class="cp-desc">${esc(texte)}</p>${S.ia.texte ? `<p class="cp-note">Description écrite par une IA, relue par nos règles.</p>` : ""}
${r.conforme ? `<p class="cp-conforme">Conforme ✓ <span>limites de sécurité respectées</span></p>` : alerte("erreur", r.erreurs)}
${alerte("attention", r.avertissements)}
${r.commande === "avec_confirmation" || (S.confirme && r.harmonie.libelle === "deconseille") ? `<label class="cp-confirme"><input type="checkbox" data-champ="confirme"${S.confirme ? " checked" : ""}> Je comprends que ces notes risquent de mal s'accorder, je veux quand même ce parfum.</label>` : ""}
${r.commande === "non" && r.conforme ? `<p class="cp-note">Cette formule ne peut pas être commandée depuis cette porte : passe par le mode expert pour la garder telle quelle.</p>` : ""}
<fieldset class="cp-formats"><legend>Ton format</legend>${formats}</fieldset>
<p class="cp-note">${esc(B.delai || "")}${S.format === "kit" && B.kit_deduit ? ` · ${esc(B.kit_deduit)}` : ""}</p>
${S.serveur.code ? `<p class="cp-code">Ton code de formule : <b>${esc(S.serveur.code)}</b>. Garde-le pour recommander exactement le même parfum.</p>` : ""}
${S.serveur.erreur ? `<p class="cp-retour">${esc(S.serveur.erreur)}</p>` : ""}`,
    bas: venteOuverte && ok ? bouton("Commander", "commander") : `<button type="button" class="btn" disabled>${ok || !r.conforme ? "Bientôt disponible" : "Coche la case pour continuer"}</button>`,
  };
}

const ECRANS = {
  accueil: ecranAccueil,
  "p1-recherche": ecranP1Recherche, "p1-notes": ecranP1Notes, "p1-reglages": ecranP1Reglages,
  "p2-ambiances": ecranP2Ambiances, "p2-recettes": ecranRecettes, "p2-reglages": () => ecranReglages(),
  "p3-question": ecranP3Question, "p3-detestee": ecranP3Detestee, "p3-recettes": ecranRecettes, "p3-reglages": () => ecranReglages({ intensite: false }),
  "p4-catalogue": ecranP4Catalogue, "p4-fiche": ecranP4Fiche,
  "p5-notes": ecranP5Notes, "p5-doses": ecranP5Doses,
  recap: ecranRecap,
};

function rendre(haut = false) {
  const { corps, bas } = ECRANS[S.ecran]();
  const retourHtml = S.ecran !== "accueil" ? `<div class="cp-haut">${bouton("← Retour", "retour", "", "cp-lien")}${bouton("Accueil", "accueil", "", "cp-lien")}</div>` : "";
  racine.innerHTML = `${progression()}${retourHtml}<div class="cp-ecran">${corps}</div>${bas ? `<div class="cp-bas">${bas}</div>` : ""}`;
  if (haut) racine.scrollIntoView({ block: "start" });
  if (S.ecran === "recap") preparerRecap();
}

// Zone qui change pendant qu'on bouge un curseur (sans redessiner les curseurs eux-mêmes).
function rafraichirDirect() {
  const z = racine.querySelector('[data-zone="direct"]');
  if (z) z.innerHTML = `${pyramideHtml(S.formule)}${jaugeHarmonie(M.harmonie(S.formule))}`;
  const j = racine.querySelector('[data-zone="jauges"]');
  if (j) j.innerHTML = `${jaugeHarmonie(M.harmonie(S.formule))}${jaugeMarge(M.securite(S.formule).marge_min)}`;
}

// ---------------- Récap : code enregistré par le serveur, puis explication par l'IA ----------------

async function preparerRecap() {
  const f = S.formule;
  const cle = JSON.stringify([f, S.porte, S.confirme]);
  if (!WORKER() || S.serveur.cle === cle || !M.securite(f).ok) return;
  S.serveur = { code: null, prix: null, vente: null, erreur: null, cle };
  const r = await api("/api/formule", { corps: { formule: f, porte: S.porte || "P5", confirme: S.confirme } });
  if (S.serveur.cle !== cle) return;
  if (!r.ok) { S.serveur.erreur = r.donnees.erreur || null; if (S.ecran === "recap") rendre(); return; }
  Object.assign(S.serveur, { code: r.donnees.code, prix: r.donnees.prix || null, vente: r.donnees.vente });
  memo.ecrire(CLE_CODE, r.donnees.code);
  if (S.ecran === "recap") rendre();
  if (D.features.ia_active && S.ia.cle !== r.donnees.code) {
    S.ia = { texte: null, cle: r.donnees.code };
    const x = await api("/api/ia/expliquer", { corps: { code: r.donnees.code } });
    if (S.ia.cle === r.donnees.code && x.ok && x.donnees.texte) { S.ia.texte = x.donnees.texte; if (S.ecran === "recap") rendre(); }
  }
}

async function commander() {
  if (!S.serveur.code) { S.serveur.erreur = "Le code de ta formule n'est pas encore prêt : réessaie dans un instant."; rendre(); return; }
  const r = await api("/api/checkout", { corps: { code: S.serveur.code, format: S.format, quantite: 1 } });
  if (r.ok && r.donnees.url) { location.href = r.donnees.url; return; }
  S.serveur.erreur = r.donnees.erreur || "Paiement indisponible pour le moment.";
  rendre();
}

// ---------------- clics et saisies ----------------

function demarrer(porte) {
  S.porte = porte;
  S.pile = [{ ecran: "accueil", quizI: 0 }];
  S.confirme = false;
  if (porte === "P1") S.ecran = "p1-recherche";
  if (porte === "P2") S.ecran = "p2-ambiances";
  if (porte === "P3") { S.quiz = { reponses: {}, i: 0, detestee: "" }; S.ecran = "p3-question"; }
  if (porte === "P4") S.ecran = "p4-catalogue";
  if (porte === "P5") { S.formule = { concentration: D.regles.concentration.defaut, notes: {} }; S.ecran = "p5-notes"; }
  rendre(true);
}

function choisirParfum(slug) {
  S.p1.slug = slug;
  const cv = P.couverture(slug);
  if (cv && cv.total) {
    S.p1.couverture = cv;
    S.p1.proposition = P.proposerDepuisNotes(cv.codes);
  } else {
    // Pas de notes publiées : la structure la plus proche d'après les accords.
    const acc = P.proposerDepuisAccords((D.accords || {})[slug] || []);
    S.p1.couverture = { etages: { tete: [], coeur: [], fond: [] }, couvertes: 0, total: 0, codes: [] };
    S.p1.proposition = acc && acc.formule ? { formule: acc.formule, structure: acc.structure, ajoutees: [] } : null;
  }
  aller("p1-notes");
}

function choisirRecette(code) {
  const r = P.resumeRecette(code);
  S.titreRecettes = r.nom;
  const c = S.porte === "P3" ? S.quizConcentration : S.porte === "P2" ? S.p2Concentration : undefined;
  S.base = P.formuleRecette(code, c ?? D.regles.concentration.defaut);
  S.curseurs = { fraicheur: 0, douceur: 0, intensite: 0 };
  S.formule = S.base;
  aller(S.porte === "P4" ? "p4-fiche" : S.porte === "P2" ? "p2-reglages" : "p3-reglages");
}

racine.addEventListener("click", e => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "FORM") return;
  const a = el.dataset.action;
  if (a === "porte") return demarrer(el.dataset.porte);
  if (a === "retour") return retour();
  if (a === "accueil") return accueil();
  if (a === "parfum") return choisirParfum(el.dataset.slug);
  if (a === "ambiance") {
    const amb = D.portes.ambiances.find(x => x.id === el.dataset.id);
    S.recettes = P.recettesAmbiance(el.dataset.id);
    S.titreRecettes = amb ? amb.nom : "Choisis ta recette";
    S.p2Concentration = undefined;
    return aller("p2-recettes");
  }
  if (a === "recette") return choisirRecette(el.dataset.code);
  if (a === "reponse") {
    S.quiz.reponses[el.dataset.q] = el.dataset.r;
    if (S.quiz.i < P.quiz().length - 1) { S.pile.push({ ecran: S.ecran, quizI: S.quiz.i }); S.quiz.i++; return rendre(true); }
    return aller("p3-detestee");
  }
  if (a === "famille") { S.p4.famille = el.dataset.id || null; return rendre(); }
  if (a === "moins" || a === "plus") { S.formule = P.ajusterNote(S.formule, el.dataset.code, a === "plus" ? 5 : -5); return rendre(); }
  if (a === "onglet") { S.p5.etage = el.dataset.etage; return rendre(); }
  if (a === "note") {
    const c = el.dataset.code;
    S.formule = c in S.formule.notes ? P.retirerNote(S.formule, c) : P.ajouterNote(S.formule, c);
    return rendre();
  }
  if (a === "suivant") {
    if (S.ecran === "p1-notes") { S.formule = S.p1.proposition.formule; S.p1.etages = P.partsEtages(S.formule); return aller("p1-reglages"); }
    if (S.ecran === "p3-detestee") {
      const res = P.resultatQuiz(S.quiz.reponses, { detestee: S.quiz.detestee || null });
      S.recettes = res.recettes;
      S.quizConcentration = res.concentration;
      S.titreRecettes = `Tes pistes : ${res.structures.map(s => s.nom.toLowerCase()).join(" et ")}`;
      return aller("p3-recettes");
    }
    if (S.ecran === "p5-notes") { S.formule = P.proposerDoses(Object.keys(S.formule.notes), { concentration: S.formule.concentration }); return aller("p5-doses"); }
  }
  if (a === "recap") return aller("recap");
  if (a === "commander") return commander();
});

racine.addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.target;
  if (form.dataset.action === "comprendre") {
    S.comprendre.texte = form.texte.value;
    S.comprendre.attente = true;
    S.comprendre.erreur = null;
    rendre();
    const r = await api("/api/ia/comprendre", { corps: { texte: S.comprendre.texte } });
    S.comprendre.attente = false;
    if (r.ok && r.donnees.resultat) {
      const x = P.depuisComprehension(r.donnees.resultat);
      S.recettes = x.recettes;
      S.p2Concentration = x.concentration;
      S.titreRecettes = "Nos propositions";
      return aller("p2-recettes");
    }
    S.comprendre.erreur = r.donnees.erreur || "On n'a pas pu lire ta description : choisis plutôt une ambiance.";
    return rendre();
  }
  if (form.dataset.action === "rappel") {
    S.rappel.texte = form.code.value;
    const r = await api(`/api/formule?code=${encodeURIComponent(form.code.value.trim())}`, { methode: "GET" });
    if (!r.ok) { S.rappel.erreur = r.donnees.erreur || "Code introuvable."; return rendre(); }
    S.porte = "P5";
    S.pile = [{ ecran: "accueil", quizI: 0 }];
    S.formule = r.donnees.a_mettre_a_jour && r.donnees.variante ? r.donnees.variante : r.donnees.formule;
    S.rappel.erreur = r.donnees.a_mettre_a_jour ? "Formule à mettre à jour : voici la version conforme la plus proche." : null;
    S.ecran = "recap";
    return rendre(true);
  }
});

function lireCurseur(input, fin) {
  const nom = input.dataset.curseur, v = Number(input.value);
  if (["fraicheur", "douceur", "intensite"].includes(nom)) {
    S.curseurs[nom] = v;
    S.formule = P.appliquerCurseurs(S.base, S.curseurs);
  } else if (nom.startsWith("etage-")) {
    S.p1.etages[nom.slice(6)] = v;
    S.formule = P.reglerEtages(S.p1.proposition.formule, S.p1.etages);
    S.formule = P.reglerIntensite(S.formule, S.formule.concentration);
  } else if (nom === "concentration") {
    S.formule = P.reglerIntensite(S.formule, v);
  } else if (nom.startsWith("note-")) {
    S.formule = P.reglerNote(S.formule, nom.slice(5), v);
  }
  const sortie = racine.querySelector(`[data-sortie="${nom}"]`);
  if (sortie && nom.startsWith("note-")) sortie.textContent = pct(S.formule.notes[nom.slice(5)] ?? v);
  else if (sortie && (nom === "concentration" || nom === "intensite")) sortie.textContent = pct(S.formule.concentration);
  if (fin) rendre(); else rafraichirDirect();
}

racine.addEventListener("input", e => {
  if (e.target.dataset.curseur) return lireCurseur(e.target, false);
  if (e.target.dataset.champ === "recherche") {
    S.p1.recherche = e.target.value;
    const pos = e.target.selectionStart;
    rendre();
    const champ = racine.querySelector('[data-champ="recherche"]');
    if (champ) { champ.focus(); champ.setSelectionRange(pos, pos); }
  }
});

racine.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.curseur) return lireCurseur(t, true);
  if (t.dataset.remplacer && t.value) { S.formule = P.remplacer(S.formule, t.dataset.remplacer, t.value); return rendre(); }
  if (t.dataset.champ === "detestee") S.quiz.detestee = t.value;
  if (t.dataset.champ === "format") { S.format = t.value; return rendre(); }
  if (t.dataset.champ === "confirme") { S.confirme = t.checked; return rendre(); }
});

// ---------------- démarrage ----------------

(async () => {
  try {
    D = await fetch(new URL("donnees.json", BASE), { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  } catch (e) {
    racine.innerHTML = `<p class="cp-vide">L'atelier ne s'est pas chargé. Recharge la page.</p>`;
    return;
  }
  M = creerMoteur(D);
  P = creerPortes(D, M);
  B = D.boutique || {};
  N = new Map(Object.values(D.notes.notes).map(n => [n.code, n]));
  const params = new URLSearchParams(location.search);
  const slug = params.get("parfum");
  if (slug && D.features.inspiration_nommee && P.portesVisibles().some(p => p.id === "P1")) {
    S.porte = "P1"; S.pile = [{ ecran: "accueil", quizI: 0 }]; S.ecran = "p1-recherche";
    return choisirParfum(slug);
  }
  if (params.get("code")) S.rappel.texte = params.get("code");
  rendre();
})();
