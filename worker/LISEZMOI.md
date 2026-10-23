# Programme Cloudflare (Worker) d'Olfamatch

Ce petit programme tourne chez Cloudflare. Il fait deux choses :

1. **Fiche par e-mail (V2).** Quand un client paie sur un de tes 3 liens Stripe (kit, 50 ml, 100 ml), Stripe prévient le programme. Le programme vérifie que le message vient bien de Stripe, recalcule la fiche de pesée à partir du code de formule, puis t'envoie un e-mail avec les grammes à peser.
   - L'e-mail commence par **NE PAS FABRIQUER**, avec la raison, si le code manque, si la formule ne respecte plus les règles, ou si le produit payé ne correspond pas au code (par exemple un kit payé avec un code de flacon 100 ml).
   - Une commande à **0 €** (code promo à 100 %) est signalée en tête de l'e-mail.
   - Un paiement venant d'un autre lien Stripe est ignoré.
   - Si Stripe envoie deux fois le même paiement, une seule fiche part.
   - Pour un kit d'échantillons, l'e-mail contient les 3 variantes.
2. **Description par IA (V3).** La page « Crée ton parfum » peut demander une description écrite par Claude. L'IA écrit seulement le texte : elle ne choisit jamais les doses. En cas de souci, la page garde ses phrases préécrites.
   - Chaque formule n'est décrite qu'une fois : le texte est gardé 30 jours.
   - 5 demandes par minute au plus par visiteur, et 200 par jour en tout (réglable : `IA_PLAFOND_JOUR`).
   - Modèle par défaut : Claude Haiku 5.5, le moins cher, avec 300 jetons au plus par description.

**Rien n'est en ligne tant que tu n'as pas fait les étapes ci-dessous.**

## Ce qu'il te faut

- Un nom de domaine géré par Cloudflare (par exemple `olfamatch.fr`). L'envoi d'e-mails de Cloudflare ne marche pas avec la seule adresse `olfamatch.pages.dev`.
- Un compte Stripe avec tes 3 liens de paiement.
- Une clé API Anthropic, seulement pour la description par IA (facultatif).

## 1. Cloudflare : e-mails

1. Dans Cloudflare, ouvre ton domaine, puis **Email > Email Routing**, et active-le.
2. Dans **Destination addresses**, ajoute l'adresse qui recevra les fiches et confirme-la depuis l'e-mail reçu.
3. Dans [wrangler.toml](wrangler.toml), remplace :
   - `ADRESSE-DE-L-ATELIER@exemple.fr` (2 fois) par cette adresse ;
   - `atelier@VOTRE-DOMAINE.fr` par une adresse de ton domaine (elle sert d'expéditeur).

## 2. Cloudflare : mémoire

Dans un terminal, depuis le dossier `worker` :

```bash
npx wrangler login
```

```bash
npx wrangler kv namespace create MEMOIRE
```

Copie l'identifiant affiché à la place de `IDENTIFIANT-KV-A-REMPLACER` dans [wrangler.toml](wrangler.toml).

## 3. Stripe : identifiants des liens

1. Dans Stripe, ouvre chacun de tes 3 liens de paiement. Son identifiant commence par `plink_`.
2. Colle-les dans [data/creer/boutique.json](../data/creer/boutique.json), champ `liens_stripe_ids` (kit, flacon_50, flacon_100).

Sans ces identifiants, le programme refuse les paiements (Stripe réessaie et te prévient) : il ne peut pas vérifier le produit payé.

## 4. Mettre le programme en ligne

```bash
npx wrangler deploy
```

Cloudflare affiche l'adresse du programme, par exemple `https://olfamatch-atelier.TON-COMPTE.workers.dev`.

## 5. Stripe : webhook

1. Dans Stripe, ouvre **Développeurs > Webhooks > Ajouter un endpoint**.
2. URL : l'adresse du programme suivie de `/stripe`, par exemple `https://olfamatch-atelier.TON-COMPTE.workers.dev/stripe`.
3. Événements : `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
4. Copie le **secret de signature** (il commence par `whsec_`), puis enregistre-le :

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

## 6. Description par IA (facultatif)

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Puis colle l'adresse du programme (par exemple `https://olfamatch-atelier.TON-COMPTE.workers.dev`) dans [data/creer/boutique.json](../data/creer/boutique.json), champ `worker` : la page affichera alors le bouton « Décris-le autrement ».

Le jour où ton nom de domaine arrive, ajoute ses adresses (avec et sans `www`) dans `SITE_ORIGINS` de [wrangler.toml](wrangler.toml), puis refais `npx wrangler deploy`.

Sans clé, la page garde simplement ses descriptions préécrites.

## 7. Vérifier

Fais un vrai achat test avec le mode test de Stripe sur un de tes liens, avec un code de formule. Un e-mail avec la fiche de pesée doit arriver.

## À savoir

- Si l'e-mail ne part pas, le programme répond une erreur à Stripe, qui renvoie l'événement plus tard : la commande n'est pas perdue.
- Le contrôle des doublons garde chaque commande 60 jours en mémoire. Deux envois de Stripe à la même seconde peuvent encore passer tous les deux (rare) : le numéro de commande est dans l'e-mail pour les repérer.
