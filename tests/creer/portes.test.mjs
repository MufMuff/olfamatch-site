// Les 5 portes d'entrée (§ B8) : chaque formule proposée passe par le moteur et finit sur l'écran Récap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerPortes } from "../../src/creer/portes.js";
import { creerControleTextes } from "../../src/creer/mots.js";
import { donnees, moteur, lireSite } from "./outils.mjs";

const PARFUMS = lireSite("parfums");
const ACCORDS = lireSite("accords");
const ctl = creerControleTextes(PARFUMS);
const monter = (modifier = () => {}) => {
  const d = donnees();
  modifier(d);
  const m = moteur(d);
  return { d, m, p: creerPortes(d, m) };
};
const tout = () => monter(d => { d.features.vagues_actives = [1, 2, 3]; });
const somme = notes => Object.values(notes).reduce((s, v) => s + v, 0);
const valide = (m, f) => {
  assert.equal(somme(f.notes), 100);
  assert.ok(m.securite(f).ok, JSON.stringify(f) + " " + m.securite(f).erreurs.map(e => e.message).join(" / "));
};

test("portes visibles : P1 seulement avec l'interrupteur inspiration_nommee", () => {
  assert.deepEqual(monter().p.portesVisibles().map(x => x.id), ["P2", "P3", "P4", "P5"]);
  const avec = monter(d => { d.features.inspiration_nommee = true; });
  assert.deepEqual(avec.p.portesVisibles().map(x => x.id), ["P1", "P2", "P3", "P4", "P5"]);
  // interrupteur coupé : pas de liste de parfums, pas de couverture
  const sans = monter();
  assert.deepEqual(sans.p.parfumsInspiration(PARFUMS), []);
  assert.equal(sans.p.couverture("libre-yves-saint-laurent"), null);
});

test("P4 : catalogue par famille, seulement les recettes des vagues actives", () => {
  const { p, d } = monter();
  const toutes = p.catalogue();
  assert.equal(toutes.length, 13);
  assert.ok(toutes.every(r => r.vague === 1));
  const familles = p.familles().map(f => f.id);
  for (const f of familles) assert.ok(p.catalogue(f).every(r => d.structures.structures[r.structure].famille === f));
  assert.equal(familles.reduce((s, f) => s + p.catalogue(f).length, 0), 13);
  assert.equal(tout().p.catalogue().length, 36);
});

test("P4 : remplacer une note par une autre du même étage, ou ±5 points ; recalcul en direct", () => {
  const { p, m } = monter();
  const f = p.formuleRecette("R01");
  const choix = p.remplacants(f, "CIT");
  assert.ok(choix.length > 0 && choix.every(c => m.note(c.code).etage === "tete" && !(c.code in f.notes)));
  assert.deepEqual(choix.map(c => c.harmonie), [...choix.map(c => c.harmonie)].sort((a, b) => b - a));
  const g = p.remplacer(f, "CIT", choix[0].code);
  assert.ok(!("CIT" in g.notes) && choix[0].code in g.notes);
  valide(m, g);
  const plus = p.ajusterNote(f, "JAS", 5);
  assert.equal(plus.notes.JAS, 10);
  valide(m, plus);
  const moins = p.ajusterNote(f, "MUS", -5);
  assert.equal(moins.notes.MUS, 15);
  valide(m, moins);
});

test("P5 : curseurs ramenés à 100 et bloqués à la limite de sécurité", () => {
  const { p, m } = tout();
  let f = p.proposerDoses(["BER", "LAV", "TON", "MUS"], { concentration: 20 });
  valide(m, f);
  // on pousse la tonka très haut : elle s'arrête à sa limite (dose_max et coumarine)
  const g = p.reglerNote(f, "TON", 60);
  valide(m, g);
  assert.ok(g.notes.TON <= 20 && g.notes.TON >= 15, String(g.notes.TON));
  // ajouter puis retirer une note
  f = p.ajouterNote(f, "ROS");
  valide(m, f);
  assert.equal(f.notes.ROS, 10);
  f = p.retirerNote(f, "ROS");
  assert.ok(!("ROS" in f.notes) && somme(f.notes) === 100);
});

