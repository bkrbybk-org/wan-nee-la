/**
 * Cloudflare Access identity.
 *
 * Access sits in front of the custom hostname and stamps every request with a
 * signed JWT (`Cf-Access-Jwt-Assertion` header, `CF_Authorization` cookie). We
 * verify that JWT rather than trusting the header, because a header is only
 * trustworthy if nothing can reach the Worker except through Access — and that
 * assumption breaks the moment a `workers.dev` route, a second route, or a
 * misconfigured Access policy exists. Verification costs one cached JWKS fetch
 * and removes the need to be right about the network path.
 *
 * Checks performed: RS256 signature against the team's JWKS, `aud` contains the
 * application AUD tag, `exp` in the future, `iss` matches the team domain.
 */

import type { Env } from '../types.ts';

export interface Identity {
	email: string;
}

type Jwk = JsonWebKey & { kid: string };

/**
 * JWKS cache, per isolate. Access rotates signing keys, so this is a short TTL
 * rather than a permanent memo — a stale set would reject every request after a
 * rotation until the isolate recycled.
 */
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache: { url: string; fetchedAt: number; keys: Map<string, CryptoKey> } | null = null;

async function getKey(teamDomain: string, kid: string): Promise<CryptoKey | null> {
	const url = `https://${teamDomain}/cdn-cgi/access/certs`;
	const fresh = jwksCache && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;

	if (fresh && jwksCache!.keys.has(kid)) return jwksCache!.keys.get(kid)!;

	// Unknown kid, or expired cache: refetch. A rotation shows up as a kid we
	// have never seen, so an unknown kid is a reason to refetch, not to reject.
	const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
	if (!res.ok) return null;

	const body = (await res.json()) as { keys?: Jwk[] };
	const keys = new Map<string, CryptoKey>();
	for (const jwk of body.keys ?? []) {
		if (!jwk.kid) continue;
		try {
			keys.set(
				jwk.kid,
				await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
			);
		} catch {
			// A key we cannot import is a key we cannot verify with. Skip it
			// rather than failing the whole set.
		}
	}
	jwksCache = { url, fetchedAt: Date.now(), keys };
	return keys.get(kid) ?? null;
}

function b64urlToBytes(s: string): Uint8Array {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function decodeJson(part: string): Record<string, unknown> | null {
	try {
		return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function audMatches(aud: unknown, want: string): boolean {
	if (typeof aud === 'string') return aud === want;
	if (Array.isArray(aud)) return aud.includes(want);
	return false;
}

/** Verify an Access JWT. Returns the identity, or null for any failure. */
export async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<Identity | null> {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [rawHeader, rawPayload, rawSig] = parts;

	const header = decodeJson(rawHeader);
	const payload = decodeJson(rawPayload);
	if (!header || !payload) return null;

	if (header.alg !== 'RS256') return null; // never honour "none", never let the token pick its own algorithm
	if (typeof header.kid !== 'string') return null;

	const key = await getKey(teamDomain, header.kid);
	if (!key) return null;

	const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
	const sig = b64urlToBytes(rawSig);
	const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig as BufferSource, signed as BufferSource);
	if (!valid) return null;

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
	if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
	if (!audMatches(payload.aud, aud)) return null;
	if (payload.iss !== `https://${teamDomain}`) return null;

	const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
	if (!email) return null;

	return { email };
}

function readToken(req: Request): string | null {
	const header = req.headers.get('Cf-Access-Jwt-Assertion');
	if (header) return header;
	const cookie = req.headers.get('Cookie') ?? '';
	const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
	return match ? match[1] : null;
}

export type AuthResult = { ok: true; identity: Identity } | { ok: false; reason: string };

/**
 * Identity for the current request.
 *
 * `DEV_AUTH_BYPASS=1` skips verification entirely and logs in as `DEV_EMAIL`.
 * That is for `wrangler dev` only — set in production it hands every visitor a
 * session as that user. It is off by default in wrangler.jsonc and the value is
 * surfaced in /health so a production check can catch it being left on.
 */
export async function authenticate(req: Request, env: Env): Promise<AuthResult> {
	if (env.DEV_AUTH_BYPASS === '1') {
		const email = (env.DEV_EMAIL || 'dev@example.com').trim().toLowerCase();
		return { ok: true, identity: { email } };
	}

	if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
		// Fail closed. An unconfigured deployment must not serve leave data to
		// anyone who happens to find the hostname.
		return { ok: false, reason: 'Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD are unset).' };
	}

	const token = readToken(req);
	if (!token) return { ok: false, reason: 'No Cloudflare Access token on this request.' };

	const identity = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
	if (!identity) return { ok: false, reason: 'Access token failed verification.' };

	return { ok: true, identity };
}
