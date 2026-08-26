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
const MIN_ASSERTIONS = 139;

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

/** POST JSON the way the push client does. */
function postJson(path, body, { origin = ORIGIN } = {}) {
	const headers = { 'Content-Type': 'application/json' };
	if (origin !== null) headers.Origin = origin;
	return fetch(`${BASE}${path}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
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

	// Absence is not permission: every browser sends Origin on a POST, so a
	// request without one is not coming from one of our pages.
	res = await post('/api/leave', { leaveTypeId: '1', startDate: MON }, { origin: null });
	eq('CSRF: a missing origin is rejected', res.status, 403);

	// --- booking rules over HTTP -------------------------------------------
	res = await post('/api/leave', { leaveTypeId: '1', startDate: MON, endDate: FRI, note: 'smoke-private-note' });
	eq('book Mon-Fri: accepted', res.status, 303);
	eq('book Mon-Fri: charged 5 days', flashOf(res)?.message, 'Booked 5 days of annual leave.');

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
		leaveTypeId: '1', startDate: MON, endDate: FRI, startHalf: 'full', endHalf: 'full', note: 'smoke-private-note',
	});
	check('edit with unchanged dates does not self-overlap', flashOf(res)?.kind === 'ok', flashOf(res)?.message);

	res = await post(`/api/leave/${bookingId}/edit`, {
		leaveTypeId: '1', startDate: MON, endDate: addDays(MON, 2), note: 'smoke-private-note',
	});
	eq('shortening credits its own days back', flashOf(res)?.message, 'Updated to 3 days of annual leave.');

	// --- security headers ---------------------------------------------------
	{
		const headers = (await fetch(`${BASE}/me`)).headers;
		const csp = headers.get('content-security-policy') ?? '';
		check('CSP is set on HTML', csp.includes("default-src 'self'"), csp);
		check('CSP allows the inline theme script by hash only', /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/.test(csp), csp);
		check('CSP forbids framing', csp.includes("frame-ancestors 'none'"), csp);
		eq('HTML is not stored by shared caches', headers.get('cache-control'), 'private, no-store');
		eq('MIME sniffing off', headers.get('x-content-type-options'), 'nosniff');
		// `same-origin`, not `no-referrer`: the app reads its own Referer to send
		// people back where they came from.
		eq('referrer stays inside the origin', headers.get('referrer-policy'), 'same-origin');
	}

	// --- the Referer header is a redirect target, so it is not trusted -------
	//
	// A page elsewhere can set its own Referrer-Policy and send us anything.
	// `//evil.example` is a valid URL *pathname*, and would be a
	// protocol-relative redirect off the site if it were used as given.
	res = await post('/api/leave/1/cancel', {}, { referer: 'https://evil.example//evil.example' });
	eq('a cross-origin referrer is ignored', res.headers.get('location'), '/me');
	res = await post('/api/leave/1/cancel', {}, { referer: `${BASE}//evil.example` });
	check(
		'a same-origin referrer with a protocol-relative path is refused',
		!(res.headers.get('location') ?? '').startsWith('//'),
		res.headers.get('location'),
	);
	res = await post('/api/leave/1/cancel', {}, { referer: `${BASE}/?y=2026&m=9` });
	eq('an ordinary same-origin referrer is honoured', res.headers.get('location'), '/?y=2026&m=9');

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
	check(
		'digest: refuses to send with no channel token',
		/no channel is configured/i.test(flashOf(res)?.message ?? ''),
		flashOf(res)?.message,
	);
	eq('digest: nothing logged when nothing was sent', d1Rows('SELECT COUNT(*) AS n FROM notification_runs')[0]?.n, 0);

	// --- note visibility ----------------------------------------------------
	//
	// The note in the booking above was written with the box unticked, so it is
	// private. The author can read it back; a colleague cannot, and that is
	// asserted from the other identity further down.
	// Found by id: the suite has booked more than one thing by now, and the feed
	// is ordered by date rather than by whatever was created last.
	const mine = async () => (await feed(MON, FRI)).entries.find((e) => e.id === bookingId);

	// Set the note here rather than relying on one written earlier — the
	// open-redirect tests above edit this same booking, and a test that depends
	// on another test's leftovers breaks the day that one changes.
	res = await post(`/api/leave/${bookingId}/edit`, {
		leaveTypeId: '1', startDate: MON, endDate: addDays(MON, 2), note: 'smoke-private-note',
	});
	eq('note set for the privacy checks', flashOf(res)?.kind, 'ok');

	// The booking sits about a month ahead, so ask for the month it is in rather
	// than the default view, which is today's.
	const bookedMonth = `${BASE}/?y=${MON.slice(0, 4)}&m=${Number(MON.slice(5, 7))}`;
	let page = await (await fetch(bookedMonth)).text();
	check('author sees their own private note in the calendar', page.includes('smoke-private-note'), 'own note missing');
	eq('and in the JSON feed', (await mine())?.note, 'smoke-private-note');

	// Sharing it puts the same note in front of everyone; the flag is what
	// changes, not the text.
	res = await post(`/api/leave/${bookingId}/edit`, {
		leaveTypeId: '1', startDate: MON, endDate: addDays(MON, 2), note: 'smoke-shared-note', noteVisibility: 'shared',
	});
	eq('note can be shared', flashOf(res)?.kind, 'ok');
	eq(
		'and the row records it',
		d1Rows(`SELECT note_private FROM leave_requests WHERE id = '${bookingId}'`)[0]?.note_private,
		0,
	);

	res = await post(`/api/leave/${bookingId}/edit`, {
		leaveTypeId: '1', startDate: MON, endDate: addDays(MON, 2), note: 'smoke-private-note',
	});
	eq('and made private again by omitting the box', d1Rows(`SELECT note_private FROM leave_requests WHERE id = '${bookingId}'`)[0]?.note_private, 1);

	// --- audit trail --------------------------------------------------------
	const trail = d1Rows(`SELECT action, actor_email, subject_email FROM leave_audit WHERE leave_id = '${bookingId}' ORDER BY id`);
	eq('the booking was recorded as created', trail[0]?.action, 'created');
	eq('by its author', trail[0]?.actor_email, ADMIN);
	check('and every edit since was recorded', trail.filter((r) => r.action === 'edited').length >= 3, JSON.stringify(trail));
	const snapshots = d1Rows(`SELECT before, after FROM leave_audit WHERE leave_id = '${bookingId}' AND action = 'edited' ORDER BY id DESC LIMIT 1`);
	check('an edit records what changed', /"start_date"/.test(snapshots[0]?.before ?? ''), snapshots[0]?.before);
	// The trail must never become a second copy of private notes.
	eq(
		'no note text is copied into the trail',
		d1Rows(`SELECT COUNT(*) AS n FROM leave_audit WHERE before LIKE '%smoke-private-note%' OR after LIKE '%smoke-private-note%'`)[0]?.n,
		0,
	);

	// --- coverage warning ---------------------------------------------------
	let preview = await (await fetch(`${BASE}/api/leave/preview?leaveTypeId=1&start=${MON}&end=${MON}`)).json();
	eq('preview still returns a day count', preview.days, 1);
	check('and says nothing about coverage when only you are out', preview.coverage === null, JSON.stringify(preview.coverage));

	// --- holiday import -----------------------------------------------------
	res = await post('/admin/holidays/import', { list: '2027-01-01 New Year\n2027-04-13 Songkran' });
	eq('holiday import accepted', flashOf(res)?.kind, 'ok');
	// Counted by the two dates imported, not by year: the seed already carries a
	// set of Thai holidays, and asserting on a total would be asserting on those.
	eq(
		'both holidays stored',
		d1Rows("SELECT COUNT(*) AS n FROM holidays WHERE date IN ('2027-01-01','2027-04-13')")[0]?.n,
		2,
	);

	res = await post('/admin/holidays/import', { list: '2028-01-01 Good\nnonsense line' });
	eq('a bad line rejects the whole import', flashOf(res)?.kind, 'err');
	eq('and nothing from it was written', d1Rows("SELECT COUNT(*) AS n FROM holidays WHERE date LIKE '2028-%'")[0]?.n, 0);

	// --- language -----------------------------------------------------------
	res = await post('/me/lang', { lang: 'th' });
	eq('language can be set to Thai', flashOf(res)?.kind, 'ok');
	page = await (await fetch(`${BASE}/me`)).text();
	check('the interface is in Thai', page.includes('การลาของฉัน'), 'Thai heading missing');
	check('and the document says so', page.includes('<html lang="th"'), 'lang attribute not switched');
	res = await post('/me/lang', { lang: 'kr' });
	eq('an unoffered language is refused', flashOf(res)?.kind, 'err');
	res = await post('/me/lang', { lang: 'en' });
	page = await (await fetch(`${BASE}/me`)).text();
	check('and back to English', page.includes('My leave'), 'English heading missing');

	// --- browser push ------------------------------------------------------
	//
	// No VAPID pair is configured here, so nothing is ever sent: what is under
	// test is the subscription store and its ownership rules, plus the digest's
	// decision not to attempt a channel it cannot sign for.

	// A real-looking subscription: the key sizes are checked on the way in, so
	// these are the RFC 8291 example's, which are the right shape.
	const P256DH = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
	const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';
	const endpointOf = (id) => `https://push.example.net/wpush/v2/${id}`;
	const sub = (id) => ({ endpoint: endpointOf(id), keys: { p256dh: P256DH, auth: AUTH } });

	eq('push: subscribe accepted', (await postJson('/api/push/subscribe', sub('admin-laptop'))).status, 200);
	eq(
		'push: subscription stored against the caller',
		d1Rows(`SELECT user_email FROM push_subscriptions WHERE endpoint = '${endpointOf('admin-laptop')}'`)[0]?.user_email,
		ADMIN,
	);

	// Re-subscribing the same browser must not create a second row — the
	// endpoint is the identity, and duplicates would push twice to one device.
	await postJson('/api/push/subscribe', sub('admin-laptop'));
	eq('push: re-subscribing updates rather than duplicates', d1Rows('SELECT COUNT(*) AS n FROM push_subscriptions')[0]?.n, 1);

	eq(
		'push: rejects a non-https endpoint',
		(await postJson('/api/push/subscribe', { endpoint: 'http://push.example.net/x', keys: { p256dh: P256DH, auth: AUTH } })).status,
		400,
	);
	eq(
		'push: rejects a wrong-sized key',
		(await postJson('/api/push/subscribe', { endpoint: endpointOf('bad'), keys: { p256dh: 'AAAA', auth: AUTH } })).status,
		400,
	);
	eq('push: rejects an empty body', (await postJson('/api/push/subscribe', {})).status, 400);
	eq(
		'push: cross-origin subscribe rejected',
		(await postJson('/api/push/subscribe', sub('evil'), { origin: 'https://evil.example' })).status,
		403,
	);
	eq('push: nothing stored by the rejected calls', d1Rows('SELECT COUNT(*) AS n FROM push_subscriptions')[0]?.n, 1);

	eq('push: test send refused with no VAPID pair', (await postJson('/api/push/test', {})).status, 503);

	// A subscription exists, but the server cannot sign a push without a VAPID
	// pair, so the digest must report that rather than claiming the date.
	res = await post('/admin/notify/send', { date: MON });
	check(
		'digest: still not configured for push',
		/no channel is configured/i.test(flashOf(res)?.message ?? ''),
		flashOf(res)?.message,
	);
	eq('digest: no run claimed for an unsendable channel', d1Rows('SELECT COUNT(*) AS n FROM notification_runs')[0]?.n, 0);

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
	eq('second user cannot import holidays', (await post('/admin/holidays/import', { list: '2030-01-01 Sneaky' })).status, 403);
	eq('and nothing was imported', d1Rows("SELECT COUNT(*) AS n FROM holidays WHERE date LIKE '2030-%'")[0]?.n, 0);

	// --- per-person page: schedule is shared, balances are not ---------------
	const otherViewsAdmin = await (await fetch(`${BASE}/u/${encodeURIComponent(ADMIN)}`)).text();
	check('a colleague can see someone\'s schedule', otherViewsAdmin.includes('leave-row'), 'schedule missing');
	check('but not their balances', !otherViewsAdmin.includes('class="balances"'), 'balances leaked to a colleague');
	check('and never their note', !otherViewsAdmin.includes('smoke-private-note'), 'note leaked');

	const ownPage = await (await fetch(`${BASE}/u/${encodeURIComponent(OTHER)}`)).text();
	check('a person sees their own balances', ownPage.includes('class="balances"'), 'own balances missing');

	eq('unknown person 404s', (await fetch(`${BASE}/u/nobody%40example.com`)).status, 404);

	// --- a colleague cannot read a private note -----------------------------
	const colleagueView = await (await fetch(`${BASE}/?y=${MON.slice(0, 4)}&m=${Number(MON.slice(5, 7))}`)).text();
	check('a private note is absent from a colleague\'s calendar', !colleagueView.includes('smoke-private-note'), 'private note leaked');
	const colleagueFeed = (await feed(MON, FRI)).entries;
	const theirs = colleagueFeed.find((e) => e.id === bookingId);
	eq('and absent from their JSON feed', theirs?.note ?? null, null);
	check('though the booking itself is still visible', Boolean(theirs), 'booking hidden entirely');

	// --- coverage warning, seen from the other side -------------------------
	//
	// The admin is booked off MON..MON+2, so a colleague previewing the same
	// days must be told — by name, since the calendar shows those anyway.
	const withCoverage = await (await fetch(`${BASE}/api/leave/preview?leaveTypeId=1&start=${MON}&end=${MON}`)).json();
	check('coverage reports the colleague already away', withCoverage.coverage?.out === 2, JSON.stringify(withCoverage.coverage));
	check('and names them', (withCoverage.coverage?.names ?? []).includes('Admin'), JSON.stringify(withCoverage.coverage));
	check('two of two people out is flagged as busy', withCoverage.coverage?.busy === true, JSON.stringify(withCoverage.coverage));

	// --- push subscriptions belong to someone -------------------------------
	const adminEndpoint = 'https://push.example.net/wpush/v2/admin-laptop';
	await postJson('/api/push/unsubscribe', { endpoint: adminEndpoint });
	eq(
		"cannot unsubscribe another user's browser",
		d1Rows(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = '${adminEndpoint}'`)[0]?.n,
		1,
	);
	eq(
		'and it still belongs to them',
		d1Rows(`SELECT user_email FROM push_subscriptions WHERE endpoint = '${adminEndpoint}'`)[0]?.user_email,
		ADMIN,
	);

	// Re-subscribing the same browser as a different person reassigns it. That
	// is deliberate — a shared machine where the previous person signed out must
	// not keep sending their colleague's digest to them.
	await postJson('/api/push/subscribe', {
		endpoint: adminEndpoint,
		keys: {
			p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
			auth: 'BTBZMqHH6r4Tts7J_aSIgg',
		},
	});
	eq(
		'a browser re-subscribed by someone else changes hands',
		d1Rows(`SELECT user_email FROM push_subscriptions WHERE endpoint = '${adminEndpoint}'`)[0]?.user_email,
		OTHER,
	);
	eq('and is still one row', d1Rows('SELECT COUNT(*) AS n FROM push_subscriptions')[0]?.n, 1);

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

	// --- "out today / next 7 days" summary ----------------------------------
	//
	// Rows are inserted straight into D1 rather than booked over HTTP: this is
	// about what the summary renders, and a booking would be refused or not
	// depending on which day of the week the suite happens to run.
	const TODAY = (await (await fetch(`${BASE}/health`)).json()).bangkokToday;
	const MONTH_NAMES = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December',
	];
	const SOON = addDays(TODAY, 2);
	const insertLeave = (id, email, date) =>
		d1(
			`INSERT INTO leave_requests (id, user_email, leave_type_id, start_date, end_date, start_half, end_half, days_total, note, note_private, status, created_at)
			 VALUES ('${id}', '${email}', 1, '${date}', '${date}', 'full', 'full', 1, NULL, 1, 'confirmed', '${date}')`,
		);

	// Nothing booked in the window: one line, not two cards each saying nothing.
	const quietHtml = await (await fetch(`${BASE}/`)).text();
	check(
		'a quiet week collapses to a single line',
		quietHtml.includes('Nobody is out today or in the next 7 days'),
		'combined empty state missing',
	);
	check('and drops the two headings', !quietHtml.includes('Out today'), 'empty cards still rendered');

	insertLeave('smoke-today', ADMIN, TODAY);
	const outTodayHtml = await (await fetch(`${BASE}/`)).text();
	check('summary shows on the current month', outTodayHtml.includes('Out today'), 'summary missing');
	check('and names who is out', outTodayHtml.includes('Admin'), 'name missing from summary');
	check('the combined line is gone', !outTodayHtml.includes('Nobody is out today or in'), 'quiet line still rendered');

	// Someone else, inside the forward window but not today.
	insertLeave('smoke-soon', OTHER, SOON);
	const forwardHtml = await (await fetch(`${BASE}/`)).text();
	check('summary looks forward, not at a mostly-past week', forwardHtml.includes('Next 7 days'), 'forward window missing');
	check('and names who is out later', forwardHtml.includes('Other'), 'forward name missing');

	d1("DELETE FROM leave_requests WHERE id IN ('smoke-today', 'smoke-soon')");

	// --- the month grid on a phone ------------------------------------------
	//
	// The grid is rendered at every width and CSS decides how it reads, so what
	// is checked here is the markup a phone depends on: a day with something on
	// it gets a whole-cell link into the list below, and a day without one
	// keeps the booking link.
	insertLeave('smoke-grid', ADMIN, TODAY);
	const gridHtml = await (await fetch(`${BASE}/`)).text();
	check('a busy day links into the day list', gridHtml.includes(`href="#d-${TODAY}"`), 'day link missing');
	check('and the list carries the matching anchor', gridHtml.includes(`id="d-${TODAY}"`), 'anchor missing');
	// A day with nothing on it has no day link at all, so the cell's booking
	// link is what a tap finds.
	const emptyDay = addDays(TODAY, 300);
	check(
		'an empty day has no day link',
		!gridHtml.includes(`href="#d-${emptyDay}"`),
		'empty day linked into the list',
	);
	check('and still offers booking', gridHtml.includes(`/book?date=${TODAY}`), 'booking link missing');
	d1("DELETE FROM leave_requests WHERE id = 'smoke-grid'");

	// --- jumping to a month -------------------------------------------------
	//
	// A plain GET form, so what is checked is that the URL it produces lands on
	// the right month and that a crafted one cannot take the grid somewhere
	// absurd.
	const jumpHtml = await (await fetch(`${BASE}/`)).text();
	check('the month can be jumped to', jumpHtml.includes('month-jump-form'), 'jump form missing');

	const jan = await (await fetch(`${BASE}/?y=2027&m=1`)).text();
	check('jumping lands on the month asked for', jan.includes('<title>January 2027'), 'wrong month');
	check('and the picker shows where it landed', jan.includes('value="1" selected'), 'month not preselected');

	// Out of range falls back to the current month rather than rendering a
	// grid for the year 1200.
	const silly = await (await fetch(`${BASE}/?y=1200&m=99`)).text();
	check('a nonsense month falls back to today\'s', silly.includes(`<title>${MONTH_NAMES[Number(TODAY.slice(5, 7)) - 1]}`), 'not clamped');

	// --- the sidebar's upcoming list ----------------------------------------
	//
	// It answers "what is coming up", anchored to today, so it must survive
	// paging to another month — that is the whole reason it is fetched
	// separately from the grid.
	insertLeave('smoke-soon-2', OTHER, addDays(TODAY, 3));
	const sideHtml = await (await fetch(`${BASE}/`)).text();
	check('the sidebar lists what is coming up', sideHtml.includes('cal-upcoming'), 'sidebar missing');
	check('and names who', sideHtml.includes('upcoming-name'), 'upcoming entries missing');

	const otherMonth = await (await fetch(`${BASE}/?y=2030&m=6`)).text();
	check(
		'the upcoming list stays anchored to today when paging months',
		otherMonth.includes('upcoming-name'),
		'sidebar emptied by paging',
	);
	d1("DELETE FROM leave_requests WHERE id = 'smoke-soon-2'");

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
