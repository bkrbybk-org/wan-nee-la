/**
 * Leave counted over a span of time: the HR export and the per-month view on
 * /me.
 *
 * A booking's own `days_total` answers "what did this cost", charged to the
 * year it starts in. Reports ask a different question — how much leave fell
 * inside these dates — so a booking that crosses the edge of the span is cut
 * at it and counted again, with the same rules as booking: weekends and
 * holidays free, and a half-day only where the booking's own half falls
 * inside the span.
 */

import { countLeaveDays } from './dates.ts';
import type { LeaveEntry } from '../types.ts';

/** Leave days a booking uses between `from` and `to`, inclusive. */
export function daysWithin(e: LeaveEntry, from: string, to: string, holidays: ReadonlySet<string>): number {
	const start = e.start_date > from ? e.start_date : from;
	const end = e.end_date < to ? e.end_date : to;
	if (start > end) return 0;
	// A half belongs to the booking's own first or last day; where the span
	// cuts the booking, that edge is a full day.
	let startHalf = start === e.start_date ? e.start_half : 'full';
	let endHalf = end === e.end_date ? e.end_half : 'full';
	// Cut down to one day, it is a single-day booking with that day's half —
	// which `countLeaveDays` reads from the start half alone. The booking's
	// last morning, say, is `am` at both ends, not `full` then `am`.
	if (start === end) {
		const half = start === e.start_date ? e.start_half : end === e.end_date ? e.end_half : 'full';
		startHalf = half;
		endHalf = half;
	}
	const count = countLeaveDays(start, end, startHalf, endHalf, holidays);
	// A slice made only of days off is a legitimate zero, not an error.
	return count.ok ? count.days : 0;
}

export interface SummaryRow {
	email: string;
	name: string;
	typeEn: string;
	typeTh: string;
	days: number;
	bookings: number;
}

/** Days per person per leave type within the span, people by name. */
export function leaveSummary(
	entries: readonly LeaveEntry[],
	from: string,
	to: string,
	holidays: ReadonlySet<string>,
): SummaryRow[] {
	const rows = new Map<string, SummaryRow>();
	for (const e of entries) {
		const days = daysWithin(e, from, to, holidays);
		if (days === 0) continue;
		const key = `${e.user_email}\u0000${e.leave_type_id}`;
		const row = rows.get(key) ?? {
			email: e.user_email,
			name: e.display_name,
			typeEn: e.type_label_en,
			typeTh: e.type_label_th,
			days: 0,
			bookings: 0,
		};
		row.days += days;
		row.bookings += 1;
		rows.set(key, row);
	}
	return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.typeEn.localeCompare(b.typeEn));
}

export interface MonthTotals {
	/** 1–12. */
	month: number;
	/** Days by leave type id, only types with leave that month. */
	byType: Map<number, number>;
	total: number;
}

/** Leave days in each month of `year`, split by type. */
export function monthlyDays(entries: readonly LeaveEntry[], year: number, holidays: ReadonlySet<string>): MonthTotals[] {
	return Array.from({ length: 12 }, (_, i) => {
		const month = i + 1;
		const mm = String(month).padStart(2, '0');
		const from = `${year}-${mm}-01`;
		const to = `${year}-${mm}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
		const byType = new Map<number, number>();
		for (const e of entries) {
			const days = daysWithin(e, from, to, holidays);
			if (days > 0) byType.set(e.leave_type_id, (byType.get(e.leave_type_id) ?? 0) + days);
		}
		return { month, byType, total: [...byType.values()].reduce((a, b) => a + b, 0) };
	});
}

/**
 * One CSV cell. Quoted always, quotes doubled, and a leading = + - @ (or a tab
 * or carriage return) neutralised with an apostrophe: display names are typed
 * by employees, and a spreadsheet opening `=HYPERLINK(...)` would run it.
 */
function cell(value: string | number): string {
	let s = String(value);
	if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return `"${s.replace(/"/g, '""')}"`;
}

/**
 * A CSV file: CRLF line ends, as the format and Excel expect, and a UTF-8 byte
 * order mark so Excel reads the Thai labels as Thai rather than as mojibake.
 */
export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
	return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
