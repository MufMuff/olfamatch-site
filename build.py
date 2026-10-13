"""Génère le site statique Olfamatch dans dist/ à partir de data/parfums.json.
Usage : python3 build.py   (puis python3 pdf_top30.py pour le PDF et son aperçu)
Images : data/images.json  ("slug" pour l'original, "slug/idAlternative" pour une alternative).
Couleurs : data/colors.json (mêmes clés) = couleur d'ambiance de chaque flacon."""
import json, html, shutil, re
from pathlib import Path

ROOT = Path(__file__).parent
DIST = ROOT / "dist"
SITE = "https://olfamatch.netlify.app"
CFG = json.loads((ROOT / "data/config.json").read_text()) if (ROOT / "data/config.json").exists() else {}
data = json.loads((ROOT / "data/parfums.json").read_text())
load = lambda n: json.loads((ROOT / f"data/{n}.json").read_text()) if (ROOT / f"data/{n}.json").exists() else {}
images, colors = load("images"), load("colors")
GOLD = "#C8A15A"
Q = '"'

def clean_note(n):
    if not n: return None
    parts, seen = [], set()
    for x in n.split(" · "):
        k = x.lower().replace("version ", "").replace("existe aussi en ", "").strip()
        if k in seen: continue
        seen.add(k); parts.append(x.strip())
    return ". ".join(parts) + "."
def fr_num(s):
    return re.sub(r"(\d+)\.(\d+) €", lambda m: f"{m.group(1)},{m.group(2).ljust(2,'0')} €", s or "")
for o in data:
    o["priceDetail"] = fr_num(o.get("priceDetail"))
    o["image"] = images.get(o["slug"], o.get("image"))
    o["color"] = colors.get(o["slug"])
    for d in o["dupes"]:
        d["note"] = clean_note(d["note"]); d["priceDetail"] = fr_num(d["priceDetail"])
        k = f'{o["slug"]}/{d["id"]}'
        d["image"] = images.get(k, d.get("image")); d["color"] = colors.get(k)

e = lambda s: html.escape(str(s or ""), quote=True)
euro = lambda x: "" if x is None else f"{round(x)} €"
by = {o["slug"]: o for o in data}

def best(o):
    priced = [d for d in o["dupes"] if d["price100"] and d["link"]]
    return (priced or o["dupes"])[0]

from urllib.parse import quote
def rs(url, w):
    """Version redimensionnée en WebP (proxy d'images de Higgsfield)."""
    return f"https://images.higgs.ai/?default=1&output=webp&url={quote(url, safe='')}&w={w}&q=80"
def img(url, alt, eager=False, ws=(480, 800), sizes="(max-width:720px) 90vw, 40vw", crop=True):
    if not url: return ""
    if crop:  # tout en 3:4, recadré sur le flacon
        return img_c(url, alt, eager, ws, sizes)
    load_attr = 'fetchpriority="high"' if eager else 'loading="lazy"'
    srcset = ", ".join(f"{e(rs(url, w))} {w}w" for w in ws)
    return f'<img src="{e(rs(url, ws[-1]))}" srcset="{srcset}" sizes="{sizes}" alt="{e(alt)}" {load_attr} decoding="async">'

def img_c(url, alt, eager, ws, sizes):
    load_attr = 'fetchpriority="high"' if eager else 'loading="lazy"'
    r = lambda w: rs(url, w) + f"&h={round(w*4/3)}&fit=cover&a=attention"
    srcset = ", ".join(f"{e(r(w))} {w}w" for w in ws)
    return f'<img src="{e(r(ws[-1]))}" srcset="{srcset}" sizes="{sizes}" alt="{e(alt)}" {load_attr} decoding="async">'

def match(pct, big=False):
    """Indice : un chiffre et un fin trait qui se remplit."""
    return f'<span class="match{" big" if big else ""}" style="--p:{(pct or 0)/100:.2f}"><b>{pct}<small> %</small></b><i></i><em>ressemblance</em></span>'

