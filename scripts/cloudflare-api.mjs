/**
 * The two Cloudflare API calls the Shield scripts share: one authenticated
 * request, and finding the zone a hostname lives in. shield:upload writes with
 * them; shield:check only reads.
 */

const API = 'https://api.cloudflare.com/client/v4';

/** One API call. Throws with Cloudflare's own error codes when it refuses. */
export async function cfApi(token, path, init = {}) {
	const res = await fetch(API + path, {
		...init,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.success === false) {
		const why = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
		throw new Error(`${init.method ?? 'GET'} ${path} failed: ${why}`);
	}
	return body.result;
}

/** The zone whose name is the longest suffix of the hostname — api.x.example.com lives in example.com. */
export async function findZoneId(token, host, given) {
	if (given) return given;
	const parts = host.split('.');
	for (let i = 0; i < parts.length - 1; i++) {
		const candidate = parts.slice(i).join('.');
		const zones = await cfApi(token, `/zones?name=${encodeURIComponent(candidate)}`);
		if (zones.length > 0) return zones[0].id;
	}
	throw new Error(`no zone found for ${host}. Pass --zone <id>.`);
}
