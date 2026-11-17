-- ============================================================
-- PILOTE RÉSEAU — Base Cloudflare D1 : pilote-reseau-db
-- Migration 0001 (initiale) — dialecte SQLite/D1
-- Traduction fidèle de app/supabase/schema.sql (PostgreSQL)
-- Différences assumées :
--   * pas de RLS PostgreSQL : la sécurité est appliquée dans le
--     Worker (chaque requête vérifie le workspaceId du client).
--   * pas de fonction SQL consume_credit : le débit atomique se
--     fait par UPDATE ... WHERE balance > 0 (même garantie).
--   * identifiants = TEXT générés par l'application (crypto).
--   * dates = TEXT ISO 8601 (datetime('now') par défaut).
-- Ne jamais stocker de mot de passe en clair : auth_salt + auth_hash.
-- Les tokens sociaux sont chiffrés AES-256-GCM côté serveur.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- Utilisateurs, profils, rôles ----------
CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  full_name   TEXT,
  login       TEXT NOT NULL UNIQUE,            -- téléphone ou email normalisé
  auth_salt   TEXT NOT NULL,                   -- sel (jamais le mot de passe)
  auth_hash   TEXT NOT NULL,                   -- hachage du mot de passe
  role        TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','admin')),
  phone       TEXT,
  country     TEXT,
  language    TEXT NOT NULL DEFAULT 'fr',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,                -- hachage du jeton (jamais le jeton)
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------- Espaces de travail (une entreprise = un espace) ----------
CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);

-- ---------- Assistants IA ----------
CREATE TABLE IF NOT EXISTS assistants (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp','facebook','instagram','tiktok')),
  mission         TEXT NOT NULL DEFAULT 'repondre',
  instructions    TEXT NOT NULL DEFAULT '',
  tone            TEXT,
  language        TEXT NOT NULL DEFAULT 'fr',
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  handoff_enabled INTEGER NOT NULL DEFAULT 1 CHECK (handoff_enabled IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistants_ws ON assistants(workspace_id);

-- ---------- Comptes sociaux connectés (tokens chiffrés) ----------
CREATE TABLE IF NOT EXISTS connected_accounts (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel                 TEXT NOT NULL CHECK (channel IN ('whatsapp','facebook','instagram','tiktok')),
  external_id             TEXT NOT NULL,       -- phone_number_id / Page ID / IG ID
  display_name            TEXT,
  access_token_encrypted  TEXT NOT NULL,       -- AES-256-GCM, jamais en clair
  token_expires_at        TEXT,
  status                  TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','expired','error')),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (channel, external_id)
);
CREATE INDEX IF NOT EXISTS idx_accounts_ws ON connected_accounts(workspace_id);

-- ---------- Base de connaissances ----------
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assistant_id TEXT REFERENCES assistants(id) ON DELETE SET NULL,
  type         TEXT NOT NULL CHECK (type IN ('text','pdf','url','faq')),
  title        TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  file_path    TEXT,                            -- futur R2 (étape ultérieure)
  status       TEXT NOT NULL DEFAULT 'ready',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_ws ON knowledge_sources(workspace_id);

-- ---------- Conversations et messages ----------
CREATE TABLE IF NOT EXISTS conversations (
  id                       TEXT PRIMARY KEY,
  workspace_id             TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assistant_id             TEXT REFERENCES assistants(id) ON DELETE SET NULL,
  channel                  TEXT NOT NULL CHECK (channel IN ('whatsapp','facebook','instagram','tiktok')),
  external_conversation_id TEXT,
  contact_external_id      TEXT NOT NULL,
  contact_name             TEXT,
  contact_phone            TEXT,
  status                   TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','human','closed','paused')),
  assigned_to              TEXT REFERENCES profiles(id),
  last_message_at          TEXT,
  last_inbound_at          TEXT,                -- fenêtre 24 h Meta
  unread_count             INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conv_workspace ON conversations(workspace_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction           TEXT NOT NULL CHECK (direction IN ('in','out')),
  sender              TEXT NOT NULL CHECK (sender IN ('contact','ai','human','system')),
  content             TEXT NOT NULL,
  external_message_id TEXT UNIQUE,              -- anti-doublon webhook
  credits_used        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'sent',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

-- ---------- Commentaires (Facebook / Instagram / TikTok) ----------
CREATE TABLE IF NOT EXISTS comments (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id       TEXT REFERENCES connected_accounts(id) ON DELETE SET NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('facebook','instagram','tiktok')),
  external_comment_id TEXT UNIQUE,              -- anti-doublon webhook
  post_external_id TEXT,
  author_name      TEXT,
  content          TEXT NOT NULL,
  ai_reply         TEXT,
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','human','ignored')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_ws ON comments(workspace_id, created_at DESC);

-- ---------- Publications ----------
CREATE TABLE IF NOT EXISTS posts (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id       TEXT REFERENCES connected_accounts(id) ON DELETE SET NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('whatsapp','facebook','instagram','tiktok')),
  external_post_id TEXT,
  content          TEXT,
  media_path       TEXT,                        -- futur R2
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','failed')),
  published_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Automatisations / campagnes ----------
CREATE TABLE IF NOT EXISTS automations (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assistant_id TEXT REFERENCES assistants(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  trigger      TEXT NOT NULL DEFAULT 'message' CHECK (trigger IN ('message','comment','keyword','schedule')),
  config       TEXT NOT NULL DEFAULT '{}',      -- JSON
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Plans, crédits, paiements ----------
CREATE TABLE IF NOT EXISTS plans (
  code             TEXT PRIMARY KEY CHECK (code IN ('starter','standard','pro','premium','business')),
  name             TEXT NOT NULL,
  price_monthly    REAL NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  credits_included INTEGER NOT NULL,
  max_assistants   INTEGER NOT NULL,
  features         TEXT NOT NULL DEFAULT '{}'   -- JSON
);
INSERT OR IGNORE INTO plans(code,name,price_monthly,credits_included,max_assistants) VALUES
  ('starter','Starter',2,500,1),
  ('standard','Standard',5,1500,2),
  ('pro','Pro',10,3500,3),
  ('premium','Premium',25,6000,5),
  ('business','Business',59,10000,99);

CREATE TABLE IF NOT EXISTS credit_accounts (
  workspace_id    TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  balance         INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  plan            TEXT NOT NULL DEFAULT 'starter' REFERENCES plans(code),
  plan_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  amount       INTEGER NOT NULL,
  type         TEXT NOT NULL,
  reference    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_ws ON credit_transactions(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,                -- saspay, flutterwave…
  provider_ref    TEXT UNIQUE,
  amount          REAL NOT NULL,
  currency        TEXT NOT NULL,                -- devise réellement débitée
  amount_usd      REAL,                         -- prix de référence USD
  method          TEXT,
  country         TEXT,                         -- pays choisi par le client
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  credits_granted INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_ws ON payments(workspace_id, created_at DESC);

-- ---------- Notifications et passages à un humain ----------
CREATE TABLE IF NOT EXISTS handoff_alerts (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  reason          TEXT,
  notified_via    TEXT,
  is_read         INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  is_read      INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Paramètres + journal des opérations ----------
CREATE TABLE IF NOT EXISTS settings (
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,  -- NULL = plateforme
  key          TEXT NOT NULL,
  value        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS operation_log (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  actor        TEXT,
  action       TEXT NOT NULL,
  detail       TEXT,                            -- jamais de secret en clair
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oplog_ws ON operation_log(workspace_id, created_at DESC);
