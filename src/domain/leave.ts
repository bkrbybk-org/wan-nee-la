/**
 * Booking rules and balance arithmetic. Pure functions — the repo layer supplies
 * the rows, this decides what they mean. Tested by `scripts/test-leave.mjs`.
 *
 * Everything a client sends is treated as untrusted: `days_total` is computed
 * here from the dates, never read from the request body. Otherwise a crafted
 * POST could book three weeks and claim it cost half a day.
 */

import { addDays, countLeaveDays, daysBetween, isValidDate, rangesOverlap, type Half } from './dates.ts';
import type { Balance, LeaveEntry, LeaveType, Quota } from '../types.ts';
import { msg, type Message, type StringKey } from '../i18n/strings.ts';

export const HALVES: readonly Half[] = ['full', 'am', 'pm'];

export function parseHalf(v: unknown): Half | null {
	return typeof v === 'string' && (HALVES as readonly string[]).includes(v) ? (v as Half) : null;
}

export interface BookingInput {
	leaveTypeId: number;
	startDate: string;
	endDate: string;
	startHalf: Half;
	endHalf: Half;
	note: string;
	/** True when only the booker and admins may read the note. */
	notePrivate: boolean;
}

export interface ExistingRange {
	id: string;
	start_date: string;
	end_date: string;
}

export interface BookingContext {
	holidays: ReadonlySet<string>;
	/** The user's other confirmed leave, used for the overlap check. */
	existing: readonly ExistingRange[];
	types: readonly LeaveType[];
	/** Remaining days per leave type id, for types that draw down quota. */
	remaining: ReadonlyMap<number, number>;
	/** Bangkok today — bookings are allowed in the past, but only so far. See MAX_BACKDATE_DAYS. */
	today: string;
}

export type Validated = { ok: true; days: number; type: LeaveType } | { ok: false; error: Message };

export const NOTE_MAX = 500;

/**
 * How far back leave may be booked. Sick leave is routinely entered after the
 * fact, so backdating has to be allowed; an unbounded window would let someone
 * quietly rewrite last year's balance.
 */
export const MAX_BACKDATE_DAYS = 90;

/** How far ahead. Guards against a typo'd year putting leave in 2126. */
export const MAX_FUTURE_DAYS = 550;

/**
 * The note this viewer is allowed to read, or null.
 *
 * One rule, one place. Every surface that renders or serialises a note goes
 * through here — the calendar's data attributes, the chip tooltip, the JSON
 * feed — so a new surface cannot quietly become the one that leaks.
 */
export function visibleNote(
	entry: { note: string | null; note_private: number; user_email: string },
	viewer: { email: string; is_admin: number },
): string | null {
	if (!entry.note) return null;
	if (!entry.note_private) return entry.note;
	return entry.user_email === viewer.email || viewer.is_admin ? entry.note : null;
}

export function parseBooking(form: Record<string, unknown>): BookingInput | { error: Message } {
	const leaveTypeId = Number(form.leaveTypeId ?? form.leave_type_id);
	if (!Number.isInteger(leaveTypeId) || leaveTypeId <= 0) return { error: msg('error.pickType') };

	const startDate = String(form.startDate ?? form.start_date ?? '').trim();
	// A blank end date means a single-day booking — the common case on mobile,
	// where filling a second date picker for one day off is pure friction.
	const endDate = String(form.endDate ?? form.end_date ?? '').trim() || startDate;

	if (!isValidDate(startDate)) return { error: msg('error.badStart') };
	if (!isValidDate(endDate)) return { error: msg('error.badEnd') };

	const startHalf = parseHalf(form.startHalf ?? form.start_half ?? 'full');
	const endHalf = parseHalf(form.endHalf ?? form.end_half ?? (startDate === endDate ? startHalf : 'full'));
	if (!startHalf || !endHalf) return { error: msg('error.badHalf') };

	const note = String(form.note ?? '').trim().slice(0, NOTE_MAX);
	// Private unless the booker asked to share. An unchecked checkbox submits
	// nothing at all, so absence has to mean private — the safe direction. The
	// drag-to-move path rebuilds the booking from data attributes and sends this
	// explicitly, which is what stops a dragged booking's note turning private.
	const notePrivate = String(form.noteVisibility ?? '') !== 'shared';

	return { leaveTypeId, startDate, endDate, startHalf, endHalf, note, notePrivate };
}

/**
 * Apply every booking rule. Order matters only for the error message the user
 * sees first, so the cheapest and most likely-wrong checks come first.
 */
