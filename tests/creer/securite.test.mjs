// Règles de sécurité V2 (§ B5) : toutes bloquantes, décidées par le moteur seul.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerMoteur, MOTEUR_VERSION } from "../../src/creer/moteur.js";
import { donnees, moteur, avecLot } from "./outils.mjs";

const f = (notes, concentration = 18) => ({ concentration, notes });
const codes = r => r.erreurs.map(e => e.code);

// Données sans mode démonstration : seules les notes à qui on donne un vrai lot existent.
function sansDemo(lots = {}) {
  const d = donnees({ toutesVagues: true });
  d.features.mode_demo = false;
  for (const [code, extra] of Object.entries(lots)) avecLot(d, code, extra);
  return d;
}

test("règle 1 : sans cadre signé, le maximum de chaque note est sa dose_max ; concentration 15 à 20 % ; 3 à 12 notes", () => {
  const m = moteur(donnees({ toutesVagues: true }));
  assert.equal(m.cadre(), null);
  assert.ok(m.securite(f({ BER: 35, ROS: 25, MUS: 40 })).ok);
  assert.ok(codes(m.securite(f({ BER: 36, ROS: 24, MUS: 40 }))).includes("cadre"));
  assert.ok(codes(m.securite(f({ BER: 35, ROS: 25, MUS: 40 }, 21))).includes("concentration"));
  assert.ok(codes(m.securite(f({ BER: 35, ROS: 25, MUS: 40 }, 14))).includes("concentration"));
  assert.ok(codes(m.securite(f({ BER: 35, ROS: 25, MUS: 40 }, 17.5))).includes("concentration"), "concentration au pas de 1 %");
  assert.ok(codes(m.securite(f({ BER: 50, MUS: 50 }))).includes("nombre_notes"));
});

test("règle 1 : avec un cadre signé, seules ses notes existent, avec ses maximums et sa plage de concentration", () => {
  const d = donnees({ toutesVagues: true });
  d.cadre_securite = { version: "C1", date: "2027-01-15", signataire: "Évaluateur test", concentration: { min: 15, max: 18 },
    nombre_notes: { min: 3, max: 10 }, notes: { BER: { pmax: 20 }, ROS: { pmax: 30 }, MUS: { pmax: 45 }, CED: { pmax: 30 } }, allergenes_total_max_pct: null };
  const m = creerMoteur(d);
  assert.deepEqual(m.notesDisponibles().map(n => n.code).sort(), ["BER", "CED", "MUS", "ROS"]);
  assert.equal(m.disponibilite("JAS").raison, "note absente du cadre de sécurité signé");
  assert.ok(m.securite(f({ BER: 20, ROS: 30, MUS: 40, CED: 10 })).ok);
  assert.ok(codes(m.securite(f({ BER: 25, ROS: 25, MUS: 40, CED: 10 }))).includes("cadre"), "BER 25 > pmax 20 (même si dose_max vaut 35)");
  assert.ok(codes(m.securite(f({ BER: 20, ROS: 30, MUS: 40, CED: 10 }, 19))).includes("concentration"));
  assert.ok(codes(m.securite(f({ BER: 20, ROS: 30, JAS: 10, MUS: 40 }))).includes("note_indisponible"));
  assert.equal(m.securite(f({ BER: 20, ROS: 30, MUS: 40, CED: 10 })).versions.cadre_version, "C1");
});

