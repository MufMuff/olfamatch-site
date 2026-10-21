/*
 * Calculateur de fabrication de « Crée ton parfum » (Olfamatch).
 *
 * - grammes() : transforme une formule (doses en % du mélange d'huiles) en grammes
 *   à peser pour un flacon. On pèse, on ne compte pas les gouttes.
 * - encoder() / decoder() : le code de formule (ex. R04-BER12-ROS20-SAN25-MUS20-VAN15-C18-V100)
 *   qui voyage avec le paiement Stripe et permet de refaire le parfum à l'identique.
 * - allergenes() : la liste à imprimer sur l'étiquette.
 * - preparerFiche() : tout ce qu'affiche la page privée de fabrication à partir d'un code.
 *
 * Comme le moteur de règles, il lit tout dans les fichiers data/creer/*.json.
 */
import { creerMoteur } from "./moteur.js";

// Ordre de pesée : le fond d'abord, la tête (plus volatile) en dernier, puis l'alcool.
const ORDRE_PESEE = ["fond", "coeur", "tete"];
// On calcule en milligrammes entiers (balance au 0,001 g) pour que tout tombe juste.
const enMg = grammes => Math.round(grammes * 1000);
const enG = milligrammes => milligrammes / 1000;
const somme = t => t.reduce((s, v) => s + v, 0);
const msg = (code, message, extra = {}) => ({ code, message, ...extra });
// Dans un code, la virgule s'écrit « _ » (Stripe n'accepte que lettres, chiffres, - et _).
const nombreCode = v => String(Math.round(v * 100) / 100).replace(".", "_");
const lireNombre = s => Number(s.replace("_", "."));

