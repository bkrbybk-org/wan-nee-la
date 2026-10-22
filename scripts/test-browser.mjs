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
 *
 * It also compares screenshots, which the assertions cannot replace: they
 * measure what they were written to measure, and a CSS slip that turns every
 * chip grey passes all of them. The shots are of March 2030 — a month with
 * fixed bookings, no holidays and no today — with the parts that depend on the
 * date (the Upcoming list, the banners, the footer) blanked, so the same code
 * draws the same picture any day of the year. The admin People page is shot
 * for 2030 too, where every allowance is a type default. Fonts differ between operating
 * systems, so each platform keeps its own references, in
 * scripts/visual/<platform>/. A shot with no reference yet is recorded as one;
 * `UPDATE_VISUAL=1` re-records them after a deliberate change, and
 * `VISUAL_OUT=<dir>` keeps every shot and diff (CI uploads it).
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodePng, diffPng, encodePng } from './png.mjs';

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
	// Four away on the busy day, one more than a phone cell has dots for.
	sqlite.exec(`INSERT INTO users (email, display_name, is_admin, active, created_at) VALUES
		('pim@example.com', 'Pim Rattana', 0, 1, '2026-01-03'),
		('anan@example.com', 'Anan Wongsa', 0, 1, '2026-01-04')`);
	book('b-busy-2', 'nok@example.com', busy, busy);
	book('b-busy-3', 'pim@example.com', busy, busy);
	book('b-busy-4', 'anan@example.com', busy, busy);

	// For dragging: the admin's own booking on a Tuesday some months ahead —
	// inside the far-future guard — in a week whose Tuesday to Thursday holds no
	// holiday, so the move is one the booking rules accept.
	const isHoliday = (d) => Boolean(sqlite.prepare('SELECT 1 FROM holidays WHERE date = ?').get(d));
	let tue = addDays(today, 120);
	while (weekday(tue) !== 2 || [0, 1, 2].some((i) => isHoliday(addDays(tue, i)))) tue = addDays(tue, 1);
	// A real UUID, as every booking has: the undo offer is only carried for
	// an id of that shape, so a made-up one would quietly lose it.
	const DRAG_ID = randomUUID();
	book(DRAG_ID, ADMIN, tue, tue);

	// March 2030 for the screenshots: a month no other fixture touches, with
	// no holidays and no today in it, so it renders the same on any date. A
	// spread of types, a half day, a multi-day bar and four people on the 7th.
	// Each with its real day count: the booking page and My leave show it.
	const VIS = [
		['vis-1', 'mai@example.com', 'annual', '2030-03-04', '2030-03-08', 'full', 'full', 5],
		['vis-2', 'nok@example.com', 'sick', '2030-03-06', '2030-03-07', 'full', 'full', 2],
		['vis-3', 'pim@example.com', 'annual', '2030-03-07', '2030-03-07', 'full', 'full', 1],
		['vis-4', 'anan@example.com', 'medical', '2030-03-07', '2030-03-07', 'am', 'am', 0.5],
		['vis-5', ADMIN, 'annual', '2030-03-18', '2030-03-22', 'full', 'full', 5],
		['vis-6', 'nok@example.com', 'annual', '2030-03-27', '2030-04-02', 'full', 'full', 5],
	];
	for (const [id, email, code, start, end, sh, eh, days] of VIS) {
		sqlite
			.prepare(
				`INSERT INTO leave_requests (id, user_email, leave_type_id, start_date, end_date, start_half, end_half, days_total, note, note_private, status, created_at)
				 VALUES (?, ?, (SELECT id FROM leave_types WHERE code = ?), ?, ?, ?, ?, ?, NULL, 1, 'confirmed', '2026-01-01')`,
			)
			.run(id, email, code, start, end, sh, eh, days);
	}

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

	// BROWSER_SHOTS=<dir> saves a PNG at the marked points, for looking at
	// what the assertions only measure.
	const shot = async (name) => {
		if (!process.env.BROWSER_SHOTS) return;
		const { data } = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(join(process.env.BROWSER_SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
	};

	// Screenshot comparison. See the header for what is blanked and why.
	const VISUAL_DIR = join('scripts', 'visual', process.platform);
	const STILL = [
		'*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }',
		// Present or not by the date or the browser's history, not by the code.
		'.banner { display: none !important; }',
		'.due-chip { visibility: hidden !important; }',
		'.cal-upcoming, .foot { visibility: hidden !important; }',
	].join('\n');
	// `hide`: selectors that depend on today's date on that page, taken out of
	// the layout so the rest of it can be compared on any day.
	// Accessibility, by axe-core: the WCAG 2.1 A and AA rules, failing on what
	// it rates serious or critical. Run on the pages the screenshots visit, so
	// what it reads is the same stable fixture. Moderate and minor findings are
	// printed, not failed: they are worth reading, not worth a red build.
	const AXE = readFileSync(join('node_modules', 'axe-core', 'axe.min.js'), 'utf8');
	const accessible = async (name) => {
		if (!(await evaluate("typeof window.axe === 'object'"))) await evaluate(`${AXE}\n;true`);
		const found = await evaluate(`axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
			.then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, where: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })))`);
		const serious = found.filter((v) => v.impact === 'serious' || v.impact === 'critical');
		for (const v of found.filter((x) => !serious.includes(x))) console.log(`  note: a11y ${name}: ${v.impact} ${v.id} (${v.nodes}) ${v.where.join(' | ')}`);
		check(`a11y: ${name} has no serious problems`, serious.length === 0, JSON.stringify(serious));
	};
	const looksRight = async (name, hide = []) => {
		const css = hide.length ? `${STILL}\n${hide.join(', ')} { display: none !important; }` : STILL;
		await evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.append(s); document.activeElement?.blur(); scrollTo(0, 0); })()`);
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
		await sleep(300);
		const { data } = await send('Page.captureScreenshot', { format: 'png' });
		const png = Buffer.from(data, 'base64');
		const ref = join(VISUAL_DIR, `${name}.png`);
		const out = process.env.VISUAL_OUT;
		if (out) {
			mkdirSync(out, { recursive: true });
			writeFileSync(join(out, `${name}.png`), png);
		}
		if (process.env.UPDATE_VISUAL || !existsSync(ref)) {
			mkdirSync(VISUAL_DIR, { recursive: true });
			writeFileSync(ref, png);
			check(`looks: ${name} — reference ${process.env.UPDATE_VISUAL ? 're-recorded' : 'recorded, none yet for ' + process.platform}`, true);
			return;
		}
		const { ratio, sizeMismatch, image } = diffPng(decodePng(readFileSync(ref)), decodePng(png));
		let where = '';
		if (ratio > 0.001) {
			const dir = out ?? mkdtempSync(join(tmpdir(), 'wnl-visual-'));
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, `${name}.actual.png`), png);
			if (image) writeFileSync(join(dir, `${name}.diff.png`), encodePng(image));
			where = `, actual and diff in ${dir}`;
		}
		check(`looks: ${name} matches its reference`, ratio <= 0.001, sizeMismatch ?? `${(ratio * 100).toFixed(2)}% of pixels differ${where}`);
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
	check('today card: first on a phone', await evaluate("(() => { const c = document.querySelector('.today-card'); return c && getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().bottom <= document.querySelector('.grid-view').getBoundingClientRect().top; })()"), 'no card above the grid');
	eq(
		"today card: counts today's people, as the day card does",
		await evaluate("Number(document.querySelector('.today-card').dataset.awayToday)"),
		await evaluate("document.querySelectorAll('.agenda-row.today .agenda-item').length"),
	);
	check('today card: and names them', await evaluate("document.querySelector('.today-card').innerText.includes('Nok T.')"), await evaluate("document.querySelector('.today-card').innerText"));
	// With the notification invitation and the admin's holiday reminder both
	// up — the busiest the top of the page gets — the card still starts on a
	// 812px screen, with room to read its first row.
	await waitFor("!document.querySelector('[data-push-nudge]').hidden", 5000);
	const layout = await evaluate("({ banners: document.querySelectorAll('.banner:not([hidden])').length, cardTop: Math.round(document.querySelector('.agenda-row.selected').getBoundingClientRect().top), height: innerHeight })");
	check('phone: with both banners up', layout.banners >= 2, JSON.stringify(layout));
	check('phone: the day card still starts on screen', layout.cardTop < layout.height - 80, JSON.stringify(layout));
	await shot('phone-calendar');

	// Measured after bringing the cell on screen, which `tap` would do anyway:
	// what matters is that choosing the day moves nothing.
	await evaluate(`document.querySelector('.cell-day[data-day="${busy}"]').scrollIntoView({ block: 'center' })`);
	await sleep(50);
	const scrollBefore = await evaluate('scrollY');

	// The busy day: a count instead of four dots.
	const busyCell = `document.querySelector('.cell-day[data-day="${busy}"]').closest('.cell')`;
	eq('busy day: shows how many are away', await evaluate(`(() => { const n = ${busyCell}.querySelector('.day-count'); return n && getComputedStyle(n).display !== 'none' ? n.textContent : null; })()`), '4');
	check('busy day: instead of the dots', await evaluate(`getComputedStyle(${busyCell}.querySelector('.chips')).display === 'none'`), 'dots still shown');
	check('quiet day: keeps its dot', await evaluate(`getComputedStyle(document.querySelector('.cell-day[data-day="${today}"]').closest('.cell').querySelector('.chips')).display !== 'none'`), 'dot hidden');
	await tap(`.cell-day[data-day="${busy}"]`);
	await sleep(150);
	eq('day card: a tapped day takes its place', await evaluate("document.querySelector('.agenda-row.selected')?.dataset.day"), busy);
	check('day card: with that day\'s people', await evaluate("document.querySelector('.agenda-row.selected').innerText.includes('Mai Srisuk')"), 'Mai missing');
	eq('day card: and the page did not scroll', await evaluate('scrollY'), scrollBefore);
	eq('day card: the URL names the day', await evaluate('location.hash'), `#d-${busy}`);
	check('day card: the grid rings the same day', await evaluate(`document.querySelector('.cell.selected .cell-day')?.dataset.day === ${JSON.stringify(busy)}`), 'cell not marked');

	const said = await evaluate("document.querySelector('[data-day-status]').textContent");
	check('screen reader: the new day is announced, with who is away', said.includes('Mai Srisuk') && /\d{4}/.test(said), said);
	eq('screen reader: from a polite live region', await evaluate("document.querySelector('[data-day-status]').getAttribute('aria-live')"), 'polite');

	// The floating Book button is round from the start, and steps aside while
	// the day card is on screen — the card has its own Book link, and the
	// button would sit on a name in it.
	await evaluate('scrollTo(0, 0)');
	await sleep(400);
	check('book button: round from the start', await evaluate("document.querySelector('[data-fab]').getBoundingClientRect().width <= 60"), String(await evaluate("document.querySelector('[data-fab]').getBoundingClientRect().width")));
	eq('book button: and keeps its name', await evaluate("document.querySelector('[data-fab]').getAttribute('aria-label')"), 'Book leave');
	check('book button: steps aside while the day card is on screen', await waitFor("document.querySelector('[data-fab]').classList.contains('fab-away')", 3000), 'still over the card');
	check('day card: carries its own Book link', await evaluate("Boolean(document.querySelector('.agenda-row.selected .agenda-book[data-book-link]'))"), 'no Book link in the card');
	// Upcoming stays under the card, folded to its first days, and never names
	// today's people a second time while the card is showing today.
	check('phone: Upcoming stays under the day card', await evaluate("getComputedStyle(document.querySelector('.cal-upcoming')).display !== 'none'"), 'Upcoming hidden');
	check(
		'phone: and folds past its first four days, with a button for the rest',
		await evaluate("(() => { const days = document.querySelectorAll('.upcoming-day').length; const all = document.querySelector('[data-upcoming-all]'); return days > 4 ? document.querySelector('.cal-upcoming').classList.contains('folded') && !all.hidden : !all || all.hidden; })()"),
		'fold and button disagree',
	);
	check('phone: a one-line key says which colour is which', await evaluate("getComputedStyle(document.querySelector('.legend')).display === 'flex' && document.querySelector('.legend-item').getBoundingClientRect().height <= 20"), 'no compact legend');

	// A day in the middle of the month, so a step either way stays in it.
	const mid = `${month}-15`;
	await tap(`.cell-day[data-day="${mid}"]`);
	await sleep(150);
	// The 15th has nobody away in this fixture.
	check('phone: Upcoming still there on a quiet day', await evaluate("getComputedStyle(document.querySelector('.cal-upcoming')).display !== 'none'"), 'Upcoming hidden');
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

	const bar = `.bar[data-entry="${DRAG_ID}"]`;
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
		moved = sqlite.prepare('SELECT start_date FROM leave_requests WHERE id = ?').get(DRAG_ID)?.start_date;
	}
	const after = moved === thu ? '' : await evaluate("location.href + ' | ' + (document.querySelector('.banner.error')?.innerText ?? 'no error banner')").catch((e) => e.message);
	check('drag: a bar dropped on Thursday moves the booking there', moved === thu, `start ${moved}, page ${after}, seen ${seen}`);

	// --- remove, then undo -----------------------------------------------------
	await open(`/?y=${y}&m=${m}`);
	await tap(bar);
	await waitFor("document.querySelector('[data-entry-dialog]').open");
	await tap('[data-p-cancel] button[type="submit"]');
	const statusOf = (id) => sqlite.prepare('SELECT status FROM leave_requests WHERE id = ?').get(id)?.status;
	let status = null;
	for (let i = 0; i < 50 && status !== 'cancelled'; i++) {
		await sleep(100);
		status = statusOf(DRAG_ID);
	}
	eq('remove: the popup\'s Remove cancels the booking', status, 'cancelled');
	check(
		'undo: offered straight after',
		await waitFor("Boolean(document.querySelector('form[action$=\"/undo\"] button'))"),
		await evaluate("location.href + ' | ' + [...document.querySelectorAll('.banner')].map((b) => b.className + ': ' + b.innerText.slice(0, 80)).join(' / ')"),
	);
	await tap('form[action$="/undo"] button');
	for (let i = 0; i < 50 && status !== 'confirmed'; i++) {
		await sleep(100);
		status = statusOf(DRAG_ID);
	}
	eq('undo: brings the booking back', status, 'confirmed');

	// --- book from an empty day ------------------------------------------------
	await open(`/?y=${y}&m=${m}`);
	// Wednesday of the same week: on this month's grid, and free now the
	// booking has moved to Thursday.
	const freeDay = addDays(tue, 1);
	// On a laptop a day is selected by clicking it, into the panel beside the
	// month; its + books it.
	await tap(`.cell-day[data-day="${tue}"]`);
	await sleep(150);
	eq('laptop: clicking a day shows it in the panel', await evaluate("document.querySelector('.cal-side .agenda-row.selected')?.dataset.day"), tue);
	check('laptop: the panel sits beside the month', await evaluate("(() => { const g = document.querySelector('.grid-view').getBoundingClientRect(); const p = document.querySelector('.cal-side .agenda-view').getBoundingClientRect(); return p.left >= g.right && p.top < g.bottom; })()"), 'panel not beside the grid');
	check(
		'laptop: the weekend columns are narrower than the weekdays',
		await evaluate("(() => { const w = [...document.querySelectorAll('.grid thead th')].map((th) => [th.classList.contains('weekend'), th.getBoundingClientRect().width]); const we = w.filter(([x]) => x).map(([, v]) => v); const wd = w.filter(([x]) => !x).map(([, v]) => v); return we.length === 2 && Math.max(...we) < Math.min(...wd) * 0.8; })()"),
		'weekend as wide as a weekday',
	);
	check(
		'laptop: and the bars still line up with the days',
		await evaluate("[...document.querySelectorAll('.week-bars > .bar')].every((bar) => { const row = bar.closest('tr'); const col = Number(bar.style.gridColumn.split('/')[0]) - 1; const cell = row.children[col].getBoundingClientRect(); const b = bar.getBoundingClientRect(); return Math.abs(b.left - cell.left) <= 7; })"),
		'a bar starts away from its day',
	);
	check('laptop: and does not open the booking form', !(await evaluate("document.querySelector('[data-create-dialog]').open")), 'dialog opened');
	await tap(`.cell-plus[data-date="${freeDay}"]`);
	check('book: the + on an empty day opens the form', await waitFor("document.querySelector('[data-create-dialog]').open"), 'dialog closed');
	eq('book: on that day', await evaluate("document.querySelector('[data-create-dialog] [data-start]').value"), freeDay);
	// The summary above the button: the cost, the balance, and the button says it.
	const dlg = "document.querySelector('[data-create-dialog]')";
	check('form: the summary says what it costs and leaves', await waitFor(`/1 day/.test(${dlg}.querySelector('[data-preview]').textContent) && / left/.test(${dlg}.querySelector('[data-balance]').textContent)`, 5000), await evaluate(`${dlg}.querySelector('[data-summary]').innerText`));
	eq('form: and the button says it too', await evaluate(`${dlg}.querySelector('[data-submit]').textContent`), 'Book 1 day');
	// More days than the allowance holds: the summary says so before the
	// server has to, and the button waits.
	await evaluate(`${dlg}.querySelector('input[name="mode"][value="range"]').click()`);
	await evaluate(`(() => { const end = ${dlg}.querySelector('[data-end]'); end.value = ${JSON.stringify(addDays(freeDay, 90))}; end.dispatchEvent(new Event('input', { bubbles: true })); })()`);
	check('form: too many days holds the button', await waitFor(`${dlg}.querySelector('[data-submit]').disabled`, 5000), await evaluate(`${dlg}.querySelector('[data-summary]').innerText`));
	check('form: and says why, beside it', await evaluate(`${dlg}.querySelector('[data-balance].bad, [data-preview].bad') !== null && ${dlg}.querySelector('[data-submit]').getAttribute('aria-describedby') === 'booking-summary'`), await evaluate(`${dlg}.querySelector('[data-summary]').innerText`));
	await evaluate(`(() => { const end = ${dlg}.querySelector('[data-end]'); end.value = ${JSON.stringify(freeDay)}; end.dispatchEvent(new Event('input', { bubbles: true })); })()`);
	await evaluate(`${dlg}.querySelector('input[name="mode"][value="one"]').click()`);
	check('form: back within it, the button is free again', await waitFor(`!${dlg}.querySelector('[data-submit]').disabled`, 5000), 'still held');
	check('form: One day hides the To field', await evaluate(`getComputedStyle(${dlg}.querySelector('[data-end]').closest('.when-end')).display === 'none'`), 'To shown');
	await evaluate(`${dlg}.querySelector('input[name="mode"][value="range"]').click()`);
	check('form: Several days shows it, with its half-day ends', await evaluate(`getComputedStyle(${dlg}.querySelector('[data-end]').closest('.when-end')).display !== 'none' && getComputedStyle(${dlg}.querySelector('input[name="dayPart"]').closest('.choice')).display === 'none'`), 'shape did not switch');
	await evaluate(`${dlg}.querySelector('input[name="mode"][value="one"]').click()`);
	await tap('[data-create-dialog] button[type="submit"]');
	let booked = null;
	for (let i = 0; i < 50 && !booked; i++) {
		await sleep(100);
		booked = sqlite.prepare("SELECT start_date FROM leave_requests WHERE user_email = ? AND start_date = ? AND status = 'confirmed'").get(ADMIN, freeDay)?.start_date;
	}
	eq('book: submitting it books the day', booked, freeDay);

	// --- drag across days to book them ------------------------------------------
	await open(`/?y=${y}&m=${m}`);
	check('laptop: no Today card beside the day panel', await evaluate("!document.querySelector('.today-card') || getComputedStyle(document.querySelector('.today-card')).display === 'none'"), 'card shown');
	// The same week as the drag test: always on this month's grid.
	const rangeFrom = addDays(tue, -1);
	const rangeTo = addDays(tue, 1);
	await evaluate(`document.querySelector('td:has(> .cell-add[data-date="${rangeFrom}"])').scrollIntoView({ block: 'center' })`);
	await sleep(100);
	// Low in the cell, clear of the bars that run along its top.
	const low = async (date) => {
		const r = await evaluate(`(() => { const b = document.querySelector('td:has(> .cell-add[data-date="${date}"])').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.bottom - 8 }; })()`);
		return r;
	};
	const a = await low(rangeFrom);
	const b = await low(rangeTo);
	await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
	await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
	for (let i = 1; i <= 10; i++) {
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10, button: 'left', buttons: 1 });
		await sleep(20);
	}
	eq('range: the days dragged across are marked', await evaluate("document.querySelectorAll('.cell.range-pick').length"), 3);
	await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
	check('range: letting go opens the booking form', await waitFor("document.querySelector('[data-create-dialog]').open", 3000), 'dialog closed');
	eq(
		'range: on Several days, from the first day to the last',
		await evaluate("(() => { const d = document.querySelector('[data-create-dialog]'); return [d.querySelector('input[name=\"mode\"]:checked')?.value, d.querySelector('[data-start]').value, d.querySelector('[data-end]').value].join(' '); })()"),
		`range ${rangeFrom} ${rangeTo}`,
	);
	eq('range: and the marks are cleared', await evaluate("document.querySelectorAll('.cell.range-pick').length"), 0);
	await evaluate("document.querySelector('[data-create-dialog]').close()");

	// --- days off by month, on /me ----------------------------------------------
	await send('Page.navigate', { url: `${BASE}/me?y=${y}` });
	await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('.month-bars'))");
	eq('by month: twelve bars', await evaluate("document.querySelectorAll('.month-bars .mb-col').length"), 12);
	check(
		'by month: the month with leave has a bar',
		await evaluate(`document.querySelectorAll('.month-bars .mb-col')[${m - 1}].querySelector('.mb-stack').getBoundingClientRect().height > 10`),
		'no bar',
	);
	check('by month: and a table a screen reader can read', await evaluate("document.querySelector('.month-use table tbody tr') !== null"), 'no table');
	await shot('me-by-month');

	// --- how it looks ----------------------------------------------------------
	// One pixel per CSS pixel: the comparison needs no more, and the references
	// stay small enough to commit.
	await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	// The system theme, pinned: headless Chrome otherwise follows the host's,
	// and a laptop in dark mode would record a "light" reference that is dark.
	const scheme = (value) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
	await scheme('light');
	await open('/?y=2030&m=3');
	await accessible('the month on a phone');
	await looksRight('phone-month');
	await scheme('dark');
	await open('/?y=2030&m=3');
	await accessible('the month on a phone, dark');
	await looksRight('phone-month-dark');
	await scheme('light');
	await send('Emulation.setTouchEmulationEnabled', { enabled: false });
	await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await open('/?y=2030&m=3');
	await accessible('the month on a laptop');
	await looksRight('laptop-month');
	// A30: the booking dialog over the month, on a quiet Tuesday — its summary
	// is 2030's allowance and nobody else away, the same on any date.
	await evaluate("document.querySelector('.cell-plus[data-date=\"2030-03-12\"]').click()");
	await waitFor("document.querySelector('[data-create-dialog]').open && /\\d/.test(document.querySelector('[data-create-dialog] [data-balance]').textContent)", 5000);
	await accessible('the booking dialog');
	await looksRight('laptop-book-dialog');
	await evaluate("document.querySelector('[data-create-dialog]').close()");
	// The admin roster, for a year nobody has set allowances in, so every
	// number is a type default and the year label never moves.
	const openPlain = async (path) => {
		await send('Page.navigate', { url: `${BASE}${path}` });
		await sleep(200);
		await waitFor("document.readyState === 'complete'");
	};
	await openPlain('/admin/people?y=2030');
	await accessible('the admin People page');
	await looksRight('laptop-admin-people');
	await openPlain('/admin');
	await accessible('the admin overview');
	// A30: My leave for 2030 — the balance cards and the by-month chart. The
	// next-leave card and the list run from today, so they are left out.
	await openPlain('/me?y=2030');
	await accessible('My leave');
	await looksRight('laptop-me', ['.next-leave', '.my-leave']);
	// A30: a booking's page. Its "in N days" counts from today.
	await openPlain('/leave/vis-5/edit');
	await accessible("a booking's page");
	await looksRight('laptop-booking-page', ['.booking-head .tag']);
	await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
	await openPlain('/admin/people?y=2030');
	await looksRight('phone-admin-people');
	await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await send('Emulation.setEmulatedMedia', { features: [] });

	// --- in Thai ---------------------------------------------------------------
	await evaluate("fetch('/me/settings', { method: 'POST', body: new URLSearchParams({ displayName: 'Admin', weekStart: '1', lang: 'th' }) }).then((r) => r.status)");
	await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
	await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	await open('/');
	eq('thai: the page says it is Thai', await evaluate('document.documentElement.lang'), 'th');
	check('thai: the phone heading is the Thai short month', await evaluate("/[\\u0E00-\\u0E7F]/.test(document.querySelector('.month-head .m-short').textContent)"), await evaluate("document.querySelector('.month-head .m-short').textContent"));
	check('thai: and the day card still works', await evaluate("document.querySelector('[data-agenda]').classList.contains('day-mode') && Boolean(document.querySelector('.agenda-row.selected'))"), 'no day card');
	await shot('phone-thai');
	await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
	await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
	await open('/?y=2030&m=3');
	await accessible('the month in Thai');
	await looksRight('phone-month-thai');
	await send('Emulation.setEmulatedMedia', { features: [] });

	browser.close();
}

function eq(name, got, want) {
	check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

let exitCode = 0;
try {
	await main();
} catch (err) {
	fail++;
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
