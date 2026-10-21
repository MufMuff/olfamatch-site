// Configurateur : questions du mode guidé, curseurs, kit, visualisation, lien de paiement, étiquette.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { creerConfigurateur, lienPaiement } from "../../src/creer/configurateur.js";
import { creerFabrication } from "../../src/creer/fabrication.js";
import { controlerDonnees } from "../../src/creer/donnees.js";
import { donnees, hasard, somme } from "./outils.mjs";

const d = donnees();
const conf = creerConfigurateur(d), m = conf.moteur, atelier = creerFabrication(d);
const N = d.notes.notes, REC = d.recettes.recettes, R = d.regles;
const etages = f => { const t = { tete: 0, coeur: 0, fond: 0 }; for (const [id, v] of Object.entries(f.notes)) t[N[id].etage] += v; return t; };

const AMBIANCES = ["fraiche", "florale", "boisee", "chaude", "gourmande"];
const MOMENTS = ["jour", "soir"], SAISONS = ["printemps", "ete", "automne", "hiver"], INTENSITES = ["douce", "intense"];

test("mode guidé : toutes les combinaisons de réponses donnent 2 ou 3 recettes valables", () => {
  const ids = Object.keys(N), alea = hasard(5);
  for (const ambiance of AMBIANCES) for (const moment of MOMENTS) for (const saison of SAISONS) for (const intensite of INTENSITES) {
    const adoree = alea() < 0.6 ? ids[Math.floor(alea() * ids.length)] : undefined;
    const detestee = alea() < 0.6 ? ids[Math.floor(alea() * ids.length)] : undefined;
    const rep = { ambiance, moment, saison, intensite, adoree, detestee };
    const props = conf.choisirRecettes(rep);
    const sansDetestee = Object.values(REC).filter(r => !detestee || !(detestee in r.notes)).length;
    assert.ok(props.length >= Math.min(2, sansDetestee) && props.length <= 3, `${JSON.stringify(rep)} : ${props.length} recettes`);
    for (const p of props) {
      if (detestee) assert.ok(!(detestee in REC[p.id].notes) && p.ajout !== detestee, `note détestée proposée : ${JSON.stringify(rep)}`);
      const res = conf.formuleGuidee(p.id, {}, p.ajout);
      assert.ok(res.ok, `${p.id} + ${p.ajout} : ${res.erreurs.map(e => e.message).join(" / ")}`);
    }
  }
});

test("recettes : chaque note manque dans au moins 2 recettes (un client qui la déteste a encore le choix)", () => {
  for (const [id, n] of Object.entries(N)) {
    const sans = Object.values(REC).filter(r => !(id in r.notes)).length;
    assert.ok(sans >= 2, `${n.nom} est dans presque toutes les recettes : seulement ${sans} recette(s) sans elle`);
  }
});

test("mode guidé : la bonne ambiance passe en premier, la note adorée compte", () => {
  for (const a of AMBIANCES) {
    const [premiere] = conf.choisirRecettes({ ambiance: a });
    assert.equal(REC[premiere.id].ambiance, a, a);
  }
  const avecIris = conf.choisirRecettes({ ambiance: "florale", adoree: "iris" });
  assert.ok(avecIris.some(p => "iris" in REC[p.id].notes || p.ajout === "iris"));
  const sansVanille = conf.choisirRecettes({ ambiance: "florale", detestee: "vanille" });
  assert.ok(sansVanille.every(p => !("vanille" in REC[p.id].notes)));
});

test("curseurs : plus frais = plus de tête, plus chaud = plus de fond, intensité = concentration", () => {
  let compare = 0;
  for (const id of Object.keys(REC)) {
    const frais = conf.formuleGuidee(id, { fraicheur: -1 }), chaud = conf.formuleGuidee(id, { fraicheur: 1 });
    assert.ok(frais.ok && chaud.ok, id);
    assert.ok(etages(frais.formule).tete >= etages(chaud.formule).tete, `${id} : tête`);
    assert.ok(etages(frais.formule).fond <= etages(chaud.formule).fond, `${id} : fond`);
    if (etages(frais.formule).fond < etages(chaud.formule).fond) compare++;
    assert.equal(conf.formuleGuidee(id, { intensite: 1 }).formule.concentration, R.concentration.max);
    assert.equal(conf.formuleGuidee(id, { intensite: -1 }).formule.concentration, R.concentration.min);
  }
  assert.ok(compare >= 8, `le curseur fraîcheur ne bouge que ${compare} recettes sur 10`);
});

