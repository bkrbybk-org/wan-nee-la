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
 *   2. Deploy  refuse if the live Worker's vars differ from the config file,
 *              since a deploy overwrites them (ISSUES #40); then any
 *              migrations named with --migrate, applied to production D1
 *              first, then `npm run deploy`.
 *   3. Prod    the new version is the one serving, Access still fronts the
 *              hostname, production D1 answers a read, and API Shield still
 *              blocks every schema violation at the edge (`shield:probe`).
 *
 * The real config, `wrangler.local.jsonc`, is gitignored and lives only in the
 * main checkout. Run from a git worktree, this copies it in for the deploy and
 * removes it again afterwards, whatever happened.
 *
 * Usage:
 *   npm run ship
 *   npm run ship -- --migrate migrations/0011_leave_type_active.sql
 *   npm run ship -- --local-only        stage 1 alone
 *   npm run ship -- --check-drift       compare live vars with the config, nothing else
 *   npm run ship -- --accept-var-changes
 *                                       deploy even though vars differ — for a
 *                                       change made in the config on purpose
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
const FLAGS = ['--local-only', '--check-drift', '--accept-var-changes'];
const localOnly = args.includes('--local-only');
const checkDriftOnly = args.includes('--check-drift');
const acceptVarChanges = args.includes('--accept-var-changes');
const migrations = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--migrate') migrations.push(args[++i]);
	else if (!FLAGS.includes(args[i])) fail(`unknown argument: ${args[i]}`);
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

/** Copy the real config in from the main checkout if this checkout lacks it. */
function borrowConfig() {
	if (existsSync(CONFIG)) return;
	// The main checkout is always the first entry `git worktree list` prints.
	const main = capture('git', ['worktree', 'list', '--porcelain'], 'git worktree list').split('\n')[0].replace(/^worktree /, '');
	const source = join(main, CONFIG);
	if (!existsSync(source)) fail(`${CONFIG} is in neither this checkout nor the main one (${main})`);
	copyFileSync(source, CONFIG);
	console.log(`borrowed ${CONFIG} from the main checkout`);
	process.on('exit', () => rmSync(CONFIG, { force: true }));
	process.on('SIGINT', () => process.exit(130));
}

/** The version id taking all traffic right now. */
function servingVersion() {
	const deployments = JSON.parse(capture('npx', ['wrangler', 'deployments', 'list', '--json', '--config', CONFIG], 'wrangler deployments list'));
	const latest = deployments.at(-1) ?? deployments[0];
	return latest?.versions?.find((v) => v.percentage === 100)?.version_id;
}

/**
 * Plain-text vars the deploy would change on the live Worker.
 *
 * `wrangler deploy` replaces every var with the config file's and only warns,
 * so a value set on the Worker some other way — the dashboard, `wrangler
 * versions` — is silently lost. That is how the push keypair came apart in
 * September (ISSUES #40). Secrets are not compared: a deploy keeps them.
 *
 * Names only in what this prints, never values: the log is pasted into chats
 * and issues, and a var is a var only by convention.
 */
function varDrift(config) {
	const version = servingVersion();
	if (!version) fail('could not tell which version is serving, so the vars cannot be compared');
	const view = JSON.parse(capture('npx', ['wrangler', 'versions', 'view', version, '--json', '--config', CONFIG], 'wrangler versions view'));
	const live = new Map((view.resources?.bindings ?? []).filter((b) => b.type === 'plain_text').map((b) => [b.name, String(b.text ?? '')]));
	const want = new Map(Object.entries(config.vars ?? {}).map(([k, v]) => [k, String(v)]));
	const removed = [...live.keys()].filter((k) => !want.has(k));
	const changed = [...want.keys()].filter((k) => live.has(k) && live.get(k) !== want.get(k));
	const added = [...want.keys()].filter((k) => !live.has(k));
	return { version, removed, changed, added };
}

/** Report drift; true when the deploy may go ahead. */
function reportDrift({ version, removed, changed, added }) {
	console.log(`live version ${version}`);
	if (added.length) console.log(`  new in the config, added by this deploy: ${added.join(', ')}`);
	if (removed.length) console.log(`  set on the Worker but not in ${CONFIG} — this deploy would DELETE: ${removed.join(', ')}`);
	if (changed.length) console.log(`  different on the Worker — this deploy would OVERWRITE: ${changed.join(', ')}`);
	if (!removed.length && !changed.length) {
		console.log('✓ the config matches the live vars');
		return true;
	}
	return false;
}

if (checkDriftOnly) {
	stage('var drift');
	borrowConfig();
	const ok = reportDrift(varDrift(parseJsonc(readFileSync(CONFIG, 'utf8'))));
	process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// 1. Local
// ---------------------------------------------------------------------------

stage('1/3 local checks');

// The test scripts import .ts directly, which needs the Node in .nvmrc. An
// older one fails several commands in with "bad option: --experimental-strip-
// types", which reads like a broken test rather than a shell on the wrong node.
const want = Number(readFileSync('.nvmrc', 'utf8').trim().split('.')[0]);
const have = Number(process.versions.node.split('.')[0]);
if (have < want) fail(`Node ${have} is too old: .nvmrc asks for ${want}. Try \`nvm use\`.`);

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

borrowConfig();

const config = parseJsonc(readFileSync(CONFIG, 'utf8'));
const host = config.routes?.[0]?.pattern?.replace(/\/.*$/, '');
const dbName = config.d1_databases?.[0]?.database_name;
if (!host || !dbName) fail(`${CONFIG} names no route or no D1 database`);

// Before anything touches production, migrations included.
if (!reportDrift(varDrift(config))) {
	if (!acceptVarChanges) {
		fail(
			`the deploy would change vars on the live Worker. If the value on the Worker is the right one, put it in ${CONFIG}` +
				' (in the main checkout); if the config is right and the change is deliberate, re-run with -- --accept-var-changes',
		);
	}
	console.log('--accept-var-changes: deploying anyway');
}

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
const serving = servingVersion();
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

// The edge, which a deploy cannot change but a dashboard edit can — and on
// 2026-10-19 two edits in a row switched enforcement off without anything in
// the dashboard looking wrong. Anonymous and read-only; see the script.
console.log('\n$ npm run shield:probe');
const shield = spawnSync('node', ['scripts/shield-probe.mjs', '--host', host], { encoding: 'utf8' });
const verdict = (shield.stdout ?? '').trim().split('\n').filter((l) => /^[✓✗~-] /.test(l) || /^ {4}/.test(l));
if (shield.status === 0) ok('API Shield blocks every schema violation at the edge');
else {
	for (const line of verdict) console.log(`  ${line}`);
	bad('API Shield is not blocking every schema violation — run `npm run shield:probe` for the table');
}

if (problems > 0) fail(`${problems} production check(s) failed — version ${version} is live; roll back with \`npx wrangler rollback\` if it is at fault`);
console.log(`\n✓ shipped ${version}. Next: update the docs, then commit and push.`);
