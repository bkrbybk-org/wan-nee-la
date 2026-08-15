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

export type Validated = { ok: true; days: number; type: LeaveType } | { ok: false; error: string };

export const NOTE_MAX = 500;

/**
 * How far back leave may be booked. Sick leave is routinely entered after the
 * fact, so backdating has to be allowed; an unbounded window would let someone
 * quietly rewrite last year's balance.
 */
export const MAX_BACKDATE_DAYS = 90;

/** How far ahead. Guards against a typo'd year putting leave in 2126. */
export const MAX_FUTURE_DAYS = 550;

export function parseBooking(form: Record<string, unknown>): BookingInput | { error: string } {
	const leaveTypeId = Number(form.leaveTypeId ?? form.leave_type_id);
	if (!Number.isInteger(leaveTypeId) || leaveTypeId <= 0) return { error: 'Pick a leave type.' };

	const startDate = String(form.startDate ?? form.start_date ?? '').trim();
	// A blank end date means a single-day booking — the common case on mobile,
	// where filling a second date picker for one day off is pure friction.
	const endDate = String(form.endDate ?? form.end_date ?? '').trim() || startDate;

	if (!isValidDate(startDate)) return { error: 'Start date is not a valid date.' };
	if (!isValidDate(endDate)) return { error: 'End date is not a valid date.' };

	const startHalf = parseHalf(form.startHalf ?? form.start_half ?? 'full');
	const endHalf = parseHalf(form.endHalf ?? form.end_half ?? (startDate === endDate ? startHalf : 'full'));
	if (!startHalf || !endHalf) return { error: 'Half-day value must be full, am, or pm.' };

	const note = String(form.note ?? '').trim().slice(0, NOTE_MAX);

	return { leaveTypeId, startDate, endDate, startHalf, endHalf, note };
}

/**
 * Apply every booking rule. Order matters only for the error message the user
 * sees first, so the cheapest and most likely-wrong checks come first.
 */
export function validateBooking(input: BookingInput, ctx: BookingContext): Validated {
	const type = ctx.types.find((t) => t.id === input.leaveTypeId);
	if (!type) return { ok: false, error: 'Unknown leave type.' };

	const count = countLeaveDays(input.startDate, input.endDate, input.startHalf, input.endHalf, ctx.holidays);
	if (!count.ok) return { ok: false, error: count.error };

	const backdate = daysBetween(input.startDate, ctx.today);
	if (backdate > MAX_BACKDATE_DAYS) {
		return { ok: false, error: `That start date is more than ${MAX_BACKDATE_DAYS} days in the past. Ask an admin to add it.` };
	}
	if (daysBetween(ctx.today, input.endDate) > MAX_FUTURE_DAYS) {
		return { ok: false, error: 'That end date is too far in the future — check the year.' };
	}

	const clash = ctx.existing.find((e) => rangesOverlap(input.startDate, input.endDate, e.start_date, e.end_date));
	if (clash) {
		return { ok: false, error: `You already have leave booked over ${clash.start_date} – ${clash.end_date}.` };
	}

	if (type.counts_quota) {
		const left = ctx.remaining.get(type.id) ?? 0;
		if (count.days > left) {
			return {
				ok: false,
				error: `Not enough ${type.label_en.toLowerCase()} leave left: ${count.days} day(s) requested, ${left} remaining.`,
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
