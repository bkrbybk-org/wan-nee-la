/**
 * Booking rules and balance arithmetic. Pure functions — the repo layer supplies
 * the rows, this decides what they mean. Tested by `scripts/test-leave.mjs`.
 *
 * Everything a client sends is treated as untrusted: `days_total` is computed
 * here from the dates, never read from the request body. Otherwise a crafted
 * POST could book three weeks and claim it cost half a day.
 */

import { addDays, countLeaveDays, daysBetween, isValidDate, isWeekend, rangesOverlap, type Half } from './dates.ts';
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

/**
 * A rejected booking on its way back to the form it came from.
 *
 * The same fields as `BookingInput`, except the note is optional: it is the one
 * field big enough to threaten the cookie that carries this (see `flashCookie`
 * in `src/index.tsx`), so the encoder is allowed to drop it. `undefined` means
 * "not carried" and leaves whatever the form already had; an empty string means
 * the reader cleared the note, which is a different thing.
 */
export type BookingDraft = Omit<BookingInput, 'note'> & { note?: string };

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
	/**
	 * A retired type that stays bookable for this one request: the type the
	 * booking already had. Retiring a type stops new bookings, not the edits and
	 * undos of bookings that exist — otherwise the only way to move a retired
	 * booking's dates would be to change what kind of leave it was.
	 */
	keepTypeId?: number;
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
 * The draft as it travels inside the flash cookie.
 *
 * One- and two-character keys, which is not how the rest of this file names
 * things: the cookie has a hard 4096-byte budget shared with the error message,
 * and base64 adds a third on top of whatever JSON costs. Full field names would
 * spend around 60 of those bytes on nothing.
 */
export function draftPayload(draft: BookingDraft): Record<string, unknown> {
	return {
		t: draft.leaveTypeId,
		s: draft.startDate,
		e: draft.endDate,
		sh: draft.startHalf,
		eh: draft.endHalf,
		p: draft.notePrivate,
		// Omitted rather than sent empty when the note was dropped, so the form
		// can tell "not carried" from "cleared".
		...(draft.note === undefined ? {} : { n: draft.note }),
	};
}

/**
 * Read a draft back out of the cookie.
 *
 * Every field is re-validated. The cookie is HttpOnly, but it still round-trips
 * through the client, so what comes back is untrusted input exactly like a form
 * body — and this one is fed straight into rendered form values.
 */
export function parseDraft(value: unknown): BookingDraft | null {
	if (typeof value !== 'object' || value === null) return null;
	const v = value as Record<string, unknown>;

	const leaveTypeId = v.t;
	if (typeof leaveTypeId !== 'number' || !Number.isInteger(leaveTypeId) || leaveTypeId <= 0) return null;

	const startDate = typeof v.s === 'string' ? v.s : '';
	const endDate = typeof v.e === 'string' ? v.e : '';
	if (!isValidDate(startDate) || !isValidDate(endDate)) return null;

	const startHalf = parseHalf(v.sh);
	const endHalf = parseHalf(v.eh);
	if (!startHalf || !endHalf) return null;

	if (v.n !== undefined && typeof v.n !== 'string') return null;

	return {
		leaveTypeId,
		startDate,
		endDate,
		startHalf,
		endHalf,
		note: v.n === undefined ? undefined : v.n.slice(0, NOTE_MAX),
		// Private unless the payload says otherwise — the same safe direction
		// `parseBooking` takes with a missing checkbox.
		notePrivate: v.p !== false,
	};
}

/**
 * Apply every booking rule. Order matters only for the error message the user
 * sees first, so the cheapest and most likely-wrong checks come first.
 */
