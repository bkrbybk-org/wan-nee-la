import { Hono } from 'hono';
import { addDays, countLeaveDays, daysBetween, firstOfMonth, lastOfMonth, MAX_RANGE_DAYS, shortDate } from '../domain/dates.ts';
import { byDate, computeBalances, parseBooking, halfOn, round, visibleNote } from '../domain/leave.ts';
import { toLang, type Lang, type Message } from '../i18n/strings.ts';
import * as db from '../repo/db.ts';
import { type Ctx, userOf, sayMessage, personByKey, leaveTypesOf, clampInt, jsonError, PERIOD, validDateOr, isEmail, type AppEnv } from '../server/common.tsx';
/*
 * The JSON API: the leave feeds, holidays, balances and the booking preview.
 */

const app = new Hono<AppEnv>();

/**
 * JSON feed for the calendar. Same data the grid renders, for scripts and future views.
 *
 * `user` narrows it to one person, by the email Access knows them by. No new
 * permission: a colleague's schedule is already shared — it is the calendar,
 * and `/u/:email` renders the same rows as a page. The privacy rules are
 * unchanged: emails never appear in the response, private notes are absent
 * rather than hidden, and a deactivated person is left out as everywhere else.
 * An email nobody has is an empty list, not a 404, which is also what a range
 * with no leave in it returns.
 */
app.get('/api/v1/leave', async (c) => {
	const today = c.get('today');
	// Absent for a service token, which is why it never sees a note: `visibleNote`
	// answers "may *this person* read it", and a machine is not one.
	const viewer = c.get('user');
	const from = validDateOr(c.req.query('from'), firstOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7))));
	const to = validDateOr(c.req.query('to'), lastOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7))));
	if (from > to) return jsonError(c, 'from is after to', 400);
	if (daysBetween(from, to) > MAX_RANGE_DAYS) return jsonError(c, `range is longer than ${MAX_RANGE_DAYS} days`, 400);

	// Lowercased to match how `ensureUser` stores it, so a capitalised address
	// finds the same person rather than silently nobody.
	const raw = c.req.query('user')?.trim().toLowerCase();
	if (raw !== undefined && !isEmail(raw)) return jsonError(c, 'user is not an email address', 400);

	const entries = await db.listLeaveInRange(c.env.DB, from, to, raw);
	return c.json({
		from,
		to,
		...(raw === undefined ? {} : { user: raw }),
		entries: entries.map((e) => ({
			id: e.id,
			name: e.display_name,
			type: e.type_code,
			label: e.type_label_en,
			color: e.color,
			start: e.start_date,
			end: e.end_date,
			startHalf: e.start_half,
			endHalf: e.end_half,
			days: e.days_total,
			// Same rule as the calendar: a private note is absent from the feed,
			// not merely hidden by whatever renders it.
			note: viewer ? visibleNote(e, viewer) : null,
		})),
	});
});

/**
 * The same leave, grouped by calendar date rather than by booking.
 *
 * A booking is one row spanning a range; a rota, a dashboard or a chat bot
 * wants "who is away on this day", and would otherwise expand the range —
 * including the half-day rules at each end — itself, differently each time.
 * Each date a booking touches appears once, with `period` saying which part of
 * *that* day it covers: a range's middle days are always `full_day`.
 *
 * Dates with nobody away are absent, so there is no way to confuse "nobody is
 * out" with "not covered by the request".
 *
 * **This one carries email addresses**, which the calendar feed deliberately
 * does not (see `/api/v1/leave`). That is the owner's decision, taken 2026-09-21:
 * an integration needs a stable identifier for a person, and a display name is
 * neither unique nor stable. Notes are still never included.
 */
app.get('/api/v1/leave/by-date', async (c) => {
	const today = c.get('today');
	const from = validDateOr(c.req.query('from'), firstOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7))));
	const to = validDateOr(c.req.query('to'), lastOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7))));
	if (from > to) return jsonError(c, 'from is after to', 400);
	// A day per entry, so an unbounded range is an unbounded response. The same
	// ceiling a single booking has, and the same one the feed applies.
	if (daysBetween(from, to) > MAX_RANGE_DAYS) return jsonError(c, `range is longer than ${MAX_RANGE_DAYS} days`, 400);

	const [entries, holidays] = await Promise.all([
		db.listLeaveInRange(c.env.DB, from, to),
		db.holidaySet(c.env.DB, from, to),
	]);
	// Only days someone is actually off: a Friday-to-Monday booking is two
	// leave days, not four, and an integration reading Saturday should not be
	// told they are away.
	const byDay = byDate(entries, holidays);

	const data = [];
	for (let date = from; date <= to; date = addDays(date, 1)) {
		const onThatDay = byDay.get(date);
		if (!onThatDay) continue;
		data.push({
			date,
			// By name within the day. The rows arrive ordered by the booking's
			// start date, which on any given date is the order the bookings were
			// *made* for — arbitrary to somebody reading one day's list.
			employees: [...onThatDay]
				.sort((a, b) => a.display_name.localeCompare(b.display_name))
				.map((e) => ({
					email: e.user_email,
					name: e.display_name,
					leave_type: e.type_label_en,
					period: PERIOD[halfOn(e, date)],
				})),
		});
	}

	return c.json({ from, to, data });
});

