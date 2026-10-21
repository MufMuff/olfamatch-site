/*
 * Contrôle des fichiers de données de « Crée ton parfum » (data/creer/*.json).
 * Renvoie la liste des problèmes trouvés, en phrases simples. Liste vide = tout va bien.
 * Lancé par les tests : une erreur de frappe dans un fichier fait échouer les tests
 * au lieu d'arriver sur le site.
 */
import { ETAGES } from "./moteur.js";

const AMBIANCES = ["fraiche", "florale", "boisee", "chaude", "gourmande"];
const MOMENTS = ["jour", "soir"];
const SAISONS = ["printemps", "ete", "automne", "hiver"];
const INTENSITES = ["douce", "intense"];

const num = v => typeof v === "number" && Number.isFinite(v);
const texte = v => typeof v === "string" && v.trim() !== "";
const sousListe = (v, permis) => Array.isArray(v) && v.length > 0 && v.every(x => permis.includes(x));

export function controlerDonnees({ notes, compatibilite, recettes, regles }) {
  const pb = [];
  const R = regles || {};
  const N = (notes && notes.notes) || {};
  const REC = (recettes && recettes.recettes) || {};
  const familles = Object.keys(R.equilibre || {});

  // ---------- regles.json ----------
  const c = R.concentration || {};
  if (!(num(c.min) && num(c.max) && num(c.defaut) && 0 < c.min && c.min <= c.defaut && c.defaut <= c.max && c.max <= 100))
    pb.push("regles.json : concentration incohérente (il faut 0 < min ≤ defaut ≤ max ≤ 100).");
  const nb = R.nombre_notes || {};
  if (!(Number.isInteger(nb.min) && Number.isInteger(nb.max) && 1 <= nb.min && nb.min <= nb.max))
    pb.push("regles.json : nombre_notes incohérent (il faut 1 ≤ min ≤ max).");
  for (const e of ETAGES)
    if (!Number.isInteger((R.minimum_par_etage || {})[e])) pb.push(`regles.json : minimum_par_etage.${e} manque.`);
  if (!familles.length) pb.push("regles.json : aucune famille dans equilibre.");
  for (const f of familles) {
    const eq = R.equilibre[f];
    if (!texte(eq.nom)) pb.push(`regles.json : la famille ${f} n'a pas de nom affiché.`);
    let lo = 0, hi = 0;
    for (const e of ETAGES) {
      const p = eq[e];
      if (!(Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]) && 0 <= p[0] && p[0] <= p[1] && p[1] <= 100)) {
        pb.push(`regles.json : plage ${f} / ${e} incorrecte (il faut [minimum, maximum]).`);
        continue;
      }
      lo += p[0]; hi += p[1];
    }
    if (lo > 100 || hi < 100) pb.push(`regles.json : les plages de la famille ${f} ne permettent pas de faire 100 %.`);
  }
  for (const id of R.notes_de_tenue || []) if (!N[id]) pb.push(`regles.json : note de tenue inconnue « ${id} ».`);
  for (const g of R.associations_interdites || [])
    for (const id of g) if (!N[id]) pb.push(`regles.json : association interdite avec une note inconnue « ${id} ».`);
  const m = R.matrice || {};
  if (!num(m.moyenne_min)) pb.push("regles.json : matrice.moyenne_min manque.");
  if (!(m.risquees_max && Number.isInteger(m.risquees_max.guide) && Number.isInteger(m.risquees_max.expert)))
    pb.push("regles.json : matrice.risquees_max doit donner un nombre pour guide et pour expert.");
  if (!(num(m.reduction_note_forte) && m.reduction_note_forte > 0 && m.reduction_note_forte <= 1))
    pb.push("regles.json : matrice.reduction_note_forte doit être entre 0 et 1.");
  const p = R.puissance || {};
  if (!(num(p.part_max_par_note) && Number.isInteger(p.fortes_a_partir_de) && Number.isInteger(p.fortes_max)))
    pb.push("regles.json : bloc puissance incomplet.");
  if (!(R.ifra && typeof R.ifra.exiger_certificat === "boolean")) pb.push("regles.json : ifra.exiger_certificat doit valoir true ou false.");
  const g = R.guide || {};
  if (!(num(g.marge_defaut) && Number.isInteger(g.ajouts_max) && num(g.ajout_dose_max))) pb.push("regles.json : bloc guide incomplet.");
  if (!(num(R.pas_pourcentage) && R.pas_pourcentage > 0)) pb.push("regles.json : pas_pourcentage doit être un nombre positif.");
  if (!(num(R.densite_g_ml) && R.densite_g_ml > 0)) pb.push("regles.json : densite_g_ml doit être un nombre positif.");

  // ---------- notes.json ----------
  const codes = new Map();
  for (const [id, n] of Object.entries(N)) {
    const ou = `notes.json, ${id}`;
    if (!/^[a-z0-9_]+$/.test(id)) pb.push(`${ou} : identifiant à écrire en minuscules, sans accent ni espace.`);
    if (!texte(n.nom)) pb.push(`${ou} : nom manquant.`);
    if (typeof n.code !== "string" || !/^[A-Z]{3}$/.test(n.code)) pb.push(`${ou} : code de 3 lettres majuscules attendu.`);
    else if (codes.has(n.code)) pb.push(`${ou} : le code ${n.code} est déjà pris par ${codes.get(n.code)}.`);
    else codes.set(n.code, id);
    if (!ETAGES.includes(n.etage)) pb.push(`${ou} : etage doit valoir ${ETAGES.join(", ")}.`);
    if (n.famille !== "neutre" && !familles.includes(n.famille)) pb.push(`${ou} : famille inconnue « ${n.famille} ».`);
    if (!(Number.isInteger(n.puissance) && n.puissance >= 1 && n.puissance <= 5)) pb.push(`${ou} : puissance entière de 1 à 5 attendue.`);
    if (!(num(n.tenue_h) && n.tenue_h > 0)) pb.push(`${ou} : tenue_h doit être un nombre d'heures.`);
    if (!(num(n.dose_min) && num(n.dose_max) && 0 < n.dose_min && n.dose_min <= n.dose_max && n.dose_max <= 100))
      pb.push(`${ou} : doses incohérentes (il faut 0 < dose_min ≤ dose_max ≤ 100).`);
    if (!(num(n.ifra_max) && n.ifra_max > 0)) pb.push(`${ou} : ifra_max doit être un nombre positif.`);
    if (n.ifra_certificat !== null && !texte(n.ifra_certificat)) pb.push(`${ou} : ifra_certificat doit être null ou une référence.`);
    if (n.allergenes !== null && !(typeof n.allergenes === "object" && !Array.isArray(n.allergenes) &&
        Object.values(n.allergenes).every(v => num(v) && v >= 0 && v <= 100)))
      pb.push(`${ou} : allergenes doit être null ou une liste {"Nom": % dans l'huile}.`);
    if (!(num(n.dilution_stock) && n.dilution_stock > 0 && n.dilution_stock <= 100)) pb.push(`${ou} : dilution_stock entre 1 et 100 attendue.`);
    if (n.cout_g !== null && !(num(n.cout_g) && n.cout_g >= 0)) pb.push(`${ou} : cout_g doit être null ou un nombre.`);
    if (n.stock_g !== null && !(num(n.stock_g) && n.stock_g >= 0)) pb.push(`${ou} : stock_g doit être null ou un nombre.`);
    if (typeof n.actif !== "boolean") pb.push(`${ou} : actif doit valoir true ou false.`);
    if (typeof n.texte !== "string") pb.push(`${ou} : texte manquant.`);
  }

  // ---------- compatibilite.json ----------
  const C = compatibilite || {};
  if (!num(C.score_par_defaut)) pb.push("compatibilite.json : score_par_defaut manque.");
  const vues = new Map();
  for (const nomListe of ["accords", "risquees", "interdites"]) {
    if (!Array.isArray(C[nomListe])) { pb.push(`compatibilite.json : la liste ${nomListe} manque.`); continue; }
    C[nomListe].forEach((grp, i) => {
      const ou = `compatibilite.json, ${nomListe} ligne ${i + 1}`;
      if (!Array.isArray(grp) || grp.length < 2) { pb.push(`${ou} : au moins 2 notes attendues.`); return; }
      if (nomListe === "accords" && grp.length > 2) pb.push(`${ou} : un accord classique se note par paire.`);
      for (const id of grp) if (!N[id]) pb.push(`${ou} : note inconnue « ${id} ».`);
      if (new Set(grp).size !== grp.length) pb.push(`${ou} : note en double.`);
      const k = [...grp].sort().join("|");
      if (vues.has(k)) pb.push(`${ou} : association déjà notée (${vues.get(k)}).`);
      else vues.set(k, `${nomListe} ligne ${i + 1}`);
    });
  }

  // ---------- recettes.json ----------
  if (!Object.keys(REC).length) pb.push("recettes.json : aucune recette.");
  for (const [rid, r] of Object.entries(REC)) {
    const ou = `recettes.json, ${rid}`;
    if (!/^R\d{2}$/.test(rid)) pb.push(`${ou} : identifiant attendu de la forme R01.`);
    if (!texte(r.nom)) pb.push(`${ou} : nom manquant.`);
    if (!familles.includes(r.famille)) pb.push(`${ou} : famille inconnue « ${r.famille} ».`);
    if (!AMBIANCES.includes(r.ambiance)) pb.push(`${ou} : ambiance parmi ${AMBIANCES.join(", ")}.`);
    if (!sousListe(r.moment, MOMENTS)) pb.push(`${ou} : moment parmi ${MOMENTS.join(", ")}.`);
    if (!sousListe(r.saisons, SAISONS)) pb.push(`${ou} : saisons parmi ${SAISONS.join(", ")}.`);
    if (!INTENSITES.includes(r.intensite)) pb.push(`${ou} : intensite parmi ${INTENSITES.join(", ")}.`);
    if (!(num(r.concentration) && r.concentration >= c.min && r.concentration <= c.max)) pb.push(`${ou} : concentration hors de la plage de regles.json.`);
    if (r.marge !== undefined && !(num(r.marge) && r.marge >= 0)) pb.push(`${ou} : marge doit être un nombre positif.`);
    const doses = r.notes && typeof r.notes === "object" ? Object.entries(r.notes) : [];
    if (!doses.length) { pb.push(`${ou} : notes manquantes.`); continue; }
    for (const [id, v] of doses) {
      if (!N[id]) pb.push(`${ou} : note inconnue « ${id} ».`);
      else if (N[id].actif === false) pb.push(`${ou} : la note ${id} est désactivée.`);
      if (!(num(v) && v > 0)) pb.push(`${ou} : dose de ${id} incorrecte.`);
    }
    const total = doses.reduce((s, [, v]) => s + (num(v) ? v : 0), 0);
    if (Math.abs(total - 100) > 1e-6) pb.push(`${ou} : le total des doses fait ${total} au lieu de 100.`);
  }
  return pb;
}
