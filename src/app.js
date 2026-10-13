(function () {
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Recherche avec suggestions */
  const box = document.querySelector(".search[data-root]");
  if (box) {
    const root = box.dataset.root;
    const input = box.querySelector("input");
    const list = box.querySelector(".suggest");
    let idx = null, active = -1, items = [];
    const load = () => idx ? Promise.resolve(idx) :
      fetch(root + "assets/search.json").then(r => r.json()).then(j => (idx = j.map(o => ({...o, h: norm(o.n + " " + o.b + " " + o.a.join(" "))}))));
    const render = q => {
      const nq = norm(q).trim();
      if (!nq) { list.classList.remove("open"); return; }
      const words = nq.split(/\s+/);
      items = idx.filter(o => words.every(w => o.h.includes(w)))
        .sort((a, b) => (norm(a.n).startsWith(nq) ? -1 : 0) - (norm(b.n).startsWith(nq) ? -1 : 0)).slice(0, 7);
      active = -1;
      list.innerHTML = items.length
        ? items.map((o, i) => `<a role="option" href="${root}alternative/${o.s}/" data-i="${i}"><span class="s-name">${o.n}</span><span class="s-brand">${o.b}</span></a>`).join("")
        : `<div class="s-empty">Pas encore dans l'annuaire. Écris-nous le nom en commentaire sur TikTok, on le cherche.</div>`;
      list.classList.add("open");
    };
    input.addEventListener("input", () => load().then(() => render(input.value)));
    input.addEventListener("focus", () => load());
    input.addEventListener("keydown", ev => {
      const links = list.querySelectorAll("a");
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (!links.length) return;
        ev.preventDefault();
        active = (active + (ev.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        links.forEach((a, i) => a.classList.toggle("active", i === active));
      } else if (ev.key === "Enter") {
        const target = links[active >= 0 ? active : 0];
        if (target) { ev.preventDefault(); location.href = target.href; }
      } else if (ev.key === "Escape") list.classList.remove("open");
    });
    document.addEventListener("click", ev => { if (!box.contains(ev.target)) list.classList.remove("open"); });
  }

  /* Vitrine de l'accueil : un seul mouvement, l'échange des paires */
  const show = document.querySelector(".showcase[data-pairs]");
  if (show && !reduced) {
    const pairs = JSON.parse(show.dataset.pairs);
    const slot = show.querySelector(".slot");
    let i = 0;
    setInterval(() => {
      i = (i + 1) % pairs.length;
      slot.classList.add("fade");
      setTimeout(() => {
        const p = pairs[i];
        slot.querySelectorAll("[data-k]").forEach(el => { el.textContent = p[el.dataset.k]; });
        show.href = show.getAttribute("href").replace(/alternative\/[^/]+\//, "alternative/" + p.s + "/");
        slot.classList.remove("fade");
      }, 450);
    }, 3800);
  }

  /* Annuaire : filtre texte + catégories */
  const dir = document.getElementById("dir");
  if (dir) {
    const rows = [...dir.querySelectorAll(".row")];
    const input = document.getElementById("filter");
    const count = document.querySelector(".count");
    const empty = document.querySelector(".empty");
    const state = { l: "", g: "" };
    const params = new URLSearchParams(location.search);
    if (params.get("q")) input.value = params.get("q");
    const apply = () => {
      const words = norm(input.value).trim().split(/\s+/).filter(Boolean);
      let n = 0;
      rows.forEach(r => {
        const ok = (!state.l || r.dataset.l.startsWith(state.l)) && (!state.g || r.dataset.g === state.g) && words.every(w => norm(r.dataset.h).includes(w));
        r.hidden = !ok; if (ok) n++;
      });
      count.textContent = n + (n > 1 ? " parfums" : " parfum");
      empty.hidden = n > 0;
    };
    document.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => {
      const f = c.dataset.f, v = c.dataset.v;
      if (f === "g" && state.g === v) state.g = ""; else state[f] = v;
      document.querySelectorAll(`.chip[data-f="${f}"]`).forEach(x => x.setAttribute("aria-pressed", String(state[f] === x.dataset.v)));
      apply();
    }));
    input.addEventListener("input", apply);
    apply();
  }

  /* Formulaires e-mail (MailerLite) */
  const root = () => (document.querySelector('link[rel=stylesheet][href$="style.css"]').getAttribute("href").replace("style.css", ""));
  document.querySelectorAll("form.form").forEach(form => {
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const email = form.email.value.trim();
      const ok = form.querySelector(".ok");
      const btn = form.querySelector("button");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ok.hidden = false; ok.textContent = "Cette adresse ne semble pas valide. Vérifie-la et réessaie."; return; }
      const cfg = (window.OLFA || {}).form;
      btn.disabled = true; btn.textContent = "Envoi…";
      if (cfg) { const ml = new FormData(); ml.append("fields[email]", email); ml.append("ml-submit", "1"); ml.append("anticsrf", "true"); fetch(cfg, { method: "POST", body: ml, mode: "no-cors" }).catch(() => {}); }
      const data = new URLSearchParams(new FormData(form));
      fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: data.toString() })
        .then(r => { if (!r.ok) throw new Error(r.status); })
        .then(() => { form.email.value = ""; ok.hidden = false; ok.innerHTML = 'C\'est bon ! <a href="' + root() + 'top-30/olfamatch-top-30.pdf" download style="color:inherit;font-weight:600">Télécharge ton Top 30 ici</a>.'; btn.textContent = "Merci"; })
        .catch(() => { ok.hidden = false; ok.textContent = "L'envoi a échoué. Réessaie dans un instant."; btn.disabled = false; btn.textContent = "Recevoir le PDF"; });
    });
  });
})();
