/*
 * Contrôle des fichiers de données de « Crée ton parfum » V2 (data/creer/*.json).
 * Renvoie la liste des problèmes trouvés, en phrases simples. Liste vide = tout va bien.
 * Lancé par les tests : une erreur de frappe dans un fichier fait échouer les tests
 * au lieu d'arriver sur le site.
 */
import { ETAGES, borneHaute } from "./moteur.js";

const num = v => typeof v === "number" && Number.isFinite(v);
const entier = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const texte = v => typeof v === "string" && v.trim() !== "";
const objet = v => v !== null && typeof v === "object" && !Array.isArray(v);
const pct = v => (Array.isArray(v) ? v.length === 2 && v.every(x => num(x) && x >= 0 && x <= 100) && v[0] <= v[1] : num(v) && v >= 0 && v <= 100);
const url = v => typeof v === "string" && /^https:\/\/[^\s]+$/.test(v);
const date = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const FAMILLES = ["frais", "floral", "gourmand", "boise", "ambre"];
const DOCS = ["fds", "ifra", "coa", "allergenes"];

export const FICHIERS = ["notes", "facettes", "matrice_sf", "exceptions", "structures", "recettes", "ifra_cat4",
  "allergenes", "matieres_lots", "cadre_securite", "regles", "boutique", "portes", "notes_publiees", "correspondances"];

