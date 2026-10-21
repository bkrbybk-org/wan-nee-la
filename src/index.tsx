import { Hono } from 'hono';
import { authenticate, isService } from './auth/access.ts';
import { bangkokToday } from './domain/dates.ts';
import * as db from './repo/db.ts';
import { ErrorPage, THEME_SCRIPT } from './views/layout.tsx';
import { groupIdFromWebhook, verifyLineSignature } from './notify/line.ts';
import { GROUP_ID_KEY, runDigest, runWeekAhead } from './notify/digest.ts';
import { runYearEnd } from './notify/yearend.ts';
import type { Env } from './types.ts';
import { jsonError, errorPage, type AppEnv } from './server/common.tsx';
import { FLASH_CLEAR, readFlash } from './server/flash.ts';
import calendarRoutes from './routes/calendar.tsx';
import apiRoutes from './routes/api.tsx';
import leaveRoutes from './routes/leave.tsx';
import meRoutes from './routes/me.tsx';
import pushRoutes from './routes/push.tsx';
import adminRoutes from './routes/admin.tsx';

/**
 * What an Access service token may ask for. Both are read-only, and neither
 * needs to know who is asking — which is what makes them safe to open to a
 * caller that is not a person. Everything else, including the preview (it
 * costs a booking against *someone's* quota) and every write, stays human-only.
 */
const MACHINE_READABLE = new Set([
	'GET /api/v1/leave',
	'GET /api/v1/leave/by-date',
	'GET /api/v1/holidays',
	'GET /api/v1/balances',
]);

const app = new Hono<AppEnv>();

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
	// 503 when D1 is unreachable, so an uptime monitor that only looks at the
	// status code still notices. The body is the same either way.
	return c.json({
		ok: dbOk,
		db: dbOk,
		version: meta?.id ?? null,
		deployedAt: meta?.timestamp ?? null,
		bangkokToday: bangkokToday(),
		accessConfigured: Boolean(c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD),
		// Surfaced so a production check can catch the dev bypass being left on.
		devAuthBypass: c.env.DEV_AUTH_BYPASS === '1',
	}, dbOk ? 200 : 503);
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

	// A machine caller. It has no employee record, reads only the two feeds,
	// and gets no notes at all — not "no private notes", none: a token cannot
	// be the colleague a shared note was shared with.
	if (isService(auth.identity)) {
		if (!MACHINE_READABLE.has(`${c.req.method} ${new URL(c.req.url).pathname}`)) {
			return jsonError(c, `Service token "${auth.identity.service}" may read ${[...MACHINE_READABLE].join(' and ')}, nothing else.`, 403);
		}
		c.set('service', auth.identity.service);
		c.set('today', today);
		await next();
		return;
	}

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

// Every route, in the order they were registered when this was one file.
// Each module is its own Hono app, mounted at the root: the middleware above
// runs first for all of them, and the handlers below catch what they throw.
app.route('/', calendarRoutes);
app.route('/', apiRoutes);
app.route('/', leaveRoutes);
app.route('/', meRoutes);
app.route('/', pushRoutes);
app.route('/', adminRoutes);

/**
 * Anything a route throws.
 *
 * One JSON line per failure, for Workers Logs (`observability` in the config)
 * to keep: what broke, where, and in which version — so a 500 nobody was
 * watching still leaves a trace. The *route pattern* is logged, never the path:
 * `/u/:email` would otherwise write an address into the log on every failure
 * there. No query, no body, no identity. A D1 error message names the SQL, not
 * the values bound to it.
 *
 * The caller gets the app's own shapes rather than Hono's bare "Internal Server
 * Error": the one JSON error shape on `/api/…`, a page everywhere else.
 */
app.onError((err, c) => {
	console.error(
		JSON.stringify({
			event: 'unhandled-error',
			method: c.req.method,
			route: c.req.routePath,
			error: err.name,
			message: err.message.slice(0, 500),
			stack: err.stack?.split('\n').slice(1, 6).join('\n'),
			version: c.env.CF_VERSION_METADATA?.id,
		}),
	);
	if (c.req.path.startsWith('/api/')) return jsonError(c, 'Something went wrong on the server. Try again shortly.', 500);
	return errorPage(c, 500, 'err.server', 'err.serverDetail');
});

app.notFound((c) => errorPage(c, 404, 'err.notFound', 'err.notFoundDetail'));

export default {
	fetch: app.fetch,

	/**
	 * 09:00 Asia/Bangkok, Monday to Friday (02:00 UTC — Thailand has no DST).
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

		// Once a year, in November: who still has annual leave unbooked. Claimed
		// per year, so only the month's first weekday sends it. Its own try, so
		// neither it nor the digest can stop the other.
		try {
			const yearEnd = await runYearEnd(env, bangkokToday());
			if (yearEnd.status !== 'not_due') console.log(JSON.stringify({ job: 'year-end-reminder', trigger: 'cron', ...yearEnd }));
		} catch (err) {
			console.log(JSON.stringify({ job: 'year-end-reminder', status: 'error', error: err instanceof Error ? err.message : String(err) }));
		}

		// After the posts and in its own try, so housekeeping can neither delay
		// nor block the one thing this handler exists to deliver.
		try {
			const pruned = await db.pruneHistory(env.DB, bangkokToday());
			console.log(JSON.stringify({ job: 'prune-history', ...pruned }));
		} catch (err) {
			console.log(
				JSON.stringify({ job: 'prune-history', status: 'error', error: err instanceof Error ? err.message : String(err) }),
			);
		}
	},
};

