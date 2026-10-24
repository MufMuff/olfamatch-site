/*
 * Page privée de l'atelier (servie par le programme Cloudflare, derrière Cloudflare Access).
 * Tout est calculé par le programme : la page affiche et envoie les masses pesées.
 */
export function pageFabrication() {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Atelier | Olfamatch</title>
<style>
:root{--bg:#160A13;--bg2:#1E0F1A;--carte:#24131f;--ligne:rgba(242,228,216,.14);--or:#C8A15A;--ivoire:#F2E4D8;--doux:#A8919B;--rouge:#E0786B;--vert:#9BD08F}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ivoire);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}h1,h2,h3{font-family:Georgia,serif;font-weight:400}h1{font-size:28px;margin:8px 0 4px}h2{font-size:22px;margin:28px 0 10px}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 18px}nav button,.btn{background:var(--or);color:#1A0C16;border:0;border-radius:10px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer;min-height:44px}
nav button.off{background:transparent;color:var(--ivoire);border:1px solid var(--ligne)}.btn[disabled]{opacity:.4;cursor:not-allowed}.btn.sec{background:transparent;color:var(--or);border:1px solid var(--or)}
.carte{background:var(--carte);border:1px solid var(--ligne);border-radius:14px;padding:14px 16px;margin:10px 0}.doux{color:var(--doux)}.alerte{color:var(--rouge);font-weight:600}.ok{color:var(--vert)}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--ligne);vertical-align:top}th{color:var(--doux);font-weight:500}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}input,select,textarea{font:inherit;color:var(--ivoire);background:var(--bg2);border:1px solid var(--ligne);border-radius:8px;padding:8px}
input.masse{width:96px;text-align:right}tr.hors td{background:rgba(224,120,107,.18)}tr.hors td.num{color:var(--rouge);font-weight:700}tr.bon td.num:last-child{color:var(--vert)}
.rappel{padding:8px 12px;border-left:3px solid var(--or);margin:6px 0;background:var(--bg2)}.rappel.alerte{border-color:var(--rouge)}
.grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.grille label{display:flex;flex-direction:column;gap:4px;color:var(--doux);font-size:14px}
.etiquette{background:#fff;color:#111;border-radius:6px;padding:14px;max-width:360px;font:12px/1.4 Arial,sans-serif}.etiquette b{font-size:15px}
@media print{body{background:#fff}main>*:not(#zone-etiquette){display:none!important}#zone-etiquette{display:block!important}.etiquette{border:1px solid #000}button{display:none}}
</style></head><body><main>
<h1>Atelier Olfamatch</h1><p class="doux">Page privée : fabrication, étiquettes, stocks et essais des recettes.</p>
<nav><button data-vue="tableau">Commandes</button><button data-vue="stocks" class="off">Stocks</button><button data-vue="essais" class="off">Essais des recettes</button></nav>
<div id="vue"></div><div id="zone-etiquette" style="display:none"></div>
</main><script>
const vue = document.getElementById("vue");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const g = v => v == null ? "" : Number(v).toFixed(3).replace(".", ",");
const date = s => s ? new Date(s).toLocaleDateString("fr-FR") : "";
const api = async (chemin, corps) => {
  const r = await fetch("/api/fabrication/" + chemin, corps ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) } : {});
  return { ok: r.ok, statut: r.status, d: await r.json().catch(() => ({})) };
};
const STATUT = { payee: "à peser", en_maceration: "en macération", prete: "prête", expediee: "expédiée", bloquee: "BLOQUÉE – à vérifier" };

document.querySelector("nav").addEventListener("click", e => {
  const b = e.target.closest("[data-vue]"); if (!b) return;
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("off", x !== b));
  ({ tableau, stocks, essais })[b.dataset.vue]();
});

