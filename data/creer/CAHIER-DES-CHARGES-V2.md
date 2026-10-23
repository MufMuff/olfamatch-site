# Cahier des charges V2 — « Crée ton parfum » (Olfamatch)

Version du 23/10/2026. Remplace le cahier des charges V1 pour tout ce qui suit.
Destinataire : Claude Code (développement). Le propriétaire du projet, Ethan, n'est pas développeur : tout message qui lui est destiné doit être en français simple, sans jargon.

---

## 0. Consignes pour Claude Code (à lire en premier)

### Point de départ
- Travailler sur la branche **`creer-ton-parfum-v2`** (créée depuis `creer-ton-parfum`). Elle contient la V1 et les 9 corrections du 23/10 (107 tests, `node --test`).
- **Ne jamais toucher `main`.** L'outil reste caché (`boutique.json` → `publie: false`) et la vente bloquée (nouvel interrupteur `vente_active: false`) jusqu'à ce qu'Ethan ait son rapport de sécurité et sa notification CPNP.
- Travailler en autonomie, étape par étape (§ B17). Ne s'arrêter pour poser une question que si une décision ne peut pas être prise avec ce document. À la fin de chaque étape : lancer tous les tests, envoyer la branche sur GitHub, écrire un résumé de 5 lignes en français simple.

### Ce qu'on garde de la V1
- La structure du site et du build (`build.py`, pages générées, `src/creer/`, `data/creer/`, `worker/`).
- Le calcul en grammes **avec `dilution_stock`** (prédilution) : les notes très puissantes ou à petite dose (PAT, OUD, CUI déjà en V1, plus CAN, GIR, MEN, GAL, SAF, MAR, CON en V2) sont stockées prédiluées à 10 % dans l'alcool pour pouvoir être pesées avec une balance à 0,01 g.
- La page privée de fabrication et la fiche de pesée.
- Le kit d'échantillons V1 : 3 variantes de 2 ml de la formule du client (« Plus fraîche », « Standard », « Plus intense »), préparées à partir de mini-lots de 10 ml (`regles.json` → `kit`).
- Les protections ajoutées le 23/10 : anti-doublon des paiements (KV, 60 jours), description par IA en cache 30 jours par formule, 5 demandes par minute et par IP, plafond par jour, 300 jetons maximum, modèle Claude Haiku 5.5 par défaut, `SITE_ORIGINS`, note détestée exclue en mode guidé, notes manquantes proposées en un clic en mode expert.
- Le schéma des notes V1 (clé en minuscules + champ `code` à 3 lettres, `etage`, `puissance`, `tenue_h`, `dose_min`, `dose_max`, `dilution_stock`, `cout_g`, `stock_g`, `actif`, `texte`). Les identifiants à 3 lettres de ce document correspondent au champ `code`. On **ajoute** les champs V2 (§ B2).

### Ce qu'on remplace
- 18 notes → 58 notes en 3 vagues (§ B3).
- `compatibilite.json` (paires) → moteur d'harmonie par sous-familles, facettes et 100 exceptions (§ B4).
- 10 recettes provisoires → 12 structures et 36 recettes (§ B6, B7).
- 2 modes (guidé, expert) → 5 portes d'entrée (§ B8). Le mode guidé V1 devient la base de la porte P3 (quiz) et le mode expert V1 la base de P5.
- Liens de paiement Stripe → sessions Stripe Checkout créées par le worker, avec prix recalculé côté serveur (§ B12).
- Les certificats IFRA et allergènes ne sont plus rangés dans chaque note mais dans les **lots fournisseurs** (`matieres_lots.json`, § B2).

### Migration
La V1 n'a jamais été vendue : aucun ancien code de formule à garder compatible. Le nouveau format de code (§ B11) remplace l'ancien.

### Valeurs provisoires
Tous les chiffres de ce document (puissance, ténacité, dose max, matrice, facettes, exceptions, recettes, prix) sont des **valeurs de départ**. Ils doivent tous vivre dans des fichiers JSON (jamais écrits en dur dans le code), avec un champ `_aide` en français simple, pour qu'Ethan les ajuste après ses essais. Les limites de sécurité, elles, ne sont jamais assouplies par le code.

### Mots interdits (correction importante)
Ne pas filtrer le mot « comme » seul : il est partout en français. Ce qui est interdit, ce sont les **tournures de ressemblance** avec un parfum ou une marque :
- toujours interdits : « dupe », « copie », « réplique », « imitation », « contretype », « clone » ;
- interdits à côté d'un nom de parfum ou de marque (liste des 442 parfums et de leurs marques, `data/parfums.json`) : « inspiré(e) de », « identique à », « comme », « sent comme », « version de », « équivalent de », « alternative à » (pour l'outil de création uniquement).
Un test doit échouer si une de ces tournures apparaît dans un texte affiché, une sortie de l'IA, un e-mail, une étiquette ou les données envoyées à Stripe.

---

## PARTIE A — Résumé du projet (contexte)

**Ce que fait la V2.** Le client compose son eau de parfum à partir de 58 notes (dont beaucoup d'accords tout faits : ambre, cuir, oud, musc blanc…). Le moteur vérifie deux choses séparément : *est-ce que ça sent juste ?* (score d'harmonie sur 100) et *est-ce que c'est autorisé ?* (limites IFRA, allergènes, bornes du dossier de sécurité). Une formule non autorisée ne peut jamais être payée. Ethan mélange ensuite le parfum à la main (huiles achetées en vrac, 15 à 20 % dans l'alcool).

**Prix (provisoires, dans `boutique.json`)** : kit 10 €, 50 ml 32 €, 100 ml 48 € (plafond voulu : 50 €).

**Ce qui bloque la vente, hors code** :
1. Un évaluateur de sécurité doit signer un rapport couvrant un **cadre** de formules (liste fermée de notes, maximum par note, concentration de 15 à 20 %).
2. Les fournisseurs doivent fournir pour chaque huile : fiche de données de sécurité (16 rubriques), certificat IFRA 51e amendement avec le maximum en catégorie 4, liste des allergènes, certificat d'analyse avec densité.
3. Il faut un transporteur qui accepte les parfums en « quantités limitées » : La Poste et Colissimo les interdisent.

D'où l'interrupteur `vente_active`, qui reste à `false` tant que ces trois points ne sont pas réglés.

---

## PARTIE B — Spécification technique

### B1. Architecture