test("curseurs : 1 000 réglages au hasard restent toujours dans les règles et les marges de la recette", () => {
  const alea = hasard(31), ids = Object.keys(REC);
  for (let k = 0; k < 1000; k++) {
    const id = ids[Math.floor(alea() * ids.length)];
    const possibles = m.notesCompatibles({ mode: "guide", recette: id, notes: REC[id].notes }).filter(n => n.possible);
    const ajout = alea() < 0.4 && possibles.length ? possibles[Math.floor(alea() * possibles.length)].id : null;
    const curseurs = { fraicheur: alea() * 2 - 1, douceur: alea() * 2 - 1, intensite: alea() * 2 - 1 };
    const res = conf.formuleGuidee(id, curseurs, ajout);
    assert.ok(res.ok, `${id} ${JSON.stringify(curseurs)} + ${ajout} : ${res.erreurs.map(e => e.message).join(" / ")}`);
    assert.ok(m.verifier(res.formule).ok);
    assert.equal(somme(Object.values(res.formule.notes)), 100);
  }
});

test("kit : 3 variantes valables, la standard est la formule du client", () => {
  for (const id of Object.keys(REC)) {
    const f = conf.formuleGuidee(id, { douceur: 0.4 }).formule;
    const v = conf.variantesKit(f);
    assert.deepEqual(v.map(x => x.nom), ["Plus fraîche", "Standard", "Plus intense"]);
    for (const x of v) assert.ok(m.verifier(x.formule).ok, `${id} ${x.nom}`);
    assert.deepEqual(v[1].formule.notes, f.notes);
    assert.ok(v[0].formule.concentration <= f.concentration && v[2].formule.concentration >= f.concentration, id);
  }
});

test("kit : code KIT → 3 fiches de pesée de 10 ml, chacune avec son code et son étiquette de 2 ml", () => {
  const res = atelier.preparerFiche("R01-BER22-MAN18-FLO25-MUS20-CED15-C18-KIT");
  assert.ok(res.ok, res.erreurs.map(e => e.message).join(" / "));
  assert.equal(res.kit, true);
  assert.equal(res.variantes.length, 3);
  for (const v of res.variantes) {
    assert.equal(v.fiche.masse_totale_g, 8.2);
    assert.equal(somme(v.fiche.lignes.map(l => Math.round(l.a_peser_g * 1000))), 8200);
    assert.equal(v.etiquette.contenance, "2 ml ℮");
    const lu = atelier.decoder(v.code, { volumeFacultatif: true });
    assert.ok(lu.ok && m.verifier(lu.formule).ok, v.code);
  }
  assert.equal(atelier.encoder(res.formule, "kit"), "R01-BER22-MAN18-FLO25-MUS20-CED15-C18-KIT");
  // un code sans produit ne suffit pas pour fabriquer
  assert.equal(atelier.preparerFiche("R01-BER22-MAN18-FLO25-MUS20-CED15-C18").ok, false);
});

test("visualisation : pyramide, roue des familles et frise cohérentes", () => {
  const f = conf.formuleGuidee("R05").formule;
  const p = conf.pyramide(f);
  assert.equal(somme([...p.tete, ...p.coeur, ...p.fond].map(n => n.pct)), 100);
  assert.ok(p.fond[0].pct >= p.fond.at(-1).pct);
  const r = conf.roue(f);
  assert.ok(Math.abs(somme(r.familles.map(x => x.part)) - 100) < 0.5);
  assert.equal(r.dominante, "boise");
  assert.ok(r.angle >= 0 && r.angle < 360);
  const fr = conf.frise(f);
  assert.deepEqual(fr.map(x => x.moment), ["0 min", "1 h", "6 h"]);
  // au bout de 6 h, plus aucune note de tête (tenue de 1 à 3 h)
  assert.ok(fr[2].notes.every(n => N[n.id].etage !== "tete"));
  assert.ok(fr[0].notes.some(n => N[n.id].etage === "tete"));
});

