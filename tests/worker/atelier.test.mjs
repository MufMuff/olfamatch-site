// Atelier privé (§ B9, B13, B14) : accès Cloudflare Access, pesée, macération, expédition, étiquette, essais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerControleTextes } from "../../src/creer/mots.js";
import { monter, commander, notificationStripe, evenementPaye, texteEmail, donneesEnVente, PARFUMS, MAINTENANT } from "./outils.mjs";
import { donnees } from "../creer/outils.mjs";

const ctl = creerControleTextes(PARFUMS);
const ORIGINE = "https://atelier.exemple.workers.dev";
const EQUIPE = "olfamatch", AUD = "aud-atelier-123", ETHAN = "ethan@exemple.fr";
const ENV_ACCES = { ACCESS_EQUIPE: EQUIPE, ACCESS_AUD: AUD, ACCESS_EMAILS: ETHAN };
const JOUR = 24 * 3600 * 1000;

// Une vraie paire de clés RSA : le programme vérifie la signature comme avec Cloudflare Access.
const paire = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const autre = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const JWK = { ...(await crypto.subtle.exportKey("jwk", paire.publicKey)), kid: "k1" };
const b64u = x => Buffer.from(x).toString("base64url");
async function jeton(extra = {}, { cle = paire.privateKey, kid = "k1" } = {}) {
  const contenu = { aud: [AUD], iss: `https://${EQUIPE}.cloudflareaccess.com`, email: ETHAN, exp: Math.floor(MAINTENANT / 1000) + 3600, ...extra };
  const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), p = b64u(JSON.stringify(contenu));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cle, Buffer.from(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

async function atelier(options = {}) {
  const m = await monter({ ...options, env: { ...ENV_ACCES, ...(options.env || {}) }, certs: [JWK] });
  // un jeton neuf à chaque demande, valable une heure à l'heure du programme
  const prive = async (chemin, { corps, methode = corps ? "POST" : "GET", entete = null } = {}) => {
    const e = entete || { "Cf-Access-Jwt-Assertion": await jeton({ exp: Math.floor(m.horloge.t / 1000) + 3600 }) };
    return m.app.traiter(new Request(`${ORIGINE}${chemin}`, { method: methode, body: corps ? JSON.stringify(corps) : undefined, headers: { "Content-Type": "application/json", ...e } }));
  };
  return { ...m, prive };
}

// Une commande payée et vérifiée (passe par le vrai paiement et la vraie notification Stripe).
async function payee(m, options = {}) {
  const x = await commander(m.app, options);
  const r = await (await m.app.traiter(notificationStripe(evenementPaye(x.session)))).json();
  assert.equal(r.statut, "payee");
  return x.session;
}

const massesParfaites = fiche => Object.fromEntries(fiche.preparations.flatMap(p => p.fiche.lignes.map(l => [l.id, l.a_peser_g])));

test("accès : sans réglage Cloudflare Access, tout est refusé (403), même la page", async () => {
  const { app } = await monter();
  for (const chemin of ["/fabrication", "/api/fabrication/tableau", "/api/fabrication/commande?id=x"]) {
    const r = await app.traiter(new Request(`${ORIGINE}${chemin}`));
    assert.equal(r.status, 403, chemin);
    assert.match(await r.text(), /Cloudflare Access pas réglée/);
  }
});

test("accès : jeton Cloudflare Access vérifié (signature, audience, équipe, expiration, adresse d'Ethan)", async () => {
  const { prive } = await atelier();
  assert.equal((await prive("/api/fabrication/tableau")).status, 200);
  const page = await prive("/fabrication");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Atelier Olfamatch/);
  assert.equal(page.headers.get("X-Robots-Tag"), "noindex");
  assert.match(page.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  // aussi par le cookie posé par Cloudflare Access
  assert.equal((await prive("/api/fabrication/tableau", { entete: { Cookie: `x=1; CF_Authorization=${await jeton()}` } })).status, 200);
  const refus = [
    ["sans jeton", { "X-Rien": "1" }],
    ["autre audience", { "Cf-Access-Jwt-Assertion": await jeton({ aud: ["autre"] }) }],
    ["autre équipe", { "Cf-Access-Jwt-Assertion": await jeton({ iss: "https://pirate.cloudflareaccess.com" }) }],
    ["expiré", { "Cf-Access-Jwt-Assertion": await jeton({ exp: Math.floor(MAINTENANT / 1000) - 10 }) }],
    ["autre personne", { "Cf-Access-Jwt-Assertion": await jeton({ email: "quelquun@exemple.fr" }) }],
    ["mauvaise signature", { "Cf-Access-Jwt-Assertion": await jeton({}, { cle: autre.privateKey }) }],
    ["clé inconnue", { "Cf-Access-Jwt-Assertion": await jeton({}, { kid: "k9" }) }],
    ["illisible", { "Cf-Access-Jwt-Assertion": "abc.def" }],
  ];
  for (const [nom, entete] of refus) assert.equal((await prive("/api/fabrication/tableau", { entete })).status, 403, nom);
});

test("fiche de pesée : seulement pour une commande payée et vérifiée ; ordre fond, cœur, tête, alcool ; lots et tolérances", async () => {
  const m = await atelier();
  const id = await payee(m);
  const f = await (await m.prive(`/api/fabrication/commande?id=${id}`)).json();
  assert.equal(f.commande.numero_lot, "L2611-0001");
  assert.equal(f.commande.statut, "payee");
  const lignes = f.preparations[0].fiche.lignes;
  const ordre = lignes.map(l => l.etage);
  assert.deepEqual(ordre, ["fond", "fond", "coeur", "tete", "tete", "tete", "tete", null]);
  assert.equal(lignes.at(-1).code, "ALC");
  assert.equal(lignes.find(l => l.code === "BER").lot, "BER-2026-01");
  for (const l of lignes) assert.ok(Math.abs(l.tolerance_g - Math.max(l.a_peser_g * 0.02, 0.02)) < 0.0011, l.code);
  assert.ok(f.securite.conforme);
  // commande bloquée : aucune fiche
  const m2 = await atelier();
  const x = await commander(m2.app);
  m2.stripe.etat.trafiquer = s => { s.amount_total = 1; return s; };
  await m2.app.traiter(notificationStripe(evenementPaye(x.session)));
  const r = await m2.prive(`/api/fabrication/commande?id=${x.session}`);
  assert.equal(r.status, 409);
  assert.match((await r.json()).erreur, /BLOQUÉE/);
  // commande créée mais pas payée : pas de fiche non plus
  const y = await commander(m2.app);
  assert.equal((await m2.prive(`/api/fabrication/commande?id=${y.session}`)).status, 409);
});

test("pesée : une ligne hors tolérance (±2 % ou ±0,02 g) ou manquante bloque la validation", async () => {
  const m = await atelier();
  const id = await payee(m);
  const f = await (await m.prive(`/api/fabrication/commande?id=${id}`)).json();
  const masses = massesParfaites(f);
  const ber = f.preparations[0].fiche.lignes.find(l => l.code === "BER");
  // juste dans la tolérance : accepté plus bas ; juste au-delà : refusé
  const hors = { ...masses, [ber.id]: Math.round((ber.a_peser_g + ber.tolerance_g + 0.01) * 1000) / 1000 };
  const r = await m.prive("/api/fabrication/pesee", { corps: { id, masses: hors } });
  assert.equal(r.status, 422);
  const x = await r.json();
  assert.deepEqual(x.hors_tolerance, [ber.id]);
  const manque = { ...masses };
  delete manque["0:ALC"];
  const r2 = await (await m.prive("/api/fabrication/pesee", { corps: { id, masses: manque } })).json();
  assert.deepEqual(r2.manquantes, ["0:ALC"]);
  // toujours à peser
  assert.equal((await (await m.prive(`/api/fabrication/commande?id=${id}`)).json()).commande.statut, "payee");
});

test("pesée validée : stocks décomptés, macération de 14 jours, puis froid et filtration, puis expédition avec e-mail au client", async () => {
  const m = await atelier({ stock: 500 });
  const id = await payee(m);
  const f = await (await m.prive(`/api/fabrication/commande?id=${id}`)).json();
  const masses = massesParfaites(f);
  const ber = f.preparations[0].fiche.lignes.find(l => l.code === "BER");
  masses[ber.id] = Math.round((ber.a_peser_g + ber.tolerance_g * 0.9) * 1000) / 1000;
  const r = await (await m.prive("/api/fabrication/pesee", { corps: { id, masses } })).json();
  assert.equal(r.statut, "en_maceration");
  assert.equal(r.maceration_fin.slice(0, 10), "2026-11-19");
  assert.match(r.rappel, /abri de la lumière/);
  const stock = await m.db.prepare("SELECT grammes FROM stocks WHERE code_note = 'BER'").first();
  assert.ok(Math.abs(stock.grammes - (500 - masses[ber.id])) < 1e-6);
  // une deuxième pesée est refusée
  assert.equal((await m.prive("/api/fabrication/pesee", { corps: { id, masses } })).status, 409);
  // rappel au tableau de bord quand la macération est finie
  assert.equal((await m.prive("/api/fabrication/etape", { corps: { id, action: "prete" } })).status, 409, "macération pas finie");
  m.horloge.t = MAINTENANT + 15 * JOUR;
  const t = await (await m.prive("/api/fabrication/tableau")).json();
  assert.ok(t.rappels.some(x => /macération finie/.test(x.texte) && /froid/.test(x.texte)));
  assert.equal((await (await m.prive("/api/fabrication/etape", { corps: { id, action: "prete" } })).json()).statut, "prete");
  // expédition : numéro de suivi obligatoire, puis e-mail au client
  assert.equal((await m.prive("/api/fabrication/etape", { corps: { id, action: "expediee" } })).status, 400);
  const avant = m.envoyes.length;
  const e = await (await m.prive("/api/fabrication/etape", { corps: { id, action: "expediee", suivi: "6A123456789FR" } })).json();
  assert.deepEqual([e.statut, e.email], ["expediee", "envoyé"]);
  const mail = texteEmail(m.envoyes[avant]);
  assert.equal(mail.a, "camille@exemple.fr");
  assert.match(mail.corps, /6A123456789FR/);
  assert.ok(ctl.propre(mail.sujet) && ctl.tournures(mail.corps).length === 0 && !ctl.marquesCitees(mail.corps).length);
});

test("kit : 3 mini-lots à peser (une variante chacun) et code de réduction à glisser dans le colis", async () => {
  const m = await atelier();
  const id = await payee(m, { format: "kit" });
  const f = await (await m.prive(`/api/fabrication/commande?id=${id}`)).json();
  assert.equal(f.preparations.length, 3);
  assert.match(f.preparations[0].nom, /Plus fraîche/);
  assert.ok(f.preparations[0].fiche.lignes.every(l => l.id.startsWith("0:")) && f.preparations[2].fiche.lignes.every(l => l.id.startsWith("2:")));
  assert.match(f.commande.code_kit_a_glisser.code, /^KIT-/);
  assert.equal(f.etiquette.contenance, "2 ml");
  assert.equal(f.etiquette.ingredients_sur_notice, true);
  const r = await (await m.prive("/api/fabrication/pesee", { corps: { id, masses: massesParfaites(f) } })).json();
  assert.equal(r.statut, "en_maceration");
});

test("étiquette : ALCOHOL DENAT., PARFUM (FRAGRANCE), puis allergènes au-delà de 0,001 % du plus au moins présent ; personne responsable obligatoire", async () => {
  const m = await atelier();
  const id = await payee(m);
  const f = await (await m.prive(`/api/fabrication/commande?id=${id}`)).json();
  const et = f.etiquette;
  assert.ok(et.ingredients.startsWith("ALCOHOL DENAT., PARFUM (FRAGRANCE), "));
  const allerg = et.ingredients.split(", ").slice(2);
  assert.deepEqual(allerg, f.allergenes.map(a => a.inci));
  assert.deepEqual(f.allergenes.map(a => a.pct_produit), [...f.allergenes.map(a => a.pct_produit)].sort((a, b) => b - a));
  assert.ok(f.allergenes.every(a => a.pct_produit > 0.001));
  assert.equal(et.fonction, "Eau de parfum");
  assert.equal(et.contenance, "100 ml");
  assert.equal(et.numero_lot, "L2611-0001");
  assert.match(et.precautions, /Inflammable/);
  assert.equal(et.marquage_colis, "LQ");
  assert.equal(et.pret, false);
  assert.match(et.manque.join(" "), /personne responsable/);
  for (const t of [et.ingredients, et.precautions, et.fonction]) assert.ok(ctl.propre(t), t);
  // avec la personne responsable : prête à imprimer
  const d = donneesEnVente();
  d.regles.etiquette.responsable = "Olfamatch, 1 rue Exemple, 75000 Paris";
  const m2 = await atelier({ d });
  const id2 = await payee(m2);
  const f2 = await (await m2.prive(`/api/fabrication/commande?id=${id2}`)).json();
  assert.equal(f2.etiquette.pret, true);
});

test("lots de démonstration : pesée refusée (ne jamais fabriquer avec)", async () => {
  const d = donnees();
  const m = await atelier({ d });
  // commande payée écrite à la main (la vente est fermée en mode démonstration)
  await m.db.prepare("INSERT INTO formules (code, hash_canonique, canonique, concentration, notes, moteur_version, cadre_version, ifra_amendement, cree_le) VALUES ('OLF-DEMO0-00000', 'x', 'x', 18, ?, '2.0', NULL, 51, 'x')")
    .bind(JSON.stringify(d.recettes.recettes.R01.notes)).run();
  await m.db.prepare("INSERT INTO commandes (session_id, code, format, quantite, prix_unitaire_centimes, montant_attendu_centimes, statut, numero_lot, cree_le) VALUES ('cs_demo', 'OLF-DEMO0-00000', '100', 1, 4800, 4800, 'payee', 'L2611-0099', 'x')").run();
  const f = await (await m.prive("/api/fabrication/commande?id=cs_demo")).json();
  assert.match(f.etiquette.manque.join(" "), /démonstration/);
  const r = await m.prive("/api/fabrication/pesee", { corps: { id: "cs_demo", masses: massesParfaites(f) } });
  assert.equal(r.status, 409);
  assert.match((await r.json()).erreur, /démonstration/);
});

test("stocks : mise à jour et lecture ; les modifications ne viennent que de la page elle-même", async () => {
  const m = await atelier();
  assert.equal((await m.prive("/api/fabrication/stocks", { corps: { code_note: "BER", grammes: 250.5 } })).status, 200);
  const s = await (await m.prive("/api/fabrication/stocks")).json();
  assert.equal(s.stocks.find(x => x.code_note === "BER").grammes, 250.5);
  assert.equal((await m.prive("/api/fabrication/stocks", { corps: { code_note: "XYZ", grammes: 1 } })).status, 400);
  const j = await jeton();
  const r = await m.app.traiter(new Request(`${ORIGINE}/api/fabrication/stocks`, { method: "POST", body: JSON.stringify({ code_note: "BER", grammes: 0 }),
    headers: { "Content-Type": "application/json", Origin: "https://pirate.exemple", "Cf-Access-Jwt-Assertion": j } }));
  assert.equal(r.status, 403);
});

test("essais des recettes : grille sur 5, « validee » à partir de 3,5 de moyenne et sans défaut de stabilité ; mini-lot de 10 g à 18 %", async () => {
  const m = await atelier();
  const bon = await (await m.prive("/api/fabrication/essais", { corps: { recette: "R01", tete: 4, coeur: 3.5, fond: 3.5, sillage: 3, tenue_h: 7, stabilite_ok: true } })).json();
  assert.deepEqual([bon.moyenne, bon.statut], [3.5, "validee"]);
  assert.match(bon.rappel, /recettes\.json/);
  const instable = await (await m.prive("/api/fabrication/essais", { corps: { recette: "R02", tete: 5, coeur: 5, fond: 5, sillage: 5, stabilite_ok: false } })).json();
  assert.equal(instable.statut, "a_valider");
  const pasFaite = await (await m.prive("/api/fabrication/essais", { corps: { recette: "R04", tete: 5, coeur: 5, fond: 5, sillage: 5 } })).json();
  assert.equal(pasFaite.statut, "a_valider");
  assert.equal((await m.prive("/api/fabrication/essais", { corps: { recette: "R01", tete: 7, coeur: 1, fond: 1, sillage: 1 } })).status, 400);
  const liste = await (await m.prive("/api/fabrication/essais")).json();
  assert.equal(liste.recettes.find(r => r.code === "R01").statut_essais, "validee");
  assert.equal(liste.protocole.length, 4);
  const essai = await (await m.prive("/api/fabrication/essai?recette=R01")).json();
  assert.equal(essai.masse_totale_g, 10);
  assert.ok(Math.abs(essai.masse_concentre_g - 1.8) < 1e-9);
  const ber = essai.lignes.find(l => l.code === "BER");
  assert.ok(Math.abs(ber.a_peser_g - 0.45) < 0.001);
  assert.ok(Math.abs(essai.lignes.reduce((s, l) => s + l.a_peser_g, 0) - 10) < 0.005);
});
