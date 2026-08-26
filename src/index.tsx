import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { authenticate } from './auth/access.ts';
import {
	addDays,
	bangkokNow,
	bangkokToday,
	countLeaveDays,
	firstOfMonth,
	isValidDate,
	lastOfMonth,
	monthGrid,
	parseWeekStart,
	shortDate,
} from './domain/dates.ts';
import { parseBooking, round, validateBooking, visibleNote } from './domain/leave.ts';
import { parseHolidayList } from './domain/holidays.ts';
import { isLang, t, tm, toLang, type Lang, type Message, type StringKey } from './i18n/strings.ts';
import * as db from './repo/db.ts';
import { AdminPage } from './views/admin.tsx';
import { BookPage } from './views/book.tsx';
import { CalendarPage } from './views/calendar.tsx';
import { EditPage } from './views/edit.tsx';
import { ErrorPage, Layout, THEME_SCRIPT } from './views/layout.tsx';
import { MePage } from './views/me.tsx';
import { UserPage } from './views/user.tsx';
import { groupIdFromWebhook, verifyLineSignature } from './notify/line.ts';
import {
	GROUP_ID_KEY,
	lineConfigured,
	pushConfigured,
	resolveGroupId,
	runDigest,
	runWeekAhead,
	vapidKeys,
} from './notify/digest.ts';
import { parseSubscription, sendPush } from './notify/push.ts';
import type { Env, LeaveRequest, User } from './types.ts';

type Vars = { user: User; today: string; flash: Flash };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * Pick up a flash message and immediately expire the cookie, so a message is
 * shown exactly once and never resurfaces on a refresh.
 */
/**
 * Security headers on everything this Worker returns.
 *
 * Access authenticates the visitor; it does not tell their browser how to treat
 * the page afterwards. These do.
 *
 * The policy is strict about scripts and deliberately not about styles. Colours
 * for leave types are rendered as `style="--chip: …"` on hundreds of elements,
 * so inline styles have to be allowed; script execution, which is what turns an
 * escaping mistake into an account takeover, does not. The one inline script is
 * the pre-paint theme switcher, allowed by its hash rather than by opening the
 * door to every inline script on the page.
 *
 * `no-store` on HTML matters in an office where machines are shared: without
 * it, a page rendered for one signed-in person can be pulled out of the
 * back/forward cache by the next.
 */
let cspHeader: string | null = null;

async function contentSecurityPolicy(): Promise<string> {
	if (cspHeader) return cspHeader;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(THEME_SCRIPT));
	const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
	cspHeader = [
		"default-src 'self'",
		"base-uri 'none'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		"img-src 'self' data:",
		"style-src 'self' 'unsafe-inline'",
		`script-src 'self' 'sha256-${hash}'`,
		"connect-src 'self'",
		"manifest-src 'self'",
		"worker-src 'self'",
	].join('; ');
	return cspHeader;
}

app.use('*', async (c, next) => {
	await next();
	const headers = c.res.headers;
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY');
	// Nothing here should ever appear in a search result.
	headers.set('X-Robots-Tag', 'noindex, nofollow');
	// `same-origin`, not `no-referrer`: the app links nowhere external, so this
	// still keeps a URL like /u/someone@example.com from reaching a third party
	// — but it leaves the header intact for our own pages, which is what
	// `referrerPath` uses to send someone back to the calendar they booked
	// from. Under `no-referrer` that header is absent and every booking
	// redirects to /me instead.
	headers.set('Referrer-Policy', 'same-origin');

	if ((headers.get('Content-Type') ?? '').includes('text/html')) {
		headers.set('Content-Security-Policy', await contentSecurityPolicy());
		headers.set('Cache-Control', 'private, no-store');
	}
});

app.use('*', async (c, next) => {
	const flash = readFlash(c.req.header('Cookie'));
	c.set('flash', flash);
	await next();
	if (flash) c.header('Set-Cookie', FLASH_CLEAR, { append: true });
});

/**
 * Health check. Deliberately above the auth middleware and deliberately dull:
 * it proves which build answered and whether D1 responds, and leaks nothing
 * about who works here or when they are away.
 */
app.get('/health', async (c) => {
	let dbOk = false;
	try {
		await c.env.DB.prepare('SELECT 1').first();
		dbOk = true;
	} catch {
		dbOk = false;
	}
	const meta = c.env.CF_VERSION_METADATA;
	return c.json({
		ok: dbOk,
		db: dbOk,
		version: meta?.id ?? null,
		deployedAt: meta?.timestamp ?? null,
		bangkokToday: bangkokToday(),
		accessConfigured: Boolean(c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD),
		// Surfaced so a production check can catch the dev bypass being left on.
		devAuthBypass: c.env.DEV_AUTH_BYPASS === '1',
	});
});

/**
 * LINE webhook. Deliberately above the auth middleware, because LINE's servers
 * must reach it and cannot carry an Access token — it needs a Bypass rule on
 * this path in the Access policy.
 *
 * That makes it the one publicly reachable route in the app, so it defends
 * itself: the raw body is read once and its HMAC checked before anything is
 * parsed, an unsigned request is refused outright rather than logged and
 * allowed, and the only state it may write is the group id.
 */