test("règle 2 : maximum IFRA de l'huile, lu sur le certificat du lot (10 % du parfum = 55,5 % du concentré à 18 %)", () => {
  const d = sansDemo({ MUS: { ifra_cat4_max_pct_produit: 10 }, BER: { fcf: true }, ROS: {} });
  d.cadre_securite = { version: "T", date: "2027-01-01", signataire: "t", concentration: { min: 15, max: 20 }, nombre_notes: { min: 3, max: 12 },
    notes: { MUS: { pmax: 80 }, BER: { pmax: 50 }, ROS: { pmax: 50 } }, allergenes_total_max_pct: null };
  const m = creerMoteur(d);
  assert.ok(m.securite(f({ MUS: 55.5, BER: 22.5, ROS: 22 })).ok);
  const r = m.securite(f({ MUS: 56, BER: 22, ROS: 22 }));
  assert.deepEqual(codes(r), ["ifra_lot"]);
  assert.match(r.erreurs[0].message, /55,556 % du concentré au maximum à 18 %/);
});

test("règle 3 : cumul d'une substance sur toutes les notes (tonka à 40 % de coumarine)", () => {
  const d = sansDemo({ TON: { substances_ifra_pct: { coumarine: 40 } }, BER: { fcf: true }, MUS: {}, LAV: { substances_ifra_pct: { coumarine: 0.5 } } });
  d.cadre_securite = { version: "T", date: "2027-01-01", signataire: "t", concentration: { min: 15, max: 20 }, nombre_notes: { min: 3, max: 12 },
    notes: { TON: { pmax: 40 }, BER: { pmax: 50 }, MUS: { pmax: 60 }, LAV: { pmax: 40 } }, allergenes_total_max_pct: null };
  const m = creerMoteur(d);
  // 15 % de tonka dans un concentré à 20 % = 1,2 % de coumarine : autorisé (limite 1,5 %)
  assert.ok(m.securite(f({ TON: 15, BER: 35, MUS: 50 }, 20)).ok);
  // 25 % = 2,0 % : bloqué
  const r = m.securite(f({ TON: 25, BER: 25, MUS: 50 }, 20));
  assert.deepEqual(codes(r), ["substance"]);
  assert.ok(Math.abs(r.erreurs[0].valeur - 2) < 1e-9);
  // 18 % de tonka (1,44 %) + 20 % de lavande à 0,5 % (0,02 %) = 1,46 % : passe ; avec 30 % de lavande à 3 % : bloqué
  assert.ok(m.securite(f({ TON: 18, LAV: 20, BER: 12, MUS: 50 }, 20)).ok);
  d.matieres_lots.lots.find(l => l.lot === "LAV-2026-01").substances_ifra_pct.coumarine = 3;
  assert.ok(codes(creerMoteur(d).securite(f({ TON: 18, LAV: 30, BER: 2, MUS: 50 }, 20))).includes("substance"));
});

test("règle 4 : mousse de chêne seulement avec un certificat atranol et chloroatranol sous 100 ppm", () => {
  const base = { substances_ifra_pct: { mousse_de_chene: 3 } };
  for (const [ppm, ok] of [[50, true], [99, true], [100, false], [[40, 120], false], [null, false], [undefined, false]]) {
    const d = sansDemo({ MOU: { ...base, atranol_chloroatranol_ppm: ppm } });
    assert.equal(creerMoteur(d).disponibilite("MOU").ok, ok, String(ppm));
  }
});

test("règle 5 : bergamote FCF obligatoire, sinon 0,4 % du parfum fini au maximum", () => {
  const nonFcf = creerMoteur(sansDemo({ BER: { fcf: false }, ROS: {}, CED: {}, MUS: {} }));
  assert.ok(nonFcf.securite(f({ BER: 2, ROS: 35, CED: 18, MUS: 45 }, 20)).ok, "2 % × 20 % = 0,4 %");
  const r = nonFcf.securite(f({ BER: 2.5, ROS: 35, CED: 17.5, MUS: 45 }, 20));
  assert.deepEqual(codes(r), ["bergamote"]);
  assert.match(r.erreurs[0].message, /sans furocoumarines/);
  const fcf = creerMoteur(sansDemo({ BER: { fcf: true }, ROS: {}, MUS: {} }));
  assert.ok(fcf.securite(f({ BER: 30, ROS: 30, MUS: 40 }, 20)).ok);
  const inconnu = creerMoteur(sansDemo({ BER: {}, ROS: {}, MUS: {} }));
  assert.ok(!inconnu.securite(f({ BER: 30, ROS: 30, MUS: 40 }, 20)).ok, "FCF non déclaré = non FCF");
});

