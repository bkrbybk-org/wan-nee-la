-- The week-ahead digest needs its own claim.
--
-- notification_runs was keyed on (date, channel). A Monday carries two posts —
-- the daily "out today" and the week-ahead — and with that key the first to run
-- would claim the day and suppress the second. `kind` separates them.
--
-- Rebuilt rather than altered because SQLite cannot extend a primary key, and
-- written to survive a replay: the old table is recreated empty if it has
-- already been renamed away, so the copy is a no-op the second time rather than
-- an error.

CREATE TABLE IF NOT EXISTS notification_runs_v2 (
	date    TEXT NOT NULL,
	kind    TEXT NOT NULL,                -- daily | week
	channel TEXT NOT NULL,                -- line | push
	sent_at TEXT NOT NULL,
	people  INTEGER NOT NULL,
	status  TEXT NOT NULL,                -- pending | sent | failed
	error   TEXT,
	PRIMARY KEY (date, kind, channel)
);

CREATE TABLE IF NOT EXISTS notification_runs (
	date    TEXT NOT NULL,
	channel TEXT NOT NULL,
	sent_at TEXT NOT NULL,
	people  INTEGER NOT NULL,
	status  TEXT NOT NULL,
	error   TEXT,
	PRIMARY KEY (date, channel)
);

-- Everything already recorded is a daily digest; the week-ahead did not exist.
INSERT OR IGNORE INTO notification_runs_v2 (date, kind, channel, sent_at, people, status, error)
	SELECT date, 'daily', channel, sent_at, people, status, error FROM notification_runs;

DROP TABLE notification_runs;
ALTER TABLE notification_runs_v2 RENAME TO notification_runs;