app.post('/line/webhook', async (c) => {
	const secret = c.env.LINE_CHANNEL_SECRET;
	if (!secret) return c.text('LINE is not configured.', 503);

	const signature = c.req.header('X-Line-Signature') ?? '';
	// Read the raw bytes exactly once, before any parsing. `c.req.json()`
	// consumes the stream; a later re-read yields an empty body and the
	// signature would then be verified over nothing.
	const raw = await c.req.text();

	if (!(await verifyLineSignature(raw, signature, secret))) {
		return c.text('Bad signature.', 401);
	}

	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return c.text('Bad JSON.', 400);
	}

	const groupId = groupIdFromWebhook(body);
	if (groupId) await db.setConfig(c.env.DB, GROUP_ID_KEY, groupId);

	// LINE retries on any non-2xx, so acknowledge even when the event carried
	// nothing we wanted.
	return c.text('ok');
});

/**
 * Identity for every other route.
 *
 * Also the write path for user rows: there is no signup, so an authenticated
 * Access identity we have not seen before becomes a user here, with this year's
 * quotas seeded.
 */
app.use('*', async (c, next) => {
	const auth = await authenticate(c.req.raw, c.env);
	if (!auth.ok) {
		return c.html(<ErrorPage title="Not signed in" detail={auth.reason} />, 403);
	}
	const today = bangkokToday();
	const user = await db.ensureUser(c.env.DB, auth.identity.email, Number(today.slice(0, 4)));
	if (!user.active) {
		return c.html(<ErrorPage title="Account inactive" detail="An admin has deactivated this account." />, 403);
	}
	c.set('user', user);
	c.set('today', today);
	await next();
});

/**
 * Reject cross-site form posts.
 *
 * Access is an authentication gate, not a CSRF defence — its cookie rides along
 * on a form POST from any origin. Comparing Origin to Host is enough here
 * because every mutation below this line is a same-origin form submit or fetch
 * from our own pages.
 *
 * A *missing* Origin is refused too, not waved through. Every browser sends it
 * on a POST, so absence means something that is not one of our pages — and
 * "allow when the header is absent" is the standard way this check is quietly
 * defeated. The LINE webhook, which genuinely has no Origin, is registered
 * above this middleware and never reaches it; it proves itself with a
 * signature instead.
 */
app.use('*', async (c, next) => {
	if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();

	const origin = c.req.header('Origin');
	const host = c.req.header('Host');
	let originHost = '';
	try {
		originHost = origin ? new URL(origin).host : '';
	} catch {
		originHost = '';
	}
	if (!origin || !host || originHost !== host) {
		return c.text('Cross-origin request rejected.', 403);
	}
	return next();
});

/**
 * Translate for whoever is signed in.
 *
 * Flash messages are rendered on the next request, by which time the reader is
 * known again — but translating here keeps the message and its numbers in one
 * place, and means a stored flash cannot outlive a language change.
 */
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

function say(c: Ctx, key: StringKey, vars?: Record<string, string | number>): string {
	return t(toLang(c.get('user')?.lang), key, vars);
}

function sayMessage(c: Ctx, m: Message): string {
	return tm(toLang(c.get('user')?.lang), m);
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
	const user = c.get('user');
	const today = c.get('today');
	const now = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
	const year = clampInt(c.req.query('y'), now.year, 2000, 2100);
	const month = clampInt(c.req.query('m'), now.month, 1, 12);

	// The grid is padded to whole weeks, so the query has to cover the padding
	// days too — otherwise leave shows in the trailing week of one month and
	// vanishes from the leading week of the next.
	//
	// It must be built with the viewer's own week start. A Sunday-first grid
	// begins a day earlier than a Monday-first one, and fetching the Monday-first
	// range would leave that first column silently empty.
	const grid = monthGrid(year, month, parseWeekStart(user.week_start) ?? undefined);
	const from = grid[0];
	// Seven days past the grid so the "next 7 days" summary always has its full
	// window, even when today sits in the last row of the month. Rows beyond the
	// grid are never rendered as cells — the grid only draws dates it lists.
	const to = addDays(grid[grid.length - 1], 7);

	const [entries, holidays, types] = await Promise.all([
		db.listLeaveInRange(c.env.DB, from, to),
		db.listHolidays(c.env.DB, from, to),
		db.listLeaveTypes(c.env.DB),
	]);

	return c.html(
		<CalendarPage
			user={user}
			year={year}
			month={month}
			entries={entries}
			holidays={holidays}
			types={types}
			today={today}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			notice={flashOf(c.get('flash'), 'ok')}
		/>,
	);
});

/**
 * Standalone booking page — the no-JS destination for the calendar's day cells
 * and Book leave button. With scripting on, those clicks open a dialog instead
 * and never reach this route.
 */
