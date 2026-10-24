/*
 * Moteur de « Crée ton parfum » V2 (Olfamatch).
 *
 * Il répond à deux questions, séparément :
 *   - harmonie() : est-ce que ça sent juste ? (score sur 100, « Bon », « Risqué » ou « Déconseillé ») ;
 *   - securite() : est-ce autorisé ? (cadre signé, limites IFRA, allergènes). Une formule non autorisée
 *     ne peut jamais être commandée, quelle que soit son harmonie.
 *
 * Un seul module, exécuté dans le navigateur pour l'affichage et ré-exécuté dans le programme
 * Cloudflare pour décider : seul le résultat du programme Cloudflare fait foi.
 *
 * Toutes les valeurs (notes, matrice, facettes, exceptions, limites, seuils) viennent des fichiers
 * data/creer/*.json. Ce fichier ne contient que la logique.
 *
 * Une formule :
 *   { concentration: 18,                    // % de concentré dans le parfum fini
 *     notes: { BER: 25, CIT: 15, MUS: 20 } } // % de chaque note dans le concentré (total 100)
 */

export const MOTEUR_VERSION = "2.0";
export const ETAGES = ["tete", "coeur", "fond"];
const NOM_ETAGE = { tete: "tête", coeur: "cœur", fond: "fond" };
const EPS = 1e-9;

const somme = t => t.reduce((s, v) => s + v, 0);
const propre = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const paire = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const msg = (code, message, extra = {}) => ({ code, message, ...extra });
const nombre = v => String(Math.round(v * 1000) / 1000).replace(".", ",");
const maj = s => s.charAt(0).toUpperCase() + s.slice(1);
// « de rose », « d'ambre »
const de = mot => (/^[aeiouyhàâäéèêëîïôöûü]/i.test(mot) ? "d'" : "de ") + mot;
// Règle 8 : d'une fourchette déclarée par le fournisseur, on garde la borne haute.
export const borneHaute = v => (Array.isArray(v) ? Math.max(...v.map(Number)) : Number(v));
const LIBELLES = { bon: "Bon", risque: "Risqué", deconseille: "Déconseillé" };

/*
 * Répartit `total` entre plusieurs valeurs en gardant leurs proportions,
 * chacune restant entre son minimum et son maximum (multiplicateur trouvé par dichotomie).
 */
export function repartir(poids, bornes, total) {
  const w = poids.map(v => (v > 0 ? v : 1e-6));
  const valeurs = k => w.map((v, i) => Math.min(bornes[i].hi, Math.max(bornes[i].lo, k * v)));
  const s = k => somme(valeurs(k));
  let bas = 0, haut = 1;
  while (s(haut) < total - EPS && haut < 1e15) haut *= 2;
  for (let i = 0; i < 200; i++) {
    const m = (bas + haut) / 2;
    if (s(m) < total) bas = m; else haut = m;
  }
  return valeurs(haut);
}

/*
 * Arrondit au pas sans changer le total ni sortir des bornes : arrondi vers le bas,
 * puis les pas manquants vont aux valeurs qui avaient le plus gros reste.
 */
export function arrondir(valeurs, bornes, total, pas) {
  const cible = Math.round(total / pas);
  const lo = bornes.map(b => Math.ceil(b.lo / pas - 1e-7));
  const hi = bornes.map(b => Math.floor(b.hi / pas + 1e-7));
  const ideal = valeurs.map(v => v / pas);
  const u = ideal.map((v, i) => Math.min(hi[i], Math.max(lo[i], Math.floor(v + 1e-7))));
  let reste = cible - somme(u);
  const ordre = ideal.map((_, i) => i).sort((a, b) => ideal[b] - u[b] - (ideal[a] - u[a]) || a - b);
  while (reste > 0) {
    let bouge = false;
    for (const i of ordre) if (reste > 0 && u[i] < hi[i]) { u[i]++; reste--; bouge = true; }
    if (!bouge) break;
  }
  while (reste < 0) {
    let bouge = false;
    for (const i of [...ordre].reverse()) if (reste < 0 && u[i] > lo[i]) { u[i]--; reste++; bouge = true; }
    if (!bouge) break;
  }
  return u.map(v => Math.round(v * pas * 1e6) / 1e6);
}

/*
 * creerMoteur({ notes, facettes, matrice_sf, exceptions, structures, recettes, ifra_cat4,
 *               allergenes, matieres_lots, cadre_securite, regles, features, boutique })
 */
