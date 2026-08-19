#!/usr/bin/env node
/**
 * Route-level smoke tests.
 *
 * The unit suites cover pure functions. This covers the HTTP layer: the CSRF
 * guard, ownership checks, booking rules as they are actually enforced over a
 * request, the digest's decisions, and the LINE webhook's signature check.
 * Those are the app's security guarantees, and none of them are reachable from
 * a pure-function test.
 *
 * Design notes, because the failure mode here is a suite that passes without
 * testing anything:
 *
 *  - The server is booted by this script and health-checked before a single
 *    assertion runs. If it does not come up, the run fails loudly with the
 *    server log rather than reporting zero failures.
 *  - A minimum assertion count is enforced at the end. If a section throws
 *    early, the count falls short and the run fails even though nothing
 *    explicitly reported a failure.
 *  - No secrets and no outbound network. It runs against the committed
 *    template config with vars injected on the command line, so it behaves
 *    identically on a laptop and on a CI runner with no .dev.vars. The digest
 *    is only exercised where it returns before contacting LINE.
 *  - State lives in a scratch --persist-to directory, wiped at start, so a
 *    developer's local database is never touched and runs are deterministic.
 *
 * Run: npm run test:smoke
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Randomised per run so a stray worker left behind by an earlier run can never
// be mistaken for this one's server.
const PORT = Number(process.env.SMOKE_PORT ?? 8800 + Math.floor(Math.random() * 900));
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHANNEL_SECRET = 'smoke-channel-secret';
const ADMIN = 'admin@example.com';
const OTHER = 'other@example.com';
const STATE = mkdtempSync(join(tmpdir(), 'wnl-smoke-'));

/** Assertions that must run for the suite to be considered complete. */
const MIN_ASSERTIONS = 62;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
	if (ok) {
		pass++;
		console.log(`PASS: ${name}`);
	} else {
		fail++;
		failures.push(`${name} -> ${detail}`);
		console.log(`FAIL: ${name} -> ${detail}`);
	}
}

const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

const WRANGLER = ['wrangler', 'dev', '--config', 'wrangler.jsonc', '--port', String(PORT), '--persist-to', STATE];
let server = null;
let serverLog = '';

function d1(sql, file) {
	const args = ['wrangler', 'd1', 'execute', 'wan-nee-la', '--local', '--persist-to', STATE];
	args.push(file ? '--file' : '--command', file ?? sql);
	const res = spawnSync('npx', args, { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
	if (res.status !== 0) {
		throw new Error(`d1 failed: ${(res.stderr || res.stdout || '').slice(0, 600)}`);
	}
	return res.stdout;
}

/**
 * Rows from a d1 query.
 *
 * wrangler prints a banner before the JSON, so asserting with a regex over the
 * raw stdout matches the banner as readily as the data. Parse it properly and
 * fail loudly if the shape is not what we expect, rather than quietly treating
 * an unparseable result as "no rows".
 */
function d1Rows(sql) {
	const out = d1(sql);
	const start = out.indexOf('[');
	if (start === -1) throw new Error(`no JSON in d1 output: ${out.slice(0, 300)}`);
	const parsed = JSON.parse(out.slice(start));
	const results = parsed?.[0]?.results;
	if (!Array.isArray(results)) throw new Error(`unexpected d1 shape: ${out.slice(0, 300)}`);
	return results;
}

async function startServer(devEmail) {
	serverLog = '';
	server = spawn(
		'npx',
		[
			...WRANGLER,
			'--var', 'DEV_AUTH_BYPASS:1',
			'--var', `DEV_EMAIL:${devEmail}`,
			'--var', `LINE_CHANNEL_SECRET:${CHANNEL_SECRET}`,
			// Forced empty, overriding any real token a developer has in their
			// .dev.vars. Without this the digest tests would actually call
			// api.line.me from a laptop and not from CI, so the suite would test
			// two different things depending on where it ran — and would fail on
			// a machine with no outbound network.
			'--var', 'LINE_CHANNEL_ACCESS_TOKEN:',
		],
		{
			env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
			stdio: ['ignore', 'pipe', 'pipe'],
			// Own process group. `npx` is a wrapper around wrangler, which itself
			// runs workerd as a child; signalling only the wrapper leaves workerd
			// alive and still holding the port, so the next boot in this suite
			// cannot bind. Killing the group takes the whole tree down.
			detached: true,
		},
	);
	server.stdout.on('data', (b) => (serverLog += b));
	server.stderr.on('data', (b) => (serverLog += b));

	for (let i = 0; i < 120; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		try {
			const res = await fetch(`${BASE}/health`);
			if (res.ok) {
				// Prove the identity actually took effect, so a mis-injected var
				// cannot silently make every later assertion meaningless.
				const body = await res.json();
				if (!body.devAuthBypass) throw new Error('dev auth bypass did not take effect');

				// And prove this is a server signed in as `devEmail`, not some
				// other process answering on the port. Without this an orphaned
				// worker from an earlier session would quietly run the
				// authorisation tests as the wrong user — and pass them.
				const page = await (await fetch(`${BASE}/`)).text();
				if (!page.includes(`title="${devEmail}"`)) {
					throw new Error(`server on ${BASE} is not signed in as ${devEmail}`);
				}
				return;
			}
		} catch {
			// not up yet
		}
	}
	throw new Error(`server did not start on ${BASE} as ${devEmail}\n--- log ---\n${serverLog.slice(-3000)}`);
}

/** True while something is still answering on the port. */
async function portBusy() {
	try {
		await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) });
		return true;
	} catch {
		return false;
	}
}

