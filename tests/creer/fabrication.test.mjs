// Calculateur en grammes, code de formule, allergènes et fiche de la page privée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerFabrication } from "../../src/creer/fabrication.js";
import { donnees, moteur, hasard, somme } from "./outils.mjs";

const atelier = (d = donnees()) => creerFabrication(d);
const mg = g => Math.round(g * 1000);
const totalPese = fiche => somme(fiche.lignes.map(l => mg(l.a_peser_g)));
const R01 = () => ({ mode: "guide", recette: "R01", concentration: 18, notes: { ...donnees().recettes.recettes.R01.notes } });

test("exemple du cahier : 50 ml à 18 % = environ 41 g, 7,4 g d'huiles, une note à 4 % = 0,30 g", () => {
  const f = { mode: "expert", concentration: 18, notes: { bergamote: 20, rose: 25, jasmin: 15, musc_blanc: 16, santal: 20, vanille: 4 } };
  const fiche = atelier().grammes(f, 50);
  assert.equal(fiche.masse_totale_g, 41);
  assert.equal(fiche.masse_huiles_g, 7.38);
  assert.equal(fiche.lignes.find(l => l.id === "vanille").a_peser_g, 0.295);
});

test("la somme des pesées fait exactement la masse totale, au milligramme près", () => {
  const fiche = atelier().grammes(R01(), 100);
  assert.equal(totalPese(fiche), mg(fiche.masse_totale_g));
  assert.equal(fiche.masse_totale_g, 82);
});

test("ordre de pesée : fond, puis cœur, puis tête, et l'alcool en dernier", () => {
  const d = donnees();
  const fiche = atelier(d).grammes(R01(), 100);
  const etages = fiche.lignes.filter(l => l.type === "note").map(l => l.etage);
  assert.deepEqual(etages, ["fond", "fond", "coeur", "tete", "tete"]);
  assert.equal(fiche.lignes.at(-1).type, "alcool");
});

test("notes prédiluées à 10 % : on pèse 10 fois plus, et l'alcool ajouté baisse d'autant", () => {
  const d = donnees();
  const f = { mode: "guide", recette: "R10", concentration: 18, notes: { ...d.recettes.recettes.R10.notes } };
  const fiche = atelier(d).grammes(f, 100);
  const cuir = fiche.lignes.find(l => l.id === "cuir");
  assert.equal(cuir.huile_g, 0.738); // 82 g × 18 % × 5 %
  assert.equal(cuir.a_peser_g, 7.38);
  assert.match(cuir.remarque, /dilué à 10 %/);
  // alcool ajouté + alcool déjà présent dans le cuir dilué = masse totale − huiles pures
  const alcoolAjoute = mg(fiche.lignes.at(-1).a_peser_g);
  const alcoolDuCuir = mg(cuir.a_peser_g) - mg(cuir.huile_g);
  const huilesPures = somme(fiche.lignes.map(l => mg(l.huile_g)));
  assert.ok(Math.abs(alcoolAjoute + alcoolDuCuir - (mg(82) - huilesPures)) <= 3, "alcool"); // quelques mg d'arrondi
});

test("1 000 formules au hasard : grammes justes en 50 et 100 ml", () => {
  const d = donnees(), m = moteur(d), a = atelier(d), N = d.notes.notes, ids = Object.keys(N);
  const alea = hasard(1000);
  let n = 0;
  while (n < 1000) {
    const choix = [...ids].sort(() => alea() - 0.5).slice(0, 4 + Math.floor(alea() * 4));
    const res = m.ajuster({ mode: "expert", concentration: 15 + Math.floor(alea() * 11) / 2, notes: Object.fromEntries(choix.map(id => [id, 1 + Math.round(alea() * 30)])) });
    if (!res.ok) continue;
    n++;
    for (const volume of [50, 100]) {
      const f = res.formule, fiche = a.grammes(f, volume);
      const masse = volume * d.regles.densite_g_ml, huiles = masse * f.concentration / 100;
      assert.equal(totalPese(fiche), mg(masse), "total");
      for (const l of fiche.lignes.filter(x => x.type === "note")) {
        const attendu = huiles * f.notes[l.id] / 100;
        // arrondi au milligramme : 0,0005 g d'écart au plus
        assert.ok(Math.abs(l.huile_g - attendu) <= 0.0005 + 1e-9, `${l.id} : ${l.huile_g} g au lieu de ${attendu}`);
        assert.ok(Math.abs(l.a_peser_g - attendu * 100 / N[l.id].dilution_stock) <= 0.0005 + 1e-9, `${l.id} à peser`);
      }
      assert.equal(fiche.lignes.filter(x => x.type === "note").length, Object.keys(f.notes).length);
      assert.ok(fiche.lignes.at(-1).a_peser_g > 0, "alcool positif");
      // l'huile pure fait bien la concentration voulue
      const pur = somme(fiche.lignes.map(l => l.huile_g));
      assert.ok(Math.abs(pur / masse * 100 - f.concentration) < 0.01, "concentration");
    }
  }
});

