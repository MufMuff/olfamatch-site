/*
 * Code de formule de « Crée ton parfum » V2 (§ B11).
 *
 * Forme canonique : notes triées par code, doses au pas de 0,5 %, concentration au pas de 1 %,
 * versions du moteur, du cadre de sécurité et de l'amendement IFRA. Deux formules identiques
 * donnent toujours la même forme, donc le même code.
 *
 * Code = « OLF- » + empreinte SHA-256 de la forme canonique écrite en base 32 (alphabet de Crockford :
 * pas de I, L, O ni U, pour éviter les confusions) + 1 caractère de contrôle, en deux blocs de 5 :
 * OLF-7K3QH-9XB2Q. Le cahier parle de 40 bits mais montre 2 blocs de 5 caractères : on prend
 * 45 bits (9 caractères) + 1 caractère de contrôle pour remplir les deux blocs.
 *
 * Le code ne contient ni la formule, ni nom de marque, ni texte libre : le serveur garde la forme
 * canonique dans sa base (table formules) et la retrouve à partir du code.
 */

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PREFIXE = "OLF";

const nombre = v => String(Math.round(v * 1000) / 1000);

// Forme canonique (texte). versions = { moteur_version, cadre_version, ifra_amendement }.
export function formeCanonique(formule, versions, { pas = 0.5, pasConcentration = 1 } = {}) {
  const notes = Object.entries(formule.notes || {})
    .map(([code, p]) => [code, Math.round(Number(p) / pas) * pas])
    .filter(([, p]) => p > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const c = Math.round(Number(formule.concentration) / pasConcentration) * pasConcentration;
  return [
    "OLF2",
    `moteur=${versions.moteur_version}`,
    `cadre=${versions.cadre_version ?? "-"}`,
    `ifra=${versions.ifra_amendement}`,
    `c=${nombre(c)}`,
    ...notes.map(([code, p]) => `${code}=${nombre(p)}`),
  ].join(";");
}

// Relit une forme canonique : { concentration, notes, versions }.
export function lireCanonique(texte) {
  const [tete, ...parties] = String(texte).split(";");
  if (tete !== "OLF2") return null;
  const versions = {}, notes = {};
  let concentration = null;
  for (const p of parties) {
    const [k, v] = p.split("=");
    if (k === "moteur") versions.moteur_version = v;
    else if (k === "cadre") versions.cadre_version = v === "-" ? null : v;
    else if (k === "ifra") versions.ifra_amendement = Number(v);
    else if (k === "c") concentration = Number(v);
    else if (/^[A-Z]{3}$/.test(k)) notes[k] = Number(v);
    else return null;
  }
  return { concentration, notes, versions };
}

export async function sha256Hex(texte) {
  const octets = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte)));
  return [...octets].map(o => o.toString(16).padStart(2, "0")).join("");
}

// Caractère de contrôle (Luhn modulo 32) : repère une faute de frappe ou deux caractères inversés.
export function caractereControle(chars) {
  let facteur = 2, total = 0;
  for (let i = chars.length - 1; i >= 0; i--) {
    let x = facteur * ALPHABET.indexOf(chars[i]);
    facteur = facteur === 2 ? 1 : 2;
    total += Math.floor(x / 32) + (x % 32);
  }
  return ALPHABET[(32 - (total % 32)) % 32];
}

// { code: "OLF-XXXXX-XXXXX", hash } à partir de la forme canonique.
export async function codeFormule(canonique) {
  const hash = await sha256Hex(canonique);
  // 45 premiers bits = 9 caractères de 5 bits
  let bits = "";
  for (let i = 0; i < 12; i++) bits += parseInt(hash[i], 16).toString(2).padStart(4, "0");
  let corps = "";
  for (let i = 0; i < 9; i++) corps += ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  const complet = corps + caractereControle(corps);
  return { code: `${PREFIXE}-${complet.slice(0, 5)}-${complet.slice(5)}`, hash };
}

/*
 * Lit un code tapé ou collé par quelqu'un : majuscules, espaces et tirets ignorés,
 * O lu comme 0, I et L lus comme 1. Vérifie le caractère de contrôle.
 */
export function lireCode(texte) {
  let s = String(texte ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (s.startsWith(PREFIXE)) s = s.slice(PREFIXE.length);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== 10 || ![...s].every(ch => ALPHABET.includes(ch)))
    return { ok: false, erreur: "Ce code n'a pas la bonne forme : il ressemble à OLF-7K3QH-9XB2Q." };
  if (caractereControle(s.slice(0, 9)) !== s[9]) return { ok: false, erreur: "Ce code contient une faute de frappe : vérifie-le." };
  return { ok: true, code: `${PREFIXE}-${s.slice(0, 5)}-${s.slice(5)}` };
}
