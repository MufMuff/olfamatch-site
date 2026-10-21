# Lancer « Crée ton parfum » : la liste

Tout le code est prêt. Ce qui reste demande tes comptes (Stripe, Cloudflare) ou tes tests sur mouillette.

## Avant tout (V0, sans code)

1. Recevoir les échantillons, faire le test de mélange à l'alcool.
2. Pour chaque huile : certificat IFRA catégorie 4, liste d'allergènes, fiche de sécurité. Les reporter dans [notes.json](notes.json) (`ifra_max`, `ifra_certificat`, `allergenes`).
3. Noter puissance et tenue sur mouillette, corriger [notes.json](notes.json) et [compatibilite.json](compatibilite.json).
4. Remplacer les 10 recettes provisoires de [recettes.json](recettes.json) par les tiennes.
5. Dans [regles.json](regles.json) :
   - mesurer la densité de ton parfum (`densite_g_ml`) ;
   - remplir `etiquette.responsable` (nom et adresse) et faire valider l'étiquette ;
   - passer `ifra.exiger_certificat` à `true`.
6. Après chaque modification, lancer les tests :

```bash
node --test
```

## Paiement (V1)

1. Dans Stripe, créer 3 liens de paiement : kit, flacon 50 ml, flacon 100 ml, aux prix de [boutique.json](boutique.json).
2. Pour chaque lien, dans « Après le paiement », choisir « Rediriger vers ton site » avec l'adresse `https://olfamatch.pages.dev/creer-mon-parfum/merci/`.
3. Coller les 3 adresses de liens dans [boutique.json](boutique.json) (`liens_stripe`).
4. Créer dans Stripe le code de réduction glissé dans les kits (prix du kit déduit du flacon).
5. Commande reçue : ouvrir le paiement dans Stripe, copier la « référence client » (le code de formule) et la coller dans la page privée `https://olfamatch.pages.dev/fabrication/`.

## Fiche par e-mail et description par IA (V2, V3)

Voir [worker/LISEZMOI.md](../../worker/LISEZMOI.md).

## Mise en ligne

1. Passer `publie` à `true` dans [boutique.json](boutique.json) : le lien « Crée ton parfum » apparaît dans le menu et la page entre dans le plan du site.
2. Reconstruire le site, puis le publier comme d'habitude :

```bash
python build.py
```

3. Conseillé : protéger `/fabrication/` avec Cloudflare Access (gratuit), pour que toi seul puisses l'ouvrir.
