/**
 * D1 access. Every query lives here so the route handlers stay free of SQL and
 * the domain modules stay free of bindings.
 *
 * All statements are parameterised — no string interpolation into SQL anywhere
 * in this file, including for values that "obviously" came from our own tables.
 */

import { bangkokNow } from '../domain/dates.ts';
import { computeBalances } from '../domain/leave.ts';
import type { Balance, Holiday, LeaveEntry, LeaveRequest, LeaveType, Quota, User } from '../types.ts';

const ENTRY_COLUMNS = `
	r.id, r.user_email, r.leave_type_id, r.start_date, r.end_date,
	r.start_half, r.end_half, r.days_total, r.note, r.status,
	r.created_at, r.cancelled_at,
	COALESCE(u.display_name, r.user_email) AS display_name,
	t.code  AS type_code,
	t.label_en AS type_label_en,
	t.label_th AS type_label_th,
	t.color AS color
`;

const ENTRY_FROM = `
	FROM leave_requests r
	LEFT JOIN users u ON u.email = r.user_email
	JOIN leave_types t ON t.id = r.leave_type_id
`;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUser(db: D1Database, email: string): Promise<User | null> {
	return await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
}

export async function listUsers(db: D1Database): Promise<User[]> {
	const res = await db.prepare('SELECT * FROM users ORDER BY active DESC, display_name').all<User>();
	return res.results ?? [];
}

/**
 * Ensure a row exists for an authenticated Access identity, and give them this
 * year's quotas.
 *
 * The very first user to sign in becomes an admin — otherwise a fresh
 * deployment has no way to reach /admin and no way to grant anyone access to
 * it. Every later user is a normal user.
 */
export async function ensureUser(db: D1Database, email: string, year: number): Promise<User> {
	const existing = await getUser(db, email);
	if (existing) {
		await ensureQuotas(db, email, year);
		return existing;
	}

	const count = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
	const isFirst = (count?.n ?? 0) === 0;
	const displayName = defaultDisplayName(email);

	await db
		.prepare('INSERT OR IGNORE INTO users (email, display_name, is_admin, active, created_at) VALUES (?, ?, ?, 1, ?)')
		.bind(email, displayName, isFirst ? 1 : 0, bangkokNow())
		.run();

	await ensureQuotas(db, email, year);
	return (await getUser(db, email))!;
}

/** "chatchai.w" -> "Chatchai W" — a placeholder the user can correct on /me. */
export function defaultDisplayName(email: string): string {
	const local = email.split('@')[0] ?? email;
	return (
		local
			.split(/[._-]+/)
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ') || email
	);
}

export async function setDisplayName(db: D1Database, email: string, name: string): Promise<void> {
	await db.prepare('UPDATE users SET display_name = ? WHERE email = ?').bind(name, email).run();
}

export async function setWeekStart(db: D1Database, email: string, weekStart: number): Promise<void> {
	await db.prepare('UPDATE users SET week_start = ? WHERE email = ?').bind(weekStart, email).run();
}

export async function setAdmin(db: D1Database, email: string, isAdmin: boolean): Promise<void> {
	await db.prepare('UPDATE users SET is_admin = ? WHERE email = ?').bind(isAdmin ? 1 : 0, email).run();
}

export async function setActive(db: D1Database, email: string, active: boolean): Promise<void> {
	await db.prepare('UPDATE users SET active = ? WHERE email = ?').bind(active ? 1 : 0, email).run();
}

// ---------------------------------------------------------------------------
// Leave types, holidays
// ---------------------------------------------------------------------------

export async function listLeaveTypes(db: D1Database): Promise<LeaveType[]> {
	const res = await db.prepare('SELECT * FROM leave_types ORDER BY sort_order, id').all<LeaveType>();
	return res.results ?? [];
}

export async function listHolidays(db: D1Database, from: string, to: string): Promise<Holiday[]> {
	const res = await db
		.prepare('SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date')
		.bind(from, to)
		.all<Holiday>();
	return res.results ?? [];
}

export async function holidaySet(db: D1Database, from: string, to: string): Promise<Set<string>> {
	return new Set((await listHolidays(db, from, to)).map((h) => h.date));
}

export async function addHoliday(db: D1Database, date: string, label: string): Promise<void> {
	await db.prepare('INSERT OR REPLACE INTO holidays (date, label) VALUES (?, ?)').bind(date, label).run();
}

