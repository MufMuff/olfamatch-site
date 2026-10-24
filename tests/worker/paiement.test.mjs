// Programme Cloudflare V2 : code de formule, paiement vérifié par le serveur, notification Stripe (§ B11, B12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerControleTextes } from "../../src/creer/mots.js";
import { lireCode } from "../../src/creer/code.js";
import { donnees } from "../creer/outils.mjs";
import { monter, appel, commander, notificationStripe, evenementPaye, texteEmail, donneesEnVente, R01, PARFUMS, SITE, fauxStripe } from "./outils.mjs";

const ctl = creerControleTextes(PARFUMS);

test("formule : le serveur revérifie, enregistre la forme canonique et renvoie un code OLF-XXXXX-XXXXX", async () => {
  const { app, db } = await monter();
  const r = await appel(app, "/api/formule", { corps: { formule: R01(), porte: "P4" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), SITE);
  const x = await r.json();
  assert.match(x.code, /^OLF-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.ok(lireCode(x.code).ok);
  assert.equal(x.harmonie.libelle, "bon");
  assert.equal(x.commande, "oui");
  const ligne = await db.prepare("SELECT * FROM formules WHERE code = ?").bind(x.code).first();
  assert.match(ligne.canonique, /^OLF2;moteur=2\.0;cadre=CADRE-TEST-1;ifra=51;c=18;BER=25;CED=15;CIT=15;JAS=5;LAV=10;MAN=10;MUS=20$/);
  // même formule (notes dans un autre ordre) = même code, une seule ligne
  const notes = Object.fromEntries(Object.entries(R01().notes).reverse());
  const y = await (await appel(app, "/api/formule", { corps: { formule: { concentration: 18, notes } } })).json();
  assert.equal(y.code, x.code);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM formules").first()).n, 1);
  // relire le code : même formule, toujours conforme
  const z = await (await appel(app, `/api/formule?code=${x.code.toLowerCase()}`, { methode: "GET" })).json();
  assert.deepEqual(z.formule, R01());
  assert.equal(z.a_mettre_a_jour, false);
});

test("formule non conforme : refus clair (422) avec la variante conforme la plus proche, rien d'enregistré", async () => {
  const { app, db } = await monter();
  const r = await appel(app, "/api/formule", { corps: { formule: { concentration: 20, notes: { TON: 25, LAV: 20, BER: 15, MUS: 40 } } } });
  assert.equal(r.status, 422);
  const x = await r.json();
  assert.ok(x.securite.erreurs.length > 0);
  assert.ok(x.variante && x.variante.notes.TON <= 20);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM formules").first()).n, 0);
});

test("code rechargé après un changement de cadre : « formule à mettre à jour » et variante proposée", async () => {
  const d = donneesEnVente();
  const { app, db } = await monter({ d });
  const { code } = await (await appel(app, "/api/formule", { corps: { formule: R01() } })).json();
  // nouveau cadre signé : la bergamote est limitée à 20 %
  const d2 = donneesEnVente();
  d2.cadre_securite.version = "CADRE-TEST-2";
  d2.cadre_securite.notes.BER.pmax = 20;
  const { creerApp } = await import("../../worker/app.js");
  const app2 = creerApp({ donnees: d2, parfums: PARFUMS, env: { DB: db, SITE_ORIGIN: SITE, SITE_ORIGINS: SITE, STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "s" }, fetch: fauxStripe().fetch });
  const x = await (await appel(app2, `/api/formule?code=${code}`, { methode: "GET" })).json();
  assert.equal(x.a_mettre_a_jour, true);
  assert.equal(x.message, "Formule à mettre à jour");
  assert.ok(x.variante.notes.BER <= 20);
  // et le paiement est refusé (409)
  const c = await appel(app2, "/api/checkout", { corps: { code, format: "100" } });
  assert.equal(c.status, 409);
});

test("paiement : le serveur recalcule le prix (boutique.json) et envoie à Stripe un contenu exact, sans nom de marque", async () => {
  const { app, stripe, db } = await monter();
  const x = await commander(app, { format: "100" });
  assert.equal(x.statut, 200);
  assert.match(x.url, /^https:\/\/checkout\.stripe\.com\//);
  const envoi = stripe.sessions.get(x.session);
  assert.deepEqual(envoi, {
    mode: "payment", locale: "fr", client_reference_id: x.code,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": "4800",
    "line_items[0][price_data][product_data][name]": `Eau de parfum sur mesure Olfamatch – ${x.code} – 100 ml`,
    "line_items[0][quantity]": "1",
    "metadata[code]": x.code, "metadata[format]": "100", "metadata[hash_canonique]": envoi["metadata[hash_canonique]"],
    "metadata[moteur_version]": "2.0", "metadata[cadre_version]": "CADRE-TEST-1",
    "payment_intent_data[metadata][code]": x.code, "payment_intent_data[metadata][format]": "100",
    "payment_intent_data[metadata][hash_canonique]": envoi["metadata[hash_canonique]"],
    "payment_intent_data[metadata][moteur_version]": "2.0", "payment_intent_data[metadata][cadre_version]": "CADRE-TEST-1",
    "shipping_address_collection[allowed_countries][0]": "FR",
    success_url: `${SITE}/creer-mon-parfum/merci/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/creer-mon-parfum/?code=${encodeURIComponent(x.code)}`,
  });
  assert.match(envoi["metadata[hash_canonique]"], /^[0-9a-f]{64}$/);
  for (const v of Object.values(envoi)) assert.ok(ctl.propre(v), v);
  // clé secrète et version d'API dans les en-têtes, jamais dans le corps
  const { init } = stripe.appels[0];
  assert.equal(init.headers.Authorization, "Bearer sk_test_x");
  assert.ok(!init.body.includes("sk_test_x"));
  const c = await db.prepare("SELECT * FROM commandes WHERE session_id = ?").bind(x.session).first();
  assert.deepEqual([c.statut, c.montant_attendu_centimes, c.format], ["creee", 4800, "100"]);
  // kit et 50 ml : prix de boutique.json
  assert.equal(stripe.sessions.get((await commander(app, { format: "kit" })).session)["line_items[0][price_data][unit_amount]"], "1000");
  assert.equal(stripe.sessions.get((await commander(app, { format: "50", quantite: 2 })).session)["line_items[0][quantity]"], "2");
});

test("paiement : le navigateur ne peut envoyer ni montant ni champ en plus", async () => {
  const { app, stripe } = await monter();
  const { code } = await (await appel(app, "/api/formule", { corps: { formule: R01() } })).json();
  for (const corps of [{ code, format: "100", prix: 1 }, { code, format: "100", montant: 100 }, { code, format: "100", amount: 1 }]) {
    const r = await appel(app, "/api/checkout", { corps });
    assert.equal(r.status, 400, JSON.stringify(corps));
  }
  assert.equal(stripe.sessions.size, 0);
});

test("paiement refusé : vente fermée (« Bientôt disponible »), mode démonstration, code inexistant ou faux, format ou quantité hors liste", async () => {
  const fermee = donneesEnVente();
  fermee.boutique.vente_active = false;
  const a = await monter({ d: fermee });
  const { code } = await (await appel(a.app, "/api/formule", { corps: { formule: R01() } })).json();
  const r = await appel(a.app, "/api/checkout", { corps: { code, format: "100" } });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).erreur, "Bientôt disponible.");
  // données du dépôt telles quelles (mode démonstration, cadre vide, vente fermée)
  const b = await monter({ d: donnees() });
  const { code: c2 } = await (await appel(b.app, "/api/formule", { corps: { formule: R01() } })).json();
  assert.equal((await appel(b.app, "/api/checkout", { corps: { code: c2, format: "100" } })).status, 403);

  const { app, stripe } = await monter();
  assert.equal((await appel(app, "/api/checkout", { corps: { code: "OLF-00000-00000", format: "100" } })).status, 404);
  assert.equal((await appel(app, "/api/checkout", { corps: { code: "OLF-12345-6789X", format: "100" } })).status, 400);
  const { code: c3 } = await (await appel(app, "/api/formule", { corps: { formule: R01() } })).json();
  assert.equal((await appel(app, "/api/checkout", { corps: { code: c3, format: "75" } })).status, 400);
  assert.equal((await appel(app, "/api/checkout", { corps: { code: c3, format: "100", quantite: 9 } })).status, 400);
  assert.equal((await appel(app, "/api/checkout", { corps: { code: c3, format: "kit", quantite: 2 } })).status, 400);
  assert.equal(stripe.sessions.size, 0);
});

test("paiement refusé si le stock ne suffit pas (commandes payées en attente comprises)", async () => {
  const { app, db, stripe } = await monter({ stock: 30 });
  // 100 ml de R01 : 4,4 g de bergamote environ ; 30 g suffisent pour 1 flacon…
  const x = await commander(app, { format: "100" });
  assert.equal(x.statut, 200);
  // … mais pas pour 3 flacons de plus quand on a peu de cèdre
  await db.prepare("UPDATE stocks SET grammes = 5 WHERE code_note = 'CED'").run();
  const y = await commander(app, { format: "100", quantite: 3 });
  assert.equal(y.statut, 409);
  assert.match(y.erreur, /rupture/);
  // note sans ligne de stock : refusé
  await db.prepare("DELETE FROM stocks WHERE code_note = 'JAS'").run();
  assert.equal((await commander(app, { format: "50" })).statut, 409);
  assert.equal(stripe.sessions.size, 1);
});

test("notification : paiement conforme = commande payée, numéro de lot L2611-0001, un e-mail à l'atelier", async () => {
  const { app, db, envoyes } = await monter();
  const x = await commander(app, { format: "100" });
  const r = await app.traiter(notificationStripe(evenementPaye(x.session)));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { recu: true, traite: true, statut: "payee", numero_lot: "L2611-0001" });
  const c = await db.prepare("SELECT * FROM commandes WHERE session_id = ?").bind(x.session).first();
  assert.equal(c.statut, "payee");
  assert.equal(c.montant_recu_centimes, 4800);
  assert.equal(JSON.parse(c.lots).BER, "BER-2026-01");
  assert.ok((await db.prepare("SELECT * FROM lots WHERE lot = 'BER-2026-01'").first()), "lot archivé");
  assert.equal(envoyes.length, 2, "un e-mail à l'atelier, une confirmation au client");
  const m = texteEmail(envoyes[0]);
  assert.equal(m.a, "atelier@exemple.fr");
  assert.deepEqual(m.de, { email: "robot@olfamatch.fr", name: "Olfamatch" });
  assert.match(m.sujet, /Nouvelle commande L2611-0001/);
  assert.match(m.corps, new RegExp(x.code));
  assert.match(m.corps, /Fiche de fabrication : https:\/\/atelier\.exemple\.workers\.dev\/fabrication\?commande=cs_test_1/);
  const client = texteEmail(envoyes[1]);
  assert.equal(client.a, "camille@exemple.fr");
  assert.match(client.sujet, /Ta commande Olfamatch est confirmée/);
  assert.match(client.corps, new RegExp(x.code));
  assert.match(client.corps, /Flacon 100 ml/);
  assert.match(client.corps, /environ 3 semaines, macération comprise/);
  for (const e of [m, client]) {
    assert.ok(ctl.propre(e.sujet) && ctl.tournures(e.corps).length === 0 && !ctl.marquesCitees(e.corps).length);
    assert.ok(!/apaisant|aphrodisiaque|santé|bien-être/i.test(e.corps));
  }
  // deuxième commande du mois : L2611-0002
  const y = await commander(app, { format: "50" });
  assert.equal((await (await app.traiter(notificationStripe(evenementPaye(y.session)))).json()).numero_lot, "L2611-0002");
});