test("le 100 ml pèse le double du 50 ml", () => {
  const a = atelier();
  const p50 = a.grammes(R01(), 50), p100 = a.grammes(R01(), 100);
  p50.lignes.forEach((l, i) => assert.ok(Math.abs(p100.lignes[i].a_peser_g - 2 * l.a_peser_g) <= 0.002, l.nom));
});

test("mélange déjà reposé : une recette inchangée = le mélange + l'alcool, rien d'autre", () => {
  const fiche = atelier().grammes(R01(), 100, { melangePrepare: true });
  assert.deepEqual(fiche.lignes.map(l => l.type), ["melange", "alcool"]);
  assert.equal(fiche.melange.huile_g, 14.76);
  assert.equal(totalPese(fiche), mg(82));
});

test("mélange déjà reposé : les réglages du client deviennent des compléments", () => {
  const d = donnees(), a = atelier(d), m = moteur(d);
  const res = m.ajuster({ mode: "guide", recette: "R01", notes: { ...d.recettes.recettes.R01.notes, bergamote: 27, santal: 6 } });
  assert.ok(res.ok, res.erreurs.map(e => e.message).join(" / "));
  const direct = a.grammes(res.formule, 100), avecMelange = a.grammes(res.formule, 100, { melangePrepare: true });
  assert.equal(avecMelange.lignes[0].type, "melange");
  assert.ok(avecMelange.lignes.some(l => l.id === "santal" && /complément/.test(l.remarque)));
  // même parfum au final : chaque huile pure, mélange compris, retombe sur le calcul direct
  const r = d.recettes.recettes.R01.notes, base = avecMelange.melange.huile_g;
  for (const l of direct.lignes.filter(x => x.type === "note")) {
    const complement = avecMelange.lignes.find(x => x.id === l.id)?.huile_g ?? 0;
    const total = (r[l.id] ? base * r[l.id] / 100 : 0) + complement;
    assert.ok(Math.abs(total - l.huile_g) <= 0.002, `${l.id} : ${total} au lieu de ${l.huile_g}`);
  }
  assert.equal(totalPese(avecMelange), mg(82));
});

test("préparer un lot de mélange de recette à l'avance", () => {
  const lot = atelier().ficheMelange("R10", 50);
  assert.ok(lot.ok);
  assert.equal(lot.lignes.find(l => l.id === "cuir").a_peser_g, 25); // 5 % de 50 g, dilué à 10 %
  assert.equal(lot.total_g, 47.5 + 25);
  assert.equal(atelier().ficheMelange("R99", 50).ok, false);
  assert.equal(atelier().ficheMelange("R01", -3).ok, false);
});

test("code de formule : même forme que l'exemple du cahier", () => {
  const code = atelier().encoder(R01(), 100);
  assert.equal(code, "R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V100");
});

test("code de formule : accepté par un lien de paiement Stripe (lettres, chiffres, - et _, 200 caractères au plus)", () => {
  const d = donnees(), m = moteur(d), a = atelier(d), alea = hasard(9);
  for (let k = 0; k < 300; k++) {
    const res = m.proposer(Object.keys(d.notes.notes).sort(() => alea() - 0.5).slice(0, 7), { concentration: 15 + Math.floor(alea() * 11) / 2 });
    if (!res.ok) continue;
    const code = a.encoder(res.formule, 100);
    assert.match(code, /^[A-Za-z0-9_-]{1,200}$/, code);
  }
});

test("code de formule : on retrouve exactement la même formule (toutes les recettes, 1 000 formules au hasard)", () => {
  const d = donnees(), m = moteur(d), a = atelier(d), alea = hasard(77);
  const formules = Object.keys(d.recettes.recettes).map(id => ({ mode: "guide", recette: id, concentration: d.recettes.recettes[id].concentration, notes: d.recettes.recettes[id].notes }));
  while (formules.length < 1010) {
    const res = m.ajuster({ mode: "expert", concentration: 15 + Math.floor(alea() * 11) / 2,
      notes: Object.fromEntries(Object.keys(d.notes.notes).sort(() => alea() - 0.5).slice(0, 4 + Math.floor(alea() * 4)).map(id => [id, 1 + Math.round(alea() * 30)])) });
    if (res.ok) formules.push(res.formule);
  }
  for (const f of formules)
    for (const volume of [50, 100]) {
      const code = a.encoder(f, volume), lu = a.decoder(code);
      assert.ok(lu.ok, code);
      assert.deepEqual(lu.formule.notes, f.notes, code);
      assert.equal(lu.formule.concentration, f.concentration, code);
      assert.equal(lu.volume, volume);
      assert.equal(lu.formule.mode, f.mode);
      // relu, le code repasse toutes les règles
      assert.ok(m.verifier(lu.formule).ok, code);
    }
});

