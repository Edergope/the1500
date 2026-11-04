-- THE1500 CORE-008: administrative case handling already defined by Decisions 22-25, 28 and 45.

-- Decisions 22, 23, 34: final notice, 7 calendar days, then a reasoned decision within 5 business days.
ALTER TABLE onboarding_cases ADD COLUMN final_notice_requested_at TEXT;
ALTER TABLE onboarding_cases ADD COLUMN final_notice_requested_by TEXT REFERENCES users(id);
ALTER TABLE onboarding_cases ADD COLUMN final_notice_channel TEXT;
ALTER TABLE onboarding_cases ADD COLUMN final_notice_recipient TEXT;
ALTER TABLE onboarding_cases ADD COLUMN final_notice_evidence TEXT;
ALTER TABLE onboarding_cases ADD COLUMN final_notice_sent_at TEXT;
ALTER TABLE onboarding_cases ADD COLUMN final_notice_due_at TEXT;
ALTER TABLE onboarding_cases ADD COLUMN final_notice_response_at TEXT;
ALTER TABLE onboarding_cases ADD COLUMN final_notice_response TEXT;
ALTER TABLE onboarding_cases ADD COLUMN resolution_due_at TEXT;
ALTER TABLE onboarding_cases ADD COLUMN resolved_at TEXT;
ALTER TABLE onboarding_cases ADD COLUMN resolved_by TEXT REFERENCES users(id);
ALTER TABLE onboarding_cases ADD COLUMN resolution TEXT CHECK(resolution IN ('continue','cancel'));
ALTER TABLE onboarding_cases ADD COLUMN resolution_evidence TEXT;

-- Decisions 24, 25: deadline to order an approved refund, and the exceptional alternative method.
ALTER TABLE purchase_attempts ADD COLUMN refund_order_due_at TEXT;
ALTER TABLE purchase_attempts ADD COLUMN refund_method TEXT CHECK(refund_method IN ('original','alternative'));
ALTER TABLE purchase_attempts ADD COLUMN refund_operation_ref TEXT;
ALTER TABLE purchase_attempts ADD COLUMN refund_exception_json TEXT;

-- Decision 28: 15 calendar days to regularize a lost chargeback on a published profile.
ALTER TABLE purchase_attempts ADD COLUMN regularization_due_at TEXT;
ALTER TABLE purchase_attempts ADD COLUMN chargeback_resolution TEXT CHECK(chargeback_resolution IN ('regularized','unpublished','kept'));
ALTER TABLE purchase_attempts ADD COLUMN chargeback_resolved_at TEXT;
ALTER TABLE purchase_attempts ADD COLUMN chargeback_resolved_by TEXT REFERENCES users(id);
ALTER TABLE purchase_attempts ADD COLUMN chargeback_evidence TEXT;

-- Decision 45: payment by someone other than the account holder needs documented authorization.
ALTER TABLE purchase_attempts ADD COLUMN payer_review TEXT CHECK(payer_review IN ('required','authorized'));
ALTER TABLE purchase_attempts ADD COLUMN payer_authorization_ref TEXT;
ALTER TABLE purchase_attempts ADD COLUMN payer_authorized_at TEXT;
ALTER TABLE purchase_attempts ADD COLUMN payer_authorized_by TEXT REFERENCES users(id);
