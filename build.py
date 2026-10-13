"""Génère le site statique Olfamatch dans dist/ à partir de data/parfums.json.
Usage : python3 build.py
Les images sont optionnelles : renseigner "image" (URL) sur un parfum original ou une alternative
dans data/parfums.json (ou data/images.json) et relancer le build."""
import json, html, os, shutil, re
from pathlib import Path

ROOT = Path(__file__).parent
DIST = ROOT / "dist"
SITE = "https://olfamatch.netlify.app"
CFG = json.loads((ROOT / "data/config.json").read_text()) if (ROOT / "data/config.json").exists() else {}

data = json.loads((ROOT / "data/parfums.json").read_text())
images = json.loads((ROOT / "data/images.json").read_text()) if (ROOT / "data/images.json").exists() else {}
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
    for d in o["dupes"]:
        d["note"] = clean_note(d["note"]); d["priceDetail"] = fr_num(d["priceDetail"])
for o in data:
    o["image"] = images.get(o["slug"], o.get("image"))
    for d in o["dupes"]:
        d["image"] = images.get(f'{o["slug"]}/{d["id"]}', d.get("image"))

e = lambda s: html.escape(str(s or ""), quote=True)

def euro(x):
    if x is None:
        return ""
    v = round(x)
    return f"{v} €"

def best(o):
    """Meilleure alternative affichable : la plus ressemblante qui a un prix et un lien, sinon la plus ressemblante."""
    priced = [d for d in o["dupes"] if d["price100"] and d["link"]]
    return (priced or o["dupes"])[0]

bottle_n = 0
def bottle(pct, size="sm"):
    """Flacon dessiné dont le niveau de liquide = indice de ressemblance."""
    global bottle_n
    bottle_n += 1
    pct = pct or 0
    i = f"b{bottle_n}"
    top = 16 + (60 - 16) * (1 - pct / 100)  # zone liquide : y 16 -> 60
    return f'''<svg viewBox="0 0 44 62" role="img" aria-label="Indice de ressemblance {pct} %">
<defs><clipPath id="{i}"><path d="M8 18 Q8 14 12 14 H32 Q36 14 36 18 V56 Q36 60 32 60 H12 Q8 60 8 56 Z"/></clipPath></defs>
<rect x="17" y="2" width="10" height="7" rx="1.5" fill="#C8A15A"/>
<rect x="19" y="9" width="6" height="5" fill="#8C6F3C"/>
<g clip-path="url(#{i})"><rect x="0" y="0" width="44" height="62" fill="#3A1D33"/>
<rect x="0" y="{top:.1f}" width="44" height="62" fill="#C8A15A" opacity=".9"/>
<rect x="0" y="{top:.1f}" width="44" height="1.6" fill="#F2D9A6"/></g>
<path d="M8 18 Q8 14 12 14 H32 Q36 14 36 18 V56 Q36 60 32 60 H12 Q8 60 8 56 Z" fill="none" stroke="#E2C68E" stroke-width="1.2"/>
</svg>'''

FONTS = ''

def page(path, title, desc, body, nav=""):
    url = SITE + "/" + path.replace("index.html", "")
    depth = path.count("/")
    rel = "../" * depth
    out = f'''<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="{url}"><meta name="theme-color" content="#1C0E19">
<link rel="icon" href="{rel}favicon.svg" type="image/svg+xml">{FONTS}<link rel="stylesheet" href="{rel}style.css"></head><body>
<div class="wrap"><header class="top"><a class="logo" href="{rel}">olfa<b>match</b></a>
<nav class="nav"><a href="{rel}annuaire/"{' aria-current="page"' if nav=="annuaire" else ""}>Annuaire</a><a href="{rel}top-30/"{' aria-current="page"' if nav=="top30" else ""}>Top 30 gratuit</a></nav></header>
<main>{body}</main>
<footer><div class="cols"><div>
<p>Olfamatch répertorie des parfums plus abordables proches de grands parfums, à partir de sources publiques. Nous ne vendons rien nous-mêmes.</p>
<p>Les boutons d'achat sont des liens affiliés : Olfamatch touche une petite commission sur les achats, sans surcoût pour toi. En tant que Partenaire Amazon, Olfamatch réalise un bénéfice sur les achats remplissant les conditions requises.</p>
<p>Les noms de parfums et de marques appartiennent à leurs propriétaires et sont cités uniquement pour identifier les produits comparés. Olfamatch n'est affilié à aucune de ces marques.</p>
</div><div><p><a href="{rel}annuaire/">Annuaire</a><br><a href="{rel}top-30/">Top 30 gratuit</a><br><a href="{rel}mentions-legales/">Mentions légales</a><br><a href="https://www.tiktok.com/@olfamatch" rel="noopener">TikTok</a> · <a href="https://www.instagram.com/olfamatch" rel="noopener">Instagram</a></p></div></div></footer></div>
<script src="{rel}assets/config.js"></script><script src="{rel}app.js" defer></script></body></html>'''
    f = DIST / path
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(out)

