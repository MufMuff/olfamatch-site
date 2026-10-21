/*
 * Moteur de règles de l'outil « Crée ton parfum » (Olfamatch).
 *
 * Il vérifie une formule, la corrige quand c'est possible, et la refuse avec
 * un message simple quand ce n'est pas possible.
 *
 * Toutes les connaissances (notes, accords, recettes, seuils) viennent des
 * fichiers data/creer/*.json. Ce fichier ne contient que la logique : on change
 * les chiffres dans les fichiers de données, pas ici.
 *
 * Il tourne tel quel dans le navigateur (module JavaScript) et dans Node (tests).
 *
 * Une formule :
 *   {
 *     mode: "guide" ou "expert",
 *     recette: "R01",           // mode guidé seulement
 *     famille: "floral",        // facultatif en mode expert (sinon déduite des notes)
 *     concentration: 18,        // % d'huiles dans le parfum fini
 *     notes: { bergamote: 22, rose: 25, ... }   // doses en % du mélange d'huiles
 *   }
 */

export const ETAGES = ["tete", "coeur", "fond"];
const NOM_ETAGE = { tete: "tête", coeur: "cœur", fond: "fond" };
const EPS = 1e-9;

const cle = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const somme = t => t.reduce((s, v) => s + v, 0);
const maj = s => s.charAt(0).toUpperCase() + s.slice(1);
const nombre = v => String(Math.round(v * 100) / 100).replace(".", ",");
// « de rose », « d'ambre »
const de = mot => (/^[aeiouyhàâäéèêëîïôöûü]/i.test(mot) ? "d'" : "de ") + mot;
const liste = (mots, et = "et") =>
  mots.length < 2 ? mots.join("") : `${mots.slice(0, -1).join(", ")} ${et} ${mots[mots.length - 1]}`;
const msg = (code, message, extra = {}) => ({ code, message, ...extra });

const RAISON_HAUT = {
  dose_max: "maximum pour cette note",
  ifra: "limite de sécurité à cette concentration",
  association: "association délicate",
  recette: "écart permis par la recette",
  ajout: "note ajoutée en mode guidé",
};
const RAISON_BAS = {
  dose_min: "minimum pour cette note",
  recette: "écart permis par la recette",
};

/*
 * Répartit `total` entre plusieurs notes en gardant leurs proportions,
 * chaque valeur restant entre son minimum et son maximum.
 * On cherche le multiplicateur k tel que la somme des k × poids (bornés) fasse `total`.
 */
