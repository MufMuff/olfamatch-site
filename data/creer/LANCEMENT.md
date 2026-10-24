# Lancer « Crée ton parfum » V2 : ta liste

Le code est prêt. Ce qui reste dépend de documents, de comptes et d'essais que toi seul peux faire. L'outil reste caché (`publie: false`) et la vente bloquée (`vente_active: false`) jusqu'au bout de cette liste.

Après **chaque** modification d'un fichier de ce dossier, lance les tests. Ils vérifient tes fichiers et refusent une erreur de frappe ou une limite dépassée :

```bash
node --test
```

Une fois le programme Cloudflare en ligne, il garde sa propre copie de ces fichiers. Après chaque changement, refais aussi `npx wrangler deploy` (depuis le dossier `worker`).

## 1. Ce qui bloque la vente (hors code)

1. **Rapport de sécurité.** Un évaluateur de sécurité doit signer un rapport qui couvre le cadre : la liste fermée des notes de la vague 1, le maximum de chaque note, une concentration de 15 à 20 % et le cumul d'allergènes. Donne-lui :
   - [notes.json](notes.json) ;
   - [ifra_cat4.json](ifra_cat4.json) ;
   - [allergenes.json](allergenes.json) ;
   - [recettes.json](recettes.json) ;
   - les documents de tes lots.
2. **Documents fournisseurs**, pour chaque huile :
   - la fiche de données de sécurité (16 rubriques) ;
   - le certificat IFRA du 51e amendement, avec le maximum en catégorie 4 ;
   - la liste des allergènes ;
   - le certificat d'analyse, avec la densité.
3. **Transporteur.** Il doit accepter les parfums en « quantités limitées » (UN 1266, losange LQ). La Poste et Colissimo les refusent.
4. **Notification CPNP** des produits, **assurance** responsabilité civile pro, et **personne responsable** (nom et adresse sur l'étiquette).

## 2. Remplir les fichiers avec tes vraies valeurs

1. **Lots fournisseurs** : pour chaque huile reçue, ajoute un lot dans [matieres_lots.json](matieres_lots.json), en copiant un lot DEMO :
   - lui donner un vrai numéro (pas de `DEMO`) et `"demo": false` ;
   - recopier la composition lue sur ses documents ;
   - passer les 4 `docs` à `true`.
   Puis indique ce numéro dans `lot_actif` de la note, dans [notes.json](notes.json). Une note sans vrai lot complet devient invisible dès que le mode démonstration est coupé.
2. **Cadre signé** : recopie le rapport dans [cadre_securite.json](cadre_securite.json) (version, date, signataire, notes et maximums, concentration, cumul d'allergènes). Le moteur ne fait jamais plus large.
3. **Étiquette** : dans [regles.json](regles.json), remplis `etiquette.responsable`. Ajoute `etiquette.duree_apres_ouverture` (par exemple `36M`) une fois la stabilité établie. Fais valider les mentions par l'évaluateur.
4. **Vente** : dans [boutique.json](boutique.json), indique le `transporteur` et vérifie les prix et le délai.
5. **Après tes essais sur mouillette**, corrige si besoin la puissance, la ténacité et la dose maximum des notes ([notes.json](notes.json)), ainsi que la matrice, les facettes et les exceptions. Les tests vérifient que les 36 recettes gardent une harmonie d'au moins 70. Sinon, ajuste les poids dans [regles.json](regles.json), pas les recettes.

## 3. Essayer et valider les recettes

Dans l'atelier privé (`/fabrication`, onglet « Essais des recettes ») :

1. Calcule le mini-lot d'essai (10 g à 18 %) de la recette.
2. Sens-le sur mouillette à T0, 1 h, 6 h et 24 h, puis sur la peau de 3 à 5 personnes.
3. Sens-le de nouveau après macération, à J7, J14 et J28.
4. Fais le test de stabilité pendant 4 semaines : un échantillon à 40 °C, un au froid, un à la lumière.
5. Note l'essai sur 5. La recette passe « validée » avec une moyenne d'au moins 3,5 et aucun défaut de stabilité.
6. Recopie alors `"statut": "validee"` dans [recettes.json](recettes.json).

## 4. Les comptes (programme Cloudflare, Stripe, IA)

Suis [worker/LISEZMOI.md](../../worker/LISEZMOI.md), dans l'ordre :

1. base de données ;
2. mémoire ;
3. e-mails ;
4. mise en ligne ;
5. protection de l'atelier ;
6. Stripe ;
7. IA ;
8. lien entre le site et le programme.

## 5. Ouvrir la vente

Dans cet ordre, puis lance `node --test` (les tests refusent un réglage incohérent) :

1. [config/features.json](config/features.json) :
   - `mode_demo: false` (les lots fictifs ne servent plus) ;
   - `vagues_actives: [1]`.
2. [boutique.json](boutique.json) : `vente_active: true`. Il faut un cadre signé, des vrais lots, un transporteur et le mode démonstration coupé, sinon les tests et le programme refusent.
3. Fais un achat test complet en mode test Stripe (voir LISEZMOI, étape 10).
4. [boutique.json](boutique.json) : `publie: true`. Le lien « Crée ton parfum » apparaît alors dans le menu, et la page entre dans le plan du site.
5. Reconstruis le site et publie-le comme d'habitude :

```bash
python build.py
```

6. Demande la fusion de la branche `creer-ton-parfum-v2` dans `main` quand tu es prêt. Rien n'est en ligne avant.

## 6. Plus tard

- **Vague 2 puis vague 3** : chaque nouvelle vague exige une mise à jour du rapport de sécurité **avant** d'être ajoutée à `vagues_actives`.
- **Porte « Pars d'un parfum que tu aimes »** : les notes publiées des parfums sont à collecter à part, sur les sites des marques, dans [notes_publiees.json](notes_publiees.json). Les 3 exemples actuels sont marqués « à vérifier ». Allume ensuite les deux interrupteurs (voir LISEZMOI, étape 9). Vérifie d'abord avec un juriste l'usage des noms de marque.
- **IFRA, 52e amendement** (attendu en janvier 2027) : mets à jour [ifra_cat4.json](ifra_cat4.json), puis demande de nouveaux certificats à tes fournisseurs. Un certificat d'un ancien amendement rend la note indisponible.

## À savoir

- Toutes les valeurs de départ sont **provisoires** :
  - puissance, ténacité et doses maximum ;
  - matrice, facettes et exceptions ;
  - recettes et prix.
- Les lots DEMO sont **fictifs** : ne jamais fabriquer avec. L'atelier refuse d'ailleurs la pesée et l'étiquette.
- Le moteur applique la limite **la plus sévère** entre l'IFRA et la loi européenne. Pour quatre substances (isoeugénol, hydroxycitronellal, méthyl 2-octynoate, cétones de rose), la loi est plus stricte que l'IFRA. Les plafonds du règlement 2026/909 (citral, salicylate de benzyle) sont déjà appliqués.
- Pour l'harmonie, le poids des sous-familles est passé de 25 à 30 (au lieu des 25 du cahier). Sans ce changement, deux recettes cuir restaient sous 70.
