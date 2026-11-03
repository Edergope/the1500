-- THE1500 CORE-004: founder invitations, trusted administration and public-only FTS5.
-- Never seed an admin from an unverified email or from a public API.
-- Bootstrap an admin only after manual verification of the account's user ID.
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  granted_at TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS founder_invitations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  invited_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','expired','revoked')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES users(id),
  CHECK(expires_at > created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_founder_one_pending_invite
  ON founder_invitations(company_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_founder_invitation_expiry ON founder_invitations(status,expires_at);
CREATE INDEX IF NOT EXISTS idx_founder_invitation_company ON founder_invitations(company_id,status);

CREATE TABLE IF NOT EXISTS admin_review_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  admin_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  reason_code TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_review_company ON admin_review_events(company_id,decided_at);
CREATE TRIGGER IF NOT EXISTS trg_review_no_update BEFORE UPDATE ON admin_review_events
BEGIN SELECT RAISE(ABORT,'admin review is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_review_no_delete BEFORE DELETE ON admin_review_events
BEGIN SELECT RAISE(ABORT,'admin review is append-only'); END;

-- FTS contains only text from a profile published after owner approval.
-- Source-of-truth visibility is *always* checked through companies and profile_versions.
CREATE VIRTUAL TABLE IF NOT EXISTS published_company_fts USING fts5(
  company_id UNINDEXED,
  name, industry, country, summary, services, problems, solutions,
  tokenize='unicode61 remove_diacritics 2'
);
-- Safely backfill already published and explicitly approved profiles when upgrading
-- a non-empty staging database. Never index drafts or unapproved versions.
INSERT INTO published_company_fts(company_id,name,industry,country,summary,services,problems,solutions)
SELECT c.id,c.display_name,COALESCE(c.industry,''),c.country,
  COALESCE(json_extract(v.canonical_json,'$.descriptionEn'),'' ) || ' ' ||
  COALESCE(json_extract(v.canonical_json,'$.descriptionEs'),''),
  COALESCE((SELECT group_concat(j.value,' ') FROM json_each(v.canonical_json,'$.services') j),''),
  COALESCE((SELECT group_concat(json_extract(j.value,'$.problem'),' ')
    FROM json_each(v.canonical_json,'$.problemSolutions') j),''),
  COALESCE((SELECT group_concat(json_extract(j.value,'$.solution'),' ')
    FROM json_each(v.canonical_json,'$.problemSolutions') j),'')
FROM companies c JOIN profile_versions v ON v.company_id=c.id
JOIN published_profile_snapshots p ON p.company_id=v.company_id AND p.version=v.version
WHERE c.publication_status='published' AND v.approved_at IS NOT NULL AND v.published_at IS NOT NULL
  AND v.version=(SELECT MAX(v2.version) FROM profile_versions v2
    JOIN published_profile_snapshots p2 ON p2.company_id=v2.company_id AND p2.version=v2.version
    WHERE v2.company_id=c.id AND v2.approved_at IS NOT NULL AND v2.published_at IS NOT NULL);

CREATE TRIGGER IF NOT EXISTS trg_fts_on_withdraw
AFTER UPDATE OF publication_status ON companies
WHEN NEW.publication_status <> 'published' AND OLD.publication_status = 'published'
BEGIN
  DELETE FROM published_company_fts WHERE company_id=NEW.id;
END;

-- Defense-in-depth: free founder awards must be recorded against a real founder
-- assignment in the dedicated 1..100 range, never against paid positions.
CREATE TRIGGER IF NOT EXISTS trg_founder_award_requires_slot BEFORE INSERT ON founder_awards
WHEN NEW.slot_number NOT BETWEEN 1 AND 100 OR NOT EXISTS(
  SELECT 1 FROM slots s WHERE s.number=NEW.slot_number AND s.company_id=NEW.company_id
    AND s.status='assigned' AND s.assignment_kind='founder')
BEGIN SELECT RAISE(ABORT,'founder award requires assigned reserved founder slot'); END;
