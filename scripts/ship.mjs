#!/usr/bin/env node
/**
 * Ship the working tree: local checks, then deploy, then check production.
 *
 * The order is the project's release rule. Each stage runs only if the one
 * before it passed, and the first failure stops everything with a non-zero
 * exit — a deploy never follows a red test, and a failed production check is
 * reported as exactly that rather than as a finished release. What comes after
 * (updating the docs, committing, pushing) is left to a person on purpose:
 * this script only proves the code works where it runs.
 *
 *   1. Local   typecheck, lint, unit tests, colour contrast, route smoke tests.
 *   2. Deploy  any migrations named with --migrate, applied to production D1
 *              first, then `npm run deploy`.
 *   3. Prod    the new version is the one serving, Access still fronts the
 *              hostname, and production D1 answers a read.
 *
 * The real config, `wrangler.local.jsonc`, is gitignored and lives only in the
 * main checkout. Run from a git worktree, this copies it in for the deploy and
 * removes it again afterwards, whatever happened.
 *
 * Usage:
 *   npm run ship
 *   npm run ship -- --migrate migrations/0011_leave_type_active.sql
 *   npm run ship -- --local-only        stage 1 alone
 *
 * Migrations are named, never inferred: D1 here has no record of which files
 * have been applied, and an ALTER TABLE run twice fails. Naming the file is the
 * deliberate act — read it first if it deletes anything.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG = 'wrangler.local.jsonc';
const args = process.argv.slice(2);
const localOnly = args.includes('--local-only');
const migrations = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--migrate') migrations.push(args[++i]);
	else if (args[i] !== '--local-only') fail(`unknown argument: ${args[i]}`);
}
for (const m of migrations) {
	if (!m || !existsSync(m)) fail(`no such migration: ${m}`);
}

function fail(message) {
	console.error(`\n✗ ship: ${message}`);
	process.exit(1);
}

function stage(title) {
	console.log(`\n━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}`);
}

/** Run a command with its output streamed; stop the ship if it fails. */
function run(cmd, cmdArgs, what) {
	console.log(`\n$ ${cmd} ${cmdArgs.join(' ')}`);
	const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
	if (res.status !== 0) fail(`${what} failed`);
}

/** Run a command and return its stdout; stop the ship if it fails. */
function capture(cmd, cmdArgs, what) {
	const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
	if (res.status !== 0) {
		process.stderr.write(res.stderr || res.stdout || '');
		fail(`${what} failed`);
	}
	return res.stdout;
}

/** JSON with comments and trailing commas, as wrangler writes it. Strings are respected. */
function parseJsonc(text) {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j;
		} else if (ch === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			out += '\n';
		} else if (ch === '/' && text[i + 1] === '*') {
			i = text.indexOf('*/', i + 2) + 1;
		} else {
			out += ch;
		}
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// ---------------------------------------------------------------------------
// 1. Local
// ---------------------------------------------------------------------------

stage('1/3 local checks');
run('npm', ['run', 'typecheck'], 'typecheck');
run('npm', ['run', 'lint'], 'lint');
run('npm', ['test'], 'unit tests');
// Prints every palette on success; only the exit code and any complaint matter here.
console.log('\n$ node scripts/palette.mjs > /dev/null');
if (spawnSync('node', ['scripts/palette.mjs'], { stdio: ['ignore', 'ignore', 'inherit'] }).status !== 0) fail('colour contrast failed');
run('npm', ['run', 'test:smoke'], 'smoke tests');
console.log('\n✓ local checks passed');
if (localOnly) process.exit(0);

// ---------------------------------------------------------------------------
// 2. Deploy
// ---------------------------------------------------------------------------

stage('2/3 deploy');

// The main checkout is always the first entry `git worktree list` prints.
let borrowed = false;
if (!existsSync(CONFIG)) {
	const main = capture('git', ['worktree', 'list', '--porcelain'], 'git worktree list').split('\n')[0].replace(/^worktree /, '');
	const source = join(main, CONFIG);
	if (!existsSync(source)) fail(`${CONFIG} is in neither this checkout nor the main one (${main})`);
	copyFileSync(source, CONFIG);
	borrowed = true;
	console.log(`borrowed ${CONFIG} from the main checkout`);
}
const giveBack = () => {
	if (borrowed) rmSync(CONFIG, { force: true });
};
process.on('exit', giveBack);
process.on('SIGINT', () => process.exit(130));

