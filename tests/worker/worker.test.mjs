// Programme Cloudflare (worker/app.js) : e-mail Stripe et description par IA, sans réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { creerApp, _interne } from "../../worker/app.js";
import { creerFabrication } from "../../src/creer/fabrication.js";
import { donnees } from "../creer/outils.mjs";

const SECRET = "whsec_test_123";
const MAINTENANT = Date.UTC(2026, 9, 21, 12, 0, 0);
const CODE = "R01-BER22-MAN18-FLO25-MUS20-CED15-C18-V100";
const SITE = "https://olfamatch.pages.dev";

class FauxEmail {
  constructor(de, a, brut) { Object.assign(this, { de, a, brut }); }
}

function monter({ env = {}, fetch, envoi } = {}) {
  const envoyes = [], appels = [];
  const fauxFetch = fetch || (async (...args) => { appels.push(args); throw new Error("pas de réseau"); });
  const app = creerApp({
    donnees: donnees(),
    env: {
      STRIPE_WEBHOOK_SECRET: SECRET, EMAIL_ATELIER: "atelier@exemple.fr", EMAIL_EXPEDITEUR: "robot@olfamatch.fr",
      SITE_ORIGIN: SITE, EMAIL: { send: envoi || (async m => { envoyes.push(m); }) }, ...env,
    },
    fetch: async (...args) => { appels.push(args); return fauxFetch(...args); },
    EmailMessage: FauxEmail,
    maintenant: () => MAINTENANT,
  });
  return { app, envoyes, appels };
}

function requeteStripe(evenement, { t = Math.floor(MAINTENANT / 1000), secret = SECRET, signature } = {}) {
  const corps = JSON.stringify(evenement);
  const v1 = signature ?? createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex");
  return new Request("https://atelier.exemple.workers.dev/stripe", {
    method: "POST", body: corps, headers: { "Stripe-Signature": `t=${t},v1=${v1}`, "Content-Type": "application/json" },
  });
}

const session = (extra = {}) => ({
  type: "checkout.session.completed",
  data: { object: {
    id: "cs_test_42", payment_status: "paid", amount_total: 4900, currency: "eur", client_reference_id: CODE,
    payment_link: "plink_123",
    customer_details: { name: "Camille Martin", email: "camille@exemple.fr", address: { line1: "3 rue des Lilas", postal_code: "69001", city: "Lyon", country: "FR" } },
    ...extra,
  } },
});

// Relit un e-mail brut : en-têtes, sujet décodé et corps décodé.
function lireEmail(brut) {
  const [entetes, corps64] = brut.split("\r\n\r\n");
  const sujetBrut = entetes.split("\r\n").reduce((acc, l) => (l.startsWith("Subject:") ? l.slice(9) : acc.length && l.startsWith(" ") ? acc + l : acc), "");
  const sujet = [...sujetBrut.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)].map(m => Buffer.from(m[1], "base64").toString("utf8")).join("");
  return { entetes, sujetBrut, sujet, corps: Buffer.from(corps64.replace(/\r\n/g, ""), "base64").toString("utf8") };
}

// ---------- Stripe ----------

test("Stripe : signature valide, commande payée = un seul e-mail à l'atelier avec la fiche de pesée", async () => {
  const { app, envoyes } = monter();
  const rep = await app.traiter(requeteStripe(session()));
  assert.equal(rep.status, 200);
  assert.equal(envoyes.length, 1);
  const m = envoyes[0];
  assert.equal(m.a, "atelier@exemple.fr");
  assert.equal(m.de, "robot@olfamatch.fr");
  const e = lireEmail(m.brut);
  assert.match(e.entetes, /^From: Olfamatch atelier <robot@olfamatch\.fr>/);
  assert.match(e.entetes, /\r\nTo: <atelier@exemple\.fr>/);
  assert.match(e.entetes, /\r\nContent-Type: text\/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64/);
  assert.match(e.entetes, /\r\nMessage-ID: <[^@\s]+@olfamatch\.fr>/);
  assert.match(e.entetes, /\r\nDate: Wed, 21 Oct 2026 12:00:00 \+0000/);
  assert.match(e.sujetBrut, /=\?UTF-8\?B\?/);
  assert.match(e.sujet, /Commande R01 · 100 ml · Camille Martin/);
  for (const attendu of ["82,000", "Alcool de parfumeur", "camille@exemple.fr", CODE, "Agrumes et fleur d'oranger",
    "Musc blanc", "MÉLANGE R01 DÉJÀ REPOSÉ", "49,00 EUR", "3 rue des Lilas, 69001 Lyon, FR", `${SITE}/fabrication/?code=`])
    assert.ok(e.corps.includes(attendu), `manque « ${attendu} » dans :\n${e.corps}`);
  assert.ok(!e.corps.includes("NE PAS FABRIQUER"));
  // lignes du corps de 76 caractères au plus (règle des e-mails)
  for (const ligne of m.brut.split("\r\n\r\n")[1].split("\r\n")) assert.ok(ligne.length <= 76);
});