test("notification rejouée (même événement deux fois) = une seule commande traitée, un seul e-mail", async () => {
  const { app, envoyes } = await monter();
  const x = await commander(app);
  const ev = evenementPaye(x.session);
  assert.equal((await (await app.traiter(notificationStripe(ev))).json()).traite, true);
  const deuxieme = await (await app.traiter(notificationStripe(ev))).json();
  assert.deepEqual(deuxieme, { recu: true, traite: false, raison: "déjà traitée" });
  // autre événement pour la même session (async_payment_succeeded) : la commande est déjà payée
  const autre = await (await app.traiter(notificationStripe(evenementPaye(x.session, { id: "evt_autre", type: "checkout.session.async_payment_succeeded" })))).json();
  assert.equal(autre.traite, false);
  assert.equal(envoyes.length, 2, "un seul couple d'e-mails (atelier + client)");
});

test("notification : signature invalide, trop ancienne ou secret manquant = refus, rien n'est traité", async () => {
  const { app, envoyes, db } = await monter();
  const x = await commander(app);
  assert.equal((await app.traiter(notificationStripe(evenementPaye(x.session), { secret: "whsec_faux" }))).status, 400);
  assert.equal((await app.traiter(notificationStripe(evenementPaye(x.session), { signature: "abc" }))).status, 400);
  assert.equal((await app.traiter(notificationStripe(evenementPaye(x.session), { t: Math.floor(Date.UTC(2026, 10, 5, 11, 50) / 1000) }))).status, 400);
  assert.equal(envoyes.length, 0);
  assert.equal((await db.prepare("SELECT statut FROM commandes").first()).statut, "creee");
  const sansSecret = await monter({ env: { STRIPE_WEBHOOK_SECRET: undefined } });
  assert.equal((await sansSecret.app.traiter(notificationStripe(evenementPaye("cs_test_1")))).status, 500);
});

