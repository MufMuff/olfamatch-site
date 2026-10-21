# Programme Cloudflare (Worker) d'Olfamatch

Ce petit programme tourne chez Cloudflare. Il fait deux choses :

1. **Fiche par e-mail (V2).** Quand un client paie sur un lien Stripe, Stripe prévient le programme. Le programme vérifie que le message vient bien de Stripe, recalcule la fiche de pesée à partir du code de formule, puis t'envoie un e-mail avec les grammes à peser.
   - Si le code manque ou si la formule ne respecte plus les règles, l'e-mail commence par **NE PAS FABRIQUER**, avec la raison.
   - Pour un kit d'échantillons, l'e-mail contient les 3 variantes.
2. **Description par IA (V3).** La page « Crée ton parfum » peut demander une description écrite par Claude. L'IA écrit seulement le texte : elle ne choisit jamais les doses. En cas de souci, la page garde ses phrases préécrites.

**Rien n'est en ligne tant que tu n'as pas fait les étapes ci-dessous.**

## Ce qu'il te faut

- Un nom de domaine géré par Cloudflare (par exemple `olfamatch.fr`). L'envoi d'e-mails de Cloudflare ne marche pas avec la seule adresse `olfamatch.pages.dev`.
- Un compte Stripe avec tes liens de paiement.
- Une clé API Anthropic, seulement pour la description par IA (facultatif).

## 1. Cloudflare : e-mails

1. Dans Cloudflare, ouvre ton domaine, puis **Email > Email Routing**, et active-le.
2. Dans **Destination addresses**, ajoute l'adresse qui recevra les fiches et confirme-la depuis l'e-mail reçu.
3. Dans [wrangler.toml](wrangler.toml), remplace :
   - `ADRESSE-DE-L-ATELIER@exemple.fr` (2 fois) par cette adresse ;
   - `atelier@VOTRE-DOMAINE.fr` par une adresse de ton domaine (elle sert d'expéditeur).

## 2. Mettre le programme en ligne

Dans un terminal, depuis le dossier `worker` :

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

Cloudflare affiche l'adresse du programme, par exemple `https://olfamatch-atelier.TON-COMPTE.workers.dev`.

## 3. Stripe

1. Dans Stripe, ouvre **Développeurs > Webhooks > Ajouter un endpoint**.
2. URL : l'adresse du programme suivie de `/stripe`, par exemple `https://olfamatch-atelier.TON-COMPTE.workers.dev/stripe`.
3. Événements : `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
4. Copie le **secret de signature** (il commence par `whsec_`), puis enregistre-le :

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

## 4. Description par IA (facultatif)

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Puis colle l'adresse du programme (par exemple `https://olfamatch-atelier.TON-COMPTE.workers.dev`) dans [data/creer/boutique.json](../data/creer/boutique.json), champ `worker` : la page affichera alors le bouton « Décris-le autrement ».

Sans clé, la page garde simplement ses descriptions préécrites.

## 5. Vérifier

Dans Stripe, sur le webhook, clique **Envoyer un événement de test** (`checkout.session.completed`). Un e-mail « NE PAS FABRIQUER » doit arriver : c'est normal, l'événement de test n'a pas de code de formule.

## À savoir

- Si l'e-mail ne part pas, le programme répond une erreur à Stripe, qui renvoie l'événement plus tard : la commande n'est pas perdue.
- Stripe peut parfois envoyer deux fois le même événement. Le numéro de commande est dans l'e-mail pour repérer un doublon.
- L'adresse `/description` n'accepte que les demandes venant du site (`SITE_ORIGIN`). Pour limiter les abus et la facture d'IA, ajoute une règle de limitation de débit dans Cloudflare (**Security > WAF > Rate limiting rules**) sur `/description`.