test("Stripe : mauvaise signature = 400, aucun e-mail", async () => {
  const { app, envoyes } = monter();
  assert.equal((await app.traiter(requeteStripe(session(), { secret: "whsec_autre" }))).status, 400);
  assert.equal((await app.traiter(requeteStripe(session(), { signature: "abc" }))).status, 400);
  const sansEntete = new Request("https://x/stripe", { method: "POST", body: JSON.stringify(session()) });
  assert.equal((await app.traiter(sansEntete)).status, 400);
  assert.equal(envoyes.length, 0);
});

test("Stripe : message trop ancien (plus de 5 minutes) = 400, même bien signé", async () => {
  const { app, envoyes } = monter();
  const rep = await app.traiter(requeteStripe(session(), { t: Math.floor(MAINTENANT / 1000) - 600 }));
  assert.equal(rep.status, 400);
  assert.equal(envoyes.length, 0);
});

test("Stripe : la tolérance de temps se règle", async () => {
  const { app, envoyes } = monter({ env: { STRIPE_TOLERANCE_S: "900" } });
  assert.equal((await app.traiter(requeteStripe(session(), { t: Math.floor(MAINTENANT / 1000) - 600 }))).status, 200);
  assert.equal(envoyes.length, 1);
});

test("Stripe : formule hors règles = e-mail « NE PAS FABRIQUER » avec la raison", async () => {
  const { app, envoyes } = monter();
  const rep = await app.traiter(requeteStripe(session({ client_reference_id: "R01-BER40-MAN10-FLO15-MUS20-CED15-C18-V100" })));
  assert.equal(rep.status, 200);
  assert.equal(envoyes.length, 1);
  const e = lireEmail(envoyes[0].brut);
  assert.match(e.sujet, /^NE PAS FABRIQUER/);
  assert.match(e.corps, /NE PAS FABRIQUER/);
  assert.match(e.corps, /limite de sécurité/);
  assert.match(e.corps, /camille@exemple\.fr/);
  assert.ok(!e.corps.includes("FICHE DE PESÉE"));
});

test("Stripe : code illisible ou absent = e-mail « NE PAS FABRIQUER »", async () => {
  const { app, envoyes } = monter();
  await app.traiter(requeteStripe(session({ client_reference_id: "n'importe quoi" })));
  await app.traiter(requeteStripe(session({ client_reference_id: null })));
  assert.equal(envoyes.length, 2);
  const [illisible, absent] = envoyes.map(m => lireEmail(m.brut));
  assert.match(illisible.corps, /NE PAS FABRIQUER[\s\S]*code de formule est illisible/);
  assert.match(absent.corps, /NE PAS FABRIQUER[\s\S]*pas de code de formule/);
});

test("Stripe : autres événements et paiements en attente ignorés (200, pas d'e-mail)", async () => {
  const { app, envoyes } = monter();
  assert.equal((await app.traiter(requeteStripe({ type: "payment_intent.succeeded", data: { object: {} } }))).status, 200);
  assert.equal((await app.traiter(requeteStripe(session({ payment_status: "unpaid" })))).status, 200);
  assert.equal(envoyes.length, 0);
  // le paiement différé finit par arriver : là, l'e-mail part
  const differe = session({ payment_status: "paid" });
  differe.type = "checkout.session.async_payment_succeeded";
  assert.equal((await app.traiter(requeteStripe(differe))).status, 200);
  assert.equal(envoyes.length, 1);
});

test("Stripe : si l'e-mail ne part pas, réponse 500 pour que Stripe réessaie", async () => {
  const { app } = monter({ envoi: async () => { throw new Error("adresse non vérifiée"); } });
  assert.equal((await app.traiter(requeteStripe(session()))).status, 500);
});

