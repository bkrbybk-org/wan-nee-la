/**
 * LINE Messaging API — the 08:00 Asia/Bangkok digest.
 *
 * LINE Notify was terminated on 2025-03-31, so the Messaging API push endpoint
 * is the only remaining way to post into a group. That has three consequences
 * the rest of this file exists to handle:
 *
 *  1. Pushing requires an Official Account whose bot has been invited to the
 *     group. The bot can only post to groups it belongs to.
 *  2. The group id is not visible anywhere in the LINE app. It arrives in a
 *     webhook event as `source.groupId`, which is why `/line/webhook` exists —
 *     capture it once, store it, done.
 *  3. Push is metered, and LINE bills a group push as one message *per member*.
 *     A 20-person group posted to daily is 600 messages a month, which will
 *     exceed a free allowance. The scheduled handler therefore skips days with
 *     nobody on leave rather than posting "nobody is out today".
 */

import { describeRange } from '../domain/dates.ts';
import type { LeaveEntry } from '../types.ts';

export const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

/** Longest a LINE text message may be. */
const TEXT_LIMIT = 4900;

/**
 * Compare two strings without leaking, through timing, how much of the prefix
 * matched. Relevant because the value being compared is an attacker-supplied
 * signature on a public endpoint.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	// Length is not secret — it is visible from the header itself.
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * Verify `X-Line-Signature`: base64(HMAC-SHA256(raw request body, channel secret)).
 *
 * The body must be the exact bytes LINE sent. Re-serialising a parsed object
 * changes key order and whitespace and the signature will never match.
 */
export async function verifyLineSignature(rawBody: string, signature: string, channelSecret: string): Promise<boolean> {
	if (!signature || !channelSecret) return false;
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(channelSecret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
	const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
	return timingSafeEqual(expected, signature);
}

/** The group id carried by a webhook event, if this event came from a group. */
export function groupIdFromWebhook(body: unknown): string | null {
	const events = (body as { events?: unknown })?.events;
	if (!Array.isArray(events)) return null;
	for (const event of events) {
		const source = (event as { source?: { type?: string; groupId?: string } })?.source;
		if (source?.type === 'group' && typeof source.groupId === 'string' && source.groupId) {
			return source.groupId;
		}
	}
	return null;
}

function halfSuffix(entry: LeaveEntry, date: string): string {
	// Which half of *this* day the booking covers — a range's middle days are
	// always full even when its ends are not.
	if (entry.start_date === entry.end_date) {
		return entry.start_half === 'am' ? ' (morning)' : entry.start_half === 'pm' ? ' (afternoon)' : '';
	}
	if (date === entry.start_date && entry.start_half === 'pm') return ' (afternoon)';
	if (date === entry.end_date && entry.end_half === 'am') return ' (morning)';
	return '';
}

/**
 * The message body.
 *
 * Plain text rather than a Flex bubble on purpose: a Flex payload is a second
 * thing that can be rejected for schema reasons at 08:00 with nobody watching,
 * and it costs exactly the same as text under LINE's per-member billing. A text
 * message either sends or it does not.
 */
export function buildDigest(date: string, entries: readonly LeaveEntry[]): string {
	const lines = [`🌴 ลาวันนี้ / On leave today — ${date}`, ''];

	for (const e of entries) {
		const multiDay = e.start_date !== e.end_date;
		const span = multiDay ? `  · ${describeRange(e.start_date, e.end_date, e.start_half, e.end_half)}` : '';
		lines.push(`• ${e.display_name} — ${e.type_label_en}${halfSuffix(e, date)}${span}`);
	}

	lines.push('', `${entries.length} ${entries.length === 1 ? 'person' : 'people'} out.`);

	const text = lines.join('\n');
	return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT - 1)}…` : text;
}

export type PushResult = { ok: true } | { ok: false; error: string };

/**
 * Push one text message to a group.
 *
 * `X-Line-Retry-Key` is LINE's own idempotency header: if the same key is
 * retried, LINE will not deliver a second copy. That is the outer guard against
 * a duplicate post; the inner one is the `notification_log` row the caller
 * claims before ever getting here.
 */
export async function pushText(
	channelAccessToken: string,
	groupId: string,
	text: string,
	retryKey: string,
): Promise<PushResult> {
	let res: Response;
	try {
		res = await fetch(LINE_PUSH_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${channelAccessToken}`,
				'Content-Type': 'application/json',
				'X-Line-Retry-Key': retryKey,
			},
			body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
		});
	} catch (err) {
		return { ok: false, error: `network: ${err instanceof Error ? err.message : String(err)}` };
	}

	if (res.ok) return { ok: true };

	// LINE puts the useful reason in the body, not the status line.
	let detail = '';
	try {
		detail = (await res.text()).slice(0, 300);
	} catch {
		detail = '(no body)';
	}
	return { ok: false, error: `HTTP ${res.status}: ${detail}` };
}