export async function removeHoliday(db: D1Database, date: string): Promise<void> {
	await db.prepare('DELETE FROM holidays WHERE date = ?').bind(date).run();
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

export async function listQuotas(db: D1Database, email: string, year: number): Promise<Quota[]> {
	const res = await db
		.prepare('SELECT * FROM quotas WHERE user_email = ? AND year = ?')
		.bind(email, year)
		.all<Quota>();
	return res.results ?? [];
}

/** Seed any missing quota rows for the year from `leave_types.default_days`. */
export async function ensureQuotas(db: D1Database, email: string, year: number): Promise<void> {
	await db
		.prepare(
			`INSERT OR IGNORE INTO quotas (user_email, year, leave_type_id, days_allotted)
			 SELECT ?, ?, id, default_days FROM leave_types`,
		)
		.bind(email, year)
		.run();
}

export async function setQuota(
	db: D1Database,
	email: string,
	year: number,
	leaveTypeId: number,
	days: number,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO quotas (user_email, year, leave_type_id, days_allotted) VALUES (?, ?, ?, ?)
			 ON CONFLICT (user_email, year, leave_type_id) DO UPDATE SET days_allotted = excluded.days_allotted`,
		)
		.bind(email, year, leaveTypeId, days)
		.run();
}

/**
 * Set one leave type's quota for every active user. `db.batch()` sends the
 * whole set as one round trip instead of N sequential awaits — a 40-person
 * team is 40 batched statements, not 40 network round trips.
 */
export async function bulkSetQuota(db: D1Database, year: number, leaveTypeId: number, days: number): Promise<number> {
	const active = await db.prepare('SELECT email FROM users WHERE active = 1').all<{ email: string }>();
	const emails = (active.results ?? []).map((u) => u.email);
	if (emails.length === 0) return 0;

	const stmt = db.prepare(
		`INSERT INTO quotas (user_email, year, leave_type_id, days_allotted) VALUES (?, ?, ?, ?)
		 ON CONFLICT (user_email, year, leave_type_id) DO UPDATE SET days_allotted = excluded.days_allotted`,
	);
	await db.batch(emails.map((email) => stmt.bind(email, year, leaveTypeId, days)));
	return emails.length;
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

/**
 * Confirmed leave overlapping [from, to], for the shared calendar / JSON feed /
 * LINE digest — the three surfaces that answer "who of us is out". A
 * deactivated user's leave is excluded here only; admin-facing queries
 * (listUserLeave, usedByType, confirmedRanges) are untouched so their history
 * and balances stay intact.
 *
 * `u` is a LEFT JOIN, so `u.active` is NULL when the user row is missing
 * entirely (never actually true today, but nothing guarantees it stays that
 * way). That absence has nothing to do with the active/inactive decision, so
 * treat NULL as "not deactivated" rather than filtering the row out for an
 * unrelated reason — only an explicit `active = 0` hides a row.
 */
export async function listLeaveInRange(db: D1Database, from: string, to: string): Promise<LeaveEntry[]> {
	const res = await db
		.prepare(
			`SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM}
			 WHERE r.status = 'confirmed' AND r.start_date <= ? AND r.end_date >= ?
			 AND (u.active IS NULL OR u.active = 1)
			 ORDER BY r.start_date, display_name`,
		)
		.bind(to, from)
		.all<LeaveEntry>();
	return res.results ?? [];
}

export async function listUserLeave(db: D1Database, email: string, year: number): Promise<LeaveEntry[]> {
	const res = await db
		.prepare(
			`SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM}
			 WHERE r.user_email = ? AND r.start_date BETWEEN ? AND ?
			 ORDER BY r.start_date DESC`,
		)
		.bind(email, `${year}-01-01`, `${year}-12-31`)
		.all<LeaveEntry>();
	return res.results ?? [];
}

/** Confirmed ranges for a user, for the overlap check. Cancelled rows do not block. */
export async function confirmedRanges(
	db: D1Database,
	email: string,
): Promise<{ id: string; start_date: string; end_date: string }[]> {
	const res = await db
		.prepare(`SELECT id, start_date, end_date FROM leave_requests WHERE user_email = ? AND status = 'confirmed'`)
		.bind(email)
		.all<{ id: string; start_date: string; end_date: string }>();
	return res.results ?? [];
}

/** Days used per leave type for a user in a year. Attributed by start date. */
export async function usedByType(db: D1Database, email: string, year: number): Promise<Map<number, number>> {
	const res = await db
		.prepare(
			`SELECT leave_type_id, SUM(days_total) AS days
			 FROM leave_requests
			 WHERE user_email = ? AND status = 'confirmed' AND start_date BETWEEN ? AND ?
			 GROUP BY leave_type_id`,
		)
		.bind(email, `${year}-01-01`, `${year}-12-31`)
		.all<{ leave_type_id: number; days: number }>();
	return new Map((res.results ?? []).map((r) => [r.leave_type_id, r.days]));
}

export async function insertLeave(db: D1Database, row: LeaveRequest): Promise<void> {
	await db
		.prepare(
			`INSERT INTO leave_requests
			 (id, user_email, leave_type_id, start_date, end_date, start_half, end_half, days_total, note, status, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
		)
		.bind(
			row.id,
			row.user_email,
			row.leave_type_id,
			row.start_date,
			row.end_date,
			row.start_half,
			row.end_half,
			row.days_total,
			row.note,
			row.created_at,
		)
		.run();
}

