/**
 * The daily digest job, shared by the 08:00 cron and the admin test button so
 * that what an admin previews is produced by exactly the code that posts at
 * 08:00 — a separate "test" path would drift and stop being a test.
 */

import { bangkokToday, isWeekend } from '../domain/dates.ts';
import * as db from '../repo/db.ts';
import type { NotifyChannel } from '../repo/db.ts';
import type { Env } from '../types.ts';
import { buildDigest, pushText } from './line.ts';
import { sendPush, type VapidKeys } from './push.ts';

export const GROUP_ID_KEY = 'line_group_id';

export type DigestStatus =
	| 'sent'
	| 'skipped_empty'
	| 'skipped_holiday'
	| 'skipped_weekend'
	| 'skipped_duplicate'
	| 'not_configured'
	| 'no_subscribers'
	| 'dry_run'
	| 'failed';

export interface ChannelOutcome {
	channel: NotifyChannel;
	status: DigestStatus;
	/** Browsers reached, for push. Always 1 for LINE, which posts to one group. */
	recipients?: number;
	error?: string;
}

export interface DigestOutcome {
	date: string;
	/** The overall verdict, rolled up from `channels` — see `rollUp`. */
	status: DigestStatus;
	people: number;
	text?: string;
	error?: string;
	channels: ChannelOutcome[];
}

/** The group to post to: captured by the webhook, or pinned in config. */
export async function resolveGroupId(env: Env): Promise<string | null> {
	return (await db.getConfig(env.DB, GROUP_ID_KEY)) ?? (env.LINE_GROUP_ID || null);
}

export function lineConfigured(env: Env): boolean {
	return Boolean(env.LINE_CHANNEL_ACCESS_TOKEN);
}

