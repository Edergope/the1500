-- THE1500 CORE-001: additive migration, non-destructive to Sprint 0 tables.
-- The legacy `orders` table is left untouched. New attempts use `purchase_attempts`.
-- Do not deploy directly to production without the project migration/reconciliation review.

ALTER TABLE slots ADD COLUMN active_hold_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_slots_active_hold ON slots(active_hold_id) WHERE active_hold_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slots_phase_open ON slots(phase, status, number);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'blocked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_digest TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK(role IN ('owner', 'editor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, company_id)
);

CREATE TABLE IF NOT EXISTS slot_holds (
  id TEXT PRIMARY KEY,
  slot_number INTEGER NOT NULL REFERENCES slots(number),
  company_id TEXT NOT NULL REFERENCES companies(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','expired','released','converted')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_holds_active_slot ON slot_holds(slot_number) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_holds_active_company ON slot_holds(company_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_slot_holds_expiry ON slot_holds(status, expires_at);

-- An order is an *attempt*: a single slot can have multiple historical attempts.
-- No actual payment may be inferred from return URLs; confirmation requires verified provider events.
CREATE TABLE IF NOT EXISTS purchase_attempts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  slot_number INTEGER NOT NULL REFERENCES slots(number),
  hold_id TEXT REFERENCES slot_holds(id),
  provider TEXT NOT NULL CHECK(provider IN ('stripe','bank','manual')),
  provider_reference TEXT UNIQUE,
  amount_usd_cents INTEGER NOT NULL CHECK(amount_usd_cents > 0),
  charged_currency TEXT NOT NULL DEFAULT 'USD',
  total_minor INTEGER NOT NULL CHECK(total_minor > 0),
  status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','expired','refunded','disputed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_purchase_attempts_slot ON purchase_attempts(slot_number,created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_attempts_company ON purchase_attempts(company_id,created_at);

CREATE TABLE IF NOT EXISTS verified_payment_events (
  provider_event_id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchase_attempts(id),
  event_type TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  signature_verified_at TEXT NOT NULL,
  applied_at TEXT,
  outcome TEXT NOT NULL
);

-- Append-only evidence of slot state changes.
CREATE TABLE IF NOT EXISTS slot_audit (
  event_id TEXT PRIMARY KEY,
  slot_number INTEGER NOT NULL REFERENCES slots(number),
  action TEXT NOT NULL CHECK(action IN ('hold','expire','release','assign_paid','assign_founder','retire')),
  company_id TEXT REFERENCES companies(id),
  reference_id TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_slot_audit_slot ON slot_audit(slot_number, occurred_at);
CREATE TRIGGER IF NOT EXISTS trg_slot_audit_no_update BEFORE UPDATE ON slot_audit
BEGIN SELECT RAISE(ABORT, 'slot_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_slot_audit_no_delete BEFORE DELETE ON slot_audit
BEGIN SELECT RAISE(ABORT, 'slot_audit is append-only'); END;

-- Free founder awards: up to 100 *active* positions, all within phase 1.
CREATE TABLE IF NOT EXISTS founder_awards (
  id TEXT PRIMARY KEY,
  slot_number INTEGER NOT NULL REFERENCES slots(number),
  company_id TEXT NOT NULL REFERENCES companies(id),
  approved_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  awarded_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_founder_active_slot ON founder_awards(slot_number) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_founder_active_company ON founder_awards(company_id) WHERE status='active';
CREATE TRIGGER IF NOT EXISTS trg_founder_phase_insert BEFORE INSERT ON founder_awards
WHEN (SELECT phase FROM slots WHERE number=NEW.slot_number) <> 1
BEGIN SELECT RAISE(ABORT,'founder award must be within phase 1'); END;
CREATE TRIGGER IF NOT EXISTS trg_founder_phase_update BEFORE UPDATE OF slot_number ON founder_awards
WHEN (SELECT phase FROM slots WHERE number=NEW.slot_number) <> 1
BEGIN SELECT RAISE(ABORT,'founder award must be within phase 1'); END;
CREATE TRIGGER IF NOT EXISTS trg_founder_limit_insert BEFORE INSERT ON founder_awards
WHEN NEW.status='active' AND (SELECT COUNT(*) FROM founder_awards WHERE status='active') >= 100
BEGIN SELECT RAISE(ABORT,'founder quota exhausted'); END;
CREATE TRIGGER IF NOT EXISTS trg_founder_limit_update BEFORE UPDATE OF status ON founder_awards
WHEN NEW.status='active' AND OLD.status<>'active' AND (SELECT COUNT(*) FROM founder_awards WHERE status='active') >= 100
BEGIN SELECT RAISE(ABORT,'founder quota exhausted'); END;

CREATE TABLE IF NOT EXISTS legal_seller_configuration (
  id INTEGER PRIMARY KEY CHECK(id=1),
  seller_entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'unapproved' CHECK(status IN ('unapproved','approved')),
  payment_provider TEXT NOT NULL DEFAULT 'stripe',
  payment_mode TEXT NOT NULL DEFAULT 'test' CHECK(payment_mode IN ('test','live')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(status='approved' OR payment_mode='test'),
  CHECK(status='unapproved' OR seller_entity_id IS NOT NULL)
);
INSERT OR IGNORE INTO legal_seller_configuration(id,status,payment_provider,payment_mode)
VALUES(1,'unapproved','stripe','test');