test("règle 6 : un allergène s'étiquette si et seulement s'il dépasse 0,001 % du parfum fini", () => {
  const m = creerMoteur(sansDemo({ BER: { fcf: true, allergenes_pct: { limonene: 0.025 } }, ROS: { allergenes_pct: { geraniol: 0.02 } }, MUS: {} }));
  // limonène : 20 % × 20 % × 0,025 % = 0,001 % pile → pas étiqueté ; géraniol : 30 % × 20 % × 0,02 % = 0,0012 % → étiqueté
  const a = m.allergenes(f({ BER: 20, ROS: 30, MUS: 50 }, 20));
  assert.deepEqual(a.a_etiqueter.map(x => x.inci), ["GERANIOL"]);
  assert.ok(Math.abs(a.liste.find(x => x.id === "limonene").pct_produit - 0.001) < 1e-12);
  // tri du plus au moins présent
  const m2 = moteur(donnees());
  const liste = m2.allergenes(f(donnees().recettes.recettes.R01.notes)).a_etiqueter.map(x => x.pct_produit);
  assert.deepEqual(liste, [...liste].sort((x, y) => y - x));
});

test("règle 7 : cumul des allergènes plafonné par le cadre signé", () => {
  const d = sansDemo({ BER: { fcf: true, allergenes_pct: { limonene: 40 } }, ROS: { allergenes_pct: { geraniol: 10 } }, MUS: {} });
  d.cadre_securite = { version: "T", date: "2027-01-01", signataire: "t", concentration: { min: 15, max: 20 }, nombre_notes: { min: 3, max: 12 },
    notes: { BER: { pmax: 50 }, ROS: { pmax: 50 }, MUS: { pmax: 60 } }, allergenes_total_max_pct: 2 };
  const m = creerMoteur(d);
  // 20 % × 20 % × 40 % = 1,6 % + 20 % × 20 % × 10 % = 0,4 % → 2,0 % : autorisé ; un peu plus : bloqué
  assert.ok(m.securite(f({ BER: 20, ROS: 20, MUS: 60 }, 20)).ok);
  assert.deepEqual(codes(m.securite(f({ BER: 21, ROS: 20, MUS: 59 }, 20))), ["allergenes_total"]);
});

test("règle 8 : d'une fourchette déclarée, on garde la borne haute", () => {
  const m = creerMoteur(sansDemo({ TON: { substances_ifra_pct: { coumarine: [20, 40] }, allergenes_pct: { coumarin: [20, 40] } }, BER: { fcf: true }, MUS: {} }));
  const r = m.securite(f({ TON: 20, BER: 30, MUS: 50 }, 20));
  assert.ok(codes(r).includes("substance"), "20 % × 20 % × 40 % = 1,6 % > 1,5 %");
  assert.ok(Math.abs(m.allergenes(f({ TON: 20, BER: 30, MUS: 50 }, 20)).liste[0].pct_produit - 1.6) < 1e-9);
});

test("règle 9 : la formule garde les versions (moteur, amendement IFRA, cadre)", () => {
  const r = moteur(donnees()).securite(f(donnees().recettes.recettes.R01.notes));
  assert.deepEqual(r.versions, { moteur_version: MOTEUR_VERSION, ifra_amendement: 51, cadre_version: null });
  // le 52e amendement : il suffit de changer ifra_cat4.json ; un lot certifié au 51e ne suffit plus
  const d = donnees();
  d.ifra_cat4.amendement = 52;
  const m = creerMoteur(d);
  assert.equal(m.disponibilite("BER").ok, false);
  assert.match(m.disponibilite("BER").raison, /52e amendement/);
});

