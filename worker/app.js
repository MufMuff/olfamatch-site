/*
 * Programme Cloudflare (Worker) de « Crée ton parfum » V2 (Olfamatch).
 *
 *   POST /api/formule          une formule → revérifiée par le moteur → code OLF-… enregistré
 *   GET  /api/formule?code=…   un code → la formule, revérifiée avec les règles et les lots du jour
 *   POST /api/checkout         { code, format, quantite, code_kit? } → page de paiement Stripe
 *   POST /api/webhook-stripe   Stripe annonce un paiement : tout est recalculé et comparé
 *   POST /api/ia/comprendre    { texte } → structure et notes souhaitées (porte « par ambiance »)
 *   POST /api/ia/expliquer     { code } → explication de la formule en 80 à 120 mots
 *
 * Seul ce programme décide : il relance toujours le moteur (harmonie + sécurité) et calcule
 * lui-même le prix à partir de boutique.json. Il ne reprend jamais un montant envoyé par le navigateur.
 *
 * Ce fichier ne dépend pas de Cloudflare : index.js lui passe la base (D1), l'envoi d'e-mails
 * et fetch ; les tests lui passent des faux.
 */
import { creerMoteur } from "../src/creer/moteur.js";
import { creerFabrication } from "../src/creer/fabrication.js";
import { formeCanonique, codeFormule, lireCode, sha256Hex, ALPHABET } from "../src/creer/code.js";
import { creerControleTextes } from "../src/creer/mots.js";
import { creerStripe, signatureValide } from "./stripe.js";
import { messageBrut } from "./courriel.js";
import { creerIA } from "./ia.js";

export const FORMATS = {
  kit: { cle: "kit", nom: "Kit d'échantillons", detail: "3 × 2 ml" },
  "50": { cle: "flacon_50", nom: "Flacon 50 ml", detail: "50 ml" },
  "100": { cle: "flacon_100", nom: "Flacon 100 ml", detail: "100 ml" },
};
const TAILLE_MAX = 8 * 1024;            // demandes du site : 8 Ko
const TAILLE_MAX_STRIPE = 1024 * 1024;  // notifications Stripe : 1 Mo
const JOUR_MS = 24 * 3600 * 1000;