def thumb(url, name, color):
    if url:
        return f'<span class="thumb">{img(url, name, ws=(160,), sizes="72px")}</span>'
    return f'<span class="thumb mono" style="--c:{color or GOLD}">{e(name[:1])}</span>'

SEARCH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'

def search_box(rel, ident="q"):
    return f'''<div class="search" data-root="{rel}"><label class="sr" for="{ident}">Cherche ton parfum</label>{SEARCH_SVG}
<input id="{ident}" type="search" autocomplete="off" placeholder="Ton parfum : Sauvage, Libre, Baccarat…" aria-autocomplete="list">
<div class="suggest" role="listbox"></div></div>'''

def email_form(source):
    return f'''<form class="form" name="top30" method="POST" data-netlify="true" netlify-honeypot="site" data-source="{source}" novalidate>
<input type="hidden" name="form-name" value="top30"><input type="hidden" name="source" value="{source}"><p hidden><label>Ne pas remplir <input name="site"></label></p>
<label class="sr" for="em-{source}">Ton adresse e-mail</label>
<div class="field"><input id="em-{source}" type="email" name="email" required placeholder="ton@email.fr" autocomplete="email"><button class="btn" type="submit">Recevoir le PDF</button></div>
<small>Un seul e-mail avec le PDF, puis de temps en temps une nouvelle alternative. Désinscription en un clic.</small>
<p class="ok" hidden></p></form>'''

def pdf_band(source):
    return f'''<div class="band"><div class="phone reveal" aria-hidden="true"><div class="notch"></div><div class="screen"><img src="/top-30/apercu.png" alt="" loading="lazy"></div></div>
<div class="band-txt"><h2>Le Top 30,<br><span>en PDF, gratuit.</span></h2>
<p class="sub">Les 30 alternatives les plus sûres de l'annuaire : 10 grands classiques, 10 parfums très demandés, 10 parfums de niche. À garder dans ton téléphone pour ta prochaine parfumerie.</p>
{email_form(source)}</div></div>'''

def page(path, title, desc, body, nav="", amb=None, cls=""):
    url = SITE + "/" + path.replace("index.html", "")
    rel = "../" * path.count("/")
    cur = lambda n: ' aria-current="page"' if nav == n else ""
    out = f'''<!doctype html><html lang="fr" style="--amb:{amb or "#5a2140"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="{url}"><meta name="theme-color" content="#160A13"><script>document.documentElement.classList.add("js")</script>
<link rel="icon" href="{rel}favicon.svg" type="image/svg+xml"><link rel="preload" href="{rel}assets/fonts/bodoni.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="{rel}style.css"></head><body class="{cls}">
<div class="amb" aria-hidden="true" style="--glow:{amb or "#5a2140"}"></div>
<header class="top"><div class="wrap top-in"><a class="logo" href="{rel}">olfa<b>match</b></a>
<nav class="nav"><a href="{rel}annuaire/"{cur("annuaire")}>Annuaire</a><a href="{rel}top-30/"{cur("top30")}>Top 30 gratuit</a>
<button class="s-open" type="button" aria-label="Rechercher un parfum">{SEARCH_SVG}</button></nav></div></header>
<div class="overlay" hidden><div class="wrap"><button class="s-close" type="button">Fermer</button><p class="o-title">Quel parfum tu aimes ?</p>{search_box(rel, "q2")}</div></div>
<main>{body}</main>
<footer><div class="wrap"><div class="f-top"><a class="logo" href="{rel}">olfa<b>match</b></a>
<p class="f-links"><a href="{rel}annuaire/">Annuaire</a><a href="{rel}top-30/">Top 30 gratuit</a><a href="{rel}mentions-legales/">Mentions légales</a><a href="https://www.tiktok.com/@olfamatch" rel="noopener">TikTok</a><a href="https://www.instagram.com/olfamatch" rel="noopener">Instagram</a></p></div>
<p>Olfamatch répertorie des parfums plus abordables proches de grands parfums, à partir de sources publiques. Nous ne vendons rien nous-mêmes. Les boutons d'achat sont des liens affiliés : Olfamatch touche une petite commission sur les achats, sans surcoût pour toi. En tant que Partenaire Amazon, Olfamatch réalise un bénéfice sur les achats remplissant les conditions requises.</p>
<p>Les noms de parfums et de marques appartiennent à leurs propriétaires et sont cités uniquement pour identifier les produits comparés. Olfamatch n'est affilié à aucune de ces marques. Photos de flacons : illustrations.</p></div></footer>
<script src="{rel}assets/config.js"></script><script src="{rel}app.js" defer></script></body></html>'''
    f = DIST / path
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(out)

