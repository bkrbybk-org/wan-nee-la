#!/usr/bin/env node
/**
 * Apply the migrations a database has not had yet, and remember that it has.
 *
 * Until this, nothing recorded which files had run. `db:init` replayed the
 * whole directory, and most files are written to survive that — but `0003` is
 * a bare `ADD COLUMN`, so a second run failed, and a real failure looked the
 * same as a no-op (ISSUES #24). `ship` made you name each file by hand for the
 * same reason. Now each database carries an `applied_migrations` table, and a
 * file runs once.
 *
 * Each pending file goes to D1 in one script with its own record written
 * straight after it, so a database can never hold a migration's changes
 * without the row saying so. All pending files go in one `wrangler d1 execute`,
 * which is one call to D1 rather than one per file.
 *
 * A database migrated before this existed has the schema and no table. That is
 * refused rather than guessed at: replaying `0003` against it fails, and
 * deciding from the schema which files "must" have run is a guess. Record the
 * history once, explicitly, with --baseline.
 *
 * Usage:
 *   node scripts/migrate.mjs --local                      apply what is pending (npm run db:init)
 *   node scripts/migrate.mjs --remote                     the same, against production (npm run db:init:remote)
 *   node scripts/migrate.mjs --remote --status            list applied and pending; change nothing
 *   node scripts/migrate.mjs --remote --baseline 0011_leave_type_active.sql
 *                    record every file up to and including that one as applied, without running any
 *
 *   --persist-to <dir>   local state directory, as wrangler takes it
 *   --config <file>      wrangler config. Remote defaults to wrangler.local.jsonc, here
 *                        or in the main checkout; local to wrangler.local.jsonc here, else
 *                        wrangler.jsonc — never the main checkout's.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TABLE = 'applied_migrations';
const NAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

/** The migration files, in the order they apply. */
export function migrationFiles(dir = 'migrations') {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.sql'))
		.sort();
}

/** Files not yet recorded, in order. */
export function pendingOf(files, applied) {
	const done = new Set(applied);
	return files.filter((f) => !done.has(f));
}

function checkName(name) {
	// Interpolated into SQL below, so held to the shape every file here has.
	if (!NAME.test(name)) throw new Error(`not a migration file name: ${name}`);
	return name;
}

