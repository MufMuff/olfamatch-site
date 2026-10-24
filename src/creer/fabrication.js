/*
 * Fabrication de « Crée ton parfum » V2 : grammes à peser (§ B7).
 *
 * Tout se pèse, rien ne se mesure en volume :
 *   masse du concentré = volume × concentration × densité du concentré
 *   masse d'alcool     = volume × (1 − concentration) × densité de l'alcool,
 *                        moins l'alcool déjà apporté par les flacons de stock prédilués
 *   grammes d'une note = part de la note × masse du concentré × 100 / dilution du stock
 * On prépare un peu plus de liquide que le flacon (marge_liquide_pct), car le mélange n'est pas
 * parfaitement additif en volume. Densités par défaut dans regles.json ; quand toutes les notes ont
 * un vrai lot avec sa densité mesurée, la densité du concentré en est déduite.
 */

const somme = t => t.reduce((s, v) => s + v, 0);
// Calcul au milligramme (balance au 0,01 g, on garde une décimale de plus).
const mg = g => Math.round(g * 1000) / 1000;

export function creerFabrication(d, moteur) {
  const R = d.regles, F = R.fabrication;
  const N = new Map(Object.values(d.notes.notes).map(n => [n.code, n]));
  const ORDRE = F.ordre_pesee || ["fond", "coeur", "tete"];

  // Densité du concentré : celle des vrais lots si on les a toutes, sinon la valeur par défaut.
  function densiteConcentre(formule) {
    const notes = Object.entries(formule.notes);
    const lots = notes.map(([code]) => moteur.lotDe(code));
    if (!lots.every(l => l && l.demo !== true && l.densite_g_ml > 0)) return F.densite_concentre_g_ml;
    // les doses sont des parts en masse : volume = Σ masse / densité
    return 1 / somme(notes.map(([, p], i) => p / 100 / lots[i].densite_g_ml));
  }

  /*
   * Fiche de pesée pour un volume (ml). marge : true = on prépare marge_liquide_pct % de plus.
   * Lignes dans l'ordre d'ajout : fond, cœur, tête (de la plus dosée à la moins dosée), puis alcool.
   */
  function grammes(formule, volume_ml, { marge = true } = {}) {
    const V = volume_ml * (marge ? 1 + (F.marge_liquide_pct || 0) / 100 : 1);
    const c = formule.concentration / 100;
    const dC = densiteConcentre(formule);
    const masseConc = V * c * dC;
    const lignes = Object.entries(formule.notes)
      .map(([code, p]) => {
        const n = N.get(code);
        const pur = (p / 100) * masseConc;
        const aPeser = (pur * 100) / n.dilution_stock;
        return {
          type: "note", code, nom: n.nom, etage: n.etage, dose_pct: p, dilution_stock: n.dilution_stock,
          pur_g: mg(pur), a_peser_g: mg(aPeser), alcool_apporte_g: aPeser - pur, lot: moteur.lotDe(code)?.lot || null,
        };
      })
      .sort((a, b) => ORDRE.indexOf(a.etage) - ORDRE.indexOf(b.etage) || b.dose_pct - a.dose_pct || (a.code < b.code ? -1 : 1));
    const alcoolStocks = somme(lignes.map(l => l.alcool_apporte_g));
    const masseAlcool = V * (1 - c) * F.densite_alcool_g_ml - alcoolStocks;
    for (const l of lignes) l.alcool_apporte_g = mg(l.alcool_apporte_g);
    lignes.push({ type: "alcool", code: "ALC", nom: "Alcool éthylique 96 % dénaturé", etage: null, dose_pct: null,
      pur_g: null, a_peser_g: mg(masseAlcool), alcool_apporte_g: 0, lot: null });
    return {
      volume_ml, volume_prepare_ml: mg(V), concentration: formule.concentration,
      densite_concentre_g_ml: Math.round(dC * 10000) / 10000,
      masse_concentre_g: mg(masseConc), masse_alcool_g: mg(V * (1 - c) * F.densite_alcool_g_ml),
      masse_totale_g: mg(somme(lignes.map(l => l.a_peser_g))),
      lignes,
    };
  }

  const VOLUMES = { "50": 50, "100": 100 };

  /*
   * Grammes de stock nécessaires pour une commande (par note), pour vérifier le stock.
   * format : "kit" (3 variantes, chacune en mini-lot de kit.lot_ml), "50" ou "100".
   */
  function besoins(formule, format, quantite = 1) {
    const fiches = format === "kit"
      ? moteur.variantesKit(formule).map(v => grammes(v.formule, R.kit.lot_ml, { marge: false }))
      : [grammes(formule, VOLUMES[format])];
    const res = {};
    for (const f of fiches) for (const l of f.lignes) if (l.type === "note") res[l.code] = mg((res[l.code] || 0) + l.a_peser_g * quantite);
    return res;
  }

  /*
   * Mini-lot d'essai d'une recette (§ B9) : une masse totale (10 g) à une concentration (18 %).
   * Même calcul que grammes(), mais à partir d'une masse et non d'un volume.
   */
  function grammesMasse(formule, masse_g) {
    const c = formule.concentration / 100;
    const masseConc = masse_g * c;
    const lignes = Object.entries(formule.notes).map(([code, p]) => {
      const n = N.get(code), pur = (p / 100) * masseConc, aPeser = (pur * 100) / n.dilution_stock;
      return { type: "note", code, nom: n.nom, etage: n.etage, dose_pct: p, dilution_stock: n.dilution_stock, pur_g: mg(pur), a_peser_g: mg(aPeser), alcool_apporte_g: aPeser - pur, lot: moteur.lotDe(code)?.lot || null };
    }).sort((a, b) => ORDRE.indexOf(a.etage) - ORDRE.indexOf(b.etage) || b.dose_pct - a.dose_pct || (a.code < b.code ? -1 : 1));
    const alcool = masse_g * (1 - c) - somme(lignes.map(l => l.alcool_apporte_g));
    for (const l of lignes) l.alcool_apporte_g = mg(l.alcool_apporte_g);
    lignes.push({ type: "alcool", code: "ALC", nom: "Alcool éthylique 96 % dénaturé", etage: null, dose_pct: null, pur_g: null, a_peser_g: mg(alcool), alcool_apporte_g: 0, lot: null });
    return { masse_totale_g: masse_g, concentration: formule.concentration, masse_concentre_g: mg(masseConc), lignes };
  }

  // Tolérance de pesée d'une ligne : ± tolerance_pesee_pct % ou ± tolerance_pesee_g grammes, la plus large.
  const tolerance = cible => Math.max((cible * (F.tolerance_pesee_pct ?? 2)) / 100, F.tolerance_pesee_g ?? 0.02);

  /*
   * Fiche de pesée d'une commande : une préparation par flacon (kit : un mini-lot par variante).
   * Chaque ligne a un identifiant « préparation:code » (ex. « 0:BER »), sa masse cible et sa tolérance.
   */
  function fichePesee(formule, format, quantite = 1) {
    const preparations = format === "kit"
      ? moteur.variantesKit(formule).map(v => ({ nom: `Variante « ${v.nom} » (mini-lot de ${R.kit.lot_ml} ml)`, formule: v.formule, fiche: grammes(v.formule, R.kit.lot_ml, { marge: false }) }))
      : Array.from({ length: quantite }, (_, i) => ({ nom: quantite > 1 ? `Flacon ${i + 1} sur ${quantite}` : `Flacon ${format} ml`, formule, fiche: grammes(formule, VOLUMES[format]) }));
    preparations.forEach((p, i) => { for (const l of p.fiche.lignes) { l.id = `${i}:${l.code}`; l.tolerance_g = mg(tolerance(l.a_peser_g)); } });
    return preparations;
  }

  /*
   * Compare les masses réellement pesées aux masses cibles. masses = { "0:BER": 4.31, … }.
   * Une ligne hors tolérance, ou pas pesée, bloque la validation.
   */
  function verifierPesee(preparations, masses = {}) {
    const lignes = [];
    for (const p of preparations) for (const l of p.fiche.lignes) {
      const reel = Number(masses[l.id]);
      const pesee = masses[l.id] !== undefined && masses[l.id] !== null && masses[l.id] !== "" && Number.isFinite(reel);
      const ecart = pesee ? mg(reel - l.a_peser_g) : null;
      lignes.push({ id: l.id, code: l.code, nom: l.nom, cible_g: l.a_peser_g, tolerance_g: l.tolerance_g, reel_g: pesee ? reel : null, ecart_g: ecart,
        ok: pesee && Math.abs(ecart) <= l.tolerance_g + 1e-9 });
    }
    return { ok: lignes.every(l => l.ok), lignes, hors_tolerance: lignes.filter(l => l.reel_g !== null && !l.ok).map(l => l.id), manquantes: lignes.filter(l => l.reel_g === null).map(l => l.id) };
  }

  /*
   * Étiquette (§ B14) : fonction, contenance, numéro de lot, ingrédients (alcool, parfum, puis allergènes
   * au-delà de 0,001 % du plus au moins présent), précautions, personne responsable, durée après ouverture.
   * `manque` liste ce qui empêche encore d'imprimer.
   */
  function etiquette(formule, { format = "100", numero_lot = null } = {}) {
    const E = R.etiquette || {};
    const allerg = moteur.allergenes(formule).a_etiqueter.map(a => a.inci);
    const ingredients = [E.inci_alcool, E.inci_parfum, ...allerg].join(", ");
    const manque = [];
    if (!E.responsable) manque.push("nom et adresse de la personne responsable (regles.json, etiquette.responsable)");
    if (!numero_lot) manque.push("numéro de lot de la commande");
    if (Object.keys(formule.notes).some(c => moteur.lotDe(c)?.demo === true)) manque.push("vrais lots fournisseurs (lots de démonstration : ne pas fabriquer)");
    if (!moteur.securite(formule).ok) manque.push("formule conforme aux règles de sécurité");
    return {
      fonction: E.fonction, contenance: format === "kit" ? `${R.kit.flacon_ml} ml` : `${VOLUMES[format]} ml`,
      numero_lot, ingredients, ingredients_sur_notice: format === "kit", precautions: E.precautions,
      duree_apres_ouverture: E.duree_apres_ouverture || null, responsable: E.responsable || null,
      marquage_colis: E.marquage_colis || "LQ", pret: manque.length === 0, manque,
    };
  }

  return { grammes, grammesMasse, besoins, densiteConcentre, fichePesee, verifierPesee, etiquette, tolerance, VOLUMES };
}
