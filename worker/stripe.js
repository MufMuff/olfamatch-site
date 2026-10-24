/*
 * Échanges avec Stripe, sans dépendance : création d'une session de paiement (Checkout),
 * relecture d'une session, coupon et code de réduction du kit, signature des notifications.
 */

const API = "https://api.stripe.com/v1";
// Version de l'API Stripe figée : les réponses gardent la forme attendue par ce programme.
export const VERSION_STRIPE = "2024-06-20";

// { a: { b: [ { c: 1 } ] } } → "a[b][0][c]=1" (format attendu par l'API Stripe)
export function encoderFormulaire(objet) {
  const paires = [];
  const ajouter = (cle, v) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => ajouter(`${cle}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) ajouter(`${cle}[${k}]`, x);
    else paires.push(`${encodeURIComponent(cle)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(objet)) ajouter(k, v);
  return paires.join("&");
}

export function creerStripe({ cle, fetch: fetchFn }) {
  async function appel(methode, chemin, params, { idempotence } = {}) {
    if (!cle) throw new Error("Clé secrète Stripe manquante (STRIPE_SECRET_KEY).");
    const options = {
      method: methode,
      headers: { Authorization: `Bearer ${cle}`, "Stripe-Version": VERSION_STRIPE, "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotence ? { "Idempotency-Key": idempotence } : {}) },
    };
    let url = `${API}${chemin}`;
    if (params && methode === "GET") url += `?${encoderFormulaire(params)}`;
    else if (params) options.body = encoderFormulaire(params);
    const reponse = await fetchFn(url, options);
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(`Stripe ${reponse.status} : ${corps?.error?.message || "erreur inconnue"}`);
    return corps;
  }
  return {
    creerSession: (params, idempotence) => appel("POST", "/checkout/sessions", params, { idempotence }),
    lireSession: id => appel("GET", `/checkout/sessions/${encodeURIComponent(id)}`, { expand: ["line_items"] }),
    creerCoupon: (params, idempotence) => appel("POST", "/coupons", params, { idempotence }),
    creerCodePromo: (params, idempotence) => appel("POST", "/promotion_codes", params, { idempotence }),
  };
}

// ---------- signature des notifications (webhook) ----------

export async function hmacHex(secret, message) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)));
  return [...s].map(o => o.toString(16).padStart(2, "0")).join("");
}

// Comparaison en temps constant, pour ne rien laisser deviner.
function egaux(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signatureValide(entete, corps, secret, maintenantS, toleranceS = 300) {
  if (!entete || !secret) return false;
  const parties = entete.split(",").map(p => p.trim().split("="));
  const t = Number((parties.find(([k]) => k === "t") || [])[1]);
  const v1 = parties.filter(([k]) => k === "v1").map(([, v]) => v || "");
  if (!Number.isFinite(t) || !v1.length) return false;
  if (Math.abs(maintenantS - t) > toleranceS) return false; // trop ancien : peut-être rejoué
  const attendu = await hmacHex(secret, `${t}.${corps}`);
  return v1.some(v => egaux(v, attendu));
}
