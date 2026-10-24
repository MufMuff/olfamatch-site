// IA (§ B10) : rôle 1 « comprendre », rôle 2 « expliquer », garde-fous, sans réseau (réponses de l'IA simulées).
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerControleTextes } from "../../src/creer/mots.js";
import { monter, appel, R01, PARFUMS, fausseMemoire, donneesEnVente, SITE } from "./outils.mjs";

const ctl = creerControleTextes(PARFUMS);
const message = (texte, extra = {}) => ({ type: "message", role: "assistant", content: [{ type: "text", text: texte }], stop_reason: "end_turn", usage: { output_tokens: 120 }, ...extra });
const EXPLICATION = "Ce parfum s'ouvre sur un éclat d'agrumes vif et pétillant, porté par la bergamote et le citron. "
  + "Très vite, une lavande fraîche et un jasmin lumineux prennent le relais et donnent de la douceur au départ. "
  + "Sur la peau, le musc blanc et le cèdre installent un fond propre et boisé, net comme du linge séché au soleil. "
  + "L'ensemble reste clair et facile à porter, idéal pour les journées où tu veux te sentir frais du matin au soir. "
  + "Les agrumes et le musc s'entendent très bien : l'un apporte l'élan, l'autre le confort, et la lavande fait le lien entre les deux.";

async function code(app) {
  return (await (await appel(app, "/api/formule", { corps: { formule: R01() } })).json()).code;
}

