/*
 * Point d'entrée du programme Cloudflare (Worker) d'Olfamatch « Crée ton parfum » V2.
 * Il charge les fichiers de données et passe les vrais outils de Cloudflare (base D1, envoi
 * d'e-mails par Cloudflare Email Service) au programme principal, app.js. Mise en ligne : voir LISEZMOI.md.
 */
import { creerApp } from "./app.js";
import notes from "../data/creer/notes.json";
import facettes from "../data/creer/facettes.json";
import matrice_sf from "../data/creer/matrice_sf.json";
import exceptions from "../data/creer/exceptions.json";
import structures from "../data/creer/structures.json";
import recettes from "../data/creer/recettes.json";
import ifra_cat4 from "../data/creer/ifra_cat4.json";
import allergenes from "../data/creer/allergenes.json";
import matieres_lots from "../data/creer/matieres_lots.json";
import cadre_securite from "../data/creer/cadre_securite.json";
import regles from "../data/creer/regles.json";
import boutique from "../data/creer/boutique.json";
import features from "../data/creer/config/features.json";
import parfums from "../data/parfums.json";

const donnees = { notes, facettes, matrice_sf, exceptions, structures, recettes, ifra_cat4, allergenes, matieres_lots, cadre_securite, regles, boutique, features };

// Le programme est préparé une fois, puis réutilisé pour les demandes suivantes.
let app = null, envConnu = null;

export default {
  fetch(request, env) {
    if (!app || envConnu !== env) { app = creerApp({ donnees, parfums, env }); envConnu = env; }
    return app.traiter(request);
  },
};