export function creerFabrication(donnees) {
  const { notes, recettes, regles } = donnees;
  const N = notes.notes, REC = recettes.recettes, R = regles;
  const moteur = creerMoteur(donnees);
  const propre = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const idParCode = new Map(Object.entries(N).map(([id, n]) => [n.code, id]));
  const volumes = R.volumes_ml || [50, 100];
  const rang = id => ORDRE_PESEE.indexOf(N[id].etage);
  const dansOrdre = ids => [...ids].sort((a, b) => rang(a) - rang(b)); // tri stable : l'ordre de la formule est gardé
  const remarqueDilution = n => (n.dilution_stock < 100
    ? `flacon de stock dilué à ${n.dilution_stock} % : on en pèse ${Math.round(100 / n.dilution_stock * 10) / 10} fois plus`
    : "");

  /*
   * Grammes à peser pour une formule déjà vérifiée.
   *   masse totale = volume × densité
   *   mélange d'huiles = masse totale × concentration
   *   chaque note = mélange d'huiles × sa dose
   * Une note stockée diluée (à 10 % par exemple) se pèse 10 fois plus lourde ;
   * l'alcool qu'elle apporte est déduit de l'alcool à ajouter.
   * melangePrepare (mode guidé) : on part du mélange de la recette déjà reposé
   * et on ne pèse que les compléments.
   */
  function grammes(formule, volume, { melangePrepare = false } = {}) {
    const masseTotale = volume * R.densite_g_ml;
    const huiles = (masseTotale * formule.concentration) / 100;
    const ids = dansOrdre(Object.keys(formule.notes));
    const pur = Object.fromEntries(ids.map(id => [id, (huiles * formule.notes[id]) / 100]));
    const reste = { ...pur };
    const lignes = [];
    let melange = null;

    const recette = melangePrepare && formule.mode === "guide" && propre(REC, formule.recette) ? REC[formule.recette] : null;
    if (recette) {
      const doses = Object.entries(recette.notes);
      // Quantité d'huiles pure qu'on peut prendre dans le mélange sans dépasser aucune note.
      const base = Math.min(...doses.map(([id, r]) => (pur[id] || 0) / (r / 100)));
      if (base > 0) {
        const stockParGramme = somme(doses.map(([id, r]) => (r / 100) * (100 / N[id].dilution_stock)));
        for (const [id, r] of doses) reste[id] = Math.max(0, pur[id] - (base * r) / 100);
        melange = { recette: formule.recette, nom: recette.nom, huile_g: enG(enMg(base)), a_peser_g: enG(enMg(base * stockParGramme)) };
        lignes.push({
          type: "melange", id: formule.recette, nom: `Mélange ${formule.recette} « ${recette.nom} », déjà reposé`,
          dose_pct: null, huile_g: melange.huile_g, a_peser_g: melange.a_peser_g,
          remarque: stockParGramme > 1 + 1e-9 ? "contient l'alcool des notes prédiluées" : "",
        });
      }
    }

    for (const id of ids) {
      const n = N[id];
      const peser = enMg((reste[id] * 100) / n.dilution_stock);
      if (peser <= 0) continue; // déjà apporté en entier par le mélange
      const complement = melange !== null;
      lignes.push({
        type: "note", id, nom: n.nom, etage: n.etage, dose_pct: formule.notes[id],
        huile_g: enG(enMg(reste[id])), a_peser_g: enG(peser),
        remarque: [complement ? "complément" : "", remarqueDilution(n)].filter(Boolean).join(" ; "),
      });
    }

    const totalMg = enMg(masseTotale);
    const alcoolMg = totalMg - somme(lignes.map(l => enMg(l.a_peser_g)));
    lignes.push({ type: "alcool", id: "alcool", nom: "Alcool de parfumeur", dose_pct: null, huile_g: 0, a_peser_g: enG(alcoolMg), remarque: "en dernier" });
    return {
      volume_ml: volume, concentration: formule.concentration, densite_g_ml: R.densite_g_ml,
      masse_totale_g: enG(totalMg), masse_huiles_g: enG(enMg(huiles)), melange, lignes,
    };
  }

  /*
   * Allergènes du parfum fini : on additionne ceux déclarés par chaque fournisseur.
   * % dans le parfum = dose de la note × concentration × % de l'allergène dans l'huile.
   */
  function allergenes(formule) {
    const seuil = (R.etiquette && R.etiquette.seuil_allergenes_pct) || 0.001;
    const manquants = [];
    const total = new Map();
    for (const [id, dose] of Object.entries(formule.notes)) {
      const liste = N[id].allergenes;
      if (!liste) { manquants.push(id); continue; }
      for (const [nom, pct] of Object.entries(liste))
        total.set(nom, (total.get(nom) || 0) + (dose * formule.concentration * pct) / 10000);
    }
    const detail = [...total].map(([nom, pct]) => ({ nom, pct_parfum: Math.round(pct * 1e6) / 1e6 })).sort((a, b) => b.pct_parfum - a.pct_parfum);
    return {
      complet: manquants.length === 0,
      manquants: manquants.map(id => N[id].nom),
      seuil_pct: seuil,
      a_declarer: detail.filter(a => a.pct_parfum >= seuil - 1e-12).map(a => a.nom),
      detail,
    };
  }

  // Code de formule : recette (ou EX en mode expert), une partie par note, concentration, volume.
  function encoder(formule, volume) {
    const debut = formule.mode === "guide" ? formule.recette : "EX";
    const parNote = Object.entries(formule.notes).map(([id, v]) => N[id].code + nombreCode(v));
    return [debut, ...parNote, `C${nombreCode(formule.concentration)}`, `V${nombreCode(volume)}`].join("-");
  }

  function decoder(texte) {
    const echec = (...messages) => ({ ok: false, erreurs: messages.map(m => msg("code", m)) });
    // Les espaces et retours à la ligne d'un copier-coller sont ignorés.
    const brut = String(texte ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (!brut) return echec("Colle un code de formule, par exemple R04-BER12-ROS20-…-C18-V100.");
    if (brut.length > 200 || !/^[A-Z0-9_-]+$/.test(brut)) return echec("Ce code contient des caractères inattendus : vérifie le copier-coller.");
    const [debut, ...parties] = brut.split("-").filter(Boolean);
    let mode, recette = null;
    if (debut === "EX") mode = "expert";
    else if (/^R\d{2}$/.test(debut)) {
      if (!propre(REC, debut)) return echec(`La recette ${debut} n'existe pas (ou plus).`);
      mode = "guide"; recette = debut;
    } else return echec("Le code doit commencer par une recette (R04 par exemple) ou par EX.");

    const notesF = {}, erreurs = [];
    let concentration = null, volume = null, m;
    for (const p of parties) {
      if ((m = /^C(\d+(?:_\d+)?)$/.exec(p))) concentration = lireNombre(m[1]);
      else if ((m = /^V(\d+(?:_\d+)?)$/.exec(p))) volume = lireNombre(m[1]);
      else if ((m = /^([A-Z]{3})(\d+(?:_\d+)?)$/.exec(p))) {
        const id = idParCode.get(m[1]);
        if (!id) erreurs.push(`Note inconnue dans le code : ${m[1]}.`);
        else if (propre(notesF, id)) erreurs.push(`La note ${m[1]} apparaît deux fois.`);
        else notesF[id] = lireNombre(m[2]);
      } else erreurs.push(`Morceau illisible dans le code : ${p}.`);
    }
    if (!Object.keys(notesF).length && !erreurs.length) erreurs.push("Le code ne contient aucune note.");
    if (concentration === null) erreurs.push("Il manque la concentration (C18 par exemple).");
    if (volume === null) erreurs.push(`Il manque le volume (${volumes.map(v => `V${v}`).join(" ou ")}).`);
    else if (!volumes.includes(volume)) erreurs.push(`Le flacon de ${volume} ml n'est pas vendu : ${volumes.join(" ou ")} ml.`);
    if (erreurs.length) return echec(...erreurs);
    return { ok: true, formule: { mode, recette, concentration, notes: notesF }, volume, erreurs: [] };
  }

  /*
   * Page privée de fabrication : code collé → formule relue → revérifiée avec les
   * règles actuelles → grammes à peser et allergènes.
   */
  function preparerFiche(code, options = {}) {
    const lu = decoder(code);
    if (!lu.ok) return { ok: false, erreurs: lu.erreurs, avertissements: [] };
    const v = moteur.verifier(lu.formule);
    const formule = { ...lu.formule, famille: v.famille };
    if (!v.ok) return { ok: false, formule, volume: lu.volume, erreurs: v.erreurs, avertissements: v.avertissements };
    const fiche = grammes(formule, lu.volume, options);
    if (fiche.lignes.some(l => l.a_peser_g < 0))
      return { ok: false, formule, volume: lu.volume, erreurs: [msg("alcool", "Calcul impossible : les huiles dépassent la masse du flacon.")], avertissements: [] };
    return {
      ok: true, code: encoder(formule, lu.volume), formule, volume: lu.volume,
      recette: formule.recette ? REC[formule.recette].nom : null,
      fiche, allergenes: allergenes(formule), avertissements: v.avertissements, erreurs: [],
    };
  }

  // Préparer à l'avance un lot du mélange d'huiles d'une recette (pour qu'il repose).
  function ficheMelange(idRecette, huileG) {
    if (!propre(REC, idRecette)) return { ok: false, erreurs: [msg("recette", "Choisis une recette.")] };
    const x = Number(huileG);
    if (!(Number.isFinite(x) && x > 0 && x <= 10000)) return { ok: false, erreurs: [msg("quantite", "Indique la quantité d'huiles voulue, en grammes.")] };
    const r = REC[idRecette];
    const lignes = dansOrdre(Object.keys(r.notes)).map(id => {
      const n = N[id], pur = (x * r.notes[id]) / 100;
      return { id, nom: n.nom, etage: n.etage, dose_pct: r.notes[id], huile_g: enG(enMg(pur)), a_peser_g: enG(enMg((pur * 100) / n.dilution_stock)), remarque: remarqueDilution(n) };
    });
    return { ok: true, recette: idRecette, nom: r.nom, huile_g: x, lignes, total_g: enG(somme(lignes.map(l => enMg(l.a_peser_g)))), erreurs: [] };
  }

  return { grammes, allergenes, encoder, decoder, preparerFiche, ficheMelange, volumes };
}
