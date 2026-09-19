#!/usr/bin/env node
/**
 * Write public/openapi.json from public/openapi.yaml.
 *
 * /docs used to load the YAML directly, until a zone security rule began
 * refusing every `*.yaml` and `*.yml` path at the edge — a reasonable rule,
 * since those are usually config files, and one worth keeping rather than
 * carving an exception into. The JSON is the same document, so Swagger UI reads
 * it instead. The YAML stays the source: it is what people edit, and what the
 * API Shield export (scripts/openapi-shield.mjs) is derived from.
 *
 * Committed rather than built, so the Worker, the smoke suite and a fresh clone
 * all have it without a build step. `npm run test:openapi` fails if it no
 * longer matches the YAML. Usage: npm run build:spec
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** The JSON text for a given YAML spec, byte-for-byte what gets committed. */
export function specJson(yamlText) {
	return `${JSON.stringify(parse(yamlText), null, '\t')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync('public/openapi.json', specJson(readFileSync('public/openapi.yaml', 'utf8')));
	console.log('public/openapi.json written from public/openapi.yaml');
}
