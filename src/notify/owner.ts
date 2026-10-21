/**
 * Telling a booking's owner that someone else changed it.
 *
 * An admin can book, edit, remove and restore anyone's leave. The booking's
 * own page records who did what, but the owner only sees that by opening it —
 * and a booking moved or removed without them knowing is the kind they find
 * out about on the Monday. So the owner's browsers get a push, in the owner's
 * own language. Nothing is sent when people change their own bookings.
 *
 * Best effort: no subscription, no keys, or a push service that refuses are
 * all silent. The change itself has already been saved.
 */

import { describeRange, type Half } from '../domain/dates.ts';
import { t, toLang, type Lang } from '../i18n/strings.ts';
import * as db from '../repo/db.ts';
import type { Env } from '../types.ts';
import { pushConfigured, vapidKeys } from './digest.ts';
import { sendPush } from './push.ts';

export type OwnerNoticeAction = 'created' | 'edited' | 'cancelled' | 'restored';

export interface OwnerNoticeInput {
	action: OwnerNoticeAction;
	actorName: string;
	leaveId: string;
	type: { label_en: string; label_th: string };
	start_date: string;
	end_date: string;
	start_half: Half;
	end_half: Half;
}

/**
 * The notification itself: "Pim changed your leave", "Annual · 3 – 6 Nov".
 * Tagged per booking, so a second change replaces the first on the lock
 * screen rather than stacking. A removed booking has no page to open, so it
 * opens My leave.
 */
export function ownerNotice(input: OwnerNoticeInput, lang: Lang): { title: string; body: string; url: string; tag: string } {
	const type = lang === 'th' ? input.type.label_th : input.type.label_en;
	return {
		title: t(lang, `notice.${input.action}`, { actor: input.actorName }),
		body: `${type} · ${describeRange(input.start_date, input.end_date, input.start_half, input.end_half, lang)}`,
		url: input.action === 'cancelled' ? '/me' : `/leave/${input.leaveId}/edit`,
		tag: `wnl-leave-${input.leaveId}`,
	};
}

/** True when the change was made by someone other than the booking's owner. */
export function shouldTellOwner(actorEmail: string, ownerEmail: string): boolean {
	return actorEmail !== ownerEmail;
}

/** Send `ownerNotice` to every browser the owner has subscribed. Never throws. */
export async function tellOwner(env: Env, ownerEmail: string, input: OwnerNoticeInput): Promise<void> {
	try {
		if (!pushConfigured(env)) return;
		const [owner, subs] = await Promise.all([db.getUser(env.DB, ownerEmail), db.subscriptionsFor(env.DB, ownerEmail)]);
		if (!owner || subs.length === 0) return;

		const payload = JSON.stringify(ownerNotice(input, toLang(owner.lang)));
		const results = await Promise.all(subs.map((s) => sendPush(s, payload, vapidKeys(env))));
		await Promise.all(results.filter((r) => r.gone).map((r) => db.deleteSubscriptionByEndpoint(env.DB, r.endpoint)));
		console.log(
			JSON.stringify({ event: 'owner-notified', action: input.action, leave: input.leaveId, delivered: results.filter((r) => r.ok).length, browsers: subs.length }),
		);
	} catch (err) {
		console.log(JSON.stringify({ event: 'owner-notify-failed', action: input.action, error: String(err) }));
	}
}