export function repartir(poids, bornes, total) {
  const w = poids.map(v => (v > 0 ? v : 1e-6)); // une note à 0 reçoit son minimum
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
 * Arrondit les valeurs au pas (1 % par défaut) sans changer le total
 * ni sortir des bornes : on arrondit vers le bas, puis on rend les unités
 * manquantes aux valeurs qui avaient le plus gros reste.
 */
export function arrondir(valeurs, bornes, total, pas = 1) {
  const cible = Math.round(total / pas);
  const lo = bornes.map(b => Math.round(b.lo / pas));
  const hi = bornes.map(b => Math.round(b.hi / pas));
  const ideal = valeurs.map(v => v / pas);
  const u = ideal.map((v, i) => Math.min(hi[i], Math.max(lo[i], Math.floor(v + 1e-7))));
  let reste = cible - somme(u);
  const parReste = ideal.map((_, i) => i).sort((a, b) => ideal[b] - u[b] - (ideal[a] - u[a]));
  while (reste > 0) {
    let bouge = false;
    for (const i of parReste) if (reste > 0 && u[i] < hi[i]) { u[i]++; reste--; bouge = true; }
    if (!bouge) break;
  }
  while (reste < 0) {
    let bouge = false;
    for (const i of [...parReste].reverse()) if (reste < 0 && u[i] > lo[i]) { u[i]--; reste++; bouge = true; }
    if (!bouge) break;
  }
  return u.map(v => Math.round(v * pas * 1e6) / 1e6);
}

/*
 * Crée le moteur à partir des quatre fichiers de données (déjà lus en JSON) :
 *   creerMoteur({ notes, compatibilite, recettes, regles })
 */
export function creerMoteur({ notes, compatibilite, recettes, regles }) {
  const R = regles;
  const N = notes.notes;
  const RECETTES = recettes.recettes;
  const DEFAUT = compatibilite.score_par_defaut ?? 2;
  const PAS = R.pas_pourcentage || 1;

  // Matrice de compatibilité : paires (score) et groupes de 3 notes ou plus.
  const paires = new Map();
  const groupes = [];
  for (const [nomListe, score] of [["accords", 3], ["risquees", 1], ["interdites", 0]])
    for (const g of compatibilite[nomListe] || [])
      if (g.length === 2) paires.set(cle(g[0], g[1]), score);
      else groupes.push({ notes: g, score });

  // « constructor » ou « __proto__ » ne sont pas des notes : on ne lit que les clés des fichiers.
  const propre = (obj, id) => Object.prototype.hasOwnProperty.call(obj, id);
  const connue = id => propre(N, id);
  const nom = id => (connue(id) ? N[id].nom.toLowerCase() : String(id));

  function scorePaire(a, b) {
    const s = paires.get(cle(a, b));
    return s === undefined ? DEFAUT : s;
  }

  // Associations notables (accords, délicates, interdites) présentes parmi ces notes.
  function associations(ids) {
    const res = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const s = scorePaire(ids[i], ids[j]);
        if (s !== DEFAUT) res.push({ notes: [ids[i], ids[j]], score: s });
      }
    for (const g of groupes) if (g.notes.every(id => ids.includes(id))) res.push({ notes: [...g.notes], score: g.score });
    return res;
  }

  // Jauge d'harmonie : score moyen de toutes les paires (de 0 à 3). null sous 2 notes.
  function harmonie(ids) {
    if (ids.length < 2) return null;
    let t = 0, n = 0;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) { t += scorePaire(ids[i], ids[j]); n++; }
    return t / n;
  }

  /*
   * Familles présentes dans la formule, de la plus marquée à la moins marquée
   * (dose × puissance). Les notes « neutres » comme le musc blanc ne comptent pas.
   */
  function classementFamilles(notesObj) {
    const familles = Object.keys(R.equilibre);
    const score = Object.fromEntries(familles.map(f => [f, 0]));
    const vide = somme(Object.values(notesObj).map(v => (v > 0 ? v : 0))) === 0;
    for (const [id, v] of Object.entries(notesObj)) {
      const n = connue(id) ? N[id] : null;
      if (n && propre(score, n.famille)) score[n.famille] += (vide ? 1 : Math.max(0, v)) * n.puissance;
    }
    const presentes = familles.filter(f => score[f] > 0);
    // tri stable : à égalité, l'ordre de regles.json décide
    return presentes.length ? presentes.sort((a, b) => score[b] - score[a]) : [familles[0]];
  }

  const familleDominante = notesObj => classementFamilles(notesObj)[0];

  // Dose maximum permise par le certificat IFRA, en % du mélange d'huiles.
  function limiteIfra(id, concentration) {
    return (N[id].ifra_max * 100) / concentration;
  }

  function lireNotes(obj) {
    if (Array.isArray(obj)) return Object.fromEntries(obj.map(id => [id, 0]));
    const res = {};
    for (const [id, v] of Object.entries(obj || {})) {
      const x = Number(v);
      res[id] = Number.isFinite(x) && x > 0 ? x : 0;
    }
    return res;
  }

  function contexte(f, corriger) {
    const mode = f.mode === "guide" || f.mode === "expert" ? f.mode : f.recette ? "guide" : "expert";
    const recette = mode === "guide" && propre(RECETTES, f.recette) ? RECETTES[f.recette] : null;
    const { min, max, defaut } = R.concentration;
    let c = Number(f.concentration ?? (recette && recette.concentration) ?? defaut);
    if (!Number.isFinite(c)) c = defaut;
    const corrections = [], erreurs = [];
    if (c < min || c > max) {
      const c2 = Math.min(max, Math.max(min, c));
      if (corriger) {
        corrections.push(msg("concentration", `Concentration ramenée à ${nombre(c2)} % (entre ${min} et ${max} %).`, { avant: c, apres: c2 }));
        c = c2;
      } else erreurs.push(msg("concentration", `La concentration doit rester entre ${min} et ${max} %.`));
    }
    let famille = recette ? recette.famille : f.famille;
    if (!propre(R.equilibre, famille)) famille = null;
    return { mode, recette, idRecette: mode === "guide" ? f.recette ?? null : null, concentration: c, famille, corrections, erreurs };
  }

  /* Règles qui ne dépendent que du choix des notes et qui empêchent d'en ajouter une. */
  function controlesAjout(ids, ctx) {
    const err = [];
    for (const id of ids) {
      const n = connue(id) ? N[id] : null;
      if (!n || n.actif === false) err.push(msg("note_indisponible", `Cette note n'est pas disponible : ${nom(id)}.`, { note: id }));
      else if (R.ifra.exiger_certificat && !n.ifra_certificat)
        err.push(msg("note_indisponible", `${maj(nom(id))} n'est pas encore disponible.`, { note: id }));
    }
    if (err.length) return err;

    if (ctx.mode === "guide" && ctx.recette) {
      const ajouts = ids.filter(id => !(id in ctx.recette.notes));
      const max = R.guide.ajouts_max;
      if (ajouts.length > max)
        err.push(msg("trop_d_ajouts", max === 0 ? "En mode guidé, on garde les notes de la recette."
          : max === 1 ? "En mode guidé, tu peux ajouter une seule note." : `En mode guidé, tu peux ajouter ${max} notes au plus.`));
    }
    const { max } = R.nombre_notes;
    if (ids.length > max) err.push(msg("trop_de_notes", `${max} notes au maximum : retires-en une.`));

    for (const g of R.associations_interdites || [])
      if (g.every(id => ids.includes(id)))
        err.push(msg("association_interdite", `${maj(liste(g.map(nom)))} ensemble, c'est trop chargé : retire l'une de ces notes.`, { notes: g }));

    const p = R.puissance;
    const fortes = ids.filter(id => N[id].puissance >= p.fortes_a_partir_de);
    if (fortes.length > p.fortes_max)
      err.push(msg("trop_de_notes_puissantes", `Trop de notes très puissantes (${liste(fortes.map(nom))}) : garde-en ${p.fortes_max} au plus.`, { notes: fortes }));

    const assoc = associations(ids);
    for (const a of assoc.filter(a => a.score === 0))
      err.push(msg("association_interdite", `${maj(liste(a.notes.map(nom)))} ne vont pas ensemble.`, { notes: a.notes }));
    const risquees = assoc.filter(a => a.score === 1);
    const maxR = R.matrice.risquees_max[ctx.mode] ?? 0;
    if (risquees.length > maxR) {
      if (maxR === 0)
        for (const a of risquees)
          err.push(msg("association_delicate", `${maj(liste(a.notes.map(nom)))} s'accordent mal : choisis une autre note.`, { notes: a.notes }));
      else
        err.push(msg("trop_d_associations_delicates",
          `Trop d'associations délicates (${risquees.map(a => liste(a.notes.map(nom))).join(" ; ")}) : ${maxR === 1 ? "une seule est possible" : `${maxR} au plus`}.`));
    }
    return err;
  }

  /* Règles qu'une formule doit remplir une fois terminée. */
  function controlesMinimum(ids, ctx) {
    const err = [];
    if (ctx.mode === "guide") {
      if (!ctx.recette) return [msg("recette_inconnue", "Cette recette n'existe pas : choisis-en une autre.")];
      const manquent = Object.keys(ctx.recette.notes).filter(id => !ids.includes(id));
      if (manquent.length)
        err.push(msg("recette_incomplete", `En mode guidé, toutes les notes de la recette restent : il manque ${liste(manquent.map(nom))}.`));
    }
    const { min } = R.nombre_notes;
    if (ids.length < min) err.push(msg("trop_peu_de_notes", `Choisis au moins ${min} notes.`));
    for (const e of ETAGES) {
      const k = ids.filter(id => N[id].etage === e).length;
      const m = R.minimum_par_etage[e] || 0;
      if (k < m)
        err.push(msg("etage_incomplet", m === 1 ? `Ajoute au moins une note de ${NOM_ETAGE[e]}.` : `Ajoute au moins ${m} notes de ${NOM_ETAGE[e]}.`, { etage: e }));
    }
    const tenue = R.notes_de_tenue || [];
    if (tenue.length && !tenue.some(id => ids.includes(id)))
      err.push(msg("tenue", `Ajoute ${liste(tenue.map(nom), "ou")} pour que le parfum tienne sur la peau.`));

    const h = harmonie(ids);
    if (h !== null && h < R.matrice.moyenne_min - EPS) {
      // la note qui s'entend le moins bien avec les autres
      const moy = id => somme(ids.filter(x => x !== id).map(x => scorePaire(id, x))) / (ids.length - 1);
      const pire = ids.reduce((m, id) => (moy(id) < moy(m) - EPS || (Math.abs(moy(id) - moy(m)) < EPS && N[id].puissance > N[m].puissance) ? id : m));
      err.push(msg("harmonie", `Ces notes s'accordent mal ensemble. Essaie sans ${nom(pire)}.`, { note: pire, harmonie: h }));
    }
    return err;
  }

  function controleStructure(ids, ctx) {
    const err = controlesAjout(ids, ctx);
    if (err.some(e => e.code === "note_indisponible")) return err;
    return err.concat(controlesMinimum(ids, ctx));
  }

  // La note la plus puissante d'un groupe (à égalité : la première citée).
  const noteForte = ids => ids.reduce((m, id) => (N[id].puissance > N[m].puissance ? id : m));

  function avertissements(ids) {
    const f = R.matrice.reduction_note_forte;
    const effet = f === 0.5 ? "réduite de moitié" : `limitée à ${Math.round(f * 100)} % de son maximum`;
    return associations(ids).filter(a => a.score === 1).map(a => {
      const forte = noteForte(a.notes);
      return msg("association_delicate", `${maj(liste(a.notes.map(nom)))} : association délicate. La dose ${de(nom(forte))} est ${effet}.`, { notes: a.notes, note: forte });
    });
  }

  /*
   * Dose minimum et maximum de chaque note, dans cet ordre :
   * plafonds de la note, IFRA, association délicate, puis marges de la recette (mode guidé).
   */
  function bornes(ids, ctx) {
    const b = {};
    for (const id of ids) {
      const n = N[id];
      b[id] = { lo: n.dose_min, hi: n.dose_max, rLo: "dose_min", rHi: "dose_max" };
      const ifra = limiteIfra(id, ctx.concentration);
      if (ifra < b[id].hi) { b[id].hi = ifra; b[id].rHi = "ifra"; }
    }
    for (const a of associations(ids).filter(a => a.score === 1)) {
      const forte = noteForte(a.notes);
      const cap = N[forte].dose_max * R.matrice.reduction_note_forte;
      if (cap < b[forte].hi) { b[forte].hi = cap; b[forte].rHi = "association"; }
    }
    if (ctx.mode === "guide" && ctx.recette) {
      const marge = ctx.recette.marge ?? R.guide.marge_defaut;
      for (const id of ids) {
        const r = ctx.recette.notes[id];
        if (r !== undefined) {
          if (r - marge > b[id].lo) { b[id].lo = r - marge; b[id].rLo = "recette"; }
          if (r + marge < b[id].hi) { b[id].hi = r + marge; b[id].rHi = "recette"; }
          // la sécurité passe avant la recette : le minimum de la recette s'efface sous la limite IFRA
          if (b[id].lo > b[id].hi && b[id].rLo === "recette") { b[id].lo = Math.max(N[id].dose_min, b[id].hi); b[id].rLo = "dose_min"; }
        } else if (R.guide.ajout_dose_max < b[id].hi) { b[id].hi = R.guide.ajout_dose_max; b[id].rHi = "ajout"; }
      }
    }
    for (const id of ids) {
      b[id].lo = Math.ceil(b[id].lo / PAS - 1e-9) * PAS;
      b[id].hi = Math.floor(b[id].hi / PAS + 1e-9) * PAS;
    }
    return b;
  }

  function erreursBornes(ids, b) {
    return ids.filter(id => b[id].lo > b[id].hi + EPS).map(id =>
      b[id].rHi === "ifra"
        ? msg("dose_impossible", `On ne peut pas mettre assez ${de(nom(id))} à cette concentration : baisse-la ou retire cette note.`, { note: id })
        : msg("dose_impossible", `On ne peut pas doser ${nom(id)} correctement ici : retire cette note.`, { note: id }));
  }

  // Plage permise pour chaque étage : famille, fond minimum, et ce que les doses des notes permettent.
  function plagesEtages(famille, ids, b) {
    const eq = R.equilibre[famille];
    const plages = {}, err = [];
    for (const e of ETAGES) {
      const g = ids.filter(id => N[id].etage === e);
      const sLo = somme(g.map(id => b[id].lo)), sHi = somme(g.map(id => b[id].hi));
      let [lo, hi] = eq[e];
      if (e === "fond") lo = Math.max(lo, R.fond_minimum || 0);
      if (sHi < lo - EPS) err.push(msg("equilibre", `Pas assez de notes de ${NOM_ETAGE[e]} pour un parfum ${eq.nom} : ajoutes-en une.`, { etage: e }));
      else if (sLo > hi + EPS) err.push(msg("equilibre", `Trop de notes de ${NOM_ETAGE[e]} pour un parfum ${eq.nom} : retires-en une.`, { etage: e }));
      plages[e] = { lo: Math.max(lo, sLo), hi: Math.min(hi, sHi) };
    }
    if (!err.length) {
      if (somme(ETAGES.map(e => plages[e].lo)) > 100 + EPS)
        err.push(msg("equilibre", "Trop de notes pour leurs doses minimum : retires-en une."));
      else if (somme(ETAGES.map(e => plages[e].hi)) < 100 - EPS)
        err.push(msg("equilibre", "Les doses maximum ne suffisent pas à remplir le parfum : ajoute une note."));
    }
    return { plages, err };
  }

  /*
   * Mode expert sans famille imposée : la famille la plus marquée, ou à défaut
   * la suivante dont l'équilibre est atteignable avec ces notes.
   */
  function choisirFamille(entree, ids, b) {
    const classement = classementFamilles(entree);
    for (const f of classement) {
      const r = plagesEtages(f, ids, b);
      if (!r.err.length) return { famille: f, ...r };
    }
    return { famille: classement[0], ...plagesEtages(classement[0], ids, b) };
  }

  function erreursEtages(famille, etages) {
    const eq = R.equilibre[famille], err = [];
    for (const e of ETAGES) {
      let [lo, hi] = eq[e];
      if (e === "fond") lo = Math.max(lo, R.fond_minimum || 0);
      if (etages[e] < lo - EPS || etages[e] > hi + EPS)
        err.push(msg("equilibre", `Pour un parfum ${eq.nom}, les notes de ${NOM_ETAGE[e]} doivent faire entre ${lo} et ${hi} % (ici ${nombre(etages[e])} %).`, { etage: e }));
    }
    return err;
  }

  function totauxEtages(notesObj) {
    const t = { tete: 0, coeur: 0, fond: 0 };
    for (const [id, v] of Object.entries(notesObj)) if (connue(id)) t[N[id].etage] += v;
    for (const e of ETAGES) t[e] = Math.round(t[e] * 1e6) / 1e6;
    return t;
  }

  function normaliser(notesObj) {
    const ids = Object.keys(notesObj);
    const t = somme(Object.values(notesObj));
    return Object.fromEntries(ids.map(id => [id, Math.round((t > 0 ? (notesObj[id] / t) * 100 : 100 / ids.length) * 100) / 100]));
  }

  // Ce que l'ajustement a changé et pourquoi, pour l'afficher au client.
  function correctionsFaites(entree, sortie, b, poids, famille) {
    const tot = somme(Object.values(entree)) || 1;
    const res = [];
    for (const [id, v] of Object.entries(sortie)) {
      const avant = (entree[id] / tot) * 100;
      const info = { note: id, avant: Math.round(avant * 10) / 10, apres: v };
      if (avant > b[id].hi + EPS && Math.abs(v - b[id].hi) < EPS)
        res.push(msg("dose", `Dose ${de(nom(id))} ramenée à ${nombre(v)} % (${RAISON_HAUT[b[id].rHi]}).`, { ...info, raison: b[id].rHi }));
      else if (entree[id] > 0 && avant < b[id].lo - EPS && Math.abs(v - b[id].lo) < EPS)
        res.push(msg("dose", `Dose ${de(nom(id))} remontée à ${nombre(v)} % (${RAISON_BAS[b[id].rLo]}).`, { ...info, raison: b[id].rLo }));
    }
    const eq = R.equilibre[famille];
    const hors = ETAGES.some((e, k) => {
      const part = (poids[k] / tot) * 100;
      return part < eq[e][0] - EPS || part > eq[e][1] + EPS;
    });
    if (hors) res.push(msg("equilibre", `Proportions tête, cœur et fond rééquilibrées pour un parfum ${eq.nom}.`));
    return res;
  }

  function resultat(ok, formule, erreurs, avertissementsListe, corrections) {
    const ids = Object.keys(formule.notes).filter(connue);
    return { ok, formule, erreurs, avertissements: avertissementsListe, corrections, etages: totauxEtages(formule.notes), harmonie: harmonie(ids) };
  }

  /*
   * Vérifie une formule sans la modifier.
   * Renvoie { ok, erreurs, avertissements, famille, etages, harmonie }.
   */
  function verifier(formule = {}) {
    const ctx = contexte(formule, false);
    const notesF = lireNotes(formule.notes);
    const ids = Object.keys(notesF);
    const erreurs = [...ctx.erreurs, ...controleStructure(ids, ctx)];
    if (erreurs.length) return { ok: false, erreurs, avertissements: [], famille: ctx.famille, etages: null, harmonie: null };

    const c = ctx.concentration;
    const total = somme(ids.map(id => notesF[id]));
    if (Math.abs(total - 100) > 1e-6) erreurs.push(msg("total", `Le total des notes doit faire 100 % (ici ${nombre(total)} %).`));

    const b = bornes(ids, ctx);
    erreurs.push(...erreursBornes(ids, b));
    for (const id of ids) {
      const v = notesF[id];
      if ((v * c) / 100 > N[id].ifra_max + EPS)
        erreurs.push(msg("ifra", `Trop ${de(nom(id))} : la limite de sécurité est dépassée.`, { note: id }));
      else if (b[id].lo <= b[id].hi + EPS && (v < b[id].lo - EPS || v > b[id].hi + EPS))
        erreurs.push(msg("dose", `La dose ${de(nom(id))} doit rester entre ${nombre(b[id].lo)} et ${nombre(b[id].hi)} %.`, { note: id }));
      if (Math.abs(v / PAS - Math.round(v / PAS)) > 1e-6)
        erreurs.push(msg("pas", `La dose ${de(nom(id))} doit être un multiple de ${nombre(PAS)} %.`, { note: id }));
    }

    // Équilibre tête / cœur / fond : famille imposée, sinon la première famille qui convient
    // (les plus marquées d'abord). Utile pour relire un code de formule, qui ne contient pas la famille.
    const etages = totauxEtages(notesF);
    let famille = ctx.famille;
    if (!famille) {
      const classement = classementFamilles(notesF);
      const toutes = [...classement, ...Object.keys(R.equilibre).filter(f => !classement.includes(f))];
      famille = toutes.find(f => !erreursEtages(f, etages).length) || classement[0];
    }
    erreurs.push(...erreursEtages(famille, etages));

    // Aucune note ne doit écraser les autres (poids perçu = dose × puissance).
    const percu = ids.map(id => notesF[id] * N[id].puissance);
    const totalPercu = somme(percu);
    ids.forEach((id, i) => {
      if (totalPercu > 0 && (percu[i] / totalPercu) * 100 > R.puissance.part_max_par_note + EPS)
        erreurs.push(msg("trop_presente", `Trop ${de(nom(id))} pour rester harmonieux.`, { note: id }));
    });

    return { ok: erreurs.length === 0, erreurs, avertissements: avertissements(ids), famille, etages, harmonie: harmonie(ids) };
  }

  /*
   * Corrige une formule après chaque changement du client :
   * total remis à 100 %, puis plafonds de note, IFRA et équilibre tête / cœur / fond.
   * Renvoie { ok, formule, erreurs, avertissements, corrections, etages, harmonie }.
   * Si ok vaut false, `erreurs` contient des messages simples à afficher.
   */
  function ajuster(formule = {}) {
    const ctx = contexte(formule, true);
    const entree = lireNotes(formule.notes);
    const ids = Object.keys(entree);
    const base = { mode: ctx.mode, recette: ctx.idRecette, concentration: ctx.concentration };
    const echec = erreurs =>
      resultat(false, { ...base, famille: ctx.famille, notes: normaliser(entree) }, erreurs, [], ctx.corrections);

    const errStructure = controleStructure(ids, ctx);
    if (errStructure.length) return echec(errStructure);
    const b = bornes(ids, ctx);
    const errBornes = erreursBornes(ids, b);
    if (errBornes.length) return echec(errBornes);
    const { famille, plages, err: errEquilibre } = ctx.famille
      ? { famille: ctx.famille, ...plagesEtages(ctx.famille, ids, b) }
      : choisirFamille(entree, ids, b);
    if (errEquilibre.length) return echec(errEquilibre);

    // 1. Part de chaque étage, dans la plage de la famille.
    const poids = ETAGES.map(e => somme(ids.filter(id => N[id].etage === e).map(id => entree[id])));
    const bornesEtages = ETAGES.map(e => plages[e]);
    const cibles = arrondir(repartir(poids, bornesEtages, 100), bornesEtages, 100, PAS);

    // 2. Dose de chaque note dans son étage, dans ses propres limites.
    const sortie = {};
    ETAGES.forEach((e, k) => {
      const g = ids.filter(id => N[id].etage === e);
      const bg = g.map(id => b[id]);
      const v = arrondir(repartir(g.map(id => entree[id]), bg, cibles[k]), bg, cibles[k], PAS);
      g.forEach((id, i) => { sortie[id] = v[i]; });
    });
    const notesSortie = Object.fromEntries(ids.map(id => [id, sortie[id]]));

    // 3. Vérification finale, avec les mêmes règles que verifier().
    const f = { ...base, famille, notes: notesSortie };
    const v = verifier(f);
    const corrections = ctx.corrections.concat(correctionsFaites(entree, notesSortie, b, poids, famille));
    return resultat(v.ok, f, v.erreurs, v.avertissements, corrections);
  }

  /*
   * Mode expert : propose un dosage de départ pour une liste de notes
   * (milieu des plages de la famille, moins de dose pour les notes puissantes).
   */
  function proposer(ids, { concentration, famille } = {}) {
    const connues = ids.filter(connue);
    const ctx = contexte({ mode: "expert", concentration }, true);
    const fam = propre(R.equilibre, famille) ? famille
      : choisirFamille(Object.fromEntries(connues.map(id => [id, 0])), connues, bornes(connues, ctx)).famille;
    const eq = R.equilibre[fam];
    const doses = {};
    for (const e of ETAGES) {
      const g = connues.filter(id => N[id].etage === e);
      const inv = g.map(id => 1 / N[id].puissance), t = somme(inv);
      g.forEach((id, i) => { doses[id] = ((eq[e][0] + eq[e][1]) / 2) * (inv[i] / t); });
    }
    return ajuster({ mode: "expert", famille: fam, concentration, notes: Object.fromEntries(ids.map(id => [id, doses[id] ?? 0])) });
  }

  /*
   * Pour chaque note pas encore choisie : peut-on l'ajouter ?
   * Sert à griser les notes qui jurent (mode expert) ou à limiter l'ajout (mode guidé).
   */
  function notesCompatibles(formule = {}) {
    const ctx = contexte(formule, true);
    const ids = Object.keys(lireNotes(formule.notes)).filter(id => connue(id) && N[id].actif !== false);
    const deja = new Set(controlesAjout(ids, ctx).map(e => e.message));
    return Object.keys(N)
      .filter(id => !ids.includes(id) && N[id].actif !== false)
      .map(id => {
        const essai = [...ids, id];
        const nouvelles = controlesAjout(essai, ctx).filter(e => !deja.has(e.message));
        return { id, nom: N[id].nom, possible: nouvelles.length === 0, raison: nouvelles.length ? nouvelles[0].message : null, harmonie: harmonie(essai) };
      });
  }

  return { ajuster, verifier, proposer, notesCompatibles, harmonie, associations, familleDominante, limiteIfra };
}
