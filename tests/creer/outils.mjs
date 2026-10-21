// Outils communs aux tests de « Crée ton parfum ».
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { creerMoteur } from "../../src/creer/moteur.js";

const dossier = new URL("../../data/creer/", import.meta.url);
const lire = nom => JSON.parse(readFileSync(fileURLToPath(new URL(`${nom}.json`, dossier)), "utf8"));

// Une copie neuve des quatre fichiers à chaque appel : un test peut la modifier sans gêner les autres.
export function donnees() {
  return { notes: lire("notes"), compatibilite: lire("compatibilite"), recettes: lire("recettes"), regles: lire("regles"), boutique: lire("boutique") };
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
