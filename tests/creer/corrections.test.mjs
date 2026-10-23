// Corrections demandées après relecture : note réduite à puissance égale, note détestée,
// notes proposées en un clic, prix attendu sur la page de fabrication, identifiants Stripe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerConfigurateur } from "../../src/creer/configurateur.js";
import { creerFabrication } from "../../src/creer/fabrication.js";
import { controlerDonnees } from "../../src/creer/donnees.js";
import { donnees, moteur, hasard } from "./outils.mjs";

const d = donnees();
const m = moteur(d), conf = creerConfigurateur(d), atelier = creerFabrication(d);
const N = d.notes.notes;

test("association délicate entre deux notes de même puissance : la plus dosée est réduite", () => {
  // lavande et rose : même puissance (3), association délicate
  const roseDominante = m.ajuster({ mode: "expert", notes: { bergamote: 20, lavande: 10, rose: 25, iris: 10, musc_blanc: 20, cedre: 15 } });
  assert.ok(roseDominante.ok, roseDominante.erreurs.map(e => e.message).join(" / "));
  assert.ok(roseDominante.formule.notes.rose <= 17, `rose à ${roseDominante.formule.notes.rose}`);
  assert.match(roseDominante.avertissements[0].message, /La dose de rose est réduite de moitié/);

  const lavandeDominante = m.ajuster({ mode: "expert", notes: { bergamote: 15, lavande: 25, rose: 15, iris: 10, musc_blanc: 20, cedre: 15 } });
  assert.ok(lavandeDominante.ok, lavandeDominante.erreurs.map(e => e.message).join(" / "));
  assert.ok(lavandeDominante.formule.notes.lavande <= 17, `lavande à ${lavandeDominante.formule.notes.lavande}`);
  assert.match(lavandeDominante.avertissements[0].message, /La dose de lavande est réduite de moitié/);
});

test("association délicate de puissances différentes : la plus puissante reste réduite, quelle que soit la dose", () => {
  // mandarine (2) et cuir (5) : le cuir est réduit même s'il est moins dosé
  const res = m.ajuster({ mode: "expert", notes: { mandarine: 12, bergamote: 6, rose: 25, cuir: 6, ambre: 31, santal: 20 } });
  assert.ok(res.ok);
  assert.ok(res.formule.notes.cuir <= 3);
  assert.match(res.avertissements[0].message, /La dose de cuir/);
});

test("règle de réduction écrite dans regles.json et contrôlée", () => {
  assert.deepEqual(d.regles.matrice.reduire, ["puissance", "dose"]);
  const d2 = donnees();
  d2.regles.matrice.reduire = ["couleur"];
  assert.match(controlerDonnees(d2).join("\n"), /matrice.reduire/);
});

test("1 000 formules expert avec une association délicate de même puissance : la note la plus dosée respecte toujours sa limite", () => {
  const alea = hasard(77);
  const paires = [["lavande", "rose"], ["lavande", "jasmin"], ["lavande", "fleur_oranger"]];
  let acceptees = 0;
  for (let k = 0; k < 1000; k++) {
    const [a, b] = paires[k % paires.length];
    const notes = { bergamote: 5 + Math.round(alea() * 20), [a]: 2 + Math.round(alea() * 30), [b]: 2 + Math.round(alea() * 30),
      iris: 3 + Math.round(alea() * 9), musc_blanc: 10 + Math.round(alea() * 20), cedre: 5 + Math.round(alea() * 20) };
    const res = m.ajuster({ mode: "expert", concentration: 15 + Math.floor(alea() * 11) / 2, notes });
    if (!res.ok) continue;
    acceptees++;
    const f = res.formule.notes, forte = f[a] >= f[b] ? a : b;
    assert.ok(f[forte] <= N[forte].dose_max * d.regles.matrice.reduction_note_forte + 1e-9, `${JSON.stringify(f)}`);
    assert.ok(m.verifier(res.formule).ok);
    assert.deepEqual(m.ajuster(res.formule).formule.notes, f, "deuxième passage identique");
  }
  assert.ok(acceptees > 100, `${acceptees} acceptées`);
});

