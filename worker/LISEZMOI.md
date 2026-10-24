# Programme Cloudflare (Worker) d'Olfamatch « Crée ton parfum » V2

Ce programme tourne chez Cloudflare. C'est lui qui décide, jamais la page du site :

1. **Code de formule.** Quand un client arrive sur le récapitulatif, le programme revérifie la formule avec le moteur (harmonie et sécurité). Il l'enregistre dans sa base et donne un code du type `OLF-7K3QH-9XB2Q`.
2. **Paiement.** Au clic sur « Commander », il relance toutes les règles avec les lots du jour, vérifie le stock et calcule lui-même le prix (depuis `boutique.json`). Puis il ouvre la page de paiement Stripe. Le navigateur n'envoie jamais de montant.
3. **Vérification du paiement.** Quand Stripe annonce un paiement, le programme relit la commande chez Stripe et compare tout : montant, prix, quantité, format, formule.
   - Au moindre écart, la commande est « **BLOQUÉE – à vérifier** » et tu reçois un e-mail « NE PAS FABRIQUER ».
   - Sinon, la commande reçoit un numéro de lot (L2611-0001). Tu reçois un e-mail avec le lien vers la fiche, et le client une confirmation.
   - Pour un kit, un code de réduction de 10 € est créé chez Stripe. Il vaut un seul usage, pendant 90 jours, sur un flacon de la même formule.
4. **IA.** Elle comprend la description libre d'un client (porte « Par ambiance ») et explique la formule finale en 80 à 120 mots. Elle ne donne jamais de dose. Son texte est contrôlé : sinon, la page garde son texte préécrit.
5. **Atelier privé** (`/fabrication`). Il rassemble la fiche de pesée, la macération, l'étiquette, les stocks et les essais des recettes. Il est réservé à ton compte grâce à Cloudflare Access.

**Rien n'est en ligne tant que tu n'as pas fait les étapes ci-dessous.** Et la vente reste fermée tant que `vente_active` vaut `false`.

## Ce qu'il te faut

- Un **nom de domaine géré par Cloudflare** (par exemple `olfamatch.fr`). Il sert pour les e-mails aux clients et pour protéger l'atelier.
- Un compte **Stripe**.
- Une clé API **Anthropic**, seulement pour l'IA (facultatif).

Toutes les commandes se tapent dans un terminal, depuis le dossier `worker`. Commence par :

```bash
npx wrangler login
```

## 1. La base de données (D1)

```bash
npx wrangler d1 create olfamatch
```

Copie l'identifiant affiché à la place de `IDENTIFIANT-D1-A-REMPLACER` dans [wrangler.toml](wrangler.toml), puis crée les tables :

```bash
npx wrangler d1 execute olfamatch --remote --file=schema.sql
```

## 2. La mémoire (KV) pour l'IA

```bash
npx wrangler kv namespace create MEMOIRE
```

Copie l'identifiant affiché à la place de `IDENTIFIANT-KV-A-REMPLACER` dans [wrangler.toml](wrangler.toml).

## 3. Les e-mails (Cloudflare Email Service)

Active l'envoi sur ton domaine :

```bash
npx wrangler email sending enable TON-DOMAINE.fr
```

Puis, dans [wrangler.toml](wrangler.toml), remplace :
- `ADRESSE-DE-L-ATELIER@exemple.fr` par l'adresse qui reçoit les commandes et les alertes ;
- `atelier@VOTRE-DOMAINE.fr` par une adresse de ton domaine, qui sert d'expéditeur.

Au début, Cloudflare limite le nombre d'e-mails par jour, puis augmente la limite avec le temps.

## 4. Mettre le programme en ligne

```bash
npx wrangler deploy
```

Puis relie-le à un sous-domaine : dans Cloudflare, **Workers & Pages > olfamatch-atelier > Settings > Domains & Routes > Add > Custom domain**, par exemple `atelier.TON-DOMAINE.fr`. C'est l'adresse du programme pour la suite.

## 5. Protéger l'atelier (Cloudflare Access)

