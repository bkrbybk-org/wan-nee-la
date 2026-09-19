#!/usr/bin/env node
/**
 * Turn public/openapi.yaml into something Cloudflare API Shield will accept.
 *
 * The spec is OpenAPI 3.1, which is what /docs renders and what describes the
 * API most precisely. API Shield's schema validation accepts only 3.0.x, and
 * says so plainly — 3.1 is not supported and not planned. Rather than write the
 * spec twice, or downgrade the one people read, this derives a 3.0.3 copy:
 *
 *   - `type: [string, 'null']`  → `type: string` + `nullable: true`
 *   - `examples: [x]` in a schema → `example: x`
 *   - `const: v`                 → `enum: [v]`
 *   - `info.summary` (3.1 only)  → folded into the description
 *   - response bodies            → dropped, keeping each status and its
 *     description. API Shield validates requests, not responses, and the
 *     response schemas are where most of the 3.1-only shapes live.
 *   - component schemas nothing references any more → dropped
 *   - `servers`                  → one absolute URL, the real hostname.
 *     API Shield rejects relative URLs and does not expand server variables,
 *     so the committed `{hostname}` placeholder would register every
 *     operation against example.com.
 *
 * Then it checks its own output: no 3.1 keyword survives, and every schema
 * has a `type`, which API Shield requires even where OpenAPI does not.
 *
 * The hostname comes from wrangler.local.jsonc (the main checkout's, when run
 * from a worktree) or from --host. The output names that hostname, so it goes
 * to dist/, which is gitignored — this repo is public.
 *
 * Usage:
 *   npm run openapi:shield                    → dist/openapi-shield.json
 *   npm run openapi:shield -- --host api.example.com
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** Convert the 3.1 spec text to a 3.0.3 document for `host`. Throws if the result is not clean. */
export function toShield(specText, host) {
	const spec = parse(specText);

	spec.openapi = '3.0.3';
	if (spec.info?.summary) {
		spec.info.description = `${spec.info.summary}\n\n${spec.info.description ?? ''}`.trim();
		delete spec.info.summary;
	}
	spec.servers = [{ url: `https://${host}` }];

	for (const item of Object.values(spec.paths ?? {})) {
		for (const op of Object.values(item)) {
			if (typeof op !== 'object' || !op?.responses) continue;
			for (const [status, res] of Object.entries(op.responses)) {
				op.responses[status] = { description: res.description ?? status };
			}
		}
	}
	delete spec.components?.responses;

	downgrade(spec);
	pruneUnreferenced(spec);

	const problems = audit(spec);
	if (problems.length > 0) throw new Error(`not API Shield-ready:\n  ${problems.join('\n  ')}`);
	return spec;
}

/**
 * Visit every Schema Object in the document, children before parents.
 *
 * Only schema positions are visited. `examples` means an array under a schema
 * but a map of Example Objects under a media type or parameter, so rewriting
 * by key name alone would break the second kind.
 */
function eachSchema(node, visit, inSchema = false, path = '') {
	if (Array.isArray(node)) {
		node.forEach((v, i) => eachSchema(v, visit, inSchema, `${path}[${i}]`));
		return;
	}
	if (typeof node !== 'object' || node === null) return;
	for (const [key, value] of Object.entries(node)) {
		const at = path ? `${path}.${key}` : key;
		if (key === 'schema') eachSchema(value, visit, true, at);
		else if (key === 'schemas' && path === 'components') for (const [k, v] of Object.entries(value)) eachSchema(v, visit, true, `${at}.${k}`);
		else if (inSchema && key === 'properties') for (const [k, v] of Object.entries(value)) eachSchema(v, visit, true, `${at}.${k}`);
		else if (inSchema && ['items', 'additionalProperties', 'not'].includes(key)) eachSchema(value, visit, true, at);
		else if (inSchema && ['oneOf', 'anyOf', 'allOf'].includes(key)) value.forEach((v, i) => eachSchema(v, visit, true, `${at}[${i}]`));
		else if (!inSchema) eachSchema(value, visit, false, at);
	}
	if (inSchema) visit(node, path);
}