export async function getLeave(db: D1Database, id: string): Promise<LeaveRequest | null> {
	return await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(id).first<LeaveRequest>();
}

/** The same row as `getLeave`, with the display fields the edit page renders. */
export async function getLeaveEntry(db: D1Database, id: string): Promise<LeaveEntry | null> {
	return await db
		.prepare(`SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM} WHERE r.id = ?`)
		.bind(id)
		.first<LeaveEntry>();
}

/**
 * Rewrite a booking in place.
 *
 * The `status = 'confirmed'` guard means a cancelled booking cannot be edited
 * back into existence — cancelling is the way out, and re-booking is the way
 * back in, so the balance arithmetic only ever has one path to reason about.
 */
export async function updateLeave(
	db: D1Database,
	id: string,
	row: Pick<
		LeaveRequest,
		'leave_type_id' | 'start_date' | 'end_date' | 'start_half' | 'end_half' | 'days_total' | 'note'
	>,
): Promise<boolean> {
	const res = await db
		.prepare(
			`UPDATE leave_requests
			 SET leave_type_id = ?, start_date = ?, end_date = ?, start_half = ?, end_half = ?, days_total = ?, note = ?
			 WHERE id = ? AND status = 'confirmed'`,
		)
		.bind(
			row.leave_type_id,
			row.start_date,
			row.end_date,
			row.start_half,
			row.end_half,
			row.days_total,
			row.note,
			id,
		)
		.run();
	return (res.meta.changes ?? 0) > 0;
}

/**
 * Cancel a request. Returns false when nothing was cancelled — a wrong id, or a
 * row already cancelled. The status guard in the WHERE clause makes a double
 * submit a no-op rather than rewriting `cancelled_at`.
 */
