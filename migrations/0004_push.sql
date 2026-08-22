-- Browser push notifications.
--
-- One row per browser, not per person: someone with a laptop and a phone has
-- two subscriptions, and each has its own endpoint and keys. The endpoint is
-- the natural primary key — the push service issues it, and it is what the
-- browser hands back when it re-subscribes.

CREATE TABLE IF NOT EXISTS push_subscriptions (
	endpoint   TEXT PRIMARY KEY,          -- issued by the browser's push service
	user_email TEXT NOT NULL,
	p256dh     TEXT NOT NULL,             -- the browser's public key, base64url
	auth       TEXT NOT NULL,             -- shared secret for the encryption, base64url
	created_at TEXT NOT NULL,
	last_seen  TEXT                       -- last successful push; NULL until one lands
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_email);

-- The notification log becomes per-channel, as `notification_runs`.
--
-- It was keyed on the date alone, which was right while LINE was the only
-- channel. With two, one row cannot say "LINE failed but the browsers got it" —
-- and worse, the LINE row would claim the date and silently suppress the push.
-- SQLite cannot alter a primary key, so this is a new table.
--
-- Written to survive being applied twice, because `npm run db:init` replays
-- every file in this directory. The old table is recreated empty if it is
-- already gone, so the copy below is a no-op on a second run rather than an
-- error — and rows can never be re-stamped as 'line' after the fact.

CREATE TABLE IF NOT EXISTS notification_runs (
	date    TEXT NOT NULL,
	channel TEXT NOT NULL,                -- line | push
	sent_at TEXT NOT NULL,
	people  INTEGER NOT NULL,
	status  TEXT NOT NULL,                -- pending | sent | failed
	error   TEXT,
	PRIMARY KEY (date, channel)
);

CREATE TABLE IF NOT EXISTS notification_log (
	date    TEXT PRIMARY KEY,
	sent_at TEXT NOT NULL,
	people  INTEGER NOT NULL,
	status  TEXT NOT NULL,
	error   TEXT
);

-- Everything already in the old table is LINE by definition; nothing else could
-- have written it.
INSERT OR IGNORE INTO notification_runs (date, channel, sent_at, people, status, error)
	SELECT date, 'line', sent_at, people, status, error FROM notification_log;

DROP TABLE notification_log;
