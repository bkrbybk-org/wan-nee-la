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

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

/** Confirmed leave overlapping [from, to], for the calendar. */
export async function listLeaveInRange(db: D1Database, from: string, to: string): Promise<LeaveEntry[]> {
	const res = await db
		.prepare(
			`SELECT ${ENTRY_COLUMNS} ${ENTRY_FROM}
			 WHERE r.status = 'confirmed' AND r.start_date <= ? AND r.end_date >= ?
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
