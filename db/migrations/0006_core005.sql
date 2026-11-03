-- THE1500 CORE-005: paid path, irreversible publication, withdrawal, provenance, operations.
-- Rebuilds tables that no code has ever written (purchase_attempts, verified_payment_events)
-- and drops dead Sprint 0 tables. database_id was still a placeholder: no environment holds data.

DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS verified_payment_events;
DROP TABLE IF EXISTS purchase_attempts;

-- ---------- Inventory ----------
ALTER TABLE slots ADD COLUMN assigned_at TEXT;
ALTER TABLE slots ADD COLUMN first_published_at TEXT;

-- Decisions 17/29/30: once published, a position is consumed forever.
CREATE TRIGGER IF NOT EXISTS trg_slot_published_irreversible BEFORE UPDATE ON slots
WHEN OLD.first_published_at IS NOT NULL AND (
  NEW.status NOT IN ('assigned','retired') OR NEW.company_id IS NOT OLD.company_id
  OR NEW.first_published_at IS NOT OLD.first_published_at OR (OLD.status='retired' AND NEW.status<>'retired'))
BEGIN SELECT RAISE(ABORT,'published position cannot be released'); END;
CREATE TRIGGER IF NOT EXISTS trg_slot_no_delete BEFORE DELETE ON slots
BEGIN SELECT RAISE(ABORT,'slots cannot be deleted'); END;

-- Owner decision 2026-11-03 (Decision 05): founders hold exactly 1-100, paid tier 1 buyers 101-600.
CREATE TRIGGER IF NOT EXISTS trg_founder_range_reserved BEFORE UPDATE ON slots
WHEN (NEW.number<=100 AND (NEW.status='held' OR NEW.assignment_kind IN ('paid','premium')))
  OR (NEW.number>100 AND NEW.assignment_kind='founder')
BEGIN SELECT RAISE(ABORT,'positions 1-100 are founder positions, and only those'); END;
CREATE TRIGGER IF NOT EXISTS trg_phase4_no_checkout BEFORE UPDATE OF status ON slots
WHEN NEW.phase=4 AND NEW.status='held'
BEGIN SELECT RAISE(ABORT,'premium positions have no checkout'); END;

DROP TRIGGER IF EXISTS trg_slot_audit_no_update;
DROP TRIGGER IF EXISTS trg_slot_audit_no_delete;
CREATE TABLE slot_audit_v2 (
  event_id TEXT PRIMARY KEY,
  slot_number INTEGER NOT NULL REFERENCES slots(number),
  action TEXT NOT NULL CHECK(action IN ('hold','expire','release','assign_paid','assign_founder','assign_premium',
    'retire','first_publication','revoke_founder','refund_release','hold_moved')),
  company_id TEXT REFERENCES companies(id),
  reference_id TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO slot_audit_v2 SELECT event_id,slot_number,action,company_id,reference_id,occurred_at,metadata_json FROM slot_audit;
DROP TABLE slot_audit;
ALTER TABLE slot_audit_v2 RENAME TO slot_audit;
CREATE INDEX IF NOT EXISTS idx_slot_audit_slot ON slot_audit(slot_number, occurred_at);
CREATE TRIGGER trg_slot_audit_no_update BEFORE UPDATE ON slot_audit
BEGIN SELECT RAISE(ABORT, 'slot_audit is append-only'); END;
CREATE TRIGGER trg_slot_audit_no_delete BEFORE DELETE ON slot_audit
BEGIN SELECT RAISE(ABORT, 'slot_audit is append-only'); END;

-- ---------- Payments ----------
CREATE TABLE purchase_attempts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  hold_id TEXT NOT NULL REFERENCES slot_holds(id),
  phase INTEGER NOT NULL CHECK(phase BETWEEN 1 AND 3),
  assigned_slot_number INTEGER REFERENCES slots(number),
  provisional_slot_number INTEGER,
  settlement_id TEXT,
  provider TEXT NOT NULL CHECK(provider IN ('stripe','bank','manual')),
  provider_session_id TEXT UNIQUE,
  provider_payment_intent TEXT UNIQUE,
  amount_usd_cents INTEGER NOT NULL CHECK(amount_usd_cents > 0),
  tax_minor INTEGER NOT NULL DEFAULT 0,
  tax_status TEXT NOT NULL DEFAULT 'not_determined',
  charged_currency TEXT NOT NULL DEFAULT 'usd',
  total_minor INTEGER NOT NULL CHECK(total_minor > 0),
  seller_entity_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('creating','pending','paid','failed','expired','late_review','amount_review',
    'refund_pending','refunded','disputed','chargeback_lost')),
  idempotency_key TEXT NOT NULL UNIQUE,
  hold_expires_at TEXT NOT NULL,
  checkout_expires_at TEXT,
  paid_at TEXT,
  payer_email TEXT,
  refund_reason TEXT,
  refund_requested_at TEXT,
  refund_confirmed_at TEXT,
  provider_refund_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_purchase_status ON purchase_attempts(status,hold_expires_at);
CREATE INDEX idx_purchase_company ON purchase_attempts(company_id,created_at);
-- A company can never hold two simultaneously effective purchases, and a hold one open attempt.
CREATE UNIQUE INDEX idx_purchase_one_paid ON purchase_attempts(company_id) WHERE status='paid';
CREATE UNIQUE INDEX idx_purchase_one_open_per_hold ON purchase_attempts(hold_id) WHERE status IN ('creating','pending');

CREATE TABLE webhook_events (
  provider_event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  attempt_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  outcome TEXT
);

ALTER TABLE legal_seller_configuration ADD COLUMN seller_legal_name TEXT;
ALTER TABLE legal_seller_configuration ADD COLUMN seller_country TEXT;

