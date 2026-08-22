/**
 * Web Push — VAPID (RFC 8292) and `aes128gcm` payload encryption (RFC 8291).
 *
 * Written out rather than pulled from npm. Every primitive this needs is in
 * WebCrypto, which the Workers runtime implements in full, and the alternative
 * is handing our VAPID private key to a dependency. RFC 8291 §5 publishes a
 * complete worked example, so this is checked against the spec's own numbers
 * in scripts/test-push.mjs rather than against my reading of the spec.
 *
 * The shape of a push, end to end:
 *
 *   1. The browser hands us an endpoint URL plus two keys — `p256dh` (the
 *      user agent's public key) and `auth` (a shared secret).
 *   2. We generate a throwaway ECDH keypair, agree a secret with `p256dh`,
 *      and derive a content key and nonce from it (§3 below).
 *   3. The message is encrypted to that key. The push service — Google,
 *      Mozilla, Apple — forwards bytes it cannot read.
 *   4. A VAPID JWT, signed with our own long-lived key, tells the push
 *      service who is asking. That key identifies the application, not the
 *      user; it never encrypts anything.
 */

/** What the browser's PushSubscription gives us, as stored in D1. */
export interface PushSubscription {
	endpoint: string;
	p256dh: string;
	auth: string;
}

export interface PushResult {
	endpoint: string;
	ok: boolean;
	/** The subscription is dead and should be deleted — 404 or 410 from the push service. */
	gone: boolean;
	status?: number;
	error?: string;
}

export interface VapidKeys {
	subject: string;
	publicKey: string;
	privateKey: string;
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

export function b64urlToBytes(s: string): Uint8Array {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export function bytesToB64url(b: Uint8Array): string {
	let bin = '';
	for (const byte of b) bin += String.fromCharCode(byte);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/**
 * Validate what a browser posted to /api/push/subscribe.
 *
 * The shape comes from `PushSubscription.toJSON()`, but it arrives over the
 * network and lands in a table the cron later reads and sends to. Two rules
 * matter beyond the obvious: the endpoint must be an https URL, because it is
 * fetched later and a `file:` or `http:` endpoint is either an attack or a
 * mistake; and the keys must be exactly the sizes P-256 and RFC 8291 define,
 * since a wrong-sized key fails deep inside WebCrypto at 08:00 rather than here.
 */
export function parseSubscription(input: unknown): PushSubscription | null {
	if (!input || typeof input !== 'object') return null;
	const body = input as Record<string, unknown>;
	const keys = (body.keys ?? {}) as Record<string, unknown>;

	const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
	const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
	const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';
	if (!endpoint || !p256dh || !auth) return null;

	// Endpoints are long, but not unbounded — a megabyte of "endpoint" is not a
	// subscription.
	if (endpoint.length > 2048) return null;
	try {
		if (new URL(endpoint).protocol !== 'https:') return null;
	} catch {
		return null;
	}

	if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return null;
	try {
		const pub = b64urlToBytes(p256dh);
		// 65 bytes, uncompressed point marker first.
		if (pub.length !== 65 || pub[0] !== 4) return null;
		if (b64urlToBytes(auth).length !== 16) return null;
	} catch {
		return null;
	}

	return { endpoint, p256dh, auth };
}

// ---------------------------------------------------------------------------
// Payload encryption (RFC 8291)
// ---------------------------------------------------------------------------

/** One HKDF extract-and-expand. WebCrypto does both halves in a single call. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
		key,
		bytes * 8,
	);
	return new Uint8Array(bits);
}

/**
 * Encrypt one message for one subscription.
 *
 * `salt` and `keyPair` exist only so the RFC's example can be reproduced
 * exactly; in production both are fresh per message, which is what makes the
 * nonce safe to derive deterministically.
 */
export async function encryptPayload(
	plaintext: string | Uint8Array,
	sub: Pick<PushSubscription, 'p256dh' | 'auth'>,
	opts: { salt?: Uint8Array; keyPair?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
	const uaPublicBytes = b64urlToBytes(sub.p256dh);
	const authSecret = b64urlToBytes(sub.auth);

	// The workers-types overloads for generateKey/exportKey/deriveBits return
	// unions that TypeScript cannot narrow here, and name the ECDH peer key
	// `$public` where the runtime reads `public`. The casts are about those
	// declarations, not about the values, which are exactly what they look like.
	const keyPair = (opts.keyPair ??
		(await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))) as CryptoKeyPair;
	const asPublicBytes = new Uint8Array((await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer);

	const uaPublicKey = await crypto.subtle.importKey(
		'raw',
		uaPublicBytes as BufferSource,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'ECDH', public: uaPublicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
			keyPair.privateKey,
			256,
		),
	);

	// §3.4. The auth secret salts this first derivation, which is what binds the
	// message to this subscription and not merely to this public key.
	const keyInfo = concat(utf8('WebPush: info'), new Uint8Array([0]), uaPublicBytes, asPublicBytes);
	const ikm = await hkdf(authSecret, shared, keyInfo, 32);

	const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
	const cek = await hkdf(salt, ikm, concat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
	const nonce = await hkdf(salt, ikm, concat(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 12);

	// RFC 8188 pads each record with a delimiter octet; 0x02 marks the last one,
	// and this is always a single-record message.
	const body = typeof plaintext === 'string' ? utf8(plaintext) : plaintext;
	const padded = concat(body, new Uint8Array([2]));

	const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 }, aesKey, padded as BufferSource),
	);

	// Header: salt(16) ‖ record size(4) ‖ key id length(1) ‖ key id(65).
	const recordSize = new Uint8Array(4);
	new DataView(recordSize.buffer).setUint32(0, 4096);
	return concat(salt, recordSize, new Uint8Array([asPublicBytes.length]), asPublicBytes, ciphertext);
}

// ---------------------------------------------------------------------------
// VAPID (RFC 8292)
// ---------------------------------------------------------------------------

/**
 * Import a VAPID private key for signing.
 *
 * The conventional storage format — what every generator emits — is the raw
 * 32-byte scalar, base64url. WebCrypto will not take that directly, so it is
 * reassembled into a JWK alongside the public point.
 */
async function importVapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
	const pub = b64urlToBytes(publicKey);
	if (pub.length !== 65 || pub[0] !== 4) {
		throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point');
	}
	const d = b64urlToBytes(privateKey);
	if (d.length !== 32) throw new Error('VAPID private key must be 32 bytes');

	return crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			x: bytesToB64url(pub.slice(1, 33)),
			y: bytesToB64url(pub.slice(33, 65)),
			d: bytesToB64url(d),
			ext: true,
		},
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign'],
	);
}

