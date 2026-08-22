#!/usr/bin/env node
// Unit tests for src/notify/push.ts — Web Push payload encryption and VAPID.
//
// The encryption is checked against the complete worked example in RFC 8291 §5:
// same subscription keys, same auth secret, same salt, same ephemeral keypair,
// and the output must match the RFC's message byte for byte. That is the only
// way to be sure of this code without a browser on the other end — every step
// of the derivation is invisible until the very last byte is wrong.
//
// Run: npm run test:push
import { b64urlToBytes, bytesToB64url, encryptPayload, vapidAuthorization } from '../src/notify/push.ts';

let failures = 0;
const check = (name, cond, detail) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` -> ${detail}`}`);
	if (!cond) failures++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------------------

eq('b64url: round trip', bytesToB64url(b64urlToBytes('BTBZMqHH6r4Tts7J_aSIgg')), 'BTBZMqHH6r4Tts7J_aSIgg');
eq('b64url: decodes to the right length', b64urlToBytes('BTBZMqHH6r4Tts7J_aSIgg').length, 16);
eq('b64url: no padding on output', bytesToB64url(new Uint8Array([1, 2, 3, 4, 5])).includes('='), false);
eq('b64url: url alphabet only', /^[A-Za-z0-9_-]*$/.test(bytesToB64url(new Uint8Array([251, 255, 254]))), true);

// ---------------------------------------------------------------------------------------
// RFC 8291 §5 — "Push Message Encryption Example"
// ---------------------------------------------------------------------------------------

const RFC = {
	plaintext: 'When I grow up, I want to be a watermelon',
	auth: 'BTBZMqHH6r4Tts7J_aSIgg',
	uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
	uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
	asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
	asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
	body:
		'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
		'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
		'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

// Before trusting the vector, check it against itself. The RFC's message embeds
// the sender's public key at a fixed offset, so if this transcription had lost a
// character the two would disagree here rather than in an opaque ciphertext
// mismatch fifty lines later.
const expected = b64urlToBytes(RFC.body);
eq('RFC vector: header declares a 65-byte key id', expected[20], 65);
eq('RFC vector: record size is 4096', new DataView(expected.buffer).getUint32(16), 4096);
eq('RFC vector: embedded sender key matches the stated one', bytesToB64url(expected.slice(21, 86)), RFC.asPublic);

// The salt is the first 16 bytes of the message, and the ephemeral keypair is
// the RFC's rather than a fresh one — otherwise the output could never match.
const salt = expected.slice(0, 16);
const asPublicBytes = b64urlToBytes(RFC.asPublic);
const jwk = {
	kty: 'EC',
	crv: 'P-256',
	x: bytesToB64url(asPublicBytes.slice(1, 33)),
	y: bytesToB64url(asPublicBytes.slice(33, 65)),
	ext: true,
};
const keyPair = {
	privateKey: await crypto.subtle.importKey(
		'jwk',
		{ ...jwk, d: RFC.asPrivate },
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits'],
	),
	publicKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
};

const encrypted = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt, keyPair });
eq('RFC 8291 §5: encrypted message matches the spec byte for byte', bytesToB64url(encrypted), RFC.body);
eq('RFC 8291 §5: length matches', encrypted.length, expected.length);

// And the same call with a real random salt must NOT be deterministic — if it
// were, two messages would share a nonce under one key, which is the failure
// this whole construction exists to avoid.
const a = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth });
const b = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth });
check('fresh salt and keypair per message', bytesToB64url(a) !== bytesToB64url(b), 'two encryptions were identical');
eq('fresh message still carries a 65-byte key id', a[20], 65);

// ---------------------------------------------------------------------------------------
// VAPID (RFC 8292)
// ---------------------------------------------------------------------------------------

// A throwaway application key. The public half is exported raw, which is the
// format a browser's applicationServerKey and our own storage both use.
const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidPublic = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', vapidPair.publicKey)));
const vapidPrivate = bytesToB64url(
	b64urlToBytes((await crypto.subtle.exportKey('jwk', vapidPair.privateKey)).d),
);
const keys = { subject: 'mailto:ops@example.com', publicKey: vapidPublic, privateKey: vapidPrivate };

const NOW = Date.parse('2026-08-21T01:00:00Z');
const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', keys, NOW);

check('vapid: scheme and both parameters', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(header), header);
const [, token] = header.match(/t=([^,]+)/);
eq('vapid: k is the public key', header.endsWith(`k=${vapidPublic}`), true);

const [h64, c64, s64] = token.split('.');
const jwtHeader = JSON.parse(new TextDecoder().decode(b64urlToBytes(h64)));
const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(c64)));
eq('vapid: ES256', jwtHeader.alg, 'ES256');
eq('vapid: typ', jwtHeader.typ, 'JWT');
// aud is the push service's origin and nothing more — a token scoped to the
// whole endpoint URL would leak which subscription is being pushed.
eq('vapid: aud is the push service origin', claims.aud, 'https://fcm.googleapis.com');
eq('vapid: sub carries the contact', claims.sub, 'mailto:ops@example.com');
eq('vapid: expiry is 12h out', claims.exp - Math.floor(NOW / 1000), 12 * 60 * 60);
check('vapid: expiry is inside the 24h the spec allows', claims.exp - Math.floor(NOW / 1000) <= 86400, claims.exp);

// The signature has to verify against the public key we advertise in `k`, with
// the raw r‖s encoding JWS requires rather than DER.
const sigOk = await crypto.subtle.verify(
	{ name: 'ECDSA', hash: 'SHA-256' },
	vapidPair.publicKey,
	b64urlToBytes(s64),
	new TextEncoder().encode(`${h64}.${c64}`),
);
eq('vapid: signature verifies against the advertised key', sigOk, true);
eq('vapid: signature is raw r‖s, 64 bytes', b64urlToBytes(s64).length, 64);

const tampered = await crypto.subtle.verify(
	{ name: 'ECDSA', hash: 'SHA-256' },
	vapidPair.publicKey,
	b64urlToBytes(s64),
	new TextEncoder().encode(`${h64}.${c64}x`),
);
eq('vapid: a tampered token does not verify', tampered, false);

// A different endpoint must produce a different audience, not a reused token.
const other = await vapidAuthorization('https://updates.push.services.mozilla.com/wpush/v2/xyz', keys, NOW);
const otherClaims = JSON.parse(new TextDecoder().decode(b64urlToBytes(other.match(/t=([^.]+)\.([^.]+)/)[2])));
eq('vapid: audience follows the endpoint', otherClaims.aud, 'https://updates.push.services.mozilla.com');

console.log(failures === 0 ? '\nAll push tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