export function validateBooking(input: BookingInput, ctx: BookingContext): Validated {
	const type = ctx.types.find((t) => t.id === input.leaveTypeId);
	if (!type) return { ok: false, error: msg('error.unknownType') };
	if (!type.active && type.id !== ctx.keepTypeId) return { ok: false, error: msg('error.retiredType') };

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
 * The allowance for one leave type in one year.
 *
 * An explicit quota row wins. Where there is none the type's own `default_days`
 * stands in, because quota rows are only ever seeded for a year somebody has
 * signed in during — so a year still ahead of us has none at all, and reading
 * that absence as a zero allowance is what refused next January's leave to
 * anyone who had spent this year's.
 *
 * A fallback rather than a write: seeding here would put an INSERT in front of
 * every balance page and every booking check, and it would freeze whatever
 * `default_days` happened to say that day. An admin who has set a number
 * already has a row, and the row still wins.
 *
 * One place on purpose. The booking check, the balance cards and the admin
 * editor all have to agree on what next year's allowance is; three copies of
 * `?? 0` is how they would quietly stop agreeing.
 */
export function allottedFor(type: LeaveType, quotas: readonly Quota[]): number {
	const row = quotas.find((q) => q.leave_type_id === type.id);
	return row ? row.days_allotted : type.default_days;
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
		// A retired type is shown only in a year somebody actually took it, so
		// history stays explained without an empty card for a type nobody can book.
		.filter((type) => type.active || (used.get(type.id) ?? 0) > 0)
		.map((type) => {
			const allotted = allottedFor(type, quotas);
			const spent = used.get(type.id) ?? 0;
			return {
				type,
				allotted,
				used: spent,
				// A type with counts_quota = 0 has no allowance to run down, so
				// "remaining" is meaningless for it; report 0 and let the view hide
				// the bar. Planned medical is the one that behaves this way today.
				remaining: type.counts_quota ? round(allotted - spent) : 0,
			};
		});
}

/** Days are always multiples of 0.5, but float subtraction still yields 9.499999999. */
export function round(n: number): number {
	return Math.round(n * 2) / 2;
}

/** One booking's piece of one calendar week, laid out as a bar. */
export interface WeekSegment {
	entry: LeaveEntry;
	/** Column the bar starts in, 0–6. */
	col: number;
	/** How many columns it covers, 1–7. */
	span: number;
	/** Row within the week, 0 at the top. */
	lane: number;
	/** The booking began before this week, so the bar has no left end here. */
	continuesBefore: boolean;
	/** The booking runs on past this week. */
	continuesAfter: boolean;
}

/**
 * Lay a week's bookings out as bars: each one a single piece across the days it
 * covers in this week, stacked into the fewest rows that keep any two that share
 * a day from overlapping.
 *
 * A booking that crosses a week boundary becomes one piece per week, flagged at
 * the cut so the bar can show it carries on. Longer pieces and earlier starts
 * take the top rows, which is what keeps a long absence a straight line down the
 * month rather than stepping between rows week to week. Names break ties, so
 * the layout is the same on every render.
 *
 * Weekends and public holidays inside a booking are cut out, as `byDate` does
 * for the per-day views: a Friday-to-Monday booking in a Sunday-first week is
 * a Friday piece and a Monday piece, not a bar across a weekend nobody took.
 * The cut ends are flagged like a week boundary, so the bar still reads as
 * carrying on. A booking made of nothing but days off keeps all its days.
 *
 * `week` is seven consecutive dates.
 */
export function weekLanes(
	week: readonly string[],
	entries: readonly LeaveEntry[],
	holidays: ReadonlySet<string> = new Set(),
): WeekSegment[] {
	const first = week[0];
	const last = week[week.length - 1];
	const off = (d: string) => isWeekend(d) || holidays.has(d);
	const pieces: WeekSegment[] = [];
	for (const e of entries.filter((x) => x.start_date <= last && x.end_date >= first)) {
		let allOff = true;
		for (let d = e.start_date; d <= e.end_date && allOff; d = addDays(d, 1)) allOff = off(d);
		// Runs of consecutive days this booking is away within the week.
		let run: string[] = [];
		const close = () => {
			if (run.length === 0) return;
			const from = run[0];
			const to = run[run.length - 1];
			pieces.push({
				entry: e,
				col: daysBetween(first, from),
				span: run.length,
				lane: 0,
				continuesBefore: e.start_date < from,
				continuesAfter: e.end_date > to,
			});
			run = [];
		};
		for (const d of week) {
			if (d >= e.start_date && d <= e.end_date && (allOff || !off(d))) run.push(d);
			else close();
		}
		close();
	}
	pieces.sort(
		(a, b) =>
			a.col - b.col ||
			b.span - a.span ||
			a.entry.display_name.localeCompare(b.entry.display_name) ||
			a.entry.id.localeCompare(b.entry.id),
	);

	const taken: boolean[][] = [];
	for (const piece of pieces) {
		let lane = 0;
		const free = (l: number) => !(taken[l] ?? []).slice(piece.col, piece.col + piece.span).some(Boolean);
		while (!free(lane)) lane++;
		taken[lane] ??= [];
		for (let c = piece.col; c < piece.col + piece.span; c++) taken[lane][c] = true;
		piece.lane = lane;
	}
	return pieces;
}

/**
 * Index entries by the days someone is actually away.
 *
 * A booking from Friday to Monday covers four calendar dates but two leave
 * days — the weekend is not taken and not charged (`countLeaveDays`). Listing
 * the person on Saturday and Sunday too put a dot on the phone's grid and a
 * row in the day card for days nobody was off, so weekends and public holidays
 * inside a booking are left out. A booking made up of nothing but days off,
 * which the booking rules do not allow but older data might hold, keeps all
 * its days rather than vanishing.
 *
 * Per day only: the desktop's bars still run the whole range, since one
 * booking reads as one line there.
 */
export function byDate(entries: readonly LeaveEntry[], holidays: ReadonlySet<string> = new Set()): Map<string, LeaveEntry[]> {
	const off = (d: string) => isWeekend(d) || holidays.has(d);
	const map = new Map<string, LeaveEntry[]>();
	for (const e of entries) {
		const days: string[] = [];
		for (let d = e.start_date; d <= e.end_date; d = addDays(d, 1)) days.push(d);
		const working = days.filter((d) => !off(d));
		for (const d of working.length > 0 ? working : days) {
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
	'error.retiredType': 'leaveTypeId',
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
