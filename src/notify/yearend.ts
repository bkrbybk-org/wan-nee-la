/**
 * The year-end reminder: in November, everyone with annual leave still
 * unbooked is told how much, in their own language.
 *
 * Unused days do not move into the next year in this app — there is no
 * carry-over (PLAN 5.7) — so the cheapest fix for leave lost in January is
 * saying so while there are still weeks to book it.
 *
 * Once a year. The claim is a `notification_runs` row keyed on the year's
 * 1 November rather than on the day it ran, so the first weekday's cron sends
 * it and every later one finds it taken — as does an admin's "Send now" in
 * October, which then is that year's reminder.
 */

import { t, toLang, type Lang } from '../i18n/strings.ts';
import { unusedLeave, type UnusedRow } from '../domain/report.ts';
import { formatDays } from '../domain/dates.ts';
import * as db from '../repo/db.ts';
import type { Env, LeaveType } from '../types.ts';
import { pushConfigured, vapidKeys } from './digest.ts';
import { sendPush } from './push.ts';

/** The leave type the reminder is about. Code, not id: the code never changes. */
export const YEAR_END_TYPE = 'annual';

/** The claim's date for a year's reminder. */
export function yearEndKey(year: number): string {
	return `${year}-11-01`;
}

/** "6 days of Annual leave left in 2026", "Book them before the year ends." */
export function yearEndNotice(row: Pick<UnusedRow, 'left'>, type: Pick<LeaveType, 'label_en' | 'label_th'>, year: number, lang: Lang) {
	return {
		title: t(lang, 'notice.yearEnd', {
			count: row.left,
			days: formatDays(row.left),
			type: lang === 'th' ? type.label_th : type.label_en,
			year,
		}),
		body: t(lang, 'notice.yearEndBody'),
		url: '/me',
		tag: `wnl-yearend-${year}`,
	};
}

/** This year's report: everyone's unbooked days of the reminder's type. */
export async function yearEndReport(env: Env, year: number) {
	const types = await db.listLeaveTypes(env.DB);
	const type = types.find((ty) => ty.code === YEAR_END_TYPE && ty.counts_quota) ?? null;
	if (!type) return { type: null, rows: [] as UnusedRow[] };
	const [users, quotas, used] = await Promise.all([db.listUsers(env.DB), db.listQuotasForYear(env.DB, year), db.usedByTypeForYear(env.DB, year)]);
	return { type, rows: unusedLeave(users, type, quotas, used) };
}

export type YearEndStatus = 'sent' | 'skipped_empty' | 'skipped_duplicate' | 'not_configured' | 'not_due' | 'failed';

/**
 * Send this year's reminder, once.
 *
 * `today` decides whether the cron should: November, and only then. `force`
 * is an admin's "Send now", which skips the month check but never the
 * once-a-year claim.
 */
export async function runYearEnd(env: Env, today: string, opts: { force?: boolean } = {}): Promise<{ status: YearEndStatus; people: number }> {
	const year = Number(today.slice(0, 4));
	if (!opts.force && today.slice(5, 7) !== '11') return { status: 'not_due', people: 0 };
	if (!pushConfigured(env)) return { status: 'not_configured', people: 0 };

	const { type, rows } = await yearEndReport(env, year);
	const owed = rows.filter((r) => r.left > 0);
	if (!(await db.claimNotification(env.DB, yearEndKey(year), 'yearend', 'push', owed.length))) {
		return { status: 'skipped_duplicate', people: 0 };
	}
	if (!type || owed.length === 0) {
		await db.finishNotification(env.DB, yearEndKey(year), 'yearend', 'push', 'skipped_empty');
		return { status: 'skipped_empty', people: 0 };
	}

	try {
		const [subs, users] = await Promise.all([db.activeSubscriptions(env.DB), db.listUsers(env.DB)]);
		const langOf = new Map(users.map((u) => [u.email, toLang(u.lang)]));
		let reached = 0;
		for (const row of owed) {
			const mine = subs.filter((s) => s.user_email === row.email);
			if (mine.length === 0) continue;
			const payload = JSON.stringify(yearEndNotice(row, type, year, langOf.get(row.email) ?? 'en'));
			const results = await Promise.all(mine.map((s) => sendPush(s, payload, vapidKeys(env))));
			await Promise.all(results.filter((r) => r.gone).map((r) => db.deleteSubscriptionByEndpoint(env.DB, r.endpoint)));
			if (results.some((r) => r.ok)) reached++;
		}
		await db.finishNotification(env.DB, yearEndKey(year), 'yearend', 'push', 'sent');
		await db.setNotificationPeople(env.DB, yearEndKey(year), 'yearend', 'push', reached);
		return { status: 'sent', people: reached };
	} catch (err) {
		await db.finishNotification(env.DB, yearEndKey(year), 'yearend', 'push', 'failed', err instanceof Error ? err.message : String(err));
		return { status: 'failed', people: 0 };
	}
}