test("aucun nom de marque dans les recettes, les notes et les descriptions", () => {
  const parfums = JSON.parse(readFileSync(fileURLToPath(new URL("../../data/parfums.json", import.meta.url)), "utf8"));
  const sans = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const marques = new Set();
  // les marques seulement : des noms de parfums comme « Blanche » sont aussi des mots courants
  for (const o of parfums) { marques.add(o.brand); for (const x of o.dupes) marques.add(x.brand); }
  const motifs = [...marques].filter(b => b && b.length >= 4).map(b => new RegExp(`\\b${sans(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`));
  const textes = [
    ...Object.values(REC).map(r => r.nom), ...Object.values(N).map(n => `${n.nom} ${n.texte}`),
    ...Object.values(R.equilibre).map(e => e.texte),
    ...Object.keys(REC).flatMap(id => [conf.decrire(conf.formuleGuidee(id).formule), atelier.etiquette(conf.formuleGuidee(id).formule, 100).nom]),
  ];
  for (const t of textes) for (const motif of motifs) assert.ok(!motif.test(sans(t)), `« ${t} » contient ${motif}`);
  for (const t of textes) assert.ok(!/dans l'esprit/i.test(t));
});

test("lien de paiement : rien tant que le lien n'existe pas, sinon le code part avec", () => {
  assert.equal(lienPaiement(d.boutique, "flacon_100", "R01-BER22-C18-V100"), null);
  const b = { ...d.boutique, liens_stripe: { ...d.boutique.liens_stripe, flacon_100: "https://buy.stripe.com/test_abc123" } };
  const lien = lienPaiement(b, "flacon_100", "R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V100");
  assert.equal(lien, "https://buy.stripe.com/test_abc123?client_reference_id=R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V100");
});

test("étiquette : liste d'ingrédients dans l'ordre, et ce qui manque encore pour l'imprimer", () => {
  const f = conf.formuleGuidee("R01").formule;
  const e = atelier.etiquette(f, 100);
  assert.equal(e.nom, "Agrumes et fleur d'oranger");
  assert.equal(e.contenance, "100 ml ℮");
  assert.equal(e.ingredients, "ALCOHOL DENAT., PARFUM (FRAGRANCE)");
  assert.equal(e.pret, false);
  assert.equal(e.manque.length, 2);
  const d2 = donnees();
  for (const n of Object.values(d2.notes.notes)) n.allergenes = {};
  d2.notes.notes.bergamote.allergenes = { Limonene: 30, Linalool: 10 };
  d2.regles.etiquette.responsable = "Olfamatch, adresse à compléter";
  const e2 = creerFabrication(d2).etiquette(f, 100);
  assert.equal(e2.ingredients, "ALCOHOL DENAT., PARFUM (FRAGRANCE), LIMONENE, LINALOOL");
  assert.equal(e2.pret, true);
  // mode expert : nom tiré de la famille
  const exp = m.proposer(["bergamote", "rose", "jasmin", "musc_blanc", "santal"]);
  assert.match(atelier.etiquette(exp.formule, 50).nom, /^Création /);
});

test("boutique.json : contrôlé comme les autres fichiers", () => {
  assert.deepEqual(controlerDonnees(donnees()), []);
  const d2 = donnees();
  d2.boutique.publie = true;
  d2.boutique.liens_stripe.kit = "http://pas-securise";
  const pb = controlerDonnees(d2).join("\n");
  assert.match(pb, /lien Stripe « kit »/);
  assert.match(pb, /publie vaut true mais aucun lien|lien Stripe/);
});