test("notification : montant différent (amount_total), prix unitaire, quantité, format ou empreinte modifiés = « BLOQUÉE – à vérifier »", async () => {
  const cas = [
    [s => { s.amount_total = 100; }, /Montant reçu 1,00 €, montant attendu 48,00 €/],
    [s => { s.amount_total = 0; s.payment_status = "no_payment_required"; }, /Montant reçu 0,00 €/],
    [s => { s.line_items.data[0].price.unit_amount = 100; s.amount_total = 100; }, /Prix unitaire payé 1,00 €/],
    [s => { s.line_items.data[0].quantity = 2; }, /Quantité payée 2/],
    [s => { s.metadata.format = "50"; }, /Format payé « 50 »/],
    [s => { s.metadata.hash_canonique = "0".repeat(64); }, /empreinte/],
    [s => { s.metadata.code = "OLF-00000-00000"; }, /code de formule de la session/],
    [s => { s.currency = "usd"; }, /Devise/],
    [s => { s.line_items.data.push(s.line_items.data[0]); }, /2 articles/],
  ];
  for (const [trafiquer, attendu] of cas) {
    const { app, db, stripe, envoyes } = await monter();
    const x = await commander(app);
    stripe.etat.trafiquer = s => { trafiquer(s); return s; };
    const r = await (await app.traiter(notificationStripe(evenementPaye(x.session)))).json();
    assert.equal(r.statut, "bloquee", String(attendu));
    const c = await db.prepare("SELECT * FROM commandes WHERE session_id = ?").bind(x.session).first();
    assert.equal(c.statut, "bloquee");
    assert.equal(c.numero_lot, null, "pas de fiche de fabrication");
    assert.match(c.raison_blocage, attendu);
    const m = texteEmail(envoyes[0]);
    assert.match(m.sujet, /BLOQUÉE – à vérifier/);
    assert.match(m.corps, /NE PAS FABRIQUER/);
    assert.match(m.corps, attendu);
  }
});

