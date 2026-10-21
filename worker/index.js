/*
 * Point d'entrée du programme Cloudflare (Worker) d'Olfamatch.
 * Il charge les fichiers de données de « Crée ton parfum » et passe les vrais outils
 * de Cloudflare (envoi d'e-mail) au programme principal, app.js.
 * Mise en ligne : voir LISEZMOI.md.
 */
import { EmailMessage } from "cloudflare:email";
import { creerApp } from "./app.js";
import notes from "../data/creer/notes.json";
import compatibilite from "../data/creer/compatibilite.json";
import recettes from "../data/creer/recettes.json";
import regles from "../data/creer/regles.json";

const donnees = { notes, compatibilite, recettes, regles };

export default {
  fetch(request, env) {
    return creerApp({ donnees, env, EmailMessage }).traiter(request);
  },
};
