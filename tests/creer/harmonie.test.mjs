// Moteur d'harmonie V2 : matrice, facettes, pyramide, exceptions, pénalités, seuils.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerMoteur } from "../../src/creer/moteur.js";
import { donnees, moteur } from "./outils.mjs";

const d = donnees({ toutesVagues: true });
const m = moteur(d);
const H = d.regles.harmonie;
const f = (notes, concentration = 18) => ({ concentration, notes });

test("une exception remplace la matrice pour sa paire (et seulement pour elle)", () => {
  // ROS (flro) × OUD (ambr) : matrice 1, exception E001 = +2
  assert.equal(d.matrice_sf.matrice.flro.ambr, 1);
  assert.deepEqual([m.valeurPaire("ROS", "OUD").valeur, m.valeurPaire("ROS", "OUD").source], [2, "exception"]);
  assert.equal(m.valeurPaire("OUD", "ROS").valeur, 2, "l'ordre ne compte pas");
  // MEN × JAS : arom × flbl = -1 dans la matrice, exception E062 = -2
  assert.equal(m.valeurPaire("MEN", "JAS").valeur, -2);
  // sans exception : la matrice
  assert.deepEqual([m.valeurPaire("BER", "CIT").valeur, m.valeurPaire("BER", "CIT").source], [2, "matrice"]);
  // changer l'exception change le score de la formule
  const formule = f({ BER: 10, ROS: 40, OUD: 20, MUS: 30 });
  const avant = m.harmonie(formule).score;
  const d2 = donnees({ toutesVagues: true });
  d2.exceptions.exceptions.find(e => e.id === "E001").valeur = -2;
  assert.ok(creerMoteur(d2).harmonie(formule).score < avant - 5);
});

test("affinités des facettes : symétriques, et une paire absente vaut 0", () => {
  for (const a of ["BER", "ROS", "VAN", "CUI", "MAR"]) for (const b of ["MUS", "TON", "ENC", "FRB"])
    assert.equal(m.affiniteFacettes(a, b), m.affiniteFacettes(b, a));
  // BER (hespéridé 1, vert 0,5) × MUS (musqué 1) : hespéridé–musqué = +1
  assert.equal(m.affiniteFacettes("BER", "MUS"), 1);
  // CED (boisé sec) × CAC (boisé sec, ambré) : rien dans la table
  assert.equal(m.affiniteFacettes("CED", "CED"), 0);
});

test("calcul : poids des paires selon les doses, S_sf entre -1 et +1, H borné entre 0 et 100", () => {
  const h = m.harmonie(f({ BER: 50, MUS: 50 }));
  // une seule paire : S_sf = M[hesp][musq] / 2 = 1
  assert.equal(h.S_sf, 1);
  assert.equal(h.paires.length, 1);
  assert.equal(h.paires[0].poids, 1);
  for (const notes of [{ MUS: 100 }, { CAF: 30, CIT: 30, CON: 20, OUD: 20 }, { BER: 34, CIT: 33, MUS: 33 }]) {
    const x = m.harmonie(f(notes));
    assert.ok(x.score >= 0 && x.score <= 100);
    assert.ok(x.S_sf >= -1 && x.S_sf <= 1 && x.S_fac >= -1 && x.S_fac <= 1 && x.S_pyr >= -1 && x.S_pyr <= 1);
  }
});

test("formule de H : base + poids × scores − pénalités, poids lus dans regles.json", () => {
  const formule = f({ BER: 20, LAV: 20, ROS: 20, CED: 20, MUS: 20 });
  const h = m.harmonie(formule);
  const attendu = H.base + H.poids.sous_familles * h.S_sf + H.poids.facettes * h.S_fac + H.poids.pyramide * h.S_pyr;
  assert.ok(Math.abs(h.score - Math.round(attendu * 10) / 10) < 1e-9);
  const d2 = donnees({ toutesVagues: true });
  d2.regles.harmonie.poids.pyramide = 0;
  const h2 = creerMoteur(d2).harmonie(formule);
  assert.ok(Math.abs(h2.score - (h.score - H.poids.pyramide * h.S_pyr)) < 0.11);
});

test("pyramide : écart à la structure la plus proche ; une note à cheval compte pour moitié dans ses deux étages", () => {
  const e = m.etages(f({ LAV: 50, MUS: 50 }));
  assert.deepEqual(e, { tete: 25, coeur: 25, fond: 50 });
  const h = m.harmonie(f({ LAV: 50, MUS: 50 }));
  // pile la pyramide de S12 (25/25/50) : écart nul, S_pyr = 1
  assert.equal(h.D, 0);
  assert.equal(h.S_pyr, 1);
  assert.equal(h.structure_proche, "S12");
  // tout en tête : très loin de toute structure
  const tete = m.harmonie(f({ BER: 40, CIT: 30, MAN: 30 }));
  assert.ok(tete.S_pyr < 0);
});