export function controlerDonnees(d) {
  const pb = [];
  const R = d.regles || {};
  const N = d.notes?.notes || {};
  const SF = d.matrice_sf?.sous_familles || {};
  const M = d.matrice_sf?.matrice || {};
  const FAC = d.facettes?.facettes || {};
  const SUBST = d.ifra_cat4?.substances || {};
  const ALL = new Map((d.allergenes?.allergenes || []).map(a => [a.id, a]));
  const LOTS = new Map();
  const codes = new Map();
  const PAS = R.pas_pourcentage;
  const STRUCT = d.structures?.structures || {};

  // ---------- regles.json ----------
  const c = R.concentration || {};
  if (!(num(c.min) && num(c.max) && num(c.defaut) && 0 < c.min && c.min <= c.defaut && c.defaut <= c.max && c.max <= 100 && num(c.pas) && c.pas > 0))
    pb.push("regles.json : concentration incohérente (il faut 0 < min ≤ defaut ≤ max ≤ 100, et un pas).");
  const nb = R.nombre_notes || {};
  if (!(Number.isInteger(nb.min) && Number.isInteger(nb.max) && 1 <= nb.min && nb.min <= nb.max)) pb.push("regles.json : nombre_notes incohérent.");
  if (!(num(PAS) && PAS > 0)) pb.push("regles.json : pas_pourcentage doit être un nombre positif.");
  const H = R.harmonie || {};
  if (!(num(H.base) && objet(H.poids) && ["sous_familles", "facettes", "pyramide"].every(k => num(H.poids[k]))))
    pb.push("regles.json : harmonie.base et harmonie.poids (sous_familles, facettes, pyramide) doivent être des nombres.");
  if (!(num(H.pyramide?.ecart_nul) && H.pyramide.ecart_nul > 0 && num(H.pyramide?.part_etage_secondaire) && H.pyramide.part_etage_secondaire >= 0 && H.pyramide.part_etage_secondaire <= 1))
    pb.push("regles.json : harmonie.pyramide incomplet.");
  const P = H.penalites || {};
  if (!(num(P.au_dessus_dose_max) && num(P.note_tres_puissante?.points) && num(P.note_tres_puissante?.seuil_pct) && num(P.note_tres_puissante?.puissance)
      && num(P.trop_de_notes?.max) && num(P.trop_de_notes?.points) && num(P.trop_peu_de_notes?.min) && num(P.trop_peu_de_notes?.points)))
    pb.push("regles.json : harmonie.penalites incomplet.");
  if (!(num(H.seuils?.bon) && num(H.seuils?.risque) && H.seuils.risque <= H.seuils.bon)) pb.push("regles.json : harmonie.seuils incohérents (risque ≤ bon).");
  if (!(num(H.regle_dure?.valeur) && num(H.regle_dure?.part_min_pct))) pb.push("regles.json : harmonie.regle_dure incomplet.");
  const cmd = H.commande || {};
  const okCmd = v => ["oui", "non", "avec_confirmation"].includes(v);
  if (!(okCmd(cmd.bon) && okCmd(cmd.risque) && objet(cmd.deconseille) && ["P1", "P2", "P3", "P4", "P5"].every(p => okCmd(cmd.deconseille[p]))))
    pb.push("regles.json : harmonie.commande doit dire oui, non ou avec_confirmation (et pour « deconseille », par porte P1 à P5).");
  if (cmd.deconseille && ["P1", "P2", "P3", "P4"].some(p => cmd.deconseille[p] === "oui"))
    pb.push("regles.json : une formule « Déconseillé » ne doit jamais être commandable dans les portes P1 à P4.");
  const S = R.securite || {};
  if (!(num(S.atranol_max_ppm) && S.atranol_max_ppm > 0)) pb.push("regles.json : securite.atranol_max_ppm manque.");
  for (const s of S.substances_atranol || []) if (!SUBST[s]) pb.push(`regles.json : securite.substances_atranol cite une substance absente de ifra_cat4.json (${s}).`);
  if (!SUBST[S.bergamote_substance]) pb.push("regles.json : securite.bergamote_substance doit exister dans ifra_cat4.json.");
  const F = R.fabrication || {};
  if (!(num(F.densite_alcool_g_ml) && num(F.densite_concentre_g_ml) && num(F.marge_liquide_pct) && num(F.tolerance_pesee_pct) && num(F.tolerance_pesee_g)
      && Array.isArray(F.ordre_pesee) && F.ordre_pesee.length === 3 && ETAGES.every(e => F.ordre_pesee.includes(e))))
    pb.push("regles.json : bloc fabrication incomplet.");
  const kit = R.kit || {};
  const reglage = v => v === undefined || (num(v) && v >= -1 && v <= 1);
  if (!(num(kit.flacon_ml) && kit.flacon_ml > 0 && num(kit.lot_ml) && kit.lot_ml >= kit.flacon_ml)) pb.push("regles.json : kit.flacon_ml et kit.lot_ml incorrects.");
  if (!(Array.isArray(kit.variantes) && kit.variantes.length && kit.variantes.every(v => texte(v.nom) && reglage(v.fraicheur) && reglage(v.douceur) && reglage(v.intensite))))
    pb.push("regles.json : kit.variantes doit lister des variantes avec un nom et des réglages entre -1 et 1.");
  const cu = R.curseurs || {};
  if (!(objet(cu.fraicheur) && ETAGES.every(e => num(cu.fraicheur[e])))) pb.push("regles.json : curseurs.fraicheur doit donner un nombre pour tete, coeur et fond.");
  if (!(objet(cu.douceur) && [...FAMILLES, "neutre"].every(f => num(cu.douceur[f])))) pb.push("regles.json : curseurs.douceur doit donner un nombre pour chaque famille et pour neutre.");
  const et = R.etiquette || {};
  if (!(texte(et.inci_alcool) && texte(et.inci_parfum) && texte(et.fonction) && texte(et.precautions))) pb.push("regles.json : etiquette doit donner inci_alcool, inci_parfum, fonction et precautions.");
  if (et.responsable !== null && !texte(et.responsable)) pb.push("regles.json : etiquette.responsable doit être null ou un texte.");
  if (!(Array.isArray(R.volumes_ml) && R.volumes_ml.length && R.volumes_ml.every(v => Number.isInteger(v) && v > 0))) pb.push("regles.json : volumes_ml incorrect.");

  // ---------- matrice_sf.json ----------
  const sfs = Object.keys(SF);
  if (sfs.length !== 15) pb.push(`matrice_sf.json : 15 sous-familles attendues (ici ${sfs.length}).`);
  for (const [k, v] of Object.entries(SF)) {
    if (!texte(v.nom)) pb.push(`matrice_sf.json : la sous-famille ${k} n'a pas de nom.`);
    if (!FAMILLES.includes(v.famille)) pb.push(`matrice_sf.json : famille inconnue pour ${k} (« ${v.famille} »).`);
  }
  for (const a of sfs) for (const b of sfs) {
    const v = M[a]?.[b];
    if (!(num(v) && v >= -2 && v <= 2)) { pb.push(`matrice_sf.json : valeur ${a}/${b} manquante ou hors de -2…+2.`); continue; }
    if (M[b]?.[a] !== v) pb.push(`matrice_sf.json : la matrice n'est pas symétrique (${a}/${b} = ${v}, ${b}/${a} = ${M[b]?.[a]}).`);
  }

  // ---------- facettes.json ----------
  if (Object.keys(FAC).length !== 22) pb.push(`facettes.json : 22 facettes attendues (ici ${Object.keys(FAC).length}).`);
  const vuesAff = new Set();
  (d.facettes?.affinites || []).forEach(([a, b, v], i) => {
    const ou = `facettes.json, affinité ${i + 1}`;
    if (!FAC[a] || !FAC[b]) pb.push(`${ou} : facette inconnue (${a}, ${b}).`);
    if (!(num(v) && v >= -1 && v <= 1)) pb.push(`${ou} : valeur entre -1 et 1 attendue.`);
    const k = [a, b].sort().join("|");
    if (vuesAff.has(k)) pb.push(`${ou} : paire déjà notée.`);
    vuesAff.add(k);
  });

  // ---------- notes.json ----------
  for (const [id, n] of Object.entries(N)) {
    const ou = `notes.json, ${id}`;
    if (!/^[a-z0-9_]+$/.test(id)) pb.push(`${ou} : identifiant à écrire en minuscules, sans accent ni espace.`);
    if (!texte(n.nom)) pb.push(`${ou} : nom manquant.`);
    if (typeof n.code !== "string" || !/^[A-Z]{3}$/.test(n.code)) pb.push(`${ou} : code de 3 lettres majuscules attendu.`);
    else if (codes.has(n.code)) pb.push(`${ou} : le code ${n.code} est déjà pris par ${codes.get(n.code)}.`);
    else codes.set(n.code, id);
    if (!["accord", "matiere"].includes(n.type)) pb.push(`${ou} : type doit valoir accord ou matiere.`);
    if (!entier(n.vague, 1, 3)) pb.push(`${ou} : vague 1, 2 ou 3 attendue.`);
    if (!SF[n.sous_famille]) pb.push(`${ou} : sous-famille inconnue « ${n.sous_famille} ».`);
    else if (n.famille !== SF[n.sous_famille].famille && n.famille !== "neutre")
      pb.push(`${ou} : famille « ${n.famille} » différente de celle de sa sous-famille (${SF[n.sous_famille].famille}) ; seule exception permise : neutre.`);
    if (!objet(n.facettes) || !Object.keys(n.facettes).length) pb.push(`${ou} : au moins une facette attendue.`);
    else for (const [f, v] of Object.entries(n.facettes)) {
      if (!FAC[f]) pb.push(`${ou} : facette inconnue « ${f} ».`);
      if (!(num(v) && v > 0 && v <= 1)) pb.push(`${ou} : intensité de la facette ${f} entre 0 et 1 attendue.`);
    }
    if (!ETAGES.includes(n.etage)) pb.push(`${ou} : etage doit valoir ${ETAGES.join(", ")}.`);
    if (n.etage_secondaire !== null && (!ETAGES.includes(n.etage_secondaire) || n.etage_secondaire === n.etage))
      pb.push(`${ou} : etage_secondaire doit être null ou un autre étage.`);
    if (!entier(n.puissance, 1, 5)) pb.push(`${ou} : puissance entière de 1 à 5 attendue.`);
    if (!entier(n.tenacite, 1, 5)) pb.push(`${ou} : tenacite entière de 1 à 5 attendue.`);
    if (!(num(n.tenue_h) && n.tenue_h > 0)) pb.push(`${ou} : tenue_h doit être un nombre d'heures.`);
    if (!(num(n.dose_min) && num(n.dose_max) && 0 < n.dose_min && n.dose_min <= n.dose_max && n.dose_max <= 100))
      pb.push(`${ou} : doses incohérentes (il faut 0 < dose_min ≤ dose_max ≤ 100).`);
    if (!(num(n.dilution_stock) && n.dilution_stock > 0 && n.dilution_stock <= 100)) pb.push(`${ou} : dilution_stock entre 1 et 100 attendue.`);
    if (!["A", "B", "C"].includes(n.prix_classe)) pb.push(`${ou} : prix_classe A, B ou C attendue.`);
    if (!["tres_courante", "moins_courante"].includes(n.dispo_chine)) pb.push(`${ou} : dispo_chine tres_courante ou moins_courante attendue.`);
    if (n.cout_g !== null && !(num(n.cout_g) && n.cout_g >= 0)) pb.push(`${ou} : cout_g doit être null ou un nombre.`);
    if (n.stock_g !== null && !(num(n.stock_g) && n.stock_g >= 0)) pb.push(`${ou} : stock_g doit être null ou un nombre.`);
    if (typeof n.actif !== "boolean") pb.push(`${ou} : actif doit valoir true ou false.`);
    if (!texte(n.texte)) pb.push(`${ou} : texte manquant.`);
  }
  const connue = code => codes.has(code);

  // ---------- exceptions.json ----------
  const ids = new Set(), vues = new Map();
  for (const e of d.exceptions?.exceptions || []) {
    const ou = `exceptions.json, ${e.id}`;
    if (!/^E\d{3}$/.test(e.id) || ids.has(e.id)) pb.push(`${ou} : identifiant E000 unique attendu.`);
    ids.add(e.id);
    if (!connue(e.a) || !connue(e.b) || e.a === e.b) pb.push(`${ou} : deux codes de notes différents attendus (${e.a}, ${e.b}).`);
    if (!(num(e.valeur) && e.valeur >= -2 && e.valeur <= 2)) pb.push(`${ou} : valeur entre -2 et +2 attendue.`);
    if (!texte(e.raison)) pb.push(`${ou} : raison manquante.`);
    const k = [e.a, e.b].sort().join("|");
    if (vues.has(k)) pb.push(`${ou} : paire déjà notée par ${vues.get(k)}.`);
    vues.set(k, e.id);
  }
  for (const g of d.exceptions?.groupes || []) {
    if (!(Array.isArray(g.notes) && g.notes.length >= 3 && g.notes.every(connue))) pb.push(`exceptions.json, groupe ${g.id} : au moins 3 codes de notes connus attendus.`);
    if (!(num(g.points) && g.points >= 0)) pb.push(`exceptions.json, groupe ${g.id} : points positifs attendus.`);
  }

  // ---------- structures.json ----------
  for (const [s, st] of Object.entries(STRUCT)) {
    const ou = `structures.json, ${s}`;
    const p = st.pyramide || {};
    if (!(ETAGES.every(e => num(p[e]) && p[e] >= 0) && Math.abs(ETAGES.reduce((x, e) => x + p[e], 0) - 100) < 1e-9))
      pb.push(`${ou} : la pyramide (tete, coeur, fond) doit faire 100.`);
    if (!(num(st.tolerance) && st.tolerance >= 0)) pb.push(`${ou} : tolerance manquante.`);
    if (!FAMILLES.includes(st.famille)) pb.push(`${ou} : famille inconnue.`);
    if (!entier(st.vague, 1, 3)) pb.push(`${ou} : vague 1, 2 ou 3 attendue.`);
    if (!(Array.isArray(st.obligatoires) && st.obligatoires.length && st.obligatoires.every(g => Array.isArray(g.notes) && g.notes.length && g.notes.every(connue))))
      pb.push(`${ou} : obligatoires doit lister des groupes de codes de notes connus.`);
    if (!(Array.isArray(st.optionnelles) && st.optionnelles.every(connue))) pb.push(`${ou} : optionnelles contient un code inconnu.`);
  }

  // ---------- recettes.json ----------
  for (const [rid, r] of Object.entries(d.recettes?.recettes || {})) {
    const ou = `recettes.json, ${rid}`;
    if (!/^R\d{2}$/.test(rid)) pb.push(`${ou} : identifiant attendu de la forme R01.`);
    if (!texte(r.nom)) pb.push(`${ou} : nom manquant.`);
    if (!STRUCT[r.structure]) pb.push(`${ou} : structure inconnue « ${r.structure} ».`);
    if (!["a_valider", "validee"].includes(r.statut)) pb.push(`${ou} : statut a_valider ou validee attendu.`);
    const doses = objet(r.notes) ? Object.entries(r.notes) : [];
    if (!doses.length) { pb.push(`${ou} : notes manquantes.`); continue; }
    let vmax = 0, total = 0;
    for (const [code, v] of doses) {
      if (!connue(code)) { pb.push(`${ou} : note inconnue « ${code} ».`); continue; }
      vmax = Math.max(vmax, N[codes.get(code)].vague);
      if (!(num(v) && v > 0 && Math.abs(v / PAS - Math.round(v / PAS)) < 1e-9)) pb.push(`${ou} : dose de ${code} incorrecte (multiple de ${PAS} attendu).`);
      total += num(v) ? v : 0;
    }
    if (Math.abs(total - 100) > 1e-6) pb.push(`${ou} : le total des doses fait ${total} au lieu de 100.`);
    if (vmax && r.vague !== vmax) pb.push(`${ou} : vague ${r.vague} indiquée, mais sa note la plus tardive est de la vague ${vmax}.`);
    const st = STRUCT[r.structure];
    if (st) for (const g of st.obligatoires || []) {
      const ok = g.notes.some(code => (r.notes[code] || 0) >= (g.min_pct || 0) && r.notes[code] > 0);
      if (!ok) pb.push(`${ou} : la structure ${r.structure} demande ${g.notes.join(" ou ")}${g.min_pct ? ` (au moins ${g.min_pct} %)` : ""}.`);
    }
  }

  // ---------- ifra_cat4.json ----------
  if (!Number.isInteger(d.ifra_cat4?.amendement)) pb.push("ifra_cat4.json : numéro d'amendement entier attendu.");
  for (const [s, v] of Object.entries(SUBST))
    if (!(texte(v.nom) && num(v.limite_pct) && v.limite_pct > 0)) pb.push(`ifra_cat4.json, ${s} : nom et limite_pct positive attendus.`);

  // ---------- allergenes.json ----------
  if (!(num(d.allergenes?.seuil_sans_rincage_pct) && d.allergenes.seuil_sans_rincage_pct > 0)) pb.push("allergenes.json : seuil_sans_rincage_pct manquant.");
  const vusA = new Set();
  for (const a of d.allergenes?.allergenes || []) {
    if (!/^[a-z0-9_]+$/.test(a.id) || vusA.has(a.id)) pb.push(`allergenes.json : identifiant « ${a.id} » incorrect ou en double.`);
    vusA.add(a.id);
    if (!texte(a.inci)) pb.push(`allergenes.json, ${a.id} : nom INCI manquant.`);
    if (a.max_pct_produit !== undefined && !(num(a.max_pct_produit) && a.max_pct_produit >= 0)) pb.push(`allergenes.json, ${a.id} : max_pct_produit doit être un nombre.`);
  }

  // ---------- matieres_lots.json ----------
  for (const l of d.matieres_lots?.lots || []) {
    const ou = `matieres_lots.json, ${l.lot}`;
    if (!texte(l.lot) || LOTS.has(l.lot)) pb.push(`${ou} : numéro de lot manquant ou en double.`);
    LOTS.set(l.lot, l);
    if (!connue(l.code_note)) pb.push(`${ou} : code_note inconnu.`);
    if (l.demo === true && !String(l.lot).startsWith("DEMO")) pb.push(`${ou} : un lot de démonstration doit commencer par DEMO.`);
    if (l.demo !== true && String(l.lot).startsWith("DEMO")) pb.push(`${ou} : un vrai lot ne doit pas commencer par DEMO.`);
    if (!(num(l.densite_g_ml) && l.densite_g_ml > 0.5 && l.densite_g_ml < 2)) pb.push(`${ou} : densité entre 0,5 et 2 attendue.`);
    if (!Number.isInteger(l.ifra_amendement)) pb.push(`${ou} : ifra_amendement entier attendu.`);
    if (!(num(l.ifra_cat4_max_pct_produit) && l.ifra_cat4_max_pct_produit > 0 && l.ifra_cat4_max_pct_produit <= 100)) pb.push(`${ou} : ifra_cat4_max_pct_produit entre 0 et 100 attendu.`);
    for (const [s, v] of Object.entries(l.substances_ifra_pct || {})) {
      if (!SUBST[s]) pb.push(`${ou} : substance « ${s} » absente de ifra_cat4.json.`);
      if (!pct(v)) pb.push(`${ou} : % de ${s} incorrect (nombre ou [mini, maxi]).`);
    }
    for (const [a, v] of Object.entries(l.allergenes_pct || {})) {
      if (!ALL.has(a)) pb.push(`${ou} : allergène « ${a} » absent de allergenes.json.`);
      if (!pct(v)) pb.push(`${ou} : % de ${a} incorrect (nombre ou [mini, maxi]).`);
    }
    if (!(objet(l.docs) && DOCS.every(k => typeof l.docs[k] === "boolean"))) pb.push(`${ou} : docs doit donner true ou false pour ${DOCS.join(", ")}.`);
    if (l.fcf !== undefined && typeof l.fcf !== "boolean") pb.push(`${ou} : fcf doit valoir true ou false.`);
    if (l.atranol_chloroatranol_ppm !== undefined && l.atranol_chloroatranol_ppm !== null && !(num(borneHaute(l.atranol_chloroatranol_ppm))))
      pb.push(`${ou} : atranol_chloroatranol_ppm doit être un nombre.`);
    if (!date(l.date_docs)) pb.push(`${ou} : date_docs au format AAAA-MM-JJ attendue.`);
  }
  for (const [id, n] of Object.entries(N)) {
    if (n.lot_actif === null) continue;
    const l = LOTS.get(n.lot_actif);
    if (!l) pb.push(`notes.json, ${id} : lot_actif « ${n.lot_actif} » absent de matieres_lots.json.`);
    else if (l.code_note !== n.code) pb.push(`notes.json, ${id} : le lot ${n.lot_actif} est celui d'une autre note (${l.code_note}).`);
  }

  // ---------- cadre_securite.json ----------
  const C = d.cadre_securite || {};
  if (C.version !== null && C.version !== undefined) {
    if (!(texte(String(C.version)) && date(C.date) && texte(C.signataire))) pb.push("cadre_securite.json : version, date (AAAA-MM-JJ) et signataire attendus.");
    if (!(objet(C.concentration) && num(C.concentration.min) && num(C.concentration.max) && C.concentration.min <= C.concentration.max))
      pb.push("cadre_securite.json : concentration {min, max} attendue.");
    if (!(objet(C.nombre_notes) && Number.isInteger(C.nombre_notes.min) && Number.isInteger(C.nombre_notes.max))) pb.push("cadre_securite.json : nombre_notes {min, max} attendu.");
    if (!(objet(C.notes) && Object.keys(C.notes).length)) pb.push("cadre_securite.json : la liste des notes couvertes est vide.");
    for (const [code, v] of Object.entries(C.notes || {}))
      if (!connue(code) || !(num(v?.pmax) && v.pmax > 0 && v.pmax <= 100)) pb.push(`cadre_securite.json, ${code} : code connu et pmax entre 0 et 100 attendus.`);
    if (C.allergenes_total_max_pct !== null && !(num(C.allergenes_total_max_pct) && C.allergenes_total_max_pct > 0))
      pb.push("cadre_securite.json : allergenes_total_max_pct doit être null ou un nombre positif.");
  } else if (Object.keys(C.notes || {}).length) pb.push("cadre_securite.json : des notes sont listées mais la version du rapport manque.");

  // ---------- config/features.json ----------
  const FE = d.features || {};
  for (const k of ["inspiration_nommee", "ia_active", "mode_demo"])
    if (typeof FE[k] !== "boolean") pb.push(`config/features.json : ${k} doit valoir true ou false.`);
  if (!(Array.isArray(FE.vagues_actives) && FE.vagues_actives.every(v => [1, 2, 3].includes(v)))) pb.push("config/features.json : vagues_actives doit lister 1, 2 et/ou 3.");

  // ---------- portes.json ----------
  const PO = d.portes;
  if (PO) {
    for (const p of ["P1", "P2", "P3", "P4", "P5"]) if (!(texte(PO.portes?.[p]?.titre) && texte(PO.portes?.[p]?.texte))) pb.push(`portes.json : titre et texte de la porte ${p} manquants.`);
    for (const f of FAMILLES) if (!texte(PO.familles?.[f])) pb.push(`portes.json : nom de la famille ${f} manquant.`);
    for (const f of FAMILLES) if (!(texte(PO.familles_textes?.[f]?.adjectif) && texte(PO.familles_textes?.[f]?.touche))) pb.push(`portes.json : familles_textes.${f} (adjectif et touche) manquant.`);
    const ids = new Set();
    for (const a of PO.ambiances || []) {
      if (!texte(a.id) || ids.has(a.id)) pb.push(`portes.json : ambiance « ${a.id} » sans identifiant unique.`);
      ids.add(a.id);
      if (!(texte(a.nom) && texte(a.texte))) pb.push(`portes.json, ambiance ${a.id} : nom et texte attendus.`);
      if (!(Array.isArray(a.structures) && a.structures.length && a.structures.every(x => STRUCT[x]))) pb.push(`portes.json, ambiance ${a.id} : structures inconnues.`);
    }
    if ((PO.ambiances || []).length !== 8) pb.push("portes.json : 8 ambiances attendues.");
    for (const [k, v] of Object.entries(PO.intensites || {}))
      if (!(num(v) && v >= c.min && v <= c.max)) pb.push(`portes.json : intensité ${k} hors de la plage de concentration.`);
    if ((PO.quiz || []).length !== 6) pb.push("portes.json : le quiz doit avoir 6 questions.");
    for (const q of PO.quiz || []) {
      if (!(texte(q.id) && texte(q.question) && Array.isArray(q.reponses) && q.reponses.length >= 2)) pb.push(`portes.json, question ${q.id} : question et au moins 2 réponses attendues.`);
      for (const r of q.reponses || []) {
        if (!(texte(r.id) && texte(r.texte))) pb.push(`portes.json, question ${q.id} : réponse sans texte.`);
        for (const [s2, v] of Object.entries(r.points || {})) if (!STRUCT[s2] || !num(v)) pb.push(`portes.json, question ${q.id}, réponse ${r.id} : points pour une structure inconnue (${s2}).`);
        if (r.intensite !== undefined && !num(PO.intensites?.[r.intensite])) pb.push(`portes.json, question ${q.id}, réponse ${r.id} : intensité inconnue.`);
      }
    }
  }

  // ---------- notes_publiees.json et correspondances.json ----------
  for (const [slug, p] of Object.entries(d.notes_publiees?.parfums || {})) {
    if (!ETAGES.every(e => Array.isArray(p[e]) && p[e].every(texte))) pb.push(`notes_publiees.json, ${slug} : listes tete, coeur et fond attendues.`);
    if (typeof p.a_verifier !== "boolean") pb.push(`notes_publiees.json, ${slug} : a_verifier doit valoir true ou false.`);
    if (d.parfums && !d.parfums.some(x => x.slug === slug)) pb.push(`notes_publiees.json : parfum « ${slug} » absent de data/parfums.json.`);
  }
  for (const [n, code] of Object.entries(d.correspondances?.notes || {}))
    if (!connue(code)) pb.push(`correspondances.json : « ${n} » renvoie vers un code inconnu (${code}).`);
  for (const [a, sf] of Object.entries(d.correspondances?.accords || {}))
    if (!SF[sf]) pb.push(`correspondances.json : l'accord « ${a} » renvoie vers une sous-famille inconnue (${sf}).`);

  // ---------- boutique.json ----------
  const B = d.boutique;
  if (B) {
    if (typeof B.publie !== "boolean") pb.push("boutique.json : publie doit valoir true ou false.");
    if (typeof B.vente_active !== "boolean") pb.push("boutique.json : vente_active doit valoir true ou false.");
    for (const p of ["kit", "flacon_50", "flacon_100"]) if (!(num(B.prix_eur?.[p]) && B.prix_eur[p] > 0)) pb.push(`boutique.json : prix « ${p} » manquant.`);
    if (!texte(B.delai)) pb.push("boutique.json : delai manquant.");
    if (B.worker !== null && !url(B.worker)) pb.push("boutique.json : worker doit être null ou une adresse https://.");
    if (!(Number.isInteger(B.quantite_max) && B.quantite_max >= 1)) pb.push("boutique.json : quantite_max doit être un nombre entier.");
    if (!(Array.isArray(B.pays_livraison) && B.pays_livraison.length && B.pays_livraison.every(x => /^[A-Z]{2}$/.test(x)))) pb.push("boutique.json : pays_livraison doit lister des codes de pays à 2 lettres (FR).");
    if (B.transporteur !== null && !texte(B.transporteur)) pb.push("boutique.json : transporteur doit être null ou un nom.");
    if (texte(B.transporteur) && /poste|colissimo/i.test(B.transporteur)) pb.push("boutique.json : La Poste et Colissimo refusent les parfums ; choisis un transporteur qui accepte les « quantités limitées ».");
    if (B.vente_active === true && !texte(B.transporteur)) pb.push("boutique.json : vente_active vaut true sans transporteur choisi.");
    if (B.vente_active === true && FE.mode_demo === true) pb.push("boutique.json : vente_active vaut true alors que le mode démonstration est actif (lots fictifs).");
    if (B.vente_active === true && !(C.version && Object.keys(C.notes || {}).length)) pb.push("boutique.json : vente_active vaut true sans cadre de sécurité signé.");
  }
  return pb;
}
