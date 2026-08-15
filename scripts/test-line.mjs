#!/usr/bin/env node
// Unit tests for src/notify/line.ts — webhook signature verification, group-id
// extraction, and the digest text. No network: pushText is not exercised here.
// Run: npm run test:line
import { buildDigest, groupIdFromWebhook, timingSafeEqual, verifyLineSignature } from '../src/notify/line.ts';

let failures = 0;
const check = (name, cond, detail) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` -> ${detail}`}`);
	if (!cond) failures++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------------------------------
// timingSafeEqual
// ---------------------------------------------------------------------------------------

eq('timingSafeEqual: identical', timingSafeEqual('abc123', 'abc123'), true);
eq('timingSafeEqual: differing last char', timingSafeEqual('abc123', 'abc124'), false);
eq('timingSafeEqual: differing first char', timingSafeEqual('abc123', 'zbc123'), false);
eq('timingSafeEqual: different length', timingSafeEqual('abc', 'abcd'), false);
eq('timingSafeEqual: both empty', timingSafeEqual('', ''), true);

// ---------------------------------------------------------------------------------------
// verifyLineSignature — the guard on the one publicly reachable route.
// ---------------------------------------------------------------------------------------

const SECRET = 'test-channel-secret';
const BODY = JSON.stringify({ events: [{ type: 'message', source: { type: 'group', groupId: 'Cabc123' } }] });

async function sign(body, secret) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
	return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

const good = await sign(BODY, SECRET);

eq('signature: valid', await verifyLineSignature(BODY, good, SECRET), true);
eq('signature: wrong secret', await verifyLineSignature(BODY, good, 'other-secret'), false);
eq('signature: tampered body', await verifyLineSignature(`${BODY} `, good, SECRET), false);
eq('signature: empty signature', await verifyLineSignature(BODY, '', SECRET), false);
eq('signature: garbage signature', await verifyLineSignature(BODY, 'not-base64!!', SECRET), false);
// An unconfigured deployment must not accept everything.
eq('signature: empty secret rejects', await verifyLineSignature(BODY, good, ''), false);
// Re-serialising the parsed body changes key order/whitespace and must fail —
// this is why the route reads the raw bytes exactly once.
eq('signature: reserialised body', await verifyLineSignature(JSON.stringify(JSON.parse(BODY)) + '\n', good, SECRET), false);

// ---------------------------------------------------------------------------------------
// groupIdFromWebhook
// ---------------------------------------------------------------------------------------

eq('groupId: from a group message', groupIdFromWebhook(JSON.parse(BODY)), 'Cabc123');
eq(
	'groupId: from a join event',
	groupIdFromWebhook({ events: [{ type: 'join', source: { type: 'group', groupId: 'Cjoin1' } }] }),
	'Cjoin1',
);
eq(
	'groupId: 1:1 chat has none',
	groupIdFromWebhook({ events: [{ type: 'message', source: { type: 'user', userId: 'U1' } }] }),
	null,
);
eq(
	'groupId: room is not a group',
	groupIdFromWebhook({ events: [{ type: 'message', source: { type: 'room', roomId: 'R1' } }] }),
	null,
);
eq('groupId: empty events', groupIdFromWebhook({ events: [] }), null);
eq('groupId: no events key', groupIdFromWebhook({}), null);
eq('groupId: not an object', groupIdFromWebhook(null), null);
eq('groupId: events not an array', groupIdFromWebhook({ events: 'nope' }), null);
eq(
	'groupId: picks the group among mixed events',
	groupIdFromWebhook({
		events: [
			{ type: 'message', source: { type: 'user', userId: 'U1' } },
			{ type: 'message', source: { type: 'group', groupId: 'Cmixed' } },
		],
	}),
	'Cmixed',
);

// ---------------------------------------------------------------------------------------
// buildDigest
// ---------------------------------------------------------------------------------------

const entry = (over = {}) => ({
	id: 'e1',
	user_email: 'a@x.com',
	leave_type_id: 1,
	start_date: '2026-08-17',
	end_date: '2026-08-17',
	start_half: 'full',
	end_half: 'full',
	days_total: 1,
	note: null,
	status: 'confirmed',
	created_at: '',
	cancelled_at: null,
	display_name: 'Ann',
	type_code: 'annual',
	type_label_en: 'Annual',
	type_label_th: 'ลาพักร้อน',
	color: '#2563eb',
	...over,
});

const one = buildDigest('2026-08-17', [entry()]);
check('digest: names the date', one.includes('2026-08-17'), one);
check('digest: lists the person', one.includes('Ann'), one);
check('digest: names the leave type', one.includes('Annual'), one);
check('digest: singular wording', one.includes('1 person out.'), one);

const two = buildDigest('2026-08-17', [entry(), entry({ display_name: 'Bob' })]);
check('digest: plural wording', two.includes('2 people out.'), two);

// Half days have to be legible in the chat, or the message misleads about cover.
const am = buildDigest('2026-08-17', [entry({ start_half: 'am', end_half: 'am', days_total: 0.5 })]);
check('digest: morning-only marked', am.includes('(morning)'), am);
const pm = buildDigest('2026-08-17', [entry({ start_half: 'pm', end_half: 'pm', days_total: 0.5 })]);
check('digest: afternoon-only marked', pm.includes('(afternoon)'), pm);

// A multi-day booking shows its span, and its middle days read as full days.
const span = buildDigest('2026-08-18', [entry({ start_date: '2026-08-17', end_date: '2026-08-19', days_total: 3 })]);
check('digest: multi-day shows the range', span.includes('17 Aug') && span.includes('19 Aug'), span);
check('digest: middle day is not marked half', !span.includes('(morning)') && !span.includes('(afternoon)'), span);

// The last day of a range that ends at lunch is a morning on that day only.
const endsAm = buildDigest('2026-08-19', [
	entry({ start_date: '2026-08-17', end_date: '2026-08-19', end_half: 'am', days_total: 2.5 }),
]);
check('digest: range ending AM marks its last day', endsAm.includes('(morning)'), endsAm);

// LINE rejects anything past ~5000 characters, so a big day must not blow the limit.
const many = buildDigest('2026-08-17', Array.from({ length: 400 }, (_, i) => entry({ display_name: `Person ${i}` })));
check('digest: clamped below the LINE limit', many.length <= 4900, `length ${many.length}`);

console.log(failures === 0 ? '\nAll LINE tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
