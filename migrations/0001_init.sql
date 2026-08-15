-- wan-nee-la initial schema.
-- All dates are Bangkok-local YYYY-MM-DD strings, never UTC timestamps. See docs/ISSUES.md #5.

CREATE TABLE IF NOT EXISTS users (
	email        TEXT PRIMARY KEY,          -- from the Access JWT, lowercased
	display_name TEXT NOT NULL,
	is_admin     INTEGER NOT NULL DEFAULT 0,
	active       INTEGER NOT NULL DEFAULT 1,
	created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_types (
	id           INTEGER PRIMARY KEY,
	code         TEXT NOT NULL UNIQUE,      -- annual | sick | personal | unpaid
	label_th     TEXT NOT NULL,
	label_en     TEXT NOT NULL,
	color        TEXT NOT NULL,             -- calendar chip color
	default_days REAL NOT NULL,             -- seeds a new year's quota rows
	counts_quota INTEGER NOT NULL DEFAULT 1,-- unpaid leave does not draw down a balance
	sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quotas (
	user_email    TEXT NOT NULL,
	year          INTEGER NOT NULL,
	leave_type_id INTEGER NOT NULL,
	days_allotted REAL NOT NULL,
	PRIMARY KEY (user_email, year, leave_type_id)
);

CREATE TABLE IF NOT EXISTS leave_requests (
	id            TEXT PRIMARY KEY,         -- crypto.randomUUID()
	user_email    TEXT NOT NULL,
	leave_type_id INTEGER NOT NULL,
	start_date    TEXT NOT NULL,            -- YYYY-MM-DD
	end_date      TEXT NOT NULL,            -- inclusive
	start_half    TEXT NOT NULL,            -- full | am | pm
	end_half      TEXT NOT NULL,
	days_total    REAL NOT NULL,            -- computed server-side, never trusted from the client
	note          TEXT,
	status        TEXT NOT NULL,            -- confirmed | cancelled
	created_at    TEXT NOT NULL,
	cancelled_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_leave_range ON leave_requests (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_user  ON leave_requests (user_email, start_date);

CREATE TABLE IF NOT EXISTS holidays (
	date  TEXT PRIMARY KEY,                 -- YYYY-MM-DD
	label TEXT NOT NULL
);

-- Phase 4. Created now so the cron stub can write to it without a second migration.
CREATE TABLE IF NOT EXISTS notification_log (
	date    TEXT PRIMARY KEY,               -- the leave date announced
	sent_at TEXT NOT NULL,
	people  INTEGER NOT NULL,
	status  TEXT NOT NULL,                  -- sent | skipped_empty | failed
	error   TEXT
);

CREATE TABLE IF NOT EXISTS app_config (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
