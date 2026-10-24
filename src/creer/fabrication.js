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

  return { grammes, besoins, densiteConcentre, VOLUMES };
}
