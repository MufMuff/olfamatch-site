-- Base de données (Cloudflare D1) du programme Olfamatch « Crée ton parfum ».
-- À appliquer une fois (et après chaque mise à jour de ce fichier) :
--   npx wrangler d1 execute olfamatch --remote --file=schema.sql
-- Les commandes « CREATE TABLE IF NOT EXISTS » ne touchent pas aux données déjà là.

-- Formules : la forme canonique gardée au moment où le code est créé.
CREATE TABLE IF NOT EXISTS formules (
  code TEXT PRIMARY KEY,                 -- OLF-XXXXX-XXXXX
  hash_canonique TEXT NOT NULL,          -- SHA-256 de la forme canonique
  canonique TEXT NOT NULL,               -- OLF2;moteur=…;cadre=…;ifra=…;c=18;BER=25;…
  concentration REAL NOT NULL,
  notes TEXT NOT NULL,                   -- {"BER":25,…} en % du concentré
  moteur_version TEXT NOT NULL,
  cadre_version TEXT,
  ifra_amendement INTEGER NOT NULL,
  harmonie REAL,
  harmonie_libelle TEXT,
  porte TEXT,                            -- P1 à P5
  confirme INTEGER NOT NULL DEFAULT 0,   -- case « je comprends » cochée (mode expert)
  cree_le TEXT NOT NULL
);

-- Commandes : une ligne par session de paiement Stripe créée par le programme.
CREATE TABLE IF NOT EXISTS commandes (
  session_id TEXT PRIMARY KEY,           -- cs_…
  code TEXT NOT NULL,
  format TEXT NOT NULL,                  -- kit, 50 ou 100
  quantite INTEGER NOT NULL,
  prix_unitaire_centimes INTEGER NOT NULL,
  remise_centimes INTEGER NOT NULL DEFAULT 0,
  montant_attendu_centimes INTEGER NOT NULL,
  code_kit TEXT,                         -- code de réduction du kit utilisé
  statut TEXT NOT NULL,                  -- creee, payee, bloquee, pesee, en_maceration, prete, expediee
  raison_blocage TEXT,
  numero_lot TEXT UNIQUE,                -- LAAMM-NNNN
  lots TEXT,                             -- lots fournisseurs utilisés {"BER":"BER-2026-01",…}
  montant_recu_centimes INTEGER,
  nom_client TEXT,
  email_client TEXT,
  adresse TEXT,
  suivi TEXT,                            -- numéro de suivi du colis
  pesee TEXT,                            -- masses réelles pesées (JSON)
  maceration_debut TEXT,
  maceration_fin TEXT,
  cree_le TEXT NOT NULL,
  paye_le TEXT,
  maj_le TEXT
);
CREATE INDEX IF NOT EXISTS commandes_statut ON commandes (statut);

-- Notifications Stripe déjà traitées (anti-doublon).
CREATE TABLE IF NOT EXISTS evenements_stripe (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  session_id TEXT,
  recu_le TEXT NOT NULL
);

-- Archive des lots fournisseurs utilisés (à garder au moins 10 ans).
CREATE TABLE IF NOT EXISTS lots (
  lot TEXT PRIMARY KEY,
  code_note TEXT NOT NULL,
  donnees TEXT NOT NULL,                 -- copie du lot de matieres_lots.json au moment de son usage
  premier_usage TEXT NOT NULL
);

-- Stock de chaque flacon de stock, en grammes (tel qu'on le pèse, prédilution comprise).
CREATE TABLE IF NOT EXISTS stocks (
  code_note TEXT PRIMARY KEY,
  lot TEXT,
  grammes REAL NOT NULL,
  maj_le TEXT NOT NULL
);

-- Codes de réduction du kit (10 €, un seul usage, 90 jours, même formule).
CREATE TABLE IF NOT EXISTS codes_kit (
  code_promo TEXT PRIMARY KEY,
  formule TEXT NOT NULL,
  stripe_promotion_id TEXT NOT NULL,
  session_kit TEXT NOT NULL,
  expire_le TEXT NOT NULL,
  utilise INTEGER NOT NULL DEFAULT 0
);

-- Essais des recettes par Ethan (grille notée sur 5, stabilité).
CREATE TABLE IF NOT EXISTS essais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recette TEXT NOT NULL,
  date TEXT NOT NULL,
  tete REAL, coeur REAL, fond REAL, tenue_h REAL, sillage REAL,
  stabilite_ok INTEGER,                  -- 1 = aucun défaut, 0 = défaut, NULL = pas encore fait
  remarques TEXT,
  statut TEXT NOT NULL                   -- a_valider ou validee
);