1. Dans Cloudflare, ouvre **Zero Trust > Access > Applications > Add an application > Self-hosted**.
2. Domaine : `atelier.TON-DOMAINE.fr`. Ajoute deux chemins : `fabrication` et `api/fabrication/*`. **Ne protège pas tout le domaine** : le site et Stripe doivent pouvoir joindre `/api/formule`, `/api/checkout` et `/api/webhook-stripe`.
3. Règle : **Allow**, avec ton adresse e-mail seulement.
4. Recopie dans [wrangler.toml](wrangler.toml) :
   - `ACCESS_EQUIPE` : le nom de ton équipe (le début de `xxx.cloudflareaccess.com`) ;
   - `ACCESS_AUD` : l'« Application Audience (AUD) Tag » de l'application ;
   - `ACCESS_EMAILS` : ton adresse e-mail.

Le programme revérifie lui-même la connexion. Sans ces trois réglages, l'atelier refuse tout le monde, toi compris.

## 6. Stripe

1. Crée une **clé restreinte** : **Développeurs > Clés API > Créer une clé restreinte**. Donne-lui les droits « Checkout Sessions » (écriture), « Coupons » (écriture) et « Promotion Codes » (écriture). Enregistre-la :

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

2. Webhook : **Développeurs > Webhooks > Ajouter un endpoint**.
   - URL : `https://atelier.TON-DOMAINE.fr/api/webhook-stripe`.
   - Événements : `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
   - Copie le secret de signature (il commence par `whsec_`) et enregistre-le :

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Les anciens liens de paiement de la V1 ne servent plus.

## 7. L'IA (facultatif)

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

- Modèle par défaut : Claude Haiku 5.5, le moins cher. On peut en choisir un autre avec `MODELE_IA` dans wrangler.toml.
- Limites : 5 demandes par minute et par visiteur, 200 par jour en tout (`IA_PLAFOND_JOUR`), 300 jetons au plus par réponse.
- Les textes déjà écrits sont gardés 30 jours.
- L'interrupteur `ia_active` de [config/features.json](../data/creer/config/features.json) coupe l'IA (puis reconstruis le site et refais `npx wrangler deploy`).

## 8. Relier le site au programme

- Dans [data/creer/boutique.json](../data/creer/boutique.json), mets `worker` à `https://atelier.TON-DOMAINE.fr`.
- Dans `SITE_ORIGINS` de [wrangler.toml](wrangler.toml), mets toutes les adresses du site, séparées par des virgules (avec et sans `www`), puis refais `npx wrangler deploy`.

## 9. Porte « Pars d'un parfum que tu aimes » (facultatif, plus tard)

Elle s'allume à deux endroits, et il faut les deux :
- `inspiration_nommee: true` dans [config/features.json](../data/creer/config/features.json) ;
- `INSPIRATION_NOMMEE = "true"` dans [wrangler.toml](wrangler.toml).

Le nom du parfum de marque reste dans la page du client. Le programme refuse toute demande qui en contient un, sauf la description libre quand l'interrupteur est allumé.

## 10. Vérifier avant d'ouvrir

1. En mode test Stripe (clé `sk_test_…`), fais un achat complet depuis le site.
2. Tu dois recevoir l'e-mail « Nouvelle commande », et le client test sa confirmation.
3. Ouvre la fiche dans l'atelier, fais une pesée d'essai, puis vérifie l'étiquette.

## À savoir

- **Le programme emporte une copie des fichiers de `data/creer`** (notes, lots, cadre, prix, interrupteurs). Après chaque changement de ces fichiers, refais `npx wrangler deploy`, en plus de reconstruire le site. Sinon le programme garde les anciennes valeurs.

- **E-mail ou Stripe en panne** : le programme répond une erreur à Stripe, qui renvoie l'événement plus tard. La commande n'est pas perdue.
- **Doublons** : chaque notification Stripe n'est traitée qu'une fois (table `evenements_stripe`).
- **« Formule à mettre à jour »** : quand un client recharge un ancien code alors que le cadre de sécurité ou un lot a changé, l'outil lui propose la variante conforme la plus proche.
- **Archives** : la base garde la copie de chaque lot fournisseur utilisé (table `lots`). Garde-la au moins 10 ans.
- **Mise à jour du schéma** : après une mise à jour de `schema.sql`, relance la commande de l'étape 1. Elle ne touche pas aux données déjà là.
