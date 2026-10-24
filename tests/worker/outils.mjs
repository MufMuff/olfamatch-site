// Outils des tests du programme Cloudflare : fausse base D1 (SQLite en mémoire), faux Stripe, faux e-mail.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { creerApp } from "../../worker/app.js";
import { donnees, lireSite } from "../creer/outils.mjs";

export const SECRET = "whsec_test_123";
export const SITE = "https://olfamatch.pages.dev";
export const MAINTENANT = Date.UTC(2026, 10, 5, 12, 0, 0); // 5 novembre 2026
const SCHEMA = readFileSync(fileURLToPath(new URL("../../worker/schema.sql", import.meta.url)), "utf8");
export const PARFUMS = lireSite("parfums");

// Base D1 imitée avec SQLite en mémoire : prepare().bind().first()/all()/run().
export function fausseD1() {
  const base = new DatabaseSync(":memory:");
  base.exec(SCHEMA);
  const nettoyer = v => (v === undefined ? null : v);
  const requete = (sql, args = []) => ({
    bind: (...a) => requete(sql, a.map(nettoyer)),
    first: async col => { const r = base.prepare(sql).get(...args); return r === undefined ? null : col ? r[col] : { ...r }; },
    all: async () => ({ results: base.prepare(sql).all(...args).map(r => ({ ...r })), success: true }),
    run: async () => { const r = base.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: sql => requete(sql), base };
}

// Un e-mail envoyé (Cloudflare Email Service) : destinataire, expéditeur, sujet et texte.
export const texteEmail = m => ({ a: m.to, de: m.from, sujet: m.subject, corps: m.text });

/*
 * Faux Stripe : garde les sessions créées et renvoie, à la relecture, une session « payée »
 * calculée à partir de ce qui a été créé. `trafiquer(session)` permet de simuler un écart.
 */
export function fauxStripe() {
  const sessions = new Map(), appels = [], coupons = [], promos = [];
  let n = 0;
  const etat = { trafiquer: s => s, panne: false };
  const lireForm = body => {
    const p = new URLSearchParams(body), o = {};
    for (const [k, v] of p) o[k] = v;
    return o;
  };
  async function fetch(url, init = {}) {
    appels.push({ url, init });
    if (etat.panne) return new Response(JSON.stringify({ error: { message: "panne" } }), { status: 500 });
    const u = new URL(url);
    if (u.pathname === "/v1/checkout/sessions" && init.method === "POST") {
      const p = lireForm(init.body);
      const id = `cs_test_${++n}`;
      sessions.set(id, p);
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    const m = u.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_\d+)$/);
    if (m && init.method === "GET") {
      const p = sessions.get(m[1]);
      if (!p) return new Response(JSON.stringify({ error: { message: "introuvable" } }), { status: 404 });
      const unitaire = Number(p["line_items[0][price_data][unit_amount]"]), q = Number(p["line_items[0][quantity]"]);
      const remise = p["discounts[0][promotion_code]"] ? 1000 : 0;
      const metadata = Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v]));
      const s = {
        id: m[1], object: "checkout.session", payment_status: "paid", status: "complete", currency: "eur",
        amount_total: unitaire * q - remise, total_details: { amount_discount: remise },
        client_reference_id: p.client_reference_id, metadata,
        customer_details: { name: "Camille Test", email: "camille@exemple.fr", address: { line1: "1 rue des Fleurs", postal_code: "75001", city: "Paris", country: "FR" } },
        shipping_details: { name: "Camille Test", address: { line1: "1 rue des Fleurs", postal_code: "75001", city: "Paris", country: "FR" } },
        line_items: { data: [{ quantity: q, description: p["line_items[0][price_data][product_data][name]"], price: { unit_amount: unitaire, currency: "eur" } }] },
      };
      return Response.json(etat.trafiquer(structuredClone(s)));
    }
    if (u.pathname === "/v1/coupons") { coupons.push(lireForm(init.body)); return Response.json({ id: `coupon_${coupons.length}` }); }
    if (u.pathname === "/v1/promotion_codes") { const p = lireForm(init.body); promos.push(p); return Response.json({ id: `promo_${promos.length}`, code: p.code }); }
    return new Response(JSON.stringify({ error: { message: "inconnu" } }), { status: 404 });
  }
  return { fetch, sessions, appels, coupons, promos, etat };
}

