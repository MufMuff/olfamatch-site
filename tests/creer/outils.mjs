// Outils communs aux tests de « Crée ton parfum » V2.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { creerMoteur } from "../../src/creer/moteur.js";
import { FICHIERS } from "../../src/creer/donnees.js";

const dossier = new URL("../../data/creer/", import.meta.url);
export const lire = nom => JSON.parse(readFileSync(fileURLToPath(new URL(`${nom}.json`, dossier)), "utf8"));
export const lireSite = nom => JSON.parse(readFileSync(fileURLToPath(new URL(`../../data/${nom}.json`, import.meta.url)), "utf8"));

// Une copie neuve de tous les fichiers à chaque appel : un test peut la modifier sans gêner les autres.
// toutesVagues : les 3 vagues ouvertes (pour tester les 58 notes et les 36 recettes).
export function donnees({ toutesVagues = false } = {}) {
  const d = Object.fromEntries(FICHIERS.map(n => [n, lire(n)]));
  d.features = lire("config/features");
  if (toutesVagues) d.features.vagues_actives = [1, 2, 3];
  return d;
}

export const moteur = (d = donnees()) => creerMoteur(d);

// Générateur pseudo-aléatoire à graine fixe : les mêmes formules « au hasard » à chaque lancement.
export function hasard(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const somme = t => t.reduce((s, v) => s + v, 0);

// Un vrai lot (pas DEMO) complet, pour les tests des règles de sécurité.
export function vraiLot(code, extra = {}) {
  return {
    lot: `${code}-2026-01`, code_note: code, fournisseur: "Test", densite_g_ml: 0.9, ifra_amendement: 51,
    ifra_cat4_max_pct_produit: 20, substances_ifra_pct: {}, allergenes_pct: {},
    docs: { fds: true, ifra: true, coa: true, allergenes: true }, date_docs: "2026-10-01", ...extra,
  };
}

// Remplace le lot d'une note par un vrai lot (et le rend actif).
export function avecLot(d, code, extra = {}) {
  const l = vraiLot(code, extra);
  d.matieres_lots.lots.push(l);
  const id = Object.keys(d.notes.notes).find(k => d.notes.notes[k].code === code);
  d.notes.notes[id].lot_actif = l.lot;
  return l;
}
