-- CORE-003 semantic profile MVP: owner-declared facts, explicit approval, public snapshot.
-- Deterministic Schema.org JSON-LD now; LLM suggestions and R2 snapshots are subsequent work.
ALTER TABLE profile_versions ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'
  CHECK(locale IN('en','es'));
ALTER TABLE profile_versions ADD COLUMN description_es TEXT;
ALTER TABLE profile_versions ADD COLUMN public_jsonld_es TEXT;
ALTER TABLE profile_versions ADD COLUMN created_at TEXT;

CREATE TABLE IF NOT EXISTS owner_profile_declarations (
  company_id TEXT NOT NULL REFERENCES companies(id),
  version INTEGER NOT NULL,
  declaration_json TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  PRIMARY KEY(company_id,version),
  FOREIGN KEY(company_id,version) REFERENCES profile_versions(company_id,version)
);
CREATE TABLE IF NOT EXISTS profile_approvals (
  company_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  content_digest TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY(company_id,version),
  FOREIGN KEY(company_id,version) REFERENCES profile_versions(company_id,version)
);
CREATE TABLE IF NOT EXISTS published_profile_snapshots (
  company_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  jsonld_digest TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY(company_id,version),
  FOREIGN KEY(company_id,version) REFERENCES profile_versions(company_id,version)
);
CREATE TRIGGER IF NOT EXISTS trg_snapshots_no_update BEFORE UPDATE ON published_profile_snapshots
BEGIN SELECT RAISE(ABORT,'published snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_snapshots_no_delete BEFORE DELETE ON published_profile_snapshots
BEGIN SELECT RAISE(ABORT,'published snapshot is immutable'); END;
CREATE INDEX IF NOT EXISTS idx_profiles_publication ON profile_versions(company_id,published_at,version);
CREATE INDEX IF NOT EXISTS idx_companies_published ON companies(publication_status,country,industry);

-- Additional database-level guard: a public snapshot requires prior owner approval
-- and a valid assignment. Manual SQL cannot bypass this eligibility check.
CREATE TRIGGER IF NOT EXISTS trg_snapshot_requires_assigned_approved
BEFORE INSERT ON published_profile_snapshots
WHEN NOT EXISTS(
  SELECT 1 FROM profile_versions v JOIN slots s ON s.company_id=v.company_id
  WHERE v.company_id=NEW.company_id AND v.version=NEW.version
    AND v.approved_at IS NOT NULL AND v.published_at IS NOT NULL AND s.status='assigned'
)
BEGIN SELECT RAISE(ABORT,'publication requires approval and assigned slot'); END;