test("règle 10 : chaque variante du kit passe toutes les règles", () => {
  const d = donnees({ toutesVagues: true });
  const m = creerMoteur(d);
  for (const [code, r] of Object.entries(d.recettes.recettes)) {
    const variantes = m.variantesKit({ concentration: 18, notes: r.notes });
    assert.deepEqual(variantes.map(v => v.nom), ["Plus fraîche", "Standard", "Plus intense"]);
    for (const v of variantes) assert.ok(m.securite(v.formule).ok, `${code} ${v.nom}`);
    // la variante plus intense est plus concentrée, la plus fraîche a plus de tête
    assert.ok(variantes[2].formule.concentration > variantes[0].formule.concentration, code);
    assert.ok(m.etages(variantes[0].formule).tete >= m.etages(variantes[1].formule).tete - 1e-9, code);
  }
});

test("plafonds légaux européens (annexe III) : appliqués en plus de l'IFRA, le plus sévère gagne", () => {
  // isoeugénol : IFRA 0,11 %, loi 0,02 %
  const lot = { substances_ifra_pct: { isoeugenol: 1 }, allergenes_pct: { isoeugenol: 1 } };
  const m = creerMoteur(sansDemo({ YLA: lot, ROS: {}, CED: {}, MUS: {} }));
  assert.ok(m.securite(f({ YLA: 10, ROS: 35, CED: 10, MUS: 45 }, 20)).ok, "10 % × 20 % × 1 % = 0,02 %");
  const r = m.securite(f({ YLA: 12, ROS: 35, CED: 8, MUS: 45 }, 20));
  assert.deepEqual(codes(r), ["annexe3"]);
  assert.match(r.erreurs[0].message, /plafond fixé par la loi/);
});

test("une note sans lot valable (4 documents, lot réel) est invisible et inutilisable, hors mode démonstration", () => {
  const d = sansDemo({ BER: {}, ROS: { docs: { fds: true, ifra: true, coa: false, allergenes: true } } });
  const m = creerMoteur(d);
  assert.deepEqual(m.notesDisponibles().map(n => n.code), ["BER"]);
  assert.match(m.disponibilite("ROS").raison, /4 documents/);
  assert.match(m.disponibilite("JAS").raison, /pas de lot/);
  assert.ok(codes(m.securite(f({ BER: 30, ROS: 30, MUS: 40 }))).includes("note_indisponible"));
  // les lots DEMO ne servent qu'en mode démonstration
  assert.equal(moteur(donnees()).disponibilite("BER").lot.lot, "DEMO-BER");
  assert.equal(creerMoteur(sansDemo()).notesDisponibles().length, 0);
  // un vrai lot passe avant le lot DEMO
  const d2 = donnees();
  avecLot(d2, "BER", { fcf: true });
  assert.equal(creerMoteur(d2).lotDe("BER").lot, "BER-2026-01");
  // un lot qui cite une substance ou un allergène inconnu est refusé (on ne sait pas le vérifier)
  assert.match(creerMoteur(sansDemo({ BER: { substances_ifra_pct: { safrole: 1 } } })).disponibilite("BER").raison, /safrole/);
});

test("vagues : seules les notes des vagues actives sont visibles", () => {
  const d = donnees();
  assert.equal(moteur(d).notesDisponibles().length, 20);
  d.features.vagues_actives = [1, 2];
  assert.equal(creerMoteur(d).notesDisponibles().length, 41);
  assert.match(moteur(donnees()).disponibilite("IRI").raison, /vague 2/);
});

test("vente bloquée tant que vente_active, mode démonstration ou cadre vide le demandent", () => {
  const d = donnees();
  assert.equal(moteur(d).etatVente().raisons.length, 3);
  d.boutique.vente_active = true;
  d.features.mode_demo = false;
  d.cadre_securite = { version: "C1", date: "2027-01-01", signataire: "x", concentration: { min: 15, max: 20 }, nombre_notes: { min: 3, max: 12 }, notes: { BER: { pmax: 30 } }, allergenes_total_max_pct: null };
  assert.deepEqual(creerMoteur(d).etatVente(), { ok: true, raisons: [] });
});

