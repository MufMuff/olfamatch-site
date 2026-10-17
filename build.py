"""Génère le site statique Olfamatch dans dist/ à partir de data/parfums.json.
Usage : python3 build.py
Images : data/images.json  ("slug" pour l'original, "slug/idAlternative" pour une alternative).
Couleurs : data/colors.json (mêmes clés) = couleur d'ambiance de chaque flacon.
Accords : data/accords.json (mêmes clés) = accords principaux (source Fragrantica), en % du plus fort.
Médias : data/media.json = vidéos et visuels générés (ouverture, univers, échantillons, familles)."""
import json, html, shutil, re, math, subprocess, datetime
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(__file__).parent
DIST = ROOT / "dist"
CFG = json.loads((ROOT / "data/config.json").read_text()) if (ROOT / "data/config.json").exists() else {}
SITE = CFG.get("site", "https://olfamatch.netlify.app")
data = json.loads((ROOT / "data/parfums.json").read_text())
load = lambda n: json.loads((ROOT / f"data/{n}.json").read_text()) if (ROOT / f"data/{n}.json").exists() else {}
images, colors, accords, media, familles = load("images"), load("colors"), load("accords"), load("media"), load("familles")
GOLD = "#C8A15A"

# ---------- accords et familles ----------
ACC_FR = {"white floral": "fleurs blanches", "citrus": "agrumes", "lavender": "lavande", "vanilla": "vanille", "aromatic": "aromatique",
    "sweet": "sucré", "powdery": "poudré", "animalic": "animal", "woody": "boisé", "amber": "ambré", "warm spicy": "épices chaudes",
    "fresh spicy": "épices fraîches", "soft spicy": "épices douces", "fruity": "fruité", "floral": "floral", "rose": "rose", "musky": "musqué",
    "leather": "cuir", "oud": "oud", "smoky": "fumé", "balsamic": "balsamique", "earthy": "terreux", "aquatic": "aquatique", "marine": "marin",
    "fresh": "frais", "green": "vert", "honey": "miel", "caramel": "caramel", "chocolate": "chocolat", "cacao": "cacao", "coffee": "café",
    "tobacco": "tabac", "iris": "iris", "violet": "violette", "tuberose": "tubéreuse", "yellow floral": "fleurs jaunes", "cherry": "cerise",
    "almond": "amande", "coconut": "noix de coco", "lactonic": "lacté", "salty": "salé", "ozonic": "ozonique", "metallic": "métallique",
    "mossy": "mousse", "patchouli": "patchouli", "vetiver": "vétiver", "tropical": "tropical", "sour": "acidulé", "herbal": "herbacé",
    "anis": "anis", "cinnamon": "cannelle", "rum": "rhum", "whiskey": "whisky", "wine": "vin", "beeswax": "cire d'abeille",
    "aldehydic": "aldéhydé", "camphor": "camphré", "nutty": "noisette", "mineral": "minéral", "conifer": "conifère", "bitter": "amer",
    "savory": "épicé salé", "cannabis": "chanvre", "tuberose ": "tubéreuse", "mossy ": "mousse", "soapy": "savonneux", "clean": "propre",
    "sand": "sable", "terpenic": "résineux", "vinyl": "vinyle", "plastic": "plastique", "industrial glue": "colle", "champagne": "champagne",
    "gourmand": "gourmand", "orange blossom": "fleur d'oranger", "milky": "lacté", "pear": "poire"}
FAM = {"frais": {"citrus", "aquatic", "marine", "fresh", "fresh spicy", "aromatic", "green", "ozonic", "lavender", "herbal", "mineral", "salty", "soapy", "clean"},
       "floral": {"white floral", "floral", "rose", "tuberose", "iris", "violet", "yellow floral", "powdery", "orange blossom", "aldehydic"},
       "gourmand": {"vanilla", "sweet", "caramel", "chocolate", "cacao", "coffee", "honey", "almond", "cherry", "fruity", "coconut", "lactonic", "milky", "nutty", "rum", "tropical", "pear"},
       "boise": {"woody", "earthy", "mossy", "vetiver", "patchouli", "conifer", "musky"},
       "ambre": {"amber", "warm spicy", "soft spicy", "oud", "leather", "smoky", "balsamic", "tobacco", "animalic", "cinnamon", "whiskey", "beeswax"}}
FAM_LABEL = {"frais": "Frais", "floral": "Floral", "gourmand": "Gourmand", "boise": "Boisé", "ambre": "Ambré"}
ADJ = {"frais": "frais", "floral": "floral", "gourmand": "gourmand", "boise": "boisé", "ambre": "ambré"}
TOUCHE = {"frais": "fraîche", "floral": "florale", "gourmand": "gourmande", "boise": "boisée", "ambre": "ambrée"}
MOOD = {"frais": "Frais et lumineux : il se porte facilement la journée et quand il fait chaud.",
        "floral": "Floral et élégant : doux, lumineux, il fait tout de suite soigné.",
        "gourmand": "Gourmand : sucré et réconfortant, il laisse un sillage qu'on remarque.",
        "boise": "Boisé : calme, chic et posé, il convient à presque toutes les occasions.",
        "ambre": "Ambré et chaud : enveloppant et intense, il est parfait pour le soir."}

def fam_scores(acc):
    s = {f: 0.0 for f in FAM}
    for n, p in acc:
        for f, names in FAM.items():
            if n in names: s[f] += p
    tot = sum(s.values()) or 1
    return {f: round(v / tot, 3) for f, v in s.items()}

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
    o["acc"] = accords.get(o["slug"]) or []
    for d in o["dupes"]:
        d["note"] = clean_note(d["note"]); d["priceDetail"] = fr_num(d["priceDetail"])
        if d["saving"] is not None and d["saving"] <= 0: d["saving"] = None  # alternative plus chère : pas d'économie à afficher
        k = f'{o["slug"]}/{d["id"]}'
        d["image"] = images.get(k, d.get("image")); d["color"] = colors.get(k)
        d["acc"] = accords.get(k) or []

e = lambda s: html.escape(str(s or ""), quote=True)

euro = lambda x: "" if x is None else f"{round(x)} €"
by = {o["slug"]: o for o in data}


def best(o):
    """La plus ressemblante qui a un lien d'achat (à égalité, celle qui a un prix), sinon la plus ressemblante."""
    linked = [d for d in o["dupes"] if d["link"]] or o["dupes"]
    return max(linked, key=lambda d: (d["index"] or 0, 1 if d["price100"] else 0))

def profile(o):
    """Accords de référence d'un parfum : les siens, sinon ceux de sa meilleure alternative."""
    return o["acc"] or best(o)["acc"]

def fam_of(o):
    """Familles d'un parfum (0 à 1) : moyenne des accords relevés et de notre classement, ou l'un des deux."""
    ed, pr = familles.get(o["slug"]), profile(o)
    if not pr: return dict(ed) if ed else None
    ac = fam_scores(pr)
    if not ed: return ac
    return {f: round((ac[f] + ed.get(f, 0)) / 2, 3) for f in FAM}
for o in data: o["fam"] = fam_of(o)

