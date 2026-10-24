/*
 * Les 5 portes d'entrée de « Crée ton parfum » V2, sans affichage (§ B8).
 *   P1 Pars d'un parfum que tu aimes · P2 Par ambiance · P3 Petit quiz
 *   P4 Recettes de base à modifier · P5 Mode expert libre
 * Toutes aboutissent au même écran Récap. Chaque formule proposée passe par le moteur
 * (harmonie + sécurité) : rien ne sort sans avoir été vérifié.
 */
import { ETAGES } from "./moteur.js";

const somme = t => t.reduce((s, v) => s + v, 0);
const borne = (v, a, b) => Math.min(b, Math.max(a, v));
const propre = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
export const sansAccent = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`´]/g, "'").toLowerCase().trim();
const NOM_ETAGE = { tete: "tête", coeur: "cœur", fond: "fond" };

export function creerPortes(d, moteur) {
  const R = d.regles, P = d.portes, REC = d.recettes.recettes, STRUCT = d.structures.structures, FE = d.features || {};
  const N = new Map(Object.values(d.notes.notes).map(n => [n.code, n]));
  const DISPO = new Set(moteur.notesDisponibles().map(n => n.code));
  const C0 = R.concentration.defaut;
  const PAS = R.pas_pourcentage;
  const nom = c => N.get(c)?.nom || c;

  // ---------------- commun ----------------

  const recetteActive = code => Object.keys(REC[code].notes).every(c => DISPO.has(c));
  const RECETTES = Object.keys(REC).filter(recetteActive);
  const formuleRecette = (code, concentration = C0) => ({ concentration, notes: { ...REC[code].notes } });
  const score = f => moteur.harmonie(f).score;

  // La formule telle quelle si elle est conforme, sinon la variante conforme la plus proche.
  function conforme(f) {
    if (moteur.securite(f).ok) return f;
    const c = moteur.corriger(f);
    return c.ok ? c.formule : f;
  }

  // Curseurs fraîcheur, douceur, intensité (de −1 à +1), repris du mode guidé V1.
  function appliquerCurseurs(formule, curseurs = {}) {
    return conforme(moteur.transformer(formule, curseurs));
  }

  function resumeRecette(code) {
    const r = REC[code], f = formuleRecette(code), h = moteur.harmonie(f);
    return { code, nom: r.nom, structure: r.structure, nom_structure: STRUCT[r.structure].nom, famille: STRUCT[r.structure].famille,
      vague: r.vague, statut: r.statut, notes: Object.keys(r.notes).map(c => ({ code: c, nom: nom(c) })), harmonie: h.score, libelle: h.libelle };
  }

  // Portes visibles : P1 seulement avec l'interrupteur inspiration_nommee et des parfums renseignés.
  function portesVisibles() {
    const res = [];
    if (FE.inspiration_nommee === true && Object.keys(d.notes_publiees?.parfums || {}).length) res.push("P1");
    res.push("P2", "P3", "P4", "P5");
    return res.map(id => ({ id, ...P.portes[id] }));
  }

  // ---------------- P4 : recettes de base à modifier ----------------

  function familles() {
    const presentes = new Set(RECETTES.map(r => STRUCT[REC[r].structure].famille));
    return Object.entries(P.familles).filter(([f]) => presentes.has(f)).map(([id, nomF]) => ({ id, nom: nomF }));
  }

  const catalogue = famille => RECETTES.filter(r => !famille || STRUCT[REC[r].structure].famille === famille).map(resumeRecette);

  /*
   * Règle une note à une valeur (en % du concentré) ; les autres gardent leurs proportions
   * et le total reste 100. La valeur est bornée à la limite de sécurité de la note.
   */
  function reglerNote(formule, code, valeur) {
    if (!propre(formule.notes, code)) return formule;
    const lim = moteur.limitesNote(formule, code) || { min: PAS, max: 100 };
    const v = borne(Number(valeur), Math.max(PAS, lim.min), Math.max(PAS, Math.min(lim.max, 100 - PAS * (Object.keys(formule.notes).length - 1))));
    const autres = Object.entries(formule.notes).filter(([c]) => c !== code);
    const reste = somme(autres.map(([, x]) => x));
    const notes = { [code]: v };
    for (const [c, x] of autres) notes[c] = reste > 0 ? (x * (100 - v)) / reste : (100 - v) / autres.length;
    return conforme({ ...formule, notes: moteur.normaliser(notes) });
  }

  // ±5 points sur une note (P4).
  const ajusterNote = (formule, code, delta) => reglerNote(formule, code, (formule.notes[code] || 0) + delta);

  // Notes du même étage qui peuvent remplacer une note (P4), les mieux accordées d'abord.
  function remplacants(formule, code) {
    const n = N.get(code);
    if (!n) return [];
    return [...DISPO].filter(c => c !== code && !propre(formule.notes, c) && N.get(c).etage === n.etage).map(c => {
      const f = remplacer(formule, code, c);
      return { code: c, nom: nom(c), harmonie: score(f), conforme: moteur.securite(f).ok };
    }).sort((a, b) => b.harmonie - a.harmonie || a.nom.localeCompare(b.nom));
  }

  // Remplace une note par une autre, à la même dose (ramenée sous ses limites si besoin).
  function remplacer(formule, ancien, nouveau) {
    if (!propre(formule.notes, ancien) || propre(formule.notes, nouveau)) return formule;
    const notes = {};
    for (const [c, x] of Object.entries(formule.notes)) notes[c === ancien ? nouveau : c] = x;
    return conforme({ ...formule, notes });
  }

  // ---------------- P5 : mode expert libre ----------------

  function notesParEtage() {
    const res = { tete: [], coeur: [], fond: [] };
    for (const c of DISPO) { const n = N.get(c); res[n.etage].push({ code: c, nom: n.nom, famille: n.famille, texte: n.texte }); }
    for (const e of ETAGES) res[e].sort((a, b) => a.nom.localeCompare(b.nom));
    return res;
  }

  /*
   * Doses de départ pour une liste de notes : part de chaque étage selon la pyramide de la structure
   * (donnée, ou la plus proche), puis, dans un étage, moins de dose pour les notes puissantes.
   */
  function proposerDoses(codes, { concentration = C0, structure = null } = {}) {
    const liste = [...new Set(codes)].filter(c => N.has(c));
    if (!liste.length) return { concentration, notes: {} };
    const pyr = structure && STRUCT[structure] ? STRUCT[structure].pyramide
      : STRUCT[moteur.structureProche({ concentration, notes: Object.fromEntries(liste.map(c => [c, 1])) }).structure].pyramide;
    const groupes = Object.fromEntries(ETAGES.map(e => [e, liste.filter(c => N.get(c).etage === e)]));
    const partTotale = somme(ETAGES.filter(e => groupes[e].length).map(e => pyr[e])) || 1;
    const doses = {};
    for (const e of ETAGES) {
      const g = groupes[e];
      if (!g.length) continue;
      const part = (pyr[e] / partTotale) * 100;
      const inv = g.map(c => 1 / N.get(c).puissance), t = somme(inv);
      // on reste à 80 % du maximum de chaque note pour garder de la marge sur les curseurs
      g.forEach((c, i) => { doses[c] = Math.min(0.8 * N.get(c).dose_max, (part * inv[i]) / t); });
    }
    return conforme({ concentration, notes: moteur.normaliser(doses) });
  }

  // Ajoute une note (10 % de départ, ou moins si sa limite l'impose) ; les autres s'ajustent.
  function ajouterNote(formule, code) {
    if (!N.has(code) || propre(formule.notes, code)) return formule;
    if (!Object.keys(formule.notes).length) return proposerDoses([code], { concentration: formule.concentration });
    const f = { ...formule, notes: moteur.normaliser({ ...formule.notes, [code]: PAS }) };
    return reglerNote(f, code, Math.min(10, N.get(code).dose_max));
  }

  function retirerNote(formule, code) {
    const notes = { ...formule.notes };
    delete notes[code];
    return { ...formule, notes: Object.keys(notes).length ? moteur.normaliser(notes) : {} };
  }

  /*
   * Mode expert : ce qui manque (un étage vide, trop peu de notes) et les notes qui le règlent
   * en un clic, les mieux accordées d'abord (repris de la V1).
   */
  function suggestions(formule, parManque = 4) {
    const presents = Object.keys(formule.notes);
    const out = [];
    const meilleures = filtre => [...DISPO].filter(c => !presents.includes(c) && filtre(c))
      .map(c => ({ code: c, nom: nom(c), harmonie: score(ajouterNote(formule, c)) }))
      .sort((a, b) => b.harmonie - a.harmonie).slice(0, parManque);
    for (const e of ETAGES)
      if (presents.length && !presents.some(c => N.get(c).etage === e)) {
        const notes = meilleures(c => N.get(c).etage === e);
        if (notes.length) out.push({ manque: "etage", etage: e, titre: `Ajoute une note de ${NOM_ETAGE[e]} :`, notes });
      }
    const min = moteur.plages().nombre_notes.min;
    if (presents.length && presents.length < min && !out.length) {
      const notes = meilleures(() => true);
      if (notes.length) out.push({ manque: "nombre", etage: null, titre: `Ajoute au moins ${min - presents.length} note${min - presents.length > 1 ? "s" : ""} :`, notes });
    }
    return out;
  }

  // ---------------- P2 : par ambiance ----------------

  /*
   * Jusqu'à 3 recettes des structures données (dans leur ordre), sans les notes à éviter,
   * en préférant celles qui contiennent les notes souhaitées.
   */
  function recettesPourStructures(structures, { exclure = [], preferer = [], nombre = 3 } = {}) {
    const rang = s => structures.indexOf(s);
    return RECETTES.filter(r => structures.includes(REC[r].structure) && !exclure.some(c => propre(REC[r].notes, c)))
      .map(r => ({ r, rang: rang(REC[r].structure), voulues: preferer.filter(c => propre(REC[r].notes, c)).length, h: score(formuleRecette(r)) }))
      .sort((a, b) => b.voulues - a.voulues || a.rang - b.rang || b.h - a.h)
      .slice(0, nombre).map(x => resumeRecette(x.r));
  }

  const ambiances = () => P.ambiances.filter(a => recettesPourStructures(a.structures).length).map(a => ({ id: a.id, nom: a.nom, texte: a.texte }));

  function recettesAmbiance(id, opts = {}) {
    const a = P.ambiances.find(x => x.id === id);
    return a ? recettesPourStructures(a.structures, opts) : [];
  }

  /*
   * Réponse de l'IA (rôle 1, déjà contrôlée par le serveur) : { structure_code, notes_codes,
   * notes_evitees, intensite } → recettes proposées et concentration. L'IA ne donne jamais de dose.
   */
  function depuisComprehension(rep = {}) {
    const voulues = (rep.notes_codes || []).filter(c => DISPO.has(c));
    const evitees = (rep.notes_evitees || []).filter(c => N.has(c));
    const recouvre = s => somme(voulues.map(c => (STRUCT[s].obligatoires.some(g => g.notes.includes(c)) ? 2 : STRUCT[s].optionnelles.includes(c) ? 1 : 0)));
    const toutes = Object.keys(STRUCT).sort((a, b) => recouvre(b) - recouvre(a));
    const ordre = rep.structure_code && STRUCT[rep.structure_code] ? [rep.structure_code, ...toutes.filter(s => s !== rep.structure_code)] : toutes;
    return {
      recettes: recettesPourStructures(ordre, { exclure: evitees, preferer: voulues }),
      concentration: P.intensites[rep.intensite] ?? C0,
      voulues, evitees,
    };
  }

  // ---------------- P3 : petit quiz ----------------

  const quiz = () => P.quiz.map(q => ({ id: q.id, question: q.question, reponses: q.reponses.map(r => ({ id: r.id, texte: r.texte })) }));

  /*
   * reponses = { moment: "soir", saison: "hiver", … }, detestee = code d'une note à éviter.
   * On garde les 2 structures qui ont le plus de points et leurs recettes.
   */
  function resultatQuiz(reponses = {}, { detestee = null } = {}) {
    const points = {};
    let intensite = null;
    for (const q of P.quiz) {
      const r = q.reponses.find(x => x.id === reponses[q.id]);
      if (!r) continue;
      for (const [s, p] of Object.entries(r.points || {})) points[s] = (points[s] || 0) + p;
      if (r.intensite) intensite = r.intensite;
    }
    const exclure = detestee && N.has(detestee) ? [detestee] : [];
    const ordre = Object.keys(STRUCT);
    const candidates = ordre.filter(s => recettesPourStructures([s], { exclure }).length)
      .sort((a, b) => (points[b] || 0) - (points[a] || 0) || ordre.indexOf(a) - ordre.indexOf(b));
    const structures = candidates.slice(0, P.quiz_structures || 2);
    return {
      structures: structures.map(s => ({ code: s, nom: STRUCT[s].nom, points: points[s] || 0 })),
      recettes: recettesPourStructures(structures, { exclure }),
      concentration: P.intensites[intensite] ?? C0,
    };
  }

  // ---------------- P1 : pars d'un parfum que tu aimes ----------------

  const COR = new Map(Object.entries(d.correspondances?.notes || {}).map(([k, v]) => [sansAccent(k), v]));
  const PUB = d.notes_publiees?.parfums || {};
  const codeDe = nomNote => COR.get(sansAccent(nomNote)) || null;

  // Parfums proposés dans le champ « Un parfum que tu aimes » (ceux qui ont des notes publiées).
  function parfumsInspiration(parfums = []) {
    if (FE.inspiration_nommee !== true) return [];
    return parfums.filter(p => propre(PUB, p.slug)).map(p => ({ slug: p.slug, nom: p.name, marque: p.brand }));
  }

  /*
   * Ce que l'outil couvre des notes publiées d'un parfum :
   * { etages: { tete: [{ nom, code, couverte }] … }, couvertes, total, codes }
   */
  function couverture(slug) {
    const p = PUB[slug];
    if (!p || FE.inspiration_nommee !== true) return null;
    const etages = {}, codes = [];
    let total = 0, couvertes = 0;
    for (const e of ETAGES) {
      etages[e] = (p[e] || []).map(n => {
        const code = codeDe(n);
        const ok = Boolean(code && DISPO.has(code));
        total++;
        if (ok) { couvertes++; if (!codes.includes(code)) codes.push(code); }
        return { nom: n, code, couverte: ok };
      });
    }
    return { etages, couvertes, total, codes, a_verifier: p.a_verifier === true };
  }

  /*
   * Formule à partir des notes couvertes, dans la structure la plus proche : celle dont les notes
   * recoupent le mieux, puis la pyramide la plus proche. S'il manque un étage ou des notes, on en
   * ajoute de la structure (signalées comme ajoutées).
   */
  function proposerDepuisNotes(codes, { concentration = C0 } = {}) {
    const liste = codes.filter(c => DISPO.has(c));
    if (!liste.length) return null;
    const recouvre = s => somme(liste.map(c => (STRUCT[s].obligatoires.some(g => g.notes.includes(c)) ? 2 : STRUCT[s].optionnelles.includes(c) ? 1 : 0)));
    const actives = Object.keys(STRUCT).filter(s => RECETTES.some(r => REC[r].structure === s));
    const proche = moteur.structureProche({ concentration, notes: Object.fromEntries(liste.map(c => [c, 1])) }, actives).structure;
    const structure = actives.sort((a, b) => recouvre(b) - recouvre(a) || (b === proche) - (a === proche))[0];
    const ajoutees = [];
    const st = STRUCT[structure];
    const candidats = [...st.obligatoires.flatMap(g => g.notes), ...st.optionnelles].filter(c => DISPO.has(c));
    const choix = [...liste];
    for (const e of ETAGES)
      if (!choix.some(c => N.get(c).etage === e)) {
        const c = candidats.find(x => N.get(x).etage === e && !choix.includes(x));
        if (c) { choix.push(c); ajoutees.push(c); }
      }
    for (const c of candidats) {
      if (choix.length >= moteur.plages().nombre_notes.min) break;
      if (!choix.includes(c)) { choix.push(c); ajoutees.push(c); }
    }
    const max = moteur.plages().nombre_notes.max;
    const formule = proposerDoses(choix.slice(0, max), { concentration, structure });
    return { formule, structure, nom_structure: st.nom, ajoutees };
  }

  // Parfum sans notes publiées mais avec des accords (data/accords.json) : la structure la plus proche.
  function proposerDepuisAccords(accords = []) {
    const SF = d.correspondances?.accords || {};
    const profil = {};
    for (const [a, poids] of accords) if (SF[a]) profil[SF[a]] = (profil[SF[a]] || 0) + poids;
    if (!Object.keys(profil).length) return null;
    const actives = Object.keys(STRUCT).filter(s => RECETTES.some(r => REC[r].structure === s));
    const valeur = s => {
      const st = STRUCT[s];
      const notes = [...st.obligatoires.flatMap(g => g.notes.map(c => [c, 2])), ...st.optionnelles.map(c => [c, 1])];
      return somme(notes.map(([c, w]) => w * (profil[N.get(c).sous_famille] || 0))) / somme(notes.map(([, w]) => w));
    };
    const structure = actives.sort((a, b) => valeur(b) - valeur(a))[0];
    const recette = recettesPourStructures([structure], { nombre: 1 })[0];
    return { structure, nom_structure: STRUCT[structure].nom, recette: recette?.code || null, formule: recette ? formuleRecette(recette.code) : null };
  }

  /*
   * Curseurs tête / cœur / fond (P1) : chaque étage est ramené à la part voulue,
   * les notes d'un étage gardant leurs proportions.
   */
  function reglerEtages(formule, cible) {
    const groupes = Object.fromEntries(ETAGES.map(e => [e, Object.keys(formule.notes).filter(c => N.get(c).etage === e)]));
    const utiles = ETAGES.filter(e => groupes[e].length);
    const t = somme(utiles.map(e => Math.max(1, Number(cible[e]) || 0))) || 1;
    const notes = {};
    for (const e of utiles) {
      const part = (Math.max(1, Number(cible[e]) || 0) / t) * 100;
      const s = somme(groupes[e].map(c => formule.notes[c])) || 1;
      for (const c of groupes[e]) notes[c] = (formule.notes[c] / s) * part;
    }
    return conforme({ ...formule, notes: moteur.normaliser(notes) });
  }

  // Intensité (P1) : concentration de 15 à 20 %, au pas de 1 %.
  function reglerIntensite(formule, c) {
    const pc = moteur.plages().concentration;
    return conforme({ ...formule, concentration: borne(Math.round(Number(c) || C0), pc.min, pc.max) });
  }

  // Parts de tête, de cœur et de fond, par étage principal de chaque note (curseurs de P1).
  function partsEtages(formule) {
    const t = { tete: 0, coeur: 0, fond: 0 };
    for (const [c, x] of Object.entries(formule.notes)) t[N.get(c).etage] += x;
    return t;
  }

  // ---------------- écran Récap ----------------

  function pyramide(formule) {
    const p = { tete: [], coeur: [], fond: [] };
    for (const [c, pct] of Object.entries(formule.notes)) if (N.has(c)) p[N.get(c).etage].push({ code: c, nom: nom(c), pct });
    for (const e of ETAGES) p[e].sort((a, b) => b.pct - a.pct || a.nom.localeCompare(b.nom));
    return p;
  }

  // Description préécrite (repli quand l'IA est coupée ou indisponible). Jamais de nom de marque ni de chiffre.
  function decrire(formule) {
    const fam = moteur.familles(formule);
    const p = pyramide(formule);
    const noms = e => p[e].map(n => n.nom.toLowerCase()).join(", ");
    const forte = Object.entries(formule.notes).filter(([c]) => N.has(c))
      .sort((a, b) => b[1] * N.get(b[0]).puissance - a[1] * N.get(a[0]).puissance)[0];
    const T = P.familles_textes || {};
    const premiere = fam[0] && T[fam[0].famille], seconde = fam[1] && fam[1].part >= 0.2 && T[fam[1].famille];
    const phrases = [premiere ? `Un parfum ${premiere.adjectif}${seconde ? ` avec une touche ${seconde.touche}` : ""}.` : "Un parfum tout en douceur."];
    const parties = [];
    if (p.tete.length) parties.push(`En tête : ${noms("tete")}.`);
    if (p.coeur.length) parties.push(`Au cœur : ${noms("coeur")}.`);
    if (p.fond.length) parties.push(`En fond : ${noms("fond")}.`);
    phrases.push(parties.join(" "));
    if (forte) phrases.push(`Ce qu'on sent le plus : ${nom(forte[0]).toLowerCase()}. ${N.get(forte[0]).texte}`);
    return phrases.join(" ");
  }

  /*
   * Tout ce qu'affiche l'écran Récap : pyramide, harmonie et son libellé, conformité,
   * possibilité de commander selon la porte, avertissements, description préécrite.
   */
  function recap(formule, { porte = "P5", confirme = false } = {}) {
    const ev = moteur.evaluer(formule, { porte, confirme });
    return {
      formule,
      pyramide: pyramide(formule),
      harmonie: { score: ev.harmonie.score, libelle: ev.harmonie.libelle, texte: ev.harmonie.texte, structure: ev.harmonie.structure_proche,
        nom_structure: STRUCT[ev.harmonie.structure_proche]?.nom || null },
      conforme: ev.conforme,
      erreurs: ev.securite.erreurs.map(e => e.message),
      marge: ev.securite.marge_min,
      commande: ev.commande,
      avertissements: ev.avertissements.map(a => a.message),
      description: decrire(formule),
    };
  }

  return {
    portesVisibles, familles, catalogue, resumeRecette, formuleRecette, recettesActives: () => [...RECETTES],
    reglerNote, ajusterNote, remplacants, remplacer,
    notesParEtage, proposerDoses, ajouterNote, retirerNote, suggestions,
    ambiances, recettesAmbiance, recettesPourStructures, depuisComprehension,
    quiz, resultatQuiz, appliquerCurseurs,
    parfumsInspiration, couverture, codeDe, proposerDepuisNotes, proposerDepuisAccords, reglerEtages, reglerIntensite, partsEtages,
    pyramide, decrire, recap, conforme,
    notesDisponibles: () => [...DISPO],
  };
}