test("forme de la formule : total 100 %, doses au pas de 0,5 %, notes connues", () => {
  const m = moteur(donnees());
  assert.ok(codes(m.securite(f({ BER: 30, ROS: 30, MUS: 39 }))).includes("total"));
  assert.ok(codes(m.securite(f({ BER: 30.2, ROS: 29.8, MUS: 40 }))).includes("pas"));
  assert.ok(codes(m.securite(f({ BER: 30, XYZ: 30, MUS: 40 }))).includes("note_inconnue"));
  assert.ok(codes(m.securite(f({ BER: 30, constructor: 30, MUS: 40 }))).includes("note_inconnue"));
  assert.ok(codes(m.securite({ notes: { BER: 30, ROS: 30, MUS: 40 } })).includes("concentration"));
  assert.ok(!m.securite(null).ok);
});

test("marge de sécurité : la plus petite marge restante, toutes règles confondues", () => {
  const m = moteur(donnees());
  const r = m.securite(f({ BER: 35, ROS: 25, MUS: 40 }));
  assert.equal(r.marge_min, 0, "BER pile à sa dose_max");
  const r2 = m.securite(f({ BER: 17.5, ROS: 25, CED: 15, MUS: 42.5 }));
  assert.ok(r2.marge_min > 0 && r2.marge_min < 1);
  assert.equal(r2.marge_min, Math.min(...r2.marges.map(x => x.marge)));
});

test("curseurs : la plage d'une note tient compte de toutes les règles quand les autres s'ajustent", () => {
  const d = donnees({ toutesVagues: true });
  const m = creerMoteur(d);
  const formule = f(d.recettes.recettes.R04.notes, 20);
  const { max } = m.limitesNote(formule, "TON");
  // juste sous la limite de coumarine : au maximum, conforme ; un pas de plus, refusé
  const essai = p => {
    const autres = Object.entries(formule.notes).filter(([c]) => c !== "TON");
    const reste = autres.reduce((s, [, v]) => s + v, 0);
    const notes = { TON: p, ...Object.fromEntries(autres.map(([c, v]) => [c, (v * (100 - p)) / reste])) };
    return m.securite({ concentration: 20, notes: m.normaliser(notes) });
  };
  assert.ok(max < 20, `max ${max}`);
  assert.ok(essai(max).ok);
  assert.ok(!essai(max + 1).ok);
});

test("corriger : propose la variante conforme la plus proche", () => {
  const m = moteur(donnees());
  const r = m.corriger(f({ BER: 50, ROS: 10, MUS: 40 }, 22));
  assert.ok(r.ok);
  assert.ok(m.securite(r.formule).ok);
  assert.equal(r.formule.concentration, 20);
  assert.equal(r.formule.notes.BER, 35);
  assert.ok(r.changements.some(c => c.code === "concentration"));
  // une note indisponible est retirée
  const r2 = m.corriger(f({ BER: 20, IRI: 10, ROS: 30, MUS: 40 }));
  assert.ok(r2.ok && !("IRI" in r2.formule.notes));
  // impossible : il ne reste pas assez de notes
  assert.equal(m.corriger(f({ IRI: 50, MUS: 50 })).ok, false);
});

test("normaliser : total 100 %, au pas de 0,5 %, notes à 0 retirées", () => {
  const m = moteur(donnees());
  const n = m.normaliser({ BER: 1, ROS: 1, MUS: 1, CED: 0 });
  assert.equal(Object.values(n).reduce((s, v) => s + v, 0), 100);
  assert.ok(Object.values(n).every(v => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9));
  assert.ok(!("CED" in n));
});
