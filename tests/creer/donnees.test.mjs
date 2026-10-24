// Fichiers de données V2 : forme, cohérence, et chiffres du cahier des charges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { controlerDonnees } from "../../src/creer/donnees.js";
import { donnees } from "./outils.mjs";

const d = donnees();
const N = Object.values(d.notes.notes);

test("les fichiers de données ne contiennent aucune erreur", () => {
  assert.deepEqual(controlerDonnees(d), []);
});

test("58 notes : 20 en vague 1, 21 en vague 2, 17 en vague 3", () => {
  assert.equal(N.length, 58);
  const parVague = v => N.filter(n => n.vague === v).length;
  assert.deepEqual([parVague(1), parVague(2), parVague(3)], [20, 21, 17]);
  // IRI passe en vague 2, FLO en vague 3
  assert.equal(d.notes.notes.iris.vague, 2);
  assert.equal(d.notes.notes.fleur_oranger.vague, 3);
});

test("notes prédiluées à 10 % : PAT, OUD, CUI (V1) + CAN, GIR, MEN, GAL, SAF, MAR, CON", () => {
  const predil = N.filter(n => n.dilution_stock === 10).map(n => n.code).sort();
  assert.deepEqual(predil, ["CAN", "CON", "CUI", "GAL", "GIR", "MAR", "MEN", "OUD", "PAT", "SAF"]);
});

test("schéma V1 gardé et champs V2 ajoutés sur chaque note", () => {
  const v1 = ["nom", "code", "etage", "puissance", "tenue_h", "dose_min", "dose_max", "dilution_stock", "cout_g", "stock_g", "actif", "texte", "famille"];
  const v2 = ["type", "vague", "sous_famille", "facettes", "tenacite", "lot_actif", "prix_classe", "dispo_chine"];
  for (const n of N) for (const k of [...v1, ...v2]) assert.ok(k in n, `${n.code} : ${k}`);
  assert.equal(d.notes.notes.musc_blanc.famille, "neutre");
});

test("matrice des sous-familles : 15 × 15, symétrique, entre -2 et +2", () => {
  const M = d.matrice_sf.matrice, sf = Object.keys(M);
  assert.equal(sf.length, 15);
  for (const a of sf) for (const b of sf) assert.equal(M[a][b], M[b][a], `${a}/${b}`);
  // une matrice non symétrique est signalée
  const d2 = donnees();
  d2.matrice_sf.matrice.hesp.gour = 1;
  assert.match(controlerDonnees(d2).join("\n"), /pas symétrique/);
});

test("22 facettes, 100 exceptions E001 à E100 (+ associations délicates de la V1), 12 structures, 36 recettes", () => {
  assert.equal(Object.keys(d.facettes.facettes).length, 22);
  const ids = d.exceptions.exceptions.map(e => e.id);
  for (let i = 1; i <= 100; i++) assert.ok(ids.includes(`E${String(i).padStart(3, "0")}`), `E${i}`);
  assert.ok(d.exceptions.exceptions.filter(e => Number(e.id.slice(1)) > 100).every(e => /V1/.test(e.raison)));
  assert.equal(d.exceptions.exceptions.filter(e => Number(e.id.slice(1)) <= 60).every(e => e.valeur > 0), true);
  assert.equal(d.exceptions.exceptions.filter(e => Number(e.id.slice(1)) > 60 && Number(e.id.slice(1)) <= 100).every(e => e.valeur < 0), true);
  assert.equal(Object.keys(d.structures.structures).length, 12);
  assert.equal(Object.keys(d.recettes.recettes).length, 36);
});

test("vague 1 = 13 recettes sur 11 structures (la structure poudré/iris attend la vague 2)", () => {
  const v1 = Object.entries(d.recettes.recettes).filter(([, r]) => r.vague === 1);
  assert.deepEqual(v1.map(([k]) => k), ["R01", "R02", "R04", "R07", "R10", "R13", "R16", "R19", "R22", "R25", "R26", "R31", "R34"]);
  const structures = new Set(v1.map(([, r]) => r.structure));
  assert.equal(structures.size, 11);
  assert.ok(!structures.has("S10"));
  // toutes à valider tant qu'Ethan ne les a pas essayées
  assert.ok(Object.values(d.recettes.recettes).every(r => r.statut === "a_valider"));
});