test("pénalités : note au-dessus de sa dose_max, note de puissance 5 au-delà de 15 %, moins de 3 ou plus de 12 notes", () => {
  const codes = h => h.penalites.map(p => p.code);
  assert.ok(codes(m.harmonie(f({ BER: 30, POI: 20, MUS: 50 }))).includes("au_dessus_dose_max")); // POI max 10
  assert.ok(codes(m.harmonie(f({ BER: 30, CUI: 20, MUS: 50 }))).includes("note_tres_puissante"));
  assert.ok(!codes(m.harmonie(f({ BER: 35, CUI: 15, MUS: 50 }))).includes("note_tres_puissante"), "15 % pile : pas de pénalité");
  assert.ok(codes(m.harmonie(f({ BER: 50, MUS: 50 }))).includes("trop_peu_de_notes"));
  const treize = Object.fromEntries(["BER", "CIT", "MAN", "PAM", "LAV", "ROS", "JAS", "CED", "SAN", "VET", "AMB", "MUS", "VAN"].map(c => [c, c === "MUS" ? 16 : 7]));
  assert.ok(codes(m.harmonie(f(treize))).includes("trop_de_notes"));
  // les points retirés sont ceux de regles.json
  const avec = m.harmonie(f({ BER: 30, CUI: 20, MUS: 50 }));
  assert.equal(avec.penalites.find(p => p.code === "note_tres_puissante").points, H.penalites.note_tres_puissante.points);
});

test("associations de 3 notes de la V1 : pénalité seulement quand les 3 sont présentes", () => {
  const sans = m.harmonie(f({ OUD: 10, CUI: 10, ROS: 30, MUS: 50 }));
  const avec = m.harmonie(f({ OUD: 10, CUI: 10, PAT: 10, MUS: 70 }));
  assert.ok(!sans.penalites.some(p => p.code === "groupe"));
  assert.ok(avec.penalites.some(p => p.code === "groupe" && p.groupe === "G02"));
});

test("seuils : Bon à partir de 70, Risqué de 55 à 70, Déconseillé en dessous", () => {
  const d2 = donnees({ toutesVagues: true });
  const m2 = creerMoteur(d2);
  const formule = f({ BER: 20, LAV: 20, ROS: 20, CED: 20, MUS: 20 });
  const s = m2.harmonie(formule).score;
  for (const [bon, risque, attendu] of [[s - 1, s - 2, "bon"], [s + 1, s - 1, "risque"], [s + 2, s + 1, "deconseille"]]) {
    d2.regles.harmonie.seuils = { bon, risque };
    assert.equal(creerMoteur(d2).harmonie(formule).libelle, attendu);
  }
  // libellé affiché au client
  d2.regles.harmonie.seuils = { bon: 1, risque: 0 };
  assert.equal(creerMoteur(d2).harmonie(formule).texte, "Bon");
  d2.regles.harmonie.seuils = { bon: 100, risque: 1 };
  assert.equal(creerMoteur(d2).harmonie(formule).texte, "Risqué");
  assert.equal(m.harmonie(f({ MAR: 30, PRA: 30, CON: 20, VAN: 20 })).texte, "Déconseillé");
});

test("règle dure : une paire à -2 où les deux notes pèsent au moins 8 % rend la formule « Déconseillé »", () => {
  // CAF × CIT = -2 (E069)
  const dure = m.harmonie(f({ CIT: 8, CAF: 8, VAN: 30, AMB: 24, MUS: 30 }));
  assert.equal(dure.libelle, "deconseille");
  assert.deepEqual([dure.regle_dure.a, dure.regle_dure.b].sort(), ["CAF", "CIT"]);
  // 7,5 % : la règle dure ne joue plus (le score seul décide)
  const juste = m.harmonie(f({ CIT: 7.5, CAF: 8, VAN: 30, AMB: 24.5, MUS: 30 }));
  assert.equal(juste.regle_dure, null);
});

test("des associations qui se heurtent font chuter le score", () => {
  assert.equal(m.harmonie(f({ MAR: 30, PRA: 30, CON: 20, VAN: 20 })).libelle, "deconseille");
  assert.equal(m.harmonie(f({ CAF: 20, CIT: 20, OUD: 20, CON: 20, MAR: 20 })).libelle, "deconseille");
  const bon = m.harmonie(f({ BER: 30, ROS: 30, MUS: 40 }));
  assert.equal(bon.libelle, "bon");
});

test("évaluer : Déconseillé bloque les portes P1 à P4, demande une confirmation en mode expert", () => {
  const formule = f({ CIT: 10, CAF: 10, VAN: 30, AMB: 20, MUS: 30 });
  assert.equal(m.securite(formule).ok, true);
  for (const porte of ["P1", "P2", "P3", "P4"]) assert.equal(m.evaluer(formule, { porte }).commande, "non");
  assert.equal(m.evaluer(formule, { porte: "P5" }).commande, "avec_confirmation");
  assert.equal(m.evaluer(formule, { porte: "P5", confirme: true }).commande, "oui");
  // Risqué : commande possible, avec un avertissement et le kit conseillé
  const d2 = donnees({ toutesVagues: true });
  d2.regles.harmonie.seuils = { bon: 99, risque: 1 };
  const r = creerMoteur(d2).evaluer(f({ BER: 30, ROS: 30, MUS: 40 }), { porte: "P2" });
  assert.equal(r.harmonie.libelle, "risque");
  assert.equal(r.commande, "oui");
  assert.match(r.avertissements[0].message, /kit/);
});

test("l'harmonie ne contourne jamais la sécurité : une formule non conforme n'est jamais commandable", () => {
  // très harmonieuse, mais tonka au-dessus de son maximum
  const formule = f({ LAV: 20, TON: 25, BER: 15, MUS: 40 }, 20);
  const r = m.evaluer(formule, { porte: "P5", confirme: true });
  assert.equal(r.conforme, false);
  assert.equal(r.commande, "non");
});
