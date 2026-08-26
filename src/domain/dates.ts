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

import { msg, type Message } from '../i18n/strings.ts';

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

export type DayCount = { ok: true; days: number } | { ok: false; error: Message };

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
	if (!isValidDate(start)) return { ok: false, error: msg('error.badStart') };
	if (!isValidDate(end)) return { ok: false, error: msg('error.badEnd') };
	if (daysBetween(start, end) < 0) return { ok: false, error: msg('error.endBeforeStart') };

	const single = start === end;

	if (single) {
		if (startHalf !== endHalf) {
			return { ok: false, error: msg('error.badHalf') };
		}
		if (!isWorkday(start, holidays)) {
			return { ok: false, error: msg('error.notAWorkingDay') };
		}
		return { ok: true, days: startHalf === 'full' ? 1 : 0.5 };
	}

	if (startHalf === 'am') return { ok: false, error: msg('error.halfOnMultiDay') };
	if (endHalf === 'pm') return { ok: false, error: msg('error.halfOnMultiDay') };

	const workdays = workdaysIn(start, end, holidays);
	if (workdays.length === 0) {
		return { ok: false, error: msg('error.noWorkingDays') };
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
 * Which day a week starts on, as a JS day number so it compares directly with
 * `dayOfWeek()`. Monday is the default: a Mon-first grid puts Saturday and
 * Sunday together at the right, where the eye can skip them.
 */
export type WeekStart = 0 | 1;
export const MONDAY: WeekStart = 1;
export const SUNDAY: WeekStart = 0;

export function parseWeekStart(v: unknown): WeekStart | null {
	// `Number('')` is 0, so an empty or whitespace-only field would otherwise be
	// read as Sunday and silently rotate someone's calendar.
	if (typeof v === 'string' && v.trim() === '') return null;
	const n = typeof v === 'string' ? Number(v) : v;
	return n === 0 || n === 1 ? (n as WeekStart) : null;
}

/** Position of `date` within its week, 0-indexed from `weekStart`. */
export function indexInWeek(date: string, weekStart: WeekStart = MONDAY): number {
	return (dayOfWeek(date) - weekStart + 7) % 7;
}

/**
 * Dates for a month grid, padded to whole weeks.
 *
 * `weekStart` only rotates the columns. Weekends stay Saturday and Sunday and
 * no quota arithmetic depends on this — it is presentation, not policy.
 */
export function monthGrid(year: number, month: number, weekStart: WeekStart = MONDAY): string[] {
	const first = firstOfMonth(year, month);
	const startAt = addDays(first, -indexInWeek(first, weekStart));
	const last = lastOfMonth(year, month);
	// Pad forward to the last day of that week: the column index of the final
	// day subtracted from the last column.
	const trail = 6 - indexInWeek(last, weekStart);
	return eachDate(startAt, addDays(last, trail));
}

/**
 * Names, by language.
 *
 * Thai years stay Gregorian rather than Buddhist Era. Both are used in Thailand
 * — B.E. on official documents, C.E. in most software — and a calendar that
 * silently showed 2569 next to a date field the browser fills with 2026 would
 * be worse than one that is consistently plain. Flip `THAI_YEAR_OFFSET` if the
 * office wants B.E.
 */
const DAY_NAMES = {
	en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
	th: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'],
};

const DAY_NAMES_FULL = {
	en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
	th: ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'],
};

/** 0 keeps the Gregorian year; 543 would make it Buddhist Era. */
const THAI_YEAR_OFFSET = 0;

type DateLang = 'en' | 'th';

/** Column headings in the order the grid renders them. */
export function weekdayLabels(weekStart: WeekStart = MONDAY, lang: DateLang = 'en'): string[] {
	return Array.from({ length: 7 }, (_, i) => DAY_NAMES[lang][(weekStart + i) % 7]);
}

/**
 * "Monday 17 August 2026" — spoken form.
 *
 * A calendar cell shows a bare number, which reads as a stray digit out of
 * context. Assistive technology gets this instead.
 */
export function longDate(iso: string, lang: DateLang = 'en'): string {
	const [y, m, dd] = iso.split('-').map(Number);
	const year = lang === 'th' ? y + THAI_YEAR_OFFSET : y;
	return `${DAY_NAMES_FULL[lang][dayOfWeek(iso)]} ${dd} ${monthName(m, lang)} ${year}`;
}

/** Split a run of dates into rows of seven, for a month table. */
export function intoWeeks(dates: readonly string[]): string[][] {
	const weeks: string[][] = [];
	for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
	return weeks;
}

/** The short name of a date's own weekday, independent of column order. */
export function weekdayName(date: string, lang: DateLang = 'en'): string {
	return DAY_NAMES[lang][dayOfWeek(date)];
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
	const total = year * 12 + (month - 1) + delta;
	return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

const MONTH_NAMES = {
	en: [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December',
	],
	th: [
		'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
		'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
	],
};

const MONTH_SHORT = {
	en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
	th: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
};

export function monthName(month: number, lang: DateLang = 'en'): string {
	return MONTH_NAMES[lang][month - 1] ?? '';
}

/**
 * "15 Aug" — compact enough for a calendar chip.
 *
 * Thai abbreviations are their own forms ("ส.ค."), not the first three
 * characters of the full name, which would produce nonsense.
 */
export function shortDate(iso: string, lang: DateLang = 'en'): string {
	const [, m, d] = iso.split('-').map(Number);
	return `${d} ${MONTH_SHORT[lang][m - 1] ?? ''}`;
}

export function formatDays(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** How a request's dates read in a list: "15 Aug", "15–19 Aug", "15 Aug (PM)". */
export function describeRange(
	start: string,
	end: string,
	startHalf: Half,
	endHalf: Half,
	lang: DateLang = 'en',
): string {
	const half = (h: Half) =>
		h === 'am' ? (lang === 'th' ? ' (เช้า)' : ' (AM)') : h === 'pm' ? (lang === 'th' ? ' (บ่าย)' : ' (PM)') : '';
	if (start === end) return `${shortDate(start, lang)}${half(startHalf)}`;
	return `${shortDate(start, lang)}${half(startHalf)} – ${shortDate(end, lang)}${half(endHalf)}`;
}
