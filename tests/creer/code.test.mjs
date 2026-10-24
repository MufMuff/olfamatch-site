// Code de formule (§ B11) et grammes à peser (§ B7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { formeCanonique, lireCanonique, codeFormule, lireCode, caractereControle, ALPHABET, sha256Hex } from "../../src/creer/code.js";
import { creerFabrication } from "../../src/creer/fabrication.js";
import { donnees, moteur, hasard, avecLot } from "./outils.mjs";

const V = { moteur_version: "2.0", cadre_version: null, ifra_amendement: 51 };

test("forme canonique : notes triées par code, doses au pas de 0,5 %, concentration au pas de 1 %, versions", () => {
  const a = formeCanonique({ concentration: 18.2, notes: { MUS: 20, BER: 25.24, CED: 54.76 } }, V);
  assert.equal(a, "OLF2;moteur=2.0;cadre=-;ifra=51;c=18;BER=25;CED=55;MUS=20");
  assert.equal(formeCanonique({ concentration: 18, notes: { CED: 54.5, MUS: 20, BER: 25.5 } }, { ...V, cadre_version: "C1" }),
    "OLF2;moteur=2.0;cadre=C1;ifra=51;c=18;BER=25.5;CED=54.5;MUS=20");
  assert.deepEqual(lireCanonique(a), { concentration: 18, notes: { BER: 25, CED: 55, MUS: 20 }, versions: V });
  assert.equal(lireCanonique("autre;chose"), null);
});

test("empreinte SHA-256 identique à celle de Node", async () => {
  for (const t of ["", "OLF2;c=18", "é€😀"]) assert.equal(await sha256Hex(t), createHash("sha256").update(t).digest("hex"));
});