// Données prêtes à vendre : vente ouverte, vrais lots (copies des lots DEMO), cadre signé, stock rempli.
export function donneesEnVente({ vagues = [1, 2, 3] } = {}) {
  const d = donnees();
  d.features.vagues_actives = vagues;
  d.features.mode_demo = false;
  d.boutique.vente_active = true;
  d.boutique.transporteur = "Transporteur test (quantités limitées)";
  for (const l of d.matieres_lots.lots) { l.demo = false; l.lot = l.lot.replace("DEMO-", "") + "-2026-01"; l.fournisseur = "Test"; }
  for (const n of Object.values(d.notes.notes)) n.lot_actif = `${n.code}-2026-01`;
  d.cadre_securite = {
    version: "CADRE-TEST-1", date: "2026-10-30", signataire: "Évaluateur test", concentration: { min: 15, max: 20 },
    nombre_notes: { min: 3, max: 12 }, allergenes_total_max_pct: null,
    notes: Object.fromEntries(Object.values(d.notes.notes).map(n => [n.code, { pmax: n.dose_max }])),
  };
  return d;
}

// Fausse mémoire Cloudflare (KV) : garde aussi la durée demandée pour chaque clé.
export function fausseMemoire() {
  const valeurs = new Map(), durees = new Map();
  return {
    valeurs, durees,
    async get(cle) { return valeurs.has(cle) ? valeurs.get(cle) : null; },
    async put(cle, valeur, options = {}) { valeurs.set(cle, valeur); durees.set(cle, options.expirationTtl); },
  };
}

// ia : fonction (corps de la demande) → réponse de l'API Claude ; les appels sont gardés dans appelsIA.
// certs : clés publiques de Cloudflare Access (faux) ; horloge.t : l'heure du programme, modifiable.
export async function monter({ d = donneesEnVente(), env = {}, stock = 1000, ia = null, certs = [] } = {}) {
  const horloge = { t: MAINTENANT };
  const db = fausseD1();
  const stripe = fauxStripe();
  const envoyes = [], appelsIA = [];
  const fetchTout = async (url, init = {}) => {
    if (String(url).startsWith("https://api.anthropic.com/")) {
      const corps = JSON.parse(init.body);
      appelsIA.push({ url, init, corps });
      if (!ia) throw new Error("pas de réseau");
      const r = await ia(corps);
      return r instanceof Response ? r : Response.json(r);
    }
    if (String(url).endsWith(".cloudflareaccess.com/cdn-cgi/access/certs")) return Response.json({ keys: certs });
    return stripe.fetch(url, init);
  };
  if (stock !== null) for (const n of Object.values(d.notes.notes))
    await db.prepare("INSERT INTO stocks (code_note, lot, grammes, maj_le) VALUES (?, ?, ?, ?)").bind(n.code, n.lot_actif, stock, "2026-11-01").run();
  const app = creerApp({
    donnees: d, parfums: PARFUMS,
    env: { DB: db, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: SECRET, SITE_ORIGIN: SITE, SITE_ORIGINS: SITE,
      EMAIL_ATELIER: "atelier@exemple.fr", EMAIL_EXPEDITEUR: "robot@olfamatch.fr", EMAIL: { send: async m => { envoyes.push(m); } }, ...env },
    fetch: fetchTout, maintenant: () => horloge.t,
  });
  return { app, db, stripe, envoyes, d, appelsIA, horloge };
}

export const appel = (app, chemin, { methode = "POST", corps, origine = SITE, ip = "1.2.3.4" } = {}) =>
  app.traiter(new Request(`https://atelier.exemple.workers.dev${chemin}`, {
    method: methode, body: corps === undefined ? undefined : typeof corps === "string" ? corps : JSON.stringify(corps),
    headers: { "Content-Type": "application/json", ...(origine ? { Origin: origine } : {}), "CF-Connecting-IP": ip },
  }));

export function notificationStripe(evenement, { t = Math.floor(MAINTENANT / 1000), secret = SECRET, signature } = {}) {
  const corps = JSON.stringify(evenement);
  const v1 = signature ?? createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex");
  return new Request("https://atelier.exemple.workers.dev/api/webhook-stripe", {
    method: "POST", body: corps, headers: { "Stripe-Signature": `t=${t},v1=${v1}`, "Content-Type": "application/json" },
  });
}

export const evenementPaye = (sessionId, { id = `evt_${sessionId}`, type = "checkout.session.completed", statut = "paid" } = {}) =>
  ({ id, type, data: { object: { id: sessionId, object: "checkout.session", payment_status: statut } } });

export const R01 = () => ({ concentration: 18, notes: { ...donnees().recettes.recettes.R01.notes } });

// Crée un code puis un paiement ; renvoie le code et l'identifiant de la session Stripe.
export async function commander(app, { formule = R01(), format = "100", quantite = 1, code_kit } = {}) {
  const r = await appel(app, "/api/formule", { corps: { formule, porte: "P4" } });
  const { code } = await r.json();
  const c = await appel(app, "/api/checkout", { corps: { code, format, quantite, ...(code_kit ? { code_kit } : {}) } });
  const corps = await c.json();
  return { code, statut: c.status, ...corps, session: corps.url ? corps.url.split("/").pop() : null };
}
