import { Hono } from 'hono';
import type { Context } from 'hono';
import { bangkokNow, isValidDate } from '../domain/dates.ts';
import { allottedFor, fieldForError, parseBooking, parseHalf, round, validateBooking, type BookingInput } from '../domain/leave.ts';
import { toLang } from '../i18n/strings.ts';
import * as db from '../repo/db.ts';
import { EditPage } from '../views/edit.tsx';
import type { Env, LeaveRequest, User } from '../types.ts';
import { type Vars, userOf, say, sayMessage, keysOf, personByKey, notifyOwner, backLabel, leaveTypesOf, page, safePath, referrerPath, type AppEnv } from '../server/common.tsx';
import { flashUndo, flashDraft, flashOf, flashField, redirectWithFlash } from '../server/flash.ts';
/*
 * Booking, editing, removing and undoing leave, and a booking's own page.
 */

const app = new Hono<AppEnv>();

/**
 * Everything `validateBooking` needs, for a given user.
 *
 * `replacing` is the booking being edited, if any. It is excluded from the
 * overlap check — a booking always overlaps itself, so without this every edit
 * would be rejected as a clash with the very row it is rewriting — and its days
 * are credited back before the balance check, so shortening or retyping a
 * booking is never refused for a quota the booking itself is consuming.
 *
 * Takes `env`, not the Hono context `c`, so it cannot reach the per-request
 * leaveTypesOf(c) memo — it calls db.listLeaveTypes() directly instead. That is
 * fine rather than a gap: every caller invokes this function at most once per
 * request and does not also call listLeaveTypes()/leaveTypesOf() itself, so
 * there is no repeat query here for a memo to save. Threading `c` through
 * purely to reuse the cache would add a parameter with no request that
 * benefits from it.
 */
async function buildBookingContext(
	env: Env,
	email: string,
	parsed: { startDate: string; endDate: string },
	today: string,
	replacing?: LeaveRequest,
	// The type this booking already had, which stays bookable even if retired.
	// An edit keeps the row's type; an undo keeps the type it is restoring.
	keepTypeId: number | undefined = replacing?.leave_type_id,
) {
	// The year a booking draws from is the year it *starts* in, not the year it
	// happens to be booked in. `usedByType` has always attributed it that way and
	// `computeBalances` documents the rule, but the check read today's year — so
	// leave booked for next January was measured against this year's remaining
	// days and then recorded against next year's, and neither year was right.
	// Spending this year's allowance stopped you booking next year's.
	const year = Number(parsed.startDate.slice(0, 4));
	const [types, existing, quotas, used, holidays] = await Promise.all([
		db.listLeaveTypes(env.DB),
		db.confirmedRanges(env.DB, email),
		db.listQuotas(env.DB, email, year),
		db.usedByType(env.DB, email, year),
		// Holidays are looked up across the request's own range rather than the
		// whole year — a booking can legitimately cross into next year.
		db.holidaySet(env.DB, parsed.startDate, parsed.endDate),
	]);

	const remaining = new Map<number, number>();
	for (const t of types) {
		const allotted = allottedFor(t, quotas);
		let spent = used.get(t.id) ?? 0;
		// Credit the booking's own days back only if they were counted in this
		// year to begin with. `used` is the total for the year the booking now
		// starts in; an edit that moves it across New Year was never part of that
		// total, and subtracting it anyway handed the moved booking a free
		// allowance exactly its own size — 13 days accepted against a 10-day
		// quota, before this check existed.
		if (replacing && replacing.leave_type_id === t.id && Number(replacing.start_date.slice(0, 4)) === year) {
			spent = round(spent - replacing.days_total);
		}
		remaining.set(t.id, round(allotted - spent));
	}

	return {
		holidays,
		existing: replacing ? existing.filter((e) => e.id !== replacing.id) : existing,
		types,
		remaining,
		today,
		keepTypeId,
	};
}