test("notification : une formule devenue non conforme entre le paiement et la notification est bloquée", async () => {
  const d = donneesEnVente();
  const { app, db, stripe } = await monter({ d });
  const x = await commander(app);
  // le lot de bergamote perd un document : la note n'est plus utilisable
  const d2 = donneesEnVente();
  d2.matieres_lots.lots.find(l => l.code_note === "BER").docs.ifra = false;
  const { creerApp } = await import("../../worker/app.js");
  const envoyes = [];
  const app2 = creerApp({ donnees: d2, parfums: PARFUMS, fetch: stripe.fetch,
    env: { DB: db, STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "whsec_test_123", SITE_ORIGIN: SITE, EMAIL: { send: async m => envoyes.push(m) }, EMAIL_ATELIER: "a@b.fr", EMAIL_EXPEDITEUR: "r@b.fr" },
    maintenant: () => Date.UTC(2026, 10, 5, 12, 0, 0) });
  const r = await (await app2.traiter(notificationStripe(evenementPaye(x.session)))).json();
  assert.equal(r.statut, "bloquee");
  assert.match((await db.prepare("SELECT raison_blocage FROM commandes").first()).raison_blocage, /règles de sécurité/);
});

test("notification : paiement en attente, autres événements, session inconnue = ignorés (200, pas d'e-mail)", async () => {
  const { app, envoyes } = await monter();
  const x = await commander(app);
  assert.equal((await (await app.traiter(notificationStripe(evenementPaye(x.session, { statut: "unpaid" })))).json()).traite, false);
  assert.equal((await (await app.traiter(notificationStripe({ id: "evt_1", type: "charge.refunded", data: { object: { id: "ch_1" } } }))).json()).traite, false);
  assert.equal((await (await app.traiter(notificationStripe(evenementPaye("cs_live_autre")))).json()).raison, "session inconnue");
  assert.equal(envoyes.length, 0);
});