/**
 * The public holidays in a range.
 *
 * Company-wide and nobody's personal data — the one feed here that says nothing
 * about a person. A rota or calendar integration needs it to know which days
 * cost nothing, and every employee can already see them on the calendar.
 */
app.get('/api/v1/holidays', async (c) => {
	const today = c.get('today');
	const year = Number(today.slice(0, 4));
	const from = validDateOr(c.req.query('from'), `${year}-01-01`);
	const to = validDateOr(c.req.query('to'), `${year}-12-31`);
	if (from > to) return jsonError(c, 'from is after to', 400);
	if (daysBetween(from, to) > MAX_RANGE_DAYS * 3) return jsonError(c, `range is longer than ${MAX_RANGE_DAYS * 3} days`, 400);

	const holidays = await db.listHolidays(c.env.DB, from, to);
	return c.json({ from, to, holidays: holidays.map((h) => ({ date: h.date, label: h.label })) });
});

/**
 * Entitlement, taken and remaining, per person per leave type, for one year.
 *
 * The most revealing thing this API returns — how much sick leave each
 * colleague has used is nobody's business but theirs, their admins' and
 * whatever HR system is asking. So it is not a feed every signed-in employee
 * may read: an **admin** or an allowlisted **service token**, and nobody else.
 *
 * A year nobody has been seeded for falls back to each type's `default_days`,
 * through the same helper the booking check and the balance cards use, so the
 * number here is the number the app would actually enforce.
 */
app.get('/api/v1/balances', async (c) => {
	const today = c.get('today');
	const viewer = c.get('user');
	const machine = c.get('service');
	if (!machine && !viewer?.is_admin) {
		return jsonError(c, 'Balances are readable by an admin or an allowlisted service token.', 403);
	}

	const year = clampInt(c.req.query('year'), Number(today.slice(0, 4)), 2000, 2100);
	const only = c.req.query('user')?.trim().toLowerCase();
	if (only !== undefined && !isEmail(only)) return jsonError(c, 'user is not an email address', 400);

	const [users, types, quotas, used] = await Promise.all([
		db.listUsers(c.env.DB),
		leaveTypesOf(c),
		db.listQuotasForYear(c.env.DB, year),
		db.usedByTypeForYear(c.env.DB, year),
	]);

	const people = users
		.filter((u) => u.active && (only === undefined || u.email === only))
		.map((u) => ({
			email: u.email,
			name: u.display_name,
			balances: computeBalances(types, quotas.filter((q) => q.user_email === u.email), used.get(u.email) ?? new Map()).map((b) => ({
				leaveType: b.type.code,
				label: b.type.label_en,
				countsQuota: Boolean(b.type.counts_quota),
				allotted: b.allotted,
				used: b.used,
				remaining: b.remaining,
			})),
		}));

	return c.json({ year, ...(only === undefined ? {} : { user: only }), people });
});

/**
 * Dry-run day count for the booking form's live preview.
 *
 * The client asks the server rather than reimplementing `countLeaveDays` in
 * `booking.ts`: a second copy of the half-day and holiday rules would drift,
 * and the number the user sees before submitting would stop matching the number
 * their quota is actually charged.
 */
