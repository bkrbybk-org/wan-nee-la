/**
 * Service worker — notifications only.
 *
 * Deliberately not a cache or an offline layer. Every page here is behind
 * Cloudflare Access and rendered per user; a cached one served to the wrong
 * person, or after their access was revoked, is a much worse bug than a page
 * that fails to load on a train.
 *
 * Hand-written and served as-is rather than bundled: it is loaded by the
 * browser as a top-level worker script, not imported by the page bundle.
 */

self.addEventListener('install', () => {
	// Take over as soon as this version lands, rather than waiting for every tab
	// to close first — otherwise a fix to this file can sit unused for weeks.
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
	// The message travels inside the encrypted payload. This worker cannot fetch
	// it from the server instead: it wakes with no page open, and a request to
	// an origin behind Access would come back as a login redirect.
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		data = {};
	}

	const title = data.title || 'wan-nee-la';
	event.waitUntil(
		self.registration.showNotification(title, {
			body: data.body || '',
			icon: '/icon-192.png',
			badge: '/badge.png',
			// One notification per digest: a second push for the same day replaces
			// the first instead of stacking a duplicate on the lock screen.
			tag: data.tag || 'wnl-digest',
			renotify: false,
			data: { url: data.url || '/' },
		}),
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data && event.notification.data.url) || '/';

	event.waitUntil(
		(async () => {
			const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			// Focus a tab that is already open rather than piling up windows.
			for (const client of clients) {
				if (new URL(client.url).origin === self.location.origin) {
					await client.focus();
					if ('navigate' in client) await client.navigate(url);
					return;
				}
			}
			await self.clients.openWindow(url);
		})(),
	);
});
