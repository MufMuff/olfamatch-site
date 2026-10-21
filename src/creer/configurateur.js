/*
 * Logique du configurateur « Crée ton parfum » (Olfamatch), sans affichage :
 * - choisirRecettes() : les 5 questions du mode guidé → 2 ou 3 recettes de départ ;
 * - transformer() / formuleGuidee() : les 3 curseurs (fraîcheur ↔ chaleur, douceur, intensité) ;
 * - variantesKit() : les 3 variantes du kit d'échantillons ;
 * - pyramide(), roue(), frise(), decrire() : ce que voit le client ;
 * - lienPaiement() : le lien Stripe avec le code de formule.
 * Tout passe par le moteur de règles : aucune formule ne sort sans avoir été vérifiée.
 */
import { creerMoteur, ETAGES } from "./moteur.js";

const somme = t => t.reduce((s, v) => s + v, 0);
const borne = (v, a, b) => Math.min(b, Math.max(a, v));
const AMBIANCE_FAMILLE = { fraiche: "frais", florale: "floral", boisee: "boise", chaude: "ambre", gourmande: "gourmand" };

export function creerConfigurateur(donnees) {
  const N = donnees.notes.notes, REC = donnees.recettes.recettes, R = donnees.regles;
  const moteur = creerMoteur(donnees);
  const propre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ROUE = R.roue || Object.keys(R.equilibre);

  // Distance entre deux familles sur la roue (0 = même famille, 3 = opposées).
  function distanceRoue(a, b) {
    const i = ROUE.indexOf(a), j = ROUE.indexOf(b);
    if (i < 0 || j < 0) return ROUE.length;
    const d = Math.abs(i - j);
    return Math.min(d, ROUE.length - d);
  }

  /*
   * Mode guidé : réponses → 2 ou 3 recettes.
   * reponses = { ambiance, moment, saison, intensite, adoree, detestee }
   * Une recette qui contient la note détestée est écartée.
   * La note adorée : bonus si la recette la contient, petit bonus si on peut l'ajouter.
   */
  function choisirRecettes(reponses = {}, nombre = 3) {
    const voulue = AMBIANCE_FAMILLE[reponses.ambiance];
    const res = [];
    for (const [id, r] of Object.entries(REC)) {
      if (reponses.detestee && propre(r.notes, reponses.detestee)) continue;
      let score = 0;
      const raisons = [];
      if (r.ambiance === reponses.ambiance) { score += 10; raisons.push("ambiance"); }
      else if (voulue) score += Math.max(0, 4 - 2 * distanceRoue(voulue, r.famille));
      if (reponses.moment && r.moment.includes(reponses.moment)) { score += 3; raisons.push("moment"); }
      if (reponses.saison && r.saisons.includes(reponses.saison)) { score += 2; raisons.push("saison"); }
      if (reponses.intensite && r.intensite === reponses.intensite) { score += 3; raisons.push("intensite"); }
      let ajout = null;
      if (reponses.adoree && propre(N, reponses.adoree)) {
        if (propre(r.notes, reponses.adoree)) { score += 5; raisons.push("note adorée"); }
        else {
          const possible = moteur.notesCompatibles({ mode: "guide", recette: id, notes: r.notes })
            .find(n => n.id === reponses.adoree && n.possible);
          if (possible && formuleGuidee(id, {}, reponses.adoree).ok) { score += 2; ajout = reponses.adoree; raisons.push("note adorée ajoutée"); }
        }
      }
      res.push({ id, nom: r.nom, famille: r.famille, score, ajout, raisons });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, nombre);
  }

  /*
   * Applique les curseurs à une formule (de -1 à +1 chacun) :
   *   fraicheur : -1 plus frais (plus de tête), +1 plus chaud (plus de fond) ;
   *   douceur   : -1 plus sec, +1 plus doux (selon la famille de chaque note) ;
   *   intensite : -1 plus léger, +1 plus intense (concentration dans sa plage).
   * Le moteur remet ensuite tout dans les règles (marges de la recette, IFRA, équilibre).
   */
  function transformer(formule, { fraicheur = 0, douceur = 0, intensite = 0 } = {}) {
    const fr = borne(Number(fraicheur) || 0, -1, 1), dz = borne(Number(douceur) || 0, -1, 1), it = borne(Number(intensite) || 0, -1, 1);
    const cF = R.curseurs.fraicheur, cD = R.curseurs.douceur;
    const notes = {};
    for (const [id, v] of Object.entries(formule.notes)) {
      const n = N[id];
      notes[id] = n ? v * Math.max(0.05, 1 + fr * (cF[n.etage] || 0)) * Math.max(0.05, 1 + dz * (cD[n.famille] || 0)) : v;
    }
    const { min, max, defaut } = R.concentration;
    const c0 = Number(formule.concentration ?? defaut);
    const c = borne(c0 + it * (it > 0 ? max - c0 : c0 - min), min, max);
    return { ...formule, notes, concentration: Math.round(c * 2) / 2 };
  }

  // Mode guidé : recette + curseurs (+ une note ajoutée) → formule vérifiée par le moteur.
  function formuleGuidee(idRecette, curseurs = {}, ajout = null) {
    if (!propre(REC, idRecette)) return moteur.ajuster({ mode: "guide", recette: idRecette, notes: {} });
    const r = REC[idRecette];
    const notes = { ...r.notes };
    if (ajout && !propre(notes, ajout)) notes[ajout] = Math.min(5, R.guide.ajout_dose_max);
    return moteur.ajuster(transformer({ mode: "guide", recette: idRecette, concentration: r.concentration, notes }, curseurs));
  }

  /*
   * Kit d'échantillons : 3 variantes de la formule du client (plus fraîche, standard, plus intense).
   * Chaque variante repasse par le moteur ; si une variante est refusée, on garde la formule standard.
   */
  function variantesKit(formule) {
    return (R.kit?.variantes || []).map(v => {
      const essai = moteur.ajuster(transformer(formule, v));
      const ok = essai.ok;
      return { nom: v.nom, formule: ok ? essai.formule : { ...formule }, ok };
    });
  }

  // Notes par étage, de la plus dosée à la moins dosée.
  function pyramide(formule) {
    const p = { tete: [], coeur: [], fond: [] };
    for (const [id, pct] of Object.entries(formule.notes)) if (N[id]) p[N[id].etage].push({ id, nom: N[id].nom, pct });
    for (const e of ETAGES) p[e].sort((a, b) => b.pct - a.pct);
    return p;
  }

  /*
   * Roue des familles : part de chaque famille dans ce qu'on sent (dose × puissance),
   * et position moyenne sur la roue (en degrés, 0 = première famille, sens horaire).
   */
  function roue(formule) {
    const poids = Object.fromEntries(ROUE.map(f => [f, 0]));
    for (const [id, pct] of Object.entries(formule.notes)) {
      const n = N[id];
      if (n && propre(poids, n.famille)) poids[n.famille] += pct * n.puissance;
    }
    const total = somme(Object.values(poids)) || 1;
    const pas = 360 / ROUE.length;
    let x = 0, y = 0;
    const familles = ROUE.map((f, i) => {
      const part = poids[f] / total;
      x += part * Math.cos((i * pas * Math.PI) / 180);
      y += part * Math.sin((i * pas * Math.PI) / 180);
      return { id: f, nom: R.equilibre[f].nom, part: Math.round(part * 1000) / 10, angle: i * pas };
    });
    const angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const dominante = familles.reduce((m, f) => (f.part > m.part ? f : m)).id;
    return { familles, angle: Math.round(angle), force: Math.round(Math.hypot(x, y) * 100) / 100, dominante };
  }

  /*
   * Frise « 0 min / 1 h / 6 h » : les notes qu'on sent le plus à chaque moment (estimation).
   * Une note pèse dose × puissance, s'éteint au fil de sa tenue ; le fond met un peu de temps à apparaître.
   */
  const EMERGENCE = { tete: 1, coeur: 0.8, fond: 0.5 };
  function frise(formule, moments = [{ nom: "0 min", h: 0 }, { nom: "1 h", h: 1 }, { nom: "6 h", h: 6 }], parMoment = 3) {
    return moments.map(m => {
      const notes = Object.entries(formule.notes).filter(([id]) => N[id]).map(([id, pct]) => {
        const n = N[id];
        const reste = Math.max(0, 1 - m.h / n.tenue_h);
        const apparition = m.h === 0 ? EMERGENCE[n.etage] : 1;
        return { id, nom: n.nom, force: pct * n.puissance * reste * apparition };
      }).filter(n => n.force > 0).sort((a, b) => b.force - a.force).slice(0, parMoment);
      return { moment: m.nom, notes: notes.map(({ id, nom }) => ({ id, nom })) };
    });
  }

  // Description préécrite : famille, notes par étage, note la plus présente. Jamais de nom de marque.
  function decrire(formule) {
    const r = roue(formule);
    const fam = formule.famille && R.equilibre[formule.famille] ? formule.famille : r.dominante;
    const eq = R.equilibre[fam];
    const seconde = r.familles.filter(f => f.id !== fam && f.part >= 20).sort((a, b) => b.part - a.part)[0];
    const p = pyramide(formule);
    const noms = e => p[e].map(n => n.nom.toLowerCase()).join(", ");
    const forte = Object.entries(formule.notes).filter(([id]) => N[id])
      .sort((a, b) => b[1] * N[b[0]].puissance - a[1] * N[a[0]].puissance)[0];
    const phrases = [
      `Un parfum ${eq.nom}${seconde ? ` avec une touche ${R.equilibre[seconde.id].touche}` : ""}. ${eq.texte}`,
      `En tête : ${noms("tete")}. Au cœur : ${noms("coeur")}. En fond : ${noms("fond")}.`,
    ];
    if (forte && N[forte[0]].texte) phrases.push(`Ce qu'on sent le plus : ${N[forte[0]].nom.toLowerCase()}. ${N[forte[0]].texte}`);
    return phrases.join(" ");
  }

  return { choisirRecettes, transformer, formuleGuidee, variantesKit, pyramide, roue, frise, decrire, moteur };
}

/*
 * Lien de paiement Stripe pour un produit (kit, flacon_50, flacon_100), avec le code de formule.
 * null si le lien n'est pas encore créé dans boutique.json.
 */
export function lienPaiement(boutique, produit, code) {
  const base = boutique && boutique.liens_stripe && boutique.liens_stripe[produit];
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("client_reference_id", code);
  return url.toString();
}