export function creerMoteur(d) {
  const R = d.regles;
  const H = R.harmonie;
  const FEAT = d.features || {};
  const IFRA = d.ifra_cat4 || { substances: {} };
  const SUBST = IFRA.substances || {};
  const ALLERG = new Map((d.allergenes?.allergenes || []).map(a => [a.id, a]));
  const SEUIL_ALLERG = d.allergenes?.seuil_sans_rincage_pct ?? 0.001;
  const STRUCT = d.structures.structures;
  const REC = d.recettes.recettes;
  const M = d.matrice_sf.matrice;
  const SF = d.matrice_sf.sous_familles;
  const PAS = R.pas_pourcentage || 0.5;
  const PAS_C = R.concentration.pas || 1;

  // Notes, rangées par code (BER, ROS…). L'identifiant en minuscules reste dans `id`.
  const N = new Map(Object.entries(d.notes.notes).map(([id, n]) => [n.code, { ...n, id }]));
  const connue = code => typeof code === "string" && N.has(code);
  const nom = code => (connue(code) ? N.get(code).nom.toLowerCase() : String(code));

  const EXC = new Map((d.exceptions.exceptions || []).map(e => [paire(e.a, e.b), e]));
  const GROUPES = d.exceptions.groupes || [];
  const AFF = new Map((d.facettes.affinites || []).map(([a, b, v]) => [paire(a, b), v]));

  // ---------------- cadre signé, lots, disponibilité ----------------

  // Le cadre compte seulement s'il est signé (version) et liste des notes.
  const CADRE = d.cadre_securite && d.cadre_securite.version && Object.keys(d.cadre_securite.notes || {}).length
    ? d.cadre_securite : null;
  const plageC = () => ({
    min: CADRE?.concentration?.min ?? R.concentration.min,
    max: CADRE?.concentration?.max ?? R.concentration.max,
  });
  const plageNb = () => ({
    min: CADRE?.nombre_notes?.min ?? R.nombre_notes.min,
    max: CADRE?.nombre_notes?.max ?? R.nombre_notes.max,
  });
  const pmax = code => (CADRE ? Number(CADRE.notes[code]?.pmax) : N.get(code).dose_max);

  const LOTS = new Map((d.matieres_lots?.lots || []).map(l => [l.lot, l]));
  const DOCS = ["fds", "ifra", "coa", "allergenes"];
  const atranolNecessaire = lot =>
    (R.securite?.substances_atranol || []).some(s => borneHaute(lot.substances_ifra_pct?.[s] ?? 0) > 0);

  // Un lot est utilisable s'il a ses 4 documents, un certificat IFRA à jour et une composition connue.
  function lotValide(lot) {
    if (!lot) return { ok: false, raison: "aucun lot" };
    if (lot.demo === true && FEAT.mode_demo !== true) return { ok: false, raison: "lot de démonstration (mode_demo coupé)" };
    if (!lot.docs || !DOCS.every(k => lot.docs[k] === true)) return { ok: false, raison: "il manque un des 4 documents du lot" };
    if (!(Number(lot.ifra_amendement) >= Number(IFRA.amendement))) return { ok: false, raison: `certificat IFRA antérieur au ${IFRA.amendement}e amendement` };
    if (!(Number(lot.ifra_cat4_max_pct_produit) > 0)) return { ok: false, raison: "maximum IFRA catégorie 4 manquant" };
    for (const s of Object.keys(lot.substances_ifra_pct || {}))
      if (!propre(SUBST, s)) return { ok: false, raison: `substance sans limite dans ifra_cat4.json : ${s}` };
    for (const a of Object.keys(lot.allergenes_pct || {}))
      if (!ALLERG.has(a)) return { ok: false, raison: `allergène inconnu de allergenes.json : ${a}` };
    if (atranolNecessaire(lot)) {
      const ppm = lot.atranol_chloroatranol_ppm;
      if (!(ppm !== null && ppm !== undefined && borneHaute(ppm) < (R.securite.atranol_max_ppm ?? 100)))
        return { ok: false, raison: "certificat atranol et chloroatranol manquant ou trop élevé" };
    }
    return { ok: true };
  }

  // Lot utilisé pour une note : son vrai lot actif, sinon (mode démonstration) son lot DEMO.
  const cacheLots = new Map();
  function lotDe(code) {
    if (cacheLots.has(code)) return cacheLots.get(code);
    const n = N.get(code);
    let res = null;
    if (n) {
      const vrai = n.lot_actif ? LOTS.get(n.lot_actif) : null;
      if (vrai && vrai.code_note === code && lotValide(vrai).ok) res = vrai;
      else if (FEAT.mode_demo === true)
        for (const l of LOTS.values()) if (l.demo === true && l.code_note === code && lotValide(l).ok) { res = l; break; }
    }
    cacheLots.set(code, res);
    return res;
  }

  // Une note est visible et utilisable si elle est active, dans une vague active, dans le cadre signé
  // (quand il existe) et si elle a un lot valable.
  function disponibilite(code) {
    if (!connue(code)) return { ok: false, raison: "note inconnue" };
    const n = N.get(code);
    if (n.actif === false) return { ok: false, raison: "note désactivée" };
    if (!(FEAT.vagues_actives || []).includes(n.vague)) return { ok: false, raison: `vague ${n.vague} pas encore ouverte` };
    if (CADRE && !(Number(CADRE.notes[code]?.pmax) > 0)) return { ok: false, raison: "note absente du cadre de sécurité signé" };
    const lot = lotDe(code);
    if (!lot) {
      const vrai = n.lot_actif ? LOTS.get(n.lot_actif) : null;
      const demo = FEAT.mode_demo === true ? [...LOTS.values()].find(l => l.demo === true && l.code_note === code) : null;
      const essai = vrai || demo;
      return { ok: false, raison: essai ? `lot ${essai.lot} : ${lotValide(essai).raison}` : "pas de lot fournisseur avec ses 4 documents" };
    }
    return { ok: true, lot };
  }

  function notesDisponibles() {
    return [...N.keys()].filter(c => disponibilite(c).ok).map(c => {
      const n = N.get(c);
      return { code: c, id: n.id, nom: n.nom, etage: n.etage, famille: n.famille, sous_famille: n.sous_famille, vague: n.vague };
    });
  }

  // ---------------- lecture d'une formule ----------------

  function lire(formule) {
    const erreurs = [];
    const brut = formule && typeof formule.notes === "object" && formule.notes ? formule.notes : {};
    const notes = [];
    for (const [code, v] of Object.entries(brut)) {
      const x = Number(v);
      if (!connue(code)) erreurs.push(msg("note_inconnue", `Note inconnue : ${String(code).slice(0, 20)}.`, { note: code }));
      else if (!(Number.isFinite(x) && x > 0)) erreurs.push(msg("dose", `La dose ${de(nom(code))} doit être un nombre positif.`, { note: code }));
      else notes.push({ code, pct: x });
    }
    const c = Number(formule?.concentration);
    if (!Number.isFinite(c)) erreurs.push(msg("concentration", "Il manque la concentration."));
    return { notes, c, erreurs };
  }

  // Part de tête, de cœur et de fond (une note à cheval compte pour moitié dans son 2e étage).
  function etages(formule) {
    const { notes } = lire(formule);
    const total = somme(notes.map(n => n.pct)) || 1;
    const part2 = H.pyramide.part_etage_secondaire ?? 0.5;
    const t = { tete: 0, coeur: 0, fond: 0 };
    for (const { code, pct } of notes) {
      const n = N.get(code), x = (pct / total) * 100;
      if (n.etage_secondaire) { t[n.etage] += x * (1 - part2); t[n.etage_secondaire] += x * part2; }
      else t[n.etage] += x;
    }
    for (const e of ETAGES) t[e] = Math.round(t[e] * 1e6) / 1e6;
    return t;
  }

  // Structure dont la pyramide est la plus proche. D = écart en points de %.
  function structureProche(formule, codes = Object.keys(STRUCT)) {
    const t = etages(formule);
    let best = null;
    for (const s of codes) {
      const p = STRUCT[s].pyramide;
      const D = (Math.abs(t.tete - p.tete) + Math.abs(t.coeur - p.coeur) + Math.abs(t.fond - p.fond)) / 2;
      if (!best || D < best.D - EPS) best = { structure: s, D };
    }
    return { ...best, etages: t };
  }

  // ---------------- harmonie ----------------

  function valeurPaire(a, b) {
    const e = EXC.get(paire(a, b));
    if (e) return { valeur: e.valeur, source: "exception", id: e.id, raison: e.raison };
    return { valeur: M[N.get(a).sous_famille][N.get(b).sous_famille], source: "matrice" };
  }

  function affiniteFacettes(a, b) {
    const fa = N.get(a).facettes || {}, fb = N.get(b).facettes || {};
    let s = 0;
    for (const [x, ix] of Object.entries(fa))
      for (const [y, iy] of Object.entries(fb)) {
        const v = AFF.get(paire(x, y));
        if (v) s += v * ix * iy;
      }
    return s;
  }

  /*
   * Score d'harmonie H sur 100 :
   *   H = base + poids_sf × S_sf + poids_fac × S_fac + poids_pyr × S_pyr − pénalités
   * S_sf : entente des sous-familles (matrice, ou exception pour la paire), pondérée par les doses.
   * S_fac : entente des facettes. S_pyr : écart à la pyramide de la structure la plus proche.
   */
  function harmonie(formule) {
    const { notes } = lire(formule);
    const total = somme(notes.map(n => n.pct)) || 1;
    const p = notes.map(n => n.pct / total);
    const paires = [];
    let sp = 0;
    for (let i = 0; i < notes.length; i++)
      for (let j = i + 1; j < notes.length; j++) sp += p[i] * p[j];
    let ssf = 0, sfac = 0, dure = null;
    const dureR = H.regle_dure || {};
    for (let i = 0; i < notes.length; i++)
      for (let j = i + 1; j < notes.length; j++) {
        const a = notes[i].code, b = notes[j].code;
        const w = sp > 0 ? (p[i] * p[j]) / sp : 0;
        const v = valeurPaire(a, b);
        const f = affiniteFacettes(a, b);
        ssf += w * v.valeur;
        sfac += w * f;
        paires.push({ a, b, poids: w, ...v, facettes: f });
        if (!dure && v.valeur <= dureR.valeur && p[i] * 100 >= dureR.part_min_pct - EPS && p[j] * 100 >= dureR.part_min_pct - EPS)
          dure = { a, b, valeur: v.valeur };
      }
    const S_sf = ssf / 2;
    const S_fac = Math.max(-1, Math.min(1, sfac));
    const proche = notes.length ? structureProche(formule) : { structure: null, D: 100, etages: { tete: 0, coeur: 0, fond: 0 } };
    const S_pyr = Math.max(-1, 1 - proche.D / H.pyramide.ecart_nul);

    const pen = [], P = H.penalites;
    for (const { code, pct } of notes) {
      const n = N.get(code), x = (pct / total) * 100;
      if (x > n.dose_max + EPS)
        pen.push(msg("au_dessus_dose_max", `${maj(nom(code))} dépasse ${n.dose_max} %.`, { note: code, points: P.au_dessus_dose_max }));
      if (n.puissance >= P.note_tres_puissante.puissance && x > P.note_tres_puissante.seuil_pct + EPS)
        pen.push(msg("note_tres_puissante", `${maj(nom(code))} est très puissante : au-delà de ${P.note_tres_puissante.seuil_pct} %, elle écrase les autres.`, { note: code, points: P.note_tres_puissante.points }));
    }
    if (notes.length > P.trop_de_notes.max) pen.push(msg("trop_de_notes", `Plus de ${P.trop_de_notes.max} notes : le parfum devient flou.`, { points: P.trop_de_notes.points }));
    if (notes.length < P.trop_peu_de_notes.min) pen.push(msg("trop_peu_de_notes", `Moins de ${P.trop_peu_de_notes.min} notes : le parfum manque de relief.`, { points: P.trop_peu_de_notes.points }));
    const codes = new Set(notes.map(n => n.code));
    for (const g of GROUPES)
      if (g.notes.every(c => codes.has(c)))
        pen.push(msg("groupe", `${maj(g.notes.map(nom).join(", "))} ensemble : ${g.raison}.`, { groupe: g.id, points: g.points }));

    const brut = H.base + H.poids.sous_familles * S_sf + H.poids.facettes * S_fac + H.poids.pyramide * S_pyr - somme(pen.map(x => x.points));
    const score = Math.max(0, Math.min(100, brut));
    let libelle = score >= H.seuils.bon - EPS ? "bon" : score >= H.seuils.risque - EPS ? "risque" : "deconseille";
    if (dure) libelle = "deconseille";
    paires.sort((x, y) => y.poids * y.valeur - x.poids * x.valeur);
    return {
      score: Math.round(score * 10) / 10, libelle, texte: LIBELLES[libelle],
      S_sf, S_fac, S_pyr, D: proche.D, structure_proche: proche.structure, etages: proche.etages,
      penalites: pen, regle_dure: dure,
      raison_dure: dure ? `${maj(nom(dure.a))} et ${nom(dure.b)} se heurtent, et les deux sont bien présentes.` : null,
      paires,
    };
  }

  // ---------------- sécurité (§ B5) ----------------

  /*
   * Contraintes chiffrées d'une formule, toutes de la forme Σ coef × dose ≤ limite
   * (doses en % du concentré, concentration fixée). Elles servent à vérifier, à calculer
   * la marge de sécurité et à bloquer les curseurs à la limite.
   */
  function contraintes(codes, c) {
    const liste = [];
    const lots = Object.fromEntries(codes.map(code => [code, lotDe(code)]));
    const fcf = new Set(R.securite?.notes_fcf || []);
    const substBerg = R.securite?.bergamote_substance;
    for (const code of codes) {
      const n = N.get(code), lot = lots[code];
      // Règle 1 : maximum par note (cadre signé, sinon dose_max).
      const max = pmax(code);
      if (Number.isFinite(max))
        liste.push({ regle: "cadre", note: code, coefs: { [code]: 1 }, limite: max,
          message: `${maj(nom(code))} : ${nombre(max)} % du concentré au maximum.` });
      // Règle 2 : maximum IFRA de l'huile, lu sur le certificat de son lot.
      if (lot)
        liste.push({ regle: "ifra_lot", note: code, coefs: { [code]: c / 100 }, limite: Number(lot.ifra_cat4_max_pct_produit),
          message: `Trop ${de(nom(code))} pour la limite de sécurité de cette huile : ${nombre((lot.ifra_cat4_max_pct_produit * 100) / c)} % du concentré au maximum à ${nombre(c)} %.` });
    }
    // Règles 3 et 5 : cumul de chaque substance limitée (et bergamote non FCF), en % du parfum fini.
    const parSubstance = {};
    for (const code of codes) {
      const lot = lots[code];
      if (!lot) continue;
      const comp = { ...(lot.substances_ifra_pct || {}) };
      if (fcf.has(code) && lot.fcf !== true && substBerg) comp[substBerg] = 100;
      for (const [s, w] of Object.entries(comp)) {
        const x = borneHaute(w);
        if (!(x > 0)) continue;
        (parSubstance[s] ||= {})[code] = (c / 100) * (x / 100);
      }
    }
    for (const [s, coefs] of Object.entries(parSubstance)) {
      const info = SUBST[s];
      const qui = Object.keys(coefs).map(nom);
      const nomS = info ? info.nom.toLowerCase() : s;
      liste.push({ regle: s === substBerg ? "bergamote" : "substance", substance: s, coefs, limite: info ? Number(info.limite_pct) : 0,
        message: s === substBerg
          ? `Ce lot de bergamote n'est pas sans furocoumarines (FCF) : ${nombre(info.limite_pct)} % du parfum au maximum.`
          : `Trop de ${nomS} au total (apporté par ${qui.join(", ")}) : la limite de sécurité est dépassée.` });
    }
    // Plafonds légaux de l'annexe III (allergenes.json, max_pct_produit) : ils s'ajoutent aux limites
    // IFRA, et la plus sévère des deux gagne toujours.
    const parAllergene = {};
    for (const code of codes) {
      const lot = lots[code];
      if (!lot) continue;
      for (const [a, w] of Object.entries(lot.allergenes_pct || {})) {
        const info = ALLERG.get(a), x = borneHaute(w);
        if (info && info.max_pct_produit !== undefined && info.max_pct_produit !== null && x > 0)
          (parAllergene[a] ||= {})[code] = (c / 100) * (x / 100);
      }
    }
    for (const [a, coefs] of Object.entries(parAllergene))
      liste.push({ regle: "annexe3", substance: a, coefs, limite: Number(ALLERG.get(a).max_pct_produit),
        message: `Trop de ${ALLERG.get(a).inci.toLowerCase()} au total (apporté par ${Object.keys(coefs).map(nom).join(", ")}) : le plafond fixé par la loi est dépassé.` });
    // Règle 7 : cumul des allergènes, plafond du cadre signé.
    if (CADRE && Number.isFinite(Number(CADRE.allergenes_total_max_pct)) && CADRE.allergenes_total_max_pct !== null) {
      const coefs = {};
      for (const code of codes) {
        const lot = lots[code];
        if (!lot) continue;
        const t = somme(Object.values(lot.allergenes_pct || {}).map(borneHaute));
        if (t > 0) coefs[code] = (c / 100) * (t / 100);
      }
      liste.push({ regle: "allergenes_total", coefs, limite: Number(CADRE.allergenes_total_max_pct),
        message: "Trop d'allergènes au total : baisse ou retire une note." });
    }
    return liste;
  }

  const valeur = (k, doses) => somme(Object.entries(k.coefs).map(([code, coef]) => coef * (doses[code] || 0)));
  const depasse = (v, limite) => v > limite * (1 + 1e-12) + 1e-12;

  // Allergènes du parfum fini (règle 6) : à étiqueter au-delà du seuil (0,001 % sans rinçage).
  function allergenes(formule) {
    const { notes, c } = lire(formule);
    const total = new Map();
    for (const { code, pct } of notes) {
      const lot = lotDe(code);
      if (!lot) continue;
      for (const [a, w] of Object.entries(lot.allergenes_pct || {}))
        total.set(a, (total.get(a) || 0) + (pct / 100) * (c / 100) * borneHaute(w));
    }
    const liste = [...total].map(([id, pct]) => ({ id, inci: ALLERG.get(id)?.inci || id.toUpperCase(), pct_produit: pct }))
      .sort((a, b) => b.pct_produit - a.pct_produit || a.inci.localeCompare(b.inci));
    return {
      seuil_pct: SEUIL_ALLERG,
      liste,
      a_etiqueter: liste.filter(a => a.pct_produit > SEUIL_ALLERG + 1e-15),
      total_pct: somme(liste.map(a => a.pct_produit)),
    };
  }

  /*
   * Vérifie toutes les règles de sécurité. Renvoie
   * { ok, erreurs, marges, marge_min, allergenes, lots, versions }.
   * Une seule erreur suffit à refuser la formule.
   */
  function securite(formule) {
    const { notes, c, erreurs } = lire(formule);
    const codes = notes.map(n => n.code);
    if (new Set(codes).size !== codes.length) erreurs.push(msg("doublon", "Une note apparaît deux fois."));
    const doses = Object.fromEntries(notes.map(n => [n.code, n.pct]));

    // Forme de la formule : total de 100 %, doses et concentration au bon pas.
    const total = somme(notes.map(n => n.pct));
    if (notes.length && Math.abs(total - 100) > 1e-6) erreurs.push(msg("total", `Le total des notes doit faire 100 % (ici ${nombre(total)} %).`));
    for (const { code, pct } of notes)
      if (Math.abs(pct / PAS - Math.round(pct / PAS)) > 1e-6)
        erreurs.push(msg("pas", `La dose ${de(nom(code))} doit être un multiple de ${nombre(PAS)} %.`, { note: code }));

    // Règle 1 : cadre (concentration, nombre de notes, notes couvertes).
    const pc = plageC(), pn = plageNb();
    if (Number.isFinite(c)) {
      if (c < pc.min - EPS || c > pc.max + EPS) erreurs.push(msg("concentration", `La concentration doit rester entre ${pc.min} et ${pc.max} %.`));
      else if (Math.abs(c / PAS_C - Math.round(c / PAS_C)) > 1e-6) erreurs.push(msg("concentration", `La concentration va de ${nombre(PAS_C)} en ${nombre(PAS_C)} %.`));
    }
    if (notes.length < pn.min || notes.length > pn.max)
      erreurs.push(msg("nombre_notes", `Choisis entre ${pn.min} et ${pn.max} notes (ici ${notes.length}).`));
    for (const code of codes) {
      const dsp = disponibilite(code);
      if (!dsp.ok) erreurs.push(msg("note_indisponible", `Cette note n'est pas disponible pour le moment : ${nom(code)}.`, { note: code, raison: dsp.raison }));
    }

    // Règles chiffrées (2, 3, 5, 7 et maximum par note), seulement pour les notes disponibles.
    const dispo = codes.filter(code => disponibilite(code).ok);
    const marges = [];
    if (Number.isFinite(c)) {
      for (const k of contraintes(dispo, c)) {
        const v = valeur(k, doses);
        marges.push({ regle: k.regle, note: k.note || null, substance: k.substance || null, valeur: v, limite: k.limite,
          marge: k.limite > 0 ? 1 - v / k.limite : v > 0 ? -1 : 1 });
        if (depasse(v, k.limite)) erreurs.push(msg(k.regle, k.message, { note: k.note, substance: k.substance, valeur: v, limite: k.limite }));
      }
    }
    const lots = Object.fromEntries(dispo.map(code => [code, lotDe(code).lot]));
    const demo = dispo.some(code => lotDe(code).demo === true);
    return {
      ok: erreurs.length === 0,
      erreurs,
      marges,
      marge_min: marges.length ? Math.min(...marges.map(m => m.marge)) : 1,
      allergenes: allergenes(formule),
      lots,
      demo,
      versions: { moteur_version: MOTEUR_VERSION, ifra_amendement: IFRA.amendement, cadre_version: CADRE ? CADRE.version : null },
    };
  }

  /*
   * Ce que le client peut faire de cette formule, selon la porte d'entrée (P1 à P5).
   * La sécurité passe toujours en premier ; l'harmonie « Déconseillé » bloque les portes P1 à P4,
   * et demande une case « je comprends » en mode expert (P5).
   */
  function evaluer(formule, { porte = "P5", confirme = false } = {}) {
    const s = securite(formule);
    const h = harmonie(formule);
    let commande;
    if (!s.ok) commande = "non";
    else {
      const regle = H.commande[h.libelle];
      const r = typeof regle === "string" ? regle : regle?.[porte] ?? "non";
      commande = r === "avec_confirmation" ? (confirme ? "oui" : "avec_confirmation") : r;
    }
    const avertissements = [];
    if (s.ok && h.libelle === "risque") avertissements.push(msg("risque", "Harmonie risquée : on te conseille de commander d'abord le kit d'échantillons."));
    if (s.ok && h.libelle === "deconseille") avertissements.push(msg("deconseille", h.raison_dure || "Ces notes s'accordent mal : le résultat risque de te décevoir."));
    return { ok: commande === "oui", commande, conforme: s.ok, securite: s, harmonie: h, avertissements };
  }

  // ---------------- aides au réglage ----------------

  // Ramène des doses quelconques à un total de 100 %, au pas de 0,5 %. Les notes à 0 disparaissent.
  function normaliser(notes) {
    const codes = Object.keys(notes || {}).filter(c => Number(notes[c]) > 0);
    if (!codes.length) return {};
    const v = codes.map(c => Number(notes[c]));
    const t = somme(v);
    const bornes = codes.map(() => ({ lo: PAS, hi: 100 }));
    const r = arrondir(v.map(x => (x / t) * 100), bornes, 100, PAS);
    return Object.fromEntries(codes.map((c, i) => [c, r[i]]));
  }

  /*
   * Plage permise pour une note quand on bouge son curseur et que les autres
   * s'ajustent en gardant leurs proportions (total toujours 100).
   * Renvoie { min, max } en % du concentré, ou null si la formule ne peut pas être évaluée.
   */
  function limitesNote(formule, code) {
    const { notes, c } = lire(formule);
    if (!Number.isFinite(c) || !notes.some(n => n.code === code)) return null;
    const p0 = notes.find(n => n.code === code).pct;
    const autres = notes.filter(n => n.code !== code);
    const reste0 = somme(autres.map(n => n.pct));
    let lo = 0, hi = 100;
    const dispo = notes.map(n => n.code).filter(x => disponibilite(x).ok);
    for (const k of contraintes(dispo, c)) {
      // valeur(p) = a·p + b·(100 − p) / reste0, avec a = coef de la note et b = Σ coef × dose des autres
      const a = k.coefs[code] || 0;
      const b = reste0 > 0 ? somme(autres.map(n => (k.coefs[n.code] || 0) * n.pct)) / reste0 : 0;
      const pente = a - b, base = 100 * b;
      if (Math.abs(pente) < 1e-15) { if (depasse(base, k.limite)) return { min: p0, max: p0, bloque: true }; continue; }
      const x = (k.limite - base) / pente;
      if (pente > 0) hi = Math.min(hi, x); else lo = Math.max(lo, x);
    }
    return { min: Math.max(PAS, Math.ceil(lo / PAS - 1e-9) * PAS), max: Math.min(100, Math.floor(hi / PAS + 1e-9) * PAS), pas: PAS };
  }

  /*
   * Variante conforme la plus proche d'une formule : notes indisponibles retirées, concentration
   * ramenée dans sa plage, chaque dose ramenée sous ses limites, le reste redistribué en gardant les
   * proportions, puis arrondi au pas. Renvoie { ok, formule, changements } ; ok = false si impossible.
   */
  function corriger(formule) {
    const lu = lire(formule);
    const changements = [];
    const pc = plageC();
    let c = Number.isFinite(lu.c) ? lu.c : R.concentration.defaut;
    const c2 = Math.min(pc.max, Math.max(pc.min, Math.round(c / PAS_C) * PAS_C));
    if (c2 !== lu.c) changements.push(msg("concentration", `Concentration ramenée à ${nombre(c2)} %.`));
    c = c2;
    const garde = lu.notes.filter(n => disponibilite(n.code).ok);
    for (const n of lu.notes) if (!garde.includes(n)) changements.push(msg("note_retiree", `${maj(nom(n.code))} retirée (pas disponible).`, { note: n.code }));
    const pn = plageNb();
    if (garde.length < pn.min || garde.length > pn.max) return { ok: false, formule: null, changements };
    const codes = garde.map(n => n.code);
    const poids = garde.map(n => n.pct);
    const ks = contraintes(codes, c);
    // Maximum de chaque note seule (contraintes à une seule note).
    const hi = codes.map(code => Math.min(100, ...ks.filter(k => Object.keys(k.coefs).length === 1 && k.coefs[code])
      .map(k => k.limite / k.coefs[code])));
    const bornes = () => codes.map((_, i) => ({ lo: PAS, hi: Math.max(PAS, hi[i]) }));
    for (let essai = 0; essai < 60; essai++) {
      if (somme(hi) < 100 - EPS) return { ok: false, formule: null, changements };
      const b = bornes();
      const v = arrondir(repartir(poids, b, 100), b, 100, PAS);
      const doses = Object.fromEntries(codes.map((code, i) => [code, v[i]]));
      let pire = null;
      for (const k of ks) {
        const val = valeur(k, doses);
        if (depasse(val, k.limite) && (!pire || val / k.limite > pire.r)) pire = { k, r: val / k.limite };
      }
      if (!pire) {
        const f = { ...formule, concentration: c, notes: doses };
        if (!securite(f).ok) return { ok: false, formule: null, changements };
        for (const code of codes) {
          const avant = (lu.notes.find(n => n.code === code).pct / (somme(poids) || 1)) * 100;
          if (Math.abs(avant - doses[code]) > PAS + EPS)
            changements.push(msg("dose", `${maj(nom(code))} : ${nombre(Math.round(avant * 2) / 2)} % → ${nombre(doses[code])} %.`, { note: code }));
        }
        return { ok: true, formule: f, changements };
      }
      // Contrainte à plusieurs notes dépassée : on resserre le maximum des notes qui y contribuent.
      codes.forEach((code, i) => {
        if (pire.k.coefs[code]) hi[i] = Math.max(PAS, Math.min(hi[i], v[i] / pire.r) - PAS * 0.01);
      });
    }
    return { ok: false, formule: null, changements };
  }

  /*
   * Curseurs (de −1 à +1) : fraicheur (−1 plus de tête, +1 plus de fond), douceur (selon la
   * famille de chaque note), intensite (concentration dans sa plage). Le résultat est ramené à 100 %.
   */
  function transformer(formule, { fraicheur = 0, douceur = 0, intensite = 0 } = {}) {
    const borne = (v, a, b) => Math.min(b, Math.max(a, v));
    const fr = borne(Number(fraicheur) || 0, -1, 1), dz = borne(Number(douceur) || 0, -1, 1), it = borne(Number(intensite) || 0, -1, 1);
    const cF = R.curseurs.fraicheur, cD = R.curseurs.douceur;
    const notes = {};
    for (const [code, v] of Object.entries(formule.notes || {})) {
      const n = N.get(code);
      notes[code] = n ? v * Math.max(0.05, 1 + fr * (cF[n.etage] || 0)) * Math.max(0.05, 1 + dz * (cD[n.famille] || 0)) : v;
    }
    const pc = plageC();
    const c0 = Number(formule.concentration ?? R.concentration.defaut);
    const c = borne(c0 + it * (it > 0 ? pc.max - c0 : c0 - pc.min), pc.min, pc.max);
    return { ...formule, notes: normaliser(notes), concentration: Math.round(c / PAS_C) * PAS_C };
  }

  /*
   * Kit d'échantillons : 3 variantes de la formule (plus fraîche, standard, plus intense).
   * Règle 10 : chaque variante passe toutes les règles de sécurité. Une variante qui ne peut pas
   * être rendue conforme est remplacée par la formule standard.
   */
  function variantesKit(formule) {
    return (R.kit?.variantes || []).map(v => {
      const corr = corriger(transformer(formule, v));
      const ok = corr.ok && securite(corr.formule).ok;
      return { nom: v.nom, formule: ok ? corr.formule : { ...formule, notes: { ...formule.notes } }, ok };
    });
  }

  // Ce qui empêche encore de vendre (vide = la vente peut être ouverte).
  function etatVente() {
    const raisons = [];
    if (d.boutique?.vente_active !== true) raisons.push("La vente n'est pas ouverte (boutique.json : vente_active vaut false).");
    if (FEAT.mode_demo === true) raisons.push("Mode démonstration actif : les lots sont fictifs (config/features.json : mode_demo).");
    if (!CADRE) raisons.push("Pas encore de cadre de sécurité signé (cadre_securite.json est vide).");
    if (!d.boutique?.transporteur) raisons.push("Pas encore de transporteur pour les parfums (boutique.json : transporteur).");
    return { ok: raisons.length === 0, raisons };
  }

  // Familles maison les plus présentes (dose × puissance), sans les notes neutres comme le musc blanc.
  function familles(formule) {
    const t = {};
    for (const [c, p] of Object.entries(formule?.notes || {})) {
      const n = N.get(c);
      if (n && n.famille !== "neutre" && Number(p) > 0) t[n.famille] = (t[n.famille] || 0) + Number(p) * n.puissance;
    }
    const total = somme(Object.values(t)) || 1;
    return Object.entries(t).map(([famille, v]) => ({ famille, part: v / total })).sort((a, b) => b.part - a.part || (a.famille < b.famille ? -1 : 1));
  }

  // Une recette, prête à évaluer.
  function recette(code, concentration = R.concentration.defaut) {
    if (!propre(REC, code)) return null;
    return { concentration, notes: { ...REC[code].notes }, recette: code, structure: REC[code].structure };
  }

  return {
    harmonie, securite, evaluer, allergenes, contraintes, etages, structureProche, familles,
    normaliser, limitesNote, corriger, transformer, variantesKit,
    disponibilite, notesDisponibles, lotDe, lotValide, etatVente, recette,
    note: code => (connue(code) ? N.get(code) : null),
    valeurPaire, affiniteFacettes,
    plages: () => ({ concentration: plageC(), nombre_notes: plageNb(), pas: PAS, pas_concentration: PAS_C }),
    cadre: () => CADRE,
  };
}
