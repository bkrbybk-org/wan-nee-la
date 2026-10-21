-- My leave marks bookings someone else last changed (`changedByOthers`),
-- which reads the audit trail by whose booking it was, on every load. The
-- trail is kept for three years and was indexed only by booking and by time.

CREATE INDEX IF NOT EXISTS idx_audit_subject ON leave_audit (subject_email, leave_id, id);
