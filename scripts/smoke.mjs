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
 *  - Every assertion written in this file has to actually run. Each `check`
 *    records the lines of this file on its call stack, and at the end every
 *    line that calls `check(` or `eq(` must be among them. If a section throws
 *    early, the assertions after it never run and are named as missing, even
 *    though nothing explicitly reported a failure. This replaced a hand-kept
 *    minimum count, which had to be bumped every time a test was added and only
 *    ever said how many went missing, never which.
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
import { rmSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

let pass = 0;
let fail = 0;
const failures = [];

// Assertion sites that have run, as line numbers in this file. Deep enough to
// reach the call site through a helper or two.
const SELF = fileURLToPath(import.meta.url);
const ran = new Set();
Error.stackTraceLimit = 50;

function check(name, ok, detail = '') {
	for (const m of new Error().stack.matchAll(/smoke\.mjs:(\d+):\d+/g)) ran.add(Number(m[1]));
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
		// `d` is the rejected booking, carried back so the form can be redisplayed
		// holding it. Compact keys, same reason the message is base64: cookie room.
		return { kind: parsed.k, message: parsed.m, field: parsed.f ?? null, draft: parsed.d ?? null, undo: parsed.u ?? null };
	} catch {
		return null;
	}
}

const feed = async (from, to) => (await fetch(`${BASE}/api/leave?from=${from}&to=${to}`)).json();

/**
 * A Monday about a month out whose whole working week is clear of holidays.
 *
 * Nearly every assertion downstream counts on Mon-Fri being five working days
 * and Mon-Wed being three. The offset is relative to today, so the window walks
 * through the calendar as the weeks pass, and Thailand has enough public
 * holidays that it lands on one several times a year — at which point the suite
 * goes red on a date rather than on a defect, which is the kind of red that
 * teaches people to ignore it. Asking the seeded holidays which week is clear
 * costs one query and removes the whole class of failure.
 *
 * Bounded at eight weeks of searching: the fixtures book up to a year and a
 * month past this date, and MAX_FUTURE_DAYS is 550.
 */
