/*
 * Tournures interdites de « Crée ton parfum » (cahier des charges V2, § 0).
 *
 * - Toujours interdits : « dupe », « copie », « réplique », « imitation », « contretype », « clone ».
 * - Interdits à côté d'un nom de parfum ou de marque (data/parfums.json) : « inspiré(e) de »,
 *   « identique à », « comme », « sent comme », « version de », « équivalent de », « alternative à ».
 * Le mot « comme » seul n'est pas filtré : il est partout en français.
 *
 * Sert à contrôler tout texte qui sort de l'outil : textes affichés, sorties de l'IA, e-mails,
 * étiquettes, données envoyées à Stripe.
 */

const sansAccent = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`´]/g, "'");
const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LETTRE = "a-z0-9";

const TOUJOURS = /(?<![a-z0-9])(dupes?|copies?|repliques?|imitations?|contretypes?|clones?)(?![a-z0-9])/g;
const TOURNURES = new RegExp([
  "inspire(?:e|s|es)? (?:de|du|des|d'|par)",
  "identiques? (?:a|au|aux)",
  "comme",
  "versions? (?:de|du|des|d')",
  "equivalent(?:e|s|es)? (?:de|du|des|d'|a|au|aux)",
  "alternatives? (?:a|au|aux)",
].map(t => `(?<![${LETTRE}])${t}(?![${LETTRE}])`).join("|"), "g");
// Petits mots qu'on saute entre la tournure et le nom : « comme le parfum de… », « version du… ».
const LIAISON = /^(?:(?:le|la|les|un|une|du|de|des|celui|celle|ceux|celles|parfum|fameux|fameuse|celebre|eau)\s+|l'|d')/;

// Marques ou noms très connus absents de parfums.json mais à bloquer quand même.
const EXTRA = ["ysl", "saint laurent", "dolce", "gabbana", "kurkdjian", "fragrantica", "aventus", "black opium",
  "la vie est belle", "coco mademoiselle", "baccarat rouge", "lattafa", "armaf", "zara"];

export function creerControleTextes(parfums = [], { extra = EXTRA } = {}) {
  const marques = new Set(extra.map(x => sansAccent(x).toLowerCase()));
  const noms = new Set();
  for (const p of parfums) {
    if (p.brand) marques.add(sansAccent(p.brand).toLowerCase());
    if (p.name) {
      const n = sansAccent(p.name).toLowerCase();
      noms.add(n);
      // « Light Blue (femme) » → « light blue » ; « … Pour Homme » → sans la précision
      const court = n.replace(/\s*\([^)]*\)/g, "").replace(/\s+(pour homme|pour femme|for her|for him)$/, "").trim();
      if (court.length >= 3) noms.add(court);
    }
    // Les alternatives listées dans l'annuaire sont aussi des parfums de marque.
    for (const x of p.dupes || []) if (x.brand) marques.add(sansAccent(x.brand).toLowerCase());
  }
  // Variantes « & » / « et » / sans espace (Dolce & Gabbana, Viktor&Rolf).
  for (const m of [...marques]) if (m.includes("&")) { marques.add(m.replace(/\s*&\s*/g, " et ")); marques.add(m.replace(/\s*&\s*/g, " & ")); }
  const motif = liste => new RegExp(`^(?:${[...liste].filter(Boolean).sort((a, b) => b.length - a.length).map(echapper).join("|")})(?![${LETTRE}])`);
  const reMarque = motif(marques);
  const reNom = motif(noms);
  const reMarqueGlobal = new RegExp(`(?<![${LETTRE}])(?:${[...marques].sort((a, b) => b.length - a.length).map(echapper).join("|")})(?![${LETTRE}])`, "g");
  const reNomGlobal = new RegExp(`(?<![${LETTRE}])(?:${[...noms].sort((a, b) => b.length - a.length).map(echapper).join("|")})(?![${LETTRE}])`, "g");

  // Un nom de parfum d'un seul mot (Libre, Orage…) ne compte que s'il est écrit avec une majuscule :
  // « comme un orage d'été » est permis, « comme Orage » ne l'est pas.
  function nomA(original, low, i) {
    const reste = low.slice(i);
    const m = reste.match(reMarque);
    if (m) return { type: "marque", nom: m[0] };
    const n = reste.match(reNom);
    if (n && (n[0].includes(" ") || /[A-Z]/.test(original[i]))) return { type: "parfum", nom: n[0] };
    return null;
  }

  // Tournures interdites trouvées dans un texte (liste vide = texte propre).
  function tournures(texte) {
    const original = sansAccent(texte);
    const low = original.toLowerCase();
    const res = [];
    for (const m of low.matchAll(TOUJOURS)) res.push({ type: "toujours", mot: m[1], extrait: original.slice(Math.max(0, m.index - 20), m.index + 30) });
    for (const m of low.matchAll(TOURNURES)) {
      // On essaie le nom juste après la tournure, puis après chaque petit mot (« la », « du parfum »…) :
      // « identique à La Vie est Belle » comme « inspiré du parfum Libre ».
      let i = m.index + m[0].length;
      for (let pas = 0; pas < 6; pas++) {
        while (low[i] === " ") i++;
        const cite = nomA(original, low, i);
        if (cite) { res.push({ type: "tournure", mot: m[0], nom: cite.nom, extrait: original.slice(m.index, i + cite.nom.length) }); break; }
        const saut = low.slice(i).match(LIAISON);
        if (!saut) break;
        i += saut[0].length;
      }
    }
    return res;
  }

  // Noms de marque présents n'importe où dans le texte.
  function marquesCitees(texte) {
    const low = sansAccent(texte).toLowerCase();
    return [...new Set([...low.matchAll(reMarqueGlobal)].map(m => m[0]))];
  }

  // Noms de parfums de marque présents (un seul mot : seulement avec une majuscule).
  function parfumsCites(texte) {
    const original = sansAccent(texte);
    const low = original.toLowerCase();
    return [...new Set([...low.matchAll(reNomGlobal)].filter(m => m[0].includes(" ") || /[A-Z]/.test(original[m.index])).map(m => m[0]))];
  }

  // Texte sans tournure interdite, sans marque et sans nom de parfum de marque.
  const propre = texte => !tournures(texte).length && !marquesCitees(texte).length && !parfumsCites(texte).length;

  return { tournures, marquesCitees, parfumsCites, propre };
}