test("mode guidé : la note détestée n'est jamais proposée dans « Ajouter une note »", () => {
  for (const id of Object.keys(d.recettes.recettes)) {
    const toutes = conf.notesAjoutables(id).map(n => n.id);
    for (const detestee of toutes) {
      const proposees = conf.notesAjoutables(id, { detestee }).map(n => n.id);
      assert.ok(!proposees.includes(detestee), `${id} propose ${detestee}`);
      assert.equal(proposees.length, toutes.length - 1);
    }
  }
  // une note à la fois adorée et détestée : on ne l'ajoute pas
  const [p] = conf.choisirRecettes({ ambiance: "gourmande", adoree: "rose", detestee: "rose" });
  assert.notEqual(p.ajout, "rose");
});

test("mode expert : il manque un étage → les notes qui règlent le problème, en un clic", () => {
  const formule = { mode: "expert", notes: { bergamote: 20, rose: 30, musc_blanc: 50 } };
  const res = m.ajuster(formule);
  assert.equal(res.ok, false);
  const s = conf.suggestions(formule, res);
  const fond = s.find(x => x.etage === "fond");
  assert.ok(fond, JSON.stringify(s));
  assert.match(fond.titre, /Ajoute une note de fond/);
  assert.ok(fond.notes.length > 0 && fond.notes.length <= 4);
  // chaque note proposée est bien de fond, compatible, et ajoutée elle règle ce manque
  for (const n of fond.notes) {
    assert.equal(N[n.id].etage, "fond");
    const apres = m.ajuster({ ...formule, notes: { ...formule.notes, [n.id]: 0 } });
    assert.ok(!apres.erreurs.some(e => e.code === "etage_incomplet" && e.etage === "fond"), n.id);
  }
  // « Ajoute une note » n'apparaît pas en plus quand un étage précis manque
  assert.ok(!s.some(x => x.manque === "trop_peu_de_notes"));
});

test("mode expert : sans note de tenue → musc blanc ou ambre proposés ; sans tête ni cœur → les deux proposés", () => {
  const sansTenue = { mode: "expert", notes: { bergamote: 20, rose: 30, santal: 25, cedre: 25 } };
  const s1 = conf.suggestions(sansTenue, m.ajuster(sansTenue));
  const tenue = s1.find(x => x.manque === "tenue");
  assert.ok(tenue);
  assert.ok(tenue.notes.every(n => ["musc_blanc", "ambre"].includes(n.id)) && tenue.notes.length >= 1);

  const fondSeul = { mode: "expert", notes: { musc_blanc: 50, santal: 50 } };
  const s2 = conf.suggestions(fondSeul, m.ajuster(fondSeul));
  assert.ok(s2.some(x => x.etage === "tete") && s2.some(x => x.etage === "coeur"), JSON.stringify(s2));
  // une note qui jure n'est jamais proposée (patchouli : interdit avec oud + cuir ; mandarine : 2 associations délicates)
  const avecOud = { mode: "expert", notes: { oud: 0, cuir: 0 } };
  for (const sug of conf.suggestions(avecOud, m.ajuster(avecOud)))
    for (const n of sug.notes) assert.ok(n.id !== "patchouli" && n.id !== "mandarine", n.id);
});

test("mode expert : formule valable → aucune suggestion", () => {
  const res = m.proposer(["bergamote", "rose", "jasmin", "musc_blanc", "santal"]);
  assert.ok(res.ok);
  assert.deepEqual(conf.suggestions(res.formule, res), []);
});

test("page de fabrication : produit et prix prévu affichés pour comparer avec Stripe", () => {
  const cent = atelier.preparerFiche("R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V100");
  assert.deepEqual(cent.produit, { cle: "flacon_100", nom: "Flacon 100 ml", prix_eur: 48 });
  assert.deepEqual(atelier.preparerFiche("R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V50").produit, { cle: "flacon_50", nom: "Flacon 50 ml", prix_eur: 32 });
  assert.deepEqual(atelier.preparerFiche("R01-BER22-MAN18-FLO25-MUS20-CED15-C18-KIT").produit, { cle: "kit", nom: "Kit d'échantillons", prix_eur: 10 });
});

test("boutique.json : identifiants des liens Stripe contrôlés (plink_…)", () => {
  const d2 = donnees();
  d2.boutique.liens_stripe_ids.kit = "https://buy.stripe.com/abc";
  d2.boutique.liens_stripe_ids.flacon_50 = "plink_1Abc";
  const pb = controlerDonnees(d2).join("\n");
  assert.match(pb, /identifiant Stripe « kit »/);
  assert.ok(!/identifiant Stripe « flacon_50 »/.test(pb));
});
