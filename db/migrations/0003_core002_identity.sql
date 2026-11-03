-- CORE-002: passwordless identity, verified ownership, idempotent reservations.
-- Apply after 0001_init.sql and 0002_core001.sql, on staging first.
-- Challenges never contain raw magic links. A challenge is one-use by conditional state update.
CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  token_digest TEXT NOT NULL UNIQUE,
  ip_digest TEXT,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  session_id TEXT UNIQUE,
  CHECK(expires_at > requested_at)
);
CREATE INDEX IF NOT EXISTS idx_login_challenges_limit_email ON login_challenges(email,requested_at);
CREATE INDEX IF NOT EXISTS idx_login_challenges_limit_ip ON login_challenges(ip_digest,requested_at);

ALTER TABLE slot_holds ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE slot_holds ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hold_user_idempotency
  ON slot_holds(user_id,idempotency_key)
  WHERE user_id IS NOT NULL AND idempotency_key IS NOT NULL;

ALTER TABLE companies ADD COLUMN website TEXT;
ALTER TABLE companies ADD COLUMN identity_state TEXT NOT NULL DEFAULT 'pending_review'
  CHECK(identity_state IN ('self_declared','pending_review','admin_verified','rejected'));
ALTER TABLE companies ADD COLUMN authority_declared_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_website ON companies(website) WHERE website IS NOT NULL AND identity_state IN ('self_declared','admin_verified');

CREATE TABLE IF NOT EXISTS auth_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('login_requested','login_completed','logout','registration')),
  occurred_at TEXT NOT NULL,
  details_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit(user_id,occurred_at);
