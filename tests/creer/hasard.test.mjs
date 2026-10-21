/*
 * Test du cahier des charges : 1 000 formules au hasard (et 1 000 en mode guidé).
 * Pour chaque formule acceptée, on recalcule nous-mêmes chaque règle à partir des
 * fichiers de données, sans faire confiance au moteur.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { donnees, moteur, hasard, somme } from "./outils.mjs";

const d = donnees();
const m = moteur(d);
const N = d.notes.notes, R = d.regles, REC = d.recettes.recettes;
const ids = Object.keys(N);
const cle = (a, b) => [a, b].sort().join("|");
const score = new Map();
for (const [liste, s] of [["accords", 3], ["risquees", 1], ["interdites", 0]])
  for (const g of d.compatibilite[liste]) if (g.length === 2) score.set(cle(...g), s);
const scorePaire = (a, b) => score.get(cle(a, b)) ?? d.compatibilite.score_par_defaut;

// Contrôle indépendant de toutes les règles sur une formule acceptée.
function controler(res, origine) {
  const f = res.formule, c = f.concentration, choix = Object.keys(f.notes);
  const dire = quoi => `${quoi} — ${JSON.stringify(origine)} → ${JSON.stringify(f)}`;
  assert.equal(somme(Object.values(f.notes)), 100, dire("total différent de 100 %"));
  assert.ok(c >= R.concentration.min && c <= R.concentration.max, dire("concentration hors plage"));
  assert.ok(choix.length >= R.nombre_notes.min && choix.length <= R.nombre_notes.max, dire("nombre de notes"));
  for (const id of choix) {
    const v = f.notes[id], n = N[id];
    assert.ok(v * c / 100 <= n.ifra_max + 1e-9, dire(`plafond IFRA dépassé pour ${id}`));
    assert.ok(v >= n.dose_min && v <= n.dose_max, dire(`dose hors limites pour ${id}`));
    assert.ok(Number.isInteger(v / R.pas_pourcentage), dire(`dose de ${id} pas arrondie`));
  }
  const etages = { tete: 0, coeur: 0, fond: 0 };
  for (const id of choix) etages[N[id].etage] += f.notes[id];
  const eq = R.equilibre[f.famille];
  for (const e of ["tete", "coeur", "fond"]) {
    assert.ok(etages[e] >= eq[e][0] && etages[e] <= eq[e][1], dire(`équilibre ${e} à ${etages[e]}`));
    assert.ok(choix.filter(id => N[id].etage === e).length >= R.minimum_par_etage[e], dire(`pas assez de notes de ${e}`));
  }
  assert.ok(etages.fond >= R.fond_minimum, dire("fond sous le minimum"));
  assert.ok(R.notes_de_tenue.some(id => choix.includes(id)), dire("pas de note de tenue"));
  const percu = choix.map(id => f.notes[id] * N[id].puissance), tot = somme(percu);
  percu.forEach((p, i) => assert.ok(p / tot * 100 <= R.puissance.part_max_par_note + 1e-9, dire(`${choix[i]} écrase les autres`)));
  assert.ok(choix.filter(id => N[id].puissance >= R.puissance.fortes_a_partir_de).length <= R.puissance.fortes_max, dire("trop de notes fortes"));
  for (const g of R.associations_interdites) assert.ok(!g.every(id => choix.includes(id)), dire("association interdite"));
  let t = 0, n = 0, risquees = 0;
  for (let i = 0; i < choix.length; i++)
    for (let j = i + 1; j < choix.length; j++) {
      const s = scorePaire(choix[i], choix[j]);
      assert.notEqual(s, 0, dire("paire interdite"));
      if (s === 1) risquees++;
      t += s; n++;
    }
  for (const g of d.compatibilite.risquees) if (g.length > 2 && g.every(id => choix.includes(id))) risquees++;
  assert.ok(t / n >= R.matrice.moyenne_min - 1e-9, dire("harmonie trop basse"));
  assert.ok(risquees <= R.matrice.risquees_max[f.mode], dire("trop d'associations délicates"));
  assert.ok(m.verifier(f).ok, dire("verifier refuse la formule corrigée"));
  // Corriger une formule déjà correcte ne doit rien changer.
  assert.deepEqual(m.ajuster(f).formule.notes, f.notes, dire("deuxième passage différent"));
}

function verifierRefus(res, origine) {
  assert.ok(res.erreurs.length > 0, `refus sans message — ${JSON.stringify(origine)}`);
  for (const e of res.erreurs)
    assert.ok(typeof e.message === "string" && e.message.length > 5 && !/undefined|NaN|null|\[object/.test(e.message), `message douteux : ${e.message}`);
}

test("1 000 formules expert au hasard : aucune règle n'est jamais enfreinte", () => {
  const alea = hasard(2026);
  let acceptees = 0;
  for (let k = 0; k < 1000; k++) {
    const nb = 3 + Math.floor(alea() * 5);
    const melange = [...ids].sort(() => alea() - 0.5).slice(0, nb);
    const formule = {
      mode: "expert",
      concentration: Math.round((14 + alea() * 7) * 2) / 2, // parfois hors de 15–20 exprès
      notes: Object.fromEntries(melange.map(id => [id, Math.round(alea() * 40)])),
    };
    const res = m.ajuster(formule);
    if (res.ok) { acceptees++; controler(res, formule); } else verifierRefus(res, formule);
  }
  // Des notes tirées sans règle forment rarement un parfum possible : on vérifie surtout les refus.
  assert.ok(acceptees >= 20, `seulement ${acceptees} formules acceptées sur 1 000`);
});

test("1 000 formules expert construites autour de règles respectées : la plupart passent", () => {
  // Tirage plus réaliste : 1–2 têtes, 1–2 cœurs, 2–3 fonds dont musc blanc ou ambre.
  const alea = hasard(51);
  const parEtage = e => ids.filter(id => N[id].etage === e);
  const pioche = (liste, k) => [...liste].sort(() => alea() - 0.5).slice(0, k);
  let acceptees = 0;
  for (let k = 0; k < 1000; k++) {
    const tenue = alea() < 0.5 ? "musc_blanc" : "ambre";
    const choix = [...pioche(parEtage("tete"), 1 + Math.floor(alea() * 2)), ...pioche(parEtage("coeur"), 1 + Math.floor(alea() * 2)),
      tenue, ...pioche(parEtage("fond").filter(id => id !== tenue), 1 + Math.floor(alea() * 2))];
    const formule = { mode: "expert", concentration: 15 + Math.floor(alea() * 6), notes: Object.fromEntries(choix.map(id => [id, 1 + Math.round(alea() * 35)])) };
    const res = m.ajuster(formule);
    if (res.ok) { acceptees++; controler(res, formule); } else verifierRefus(res, formule);
  }
  assert.ok(acceptees >= 200, `seulement ${acceptees} formules acceptées sur 1 000`);
});

test("1 000 réglages au hasard en mode guidé : la recette est respectée", () => {
  const alea = hasard(7);
  const recettes = Object.keys(REC);
  let acceptees = 0;
  for (let k = 0; k < 1000; k++) {
    const rid = recettes[Math.floor(alea() * recettes.length)], r = REC[rid];
    const notes = Object.fromEntries(Object.entries(r.notes).map(([id, v]) => [id, Math.max(0, v + Math.round((alea() - 0.5) * 30))]));
    if (alea() < 0.5) {
      const possibles = m.notesCompatibles({ mode: "guide", recette: rid, notes: r.notes }).filter(n => n.possible);
      if (possibles.length) notes[possibles[Math.floor(alea() * possibles.length)].id] = Math.round(alea() * 20);
    }
    const formule = { mode: "guide", recette: rid, concentration: 15 + Math.floor(alea() * 11) / 2, notes };
    const res = m.ajuster(formule);
    if (!res.ok) { verifierRefus(res, formule); continue; }
    acceptees++;
    controler(res, formule);
    const marge = r.marge ?? R.guide.marge_defaut;
    for (const [id, v] of Object.entries(res.formule.notes)) {
      if (id in r.notes) {
        const cap = N[id].ifra_max * 100 / res.formule.concentration;
        assert.ok(v <= r.notes[id] + marge, `${rid} : ${id} au-dessus de la marge`);
        assert.ok(v >= r.notes[id] - marge || v >= Math.floor(cap) - 1e-9 || v === N[id].dose_min, `${rid} : ${id} sous la marge`);
      } else assert.ok(v <= R.guide.ajout_dose_max, `${rid} : note ajoutée ${id} trop dosée`);
    }
  }
  assert.ok(acceptees >= 900, `seulement ${acceptees} réglages acceptés sur 1 000`);
});
