-- ADMIN-001 follow-up: indexes for the control center lists. Indexes only: no table, no trigger, no data change.
-- Kept outside db/migrations on purpose: `wrangler d1 migrations apply` would otherwise ship it with 0010.
-- Move it to db/migrations/0011_admin_indexes.sql only at step 5 of docs/ADMIN_STAGED_DEPLOY.md.

-- Companies list, newest first: walks the index and stops at the page instead of sorting every company.
CREATE INDEX IF NOT EXISTS idx_companies_created ON companies(created_at DESC, id);
-- Owner of a company and the owner-email filter. The primary key starts with user_id, so it cannot answer by company.
CREATE INDEX IF NOT EXISTS idx_memberships_company ON memberships(company_id, role, user_id);
-- Profiles list, newest first. The expression must match the ORDER BY in listProfileVersions exactly.
CREATE INDEX IF NOT EXISTS idx_profile_versions_recent ON profile_versions(COALESCE(created_at, published_at, '') DESC, company_id, version DESC);
-- Audit log, newest first, and its action filter.
CREATE INDEX IF NOT EXISTS idx_admin_events_recent ON admin_events(occurred_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_admin_events_action ON admin_events(action, occurred_at DESC);

-- DEPLOY-002: the five-minute cron. Each deadline query seeks the cases that are due instead of reading every case,
-- so an idle register costs the same few rows whatever its size.
CREATE INDEX IF NOT EXISTS idx_onboarding_extension_due ON onboarding_cases(status, extension_due_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_reactivation_due ON onboarding_cases(status, reactivation_due_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_reactivation_form_due ON onboarding_cases(status, reactivation_form_due_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_final_notice_due ON onboarding_cases(status, final_notice_due_at);
CREATE INDEX IF NOT EXISTS idx_onboarding_resolution_open ON onboarding_cases(resolution_due_at) WHERE resolved_at IS NULL;