/** Rewrite 3.1 schema keywords in place. */
function downgrade(spec) {
	eachSchema(spec, (node) => {
		if (Array.isArray(node.type)) {
			const types = node.type.filter((t) => t !== 'null');
			if (types.length !== node.type.length) node.nullable = true;
			if (types.length === 1) node.type = types[0];
			else {
				delete node.type;
				node.oneOf = types.map((t) => ({ type: t }));
			}
		}
		if (Array.isArray(node.examples)) {
			node.example = node.examples[0];
			delete node.examples;
		}
		if ('const' in node) {
			node.enum = [node.const];
			delete node.const;
		}
	});
}

/** Every `$ref` string under `node`. */
function refsIn(node, out = new Set()) {
	if (Array.isArray(node)) node.forEach((v) => refsIn(v, out));
	else if (typeof node === 'object' && node !== null) {
		for (const [k, v] of Object.entries(node)) {
			if (k === '$ref' && typeof v === 'string') out.add(v);
			else refsIn(v, out);
		}
	}
	return out;
}

/**
 * Drop component schemas nothing reaches from the paths. Followed transitively,
 * so a schema used only by another reachable schema stays.
 */
function pruneUnreferenced(spec) {
	const schemas = spec.components?.schemas;
	if (!schemas) return;
	const prefix = '#/components/schemas/';
	const keep = new Set();
	const queue = [...refsIn(spec.paths)];
	while (queue.length > 0) {
		const ref = queue.pop();
		if (!ref.startsWith(prefix)) continue;
		const name = ref.slice(prefix.length);
		if (keep.has(name) || !schemas[name]) continue;
		keep.add(name);
		queue.push(...refsIn(schemas[name]));
	}
	for (const name of Object.keys(schemas)) if (!keep.has(name)) delete schemas[name];
}

/** Everything API Shield or OpenAPI 3.0 would reject, as readable lines. */
function audit(spec) {
	const problems = [];
	eachSchema(spec, (node, path) => {
		if (Array.isArray(node.type)) problems.push(`${path}: type is a list`);
		if (node.type === 'null') problems.push(`${path}: type 'null'`);
		if ('const' in node) problems.push(`${path}: const`);
		if (Array.isArray(node.examples)) problems.push(`${path}: examples array`);
		if (!node.type && !node.$ref && !node.oneOf && !node.anyOf && !node.allOf) problems.push(`${path}: no type`);
	});
	if (spec.openapi !== '3.0.3') problems.push('openapi is not 3.0.3');
	if ('summary' in (spec.info ?? {})) problems.push('info.summary is 3.1-only');
	if (!/^https:\/\/[^/{}]+$/.test(spec.servers?.[0]?.url ?? '')) problems.push('servers[0].url is not one absolute hostname');
	return problems;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** The route's hostname from wrangler.local.jsonc, here or in the main checkout. */
function hostFromConfig() {
	const main = spawnSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout?.split('\n')[0]?.replace(/^worktree /, '');
	for (const file of ['wrangler.local.jsonc', main && join(main, 'wrangler.local.jsonc')]) {
		if (!file || !existsSync(file)) continue;
		const m = /"pattern"\s*:\s*"([^"/]+)/.exec(readFileSync(file, 'utf8'));
		if (m) return m[1];
	}
	return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const i = process.argv.indexOf('--host');
	const host = i > 0 ? process.argv[i + 1] : hostFromConfig();
	if (!host) {
		console.error('No hostname: pass --host, or have wrangler.local.jsonc in this or the main checkout.');
		process.exit(1);
	}
	const spec = toShield(readFileSync('public/openapi.yaml', 'utf8'), host);
	mkdirSync('dist', { recursive: true });
	writeFileSync('dist/openapi-shield.json', `${JSON.stringify(spec, null, 2)}\n`);
	const ops = Object.values(spec.paths).reduce((n, item) => n + Object.keys(item).filter((k) => k !== 'parameters').length, 0);
	console.log(`dist/openapi-shield.json — OpenAPI 3.0.3, ${ops} operations. Gitignored: it names the real hostname.`);
}
