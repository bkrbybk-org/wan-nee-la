import { Hono } from 'hono';
import * as db from '../repo/db.ts';
import { pushConfigured, vapidKeys } from '../notify/digest.ts';
import { parseSubscription, sendPush } from '../notify/push.ts';
import { userOf, jsonError, type AppEnv } from '../server/common.tsx';
/*
 * Browser push: subscribing, unsubscribing and the test notification.
 */

const app = new Hono<AppEnv>();

/**
 * Register this browser for the 09:00 digest.
 *
 * The subscription is owned by whoever is signed in now. That matters on a
 * shared machine: the browser hands back the same endpoint after a different
 * person signs in, and `saveSubscription` reassigns it rather than leaving
 * someone else's name on it.
 */
app.post('/api/v1/push/subscribe', async (c) => {
	const user = userOf(c);
	const sub = parseSubscription(await c.req.json().catch(() => null));
	if (!sub) return jsonError(c, 'Not a usable push subscription.', 400);

	await db.saveSubscription(c.env.DB, sub, user.email);
	return c.json({ ok: true });
});

/**
 * Stop pushing to this browser.
 *
 * Scoped to the owner, so knowing someone else's endpoint — which is not
 * secret; it travels to the push service on every send — does not let you
 * silence their notifications.
 */
app.post('/api/v1/push/unsubscribe', async (c) => {
	const user = userOf(c);
	const body = (await c.req.json().catch(() => null)) as { endpoint?: unknown } | null;
	const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
	if (!endpoint) return jsonError(c, 'No endpoint.', 400);

	await db.deleteSubscription(c.env.DB, endpoint, user.email);
	// Deliberately 200 whether or not a row was deleted. The browser has already
	// unsubscribed locally by this point, so an error here would only invite it
	// to retry something that can never succeed.
	return c.json({ ok: true });
});

/**
 * Send a test notification to the caller's own browsers.
 *
 * Without this the only way to find out whether push works is to wait until
 * 09:00 the next working day, which is how a broken setup stays broken.
 */
app.post('/api/v1/push/test', async (c) => {
	const user = userOf(c);
	if (!pushConfigured(c.env)) return jsonError(c, 'Push is not configured on the server.', 503);

	const subs = await db.subscriptionsFor(c.env.DB, user.email);
	if (subs.length === 0) return jsonError(c, 'This browser is not subscribed yet.', 409);

	const payload = JSON.stringify({
		title: 'wan-nee-la',
		body: 'Test notification. The daily digest will look like this, at 09:00.',
		url: '/me',
		tag: 'wnl-test',
	});
	const results = await Promise.all(subs.map((s) => sendPush(s, payload, vapidKeys(c.env))));

	// Prune here too: a test is exactly when a stale subscription surfaces.
	await Promise.all(results.filter((r) => r.gone).map((r) => db.deleteSubscriptionByEndpoint(c.env.DB, r.endpoint)));

	const delivered = results.filter((r) => r.ok).length;
	if (delivered === 0) {
		return jsonError(c, results.find((r) => r.error)?.error ?? 'No browser accepted the push.', 502);
	}
	return c.json({ ok: true, delivered });
});

export default app;