export function validateBooking(input: BookingInput, ctx: BookingContext): Validated {
	const type = ctx.types.find((t) => t.id === input.leaveTypeId);
	if (!type) return { ok: false, error: msg('error.unknownType') };

	const count = countLeaveDays(input.startDate, input.endDate, input.startHalf, input.endHalf, ctx.holidays);
	if (!count.ok) return { ok: false, error: count.error };

	const backdate = daysBetween(input.startDate, ctx.today);
	if (backdate > MAX_BACKDATE_DAYS) {
		return { ok: false, error: msg('error.tooFarBack', { days: MAX_BACKDATE_DAYS }) };
	}
	if (daysBetween(ctx.today, input.endDate) > MAX_FUTURE_DAYS) {
		return { ok: false, error: msg('error.tooFarAhead') };
	}

	const clash = ctx.existing.find((e) => rangesOverlap(input.startDate, input.endDate, e.start_date, e.end_date));
	if (clash) {
		return { ok: false, error: msg('error.overlap', { start: clash.start_date, end: clash.end_date }) };
	}

	if (type.counts_quota) {
		const left = ctx.remaining.get(type.id) ?? 0;
		if (count.days > left) {
			return {
				ok: false,
				// The leave type's own name is data, not an interface string, and it
				// already carries a Thai label — so the reader's language picks which
				// of the two to drop in.
				error: msg('error.notEnough', { count: count.days, type: type.label_en.toLowerCase(), typeTh: type.label_th, days: count.days, left }),
			};
		}
	}

	return { ok: true, days: count.days, type };
}

/**
 * Balance per leave type for one user in one year.
 *
 * `used` counts confirmed leave only, and a leave request is attributed to the
 * year of its **start date** — a booking spanning New Year draws entirely from
 * the year it began in. Splitting it across two years would be more precise and
 * far more confusing on a dashboard that shows one year at a time.
 */
export function computeBalances(
	types: readonly LeaveType[],
	quotas: readonly Quota[],
	used: ReadonlyMap<number, number>,
): Balance[] {
	return [...types]
		.sort((a, b) => a.sort_order - b.sort_order)
		.map((type) => {
			const allotted = quotas.find((q) => q.leave_type_id === type.id)?.days_allotted ?? 0;
			const spent = used.get(type.id) ?? 0;
			return {
				type,
				allotted,
				used: spent,
				// Unpaid leave has no allowance to run down, so "remaining" is
				// meaningless for it; report 0 and let the view hide the bar.
				remaining: type.counts_quota ? round(allotted - spent) : 0,
			};
		});
}

/** Days are always multiples of 0.5, but float subtraction still yields 9.499999999. */
export function round(n: number): number {
	return Math.round(n * 2) / 2;
}

/** Index entries by every calendar date they cover, for the month grid. */
export function byDate(entries: readonly LeaveEntry[]): Map<string, LeaveEntry[]> {
	const map = new Map<string, LeaveEntry[]>();
	for (const e of entries) {
		for (let d = e.start_date; d <= e.end_date; d = addDays(d, 1)) {
			const list = map.get(d);
			if (list) list.push(e);
			else map.set(d, [e]);
		}
	}
	return map;
}

/** Which half of `date` an entry covers — drives the chip label on the calendar. */
export function halfOn(entry: LeaveEntry, date: string): Half {
	if (entry.start_date === entry.end_date) return entry.start_half;
	if (date === entry.start_date) return entry.start_half;
	if (date === entry.end_date) return entry.end_half;
	return 'full';
}

/**
 * Which form field a booking error is about.
 *
 * Every rejection above is a `Message` carrying a catalogue key, and every key
 * is raised by exactly one check, so the offending input is already known —
 * it is just not reported. Without it the only feedback is a sentence at the
 * top of the page, which on a five-field form leaves the reader hunting for
 * what to change.
 *
 * A table rather than a `field` on each error: the return types here are also
 * the contract `scripts/test-leave.mjs` and `scripts/test-dates.mjs` assert
 * against, and widening them for a presentation concern would be paying in the
 * domain for something only the form needs. The names are the `name`
 * attributes the form submits, which is the same vocabulary `parseBooking`
 * reads, so the two drift together or not at all.
 *
 * A key with no entry — anything raised outside the booking rules — simply has
 * no field, and the page-level message stands alone as it did before.
 */
const ERROR_FIELD: Partial<Record<StringKey, string>> = {
	'error.pickType': 'leaveTypeId',
	'error.unknownType': 'leaveTypeId',
	// The quota belongs to the leave type, and switching type is the usual way
	// out of this one — more usual than shortening the booking.
	'error.notEnough': 'leaveTypeId',
	'error.badStart': 'startDate',
	'error.tooFarBack': 'startDate',
	'error.notAWorkingDay': 'startDate',
	// The range is start-and-end, but only the start is guaranteed to be filled
	// in: a blank end date means a single day.
	'error.noWorkingDays': 'startDate',
	'error.overlap': 'startDate',
	'error.badEnd': 'endDate',
	'error.endBeforeStart': 'endDate',
	'error.tooFarAhead': 'endDate',
	'error.tooLong': 'endDate',
	'error.badHalf': 'startHalf',
	'error.halfOnMultiDay': 'startHalf',
};

export function fieldForError(m: Message): string | undefined {
	return ERROR_FIELD[m.key];
}