export async function cancelLeave(db: D1Database, id: string): Promise<boolean> {
	const res = await db
		.prepare(`UPDATE leave_requests SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'confirmed'`)
		.bind(bangkokNow(), id)
		.run();
	return (res.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// App config (LINE group id)
// ---------------------------------------------------------------------------

export async function getConfig(db: D1Database, key: string): Promise<string | null> {
	const row = await db.prepare('SELECT value FROM app_config WHERE key = ?').bind(key).first<{ value: string }>();
	return row?.value ?? null;
}

export async function setConfig(db: D1Database, key: string, value: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO app_config (key, value) VALUES (?, ?)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
		)
		.bind(key, value)
		.run();
}

// ---------------------------------------------------------------------------
// Notification log
// ---------------------------------------------------------------------------

export type NotifyChannel = 'line' | 'push';

export interface NotificationRun {
	date: string;
	channel: NotifyChannel;
	sent_at: string;
	people: number;
	status: string;
	error: string | null;
}

/**
 * Claim the right to notify for `date` on `channel`.
 *
 * Returns false when a row already exists, which means some earlier run already
 * handled this date on this channel. This is the guard against posting twice to
 * a company group chat — cron can fire more than once, and a manual re-run is
 * one curl away.
 *
 * The row is claimed *before* the push is attempted, so a crash mid-send fails
 * closed (no message) rather than open (two messages). A genuinely failed send
 * is visible in /admin and can be retried deliberately via `clearNotification`.
 *
 * Per channel, not per date: a LINE failure must not stop the browsers being
 * told, and a LINE success must not claim the date out from under them.
 */
export async function claimNotification(
	db: D1Database,
	date: string,
	channel: NotifyChannel,
	people: number,
): Promise<boolean> {
	const res = await db
		.prepare(
			`INSERT OR IGNORE INTO notification_runs (date, channel, sent_at, people, status)
			 VALUES (?, ?, ?, ?, 'pending')`,
		)
		.bind(date, channel, bangkokNow(), people)
		.run();
	return (res.meta.changes ?? 0) > 0;
}

export async function finishNotification(
	db: D1Database,
	date: string,
	channel: NotifyChannel,
	status: 'sent' | 'skipped_empty' | 'failed',
	error?: string,
): Promise<void> {
	await db
		.prepare('UPDATE notification_runs SET status = ?, error = ?, sent_at = ? WHERE date = ? AND channel = ?')
		.bind(status, error ?? null, bangkokNow(), date, channel)
		.run();
}

/** Drop a log row so a failed date can be retried. Both channels when unspecified. */
export async function clearNotification(db: D1Database, date: string, channel?: NotifyChannel): Promise<void> {
	if (channel) {
		await db.prepare('DELETE FROM notification_runs WHERE date = ? AND channel = ?').bind(date, channel).run();
		return;
	}
	await db.prepare('DELETE FROM notification_runs WHERE date = ?').bind(date).run();
}

export async function recentNotifications(db: D1Database, limit = 14): Promise<NotificationRun[]> {
	const res = await db
		.prepare('SELECT * FROM notification_runs ORDER BY date DESC, channel LIMIT ?')
		.bind(limit)
		.all<NotificationRun>();
	return res.results ?? [];
}

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------

export interface StoredSubscription {
	endpoint: string;
	user_email: string;
	p256dh: string;
	auth: string;
}

/**
 * Store a browser's subscription.
 *
 * Keyed on the endpoint, and the owner is overwritten along with the keys: the
 * same browser profile re-subscribing after a different person signed in must
 * end up owned by whoever is signed in now, not by whoever registered it first.
 */
export async function saveSubscription(
	db: D1Database,
	sub: { endpoint: string; p256dh: string; auth: string },
	email: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO push_subscriptions (endpoint, user_email, p256dh, auth, created_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(endpoint) DO UPDATE SET user_email = excluded.user_email,
			                                     p256dh = excluded.p256dh,
			                                     auth = excluded.auth`,
		)
		.bind(sub.endpoint, email, sub.p256dh, sub.auth, bangkokNow())
		.run();
}

/** Remove one subscription. Scoped to its owner so an endpoint cannot be unsubscribed by someone else. */
export async function deleteSubscription(db: D1Database, endpoint: string, email: string): Promise<boolean> {
	const res = await db
		.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_email = ?')
		.bind(endpoint, email)
		.run();
	return (res.meta.changes ?? 0) > 0;
}

/** Dropped by the sender when a push service reports the subscription gone. */
export async function deleteSubscriptionByEndpoint(db: D1Database, endpoint: string): Promise<void> {
	await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
}

export async function subscriptionsFor(db: D1Database, email: string): Promise<StoredSubscription[]> {
	const res = await db
		.prepare('SELECT endpoint, user_email, p256dh, auth FROM push_subscriptions WHERE user_email = ?')
		.bind(email)
		.all<StoredSubscription>();
	return res.results ?? [];
}

/**
 * Every subscription belonging to someone still active.
 *
 * Deactivated people drop off the digest the same way they drop off the shared
 * calendar — one rule, applied in the query rather than remembered at each call
 * site.
 */
export async function activeSubscriptions(db: D1Database): Promise<StoredSubscription[]> {
	const res = await db
		.prepare(
			`SELECT s.endpoint, s.user_email, s.p256dh, s.auth
			   FROM push_subscriptions s
			   JOIN users u ON u.email = s.user_email
			  WHERE u.active = 1`,
		)
		.all<StoredSubscription>();
	return res.results ?? [];
}

export async function markSubscriptionSeen(db: D1Database, endpoint: string): Promise<void> {
	await db.prepare('UPDATE push_subscriptions SET last_seen = ? WHERE endpoint = ?').bind(bangkokNow(), endpoint).run();
}

// ---------------------------------------------------------------------------
// Composites
// ---------------------------------------------------------------------------

/** Everything the personal dashboard needs, in one place. */
export async function balancesFor(
	db: D1Database,
	email: string,
	year: number,
	types: readonly LeaveType[],
): Promise<Balance[]> {
	const [quotas, used] = await Promise.all([listQuotas(db, email, year), usedByType(db, email, year)]);
	return computeBalances(types, quotas, used);
}
