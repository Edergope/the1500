-- THE1500 CORE-007: provider-neutral mail. Which provider took each notification, and why one was refused.
ALTER TABLE notifications ADD COLUMN provider TEXT;
ALTER TABLE notifications ADD COLUMN provider_message_id TEXT;
ALTER TABLE notifications ADD COLUMN failure_code TEXT;