SITE_NAMES = {"pickmyclone.com": "PickMyClone", "scentverdict.com": "ScentVerdict", "scentonym.com": "Scentonym", "fragrantica.com": "Fragrantica",
    "sniffalike.com": "Sniffalike", "melissajanelee.com": "Melissa Jane Lee", "chaosfragrances.com": "Chaos Fragrances", "scento.com": "Scento",
    "fragdna.com": "FragDNA", "tonkava.com": "Tonkava", "youtube.com": "YouTube", "scentmetric.com": "ScentMetric", "thescentatlas.com": "The Scent Atlas",
    "scentfile.com": "Scentfile", "perfumeclonefinder.com": "Perfume Clone Finder", "dupedex.com": "Dupedex", "fragranzo.com": "Fragranzo",
    "10fragrances.com": "10 Fragrances", "parfumo.com": "Parfumo", "perfumenez.com": "Perfumenez", "reddit.com": "Reddit", "dupecabinet.com": "Dupe Cabinet",
    "thescentbase.com": "The Scent Base", "theduabrand.com": "le site de Dua", "fragrancereview.com": "FragranceReview", "arabicparfums.com": "Arabic Parfums", "altscent.app": "AltScent",
    "lemon8-app.com": "Lemon8", "osmoz.com": "Osmoz", "tiktok.com": "TikTok", "fragbar.com": "FragBar", "whowhatwear.com": "Who What Wear"}
def site_name(url):
    host = urlparse(url).netloc.lower().removeprefix("www.").removeprefix("fr.").removeprefix("m.")
    if host in SITE_NAMES: return SITE_NAMES[host]
    base = host.rsplit(".", 1)[0] if "." in host else host
    return base.replace("-", " ").title()