const config = parseJsonc(readFileSync(CONFIG, 'utf8'));
const host = config.routes?.[0]?.pattern?.replace(/\/.*$/, '');
const dbName = config.d1_databases?.[0]?.database_name;
if (!host || !dbName) fail(`${CONFIG} names no route or no D1 database`);

for (const file of migrations) {
	run('npx', ['wrangler', 'd1', 'execute', dbName, '--remote', '--config', CONFIG, '--file', file], `migration ${file}`);
}

const deployOut = spawnSync('npm', ['run', 'deploy'], { encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
process.stdout.write(deployOut.stdout ?? '');
process.stderr.write(deployOut.stderr ?? '');
if (deployOut.status !== 0) fail('deploy failed');
const version = /Current Version ID:\s*([0-9a-f-]{36})/.exec(deployOut.stdout ?? '')?.[1];
if (!version) fail('deploy printed no version id, so there is nothing to check production against');
console.log(`\n✓ deployed version ${version}`);

// ---------------------------------------------------------------------------
// 3. Production
// ---------------------------------------------------------------------------

stage('3/3 production checks');
let problems = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg) => {
	problems++;
	console.log(`✗ ${msg}`);
};

// The version now taking 100% of traffic has to be the one just uploaded.
// Another session deploying in the same minute is the case this catches.
const deployments = JSON.parse(capture('npx', ['wrangler', 'deployments', 'list', '--json', '--config', CONFIG], 'wrangler deployments list'));
const latest = deployments.at(-1) ?? deployments[0];
const serving = latest?.versions?.find((v) => v.percentage === 100)?.version_id;
if (serving === version) ok('the new version serves all traffic');
else bad(`the version serving traffic is ${serving ?? 'unknown'}, not ${version}`);

// /health is either behind Access (302 to the login page) or, once the uptime
// monitor's Bypass rule exists, open — in which case it must be the new version
// answering, with D1 up and the dev auth bypass off.
const probe = await fetch(`https://${host}/health`, { redirect: 'manual' }).catch(() => ({ status: 0, headers: new Headers() }));
if (probe.status === 302 && /cloudflareaccess\.com/.test(probe.headers.get('location') ?? '')) {
	ok('/health is behind Access (302 to the login page)');
} else if (probe.status === 200) {
	const h = await probe.json().catch(() => ({}));
	if (h.version === version && h.db === true && h.devAuthBypass === false) ok('/health is open (Bypass rule) and reports the new version, D1 up');
	else bad(`/health is open but reports version ${h.version}, db ${h.db}, devAuthBypass ${h.devAuthBypass}`);
} else {
	bad(`/health answered ${probe.status} to an anonymous request`);
}
const root = await fetch(`https://${host}/`, { redirect: 'manual' }).catch(() => ({ status: 0 }));
// The pages that carry people's leave must never be open, Bypass rule or not.
if (root.status === 302) ok('the calendar is behind Access');
else bad(`/ answered ${root.status} to an anonymous request`);

// A read against production D1, through the same binding config the Worker uses.
const rows = JSON.parse(
	capture(
		'npx',
		['wrangler', 'd1', 'execute', dbName, '--remote', '--json', '--config', CONFIG, '--command', 'SELECT COUNT(*) AS n FROM leave_types'],
		'production D1 read',
	),
);
const types = rows?.[0]?.results?.[0]?.n;
if (typeof types === 'number' && types > 0) ok(`production D1 answers (${types} leave types)`);
else bad('production D1 returned no leave types');

if (problems > 0) fail(`${problems} production check(s) failed — version ${version} is live; roll back with \`npx wrangler rollback\` if it is at fault`);
console.log(`\n✓ shipped ${version}. Next: update the docs, then commit and push.`);
