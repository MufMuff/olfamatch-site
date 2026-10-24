/*
 * Petit programme Cloudflare (Worker) de « Crée ton parfum » (Olfamatch).
 *
 * Deux adresses :
 *   POST /stripe       Stripe prévient qu'une commande est payée. Le programme vérifie
 *                      que le message vient bien de Stripe, recalcule la fiche de pesée
 *                      à partir du code de formule et l'envoie par e-mail à l'atelier.
 *   POST /description  La page « Crée ton parfum » demande une description écrite par IA
 *                      pour une formule. L'IA écrit seulement le texte : elle ne choisit
 *                      jamais les doses. En cas de souci, la page garde ses phrases préécrites.
 *
 * Ce fichier ne dépend pas de Cloudflare : index.js lui passe les vrais outils
 * (envoi d'e-mail, fetch), les tests lui passent des faux.
 */
import { creerFabrication } from "../src/creer/v1/fabrication.js";
import { creerMoteur } from "../src/creer/v1/moteur.js";

const API_ANTHROPIC = "https://api.anthropic.com/v1/messages";
// Modèle peu coûteux par défaut pour un texte de 2 ou 3 phrases ; réglable avec MODELE_IA.
const MODELE_PAR_DEFAUT = "claude-haiku-5-5";
const MAX_JETONS_IA = 300; // environ 200 mots : assez pour 60 mots, et la facture reste bornée
// Modèles qui acceptent le repli automatique côté serveur en cas de refus (paramètre fallbacks).
const MODELES_AVEC_REPLI = ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"];
const DUREE_CACHE_DESCRIPTION_S = 60 * 60 * 24 * 30; // une description est gardée 30 jours par formule
const PLAFOND_IA_JOUR_PAR_DEFAUT = 200; // appels à l'IA par jour, tous visiteurs confondus
const TAILLE_MAX_STRIPE = 1024 * 1024; // 1 Mo
const TAILLE_MAX_DESCRIPTION = 2048; // 2 Ko
const TOLERANCE_PAR_DEFAUT_S = 300; // 5 minutes

// Noms de marques à ne jamais laisser passer dans un texte écrit par l'IA.
const MARQUES = [
  "dior", "chanel", "guerlain", "lancome", "yves saint laurent", "ysl", "saint laurent", "givenchy", "hermes",
  "tom ford", "creed", "armani", "prada", "gucci", "versace", "jo malone", "le labo", "kilian", "kurkdjian",
  "baccarat", "byredo", "diptyque", "mugler", "rabanne", "gaultier", "kayali", "narciso rodriguez", "dolce",
  "gabbana", "valentino", "burberry", "calvin klein", "hugo boss", "lattafa", "amouage", "xerjoff",
  "parfums de marly", "initio", "montale", "mancera", "viktor", "cartier", "bvlgari", "bulgari",
  "carolina herrera", "azzaro", "montblanc", "issey miyake", "kenzo", "nina ricci", "aventus",
  "black opium", "la vie est belle", "coco mademoiselle", "j'adore", "fragrantica",
];

