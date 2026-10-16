(function () {
  const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const amb = document.querySelector(".amb");
  const ROOT = document.body.dataset.root || "";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* navigation privée : on fait sans */ } }
  };

  /* Index des parfums (recherche, ma liste, déjà vus) */
  let idxP = null;
  const loadIdx = () => idxP || (idxP = fetch(ROOT + "assets/search.json").then(x => x.json())
    .then(j => j.map(o => ({ ...o, h: norm(o.n + " " + o.b + " " + o.a.join(" ")) }))));
  const big = u => u ? u.replace("&w=96", "&w=320&h=426&fit=cover&a=attention") : "";

  /* En-tête qui se floute au défilement + léger mouvement de l'ouverture */
  const top = document.querySelector(".top");
  const heroMedia = [...document.querySelectorAll(".hero-media img, .hero-media .lv")];
  const onScroll = () => {
    const y = window.scrollY;
    top.classList.toggle("scrolled", y > 30);
    if (heroMedia.length && !reduced && y < 1000) heroMedia.forEach(m => { m.style.transform = `translateY(${y * 0.18}px)`; });
  };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  /* Vidéos en boucle : chargées seulement près de l'écran, en pause hors de l'écran */
  const conn = navigator.connection || {};
  const noVideo = reduced || conn.saveData || /2g/.test(conn.effectiveType || "");
  const vids = [...document.querySelectorAll("video.lv[data-src]")];
  if (!noVideo && vids.length) {
    const start = v => {
      if (!v.src) { v.src = v.dataset.src; v.addEventListener("playing", () => v.classList.add("on"), { once: true }); }
      const p = v.play(); if (p && p.catch) p.catch(() => {});
    };
    const vio = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(en => {
      const v = en.target;
      if (en.isIntersecting) { if (v.dataset.eager && !v.dataset.ready) return; start(v); } else if (v.src) v.pause();
    }), { rootMargin: "250px 0px" }) : null;
    vids.forEach(v => vio ? vio.observe(v) : null);
    // la vidéo d'ouverture attend que la page soit chargée pour ne pas ralentir l'affichage
    const eager = vids.filter(v => v.dataset.eager);
    const go = () => setTimeout(() => eager.forEach(v => { v.dataset.ready = 1; const r = v.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) start(v); }), 500);
    if (document.readyState === "complete") go(); else window.addEventListener("load", go);
  }

  /* Recherche avec suggestions (toutes les boîtes de la page) */
  document.querySelectorAll(".search[data-root]").forEach(box => {
    const input = box.querySelector("input"), list = box.querySelector(".suggest");
    let active = -1;
    const render = (idx, q) => {
      const nq = norm(q).trim();
      if (!nq) { list.classList.remove("open"); return; }
      const words = nq.split(/\s+/);
      const items = idx.filter(o => words.every(w => o.h.includes(w)))
        .sort((a, b) => (norm(a.n).startsWith(nq) ? -1 : 0) - (norm(b.n).startsWith(nq) ? -1 : 0)).slice(0, 7);
      active = -1;
      list.innerHTML = items.length
        ? items.map(o => `<a role="option" href="${ROOT}alternative/${o.s}/"><span class="s-img">${o.i ? `<img src="${esc(o.i)}" alt="" loading="lazy">` : esc(o.n[0])}</span><span class="s-name">${esc(o.n)}<small>→ ${esc(o.x)}${o.v ? " · −" + o.v + " %" : ""}</small></span><span class="s-brand">${esc(o.b)}</span></a>`).join("")
        : `<div class="s-empty">Pas encore dans l'annuaire. Essaie le <a href="${ROOT}quiz/">quiz</a>, ou écris-nous le nom en commentaire sur TikTok : on le cherche.</div>`;
      list.classList.add("open");
    };
    input.addEventListener("input", () => loadIdx().then(idx => render(idx, input.value)));
    input.addEventListener("focus", () => loadIdx());
    input.addEventListener("keydown", ev => {
      const links = list.querySelectorAll("a[role=option]");
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
    if (ev.key === "/" && ov.hidden && !/input|textarea|select/i.test(document.activeElement.tagName)) { ev.preventDefault(); openOv(); }
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
        if (document.hidden) return;
        i = (i + 1) % deals.length;
        deal.classList.add("fade");
        setTimeout(() => { show(deals[i]); deal.classList.remove("fade"); }, 380);
      }, 5200);
    }
  }

  /* Apparitions au défilement (+ compteurs) */
  const countNum = (el, to, ms) => {
    if (reduced) { el.textContent = to.toLocaleString("fr-FR"); return; }
    const t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / ms); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString("fr-FR"); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const fire = el => {
    el.classList.add("in");
    el.querySelectorAll("[data-from]").forEach(x => { if (!x.dataset.done) { x.dataset.done = 1; countTo(x, +x.dataset.from, +x.dataset.to, 1600); } });
    el.querySelectorAll("[data-count]").forEach(x => { if (!x.dataset.done) { x.dataset.done = 1; countNum(x, +x.dataset.count, 1400); } });
  };
  const io = "IntersectionObserver" in window && !reduced
    ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { fire(en.target); io.unobserve(en.target); } }), { threshold: .15 })
    : null;
  const watch = el => io ? io.observe(el) : fire(el);
  document.querySelectorAll(".reveal").forEach(watch);

  /* Grands titres : chaque mot est glissé dans un cache, les lignes montent l'une après l'autre */
  const splitTitle = el => {
    const walk = node => [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) return;
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(p => {
          if (!p) return;
          if (!p.trim()) { frag.appendChild(document.createTextNode(p)); return; }
          const w = document.createElement("span"), i = document.createElement("span");
          w.className = "sw"; i.className = "si"; i.textContent = p; w.appendChild(i); frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== "BR") walk(n);
    });
    walk(el);
    const ws = [...el.querySelectorAll(".sw")];
    const top = w => Math.round(w.getBoundingClientRect().top);
    const lines = [...new Set(ws.map(top))].sort((a, b) => a - b);
    ws.forEach(w => w.style.setProperty("--l", lines.indexOf(top(w))));
    el.classList.add("split-ready");
  };
  document.querySelectorAll("[data-split]").forEach(el => { if (!reduced) splitTitle(el); else el.classList.add("split-ready"); watch(el); });

  /* Passage d'une page à l'autre : le flacon cliqué « vole » jusqu'à la fiche (navigateurs récents) */
  const clearVT = () => document.querySelectorAll("[data-vt]").forEach(x => { x.style.viewTransitionName = ""; delete x.dataset.vt; });
  document.addEventListener("click", ev => {
    const a = ev.target.closest && ev.target.closest('a[href*="alternative/"]');
    if (!a || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.shiftKey || a.target === "_blank") return;
    const pic = a.querySelector("img");
    if (!pic) return;
    clearVT();
    const here = document.querySelector(".vs-o img");
    if (here && here !== pic) { here.style.viewTransitionName = "none"; here.dataset.vt = 1; }
    pic.style.viewTransitionName = "bottle"; pic.dataset.vt = 1;
  });
  window.addEventListener("pageshow", clearVT);

  /* Carrousel des paires : la lumière du site prend la couleur du flacon affiché */
  const slider = document.querySelector(".slider");
  if (slider) {
    const slides = [...slider.querySelectorAll(".slide")];
    const prev = document.querySelector(".arrows .prev"), next = document.querySelector(".arrows .next");
    let cur = -1;
    const activate = i => {
      if (i === cur) return; cur = i;
      amb.style.setProperty("--glow", slides[i].dataset.c);
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
    const heroAmb = amb.style.getPropertyValue("--glow");
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(es => es.forEach(en => {
        if (en.isIntersecting) { cur = -1; activate(nearest()); }
        else amb.style.setProperty("--glow", heroAmb);
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

  /* Ma liste (cœurs) : enregistrée dans le navigateur */
  const favBadge = document.querySelector(".fav-n"), favLink = document.querySelector(".n-fav");
  const favs = () => store.get("om_fav", []);
  const paintBadge = () => { const n = favs().length; if (favBadge) { favBadge.hidden = !n; favBadge.textContent = n; } };
  paintBadge();
  const toggleFav = slug => {
    let f = favs();
    const on = !f.includes(slug);
    f = on ? [slug, ...f] : f.filter(s => s !== slug);
    store.set("om_fav", f); paintBadge();
    if (on && favLink && !reduced) { favLink.classList.add("bump"); setTimeout(() => favLink.classList.remove("bump"), 350); }
    return on;
  };
  document.querySelectorAll(".fav[data-s]").forEach(b => {
    const s = b.dataset.s, lab = b.querySelector(".sr");
    const paint = on => { b.setAttribute("aria-pressed", String(on)); if (lab) lab.textContent = on ? "Retirer de ma liste" : "Ajouter à ma liste"; };
    paint(favs().includes(s));
    b.addEventListener("click", () => {
      const on = toggleFav(s); paint(on);
      if (on && !reduced) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    });
  });

  /* Petites cartes parfum générées à partir de l'index */
  const pcard = (o, extra = "") => `<a class="pcard" href="${ROOT}alternative/${o.s}/" style="--c:${esc(o.c)}">${extra}<span class="pc-img">${o.i ? `<img src="${esc(big(o.i))}" alt="${esc(o.n)}" loading="lazy">` : `<span class="c-mono" style="--c:${esc(o.c)}">${esc(o.n[0])}</span>`}</span>
<span class="pc-txt"><b>${esc(o.n)}</b><i>${esc(o.b)}</i><span class="pc-alt">→ ${esc(o.x)}${o.v ? ` <em>−${o.v} %</em>` : ""}</span></span></a>`;

  const favList = document.getElementById("fav-list");
  if (favList) {
    const emptyBox = document.querySelector(".fav-empty");
    const draw = () => loadIdx().then(idx => {
      const f = favs(), by = Object.fromEntries(idx.map(o => [o.s, o]));
      const items = f.map(s => by[s]).filter(Boolean);
      favList.className = items.length ? "pcards" : "";
      favList.innerHTML = items.map(o => pcard(o, `<button class="pc-x" type="button" data-x="${esc(o.s)}" aria-label="Retirer ${esc(o.n)} de ma liste">×</button>`)).join("");
      emptyBox.hidden = items.length > 0;
    });
    favList.addEventListener("click", ev => {
      const x = ev.target.closest(".pc-x"); if (!x) return;
      ev.preventDefault(); toggleFav(x.dataset.x); draw();
    });
    draw();
  }

  /* Parfums déjà regardés : retenus sur la fiche, proposés sur l'accueil */
  const favBtn = document.querySelector(".v-cta .fav[data-s]");
  if (favBtn) {
    const s = favBtn.dataset.s;
    store.set("om_seen", [s, ...store.get("om_seen", []).filter(x => x !== s)].slice(0, 12));
  }
  const recent = document.querySelector(".recent");
  if (recent) {
    const seen = store.get("om_seen", []);
    if (seen.length) loadIdx().then(idx => {
      const by = Object.fromEntries(idx.map(o => [o.s, o]));
      const items = seen.map(s => by[s]).filter(Boolean).slice(0, 6);
      if (!items.length) return;
      recent.querySelector(".pcards").innerHTML = items.map(o => pcard(o)).join("");
      recent.hidden = false;
    });
  }

  /* Fiche : anneau de ressemblance, économie qui défile, barre d'achat */
  const ring = document.querySelector(".vs-ring");
  if (ring) setTimeout(() => ring.classList.add("in"), reduced ? 0 : 450);
  const vb = document.querySelector(".v-save b[data-to]");
  if (vb) countTo(vb, 0, +vb.dataset.to, 1700);
  const sbar = document.querySelector(".sbar"), cta = document.querySelector(".v-cta");
  if (sbar && cta && "IntersectionObserver" in window) {
    let past = false, foot = false;
    const paint = () => sbar.classList.toggle("show", past && !foot);
    new IntersectionObserver(([en]) => { past = !en.isIntersecting && en.boundingClientRect.top < 0; paint(); }).observe(cta);
    const end = document.querySelector("#echantillon") || document.querySelector("footer");
    new IntersectionObserver(([en]) => { foot = en.isIntersecting || en.boundingClientRect.top < 0; paint(); }).observe(end);
    sbar.hidden = false;
  }

  /* Formulaires : PDF du Top 30 ou « préviens-moi » pour les échantillons */
  document.querySelectorAll("form.form").forEach(form => {
    const kind = form.dataset.kind || "pdf";
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const email = form.email.value.trim();
      const ok = form.querySelector(".ok"), btn = form.querySelector("button[type=submit]");
      const label = btn.textContent;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ok.hidden = false; ok.textContent = "Cette adresse ne semble pas valide. Vérifie-la et réessaie."; return; }
      const O = window.OLFA || {}, cfg = kind === "pdf" ? O.form : O.form_ech;
      btn.disabled = true; btn.textContent = "Envoi…";
      // Inscription envoyée à MailerLite (liste « Top 30 PDF » ou « Échantillons »). Les robots qui remplissent le champ caché sont ignorés.
      const bot = form.site && form.site.value;
      const ml = new FormData(); ml.append("fields[email]", email); ml.append("ml-submit", "1"); ml.append("anticsrf", "true");
      if (kind !== "pdf" && form.parfum && form.parfum.value) ml.append("fields[parfum]", form.parfum.value);
      (bot || !cfg ? Promise.resolve() : fetch(cfg, { method: "POST", body: ml, mode: "no-cors" }))
        .then(() => {
          form.email.value = ""; ok.hidden = false; form.classList.add("done");
          if (kind === "pdf") { ok.innerHTML = 'C\'est bon ! <a href="' + ROOT + 'top-30/olfamatch-top-30.pdf" download style="color:inherit;font-weight:600">Télécharge ton Top 30 ici</a>.'; btn.textContent = "Merci"; }
          else { ok.textContent = "C'est noté ! Tu recevras un e-mail dès que c'est disponible."; btn.textContent = "C'est noté"; }
        })
        .catch(() => { ok.hidden = false; ok.textContent = "L'envoi a échoué. Réessaie dans un instant."; btn.disabled = false; btn.textContent = label; });
    });
  });

  /* Quiz */
  const quiz = document.querySelector(".quiz");
  if (quiz) {
    const steps = [...quiz.querySelectorAll(".qstep")];
    const res = quiz.querySelector(".qres"), back = quiz.querySelector(".qback"), prog = quiz.querySelector(".qz-prog");
    const st = { g: null, f: [], t: null, p: null };
    let at = 0, data = null;
    const loadQ = () => data ? Promise.resolve(data) : fetch(ROOT + "assets/quiz.json").then(r => r.json()).then(j => (data = j));
    loadQ();
    const show = i => {
      at = i;
      steps.forEach((s, k) => { s.hidden = k !== i; });
      res.hidden = i < steps.length;
      back.hidden = i === 0;
      prog.style.setProperty("--q", Math.round(Math.min(i, steps.length) / steps.length * 100) + "%");
      if (i > 0) quiz.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      if (i === steps.length) results();
    };
    const pre = new URLSearchParams(location.search).get("f");
    steps.forEach((s, k) => {
      const key = s.dataset.step, multi = +(s.dataset.multi || 0);
      const opts = [...s.querySelectorAll(".qopt")], nxt = s.querySelector(".qnext");
      const paint = () => { opts.forEach(o => o.setAttribute("aria-pressed", String(multi ? st.f.includes(o.dataset.v) : st[key] === o.dataset.v))); if (nxt) nxt.disabled = !st.f.length; };
      if (multi && pre && opts.some(o => o.dataset.v === pre)) { st.f = [pre]; paint(); }
      opts.forEach(o => o.addEventListener("click", () => {
        const v = o.dataset.v;
        if (multi) {
          st.f = st.f.includes(v) ? st.f.filter(x => x !== v) : [...st.f, v].slice(-multi);
          paint();
        } else { st[key] = v; paint(); setTimeout(() => show(k + 1), reduced ? 0 : 260); }
      }));
      if (nxt) nxt.addEventListener("click", () => show(k + 1));
    });
    back.addEventListener("click", () => show(Math.max(0, at - 1)));
    quiz.querySelector(".qrestart").addEventListener("click", () => {
      st.g = st.t = st.p = null; st.f = [];
      steps.forEach(s => s.querySelectorAll(".qopt").forEach(o => o.setAttribute("aria-pressed", "false")));
      const n = quiz.querySelector(".qnext"); if (n) n.disabled = true;
      show(0);
    });
    const LAB = { frais: "Frais", floral: "Floral", gourmand: "Gourmand", boise: "Boisé", ambre: "Ambré" };
    const results = () => loadQ().then(all => {
      const okG = o => !st.g || o.g === st.g || o.g === "Mixte";
      const score = o => {
        let s = st.f.reduce((a, k) => a + (o.f[k] || 0), 0) / Math.max(1, st.f.length);
        if (st.t === "jour") s += .25 * ((o.f.frais || 0) + (o.f.floral || 0)) - .1 * (o.f.ambre || 0);
        if (st.t === "soir") s += .25 * ((o.f.ambre || 0) + (o.f.gourmand || 0) + .5 * (o.f.boise || 0)) - .1 * (o.f.frais || 0);
        return s + .25 * (o.m || 0) / 100 + .12 * Math.max(0, 1 - (o.r || 999) / 450) + .04 * (o.i ? 1 : 0);
      };
      let pool = all.filter(okG), relaxed = false;
      if (st.p) {
        const b = pool.filter(o => o.xp <= +st.p);
        if (b.filter(o => score(o) > .5).length >= 3) pool = b; else relaxed = true;
      }
      const seen = new Set(), out = [];
      pool.map(o => [score(o), o]).sort((a, b) => b[0] - a[0]).forEach(([, o]) => {
        if (out.length < 6 && !seen.has(o.x)) { seen.add(o.x); out.push(o); }
      });
      const bits = [st.g === "Femme" ? "Pour elle" : st.g === "Homme" ? "Pour lui" : null, st.f.map(k => LAB[k]).join(" + "),
        st.t === "jour" ? "la journée" : st.t === "soir" ? "le soir" : null, st.p ? "moins de " + st.p + " € les 100 ml" : null].filter(Boolean);
      quiz.querySelector(".qres-sub").textContent = bits.join(" · ") + (relaxed ? ". Peu d'alternatives à ce prix pour ce style : on t'a aussi mis les plus proches au-dessus de ton budget." : ".");
      quiz.querySelector(".qcards").innerHTML = out.map((o, i) => {
        const im = (u, n) => u ? `<img src="${esc(u)}" alt="${esc(n)}" loading="lazy">` : `<span class="c-mono" style="--c:${esc(o.c)}">${esc(n[0])}</span>`;
        return `<a class="qcard" href="${ROOT}alternative/${o.s}/" style="--c:${esc(o.c)};--i:${i}"><span class="qc-imgs">${im(o.i, o.n)}${im(o.xi, o.x)}<span class="match"><b>${o.m}<small> %</small></b><em>ressemblance</em></span></span>
<span class="qc-txt"><span class="o">L'alternative à <b>${esc(o.n)}</b> (${esc(o.b)})</span><span class="a">${esc(o.x)}</span><span class="ab">${esc(o.xb)}</span>
<span class="p">${o.op ? `<s>${o.op} €</s>` : ""}<strong>${o.xp} €</strong>${o.v ? `<em>−${o.v} %</em>` : ""}</span></span></a>`;
      }).join("") || `<p class="sub">Aucun parfum ne correspond. Essaie avec une autre famille.</p>`;
      store.set("om_quiz", { ...st, at: Date.now() });
    });
    show(0);
  }
})();
