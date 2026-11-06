-- ADMIN-002: external providers managed from the panel, with their credentials encrypted.
-- It waited in db/pending until ADMIN-002 had its own deploy (DEPLOY-002, phase C, 2026-11-06).
-- No row here is required. Without them the Worker keeps reading its own configuration, as before.

-- Critical integration changes need a sign-in link opened in the last 15 minutes.
ALTER TABLE sessions ADD COLUMN reauthenticated_at TEXT;
CREATE TABLE IF NOT EXISTS reauth_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_digest TEXT NOT NULL UNIQUE,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  session_id TEXT REFERENCES sessions(id),
  CHECK (expires_at > requested_at)
);
CREATE INDEX IF NOT EXISTS idx_reauth_user ON reauth_challenges(user_id, requested_at);

-- Envelope encryption: each value has its own data key, and only that key is encrypted with the master key,
-- which lives in a Worker secret and never in D1. No route returns `ciphertext`; `last4` is all the panel shows.
CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic','openai','gemini','stripe','mercadopago','resend')),
  environment TEXT NOT NULL CHECK (environment IN ('default','test')),
  name TEXT NOT NULL CHECK (name IN ('api_key','secret_key','webhook_secret','access_token','public_key')),
  version INTEGER NOT NULL CHECK (version >= 1),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  wrap_iv TEXT NOT NULL,
  master_key_version INTEGER NOT NULL,
  last4 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','replaced','disabled')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  retired_at TEXT,
  retired_by TEXT REFERENCES users(id),
  UNIQUE (provider, environment, name, version)
);
-- One active value per slot: a replacement and its predecessor cannot both be live.
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_credentials_active ON provider_credentials(provider, environment, name) WHERE status = 'active';

-- A provider with a row here is managed from the panel; one without keeps the Worker configuration.
CREATE TABLE IF NOT EXISTS provider_settings (
  provider TEXT PRIMARY KEY CHECK (provider IN ('anthropic','openai','gemini','stripe','mercadopago','cloudflare_email','resend')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  settings_json TEXT NOT NULL DEFAULT '{}',
  last_check_at TEXT,
  last_check_ok INTEGER CHECK (last_check_ok IN (0,1)),
  last_check_code TEXT,
  last_check_detail TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);

-- Which provider and model each use of AI runs on. The AI never publishes: approval stays with the owner.
CREATE TABLE IF NOT EXISTS ai_function_config (
  function TEXT PRIMARY KEY CHECK (function IN ('profile_generation','assistant')),
  provider TEXT NOT NULL CHECK (provider IN ('anthropic','openai','gemini')),
  model TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);

-- The one active mail provider, chosen from the panel.
CREATE TABLE IF NOT EXISTS integration_choices (
  kind TEXT PRIMARY KEY CHECK (kind IN ('mail')),
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare_email','resend')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);