test("expliquer : texte de l'IA renvoyé et gardé 30 jours ; la formule est relue dans la base, pas envoyée par le navigateur", async () => {
  const memoire = fausseMemoire();
  const { app, appelsIA } = await monter({ env: { ANTHROPIC_API_KEY: "sk-ant-test", MEMOIRE: memoire }, ia: () => message(EXPLICATION) });
  const c = await code(app);
  const r = await appel(app, "/api/ia/expliquer", { corps: { code: c } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.deepEqual(await r.json(), { texte: EXPLICATION, source: "ia" });
  assert.equal(memoire.durees.get(`expliquer:${c}`), 60 * 60 * 24 * 30);
  // deuxième demande : depuis la mémoire, sans appeler l'IA
  await appel(app, "/api/ia/expliquer", { corps: { code: c } });
  assert.equal(appelsIA.length, 1);
  // la demande à l'IA : notes et familles, aucun chiffre de dose
  const consigne = appelsIA[0].corps.messages[0].content;
  assert.match(consigne, /Bergamote/);
  assert.ok(!/\d/.test(consigne), consigne);
  assert.ok(ctl.propre(appelsIA[0].corps.system));
});

test("demande à l'IA : modèle Haiku 5.5, effort low, réflexion coupée, 300 jetons, aucune « température » (refusée par ce modèle)", async () => {
  const { app, appelsIA } = await monter({ env: { ANTHROPIC_API_KEY: "sk-ant-test" }, ia: () => message(EXPLICATION) });
  await appel(app, "/api/ia/expliquer", { corps: { code: await code(app) } });
  const { corps, init } = appelsIA[0];
  assert.equal(corps.model, "claude-haiku-5-5");
  assert.equal(corps.max_tokens, 300);
  assert.deepEqual(corps.output_config, { effort: "low" });
  assert.deepEqual(corps.thinking, { type: "disabled" });
  assert.ok(!("temperature" in corps) && !("top_p" in corps) && !("fallbacks" in corps));
  assert.equal(init.headers["x-api-key"], "sk-ant-test");
  assert.equal(init.headers["anthropic-version"], "2023-06-01");
  // autre modèle réglable, avec repli automatique quand il l'accepte
  const s = await monter({ env: { ANTHROPIC_API_KEY: "k", MODELE_IA: "claude-sonnet-5-5" }, ia: () => message(EXPLICATION) });
  await appel(s.app, "/api/ia/expliquer", { corps: { code: await code(s.app) } });
  assert.equal(s.appelsIA[0].corps.fallbacks, "default");
  assert.equal(s.appelsIA[0].init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.ok(!("thinking" in s.appelsIA[0].corps));
});

test("expliquer : texte refusé (marque, tournure, chiffre, allégation, trop court) = texte préécrit", async () => {
  const mauvais = [
    EXPLICATION + " Un vrai dupe de Libre.",
    EXPLICATION.replace("Ce parfum", "Comme Sauvage, ce parfum"),
    EXPLICATION.replace("bergamote", "bergamote à 25"),
    EXPLICATION + " Un parfum apaisant pour tes soirées.",
    EXPLICATION.replace("frais du matin au soir", "séduisant et sûr de toi, prêt à séduire"),
    "Trop court.",
    EXPLICATION.replace("Ce parfum", "Signé Tom Ford, ce parfum"),
  ];
  for (const t of mauvais) {
    const { app } = await monter({ env: { ANTHROPIC_API_KEY: "k" }, ia: () => message(t) });
    const r = await (await appel(app, "/api/ia/expliquer", { corps: { code: await code(app) } })).json();
    assert.deepEqual(r, { texte: null, source: "aucune" }, t);
  }
});

test("expliquer : refus du modèle, texte coupé, erreur de l'API ou panne réseau = texte préécrit", async () => {
  const reponses = [
    () => message("", { stop_reason: "refusal", content: [] }),
    () => message(EXPLICATION.slice(0, 200), { stop_reason: "max_tokens" }),
    () => new Response("{}", { status: 529 }),
    () => { throw new Error("réseau"); },
  ];
  for (const ia of reponses) {
    const { app } = await monter({ env: { ANTHROPIC_API_KEY: "k" }, ia });
    assert.equal((await (await appel(app, "/api/ia/expliquer", { corps: { code: await code(app) } })).json()).source, "aucune");
  }
});

test("garde-fous : ia_active = false ou pas de clé = aucun appel ; limite par personne (429) ; plafond du jour", async () => {
  const coupee = donneesEnVente();
  coupee.features.ia_active = false;
  const a = await monter({ d: coupee, env: { ANTHROPIC_API_KEY: "k" }, ia: () => message(EXPLICATION) });
  assert.equal((await (await appel(a.app, "/api/ia/expliquer", { corps: { code: await code(a.app) } })).json()).source, "aucune");
  assert.equal((await (await appel(a.app, "/api/ia/comprendre", { corps: { texte: "un parfum frais pour l'été" } })).json()).source, "aucune");
  assert.equal(a.appelsIA.length, 0);

  const b = await monter({ ia: () => message(EXPLICATION) });
  assert.equal((await (await appel(b.app, "/api/ia/expliquer", { corps: { code: await code(b.app) } })).json()).source, "aucune");
  assert.equal(b.appelsIA.length, 0);

  let n = 0;
  const c = await monter({ env: { ANTHROPIC_API_KEY: "k", LIMITE_IA: { limit: async () => ({ success: ++n <= 5 }) } }, ia: () => message(EXPLICATION) });
  for (let i = 0; i < 5; i++) await appel(c.app, "/api/ia/comprendre", { corps: { texte: `envie numéro ${"x".repeat(i + 1)}` } });
  const r = await appel(c.app, "/api/ia/comprendre", { corps: { texte: "encore une envie" } });
  assert.equal(r.status, 429);

  const memoire = fausseMemoire();
  memoire.valeurs.set("ia-jour:2026-11-05", "200");
  const e = await monter({ env: { ANTHROPIC_API_KEY: "k", MEMOIRE: memoire }, ia: () => message(EXPLICATION) });
  assert.equal((await (await appel(e.app, "/api/ia/expliquer", { corps: { code: await code(e.app) } })).json()).raison, "plafond");
  assert.equal(e.appelsIA.length, 0);
});

test("expliquer : code faux ou inconnu = refus clair", async () => {
  const { app } = await monter({ env: { ANTHROPIC_API_KEY: "k" }, ia: () => message(EXPLICATION) });
  assert.equal((await appel(app, "/api/ia/expliquer", { corps: { code: "OLF-12345-6789X" } })).status, 400);
  assert.equal((await appel(app, "/api/ia/expliquer", { corps: { code: "OLF-00000-00000" } })).status, 404);
  assert.equal((await appel(app, "/api/ia/expliquer", { corps: { formule: R01() } })).status, 400, "le navigateur n'envoie que le code");
  assert.equal((await appel(app, "/api/ia/expliquer", { methode: "GET" })).status, 405);
});

test("comprendre : texte → structure, notes souhaitées et évitées, intensité ; schéma imposé, seuls les codes permis passent", async () => {
  const { app, appelsIA } = await monter({ env: { ANTHROPIC_API_KEY: "k" },
    ia: () => message(JSON.stringify({ structure_code: "S6", notes_codes: ["VAN", "CAF", "XXX", "PAT"], notes_evitees: ["PAT", "constructor"], intensite: "forte", pourcentage: 30 })) });
  const r = await appel(app, "/api/ia/comprendre", { corps: { texte: "Un parfum gourmand de café et de vanille, pas trop terreux, qui se remarque." } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { resultat: { structure_code: "S6", notes_codes: ["VAN", "CAF"], notes_evitees: ["PAT"], intensite: "forte" }, source: "ia" });
  const corps = appelsIA[0].corps;
  assert.equal(corps.output_config.format.type, "json_schema");
  assert.deepEqual(corps.output_config.format.schema.required, ["structure_code", "notes_codes", "notes_evitees", "intensite"]);
  assert.equal(corps.output_config.format.schema.additionalProperties, false);
  assert.ok(!JSON.stringify(corps.output_config.format.schema).includes("pourcentage"));
  assert.ok(ctl.propre(corps.system), "pas de nom de marque dans la consigne");
  assert.match(corps.messages[0].content, /pas trop terreux/);
});

test("comprendre : nom de parfum ou de marque refusé tant que l'interrupteur « inspiration » est coupé (aux deux niveaux)", async () => {
  const textes = ["Je veux un parfum comme Sauvage", "quelque chose qui sent Baccarat Rouge 540", "un Dior en plus frais"];
  const { app, appelsIA } = await monter({ env: { ANTHROPIC_API_KEY: "k" }, ia: () => message("{}") });
  for (const texte of textes) {
    const r = await appel(app, "/api/ia/comprendre", { corps: { texte } });
    assert.equal(r.status, 400, texte);
    assert.match((await r.json()).erreur, /sans nom de parfum/);
  }
  assert.equal(appelsIA.length, 0);
  // site seul allumé : toujours refusé ; site et programme allumés : accepté
  const d = donneesEnVente();
  d.features.inspiration_nommee = true;
  const seul = await monter({ d, env: { ANTHROPIC_API_KEY: "k" }, ia: () => message("{}") });
  assert.equal((await appel(seul.app, "/api/ia/comprendre", { corps: { texte: textes[0] } })).status, 400);
  const d2 = donneesEnVente();
  d2.features.inspiration_nommee = true;
  const deux = await monter({ d: d2, env: { ANTHROPIC_API_KEY: "k", INSPIRATION_NOMMEE: "true" },
    ia: () => message(JSON.stringify({ structure_code: "S7", notes_codes: ["LAV", "BER"], notes_evitees: [], intensite: "moyenne" })) });
  const ok = await (await appel(deux.app, "/api/ia/comprendre", { corps: { texte: textes[0] } })).json();
  assert.equal(ok.resultat.structure_code, "S7");
});

test("comprendre : demande mal formée, trop longue, réponse illisible ou vide = refus ou texte préécrit", async () => {
  const { app } = await monter({ env: { ANTHROPIC_API_KEY: "k" }, ia: () => message("pas du JSON") });
  assert.equal((await appel(app, "/api/ia/comprendre", { corps: { texte: "x".repeat(401) } })).status, 400);
  assert.equal((await appel(app, "/api/ia/comprendre", { corps: { texte: "ok ok", autre: 1 } })).status, 400);
  assert.equal((await appel(app, "/api/ia/comprendre", { corps: { texte: 12 } })).status, 400);
  assert.equal((await (await appel(app, "/api/ia/comprendre", { corps: { texte: "un parfum frais" } })).json()).source, "aucune");
  const vide = await monter({ env: { ANTHROPIC_API_KEY: "k" }, ia: () => message(JSON.stringify({ structure_code: "S99", notes_codes: [], notes_evitees: [], intensite: "max" })) });
  assert.equal((await (await appel(vide.app, "/api/ia/comprendre", { corps: { texte: "un parfum frais" } })).json()).source, "aucune");
});

test("journal des appels à l'IA : rôle, modèle, statut, durée, jetons ; ni texte ni adresse IP", async () => {
  const lignes = [];
  const log = console.log;
  console.log = (...a) => lignes.push(a.join(" "));
  try {
    const { app } = await monter({ env: { ANTHROPIC_API_KEY: "k" }, ia: () => message(EXPLICATION) });
    await appel(app, "/api/ia/expliquer", { corps: { code: await code(app) }, ip: "9.8.7.6" });
  } finally { console.log = log; }
  const j = lignes.map(l => { try { return JSON.parse(l); } catch { return null; } }).find(x => x && x.ia);
  assert.deepEqual(Object.keys(j).sort(), ["ia", "jetons", "modele", "ms", "statut"]);
  assert.ok(!lignes.some(l => l.includes("9.8.7.6") || l.includes("bergamote")));
});
