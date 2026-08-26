-- Audit trail for leave changes (docs/ISSUES.md #8).
--
-- Bookings can be edited, dragged and cancelled inside a 90-day backdate
-- window, and every one of those overwrites what was there before. This records
-- who did what, and to whose booking — an admin editing someone else's leave is
-- the case that most needs a record.
--
-- Snapshots are stored as JSON rather than as columns mirroring
-- leave_requests: the trail must keep meaning when the booking table changes
-- shape, and a mirrored schema silently stops recording a field the day someone
-- adds one.

CREATE TABLE IF NOT EXISTS leave_audit (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	leave_id      TEXT NOT NULL,
	actor_email   TEXT NOT NULL,          -- who made the change
	subject_email TEXT NOT NULL,          -- whose leave it is
	action        TEXT NOT NULL,          -- created | edited | cancelled
	at            TEXT NOT NULL,          -- Bangkok-local timestamp
	before        TEXT,                   -- JSON snapshot, absent on create
	after         TEXT                    -- JSON snapshot, absent on cancel
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON leave_audit (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_leave ON leave_audit (leave_id);