/** Twelve hours. The spec caps this at 24; shorter limits the reuse window. */
const VAPID_TTL_SECONDS = 12 * 60 * 60;

/**
 * The `Authorization` header for one push.
 *
 * The token is bound to the push service's origin (`aud`), so it cannot be
 * lifted from one service's logs and replayed against another.
 */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowMs: number = Date.now()): Promise<string> {
	const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const claims = bytesToB64url(
		utf8(
			JSON.stringify({
				aud: new URL(endpoint).origin,
				exp: Math.floor(nowMs / 1000) + VAPID_TTL_SECONDS,
				sub: keys.subject,
			}),
		),
	);
	const signingInput = utf8(`${header}.${claims}`);

	const key = await importVapidKey(keys.publicKey, keys.privateKey);
	// WebCrypto's ECDSA output is already the raw r‖s pair JWS wants — no DER
	// unwrapping, which is where hand-rolled JWT signing usually goes wrong.
	const sig = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput as BufferSource),
	);

	return `vapid t=${header}.${claims}.${bytesToB64url(sig)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Deliver one message.
 *
 * Never throws: a fan-out to a dozen browsers must not be stopped by one dead
 * endpoint, and the caller needs every result to know which subscriptions to
 * prune. 404 and 410 are the push services' way of saying the subscription is
 * gone for good — anything else may be transient and is left alone.
 */
export async function sendPush(
	sub: PushSubscription,
	payload: string,
	keys: VapidKeys,
	opts: { ttlSeconds?: number } = {},
): Promise<PushResult> {
	try {
		const body = await encryptPayload(payload, sub);
		const res = await fetch(sub.endpoint, {
			method: 'POST',
			headers: {
				Authorization: await vapidAuthorization(sub.endpoint, keys),
				'Content-Encoding': 'aes128gcm',
				'Content-Type': 'application/octet-stream',
				// Held by the push service for this long if the device is offline.
				// A day's digest is worthless tomorrow, so it expires the same day.
				TTL: String(opts.ttlSeconds ?? 8 * 60 * 60),
				Urgency: 'normal',
			},
			body: body as BodyInit,
		});

		if (res.ok) return { endpoint: sub.endpoint, ok: true, gone: false, status: res.status };

		const detail = (await res.text().catch(() => '')).slice(0, 200);
		return {
			endpoint: sub.endpoint,
			ok: false,
			gone: res.status === 404 || res.status === 410,
			status: res.status,
			error: `${res.status} ${detail}`.trim(),
		};
	} catch (err) {
		return {
			endpoint: sub.endpoint,
			ok: false,
			gone: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