const sansAccent = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const json = (donnee, statut = 200, entetes = {}) =>
  new Response(JSON.stringify(donnee), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", ...entetes } });
const texte = (contenu, statut) => new Response(contenu, { status: statut, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const grammes = v => (Math.round(v * 1000) / 1000).toFixed(3).replace(".", ",");
const nombre = v => String(v).replace(".", ",");

// ---------- outils pour les e-mails (MIME écrit à la main, sans dépendance) ----------

function enBase64(chaine) {
  const octets = new TextEncoder().encode(chaine);
  let binaire = "";
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

// Sujet en UTF-8 (RFC 2047), découpé en morceaux de 45 octets au plus pour rester sous 76 caractères par ligne.
function encoderSujet(sujet) {
  const morceaux = [];
  let courant = "";
  for (const caractere of sujet) {
    if (new TextEncoder().encode(courant + caractere).length > 45) { morceaux.push(courant); courant = ""; }
    courant += caractere;
  }
  if (courant) morceaux.push(courant);
  return morceaux.map(m => `=?UTF-8?B?${enBase64(m)}?=`).join("\r\n ");
}

function messageBrut({ de, a, sujet, corps, date = new Date(), id = crypto.randomUUID() }) {
  const domaine = String(de).split("@")[1] || "olfamatch.invalid";
  const corps64 = enBase64(corps.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, ligne => `${ligne}\r\n`);
  return [
    `From: Olfamatch atelier <${de}>`,
    `To: <${a}>`,
    `Subject: ${encoderSujet(sujet)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${domaine}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    corps64,
  ].join("\r\n");
}

// ---------- signature Stripe ----------

async function hmacHex(secret, message) {
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cle, new TextEncoder().encode(message)));
  return [...signature].map(o => o.toString(16).padStart(2, "0")).join("");
}

// Comparaison qui prend toujours le même temps, pour ne rien laisser deviner.
function egaux(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signatureValide(entete, corps, secret, maintenantS, toleranceS) {
  if (!entete) return false;
  const parties = entete.split(",").map(p => p.trim().split("="));
  const t = Number((parties.find(([k]) => k === "t") || [])[1]);
  const v1 = parties.filter(([k]) => k === "v1").map(([, v]) => v || "");
  if (!Number.isFinite(t) || !v1.length) return false;
  if (Math.abs(maintenantS - t) > toleranceS) return false; // message trop ancien : peut-être rejoué
  const attendu = await hmacHex(secret, `${t}.${corps}`);
  return v1.some(v => egaux(v, attendu));
}

// ---------- le programme ----------

export function creerApp({ donnees, env = {}, fetch: fetchFn = globalThis.fetch, EmailMessage, maintenant = () => Date.now() }) {
  const atelier = creerFabrication(donnees);
  const moteur = creerMoteur(donnees);
  const N = donnees.notes.notes;
  // Adresses du site autorisées pour /description : SITE_ORIGINS (séparées par des virgules) et SITE_ORIGIN.
  const ORIGINES = [...new Set([...String(env.SITE_ORIGINS || "").split(","), env.SITE_ORIGIN || ""]
    .map(s => s.trim().replace(/\/+$/, "")).filter(Boolean))];
  const sitePrincipal = env.SITE_ORIGIN || ORIGINES[0] || null;

  // Mémoire Cloudflare (KV) facultative : doublons Stripe, descriptions déjà écrites, compteur du jour.
  async function lireMemoire(cle) {
    if (!env.MEMOIRE) return null;
    try { return await env.MEMOIRE.get(cle); } catch (e) { console.log(`Mémoire illisible : ${e && e.message}`); return null; }
  }
  async function ecrireMemoire(cle, valeur, dureeS) {
    if (!env.MEMOIRE) return;
    try { await env.MEMOIRE.put(cle, valeur, { expirationTtl: dureeS }); } catch (e) { console.log(`Mémoire non écrite : ${e && e.message}`); }
  }

  // ----- fiche de pesée en texte simple -----
  function tableau(lignes, total) {
    const largeur = Math.max(...lignes.map(l => l.nom.length), 5) + 4;
    const rangs = lignes.map((l, i) => {
      const nom = `${String(i + 1).padStart(2)}. ${l.nom} `.padEnd(largeur + 4, ".");
      const dose = l.dose_pct == null ? "" : `  (${nombre(l.dose_pct)} %)`;
      const rem = l.remarque ? `  — ${l.remarque}` : "";
      return `${nom} ${grammes(l.a_peser_g).padStart(8)} g${dose}${rem}`;
    });
    rangs.push(`    ${"Total ".padEnd(largeur, ".")} ${grammes(total).padStart(8)} g`);
    return rangs.join("\n");
  }

  // paye = produit du lien de paiement utilisé ({ cle, nom, prix_eur }), voir produitDuLien().
  function corpsCommande(session, code, paye) {
    const client = session.customer_details || {};
    const adresse = client.address
      ? [client.address.line1, client.address.line2, `${client.address.postal_code || ""} ${client.address.city || ""}`.trim(), client.address.country]
        .filter(Boolean).join(", ")
      : "non renseignée";
    const montantConnu = Number.isFinite(session.amount_total);
    const montant = montantConnu
      ? `${(session.amount_total / 100).toFixed(2).replace(".", ",")} ${String(session.currency || "").toUpperCase()}` : "inconnu";
    // Commande à 0 € : code promo à 100 % (ou erreur de réglage dans Stripe). On le dit en gros.
    const gratuite = session.amount_total === 0 || session.payment_status === "no_payment_required";
    const prixDifferent = montantConnu && !gratuite && paye.prix_eur != null && session.amount_total !== Math.round(paye.prix_eur * 100);
    const entete = [
      `Commande Stripe : ${session.id || "?"}`,
      `Produit payé : ${paye.nom}${paye.prix_eur != null ? ` (prix prévu ${nombre(paye.prix_eur)} €)` : ""}`,
      `Montant reçu : ${montant}${prixDifferent ? " — différent du prix prévu (code promo ?)" : ""}`,
      `Client : ${client.name || "?"} <${client.email || "?"}>`,
      `Adresse : ${adresse}`,
      session.payment_link ? `Lien de paiement : ${session.payment_link}` : null,
      `Code de formule : ${code || "aucun"}`,
    ].filter(Boolean).join("\n");
    const bandeauGratuit = gratuite
      ? ["!!! COMMANDE À 0 € : aucun argent reçu (code promo à 100 % ?). Vérifier dans Stripe avant de fabriquer. !!!", ""] : [];

    const probleme = (raison, erreurs = []) => ({
      sujet: `NE PAS FABRIQUER · ${gratuite ? "0 € · " : ""}vérifier la commande ${session.id || ""}`.trim(),
      corps: [
        "!!! NE PAS FABRIQUER — vérifier cette commande avant toute pesée !!!",
        "",
        ...bandeauGratuit,
        raison,
        ...erreurs.map(e => `  - ${e}`),
        "",
        entete,
        "",
        "Contacter le client si besoin, puis refaire la fiche à la main dans la page privée de fabrication.",
      ].join("\n"),
    });

    if (!code) return probleme("La commande n'a pas de code de formule.");
    const res = atelier.preparerFiche(code);
    if (!res.ok)
      return probleme(res.formule ? "La formule ne respecte pas les règles actuelles :" : "Le code de formule est illisible :", res.erreurs.map(e => e.message));
    // Le client doit avoir payé le produit que demande son code (kit, 50 ml ou 100 ml).
    if (res.produit.cle !== paye.cle)
      return probleme(`Le produit payé ne correspond pas au code : le client a payé « ${paye.nom} », le code demande « ${res.produit.nom} ».`);

    const f = res.fiche;
    const origine = res.recette ? `Recette ${res.formule.recette} · ${res.recette}` : "Formule libre (mode expert)";
    const kit = Boolean(res.kit && Array.isArray(res.variantes));
    const blocs = [
      ...bandeauGratuit,
      kit ? "Nouvelle commande « Crée ton parfum » : KIT D'ÉCHANTILLONS (3 variantes) à fabriquer."
        : "Nouvelle commande « Crée ton parfum » à fabriquer.",
      "",
      entete,
      "",
      origine,
    ];
    if (!kit) blocs.push(
      `Flacon ${f.volume_ml} ml · concentration ${nombre(f.concentration)} %`,
      `Masse totale ${grammes(f.masse_totale_g)} g · dont huiles pures ${grammes(f.masse_huiles_g)} g`,
    );
    if (res.avertissements.length) blocs.push("", "Attention :", ...res.avertissements.map(a => `  - ${a.message}`));
    if (kit) {
      // Une fiche par variante (plus fraîche, standard, plus intense), chacune avec son propre code.
      for (const v of res.variantes) {
        const fv = v.fiche;
        blocs.push("", `VARIANTE « ${v.nom} » — code ${v.code}`,
          `Lot de ${fv.volume_ml} ml · concentration ${nombre(fv.concentration)} % · masse totale ${grammes(fv.masse_totale_g)} g`,
          tableau(fv.lignes, fv.masse_totale_g));
      }
    } else blocs.push("", "FICHE DE PESÉE (dans l'ordre, balance au 0,001 g)", tableau(f.lignes, f.masse_totale_g));
    if (!kit && res.formule.mode === "guide") {
      const avecMelange = atelier.preparerFiche(code, { melangePrepare: true });
      if (avecMelange.ok && avecMelange.fiche.melange)
        blocs.push("", `VARIANTE AVEC LE MÉLANGE ${res.formule.recette} DÉJÀ REPOSÉ`, tableau(avecMelange.fiche.lignes, avecMelange.fiche.masse_totale_g));
    }
    const a = res.allergenes;
    blocs.push("", "ÉTIQUETTE",
      !a.complet ? `Pas encore possible : il manque la liste d'allergènes du fournisseur pour ${a.manquants.join(", ")}.`
        : a.a_declarer.length ? `Allergènes à imprimer : ${a.a_declarer.join(", ")}.` : "Aucun allergène à déclarer.");
    if (sitePrincipal) blocs.push("", `Page de fabrication : ${sitePrincipal}/fabrication/?code=${encodeURIComponent(res.code)}`);
    return {
      sujet: `${gratuite ? "COMMANDE À 0 € · " : ""}Commande ${res.formule.recette || "libre"} · ${kit ? "kit d'échantillons" : `${f.volume_ml} ml`} · ${client.name || client.email || session.id || ""}`.trim(),
      corps: blocs.join("\n"),
    };
  }

  // Liens de paiement connus (boutique.json, liens_stripe_ids) : identifiant plink_… → produit.
  const LIENS = new Map(Object.entries((donnees.boutique && donnees.boutique.liens_stripe_ids) || {})
    .filter(([, id]) => typeof id === "string" && id)
    .map(([cle, id]) => [id, atelier.produit(cle === "kit" ? "kit" : Number(cle.replace("flacon_", "")))]));
  const DUREE_DOUBLON_S = 60 * 60 * 24 * 60; // une session Stripe déjà traitée est ignorée pendant 60 jours

  async function stripe(requete) {
    if (!env.STRIPE_WEBHOOK_SECRET) return texte("Configuration incomplète : secret Stripe manquant.", 500);
    const longueur = Number(requete.headers.get("content-length") || 0);
    if (longueur > TAILLE_MAX_STRIPE) return texte("Message trop gros.", 413);
    const brut = await requete.text();
    if (brut.length > TAILLE_MAX_STRIPE) return texte("Message trop gros.", 413);
    const tolerance = Number(env.STRIPE_TOLERANCE_S) || TOLERANCE_PAR_DEFAUT_S;
    const ok = await signatureValide(requete.headers.get("stripe-signature"), brut, env.STRIPE_WEBHOOK_SECRET, Math.floor(maintenant() / 1000), tolerance);
    if (!ok) return texte("Signature invalide.", 400);

    let evenement;
    try { evenement = JSON.parse(brut); } catch { return texte("Message illisible.", 400); }
    const session = evenement && evenement.data && evenement.data.object;
    const paye = evenement.type === "checkout.session.async_payment_succeeded" ||
      (evenement.type === "checkout.session.completed" && session && ["paid", "no_payment_required"].includes(session.payment_status));
    // Autres événements, ou paiement encore en attente (virement…) : rien à faire, Stripe renverra le bon événement.
    if (!paye || !session) return json({ recu: true, traite: false });

    // Sans les identifiants des 3 liens, impossible de vérifier le produit payé : on refuse (500),
    // Stripe réessaie et signale l'échec dans son tableau de bord. La commande n'est pas perdue.
    if (!LIENS.size) return texte("Configuration incomplète : identifiants des liens Stripe manquants (boutique.json, liens_stripe_ids).", 500);
    const produitPaye = LIENS.get(session.payment_link);
    // Paiement venant d'un autre lien ou d'une autre vente : ce n'est pas une commande « Crée ton parfum ».
    if (!produitPaye) return json({ recu: true, traite: false, raison: "autre lien de paiement" });

    // Stripe peut envoyer deux fois le même événement : une session déjà traitée est ignorée.
    const cleDoublon = session.id ? `session:${session.id}` : null;
    if (cleDoublon && (await lireMemoire(cleDoublon)))
      return json({ recu: true, traite: false, raison: "déjà traitée" });

    const { sujet, corps } = corpsCommande(session, session.client_reference_id, produitPaye);
    try {
      const raw = messageBrut({ de: env.EMAIL_EXPEDITEUR, a: env.EMAIL_ATELIER, sujet, corps, date: new Date(maintenant()) });
      await env.EMAIL.send(new EmailMessage(env.EMAIL_EXPEDITEUR, env.EMAIL_ATELIER, raw));
    } catch (e) {
      // 500 : Stripe renverra l'événement plus tard, la commande n'est pas perdue.
      console.log(`Envoi de l'e-mail impossible pour ${session.id} : ${e && e.message}`);
      return texte("Envoi de l'e-mail impossible, Stripe réessaiera.", 500);
    }
    // Noté seulement une fois l'e-mail parti : un échec d'envoi laisse Stripe réessayer.
    if (cleDoublon) await ecrireMemoire(cleDoublon, "1", DUREE_DOUBLON_S);
    console.log(`Fiche envoyée pour ${session.id}`);
    return json({ recu: true, traite: true });
  }

  // ----- description par IA -----
  const enTetesCors = origine => ({
    "Access-Control-Allow-Origin": origine,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  function consigne(formule, famille) {
    const parEtage = { tete: [], coeur: [], fond: [] };
    for (const id of Object.keys(formule.notes)) parEtage[N[id].etage].push(`${N[id].nom} (${N[id].texte})`);
    const nomFamille = (donnees.regles.equilibre[famille] || {}).nom || famille;
    return [
      `Parfum de la famille ${nomFamille}.`,
      `Notes de tête : ${parEtage.tete.join(" ; ") || "aucune"}.`,
      `Notes de cœur : ${parEtage.coeur.join(" ; ") || "aucune"}.`,
      `Notes de fond : ${parEtage.fond.join(" ; ") || "aucune"}.`,
    ].join("\n");
  }

  const SYSTEME = [
    "Tu écris pour Olfamatch, une petite marque française de parfums à composer soi-même.",
    "Écris en français une description de 2 ou 3 phrases (60 mots au plus) du parfum décrit par l'utilisateur.",
    "Ton chaleureux, concret et sensoriel : ce qu'on sent au début, puis sur la peau, et l'ambiance.",
    "Interdit : tout nom de marque ou de parfum existant, toute comparaison du type « dans l'esprit de », tout chiffre,",
    "toute dose ou pourcentage, toute promesse de tenue ou de santé. Ne propose aucun changement de la formule.",
    "Réponds seulement par la description, sans titre, sans guillemets, sans mise en forme.",
  ].join(" ");

  function texteAcceptable(t) {
    if (!t || t.length < 20 || t.length > 700) return false;
    const s = sansAccent(t);
    if (s.includes("dans l'esprit") || s.includes("dans l’esprit")) return false;
    if (/\d/.test(s)) return false; // pas de chiffres : ni doses ni pourcentages
    return !MARQUES.some(m => new RegExp(`(^|[^a-z])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(s));
  }

  async function description(requete) {
    const origine = requete.headers.get("origin");
    const autorisee = Boolean(origine) && ORIGINES.includes(origine);
    if (requete.method === "OPTIONS") return autorisee ? new Response(null, { status: 204, headers: enTetesCors(origine) }) : texte("Origine refusée.", 403);
    if (!autorisee) return texte("Origine refusée.", 403);
    const cors = enTetesCors(origine);
    const aucune = () => json({ texte: null, source: "aucune" }, 200, cors);

    if (Number(requete.headers.get("content-length") || 0) > TAILLE_MAX_DESCRIPTION) return json({ erreur: "Demande trop grosse." }, 413, cors);
    const brut = await requete.text();
    if (brut.length > TAILLE_MAX_DESCRIPTION) return json({ erreur: "Demande trop grosse." }, 413, cors);
    let code;
    try { code = JSON.parse(brut).code; } catch { return json({ erreur: "Demande illisible." }, 400, cors); }
    if (typeof code !== "string" || !code || code.length > 200) return json({ erreur: "Code de formule manquant ou trop long." }, 400, cors);

    // La page envoie le code sans produit (pas de -V100 ni -KIT) : on l'accepte.
    const lu = atelier.decoder(code, { volumeFacultatif: true });
    if (!lu.ok) return json({ erreur: lu.erreurs[0].message }, 400, cors);
    const verif = moteur.verifier(lu.formule);
    if (!verif.ok) return json({ erreur: "Cette formule ne respecte pas les règles de l'outil." }, 400, cors);

    // 1. Déjà décrite ? On renvoie le même texte, sans appeler l'IA.
    const cleCache = `description:${atelier.encoder(lu.formule, null)}`;
    const deja = await lireMemoire(cleCache);
    if (deja) return json({ texte: deja, source: "ia" }, 200, cors);
    if (!env.ANTHROPIC_API_KEY) return aucune();

    // 2. Limite par personne (adresse IP), réglée dans wrangler.toml (LIMITE_IA).
    if (env.LIMITE_IA) {
      const ip = requete.headers.get("cf-connecting-ip") || "inconnue";
      try {
        const { success } = await env.LIMITE_IA.limit({ key: `ia:${ip}` });
        if (!success) return json({ texte: null, source: "limite" }, 429, cors);
      } catch (e) { console.log(`Limite IA indisponible : ${e && e.message}`); }
    }

    // 3. Plafond d'appels par jour, tous visiteurs confondus (IA_PLAFOND_JOUR), pour borner la facture.
    if (env.MEMOIRE) {
      const cleJour = `ia-jour:${new Date(maintenant()).toISOString().slice(0, 10)}`;
      const faits = Number(await lireMemoire(cleJour)) || 0;
      if (faits >= (Number(env.IA_PLAFOND_JOUR) || PLAFOND_IA_JOUR_PAR_DEFAUT)) return json({ texte: null, source: "plafond" }, 200, cors);
      await ecrireMemoire(cleJour, String(faits + 1), 60 * 60 * 48);
    }

    const modele = env.MODELE_IA || MODELE_PAR_DEFAUT;
    const avecRepli = MODELES_AVEC_REPLI.includes(modele);
    const corpsRequete = {
      model: modele,
      max_tokens: MAX_JETONS_IA,
      output_config: { effort: "low" },
      system: SYSTEME,
      messages: [{ role: "user", content: consigne(lu.formule, verif.famille) }],
    };
    // Haiku : réflexion coupée (accepté à l'effort low), pour que les jetons servent au texte.
    if (modele.startsWith("claude-haiku-5")) corpsRequete.thinking = { type: "disabled" };
    if (avecRepli) corpsRequete.fallbacks = "default";

    try {
      const reponse = await fetchFn(API_ANTHROPIC, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          ...(avecRepli ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
        },
        body: JSON.stringify(corpsRequete),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
      });
      if (!reponse.ok) { console.log(`Description IA : réponse ${reponse.status}`); return aucune(); }
      const message = await reponse.json();
      // Refus, ou texte coupé faute de jetons : la page garde sa phrase préécrite.
      if (["refusal", "max_tokens"].includes(message.stop_reason) || !Array.isArray(message.content)) return aucune();
      const t = message.content.filter(b => b.type === "text").map(b => b.text).join(" ").replace(/\s+/g, " ").trim();
      if (!texteAcceptable(t)) return aucune();
      await ecrireMemoire(cleCache, t, DUREE_CACHE_DESCRIPTION_S);
      return json({ texte: t, source: "ia" }, 200, cors);
    } catch (e) {
      console.log(`Description IA impossible : ${e && e.name}`);
      return aucune();
    }
  }

  async function traiter(requete) {
    const { pathname } = new URL(requete.url);
    if (pathname === "/stripe") return requete.method === "POST" ? stripe(requete) : texte("Méthode non permise.", 405);
    if (pathname === "/description")
      return ["POST", "OPTIONS"].includes(requete.method) ? description(requete) : texte("Méthode non permise.", 405);
    return texte("Page introuvable.", 404);
  }

  return { traiter };
}

// Exporté pour les tests.
export const _interne = { messageBrut, encoderSujet, hmacHex, MARQUES };
