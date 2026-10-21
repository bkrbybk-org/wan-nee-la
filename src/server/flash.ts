import { draftPayload, parseDraft, type BookingDraft } from '../domain/leave.ts';

/**
 * Post-redirect-get flash messages, carried in a short-lived cookie.
 *
 * These used to ride in the query string (`/me?ok=Booked 5 day(s)…`). Cloudflare's
 * managed "Block Attacks (WAF Attack Score)" rule blocked those redirects: free
 * prose in a query string — parentheses, colons, quotes — scores like an
 * injection probe, so a successful booking bounced the user into a WAF block
 * page. The message is UI state, not addressable content, so it does not belong
 * in the URL at all.
 *
 * Base64url keeps punctuation out of the header value too, so the cookie itself
 * cannot trip the same rule.
 */
const FLASH_COOKIE = 'wnl_flash';
const FLASH_MAX = 300;

/**
 * How long the base64url cookie value may grow before the note is dropped.
 *
 * Browsers cap a cookie at 4096 bytes covering the name, the value and the
 * attributes. The name and attributes here cost 62 bytes, so 3600 leaves a few
 * hundred spare — room for a future attribute, and cheaper than discovering the
 * limit as a cookie the browser silently refuses to store.
 *
 * For scale: a 300-character message beside a 500-character note encodes to
 * about 1200 characters in English and 3350 in Thai, so an ordinary note always
 * survives. What does not is a note of characters JSON has to escape — six bytes
 * each for control characters — which is the case the drop below exists for.
 */
const FLASH_VALUE_MAX = 3600;

const FLASH_ATTRS = 'Path=/; Max-Age=30; HttpOnly; Secure; SameSite=Lax';

/**
 * What a rejection carries back besides the sentence: which input was wrong,
 * and what was typed into the form. Both are optional and independent — a parse
 * failure knows the field but has no coherent booking to hand back.
 */
interface FlashExtra {
	field?: string;
	draft?: BookingDraft;
	/** The booking whose last change this message is offering to undo. */
	undo?: string;
}

export type Flash =
	| { kind: 'ok' | 'err'; message: string; field?: string; draft?: BookingDraft; undo?: string }
	| null;

function encodeFlash(payload: unknown): string {
	return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/**
 * `extra.field` names the input that was rejected; `extra.draft` is the booking
 * that was typed into the form, carried back so it can be handed over intact.
 * The field name is a couple of dozen bytes and always travels; the draft is
 * what has to fit in the room left over.
 */
function flashCookie(kind: 'ok' | 'err', message: string, extra?: FlashExtra): string {
	const base = {
		k: kind,
		m: message.slice(0, FLASH_MAX),
		...(extra?.field ? { f: extra.field } : {}),
		...(extra?.undo ? { u: extra.undo } : {}),
	};
	const draft = extra?.draft;
	let value = encodeFlash(draft ? { ...base, d: draftPayload(draft) } : base);

	// An oversized payload loses the note rather than the whole draft — losing
	// the draft would also lose the message explaining why the booking was
	// refused, which is the part that has to arrive. Dropping the note whole
	// beats truncating it too: a note that silently comes back half written is
	// worse than one the reader can see they have to type again.
	if (draft && value.length > FLASH_VALUE_MAX) {
		value = encodeFlash({ ...base, d: draftPayload({ ...draft, note: undefined }) });
	}

	// Max-Age is 30s: long enough to survive the redirect, short enough that a
	// stale message never reappears on a later visit.
	return `${FLASH_COOKIE}=${value}; ${FLASH_ATTRS}`;
}

export const FLASH_CLEAR = `${FLASH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** The booking this message offers to undo, if any. Only successes offer one. */
export function flashUndo(flash: Flash): string | undefined {
	return flash?.kind === 'ok' ? flash.undo : undefined;
}

/** The rejected booking to prefill a form with, if this flash carries one. */
export function flashDraft(flash: Flash): BookingDraft | undefined {
	return flash?.kind === 'err' ? flash.draft : undefined;
}

/** The message text when the flash is of this kind, else undefined. */
export function flashOf(flash: Flash, kind: 'ok' | 'err'): string | undefined {
	return flash && flash.kind === kind ? flash.message : undefined;
}

/**
 * The form field a rejected submission was about, so the booking form can mark
 * it rather than leaving the reader to work out which of five inputs the
 * sentence at the top of the page is complaining about. Only errors carry one.
 */
export function flashField(flash: Flash): string | undefined {
	return flash && flash.kind === 'err' ? flash.field : undefined;
}

export function readFlash(cookieHeader: string | undefined): Flash {
	if (!cookieHeader) return null;
	const m = new RegExp(`(?:^|;\\s*)${FLASH_COOKIE}=([^;]+)`).exec(cookieHeader);
	if (!m) return null;
	try {
		const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
		const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
		const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
			k?: string;
			m?: string;
			f?: string;
			d?: unknown;
			u?: string;
		};
		if ((parsed.k !== 'ok' && parsed.k !== 'err') || typeof parsed.m !== 'string') return null;
		// The cookie is ours, HttpOnly and short-lived, but it still arrives from
		// the client and the field name is compared against the form's own input
		// names. Anything that is not shaped like one of those is dropped rather
		// than trusted, so a hand-written cookie can at worst suppress the marker
		// it was trying to forge. The draft is re-validated by `parseDraft` for
		// the same reason, and neither failing costs more than the other: a lost
		// marker or a retype, never the message itself.
		const field = typeof parsed.f === 'string' && /^[A-Za-z]{1,32}$/.test(parsed.f) ? parsed.f : undefined;
		const draft = parsed.d === undefined ? null : parseDraft(parsed.d);
		// A booking id, and nothing else, so a hand-written cookie cannot turn the
		// undo button into a link at an arbitrary path. The route re-authorises
		// whatever arrives regardless — this only keeps the markup well formed.
		const undo = typeof parsed.u === 'string' && /^[0-9a-f-]{36}$/.test(parsed.u) ? parsed.u : undefined;
		return {
			kind: parsed.k,
			message: parsed.m.slice(0, FLASH_MAX),
			...(field ? { field } : {}),
			...(draft ? { draft } : {}),
			...(undo ? { undo } : {}),
		};
	} catch {
		// A malformed cookie is not worth an error page — just show no message.
		return null;
	}
}

/**
 * Redirect, carrying the message in the flash cookie.
 *
 * The query string is preserved. It used to be stripped because the message
 * itself travelled there; now that it does not, keeping the query is what lets
 * a redirect return to the month that was being viewed or the year being
 * edited.
 */
export function redirectWithFlash(path: string, kind: 'ok' | 'err', message: string, extra?: FlashExtra): Response {
	return new Response(null, {
		status: 303,
		headers: { Location: path, 'Set-Cookie': flashCookie(kind, message, extra) },
	});
}

