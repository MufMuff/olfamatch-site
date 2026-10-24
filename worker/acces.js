/*
 * Protection de la page de fabrication par Cloudflare Access (compte d'Ethan uniquement).
 *
 * Cloudflare Access se place devant le programme : il demande à Ethan de se connecter, puis ajoute
 * à chaque demande un jeton signé (en-tête Cf-Access-Jwt-Assertion). Ce fichier revérifie ce jeton :
 * signature (clés publiques de l'équipe Access), audience, émetteur, date d'expiration et adresse
 * e-mail autorisée. Sans réglage (ACCESS_EQUIPE, ACCESS_AUD, ACCESS_EMAILS), tout est refusé.
 */

const b64url = s => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "=".repeat((4 - (b.length % 4)) % 4)), c => c.charCodeAt(0));
};
const texte = octets => new TextDecoder().decode(octets);

export function creerAcces({ env, fetch: fetchFn, maintenant }) {
  let cache = null; // { cles, expire }

  async function cles() {
    if (cache && cache.expire > maintenant()) return cache.cles;
    const r = await fetchFn(`https://${env.ACCESS_EQUIPE}.cloudflareaccess.com/cdn-cgi/access/certs`);
    if (!r.ok) throw new Error(`certificats Access : ${r.status}`);
    const { keys } = await r.json();
    cache = { cles: keys || [], expire: maintenant() + 60 * 60 * 1000 };
    return cache.cles;
  }

  function jetonDe(requete) {
    const entete = requete.headers.get("cf-access-jwt-assertion");
    if (entete) return entete;
    const cookie = requete.headers.get("cookie") || "";
    const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    return m ? m[1] : null;
  }

  /*
   * Renvoie { ok: true, email } si la demande vient bien d'Ethan, sinon { ok: false, raison }.
   */
  async function verifier(requete) {
    if (!env.ACCESS_EQUIPE || !env.ACCESS_AUD || !env.ACCESS_EMAILS) return { ok: false, raison: "Protection Cloudflare Access pas réglée (ACCESS_EQUIPE, ACCESS_AUD, ACCESS_EMAILS)." };
    const jeton = jetonDe(requete);
    if (!jeton) return { ok: false, raison: "Connexion Cloudflare Access manquante." };
    const parties = jeton.split(".");
    if (parties.length !== 3) return { ok: false, raison: "Jeton illisible." };
    let entete, contenu;
    try { entete = JSON.parse(texte(b64url(parties[0]))); contenu = JSON.parse(texte(b64url(parties[1]))); } catch { return { ok: false, raison: "Jeton illisible." }; }
    if (entete.alg !== "RS256") return { ok: false, raison: "Jeton non signé comme attendu." };
    let liste;
    try { liste = await cles(); } catch (e) { return { ok: false, raison: "Clés Cloudflare Access indisponibles." }; }
    const jwk = liste.find(k => k.kid === entete.kid);
    if (!jwk) return { ok: false, raison: "Clé du jeton inconnue." };
    const cle = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valide = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cle, b64url(parties[2]), new TextEncoder().encode(`${parties[0]}.${parties[1]}`));
    if (!valide) return { ok: false, raison: "Signature du jeton invalide." };
    const aud = Array.isArray(contenu.aud) ? contenu.aud : [contenu.aud];
    if (!aud.includes(env.ACCESS_AUD)) return { ok: false, raison: "Jeton destiné à une autre application." };
    if (contenu.iss !== `https://${env.ACCESS_EQUIPE}.cloudflareaccess.com`) return { ok: false, raison: "Jeton émis par une autre équipe." };
    if (!(Number(contenu.exp) * 1000 > maintenant())) return { ok: false, raison: "Connexion expirée : reconnecte-toi." };
    const permis = String(env.ACCESS_EMAILS).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!permis.includes(String(contenu.email || "").toLowerCase())) return { ok: false, raison: "Ce compte n'a pas accès à l'atelier." };
    return { ok: true, email: contenu.email };
  }

  return { verifier };
}
