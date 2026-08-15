/**
 * Date math for leave. Pure functions, no I/O, no bindings — everything here is
 * unit-testable from `scripts/test-dates.mjs`.
 *
 * Two rules the rest of the codebase depends on:
 *
 *  1. A leave date is a calendar date, not an instant. It is always a
 *     `YYYY-MM-DD` string in Asia/Bangkok. Never a `Date`, never a UTC
 *     timestamp. Storing instants produces off-by-one-day bugs at the
 *     UTC/Bangkok boundary (17:00–23:59 UTC is already tomorrow in Bangkok).
 *  2. Nothing outside this file calls `new Date()` for date logic. Use
 *     `bangkokToday()`. Workers run in UTC; the host clock is not Bangkok.
 *
 * Thailand is UTC+7 year-round and has never observed DST, so the offset is a
 * constant rather than a timezone lookup.
 */

export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export type Half = 'full' | 'am' | 'pm';

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in Bangkok. The only clock read in the app. */
export function bangkokToday(now: Date = new Date()): string {
	return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Current Bangkok-local wall time as an ISO-ish stamp, for `created_at` columns. */
export function bangkokNow(now: Date = new Date()): string {
	return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().replace('Z', '+07:00');
}

/**
 * True when `s` is a real calendar date in `YYYY-MM-DD` form.
 * Rejects `2026-02-30` and friends, which `Date` would silently roll over.
 */
export function isValidDate(s: string): boolean {
	if (!ISO_DATE.test(s)) return false;
	const [y, m, d] = s.split('-').map(Number);
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUTC(iso: string): number {
	const [y, m, d] = iso.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
	return fromUTC(toUTC(iso) + n * 86_400_000);
}

/** Whole days from `a` to `b`. Negative when `b` precedes `a`. */
export function daysBetween(a: string, b: string): number {
	return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): number {
	return new Date(toUTC(iso)).getUTCDay();
}

export function isWeekend(iso: string): boolean {
	const d = dayOfWeek(iso);
	return d === 0 || d === 6;
}

/** Every date from `start` to `end` inclusive. Empty when `end` precedes `start`. */
export function eachDate(start: string, end: string): string[] {
	const out: string[] = [];
	const last = toUTC(end);
	for (let t = toUTC(start); t <= last; t += 86_400_000) out.push(fromUTC(t));
	return out;
}

/** A day that draws down quota: not a weekend, not a company holiday. */
export function isWorkday(iso: string, holidays: ReadonlySet<string>): boolean {
	return !isWeekend(iso) && !holidays.has(iso);
}

/** Workdays in the inclusive range, weekends and holidays removed. */
export function workdaysIn(start: string, end: string, holidays: ReadonlySet<string>): string[] {
	return eachDate(start, end).filter((d) => isWorkday(d, holidays));
}

export type DayCount = { ok: true; days: number } | { ok: false; error: string };

/**
 * Days of quota a request consumes.
 *
 * Half-day model, deliberately narrow so the arithmetic stays checkable:
 *
 *   single day  (start === end)  startHalf must equal endHalf.
 *                                'full' → 1, 'am' → 0.5 (morning), 'pm' → 0.5 (afternoon).
 *   multi day   (start < end)    startHalf ∈ full | pm   ('pm' = starts after lunch)
 *                                endHalf   ∈ full | am   ('am' = ends at lunch)
 *
 * A half only discounts a day that was going to count in the first place — a
 * range ending `am` on a Saturday subtracts nothing, because Saturday never
 * contributed.
 *
 * A range containing no workdays at all is an error, not a zero-day booking:
 * silently accepting it would put a phantom entry on the calendar.
 */
export function countLeaveDays(
	start: string,
	end: string,
	startHalf: Half,
	endHalf: Half,
	holidays: ReadonlySet<string>,
): DayCount {
	if (!isValidDate(start)) return { ok: false, error: `invalid start date: ${start}` };
	if (!isValidDate(end)) return { ok: false, error: `invalid end date: ${end}` };
	if (daysBetween(start, end) < 0) return { ok: false, error: 'end date is before start date' };

	const single = start === end;

	if (single) {
		if (startHalf !== endHalf) {
			return { ok: false, error: 'a single-day request must use the same half for start and end' };
		}
		if (!isWorkday(start, holidays)) {
			return { ok: false, error: 'that day is a weekend or a public holiday' };
		}
		return { ok: true, days: startHalf === 'full' ? 1 : 0.5 };
	}

	if (startHalf === 'am') return { ok: false, error: 'a multi-day request cannot start with a morning-only day' };
	if (endHalf === 'pm') return { ok: false, error: 'a multi-day request cannot end with an afternoon-only day' };

	const workdays = workdaysIn(start, end, holidays);
	if (workdays.length === 0) {
		return { ok: false, error: 'that range contains no working days' };
	}

	let days = workdays.length;
	if (startHalf === 'pm' && isWorkday(start, holidays)) days -= 0.5;
	if (endHalf === 'am' && isWorkday(end, holidays)) days -= 0.5;

	return { ok: true, days };
}

/** True when the two inclusive ranges share at least one calendar day. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
	return aStart <= bEnd && bStart <= aEnd;
}

export function firstOfMonth(year: number, month: number): string {
	return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function lastOfMonth(year: number, month: number): string {
	return fromUTC(Date.UTC(year, month, 0));
}

/**
 * Dates for a month grid, padded to whole weeks starting Monday — Thai work
 * weeks read Mon–Sun, and a Monday-first grid puts the weekend together at the
 * right where it is easy to skip over.
 */
export function monthGrid(year: number, month: number): string[] {
	const first = firstOfMonth(year, month);
	const lead = (dayOfWeek(first) + 6) % 7; // Monday = 0
	const startAt = addDays(first, -lead);
	const last = lastOfMonth(year, month);
	const trail = (7 - ((dayOfWeek(last) + 6) % 7) - 1 + 7) % 7;
	return eachDate(startAt, addDays(last, trail));
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
	const total = year * 12 + (month - 1) + delta;
	return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month: number): string {
	return MONTH_NAMES[month - 1] ?? '';
}

/** "15 Aug" — compact enough for a calendar chip. */
export function shortDate(iso: string): string {
	const [, m, d] = iso.split('-').map(Number);
	return `${d} ${monthName(m).slice(0, 3)}`;
}

export function formatDays(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** How a request's dates read in a list: "15 Aug", "15–19 Aug", "15 Aug (PM)". */
export function describeRange(start: string, end: string, startHalf: Half, endHalf: Half): string {
	const half = (h: Half) => (h === 'am' ? ' (AM)' : h === 'pm' ? ' (PM)' : '');
	if (start === end) return `${shortDate(start)}${half(startHalf)}`;
	return `${shortDate(start)}${half(startHalf)} – ${shortDate(end)}${half(endHalf)}`;
}