test("P5 : notes manquantes proposées en un clic (étage vide, trop peu de notes)", () => {
  const { p, m } = monter();
  const f = p.proposerDoses(["BER", "ROS"]);
  const s = p.suggestions(f);
  const fond = s.find(x => x.etage === "fond");
  assert.ok(fond && fond.notes.length > 0 && fond.notes.length <= 4);
  assert.ok(fond.notes.every(n => m.note(n.code).etage === "fond"));
  assert.deepEqual(p.suggestions(p.formuleRecette("R01")), []);
  assert.equal(p.suggestions({ concentration: 18, notes: {} }).length, 0);
});

test("P2 : 8 ambiances, chacune propose jusqu'à 3 recettes ; « décris-le avec tes mots » passe par l'IA", () => {
  const { p } = tout();
  const amb = p.ambiances();
  assert.equal(amb.length, 8);
  for (const a of amb) {
    const r = p.recettesAmbiance(a.id);
    assert.ok(r.length >= 1 && r.length <= 3, a.id);
  }
  assert.ok(p.recettesAmbiance("plage").every(r => ["S9", "S1"].includes(r.structure)));
  // réponse de l'IA : structure, notes voulues et évitées, intensité
  const rep = p.depuisComprehension({ structure_code: "S6", notes_codes: ["CAF"], notes_evitees: ["FRB"], intensite: "forte" });
  assert.equal(rep.concentration, 20);
  assert.ok(rep.recettes.length > 0);
  assert.ok(rep.recettes.every(r => !r.notes.some(n => n.code === "FRB")));
  assert.ok(p.depuisComprehension({ notes_evitees: ["PAT"], notes_codes: ["CAF"] }).recettes.every(r => !r.notes.some(n => n.code === "PAT")));
  assert.equal(rep.recettes[0].code, "R18", "café vanille d'abord");
  // vague 1 seule : les ambiances sans recette disponible ne s'affichent pas
  assert.ok(monter().p.ambiances().length <= 8);
});

test("P3 : quiz de 6 questions → 2 structures et leurs recettes, sans la note détestée", () => {
  const { p } = monter();
  const q = p.quiz();
  assert.equal(q.length, 6);
  const soir = p.resultatQuiz({ moment: "soir", saison: "hiver", temperature: "chaud", sucre: "oui", fleurs: "non", sillage: "fort" });
  assert.deepEqual(soir.structures.map(s => s.code), ["S4", "S6"]);
  assert.equal(soir.concentration, 20);
  assert.ok(soir.recettes.length > 0);
  const jour = p.resultatQuiz({ moment: "jour", saison: "ete", temperature: "frais", sucre: "non", fleurs: "non", sillage: "discret" });
  assert.deepEqual(jour.structures.map(s => s.code), ["S1", "S9"]);
  assert.equal(jour.concentration, 16);
  // la note détestée n'apparaît dans aucune recette proposée
  for (const detestee of ["BER", "MUS", "CED"]) {
    const r = p.resultatQuiz({ moment: "jour", temperature: "frais" }, { detestee });
    assert.ok(r.recettes.every(x => !x.notes.some(n => n.code === detestee)), detestee);
  }
});

test("réglages repris du mode guidé V1 : fraîcheur et douceur, formule toujours conforme", () => {
  const { p, m } = monter();
  const f = p.formuleRecette("R10");
  const frais = p.appliquerCurseurs(f, { fraicheur: -1 });
  const chaud = p.appliquerCurseurs(f, { fraicheur: 1 });
  valide(m, frais);
  valide(m, chaud);
  assert.ok(m.etages(frais).tete > m.etages(chaud).tete);
  const doux = p.appliquerCurseurs(f, { douceur: 1 });
  valide(m, doux);
  assert.ok(doux.notes.VAN >= f.notes.VAN);
});