const json = (donnee, statut = 200, entetes = {}) =>
  new Response(JSON.stringify(donnee), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", ...entetes } });
const texte = (contenu, statut) => new Response(contenu, { status: statut, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const euros = centimes => `${(centimes / 100).toFixed(2).replace(".", ",")} €`;
const propre = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

export function creerApp({ donnees, parfums = [], env = {}, fetch: fetchFn = globalThis.fetch, EmailMessage, maintenant = () => Date.now() }) {
  const moteur = creerMoteur(donnees);
  const atelier = creerFabrication(donnees, moteur);
  const controle = creerControleTextes(parfums);
  const stripe = creerStripe({ cle: env.STRIPE_SECRET_KEY, fetch: fetchFn });
  const B = donnees.boutique;
  const db = env.DB;
  const ORIGINES = [...new Set([...String(env.SITE_ORIGINS || "").split(","), env.SITE_ORIGIN || ""]
    .map(s => s.trim().replace(/\/+$/, "")).filter(Boolean))];
  const SITE = (env.SITE_ORIGIN || ORIGINES[0] || "").replace(/\/+$/, "");
  const iso = () => new Date(maintenant()).toISOString();
  const ia = creerIA({ donnees, moteur, controle, env, fetch: fetchFn, maintenant });

  // ---------------- outils communs ----------------

  const enTetesCors = origine => ({
    "Access-Control-Allow-Origin": origine,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  async function lireJSON(requete, max = TAILLE_MAX) {
    if (Number(requete.headers.get("content-length") || 0) > max) return { erreur: ["Demande trop grosse.", 413] };
    const brut = await requete.text();
    if (brut.length > max) return { erreur: ["Demande trop grosse.", 413] };
    try { return { valeur: JSON.parse(brut) }; } catch { return { erreur: ["Demande illisible.", 400] }; }
  }

  /*
   * Garde-fou « inspiration » : le nom d'un parfum de marque ne doit jamais arriver ici
   * (ni dans la base, ni chez Stripe, ni dans un e-mail). On refuse tout champ inspiration…
   * et toute valeur qui cite une marque ou un parfum de marque.
   */
  function refusInspiration(valeur, chemin = "") {
    if (typeof valeur === "string") {
      if (controle.marquesCitees(valeur).length || controle.parfumsCites(valeur).length || controle.tournures(valeur).length)
        return "Les noms de parfums ou de marques ne sont pas acceptés ici.";
      return null;
    }
    if (valeur && typeof valeur === "object") {
      for (const [k, v] of Object.entries(valeur)) {
        if (/^inspiration/i.test(k)) return "Les noms de parfums ou de marques ne sont pas acceptés ici.";
        // les codes de notes (BER, ROS…) ne sont pas des noms de parfum : on ne contrôle que leurs valeurs
        const r = refusInspiration(v, `${chemin}.${k}`);
        if (r) return r;
      }
    }
    return null;
  }

  const clesPermises = (objet, cles) => objet && typeof objet === "object" && !Array.isArray(objet) && Object.keys(objet).every(k => cles.includes(k));

  // ---------------- formules ----------------

  function lireFormuleEntree(f) {
    if (!clesPermises(f, ["concentration", "notes"])) return null;
    const notes = f.notes;
    if (!notes || typeof notes !== "object" || Array.isArray(notes) || Object.keys(notes).length > 20) return null;
    for (const [k, v] of Object.entries(notes)) if (!/^[A-Z]{3}$/.test(k) || typeof v !== "number" || !Number.isFinite(v)) return null;
    if (typeof f.concentration !== "number" || !Number.isFinite(f.concentration)) return null;
    return { concentration: f.concentration, notes: moteur.normaliser(notes) };
  }

  const resume = ev => ({
    harmonie: { score: ev.harmonie.score, libelle: ev.harmonie.libelle, texte: ev.harmonie.texte, structure_proche: ev.harmonie.structure_proche },
    securite: { conforme: ev.securite.ok, marge_min: ev.securite.marge_min, erreurs: ev.securite.erreurs.map(e => e.message) },
    commande: ev.commande,
    avertissements: ev.avertissements.map(a => a.message),
  });

  async function lireFormuleBase(code) {
    const ligne = await db.prepare("SELECT * FROM formules WHERE code = ?").bind(code).first();
    if (!ligne) return null;
    return { ligne, formule: { concentration: ligne.concentration, notes: JSON.parse(ligne.notes) } };
  }

  // La ligne de la base n'a pas été modifiée : sa forme canonique redonne son empreinte et son code.
  async function integre(ligne) {
    const f = { concentration: ligne.concentration, notes: JSON.parse(ligne.notes) };
    const canonique = formeCanonique(f, { moteur_version: ligne.moteur_version, cadre_version: ligne.cadre_version, ifra_amendement: ligne.ifra_amendement });
    const { code, hash } = await codeFormule(canonique);
    return canonique === ligne.canonique && hash === ligne.hash_canonique && code === ligne.code;
  }

  async function creerFormule(corps) {
    if (!clesPermises(corps, ["formule", "porte", "confirme"])) return json({ erreur: "Demande mal formée." }, 400);
    const formule = lireFormuleEntree(corps.formule);
    if (!formule) return json({ erreur: "Formule mal formée." }, 400);
    const porte = ["P1", "P2", "P3", "P4", "P5"].includes(corps.porte) ? corps.porte : "P5";
    const confirme = corps.confirme === true;
    const ev = moteur.evaluer(formule, { porte, confirme });
    if (!ev.conforme) {
      const variante = moteur.corriger(formule);
      return json({ erreur: "Cette formule ne respecte pas les règles de sécurité.", ...resume(ev), formule,
        variante: variante.ok ? variante.formule : null }, 422);
    }
    const versions = ev.securite.versions;
    const canonique = formeCanonique(formule, versions);
    const { code, hash } = await codeFormule(canonique);
    const deja = await db.prepare("SELECT canonique FROM formules WHERE code = ?").bind(code).first();
    if (deja && deja.canonique !== canonique) {
      console.log(`Collision de code ${code}`);
      return json({ erreur: "Code indisponible pour cette formule : change une dose d'un demi-point." }, 500);
    }
    await db.prepare(`INSERT INTO formules (code, hash_canonique, canonique, concentration, notes, moteur_version, cadre_version, ifra_amendement,
        harmonie, harmonie_libelle, porte, confirme, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET confirme = MAX(formules.confirme, excluded.confirme),
        porte = CASE WHEN excluded.confirme > formules.confirme THEN excluded.porte ELSE formules.porte END`)
      .bind(code, hash, canonique, formule.concentration, JSON.stringify(formule.notes), versions.moteur_version, versions.cadre_version,
        versions.ifra_amendement, ev.harmonie.score, ev.harmonie.libelle, porte, confirme ? 1 : 0, iso()).run();
    return json({ code, formule, ...resume(ev), vente: moteur.etatVente().ok, prix: { ...B.prix_eur } });
  }

  async function relireFormule(url) {
    const lu = lireCode(url.searchParams.get("code"));
    if (!lu.ok) return json({ erreur: lu.erreur }, 400);
    const trouve = await lireFormuleBase(lu.code);
    if (!trouve) return json({ erreur: "Ce code n'existe pas." }, 404);
    if (!(await integre(trouve.ligne))) return json({ erreur: "Cette formule ne peut pas être relue." }, 500);
    const ev = moteur.evaluer(trouve.formule, { porte: trouve.ligne.porte, confirme: Boolean(trouve.ligne.confirme) });
    if (!ev.conforme) {
      // Le cadre ou un lot a changé depuis : on propose la variante conforme la plus proche.
      const variante = moteur.corriger(trouve.formule);
      return json({ code: lu.code, formule: trouve.formule, a_mettre_a_jour: true, message: "Formule à mettre à jour",
        ...resume(ev), variante: variante.ok ? variante.formule : null, changements: variante.changements.map(c => c.message) });
    }
    return json({ code: lu.code, formule: trouve.formule, a_mettre_a_jour: false, ...resume(ev), vente: moteur.etatVente().ok, prix: { ...B.prix_eur } });
  }

  // ---------------- paiement ----------------

  const prixCentimes = format => Math.round(Number(B.prix_eur[FORMATS[format].cle]) * 100);
  const nomProduit = (code, format) => (format === "kit"
    ? `Kit d'échantillons Olfamatch – ${code} – ${FORMATS.kit.detail}`
    : `Eau de parfum sur mesure Olfamatch – ${code} – ${FORMATS[format].detail}`);

  // Stock restant par note : stock pesé, moins ce que demandent les commandes payées pas encore pesées.
  async function stockDisponible() {
    const stocks = new Map(((await db.prepare("SELECT code_note, grammes FROM stocks").all()).results || []).map(r => [r.code_note, r.grammes]));
    const enAttente = (await db.prepare("SELECT c.format, c.quantite, f.concentration, f.notes FROM commandes c JOIN formules f ON f.code = c.code WHERE c.statut = 'payee'").all()).results || [];
    for (const c of enAttente) {
      const b = atelier.besoins({ concentration: c.concentration, notes: JSON.parse(c.notes) }, c.format, c.quantite);
      for (const [code, g] of Object.entries(b)) if (stocks.has(code)) stocks.set(code, stocks.get(code) - g);
    }
    return stocks;
  }

  async function codeKitValable(codeKit, code) {
    const ligne = await db.prepare("SELECT * FROM codes_kit WHERE code_promo = ?").bind(codeKit).first();
    if (!ligne) return { erreur: "Ce code de réduction n'existe pas." };
    if (ligne.formule !== code) return { erreur: "Ce code de réduction est lié à une autre formule." };
    if (ligne.utilise) return { erreur: "Ce code de réduction a déjà servi." };
    if (Date.parse(ligne.expire_le) < maintenant()) return { erreur: "Ce code de réduction a expiré." };
    return { ligne };
  }

  async function checkout(corps) {
    // Le navigateur n'envoie que ces 4 champs : jamais de prix, jamais de nom de parfum.
    if (!clesPermises(corps, ["code", "format", "quantite", "code_kit"])) return json({ erreur: "Demande mal formée." }, 400);
    const vente = moteur.etatVente();
    if (!vente.ok) return json({ erreur: "Bientôt disponible.", vente: false }, 403);
    if (!env.STRIPE_SECRET_KEY || !SITE) return json({ erreur: "Paiement indisponible pour le moment." }, 503);
    const lu = lireCode(corps.code);
    if (!lu.ok) return json({ erreur: lu.erreur }, 400);
    const format = String(corps.format);
    if (!propre(FORMATS, format)) return json({ erreur: "Format inconnu : kit, 50 ou 100." }, 400);
    const quantite = corps.quantite === undefined ? 1 : corps.quantite;
    const qMax = format === "kit" ? 1 : B.quantite_max || 3;
    if (!(Number.isInteger(quantite) && quantite >= 1 && quantite <= qMax)) return json({ erreur: `Quantité entre 1 et ${qMax}.` }, 400);

    const trouve = await lireFormuleBase(lu.code);
    if (!trouve) return json({ erreur: "Ce code n'existe pas." }, 404);
    if (!(await integre(trouve.ligne))) return json({ erreur: "Cette formule ne peut pas être relue." }, 500);
    // Toutes les règles relancées avec les lots du jour.
    const ev = moteur.evaluer(trouve.formule, { porte: trouve.ligne.porte, confirme: Boolean(trouve.ligne.confirme) });
    if (!ev.conforme) return json({ erreur: "Formule à mettre à jour.", a_mettre_a_jour: true }, 409);
    if (ev.commande !== "oui") return json({ erreur: "Cette formule ne peut pas être commandée telle quelle.", ...resume(ev) }, 409);

    // Stock suffisant pour cette commande (et celles déjà payées en attente).
    const stock = await stockDisponible();
    const besoin = atelier.besoins(trouve.formule, format, quantite);
    for (const [code, g] of Object.entries(besoin))
      if (!stock.has(code) || stock.get(code) < g) return json({ erreur: "Une des notes est en rupture de stock pour le moment." }, 409);

    let remise = 0, codeKit = null, discounts;
    if (corps.code_kit !== undefined && corps.code_kit !== null && corps.code_kit !== "") {
      if (format === "kit") return json({ erreur: "Le code du kit sert pour un flacon." }, 400);
      codeKit = String(corps.code_kit).toUpperCase().replace(/\s/g, "").slice(0, 40);
      const v = await codeKitValable(codeKit, lu.code);
      if (v.erreur) return json({ erreur: v.erreur }, 400);
      remise = prixCentimes("kit");
      discounts = [{ promotion_code: v.ligne.stripe_promotion_id }];
    }
    const unitaire = prixCentimes(format);
    const attendu = unitaire * quantite - remise;
    const versions = ev.securite.versions;
    const metadata = { code: lu.code, format, hash_canonique: trouve.ligne.hash_canonique, moteur_version: versions.moteur_version, cadre_version: versions.cadre_version ?? "-" };
    const params = {
      mode: "payment",
      locale: "fr",
      client_reference_id: lu.code,
      line_items: [{ price_data: { currency: "eur", unit_amount: unitaire, product_data: { name: nomProduit(lu.code, format) } }, quantity: quantite }],
      metadata,
      payment_intent_data: { metadata },
      shipping_address_collection: { allowed_countries: B.pays_livraison || ["FR"] },
      success_url: `${SITE}/creer-mon-parfum/merci/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/creer-mon-parfum/?code=${encodeURIComponent(lu.code)}`,
      ...(discounts ? { discounts } : {}),
    };
    let session;
    try { session = await stripe.creerSession(params); } catch (e) {
      console.log(`Création du paiement impossible : ${e.message}`);
      return json({ erreur: "Paiement indisponible pour le moment, réessaie dans quelques minutes." }, 502);
    }
    await db.prepare(`INSERT INTO commandes (session_id, code, format, quantite, prix_unitaire_centimes, remise_centimes, montant_attendu_centimes,
        code_kit, statut, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'creee', ?)`)
      .bind(session.id, lu.code, format, quantite, unitaire, remise, attendu, codeKit, iso()).run();
    return json({ url: session.url });
  }

  // ---------------- notification de paiement (webhook) ----------------

  async function envoyerEmail(sujet, corps) {
    if (!env.EMAIL || !EmailMessage || !env.EMAIL_ATELIER || !env.EMAIL_EXPEDITEUR) { console.log(`E-mail non envoyé (pas configuré) : ${sujet}`); return; }
    const raw = messageBrut({ de: env.EMAIL_EXPEDITEUR, a: env.EMAIL_ATELIER, sujet, corps, date: new Date(maintenant()) });
    await env.EMAIL.send(new EmailMessage(env.EMAIL_EXPEDITEUR, env.EMAIL_ATELIER, raw));
  }

  // Numéro de lot LAAMM-NNNN : L + année + mois + compteur du mois (ex. L2611-0042).
  async function numeroLot() {
    const d = new Date(maintenant());
    const prefixe = `L${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}-`;
    const r = await db.prepare("SELECT COUNT(*) AS n FROM commandes WHERE numero_lot LIKE ?").bind(`${prefixe}%`).first();
    return `${prefixe}${String((r?.n || 0) + 1).padStart(4, "0")}`;
  }

  // Code de réduction du kit, toujours le même pour une même session (Stripe peut renvoyer la notification).
  async function codePromoKit(sessionId) {
    const h = await sha256Hex(`kit:${sessionId}`);
    let s = "";
    for (let i = 0; i < 8; i++) s += ALPHABET[parseInt(h.slice(i * 2, i * 2 + 2), 16) % 32];
    return `KIT-${s}`;
  }

  function adresseClient(session) {
    const a = session.shipping_details?.address || session.customer_details?.address;
    if (!a) return null;
    return [session.shipping_details?.name, a.line1, a.line2, `${a.postal_code || ""} ${a.city || ""}`.trim(), a.country].filter(Boolean).join(", ");
  }

  // Compare la session payée à ce que le programme recalcule lui-même. Renvoie la liste des écarts.
  async function ecarts(session, commande, trouve) {
    const res = [];
    const meta = session.metadata || {};
    const items = session.line_items?.data || [];
    if (!trouve) return ["La formule de cette commande est introuvable dans la base."];
    if (!(await integre(trouve.ligne))) res.push("La formule enregistrée a été modifiée dans la base.");
    if (meta.code !== commande.code || session.client_reference_id !== commande.code) res.push("Le code de formule de la session ne correspond pas à la commande.");
    if (meta.format !== commande.format) res.push(`Format payé « ${meta.format} » différent du format commandé « ${commande.format} ».`);
    if (meta.hash_canonique !== trouve.ligne.hash_canonique) res.push("L'empreinte de la formule ne correspond pas.");
    if (items.length !== 1) res.push(`La session contient ${items.length} articles au lieu d'un.`);
    else {
      const it = items[0];
      if (it.quantity !== commande.quantite) res.push(`Quantité payée ${it.quantity}, commandée ${commande.quantite}.`);
      if (it.price?.unit_amount !== prixCentimes(commande.format)) res.push(`Prix unitaire payé ${euros(it.price?.unit_amount ?? 0)}, prix prévu ${euros(prixCentimes(commande.format))}.`);
      if (it.description && it.description !== nomProduit(commande.code, commande.format)) res.push("Le nom du produit payé ne correspond pas.");
    }
    const attendu = prixCentimes(commande.format) * commande.quantite - commande.remise_centimes;
    if (attendu !== commande.montant_attendu_centimes) res.push("Les prix ont changé depuis la création du paiement.");
    if (session.amount_total !== attendu) res.push(`Montant reçu ${euros(session.amount_total ?? 0)}, montant attendu ${euros(attendu)}.`);
    if (String(session.currency).toLowerCase() !== "eur") res.push(`Devise inattendue : ${session.currency}.`);
    if (session.payment_status !== "paid") res.push(`Statut du paiement : ${session.payment_status}.`);
    if ((session.total_details?.amount_discount || 0) !== commande.remise_centimes) res.push("La réduction appliquée ne correspond pas au code du kit.");
    // Les règles de sécurité, relancées avec les lots du jour (variantes du kit comprises).
    const s = moteur.securite(trouve.formule);
    if (!s.ok) res.push(`La formule ne respecte plus les règles de sécurité : ${s.erreurs.map(e => e.message).join(" ; ")}`);
    if (commande.format === "kit" && !moteur.variantesKit(trouve.formule).every(v => moteur.securite(v.formule).ok)) res.push("Une variante du kit ne respecte pas les règles de sécurité.");
    if (!moteur.etatVente().ok) res.push("La vente a été coupée entre-temps.");
    return res;
  }

  async function webhook(requete) {
    if (!env.STRIPE_WEBHOOK_SECRET) return texte("Configuration incomplète : secret Stripe manquant.", 500);
    if (Number(requete.headers.get("content-length") || 0) > TAILLE_MAX_STRIPE) return texte("Message trop gros.", 413);
    const brut = await requete.text();
    if (brut.length > TAILLE_MAX_STRIPE) return texte("Message trop gros.", 413);
    const ok = await signatureValide(requete.headers.get("stripe-signature"), brut, env.STRIPE_WEBHOOK_SECRET, Math.floor(maintenant() / 1000), Number(env.STRIPE_TOLERANCE_S) || 300);
    if (!ok) return texte("Signature invalide.", 400);
    let evenement;
    try { evenement = JSON.parse(brut); } catch { return texte("Message illisible.", 400); }
    const types = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
    const objet = evenement?.data?.object;
    if (!types.includes(evenement?.type) || !objet?.id) return json({ recu: true, traite: false });
    // Paiement encore en attente (virement…) : Stripe enverra async_payment_succeeded plus tard.
    if (evenement.type === "checkout.session.completed" && objet.payment_status === "unpaid") return json({ recu: true, traite: false, raison: "paiement en attente" });

    // Anti-doublon : une notification déjà traitée est ignorée.
    try {
      await db.prepare("INSERT INTO evenements_stripe (event_id, type, session_id, recu_le) VALUES (?, ?, ?, ?)").bind(String(evenement.id), evenement.type, objet.id, iso()).run();
    } catch { return json({ recu: true, traite: false, raison: "déjà traitée" }); }
    const oublier = () => db.prepare("DELETE FROM evenements_stripe WHERE event_id = ?").bind(String(evenement.id)).run();

    try {
      const commande = await db.prepare("SELECT * FROM commandes WHERE session_id = ?").bind(objet.id).first();
      // Paiement qui ne vient pas de ce programme (autre vente, lien de paiement…) : rien à faire.
      if (!commande) return json({ recu: true, traite: false, raison: "session inconnue" });
      if (commande.statut !== "creee") return json({ recu: true, traite: false, raison: "commande déjà traitée" });

      // On relit la session chez Stripe (avec ses articles) au lieu de croire la notification.
      const session = await stripe.lireSession(objet.id);
      const trouve = await lireFormuleBase(commande.code);
      const liste = await ecarts(session, commande, trouve);
      const client = session.customer_details || {};
      const adresse = adresseClient(session);

      if (liste.length) {
        await envoyerEmail(`BLOQUÉE – à vérifier · NE PAS FABRIQUER · commande ${commande.code}`, [
          "!!! COMMANDE BLOQUÉE – à vérifier. NE PAS FABRIQUER avant d'avoir regardé dans Stripe. !!!", "",
          "Écarts trouvés :", ...liste.map(e => `  - ${e}`), "",
          `Session Stripe : ${session.id}`, `Code de formule : ${commande.code}`, `Format : ${FORMATS[commande.format]?.nom || commande.format} × ${commande.quantite}`,
          `Montant reçu : ${euros(session.amount_total ?? 0)} (attendu ${euros(commande.montant_attendu_centimes)})`,
          `Client : ${client.name || "?"} <${client.email || "?"}>`, "",
          "Aucune fiche de pesée n'est créée pour cette commande.",
        ].join("\n"));
        await db.prepare("UPDATE commandes SET statut = 'bloquee', raison_blocage = ?, montant_recu_centimes = ?, nom_client = ?, email_client = ?, adresse = ?, maj_le = ? WHERE session_id = ?")
          .bind(liste.join(" | "), session.amount_total ?? null, client.name || null, client.email || null, adresse, iso(), commande.session_id).run();
        return json({ recu: true, traite: true, statut: "bloquee" });
      }

      // Kit : code de réduction de 10 €, un seul usage, 90 jours, réservé à un flacon de la même formule.
      let kit = null;
      if (commande.format === "kit") {
        const codePromo = await codePromoKit(commande.session_id);
        const expire = Math.floor((maintenant() + 90 * JOUR_MS) / 1000);
        const coupon = await stripe.creerCoupon({ amount_off: prixCentimes("kit"), currency: "eur", duration: "once", max_redemptions: 1, redeem_by: expire,
          name: "Kit Olfamatch déduit", metadata: { formule: commande.code } }, `coupon-${commande.session_id}`);
        const promo = await stripe.creerCodePromo({ coupon: coupon.id, code: codePromo, max_redemptions: 1, expires_at: expire, metadata: { formule: commande.code } },
          `promo-${commande.session_id}`);
        kit = { code: codePromo, id: promo.id, expire: new Date(expire * 1000).toISOString() };
      }

      const lots = Object.fromEntries(Object.keys(trouve.formule.notes).map(c => [c, moteur.lotDe(c)?.lot || null]));
      let numero = await numeroLot();
      await envoyerEmail(`Nouvelle commande ${numero} · ${FORMATS[commande.format].nom}${commande.quantite > 1 ? ` × ${commande.quantite}` : ""} · ${commande.code}`, [
        "Nouvelle commande « Crée ton parfum » payée et vérifiée.", "",
        `Numéro de lot : ${numero}`, `Code de formule : ${commande.code}`, `Format : ${FORMATS[commande.format].nom} × ${commande.quantite}`,
        `Montant reçu : ${euros(session.amount_total)}`, `Client : ${client.name || "?"} <${client.email || "?"}>`, `Adresse : ${adresse || "non renseignée"}`,
        kit ? `Code de réduction à glisser dans le colis : ${kit.code} (10 €, valable jusqu'au ${kit.expire.slice(0, 10)}, pour un flacon de la même formule)` : null,
        commande.code_kit ? `Code de réduction du kit utilisé : ${commande.code_kit}` : null,
        "", SITE ? `Fiche de fabrication : ${SITE}/fabrication/?commande=${encodeURIComponent(commande.session_id)}` : "Fiche : page privée de fabrication.",
      ].filter(l => l !== null).join("\n"));

      // Le numéro de lot est unique : en cas de commande simultanée, on prend le suivant.
      for (let essai = 0; ; essai++) {
        try {
          await db.prepare(`UPDATE commandes SET statut = 'payee', numero_lot = ?, lots = ?, montant_recu_centimes = ?, nom_client = ?, email_client = ?,
              adresse = ?, paye_le = ?, maj_le = ? WHERE session_id = ?`)
            .bind(numero, JSON.stringify(lots), session.amount_total, client.name || null, client.email || null, adresse, iso(), iso(), commande.session_id).run();
          break;
        } catch (e) {
          if (essai >= 5) throw e;
          numero = `${numero.slice(0, 6)}${String(Number(numero.slice(6)) + 1).padStart(4, "0")}`;
        }
      }
      for (const [code, lot] of Object.entries(lots)) {
        const l = moteur.lotDe(code);
        if (lot && l) await db.prepare("INSERT OR IGNORE INTO lots (lot, code_note, donnees, premier_usage) VALUES (?, ?, ?, ?)").bind(lot, code, JSON.stringify(l), iso()).run();
      }
      if (kit) await db.prepare("INSERT OR IGNORE INTO codes_kit (code_promo, formule, stripe_promotion_id, session_kit, expire_le, utilise) VALUES (?, ?, ?, ?, ?, 0)")
        .bind(kit.code, commande.code, kit.id, commande.session_id, kit.expire).run();
      if (commande.code_kit) await db.prepare("UPDATE codes_kit SET utilise = 1 WHERE code_promo = ?").bind(commande.code_kit).run();
      return json({ recu: true, traite: true, statut: "payee", numero_lot: numero });
    } catch (e) {
      // Échec (Stripe injoignable, e-mail refusé…) : on oublie la notification pour que Stripe la renvoie.
      console.log(`Notification ${evenement.id} non traitée : ${e && e.message}`);
      await oublier();
      return texte("Traitement impossible pour le moment, Stripe réessaiera.", 500);
    }
  }

  // ---------------- aiguillage ----------------

  async function traiter(requete) {
    const url = new URL(requete.url);
    const chemin = url.pathname;
    if (chemin === "/api/webhook-stripe") return requete.method === "POST" ? webhook(requete) : texte("Méthode non permise.", 405);
    if (!chemin.startsWith("/api/")) return texte("Page introuvable.", 404);

    // Le site seulement (SITE_ORIGINS), et un nombre de demandes limité par personne.
    const origine = requete.headers.get("origin");
    if (!origine || !ORIGINES.includes(origine)) return texte("Origine refusée.", 403);
    const cors = enTetesCors(origine);
    if (requete.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (env.LIMITE_API) {
      try {
        const { success } = await env.LIMITE_API.limit({ key: `api:${requete.headers.get("cf-connecting-ip") || "inconnue"}` });
        if (!success) return json({ erreur: "Trop de demandes : réessaie dans une minute." }, 429, cors);
      } catch (e) { console.log(`Limite indisponible : ${e && e.message}`); }
    }
    if (!db) return json({ erreur: "Configuration incomplète : base de données manquante." }, 500, cors);
    const avecCors = async promesse => {
      const r = await promesse;
      for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
      return r;
    };

    if (chemin === "/api/formule" && requete.method === "GET") return avecCors(relireFormule(url));
    if (chemin.startsWith("/api/ia/")) {
      if (requete.method !== "POST") return json({ erreur: "Méthode non permise." }, 405, cors);
      const lu = await lireJSON(requete, 2048);
      if (lu.erreur) return json({ erreur: lu.erreur[0] }, lu.erreur[1], cors);
      const ip = requete.headers.get("cf-connecting-ip") || "inconnue";
      if (chemin === "/api/ia/comprendre") {
        const r = await ia.comprendre(lu.valeur, ip);
        return json(r.corps, r.statut, cors);
      }
      if (chemin === "/api/ia/expliquer") {
        if (!clesPermises(lu.valeur, ["code"])) return json({ erreur: "Demande mal formée." }, 400, cors);
        const code = lireCode(lu.valeur.code);
        if (!code.ok) return json({ erreur: code.erreur }, 400, cors);
        const trouve = await lireFormuleBase(code.code);
        if (!trouve) return json({ erreur: "Ce code n'existe pas." }, 404, cors);
        if (!(await integre(trouve.ligne))) return json({ erreur: "Cette formule ne peut pas être relue." }, 500, cors);
        const r = await ia.expliquer(trouve.formule, code.code, ip);
        return json(r.corps, r.statut, cors);
      }
      return json({ erreur: "Adresse inconnue." }, 404, cors);
    }
    if ((chemin === "/api/formule" || chemin === "/api/checkout") && requete.method === "POST") {
      const lu = await lireJSON(requete);
      if (lu.erreur) return json({ erreur: lu.erreur[0] }, lu.erreur[1], cors);
      const refus = refusInspiration(lu.valeur);
      if (refus) return json({ erreur: refus }, 400, cors);
      return avecCors(chemin === "/api/formule" ? creerFormule(lu.valeur) : checkout(lu.valeur));
    }
    if (["/api/formule", "/api/checkout"].includes(chemin)) return json({ erreur: "Méthode non permise." }, 405, cors);
    return json({ erreur: "Adresse inconnue." }, 404, cors);
  }

  return { traiter, moteur };
}