app.get('/book', async (c) => {
	const user = c.get('user');
	const today = c.get('today');
	const raw = c.req.query('date');
	const types = await db.listLeaveTypes(c.env.DB);

	return c.html(
		<BookPage
			user={user}
			types={types}
			today={today}
			date={raw && isValidDate(raw) ? raw : undefined}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			notice={flashOf(c.get('flash'), 'ok')}
		/>,
	);
});

/** JSON feed for the calendar. Same data the grid renders, for scripts and future views. */
app.get('/api/leave', async (c) => {
	const today = c.get('today');
	const viewer = c.get('user');
	const from = validDateOr(c.req.query('from'), firstOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7))));
	const to = validDateOr(c.req.query('to'), lastOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7))));
	if (from > to) return c.json({ error: 'from is after to' }, 400);

	const entries = await db.listLeaveInRange(c.env.DB, from, to);
	return c.json({
		from,
		to,
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
			note: visibleNote(e, viewer),
		})),
	});
});

/**
 * Dry-run day count for the booking form's live preview.
 *
 * The client asks the server rather than reimplementing `countLeaveDays` in
 * `booking.ts`: a second copy of the half-day and holiday rules would drift,
 * and the number the user sees before submitting would stop matching the number
 * their quota is actually charged.
 */
app.get('/api/leave/preview', async (c) => {
	const parsed = parseBooking({
		leaveTypeId: c.req.query('leaveTypeId') ?? '1',
		startDate: c.req.query('start') ?? '',
		endDate: c.req.query('end') ?? '',
		startHalf: c.req.query('startHalf') ?? 'full',
		endHalf: c.req.query('endHalf') ?? 'full',
	});
	if ('error' in parsed) return c.json({ error: parsed.error }, 200);

	const holidays = await db.holidaySet(c.env.DB, parsed.startDate, parsed.endDate);
	const count = countLeaveDays(parsed.startDate, parsed.endDate, parsed.startHalf, parsed.endHalf, holidays);
	if (!count.ok) return c.json({ error: count.error }, 200);

	// Who else is already away on these days. Advisory only — nothing here can
	// refuse a booking, because the app does not know who covers for whom; it
	// only knows how to stop someone finding out by accident on the Monday.
	const viewer = c.get('user');
	const [coverage, headcount] = await Promise.all([
		db.coverageInRange(c.env.DB, parsed.startDate, parsed.endDate, viewer.email, c.req.query('exclude') ?? undefined),
		db.activeUserCount(c.env.DB),
	]);
	return c.json({ days: count.days, ...summariseCoverage(coverage, headcount, toLang(viewer.lang)) }, 200);
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
function summariseCoverage(coverage: Map<string, string[]>, headcount: number, lang: Lang) {
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
		},
	};
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

/**
 * Everything `validateBooking` needs, for a given user.
 *
 * `replacing` is the booking being edited, if any. It is excluded from the
 * overlap check — a booking always overlaps itself, so without this every edit
 * would be rejected as a clash with the very row it is rewriting — and its days
 * are credited back before the balance check, so shortening or retyping a
 * booking is never refused for a quota the booking itself is consuming.
 */
async function buildBookingContext(
	env: Env,
	email: string,
	parsed: { startDate: string; endDate: string },
	today: string,
	replacing?: LeaveRequest,
) {
	const year = Number(today.slice(0, 4));
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
		const allotted = quotas.find((q) => q.leave_type_id === t.id)?.days_allotted ?? 0;
		let spent = used.get(t.id) ?? 0;
		if (replacing && replacing.leave_type_id === t.id) spent = round(spent - replacing.days_total);
		remaining.set(t.id, round(allotted - spent));
	}

	return {
		holidays,
		existing: replacing ? existing.filter((e) => e.id !== replacing.id) : existing,
		types,
		remaining,
		today,
	};
}

