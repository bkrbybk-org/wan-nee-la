// Migration tracking (scripts/migrate.mjs, ISSUES #24).
//
// Two halves. The scripts it generates are run against an in-memory SQLite
// database, which is fast and shows the SQL itself is right. Then the CLI is
// run for real through `wrangler d1 execute --local` on a scratch directory,
// twice — the second run is the one that used to fail.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TABLE, applyScript, baselineFiles, baselineScript, migrationFiles, pendingOf, stateOf } from './migrate.mjs';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
	if (ok) passed++;
	else {
		failed++;
		console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
	}
}
const throws = (fn) => {
	try {
		fn();
		return false;
	} catch {
		return true;
	}
};

const files = migrationFiles();
const read = (f) => readFileSync(join('migrations', f), 'utf8');
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
const applied = (db) => db.prepare(`SELECT name FROM ${TABLE} ORDER BY name`).all().map((r) => r.name);

// --- planning ---------------------------------------------------------------

check('files sorted, 0001 first', files[0].startsWith('0001_') && files.every((f, i) => i === 0 || files[i - 1] < f));
check('pending: nothing applied → all', pendingOf(files, []).length === files.length);
check('pending: all applied → none', pendingOf(files, files).length === 0);
check('pending: keeps order, skips the applied', pendingOf(['a', 'b', 'c'], ['b']).join() === 'a,c');
check('state: empty database is fresh, all pending', stateOf([], [], files).kind === 'fresh' && stateOf([], [], files).pending.length === files.length);
check('state: schema without the table is legacy', stateOf(['users', 'holidays'], [], files).kind === 'legacy');
check('state: tracked lists what is missing', stateOf([TABLE, 'users'], files.slice(0, 3), files).pending.join() === files.slice(3).join());
check('baseline: through a named file', baselineFiles(files, files[2]).join() === files.slice(0, 3).join());
check('baseline: an unknown file is refused', throws(() => baselineFiles(files, '9999_nope.sql')));
check('a name that could break out of the SQL string is refused', throws(() => applyScript(["0001_x'); DROP TABLE users; --.sql"], () => '')));

// --- the generated SQL, on SQLite -------------------------------------------

{
	const db = new DatabaseSync(':memory:');
	db.exec(applyScript(files, read));
	check('fresh apply: every file recorded', applied(db).join() === files.join());
	check('fresh apply: the schema is there', ['users', 'leave_requests', 'leave_audit', 'push_subscriptions'].every((t) => tables(db).includes(t)));
	check('fresh apply: 0011 ran (leave_types.active)', db.prepare('SELECT COUNT(*) AS n FROM pragma_table_info(\'leave_types\') WHERE name = \'active\'').get().n === 1);
	check('second plan is empty', pendingOf(files, applied(db)).length === 0);
	// The hazard this exists for: 0003 replayed is an error, not a no-op.
	check('replaying 0003 by hand still fails — which is why it must not be replayed', throws(() => db.exec(read('0003_week_start.sql'))));
	db.close();
}

{
	// A database built the old way: every file, no record.
	const db = new DatabaseSync(':memory:');
	for (const f of files) db.exec(read(f));
	check('legacy: recognised', stateOf(tables(db), [], files).kind === 'legacy');
	db.exec(baselineScript(baselineFiles(files, files.at(-1))));
	check('baseline: records every file without running one', applied(db).join() === files.join());
	db.exec(baselineScript(files));
	check('baseline: running it twice changes nothing', applied(db).length === files.length);
	const withNew = [...files, '9999_next.sql'];
	check('a file added later is the only one pending', pendingOf(withNew, applied(db)).join() === '9999_next.sql');
	db.close();
}

{
	// A file that fails stops the script before its record is written.
	const db = new DatabaseSync(':memory:');
	const broken = ['0001_a.sql', '0002_b.sql'];
	const body = { '0001_a.sql': 'CREATE TABLE a (x);', '0002_b.sql': 'ALTER TABLE nope ADD COLUMN y;' };
	check('a failing file throws', throws(() => db.exec(applyScript(broken, (f) => body[f]))));
	check('…and is not recorded as applied', applied(db).join() === '0001_a.sql');
	db.close();
}

// --- the CLI, through wrangler ----------------------------------------------

const cli = (dir, ...extra) =>
	spawnSync('node', ['scripts/migrate.mjs', '--local', '--config', 'wrangler.jsonc', '--persist-to', dir, ...extra], {
		encoding: 'utf8',
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
	});

const fresh = mkdtempSync(join(tmpdir(), 'wnl-migrate-fresh-'));
const legacy = mkdtempSync(join(tmpdir(), 'wnl-migrate-legacy-'));
try {
	let r = cli(fresh);
	check('cli: first run applies everything', r.status === 0 && r.stdout.includes(files.at(-1)), r.stderr.slice(0, 400));
	r = cli(fresh);
	check('cli: second run is a no-op, not an error (#24)', r.status === 0 && /nothing pending/.test(r.stdout), r.stderr.slice(0, 400));
	r = cli(fresh, '--status');
	check('cli: status counts them', r.status === 0 && r.stdout.includes(`${files.length} applied`), r.stdout + r.stderr);

	// The old way: one file executed directly, no tracking table.
	const direct = spawnSync(
		'npx',
		['wrangler', 'd1', 'execute', 'wan-nee-la', '--local', '--config', 'wrangler.jsonc', '--persist-to', legacy, '--file', 'migrations/0001_init.sql'],
		{ encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
	);
	check('cli: legacy fixture built', direct.status === 0, direct.stderr.slice(0, 400));
	r = cli(legacy);
	check('cli: a legacy database is refused, exit 2', r.status === 2 && /--baseline/.test(r.stderr), `${r.status} ${r.stderr.slice(0, 300)}`);
	r = cli(legacy, '--baseline', '0001_init.sql');
	check('cli: baseline records 0001', r.status === 0 && /recorded 1 migration/.test(r.stdout), r.stderr.slice(0, 400));
	r = cli(legacy);
	check('cli: after the baseline, the rest apply', r.status === 0 && r.stdout.includes('0002_seed.sql') && !r.stdout.includes('0001_init'), r.stdout + r.stderr.slice(0, 400));
	r = cli(legacy, '--status');
	check('cli: and nothing is left', /nothing pending/.test(r.stdout), r.stdout);
} finally {
	rmSync(fresh, { recursive: true, force: true });
	rmSync(legacy, { recursive: true, force: true });
}

console.log(`${failed ? '✗' : '✓'} migrate: ${passed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