def row(o, rel, i=0):
    d = best(o)
    if o["price100"] and d["price100"]:
        price = f'<span class="pp"><s>{euro(o["price100"])}</s><span>{euro(d["price100"])}</span></span>'
        save = f'<span class="save">−{d["saving"]} %</span>' if d["saving"] else '<span class="save"></span>'
    else:
        price, save = '<span class="pp"></span>', '<span class="save muted">Prix à venir</span>'
    more = f' · +{len(o["dupes"])-1}' if len(o["dupes"]) > 1 else ""
    hay = " ".join([o["name"], o["brand"]] + [x["name"] + " " + x["brand"] for x in o["dupes"]]).lower()
    return f'''<a class="row" style="--c:{o["color"] or d["color"] or GOLD};--i:{i}" href="{rel}alternative/{o["slug"]}/" data-g="{e(o["gender"])}" data-l="{e(o["level"])}" data-h="{e(hay)}">
{thumb(o["image"], o["name"], o["color"])}<span class="orig"><b>{e(o["name"])}</b><i>{e(o["brand"])}</i></span>
<span class="altn"><b>{e(d["name"])}</b><i>{e(d["brand"])}{more}</i></span>{match(d["index"])}{price}{save}</a>'''

def build():
    if DIST.exists(): shutil.rmtree(DIST)
    DIST.mkdir()
    for f in ("style.css", "app.js", "favicon.svg"): shutil.copy(ROOT / "src" / f, DIST / f)
    if (ROOT / "src/assets").exists(): shutil.copytree(ROOT / "src/assets", DIST / "assets")
    (DIST / "assets").mkdir(exist_ok=True)
    (DIST / "assets/config.js").write_text("window.OLFA=" + json.dumps({"form": CFG.get("form")}) + ";")
    idx = [{"n": o["name"], "b": o["brand"], "s": o["slug"], "i": rs(o["image"], 96) if o["image"] else "", "a": [x["name"] + " " + x["brand"] for x in o["dupes"]]} for o in data]
    (DIST / "assets/search.json").write_text(json.dumps(idx, ensure_ascii=False))

    # ---------- accueil ----------
    def pair(slug):
        o = by[slug]; d = best(o)
        return {"o": o["name"], "op": round(o["price100"]), "a": d["name"], "ap": round(d["price100"]), "sv": d["saving"], "s": o["slug"]}
    deals = [pair(s) for s in ["baccarat-rouge-540-maison-francis-kurkdjian", "aventus-creed", "oud-wood-tom-ford", "opera-xerjoff", "sauvage-elixir-dior"]]
    f0 = deals[0]
    mq = sorted([o for o in data if o["price100"] and o["price100"] >= 150 and best(o)["price100"] and best(o)["link"] and best(o)["saving"]], key=lambda o: o["rank"] or 999)[:16]
    mq_html = "".join(f'<a href="alternative/{o["slug"]}/"><b>{e(o["name"])}</b> <s>{euro(o["price100"])}</s> <span>{e(best(o)["name"])} {euro(best(o)["price100"])}</span></a>' for o in mq)
    cnt = {k: sum(1 for o in data if o["level"].startswith(k)) for k in ("Top", "Demandé", "Niche")}

    duo = [o for o in sorted(data, key=lambda o: o["rank"] or 999) if o["image"] and best(o)["image"] and o["price100"] and best(o)["price100"]]
    duo = sorted(duo[:10], key=lambda o: -o["price100"])
    def slide(o, n):
        d = best(o)
        return f'''<article class="slide" data-c="{o["color"] or GOLD}"><a href="alternative/{o["slug"]}/">
<div class="duo"><figure>{img(o["image"], o["name"] + " de " + o["brand"])}<figcaption>L'original</figcaption></figure>
<figure>{img(d["image"], d["name"] + " de " + d["brand"])}<figcaption>L'alternative</figcaption></figure></div>
<div class="s-txt"><span class="s-n">{n:02d} / {len(duo):02d}</span><h3><span>{e(o["name"])}</span><small>{e(o["brand"])}</small>{e(d["name"])}<small>{e(d["brand"])}</small></h3>
<p class="drop"><s>{euro(o["price100"])}</s> <em data-from="{round(o["price100"])}" data-to="{round(d["price100"])}">{euro(d["price100"])}</em><small>les 100 ml</small></p>
{match(d["index"])}</div></a></article>'''

    def uni(slug, title, key, text, q, cls=""):
        o = by[slug]
        pic = images.get("_u_aventus") if slug == "aventus-creed" else o["image"]
        return f'''<a class="uni {cls} reveal" href="annuaire/?l={q}" style="--c:{o["color"] or GOLD}"><span class="u-img">{img(pic, o["name"] + " de " + o["brand"], ws=(600, 1000), sizes="(max-width:720px) 92vw, 50vw", crop=False)}</span>
<span class="u-txt"><span class="u-n">{cnt[key]} parfums</span><b>{title}</b><span class="u-p">{text}</span></span></a>'''

    top = [o for o in data if o["level"].startswith("Top") and best(o)["price100"] and best(o)["link"]][:10]
    deals_json = e(json.dumps(deals, ensure_ascii=False))
    home = f'''<section class="hero">
<div class="hero-media" aria-hidden="true">{img(images["_hero"], "", eager=True, ws=(1000, 1600, 2400), sizes="100vw", crop=False)}<div class="mist"><i></i><i></i></div></div>
<div class="wrap hero-copy"><h1>Le parfum de luxe que tu aimes, <span>pour une fraction du prix.</span></h1>
<p class="lead">{len(data)} grands parfums, leur alternative la plus proche et ce que tu économises vraiment.</p>
{search_box("")}
<a class="deal" href="alternative/{f0["s"]}/" data-deals="{deals_json}">
<span class="d-l"><span data-k="o">{e(f0["o"])}</span> <s data-k="op">{f0["op"]} €</s></span>
<span class="d-r"><span class="arr">→</span> <span data-k="a">{e(f0["a"])}</span> <strong data-k="ap">{f0["ap"]} €</strong> <em data-k="sv">−{f0["sv"]} %</em></span></a></div>
</section>
<div class="marquee" aria-label="Exemples d'économies"><div class="mq-track">{mq_html}{mq_html.replace('<a ', '<a aria-hidden="true" tabindex="-1" ')}</div></div>
<section class="story"><div class="wrap s-head"><h2 class="h2">Même famille d'odeur.<br><span>Pas le même prix.</span></h2>
<div class="arrows"><button type="button" class="prev" aria-label="Paire précédente">←</button><button type="button" class="next" aria-label="Paire suivante">→</button></div></div>
<div class="slider" tabindex="0" aria-label="Paires original et alternative">{"".join(slide(o, i+1) for i, o in enumerate(duo))}</div></section>
<section class="wrap sec"><h2 class="h2">Trois façons<br><span>de chercher.</span></h2>
<div class="unis">{uni("aventus-creed", "Les grands classiques", "Top", "Les stars des parfumeries, celles que tout le monde reconnaît.", "Top", "u-big")}{uni("oud-wood-tom-ford", "Les très demandés", "Demandé", "Ceux dont on parle partout, souvent bien plus chers.", "Demandé")}{uni("opera-xerjoff", "La niche", "Niche", "Les maisons confidentielles, là où l'économie est la plus forte.", "Niche")}</div></section>
<section class="wrap sec"><div class="sec-row"><h2 class="h2">Les plus<br><span>recherchés.</span></h2><a class="link" href="annuaire/">Les {len(data)} parfums →</a></div>
<div class="rows reveal">{"".join(row(o, "", i) for i, o in enumerate(top))}</div></section>
<section class="wrap sec manifesto reveal"><p class="big">On n'a rien senti à ta place.<br><span>On a tout croisé.</span></p>
<div class="m-txt"><p>Chaque paire est confirmée par des comparatifs indépendants : plus ils sont nombreux, plus l'indice monte. On compare ensuite les ingrédients publiés des deux parfums, puis on ramène tous les prix à 100 ml pour que tu compares ce qui est comparable.</p>
<p class="fine">Indice calculé par Olfamatch à partir de sources publiques, pas une mesure en laboratoire. Une alternative reste un autre parfum : proche, pas identique.</p></div></section>
<section class="wrap sec">{pdf_band("home")}</section>'''
    page("index.html", "Olfamatch : l'alternative moins chère à ton parfum de luxe",
         f"Trouve l'alternative la plus proche de {len(data)} parfums de luxe et de niche, avec le prix et l'économie réalisée.", home, amb=colors.get("_hero"), cls="home")

    # ---------- annuaire ----------
    levels = [("Tous", ""), ("Grands classiques", "Top"), ("Très demandés", "Demandé"), ("Niche", "Niche")]
    genders = [("Femme", "Femme"), ("Homme", "Homme"), ("Mixte", "Mixte")]
    chips = "".join(f'<button class="chip" type="button" data-f="l" data-v="{v}" aria-pressed="{"true" if v=="" else "false"}">{t}</button>' for t, v in levels)
    chips += '<span class="sep" aria-hidden="true"></span>' + "".join(f'<button class="chip" type="button" data-f="g" data-v="{v}" aria-pressed="false">{t}</button>' for t, v in genders)
    ann = f'''<section class="wrap sec first"><h1 class="h1">L'annuaire<span>.</span></h1>
<p class="sub">{len(data)} parfums et leur meilleure alternative. Clique sur un parfum pour voir toutes ses alternatives.</p>
<div class="search small"><label class="sr" for="filter">Filtrer</label>{SEARCH_SVG}<input id="filter" type="search" autocomplete="off" placeholder="Filtrer par parfum ou par marque"></div>
<div class="filters" role="group" aria-label="Filtres">{chips}</div><p class="count" aria-live="polite"></p>
<div class="rows" id="dir">{"".join(row(o, "../", i % 12) for i, o in enumerate(data))}</div><p class="empty" hidden>Aucun parfum ne correspond. Essaie juste le nom, sans la marque.</p></section>'''
    page("annuaire/index.html", "Annuaire des alternatives aux parfums de luxe | Olfamatch",
         f"{len(data)} parfums de luxe et de niche avec leur alternative la plus proche, le prix et l'économie.", ann, "annuaire")

    # ---------- fiches ----------
    urls = ["", "annuaire/", "top-30/"]
    lvl = lambda l: "Grand classique" if l.startswith("Top") else ("Très demandé" if l.startswith("Demandé") else "Niche")
    def buy(d, big=False):
        if d["link"]:
            return f'''<div class="buy"><p class="price">{euro(d["price100"]) if d["price100"] else ""}<small>{e(d["priceDetail"] or "")}</small></p>
<a class="btn{" big" if big else ""}" href="{e(d["link"])}" rel="sponsored nofollow noopener" target="_blank">Voir sur {e(d["shop"])}</a><small class="aff">Lien affilié</small></div>'''
        return '<div class="buy"><small class="aff">Lien d\'achat bientôt disponible</small></div>'
    def srcs(d):
        if not d["sourceLinks"]: return ""
        return '<details><summary>Les sources</summary><p>' + "<br>".join(f'<a href="{e(u)}" rel="nofollow noopener" target="_blank">{e(u)}</a>' for u in d["sourceLinks"]) + '</p></details>'
    for o in data:
        rel = "../../"
        b = best(o)
        c = o["color"] or b["color"] or GOLD
        media = f'<div class="f-media">{img(o["image"], o["name"] + " de " + o["brand"], eager=True)}</div>' if o["image"] else f'<div class="f-media type" aria-hidden="true"><span>{e(o["name"])}</span></div>'
        save = f'<p class="f-save">Tu économises <b>{b["saving"]} %</b> à quantité égale.</p>' if b["saving"] else ""
        bmedia = f'<div class="b-media">{img(b["image"], b["name"] + " de " + b["brand"])}</div>' if b["image"] else ""
        note = f'<p class="note">{e(b["note"])}</p>' if b["note"] else ""
        ns = b["sources"] or 0
        others = ""
        for d in o["dupes"]:
            if d is b: continue
            facts = match(d["index"]) + (f'<span class="save">−{d["saving"]} %</span>' if d["saving"] else "")
            dn = f'<p class="note">{e(d["note"])}</p>' if d["note"] else ""
            others += f'''<article class="other reveal" style="--c:{d["color"] or GOLD}">{thumb(d["image"], d["name"], d["color"])}<div class="o-main"><h3>{e(d["name"])}</h3><p class="brand">{e(d["brand"])}</p><div class="facts">{facts}</div>{dn}{srcs(d)}</div>{buy(d)}</article>'''
        others_html = f'<section class="wrap sec tight"><h2 class="h2 small">Les autres pistes</h2>{others}</section>' if others else ""
        oprice = f'<p class="o-price">{euro(o["price100"])}<small>prix de l\'original au 100 ml</small></p>' if o["price100"] else ""
        title = f'Alternative à {o["name"]} de {o["brand"]}' + (f' : {b["name"]} (−{b["saving"]} %)' if b["saving"] else f' : {b["name"]}')
        body = f'''<section class="f-hero"><div class="wrap f-grid">{media}
<div class="f-info"><p class="crumbs"><a href="{rel}annuaire/">Annuaire</a> / {e(o["brand"])}</p>
<h1><small>Alternatives à</small>{e(o["name"])}</h1><p class="meta">{e(o["brand"])} · {e(o["gender"])} · {lvl(o["level"])}</p>{oprice}</div></div></section>
<section class="wrap best reveal{"" if b["image"] else " solo"}" style="--c:{b["color"] or c}">{bmedia}<div class="b-info"><p class="tag">Notre meilleure alternative</p><h2>{e(b["name"])}</h2><p class="brand">{e(b["brand"])}</p>
<div class="facts">{match(b["index"], big=True)}<span class="src">{ns} source{"s" if ns > 1 else ""} indépendante{"s" if ns > 1 else ""}</span></div>
{save}{note}{srcs(b)}{buy(b, True)}</div></section>
{others_html}
<p class="wrap fine">Indice calculé par Olfamatch à partir de sources publiques, pas une mesure en laboratoire. Prix ramenés à 100 ml, relevés en octobre 2026 : ils peuvent avoir changé.</p>
<section class="wrap sec">{pdf_band("fiche")}</section>'''
        page(f'alternative/{o["slug"]}/index.html', title + " | Olfamatch",
             f'L\'alternative la plus proche de {o["name"]} ({o["brand"]}) : {b["name"]} de {b["brand"]}, indice de ressemblance {b["index"]} %.' + (f' Jusqu\'à {b["saving"]} % moins cher.' if b["saving"] else ""), body, amb=c, cls="fiche")
        urls.append(f'alternative/{o["slug"]}/')

    # ---------- top 30 ----------
    t30 = [(o, d) for o in data for d in o["dupes"] if d["top30"]]
    lst = "".join(f'<li><a href="../alternative/{o["slug"]}/">{e(o["name"])}</a> → {e(d["name"])}</li>' for o, d in t30[:6])
    top30 = f'''<section class="wrap sec first"><h1 class="h1">Le Top 30<span>.</span></h1>
<p class="sub">Les 30 paires les plus sûres de l'annuaire : l'original, l'alternative, l'indice et l'économie, sur deux pages faciles à garder dans ton téléphone. On y trouve par exemple :</p>
<ul class="t30">{lst}<li>… et 24 autres</li></ul></section><section class="wrap sec">{pdf_band("top30")}</section>'''
    page("top-30/index.html", "Top 30 des alternatives aux parfums de luxe (PDF gratuit) | Olfamatch",
         "Reçois gratuitement le PDF des 30 alternatives les plus sûres aux parfums de luxe et de niche.", top30, "top30")

    ml = f'''<section class="wrap sec first legal"><h1 class="h1">Mentions légales<span>.</span></h1>
<p><strong>Éditeur</strong><br>{e(CFG.get("editeur","Olfamatch"))}<br>Contact : <a href="mailto:olfamatch.contact@gmail.com">olfamatch.contact@gmail.com</a></p>
<p><strong>Hébergement</strong><br>Netlify, Inc., 512 2nd Street, Suite 200, San Francisco, CA 94107, États-Unis.</p>
<p><strong>Liens affiliés</strong><br>Les boutons d'achat renvoient vers des boutiques partenaires. Olfamatch touche une commission sur les achats effectués via ces liens, sans surcoût pour toi. En tant que Partenaire Amazon, Olfamatch réalise un bénéfice sur les achats remplissant les conditions requises.</p>
<p><strong>Marques et visuels</strong><br>Les noms de parfums et de marques cités appartiennent à leurs propriétaires. Ils sont mentionnés uniquement pour identifier les produits comparés. Olfamatch n'est lié à aucune de ces marques. Les alternatives présentées sont des parfums distincts, proches dans leur style olfactif, et non des reproductions. Les photos de flacons sont des illustrations.</p>
<p><strong>Indice de ressemblance</strong><br>Calculé par Olfamatch à partir du nombre de sources publiques indépendantes qui rapprochent deux parfums et des ingrédients publiés. Ce n'est pas une mesure en laboratoire.</p>
<p><strong>Données personnelles</strong><br>L'adresse e-mail laissée pour recevoir le PDF sert uniquement à t'envoyer le PDF et les nouveautés d'Olfamatch. Tu peux te désinscrire à tout moment avec le lien présent dans chaque e-mail, ou en écrivant à l'adresse de contact. Le site ne dépose pas de cookie publicitaire.</p></section>'''
    page("mentions-legales/index.html", "Mentions légales | Olfamatch", "Mentions légales du site Olfamatch.", ml)
    urls.append("mentions-legales/")
    page("404.html", "Page introuvable | Olfamatch", "Cette page n'existe pas.",
         f'<section class="wrap sec first"><h1 class="h1">Cette page n\'existe pas<span>.</span></h1><p class="sub">Cherche directement ton parfum :</p>{search_box("/", "q404")}</section>')
    (DIST / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>{SITE}/{u}</loc></url>" for u in urls) + "</urlset>")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
    print(f"OK : {len(urls)} pages, {len(duo)} paires illustrées")

if __name__ == "__main__":
    build()
