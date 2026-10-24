// Chaque règle du cahier des charges, vérifiée une par une.
import { test } from "node:test";
import assert from "node:assert/strict";
import { donnees, moteur, somme } from "./outils.mjs";

const codes = res => res.erreurs.map(e => e.code);
const messages = res => res.erreurs.map(e => e.message).join(" / ");

test("exemple IFRA du cahier : 30 % d'une huile limitée à 4 %, à 18 % de concentration, redescend à 22 %", () => {
  const d = donnees();
  d.notes.notes.rose.ifra_max = 4;
  const m = moteur(d);
  assert.equal(Math.round(m.limiteIfra("rose", 18) * 10) / 10, 22.2);
  const res = m.ajuster({ mode: "expert", notes: { bergamote: 15, rose: 30, jasmin: 15, musc_blanc: 20, santal: 20 } });
  assert.ok(res.ok, messages(res));
  assert.equal(res.formule.notes.rose, 22);
  assert.ok(res.formule.notes.rose * 18 / 100 <= 4);
  const c = res.corrections.find(x => x.note === "rose");
  assert.equal(c.raison, "ifra");
  assert.match(c.message, /Dose de rose ramenée à 22 % \(limite de sécurité/);
});

test("la limite IFRA suit la concentration : plus de concentration, moins d'huile permise", () => {
  const m = moteur();
  const notes = { bergamote: 40, mandarine: 10, fleur_oranger: 25, musc_blanc: 15, cedre: 10 };
  const a18 = m.ajuster({ mode: "expert", famille: "frais", concentration: 18, notes });
  const a20 = m.ajuster({ mode: "expert", famille: "frais", concentration: 20, notes });
  assert.ok(a18.ok && a20.ok, messages(a18) + messages(a20));
  assert.equal(a18.formule.notes.bergamote, 27); // 5 % × 100 / 18 = 27,7
  assert.equal(a20.formule.notes.bergamote, 25); // 5 % × 100 / 20 = 25
});

test("le total est toujours remis à 100 %", () => {
  const res = moteur().ajuster({ mode: "expert", notes: { bergamote: 3, rose: 4, jasmin: 2, musc_blanc: 3, santal: 3 } });
  assert.ok(res.ok, messages(res));
  assert.equal(somme(Object.values(res.formule.notes)), 100);
});

test("concentration hors plage : ramenée entre 15 et 20 %", () => {
  const res = moteur().ajuster({ mode: "guide", recette: "R01", concentration: 25, notes: donnees().recettes.recettes.R01.notes });
  assert.ok(res.ok, messages(res));
  assert.equal(res.formule.concentration, 20);
  assert.equal(res.corrections[0].code, "concentration");
});

test("nombre de notes : 3 au minimum, 7 au maximum", () => {
  const m = moteur();
  assert.ok(codes(m.ajuster({ mode: "expert", notes: { bergamote: 50, musc_blanc: 50 } })).includes("trop_peu_de_notes"));
  const huit = { bergamote: 10, mandarine: 10, rose: 15, jasmin: 15, musc_blanc: 15, santal: 15, cedre: 10, vanille: 10 };
  assert.ok(codes(m.ajuster({ mode: "expert", notes: huit })).includes("trop_de_notes"));
});

test("structure : au moins 1 note de tête, 1 de cœur, 2 de fond", () => {
  const m = moteur();
  const sansTete = m.ajuster({ mode: "expert", notes: { rose: 40, musc_blanc: 30, santal: 30 } });
  assert.ok(sansTete.erreurs.some(e => e.code === "etage_incomplet" && e.etage === "tete"));
  const unFond = m.ajuster({ mode: "expert", notes: { bergamote: 30, rose: 40, musc_blanc: 30 } });
  assert.ok(unFond.erreurs.some(e => e.code === "etage_incomplet" && e.etage === "fond"));
});

test("tenue : musc blanc ou ambre obligatoire", () => {
  const res = moteur().ajuster({ mode: "expert", notes: { bergamote: 20, rose: 30, santal: 25, cedre: 25 } });
  assert.ok(codes(res).includes("tenue"));
  assert.match(messages(res), /musc blanc ou ambre/);
});

test("jamais oud, cuir et patchouli ensemble", () => {
  const res = moteur().ajuster({ mode: "expert", notes: { bergamote: 20, rose: 25, oud: 5, cuir: 5, patchouli: 5, ambre: 40 } });
  assert.ok(codes(res).includes("association_interdite"));
});

test("au plus 2 notes de puissance 4 ou 5", () => {
  const res = moteur().ajuster({ mode: "expert", notes: { bergamote: 20, iris: 10, rose: 15, patchouli: 8, vetiver: 8, cuir: 4, ambre: 35 } });
  assert.ok(codes(res).includes("trop_de_notes_puissantes"));
});

test("plafonds par note : le cuir ne dépasse jamais 6 %", () => {
  const res = moteur().ajuster({ mode: "expert", notes: { bergamote: 14, poivre_rose: 4, iris: 12, rose: 10, cuir: 30, ambre: 30, santal: 20 } });
  assert.ok(res.ok, messages(res));
  assert.ok(res.formule.notes.cuir <= 6);
  assert.ok(res.corrections.some(c => c.note === "cuir"));
});

test("aucune note ne dépasse 45 % du poids perçu", () => {
  // rose : 30 × 3 = 90 sur un total perçu de 198, soit 45,5 %
  const res = moteur().ajuster({ mode: "expert", famille: "frais", notes: { bergamote: 20, mandarine: 15, rose: 30, musc_blanc: 32, santal: 3 } });
  assert.equal(res.ok, false);
  assert.ok(codes(res).includes("trop_presente"));
  assert.match(messages(res), /Trop de rose pour rester harmonieux/);
});

test("équilibre : un parfum boisé garde 50 à 60 % de fond", () => {
  const res = moteur().ajuster({ mode: "expert", famille: "boise", notes: { bergamote: 30, rose: 15, iris: 10, cedre: 20, vetiver: 5, musc_blanc: 20 } });
  assert.ok(res.ok, messages(res));
  assert.ok(res.etages.fond >= 50 && res.etages.fond <= 60, `fond à ${res.etages.fond}`);
  assert.ok(res.corrections.some(c => c.code === "equilibre"));
});

test("association délicate en mode expert : permise une fois, dose de la note forte réduite de moitié", () => {
  // mandarine + cuir : délicate. Cuir (puissance 5) passe de 6 % à 3 % au plus.
  const res = moteur().ajuster({ mode: "expert", notes: { mandarine: 12, bergamote: 6, rose: 25, cuir: 6, ambre: 31, santal: 20 } });
  assert.ok(res.ok, messages(res));
  assert.ok(res.formule.notes.cuir <= 3);
  assert.equal(res.avertissements.length, 1);
  assert.match(res.avertissements[0].message, /Mandarine et cuir : association délicate\. La dose de cuir est réduite de moitié\./);
});

test("deux associations délicates en mode expert : refusé", () => {
  const res = moteur().ajuster({ mode: "expert", notes: { mandarine: 15, iris: 10, rose: 15, cuir: 5, ambre: 35, santal: 20 } });
  assert.ok(codes(res).includes("trop_d_associations_delicates"));
});

test("score moyen sous 2,0 : refusé, avec la note à retirer", () => {
  // mandarine + iris (délicate) sans accord classique pour compenser : moyenne 1,83
  const res = moteur().ajuster({ mode: "expert", notes: { mandarine: 20, iris: 12, ambre: 40, cedre: 28 } });
  assert.ok(codes(res).includes("harmonie"));
  assert.match(messages(res), /Essaie sans (mandarine|iris)/);
});

test("mode guidé : la recette sert de base, chaque dose reste à ± 5 points", () => {
  const r = donnees().recettes.recettes.R01;
  const res = moteur().ajuster({ mode: "guide", recette: "R01", notes: { ...r.notes, bergamote: 60 } });
  assert.ok(res.ok, messages(res));
  for (const [id, v] of Object.entries(r.notes))
    assert.ok(Math.abs(res.formule.notes[id] - v) <= 5, `${id} : ${res.formule.notes[id]} au lieu de ${v} ± 5`);
  assert.ok(res.corrections.some(c => c.note === "bergamote" && c.raison === "recette"));
});

test("mode guidé : la sécurité IFRA passe avant la marge de la recette", () => {
  const d = donnees();
  d.notes.notes.bergamote.ifra_max = 3.6; // à 20 % : 18 % au plus, sous la marge de la recette (22 − 5 = 17… 27)
  const res = moteur(d).ajuster({ mode: "guide", recette: "R01", concentration: 20, notes: d.recettes.recettes.R01.notes });
  assert.ok(res.ok, messages(res));
  assert.ok(res.formule.notes.bergamote * 20 / 100 <= 3.6);
});

test("mode guidé : toutes les notes de la recette restent, une seule note ajoutée", () => {
  const m = moteur(), r = donnees().recettes.recettes.R03;
  const { rose, ...sansRose } = r.notes;
  assert.ok(codes(m.ajuster({ mode: "guide", recette: "R03", notes: sansRose })).includes("recette_incomplete"));
  const deux = m.ajuster({ mode: "guide", recette: "R01", notes: { ...donnees().recettes.recettes.R01.notes, santal: 5, ambre: 5 } });
  assert.ok(codes(deux).includes("trop_d_ajouts"));
});

test("mode guidé : la note ajoutée doit être compatible et reste à 10 % au plus", () => {
  const m = moteur(), r1 = donnees().recettes.recettes.R01.notes;
  const oud = m.ajuster({ mode: "guide", recette: "R01", notes: { ...r1, oud: 4 } });
  assert.ok(codes(oud).includes("association_delicate"));
  const santal = m.ajuster({ mode: "guide", recette: "R01", notes: { ...r1, santal: 30 } });
  assert.ok(santal.ok, messages(santal));
  assert.ok(santal.formule.notes.santal <= 10);
});

test("notes compatibles : les notes qui jurent sont grisées, avec la raison", () => {
  const m = moteur();
  const guide = m.notesCompatibles({ mode: "guide", recette: "R01", notes: donnees().recettes.recettes.R01.notes });
  const oud = guide.find(n => n.id === "oud"), santal = guide.find(n => n.id === "santal");
  assert.equal(oud.possible, false);
  assert.match(oud.raison, /s'accordent mal/);
  assert.equal(santal.possible, true);
  const expert = m.notesCompatibles({ mode: "expert", notes: { oud: 0, cuir: 0 } });
  assert.equal(expert.find(n => n.id === "patchouli").possible, false);
  assert.equal(expert.find(n => n.id === "ambre").possible, true);
});

test("mode expert : l'outil propose un dosage qui respecte les règles", () => {
  const m = moteur();
  for (const choix of [["bergamote", "rose", "musc_blanc", "santal"], ["mandarine", "jasmin", "vanille", "tonka", "musc_blanc"],
    ["bergamote", "poivre_rose", "iris", "jasmin", "cedre", "vetiver", "musc_blanc"]]) {
    const res = m.proposer(choix);
    assert.ok(res.ok, `${choix.join(", ")} : ${messages(res)}`);
    assert.equal(somme(Object.values(res.formule.notes)), 100);
  }
});

test("mode expert : un mélange impossible à équilibrer est refusé avec la raison", () => {
  // seul l'iris en cœur, plafonné à 12 % : aucune famille n'accepte un cœur aussi faible
  const res = moteur().proposer(["bergamote", "poivre_rose", "iris", "cedre", "vetiver", "musc_blanc"]);
  assert.equal(res.ok, false);
  assert.match(messages(res), /Pas assez de notes de cœur/);
});

test("jauge d'harmonie : score moyen des paires, de 0 à 3", () => {
  const m = moteur();
  assert.equal(m.harmonie(["bergamote", "lavande"]), 3);
  assert.equal(m.harmonie(["bergamote", "mandarine"]), 2);
  assert.equal(m.harmonie(["lavande", "rose"]), 1);
  assert.equal(m.harmonie(["rose"]), null);
});

test("entrées bizarres : jamais d'erreur technique, toujours un message simple", () => {
  const m = moteur();
  for (const f of [{}, { notes: {} }, { notes: { lilas: 50, rose: 50 } }, { mode: "guide", recette: "R99", notes: { rose: 100 } },
    { notes: ["bergamote", "rose"] }, { mode: "guide", recette: "R01", concentration: "fort", notes: null },
    { mode: "guide", recette: "constructor", notes: { rose: 50, musc_blanc: 50 } },
    { famille: "__proto__", notes: { constructor: 30, toString: 30, rose: 40 } }]) {
    const res = m.ajuster(f);
    assert.equal(res.ok, false, JSON.stringify(f));
    assert.ok(res.erreurs.length > 0);
    for (const e of res.erreurs) assert.ok(typeof e.message === "string" && !/undefined|NaN|null/.test(e.message), e.message);
  }
  // doses illisibles : traitées comme 0, la note reçoit sa dose minimum
  const res = m.ajuster({ notes: { bergamote: -5, rose: "abc", musc_blanc: null, santal: 20 } });
  assert.ok(res.ok, messages(res));
  assert.equal(somme(Object.values(res.formule.notes)), 100);
});

test("verifier refuse une formule qui dépasse une limite, même si on la donne toute faite", () => {
  const m = moteur();
  const res = m.verifier({ mode: "expert", famille: "floral", concentration: 20, notes: { bergamote: 22, rose: 33, jasmin: 12, musc_blanc: 18, santal: 15 } });
  assert.equal(res.ok, false);
  assert.ok(res.erreurs.some(e => e.code === "ifra" && e.note === "rose")); // 33 × 20 % = 6,6 % > 6 %
});