async function tableau() {
  const { d } = await api("tableau");
  vue.innerHTML = \`\${d.vente && !d.vente.ok ? '<div class="carte"><b>Vente fermée.</b><ul>' + d.vente.raisons.map(r => "<li>" + esc(r) + "</li>").join("") + "</ul></div>" : ""}
<h2>Rappels</h2>\${(d.rappels || []).map(r => '<div class="rappel ' + (r.niveau === "alerte" ? "alerte" : "") + '">' + esc(r.texte) + "</div>").join("") || '<p class="doux">Rien à faire pour l\\'instant.</p>'}
<h2>Commandes</h2><table><tr><th>Lot</th><th>Code</th><th>Format</th><th>Statut</th><th>Client</th><th></th></tr>
\${(d.commandes || []).map(c => "<tr><td>" + esc(c.numero_lot || "—") + "</td><td>" + esc(c.code) + "</td><td>" + esc(c.format) + (c.quantite > 1 ? " × " + c.quantite : "") + "</td><td" + (c.statut === "bloquee" ? ' class="alerte"' : "") + ">" + esc(STATUT[c.statut] || c.statut) + (c.statut === "en_maceration" ? " jusqu'au " + date(c.maceration_fin) : "") + "</td><td>" + esc(c.nom_client || "") + "</td><td>" + (["payee", "en_maceration", "prete", "expediee"].includes(c.statut) ? '<button class="btn sec" data-fiche="' + esc(c.session_id) + '">Fiche</button>' : "") + "</td></tr>").join("")}</table>\`;
}

vue.addEventListener("click", async e => {
  const f = e.target.closest("[data-fiche]"); if (f) return fiche(f.dataset.fiche);
  if (e.target.id === "valider") return validerPesee();
  if (e.target.id === "imprimer") { document.getElementById("zone-etiquette").innerHTML = document.getElementById("etiquette").outerHTML; return print(); }
  if (e.target.dataset.etape) {
    const r = await api("etape", { id: courante.commande.id, action: e.target.dataset.etape, suivi: document.getElementById("suivi")?.value });
    alert(r.ok ? "C'est noté." + (r.d.email ? " E-mail au client : " + r.d.email + "." : "") : r.d.erreur); if (r.ok) fiche(courante.commande.id);
  }
  if (e.target.id === "essai-fiche") return ficheEssai();
  if (e.target.id === "stock-ok") {
    const r = await api("stocks", { code_note: document.getElementById("stock-note").value, grammes: Number(document.getElementById("stock-g").value.replace(",", ".")) });
    if (!r.ok) alert(r.d.erreur); stocks();
  }
});

let courante = null;
async function fiche(id) {
  const r = await api("commande?id=" + encodeURIComponent(id));
  if (!r.ok) { vue.innerHTML = '<p class="alerte">' + esc(r.d.erreur) + "</p>"; return; }
  courante = r.d; const c = r.d.commande, et = r.d.etiquette;
  const prep = r.d.preparations.map(p => "<h3>" + esc(p.nom) + "</h3><table><tr><th>#</th><th>Ingrédient</th><th>Lot</th><th class=num>Cible (g)</th><th class=num>Tolérance</th><th class=num>Pesé (g)</th><th class=num>Écart</th></tr>" +
    p.fiche.lignes.map((l, i) => '<tr data-ligne="' + esc(l.id) + '"><td>' + (i + 1) + "</td><td>" + esc(l.nom) + (l.dilution_stock < 100 ? ' <span class="doux">(stock à ' + l.dilution_stock + " %)</span>" : "") + "</td><td>" + esc(l.lot || "") + '</td><td class=num>' + g(l.a_peser_g) + "</td><td class=num>± " + g(l.tolerance_g) + '</td><td class=num><input class="masse" inputmode="decimal" data-id="' + esc(l.id) + '" data-cible="' + l.a_peser_g + '" data-tol="' + l.tolerance_g + '" value="' + (r.d.pesee ? g(r.d.pesee.masses[l.id]) : "") + '"' + (c.statut !== "payee" ? " disabled" : "") + '></td><td class="num ecart"></td></tr>').join("") + "</table>").join("");
  vue.innerHTML = \`<button class="btn sec" onclick="tableau()">← Commandes</button>
<h2>Commande \${esc(c.numero_lot || "")} · \${esc(c.code)}</h2>
<div class="carte"><b>\${esc(c.nom_format)}\${c.quantite > 1 ? " × " + c.quantite : ""}</b> · statut : \${esc(STATUT[c.statut] || c.statut)}<br>
Client : \${esc(c.client.nom || "")} · \${esc(c.client.email || "")}<br>Adresse : \${esc(c.client.adresse || "")}<br>
\${c.code_kit_a_glisser ? "Code de réduction à glisser dans le colis : <b>" + esc(c.code_kit_a_glisser.code) + "</b> (10 €, jusqu'au " + date(c.code_kit_a_glisser.expire_le) + ")<br>" : ""}
\${c.maceration_debut ? "Macération : du " + date(c.maceration_debut) + " au " + date(c.maceration_fin) + " (à l'abri de la lumière), puis froid et filtration.<br>" : ""}
\${r.d.securite.conforme ? '<span class="ok">Formule conforme ✓</span>' : '<span class="alerte">NE PAS FABRIQUER : ' + esc(r.d.securite.erreurs.join(" ; ")) + "</span>"}</div>
<p>\${esc(r.d.ordre)}</p>\${prep}
\${c.statut === "payee" ? '<p><button class="btn" id="valider" disabled>Valider la pesée</button> <span id="etat-pesee" class="doux"></span></p>' : ""}
\${c.statut === "en_maceration" ? '<p><button class="btn" data-etape="prete">Froid et filtration faits : marquer « prête »</button></p>' : ""}
\${c.statut === "prete" ? '<p><input id="suivi" placeholder="Numéro de suivi"> <button class="btn" data-etape="expediee">Marquer « expédiée » et prévenir le client</button></p>' : ""}
<h2>Étiquette</h2>\${et.pret ? "" : '<p class="alerte">Impression bloquée : ' + esc(et.manque.join(" ; ")) + "</p>"}
<div class="etiquette" id="etiquette"><b>\${esc(et.fonction)}</b> · \${esc(et.contenance)} ℮<br>Lot \${esc(et.numero_lot || "")}<br>
\${et.ingredients_sur_notice ? "Ingrédients : voir la notice." : "Ingrédients : " + esc(et.ingredients)}<br>\${esc(et.precautions)}<br>
\${et.duree_apres_ouverture ? "Après ouverture : " + esc(et.duree_apres_ouverture) + "<br>" : ""}\${esc(et.responsable || "Personne responsable : à compléter")}</div>
\${et.ingredients_sur_notice ? "<p>Notice du kit : " + esc(et.ingredients) + "</p>" : ""}<p class="doux">Colis : marquage « \${esc(et.marquage_colis)} ».</p>
<p><button class="btn sec" id="imprimer"\${et.pret ? "" : " disabled"}>Imprimer l'étiquette (ou l'enregistrer en PDF)</button></p>\`;
  controler();
}

function controler() {
  let tout = true, n = 0;
  document.querySelectorAll("input.masse").forEach(i => {
    const tr = i.closest("tr"), v = Number(i.value.replace(",", ".")), cible = Number(i.dataset.cible), tol = Number(i.dataset.tol);
    const rempli = i.value.trim() !== "" && Number.isFinite(v);
    const bon = rempli && Math.abs(v - cible) <= tol + 1e-9;
    tr.classList.toggle("hors", rempli && !bon); tr.classList.toggle("bon", bon);
    tr.querySelector(".ecart").textContent = rempli ? (v - cible >= 0 ? "+" : "") + g(v - cible) : "";
    if (!bon) tout = false; if (rempli && !bon) n++;
  });
  const b = document.getElementById("valider"); if (b) b.disabled = !tout;
  const s = document.getElementById("etat-pesee"); if (s) s.textContent = n ? n + " ligne(s) hors tolérance : validation bloquée." : tout ? "Tout est dans la tolérance." : "";
}
vue.addEventListener("input", e => { if (e.target.classList.contains("masse")) controler(); });

async function validerPesee() {
  const masses = {};
  document.querySelectorAll("input.masse").forEach(i => { masses[i.dataset.id] = Number(i.value.replace(",", ".")); });
  const r = await api("pesee", { id: courante.commande.id, masses });
  alert(r.ok ? r.d.rappel : r.d.erreur); if (r.ok) fiche(courante.commande.id);
}

async function stocks() {
  const { d } = await api("stocks");
  vue.innerHTML = '<h2>Stocks</h2><table><tr><th>Note</th><th>Lot</th><th class=num>Grammes</th><th>Mis à jour</th></tr>' + (d.stocks || []).map(s => "<tr><td>" + esc(s.code_note) + "</td><td>" + esc(s.lot || "") + "</td><td class=num" + (s.grammes < 20 ? ' style="color:var(--rouge)"' : "") + ">" + g(s.grammes) + "</td><td>" + date(s.maj_le) + "</td></tr>").join("") + "</table>" +
    '<div class="carte"><b>Mettre à jour un stock</b> (grammes du flacon de stock, prédilution comprise)<div class="grille"><label>Code de la note<input id="stock-note" placeholder="BER"></label><label>Grammes<input id="stock-g" inputmode="decimal"></label></div><p><button class="btn" id="stock-ok">Enregistrer</button></p></div>';
}

async function essais() {
  const { d } = await api("essais");
  vue.innerHTML = '<h2>Essais des recettes</h2><div class="carte"><ul>' + d.protocole.map(p => "<li>" + esc(p) + "</li>").join("") + "</ul></div>" +
    '<h3>Fiche d\\'un mini-lot d\\'essai</h3><p><select id="essai-recette">' + d.recettes.map(r => '<option value="' + r.code + '">' + r.code + " · " + esc(r.nom) + "</option>").join("") + '</select> <button class="btn sec" id="essai-fiche">Calculer</button></p><div id="essai-res"></div>' +
    '<h3>Noter un essai</h3><form id="essai-form" class="carte"><div class="grille"><label>Recette<select name="recette">' + d.recettes.map(r => '<option value="' + r.code + '">' + r.code + " · " + esc(r.nom) + "</option>").join("") + '</select></label><label>Date<input type="date" name="date"></label>' +
    ["tete", "coeur", "fond", "sillage"].map(k => '<label>' + ({ tete: "Tête", coeur: "Cœur", fond: "Fond", sillage: "Sillage" })[k] + " (sur 5)<input name=" + k + ' inputmode="decimal" required></label>').join("") +
    '<label>Tenue (heures)<input name="tenue_h" inputmode="decimal"></label><label>Stabilité<select name="stabilite"><option value="">pas encore faite</option><option value="oui">aucun défaut</option><option value="non">défaut</option></select></label></div><label class="doux">Remarques<textarea name="remarques" rows="2" style="width:100%"></textarea></label><p><button class="btn">Enregistrer l\\'essai</button></p></form>' +
    '<h3>Statut des recettes</h3><table><tr><th>Recette</th><th>Dans recettes.json</th><th>D\\'après les essais</th></tr>' + d.recettes.map(r => "<tr><td>" + r.code + " · " + esc(r.nom) + "</td><td>" + esc(r.statut_fichier) + "</td><td" + (r.statut_essais === "validee" ? ' class="ok"' : "") + ">" + esc(r.statut_essais || "—") + "</td></tr>").join("") + "</table>";
  document.getElementById("essai-form").addEventListener("submit", async ev => {
    ev.preventDefault(); const f = new FormData(ev.target), n = k => Number(String(f.get(k) || "").replace(",", "."));
    const r = await api("essais", { recette: f.get("recette"), date: f.get("date"), tete: n("tete"), coeur: n("coeur"), fond: n("fond"), sillage: n("sillage"), tenue_h: n("tenue_h"),
      stabilite_ok: f.get("stabilite") === "oui" ? true : f.get("stabilite") === "non" ? false : null, remarques: f.get("remarques") });
    alert(r.ok ? "Moyenne " + r.d.moyenne + " sur 5 : " + (r.d.statut === "validee" ? "recette validée. " + r.d.rappel : "à valider.") : r.d.erreur); if (r.ok) essais();
  });
}

async function ficheEssai() {
  const r = await api("essai?recette=" + document.getElementById("essai-recette").value);
  document.getElementById("essai-res").innerHTML = r.ok ? "<p>" + esc(r.d.nom) + " : " + r.d.masse_totale_g + " g à " + r.d.concentration + " %" + (r.d.conforme ? "" : ' <span class="alerte">(non conforme)</span>') + "</p><table><tr><th>Ingrédient</th><th>Lot</th><th class=num>À peser (g)</th></tr>" + r.d.lignes.map(l => "<tr><td>" + esc(l.nom) + "</td><td>" + esc(l.lot || "") + "</td><td class=num>" + g(l.a_peser_g) + "</td></tr>").join("") + "</table>" : '<p class="alerte">' + esc(r.d.erreur) + "</p>";
}

const id = new URLSearchParams(location.search).get("commande");
id ? fiche(id) : tableau();
</script></body></html>`;
}
