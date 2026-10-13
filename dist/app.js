(function () {
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;

  /* En-tête qui se floute au défilement + léger mouvement de la photo d'ouverture */
  const top = document.querySelector(".top");
  const heroImg = document.querySelector(".hero-media img");
  const onScroll = () => {
    const y = window.scrollY;
    top.classList.toggle("scrolled", y > 30);
    if (heroImg && !reduced && y < 1000) heroImg.style.transform = `translateY(${y * 0.18}px)`;
  };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* Recherche avec suggestions (toutes les boîtes de la page) */
  let idx = null;
  const loadIdx = r => idx ? Promise.resolve(idx) :
    fetch(r + "assets/search.json").then(x => x.json()).then(j => (idx = j.map(o => ({ ...o, h: norm(o.n + " " + o.b + " " + o.a.join(" ")) }))));
  document.querySelectorAll(".search[data-root]").forEach(box => {
    const rel = box.dataset.root, input = box.querySelector("input"), list = box.querySelector(".suggest");
    let active = -1;
    const render = q => {
      const nq = norm(q).trim();
      if (!nq) { list.classList.remove("open"); return; }
      const words = nq.split(/\s+/);
      const items = idx.filter(o => words.every(w => o.h.includes(w)))
        .sort((a, b) => (norm(a.n).startsWith(nq) ? -1 : 0) - (norm(b.n).startsWith(nq) ? -1 : 0)).slice(0, 7);
      active = -1;
      list.innerHTML = items.length
        ? items.map(o => `<a role="option" href="${rel}alternative/${o.s}/"><span class="s-img">${o.i ? `<img src="${o.i}" alt="" loading="lazy">` : o.n[0]}</span><span class="s-name">${o.n}</span><span class="s-brand">${o.b}</span></a>`).join("")
        : `<div class="s-empty">Pas encore dans l'annuaire. Écris-nous le nom en commentaire sur TikTok, on le cherche.</div>`;
      list.classList.add("open");
    };
    input.addEventListener("input", () => loadIdx(rel).then(() => render(input.value)));
    input.addEventListener("focus", () => loadIdx(rel));
    input.addEventListener("keydown", ev => {
      const links = list.querySelectorAll("a");
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (!links.length) return;
        ev.preventDefault();
        active = (active + (ev.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        links.forEach((a, i) => a.classList.toggle("active", i === active));
      } else if (ev.key === "Enter") {
        const t = links[active >= 0 ? active : 0];
        if (t) { ev.preventDefault(); location.href = t.href; }
      } else if (ev.key === "Escape") list.classList.remove("open");
    });
    document.addEventListener("click", ev => { if (!box.contains(ev.target)) list.classList.remove("open"); });
  });

  /* Recherche plein écran */
  const ov = document.querySelector(".overlay");
  const openOv = () => { ov.hidden = false; setTimeout(() => ov.querySelector("input").focus(), 30); };
  const closeOv = () => { ov.hidden = true; };
  document.querySelector(".s-open").addEventListener("click", openOv);
  ov.querySelector(".s-close").addEventListener("click", closeOv);
  ov.addEventListener("click", ev => { if (ev.target === ov) closeOv(); });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !ov.hidden) closeOv();
    if (ev.key === "/" && ov.hidden && !/input|textarea/i.test(document.activeElement.tagName)) { ev.preventDefault(); openOv(); }
  });

  /* Compteur de prix */
  const countTo = (el, from, to, ms) => {
    if (reduced) { el.textContent = to + " €"; return; }
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / ms), v = from + (to - from) * (1 - Math.pow(1 - k, 3));
      el.textContent = Math.round(v) + " €";
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* Ligne de prix de l'ouverture */
  const deal = document.querySelector(".deal[data-deals]");
  if (deal) {
    const deals = JSON.parse(deal.dataset.deals);
    const set = (k, v) => { const el = deal.querySelector(`[data-k="${k}"]`); if (el) el.textContent = v; };
    const show = p => {
      set("o", p.o); set("a", p.a); set("op", p.op + " €"); set("sv", "−" + p.sv + " %");
      deal.href = deal.getAttribute("href").replace(/alternative\/[^/]+\//, "alternative/" + p.s + "/");
      countTo(deal.querySelector('[data-k="ap"]'), p.op, p.ap, 1500);
    };
    show(deals[0]);
    if (!reduced) {
      let i = 0;
      setInterval(() => {
        i = (i + 1) % deals.length;
        deal.classList.add("fade");
        setTimeout(() => { show(deals[i]); deal.classList.remove("fade"); }, 380);
      }, 5200);
    }
  }

  /* Apparitions au défilement */
  const fire = el => {
    el.classList.add("in");
    el.querySelectorAll("em[data-from]").forEach(x => { if (!x.dataset.done) { x.dataset.done = 1; countTo(x, +x.dataset.from, +x.dataset.to, 1600); } });
  };
  const io = "IntersectionObserver" in window && !reduced
    ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { fire(en.target); io.unobserve(en.target); } }), { threshold: .15 })
    : null;
  document.querySelectorAll(".reveal").forEach(el => io ? io.observe(el) : fire(el));

  /* Carrousel des paires : la lumière du site prend la couleur du flacon affiché */
  const slider = document.querySelector(".slider");
  if (slider) {
    const slides = [...slider.querySelectorAll(".slide")];
    const prev = document.querySelector(".arrows .prev"), next = document.querySelector(".arrows .next");
    let cur = -1;
    const activate = i => {
      if (i === cur) return; cur = i;
      root.style.setProperty("--amb", slides[i].dataset.c);
      fire(slides[i]);
      if (prev) { prev.disabled = i === 0; next.disabled = i === slides.length - 1; }
    };
    const nearest = () => {
      const x = slider.getBoundingClientRect().left + parseFloat(getComputedStyle(slider).scrollPaddingLeft || 0);
      let bi = 0, bd = 1e9;
      slides.forEach((s, i) => { const d = Math.abs(s.getBoundingClientRect().left - x); if (d < bd) { bd = d; bi = i; } });
      return bi;
    };
    let t;
    slider.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(() => activate(nearest()), 80); }, { passive: true });
    const go = d => slides[Math.max(0, Math.min(slides.length - 1, nearest() + d))].scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest", inline: "start" });
    prev && prev.addEventListener("click", () => go(-1));
    next && next.addEventListener("click", () => go(1));
    slider.addEventListener("keydown", ev => { if (ev.key === "ArrowRight") { ev.preventDefault(); go(1); } if (ev.key === "ArrowLeft") { ev.preventDefault(); go(-1); } });
    // la couleur change quand on arrive sur le carrousel, et revient en le quittant
    const heroAmb = getComputedStyle(root).getPropertyValue("--amb");
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(es => es.forEach(en => {
        if (en.isIntersecting) { cur = -1; activate(nearest()); }
        else root.style.setProperty("--amb", heroAmb);
      }), { threshold: .45 }).observe(slider);
    } else activate(0);
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
    const lv = params.get("l");
    if (lv) { state.l = lv; document.querySelectorAll('.chip[data-f="l"]').forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === lv))); }
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

  /* Formulaires e-mail */
  const base = () => document.querySelector('link[rel=stylesheet][href$="style.css"]').getAttribute("href").replace("style.css", "");
  document.querySelectorAll("form.form").forEach(form => {
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const email = form.email.value.trim();
      const ok = form.querySelector(".ok"), btn = form.querySelector("button");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ok.hidden = false; ok.textContent = "Cette adresse ne semble pas valide. Vérifie-la et réessaie."; return; }
      const cfg = (window.OLFA || {}).form;
      btn.disabled = true; btn.textContent = "Envoi…";
      if (cfg) { const ml = new FormData(); ml.append("fields[email]", email); ml.append("ml-submit", "1"); ml.append("anticsrf", "true"); fetch(cfg, { method: "POST", body: ml, mode: "no-cors" }).catch(() => {}); }
      const data = new URLSearchParams(new FormData(form));
      fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: data.toString() })
        .then(r => { if (!r.ok) throw new Error(r.status); })
        .then(() => { form.email.value = ""; ok.hidden = false; ok.innerHTML = 'C\'est bon ! <a href="' + base() + 'top-30/olfamatch-top-30.pdf" download style="color:inherit;font-weight:600">Télécharge ton Top 30 ici</a>.'; btn.textContent = "Merci"; })
        .catch(() => { ok.hidden = false; ok.textContent = "L'envoi a échoué. Réessaie dans un instant."; btn.disabled = false; btn.textContent = "Recevoir le PDF"; });
    });
  });
})();