test("81 allergènes de l'annexe III, seuil 0,001 % ; limites IFRA du cahier présentes", () => {
  assert.equal(d.allergenes.allergenes.length, 81);
  assert.equal(d.allergenes.seuil_sans_rincage_pct, 0.001);
  const L = d.ifra_cat4.substances;
  assert.equal(d.ifra_cat4.amendement, 51);
  const attendu = { citral: 0.6, coumarine: 1.5, eugenol: 2.5, isoeugenol: 0.11, cinnamal: 0.25, hydroxycitronellal: 2.1, geraniol: 4.7,
    methyl_2_octynoate: 0.047, mousse_de_chene: 0.1, benzyl_salicylate: 7.3, huile_bergamote_exprimee: 0.4, methyl_ionone: 30 };
  for (const [s, v] of Object.entries(attendu)) assert.equal(L[s].limite_pct, v, s);
});

test("interrupteurs : outil caché, vente bloquée, mode démonstration, vague 1 seule", () => {
  assert.equal(d.boutique.publie, false);
  assert.equal(d.boutique.vente_active, false);
  assert.equal(d.features.mode_demo, true);
  assert.deepEqual(d.features.vagues_actives, [1]);
  assert.equal(d.cadre_securite.version, null);
});

test("lots de démonstration : un par note, marqués DEMO, 4 documents", () => {
  const lots = d.matieres_lots.lots;
  assert.equal(lots.length, 58);
  for (const l of lots) {
    assert.ok(l.demo === true && l.lot.startsWith("DEMO"), l.lot);
    assert.ok(Object.values(l.docs).every(Boolean));
  }
  assert.ok(N.every(n => n.lot_actif === null), "aucun vrai lot pour l'instant");
});

test("erreurs de saisie courantes : chacune est signalée en clair", () => {
  const cas = [
    [d2 => { d2.notes.notes.bergamote.sous_famille = "agrume"; }, /sous-famille inconnue/],
    [d2 => { d2.notes.notes.bergamote.famille = "boise"; }, /famille « boise » différente/],
    [d2 => { d2.notes.notes.rose.code = "BER"; }, /déjà pris/],
    [d2 => { d2.notes.notes.rose.facettes.florale = 1; }, /facette inconnue/],
    [d2 => { d2.recettes.recettes.R01.notes.BER = 26; }, /total des doses/],
    [d2 => { d2.recettes.recettes.R01.notes.BER = 24.3; d2.recettes.recettes.R01.notes.CIT = 15.7; }, /multiple de 0.5/],
    [d2 => { d2.recettes.recettes.R01.vague = 2; }, /vague 2 indiquée/],
    [d2 => { delete d2.recettes.recettes.R34.notes.MUS; d2.recettes.recettes.R34.notes.CAC = 55; }, /S12 demande MUS \(au moins 30 %\)/],
    [d2 => { d2.exceptions.exceptions.push({ id: "E200", a: "ROS", b: "OUD", valeur: 1, raison: "doublon" }); }, /déjà notée par E001/],
    [d2 => { d2.matieres_lots.lots[0].allergenes_pct.lilial = 1; }, /allergène « lilial » absent/],
    [d2 => { d2.matieres_lots.lots[0].substances_ifra_pct.safrole = 1; }, /substance « safrole » absente/],
    [d2 => { d2.notes.notes.tonka.lot_actif = "TON-9999"; }, /lot_actif « TON-9999 » absent/],
    [d2 => { d2.boutique.vente_active = true; }, /mode démonstration est actif/],
    [d2 => { d2.boutique.vente_active = true; }, /sans cadre de sécurité signé/],
    [d2 => { d2.boutique.vente_active = true; }, /sans transporteur choisi/],
    [d2 => { d2.boutique.transporteur = "Colissimo"; }, /La Poste et Colissimo refusent/],
    [d2 => { d2.cadre_securite.notes = { BER: { pmax: 30 } }; }, /version du rapport manque/],
    [d2 => { d2.regles.harmonie.commande.deconseille.P2 = "oui"; }, /jamais être commandable dans les portes P1 à P4/],
    [d2 => { d2.features.vagues_actives = [4]; }, /vagues_actives/],
  ];
  for (const [modifier, attendu] of cas) {
    const d2 = donnees();
    modifier(d2);
    assert.match(controlerDonnees(d2).join("\n"), attendu);
  }
});