test("Stripe : secret manquant = 500 (configuration incomplète)", async () => {
  const { app, envoyes } = monter({ env: { STRIPE_WEBHOOK_SECRET: "" } });
  assert.equal((await app.traiter(requeteStripe(session()))).status, 500);
  assert.equal(envoyes.length, 0);
});

const codeKit = CODE.replace("-V100", "-KIT");
const kitPret = (() => { try { return creerFabrication(donnees()).preparerFiche(codeKit).kit === true; } catch { return false; } })();

test("Stripe : kit d'échantillons = les 3 variantes dans l'e-mail", { skip: !kitPret && "kit pas encore prêt" }, async () => {
  const { app, envoyes } = monter();
  await app.traiter(requeteStripe(session({ client_reference_id: codeKit })));
  assert.equal(envoyes.length, 1);
  const e = lireEmail(envoyes[0].brut);
  assert.match(e.sujet, /kit d'échantillons/);
  for (const nom of ["Plus fraîche", "Standard", "Plus intense"]) assert.match(e.corps, new RegExp(`VARIANTE « ${nom} » — code R01-`));
  assert.ok(!e.corps.includes("NE PAS FABRIQUER"));
});

test("e-mail : un long sujet accentué est découpé proprement et se relit à l'identique", () => {
  const sujet = "Commande R07 · 100 ml · Éléonore Dupré-Lefèvre de la Châtaigneraie — très longue";
  const enc = _interne.encoderSujet(sujet);
  for (const ligne of enc.split("\r\n")) assert.ok(ligne.length <= 76, ligne);
  const relu = [...enc.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)].map(m => Buffer.from(m[1], "base64").toString("utf8")).join("");
  assert.equal(relu, sujet);
});

// ---------- Description par IA ----------

const requeteDescription = (corps, origine = SITE, methode = "POST") => new Request("https://atelier.exemple.workers.dev/description", {
  method: methode, headers: { Origin: origine, "Content-Type": "application/json" }, body: methode === "POST" ? JSON.stringify(corps) : undefined,
});
const reponseIA = (texte, extra = {}) => async () => new Response(JSON.stringify({
  content: [{ type: "thinking", thinking: "" }, { type: "text", text: texte }], stop_reason: "end_turn", ...extra,
}), { status: 200, headers: { "Content-Type": "application/json" } });
const TEXTE_OK = "Un départ pétillant de bergamote et de mandarine, puis une fleur d'oranger douce et lumineuse. Sur la peau, un musc propre et un bois net prennent le relais.";