app.get('/api/v1/leave/preview', async (c) => {
	// The key stays for programs; `message` is the same thing already in the
	// reader's language, because the page has no catalogue of its own to turn a
	// key into a sentence — printing the object is how "[object Object]" ended
	// up under the form on any weekend.
	const rejected = (m: Message) => c.json({ error: { key: m.key, vars: m.vars, message: sayMessage(c, m) } }, 200);
	const parsed = parseBooking({
		leaveTypeId: c.req.query('leaveTypeId') ?? '1',
		startDate: c.req.query('start') ?? '',
		endDate: c.req.query('end') ?? '',
		startHalf: c.req.query('startHalf') ?? 'full',
		endHalf: c.req.query('endHalf') ?? 'full',
	});
	if ('error' in parsed) return rejected(parsed.error);

	const holidays = await db.holidaySet(c.env.DB, parsed.startDate, parsed.endDate);
	const count = countLeaveDays(parsed.startDate, parsed.endDate, parsed.startHalf, parsed.endHalf, holidays);
	if (!count.ok) return rejected(count.error);

	// Who else is already away on these days. Advisory only — nothing here can
	// refuse a booking, because the app does not know who covers for whom; it
	// only knows how to stop someone finding out by accident on the Monday.
	const viewer = userOf(c);
	const excludeId = c.req.query('exclude') ?? undefined;
	const editing = excludeId ? await db.getLeave(c.env.DB, excludeId) : null;
	// Whose booking this is: the owner's when an admin is editing someone
	// else's, otherwise the person asking. Anyone else's booking id is ignored.
	// Coverage and balance are both theirs — counting from the admin had left
	// the admin's own days out and put the owner among "someone else".
	const mayEdit = editing && (editing.user_email === viewer.email || viewer.is_admin);
	// A new booking an admin is making for someone else: `for` names them by
	// the booking form's person key. Ignored for anyone else, and for a key
	// that is nobody active.
	const forKey = !editing && viewer.is_admin ? c.req.query('for') : undefined;
	const forUser = forKey ? await personByKey(c, forKey) : null;
	const owner = mayEdit ? editing.user_email : (forUser?.email ?? viewer.email);
	const [coverage, headcount, ownerUser] = await Promise.all([
		db.coverageInRange(c.env.DB, parsed.startDate, parsed.endDate, owner, excludeId),
		db.activeUserCount(c.env.DB),
		owner === viewer.email ? Promise.resolve(null) : db.getUser(c.env.DB, owner),
	]);
	return c.json(
		{
			days: count.days,
			...summariseCoverage(coverage, headcount, toLang(viewer.lang), ownerUser?.display_name),
			balance: await previewBalance(c, owner, parsed, count.days, mayEdit ? editing : null),
		},
		200,
	);
});

/**
 * Turn a day-by-day map of who is away into one sentence.
 *
 * Reports the worst day in the range rather than a total, because five people
 * out on five separate days is a normal week and five people out on the same
 * Tuesday is the thing worth seeing before you book.
 *
 * "A lot" is a third of the active roster, and never fewer than two people, so
 * the warning neither fires on a single colleague in a team of forty nor stays
 * silent when both halves of a team of two book the same Tuesday.
 */
/**
 * What the booking does to its type's allowance, for the form's summary:
 * "Annual: 7 left → 6 after this". Charged to the year the booking starts in,
 * as the booking check does; an edit gets its own days back first, but only
 * when the booking being edited is that type in that year — the same rule
 * `validateBooking` applies, so the summary cannot promise what the save then
 * refuses. Null for a type without an allowance.
 */
async function previewBalance(
	c: Ctx,
	email: string,
	parsed: { leaveTypeId: number; startDate: string },
	days: number,
	editing: { leave_type_id: number; start_date: string; days_total: number; status: string } | null,
) {
	const types = await leaveTypesOf(c);
	const year = Number(parsed.startDate.slice(0, 4));
	const balance = (await db.balancesFor(c.env.DB, email, year, types)).find((b) => b.type.id === parsed.leaveTypeId);
	if (!balance || !balance.type.counts_quota) return null;
	const credit =
		editing && editing.status === 'confirmed' && editing.leave_type_id === parsed.leaveTypeId && editing.start_date.slice(0, 4) === String(year)
			? editing.days_total
			: 0;
	// `remaining` is what is left now, booking included, as the booking's page
	// shows it; `after` what would be left once saved. Editing a five-day
	// booking down to three reads "6 left → 8", not "11 left → 8".
	const lang = toLang(userOf(c).lang);
	return { type: lang === 'th' ? balance.type.label_th : balance.type.label_en, remaining: round(balance.remaining), after: round(balance.remaining + credit - days) };
}

function summariseCoverage(coverage: Map<string, string[]>, headcount: number, lang: Lang, ownerName?: string) {
	let worstDate = '';
	let worst: string[] = [];
	for (const [date, names] of coverage) {
		if (names.length > worst.length) {
			worst = names;
			worstDate = date;
		}
	}
	if (worst.length === 0) return { coverage: null };

	const threshold = Math.max(2, Math.ceil(headcount / 3));
	return {
		coverage: {
			// Formatted here, where the reader's language is known: the client
			// would otherwise have to carry month names in two languages to turn
			// 2026-08-24 into 24 ส.ค.
			date: shortDate(worstDate, lang),
			// Includes the person booking, which is what makes it answer "how many
			// of us will be away that day".
			out: worst.length + 1,
			headcount,
			busy: worst.length + 1 >= threshold,
			names: worst.slice(0, 3),
			more: Math.max(0, worst.length - 3),
			// Whose booking it is, when that is not the person asking — an admin
			// editing for someone — so the form says "with Ploy", not "with you".
			...(ownerName ? { with: ownerName } : {}),
		},
	};
}

export default app;
