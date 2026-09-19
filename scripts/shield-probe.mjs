#!/usr/bin/env node
/**
 * Probe production to see whether Cloudflare API Shield schema validation is
 * doing anything.
 *
 * Sends pairs of anonymous requests to the seven operations in the uploaded
 * schema (see scripts/openapi-shield.mjs): one that matches the schema and
 * one that breaks it in exactly one way. Nothing here can change data — every
 * request is either stopped at the edge (by the WAF or by Access) or, for the
 * LINE webhook, refused by the Worker for having no signature before anything
 * is parsed.
 *
 * Reading the result:
 *   - A compliant request should get Access's 302 to the login page.
 *   - With validation enforced by a WAF rule, a violating one gets a 403 from
 *     the edge (`cf-mitigated`), never reaching Access.
 *   - With validation on Log, or not active, both get the same answer. Then
 *     the proof is in Security → Analytics, filtered by the Ray IDs printed
 *     here: violating requests should show `cf.schema_validation.uploaded.
 *     violated`, compliant ones should not.
 *
 * The hostname comes from wrangler.local.jsonc, here or in the main checkout,
 * or from --host. Usage: npm run shield:probe [-- --host example.com]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function hostFromConfig() {
	const main = spawnSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout?.split('\n')[0]?.replace(/^worktree /, '');
	for (const file of ['wrangler.local.jsonc', main && join(main, 'wrangler.local.jsonc')]) {
		if (!file || !existsSync(file)) continue;
		const m = /"pattern"\s*:\s*"([^"/]+)/.exec(readFileSync(file, 'utf8'));
		if (m) return m[1];
	}
	return null;
}

const i = process.argv.indexOf('--host');
const host = i > 0 ? process.argv[i + 1] : hostFromConfig();
if (!host) {
	console.error('No hostname: pass --host, or have wrangler.local.jsonc in this or the main checkout.');
	process.exit(1);
}
const base = `https://${host}`;

// A plausible browser push subscription. Never reaches the Worker: Access
// stops it, and even if it did, subscribe needs a signed-in user.
const SUB = {
	endpoint: 'https://fcm.googleapis.com/fcm/send/shield-probe',
	expirationTime: null,
	keys: { p256dh: 'BExampleKeyOnlyForSchemaShape', auth: 'c2hpZWxkLXByb2Jl' },
};
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** [label, path, init, compliant] — the violating cases each break one rule. */
const CASES = [
	['health', '/health', {}, true],

	['feed: valid range', '/api/leave?from=2026-09-01&to=2026-09-30', {}, true],
	['feed: from is not a date', '/api/leave?from=yesterday&to=2026-09-30', {}, false],
	['feed: to has a time in it', '/api/leave?from=2026-09-01&to=2026-09-30T00:00', {}, false],

	['preview: valid', '/api/leave/preview?leaveTypeId=1&start=2026-09-22&end=2026-09-23&startHalf=full&endHalf=full', {}, true],
	['preview: required start missing', '/api/leave/preview?leaveTypeId=1&end=2026-09-23', {}, false],
	['preview: half not in enum', '/api/leave/preview?start=2026-09-22&startHalf=evening', {}, false],
	['preview: type id not an integer', '/api/leave/preview?leaveTypeId=annual&start=2026-09-22', {}, false],
	['preview: exclude not a uuid', '/api/leave/preview?start=2026-09-22&exclude=42', {}, false],

	['subscribe: valid', '/api/push/subscribe', json(SUB), true],
	['subscribe: keys missing', '/api/push/subscribe', json({ endpoint: SUB.endpoint }), false],
	['subscribe: endpoint is a number', '/api/push/subscribe', json({ ...SUB, endpoint: 42 }), false],
	['subscribe: body not JSON-typed', '/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(SUB) }, false],

	['unsubscribe: valid', '/api/push/unsubscribe', json({ endpoint: SUB.endpoint }), true],
	['unsubscribe: endpoint missing', '/api/push/unsubscribe', json({}), false],

	['test push: valid', '/api/push/test', { method: 'POST' }, true],

	['webhook: valid shape', '/line/webhook', json({ destination: 'Uprobe', events: [] }), true],
	['webhook: body is an array', '/line/webhook', json([]), false],
	['webhook: events not an array', '/line/webhook', json({ destination: 'Uprobe', events: 'none' }), false],

	['unlisted path (fallthrough)', '/api/not-in-the-schema', {}, null],
];

function verdict(res) {
	const loc = res.headers.get('location') ?? '';
	if (res.status === 302 && /cloudflareaccess\.com/.test(loc)) return 'access';
	if (res.headers.get('cf-mitigated')) return `edge:${res.headers.get('cf-mitigated')}`;
	if (res.status === 403 && /cloudflare/i.test(res.headers.get('server') ?? '')) return 'edge-403';
	return 'worker';
}

const rows = [];
for (const [label, path, init, compliant] of CASES) {
	const res = await fetch(base + path, { redirect: 'manual', ...init }).catch((e) => ({ status: 0, headers: new Headers(), error: e }));
	rows.push({ label, compliant, status: res.status, verdict: res.status ? verdict(res) : `error: ${res.error?.message}`, ray: res.headers.get('cf-ray') ?? '-' });
	await new Promise((r) => setTimeout(r, 250));
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('case', 36)}${pad('expect', 10)}${pad('status', 8)}${pad('stopped by', 16)}ray`);
for (const r of rows) {
	const expect = r.compliant === null ? 'n/a' : r.compliant ? 'pass' : 'violate';
	console.log(`${pad(r.label, 36)}${pad(expect, 10)}${pad(r.status, 8)}${pad(r.verdict, 16)}${r.ray}`);
}

const good = rows.filter((r) => r.compliant === true);
const badRows = rows.filter((r) => r.compliant === false);
const blocked = badRows.filter((r) => r.verdict.startsWith('edge'));
const goodBlocked = good.filter((r) => r.verdict.startsWith('edge'));

console.log('');
if (goodBlocked.length > 0) {
	console.log(`✗ ${goodBlocked.length} compliant request(s) were stopped at the edge — the schema or the rule is too strict:`);
	for (const r of goodBlocked) console.log(`    ${r.label} (${r.ray})`);
}
if (blocked.length === badRows.length) {
	console.log(`✓ Enforced: all ${badRows.length} violating requests were stopped at the edge, before Access.`);
} else if (blocked.length > 0) {
	console.log(`~ Partly enforced: ${blocked.length} of ${badRows.length} violating requests were stopped at the edge. Not stopped:`);
	for (const r of badRows.filter((x) => !x.verdict.startsWith('edge'))) console.log(`    ${r.label} (${r.ray})`);
} else {
	console.log(`- Not enforced: no violating request was stopped at the edge. Either the rule is on Log, it is not`);
	console.log(`  deployed yet, or it runs after Access. Look the Ray IDs up in Security → Analytics: the ${badRows.length}`);
	console.log(`  "violate" rows should carry a schema violation, the ${good.length} "pass" rows should not.`);
}