async function stopServer() {
	if (!server) return;
	const child = server;
	server = null;

	const dead = new Promise((r) => child.once('exit', r));
	for (const signal of ['SIGTERM', 'SIGKILL']) {
		try {
			// Negative pid signals the whole process group — see `detached` above.
			process.kill(-child.pid, signal);
		} catch {
			// Already gone.
		}
		const exited = await Promise.race([dead.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
		if (exited) break;
	}

	// The next boot reuses this port, and a listener that has not finished
	// letting go yet fails the bind in a way that looks like "server did not
	// start". Wait for the port to actually go quiet.
	for (let i = 0; i < 20; i++) {
		if (!(await portBusy())) return;
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`port ${PORT} still answering after the server was killed`);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** POST a form the way a browser would: same-origin, with a Referer. */
function post(path, fields, { origin = ORIGIN, referer = `${BASE}/` } = {}) {
	const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
	if (origin !== null) headers.Origin = origin;
	if (referer !== null) headers.Referer = referer;
	return fetch(`${BASE}${path}`, {
		method: 'POST',
		headers,
		body: new URLSearchParams(fields).toString(),
		redirect: 'manual',
	});
}

/**
 * The flash message a redirect carries.
 *
 * Read straight off the Set-Cookie header rather than by following the
 * redirect and scraping HTML — fewer moving parts between the assertion and
 * the thing being asserted.
 */
function flashOf(res) {
	const raw = res.headers.get('set-cookie') ?? '';
	const m = /wnl_flash=([^;,\s]+)/.exec(raw);
	if (!m || !m[1]) return null;
	try {
		const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
		const json = Buffer.from(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='), 'base64').toString('utf8');
		const parsed = JSON.parse(json);
		return { kind: parsed.k, message: parsed.m };
	} catch {
		return null;
	}
}

const feed = async (from, to) => (await fetch(`${BASE}/api/leave?from=${from}&to=${to}`)).json();

/** A Monday about a month out — inside the booking window, never a weekend. */
function futureMonday(weeksAhead = 4) {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
	while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}
const addDays = (iso, n) => {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------

async function main() {
	// Every migration, in filename order. Listing them individually meant a new
	// migration silently did not reach this database, and the feature it added
	// then failed here for a reason that looked nothing like a missing column.
	for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
		d1(null, `migrations/${file}`);
	}

	const MON = futureMonday();
	const FRI = addDays(MON, 4);
	const SAT = addDays(MON, 5);

	// -----------------------------------------------------------------------
	// Session 1 — the first user to sign in, who therefore becomes admin.
	// -----------------------------------------------------------------------
	await startServer(ADMIN);

	const health = await (await fetch(`${BASE}/health`)).json();
	eq('health: db reachable', health.db, true);
	eq('health: reports Access unconfigured in this harness', health.accessConfigured, false);

	check('calendar renders', (await fetch(`${BASE}/`)).status === 200, 'expected 200');
	check('personal dashboard renders', (await fetch(`${BASE}/me`)).status === 200, 'expected 200');
	check('first user is admin', (await fetch(`${BASE}/admin`)).status === 200, 'expected 200');

	// --- CSRF guard --------------------------------------------------------
	let res = await post('/api/leave', { leaveTypeId: '1', startDate: MON }, { origin: 'https://evil.example' });
	eq('CSRF: cross-origin POST rejected', res.status, 403);

	res = await post('/api/leave', { leaveTypeId: '1', startDate: MON }, { origin: 'null' });
	eq('CSRF: opaque (null) origin rejected', res.status, 403);

	// --- booking rules over HTTP -------------------------------------------
	res = await post('/api/leave', { leaveTypeId: '1', startDate: MON, endDate: FRI, note: 'Trip' });
	eq('book Mon-Fri: accepted', res.status, 303);
	eq('book Mon-Fri: charged 5 days', flashOf(res)?.message, 'Booked 5 day(s) of annual leave.');

	let entries = (await feed(MON, FRI)).entries;
	eq('feed: booking present', entries.length, 1);
	eq('feed: days computed server-side', entries[0]?.days, 5);
	check('feed: no email leaked', !('email' in (entries[0] ?? {})), `keys: ${Object.keys(entries[0] ?? {})}`);
	const bookingId = entries[0]?.id;

	res = await post('/api/leave', { leaveTypeId: '1', startDate: addDays(MON, 2) });
	eq('overlap rejected', flashOf(res)?.kind, 'err');
	check('overlap message names the clash', /already have leave/.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);

	res = await post('/api/leave', { leaveTypeId: '1', startDate: SAT });
	check('weekend rejected', /weekend|holiday/.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);

	res = await post('/api/leave', { leaveTypeId: '1', startDate: addDays(MON, 7), endDate: addDays(MON, 25) });
	check('over-quota rejected', /Not enough/.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);

	res = await post('/api/leave', { leaveTypeId: '1', startDate: '2026-02-30' });
	eq('invalid calendar date rejected', flashOf(res)?.kind, 'err');

	// --- editing own booking ------------------------------------------------
	res = await post(`/api/leave/${bookingId}/edit`, {
		leaveTypeId: '1', startDate: MON, endDate: FRI, startHalf: 'full', endHalf: 'full', note: 'Trip',
	});
	check('edit with unchanged dates does not self-overlap', flashOf(res)?.kind === 'ok', flashOf(res)?.message);

	res = await post(`/api/leave/${bookingId}/edit`, {
		leaveTypeId: '1', startDate: MON, endDate: addDays(MON, 2), note: 'Trip',
	});
	eq('shortening credits its own days back', flashOf(res)?.message, 'Updated to 3 day(s) of annual leave.');

	// --- open redirect ------------------------------------------------------
	for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
		res = await post(`/api/leave/${bookingId}/edit`, {
			leaveTypeId: '1', startDate: MON, endDate: addDays(MON, 2), note: 'Trip', returnTo: evil,
		});
		const loc = res.headers.get('location') ?? '';
		check(`returnTo rejects ${evil}`, loc === '/me' || loc.startsWith('/me'), `Location: ${loc}`);
	}
	res = await post(`/api/leave/${bookingId}/edit`, {
		leaveTypeId: '1', startDate: MON, endDate: addDays(MON, 2), note: 'Trip', returnTo: '/?y=2026&m=9',
	});
	eq('returnTo accepts a same-origin path with its query', res.headers.get('location'), '/?y=2026&m=9');

	// --- LINE webhook -------------------------------------------------------
	const body = JSON.stringify({ events: [{ type: 'message', source: { type: 'group', groupId: 'Csmoke123' } }] });
	const sign = (b, secret = CHANNEL_SECRET) => createHmac('sha256', secret).update(b).digest('base64');
	const hook = (b, sig) =>
		fetch(`${BASE}/line/webhook`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(sig === null ? {} : { 'X-Line-Signature': sig }) },
			body: b,
		});

	eq('webhook: unsigned rejected', (await hook(body, null)).status, 401);
	eq('webhook: wrong signature rejected', (await hook(body, 'AAAA')).status, 401);
	eq('webhook: signature from another secret rejected', (await hook(body, sign(body, 'other'))).status, 401);
	eq('webhook: tampered body rejected', (await hook(`${body} `, sign(body))).status, 401);
	eq('webhook: valid signature accepted', (await hook(body, sign(body))).status, 200);

	const cfg = d1Rows("SELECT value FROM app_config WHERE key = 'line_group_id'");
	eq('webhook: group id captured', cfg[0]?.value, 'Csmoke123');

	// --- digest decisions (never reaches LINE: no channel token is set) -----
	res = await post('/admin/notify/preview', { date: MON });
	check('digest preview: would post', /Would post about/.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);
	check('digest preview: includes the person', /admin/i.test(flashOf(res)?.message ?? ''), 'name missing from preview');

	res = await post('/admin/notify/preview', { date: SAT });
	check('digest: weekend not posted', /would not post/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);

	res = await post('/admin/notify/send', { date: MON });
	check('digest: refuses to send with no channel token', /not configured/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);
	eq('digest: nothing logged when nothing was sent', d1Rows('SELECT COUNT(*) AS n FROM notification_log')[0]?.n, 0);

	// --- admin actions ------------------------------------------------------
	res = await post('/admin/quotas/bulk', { year: '2027', leaveTypeId: '1', days: '12' });
	eq('bulk quota accepted', flashOf(res)?.kind, 'ok');
	res = await post('/admin/quotas/bulk', { year: '2027', leaveTypeId: '1', days: '999' });
	eq('bulk quota rejects out-of-range days', flashOf(res)?.kind, 'err');
	res = await post('/admin/quotas/bulk', { year: '2027', leaveTypeId: '99', days: '5' });
	eq('bulk quota rejects unknown leave type', flashOf(res)?.kind, 'err');

	res = await post('/admin/user', { email: ADMIN, active: '1' });
	check('last admin cannot demote itself', /only admin/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);

	await stopServer();

	// -----------------------------------------------------------------------
	// Session 2 — a different, non-admin identity against the same database.
	// A second sign-in is the only honest way to test authorisation; poking
	// is_admin in SQL would test the query, not the route.
	// -----------------------------------------------------------------------
	await startServer(OTHER);

	eq('second user is not admin', (await fetch(`${BASE}/admin`)).status, 403);
	eq('second user cannot reach an admin action', (await post('/admin/quotas/bulk', { year: '2027', leaveTypeId: '1', days: '1' })).status, 403);

	res = await post(`/api/leave/${bookingId}/cancel`);
	eq("cannot cancel another user's booking", flashOf(res)?.message, 'That is not your booking.');

	res = await post(`/api/leave/${bookingId}/edit`, { leaveTypeId: '1', startDate: MON, endDate: FRI });
	eq("cannot edit another user's booking", flashOf(res)?.message, 'That is not your booking.');

	entries = (await feed(MON, FRI)).entries;
	eq("the other user's booking survived both attempts", entries.length, 1);
	eq('and still has its original owner', entries[0]?.name, 'Admin');

	// The shared calendar is shared: everyone sees who is out.
	check('second user can see the calendar', (await fetch(`${BASE}/`)).status === 200, 'expected 200');

	// --- cancellation is idempotent ----------------------------------------
	await stopServer();
	await startServer(ADMIN);

	res = await post(`/api/leave/${bookingId}/cancel`);
	eq('owner can cancel', flashOf(res)?.kind, 'ok');
	res = await post(`/api/leave/${bookingId}/cancel`);
	check('second cancel is a no-op, not a second write', /already cancelled/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);

	entries = (await feed(MON, FRI)).entries;
	eq('cancelled leave leaves the calendar', entries.length, 0);

	res = await post(`/api/leave/${bookingId}/edit`, { leaveTypeId: '1', startDate: MON, endDate: FRI });
	check('a cancelled booking cannot be edited back', /cancelled/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);

	eq('unknown booking id is not an error page', (await fetch(`${BASE}/leave/does-not-exist/edit`, { redirect: 'manual' })).status, 303);
	eq('unknown page 404s', (await fetch(`${BASE}/no-such-page`)).status, 404);

	// --- deactivated users drop off the shared surfaces --------------------
	// Inserted directly because the point is the read path, and going through
	// the booking form would just re-test rules already covered above.
	const otherLeave = `smoke-inactive-${Date.now()}`;
	d1(
		`INSERT INTO leave_requests (id,user_email,leave_type_id,start_date,end_date,start_half,end_half,days_total,note,status,created_at)
		 VALUES ('${otherLeave}','${OTHER}',1,'${addDays(MON, 35)}','${addDays(MON, 35)}','full','full',1,NULL,'confirmed','x')`,
	);
	let far = (await feed(addDays(MON, 35), addDays(MON, 35))).entries;
	eq("an active colleague's leave is on the shared calendar", far.length, 1);

	d1(`UPDATE users SET active = 0 WHERE email = '${OTHER}'`);
	far = (await feed(addDays(MON, 35), addDays(MON, 35))).entries;
	eq('a deactivated user drops off the shared calendar', far.length, 0);

	const adminHtml = await (await fetch(`${BASE}/admin`)).text();
	check('but admin still lists them', adminHtml.includes(OTHER), 'deactivated user missing from /admin');

	const stillThere = d1Rows(`SELECT status FROM leave_requests WHERE id = '${otherLeave}'`);
	eq('and their leave row is hidden, not deleted', stillThere[0]?.status, 'confirmed');

	d1(`UPDATE users SET active = 1 WHERE email = '${OTHER}'`);

	// --- week start ---------------------------------------------------------
	// Presentation only, but the route builds its query range from the same
	// grid, so a wrong setting would silently empty the first column.
	let cal = await (await fetch(`${BASE}/`)).text();
	check('calendar defaults to Monday first', cal.indexOf('>Mon<') < cal.indexOf('>Sun<'), 'column order not Monday-first');

	res = await post('/me/week-start', { weekStart: '0' });
	eq('week start can be set to Sunday', flashOf(res)?.kind, 'ok');
	cal = await (await fetch(`${BASE}/`)).text();
	check('calendar now renders Sunday first', cal.indexOf('>Sun<') < cal.indexOf('>Mon<'), 'column order did not rotate');

	res = await post('/me/week-start', { weekStart: '3' });
	eq('week start rejects a day that is not offered', flashOf(res)?.kind, 'err');
	res = await post('/me/week-start', { weekStart: '' });
	eq('week start rejects an empty value', flashOf(res)?.kind, 'err');

	res = await post('/me/week-start', { weekStart: '1' });
	eq('week start can be set back to Monday', flashOf(res)?.kind, 'ok');
	cal = await (await fetch(`${BASE}/`)).text();
	check('calendar back to Monday first', cal.indexOf('>Mon<') < cal.indexOf('>Sun<'), 'did not rotate back');

	// --- "out today / this week" summary ------------------------------------
	const todayHtml = await (await fetch(`${BASE}/`)).text();
	check('summary shows on the current month', todayHtml.includes('Out today'), 'summary missing');
	check('summary looks forward, not at a mostly-past week', todayHtml.includes('Next 7 days'), 'forward window missing');

	// Browsing a month that cannot contain today: the summary must be absent
	// rather than rendering a misleading "nobody is out today".
	const farMonth = await (await fetch(`${BASE}/?y=2030&m=6`)).text();
	check('summary hidden when browsing another month', !farMonth.includes('Out today'), 'stale summary rendered');
}

let exitCode = 0;
try {
	await main();
} catch (err) {
	fail++;
	failures.push(`harness: ${err.message}`);
	console.log(`\nFAIL: harness error -> ${err.message}`);
} finally {
	await stopServer();
	rmSync(STATE, { recursive: true, force: true });
}

const ran = pass + fail;
if (ran < MIN_ASSERTIONS) {
	console.log(`\nFAIL: only ${ran} assertions ran, expected at least ${MIN_ASSERTIONS} — the suite exited early.`);
	exitCode = 1;
}
if (fail > 0) {
	console.log(`\n${fail} failure(s):`);
	for (const f of failures) console.log(`  - ${f}`);
	exitCode = 1;
}
if (exitCode === 0) console.log(`\nAll ${pass} smoke assertions passed.`);
process.exit(exitCode);
