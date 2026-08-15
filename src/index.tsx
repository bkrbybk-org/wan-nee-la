import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { authenticate } from './auth/access.ts';
import {
	bangkokNow,
	bangkokToday,
	countLeaveDays,
	firstOfMonth,
	isValidDate,
	lastOfMonth,
	monthGrid,
} from './domain/dates.ts';
import { parseBooking, round, validateBooking } from './domain/leave.ts';
import * as db from './repo/db.ts';
import { AdminPage } from './views/admin.tsx';
import { CalendarPage } from './views/calendar.tsx';
import { ErrorPage, Layout } from './views/layout.tsx';
import { MePage } from './views/me.tsx';
import type { Env, LeaveRequest, User } from './types.ts';

type Vars = { user: User; today: string; flash: Flash };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * Pick up a flash message and immediately expire the cookie, so a message is
 * shown exactly once and never resurfaces on a refresh.
 */
app.use('*', async (c, next) => {
	const flash = readFlash(c.req.header('Cookie'));
	c.set('flash', flash);
	await next();
	if (flash) c.header('Set-Cookie', FLASH_CLEAR, { append: true });
});

app.use('*', async (c, next) => {
	await next();
	c.header('X-Robots-Tag', 'noindex, nofollow');
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('Referrer-Policy', 'no-referrer');
	c.header('X-Frame-Options', 'DENY');
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
 * because every mutation in this app is a same-origin form submit.
 */
app.use('*', async (c, next) => {
	if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
	const origin = c.req.header('Origin');
	if (origin) {
		const host = c.req.header('Host');
		let originHost = '';
		try {
			originHost = new URL(origin).host;
		} catch {
			originHost = '';
		}
		if (!host || originHost !== host) {
			return c.text('Cross-origin request rejected.', 403);
		}
	}
	return next();
});

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
	const grid = monthGrid(year, month);
	const from = grid[0];
	const to = grid[grid.length - 1];

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

/** JSON feed for the calendar. Same data the grid renders, for scripts and future views. */
app.get('/api/leave', async (c) => {
	const today = c.get('today');
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
			email: e.user_email,
			type: e.type_code,
			label: e.type_label_en,
			color: e.color,
			start: e.start_date,
			end: e.end_date,
			startHalf: e.start_half,
			endHalf: e.end_half,
			days: e.days_total,
			note: e.note,
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
	return c.json(count.ok ? { days: count.days } : { error: count.error }, 200);
});

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

app.post('/api/leave', async (c) => {
	const user = c.get('user');
	const today = c.get('today');
	const year = Number(today.slice(0, 4));
	const back = referrerPath(c.req.header('Referer')) ?? '/me';

	const form = await c.req.parseBody();
	const parsed = parseBooking(form as Record<string, unknown>);
	if ('error' in parsed) return redirectWithFlash(back, 'err', parsed.error);

	const [types, existing, quotas, used] = await Promise.all([
		db.listLeaveTypes(c.env.DB),
		db.confirmedRanges(c.env.DB, user.email),
		db.listQuotas(c.env.DB, user.email, year),
		db.usedByType(c.env.DB, user.email, year),
	]);

	// Holidays are looked up across the request's own range, plus slack, rather
	// than the whole year — a booking can legitimately cross into next year.
	const holidays = await db.holidaySet(c.env.DB, parsed.startDate, parsed.endDate);

	const remaining = new Map<number, number>();
	for (const t of types) {
		const allotted = quotas.find((q) => q.leave_type_id === t.id)?.days_allotted ?? 0;
		remaining.set(t.id, round(allotted - (used.get(t.id) ?? 0)));
	}

	const check = validateBooking(parsed, { holidays, existing, types, remaining, today });
	if (!check.ok) return redirectWithFlash(back, 'err', check.error);

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
		status: 'confirmed',
		created_at: bangkokNow(),
		cancelled_at: null,
	};
	await db.insertLeave(c.env.DB, row);

	return redirectWithFlash(back, 'ok', `Booked ${check.days} day(s) of ${check.type.label_en.toLowerCase()} leave.`);
});

app.post('/api/leave/:id/cancel', async (c) => {
	const user = c.get('user');
	const back = referrerPath(c.req.header('Referer')) ?? '/me';
	const id = c.req.param('id');

	const row = await db.getLeave(c.env.DB, id);
	if (!row) return redirectWithFlash(back, 'err', 'That booking no longer exists.');
	// Ownership check before anything else: an id is guessable in principle and
	// admins are the only ones who may touch someone else's row.
	if (row.user_email !== user.email && !user.is_admin) {
		return redirectWithFlash(back, 'err', 'That is not your booking.');
	}

	const done = await db.cancelLeave(c.env.DB, id);
	return done
		? redirectWithFlash(back, 'ok', 'Booking cancelled.')
		: redirectWithFlash(back, 'err', 'That booking was already cancelled.');
});

// ---------------------------------------------------------------------------
// Personal dashboard
// ---------------------------------------------------------------------------

app.get('/me', async (c) => {
	const user = c.get('user');
	const today = c.get('today');
	const year = clampInt(c.req.query('y'), Number(today.slice(0, 4)), 2000, 2100);

	const types = await db.listLeaveTypes(c.env.DB);
	const [balances, entries] = await Promise.all([
		db.balancesFor(c.env.DB, user.email, year, types),
		db.listUserLeave(c.env.DB, user.email, year),
	]);

	return c.html(
		<MePage
			user={user}
			year={year}
			balances={balances}
			entries={entries}
			types={types}
			today={today}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			notice={flashOf(c.get('flash'), 'ok')}
		/>,
	);
});

app.post('/me/name', async (c) => {
	const user = c.get('user');
	const form = await c.req.parseBody();
	const name = String(form.displayName ?? '').trim().slice(0, 60);
	if (!name) return redirectWithFlash('/me', 'err', 'Display name cannot be empty.');
	await db.setDisplayName(c.env.DB, user.email, name);
	return redirectWithFlash('/me', 'ok', 'Name updated.');
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

	const [users, types, holidays] = await Promise.all([
		db.listUsers(c.env.DB),
		db.listLeaveTypes(c.env.DB),
		db.listHolidays(c.env.DB, `${year}-01-01`, `${year + 1}-12-31`),
	]);

	const quotas = (await Promise.all(users.map((u) => db.listQuotas(c.env.DB, u.email, year)))).flat();

	return c.html(
		<AdminPage
			user={user}
			year={year}
			users={users}
			types={types}
			quotas={quotas}
			holidays={holidays}
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
	if (!email || !Number.isInteger(year)) return redirectWithFlash('/admin', 'err', 'Bad request.');

	const types = await db.listLeaveTypes(c.env.DB);
	for (const t of types) {
		const raw = form[`q_${t.id}`];
		if (raw === undefined) continue;
		const days = Number(raw);
		if (!Number.isFinite(days) || days < 0 || days > 365) continue;
		await db.setQuota(c.env.DB, email, year, t.id, round(days));
	}
	return redirectWithFlash(`/admin?y=${year}`, 'ok', `Quotas saved for ${email}.`);
});

app.post('/admin/user', async (c) => {
	const actor = c.get('user');
	const form = await c.req.parseBody();
	const email = String(form.email ?? '').trim().toLowerCase();
	if (!email) return redirectWithFlash('/admin', 'err', 'Bad request.');

	const isAdmin = form.isAdmin === '1';
	const active = form.active === '1';

	// Guard against locking everyone out: the last admin cannot demote or
	// deactivate themselves, because nobody would be left who can undo it.
	if (email === actor.email && (!isAdmin || !active)) {
		const admins = (await db.listUsers(c.env.DB)).filter((u) => u.is_admin && u.active);
		if (admins.length <= 1) {
			return redirectWithFlash('/admin', 'err', 'You are the only admin — promote someone else first.');
		}
	}

	await db.setAdmin(c.env.DB, email, isAdmin);
	await db.setActive(c.env.DB, email, active);
	return redirectWithFlash('/admin', 'ok', `Updated ${email}.`);
});

app.post('/admin/holiday', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim();
	const label = String(form.label ?? '').trim().slice(0, 80);
	if (!isValidDate(date) || !label) return redirectWithFlash('/admin', 'err', 'Need a valid date and a label.');
	await db.addHoliday(c.env.DB, date, label);
	return redirectWithFlash('/admin', 'ok', `Added ${date}.`);
});

app.post('/admin/holiday/delete', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim();
	if (!isValidDate(date)) return redirectWithFlash('/admin', 'err', 'Bad date.');
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

function validDateOr(raw: string | undefined, fallback: string): string {
	return raw && isValidDate(raw) ? raw : fallback;
}

/**
 * Path to bounce back to after a form post. Only the path and query of a
 * same-origin URL are kept — a Referer is attacker-influenceable, and feeding
 * it whole into a redirect is an open-redirect.
 */
function referrerPath(referer: string | undefined): string | null {
	if (!referer) return null;
	try {
		const u = new URL(referer);
		return u.pathname.startsWith('/') ? u.pathname : null;
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

/** Redirect to a bare path, carrying the message in the flash cookie. */
function redirectWithFlash(path: string, kind: 'ok' | 'err', message: string): Response {
	const [base] = path.split('?');
	return new Response(null, {
		status: 303,
		headers: { Location: base, 'Set-Cookie': flashCookie(kind, message) },
	});
}

export default {
	fetch: app.fetch,

	/**
	 * 08:00 Asia/Bangkok. The LINE push is phase 4 and not built yet; this
	 * records what it *would* have sent so the schedule and the query are
	 * proven correct before a message ever reaches a company group chat.
	 */
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		const today = bangkokToday();
		const entries = await db.listLeaveInRange(env.DB, today, today);
		const holidays = await db.holidaySet(env.DB, today, today);
		const skip = holidays.has(today) || entries.length === 0;
		console.log(
			JSON.stringify({
				job: 'daily-leave-digest',
				date: today,
				people: entries.length,
				status: skip ? 'skipped_empty' : 'would_send',
				note: 'LINE push not implemented (docs/PLAN.md phase 4)',
			}),
		);
	},
};