app.post('/api/v1/leave', async (c) => {
	const user = userOf(c);
	const today = c.get('today');
	const back = referrerPath(c.req.header('Referer'), c.req.url) ?? '/me';

	const form = await c.req.parseBody();
	const parsed = parseBooking(form as Record<string, unknown>);
	// No draft to carry: parsing failed, so there is no coherent booking to
	// prefill with. The key still names the field that was wrong, which is the
	// half of the answer that survives. Every rule that rejects a booking the
	// reader could plausibly have meant is below, and those carry both.
	if ('error' in parsed) {
		return redirectWithFlash(back, 'err', sayMessage(c, parsed.error), { field: fieldForError(parsed.error) });
	}

	// Whose booking this is. An admin may book for anyone active — someone off
	// sick who phoned in — and it is checked against that person's allowance
	// and other bookings, exactly as if they had booked it themselves.
	// No `for`, the usual case, is a booking for oneself and costs no key.
	const forKey = typeof form.for === 'string' && form.for !== '' ? form.for : null;
	let owner: User = user;
	if (forKey !== null && forKey !== (await keysOf(c, [user])).get(user.email)) {
		if (!user.is_admin) return redirectWithFlash(back, 'err', say(c, 'flash.forAdminsOnly'));
		const target = await personByKey(c, forKey);
		if (!target) return redirectWithFlash(back, 'err', say(c, 'flash.forUnknown'), { field: 'for', draft: { ...parsed, forKey } });
		owner = target;
	}
	const draft = owner === user || forKey === null ? parsed : { ...parsed, forKey };

	const ctx = await buildBookingContext(c.env, owner.email, parsed, today);
	const check = validateBooking(parsed, ctx);
	if (!check.ok) {
		return redirectWithFlash(back, 'err', sayMessage(c, check.error), { field: fieldForError(check.error), draft });
	}

	const row: LeaveRequest = {
		id: crypto.randomUUID(),
		user_email: owner.email,
		leave_type_id: parsed.leaveTypeId,
		start_date: parsed.startDate,
		end_date: parsed.endDate,
		start_half: parsed.startHalf,
		end_half: parsed.endHalf,
		days_total: check.days,
		note: parsed.note || null,
		note_private: parsed.notePrivate ? 1 : 0,
		status: 'confirmed',
		created_at: bangkokNow(),
		cancelled_at: null,
	};
	await db.insertLeave(c.env.DB, row, user.email);
	notifyOwner(c, 'created', row, check.type);

	return redirectWithFlash(
		back,
		'ok',
		say(c, owner === user ? 'flash.booked' : 'flash.bookedFor', {
			count: check.days,
			days: check.days,
			type: check.type.label_en.toLowerCase(),
			typeTh: check.type.label_th,
			name: owner.display_name,
		}),
	);
});

/**
 * Ownership gate for editing or cancelling a booking. Own bookings always;
 * anyone else's only as an admin. An id is guessable in principle, so this runs
 * before the row is shown or touched.
 */
async function ownedLeave(
	c: Context<{ Bindings: Env; Variables: Vars }>,
	id: string,
): Promise<{ ok: true; row: LeaveRequest } | { ok: false; error: string }> {
	const user = userOf(c);
	const row = await db.getLeave(c.env.DB, id);
	if (!row) return { ok: false, error: say(c, 'flash.gone') };
	if (row.user_email !== user.email && !user.is_admin) {
		return { ok: false, error: say(c, 'flash.notYours') };
	}
	return { ok: true, row };
}