test("code : OLF- + 2 blocs de 5 caractères, toujours le même pour la même formule, différent sinon", async () => {
  const f = { concentration: 18, notes: { BER: 25, CED: 55, MUS: 20 } };
  const { code, hash } = await codeFormule(formeCanonique(f, V));
  assert.match(code, /^OLF-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal((await codeFormule(formeCanonique({ concentration: 18, notes: { MUS: 20, CED: 55, BER: 25 } }, V))).code, code);
  assert.notEqual((await codeFormule(formeCanonique({ ...f, concentration: 19 }, V))).code, code);
  assert.notEqual((await codeFormule(formeCanonique(f, { ...V, cadre_version: "C2" }))).code, code, "nouveau cadre = nouveau code");
  // les 45 premiers bits de l'empreinte
  const bits = BigInt(`0x${hash.slice(0, 12)}`) >> 3n;
  let attendu = "";
  for (let i = 8; i >= 0; i--) attendu += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  assert.equal(code.replace(/-/g, "").slice(3, 12), attendu);
});

// (Luhn modulo 32 laisse passer une seule inversion : « 0 » et « Z » côte à côte.)
test("caractère de contrôle : toute faute de frappe sur un caractère, et l'inversion de deux voisins, est repérée", async () => {
  const alea = hasard(5);
  for (let k = 0; k < 300; k++) {
    const { code } = await codeFormule(`essai ${k}`);
    assert.ok(lireCode(code).ok);
    const s = code.replace(/-/g, "").slice(3);
    const i = Math.floor(alea() * 10);
    const autre = ALPHABET[(ALPHABET.indexOf(s[i]) + 1 + Math.floor(alea() * 31)) % 32];
    assert.equal(lireCode(s.slice(0, i) + autre + s.slice(i + 1)).ok, false);
    const j = Math.floor(alea() * 9);
    if (s[j] !== s[j + 1] && !["0Z", "Z0"].includes(s[j] + s[j + 1])) assert.equal(lireCode(s.slice(0, j) + s[j + 1] + s[j] + s.slice(j + 2)).ok, false, `${s} ${j}`);
  }
});

test("lecture d'un code tapé : minuscules, espaces, O pour 0 et I ou L pour 1 acceptés", async () => {
  const { code } = await codeFormule("x");
  const brut = code.slice(4).replace("-", "");
  assert.equal(lireCode(` olf ${brut.toLowerCase()} `).code, code);
  assert.equal(lireCode(code.replace(/0/g, "O").replace(/1/g, "I")).code, code);
  assert.match(lireCode("OLF-123").erreur, /bonne forme/);
  assert.match(lireCode("").erreur, /bonne forme/);
  assert.equal(caractereControle("000000000"), "0");
});

test("grammes : exemple du cahier, R01 en 100 ml à 18 % (17,3 g de concentré, 66,2 g d'alcool)", () => {
  const d = donnees();
  const atelier = creerFabrication(d, moteur(d));
  const f = { concentration: 18, notes: d.recettes.recettes.R01.notes };
  const fiche = atelier.grammes(f, 100, { marge: false });
  assert.ok(Math.abs(fiche.masse_concentre_g - 17.28) < 1e-9);
  assert.ok(Math.abs(fiche.masse_alcool_g - 66.174) < 0.001);
  const g = Object.fromEntries(fiche.lignes.map(l => [l.code, l.a_peser_g]));
  const cahier = { BER: 4.33, CIT: 2.6, MAN: 1.73, LAV: 1.73, JAS: 0.87, MUS: 3.46, CED: 2.6 };
  for (const [c, v] of Object.entries(cahier)) assert.ok(Math.abs(g[c] - v) <= 0.01, `${c} : ${g[c]} au lieu de ${v}`);
  assert.ok(Math.abs(g.ALC - 66.2) < 0.05);
  // ordre de pesée : fond, cœur, tête, puis alcool
  const etages = fiche.lignes.map(l => l.etage);
  assert.deepEqual(etages, ["fond", "fond", "coeur", "tete", "tete", "tete", "tete", null]);
  // tableau du cahier : grammes pour 1 % du concentré
  for (const [V, c, attendu] of [[100, 15, 0.144], [100, 18, 0.173], [100, 20, 0.192], [50, 15, 0.072], [50, 18, 0.086], [50, 20, 0.096]]) {
    const x = atelier.grammes({ concentration: c, notes: { MUS: 100 } }, V, { marge: false }).masse_concentre_g / 100;
    assert.ok(Math.abs(x - attendu) < 0.0006, `${V} ml à ${c} %`);
  }
});

test("grammes : notes prédiluées à 10 % pesées 10 fois plus lourdes, leur alcool déduit ; 2 % de liquide en plus", () => {
  const d = donnees();
  const atelier = creerFabrication(d, moteur(d));
  const f = { concentration: 20, notes: { PAT: 20, ROS: 30, MUS: 40, BER: 10 } };
  const sans = atelier.grammes(f, 100, { marge: false });
  const pat = sans.lignes.find(l => l.code === "PAT");
  assert.ok(Math.abs(pat.a_peser_g - pat.pur_g * 10) < 0.002);
  const alcoolAttendu = 100 * 0.8 * 0.807 - (pat.a_peser_g - pat.pur_g);
  assert.ok(Math.abs(sans.lignes.at(-1).a_peser_g - alcoolAttendu) < 0.002);
  // la masse totale reste celle de 100 ml de parfum
  assert.ok(Math.abs(sans.masse_totale_g - (19.2 + 64.56)) < 0.003);
  const avec = atelier.grammes(f, 100);
  assert.ok(Math.abs(avec.masse_totale_g / sans.masse_totale_g - 1.02) < 1e-4);
  assert.equal(avec.volume_prepare_ml, 102);
});

test("grammes : densité du concentré calculée avec les vrais lots quand ils sont tous connus", () => {
  const d = donnees();
  for (const [code, densite] of [["BER", 0.85], ["ROS", 0.95], ["MUS", 1.0]]) avecLot(d, code, { densite_g_ml: densite, fcf: true });
  const atelier = creerFabrication(d, moteur(d));
  const f = { concentration: 18, notes: { BER: 30, ROS: 30, MUS: 40 } };
  assert.ok(Math.abs(atelier.densiteConcentre(f) - 1 / (0.3 / 0.85 + 0.3 / 0.95 + 0.4 / 1.0)) < 1e-12);
  // une note encore sur un lot DEMO : densité par défaut
  assert.equal(atelier.densiteConcentre({ concentration: 18, notes: { BER: 30, ROS: 30, CED: 40 } }), 0.96);
});

test("besoins d'une commande : kit = 3 mini-lots de 10 ml ; flacons × quantité", () => {
  const d = donnees();
  const m = moteur(d);
  const atelier = creerFabrication(d, m);
  const f = { concentration: 18, notes: d.recettes.recettes.R01.notes };
  const un = atelier.besoins(f, "100", 1), deux = atelier.besoins(f, "100", 2);
  for (const c of Object.keys(un)) assert.ok(Math.abs(deux[c] - 2 * un[c]) < 0.002);
  const kit = atelier.besoins(f, "kit");
  const attendu = m.variantesKit(f).reduce((s, v) => s + atelier.grammes(v.formule, 10, { marge: false }).lignes.find(l => l.code === "BER").a_peser_g, 0);
  assert.ok(Math.abs(kit.BER - attendu) < 0.002);
});
