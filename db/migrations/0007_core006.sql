-- THE1500 CORE-006: owner decisions of 2026-11-04 on withdrawal, reactivation, late card payments and Premium.

-- ---------- Withdrawal: request and decision both leave a trace; legal requests are tracked apart ----------
ALTER TABLE service_requests ADD COLUMN legal_basis TEXT CHECK(legal_basis IN ('data_protection','illicit_content'));
ALTER TABLE service_requests ADD COLUMN legal_due_at TEXT;
ALTER TABLE service_requests ADD COLUMN origin TEXT NOT NULL DEFAULT 'owner' CHECK(origin IN ('owner','recorded_by_admin'));
ALTER TABLE service_requests ADD COLUMN channel_note TEXT;
ALTER TABLE service_requests ADD COLUMN resolution_evidence TEXT;
-- A voluntary request already open must not stop a legal one from being recorded.
DROP INDEX idx_service_request_open;
CREATE UNIQUE INDEX idx_service_request_open ON service_requests(company_id,kind,COALESCE(legal_basis,'none')) WHERE status='requested';

-- ---------- Reactivation: requested (until day 45), approved, notified. The 15 days start at notification ----------
CREATE TABLE onboarding_cases_v2 (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  origin TEXT NOT NULL CHECK(origin IN('paid','founder','premium')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','extended','suspended','reactivation_requested','reactivation_approved','reactivated','admin_review','completed','cancelled')),
  started_at TEXT NOT NULL,
  form_due_at TEXT NOT NULL,
  extension_due_at TEXT NOT NULL,
  reactivation_due_at TEXT NOT NULL,
  extended_at TEXT,
  suspended_at TEXT,
  reactivation_requested_at TEXT,
  admin_review_at TEXT,
  submitted_at TEXT,
  reactivation_approved_at TEXT,
  reactivation_approved_by TEXT REFERENCES users(id),
  reactivation_notified_at TEXT,
  reactivation_form_due_at TEXT
);
INSERT INTO onboarding_cases_v2(company_id,origin,status,started_at,form_due_at,extension_due_at,reactivation_due_at,extended_at,suspended_at,reactivation_requested_at,admin_review_at,submitted_at)
  SELECT company_id,origin,status,started_at,form_due_at,extension_due_at,reactivation_due_at,extended_at,suspended_at,reactivation_requested_at,admin_review_at,submitted_at FROM onboarding_cases;
DROP TABLE onboarding_cases;
ALTER TABLE onboarding_cases_v2 RENAME TO onboarding_cases;
CREATE INDEX idx_onboarding_status ON onboarding_cases(status,form_due_at);

-- ---------- Late card payments: the facts and the human resolution are kept with the attempt ----------
ALTER TABLE purchase_attempts ADD COLUMN paid_at_source TEXT CHECK(paid_at_source IN ('provider_charge','provider_event','processing_time'));
ALTER TABLE purchase_attempts ADD COLUMN late_resolution TEXT CHECK(late_resolution IN ('assigned','refund'));
ALTER TABLE purchase_attempts ADD COLUMN late_resolved_at TEXT;
ALTER TABLE purchase_attempts ADD COLUMN late_resolved_by TEXT REFERENCES users(id);
ALTER TABLE purchase_attempts ADD COLUMN late_resolution_evidence TEXT;

-- ---------- Premium, Decision 64: application form in the portal, human evaluation, no checkout ----------
ALTER TABLE premium_requests ADD COLUMN message TEXT;
ALTER TABLE premium_requests ADD COLUMN contact_preference TEXT CHECK(contact_preference IN ('email','meeting','no_preference'));