app.get('/leave/:id/edit', async (c) => {
	const user = userOf(c);
	const today = c.get('today');
	const id = c.req.param('id');

	const owned = await ownedLeave(c, id);
	if (!owned.ok) return redirectWithFlash('/me', 'err', owned.error);
	if (owned.row.status !== 'confirmed') {
		return redirectWithFlash('/me', 'err', say(c, 'flash.cancelledRebook'));
	}

	const [entry, types] = await Promise.all([db.getLeaveEntry(c.env.DB, id), leaveTypesOf(c)]);
	if (!entry) return redirectWithFlash('/me', 'err', say(c, 'flash.gone'));

	// The page shows the booking before offering to change it: the owner's
	// balance in the year it starts, who else is away during it, and what has
	// happened to it.
	const year = Number(entry.start_date.slice(0, 4));
	const [balances, coverage, history, users] = await Promise.all([
		db.balancesFor(c.env.DB, entry.user_email, year, types),
		db.coverageInRange(c.env.DB, entry.start_date, entry.end_date, entry.user_email, entry.id),
		db.auditForLeave(c.env.DB, entry.id),
		db.listUsers(c.env.DB),
	]);
	const balance = balances.find((b) => b.type.id === entry.leave_type_id);
	const lang = toLang(user.lang);
	const awayDates = new Map<string, string[]>();
	for (const [date, names] of [...coverage.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		for (const name of names) awayDates.set(name, [...(awayDates.get(name) ?? []), date]);
	}
	// Back to where the reader came from — the calendar, an admin's trail, My
	// leave — unless that was this page, or a form it posted to.
	const from = referrerPath(c.req.header('Referer'), c.req.url);
	const back = from && !from.startsWith('/leave/') && !from.startsWith('/api/') ? from : '/me';

	return page(
		c,
		<EditPage
			user={user}
			entry={entry}
			types={types}
			today={today}
			back={back}
			backLabel={backLabel(c, back)}
			balance={balance && balance.type.counts_quota ? { type: lang === 'th' ? balance.type.label_th : balance.type.label_en, remaining: balance.remaining, year } : null}
			alsoAway={[...awayDates.entries()].map(([name, dates]) => ({ name, dates }))}
			history={history}
			names={new Map(users.map((u) => [u.email, u.display_name]))}
			onBehalfOf={entry.user_email === user.email ? undefined : entry.display_name}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			errorField={flashField(c.get('flash'))}
			notice={flashOf(c.get('flash'), 'ok')}
			draft={flashDraft(c.get('flash'))}
			undo={flashUndo(c.get('flash'))}
		/>,
	);
});

app.post('/api/v1/leave/:id/edit', async (c) => {
	const today = c.get('today');
	const id = c.req.param('id');

	const owned = await ownedLeave(c, id);
	if (!owned.ok) return redirectWithFlash('/me', 'err', owned.error);
	if (owned.row.status !== 'confirmed') {
		return redirectWithFlash('/me', 'err', say(c, 'flash.cancelledNoEdit'));
	}

	const form = await c.req.parseBody();

	// Dragging on the calendar posts here too, and should land back on the month
	// it was dragged in rather than on /me or the edit page. The edit page sends
	// no returnTo and keeps the original behaviour.
	const returnTo = safePath(form.returnTo);
	const back = returnTo ?? `/leave/${id}/edit`;
	const done = returnTo ?? '/me';
	const parsed = parseBooking(form as Record<string, unknown>);
	if ('error' in parsed) {
		return redirectWithFlash(back, 'err', sayMessage(c, parsed.error), { field: fieldForError(parsed.error) });
	}

	// A rejected booking is carried back so the edit form can be redisplayed
	// holding it — but only for the edit page. `returnTo` means this came from a
	// drag on the calendar, which lands on a month view whose booking form is a
	// blank create form; prefilling that with the dragged booking would put
	// somebody else's dates into a form the reader never opened.
	const draft = returnTo ? undefined : parsed;

	// Validate against the owner of the booking, not whoever is editing it — an
	// admin fixing someone else's leave must be checked against that person's
	// quota and their other bookings.
	const ctx = await buildBookingContext(c.env, owned.row.user_email, parsed, today, owned.row);
	const check = validateBooking(parsed, ctx);
	if (!check.ok) {
		return redirectWithFlash(back, 'err', sayMessage(c, check.error), { field: fieldForError(check.error), draft });
	}

	const changed = await db.updateLeave(c.env.DB, id, {
		leave_type_id: parsed.leaveTypeId,
		start_date: parsed.startDate,
		end_date: parsed.endDate,
		start_half: parsed.startHalf,
		end_half: parsed.endHalf,
		days_total: check.days,
		note: parsed.note || null,
		note_private: parsed.notePrivate ? 1 : 0,
	}, userOf(c).email);
	if (!changed) return redirectWithFlash(done, 'err', say(c, 'flash.cancelledWhileEditing'));
	notifyOwner(c, 'edited', { ...owned.row, start_date: parsed.startDate, end_date: parsed.endDate, start_half: parsed.startHalf, end_half: parsed.endHalf }, check.type);

	return redirectWithFlash(
		done,
		'ok',
		say(c, 'flash.updated', {
			count: check.days,
			days: check.days,
			type: check.type.label_en.toLowerCase(),
			typeTh: check.type.label_th,
		}),
		// This is the path a drag-to-move lands on, and a drag is the easiest
		// change in the app to make by accident.
		{ undo: id },
	);
});

app.post('/api/v1/leave/:id/cancel', async (c) => {
	const back = referrerPath(c.req.header('Referer'), c.req.url) ?? '/me';
	const id = c.req.param('id');

	const owned = await ownedLeave(c, id);
	if (!owned.ok) return redirectWithFlash(back, 'err', owned.error);

	const done = await db.cancelLeave(c.env.DB, id, userOf(c).email);
	if (done) {
		const types = await leaveTypesOf(c);
		notifyOwner(c, 'cancelled', owned.row, types.find((t) => t.id === owned.row.leave_type_id));
	}
	return done
		? redirectWithFlash(back, 'ok', say(c, 'flash.cancelled'), { undo: id })
		: redirectWithFlash(back, 'err', say(c, 'flash.alreadyCancelled'));
});

/**
 * How long an undo stays available on the server.
 *
 * The offer itself disappears with the flash cookie after 30 seconds, but the
 * route has to decide for itself: the cookie is base64 JSON and a determined
 * caller can write their own. Ten minutes is long enough for someone to notice
 * a mis-drop and act on it, and short enough that this stays an undo rather
 * than becoming a general rollback API for anything in the audit trail.
 */
const UNDO_WINDOW_MS = 10 * 60 * 1000;

/**
 * Undo the last change to a booking.
 *
 * Two shapes, because the two changes lose different things:
 *
 *  - A cancellation only set a status. The row never went anywhere, so putting
 *    it back needs nothing from the audit trail — including the note, which the
 *    trail deliberately does not carry.
 *  - An edit replaced values. Those come back from the snapshot — but the note
 *    is restored from the row rather than the snapshot, for the same reason.
 *    A drag-to-move resends the note unchanged, so leaving it alone is right.
 *
 * Both re-run the booking rules first. Time passes between a change and its
 * undo, and quota can be spent or the dates taken in between; an undo that
 * skipped validation would be the one way into the app to overdraw a balance
 * or double-book a day.
 */
app.post('/api/v1/leave/:id/undo', async (c) => {
	const back = referrerPath(c.req.header('Referer'), c.req.url) ?? '/me';
	const today = c.get('today');
	const id = c.req.param('id');

	const owned = await ownedLeave(c, id);
	if (!owned.ok) return redirectWithFlash(back, 'err', owned.error);

	const last = await db.latestAudit(c.env.DB, id);
	if (!last || (last.action !== 'cancelled' && last.action !== 'edited')) {
		return redirectWithFlash(back, 'err', say(c, 'flash.nothingToUndo'));
	}
	if (Date.now() - Date.parse(last.at) > UNDO_WINDOW_MS) {
		return redirectWithFlash(back, 'err', say(c, 'flash.undoExpired'));
	}

	const row = owned.row;
	// The note and its visibility always come from the row, never the snapshot.
	const restoring: BookingInput | null =
		last.action === 'cancelled'
			? {
					leaveTypeId: row.leave_type_id,
					startDate: row.start_date,
					endDate: row.end_date,
					startHalf: row.start_half,
					endHalf: row.end_half,
					note: row.note ?? '',
					notePrivate: Boolean(row.note_private),
				}
			: snapshotToBooking(last.before, row);
	if (!restoring) return redirectWithFlash(back, 'err', say(c, 'flash.nothingToUndo'));

	// A cancelled booking is not in `confirmedRanges`, so it cannot clash with
	// itself; a confirmed one being edited back has to be excluded by hand.
	const ctx = await buildBookingContext(
		c.env,
		row.user_email,
		restoring,
		today,
		last.action === 'edited' ? row : undefined,
		restoring.leaveTypeId,
	);
	const check = validateBooking(restoring, ctx);
	if (!check.ok) return redirectWithFlash(back, 'err', sayMessage(c, check.error));

	const actor = userOf(c).email;
	if (last.action === 'cancelled') {
		const done = await db.restoreLeave(c.env.DB, id, actor);
		if (done) notifyOwner(c, 'restored', row, check.type);
		return done
			? redirectWithFlash(back, 'ok', say(c, 'flash.restored'))
			: redirectWithFlash(back, 'err', say(c, 'flash.nothingToUndo'));
	}

	const changed = await db.updateLeave(
		c.env.DB,
		id,
		{
			leave_type_id: restoring.leaveTypeId,
			start_date: restoring.startDate,
			end_date: restoring.endDate,
			start_half: restoring.startHalf,
			end_half: restoring.endHalf,
			days_total: check.days,
			note: row.note,
			note_private: row.note_private,
		},
		actor,
	);
	if (changed) {
		notifyOwner(c, 'edited', { ...row, start_date: restoring.startDate, end_date: restoring.endDate, start_half: restoring.startHalf, end_half: restoring.endHalf }, check.type);
	}
	return changed
		? redirectWithFlash(back, 'ok', say(c, 'flash.undone'))
		: redirectWithFlash(back, 'err', say(c, 'flash.nothingToUndo'));
});

/**
 * A stored `before` snapshot as something the booking rules can check.
 *
 * The snapshot is JSON written by this app, but it has been through the
 * database and a schema change could have left an older shape behind, so every
 * field is checked rather than cast. Returns null when it cannot be trusted,
 * and the caller declines the undo rather than restoring a half-read booking.
 */
function snapshotToBooking(raw: string | null, row: LeaveRequest): BookingInput | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const v = parsed as Record<string, unknown>;

	const leaveTypeId = v.leave_type_id;
	if (typeof leaveTypeId !== 'number' || !Number.isInteger(leaveTypeId) || leaveTypeId <= 0) return null;
	const startDate = typeof v.start_date === 'string' ? v.start_date : '';
	const endDate = typeof v.end_date === 'string' ? v.end_date : '';
	if (!isValidDate(startDate) || !isValidDate(endDate)) return null;
	const startHalf = parseHalf(v.start_half);
	const endHalf = parseHalf(v.end_half);
	if (!startHalf || !endHalf) return null;

	return {
		leaveTypeId,
		startDate,
		endDate,
		startHalf,
		endHalf,
		note: row.note ?? '',
		notePrivate: Boolean(row.note_private),
	};
}

export default app;