def row(o, rel):
    d = best(o)
    price = ""
    if o["price100"] and d["price100"]:
        price = f'<div class="price-pair"><s>{euro(o["price100"])}</s><span>{euro(d["price100"])}</span></div>'
        save = f'<span class="save">−{d["saving"]} %</span>' if d["saving"] else '<span></span>'
    else:
        price = '<div class="price-pair"></div>'
        save = '<span class="noprice">Prix à venir</span>'
    hay = " ".join([o["name"], o["brand"]] + [x["name"] + " " + x["brand"] for x in o["dupes"]]).lower()
    return f'''<a class="row" href="{rel}alternative/{o["slug"]}/" data-g="{e(o["gender"])}" data-l="{e(o["level"])}" data-h="{e(hay)}">
<div class="gauge"><div class="bottle">{bottle(d["index"])}</div><div class="gauge-label">{d["index"]} %</div></div>
<div class="orig"><div class="o-name">{e(o["name"])}</div><div class="o-brand">{e(o["brand"])}</div></div>
<div class="altn"><div class="a-name">{e(d["name"])}</div><div class="a-brand">{e(d["brand"])}{" · +" + str(len(o["dupes"])-1) + " autre" + ("s" if len(o["dupes"])>2 else "") if len(o["dupes"])>1 else ""}</div></div>
{price}{save}</a>'''

SEARCH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C8A15A" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'

def search_box(rel, big=True):
    return f'''<div class="search" data-root="{rel}"><label class="sr" for="q">Cherche ton parfum</label>{SEARCH_SVG}
<input id="q" type="search" autocomplete="off" placeholder="Ton parfum : Sauvage, Libre, Baccarat…" aria-controls="suggest" aria-autocomplete="list">
<div class="suggest" id="suggest" role="listbox"></div></div>'''

def email_form(source):
    return f'''<form class="form" data-source="{source}" novalidate>
<label class="sr" for="em-{source}">Ton adresse e-mail</label>
<input id="em-{source}" type="email" name="email" required placeholder="ton@email.fr" autocomplete="email">
<button class="btn" type="submit">Recevoir le PDF</button>
<small>Un seul e-mail avec le PDF, puis de temps en temps une nouvelle alternative. Désinscription en un clic.</small>
<p class="ok" hidden></p></form>'''