function clearFutureMonday(weeksAhead = 4) {
	const holidays = new Set(d1Rows('SELECT date FROM holidays').map((r) => r.date));
	for (let extra = 0; extra <= 8; extra++) {
		const mon = futureMonday(weeksAhead + extra);
		const week = Array.from({ length: 5 }, (_, i) => addDays(mon, i));
		if (!week.some((d) => holidays.has(d))) return mon;
	}
	throw new Error('no holiday-free working week within eight weeks of the usual offset');
}

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

	const MON = clearFutureMonday();
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

	// --- API reference -----------------------------------------------------
	// /docs is a Worker route rather than a page under public/ precisely so it
	// carries the security headers, which assets served ahead of the Worker do
	// not get. Asserting the header is the point: moving the page to a static
	// file would still render, and would silently lose this.
	const docs = await fetch(`${BASE}/docs`);
	eq('docs: reference renders', docs.status, 200);
	check(
		'docs: carries the CSP, so it is served by the Worker and not as an asset',
		(docs.headers.get('Content-Security-Policy') ?? '').includes("script-src 'self'"),
		`got ${JSON.stringify(docs.headers.get('Content-Security-Policy'))}`,
	);
	const spec = await fetch(`${BASE}/openapi.yaml`);
	eq('docs: the spec it loads is served', spec.status, 200);
	check('docs: spec is the OpenAPI document', (await spec.text()).includes('openapi: 3.1.0'), 'expected an openapi version line');

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

	// --- a rejected booking comes back to the form ---------------------------
	// A weekend, so this is refused whatever the quota looks like, and the leave
	// type is the one the suite never books — proof the draft is the submission
	// rather than the form's defaults.
	res = await post('/api/leave', {
		leaveTypeId: '2', startDate: SAT, endDate: addDays(SAT, 1), startHalf: 'pm', endHalf: 'am',
		note: 'smoke-draft-note', noteVisibility: 'shared',
	});
	let draft = flashOf(res)?.draft;
	eq('rejected booking carries its leave type back', draft?.t, 2);
	eq('rejected booking carries its start date back', draft?.s, SAT);
	eq('rejected booking carries its end date back', draft?.e, addDays(SAT, 1));
	eq('rejected booking carries its half-days back', `${draft?.sh}/${draft?.eh}`, 'pm/am');
	eq('rejected booking carries its note back', draft?.n, 'smoke-draft-note');
	eq('rejected booking carries the note visibility back', draft?.p, false);

	// The marker and the draft ride the same cookie and are independent: the
	// marker says which input to look at, the draft is what to show in it.
	eq('and names the field the rejection was about', flashOf(res)?.field, 'startDate');

	// A booking that never parsed has no draft to give back, but the key still
	// names the field — half an answer beats none.
	res = await post('/api/leave', { leaveTypeId: '', startDate: MON });
	eq('an unparseable booking still marks its field', flashOf(res)?.field, 'leaveTypeId');
	eq('and carries no draft', flashOf(res)?.draft, null);

	// The realistic worst case for cookie room: a full-length note in Thai, where
	// every character costs three bytes before base64 adds a third on top.
	const thaiNote = '\u0e25\u0e32'.repeat(250);
	res = await post('/api/leave', { leaveTypeId: '1', startDate: SAT, note: thaiNote });
	eq('a full-length Thai note still fits in the cookie', flashOf(res)?.draft?.n, thaiNote);

	// A note that does not fit is dropped whole rather than truncated, and the
	// rest of the draft still arrives. Control characters are what it takes:
	// JSON spends six bytes on each one.
	res = await post('/api/leave', { leaveTypeId: '1', startDate: SAT, note: `x${'\u0001'.repeat(499)}` });
	draft = flashOf(res)?.draft;
	eq('an oversized note is dropped', draft?.n, undefined);
	eq('but the rest of the draft still comes back', draft?.s, SAT);
	for (const cookie of [res, await post('/api/leave', { leaveTypeId: '1', startDate: SAT, note: thaiNote })]) {
		const header = cookie.headers.get('set-cookie') ?? '';
		const flashPart = header.split(/,(?=\s*wnl_)/)[0];
		check('the flash cookie stays inside the 4096-byte limit', flashPart.length < 4096, `${flashPart.length} bytes`);
	}

	// A booking that never parsed has nothing coherent to prefill with.
	res = await post('/api/leave', { leaveTypeId: '1', startDate: 'not-a-date' });
	eq('an unparseable booking carries no draft', flashOf(res)?.draft, null);

	// --- next year draws on next year's allowance ----------------------------
	//
	// A booking is charged to the year it *starts* in. The check used to read
	// today's year instead, so leave booked for next January was measured
	// against this year's remaining days and then recorded against next year's
	// — spending this year's allowance stopped you booking next year's at all.
	//
	// +364 days keeps the weekday and lands in the following calendar year.
	const NEXT_MON = addDays(MON, 364);
	eq('the next-year fixture really is a year on', Number(NEXT_MON.slice(0, 4)), Number(MON.slice(0, 4)) + 1);

	const annualUsed = (year) =>
		d1Rows(
			`SELECT COALESCE(SUM(days_total), 0) AS d FROM leave_requests
			 WHERE status = 'confirmed' AND leave_type_id = 1 AND user_email = '${ADMIN}'
			   AND start_date BETWEEN '${year}-01-01' AND '${year}-12-31'`,
		)[0]?.d;
	const usedThisYearBefore = annualUsed(Number(MON.slice(0, 4)));

	// Ten working days next year — more than this year has left, which is what
	// the old code measured it against and refused.
	res = await post('/api/leave', { leaveTypeId: '1', startDate: NEXT_MON, endDate: addDays(NEXT_MON, 11) });
	eq('next year is booked against its own allowance', flashOf(res)?.kind, 'ok');
	const nextYearId = (await feed(NEXT_MON, addDays(NEXT_MON, 11))).entries[0]?.id;

	eq('and this year is untouched by it', annualUsed(Number(MON.slice(0, 4))), usedThisYearBefore);
	check(
		'while next year carries the days',
		annualUsed(Number(NEXT_MON.slice(0, 4))) > 0,
		`next year used: ${annualUsed(Number(NEXT_MON.slice(0, 4)))}`,
	);

	// The allowance still binds — against the right year now. Nobody has been
	// seeded for next year, so the type default is what stands in.
	res = await post('/api/leave', { leaveTypeId: '1', startDate: addDays(NEXT_MON, 21), endDate: addDays(NEXT_MON, 32) });
	check('and next year runs out on its own quota', /Not enough/.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);

	await post(`/api/leave/${nextYearId}/cancel`);
	eq('next-year fixture cleaned up', (await feed(NEXT_MON, addDays(NEXT_MON, 11))).entries.length, 0);

	// A booking moved across New Year is checked against the year it moves into,
	// and its own days are credited back only if they were already counted
	// there. They used to be credited unconditionally, so a booking moved into a
	// full year was measured against a balance inflated by exactly its own size,
	// and accepted.
	res = await post('/api/leave', { leaveTypeId: '1', startDate: NEXT_MON, endDate: addDays(NEXT_MON, 11) });
	eq('cross-year move: next year filled first', flashOf(res)?.kind, 'ok');
	const fullNextYearId = (await feed(NEXT_MON, addDays(NEXT_MON, 11))).entries[0]?.id;

	const MOVER = addDays(MON, 14);
	res = await post('/api/leave', { leaveTypeId: '1', startDate: MOVER, endDate: addDays(MOVER, 4) });
	eq('cross-year move: a booking this year to move', flashOf(res)?.kind, 'ok');
	const moverId = (await feed(MOVER, addDays(MOVER, 4))).entries[0]?.id;

	res = await post(`/api/leave/${moverId}/edit`, {
		leaveTypeId: '1', startDate: addDays(NEXT_MON, 21), endDate: addDays(NEXT_MON, 25),
	});
	check('moving it into a full next year is refused', /Not enough/.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);
	eq('and it stays where it was', (await feed(MOVER, addDays(MOVER, 4))).entries.length, 1);

	await post(`/api/leave/${moverId}/cancel`);
	await post(`/api/leave/${fullNextYearId}/cancel`);

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

	// --- a rejected edit comes back to the edit form -------------------------
	// SAT is a weekend, so this is refused whatever the quota looks like by now.
	res = await post(`/api/leave/${bookingId}/edit`, { leaveTypeId: '2', startDate: SAT });
	eq('a rejected edit lands back on the edit page', res.headers.get('location'), `/leave/${bookingId}/edit`);
	eq('and carries the rejected leave type', flashOf(res)?.draft?.t, 2);
	eq('and the rejected date', flashOf(res)?.draft?.s, SAT);

	// A drag on the calendar posts the same endpoint with returnTo, and lands on
	// a month view whose booking form is a blank create form. Prefilling that
	// would drop the dragged booking into a form nobody opened.
	res = await post(`/api/leave/${bookingId}/edit`, { leaveTypeId: '2', startDate: SAT, returnTo: '/?y=2026&m=9' });
	eq('a rejected drag still reports the error', flashOf(res)?.kind, 'err');
	eq('but carries no draft back to the calendar', flashOf(res)?.draft, null);

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

	// LINE_ENABLED is not set in this harness, so the channel is switched off and
	// must not claim a run even though the webhook captured a group id above.
	// "Not configured" is what surfaces, because push is the one still fixable.
	eq(
		'a disabled LINE channel claims nothing',
		d1Rows("SELECT COUNT(*) AS n FROM notification_runs WHERE channel = 'line'")[0]?.n,
		0,
	);
	check(
		'and the admin page says LINE is switched off',
		(await (await fetch(`${BASE}/admin`)).text()).includes('switched off'),
		'admin page does not report the channel as off',
	);

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
	eq('second user cannot add a leave type', (await post('/admin/type', { code: 'sneaky', label_th: 'x', label_en: 'x', color: '#000000', default_days: '1' })).status, 403);
	eq('second user cannot retire one', (await post('/admin/type', { id: '1', label_th: 'x', label_en: 'x', color: '#000000', default_days: '1' })).status, 403);
	eq('second user cannot delete one', (await post('/admin/type/delete', { id: '5' })).status, 403);
	eq('and every type is untouched', d1Rows("SELECT COUNT(*) AS n FROM leave_types WHERE code = 'sneaky' OR active = 0 OR label_en = 'x'")[0]?.n, 0);

	// --- per-person page: schedule is shared, balances are not ---------------
	const otherViewsAdmin = await (await fetch(`${BASE}/u/${encodeURIComponent(ADMIN)}`)).text();
	check('a colleague can see someone\'s schedule', otherViewsAdmin.includes('leave-row'), 'schedule missing');
	check('but not their balances', !otherViewsAdmin.includes('class="balances"'), 'balances leaked to a colleague');
	check('and never their note', !otherViewsAdmin.includes('smoke-private-note'), 'note leaked');

	const ownPage = await (await fetch(`${BASE}/u/${encodeURIComponent(OTHER)}`)).text();
	check('a person sees their own balances', ownPage.includes('class="balances"'), 'own balances missing');

	eq('unknown person 404s', (await fetch(`${BASE}/u/nobody%40example.com`)).status, 404);

	// --- undo ---------------------------------------------------------------
	//
	// Booked here rather than reusing a booking from earlier: undo acts on the
	// *last* thing that happened to a row, so a test that inherited one would
	// depend on whatever the previous section did to it last.
	const undoStart = addDays(MON, 28);
	res = await post('/api/leave', { leaveTypeId: '1', startDate: undoStart, note: 'smoke-undo-note' });
	eq('a booking to undo was made', flashOf(res)?.kind, 'ok');
	const undoId = (await feed(undoStart, undoStart)).entries[0]?.id;

	// A cancel offers an undo; the id it offers is the booking's own.
	res = await post(`/api/leave/${undoId}/cancel`);
	eq('cancelling offers an undo', flashOf(res)?.undo, undoId);
	eq('and the booking is gone from the feed', (await feed(undoStart, undoStart)).entries.length, 0);

	res = await post(`/api/leave/${undoId}/undo`);
	eq('undo restores the booking', flashOf(res)?.kind, 'ok');
	eq('and it is back in the feed', (await feed(undoStart, undoStart)).entries.length, 1);
	// Cancelling never deleted the row, so the note was never rebuilt from the
	// audit snapshot — which deliberately does not carry note text.
	eq('with its note intact', (await feed(undoStart, undoStart)).entries[0]?.note, 'smoke-undo-note');
	eq('and recorded as restored', d1Rows(`SELECT action FROM leave_audit WHERE leave_id = '${undoId}' ORDER BY id DESC LIMIT 1`)[0]?.action, 'restored');

	// Nothing left to undo: the last action is now the restore itself.
	res = await post(`/api/leave/${undoId}/undo`);
	eq('a restore is not itself undoable', flashOf(res)?.kind, 'err');

	// An edit offers an undo, and undoing it puts the old dates back.
	res = await post(`/api/leave/${undoId}/edit`, { leaveTypeId: '1', startDate: undoStart, endDate: addDays(undoStart, 1), note: 'smoke-undo-note' });
	eq('editing offers an undo', flashOf(res)?.undo, undoId);
	eq('and the edit took', (await feed(undoStart, addDays(undoStart, 1))).entries[0]?.end, addDays(undoStart, 1));

	res = await post(`/api/leave/${undoId}/undo`);
	eq('undo reverts the edit', flashOf(res)?.kind, 'ok');
	eq('and the end date is back', (await feed(undoStart, addDays(undoStart, 1))).entries[0]?.end, undoStart);
	eq('the note survived the revert', (await feed(undoStart, undoStart)).entries[0]?.note, 'smoke-undo-note');

	// Undo re-runs the booking rules. Cancel, book the freed day with something
	// else, then try to undo: the restore would now overlap and must be refused.
	await post(`/api/leave/${undoId}/cancel`);
	const blockerRes = await post('/api/leave', { leaveTypeId: '2', startDate: undoStart });
	eq('the freed day was taken by another booking', flashOf(blockerRes)?.kind, 'ok');
	res = await post(`/api/leave/${undoId}/undo`);
	eq('undo is refused when the dates are no longer free', flashOf(res)?.kind, 'err');
	check('and says why', /already have leave/.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);
	eq('the booking stays cancelled', d1Rows(`SELECT status FROM leave_requests WHERE id = '${undoId}'`)[0]?.status, 'cancelled');

	// Tidy up so the sections after this one see the roster they expect.
	const blockerId = (await feed(undoStart, undoStart)).entries[0]?.id;
	await post(`/api/leave/${blockerId}/cancel`);

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

	// --- display name -------------------------------------------------------
	res = await post('/me/name', { displayName: 'Renamed Admin' });
	eq('display name can be changed', flashOf(res)?.kind, 'ok');
	check(
		'and the new name reaches the shared calendar',
		(await (await fetch(`${BASE}/`)).text()).includes('Renamed Admin'),
		'new name missing',
	);
	res = await post('/me/name', { displayName: '   ' });
	eq('an empty display name is refused', flashOf(res)?.kind, 'err');
	eq(
		'and the old one survives',
		d1Rows(`SELECT display_name FROM users WHERE email = '${ADMIN}'`)[0]?.display_name,
		'Renamed Admin',
	);
	await post('/me/name', { displayName: 'Admin' });

	// --- removing a holiday --------------------------------------------------
	await post('/admin/holiday', { date: '2031-03-04', label: 'Smoke Day' });
	eq('holiday added', d1Rows("SELECT COUNT(*) AS n FROM holidays WHERE date = '2031-03-04'")[0]?.n, 1);
	res = await post('/admin/holiday/delete', { date: '2031-03-04' });
	eq('holiday removed', flashOf(res)?.kind, 'ok');
	eq('and it is gone', d1Rows("SELECT COUNT(*) AS n FROM holidays WHERE date = '2031-03-04'")[0]?.n, 0);

	// --- leave types: add, retire, delete (0011) -----------------------------
	//
	// Retiring is the whole point: a type with bookings cannot be deleted
	// without hiding them, so it has to be possible to stop offering it while
	// its history stays intact and editable.
	const typeFields = (o = {}) => ({ label_th: 'ลาทดสอบ', label_en: 'Smoke type', color: '#0891B2', default_days: '0', sort_order: '9', ...o });
	res = await post('/admin/type', typeFields({ code: 'smoketype' }));
	eq('a leave type can be added', flashOf(res)?.kind, 'ok');
	const smokeType = d1Rows("SELECT id, active, color FROM leave_types WHERE code = 'smoketype'")[0];
	eq('and it is offered', smokeType?.active, 1);
	eq('and its colour is stored lowercase', smokeType?.color, '#0891b2');
	res = await post('/admin/type', typeFields({ code: 'smoketype' }));
	check('a taken code is refused', /already used/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);
	res = await post('/admin/type', typeFields({ code: 'badcolour', color: 'red' }));
	eq('a bad colour is refused', flashOf(res)?.kind, 'err');
	eq('and nothing was added for it', d1Rows("SELECT COUNT(*) AS n FROM leave_types WHERE code = 'badcolour'")[0]?.n, 0);
	check('the new type is on the booking form', (await (await fetch(`${BASE}/book`)).text()).includes('Smoke type'), 'not offered');

	const TYPE_MON = clearFutureMonday(66);
	res = await post('/api/leave', { leaveTypeId: String(smokeType.id), startDate: TYPE_MON, endDate: TYPE_MON });
	eq('the new type can be booked', flashOf(res)?.kind, 'ok');
	const typedId = d1Rows(`SELECT id FROM leave_requests WHERE leave_type_id = ${smokeType.id} AND status = 'confirmed'`)[0]?.id;

	// No `active` field: an unticked checkbox submits nothing, which is how the
	// form retires a type.
	res = await post('/admin/type', typeFields({ id: String(smokeType.id) }));
	eq('the type can be retired', flashOf(res)?.kind, 'ok');
	eq('and is stored as retired', d1Rows(`SELECT active FROM leave_types WHERE id = ${smokeType.id}`)[0]?.active, 0);
	check('a retired type leaves the booking form', !(await (await fetch(`${BASE}/book`)).text()).includes('Smoke type'), 'still offered');
	check('a retired type leaves the quota editor', !(await (await fetch(`${BASE}/admin`)).text()).includes(`q_${smokeType.id}`), 'still in the quota editor');
	res = await post('/api/leave', { leaveTypeId: String(smokeType.id), startDate: addDays(TYPE_MON, 1), endDate: addDays(TYPE_MON, 1) });
	check('a retired type refuses a new booking', /no longer offered/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);
	eq('and the refusal points at the type field', flashOf(res)?.field, 'leaveTypeId');

	eq('its existing booking still shows', (await feed(TYPE_MON, TYPE_MON)).entries.some((e) => e.id === typedId), true);
	check('its edit page still offers the retired type', (await (await fetch(`${BASE}/leave/${typedId}/edit`)).text()).includes('Smoke type'), 'retired type missing from its own edit page');
	res = await post(`/api/leave/${typedId}/edit`, { leaveTypeId: String(smokeType.id), startDate: addDays(TYPE_MON, 1), endDate: addDays(TYPE_MON, 1) });
	eq('its existing booking can still be moved', flashOf(res)?.kind, 'ok');
	check('the month it sits in still explains its colour', (await (await fetch(`${BASE}/?y=${TYPE_MON.slice(0, 4)}&m=${Number(TYPE_MON.slice(5, 7))}`)).text()).includes('Smoke type'), 'legend dropped it');

	res = await post('/admin/type/delete', { id: String(smokeType.id) });
	check('a type with bookings cannot be deleted', /retire it instead/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);
	eq('and it is still there', d1Rows(`SELECT COUNT(*) AS n FROM leave_types WHERE id = ${smokeType.id}`)[0]?.n, 1);
	res = await post(`/api/leave/${typedId}/cancel`);
	res = await post('/admin/type/delete', { id: String(smokeType.id) });
	eq('a cancelled booking still counts as use', flashOf(res)?.kind, 'err');

	res = await post('/admin/type', typeFields({ code: 'smokeunused', active: '1' }));
	const unusedId = d1Rows("SELECT id FROM leave_types WHERE code = 'smokeunused'")[0]?.id;
	await fetch(`${BASE}/me`); // seeds this year's quota rows, including one for the new type
	eq('a new type is seeded a quota row', d1Rows(`SELECT COUNT(*) AS n FROM quotas WHERE leave_type_id = ${unusedId}`)[0]?.n > 0, true);
	res = await post('/admin/type/delete', { id: String(unusedId) });
	eq('an unused type can be deleted', flashOf(res)?.kind, 'ok');
	eq('and it is gone', d1Rows(`SELECT COUNT(*) AS n FROM leave_types WHERE id = ${unusedId}`)[0]?.n, 0);
	eq('with its quota rows', d1Rows(`SELECT COUNT(*) AS n FROM quotas WHERE leave_type_id = ${unusedId}`)[0]?.n, 0);

	// The last offered type cannot be retired: the booking form would be empty.
	d1(`UPDATE leave_types SET active = 0 WHERE id <> 1`);
	res = await post('/admin/type', typeFields({ id: '1' }));
	check('the last offered type cannot be retired', /at least one/i.test(flashOf(res)?.message ?? ''), flashOf(res)?.message);
	eq('and it stays offered', d1Rows('SELECT active FROM leave_types WHERE id = 1')[0]?.active, 1);
	d1(`UPDATE leave_types SET active = 1 WHERE id <> ${smokeType.id}`);

	// --- housekeeping: old history is pruned by the cron ----------------------
	d1(`INSERT INTO notification_runs (date, kind, channel, sent_at, people, status) VALUES
		('2020-01-06', 'daily', 'push', '2020-01-06T09:00:00+07:00', 1, 'sent'),
		('${addDays(TODAY, -10)}', 'daily', 'push', '${addDays(TODAY, -10)}T09:00:00+07:00', 1, 'sent')`);
	d1(`INSERT INTO leave_audit (leave_id, actor_email, subject_email, action, at) VALUES
		('smoke-old-audit', '${ADMIN}', '${ADMIN}', 'created', '2020-01-06T09:00:00+07:00'),
		('smoke-new-audit', '${ADMIN}', '${ADMIN}', 'created', '${addDays(TODAY, -400)}T09:00:00+07:00')`);
	eq('the cron can be triggered', (await fetch(`${BASE}/cdn-cgi/handler/scheduled`)).status, 200);
	eq('a notification run past 90 days is pruned', d1Rows("SELECT COUNT(*) AS n FROM notification_runs WHERE date = '2020-01-06'")[0]?.n, 0);
	eq('a recent one is kept', d1Rows(`SELECT COUNT(*) AS n FROM notification_runs WHERE date = '${addDays(TODAY, -10)}'`)[0]?.n, 1);
	eq('an audit row past three years is pruned', d1Rows("SELECT COUNT(*) AS n FROM leave_audit WHERE leave_id = 'smoke-old-audit'")[0]?.n, 0);
	eq('a year-old audit row is kept', d1Rows("SELECT COUNT(*) AS n FROM leave_audit WHERE leave_id = 'smoke-new-audit'")[0]?.n, 1);

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