app.post('/api/leave', async (c) => {
	const user = c.get('user');
	const today = c.get('today');
	const back = referrerPath(c.req.header('Referer'), c.req.url) ?? '/me';

	const form = await c.req.parseBody();
	const parsed = parseBooking(form as Record<string, unknown>);
	if ('error' in parsed) return redirectWithFlash(back, 'err', sayMessage(c, parsed.error));

	const ctx = await buildBookingContext(c.env, user.email, parsed, today);
	const check = validateBooking(parsed, ctx);
	if (!check.ok) return redirectWithFlash(back, 'err', sayMessage(c, check.error));

	const row: LeaveRequest = {
		id: crypto.randomUUID(),
		user_email: user.email,
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

	return redirectWithFlash(
		back,
		'ok',
		say(c, 'flash.booked', {
			count: check.days,
			days: check.days,
			type: check.type.label_en.toLowerCase(),
			typeTh: check.type.label_th,
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
	const user = c.get('user');
	const row = await db.getLeave(c.env.DB, id);
	if (!row) return { ok: false, error: say(c, 'flash.gone') };
	if (row.user_email !== user.email && !user.is_admin) {
		return { ok: false, error: say(c, 'flash.notYours') };
	}
	return { ok: true, row };
}

app.get('/leave/:id/edit', async (c) => {
	const user = c.get('user');
	const today = c.get('today');
	const id = c.req.param('id');

	const owned = await ownedLeave(c, id);
	if (!owned.ok) return redirectWithFlash('/me', 'err', owned.error);
	if (owned.row.status !== 'confirmed') {
		return redirectWithFlash('/me', 'err', say(c, 'flash.cancelledRebook'));
	}

	const [entry, types] = await Promise.all([db.getLeaveEntry(c.env.DB, id), db.listLeaveTypes(c.env.DB)]);
	if (!entry) return redirectWithFlash('/me', 'err', say(c, 'flash.gone'));

	return c.html(
		<EditPage
			user={user}
			entry={entry}
			types={types}
			today={today}
			onBehalfOf={entry.user_email === user.email ? undefined : entry.display_name}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			notice={flashOf(c.get('flash'), 'ok')}
		/>,
	);
});

app.post('/api/leave/:id/edit', async (c) => {
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
	if ('error' in parsed) return redirectWithFlash(back, 'err', sayMessage(c, parsed.error));

	// Validate against the owner of the booking, not whoever is editing it — an
	// admin fixing someone else's leave must be checked against that person's
	// quota and their other bookings.
	const ctx = await buildBookingContext(c.env, owned.row.user_email, parsed, today, owned.row);
	const check = validateBooking(parsed, ctx);
	if (!check.ok) return redirectWithFlash(back, 'err', sayMessage(c, check.error));

	const changed = await db.updateLeave(c.env.DB, id, {
		leave_type_id: parsed.leaveTypeId,
		start_date: parsed.startDate,
		end_date: parsed.endDate,
		start_half: parsed.startHalf,
		end_half: parsed.endHalf,
		days_total: check.days,
		note: parsed.note || null,
		note_private: parsed.notePrivate ? 1 : 0,
	}, c.get('user').email);
	if (!changed) return redirectWithFlash(done, 'err', say(c, 'flash.cancelledWhileEditing'));

	return redirectWithFlash(
		done,
		'ok',
		say(c, 'flash.updated', {
			count: check.days,
			days: check.days,
			type: check.type.label_en.toLowerCase(),
			typeTh: check.type.label_th,
		}),
	);
});

app.post('/api/leave/:id/cancel', async (c) => {
	const back = referrerPath(c.req.header('Referer'), c.req.url) ?? '/me';
	const id = c.req.param('id');

	const owned = await ownedLeave(c, id);
	if (!owned.ok) return redirectWithFlash(back, 'err', owned.error);

	const done = await db.cancelLeave(c.env.DB, id, c.get('user').email);
	return done
		? redirectWithFlash(back, 'ok', say(c, 'flash.cancelled'))
		: redirectWithFlash(back, 'err', say(c, 'flash.alreadyCancelled'));
});

// ---------------------------------------------------------------------------
// Personal dashboard
// ---------------------------------------------------------------------------

app.get('/me', async (c) => {
	const user = c.get('user');
	const today = c.get('today');
	const nowYear = Number(today.slice(0, 4));
	const year = clampInt(c.req.query('y'), nowYear, 2000, 2100);
	const { minYear, maxYear } = yearNavBounds(nowYear);

	const types = await db.listLeaveTypes(c.env.DB);
	const [balances, entries] = await Promise.all([
		db.balancesFor(c.env.DB, user.email, year, types),
		db.listUserLeave(c.env.DB, user.email, year),
	]);

	return c.html(
		<MePage
			user={user}
			year={year}
			minYear={minYear}
			maxYear={maxYear}
			balances={balances}
			entries={entries}
			types={types}
			today={today}
			// The VAPID public key is meant to be handed out — the browser needs
			// it to subscribe, and it can only be used to verify our signature,
			// never to make one.
			vapidPublicKey={pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : undefined}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			notice={flashOf(c.get('flash'), 'ok')}
		/>,
	);
});

/**
 * One person's leave, keyed by email rather than an internal id — the same
 * address Access already authenticates them with, and what the admin table
 * and the calendar both key off of.
 *
 * Privacy rule lives entirely here: the schedule (`entries`) is fetched and
 * shown regardless of who's asking, since it already sits on the shared
 * calendar. `balances` is only fetched, and only rendered, when the viewer is
 * the subject themselves or an admin — everyone else gets the section omitted
 * by never receiving the prop, not by receiving zeros. An unknown email gets
 * the exact same 404 as a real-but-mistyped one, so this route can't be used
 * to enumerate who has an account.
 */
app.get('/u/:email', async (c) => {
	const viewer = c.get('user');
	const today = c.get('today');
	const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();

	const subject = await db.getUser(c.env.DB, email);
	if (!subject) {
		return c.html(<ErrorPage title="Not found" detail="No such page." />, 404);
	}

	const nowYear = Number(today.slice(0, 4));
	const year = clampInt(c.req.query('y'), nowYear, 2000, 2100);
	const { minYear, maxYear } = yearNavBounds(nowYear);

	const canSeeBalances = viewer.email === subject.email || viewer.is_admin;
	const [entries, balances] = await Promise.all([
		db.listUserLeave(c.env.DB, subject.email, year),
		canSeeBalances ? db.balancesFor(c.env.DB, subject.email, year, await db.listLeaveTypes(c.env.DB)) : Promise.resolve(undefined),
	]);

	return c.html(
		<UserPage
			viewer={viewer}
			subject={subject}
			year={year}
			minYear={minYear}
			maxYear={maxYear}
			entries={entries}
			balances={balances}
			version={c.env.CF_VERSION_METADATA?.id}
		/>,
	);
});

app.post('/me/week-start', async (c) => {
	const user = c.get('user');
	const form = await c.req.parseBody();
	const weekStart = parseWeekStart(form.weekStart);
	// Only Sunday and Monday are offered; anything else is a crafted request,
	// and silently storing it would rotate the grid to an arbitrary column.
	if (weekStart === null) return redirectWithFlash('/me', 'err', say(c, 'flash.weekBad'));
	await db.setWeekStart(c.env.DB, user.email, weekStart);
	return redirectWithFlash('/me', 'ok', say(c, weekStart === 1 ? 'flash.weekMonday' : 'flash.weekSunday'));
});

app.post('/me/lang', async (c) => {
	const user = c.get('user');
	const form = await c.req.parseBody();
	const lang = String(form.lang ?? '');
	// Only the languages actually offered. Storing anything else would fall back
	// to English on every page while the radio button claimed otherwise.
	if (!isLang(lang)) return redirectWithFlash('/me', 'err', say(c, 'flash.langBad'));

	await db.setLanguage(c.env.DB, user.email, lang);
	// Translated into the language just chosen, not the one being left behind.
	return redirectWithFlash('/me', 'ok', t(lang, 'flash.langUpdated'));
});

app.post('/me/name', async (c) => {
	const user = c.get('user');
	const form = await c.req.parseBody();
	const name = String(form.displayName ?? '').trim().slice(0, 60);
	if (!name) return redirectWithFlash('/me', 'err', say(c, 'flash.nameEmpty'));
	await db.setDisplayName(c.env.DB, user.email, name);
	return redirectWithFlash('/me', 'ok', say(c, 'flash.nameUpdated'));
});

// ---------------------------------------------------------------------------
// Browser push
// ---------------------------------------------------------------------------

/**
 * Register this browser for the 08:00 digest.
 *
 * The subscription is owned by whoever is signed in now. That matters on a
 * shared machine: the browser hands back the same endpoint after a different
 * person signs in, and `saveSubscription` reassigns it rather than leaving
 * someone else's name on it.
 */
app.post('/api/push/subscribe', async (c) => {
	const user = c.get('user');
	const sub = parseSubscription(await c.req.json().catch(() => null));
	if (!sub) return c.json({ ok: false, error: 'Not a usable push subscription.' }, 400);

	await db.saveSubscription(c.env.DB, sub, user.email);
	return c.json({ ok: true });
});

/**
 * Stop pushing to this browser.
 *
 * Scoped to the owner, so knowing someone else's endpoint — which is not
 * secret; it travels to the push service on every send — does not let you
 * silence their notifications.
 */
app.post('/api/push/unsubscribe', async (c) => {
	const user = c.get('user');
	const body = (await c.req.json().catch(() => null)) as { endpoint?: unknown } | null;
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
	if (!endpoint) return c.json({ ok: false, error: 'No endpoint.' }, 400);

	await db.deleteSubscription(c.env.DB, endpoint, user.email);
	// Deliberately 200 whether or not a row was deleted. The browser has already
	// unsubscribed locally by this point, so an error here would only invite it
	// to retry something that can never succeed.
	return c.json({ ok: true });
});

/**
 * Send a test notification to the caller's own browsers.
 *
 * Without this the only way to find out whether push works is to wait until
 * 08:00 the next working day, which is how a broken setup stays broken.
 */
app.post('/api/push/test', async (c) => {
	const user = c.get('user');
	if (!pushConfigured(c.env)) return c.json({ ok: false, error: 'Push is not configured on the server.' }, 503);

	const subs = await db.subscriptionsFor(c.env.DB, user.email);
	if (subs.length === 0) return c.json({ ok: false, error: 'This browser is not subscribed yet.' }, 409);

	const payload = JSON.stringify({
		title: 'wan-nee-la',
		body: 'Test notification. The daily digest will look like this, at 08:00.',
		url: '/me',
		tag: 'wnl-test',
	});
	const results = await Promise.all(subs.map((s) => sendPush(s, payload, vapidKeys(c.env))));

	// Prune here too: a test is exactly when a stale subscription surfaces.
	await Promise.all(results.filter((r) => r.gone).map((r) => db.deleteSubscriptionByEndpoint(c.env.DB, r.endpoint)));

	const delivered = results.filter((r) => r.ok).length;
	if (delivered === 0) {
		return c.json({ ok: false, error: results.find((r) => r.error)?.error ?? 'No browser accepted the push.' }, 502);
	}
	return c.json({ ok: true, delivered });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const adminOnly: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
	if (!c.get('user').is_admin) {
		return c.html(<ErrorPage title="Admins only" detail="Ask an admin to grant you access." />, 403);
	}
	await next();
};

app.use('/admin', adminOnly);
app.use('/admin/*', adminOnly);

app.get('/admin', async (c) => {
	const user = c.get('user');
	const today = c.get('today');
	const year = clampInt(c.req.query('y'), Number(today.slice(0, 4)), 2000, 2100);

	const [users, types, holidays, groupId, log, audit] = await Promise.all([
		db.listUsers(c.env.DB),
		db.listLeaveTypes(c.env.DB),
		db.listHolidays(c.env.DB, `${year}-01-01`, `${year + 1}-12-31`),
		resolveGroupId(c.env),
		db.recentNotifications(c.env.DB),
		db.recentAudit(c.env.DB),
	]);

	const quotas = (await Promise.all(users.map((u) => db.listQuotas(c.env.DB, u.email, year)))).flat();
	const configured = lineConfigured(c.env);

	return c.html(
		<AdminPage
			user={user}
			year={year}
			users={users}
			types={types}
			quotas={quotas}
			holidays={holidays}
			audit={audit}
			today={today}
			line={{ configured, groupId, ready: configured && Boolean(groupId) }}
			log={log}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			notice={flashOf(c.get('flash'), 'ok')}
		/>,
	);
});

app.post('/admin/quotas', async (c) => {
	const form = await c.req.parseBody();
	const email = String(form.email ?? '').trim().toLowerCase();
	const year = Number(form.year);
	if (!email || !Number.isInteger(year)) return redirectWithFlash('/admin', 'err', say(c, 'flash.badRequest'));

	const types = await db.listLeaveTypes(c.env.DB);
	for (const t of types) {
		const raw = form[`q_${t.id}`];
		if (raw === undefined) continue;
		const days = Number(raw);
		if (!Number.isFinite(days) || days < 0 || days > 365) continue;
		await db.setQuota(c.env.DB, email, year, t.id, round(days));
	}
	return redirectWithFlash(`/admin?y=${year}`, 'ok', say(c, 'flash.quotasSaved', { email }));
});

app.post('/admin/quotas/bulk', async (c) => {
	const form = await c.req.parseBody();
	const leaveTypeId = Number(form.leaveTypeId);
	const days = Number(form.days);
	const year = Number(form.year);
	if (!Number.isInteger(year)) return redirectWithFlash('/admin', 'err', say(c, 'flash.badRequest'));
	if (!Number.isFinite(days) || days < 0 || days > 365) {
		return redirectWithFlash('/admin', 'err', say(c, 'flash.daysRange'));
	}

	const types = await db.listLeaveTypes(c.env.DB);
	if (!types.some((t) => t.id === leaveTypeId)) {
		return redirectWithFlash('/admin', 'err', say(c, 'flash.unknownType'));
	}

	const count = await db.bulkSetQuota(c.env.DB, year, leaveTypeId, round(days));
	return redirectWithFlash(`/admin?y=${year}`, 'ok', say(c, 'flash.quotasBulk', { count, n: count }));
});

app.post('/admin/user', async (c) => {
	const actor = c.get('user');
	const form = await c.req.parseBody();
	const email = String(form.email ?? '').trim().toLowerCase();
	if (!email) return redirectWithFlash('/admin', 'err', say(c, 'flash.badRequest'));

	const isAdmin = form.isAdmin === '1';
	const active = form.active === '1';

	// Guard against locking everyone out: the last admin cannot demote or
	// deactivate themselves, because nobody would be left who can undo it.
	if (email === actor.email && (!isAdmin || !active)) {
		const admins = (await db.listUsers(c.env.DB)).filter((u) => u.is_admin && u.active);
		if (admins.length <= 1) {
			return redirectWithFlash('/admin', 'err', say(c, 'flash.onlyAdmin'));
		}
	}

	await db.setAdmin(c.env.DB, email, isAdmin);
	await db.setActive(c.env.DB, email, active);
	return redirectWithFlash('/admin', 'ok', say(c, 'flash.userUpdated', { email }));
});

/**
 * Preview the digest without sending. Runs the real job in dry-run mode, so
 * what an admin sees here is produced by the same code that posts at 08:00.
 */
app.post('/admin/notify/preview', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim() || c.get('today');
	if (!isValidDate(date)) return redirectWithFlash('/admin', 'err', say(c, 'flash.badDate'));

	const week = form.kind === 'week';
	const outcome = week
		? await runWeekAhead(c.env, date, { dryRun: true, allowAnyDay: true })
		: await runDigest(c.env, date, { dryRun: true });
	const summary =
		outcome.status === 'dry_run'
			? say(c, 'flash.wouldPost', { count: outcome.people, n: outcome.people })
			: say(c, 'flash.wouldNotPost', { reason: say(c, `status.${outcome.status}`) });

	// The preview text itself is stashed in the flash rather than the URL —
	// query strings carrying prose get blocked by the WAF (docs/ISSUES.md #15).
	return redirectWithFlash('/admin', 'ok', outcome.text ? `${summary}\n\n${outcome.text}` : summary);
});

/** Send the digest now. Used to verify a fresh LINE setup, and to retry a failure. */
app.post('/admin/notify/send', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim() || c.get('today');
	if (!isValidDate(date)) return redirectWithFlash('/admin', 'err', say(c, 'flash.badDate'));

	// `force` comes from the tick box in both cases. Only the day gate is
	// relaxed for a manual week-ahead send — an admin pressing the button twice
	// must still hit the duplicate guard.
	const force = form.force === '1';
	const outcome =
		form.kind === 'week'
			? await runWeekAhead(c.env, date, { force, allowAnyDay: true })
			: await runDigest(c.env, date, { force });

	if (outcome.status === 'sent') {
		// Says which channels actually delivered, rather than naming LINE when the
		// message may well have gone only to browsers.
		const sent = outcome.channels
			.filter((ch) => ch.status === 'sent')
			.map((ch) =>
				ch.channel === 'push' ? say(c, 'flash.browsers', { count: ch.recipients ?? 0, n: ch.recipients ?? 0 }) : say(c, 'flash.line'),
			)
			.join(' + ');
		return redirectWithFlash('/admin', 'ok', say(c, 'flash.sentTo', { count: outcome.people, channels: sent, n: outcome.people }));
	}
	if (outcome.status === 'failed') {
		return redirectWithFlash('/admin', 'err', say(c, 'flash.sendFailed', { error: outcome.error ?? '—' }));
	}
	return redirectWithFlash('/admin', 'err', say(c, 'flash.nothingSent', { reason: say(c, `status.${outcome.status}`) }));
});

/**
 * Import a pasted list of holidays.
 *
 * Nothing is written unless every line parses. A partial import of a
 * government holiday notice is the worst outcome: the calendar looks updated,
 * and the three days that failed silently draw down everyone's quota.
 */
app.post('/admin/holidays/import', async (c) => {
	const form = await c.req.parseBody();
	const text = String(form.list ?? '');
	if (!text.trim()) return redirectWithFlash('/admin', 'err', say(c, 'flash.nothingToImport'));

	const { holidays, errors } = parseHolidayList(text);
	if (errors.length > 0) {
		const shown = errors.slice(0, 5).map((e) => `line ${e.line}: ${e.reason}`).join('\n');
		const more = errors.length > 5 ? `\n…and ${errors.length - 5} more.` : '';
		return redirectWithFlash('/admin', 'err', `${say(c, 'flash.importFailed')}\n\n${shown}${more}`);
	}
	if (holidays.length === 0) return redirectWithFlash('/admin', 'err', say(c, 'flash.importEmpty'));

	const written = await db.bulkUpsertHolidays(c.env.DB, holidays);
	return redirectWithFlash(
		'/admin',
		'ok',
		say(c, 'flash.imported', { count: written, n: written, from: holidays[0].date, to: holidays[holidays.length - 1].date }),
	);
});

app.post('/admin/holiday', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim();
	const label = String(form.label ?? '').trim().slice(0, 80);
	if (!isValidDate(date) || !label) return redirectWithFlash('/admin', 'err', say(c, 'flash.holidayNeedsBoth'));
	await db.addHoliday(c.env.DB, date, label);
	return redirectWithFlash('/admin', 'ok', say(c, 'flash.holidayAdded', { date }));
});

app.post('/admin/holiday/delete', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim();
	if (!isValidDate(date)) return redirectWithFlash('/admin', 'err', say(c, 'flash.badDate'));
	await db.removeHoliday(c.env.DB, date);
	return redirectWithFlash('/admin', 'ok', `Removed ${date}.`);
});

app.notFound((c) => {
	const user = c.get('user');
	if (!user) return c.html(<ErrorPage title="Not found" detail="No such page." />, 404);
	return c.html(
		<Layout title="Not found" user={user} active="calendar">
			<div class="card centered">
				<h1>Not found</h1>
				<p class="muted">No such page.</p>
			</div>
		</Layout>,
		404,
	);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) return fallback;
	return n;
}

/**
 * Bounds for the prev/next year links on /me and /u/:email.
 *
 * `clampInt` above still allows a hand-edited `?y=` anywhere from 2000 to
 * 2100 — those routes work fine given a request for a year that far off, they
 * just have nothing to show. The links shouldn't invite that walk one click
 * at a time, so they stop five years either side of the current year, which
 * covers "last year's balances" and then some without wandering into empty
 * years.
 */
function yearNavBounds(nowYear: number): { minYear: number; maxYear: number } {
	return { minYear: nowYear - 5, maxYear: nowYear + 5 };
}

function validDateOr(raw: string | undefined, fallback: string): string {
	return raw && isValidDate(raw) ? raw : fallback;
}

/**
 * Path to bounce back to after a form post. Only the path and query of a
 * same-origin URL are kept — a Referer is attacker-influenceable, and feeding
 * it whole into a redirect is an open-redirect.
 */
/**
 * A client-supplied redirect target, accepted only when it is a plain
 * same-origin path. A bare `/` prefix is not enough: `//evil.example` is
 * protocol-relative and would leave the site, which is an open redirect.
 */
function safePath(raw: unknown): string | null {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value.startsWith('/') || value.startsWith('//')) return null;
	if (value.includes('\\') || value.includes('\n') || value.includes('\r')) return null;
	return value.slice(0, 200);
}

/**
 * Where a form was submitted from, as a path on this site.
 *
 * Two guards, because this feeds a `Location` header:
 *
 *  - the referrer must be *this* origin. A page elsewhere can set its own
 *    `Referrer-Policy: unsafe-url` and send us any URL it likes; only our own
 *    pages get to say where a redirect goes.
 *  - the extracted path goes through `safePath` like every other redirect
 *    target. `new URL('https://evil.example//evil.com').pathname` is
 *    `//evil.com`, which starts with a slash and would otherwise sail through
 *    as a protocol-relative redirect off the site.
 */
function referrerPath(referer: string | undefined, requestUrl: string): string | null {
	if (!referer) return null;
	try {
		const u = new URL(referer);
		if (u.origin !== new URL(requestUrl).origin) return null;
		return safePath(u.pathname + u.search);
	} catch {
		return null;
	}
}

/**
 * Post-redirect-get flash messages, carried in a short-lived cookie.
 *
 * These used to ride in the query string (`/me?ok=Booked 5 day(s)…`). Cloudflare's
 * managed "Block Attacks (WAF Attack Score)" rule blocked those redirects: free
 * prose in a query string — parentheses, colons, quotes — scores like an
 * injection probe, so a successful booking bounced the user into a WAF block
 * page. The message is UI state, not addressable content, so it does not belong
 * in the URL at all.
 *
 * Base64url keeps punctuation out of the header value too, so the cookie itself
 * cannot trip the same rule.
 */
const FLASH_COOKIE = 'wnl_flash';
const FLASH_MAX = 300;

export type Flash = { kind: 'ok' | 'err'; message: string } | null;

function flashCookie(kind: 'ok' | 'err', message: string): string {
	const payload = JSON.stringify({ k: kind, m: message.slice(0, FLASH_MAX) });
	const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
	// Max-Age is 30s: long enough to survive the redirect, short enough that a
	// stale message never reappears on a later visit.
	return `${FLASH_COOKIE}=${b64}; Path=/; Max-Age=30; HttpOnly; Secure; SameSite=Lax`;
}

const FLASH_CLEAR = `${FLASH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** The message text when the flash is of this kind, else undefined. */
function flashOf(flash: Flash, kind: 'ok' | 'err'): string | undefined {
	return flash && flash.kind === kind ? flash.message : undefined;
}

function readFlash(cookieHeader: string | undefined): Flash {
	if (!cookieHeader) return null;
	const m = new RegExp(`(?:^|;\\s*)${FLASH_COOKIE}=([^;]+)`).exec(cookieHeader);
	if (!m) return null;
	try {
		const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
		const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
		const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { k?: string; m?: string };
		if ((parsed.k !== 'ok' && parsed.k !== 'err') || typeof parsed.m !== 'string') return null;
		return { kind: parsed.k, message: parsed.m.slice(0, FLASH_MAX) };
	} catch {
		// A malformed cookie is not worth an error page — just show no message.
		return null;
	}
}

/**
 * Redirect, carrying the message in the flash cookie.
 *
 * The query string is preserved. It used to be stripped because the message
 * itself travelled there; now that it does not, keeping the query is what lets
 * a redirect return to the month that was being viewed or the year being
 * edited.
 */
function redirectWithFlash(path: string, kind: 'ok' | 'err', message: string): Response {
	return new Response(null, {
		status: 303,
		headers: { Location: path, 'Set-Cookie': flashCookie(kind, message) },
	});
}

export default {
	fetch: app.fetch,

	/**
	 * 08:00 Asia/Bangkok (01:00 UTC — Thailand has no DST).
	 *
	 * Never throws: a rejected scheduled handler is retried by the platform, and
	 * a retry that got as far as sending would post a second message to the
	 * group. The outcome is logged instead and recorded in notification_log,
	 * which /admin surfaces.
	 */
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		try {
			const outcome = await runDigest(env);
			console.log(JSON.stringify({ job: 'daily-leave-digest', ...outcome, text: undefined }));

			// Mondays carry a second post. It claims its own row, so neither can
			// suppress the other, and it decides for itself whether today is a
			// Monday worth posting about.
			const week = await runWeekAhead(env);
			console.log(JSON.stringify({ job: 'week-ahead-digest', ...week, text: undefined }));
		} catch (err) {
			console.log(
				JSON.stringify({
					job: 'daily-leave-digest',
					status: 'error',
					error: err instanceof Error ? err.message : String(err),
				}),
			);
		}
	},
};