BRAND_SITES = ("theduabrand.com",)
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
def maj_date():
    """Mois de la dernière mise à jour des données (date du dernier enregistrement de data/)."""
    try:
        d = subprocess.run(["git", "log", "-1", "--format=%cs", "--", "data/"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        y, m, _ = d.split("-")
    except Exception:
        t = datetime.date.today(); y, m = t.year, t.month
    return f"{MOIS[int(m) - 1]} {y}"
MAJ = maj_date()
CONTACT = "olfamatch.contact@gmail.com"

def rs(url, w):
    """Version redimensionnée en WebP (proxy d'images de Higgsfield)."""
    return f"https://images.higgs.ai/?default=1&output=webp&url={quote(url, safe='')}&w={w}&q=80"
def img(url, alt, eager=False, ws=(480, 800), sizes="(max-width:720px) 90vw, 40vw", crop=True, ratio=4/3):
    if not url: return ""
    load_attr = 'fetchpriority="high"' if eager else 'loading="lazy"'
    r = (lambda w: rs(url, w) + f"&h={round(w*ratio)}&fit=cover&a=attention") if crop else (lambda w: rs(url, w))
    srcset = ", ".join(f"{e(r(w))} {w}w" for w in ws)
    return f'<img src="{e(r(ws[-1]))}" srcset="{srcset}" sizes="{sizes}" alt="{e(alt)}" {load_attr} decoding="async">'
def poster(url, w=1200):
    return rs(url, w) if url else ""
def video(key, poster_url, cls="", eager=False):
    """Vidéo en boucle, muette, chargée seulement quand elle approche de l'écran (image fixe en attendant)."""
    src = media.get(key)
    if not src: return ""
    return f'<video class="lv {cls}" muted loop playsinline preload="none" data-src="{e(src)}"{" data-eager=1" if eager else ""} aria-hidden="true"></video>'

def match(pct, big=False):
    """Indice : un chiffre et un fin trait qui se remplit."""
    return f'<span class="match{" big" if big else ""}" style="--p:{(pct or 0)/100:.2f}"><b>{pct}<small> %</small></b><i></i><em>ressemblance</em></span>'

def thumb(url, name, color, w=160, size="72px"):
    if url:
        return f'<span class="thumb">{img(url, name, ws=(w,), sizes=size)}</span>'
    return f'<span class="thumb mono" style="--c:{color or GOLD}">{e(name[:1])}</span>'

SEARCH_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
HEART_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.1 3.6 4.5 7.2 4.5c2 0 3.5 1.1 4.8 2.8 1.3-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.6 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>'

def search_box(rel, ident="q"):
    return f'''<div class="search" data-root="{rel}"><label class="sr" for="{ident}">Cherche ton parfum</label>{SEARCH_SVG}
<input id="{ident}" type="search" autocomplete="off" placeholder="Ton parfum : Sauvage, Libre…" aria-autocomplete="list">
<div class="suggest" role="listbox"></div></div>'''

def notify_form(source, parfum, label="Me prévenir"):
    """Inscription « préviens-moi quand l'échantillon arrive » (groupe MailerLite « Échantillons »)."""
    ident = re.sub(r"[^a-z0-9]+", "-", (source + "-" + parfum).lower())[:60]
    return f'''<form class="form" name="echantillon" data-kind="notify" novalidate>
<input type="hidden" name="source" value="{e(source)}"><input type="hidden" name="parfum" value="{e(parfum)}"><p hidden><label>Ne pas remplir <input name="site"></label></p>
<label class="sr" for="n-{ident}">Ton adresse e-mail</label>
<div class="field"><input id="n-{ident}" type="email" name="email" required placeholder="ton@email.fr" autocomplete="email"><button class="btn" type="submit">{label}</button></div>
<small>Un e-mail le jour où l'échantillon est disponible, c'est tout.</small>
<p class="ok" hidden></p></form>'''

def page(path, title, desc, body, nav="", amb=None, cls="", og=None):
    url = SITE + "/" + path.replace("index.html", "")
    rel = "/" if path == "404.html" else "../" * path.count("/")
    cur = lambda n: ' aria-current="page"' if nav == n else ""
    ogimg = f'<meta property="og:image" content="{e(og)}">' if og else ""
    # Grands titres : apparition ligne par ligne (voir app.js)
    body = re.sub(r'<(h1|h2|p) class="(h1|h2|v-title|big)\b', r'<\1 data-split class="\2', body)
    body = body.replace('<div class="wrap hero-copy"><h1>', '<div class="wrap hero-copy"><h1 data-split>')
    out = f'''<!doctype html><html lang="fr" style="--amb:{amb or "#5a2140"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{e(title)}</title><meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">{ogimg}
<meta property="og:type" content="website"><meta property="og:url" content="{url}"><meta name="theme-color" content="#160A13"><script>document.documentElement.classList.add("js")</script>
<link rel="icon" href="{rel}favicon.svg" type="image/svg+xml"><link rel="preconnect" href="https://images.higgs.ai"><link rel="preload" href="{rel}assets/fonts/bodoni.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="{rel}style.css"></head><body class="{cls}" data-root="{rel}">
<div class="amb" aria-hidden="true" style="--glow:{amb or "#5a2140"}"></div>
<header class="top"><div class="wrap top-in"><a class="logo" href="{rel}">olfa<b>match</b></a>
<nav class="nav"><a class="n-ann" href="{rel}annuaire/"{cur("annuaire")}>Annuaire</a><a class="n-quiz" href="{rel}quiz/"{cur("quiz")}>Quiz</a><a class="n-ech" href="{rel}echantillons/"{cur("ech")}>Échantillons</a>
<a class="n-fav" href="{rel}ma-liste/" aria-label="Ma liste"{cur("liste")}>{HEART_SVG}<span class="fav-n" hidden></span></a>
<button class="s-open" type="button" aria-label="Rechercher un parfum">{SEARCH_SVG}</button></nav></div></header>
<div class="overlay" hidden><div class="wrap"><button class="s-close" type="button">Fermer</button><p class="o-title">Quel parfum tu aimes ?</p>{search_box(rel, "q2")}</div></div>
<main>{body}</main>
<footer><div class="wrap"><div class="f-top"><a class="logo" href="{rel}">olfa<b>match</b></a>
<p class="f-links"><a href="{rel}annuaire/">Annuaire</a><a href="{rel}quiz/">Quiz</a><a href="{rel}echantillons/">Échantillons</a><a href="{rel}ma-liste/">Ma liste</a><a href="{rel}top-30/">Top 30</a><a href="{rel}pourquoi-olfamatch/">Pourquoi Olfamatch</a><a href="{rel}mentions-legales/">Mentions légales</a><a href="https://www.tiktok.com/@olfamatch" rel="noopener">TikTok</a><a href="https://www.instagram.com/olfamatch" rel="noopener">Instagram</a></p></div>
<p>Olfamatch répertorie des parfums plus abordables proches de grands parfums, à partir de sources publiques. Les boutons d'achat sont des liens affiliés : Olfamatch touche une petite commission sur les achats, sans surcoût pour toi. En tant que Partenaire Amazon, Olfamatch réalise un bénéfice sur les achats remplissant les conditions requises.</p>
<p>Les noms de parfums et de marques appartiennent à leurs propriétaires et sont cités uniquement pour identifier les produits comparés. Olfamatch n'est affilié à aucune de ces marques. Photos de flacons : illustrations. Familles olfactives : classement Olfamatch, complété par les accords principaux publiés par la communauté Fragrantica quand ils sont affichés.</p></div></footer>
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

def card(o, rel):
    """Petite carte « tu aimeras aussi » : flacon de l'original, alternative et économie."""
    d = best(o)
    sv = f'<em>−{d["saving"]} %</em>' if d["saving"] else ""
    pic = img(o["image"], o["name"], ws=(260, 400), sizes="(max-width:720px) 44vw, 200px") if o["image"] else f'<span class="c-mono" style="--c:{o["color"] or GOLD}">{e(o["name"][:1])}</span>'
    return f'''<a class="pcard" href="{rel}alternative/{o["slug"]}/" style="--c:{o["color"] or d["color"] or GOLD}"><span class="pc-img">{pic}</span>
<span class="pc-txt"><b>{e(o["name"])}</b><i>{e(o["brand"])}</i><span class="pc-alt">→ {e(d["name"])} {sv}</span></span></a>'''

def vec(acc): return {n: p for n, p in acc}
def cos(a, b):
    if not a or not b: return 0
    num = sum(a[k] * b.get(k, 0) for k in a)
    den = math.sqrt(sum(v*v for v in a.values())) * math.sqrt(sum(v*v for v in b.values()))
    return num / den if den else 0

def related(o, n=6):
    """Parfums proches : mêmes accords si on les connaît des deux côtés, sinon mêmes familles ; à égalité, les plus connus."""
    va, fa = vec(profile(o)), o["fam"] or {}
    ok_g = lambda x: o["gender"] == "Mixte" or x["gender"] in (o["gender"], "Mixte")
    pool = [x for x in data if x is not o and ok_g(x) and best(x)["name"] != best(o)["name"]]
    def sim(x):
        vx = vec(profile(x))
        s = cos(va, vx) if va and vx else 0.9 * cos(fa, x["fam"] or {})
        return s + (0.04 if x["image"] else 0) + 0.04 * max(0, 1 - (x["rank"] or 450) / 450)
    if not va and not fa:
        pool = [x for x in pool if x["level"][:3] == o["level"][:3]]
        return sorted(pool, key=lambda x: (0 if x["image"] else 1, x["rank"] or 999))[:n]
    return sorted(pool, key=lambda x: -sim(x))[:n]

def accords_block(o, b):
    """« Ce qu'on sent » : famille et ambiance, avec les barres des accords quand on les connaît."""
    ao, ab = vec(o["acc"]), vec(b["acc"])
    fs = o["fam"]
    if not ao and not ab:
        if not fs: return ""
        top2 = sorted(fs, key=fs.get, reverse=True)
        sec = f', avec une touche {TOUCHE[top2[1]]}' if len(top2) > 1 and fs[top2[1]] >= 0.25 else ""
        return f'''<section class="wrap sec tight accords solo reveal" style="--c:{b["color"] or o["color"] or GOLD}"><div class="ac-head"><p class="tag">Ce qu'on sent</p>
<h2 class="h2 small">{FAM_LABEL[top2[0]]}<span>.</span></h2><p class="ac-mood">{MOOD[top2[0]]}</p><p class="ac-common">{e(o["name"])} est surtout <b>{ADJ[top2[0]]}</b>{sec}. {e(b["name"])} joue dans le même registre.</p></div></section>'''
    ref = o["acc"] or b["acc"]
    names = [n for n, _ in ref][:7]
    for n, _ in (b["acc"] if o["acc"] else []):
        if len(names) >= 8: break
        if n not in names and ab.get(n, 0) >= 50: names.append(n)
    two = bool(ao and ab)
    rows = ""
    for i, n in enumerate(names):
        lab = ACC_FR.get(n, n)
        bars = (f'<i class="bo" style="--w:{ao.get(n,0)/100:.2f}"></i>' if ao else "") + (f'<i class="ba" style="--w:{ab.get(n,0)/100:.2f}"></i>' if ab else "")
        rows += f'<div class="ac-row" style="--i:{i}"><span>{e(lab)}</span><span class="ac-bars">{bars}</span></div>'
    fs = fs or fam_scores(ref); fam = max(fs, key=fs.get)
    legend = (f'<p class="ac-leg"><span class="lo">{e(o["name"])}</span><span class="la">{e(b["name"])}</span></p>' if two
              else f'<p class="ac-leg"><span class="{"lo" if ao else "la"}">{e(o["name"] if ao else b["name"])}</span></p>')
    shared = ""
    if two:
        common = [ACC_FR.get(n, n) for n in names if ao.get(n, 0) >= 40 and ab.get(n, 0) >= 40][:3]
        if common: shared = f'<p class="ac-common">Ils partagent surtout : <b>{e(", ".join(common))}</b>.</p>'
    return f'''<section class="wrap sec tight accords reveal" style="--c:{b["color"] or o["color"] or GOLD}"><div class="ac-head"><p class="tag">Ce qu'on sent</p>
<h2 class="h2 small">{FAM_LABEL[fam]}<span>.</span></h2><p class="ac-mood">{MOOD[fam]}</p>{shared}</div>
<div class="ac-chart">{legend}{rows}<p class="fine">Accords principaux d'après la communauté Fragrantica, en intensité relative.</p></div></section>'''

def build():
    if DIST.exists(): shutil.rmtree(DIST)
    DIST.mkdir()
    for f in ("style.css", "app.js", "favicon.svg"): shutil.copy(ROOT / "src" / f, DIST / f)
    if (ROOT / "src/assets").exists(): shutil.copytree(ROOT / "src/assets", DIST / "assets")
    (DIST / "assets").mkdir(exist_ok=True)
    (DIST / "assets/config.js").write_text("window.OLFA=" + json.dumps({"form": CFG.get("form"), "form_ech": CFG.get("form_ech")}) + ";")
    def sidx(o):
        d = best(o)
        return {"n": o["name"], "b": o["brand"], "s": o["slug"], "i": rs(o["image"], 96) if o["image"] else "",
                "a": [x["name"] + " " + x["brand"] for x in o["dupes"]], "x": d["name"], "xb": d["brand"],
                "xp": round(d["price100"]) if d["price100"] else None, "v": d["saving"], "c": o["color"] or d["color"] or GOLD}
    (DIST / "assets/search.json").write_text(json.dumps([sidx(o) for o in data], ensure_ascii=False))

    # données du quiz : parfums dont on connaît les accords et dont l'alternative a un prix
    quiz = []
    for o in data:
        d = best(o)
        if not o["fam"] or not d["price100"] or (o["price100"] and d["price100"] >= o["price100"]): continue
        quiz.append({"s": o["slug"], "n": o["name"], "b": o["brand"], "g": o["gender"], "f": o["fam"],
                     "x": d["name"], "xb": d["brand"], "xp": round(d["price100"]), "op": round(o["price100"]) if o["price100"] else None,
                     "v": d["saving"], "m": d["index"], "r": o["rank"] or 999,
                     "i": (rs(o["image"], 300) + "&h=400&fit=cover&a=attention") if o["image"] else "",
                     "xi": (rs(d["image"], 300) + "&h=400&fit=cover&a=attention") if d["image"] else "", "c": o["color"] or d["color"] or GOLD})
    (DIST / "assets/quiz.json").write_text(json.dumps(quiz, ensure_ascii=False))

    # ---------- accueil ----------
    def pair(slug):
        o = by[slug]; d = best(o)
        return {"o": o["name"], "op": round(o["price100"]), "a": d["name"], "ap": round(d["price100"]), "sv": d["saving"], "s": o["slug"]}
    deals = [pair(s) for s in ["baccarat-rouge-540-maison-francis-kurkdjian", "aventus-creed", "oud-wood-tom-ford", "opera-xerjoff", "sauvage-elixir-dior"]]
    f0 = deals[0]
    mq = sorted([o for o in data if o["price100"] and o["price100"] >= 150 and best(o)["price100"] and best(o)["link"] and best(o)["saving"]], key=lambda o: o["rank"] or 999)[:16]
    mq_html = "".join(f'<a href="alternative/{o["slug"]}/"><b>{e(o["name"])}</b> <s>{euro(o["price100"])}</s> <span>{e(best(o)["name"])} {euro(best(o)["price100"])}</span></a>' for o in mq)
    cnt = {k: sum(1 for o in data if o["level"].startswith(k)) for k in ("Top", "Demandé", "Niche")}
    n_alt = sum(len(o["dupes"]) for o in data)
    n_src = sum(d["sources"] or 0 for o in data for d in o["dupes"])

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

    def uni(slug, title, key, text, q, vkey, cls=""):
        o = by[slug]
        pic = images.get("_u_aventus") if slug == "aventus-creed" else o["image"]
        return f'''<a class="uni {cls} reveal" href="annuaire/?l={q}" style="--c:{o["color"] or GOLD}"><span class="u-img">{img(pic, o["name"] + " de " + o["brand"], ws=(600, 1000), sizes="(max-width:720px) 92vw, 50vw", crop=False)}{video(vkey, pic)}</span>
<span class="u-txt"><span class="u-n">{cnt[key]} parfums</span><b>{title}</b><span class="u-p">{text}</span></span></a>'''

    chips = [("baccarat-rouge-540-maison-francis-kurkdjian", "Baccarat Rouge 540"), ("sauvage-dior", "Sauvage"), ("aventus-creed", "Aventus"),
             ("libre-yves-saint-laurent", "Libre"), ("black-opium-yves-saint-laurent", "Black Opium"), ("lost-cherry-tom-ford", "Lost Cherry")]
    chips_html = "".join(f'<a class="qchip" href="alternative/{s}/">{e(t)}</a>' for s, t in chips if s in by)
    fam_cards = "".join(f'<a class="fam" href="quiz/?f={k}"><span class="fam-img">{img(media.get("fam_"+k), "", ws=(240, 400), sizes="(max-width:720px) 40vw, 18vw", crop=True, ratio=1)}</span><b>{FAM_LABEL[k]}</b></a>' for k in FAM if media.get("fam_" + k))
    top = [o for o in data if o["level"].startswith("Top") and best(o)["price100"] and best(o)["link"]][:10]
    deals_json = e(json.dumps(deals, ensure_ascii=False))
    offers = [("Duo", "2 × 2 ml", "7 €", "Deux parfums au choix pour découvrir."), ("Découverte", "5 × 2 ml", "14 €", "Cinq parfums au choix, la box la plus complète."), ("Le 10 ml", "Spray de 10 ml", "13 €", "Pour celui ou celle qui a trouvé son parfum.")]
    offers_html = "".join(f'<div class="offer"><p class="of-n">{n}</p><p class="of-s">{s}</p><p class="of-p">{p}</p><p class="of-t">{t}</p></div>' for n, s, p, t in offers)
    home = f'''<section class="hero">
<div class="hero-media" aria-hidden="true">{img(images["_hero"], "", eager=True, ws=(1000, 1600, 2400), sizes="100vw", crop=False)}{video("hero", images["_hero"], "hv", eager=True)}<div class="mist"><i></i><i></i></div></div>
<div class="wrap hero-copy"><h1>Le parfum de luxe que tu aimes, <span>pour une fraction du prix.</span></h1>
{search_box("")}
<div class="qchips"><span>Les plus cherchés :</span>{chips_html}</div>
<p class="lead">{len(data)} grands parfums, leur alternative la plus proche et ce que tu économises vraiment.</p>
<a class="deal" href="alternative/{f0["s"]}/" data-deals="{deals_json}">
<span class="d-l"><span data-k="o">{e(f0["o"])}</span> <s data-k="op">{f0["op"]} €</s></span>
<span class="d-r"><span class="arr">→</span> <span data-k="a">{e(f0["a"])}</span> <strong data-k="ap">{f0["ap"]} €</strong> <em data-k="sv">−{f0["sv"]} %</em></span></a></div>
</section>
<div class="marquee" aria-label="Exemples d'économies"><div class="mq-track">{mq_html}{mq_html.replace('<a ', '<a aria-hidden="true" tabindex="-1" ')}</div></div>
<section class="wrap stats reveal" aria-label="L'annuaire en chiffres"><div><b data-count="{len(data)}">{len(data)}</b><span>parfums de luxe et de niche</span></div>
<div><b data-count="{n_alt}">{n_alt}</b><span>alternatives repérées</span></div><div><b data-count="{n_src}">{n_src}</b><span>comparatifs croisés</span></div></section>
<section class="wrap sec tight recent" hidden><div class="sec-row"><h2 class="h2 small">Tu as regardé</h2><a class="link" href="ma-liste/">Ma liste →</a></div><div class="pcards"></div></section>
<section class="story"><div class="wrap s-head"><h2 class="h2">Même famille d'odeur.<br><span>Pas le même prix.</span></h2>
<div class="arrows"><button type="button" class="prev" aria-label="Paire précédente">←</button><button type="button" class="next" aria-label="Paire suivante">→</button></div></div>
<div class="slider" tabindex="0" aria-label="Paires original et alternative">{"".join(slide(o, i+1) for i, o in enumerate(duo))}</div></section>
<section class="wrap sec quizband reveal"><div class="qb-txt"><p class="tag">Le quiz</p><h2 class="h2">Pas d'idée précise ?<br><span>Trouve ton parfum en 30 secondes.</span></h2>
<p class="sub">Quatre questions sur ce que tu aimes sentir, quand tu le portes et ton budget. On te sort les alternatives qui te correspondent.</p><a class="btn big" href="quiz/">Faire le quiz</a></div>
<div class="fams">{fam_cards}</div></section>
<section class="wrap sec"><h2 class="h2">Trois façons<br><span>de chercher.</span></h2>
<div class="unis">{uni("aventus-creed", "Les grands classiques", "Top", "Les stars des parfumeries, celles que tout le monde reconnaît.", "Top", "u_aventus", "u-big")}{uni("oud-wood-tom-ford", "Les très demandés", "Demandé", "Ceux dont on parle partout, souvent bien plus chers.", "Demandé", "u_oud")}{uni("opera-xerjoff", "La niche", "Niche", "Les maisons confidentielles, là où l'économie est la plus forte.", "Niche", "u_opera")}</div></section>
<section class="wrap sec"><div class="sec-row"><h2 class="h2">Les plus<br><span>recherchés.</span></h2><a class="link" href="annuaire/">Les {len(data)} parfums →</a></div>
<div class="rows reveal">{"".join(row(o, "", i) for i, o in enumerate(top))}</div></section>
<section class="wrap sec samples reveal"><div class="sp-media">{img(media.get("sample_fill"), "Une fiole d'échantillon remplie à la pipette", ws=(800, 1400), sizes="(max-width:720px) 92vw, 55vw", crop=False)}{video("v_fill", media.get("sample_fill"))}</div>
<div class="sp-txt"><p class="tag">Bientôt</p><h2 class="h2">Sens-le<br><span>avant d'acheter.</span></h2>
<p class="sub">Des échantillons des alternatives les plus demandées, remplis à la main et envoyés chez toi. Pour essayer sur ta peau avant de commander le grand flacon.</p>
<div class="offers">{offers_html}</div>{notify_form("home", "", "Me prévenir")}<a class="link" href="echantillons/">Tout savoir sur les échantillons →</a></div></section>
<section class="wrap sec manifesto reveal"><p class="big">On n'a rien senti à ta place.<br><span>On a tout croisé.</span></p>
<div class="m-txt"><p>Chaque paire est confirmée par des comparatifs indépendants : plus ils sont nombreux, plus l'indice monte. On compare ensuite les ingrédients publiés des deux parfums, puis on ramène tous les prix à 100 ml pour que tu compares ce qui est comparable.</p>
<p class="fine">Indice calculé par Olfamatch à partir de sources publiques, pas une mesure en laboratoire. Une alternative reste un autre parfum : proche, pas identique.</p></div></section>'''
    page("index.html", "Olfamatch : l'alternative moins chère à ton parfum de luxe",
         f"Trouve l'alternative la plus proche de {len(data)} parfums de luxe et de niche, avec le prix et l'économie réalisée.", home, amb=colors.get("_hero"), cls="home", og=rs(images["_hero"], 1200))

    # ---------- annuaire ----------
    levels = [("Tous", ""), ("Grands classiques", "Top"), ("Très demandés", "Demandé"), ("Niche", "Niche")]
    genders = [("Femme", "Femme"), ("Homme", "Homme"), ("Mixte", "Mixte")]
    chips = "".join(f'<button class="chip" type="button" data-f="l" data-v="{v}" aria-pressed="{"true" if v=="" else "false"}">{t}</button>' for t, v in levels)
    chips += '<span class="sep" aria-hidden="true"></span>' + "".join(f'<button class="chip" type="button" data-f="g" data-v="{v}" aria-pressed="false">{t}</button>' for t, v in genders)
    ann = f'''<section class="wrap sec first"><h1 class="h1">L'annuaire<span>.</span></h1>
<p class="sub">{len(data)} parfums et leur meilleure alternative. Clique sur un parfum pour voir toutes ses alternatives. Pas d'idée ? <a href="../quiz/">Fais le quiz</a>.</p>
<div class="search small"><label class="sr" for="filter">Filtrer</label>{SEARCH_SVG}<input id="filter" type="search" autocomplete="off" placeholder="Filtrer par parfum ou par marque"></div>
<div class="filters" role="group" aria-label="Filtres">{chips}</div><p class="count" aria-live="polite"></p>
<div class="rows" id="dir">{"".join(row(o, "../", i % 12) for i, o in enumerate(data))}</div><p class="empty" hidden>Aucun parfum ne correspond. Essaie juste le nom, sans la marque.</p></section>'''
    page("annuaire/index.html", "Annuaire des alternatives aux parfums de luxe | Olfamatch",
         f"{len(data)} parfums de luxe et de niche avec leur alternative la plus proche, le prix et l'économie.", ann, "annuaire")

    # ---------- fiches ----------
    urls = ["", "annuaire/", "quiz/", "echantillons/", "top-30/"]
    lvl = lambda l: "Grand classique" if l.startswith("Top") else ("Très demandé" if l.startswith("Demandé") else "Niche")
    def buy(d, big=False, cls=""):
        if d["link"]:
            return f'''<div class="buy {cls}"><p class="price">{euro(d["price100"]) if d["price100"] else ""}<small>{e(d["priceDetail"] or "")}</small></p>
<a class="btn{" big" if big else ""}" href="{e(d["link"])}" rel="sponsored nofollow noopener" target="_blank">Voir sur {e(d["shop"])}</a><small class="aff">Lien affilié</small></div>'''
        return f'<div class="buy {cls}"><small class="aff">Lien d\'achat bientôt disponible</small></div>'
    def srcs(d):
        if not d["sourceLinks"]: return ""
        seen, links = set(), []
        for u in d["sourceLinks"]:
            n = site_name(u)
            if n in seen: continue
            seen.add(n); links.append(f'<a href="{e(u)}" rel="nofollow noopener" target="_blank">{e(n)}</a>')
        txt = links[0] if len(links) == 1 else ", ".join(links[:-1]) + " et " + links[-1]
        return f'<p class="srcs">Repéré par {txt}.</p>'
    RING = '<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="r-bg"/><circle cx="60" cy="60" r="52" class="r-fg" pathLength="100"/></svg>'
    for o in data:
        rel = "../../"
        b = best(o)
        c = o["color"] or b["color"] or GOLD
        o_pic = img(o["image"], o["name"] + " de " + o["brand"], eager=True, ws=(360, 600), sizes="(max-width:720px) 46vw, 300px") if o["image"] else f'<span class="vs-mono" style="--c:{c}">{e(o["name"])}</span>'
        b_pic = img(b["image"], b["name"] + " de " + b["brand"], eager=True, ws=(360, 600), sizes="(max-width:720px) 46vw, 300px") if b["image"] else f'<span class="vs-mono" style="--c:{b["color"] or GOLD}">{e(b["name"])}</span>'
        diff = round(o["price100"] - b["price100"]) if o["price100"] and b["price100"] and o["price100"] > b["price100"] else None
        if diff and b["saving"]:
            vsave = f'<p class="v-save">Tu économises <b data-from="0" data-to="{diff}">{diff} €</b> sur 100 ml<em>−{b["saving"]} %</em></p>'
        else:
            vsave = f'<p class="v-save">{e(b["name"])} de {e(b["brand"])}, l\'alternative la plus proche.</p>'
        vbuy = (f'<a class="btn big v-buy" href="{e(b["link"])}" rel="sponsored nofollow noopener" target="_blank">Voir le prix sur {e(b["shop"])}</a>'
                if b["link"] else '<a class="btn big v-buy ghost" href="#echantillon">Être prévenu</a>')
        fav = f'<button class="fav" type="button" data-s="{o["slug"]}" aria-pressed="false"><span class="sr">Ajouter à ma liste</span>{HEART_SVG}</button>'
        oprice = f'<s>{euro(o["price100"])}</s>' if o["price100"] else ""
        bprice = f'<strong>{euro(b["price100"])}</strong>' if b["price100"] else ""
        ns = b["sources"] or 0
        own = any(urlparse(u).netloc.endswith(BRAND_SITES) for u in (b["sourceLinks"] or []))  # site de la marque de l'alternative : pas une source indépendante
        ind = max(ns - (1 if own else 0), 0)
        src_lbl = f'{ind} source{"s" if ind > 1 else ""} indépendante{"s" if ind > 1 else ""}' + (" + le site de la marque" if own else "")
        note = f'<p class="note">{e(b["note"])}</p>' if b["note"] else ""
        others = ""
        for d in o["dupes"]:
            if d is b: continue
            facts = match(d["index"]) + (f'<span class="save">−{d["saving"]} %</span>' if d["saving"] else "")
            dn = f'<p class="note">{e(d["note"])}</p>' if d["note"] else ""
            others += f'''<article class="other reveal" style="--c:{d["color"] or GOLD}">{thumb(d["image"], d["name"], d["color"])}<div class="o-main"><h3>{e(d["name"])}</h3><p class="brand">{e(d["brand"])}</p><div class="facts">{facts}</div>{dn}{srcs(d)}</div>{buy(d)}</article>'''
        others_html = f'<section class="wrap sec tight" id="autres"><h2 class="h2 small">Les autres pistes</h2>{others}</section>' if others else ""
        rel_html = "".join(card(x, rel) for x in related(o))
        report = "mailto:" + CONTACT + "?subject=" + quote(f'Erreur sur la fiche {o["name"]} ({o["brand"]})') + "&body=" + quote(f'Bonjour,\n\nSur la page {SITE}/alternative/{o["slug"]}/ :\n\n')
        title = f'Alternative à {o["name"]} de {o["brand"]}' + (f' : {b["name"]} (−{b["saving"]} %)' if b["saving"] else f' : {b["name"]}')
        sbar = (f'''<div class="sbar" hidden>{thumb(b["image"], b["name"], b["color"], 120, "44px")}<span class="sb-t"><b>{e(b["name"])}</b><i>{euro(b["price100"]) + " les 100 ml" if b["price100"] else e(b["brand"])}</i></span>
<a class="btn" href="{e(b["link"])}" rel="sponsored nofollow noopener" target="_blank">Voir le prix</a></div>''' if b["link"] else "")
        body = f'''<section class="v-hero"><div class="wrap">
<p class="crumbs"><a href="{rel}annuaire/">Annuaire</a> / {e(o["brand"])} · {e(o["gender"])} · {lvl(o["level"])}</p>
<h1 class="v-title"><small>L'alternative à</small>{e(o["name"])} <span>{e(o["brand"])}</span></h1>
<div class="vs" style="--c:{c};--c2:{b["color"] or c}">
<figure class="vs-card vs-o">{o_pic}<figcaption><span>L'original</span><b>{e(o["name"])}</b>{oprice}</figcaption></figure>
<div class="vs-ring" style="--p:{(b["index"] or 0)}">{RING}<b>{b["index"]}<small>%</small></b><span>ressemblance</span></div>
<figure class="vs-card vs-a">{b_pic}<figcaption><span>L'alternative</span><b>{e(b["name"])}</b><i>{e(b["brand"])}</i>{bprice}</figcaption></figure></div>
<div class="verdict">{vsave}<div class="v-cta">{vbuy}{fav}</div>
<p class="v-more"><a href="#echantillon">Échantillon 2 ml : me prévenir</a>{' · <a href="#autres">' + str(len(o["dupes"])-1) + ' autre' + ("s" if len(o["dupes"]) > 2 else "") + ' piste' + ("s" if len(o["dupes"]) > 2 else "") + '</a>' if len(o["dupes"]) > 1 else ""}</p>
{'<p class="aff">Lien affilié · ' + e(b["priceDetail"]) + '</p>' if b["link"] and b["priceDetail"] else ""}
<p class="v-meta">Fiche mise à jour en {MAJ} · <a href="{e(report)}">Signaler une erreur</a></p></div></div></section>
<div class="v-band" aria-hidden="true"><div class="vn-track">{('<span>' + e(o["name"]) + '</span><span class="alt">' + e(b["name"]) + '</span>') * 4}</div></div>
{accords_block(o, b)}
<section class="wrap sec tight why reveal" style="--c:{b["color"] or c}"><div><p class="tag">Pourquoi cette alternative</p><h2 class="h2 small">{e(b["name"])}<span>.</span></h2><p class="brand">{e(b["brand"])}</p>
<div class="facts">{match(b["index"], big=True)}<span class="src">{src_lbl}</span></div>{note}{srcs(b)}</div>{buy(b, True)}</section>
{others_html}
<section class="wrap sec tight"><div class="sec-row"><h2 class="h2 small">Tu aimeras aussi</h2><a class="link" href="{rel}quiz/">Faire le quiz →</a></div><div class="pcards">{rel_html}</div></section>
<section class="wrap sec" id="echantillon"><div class="notify"><div class="n-img">{img(media.get("sample_box"), "Une box d'échantillons de parfum", ws=(500, 800), sizes="(max-width:720px) 92vw, 380px", crop=True, ratio=5/4)}</div>
<div class="n-txt"><p class="tag">Bientôt</p><h2 class="h2 small">Sentir {e(b["name"])}<br><span>avant d'acheter.</span></h2>
<p class="sub">On prépare des échantillons de 2 ml remplis à la main. Laisse ton e-mail : on te prévient le jour où celui-ci est disponible.</p>
{notify_form("fiche", b["name"] + " (" + o["name"] + ")")}</div></div></section>
<p class="wrap fine">Indice calculé par Olfamatch à partir de sources publiques, pas une mesure en laboratoire. Prix ramenés à 100 ml, relevés en octobre 2026 : ils peuvent avoir changé.</p>{sbar}'''
        page(f'alternative/{o["slug"]}/index.html', title + " | Olfamatch",
             f'L\'alternative la plus proche de {o["name"]} ({o["brand"]}) : {b["name"]} de {b["brand"]}, indice de ressemblance {b["index"]} %.' + (f' Jusqu\'à {b["saving"]} % moins cher.' if b["saving"] else ""), body, amb=c, cls="fiche",
             og=rs(o["image"], 1200) if o["image"] else None)
        urls.append(f'alternative/{o["slug"]}/')

    # ---------- quiz ----------
    famq = "".join(f'''<button class="qopt img" type="button" data-v="{k}" aria-pressed="false"><span class="qo-img">{img(media.get("fam_"+k), "", ws=(240, 400), sizes="(max-width:720px) 44vw, 200px", ratio=1)}</span><b>{FAM_LABEL[k]}</b><i>{t}</i></button>'''
                   for k, t in [("frais", "Agrumes, menthe, marin"), ("floral", "Jasmin, rose, fleurs blanches"), ("gourmand", "Vanille, caramel, sucré"), ("boise", "Bois, vétiver, musc"), ("ambre", "Ambre, épices, oud, cuir")])
    quizp = f'''<section class="wrap sec first quiz"><div class="qz-top"><p class="tag">Le quiz</p><h1 class="h1">Trouve ton parfum<span>.</span></h1><div class="qz-prog" aria-hidden="true"><i></i></div></div>
<div class="qstep" data-step="g"><h2 class="q">Il est pour qui ?</h2><div class="qopts"><button class="qopt" type="button" data-v="Femme">Pour elle</button><button class="qopt" type="button" data-v="Homme">Pour lui</button><button class="qopt" type="button" data-v="">Peu importe</button></div></div>
<div class="qstep" data-step="f" data-multi="2" hidden><h2 class="q">Ce que tu aimes sentir <small>(1 ou 2 choix)</small></h2><div class="qopts fam-opts">{famq}</div><button class="btn qnext" type="button" disabled>Continuer</button></div>
<div class="qstep" data-step="t" hidden><h2 class="q">Tu le portes plutôt…</h2><div class="qopts"><button class="qopt" type="button" data-v="jour">La journée, au travail</button><button class="qopt" type="button" data-v="soir">Le soir, pour sortir</button><button class="qopt" type="button" data-v="">Un peu tout le temps</button></div></div>
<div class="qstep" data-step="p" hidden><h2 class="q">Ton budget pour 100 ml ?</h2><div class="qopts"><button class="qopt" type="button" data-v="30">Moins de 30 €</button><button class="qopt" type="button" data-v="50">Moins de 50 €</button><button class="qopt" type="button" data-v="">Peu importe</button></div></div>
<div class="qres" hidden><h2 class="q">Tes alternatives<span>.</span></h2><p class="sub qres-sub"></p><div class="qcards"></div>
<div class="qres-end"><button class="btn ghost qrestart" type="button">Recommencer</button><a class="link" href="../annuaire/">Voir tout l'annuaire →</a></div></div>
<button class="qback" type="button" hidden>← Retour</button></section>'''
    page("quiz/index.html", "Quiz : trouve l'alternative à ton goût | Olfamatch",
         "Quatre questions sur ce que tu aimes sentir et ton budget, et Olfamatch te propose les alternatives qui te correspondent.", quizp, "quiz", cls="quizpage")

    # ---------- échantillons ----------
    picks = ["sauvage-dior", "aventus-creed", "baccarat-rouge-540-maison-francis-kurkdjian", "libre-yves-saint-laurent", "paradoxe-prada",
             "bleu-de-chanel-edp-chanel", "coco-mademoiselle-chanel", "j-adore-dior", "sauvage-elixir-dior", "black-opium-yves-saint-laurent",
             "yum-boujee-marshmallow-81-kayali", "vanilla-28-kayali", "lost-cherry-tom-ford", "dior-homme-intense-dior", "y-edp-yves-saint-laurent"]
    picks = [by[s] for s in picks if s in by]
    opts = "".join(f'<option value="{e(best(o)["name"])} ({e(o["name"])})">{e(o["name"])} → {e(best(o)["name"])}</option>' for o in sorted(data, key=lambda o: o["name"]))
    pick_html = "".join(card(o, "../") for o in picks)
    offers_html2 = "".join(f'<div class="offer"><p class="of-n">{n}</p><p class="of-s">{s}</p><p class="of-p">{p}</p><p class="of-t">{t}</p></div>' for n, s, p, t in offers)
    ech = f'''<section class="ech-hero"><div class="eh-media" aria-hidden="true">{img(media.get("sample_fill"), "", eager=True, ws=(1000, 1600), sizes="100vw", crop=False)}{video("v_fill", media.get("sample_fill"), eager=True)}</div>
<div class="wrap eh-copy"><p class="tag">Bientôt disponible</p><h1 class="h1">Sens-le avant<br><span>d'acheter.</span></h1>
<p class="lead">Des échantillons des alternatives les plus demandées, remplis à la main et envoyés chez toi. Tu essaies sur ta peau, tu gardes celui qui te plaît.</p></div></section>
<section class="wrap sec tight"><div class="offers big">{offers_html2}</div><p class="fine">Prix indicatifs de lancement, frais de port en plus.</p></section>
<section class="wrap sec tight steps reveal"><div><b>1</b><p>Tu choisis tes alternatives parmi les plus demandées.</p></div><div><b>2</b><p>On remplit tes fioles à la main, directement depuis le flacon de l'alternative.</p></div><div><b>3</b><p>Tu les reçois chez toi et tu testes sur plusieurs jours.</p></div></section>
<section class="wrap sec tight"><h2 class="h2 small">Les premiers au catalogue</h2><div class="pcards">{pick_html}</div></section>
<section class="wrap sec" id="prevenir"><div class="notify"><div class="n-img">{img(media.get("sample_box"), "Une box d'échantillons", ws=(500, 800), sizes="(max-width:720px) 92vw, 380px", ratio=5/4)}</div>
<div class="n-txt"><h2 class="h2 small">Préviens-moi<br><span>au lancement.</span></h2><p class="sub">Dis-nous quel parfum tu veux essayer en premier : les plus demandés arriveront d'abord.</p>
<form class="form" name="echantillon" data-kind="notify" novalidate>
<input type="hidden" name="source" value="page-echantillons"><p hidden><label>Ne pas remplir <input name="site"></label></p>
<label class="sel"><span>Le parfum que tu veux essayer</span><select name="parfum"><option value="">Choisis un parfum (facultatif)</option>{opts}</select></label>
<label class="sr" for="n-ech">Ton adresse e-mail</label>
<div class="field"><input id="n-ech" type="email" name="email" required placeholder="ton@email.fr" autocomplete="email"><button class="btn" type="submit">Me prévenir</button></div>
<small>Un e-mail au lancement, c'est tout.</small><p class="ok" hidden></p></form></div></div></section>'''
    page("echantillons/index.html", "Échantillons d'alternatives de parfum (bientôt) | Olfamatch",
         "Bientôt : des échantillons de 2 ml des alternatives les plus demandées, remplis à la main. Inscris-toi pour être prévenu du lancement.", ech, "ech", cls="echpage",
         og=rs(media["sample_box"], 1200) if media.get("sample_box") else None)

    # ---------- ma liste ----------
    liste = '''<section class="wrap sec first"><h1 class="h1">Ma liste<span>.</span></h1><p class="sub">Les parfums que tu as gardés avec le cœur. Ta liste reste sur ton téléphone ou ton ordinateur.</p>
<div class="rows" id="fav-list"></div><div class="fav-empty" hidden><p class="sub">Ta liste est vide pour l'instant. Touche le cœur sur la page d'un parfum pour le garder ici.</p><a class="btn" href="../annuaire/">Parcourir l'annuaire</a></div></section>'''
    page("ma-liste/index.html", "Ma liste | Olfamatch", "Les parfums que tu as gardés sur Olfamatch.", liste, "liste")

    # ---------- top 30 ----------
    t30o = []
    for o in data:
        if any(d["top30"] for d in o["dupes"]) and o not in t30o: t30o.append(o)
    grp = "".join(f'''<h2 class="h2 small t30h">{titre}</h2><div class="rows">{"".join(row(o, "../", i) for i, o in enumerate([x for x in t30o if x["level"].startswith(lvl)]))}</div>'''
                  for titre, lvl in [("Les grands classiques", "Top"), ("Les très demandés", "Demandé"), ("La niche", "Niche")] if any(x["level"].startswith(lvl) for x in t30o))
    top30 = f'''<section class="wrap sec first"><h1 class="h1">Le Top 30<span>.</span></h1>
<p class="sub">Les {len(t30o)} paires les plus sûres de l'annuaire : celles que le plus de comparatifs indépendants confirment. Clique sur une ligne pour voir la fiche complète.</p>
{grp}</section>'''
    page("top-30/index.html", "Top 30 des alternatives aux parfums de luxe | Olfamatch",
         "Les 30 alternatives les plus sûres aux parfums de luxe et de niche : grands classiques, parfums très demandés et niche, avec l'économie réalisée.", top30, "top30")

    apropos = f'''<section class="wrap sec first legal about"><p class="tag">Pourquoi Olfamatch</p><h1 class="h1">Le parfum qu'on aime,<br><span>sans le prix qui fait mal.</span></h1>
<p class="lead">Olfamatch est né d'une passion pour le parfum, et d'une frustration : les parfums qu'on a vraiment envie de porter coûtent souvent 150, 200, parfois 300 € le flacon.</p>
<p>En cherchant des alternatives moins chères, on tombe sur des dizaines de comparatifs, de vidéos et de forums. Ils ne disent pas tous la même chose, et on ne sait jamais à qui se fier.</p>
<p>Alors j'ai voulu tout rassembler au même endroit. Pour chaque parfum, je recoupe les comparatifs publiés, je ne garde que les alternatives que d'autres ont déjà rapprochées, et j'affiche d'où vient l'info. Quand plusieurs sources indépendantes sont d'accord, l'indice de ressemblance monte. Quand une seule en parle, il reste prudent.</p>
<p>Je ne prétends pas avoir senti chaque flacon. Mon travail, c'est de chercher, de recouper et de classer, pour que tu saches quoi aller sentir et combien tu peux économiser. Le dernier mot revient toujours à ton nez.</p>
<p>Olfamatch est un petit projet indépendant, en France. Il n'est lié à aucune marque. Le site est gratuit : il vit des petites commissions sur les liens d'achat, sans surcoût pour toi.</p>
<p>Une erreur, une alternative oubliée, un parfum que tu aimerais voir ici ? Écris-moi à <a href="mailto:{CONTACT}">{CONTACT}</a>. Je lis tout et je corrige.</p>
<p class="sign">— Le fondateur d'Olfamatch</p>
<div class="about-cta"><a class="btn" href="../annuaire/">Parcourir l'annuaire</a><a class="link" href="../quiz/">Faire le quiz →</a></div></section>'''
    page("pourquoi-olfamatch/index.html", "Pourquoi Olfamatch existe | Olfamatch",
         "Olfamatch rassemble les alternatives aux parfums de luxe que plusieurs comparatifs indépendants confirment. Un projet indépendant, gratuit, lié à aucune marque.", apropos)
    urls.append("pourquoi-olfamatch/")

    ml = f'''<section class="wrap sec first legal"><h1 class="h1">Mentions légales<span>.</span></h1>
<p><strong>Éditeur</strong><br>{e(CFG.get("editeur","Olfamatch"))}<br>Contact : <a href="mailto:olfamatch.contact@gmail.com">olfamatch.contact@gmail.com</a></p>
<p><strong>Hébergement</strong><br>Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis (service Cloudflare Pages).</p>
<p><strong>Liens affiliés</strong><br>Les boutons d'achat renvoient vers des boutiques partenaires. Olfamatch touche une commission sur les achats effectués via ces liens, sans surcoût pour toi. En tant que Partenaire Amazon, Olfamatch réalise un bénéfice sur les achats remplissant les conditions requises.</p>
<p><strong>Marques et visuels</strong><br>Les noms de parfums et de marques cités appartiennent à leurs propriétaires. Ils sont mentionnés uniquement pour identifier les produits comparés. Olfamatch n'est lié à aucune de ces marques. Les alternatives présentées sont des parfums distincts, proches dans leur style olfactif, et non des reproductions. Les photos de flacons et les vidéos sont des illustrations.</p>
<p><strong>Indice de ressemblance et accords</strong><br>L'indice est calculé par Olfamatch à partir du nombre de sources publiques indépendantes qui rapprochent deux parfums et des ingrédients publiés. Ce n'est pas une mesure en laboratoire. Les familles olfactives sont un classement établi par Olfamatch. Les barres d'accords, quand elles sont affichées, reprennent les accords principaux publiés par la communauté Fragrantica.</p>
<p><strong>Données personnelles</strong><br>L'adresse e-mail laissée pour être prévenu du lancement des échantillons sert uniquement à te prévenir de ce lancement et à t'envoyer les nouveautés d'Olfamatch. Tu peux te désinscrire à tout moment avec le lien présent dans chaque e-mail, ou en écrivant à l'adresse de contact. « Ma liste » est enregistrée uniquement dans ton navigateur. Le site ne dépose pas de cookie publicitaire.</p></section>'''
    page("mentions-legales/index.html", "Mentions légales | Olfamatch", "Mentions légales du site Olfamatch.", ml)
    urls.append("mentions-legales/")
    page("404.html", "Page introuvable | Olfamatch", "Cette page n'existe pas.",
         f'<section class="wrap sec first"><h1 class="h1">Cette page n\'existe pas<span>.</span></h1><p class="sub">Cherche directement ton parfum :</p>{search_box("/", "q404")}<p class="sub" style="margin-top:26px">Ou laisse-toi guider : <a href="/quiz/">fais le quiz</a>.</p></section>')
    (DIST / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(f"<url><loc>{SITE}/{u}</loc></url>" for u in urls) + "</urlset>")
    (DIST / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n")
    print(f"OK : {len(urls)} pages, {len(duo)} paires illustrées, {len(quiz)} parfums dans le quiz, accords pour {sum(1 for o in data if o['acc'])} originaux")

if __name__ == "__main__":
    build()
