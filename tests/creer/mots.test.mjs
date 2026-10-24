// Tournures interdites (§ 0) : « comme » seul est permis, « comme » + nom de parfum ou de marque ne l'est pas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerControleTextes } from "../../src/creer/mots.js";
import { donnees, lireSite } from "./outils.mjs";

const ctl = creerControleTextes(lireSite("parfums"));
const d = donnees();

test("toujours interdits : dupe, copie, réplique, imitation, contretype, clone", () => {
  for (const t of ["Le meilleur dupe du moment", "Une COPIE parfaite", "réplique fidèle", "Pas une imitation", "un contretype", "Clones en série", "des dupes"])
    assert.equal(ctl.tournures(t)[0]?.type, "toujours", t);
});

test("interdits à côté d'un nom de parfum ou de marque", () => {
  const interdits = [
    "Il sent comme Libre d'Yves Saint Laurent.",
    "Un parfum comme Sauvage",
    "sent comme Baccarat Rouge 540",
    "Inspiré de Black Opium",
    "inspirée du parfum Libre",
    "Identique à La Vie est Belle",
    "Une version de Good Girl",
    "L'équivalent de Aventus",
    "Une alternative à Dior",
    "comme le fameux Light Blue",
    "C'est comme du Chanel",
  ];
  for (const t of interdits) assert.ok(ctl.tournures(t).length > 0, t);
});

test("« comme » seul, ou suivi d'un mot courant, reste permis", () => {
  const permis = [
    "Doux comme une caresse, il reste près de la peau.",
    "Puissant comme un orage d'été.",
    "Comme au premier jour.",
    "Une rose fraîche comme la rosée du matin.",
    "Un départ vif, comme un zeste qu'on presse.",
    "Libre à toi de choisir la version de ton parfum qui te plaît.",
    "Bois sec et net, aux accents de crayon taillé.",
  ];
  for (const t of permis) assert.deepEqual(ctl.tournures(t), [], t);
});

test("noms de marque et de parfum repérés n'importe où", () => {
  assert.deepEqual(ctl.marquesCitees("Un sillage digne de Tom Ford"), ["tom ford"]);
  assert.ok(ctl.marquesCitees("Dolce & Gabbana").length > 0);
  assert.ok(ctl.parfumsCites("Mon préféré reste Baccarat Rouge 540").length > 0);
  assert.deepEqual(ctl.parfumsCites("un orage d'été"), []);
  assert.equal(ctl.propre("Une eau de parfum boisée et douce, préparée à la main."), true);
  assert.equal(ctl.propre("Une eau de parfum façon Tom Ford."), false);
});

test("tous les textes affichés par l'outil sont propres (notes, recettes, structures, étiquette, boutique)", () => {
  const textes = [];
  for (const n of Object.values(d.notes.notes)) textes.push(n.nom, n.texte);
  for (const r of Object.values(d.recettes.recettes)) textes.push(r.nom);
  for (const s of Object.values(d.structures.structures)) textes.push(s.nom, s.remarque || "");
  for (const e of d.exceptions.exceptions) textes.push(e.raison);
  for (const g of d.exceptions.groupes) textes.push(g.raison);
  textes.push(...Object.values(d.facettes.facettes), ...Object.values(d.matrice_sf.sous_familles).map(s => s.nom));
  const et = d.regles.etiquette;
  textes.push(et.inci_alcool, et.inci_parfum, et.fonction, et.precautions);
  textes.push(d.boutique.delai, d.boutique.kit_deduit);
  for (const t of textes) assert.ok(ctl.propre(t) && ctl.tournures(t).length === 0, t);
});