/** Both halves of the VAPID pair, or push cannot be signed. */
export function pushConfigured(env: Env): boolean {
	return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function vapidKeys(env: Env): VapidKeys {
	return {
		// The contact a push service can reach if this application starts
		// misbehaving. RFC 8292 wants a mailto: or https: URL.
		subject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
		publicKey: env.VAPID_PUBLIC_KEY,
		privateKey: env.VAPID_PRIVATE_KEY,
	};
}

/**
 * One verdict for the whole run.
 *
 * A send on any channel makes the run a send — the digest reached people. Only
 * when nothing was even attempted does the run report why, and 'not_configured'
 * is the answer only when that is true of every channel.
 */
function rollUp(channels: ChannelOutcome[]): { status: DigestStatus; error?: string } {
	if (channels.some((c) => c.status === 'sent')) return { status: 'sent' };
	const failed = channels.find((c) => c.status === 'failed');
	if (failed) return { status: 'failed', error: failed.error };
	const duplicate = channels.find((c) => c.status === 'skipped_duplicate');
	if (duplicate) return { status: 'skipped_duplicate' };
	// Nothing was sent and nothing failed. Report the most specific reason
	// available rather than flattening "nobody has subscribed" into "not
	// configured", which would send an admin looking for a missing secret.
	const specific = channels.find((c) => c.status !== 'not_configured');
	return { status: specific?.status ?? 'not_configured' };
}

/**
 * Post to the LINE group.
 *
 * Unchanged in substance from when it was the only channel: claim the date,
 * then send, so a crash cannot produce a second message in a company group.
 */
async function runLine(env: Env, date: string, text: string, people: number, force: boolean): Promise<ChannelOutcome> {
	const groupId = await resolveGroupId(env);
	if (!lineConfigured(env) || !groupId) return { channel: 'line', status: 'not_configured' };

	if (force) await db.clearNotification(env.DB, date, 'line');
	if (!(await db.claimNotification(env.DB, date, 'line', people))) {
		return { channel: 'line', status: 'skipped_duplicate' };
	}

	const res = await pushText(env.LINE_CHANNEL_ACCESS_TOKEN, groupId, text, `wnl-${date}`);
	if (!res.ok) {
		await db.finishNotification(env.DB, date, 'line', 'failed', res.error);
		return { channel: 'line', status: 'failed', error: res.error };
	}
	await db.finishNotification(env.DB, date, 'line', 'sent');
	return { channel: 'line', status: 'sent', recipients: 1 };
}

/**
 * Push to every subscribed browser.
 *
 * Unlike LINE, this fans out to many endpoints and some of them will be dead —
 * a browser profile that was wiped, a subscription the user revoked. Those come
 * back as 404 or 410 and the row is deleted; anything else may be transient and
 * is left in place to be retried tomorrow.
 *
 * The whole fan-out is one claim: a partial failure does not re-send to the
 * browsers that already got it.
 */
async function runPush(env: Env, date: string, text: string, people: number, force: boolean): Promise<ChannelOutcome> {
	if (!pushConfigured(env)) return { channel: 'push', status: 'not_configured' };

	const subs = await db.activeSubscriptions(env.DB);
	if (subs.length === 0) return { channel: 'push', status: 'no_subscribers', recipients: 0 };

	if (force) await db.clearNotification(env.DB, date, 'push');
	if (!(await db.claimNotification(env.DB, date, 'push', people))) {
		return { channel: 'push', status: 'skipped_duplicate' };
	}

	const payload = JSON.stringify({
		title: `Out today · ${people} ${people === 1 ? 'person' : 'people'}`,
		// The service worker cannot fetch this from behind Access when it wakes,
		// so the message travels inside the encrypted payload.
		body: text,
		url: '/',
		tag: `wnl-digest-${date}`,
	});

	const results = await Promise.all(subs.map((s) => sendPush(s, payload, vapidKeys(env))));

	const delivered = results.filter((r) => r.ok).length;
	await Promise.all([
		...results.filter((r) => r.gone).map((r) => db.deleteSubscriptionByEndpoint(env.DB, r.endpoint)),
		...results.filter((r) => r.ok).map((r) => db.markSubscriptionSeen(env.DB, r.endpoint)),
	]);

	if (delivered === 0) {
		const error = results.find((r) => r.error)?.error ?? 'no subscription accepted the push';
		await db.finishNotification(env.DB, date, 'push', 'failed', error);
		return { channel: 'push', status: 'failed', recipients: 0, error };
	}

	await db.finishNotification(env.DB, date, 'push', 'sent');
	return { channel: 'push', status: 'sent', recipients: delivered };
}

/**
 * Decide and (unless `dryRun`) send today's digest.
 *
 * `force` re-sends a date that already has a log row. It exists for the admin
 * "retry" path after a failure; the cron never sets it.
 */
export async function runDigest(
	env: Env,
	date: string = bangkokToday(),
	opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<DigestOutcome> {
	const [entries, holidays] = await Promise.all([
		db.listLeaveInRange(env.DB, date, date),
		db.holidaySet(env.DB, date, date),
	]);

	// Nothing is posted on days nobody works, and nothing is posted when nobody
	// is out. Both are silence rather than a "nobody is on leave" message. For
	// LINE that is also a cost decision — it bills a group push per member, see
	// notify/line.ts — but a browser notification that says nothing is just as
	// unwelcome, so the rule is the same for both channels.
	if (isWeekend(date)) return { date, status: 'skipped_weekend', people: 0, channels: [] };
	if (holidays.has(date)) return { date, status: 'skipped_holiday', people: 0, channels: [] };
	if (entries.length === 0) return { date, status: 'skipped_empty', people: 0, channels: [] };

	const text = buildDigest(date, entries);
	if (opts.dryRun) return { date, status: 'dry_run', people: entries.length, text, channels: [] };

	const people = entries.length;
	const force = Boolean(opts.force);

	// Sequential, not Promise.all: both channels write to notification_runs, and
	// D1 is happier with two small statements in a row than with a race for the
	// same page. Neither can throw — each returns its own outcome.
	const channels: ChannelOutcome[] = [
		await runLine(env, date, text, people, force),
		await runPush(env, date, text, people, force),
	];

	return { date, people, text, channels, ...rollUp(channels) };
}