// Every line of this file that calls check( or eq( — skipping comments and the
// two definitions themselves — must have run at least once.
const sites = readFileSync(SELF, 'utf8')
	.split('\n')
	.map((text, i) => ({ text, line: i + 1 }))
	.filter(({ text }) => /\b(check|eq)\(/.test(text))
	.filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text))
	.filter(({ text }) => !/^(function check\(|const eq = )/.test(text));
const missed = sites.filter(({ line }) => !ran.has(line));
if (sites.length === 0) {
	console.log('\nFAIL: found no assertion sites in this file — the site check itself is broken.');
	exitCode = 1;
} else if (missed.length > 0) {
	console.log(`\nFAIL: ${missed.length} of ${sites.length} assertion sites never ran — the suite exited early or a branch skipped them:`);
	for (const { line, text } of missed.slice(0, 20)) console.log(`  smoke.mjs:${line}  ${text.trim().slice(0, 100)}`);
	exitCode = 1;
}
if (fail > 0) {
	console.log(`\n${fail} failure(s):`);
	for (const f of failures) console.log(`  - ${f}`);
	exitCode = 1;
}
if (exitCode === 0) console.log(`\nAll ${pass} smoke assertions passed; all ${sites.length} assertion sites ran.`);
process.exit(exitCode);