def build():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    shutil.copy(ROOT / "src/style.css", DIST / "style.css")
    shutil.copy(ROOT / "src/app.js", DIST / "app.js")
    shutil.copy(ROOT / "src/favicon.svg", DIST / "favicon.svg")
    if (ROOT / "src/assets").exists():
        shutil.copytree(ROOT / "src/assets", DIST / "assets")
    (DIST / "assets").mkdir(exist_ok=True)
    (DIST / "assets/config.js").write_text("window.OLFA=" + json.dumps({"form": CFG.get("form")}) + ";")

    # index de recherche léger
    idx = [{"n": o["name"], "b": o["brand"], "s": o["slug"],
            "a": [x["name"] + " " + x["brand"] for x in o["dupes"]]} for o in data]
    (DIST / "assets/search.json").write_text(json.dumps(idx, ensure_ascii=False))

    showcase_pairs = []
    for name in ["Baccarat Rouge 540", "Aventus", "Paradoxe", "Sauvage", "Libre"]:
        for o in data:
            if o["name"] == name:
                d = best(o)
                if o["price100"] and d["price100"]:
                    showcase_pairs.append({"o": o["name"], "ob": o["brand"], "op": euro(o["price100"]), "a": d["name"], "ab": d["brand"], "ap": euro(d["price100"]), "s": o["slug"]})
    first = showcase_pairs[0]
    top = [o for o in data if o["level"].startswith("Top") and best(o)["price100"] and best(o)["link"]][:12]

    home = f'''<section class="hero">
<div><h1>Le parfum de luxe que tu aimes, pour une fraction du prix.</h1>
<p class="lead">Pour {len(data)} grands parfums, on a cherché l'alternative la plus proche, son prix et ce que tu économises. Tape le tien.</p>
{search_box("")}
<p class="quick">Les plus cherchés : <a href="alternative/baccarat-rouge-540-maison-francis-kurkdjian/">Baccarat Rouge 540</a><a href="alternative/sauvage-dior/">Sauvage</a><a href="alternative/libre-yves-saint-laurent/">Libre</a></p></div>
<a class="showcase" href="alternative/{first["s"]}/" style="text-decoration:none;display:block" data-pairs='{e(json.dumps(showcase_pairs, ensure_ascii=False))}'>
<div class="slot"><div class="from">Tu aimes <span data-k="ob">{e(first["ob"])}</span></div><div class="orig" data-k="o">{e(first["o"])}</div>
<div class="prices"><span class="old" data-k="op">{first["op"]}</span><span class="new" data-k="ap">{first["ap"]}</span></div>
<div class="alt">Essaie <strong data-k="a">{e(first["a"])}</strong> de <span data-k="ab">{e(first["ab"])}</span></div></div>
<div class="unit">Prix ramenés à 100 ml, relevés en octobre 2026.</div></a>
</section>
<section class="sec"><h2>Les plus recherchés</h2><p class="sub">Le flacon montre l'indice de ressemblance : plus il est rempli, plus l'alternative est proche de l'original.</p>
<div class="rows">{"".join(row(o, "") for o in top)}</div>
<p style="margin-top:22px"><a class="btn ghost" href="annuaire/">Voir les {len(data)} parfums</a></p></section>
<section class="sec"><h2>Comment on choisit</h2><p class="sub">Personne chez nous ne prétend avoir « senti la différence ». On croise ce que disent les autres.</p>
<div class="method"><div><h3>On croise les sources</h3><p>Chaque paire est confirmée par des comparatifs indépendants. Plus il y en a, plus l'indice monte.</p></div>
<div><h3>On compare les notes</h3><p>Les ingrédients publiés de l'original et de l'alternative sont mis côte à côte.</p></div>
<div><h3>On ramène tout à 100 ml</h3><p>Pour comparer des flacons de tailles différentes sans se faire avoir.</p></div></div>
<p class="disclaimer">Indice calculé par Olfamatch à partir de sources publiques, pas une mesure en laboratoire. Une alternative reste un autre parfum : proche, pas identique.</p></section>
<section class="sec"><div class="band"><div><h2>Le Top 30 en PDF, gratuit</h2>
<p class="sub" style="margin:0">Les 30 alternatives les plus sûres, sur une page à garder dans ton téléphone pour ta prochaine parfumerie.</p>
<ul><li>10 grands classiques</li><li>10 parfums très demandés</li><li>10 parfums de niche</li></ul></div>{email_form("home")}</div></section>'''
    page("index.html", "Olfamatch : l'alternative moins chère à ton parfum de luxe",
         f"Trouve l'alternative la plus proche de {len(data)} parfums de luxe et de niche, avec le prix et l'économie réalisée.", home)

    # annuaire
    levels = [("Tous", ""), ("Grands classiques", "Top"), ("Demandés", "Demandé"), ("Niche", "Niche")]
    genders = [("Femme", "Femme"), ("Homme", "Homme"), ("Mixte", "Mixte")]
    chips = "".join(f'<button class="chip" type="button" data-f="l" data-v="{v}" aria-pressed="{"true" if v=="" else "false"}">{t}</button>' for t, v in levels)
    chips += '<span class="sep" aria-hidden="true"></span>' + "".join(f'<button class="chip" type="button" data-f="g" data-v="{v}" aria-pressed="false">{t}</button>' for t, v in genders)
    ann = f'''<section class="sec" style="padding-top:20px"><h1 class="sr">Annuaire</h1><h2>L'annuaire</h2>
<p class="sub">{len(data)} parfums et leur meilleure alternative. Clique sur un parfum pour voir toutes ses alternatives.</p>
<div class="search"><label class="sr" for="filter">Filtrer</label>{SEARCH_SVG}<input id="filter" type="search" autocomplete="off" placeholder="Filtrer par parfum ou par marque"></div>
<div class="filters" role="group" aria-label="Filtres">{chips}</div><p class="count" aria-live="polite"></p>
<div class="rows" id="dir">{"".join(row(o, "../") for o in data)}</div><p class="empty" hidden>Aucun parfum ne correspond. Essaie juste le nom, sans la marque.</p></section>'''
    page("annuaire/index.html", "Annuaire des alternatives aux parfums de luxe | Olfamatch",
         f"{len(data)} parfums de luxe et de niche avec leur alternative la plus proche, le prix et l'économie.", ann, "annuaire")

    # fiches
    urls = ["", "annuaire/", "top-30/"]
    for o in data:
        rel = "../../"
        b = best(o)
        cards = ""
        for d in o["dupes"]:
            facts = [f'<span><b>{d["index"]} %</b> de ressemblance</span>']
            if d["sources"]:
                facts.append(f'<span><b>{d["sources"]}</b> source{"s" if d["sources"]>1 else ""}</span>')
            if d["saving"]:
                facts.append(f'<span><b>−{d["saving"]} %</b> au 100 ml</span>')
            visual = f'<div class="photo"><img src="{e(d["image"])}" alt="{e(d["name"])}" loading="lazy"></div>' if d["image"] else f'<div class="bottle">{bottle(d["index"])}</div>'
            if d["link"]:
                buy = f'''<div class="buy"><div class="price">{euro(d["price100"]) if d["price100"] else ""}<small>{e(d["priceDetail"] or "")}</small></div>
<a class="btn" href="{e(d["link"])}" rel="sponsored nofollow noopener" target="_blank">Voir sur {e(d["shop"])}</a><div class="aff">Lien affilié</div></div>'''
            else:
                buy = '<div class="buy"><div class="aff">Lien d\'achat bientôt disponible</div></div>'
            src = ""
            if d["sourceLinks"]:
                src = '<details><summary>Sources</summary><p>' + "<br>".join(f'<a href="{e(u)}" rel="nofollow noopener" target="_blank">{e(u)}</a>' for u in d["sourceLinks"]) + '</p></details>'
            note = f'<p class="note">{e(d["note"])}</p>' if d["note"] else ""
            cards += f'''<article class="alt-card">{visual}<div><h2>{e(d["name"])}</h2><div class="brand">{e(d["brand"])}</div>
<div class="facts">{"".join(facts)}</div>{note}{src}</div>{buy}</article>'''
        ovisual = f'<div class="photo" style="max-width:180px">{""}<img src="{e(o["image"])}" alt="{e(o["name"])}"></div>' if o["image"] else ""
        title = f'Alternative à {o["name"]} de {o["brand"]}' + (f' : {b["name"]} (−{b["saving"]} %)' if b["saving"] else f' : {b["name"]}')
        body = f'''<p class="crumbs"><a href="{rel}annuaire/">Annuaire</a> / {e(o["brand"])}</p>
<div class="p-head"><div>{ovisual}<h1>Alternatives à {e(o["name"])}</h1><div class="meta">{e(o["brand"])} · {e(o["gender"])}</div></div>
<div class="o-price">{euro(o["price100"]) if o["price100"] else ""}<small>{"prix de l'original au 100 ml" if o["price100"] else ""}</small></div></div>
{cards}
<p class="disclaimer">Indice calculé par Olfamatch à partir de sources publiques, pas une mesure en laboratoire. Prix ramenés à 100 ml, relevés en octobre 2026 : ils peuvent avoir changé.</p>
<section class="sec"><div class="band"><div><h2>Le Top 30 en PDF, gratuit</h2><p class="sub" style="margin:0">Les 30 alternatives les plus sûres, sur une page à garder dans ton téléphone.</p></div>{email_form("fiche")}</div></section>'''
        page(f'alternative/{o["slug"]}/index.html', title + " | Olfamatch",
             f'L\'alternative la plus proche de {o["name"]} ({o["brand"]}) : {b["name"]} de {b["brand"]}, indice de ressemblance {b["index"]} %.' + (f' Jusqu\'à {b["saving"]} % moins cher.' if b["saving"] else ""), body)
        urls.append(f'alternative/{o["slug"]}/')

    # top 30
    t30 = [(o, d) for o in data for d in o["dupes"] if d["top30"]]
    lst = "".join(f'<li><a href="../alternative/{o["slug"]}/">{e(o["name"])}</a></li>' for o, d in t30[:6])
    top30 = f'''<section class="sec" style="padding-top:24px"><div class="band"><div><h1 style="font-family:var(--serif);font-weight:400;font-size:clamp(34px,5vw,56px);line-height:1.05;margin:0 0 14px">Le Top 30 des alternatives, en PDF</h1>
<p class="sub">Les 30 paires les plus sûres de l'annuaire : l'original, l'alternative, l'indice et l'économie, sur une seule page facile à garder dans ton téléphone.</p>
<p class="sub" style="margin-bottom:6px">On y trouve par exemple :</p><ul>{lst}<li>… et 24 autres</li></ul></div>{email_form("top30")}</div></section>'''
    page("top-30/index.html", "Top 30 des alternatives aux parfums de luxe (PDF gratuit) | Olfamatch",
         "Reçois gratuitement le PDF des 30 alternatives les plus sûres aux parfums de luxe et de niche.", top30, "top30")

    ml = f'''<section class="sec" style="padding-top:20px;max-width:44em"><h1 style="font-family:var(--serif);font-weight:400;font-size:44px;margin:0 0 20px">Mentions légales</h1>
<p><strong>Éditeur</strong><br>{e(CFG.get("editeur","Olfamatch"))}<br>Contact : <a href="mailto:olfamatch.contact@gmail.com">olfamatch.contact@gmail.com</a></p>
<p><strong>Hébergement</strong><br>Netlify, Inc., 512 2nd Street, Suite 200, San Francisco, CA 94107, États-Unis.</p>
<p><strong>Liens affiliés</strong><br>Les boutons d'achat renvoient vers des boutiques partenaires. Olfamatch touche une commission sur les achats effectués via ces liens, sans surcoût pour toi. En tant que Partenaire Amazon, Olfamatch réalise un bénéfice sur les achats remplissant les conditions requises.</p>
<p><strong>Marques</strong><br>Les noms de parfums et de marques cités appartiennent à leurs propriétaires. Ils sont mentionnés uniquement pour identifier les produits comparés. Olfamatch n'est lié à aucune de ces marques. Les alternatives présentées sont des parfums distincts, proches dans leur style olfactif, et non des reproductions.</p>
<p><strong>Indice de ressemblance</strong><br>Calculé par Olfamatch à partir du nombre de sources publiques indépendantes qui rapprochent deux parfums et des ingrédients publiés. Ce n'est pas une mesure en laboratoire.</p>
<p><strong>Données personnelles</strong><br>L'adresse e-mail laissée pour recevoir le PDF sert uniquement à t'envoyer le PDF et les nouveautés d'Olfamatch, via MailerLite. Tu peux te désinscrire à tout moment avec le lien présent dans chaque e-mail, ou en écrivant à l'adresse de contact. Le site ne dépose pas de cookie publicitaire.</p></section>'''
    page("mentions-legales/index.html", "Mentions légales | Olfamatch", "Mentions légales du site Olfamatch.", ml)
    urls.append("mentions-legales/")

    page("404.html", "Page introuvable | Olfamatch", "Cette page n'existe pas.",
         f'<section class="sec"><h2>Cette page n\'existe pas.</h2><p class="sub">Cherche directement ton parfum :</p>{search_box("/")}</section>')

    (DIST / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>{SITE}/{u}</loc></url>" for u in urls) + "</urlset>")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
    print(f"OK : {len(urls)} pages")

if __name__ == "__main__":
    build()
