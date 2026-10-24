/*
 * Atelier privé de fabrication (§ B9, B13, B14) : servi par le programme Cloudflare lui-même,
 * protégé par Cloudflare Access (compte d'Ethan uniquement, voir acces.js).
 *
 *   GET  /fabrication                    la page (tableau de bord, fiches, étiquettes, stocks, essais)
 *   GET  /api/fabrication/tableau        commandes à faire, rappels (pesée, froid, expédition), stocks
 *   GET  /api/fabrication/commande?id=   fiche de pesée d'une commande payée et vérifiée
 *   POST /api/fabrication/pesee          masses réelles → validation (tolérance), stock décompté, macération
 *   POST /api/fabrication/etape          « prete » (après froid et filtration) ou « expediee » (numéro de suivi)
 *   GET/POST /api/fabrication/stocks     stock de chaque flacon de stock
 *   GET/POST /api/fabrication/essais     grille d'essai des recettes, passage en « validee »
 *   GET  /api/fabrication/essai?recette= mini-lot d'essai (10 g à 18 %)
 */
import { pageFabrication } from "./page-fabrication.js";

const JOUR_MS = 24 * 3600 * 1000;
const json = (donnee, statut = 200) => new Response(JSON.stringify(donnee), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const propre = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const STATUTS_FICHE = ["payee", "en_maceration", "prete", "expediee"];

export function creerAtelier({ donnees, moteur, atelier, acces, db, maintenant, envoyerEmailClient, FORMATS }) {
  const R = donnees.regles, F = R.fabrication, REC = donnees.recettes.recettes;
  const N = new Map(Object.values(donnees.notes.notes).map(n => [n.code, n]));
  const iso = (ms = maintenant()) => new Date(ms).toISOString();

  async function lireCorps(requete) {
    const brut = await requete.text();
    if (brut.length > 16 * 1024) return null;
    try { return JSON.parse(brut); } catch { return null; }
  }

  async function commandeAvecFormule(id) {
    const c = await db.prepare("SELECT c.*, f.concentration, f.notes AS notes_formule FROM commandes c JOIN formules f ON f.code = c.code WHERE c.session_id = ?").bind(String(id)).first();
    if (!c) return null;
    return { c, formule: { concentration: c.concentration, notes: JSON.parse(c.notes_formule) } };
  }

  // ---------------- tableau de bord ----------------

  async function tableau() {
    const commandes = (await db.prepare(`SELECT session_id, code, format, quantite, statut, numero_lot, nom_client, raison_blocage, cree_le, paye_le,
        maceration_debut, maceration_fin, suivi FROM commandes WHERE statut != 'creee' ORDER BY COALESCE(paye_le, cree_le) DESC LIMIT 200`).all()).results || [];
    const rappels = [];
    const maintenantMs = maintenant();
    for (const c of commandes) {
      const nom = c.numero_lot || c.code;
      if (c.statut === "bloquee") rappels.push({ niveau: "alerte", texte: `Commande ${c.code} BLOQUÉE – à vérifier dans Stripe : ${c.raison_blocage || ""}` });
      if (c.statut === "payee") rappels.push({ niveau: "a_faire", texte: `${nom} : à peser (${FORMATS[c.format]?.nom || c.format}${c.quantite > 1 ? ` × ${c.quantite}` : ""}).` });
      if (c.statut === "en_maceration" && Date.parse(c.maceration_fin) <= maintenantMs)
        rappels.push({ niveau: "a_faire", texte: `${nom} : macération finie. ${F.froid_heures || "24 à 48"} h au froid, filtrer, puis marquer « prête ».` });
      if (c.statut === "prete") rappels.push({ niveau: "a_faire", texte: `${nom} : prête à expédier (marquage LQ sur le colis).` });
    }
    const stocks = (await db.prepare("SELECT * FROM stocks ORDER BY code_note").all()).results || [];
    return { commandes, rappels, stocks, vente: moteur.etatVente() };
  }

  // ---------------- fiche d'une commande ----------------

  async function fiche(id) {
    const t = await commandeAvecFormule(id);
    if (!t) return json({ erreur: "Commande introuvable." }, 404);
    const { c, formule } = t;
    if (!STATUTS_FICHE.includes(c.statut))
      return json({ erreur: c.statut === "bloquee" ? "Commande BLOQUÉE – à vérifier : pas de fiche de pesée." : "Commande pas encore payée : pas de fiche de pesée." }, 409);
    const preparations = atelier.fichePesee(formule, c.format, c.quantite);
    const kit = await db.prepare("SELECT code_promo, expire_le FROM codes_kit WHERE session_kit = ?").bind(c.session_id).first();
    const lots = Object.keys(formule.notes).map(code => {
      const l = moteur.lotDe(code);
      return { code, nom: N.get(code).nom, lot: l?.lot || null, demo: l?.demo === true, dilution_stock: N.get(code).dilution_stock };
    });
    return json({
      commande: {
        id: c.session_id, code: c.code, format: c.format, nom_format: FORMATS[c.format]?.nom || c.format, quantite: c.quantite, statut: c.statut,
        numero_lot: c.numero_lot, client: { nom: c.nom_client, email: c.email_client, adresse: c.adresse }, paye_le: c.paye_le,
        maceration_debut: c.maceration_debut, maceration_fin: c.maceration_fin, suivi: c.suivi, montant_recu_centimes: c.montant_recu_centimes,
        code_kit_a_glisser: kit ? { code: kit.code_promo, expire_le: kit.expire_le } : null, code_kit_utilise: c.code_kit,
      },
      formule, lots, preparations: preparations.map(p => ({ nom: p.nom, formule: p.formule, fiche: p.fiche })),
      pesee: c.pesee ? JSON.parse(c.pesee) : null,
      etiquette: atelier.etiquette(formule, { format: c.format, numero_lot: c.numero_lot }),
      allergenes: moteur.allergenes(formule).a_etiqueter.map(a => ({ inci: a.inci, pct_produit: a.pct_produit })),
      securite: { conforme: moteur.securite(formule).ok, erreurs: moteur.securite(formule).erreurs.map(e => e.message) },
      ordre: "Ordre d'ajout : fond, cœur, tête, puis l'alcool. Balance au 0,01 g.",
    });
  }

  // ---------------- pesée ----------------

  async function pesee(corps) {
    if (!corps || typeof corps.id !== "string" || typeof corps.masses !== "object" || !corps.masses) return json({ erreur: "Demande mal formée." }, 400);
    const t = await commandeAvecFormule(corps.id);
    if (!t) return json({ erreur: "Commande introuvable." }, 404);
    const { c, formule } = t;
    if (c.statut !== "payee") return json({ erreur: c.statut === "bloquee" ? "Commande BLOQUÉE : pesée impossible." : "Cette commande a déjà été pesée (ou n'est pas payée)." }, 409);
    if (!moteur.securite(formule).ok) return json({ erreur: "La formule ne respecte plus les règles de sécurité : ne pas fabriquer." }, 409);
    if (Object.keys(formule.notes).some(code => moteur.lotDe(code)?.demo === true)) return json({ erreur: "Lots de démonstration : ne pas fabriquer avec." }, 409);
    const preparations = atelier.fichePesee(formule, c.format, c.quantite);
    const v = atelier.verifierPesee(preparations, corps.masses);
    if (!v.ok) return json({ erreur: "Pesée hors tolérance ou incomplète : corrige les lignes en rouge avant de valider.", ...v }, 422);
    const debut = maintenant();
    const fin = debut + (F.maceration_jours || 14) * JOUR_MS;
    await db.prepare("UPDATE commandes SET statut = 'en_maceration', pesee = ?, maceration_debut = ?, maceration_fin = ?, maj_le = ? WHERE session_id = ? AND statut = 'payee'")
      .bind(JSON.stringify({ masses: corps.masses, le: iso(debut) }), iso(debut), iso(fin), iso(debut), c.session_id).run();
    // Décompte des stocks : masse réellement prise dans chaque flacon de stock.
    const parNote = {};
    for (const l of v.lignes) if (l.code !== "ALC") parNote[l.code] = (parNote[l.code] || 0) + l.reel_g;
    for (const [code, g] of Object.entries(parNote))
      await db.prepare("UPDATE stocks SET grammes = grammes - ?, maj_le = ? WHERE code_note = ?").bind(Math.round(g * 1000) / 1000, iso(debut), code).run();
    return json({ ok: true, statut: "en_maceration", maceration_debut: iso(debut), maceration_fin: iso(fin),
      rappel: `Laisser reposer à l'abri de la lumière jusqu'au ${iso(fin).slice(0, 10)}, puis ${F.froid_heures || "24 à 48"} h au froid et filtrer.` });
  }

  // ---------------- étapes suivantes ----------------

  async function etape(corps) {
    if (!corps || typeof corps.id !== "string" || !["prete", "expediee"].includes(corps.action)) return json({ erreur: "Demande mal formée." }, 400);
    const t = await commandeAvecFormule(corps.id);
    if (!t) return json({ erreur: "Commande introuvable." }, 404);
    const { c } = t;
    if (corps.action === "prete") {
      if (c.statut !== "en_maceration") return json({ erreur: "La commande n'est pas en macération." }, 409);
      if (Date.parse(c.maceration_fin) > maintenant()) return json({ erreur: `Macération pas finie : attendre le ${c.maceration_fin.slice(0, 10)}.` }, 409);
      await db.prepare("UPDATE commandes SET statut = 'prete', maj_le = ? WHERE session_id = ?").bind(iso(), c.session_id).run();
      return json({ ok: true, statut: "prete" });
    }
    const suivi = String(corps.suivi || "").trim().slice(0, 60);
    if (c.statut !== "prete") return json({ erreur: "La commande n'est pas prête à expédier." }, 409);
    if (!suivi) return json({ erreur: "Indique le numéro de suivi du colis." }, 400);
    await db.prepare("UPDATE commandes SET statut = 'expediee', suivi = ?, maj_le = ? WHERE session_id = ?").bind(suivi, iso(), c.session_id).run();
    let email = "pas d'adresse";
    if (c.email_client) {
      try {
        await envoyerEmailClient(c.email_client, `Ton parfum Olfamatch est en route · ${c.code}`, [
          `Bonjour${c.nom_client ? ` ${c.nom_client.split(" ")[0]}` : ""},`, "",
          "Ton parfum a été préparé à la main, a reposé, et il vient de partir.",
          `Numéro de suivi : ${suivi}`, `Code de ta formule : ${c.code}`, "",
          "Garde ce code : il permet de recommander exactement le même parfum.", "", "À bientôt,", "Olfamatch",
        ].join("\n"));
        email = "envoyé";
      } catch (e) { email = `non envoyé (${e.code || e.message})`; }
    }
    return json({ ok: true, statut: "expediee", email });
  }

  // ---------------- stocks ----------------

  async function majStock(corps) {
    if (!corps || !N.has(corps.code_note) || !(Number.isFinite(Number(corps.grammes)) && Number(corps.grammes) >= 0)) return json({ erreur: "Note ou quantité incorrecte." }, 400);
    const lot = corps.lot ? String(corps.lot).slice(0, 40) : moteur.lotDe(corps.code_note)?.lot || null;
    await db.prepare(`INSERT INTO stocks (code_note, lot, grammes, maj_le) VALUES (?, ?, ?, ?)
      ON CONFLICT(code_note) DO UPDATE SET lot = excluded.lot, grammes = excluded.grammes, maj_le = excluded.maj_le`)
      .bind(corps.code_note, lot, Number(corps.grammes), iso()).run();
    return json({ ok: true });
  }

  // ---------------- essais des recettes (§ B9) ----------------

  function statutEssai(e) {
    const notes = [e.tete, e.coeur, e.fond, e.sillage].map(Number);
    if (!notes.every(x => Number.isFinite(x) && x >= 0 && x <= 5)) return null;
    const moyenne = Math.round((notes.reduce((s, x) => s + x, 0) / 4) * 100) / 100;
    return { moyenne, statut: moyenne >= (F.validation_note_min ?? 3.5) && e.stabilite_ok === true ? "validee" : "a_valider" };
  }

  async function ajouterEssai(corps) {
    if (!corps || !propre(REC, corps.recette)) return json({ erreur: "Recette inconnue." }, 400);
    const s = statutEssai(corps);
    if (!s) return json({ erreur: "Notes de 0 à 5 attendues pour la tête, le cœur, le fond et le sillage." }, 400);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(corps.date || "")) ? corps.date : iso().slice(0, 10);
    const stab = corps.stabilite_ok === true ? 1 : corps.stabilite_ok === false ? 0 : null;
    await db.prepare("INSERT INTO essais (recette, date, tete, coeur, fond, tenue_h, sillage, stabilite_ok, remarques, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(corps.recette, date, Number(corps.tete), Number(corps.coeur), Number(corps.fond), Number.isFinite(Number(corps.tenue_h)) ? Number(corps.tenue_h) : null,
        Number(corps.sillage), stab, String(corps.remarques || "").slice(0, 1000), s.statut).run();
    return json({ ok: true, ...s, rappel: s.statut === "validee" ? `Pense à mettre "statut": "validee" pour ${corps.recette} dans recettes.json.` : null });
  }

  async function essais() {
    const liste = (await db.prepare("SELECT * FROM essais ORDER BY date DESC, id DESC LIMIT 500").all()).results || [];
    const recettes = Object.entries(REC).map(([code, r]) => ({ code, nom: r.nom, statut_fichier: r.statut,
      statut_essais: liste.find(e => e.recette === code)?.statut || null }));
    return json({ essais: liste, recettes, protocole: PROTOCOLE });
  }

  function ficheEssai(code) {
    if (!propre(REC, code)) return json({ erreur: "Recette inconnue." }, 400);
    const f = { concentration: F.essai_concentration || 18, notes: { ...REC[code].notes } };
    return json({ recette: code, nom: REC[code].nom, ...atelier.grammesMasse(f, F.essai_masse_g || 10), conforme: moteur.securite(f).ok });
  }

  const PROTOCOLE = [
    `Essai : mini-lot de ${F.essai_masse_g || 10} g à ${F.essai_concentration || 18} %. Mouillettes à T0, 1 h, 6 h et 24 h. Essai sur la peau de 3 à 5 personnes.`,
    "Macération : sentir à J7, J14 et J28.",
    "Stabilité (dossier pour l'évaluateur) : un échantillon à 40 °C, un au réfrigérateur, un à la lumière, pendant 4 semaines. Noter couleur, odeur, dépôt, trouble.",
    `Grille notée sur 5 : tête, cœur, fond, sillage (et tenue en heures). La recette passe « validee » avec une moyenne d'au moins ${F.validation_note_min ?? 3.5} et aucun défaut de stabilité.`,
  ];

  // ---------------- aiguillage ----------------

  async function traiter(requete, url) {
    const chemin = url.pathname;
    if (chemin !== "/fabrication" && chemin !== "/fabrication/" && !chemin.startsWith("/api/fabrication/")) return null;
    const ok = await acces.verifier(requete);
    if (!ok.ok) return new Response(`Accès refusé : ${ok.raison}`, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (!chemin.startsWith("/api/")) {
      if (requete.method !== "GET") return new Response("Méthode non permise.", { status: 405 });
      return new Response(pageFabrication(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'", "X-Robots-Tag": "noindex" } });
    }
    if (!db) return json({ erreur: "Base de données manquante." }, 500);
    // Les modifications ne viennent que de la page elle-même (même adresse).
    if (requete.method === "POST") {
      const origine = requete.headers.get("origin");
      if (origine && origine !== url.origin) return json({ erreur: "Origine refusée." }, 403);
    }
    const route = chemin.slice("/api/fabrication/".length);
    const methode = requete.method;
    if (route === "tableau" && methode === "GET") return json(await tableau());
    if (route === "commande" && methode === "GET") return fiche(url.searchParams.get("id") || "");
    if (route === "essai" && methode === "GET") return ficheEssai(url.searchParams.get("recette"));
    if (route === "essais" && methode === "GET") return essais();
    if (route === "stocks" && methode === "GET") return json({ stocks: (await db.prepare("SELECT * FROM stocks ORDER BY code_note").all()).results || [] });
    if (methode === "POST" && ["pesee", "etape", "stocks", "essais"].includes(route)) {
      const corps = await lireCorps(requete);
      if (!corps) return json({ erreur: "Demande illisible." }, 400);
      if (route === "pesee") return pesee(corps);
      if (route === "etape") return etape(corps);
      if (route === "stocks") return majStock(corps);
      return ajouterEssai(corps);
    }
    return json({ erreur: "Adresse inconnue." }, 404);
  }

  return { traiter };
}