- Site statique Cloudflare Pages (dépôt `MufMuff/olfamatch-site`). Livrer sur `creer-ton-parfum-v2`. Fusion dans `main` seulement quand Ethan le demande.
- Worker Cloudflare (dossier `worker/`) : routes `/api/formule`, `/api/checkout`, `/api/webhook-stripe`, `/api/ia/comprendre`, `/api/ia/expliquer`, `/api/fabrication/*`.
- Stockage : Cloudflare D1, tables `formules`, `commandes`, `evenements_stripe`, `lots`, `stocks`. Garder KV pour le cache IA et la limitation des appels.
- **Le moteur (harmonie + sécurité) est un seul module JavaScript partagé**, exécuté dans le navigateur pour l'affichage et **ré-exécuté dans le worker** pour décider. Seul le résultat du worker fait foi.
- Page de fabrication et routes `/api/fabrication/*` protégées par Cloudflare Access (compte d'Ethan uniquement). Documenter dans `worker/LISEZMOI.md` comment l'activer.

### B2. Fichiers de données (`data/creer/`)

| Fichier | Contenu |
|---|---|
| `notes.json` | les 58 notes (schéma V1 + champs V2 ci-dessous) |
| `facettes.json` | 22 facettes + table d'affinités |
| `matrice_sf.json` | matrice 15 × 15 des sous-familles |
| `exceptions.json` | 100 exceptions de paires `{id, a, b, valeur, raison}` |
| `structures.json` | 12 structures (pyramide, notes obligatoires et optionnelles, tolérance) |
| `recettes.json` | 36 recettes (structure, vague, notes en %, statut `a_valider` ou `validee`) |
| `ifra_cat4.json` | limites IFRA catégorie 4 par substance, avec la version d'amendement |
| `allergenes.json` | allergènes de l'Annexe III du règlement 1223/2009, modifiée par le règlement (UE) 2023/1545, avec leurs seuils |
| `matieres_lots.json` | composition réelle de chaque lot fournisseur (allergènes %, substances IFRA %, maximum catégorie 4, densité, 4 documents) |
| `cadre_securite.json` | bornes signées par l'évaluateur (version, date, signataire) — vide tant qu'il n'y a pas de rapport |
| `notes_publiees.json` | notes publiées des parfums de marque, pour la porte P1 (voir § B8) |
| `correspondances.json` | correspondance nom de note publiée → code de note Olfamatch (ex. « ambroxan » → AMX, « orange blossom » → FLO) |
| `boutique.json` | prix par format (existant), + `vente_active` |
| `config/features.json` | `inspiration_nommee`, `vagues_actives`, `ia_active` |

Champs V2 ajoutés à chaque note :
```json
{
  "code": "TON", "nom": "Fève tonka", "type": "accord|matiere",
  "vague": 1, "sous_famille": "gour",
  "facettes": {"gourmand": 1.0, "poudre": 0.5, "ambre": 0.3},
  "etage": "fond", "puissance": 3, "tenacite": 4,
  "dose_max": 20, "lot_actif": "TON-2026-01",
  "prix_classe": "A", "dispo_chine": "tres_courante"
}
```
Le champ `famille` de la V1 (frais, floral, gourmand, boisé, ambré, cuir, neutre) est conservé pour l'affichage. Il se déduit de la sous-famille (§ B4).

Un lot (`matieres_lots.json`) contient : `lot`, `code_note`, `fournisseur`, `densite_g_ml`, `ifra_amendement`, `ifra_cat4_max_pct_produit`, `substances_ifra_pct`, `allergenes_pct`, `docs: {fds, ifra, coa, allergenes}`, `date_docs`.
**Règle : une note sans lot actif avec ses 4 documents à `true` est invisible et inutilisable.** En développement, un drapeau `mode_demo: true` dans `config/features.json` permet de tout afficher avec des lots fictifs clairement marqués `DEMO`. Ce drapeau doit bloquer la vente.

### B3. Les 58 notes

Classes de prix (annonces Alibaba « fragrance oil », à confirmer par devis) : **A** = 8–20 $/kg, **B** = 20–35 $/kg, **C** = 35–60 $/kg. Toutes ces notes sont couramment proposées par les fabricants du Guangdong, sauf GAL et GAI (moins courantes).
P = puissance, T = ténacité (de 1 à 5). « Max % » = `dose_max`, maximum dans le concentré pour l'harmonie. La limite de sécurité est calculée à part (§ B5). « cert. » = c'est le certificat IFRA du lot qui fixe la limite. Les allergènes indiqués sont typiques ; la vérité vient toujours du document du lot.
Codes de sous-famille (minuscules, 4 lettres, pour ne pas se confondre avec les codes de notes) : voir § B4.

| Code | Nom client | V | SF | Facettes | Étage | P | T | Max % | IFRA / contrainte | Allergènes typiques | Prix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BER | Bergamote | 1 | hesp | hespéridé, vert | tête | 3 | 1 | 35 | FCF obligatoire (huile exprimée ≤ 0,4 % du produit fini) | limonene, linalool, citral | A |
| CIT | Citron | 1 | hesp | hespéridé, vert | tête | 3 | 1 | 25 | citral 0,6 % ; distillé ou FCF | limonene, citral | A |
| MAN | Mandarine | 1 | hesp | hespéridé, fruité | tête | 2 | 1 | 25 | cert. (furocoumarines) | limonene, linalool | A |
| PAM | Pamplemousse | 1 | hesp | hespéridé, amer | tête | 3 | 1 | 25 | cert. | limonene | A |
| LAV | Lavande | 1 | arom | aromatique, floral | tête/cœur | 3 | 2 | 30 | cert. | linalool, coumarin, extrait de lavande | A |
| MAR | Accord marin | 1 | aqua | aquatique, ozonique | tête | 5 | 3 | 12 | cert. | variable | A |
| POI | Poivre rose | 1 | epfr | épicé frais | tête | 4 | 2 | 10 | cert. | limonene | B |
| ROS | Accord rose | 1 | flro | floral rosé | cœur | 3 | 3 | 35 | géraniol 4,7 % ; eugénol 2,5 % | geraniol, citronellol, eugenol | A |
| JAS | Accord jasmin | 1 | flbl | floral blanc, solaire | cœur | 4 | 3 | 35 | cert. | linalool, benzyl benzoate | A |
| CED | Cèdre | 1 | bois | boisé sec | fond | 2 | 4 | 30 | cert. | — | A |
| SAN | Accord santal | 1 | bois | boisé crémeux | fond | 2 | 5 | 30 | cert. | variable | B |
| VET | Vétiver | 1 | bois | boisé sec, fumé | fond | 4 | 5 | 25 | cert. | — | B |
| PAT | Patchouli | 1 | bois | boisé, terreux | fond | 4 | 5 | 25 | cert. | — | A |
| CAC | Bois ambrés | 1 | bois | boisé sec, ambré | fond | 4 | 5 | 25 | cert. | — | A |
| OUD | Accord oud | 1 | ambr | animal, boisé, fumé | fond | 5 | 5 | 25 | cert. | variable | B |
| AMB | Accord ambre | 1 | ambr | ambré, balsamique | fond | 3 | 5 | 35 | cert. (souvent coumarine, vanilline) | coumarin, benzyl benzoate | A |
| CUI | Accord cuir | 1 | cuir | cuir, fumé, animal | fond | 5 | 5 | 30 | cert. | variable | B |
| MUS | Musc blanc | 1 | musq | musqué, propre | fond | 2 | 5 | 45 | cert. | — | A |
| VAN | Vanille | 1 | gour | gourmand, balsamique | fond | 3 | 5 | 35 | cert. | benzyl benzoate (selon base) | A |
| TON | Fève tonka | 1 | gour | gourmand, poudré | fond | 3 | 5 | 20 | coumarine 1,5 % | coumarin | A |
| NER | Néroli | 2 | hesp | hespéridé, floral blanc | tête | 3 | 2 | 25 | cert. | linalool, limonene, farnesol | B |
| PET | Petitgrain | 2 | hesp | hespéridé, vert, boisé | tête | 3 | 2 | 20 | cert. | linalool, geraniol | A |
| ROM | Romarin | 2 | arom | aromatique, camphré | tête | 4 | 1 | 10 | cert. | limonene, linalool | A |
| SAU | Sauge sclarée | 2 | arom | aromatique, ambré | tête/cœur | 3 | 2 | 10 | cert. | linalool | B |
| THE | Accord thé vert | 2 | vert | vert, aromatique | tête/cœur | 2 | 2 | 20 | cert. | linalool | A |
| FIG | Accord figue | 2 | vert | vert, lacté, fruité | cœur | 3 | 3 | 20 | cert. | variable | A |
| GIN | Gingembre | 2 | epfr | épicé frais, hespéridé | tête | 4 | 2 | 8 | cert. | citral, limonene | B |
| CAR | Cardamome | 2 | epfr | épicé frais, aromatique | tête | 4 | 2 | 8 | cert. | linalool, limonene | B |
| POM | Accord pomme-poire | 2 | frui | fruité, vert | tête | 4 | 2 | 10 | cert. | variable | A |
| FRB | Accord fruits rouges | 2 | frui | fruité, gourmand | tête/cœur | 4 | 2 | 12 | cert. | variable | A |
| YLA | Ylang-ylang | 2 | flbl | floral blanc, solaire | cœur | 4 | 3 | 12 | isoeugénol 0,11 % ; benzyl salicylate 7,3 % | benzyl salicylate, isoeugenol, farnesol | B |
| IRI | Accord iris | 2 | poud | poudré, boisé | cœur | 3 | 4 | 25 | méthyl ionone 30 % (tous isomères cumulés) | alpha-isomethyl ionone | C |
| VIO | Accord violette | 2 | poud | poudré, vert | cœur | 3 | 3 | 20 | méthyl 2-octynoate 0,047 % | alpha-isomethyl ionone | B |
| GER | Géranium | 2 | flro | floral rosé, aromatique | cœur | 4 | 3 | 12 | géraniol 4,7 % ; citral 0,6 % | geraniol, citronellol, citral | A |
| SAF | Accord safran | 2 | epch | épicé chaud, cuir | cœur | 5 | 4 | 6 | cert. | variable | C |
| ENC | Encens | 2 | ambr | résineux, fumé | fond | 4 | 4 | 15 | cert. | limonene | B |
| BEN | Benjoin | 2 | ambr | balsamique, vanillé | fond | 2 | 5 | 20 | cert. | benzyl benzoate, benzyl alcohol | B |
| LAB | Labdanum | 2 | ambr | ambré, cuir, résineux | fond | 4 | 5 | 15 | cert. | variable | B |
| MOU | Accord mousse de chêne | 2 | bois | moussu, chypré | fond | 4 | 5 | 8 | mousse de chêne 0,1 % ; atranol < 100 ppm | extrait d'Evernia prunastri | B |
| AMX | Accord ambre gris | 2 | ambr | ambré, minéral, musqué | fond | 4 | 5 | 20 | cert. | — | B |
| PRA | Accord praliné-caramel | 2 | gour | gourmand | fond | 4 | 4 | 20 | cert. | variable | A |
| ORA | Orange douce | 3 | hesp | hespéridé, fruité | tête | 2 | 1 | 25 | cert. | limonene | A |
| YUZ | Accord yuzu | 3 | hesp | hespéridé, vert | tête | 3 | 1 | 20 | cert. | limonene, citral | B |
| MEN | Menthe | 3 | arom | aromatique, frais | tête | 5 | 1 | 4 | cert. | limonene | A |
| BAS | Basilic | 3 | arom | aromatique, vert | tête | 4 | 1 | 5 | méthyleugénol : cert. obligatoire | linalool | B |
| GAL | Accord galbanum | 3 | vert | vert, amer | tête | 5 | 2 | 5 | cert. | variable | B |
| CON | Accord concombre-melon | 3 | aqua | aquatique, vert | tête | 5 | 1 | 6 | méthyl 2-octynoate 0,047 % | variable | A |
| PEC | Accord pêche | 3 | frui | fruité, lacté | cœur | 3 | 3 | 12 | cert. | variable | A |
| CAS | Accord cassis | 3 | frui | fruité, vert | tête | 4 | 2 | 8 | cert. | variable | B |
| TUB | Accord tubéreuse | 3 | flbl | floral blanc, crémeux | cœur | 5 | 4 | 25 | cert. | benzyl salicylate | B |
| FLO | Fleur d'oranger | 3 | flbl | floral blanc, miellé | cœur | 4 | 3 | 20 | cert. | linalool, farnesol | B |
| MUG | Accord muguet | 3 | flbl | floral frais, vert | cœur | 3 | 3 | 15 | hydroxycitronellal 2,1 % | hydroxycitronellal, citronellol | A |
| PIV | Accord pivoine | 3 | flro | floral rosé, fruité | cœur | 3 | 2 | 20 | cert. | geraniol, citronellol | A |
| CAN | Accord cannelle | 3 | epch | épicé chaud | cœur | 5 | 3 | 3 | cinnamal 0,25 % | cinnamal, eugenol | A |
| GIR | Accord clou de girofle | 3 | epch | épicé chaud | cœur | 5 | 3 | 4 | eugénol 2,5 % ; isoeugénol 0,11 % | eugenol, isoeugenol | A |
| TAB | Accord tabac-miel | 3 | ambr | ambré, gourmand, fumé | fond | 4 | 5 | 15 | cert. | coumarin | B |
| GAI | Accord bois fumé (gaïac) | 3 | bois | boisé sec, fumé | fond | 4 | 5 | 12 | cert. | — | B |
| CAF | Accord café | 3 | gour | gourmand, torréfié | cœur/fond | 5 | 4 | 15 | cert. | variable | B |

Notes V1 déplacées : IRI passe en vague 2 et FLO en vague 3 (matières plus chères ou moins urgentes).

Limites IFRA citées (en % du produit fini, catégorie 4, standards IFRA) : citral 0,6 % ; coumarine 1,5 % ; eugénol 2,5 % ; isoeugénol 0,11 % ; cinnamal 0,25 % ; hydroxycitronellal 2,1 % ; géraniol 4,7 % ; méthyl 2-octynoate 0,047 % ; mousse de chêne 0,1 % ; benzyl salicylate 7,3 % ; bergamote exprimée 0,4 % (bergaptène 15 ppm) ; méthyl ionone, tous isomères cumulés (dont alpha-isomethyl ionone, CAS 127-51-5), 30 % (IFRA_STD_063). C'est `allergenes.json`, et non ce tableau, qui décide de ce qui s'étiquette.

**Vagues.** Vague 1 = 20 notes : elle suffit pour 11 des 12 structures (la structure poudré/iris attend la vague 2). Vague 2 = 21 notes, vague 3 = 17 notes. `config/features.json` → `vagues_actives` décide des notes visibles ; chaque nouvelle vague exige une mise à jour du rapport de sécurité avant d'être activée.

### B4. Moteur d'harmonie

**Sous-familles** (codes minuscules) : `hesp` hespéridé, `arom` aromatique, `vert` vert, `aqua` aquatique, `frui` fruité, `epfr` épicé frais, `epch` épicé chaud, `flro` floral rosé, `flbl` floral blanc, `poud` poudré, `bois` boisé (dont moussu), `ambr` ambré/résineux/oud, `gour` gourmand, `cuir` cuir/animal, `musq` musqué.
Inspiration : roue de Michael Edwards et classification de la Société Française des Parfumeurs.
Familles maison (affichage) : frais = hesp, arom, vert, aqua, epfr ; floral = flro, flbl, poud, frui ; gourmand = gour ; boisé = bois, cuir ; ambré = ambr, epch, musq. Le musc blanc garde son statut V1 de note liante (« neutre »).

**Matrice M** (−2 = se heurtent, +2 = s'accordent très bien ; symétrique) :

| | hesp | arom | vert | aqua | frui | epfr | epch | flro | flbl | poud | bois | ambr | gour | cuir | musq |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| hesp | 2 | 2 | 2 | 2 | 1 | 2 | 0 | 1 | 1 | 0 | 1 | 0 | −1 | −1 | 2 |
| arom | 2 | 2 | 1 | 1 | 0 | 1 | 0 | 0 | −1 | 0 | 2 | 1 | −1 | 0 | 1 |
| vert | 2 | 1 | 2 | 1 | 1 | 1 | −1 | 1 | 1 | 1 | 1 | −1 | −2 | −1 | 1 |
| aqua | 2 | 1 | 1 | 2 | 1 | 1 | −2 | 0 | 0 | −1 | 1 | −1 | −2 | −2 | 2 |
| frui | 1 | 0 | 1 | 1 | 2 | 1 | 0 | 2 | 1 | 1 | 0 | 0 | 2 | −1 | 1 |
| epfr | 2 | 1 | 1 | 1 | 1 | 2 | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 1 | 1 |
| epch | 0 | 0 | −1 | −2 | 0 | 1 | 2 | 1 | 0 | 0 | 1 | 2 | 2 | 1 | 0 |
| flro | 1 | 0 | 1 | 0 | 2 | 1 | 1 | 2 | 1 | 2 | 1 | 1 | 1 | 1 | 2 |
| flbl | 1 | −1 | 1 | 0 | 1 | 0 | 0 | 1 | 2 | 1 | 1 | 1 | 1 | 0 | 2 |
| poud | 0 | 0 | 1 | −1 | 1 | 0 | 0 | 2 | 1 | 2 | 1 | 1 | 1 | 1 | 2 |
| bois | 1 | 2 | 1 | 1 | 0 | 2 | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 2 | 2 |
| ambr | 0 | 1 | −1 | −1 | 0 | 1 | 2 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 1 |
| gour | −1 | −1 | −2 | −2 | 2 | 0 | 2 | 1 | 1 | 1 | 1 | 2 | 2 | 0 | 1 |
| cuir | −1 | 0 | −1 | −2 | −1 | 1 | 1 | 1 | 0 | 1 | 2 | 2 | 0 | 2 | 1 |
| musq | 2 | 1 | 1 | 2 | 1 | 1 | 0 | 2 | 2 | 2 | 2 | 1 | 1 | 1 | 2 |

Un test vérifie que la matrice est symétrique.

**Facettes (22)** : hespéridé, aromatique, vert, aquatique, ozonique, fruité, épicé_frais, épicé_chaud, floral_blanc, floral_rosé, poudré, boisé_sec, boisé_crémeux, moussu, résineux, ambré, balsamique, gourmand, animal, cuir, fumé, musqué.
Table d'affinités F(a,b) entre −1 et +1, à 0 par défaut. Valeurs imposées :
- **+1** : hespéridé–aromatique, hespéridé–musqué, vert–hespéridé, poudré–musqué, poudré–floral_rosé, boisé_crémeux–floral_blanc, ambré–balsamique, ambré–résineux, cuir–fumé, cuir–animal, gourmand–balsamique, moussu–floral_rosé, épicé_chaud–ambré.
- **−1** : aquatique–gourmand, ozonique–animal, ozonique–épicé_chaud, vert–gourmand, aromatique–floral_blanc (menthe et indole), fumé–fruité, animal–fruité.

**Calcul** (p_i = part de la note i dans le concentré, entre 0 et 1) :
1. Poids d'une paire : w_ij = p_i·p_j / Σ_{k<l} p_k·p_l.
2. Valeur d'une paire : V_ij = exception(i,j) si elle existe, sinon M[sf_i][sf_j].
3. S_sf = Σ w_ij · V_ij / 2 (entre −1 et +1).
4. S_fac = borné à [−1, 1] de Σ w_ij · Σ_{a,b} F(a,b) · f_i(a) · f_j(b), où f(a) est l'intensité de la facette a dans la note.
5. S_pyr : D = (|t−T| + |c−C| + |f−F|) / 2, en points de %, par rapport à la pyramide de la structure la plus proche ; S_pyr = max(−1, 1 − D/20).
6. Pénalités : −5 par note au-dessus de sa `dose_max` ; −5 si une note de puissance 5 dépasse 15 % ; −10 au-delà de 12 notes ; −10 en dessous de 3 notes.
7. **H = borné à [0, 100] de 50 + 25·S_sf + 15·S_fac + 10·S_pyr − pénalités.**

Les poids (25, 15, 10), les pénalités et les seuils sont dans `regles.json`, pas dans le code.

**Seuils.**
- H ≥ 70 : **Bon**.
- 55 ≤ H < 70 : **Risqué**. Commande possible, avec un avertissement et le kit recommandé.
- H < 55 : **Déconseillé**. Commande bloquée dans les portes P1 à P4 ; en mode expert (P5), possible après une case « je comprends ».
- Règle dure : une paire avec V = −2 où les deux notes pèsent chacune au moins 8 % rend la formule « Déconseillé ».

L'harmonie ne contourne **jamais** la sécurité. Test obligatoire : les 36 recettes obtiennent H ≥ 70. Sinon, recalibrer les poids, pas les recettes.

**Les 100 exceptions** (la valeur remplace M pour la paire). Valeurs de départ tirées de la pratique de parfumerie classique (accords chypre, fougère, rose-oud…), à confirmer par les essais d'Ethan.

*Paires favorables :*
E001 ROS×OUD +2 (rose-oud classique) ; E002 BER×PAT +2 (squelette du chypre) ; E003 BER×MOU +2 (chypre) ; E004 LAV×TON +2 (cœur de la fougère) ; E005 LAV×VAN +1 (fougère ambrée) ; E006 LAV×AMB +1 (fougère orientale) ; E007 GER×TON +1 (fougère) ; E008 CIT×VAN +1 (agrume confit) ; E009 MAN×VAN +2 (hespéridé gourmand) ; E010 BER×VAN +2 (tête classique des ambrés) ; E011 ORA×CAN +2 (agrume épicé) ; E012 ORA×GIR +1 (pomander) ; E013 BER×CUI +1 (cuir « propre ») ; E014 BER×BEN +1 (ouverture d'ambré) ; E015 PAM×VET +2 (boisé frais) ; E016 PAM×CAS +2 (agrume-bourgeon) ; E017 MAR×SAU +2 (sauge marine) ; E018 MAR×AMX +2 (ambré minéral) ; E019 MAR×CAC +2 (base de l'aquatique moderne) ; E020 MAR×FIG +2 (vert aquatique) ; E021 FIG×SAN +2 (figue lactée) ; E022 THE×JAS +2 (thé-jasmin) ; E023 THE×MUS +2 (transparence) ; E024 GAL×IRI +2 (iris vert) ; E025 GAL×CUI +1 (cuir vert) ; E026 VIO×CUI +2 (cuir daim) ; E027 IRI×CUI +2 (cuir daim) ; E028 SAF×CUI +2 (cuir safrané) ; E029 SAF×ROS +2 (rose orientale) ; E030 SAF×FRB +1 (framboise-safran) ; E031 FRB×PAT +2 (patchouli fruité) ; E032 PEC×MOU +2 (chypre fruité) ; E033 PEC×JAS +2 (floral lactonique) ; E034 CAS×VET +1 (vert boisé) ; E035 POM×CAN +2 (gourmand épicé) ; E036 POM×MUS +2 (fruité propre) ; E037 POI×ROS +2 (rose épicée) ; E038 GIN×VAN +1 (pain d'épices) ; E039 CAR×CAF +2 (café cardamome) ; E040 CAR×IRI +1 (iris épicé frais) ; E041 GIR×ROS +2 (facette œillet) ; E042 GIR×YLA +1 (facette épicée de l'ylang) ; E043 TUB×CUI +1 (floral animal) ; E044 JAS×CUI +1 (indole et animal) ; E045 YLA×SAN +2 (floral crémeux) ; E046 NER×ENC +1 (cologne résineuse) ; E047 ENC×IRI +2 (encens poudré) ; E048 ENC×THE +1 (thé fumé) ; E049 OUD×BER +1 (ouverture de l'oud) ; E050 PAT×PRA +2 (gourmand patchouli) ; E051 PAT×VAN +2 (ambré boisé) ; E052 CED×VIO +2 (cèdre-ionones) ; E053 SAN×ROS +2 (rose boisée) ; E054 SAN×IRI +2 (poudré boisé) ; E055 GAI×ROS +2 (rose fumée) ; E056 CAF×PAT +2 (gourmand sombre) ; E057 PRA×FLO +2 (floral gourmand) ; E058 VAN×JAS +2 (floral solaire) ; E059 TON×IRI +2 (poudré gourmand) ; E060 AMX×BER +2 (frais ambré moderne).

*Paires défavorables :*
E061 MEN×ROS −1 (effet dentifrice) ; E062 MEN×JAS −2 (menthe + indole) ; E063 MEN×YLA −2 (idem) ; E064 MEN×CAN −2 (chewing-gum) ; E065 GIR×MEN −2 (cabinet dentaire) ; E066 GIR×LAV −1 (médicinal) ; E067 CAN×JAS −1 (écrase le floral) ; E068 CAN×TUB −1 (saturation) ; E069 CAF×CIT −2 (amer et acide) ; E070 CAF×PAM −2 (idem) ; E071 PRA×VET −1 (terreux sucré) ; E072 PRA×CUI −1 (sucre + goudron) ; E073 PRA×OUD −1 (sucre + médicinal) ; E074 OUD×CON −2 (contresens) ; E075 OUD×MEN −2 (médicinal) ; E076 OUD×TUB −1 (deux notes envahissantes) ; E077 TUB×MAR −1 (écrase l'ozonique) ; E078 MUG×CUI −1 (contresens) ; E079 MUG×OUD −1 (idem) ; E080 MUG×CAF −2 (idem) ; E081 PIV×OUD −1 (fraîcheur noyée) ; E082 CON×PAT −2 (moisi) ; E083 CON×ENC −2 (contresens) ; E084 CON×ROS −1 (tourne « salade ») ; E085 MAR×PAT −1 (terreux humide) ; E086 MAR×ENC −2 (contresens) ; E087 LAV×FRB −1 (lessive sucrée) ; E088 LAV×TUB −2 (conflit) ; E089 ROM×FRB −1 (contresens) ; E090 BAS×VAN −2 (contresens) ; E091 BAS×CUI −1 (contresens) ; E092 GER×MAR −1 (métallique) ; E093 POM×OUD −2 (shampoing médicinal) ; E094 PEC×OUD −1 (idem) ; E095 FRB×VET −1 (terreux sucré) ; E096 GAI×MAR −1 (fumé + ozone) ; E097 MOU×MAR −1 (humide) ; E098 MOU×PRA −1 (contresens) ; E099 BEN×CON −2 (contresens) ; E100 CAS×CAF −1 (aigre).

Les associations interdites et délicates de la V1 (`regles.json` → `associations_interdites`, `matrice.reduire`) sont reprises comme exceptions quand elles ne sont pas déjà couvertes.

### B5. Sécurité et dosage (le moteur à règles décide seul)

Notations : c = concentration du concentré dans le produit fini (0,15 à 0,20) ; p_i = part de la note i dans le concentré ; w_{s,i} = part de la substance s dans le lot de la note i.

**Règles, toutes bloquantes :**
1. **Cadre évalué** : chaque note est dans la liste de `cadre_securite.json` ; p_i ≤ pmax_i (borne de l'évaluateur) ; c ∈ [cmin, cmax] du cadre (15–20 % par défaut) ; 3 à 12 notes. Tant que `cadre_securite.json` est vide, le moteur utilise `dose_max` et la vente reste bloquée.
2. **Limite IFRA de chaque huile** : p_i·c ≤ `ifra_cat4_max_pct_produit` du lot. Exemple : une huile limitée à 10 % en catégorie 4 ne dépasse pas 10/18 = 55 % du concentré à 18 %.
3. **Cumul de chaque substance IFRA** : Σ_i p_i·c·w_{s,i} ≤ L_s (`ifra_cat4.json`). Exemple tonka à 40 % de coumarine : 15 % de tonka dans le concentré à 20 % = 1,2 % (autorisé, limite 1,5 %) ; 25 % = 2,0 % (bloqué).
4. **Mousse de chêne** : en plus, atranol et chloroatranol < 100 ppm dans l'extrait (certificat).
5. **Bergamote** : seul un lot FCF est accepté ; sinon p·c ≤ 0,4 %.
6. **Allergènes** : a = Σ_i p_i·c·w_{a,i}. À étiqueter si a > 0,001 % (produit non rincé). À c = 18 %, un allergène présent à plus de 0,0056 % du concentré s'étiquette, donc presque toujours.
7. **Cumul d'allergènes** : plafond fixé par l'évaluateur (`allergenes_total_max_pct` dans le cadre).
8. **Arrondi prudent** : utiliser la borne haute de toute fourchette déclarée par le fournisseur.
9. **Versionnage** : chaque formule enregistre `ifra_amendement` (51) et `cadre_version`. Le 52e amendement IFRA est attendu en janvier 2027 (application 11 mois après pour les nouvelles créations) : les tables doivent pouvoir changer sans toucher au code.
10. **Variantes du kit** : chaque variante (plus fraîche, standard, plus intense) passe aussi toutes ces règles.

Pourquoi ce cadre : l'ANSM exige que chaque mélange proposé ait une évaluation de sécurité, et a sanctionné des fabricants de cosmétiques personnalisables faute de dossier couvrant toutes les combinaisons. La méthode du cadre (palette fermée + maximum par matière + calcul au pire cas) répond à cette exigence ; elle sera validée par l'évaluateur d'Ethan.

### B6. Les 12 structures

Proportions tête / cœur / fond en % du concentré, tolérance ±10 points. « Obligatoires » : au moins une note de chaque groupe.

| Code | Structure | T/C/F | Obligatoires | Optionnelles | Vague |
|---|---|---|---|---|---|
| S1 | Hespéridé / cologne | 45/30/25 | BER ou CIT ; MUS | MAN, PAM, NER, PET, LAV, JAS, CED, YUZ | 1 |
| S2 | Fougère | 30/35/35 | LAV ; TON | BER, GER, SAU, MOU, PAT, VET, CED, CAR | 1 |
| S3 | Chypre | 25/35/40 | BER ; PAT ; ROS ou JAS | MOU, LAB, VET, FRB, PEC, AMB | 1 (néo-chypre), 2 (classique) |
| S4 | Ambré / oriental | 15/30/55 | AMB ; VAN ou BEN | TON, LAB, ENC, SAN, MAN, CAN, GIR | 1 |
| S5 | Floral solaire | 20/50/30 | JAS ou TUB ou YLA ; SAN | MAN, NER, FLO, VAN, MUS | 1 |
| S6 | Gourmand | 15/25/60 | VAN ; TON ou PRA ou CAF | PAT, FRB, MUS, AMB, CAR | 1 |
| S7 | Boisé aromatique | 30/25/45 | CED ou VET ; LAV ou SAU ou ROM | BER, PAM, POI, GIN, GAI, CAC | 1 |
| S8 | Cuir | 15/30/55 | CUI | SAF, ROS, IRI, VIO, OUD, LAB, BER, VET | 1 |
| S9 | Aquatique | 35/30/35 | MAR ou CON ; MUS | BER, CIT, PAM, CAC, CED, THE, MUG | 1 |
| S10 | Poudré / iris | 15/45/40 | IRI ou VIO ; MUS | ROS, SAN, VAN, TON, FRB | 2 |
| S11 | Rose-oud | 15/40/45 | ROS ; OUD | SAF, PAT, AMB, POI, ENC, LAB | 1 |
| S12 | Musc propre | 25/25/50 | MUS ≥ 30 % | BER, MAN, JAS, CAC, AMX, IRI, FLO | 1 |

### B7. Les 36 recettes (en % du concentré ; chaque ligne fait 100)

| Code | S | Nom | V | Formule (% du concentré) |
|---|---|---|---|---|
| R01 | S1 | Cologne claire | 1 | BER 25, CIT 15, MAN 10, LAV 10, JAS 5, MUS 20, CED 15 |
| R02 | S1 | Agrumes poivrés | 1 | PAM 20, BER 20, POI 8, LAV 7, ROS 5, CAC 20, VET 10, MUS 10 |
| R03 | S1 | Néroli lumineux | 2 | NER 20, BER 20, PET 15, MAN 10, JAS 5, MUS 20, CED 10 |
| R04 | S2 | Fougère moderne | 1 | BER 15, LAV 20, POI 5, ROS 5, TON 15, PAT 10, VET 10, CED 10, MUS 10 |
| R05 | S2 | Fougère classique | 2 | BER 15, LAV 20, GER 10, SAU 5, TON 15, MOU 5, PAT 10, CED 10, MUS 10 |
| R06 | S2 | Fougère ambrée | 2 | LAV 20, BER 10, CAR 5, GER 5, TON 15, AMB 15, CAC 15, VAN 5, MUS 10 |
| R07 | S3 | Néo-chypre rose | 1 | BER 20, MAN 5, ROS 20, JAS 10, PAT 20, VET 5, AMB 5, MUS 15 |
| R08 | S3 | Chypre classique | 2 | BER 25, ROS 15, JAS 10, LAB 10, MOU 5, PAT 15, VET 5, MUS 15 |
| R09 | S3 | Chypre fruité | 2 | BER 15, FRB 10, ROS 15, JAS 10, PAT 20, LAB 10, MOU 5, MUS 15 |
| R10 | S4 | Ambre doux | 1 | MAN 10, BER 5, JAS 5, ROS 5, AMB 30, VAN 15, TON 10, SAN 10, MUS 10 |
| R11 | S4 | Ambre résineux | 2 | BER 10, CAR 5, ROS 10, AMB 25, BEN 15, LAB 10, ENC 5, VAN 10, SAN 10 |
| R12 | S4 | Ambre épicé | 3 | MAN 10, CAN 2, GIR 3, POI 5, ROS 10, AMB 30, VAN 15, TON 10, PAT 5, SAN 10 |
| R13 | S5 | Jasmin solaire | 1 | MAN 15, BER 5, JAS 35, ROS 10, SAN 15, VAN 5, MUS 15 |
| R14 | S5 | Fleurs blanches | 2 | MAN 10, NER 10, JAS 25, YLA 10, ROS 5, SAN 15, VAN 10, MUS 15 |
| R15 | S5 | Tubéreuse plage | 3 | MAN 10, BER 5, TUB 25, JAS 15, FLO 10, SAN 15, VAN 5, MUS 15 |
| R16 | S6 | Vanille tonka | 1 | MAN 10, BER 5, JAS 5, ROS 5, VAN 30, TON 15, AMB 10, SAN 10, MUS 10 |
| R17 | S6 | Praliné patchouli | 2 | MAN 10, FRB 5, JAS 10, PRA 20, VAN 15, TON 10, PAT 15, MUS 15 |
| R18 | S6 | Café vanille | 3 | BER 10, CAR 5, IRI 5, ROS 5, CAF 15, VAN 25, TON 10, PAT 10, CAC 15 |
| R19 | S7 | Cèdre poivré | 1 | BER 15, PAM 10, POI 5, LAV 10, ROS 5, CED 20, VET 15, CAC 15, MUS 5 |
| R20 | S7 | Vétiver frais | 2 | BER 15, PAM 10, GIN 5, ROM 5, SAU 5, GER 5, VET 25, CED 15, CAC 10, MUS 5 |
| R21 | S7 | Bois fumés | 3 | BER 10, POI 5, CAR 5, LAV 10, GAI 10, VET 15, CED 20, CAC 15, AMB 10 |
| R22 | S8 | Cuir propre | 1 | BER 10, POI 5, ROS 10, JAS 5, CUI 25, CED 15, VET 10, AMB 10, MUS 10 |
| R23 | S8 | Cuir safrané | 2 | BER 10, SAF 5, ROS 15, CUI 25, OUD 5, LAB 10, VET 10, AMB 10, MUS 10 |
| R24 | S8 | Cuir daim iris | 2 | MAN 10, BER 5, IRI 10, VIO 5, ROS 5, CUI 20, SAN 15, MUS 20, AMB 10 |
| R25 | S9 | Bord de mer | 1 | BER 15, CIT 10, PAM 10, MAR 10, LAV 5, JAS 5, CAC 20, CED 10, MUS 15 |
| R26 | S9 | Aquatique boisé | 1 | BER 15, MAN 10, MAR 8, POI 5, ROS 2, CAC 20, VET 15, CED 10, MUS 15 |
| R27 | S9 | Eau verte | 3 | CIT 15, BER 10, CON 5, MAR 5, THE 10, MUG 10, CAC 15, CED 10, MUS 20 |
| R28 | S10 | Iris poudré | 2 | MAN 10, BER 5, IRI 20, VIO 10, ROS 10, SAN 15, VAN 5, MUS 25 |
| R29 | S10 | Violette boisée | 2 | BER 10, POI 5, VIO 20, IRI 10, ROS 5, CED 15, SAN 10, MUS 25 |
| R30 | S10 | Rouge à lèvres | 2 | MAN 5, FRB 10, VIO 15, IRI 10, ROS 15, VAN 10, MUS 25, SAN 10 |
| R31 | S11 | Rose oud | 1 | BER 10, POI 5, ROS 30, OUD 15, PAT 10, AMB 15, SAN 5, MUS 10 |
| R32 | S11 | Rose safran | 2 | BER 10, SAF 5, ROS 30, OUD 15, PAT 10, LAB 5, AMB 15, MUS 10 |
| R33 | S11 | Oud encens | 2 | BER 10, CAR 5, ROS 20, OUD 20, ENC 10, PAT 10, AMB 15, CED 10 |
| R34 | S12 | Linge propre | 1 | BER 15, MAN 10, JAS 5, ROS 5, MUS 40, CAC 15, SAN 10 |
| R35 | S12 | Peau musquée | 2 | BER 10, POM 5, IRI 5, ROS 5, JAS 5, MUS 35, AMX 15, SAN 20 |
| R36 | S12 | Musc fleur d'oranger | 3 | BER 10, NER 10, FLO 15, JAS 5, MUS 35, AMX 10, SAN 15 |

Vague 1 = 13 recettes (R01, R02, R04, R07, R10, R13, R16, R19, R22, R25, R26, R31, R34) sur 11 structures. Toutes les recettes sont au statut `a_valider` tant qu'Ethan ne les a pas essayées (§ B9). Elles passent aussi les règles de sécurité (§ B5) avec les vrais lots : une recette qui échoue en sécurité est refusée, même avec une bonne harmonie.

**Conversion en grammes.** Tout se pèse, rien ne se mesure en volume. Densités par défaut : alcool éthylique 96 % dénaturé 0,807 g/ml ; concentré 0,96 g/ml. La densité réelle de chaque lot (certificat d'analyse) remplace la valeur par défaut.
- masse du concentré = V × c × d_concentré ;
- masse d'alcool = V × (1 − c) × 0,807, moins l'alcool déjà apporté par les stocks prédilués (`dilution_stock`, comme en V1) ;
- grammes de la note i = p_i × masse du concentré × 100 / `dilution_stock`.

| Format | c = 15 % | c = 18 % | c = 20 % |
|---|---|---|---|
| 100 ml : concentré / alcool | 14,4 g / 68,6 g | 17,3 g / 66,2 g | 19,2 g / 64,6 g |
| 100 ml : grammes pour 1 % du concentré | 0,144 g | 0,173 g | 0,192 g |
| 50 ml : concentré / alcool | 7,2 g / 34,3 g | 8,6 g / 33,1 g | 9,6 g / 32,3 g |
| 50 ml : grammes pour 1 % du concentré | 0,072 g | 0,086 g | 0,096 g |

Exemple R01 en 100 ml à 18 % (17,3 g de concentré, notes pures) : BER 4,33 g ; CIT 2,60 g ; MAN 1,73 g ; LAV 1,73 g ; JAS 0,87 g ; MUS 3,46 g ; CED 2,60 g ; alcool 66,2 g.
`recettes.json` ne stocke que les pourcentages. Les grammes sont calculés et affichés sur la page de fabrication. Prévoir 2 % de liquide en plus (le mélange n'est pas parfaitement additif en volume) et un contrôle du niveau de remplissage.

### B8. Les 5 portes d'entrée

Téléphone d'abord : écran de 360 px, un choix par écran, bouton principal en bas, barre de progression. Style du site (prune et or). Toutes les portes aboutissent au même **écran Récap** : pyramide visuelle, score d'harmonie et son libellé, explication par l'IA, ligne « conforme ✓ », choix kit / 50 ml / 100 ml, prix calculé par le serveur.

**P1 — Pars d'un parfum que tu aimes** (visible seulement si `inspiration_nommee = true`)
1. Champ « Un parfum que tu aimes », avec autocomplétion sur les parfums de `data/parfums.json` qui ont des notes dans `notes_publiees.json`. Aussi pré-rempli par un bouton « Compose ton parfum avec ces notes » sur ces fiches de l'annuaire (bouton masqué si le parfum n'a pas de notes publiées ou si l'interrupteur est coupé).
2. Affichage factuel seulement : « Notes publiées : … » et « L'outil couvre 7 notes sur 11 ». Notes couvertes cochées, autres grisées.
3. Le moteur propose une formule avec les notes couvertes, dans la structure la plus proche, et calcule l'harmonie.
4. Réglages : curseurs tête/cœur/fond et intensité (15 à 20 %), puis Récap.

**Données manquantes à prévoir** : le site n'a pas aujourd'hui les notes publiées des parfums (seulement des accords pour 66 parfums dans `data/accords.json`). Créer `notes_publiees.json` avec son schéma (`{slug: {tete: [], coeur: [], fond: [], source, date, a_verifier}}`), 3 exemples marqués `a_verifier: true`, et `correspondances.json` (≈ 150 noms de notes courants en français et en anglais → code Olfamatch). Ne pas aller récupérer ces données sur Fragrantica ou un autre site : la collecte sera faite à part. Quand un parfum n'a pas de notes publiées mais a des accords, la porte peut proposer la structure la plus proche à partir des accords (correspondance accords → sous-familles).

Garde-fous obligatoires :
- Liste des tournures interdites (§ 0), contrôlée par des tests sur tous les textes affichés, les sorties de l'IA et les e-mails.
- Le nom du parfum de marque reste uniquement dans l'état local de la page. Il n'est **jamais envoyé** à `/api/checkout`, à Stripe, à D1, à l'étiquette, au code de formule ni aux e-mails. Le worker rejette (erreur 400) tout appel qui contient un champ `inspiration*` ou un nom de la liste des parfums et marques.
- Interrupteur `inspiration_nommee` à deux niveaux : `config/features.json` côté site et variable d'environnement du worker. Sur `false` : champ et boutons masqués, routes refusées, prompt de l'IA sans noms de marque.
- Aucun nom de marque dans les publicités ni dans les métadonnées des pages.

**P2 — Par ambiance**
1. 8 cartes illustrées : Plage, Forêt, Linge propre, Jardin fleuri, Soirée, Épices d'hiver, Cuir et bois, Douceur sucrée. Chaque carte renvoie à une structure et à ses recettes.
2. Option « Décris-le avec tes mots » : l'IA (rôle 1) transforme le texte en `{structure, notes_souhaitees, notes_evitees}`.
3. Choix entre 3 recettes, réglages, Récap.

**P3 — Petit quiz (6 questions, une par écran)** : moment (jour / soir), saison, frais ou chaud, sucré ou non, fleurs ou non, sillage discret ou fort. Chaque réponse donne des points aux structures ; on garde les 2 meilleures et leurs recettes, puis Récap. Reprendre ce qui marche dans le mode guidé V1 (note détestée, curseurs fraîcheur et douceur).

**P4 — Recettes de base à modifier**
1. Catalogue filtré par famille maison (frais, floral, gourmand, boisé, ambré), seulement pour les vagues actives.
2. Fiche recette.
3. « Modifier » : remplacer une note par une autre du même étage, ou ±5 points par note ; recalcul en direct.
4. Récap.

**P5 — Mode expert libre** (base : mode expert V1)
1. Choix de 3 à 12 notes par étage.
2. Curseurs en %, ramenés automatiquement à 100.
3. Deux jauges en direct : harmonie, et « marge de sécurité » (la plus petite marge restante, toutes règles § B5 confondues). Les curseurs bloquent à la limite de sécurité.
4. Récap.

### B9. Validation des recettes par Ethan (à afficher dans la page de fabrication)

- **Essai** : mini-lot de 10 g à 18 %. Mouillettes à T0, 1 h, 6 h et 24 h. Essai sur la peau de 3 à 5 personnes.
- **Macération** : sentir à J7, J14 et J28.
- **Stabilité** (dossier pour l'évaluateur) : un échantillon à 40 °C, un au réfrigérateur, un à la lumière, pendant 4 semaines. Noter couleur, odeur, dépôt, trouble.
- Grille notée sur 5 (tête, cœur, fond, tenue en heures, sillage). La recette passe en `validee` avec une note d'au moins 3,5 et aucun défaut de stabilité.
- Prévoir dans la page privée un petit formulaire pour saisir ces notes et changer le statut (enregistré dans D1).

### B10. IA : deux rôles seulement

- **Rôle 1, comprendre** : texte libre → JSON validé par schéma `{structure_code?, notes_codes[], notes_evitees[], intensite: "discrete|moyenne|forte"}`. Seuls les codes des notes des vagues actives sont acceptés. **Interdit** : pourcentages, grammes, avis de sécurité.
- **Rôle 2, expliquer** : formule finale déjà validée par le moteur → 80 à 120 mots en français simple.
- **Garde-fous** : température basse ; contrôle des tournures interdites et des noms de marque sur chaque sortie ; aucune allégation de santé ou d'effet (« apaisant », « aphrodisiaque »…) ; aucun chiffre de dosage ; en cas d'échec ou si `ia_active = false`, texte de repli préécrit ; journal des appels sans données personnelles. Garder les protections V1 (cache, limites, modèle).
- La validation et le prix ne dépendent **jamais** de la réponse de l'IA.

### B11. Code de formule

- **Forme canonique** : notes triées par code, p_i arrondis au pas de 0,5 %, c au pas de 1 %, `moteur_version`, `cadre_version`, `ifra_amendement`.
- **Code** = `OLF-` + base32 des 40 premiers bits du SHA-256 de la forme canonique + 1 caractère de contrôle, présenté en deux blocs (ex. `OLF-7K3QH-9XB2Q`).
- Le serveur enregistre la forme canonique dans D1 (`formules`) au moment où il crée le code. Le code ne contient aucun nom de marque ni texte libre.
- Si un code est rechargé alors que le cadre ou un lot a changé, la formule est revalidée ; si elle échoue, le client voit « formule à mettre à jour » et l'outil propose la variante conforme la plus proche.

### B12. Paiement Stripe : vérification côté serveur

1. Le navigateur n'envoie que `{code, format: "kit|50|100", quantite, code_kit?}`.
2. Le worker recharge la formule depuis D1, **relance toutes les règles § B5** avec les lots actifs, vérifie `vente_active` et le stock, puis calcule le prix depuis `boutique.json`. Il ne reprend aucun montant envoyé par le navigateur.
3. Il crée la session Stripe Checkout avec `price_data`. Nom du produit : « Eau de parfum sur mesure Olfamatch – OLF-XXXXX-XXXXX – 100 ml ». Métadonnées : `{code, format, hash_canonique, moteur_version, cadre_version}`.
4. Webhook : vérifier la signature, traiter `checkout.session.completed` et `checkout.session.async_payment_succeeded`, relire la session avec ses `line_items`, puis **comparer** `amount_total`, le format et `hash_canonique` aux valeurs recalculées. En cas d'écart : statut « BLOQUÉE – à vérifier », pas de fiche de fabrication, alerte e-mail à Ethan (même logique que la correction V1 « NE PAS FABRIQUER »).
5. Anti-doublon : table `evenements_stripe` indexée sur `event.id` (en plus du KV V1 si utile).
6. Déduction du kit : à la commande d'un kit, le worker crée un code promotion Stripe de 10 €, à usage unique, lié au code de formule, valable 90 jours, accepté seulement pour un flacon de la même formule. Le code est imprimé sur la fiche du colis.
7. Aucun nom de parfum de marque dans les métadonnées, descriptions ou e-mails. Un test vérifie le contenu exact envoyé à Stripe.
8. Clés secrètes uniquement dans les secrets du worker ; limitation du nombre de requêtes sur `/api/*` ; CORS limité aux adresses de `SITE_ORIGINS`.
9. Tant que `vente_active = false`, le bouton de paiement affiche « Bientôt disponible » et `/api/checkout` refuse.

### B13. E-mails et page privée de fabrication

- **E-mails** : au client, confirmation (code, format, délai d'environ 3 semaines macération comprise) puis expédition (numéro de suivi) ; à Ethan, nouvelle commande avec lien vers la fiche. Aucun nom de marque, aucune allégation.
- **Fiche de pesée** (seulement pour une commande payée et vérifiée) : numéro de lot `LAAMM-NNNN` (ex. L2611-0042) ; lots fournisseurs utilisés ; ordre d'ajout (fond, cœur, tête, puis alcool) ; masse cible par ligne et case pour la masse réelle ; tolérance ±2 % ou ±0,02 g ; hors tolérance, ligne en rouge et validation bloquée.
- **Macération** : date de début, fin prévue (14 jours minimum, à l'abri de la lumière), puis 24–48 h au froid et filtration. Rappel dans le tableau de bord.
- Étiquette PDF à imprimer, décompte des stocks, archive des lots gardée au moins 10 ans.

### B14. Étiquette générée automatiquement

Mentions : nom et adresse de la personne responsable (`regles.json` → `etiquette.responsable`, déjà prévu en V1 : sans eux, l'impression reste refusée) ; contenance (100 ml / 50 ml) ; numéro de lot ; durée après ouverture (ex. 36M) une fois la stabilité établie ; précautions (« Inflammable. Tenir éloigné de la chaleur et des flammes. Ne pas vaporiser sur une peau lésée. ») ; fonction (« Eau de parfum ») ; liste des ingrédients ; texte en français.
Liste INCI : `ALCOHOL DENAT., PARFUM (FRAGRANCE), [allergènes > 0,001 % par ordre décroissant]`, plus `AQUA` si de l'eau est ajoutée. Pour le kit de 2 ml, les ingrédients peuvent être sur une notice ou un étui. Aucun nom de marque tierce. Le pictogramme et les mentions exactes seront validés par l'évaluateur (champs modifiables dans `regles.json`). Le colis porte le marquage « LQ ».

### B15. Expédition

Le parfum est une marchandise dangereuse (UN 1266, classe 3) : La Poste et Colissimo l'interdisent. Envoi en « quantités limitées » (5 L maximum par emballage intérieur, colis de 30 kg maximum, losange LQ) avec un transporteur pro qui l'accepte (à confirmer par Ethan). Le site n'affiche pas Colissimo. Pas d'envoi par avion, donc pas d'outre-mer au lancement. Le choix du transporteur est un réglage de `boutique.json`.

### B16. Plan de tests (en plus des 107 tests V1 encore valables)

1. Tests unitaires : harmonie (matrice symétrique, exceptions prioritaires, seuils), règles § B5, conversions en grammes (avec prédilution), code de formule et caractère de contrôle.
2. **Tests au hasard** : 10 000 formules (3 à 12 notes, % au hasard, c entre 14 et 21 %). Chaque formule acceptée ne dépasse aucune limite ; chaque formule refusée enfreint au moins une règle ; un allergène est étiqueté si et seulement s'il dépasse 0,001 %.
3. Les 36 recettes : H ≥ 70 et conformes à c = 15, 18 et 20 % (avec les lots de démonstration).
4. Paiement : montant modifié, code inexistant, code valide mais cadre révoqué, webhook rejoué, signature invalide, comparaison `amount_total`, `vente_active = false`.
5. Tournures interdites et noms de marque absents des étiquettes, e-mails, métadonnées Stripe et sorties IA (simulées).
6. `inspiration_nommee = false` : interface masquée et routes refusées.
7. Note sans ses 4 documents : invisible et inutilisable (hors `mode_demo`).
8. Parcours complet des 5 portes sur un écran de 360 px.

### B17. Découpage de la livraison

1. **Étape 1** : fichiers de données (schémas, 58 notes, matrice, facettes, exceptions, structures, recettes, lots de démonstration), module moteur, tests au hasard.
2. **Étape 2** : worker, D1, code de formule, paiement vérifié, webhook.
3. **Étape 3** : portes P4 et P5, puis P2, P3, P1 ; IA ; écran Récap.
4. **Étape 4** : page de fabrication (pesée, validation des recettes, macération), étiquette, e-mails.
5. **Étape 5** : mise à jour de `data/creer/LANCEMENT.md` (liste des choses à faire par Ethan, en français simple) et de `worker/LISEZMOI.md`.

À la fin de chaque étape : tous les tests au vert, branche `creer-ton-parfum-v2` envoyée sur GitHub, résumé de 5 lignes en français simple pour Ethan. Jamais de fusion dans `main` sans sa demande.

---

## PARTIE D — Budget et délai (pour information)

| Poste | Estimation |
|---|---|
| Matières vague 1 (20 × 1 kg) | 150–1 100 € |
| Transport et douane des huiles | 150–400 € |
| Matières vagues 2 et 3 (38 × 1 kg) | 300–2 300 € |
| Alcool (≈ 8 L pour 100 flacons) | ≈ 215 € |
| Flacons spray 100 ml (200 unités) | 250–900 € |
| Balance 0,01 g, verrerie, étiquettes | 300–700 € |
| Évaluateur de sécurité, cadre vague 1 | 1 000–3 000 € |
| Mises à jour du cadre (vagues 2 et 3) | 500–1 500 € |
| Tests de stabilité | 0–1 500 € |
| Assurance responsabilité civile pro, 1re année | 300–800 € |
| **Total réaliste** | **≈ 4 500–9 500 €, 6 à 9 mois** |

Le code n'est pas le chemin critique : ce sont les documents fournisseurs, le rapport de sécurité et le transport.

---

## Sources principales

- Normes IFRA, 51e amendement : https://d3t14p1xronwr0.cloudfront.net/docs/Standards-Documentation/ifra-standards-51st-amendment.pdf
- ANSM, cosmétiques personnalisables (bilan d'inspections) : https://archive.ansm.sante.fr/var/ansm_site/storage/original/application/9d5b64f9b96c0ee29f764e38998cba8a.pdf
- « The Regulation of Personalized Cosmetics in the EU », Cosmetics, 2019 : https://doi.org/10.3390/cosmetics6020029
- Étiquetage des allergènes (règlement 2023/1545) : http://www.cosmed.fr/etiquetage-des-allergenes-etes-vous-prets/
- CPNP et formulations-cadres : https://www.coptis.com/resources/cpnp-portal/
- La Poste, envoi de parfums : https://www.laposte.fr/envoyer/envoyer-parfum-maquillage
- Colissimo, marchandises dangereuses : https://www.colissimo.entreprise.laposte.fr/en/practical-advice/right-packaging/dangerous-and-prohibited-goods
- UN 1266 : https://adrdangerousgoods.com/eng/substances/0000629/un1266-perfumery-products-with-flammable-solvents/
- Stripe, traitement des commandes Checkout : https://docs.stripe.com/checkout/fulfillment
- Prix d'un DIP : https://toxicologue-cosmetique.fr/prestations/
