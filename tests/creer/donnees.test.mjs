// Les fichiers de données sont-ils bien remplis et cohérents ?
import { test } from "node:test";
import assert from "node:assert/strict";
import { controlerDonnees } from "../../src/creer/donnees.js";
import { donnees, moteur } from "./outils.mjs";

test("les quatre fichiers de données sont valides", () => {
  assert.deepEqual(controlerDonnees(donnees()), []);
});

test("la palette de départ compte 18 notes actives", () => {
  const notes = Object.values(donnees().notes.notes).filter(n => n.actif);
  assert.equal(notes.length, 18);
});

test("il y a 8 à 12 recettes de départ, au moins 2 par grande famille", () => {
  const recettes = Object.values(donnees().recettes.recettes);
  assert.ok(recettes.length >= 8 && recettes.length <= 12, `${recettes.length} recettes`);
  for (const famille of ["frais", "floral", "boise", "ambre"])
    assert.ok(recettes.filter(r => r.famille === famille).length >= 2, `famille ${famille}`);
});

test("chaque recette passe toutes les règles telle quelle, sans correction", () => {
  const d = donnees(), m = moteur(d);
  for (const [id, r] of Object.entries(d.recettes.recettes)) {
    const res = m.ajuster({ mode: "guide", recette: id, notes: r.notes });
    assert.ok(res.ok, `${id} refusée : ${res.erreurs.map(e => e.message).join(" / ")}`);
    assert.deepEqual(res.formule.notes, r.notes, `${id} modifiée`);
    assert.deepEqual(res.corrections, [], `${id} corrigée`);
    assert.deepEqual(res.avertissements, [], `${id} contient une association délicate`);
  }
});

test("chaque recette reste valable sur toute la plage de concentration", () => {
  const d = donnees(), m = moteur(d);
  const { min, max } = d.regles.concentration;
  for (const [id, r] of Object.entries(d.recettes.recettes))
    for (let c = min; c <= max; c += 0.5) {
      const res = m.ajuster({ mode: "guide", recette: id, concentration: c, notes: r.notes });
      assert.ok(res.ok, `${id} à ${c} % : ${res.erreurs.map(e => e.message).join(" / ")}`);
    }
});

test("le contrôle repère les erreurs de frappe courantes", () => {
  const d = donnees();
  d.notes.notes.rose.code = "BER"; // code déjà pris
  d.notes.notes.iris.etage = "milieu";
  d.notes.notes.oud.dose_min = 9; // au-dessus de son maximum
  d.compatibilite.accords.push(["rose", "lilas"]); // note inconnue
  d.compatibilite.risquees.push(["rose", "jasmin"]); // déjà dans les accords
  d.recettes.recettes.R01.notes.bergamote = 30; // total à 108
  const pb = controlerDonnees(d).join("\n");
  for (const attendu of ["code BER est déjà pris", "iris : etage", "oud : doses incohérentes",
    "note inconnue « lilas »", "association déjà notée", "R01 : le total des doses fait 108"])
    assert.ok(pb.includes(attendu), `non repéré : ${attendu}\n${pb}`);
});

test("ajouter une note = ajouter des lignes de données, sans toucher au code", () => {
  const d = donnees();
  d.notes.notes.cardamome = {
    nom: "Cardamome", code: "CAR", etage: "tete", famille: "frais",
    puissance: 3, tenue_h: 2, dose_min: 2, dose_max: 10,
    ifra_max: 5, ifra_certificat: null, allergenes: null,
    dilution_stock: 100, cout_g: null, stock_g: null, actif: true,
    texte: "Épice fraîche et citronnée.",
  };
  d.compatibilite.accords.push(["cardamome", "bergamote"], ["cardamome", "cedre"]);
  assert.deepEqual(controlerDonnees(d), []);
  const res = moteur(d).ajuster({ mode: "expert", notes: { bergamote: 20, cardamome: 8, rose: 20, iris: 8, cedre: 24, musc_blanc: 20 } });
  assert.ok(res.ok, res.erreurs.map(e => e.message).join(" / "));
  assert.ok(res.formule.notes.cardamome > 0);
});
