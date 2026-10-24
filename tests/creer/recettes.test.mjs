// Les 36 recettes : harmonie d'au moins 70 et conformes à 15, 18 et 20 % (avec les lots de démonstration).
import { test } from "node:test";
import assert from "node:assert/strict";
import { donnees, moteur } from "./outils.mjs";

const d = donnees({ toutesVagues: true });
const m = moteur(d);
const REC = d.recettes.recettes;

test("les 36 recettes obtiennent une harmonie d'au moins 70 (« Bon »)", () => {
  const faibles = [];
  for (const [code, r] of Object.entries(REC)) {
    const h = m.harmonie({ concentration: 18, notes: r.notes });
    if (h.score < 70 || h.libelle !== "bon") faibles.push(`${code} : ${h.score} (${h.libelle})`);
  }
  assert.deepEqual(faibles, [], "Si une recette passe sous 70 : recalibrer les poids de regles.json, pas les recettes.");
});

test("les 36 recettes passent toutes les règles de sécurité à 15, 18 et 20 %", () => {
  for (const [code, r] of Object.entries(REC))
    for (const c of [15, 18, 20]) {
      const s = m.securite({ concentration: c, notes: r.notes });
      assert.ok(s.ok, `${code} à ${c} % : ${s.erreurs.map(e => e.message).join(" / ")}`);
    }
});

test("les 36 recettes sont commandables par toutes les portes, et leurs 3 variantes de kit aussi", () => {
  for (const [code, r] of Object.entries(REC)) {
    for (const porte of ["P1", "P2", "P3", "P4", "P5"])
      assert.equal(m.evaluer({ concentration: 18, notes: r.notes }, { porte }).commande, "oui", `${code} ${porte}`);
    assert.ok(m.variantesKit({ concentration: 18, notes: r.notes }).every(v => v.ok), code);
  }
});

test("avec la vague 1 seule : les 13 recettes de la vague 1 sont faisables, les autres non", () => {
  const m1 = moteur(donnees());
  const faisables = Object.entries(REC).filter(([, r]) => m1.securite({ concentration: 18, notes: r.notes }).ok).map(([k]) => k);
  assert.deepEqual(faisables, Object.entries(REC).filter(([, r]) => r.vague === 1).map(([k]) => k));
});

test("chaque recette contient au moins une note de chaque groupe obligatoire de sa structure", () => {
  for (const [code, r] of Object.entries(REC)) {
    const st = d.structures.structures[r.structure];
    for (const g of st.obligatoires)
      assert.ok(g.notes.some(n => (r.notes[n] || 0) > 0 && (r.notes[n] || 0) >= (g.min_pct || 0)), `${code} : ${g.notes.join(" ou ")}`);
  }
});

test("exemple du cahier : R01 à 18 %, allergènes étiquetés du plus au moins présent", () => {
  const a = m.allergenes({ concentration: 18, notes: REC.R01.notes });
  assert.ok(a.a_etiqueter.length > 0);
  assert.equal(a.a_etiqueter[0].inci, "LIMONENE");
  assert.ok(a.a_etiqueter.every(x => x.pct_produit > 0.001));
});
