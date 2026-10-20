#!/usr/bin/env node
/**
 * The calendar's scripted behaviour, in a real browser.
 *
 * The smoke suite checks the HTML the Worker sends; it cannot see what
 * src/client does with it — the phone's day card, swiping, the notification
 * invitation, the entry popup, drag-to-move. Those had been verified by hand,
 * once, in a preview pane. This boots the Worker against a scratch database,
 * starts headless Chrome, and drives it over the DevTools protocol with Node's
 * own WebSocket: no Playwright, no Puppeteer, nothing to install.
 *
 *     npm run test:browser
 *
 * Chrome is found at $CHROME_PATH, the macOS install location, or on PATH as
 * google-chrome / chromium. GitHub's Ubuntu runners have it. With no Chrome the
 * run fails rather than passing having tested nothing.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = 8800 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'admin@example.com';
const STATE = mkdtempSync(join(tmpdir(), 'wnl-browser-'));
const PROFILE = mkdtempSync(join(tmpdir(), 'wnl-chrome-'));
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
	if (ok) pass++;
	else fail++;
	console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${ok ? '' : ` -> ${detail}`}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addDays = (iso, n) => {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function findChrome() {
	const candidates = [
		process.env.CHROME_PATH,
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(
			(bin) => spawnSync('which', [bin], { encoding: 'utf8' }).stdout.trim(),
		),
	];
	return candidates.find((p) => p && existsSync(p));
}

/** A minimal DevTools-protocol client over one browser WebSocket. */
async function cdp(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let id = 0;
	const pending = new Map();
	ws.onmessage = (ev) => {
		const msg = JSON.parse(ev.data);
		const wait = pending.get(msg.id);
		if (!wait) return;
		pending.delete(msg.id);
		if (msg.error) wait.reject(new Error(`${wait.method}: ${msg.error.message}`));
		else wait.resolve(msg.result);
	};
	const send = (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const n = ++id;
			pending.set(n, { resolve, reject, method });
			ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	return { send, close: () => ws.close() };
}

// ---------------------------------------------------------------------------
// The Worker, on a scratch database
// ---------------------------------------------------------------------------

let server = null;
let chrome = null;
let sqlite = null;

function bootServer() {
	server = spawn(
		'npx',
		[
			'wrangler', 'dev', '--config', 'wrangler.jsonc', '--port', String(PORT), '--persist-to', STATE,
			'--var', 'DEV_AUTH_BYPASS:1', '--var', `DEV_EMAIL:${ADMIN}`,
			// Placeholders: enough for the app to draw the bell and the invitation.
			// Nothing is ever signed with them.
			'--var', 'VAPID_PUBLIC_KEY:browser-test-public-key', '--var', 'VAPID_PRIVATE_KEY:browser-test-private-key',
			'--var', 'LINE_CHANNEL_ACCESS_TOKEN:',
		],
		{ env, stdio: ['ignore', 'ignore', 'ignore'], detached: true },
	);
}

function migrate() {
	const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
	// The first through wrangler, so the file has the layout the dev server
	// expects; the rest straight into it, as the smoke suite does.
	const res = spawnSync('npx', ['wrangler', 'd1', 'execute', 'wan-nee-la', '--local', '--persist-to', STATE, '--file', `migrations/${files[0]}`], { env, encoding: 'utf8' });
	if (res.status !== 0) throw new Error(`migration failed: ${res.stderr.slice(0, 400)}`);
	const found = [];
	const walk = (dir) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) walk(join(dir, e.name));
			else if (e.name.endsWith('.sqlite') && e.name !== 'metadata.sqlite') found.push(join(dir, e.name));
		}
	};
	walk(join(STATE, 'v3', 'd1'));
	sqlite = new DatabaseSync(found[0]);
	sqlite.exec('PRAGMA busy_timeout = 10000');
	for (const f of files.slice(1)) sqlite.exec(spawnSync('cat', [`migrations/${f}`], { encoding: 'utf8' }).stdout);
}

async function waitForServer() {
	for (let i = 0; i < 120; i++) {
		try {
			const res = await fetch(`${BASE}/health`);
			if (res.ok) return (await res.json()).bangkokToday;
		} catch {
			// not up yet
		}
		await sleep(1000);
	}
	throw new Error('the dev server never came up');
}