test("description : texte de l'IA renvoyé, avec l'en-tête CORS du site", async () => {
  const { app, appels } = monter({ env: { ANTHROPIC_API_KEY: "sk-test" }, fetch: reponseIA(TEXTE_OK) });
  const rep = await app.traiter(requeteDescription({ code: CODE }));
  assert.equal(rep.status, 200);
  assert.equal(rep.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.deepEqual(await rep.json(), { texte: TEXTE_OK, source: "ia" });
  assert.equal(appels.length, 1);
  const [url, options] = appels[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(options.headers["x-api-key"], "sk-test");
  assert.equal(options.headers["anthropic-version"], "2023-06-01");
  const corps = JSON.parse(options.body);
  assert.equal(corps.model, "claude-opus-5-5");
  assert.equal(corps.output_config.effort, "low");
  assert.match(corps.messages[0].content, /Bergamote/);
  assert.match(corps.messages[0].content, /famille frais/);
  assert.ok(!/\d/.test(corps.messages[0].content), "aucune dose envoyée à l'IA");
});

test("description : modèle réglable par MODELE_IA", async () => {
  const { app, appels } = monter({ env: { ANTHROPIC_API_KEY: "sk-test", MODELE_IA: "claude-sonnet-5-5" }, fetch: reponseIA(TEXTE_OK) });
  await app.traiter(requeteDescription({ code: CODE }));
  assert.equal(JSON.parse(appels[0][1].body).model, "claude-sonnet-5-5");
});

test("description : sans clé API, la page garde son texte préécrit", async () => {
  const { app, appels } = monter();
  const rep = await app.traiter(requeteDescription({ code: CODE }));
  assert.equal(rep.status, 200);
  assert.deepEqual(await rep.json(), { texte: null, source: "aucune" });
  assert.equal(appels.length, 0);
});

test("description : texte refusé s'il cite une marque, « dans l'esprit de » ou un chiffre", async () => {
  for (const mauvais of [
    "Un parfum frais qui rappelle Dior, avec une fleur d'oranger lumineuse et un bois net.",
    "Dans l'esprit de grands classiques, un départ d'agrumes et un fond musqué très doux.",
    "Un parfum frais avec 22 % de bergamote, une fleur d'oranger lumineuse et un musc propre.",
    "Un départ d'agrumes très lumineux, comme chez Yves Saint Laurent, puis un musc propre.",
  ]) {
    const { app } = monter({ env: { ANTHROPIC_API_KEY: "sk-test" }, fetch: reponseIA(mauvais) });
    assert.deepEqual(await (await app.traiter(requeteDescription({ code: CODE }))).json(), { texte: null, source: "aucune" }, mauvais);
  }
});

test("description : refus du modèle, erreur de l'API ou panne réseau = texte préécrit", async () => {
  const cas = [
    reponseIA("", { stop_reason: "refusal" }),
    async () => new Response("{}", { status: 529 }),
    async () => { throw new Error("réseau coupé"); },
  ];
  for (const fetch of cas) {
    const { app } = monter({ env: { ANTHROPIC_API_KEY: "sk-test" }, fetch });
    const rep = await app.traiter(requeteDescription({ code: CODE }));
    assert.equal(rep.status, 200);
    assert.deepEqual(await rep.json(), { texte: null, source: "aucune" });
  }
});

test("description : demande venant d'un autre site (ou sans origine) = 403, pas d'appel à l'IA", async () => {
  const { app, appels } = monter({ env: { ANTHROPIC_API_KEY: "sk-test" }, fetch: reponseIA(TEXTE_OK) });
  const autre = await app.traiter(requeteDescription({ code: CODE }, "https://pirate.exemple"));
  assert.equal(autre.status, 403);
  assert.equal(autre.headers.get("Access-Control-Allow-Origin"), null);
  const sansOrigine = new Request("https://x/description", { method: "POST", body: JSON.stringify({ code: CODE }) });
  assert.equal((await app.traiter(sansOrigine)).status, 403);
  assert.equal(appels.length, 0);
});

test("description : pré-vérification CORS (OPTIONS)", async () => {
  const { app } = monter();
  const ok = await app.traiter(requeteDescription(null, SITE, "OPTIONS"));
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.match(ok.headers.get("Access-Control-Allow-Methods"), /POST/);
  assert.match(ok.headers.get("Access-Control-Allow-Headers"), /Content-Type/);
  assert.equal((await app.traiter(requeteDescription(null, "https://pirate.exemple", "OPTIONS"))).status, 403);
});

test("description : code faux, formule hors règles ou demande trop grosse = refus clair", async () => {
  const { app, appels } = monter({ env: { ANTHROPIC_API_KEY: "sk-test" }, fetch: reponseIA(TEXTE_OK) });
  const faux = await app.traiter(requeteDescription({ code: "Z99-ABC" }));
  assert.equal(faux.status, 400);
  assert.match((await faux.json()).erreur, /commencer par une recette/);
  const horsRegles = await app.traiter(requeteDescription({ code: "R01-BER40-MAN10-FLO15-MUS20-CED15-C18-V100" }));
  assert.equal(horsRegles.status, 400);
  assert.match((await horsRegles.json()).erreur, /ne respecte pas les règles/);
  assert.equal((await app.traiter(requeteDescription({ code: "R".repeat(201) }))).status, 400);
  assert.equal((await app.traiter(requeteDescription({ code: CODE, bourrage: "x".repeat(3000) }))).status, 413);
  const illisible = new Request("https://x/description", { method: "POST", headers: { Origin: SITE }, body: "{pas du json" });
  assert.equal((await app.traiter(illisible)).status, 400);
  assert.equal(appels.length, 0);
});

test("adresses inconnues = 404, mauvaise méthode = 405", async () => {
  const { app } = monter();
  assert.equal((await app.traiter(new Request("https://x/"))).status, 404);
  assert.equal((await app.traiter(new Request("https://x/admin", { method: "POST" }))).status, 404);
  assert.equal((await app.traiter(new Request("https://x/stripe"))).status, 405);
  assert.equal((await app.traiter(new Request("https://x/description"))).status, 405);
});
