-- THE1500 Sprint 0. Architectural seed, subject to Claude's schema review.
-- Designed for Cloudflare D1 (SQLite). Execute on a NEW DB only.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL,
  industry TEXT,
  public_summary TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','generated','owner_approved','published','withdrawn')),
  approved_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS slots (
  number INTEGER PRIMARY KEY CHECK (number BETWEEN 1 AND 1500),
  phase INTEGER NOT NULL CHECK (phase BETWEEN 1 AND 4),
  price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents IN (10000,40000,100000,506600)),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','held','assigned','retired')),
  company_id TEXT UNIQUE REFERENCES companies(id),
  held_until TEXT,
  assignment_kind TEXT CHECK (assignment_kind IN ('paid','founder','premium')),
  CHECK (
    (number BETWEEN 1 AND 600 AND phase = 1 AND price_usd_cents = 10000) OR
    (number BETWEEN 601 AND 1050 AND phase = 2 AND price_usd_cents = 40000) OR
    (number BETWEEN 1051 AND 1350 AND phase = 3 AND price_usd_cents = 100000) OR
    (number BETWEEN 1351 AND 1500 AND phase = 4 AND price_usd_cents = 506600)
  )
);
CREATE INDEX IF NOT EXISTS idx_slots_status_phase ON slots(status,phase,number);

CREATE TABLE IF NOT EXISTS profile_versions (
  company_id TEXT NOT NULL REFERENCES companies(id),
  version INTEGER NOT NULL CHECK (version > 0),
  canonical_json TEXT NOT NULL,
  public_jsonld TEXT,
  approved_by TEXT,
  approved_at TEXT,
  published_at TEXT,
  PRIMARY KEY (company_id, version)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  slot_number INTEGER UNIQUE REFERENCES slots(number),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','expired','refunded','disputed')),
  price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents >= 0),
  charged_currency TEXT NOT NULL,
  charged_amount_minor INTEGER NOT NULL CHECK (charged_amount_minor >= 0),
  provider_reference TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payment_events (
  provider_event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  digest TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  outcome TEXT NOT NULL
);

-- Exactly 1,500 numbered slots. An existing slot is never duplicated.
INSERT OR IGNORE INTO slots(number, phase, price_usd_cents)
WITH RECURSIVE sequence(n) AS (
  SELECT 1
  UNION ALL SELECT n + 1 FROM sequence WHERE n < 1500
)
SELECT n,
  CASE WHEN n <= 600 THEN 1 WHEN n <= 1050 THEN 2 WHEN n <= 1350 THEN 3 ELSE 4 END,
  CASE WHEN n <= 600 THEN 10000 WHEN n <= 1050 THEN 40000 WHEN n <= 1350 THEN 100000 ELSE 506600 END
FROM sequence;