function book(id, email, start, end) {
	sqlite
		.prepare(
			`INSERT INTO leave_requests (id, user_email, leave_type_id, start_date, end_date, start_half, end_half, days_total, note, note_private, status, created_at)
			 VALUES (?, ?, 1, ?, ?, 'full', 'full', 1, NULL, 1, 'confirmed', ?)`,
		)
		.run(id, email, start, end, start);
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

async function main() {
	const chromePath = findChrome();
	if (!chromePath) throw new Error('no Chrome found: set CHROME_PATH');

	migrate();
	bootServer();
	const today = await waitForServer();

	// Signing in creates the admin's row; then the people the tests book for.
	await fetch(`${BASE}/`);
	sqlite.exec(`INSERT INTO users (email, display_name, is_admin, active, created_at) VALUES
		('mai@example.com', 'Mai Srisuk', 0, 1, '2026-01-01'),
		('nok@example.com', 'Nok Thongdee', 0, 1, '2026-01-02')`);

	// A weekday in this month that is not today, with someone away on it.
	const month = today.slice(0, 7);
	let busy = `${month}-01`;
	while (busy === today || weekday(busy) === 0 || weekday(busy) === 6 || sqlite.prepare('SELECT 1 FROM holidays WHERE date = ?').get(busy)) busy = addDays(busy, 1);
	if (!busy.startsWith(month)) throw new Error('no weekday this month for the fixture');
	book('b-busy', 'mai@example.com', busy, busy);
	book('b-today', 'nok@example.com', today, today);

	// For dragging: the admin's own booking on a Tuesday some months ahead —
	// inside the far-future guard — in a week whose Tuesday to Thursday holds no
	// holiday, so the move is one the booking rules accept.
	const isHoliday = (d) => Boolean(sqlite.prepare('SELECT 1 FROM holidays WHERE date = ?').get(d));
	let tue = addDays(today, 120);
	while (weekday(tue) !== 2 || [0, 1, 2].some((i) => isHoliday(addDays(tue, i)))) tue = addDays(tue, 1);
	book('b-drag', ADMIN, tue, tue);

	chrome = spawn(chromePath, [
		'--headless=new', '--remote-debugging-port=0', `--user-data-dir=${PROFILE}`,
		'--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', 'about:blank',
	], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = '';
		chrome.stderr.on('data', (b) => {
			buf += b;
			const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
			if (m) resolve(m[1]);
		});
		setTimeout(() => reject(new Error(`Chrome did not start: ${buf.slice(0, 400)}`)), 30000);
	});
	const browser = await cdp(wsUrl);
	const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
	const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
	const send = (method, params) => browser.send(method, params, sessionId);

	const evaluate = async (expression) => {
		const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (exceptionDetails) throw new Error(`in page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
		return result.value;
	};
	const waitFor = async (expression, ms = 10000) => {
		for (let t = 0; t < ms; t += 100) {
			if (await evaluate(expression).catch(() => false)) return true;
			await sleep(100);
		}
		return false;
	};
	const open = async (path) => {
		await send('Page.navigate', { url: `${BASE}${path}` });
		await sleep(200);
		await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('[data-agenda]')?.classList.contains('day-mode'))");
	};
	const centre = (selector) =>
		evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
	const tap = async (selector) => {
		// On screen first, as a finger would need it to be.
		await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
		await sleep(50);
		const { x, y } = await centre(selector);
		for (const type of ['mousePressed', 'mouseReleased']) {
			await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
		}
	};
	const swipe = async (selector, dx) => {
		const { x, y } = await centre(selector);
		await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
		for (let i = 1; i <= 5; i++) {
			await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 5, y }] });
		}
		await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	};

	await send('Page.enable');
	await send('Runtime.enable');
	// Never asked, as a colleague's browser would be, so the invitation shows.
	await browser.send('Browser.setPermission', { permission: { name: 'notifications' }, setting: 'prompt', origin: BASE });

	// --- a phone -------------------------------------------------------------
	await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	await open('/');

	check('phone: touch is what the page sees', await evaluate("matchMedia('(pointer: coarse)').matches"), 'pointer is not coarse');
	check('phone: the heading uses the short month', await evaluate("getComputedStyle(document.querySelector('.month-head .m-short')).display !== 'none'"), 'long month shown');
	eq(
		'day card: opens on today, the only row showing',
		await evaluate("[...document.querySelectorAll('.agenda-row')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => r.dataset.day).join()"),
		today,
	);
	check('day card: names who is away today', await evaluate("document.querySelector('.agenda-row.selected').innerText.includes('Nok Thongdee')"), 'name missing');

	// Measured after bringing the cell on screen, which `tap` would do anyway:
	// what matters is that choosing the day moves nothing.
	await evaluate(`document.querySelector('.cell-day[data-day="${busy}"]').scrollIntoView({ block: 'center' })`);
	await sleep(50);
	const scrollBefore = await evaluate('scrollY');
	await tap(`.cell-day[data-day="${busy}"]`);
	await sleep(150);
	eq('day card: a tapped day takes its place', await evaluate("document.querySelector('.agenda-row.selected')?.dataset.day"), busy);
	check('day card: with that day\'s people', await evaluate("document.querySelector('.agenda-row.selected').innerText.includes('Mai Srisuk')"), 'Mai missing');
	eq('day card: and the page did not scroll', await evaluate('scrollY'), scrollBefore);
	eq('day card: the URL names the day', await evaluate('location.hash'), `#d-${busy}`);
	check('day card: the grid rings the same day', await evaluate(`document.querySelector('.cell.selected .cell-day')?.dataset.day === ${JSON.stringify(busy)}`), 'cell not marked');

	// A day in the middle of the month, so a step either way stays in it.
	const mid = `${month}-15`;
	await tap(`.cell-day[data-day="${mid}"]`);
	await sleep(150);
	// Banners above the grid can push the card below a short screen's fold;
	// a person scrolls to it before swiping it, and so does this.
	await evaluate("document.querySelector('.agenda-row.selected').scrollIntoView({ block: 'center' })");
	await sleep(100);
	await swipe('.agenda-row.selected', -150);
	await sleep(150);
	eq('day card: swiping left steps to the next day', await evaluate("document.querySelector('.agenda-row.selected')?.dataset.day"), addDays(mid, 1));
	await swipe('.agenda-row.selected', 150);
	await sleep(150);
	eq('day card: and right steps back', await evaluate("document.querySelector('.agenda-row.selected')?.dataset.day"), mid);

	// The invitation: shown to a browser never asked, and "Not now" sticks.
	check('invitation: shown to a browser never asked', await waitFor("!document.querySelector('[data-push-nudge]').hidden", 5000), 'hidden');
	await tap('[data-push-nudge-later]');
	await sleep(100);
	check('invitation: "Not now" puts it away', await evaluate("document.querySelector('[data-push-nudge]').hidden"), 'still shown');
	await open('/');
	await sleep(500);
	check('invitation: and it stays away on the next visit', await evaluate("document.querySelector('[data-push-nudge]').hidden"), 'back again');

	// Month swipe last on the phone: it leaves the page.
	const nextMonth = await evaluate("new URL(document.querySelector('[data-month-next]').href).search");
	await swipe('.grid-view', -200);
	check('grid: swiping left goes to next month', await waitFor(`location.search === ${JSON.stringify(nextMonth)}`), await evaluate('location.search'));

	// --- a laptop ------------------------------------------------------------
	await send('Emulation.setTouchEmulationEnabled', { enabled: false });
	await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	const [y, m] = tue.split('-').map(Number);
	await open(`/?y=${y}&m=${m}`);

	const bar = '.bar[data-entry="b-drag"]';
	check('laptop: the booking is a bar', await evaluate(`Boolean(document.querySelector('${bar}'))`), 'no bar');
	await tap(bar);
	check('popup: clicking a bar opens its details', await waitFor("document.querySelector('[data-entry-dialog]').open"), 'dialog closed');
	check('popup: for that booking', await evaluate("document.querySelector('[data-p-name]').textContent.length > 0"), 'empty');
	await evaluate("document.querySelector('[data-entry-dialog]').close()");

	// Drag the bar two days on, from Tuesday to Thursday.
	//
	// The page records the pointer and drag events it receives, and any form it
	// submits, so a failure says where the gesture died. That is how this test
	// found, on its first run, that a native link drag was cancelling every one.
	await evaluate(`(() => {
		window.__seen = [];
		for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'mouseup', 'click', 'dragstart']) {
			document.addEventListener(t, (e) => { if (t !== 'pointermove' || window.__seen.at(-1)?.[0] !== t) window.__seen.push([t, e.target.className, Math.round(e.clientX), Math.round(e.clientY), e.pointerType]); }, true);
		}
		const submit = HTMLFormElement.prototype.submit;
		HTMLFormElement.prototype.submit = function () { window.__seen.push(['submit', this.action, [...new FormData(this)].map(([k, v]) => k + '=' + v).join('&')]); return submit.call(this); };
	})()`);
	await evaluate(`document.querySelector('${bar}').scrollIntoView({ block: 'center' })`);
	await sleep(100);
	const from = await centre(bar);
	const thu = addDays(tue, 2);
	const to = await centre(`td:has(> .cell-add[data-date="${thu}"])`);
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
	for (let i = 1; i <= 10; i++) {
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10, button: 'left', buttons: 1 });
		await sleep(20);
	}
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
	const seen = await evaluate('JSON.stringify(window.__seen ?? null)').catch(() => 'page gone (navigated)');
	let moved = null;
	for (let i = 0; i < 50 && moved !== thu; i++) {
		await sleep(200);
		moved = sqlite.prepare("SELECT start_date FROM leave_requests WHERE id = 'b-drag'").get()?.start_date;
	}
	const after = moved === thu ? '' : await evaluate("location.href + ' | ' + (document.querySelector('.banner.error')?.innerText ?? 'no error banner')").catch((e) => e.message);
	check('drag: a bar dropped on Thursday moves the booking there', moved === thu, `start ${moved}, page ${after}, seen ${seen}`);

	browser.close();
}

function eq(name, got, want) {
	check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

let exitCode = 0;
try {
	await main();
} catch (err) {
	console.log(`\nFAIL: the run itself broke — ${err.message}`);
	exitCode = 1;
} finally {
	for (const child of [chrome, server]) {
		try {
			if (child) process.kill(-child.pid, 'SIGTERM');
		} catch {
			// already gone
		}
	}
	sqlite?.close();
	await sleep(500);
	rmSync(STATE, { recursive: true, force: true });
	rmSync(PROFILE, { recursive: true, force: true });
}
if (fail > 0 || pass === 0) exitCode = 1;
console.log(exitCode === 0 ? `\nAll ${pass} browser assertions passed.` : `\n${fail} failure(s), ${pass} passed.`);
process.exit(exitCode);
