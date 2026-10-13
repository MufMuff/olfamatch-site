"""Génère dist/top-30/olfamatch-top-30.pdf (liens vers les fiches du site, pas vers Amazon :
les règles Amazon interdisent leurs liens dans les documents hors ligne)."""
import json, html, subprocess, os
from pathlib import Path
ROOT = Path(__file__).parent
SITE = "https://olfamatch.netlify.app"
data = json.loads((ROOT / "data/parfums.json").read_text())
e = lambda s: html.escape(str(s or ""))
F = (ROOT / "src/assets/fonts").resolve().as_uri()

groups = [("Les grands classiques", "Top"), ("Les très demandés", "Demandé"), ("La niche", "Niche")]
def rows(prefix):
    out = ""
    for o in data:
        if not o["level"].startswith(prefix):
            continue
        for d in o["dupes"]:
            if not d["top30"]:
                continue
            price = f'<span class="p"><s>{round(o["price100"])} €</s> {round(d["price100"])} €</span>' if (o["price100"] and d["price100"]) else '<span class="p"></span>'
            save = f'−{d["saving"]} %' if d["saving"] else ""
            out += f'''<a class="r" href="{SITE}/alternative/{o["slug"]}/"><span class="o"><b>{e(o["name"])}</b><i>{e(o["brand"])}</i></span>
<span class="a"><b>{e(d["name"])}</b><i>{e(d["brand"])}</i></span><span class="i">{d["index"]} %</span>{price}<span class="s">{save}</span></a>'''
    return out

sec = lambda t, p: f'<h2>{t}</h2><div class="head"><span>Tu aimes</span><span>Essaie</span><span>Indice</span><span>Prix / 100 ml</span><span>Économie</span></div>{rows(p)}'
body1 = sec(*groups[0]) + '''<div class="how"><h2>Comment lire ce tableau</h2><p><b>Indice</b> : à quel point l'alternative est proche de l'original, d'après le nombre de comparatifs indépendants qui les rapprochent et les ingrédients qu'ils ont en commun.</p><p><b>Prix / 100 ml</b> : tous les prix sont ramenés à 100 ml pour comparer des flacons de tailles différentes.</p><p><b>Économie</b> : ce que tu gardes dans ta poche à quantité égale.</p></div>'''
body2 = sec(*groups[1]) + sec(*groups[2])
doc = f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
@font-face{{font-family:B;src:url("{F}/bodoni.woff2")}}
@font-face{{font-family:H;src:url("{F}/hanken-400.woff2");font-weight:400}}
@font-face{{font-family:H;src:url("{F}/hanken-600.woff2");font-weight:600}}
@page{{size:A4;margin:0}}
*{{box-sizing:border-box}}
body{{margin:0;background:#1C0E19;color:#F2E4D8;font-family:H;font-size:10.5pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.pg{{padding:13mm 15mm 10mm;height:297mm;overflow:hidden;break-after:page}} .pg:last-child{{break-after:auto}}
.logo{{font-family:B;font-size:20pt}} .logo b{{color:#C8A15A;font-weight:400}}
h1{{font-family:B;font-weight:400;font-size:30pt;line-height:1.05;margin:5mm 0 2mm}}
.lead{{color:#A8919B;margin:0 0 6mm;max-width:150mm}}
h2{{font-family:B;font-weight:400;font-size:17pt;margin:5mm 0 1.5mm;color:#E2C68E}}
.head,.r{{display:grid;grid-template-columns:57mm 60mm 13mm 27mm 15mm;gap:3mm;align-items:center}}
.head{{color:#A8919B;font-size:8.5pt;padding:1mm 0;border-bottom:.3mm solid #4A2A41}}
.r{{padding:1mm 0;border-bottom:.3mm solid #4A2A41;text-decoration:none;color:inherit;break-inside:avoid}}
.r b{{font-family:B;font-weight:400;font-size:12pt;display:block;line-height:1.1}}
.r i{{font-style:normal;color:#A8919B;font-size:8.5pt}}
.a b{{color:#E2C68E}}
.i{{color:#E2C68E}} .p s{{color:#A8919B}} .s{{font-weight:600;color:#C8A15A}}
.how p{{color:#A8919B;margin:0 0 2mm;max-width:160mm}} .how b{{color:#F2E4D8;font-weight:600}}
.foot{{color:#A8919B;font-size:8pt;margin-top:7mm;line-height:1.45}}
</style></head><body><div class="pg"><div class="logo">olfa<b>match</b></div>
<h1>Le Top 30 des alternatives</h1>
<p class="lead">Les 30 paires les plus sûres de l'annuaire Olfamatch. Clique sur une ligne pour voir la fiche complète et où l'acheter au meilleur prix.</p>
{body1}<p class="foot">Indice calculé par Olfamatch à partir de sources publiques, pas une mesure en laboratoire. Une alternative reste un autre parfum : proche, pas identique. Prix ramenés à 100 ml, relevés en octobre 2026.<br>
Les noms de parfums et de marques appartiennent à leurs propriétaires et sont cités uniquement pour identifier les produits comparés. Annuaire complet : olfamatch.netlify.app</p></div><div class="pg" style="padding-top:9mm">{body2}
</div></body></html>'''
tmp = ROOT / "build_pdf.html"
tmp.write_text(doc)
out = ROOT / "dist/top-30/olfamatch-top-30.pdf"
js = f'''const {{chromium}}=require('playwright');(async()=>{{const b=await chromium.launch();const p=await b.newPage();
await p.goto('{tmp.resolve().as_uri()}');await p.waitForTimeout(500);await p.pdf({{path:'{out}',format:'A4',printBackground:true,preferCSSPageSize:true}});await b.close();}})();'''
env = dict(os.environ, NODE_PATH=subprocess.check_output(["npm", "root", "-g"]).decode().strip())
subprocess.run(["node", "-e", js], check=True, env=env)
tmp.unlink()
print("PDF :", out)