const createTable = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  name        TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);`;

const record = (name, at) => `INSERT INTO ${TABLE} (name, applied_at) VALUES ('${checkName(name)}', '${at}');`;

/** One SQL script: each file followed by its own record. */
export function applyScript(files, readFile, at = new Date().toISOString()) {
	const parts = [createTable];
	for (const f of files) parts.push(`-- ${checkName(f)}\n${readFile(f).trim()}\n${record(f, at)}`);
	return `${parts.join('\n\n')}\n`;
}

/** Record files as applied without running them. */
export function baselineScript(files, at = new Date().toISOString()) {
	return `${[createTable, ...files.map((f) => record(f, at).replace('INSERT INTO', 'INSERT OR IGNORE INTO'))].join('\n')}\n`;
}

/** Up to and including `last`, which must be one of `files`. */
export function baselineFiles(files, last) {
	const i = files.indexOf(last);
	if (i < 0) throw new Error(`--baseline names ${last}, which is not in migrations/`);
	return files.slice(0, i + 1);
}

/**
 * Where a database stands, from its tables.
 *   fresh   — no app tables: everything is pending
 *   tracked — has the table: pending is whatever it does not list
 *   legacy  — app tables but no record: refuse until --baseline
 */
export function stateOf(tables, applied, files) {
	if (tables.includes(TABLE)) return { kind: 'tracked', applied, pending: pendingOf(files, applied) };
	if (tables.includes('users')) return { kind: 'legacy', applied: [], pending: [] };
	return { kind: 'fresh', applied: [], pending: files };
}

// ---------------------------------------------------------------------------
// Against D1, through wrangler
// ---------------------------------------------------------------------------

/** The main checkout's copy of a gitignored file, for a worktree that lacks it. */
function mainCheckoutFile(file) {
	const res = spawnSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
	const main = res.stdout?.split('\n')[0]?.replace(/^worktree /, '');
	return main ? join(main, file) : null;
}

function resolveConfig(given, remote) {
	if (given) return given;
	if (existsSync('wrangler.local.jsonc')) return 'wrangler.local.jsonc';
	// Only production is worth borrowing for. Locally, wrangler keeps its state
	// beside the config, so a worktree pointed at the main checkout's would
	// migrate the main checkout's local database instead of its own.
	if (!remote) return 'wrangler.jsonc';
	const borrowed = mainCheckoutFile('wrangler.local.jsonc');
	if (borrowed && existsSync(borrowed)) return borrowed;
	if (remote) throw new Error('no wrangler.local.jsonc here or in the main checkout, so there is no production database to name');
	return 'wrangler.jsonc';
}

/**
 * A wrangler target: which database, local or remote, which config.
 * `target.run(sql)` executes a script; `target.query(sql)` returns rows.
 */
export function wranglerTarget({ remote, config, persistTo }) {
	const cfg = resolveConfig(config, remote);
	const db = /"database_name"\s*:\s*"([^"]+)"/.exec(readFileSync(cfg, 'utf8'))?.[1];
	if (!db) throw new Error(`${cfg} names no D1 database`);
	const base = ['wrangler', 'd1', 'execute', db, remote ? '--remote' : '--local', '--config', cfg];
	if (persistTo) base.push('--persist-to', persistTo);
	const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
	const where = remote ? `${db} (remote)` : `${db} (local${persistTo ? `, ${persistTo}` : ''})`;

	return {
		where,
		query(sql) {
			const res = spawnSync('npx', [...base, '--json', '--command', sql], { encoding: 'utf8', env });
			if (res.status !== 0) throw new Error(`query failed on ${where}:\n${(res.stderr || res.stdout).slice(0, 800)}`);
			return JSON.parse(res.stdout)?.[0]?.results ?? [];
		},
		run(sql) {
			const dir = mkdtempSync(join(tmpdir(), 'wnl-migrate-'));
			const file = join(dir, 'migrate.sql');
			try {
				writeFileSync(file, sql);
				const res = spawnSync('npx', [...base, '--file', file], { encoding: 'utf8', env });
				if (res.status !== 0) throw new Error(`migration failed on ${where}:\n${(res.stderr || res.stdout).slice(0, 1500)}`);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	};
}

/** Read a database's state. */
export function readState(target, files = migrationFiles()) {
	const tables = target.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('${TABLE}', 'users')`).map((r) => r.name);
	const applied = tables.includes(TABLE) ? target.query(`SELECT name FROM ${TABLE} ORDER BY name`).map((r) => r.name) : [];
	return stateOf(tables, applied, files);
}

/** Apply what is pending. Returns the files applied. Throws on a legacy database. */
export function applyPending(target, files = migrationFiles()) {
	const state = readState(target, files);
	if (state.kind === 'legacy') throw new LegacyError(target.where);
	if (state.pending.length === 0) return [];
	target.run(applyScript(state.pending, (f) => readFileSync(join('migrations', f), 'utf8')));
	return state.pending;
}

export class LegacyError extends Error {
	constructor(where) {
		super(
			`${where} was migrated before migrations were tracked: it has the schema but no ${TABLE} table. ` +
				'Record what it already has, once, with --baseline <the last file it has had> — then nothing will replay.',
		);
	}
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
	const remote = args.includes('--remote');
	if (remote === args.includes('--local')) {
		console.error('Say which database: --local or --remote.');
		process.exit(1);
	}
	try {
		const target = wranglerTarget({ remote, config: value('--config'), persistTo: value('--persist-to') });
		const files = migrationFiles();

		if (args.includes('--baseline')) {
			const state = readState(target, files);
			if (state.kind === 'fresh') throw new Error(`${target.where} is empty — there is nothing to baseline. Run without --baseline.`);
			const names = baselineFiles(files, value('--baseline'));
			target.run(baselineScript(names));
			console.log(`recorded ${names.length} migration(s) as already applied on ${target.where}, through ${names.at(-1)}`);
			const after = readState(target, files);
			console.log(after.pending.length ? `pending: ${after.pending.join(', ')}` : 'nothing pending');
		} else if (args.includes('--status')) {
			const state = readState(target, files);
			if (state.kind === 'legacy') throw new LegacyError(target.where);
			console.log(`${target.where}: ${state.applied.length} applied${state.kind === 'fresh' ? ' (empty database)' : ''}`);
			console.log(state.pending.length ? `pending: ${state.pending.join(', ')}` : 'nothing pending');
		} else {
			const applied = applyPending(target, files);
			console.log(applied.length ? `applied to ${target.where}: ${applied.join(', ')}` : `${target.where}: nothing pending`);
		}
	} catch (err) {
		console.error(`✗ ${err.message}`);
		process.exit(err instanceof LegacyError ? 2 : 1);
	}
}
