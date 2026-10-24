/*
 * 10 000 formules au hasard (3 à 12 notes, doses au hasard, concentration de 14 à 21 %).
 * Chaque résultat du moteur est comparé à un second calcul, écrit ici sans réutiliser le moteur :
 *   - une formule acceptée ne dépasse aucune limite ;
 *   - une formule refusée enfreint au moins une règle ;
 *   - un allergène est étiqueté si et seulement s'il dépasse 0,001 % du parfum fini.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerMoteur } from "../../src/creer/moteur.js";
import { donnees, hasard } from "./outils.mjs";

const haut = v => (Array.isArray(v) ? Math.max(...v) : v);

// Second calcul, indépendant du moteur : la liste des règles enfreintes.
function regles(d, formule) {
  const N = new Map(Object.values(d.notes.notes).map(n => [n.code, n]));
  const lots = new Map(d.matieres_lots.lots.filter(l => l.demo).map(l => [l.code_note, l]));
  const subst = d.ifra_cat4.substances;
  const allerg = new Map(d.allergenes.allergenes.map(a => [a.id, a]));
  const R = d.regles;
  const c = formule.concentration;
  const notes = Object.entries(formule.notes);
  const enfreintes = [];
  if (!(c >= R.concentration.min && c <= R.concentration.max && Number.isInteger(c))) enfreintes.push("concentration");
  if (notes.length < R.nombre_notes.min || notes.length > R.nombre_notes.max) enfreintes.push("nombre de notes");
  const total = notes.reduce((s, [, p]) => s + p, 0);
  if (Math.abs(total - 100) > 1e-6) enfreintes.push("total");
  const sommes = {}, legal = {};
  for (const [code, p] of notes) {
    const n = N.get(code);
    if (Math.abs(p * 2 - Math.round(p * 2)) > 1e-6) enfreintes.push(`pas ${code}`);
    if (!d.features.vagues_actives.includes(n.vague)) { enfreintes.push(`vague ${code}`); continue; }
    if (p > n.dose_max + 1e-9) enfreintes.push(`dose_max ${code}`);
    const lot = lots.get(code);
    const produit = (p * c) / 100; // % de cette huile dans le parfum fini
    if (produit > lot.ifra_cat4_max_pct_produit + 1e-9) enfreintes.push(`certificat ${code}`);
    for (const [s, w] of Object.entries(lot.substances_ifra_pct)) sommes[s] = (sommes[s] || 0) + produit * haut(w) / 100;
    if (code === "BER" && lot.fcf !== true) sommes.huile_bergamote_exprimee = (sommes.huile_bergamote_exprimee || 0) + produit;
    for (const [a, w] of Object.entries(lot.allergenes_pct)) legal[a] = (legal[a] || 0) + produit * haut(w) / 100;
  }
  for (const [s, v] of Object.entries(sommes)) if (v > subst[s].limite_pct * (1 + 1e-12) + 1e-12) enfreintes.push(`IFRA ${s}`);
  for (const [a, v] of Object.entries(legal)) {
    const max = allerg.get(a).max_pct_produit;
    if (max !== undefined && v > max * (1 + 1e-12) + 1e-12) enfreintes.push(`loi ${a}`);
  }
  return { enfreintes, allergenes: legal };
}

// Doses au hasard, ramenées à 100 au pas de 0,5 (chaque note garde au moins 0,5).
function doses(alea, codes, N, style) {
  const brut = codes.map(c => (style === 0 ? alea() : style === 1 ? (0.2 + alea()) * N.get(c).dose_max : alea() ** 3 + 0.01));
  const t = brut.reduce((s, v) => s + v, 0);
  const demi = brut.map(v => Math.max(1, Math.floor((v / t) * 200)));
  let reste = 200 - demi.reduce((s, v) => s + v, 0);
  for (let i = 0; reste !== 0 && i < 10000; i++) {
    const k = i % demi.length;
    if (reste > 0) { demi[k]++; reste--; } else if (demi[k] > 1) { demi[k]--; reste++; }
  }
  return Object.fromEntries(codes.map((c, i) => [c, demi[i] / 2]));
}

test("10 000 formules au hasard : le moteur accepte exactement celles qui respectent toutes les règles", () => {
  const alea = hasard(2026);
  const scenarios = [[1], [1, 2], [1, 2, 3]].map(v => {
    const d = donnees();
    d.features.vagues_actives = v;
    const N = new Map(Object.values(d.notes.notes).map(n => [n.code, n]));
    return { d, m: creerMoteur(d), N, ouvertes: [...N.values()].filter(n => v.includes(n.vague)).map(n => n.code) };
  });
  const tous = [...scenarios[0].N.keys()];
  let acceptees = 0, refusees = 0, etiquetes = 0;
  for (let k = 0; k < 10000; k++) {
    const { d, m, N, ouvertes } = scenarios[k % 3];
    const nb = 3 + Math.floor(alea() * 10);
    // 9 fois sur 10 : notes des vagues ouvertes seulement ; sinon n'importe lesquelles des 58
    const pool = alea() < 0.9 ? [...ouvertes] : [...tous];
    const codes = [];
    while (codes.length < nb) codes.push(pool.splice(Math.floor(alea() * pool.length), 1)[0]);
    let notes = doses(alea, codes, N, k % 4 === 0 ? 0 : k % 4 === 1 ? 2 : 1);
    // 1 fois sur 20 : doses brutes (pas au pas de 0,5, total pas forcément 100)
    if (k % 20 === 7) notes = Object.fromEntries(codes.map(c => [c, Math.round(alea() * 3000) / 100 + 0.01]));
    const formule = { concentration: 14 + Math.floor(alea() * 8), notes };

    const s = m.securite(formule);
    const ref = regles(d, formule);
    assert.equal(s.ok, ref.enfreintes.length === 0,
      `${JSON.stringify(formule)}\nmoteur : ${s.erreurs.map(e => e.code).join(", ") || "accepté"}\nsecond calcul : ${ref.enfreintes.join(", ") || "accepté"}`);
    if (s.ok) acceptees++; else { refusees++; assert.ok(s.erreurs.length >= 1); }

    // Étiquetage : si et seulement si plus de 0,001 % (seulement pour les notes des vagues ouvertes).
    if (!ref.enfreintes.some(e => e.startsWith("vague"))) {
      const attendu = Object.entries(ref.allergenes).filter(([, v]) => v > 0.001).map(([a]) => a).sort();
      assert.deepEqual(s.allergenes.a_etiqueter.map(a => a.id).sort(), attendu);
      etiquetes += attendu.length;
    }
  }
  assert.ok(acceptees >= 1000 && refusees >= 1000, `${acceptees} acceptées, ${refusees} refusées`);
  assert.ok(etiquetes > 0);
});

test("formules acceptées au hasard : chaque limite chiffrée est respectée, marge comprise entre 0 et 1", () => {
  const alea = hasard(7);
  const d = donnees({ toutesVagues: true });
  const m = creerMoteur(d);
  const recettes = Object.values(d.recettes.recettes);
  let vues = 0;
  for (let k = 0; k < 2000; k++) {
    // une recette un peu bousculée : ±5 points sur deux notes
    const r = recettes[k % recettes.length];
    const notes = { ...r.notes };
    const cles = Object.keys(notes);
    for (let j = 0; j < 2; j++) {
      const c = cles[Math.floor(alea() * cles.length)];
      notes[c] = Math.max(0.5, notes[c] + (alea() < 0.5 ? -5 : 5));
    }
    const formule = { concentration: 15 + Math.floor(alea() * 6), notes: m.normaliser(notes) };
    const s = m.securite(formule);
    if (!s.ok) continue;
    vues++;
    for (const x of s.marges) assert.ok(x.valeur <= x.limite * (1 + 1e-12) + 1e-12 && x.marge >= -1e-12 && x.marge <= 1, JSON.stringify(x));
    assert.ok(s.marge_min >= -1e-12);
  }
  assert.ok(vues > 500, `${vues} formules acceptées`);
});

test("corriger : sur 1 000 formules refusées au hasard, la variante proposée est toujours conforme", () => {
  const alea = hasard(99);
  const d = donnees({ toutesVagues: true });
  const m = creerMoteur(d);
  const tous = Object.values(d.notes.notes).map(n => n.code);
  let corrigees = 0, essais = 0;
  while (essais < 1000) {
    const nb = 3 + Math.floor(alea() * 8);
    const pool = [...tous], codes = [];
    while (codes.length < nb) codes.push(pool.splice(Math.floor(alea() * pool.length), 1)[0]);
    const formule = { concentration: 14 + Math.floor(alea() * 8), notes: Object.fromEntries(codes.map(c => [c, 1 + Math.floor(alea() * 40)])) };
    if (m.securite(formule).ok) continue;
    essais++;
    const r = m.corriger(formule);
    if (r.ok) { corrigees++; assert.ok(m.securite(r.formule).ok, JSON.stringify(r.formule)); }
  }
  assert.ok(corrigees > 500, `${corrigees} corrigées sur 1000`);
});
