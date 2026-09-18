#!/usr/bin/env node
/**
 * Keeps public/openapi.yaml honest.
 *
 * The spec is hand-written, which is the only way it could carry the reasoning
 * it does — but a hand-written spec rots the moment someone adds a route and
 * forgets. This compares the JSON-answering routes in src/index.tsx against
 * the paths the spec documents and fails when the two disagree.
 *
 * It checks that the two sets match, not that the schemas are right. Nothing
 * here can tell you a response gained a field; only that an endpoint exists
 * and is written down, or does not and is not.
 *
 * Run: node scripts/check-openapi.mjs
 */

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/index.tsx', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../public/openapi.yaml', import.meta.url), 'utf8');

/**
 * Routes that answer in HTML or with a redirect, and are deliberately absent.
 *
 * The spec covers the JSON surface. Everything here is a browser flow: a page
 * render, or a form post that replies with a 303 and a flash cookie. Listing
 * them by name rather than by pattern means a new one has to be classified on
 * purpose — which is the point. A route that is neither documented nor named
 * here fails the check.
 */
const NOT_JSON = new Set([
	'GET /',
	'GET /book',
	'GET /docs',
	'GET /leave/:id/edit',
	'GET /me',
	'GET /u/:email',
	'GET /admin',
	// Form posts. These take application/x-www-form-urlencoded and answer 303.
	'POST /api/leave',
	'POST /api/leave/:id/edit',
	'POST /api/leave/:id/cancel',
	'POST /api/leave/:id/undo',
	'POST /me/week-start',
	'POST /me/lang',
	'POST /me/name',
	'POST /admin/quotas',
	'POST /admin/quotas/bulk',
	'POST /admin/user',
	'POST /admin/notify/preview',
	'POST /admin/notify/send',
	'POST /admin/holidays/import',
	'POST /admin/holiday',
	'POST /admin/holiday/delete',
	'POST /admin/type',
	'POST /admin/type/delete',
]);

// `app.get('/path'` / `app.post('/path'`, which is how every route is declared.
const routes = new Set();
for (const m of src.matchAll(/^app\.(get|post|put|delete)\('([^']+)'/gm)) {
	routes.add(`${m[1].toUpperCase()} ${m[2]}`);
}

/*
 * The spec's own paths. Deliberately a regex rather than a YAML parser: this
 * repository ships one runtime dependency and has no parser, and adding one to
 * read back a file we wrote ourselves is a poor trade. The shape being matched
 * is two-space-indented `/path:` under `paths:`, followed by the methods
 * indented under it — which is how the file is written and how it stays.
 */
const documented = new Set();
const pathsBlock = spec.slice(spec.indexOf('\npaths:'), spec.indexOf('\ncomponents:'));
let current = null;
for (const line of pathsBlock.split('\n')) {
	const path = /^ {2}(\/\S*):\s*$/.exec(line);
	if (path) {
		current = path[1];
		continue;
	}
	const method = /^ {4}(get|post|put|delete):\s*$/.exec(line);
	if (method && current) documented.add(`${method[1].toUpperCase()} ${current}`);
}

let bad = 0;

for (const route of routes) {
	if (documented.has(route) || NOT_JSON.has(route)) continue;
	console.error(`FAIL ${route} is in src/index.tsx but neither documented in openapi.yaml nor listed as non-JSON`);
	bad++;
}

for (const path of documented) {
	if (routes.has(path)) continue;
	console.error(`FAIL ${path} is documented in openapi.yaml but no such route exists`);
	bad++;
}

for (const route of NOT_JSON) {
	if (routes.has(route)) continue;
	console.error(`FAIL ${route} is listed as non-JSON but no such route exists — stale entry`);
	bad++;
}

if (bad === 0) {
	console.error(`ok   ${documented.size} documented, ${NOT_JSON.size} deliberately not, ${routes.size} routes in total`);
} else {
	console.error(`\n${bad} mismatch(es) between src/index.tsx and public/openapi.yaml`);
}

process.exitCode = bad === 0 ? 0 : 1;