test("code de formule : une concentration à virgule s'écrit avec _", () => {
  const a = atelier(), f = { ...R01(), concentration: 17.5 };
  const code = a.encoder(f, 50);
  assert.equal(code, "R01-BER22-MAN18-FLO25-MUS20-CED15-C17_5-V50");
  assert.equal(a.decoder(code).formule.concentration, 17.5);
});

test("code de formule : copier-coller imparfait toléré (espaces, minuscules)", () => {
  const lu = atelier().decoder("  r01-ber22-man18-flo25-mus20-ced15-c18-v100\n");
  assert.ok(lu.ok);
  assert.equal(lu.formule.notes.bergamote, 22);
});

test("code de formule abîmé : message simple, jamais d'erreur technique", () => {
  const a = atelier();
  const cas = {
    "": /Colle un code/,
    "R01-BER22-C18-V100 ; DROP": /caractères inattendus/,
    "Z01-BER22-C18-V100": /commencer par une recette/,
    "R77-BER22-C18-V100": /R77 n'existe pas/,
    "R01-XYZ22-MAN18-FLO25-MUS20-CED15-C18-V100": /Note inconnue dans le code : XYZ/,
    "R01-BER22-BER18-FLO25-MUS20-CED15-C18-V100": /apparaît deux fois/,
    "R01-BER22-MAN18-FLO25-MUS20-CED15-V100": /Il manque la concentration/,
    "R01-BER22-MAN18-FLO25-MUS20-CED15-C18": /Il manque le volume/,
    "R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V30": /30 ml n'est pas vendu/,
    "R01-BER-MAN18-C18-V100": /Morceau illisible/,
    "EX-C18-V100": /aucune note/,
  };
  for (const [code, attendu] of Object.entries(cas)) {
    const lu = a.decoder(code);
    assert.equal(lu.ok, false, code);
    assert.match(lu.erreurs.map(e => e.message).join(" "), attendu, code);
  }
});

test("page de fabrication : un code valide donne la fiche complète", () => {
  const res = atelier().preparerFiche("R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V100");
  assert.ok(res.ok, res.erreurs.map(e => e.message).join(" / "));
  assert.equal(res.recette, "Agrumes et fleur d'oranger");
  assert.equal(res.fiche.volume_ml, 100);
  assert.equal(totalPese(res.fiche), mg(82));
  assert.equal(res.allergenes.complet, false); // listes fournisseurs pas encore reçues
  assert.equal(res.allergenes.manquants.length, 5);
});

test("page de fabrication : un code qui ne respecte plus les règles est refusé (ne pas fabriquer)", () => {
  const a = atelier();
  // bergamote à 40 % : au-dessus de sa limite IFRA et de la marge de la recette
  const res = a.preparerFiche("R01-BER40-MAN10-FLO15-MUS20-CED15-C18-V100");
  assert.equal(res.ok, false);
  assert.ok(res.erreurs.some(e => e.code === "ifra"));
  // total différent de 100 % (faute de frappe)
  assert.ok(a.preparerFiche("R01-BER23-MAN18-FLO25-MUS20-CED15-C18-V100").erreurs.some(e => e.code === "total"));
  // une règle durcie après la commande : la fiche est refusée
  const d = donnees();
  d.notes.notes.bergamote.ifra_max = 3;
  assert.equal(atelier(d).preparerFiche("R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V100").ok, false);
});

test("allergènes : additionnés sur toute la formule, imprimés dès 0,001 % du parfum", () => {
  const d = donnees();
  for (const n of Object.values(d.notes.notes)) n.allergenes = {};
  d.notes.notes.bergamote.allergenes = { Limonene: 30, Linalool: 10 };
  d.notes.notes.fleur_oranger.allergenes = { Linalool: 20, Geraniol: 0.001 };
  const al = atelier(d).allergenes(R01());
  assert.equal(al.complet, true);
  // Linalool : 22 % × 18 % × 10 % + 25 % × 18 % × 20 % = 0,396 + 0,9 = 1,296 %
  assert.equal(al.detail.find(x => x.nom === "Linalool").pct_parfum, 1.296);
  assert.equal(al.detail.find(x => x.nom === "Limonene").pct_parfum, 1.188);
  // Geraniol : 25 % × 18 % × 0,001 % = 0,000045 %, sous le seuil
  assert.deepEqual(al.a_declarer, ["Linalool", "Limonene"]);
});
