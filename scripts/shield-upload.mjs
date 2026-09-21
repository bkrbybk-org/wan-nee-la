#!/usr/bin/env node
/**
 * Upload dist/openapi-shield.json to Cloudflare API Shield.
 *
 * The schema names paths and parameters exactly, so it goes stale the moment
 * the API changes — and a stale schema does not fail loudly: the operations it
 * no longer matches simply stop being validated. Moving to `/api/v1/…` left the
 * whole API unchecked until someone re-uploaded by hand. This makes that step a
 * command rather than a dashboard errand (PLAN 4.14).
 *
 * What it does NOT do: create the WAF rule that blocks on
 * `cf.schema_validation.uploaded.violated`. Uploading only supplies the
 * detection; mitigation is a rule you deploy deliberately, on Log first.
 *
 * Needs a token with the **API Gateway** permission (Account or Domain), which
 * only the account owner can mint:
 *
 *   export CLOUDFLARE_API_TOKEN=…
 *   npm run openapi:shield && npm run shield:upload
 *
 * The zone is found from the hostname in wrangler.local.jsonc, or given with
 * --zone <id>. `--activate` turns validation on for the uploaded schema;
 * without it the schema is uploaded inactive, which is the safer default for a
 * first run. `--prune` deletes this script's older uploads afterwards, so the
 * list does not fill with one schema per deploy.
 */

import { existsSync, readFileSync } from 'node:fs';

const API = 'https://api.cloudflare.com/client/v4';
const NAME_PREFIX = 'wan-nee-la-';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
	console.error('CLOUDFLARE_API_TOKEN is not set. It needs the API Gateway permission — see the comment at the top of this file.');
	process.exit(1);
}

const file = 'dist/openapi-shield.json';
if (!existsSync(file)) {
	console.error(`${file} is missing. Run: npm run openapi:shield`);
	process.exit(1);
}
const source = readFileSync(file, 'utf8');
const spec = JSON.parse(source);
const host = spec.servers?.[0]?.url?.replace(/^https:\/\//, '');
if (!host) {
	console.error(`${file} names no server, so there is no hostname to find a zone for.`);
	process.exit(1);
}

async function api(path, init = {}) {
	const res = await fetch(API + path, {
		...init,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.success === false) {
		const why = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
		throw new Error(`${init.method ?? 'GET'} ${path} failed: ${why}`);
	}
	return body.result;
}

/** The zone whose name is the longest suffix of the hostname — api.x.example.com lives in example.com. */
async function findZone() {
	const given = value('--zone');
	if (given) return given;
	const parts = host.split('.');
	for (let i = 0; i < parts.length - 1; i++) {
		const candidate = parts.slice(i).join('.');
		const zones = await api(`/zones?name=${encodeURIComponent(candidate)}`);
		if (zones.length > 0) return zones[0].id;
	}
	throw new Error(`no zone found for ${host}. Pass --zone <id>.`);
}

const zone = await findZone();
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const name = `${NAME_PREFIX}${stamp}`;

const uploaded = await api(`/zones/${zone}/schema_validation/schemas`, {
	method: 'POST',
	body: JSON.stringify({ kind: 'openapi_v3', name, source, validation_enabled: flag('--activate') }),
});
const id = uploaded.schema?.schema_id ?? uploaded.schema_id;
const ops = Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).length, 0);
console.log(`uploaded ${name} (${id}) — ${ops} operations, validation ${flag('--activate') ? 'enabled' : 'not enabled yet'}`);

if (flag('--prune')) {
	const all = await api(`/zones/${zone}/schema_validation/schemas?omit_source=true`);
	const mine = all.filter((s) => s.name?.startsWith(NAME_PREFIX) && s.schema_id !== id);
	for (const old of mine) {
		await api(`/zones/${zone}/schema_validation/schemas/${old.schema_id}`, { method: 'DELETE' });
		console.log(`deleted older upload ${old.name}`);
	}
}

console.log('');
console.log('Next, if this is the first upload:');
console.log('  1. Web Assets → Operations: the schema\'s operations must be listed there.');
console.log('  2. Security rules → Custom rules, on cf.schema_validation.uploaded.violated, action Log.');
console.log('  3. npm run shield:probe, then switch the rule to Block once the log is quiet.');
console.log('');
console.log('Nothing above is verified from outside. `npm run shield:probe` is what checks the edge.');
