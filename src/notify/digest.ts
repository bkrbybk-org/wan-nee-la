/**
 * The daily digest job, shared by the 08:00 cron and the admin test button so
 * that what an admin previews is produced by exactly the code that posts at
 * 08:00 — a separate "test" path would drift and stop being a test.
 */

import { bangkokToday, isWeekend } from '../domain/dates.ts';
import * as db from '../repo/db.ts';
import type { Env } from '../types.ts';
import { buildDigest, pushText } from './line.ts';

export const GROUP_ID_KEY = 'line_group_id';

export type DigestStatus =
	| 'sent'
	| 'skipped_empty'
	| 'skipped_holiday'
	| 'skipped_weekend'
	| 'skipped_duplicate'
	| 'not_configured'
	| 'dry_run'
	| 'failed';

export interface DigestOutcome {
	date: string;
	status: DigestStatus;
	people: number;
	text?: string;
	error?: string;
}

/** The group to post to: captured by the webhook, or pinned in config. */
export async function resolveGroupId(env: Env): Promise<string | null> {
	return (await db.getConfig(env.DB, GROUP_ID_KEY)) ?? (env.LINE_GROUP_ID || null);
}

export function lineConfigured(env: Env): boolean {
	return Boolean(env.LINE_CHANNEL_ACCESS_TOKEN);
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
	// is out. Both are silence rather than a "nobody is on leave" message,
	// because LINE bills a group push per member — see notify/line.ts.
	if (isWeekend(date)) return { date, status: 'skipped_weekend', people: 0 };
	if (holidays.has(date)) return { date, status: 'skipped_holiday', people: 0 };
	if (entries.length === 0) return { date, status: 'skipped_empty', people: 0 };

	const text = buildDigest(date, entries);
	if (opts.dryRun) return { date, status: 'dry_run', people: entries.length, text };

	const groupId = await resolveGroupId(env);
	if (!lineConfigured(env) || !groupId) {
		return { date, status: 'not_configured', people: entries.length, text };
	}

	if (opts.force) await db.clearNotification(env.DB, date);

	// Claim before sending. A crash between claim and push means no message
	// today, which is recoverable; the reverse ordering risks two messages in a
	// company group, which is not.
	const claimed = await db.claimNotification(env.DB, date, entries.length);
	if (!claimed) return { date, status: 'skipped_duplicate', people: entries.length, text };

	const res = await pushText(env.LINE_CHANNEL_ACCESS_TOKEN, groupId, text, `wnl-${date}`);
	if (!res.ok) {
		await db.finishNotification(env.DB, date, 'failed', res.error);
		return { date, status: 'failed', people: entries.length, text, error: res.error };
	}

	await db.finishNotification(env.DB, date, 'sent');
	return { date, status: 'sent', people: entries.length, text };
}