test("notification : si Stripe ou l'e-mail est en panne, réponse 500 et la notification pourra être renvoyée", async () => {
  const { app, stripe, db } = await monter({ env: {} });
  const x = await commander(app);
  stripe.etat.panne = true;
  assert.equal((await app.traiter(notificationStripe(evenementPaye(x.session)))).status, 500);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM evenements_stripe").first()).n, 0, "notification oubliée");
  stripe.etat.panne = false;
  assert.equal((await (await app.traiter(notificationStripe(evenementPaye(x.session)))).json()).statut, "payee");

  const e = await monter({ env: { EMAIL: { send: async () => { throw new Error("adresse non vérifiée"); } } } });
  const y = await commander(e.app);
  assert.equal((await e.app.traiter(notificationStripe(evenementPaye(y.session)))).status, 500);
  assert.equal((await e.db.prepare("SELECT statut FROM commandes").first()).statut, "creee");
});

test("kit : code de réduction de 10 €, un seul usage, 90 jours, accepté seulement pour un flacon de la même formule", async () => {
  const { app, db, stripe, envoyes } = await monter();
  const kit = await commander(app, { format: "kit" });
  await app.traiter(notificationStripe(evenementPaye(kit.session)));
  const ligne = await db.prepare("SELECT * FROM codes_kit").first();
  assert.match(ligne.code_promo, /^KIT-[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(ligne.formule, kit.code);
  assert.equal(ligne.expire_le.slice(0, 10), "2027-02-03");
  assert.deepEqual([stripe.coupons[0].amount_off, stripe.coupons[0].max_redemptions, stripe.coupons[0].duration], ["1000", "1", "once"]);
  assert.equal(stripe.promos[0].code, ligne.code_promo);
  assert.match(texteEmail(envoyes[0]).corps, new RegExp(`${ligne.code_promo}`));
  // le code est accepté pour un flacon de la même formule…
  const flacon = await commander(app, { format: "100", code_kit: ligne.code_promo.toLowerCase() });
  assert.equal(flacon.statut, 200);
  assert.equal(stripe.sessions.get(flacon.session)["discounts[0][promotion_code]"], "promo_1");
  // … refusé pour une autre formule, ou pour un kit
  const autre = await commander(app, { formule: { concentration: 18, notes: { ...donnees().recettes.recettes.R34.notes } }, format: "100", code_kit: ligne.code_promo });
  assert.equal(autre.statut, 400);
  assert.match(autre.erreur, /autre formule/);
  assert.equal((await commander(app, { format: "kit", code_kit: ligne.code_promo })).statut, 400);
  // payé avec la réduction : montant attendu 38 €, puis le code est marqué utilisé
  const r = await (await app.traiter(notificationStripe(evenementPaye(flacon.session)))).json();
  assert.equal(r.statut, "payee");
  assert.equal((await db.prepare("SELECT montant_recu_centimes AS m FROM commandes WHERE session_id = ?").bind(flacon.session).first()).m, 3800);
  assert.equal((await db.prepare("SELECT utilise FROM codes_kit").first()).utilise, 1);
  assert.match((await commander(app, { format: "100", code_kit: ligne.code_promo })).erreur, /déjà servi/);
});

test("garde-fou « inspiration » : champ inspiration… ou nom de parfum de marque = 400, rien n'est enregistré ni envoyé", async () => {
  const { app, db, stripe } = await monter();
  const essais = [
    ["/api/formule", { formule: R01(), inspiration: "Libre" }],
    ["/api/formule", { formule: R01(), inspiration_slug: "libre-yves-saint-laurent" }],
    ["/api/formule", { formule: R01(), porte: "Baccarat Rouge 540" }],
    ["/api/checkout", { code: "OLF-00000-00000", format: "100", inspiration: "Sauvage" }],
    ["/api/checkout", { code: "Comme Sauvage de Dior", format: "100" }],
  ];
  for (const [chemin, corps] of essais) {
    const r = await appel(app, chemin, { corps });
    assert.equal(r.status, 400, JSON.stringify(corps));
    assert.match((await r.json()).erreur, /parfums ou de marques|mal formée/);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM formules").first()).n, 0);
  assert.equal(stripe.sessions.size, 0);
});

test("accès : seulement depuis les adresses du site (SITE_ORIGINS), pré-vérification CORS, limite de demandes", async () => {
  const { app } = await monter({ env: { SITE_ORIGINS: `${SITE},https://olfamatch.fr,https://www.olfamatch.fr` } });
  assert.equal((await appel(app, "/api/formule", { corps: { formule: R01() }, origine: "https://pirate.exemple" })).status, 403);
  assert.equal((await appel(app, "/api/formule", { corps: { formule: R01() }, origine: null })).status, 403);
  assert.equal((await appel(app, "/api/formule", { corps: { formule: R01() }, origine: "https://www.olfamatch.fr" })).status, 200);
  const o = await appel(app, "/api/checkout", { methode: "OPTIONS", origine: "https://olfamatch.fr" });
  assert.equal(o.status, 204);
  assert.equal(o.headers.get("Access-Control-Allow-Origin"), "https://olfamatch.fr");
  // limite : la 31e demande de la minute est refusée
  let n = 0;
  const limite = await monter({ env: { LIMITE_API: { limit: async () => ({ success: ++n <= 30 }) } } });
  for (let i = 0; i < 30; i++) await appel(limite.app, "/api/formule?code=OLF-00000-00000", { methode: "GET" });
  assert.equal((await appel(limite.app, "/api/formule?code=OLF-00000-00000", { methode: "GET" })).status, 429);
  // adresses inconnues, mauvaise méthode, demande trop grosse ou illisible
  assert.equal((await appel(app, "/api/rien", { methode: "GET" })).status, 404);
  assert.equal((await appel(app, "/autre", { methode: "GET" })).status, 404);
  assert.equal((await appel(app, "/api/checkout", { methode: "GET" })).status, 405);
  assert.equal((await appel(app, "/api/formule", { corps: "x".repeat(9000) })).status, 413);
  assert.equal((await appel(app, "/api/formule", { corps: "{pas du json" })).status, 400);
});
