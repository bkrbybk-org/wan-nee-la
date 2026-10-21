#!/usr/bin/env node
/**
 * Does the schema API Shield holds match the one in this repo?
 *
 * `scripts/shield-uploaded.json` records what was uploaded, but only as well as
 * whoever wrote it: the wrong file uploaded, or a row deleted in the dashboard,
 * and the record still says all is well. And `shield:probe` proves the edge
 * refuses the cases it sends, not that every parameter is covered. This reads
 * the schema itself and fingerprints it the way `ship` fingerprints the repo's
 * spec — paths and components only, so the hostname and the prose do not
 * matter — and says whether they agree.
 *
 * Three ways in:
 *
 *   npm run shield:check                the file openapi:shield wrote to this
 *                                       checkout's dist/ — the one to upload,
 *                                       printed with its full path. Says the
 *                                       local file is right, not that the edge
 *                                       has it.
 *   npm run shield:check -- <file>...   schemas downloaded from the dashboard
 *                                       (Security → Settings → Uploaded schemas
 *                                       → ⋯ → Download): what the edge holds.
 *   npm run shield:check                with CLOUDFLARE_API_TOKEN set (API
 *                                       Gateway: Read): every upload in the
 *                                       zone, fetched. --zone <id> to name it.
 *
 * Exits 0 when the repo's spec is among what was checked, 1 when it is not.
 * A file named for a fingerprint that its content does not have is reported:
 * that is a renamed file, and the name is the thing to stop trusting.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { cfApi, findZoneId } from './cloudflare-api.mjs';
import { fingerprint, fingerprintOf, hostFromConfig, recordedFingerprint, SHIELD_DIR, SHIELD_PREFIX, shieldFileName, shieldFiles, UPLOADED_RECORD } from './openapi-shield.mjs';

const args = process.argv.slice(2);
const value = (name) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--zone');

const SPEC = fileURLToPath(new URL('../public/openapi.yaml', import.meta.url));
const repo = fingerprint(readFileSync(SPEC, 'utf8'));
/** The file to upload for the repo's spec, where openapi:shield writes it in this checkout. */
const toUpload = resolve(SHIELD_DIR, shieldFileName(repo));
const recorded = recordedFingerprint();

/** A schema's fingerprint, from JSON or YAML text. */
function printOf(text) {
	return fingerprintOf(parse(text));
}

/** The fingerprint a name claims — wan-nee-la-openapi-<print>.json — if it claims one. */
function claimedBy(name) {
	const m = new RegExp(`^${SHIELD_PREFIX}([0-9a-f]{16})\\.json$`).exec(name ?? '');
	return m ? m[1] : null;
}

const rows = [];
if (files.length > 0) {
	const missing = files.filter((f) => !existsSync(f));
	if (missing.length > 0) {
		// The dashboard downloads under the name the row has — for an upload made
		// before the names carried a fingerprint, plain wan-nee-la-openapi.json.
		console.error(`No such file: ${missing.join(', ')}`);
		console.error('Download it from Uploaded schemas → ⋯ → Download, then pass the path it was saved to (often ~/Downloads/<the row\'s name>).');
		process.exit(2);
	}
	for (const f of files) {
		try {
			rows.push({ name: basename(f), path: resolve(f), print: printOf(readFileSync(f, 'utf8')), from: 'file' });
		} catch (err) {
			console.error(`${f} is not a JSON or YAML schema: ${err instanceof Error ? err.message : err}`);
			process.exit(2);
		}
	}
} else if (!process.env.CLOUDFLARE_API_TOKEN) {
	// No download and no token: check the file this checkout would upload.
	const local = shieldFiles();
	if (local.length === 0) {
		console.error(`No Shield schema in ${SHIELD_DIR}. Run: npm run openapi:shield`);
		process.exit(2);
	}
	for (const f of local) rows.push({ name: basename(f), path: f, print: printOf(readFileSync(f, 'utf8')), from: 'local' });
} else {
	const token = process.env.CLOUDFLARE_API_TOKEN;
	const host = hostFromConfig();
	if (!host && !value('--zone')) {
		console.error('No hostname to find the zone from: have wrangler.local.jsonc here or in the main checkout, or pass --zone <id>.');
		process.exit(2);
	}
	const zone = await findZoneId(token, host, value('--zone'));
	const all = await cfApi(token, `/zones/${zone}/schema_validation/schemas?omit_source=false`);
	for (const s of all) {
		if (!s.source) continue;
		let print;
		try {
			print = printOf(s.source);
		} catch {
			print = '(unreadable)';
		}
		rows.push({ name: s.name, print, from: 'api', enabled: s.validation_enabled, created: (s.created_at ?? '').slice(0, 10) });
	}
}

console.log(`repo spec  ${repo}   (${SPEC})`);
console.log(`recorded   ${recorded ?? 'none'}   (${UPLOADED_RECORD})${recorded && recorded !== repo ? '  ← differs from the repo: upload the new schema' : ''}`);
console.log('');
for (const r of rows) {
	const verdict = r.print === repo ? '✓ matches the repo' : r.print === recorded ? '≈ the recorded upload, not the repo' : '✗ old or foreign';
	const claim = claimedBy(r.name);
	const renamed = claim && claim !== r.print ? `  ⚠ named ${claim} but holds ${r.print}` : '';
	const meta = r.from === 'api' ? `  ${r.created}  validation ${r.enabled ? 'on ' : 'off'}` : '';
	console.log(`${r.print}  ${verdict.padEnd(36)}${meta}  ${r.path ?? r.name}${renamed}`);
}

const matches = rows.filter((r) => r.print === repo);
console.log('');
if (matches.length === 0) {
	console.log(`✗ nothing checked holds the repo's spec (${repo}).`);
	console.log(`  The file to upload: ${toUpload}${existsSync(toUpload) ? '' : '  (not there yet: npm run openapi:shield)'}`);
	process.exit(1);
}
if (rows.every((r) => r.from === 'local')) {
	// Only the local file was looked at: right to upload, but whether the edge
	// has it is a download (or a token) away.
	console.log(`✓ the file to upload is current: ${toUpload}`);
	console.log('  To check what the edge holds: download the row (Uploaded schemas → ⋯ → Download) and run');
	console.log('    npm run shield:check -- <the downloaded file>');
	process.exit(0);
}
if (rows.length > 1 && rows.some((r) => r.print !== repo && r.name?.startsWith('wan-nee-la'))) {
	console.log('✓ the repo\'s spec is uploaded. Older wan-nee-la uploads are still there; delete them once the probe passes.');
} else {
	console.log('✓ the repo\'s spec is uploaded.');
}