test("P1 : notes publiées couvertes, formule dans la structure la plus proche, curseurs d'étages et d'intensité", () => {
  const { p, m } = monter(d => { d.features.inspiration_nommee = true; d.features.vagues_actives = [1, 2, 3]; });
  const liste = p.parfumsInspiration(PARFUMS);
  assert.deepEqual(liste.map(x => x.slug).sort(), ["baccarat-rouge-540-maison-francis-kurkdjian", "libre-yves-saint-laurent", "sauvage-dior"]);
  const cv = p.couverture("libre-yves-saint-laurent");
  assert.equal(cv.total, 11);
  assert.equal(cv.couvertes, 11);
  const sauvage = p.couverture("sauvage-dior");
  assert.ok(sauvage.couvertes < sauvage.total, "poivre, poivre de Sichuan, élémi ne sont pas couverts");
  assert.equal(sauvage.etages.tete.find(n => n.nom === "poivre").couverte, false);
  const prop = p.proposerDepuisNotes(cv.codes);
  valide(m, prop.formule);
  assert.ok(Object.keys(prop.formule.notes).length <= 12);
  // curseurs tête / cœur / fond et intensité
  const plusFond = p.reglerEtages(prop.formule, { tete: 15, coeur: 25, fond: 60 });
  valide(m, plusFond);
  assert.ok(p.partsEtages(plusFond).fond > p.partsEtages(prop.formule).fond);
  assert.equal(p.reglerIntensite(prop.formule, 25).concentration, 20);
  // vague 1 seule : moins de notes couvertes
  const v1 = monter(d => { d.features.inspiration_nommee = true; });
  assert.ok(v1.p.couverture("libre-yves-saint-laurent").couvertes < 11);
  // un parfum sans notes publiées mais avec des accords : la structure la plus proche
  const acc = p.proposerDepuisAccords(ACCORDS["la-vie-est-belle-lancome"]);
  assert.ok(acc && acc.formule);
  valide(m, acc.formule);
});

test("P1 : correspondances sans accent ni majuscule ; une note sans équivalent reste non couverte", () => {
  const { p } = monter();
  assert.equal(p.codeDe("Cèdre"), "CED");
  assert.equal(p.codeDe("ORANGE BLOSSOM"), "FLO");
  assert.equal(p.codeDe("ambroxan"), "AMX");
  assert.equal(p.codeDe("poivre noir"), null);
});

test("écran Récap : pyramide, harmonie et libellé, conformité, commande selon la porte, description propre", () => {
  const { p } = monter();
  const r = p.recap(p.formuleRecette("R01"), { porte: "P4" });
  assert.deepEqual(r.pyramide.fond.map(n => n.code), ["MUS", "CED"]);
  assert.equal(r.harmonie.libelle, "bon");
  assert.equal(r.conforme, true);
  assert.equal(r.commande, "oui");
  assert.ok(ctl.propre(r.description) && !/\d/.test(r.description), r.description);
  // une formule déconseillée : bloquée en P2, confirmation en P5
  const mauvaise = { concentration: 18, notes: { CIT: 10, CAF: 10, VAN: 30, AMB: 20, MUS: 30 } };
  const t = tout().p;
  assert.equal(t.recap(mauvaise, { porte: "P2" }).commande, "non");
  assert.equal(t.recap(mauvaise, { porte: "P5" }).commande, "avec_confirmation");
  assert.equal(t.recap(mauvaise, { porte: "P5", confirme: true }).commande, "oui");
});

test("parcours au hasard dans les 5 portes : chaque formule qui arrive au Récap est conforme", () => {
  const { p, m } = monter(d => { d.features.inspiration_nommee = true; d.features.vagues_actives = [1, 2, 3]; });
  const formules = [];
  for (const a of p.ambiances()) for (const r of p.recettesAmbiance(a.id)) formules.push(p.appliquerCurseurs(p.formuleRecette(r.code), { fraicheur: 0.5, douceur: -0.5 }));
  for (const r of p.catalogue()) formules.push(p.ajusterNote(p.formuleRecette(r.code), Object.keys(r.notes.length ? p.formuleRecette(r.code).notes : {})[0], 5));
  for (const slug of ["libre-yves-saint-laurent", "sauvage-dior", "baccarat-rouge-540-maison-francis-kurkdjian"]) formules.push(p.proposerDepuisNotes(p.couverture(slug).codes).formule);
  const q = p.resultatQuiz({ moment: "soir", fleurs: "oui" });
  for (const r of q.recettes) formules.push(p.appliquerCurseurs(p.formuleRecette(r.code, q.concentration), {}));
  for (const f of formules) valide(m, f);
  assert.ok(formules.length > 50);
});