-- ---------- Identity ----------
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en' CHECK(locale IN ('en','es'));
ALTER TABLE login_challenges ADD COLUMN locale TEXT NOT NULL DEFAULT 'en' CHECK(locale IN ('en','es'));

-- Decisions 10/11: evidence of consent and of the verifiable start of structuring.
CREATE TABLE consent_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('processing_authorization','purchase_terms','founder_terms','public_disclosure')),
  document_version TEXT NOT NULL,
  subject_digest TEXT,
  accepted_at TEXT NOT NULL
);
CREATE INDEX idx_consent_company ON consent_records(company_id,kind,accepted_at);
CREATE TRIGGER trg_consent_no_update BEFORE UPDATE ON consent_records
BEGIN SELECT RAISE(ABORT,'consent evidence is append-only'); END;
CREATE TRIGGER trg_consent_no_delete BEFORE DELETE ON consent_records
BEGIN SELECT RAISE(ABORT,'consent evidence is append-only'); END;

CREATE TABLE admin_events (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  reason_code TEXT,
  evidence_reference TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_admin_events_subject ON admin_events(subject_type,subject_id,occurred_at);
CREATE TRIGGER trg_admin_events_no_update BEFORE UPDATE ON admin_events
BEGIN SELECT RAISE(ABORT,'admin events are append-only'); END;
CREATE TRIGGER trg_admin_events_no_delete BEFORE DELETE ON admin_events
BEGIN SELECT RAISE(ABORT,'admin events are append-only'); END;

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL
);

-- ---------- Company lifecycle ----------
ALTER TABLE companies ADD COLUMN publication_block TEXT;
ALTER TABLE companies ADD COLUMN correction_window_ends_at TEXT;
ALTER TABLE companies ADD COLUMN guarantee_ends_at TEXT;
ALTER TABLE companies ADD COLUMN correction_override_until TEXT;
ALTER TABLE companies ADD COLUMN withdrawn_at TEXT;

CREATE TABLE service_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK(kind IN ('withdrawal','cancellation')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','completed','rejected')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  structuring_started_at TEXT,
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id),
  resolution_code TEXT
);
CREATE UNIQUE INDEX idx_service_request_open ON service_requests(company_id,kind) WHERE status='requested';

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
  company_id TEXT,
  attempt_id TEXT,
  dedupe_key TEXT UNIQUE,
  details_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES users(id),
  resolution_code TEXT
);
CREATE INDEX idx_incidents_status ON incidents(status,created_at);

-- Decisions 19-23/34. The clock starts at confirmed purchase or formal free award.
CREATE TABLE onboarding_cases (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  origin TEXT NOT NULL CHECK(origin IN ('paid','founder','premium')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','extended','suspended','reactivated','admin_review','completed','cancelled')),
  started_at TEXT NOT NULL,
  form_due_at TEXT NOT NULL,
  extension_due_at TEXT NOT NULL,
  reactivation_due_at TEXT NOT NULL,
  extended_at TEXT,
  suspended_at TEXT,
  reactivation_requested_at TEXT,
  admin_review_at TEXT,
  submitted_at TEXT
);
CREATE INDEX idx_onboarding_status ON onboarding_cases(status,form_due_at);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  company_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX idx_notifications_pending ON notifications(status,created_at);

-- Question 64 is pending: this is a channel-neutral administrative record only.
CREATE TABLE premium_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_review','accepted','rejected','assigned')),
  channel_note TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_premium_open ON premium_requests(company_id) WHERE status IN ('received','in_review','accepted');

-- ---------- Semantic profiles ----------
CREATE TABLE company_declarations (
  company_id TEXT NOT NULL REFERENCES companies(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  payload_json TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  language TEXT NOT NULL,
  form_version TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  processing_started_at TEXT,
  PRIMARY KEY(company_id,revision)
);
CREATE TRIGGER trg_declaration_content_immutable BEFORE UPDATE OF payload_json,payload_digest,submitted_by,submitted_at ON company_declarations
BEGIN SELECT RAISE(ABORT,'declarations are immutable'); END;
CREATE TRIGGER trg_declaration_no_delete BEFORE DELETE ON company_declarations
BEGIN SELECT RAISE(ABORT,'declarations are immutable'); END;

ALTER TABLE profile_versions ADD COLUMN declaration_revision INTEGER;
ALTER TABLE profile_versions ADD COLUMN generator_json TEXT;
ALTER TABLE profile_versions ADD COLUMN review_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK(review_status IN ('not_required','pending','cleared','rejected'));

-- An approved or published version can never change: the digest binds exactly what is public.
CREATE TRIGGER trg_profile_approved_immutable BEFORE UPDATE OF canonical_json,public_jsonld,public_jsonld_es,description_es ON profile_versions
WHEN OLD.approved_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'approved profile content is immutable'); END;
CREATE TRIGGER trg_profile_requires_review_clearance BEFORE UPDATE OF published_at ON profile_versions
WHEN NEW.published_at IS NOT NULL AND NEW.review_status IN ('pending','rejected')
BEGIN SELECT RAISE(ABORT,'profile requires administrative review'); END;

-- Rebuilt with stemming and tiers of evidence. Lexical retrieval: never described as semantic.
DROP TRIGGER IF EXISTS trg_fts_on_withdraw;
DROP TABLE IF EXISTS published_company_fts;
CREATE VIRTUAL TABLE published_company_fts USING fts5(
  company_id UNINDEXED,
  name, industry, country, summary, services, problems, solutions,
  tokenize='porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER trg_fts_on_withdraw
AFTER UPDATE OF publication_status ON companies
WHEN NEW.publication_status <> 'published' AND OLD.publication_status = 'published'
BEGIN
  DELETE FROM published_company_fts WHERE company_id=NEW.id;
END;
