#!/usr/bin/env node
// Unit tests for src/auth/access.ts — the parts that need no Access token:
// the development bypass, which must never work for a visitor from outside.
// Run: npm run test:auth
import { authenticate, isLoopback } from '../src/auth/access.ts';

let failures = 0;
const check = (name, cond, detail) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` -> ${detail}`}`);
	if (!cond) failures++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

for (const ip of ['::1', '127.0.0.1', '127.1.2.3', '::ffff:127.0.0.1']) eq(`loopback: ${ip}`, isLoopback(ip), true);
for (const ip of ['', '203.0.113.7', '10.0.0.1', '2001:db8::1', '127.0.0.1.example', '::ffff:10.0.0.1']) eq(`not loopback: ${ip || '(none)'}`, isLoopback(ip), false);

const bypass = { DEV_AUTH_BYPASS: '1', DEV_EMAIL: 'dev@example.com', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' };
// `wrangler dev` rewrites the URL to the configured route, so the hostname
// says nothing; the visitor's address does.
const req = (ip) => new Request('http://leave.example.com/', { headers: ip ? { 'CF-Connecting-IP': ip } : {} });
const local = await authenticate(req('::1'), bypass);
eq('bypass: signs in a caller on this machine', local.ok && local.identity.email, 'dev@example.com');
const remote = await authenticate(req('203.0.113.7'), bypass);
eq('bypass: refused for a visitor from outside', remote.ok, false);
check('bypass: and says why', !remote.ok && /not from this machine/.test(remote.reason), JSON.stringify(remote));
eq('bypass: refused with no address at all', (await authenticate(req(''), bypass)).ok, false);
const off = await authenticate(req('::1'), { ...bypass, DEV_AUTH_BYPASS: '0' });
check('without the bypass, no token is no session', !off.ok, JSON.stringify(off));

console.log(failures === 0 ? '\nAll auth tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
