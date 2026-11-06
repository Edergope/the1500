-- ADMIN-OPS: indexes for the operations screens. Indexes only: no table, no trigger, no data change.
-- Measured at 1,500 companies (tests/perf/ops.cjs): each queue reads what is open instead of every company or version.

-- Requests: identity reviews, profile reviews and open correction windows are few; each queue seeks only those.
CREATE INDEX IF NOT EXISTS idx_companies_identity_review ON companies(created_at) WHERE identity_state='pending_review';
CREATE INDEX IF NOT EXISTS idx_profile_versions_review ON profile_versions(created_at) WHERE review_status='pending';
CREATE INDEX IF NOT EXISTS idx_companies_correction ON companies(correction_override_until) WHERE correction_override_until IS NOT NULL;

-- Payments: newest first without sorting every attempt, and an attempt's incidents and provider events by key.
CREATE INDEX IF NOT EXISTS idx_purchase_created ON purchase_attempts(created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_incidents_attempt ON incidents(attempt_id, status) WHERE attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_attempt ON webhook_events(attempt_id) WHERE attempt_id IS NOT NULL;

-- A position's file: the attempts that held or took it.
CREATE INDEX IF NOT EXISTS idx_purchase_assigned_slot ON purchase_attempts(assigned_slot_number) WHERE assigned_slot_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_provisional_slot ON purchase_attempts(provisional_slot_number) WHERE provisional_slot_number IS NOT NULL;

-- Founders: invitations newest first.
CREATE INDEX IF NOT EXISTS idx_founder_invitation_created ON founder_invitations(created_at DESC);
