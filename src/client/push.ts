/**
 * Browser notifications — subscribe, unsubscribe, test.
 *
 * The whole card is hidden until this runs, because the answer to "are
 * notifications on?" lives in this browser, not on the server. Rendering an
 * "off" button server-side and correcting it a moment later would be a worse
 * lie than showing nothing.
 *
 * Three states get their own message rather than one generic failure:
 *
 *   - the browser has no Push API at all (an iPhone in a Safari tab, mostly)
 *   - permission was denied, which no button can undo — only browser settings
 *   - subscribed here, or not
 */

const card = document.querySelector<HTMLElement>('[data-push-card]');

if (card) {
	const status = card.querySelector<HTMLElement>('[data-push-status]')!;
	const enableBtn = card.querySelector<HTMLButtonElement>('[data-push-enable]')!;
	const disableBtn = card.querySelector<HTMLButtonElement>('[data-push-disable]')!;
	const testBtn = card.querySelector<HTMLButtonElement>('[data-push-test]')!;
	const iosNote = card.querySelector<HTMLElement>('[data-push-ios]')!;
	const vapidKey = card.querySelector<HTMLElement>('[data-vapid-key]')?.getAttribute('data-vapid-key') ?? '';

	card.hidden = false;

	const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

	// iOS exposes the Push API only inside a web app installed to the Home
	// Screen. In a tab there is nothing to enable, so say what to do instead of
	// offering a button that cannot work.
	const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const standalone = window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as { standalone?: boolean }).standalone === true;

	function show(message: string) {
		status.textContent = message;
	}

	function buttons(state: { enable?: boolean; disable?: boolean; test?: boolean }) {
		enableBtn.hidden = !state.enable;
		disableBtn.hidden = !state.disable;
		testBtn.hidden = !state.test;
	}

	async function registration(): Promise<ServiceWorkerRegistration> {
		return navigator.serviceWorker.register('/sw.js');
	}

	async function paint() {
		if (!supported) {
			buttons({});
			if (iOS && !standalone) {
				iosNote.hidden = false;
				show('Not available in a Safari tab.');
			} else {
				show('This browser cannot show notifications.');
			}
			return;
		}

		if (Notification.permission === 'denied') {
			buttons({});
			show('Blocked. Notifications are switched off for this site in your browser settings.');
			return;
		}

		const sub = await (await registration()).pushManager.getSubscription();
		if (sub) {
			show('On for this browser.');
			buttons({ disable: true, test: true });
		} else {
			show('Off for this browser.');
			buttons({ enable: true });
		}
	}

	/** base64url, as the server stores it, to the bytes `subscribe` wants. */
	function keyBytes(base64url: string): Uint8Array {
		const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
		const raw = atob(b64);
		const out = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
		return out;
	}

	async function post(path: string, body?: unknown): Promise<{ ok: boolean; error?: string; delivered?: number }> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: body === undefined ? '{}' : JSON.stringify(body),
			// Access's cookie, and the CSRF check's Origin header, both need this
			// to be a same-origin credentialed request.
			credentials: 'same-origin',
		});
		return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
	}

	enableBtn.addEventListener('click', async () => {
		enableBtn.disabled = true;
		show('Asking for permission…');
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				await paint();
				return;
			}

			const reg = await registration();
			// An existing subscription is reused rather than replaced: the browser
			// refuses a second subscribe with a different key anyway.
			const sub =
				(await reg.pushManager.getSubscription()) ??
				(await reg.pushManager.subscribe({
					// Required by every browser now — a push without a payload the
					// user agent can attribute is refused.
					userVisibleOnly: true,
					applicationServerKey: keyBytes(vapidKey) as BufferSource,
				}));

			const saved = await post('/api/push/subscribe', sub.toJSON());
			if (!saved.ok) {
				// Do not leave a live subscription the server has no record of —
				// it would be a notification nobody can ever turn off.
				await sub.unsubscribe();
				show(saved.error ?? 'The server would not accept this subscription.');
				buttons({ enable: true });
				return;
			}
			await paint();
		} catch (err) {
			show(err instanceof Error ? err.message : 'Could not turn notifications on.');
			buttons({ enable: true });
		} finally {
			enableBtn.disabled = false;
		}
	});

	disableBtn.addEventListener('click', async () => {
		disableBtn.disabled = true;
		try {
			const sub = await (await registration()).pushManager.getSubscription();
			if (sub) {
				// Locally first. If the network call fails the browser is already
				// unsubscribed, and the server's row is pruned on the next push when
				// the endpoint answers 410.
				const endpoint = sub.endpoint;
				await sub.unsubscribe();
				await post('/api/push/unsubscribe', { endpoint });
			}
			await paint();
		} finally {
			disableBtn.disabled = false;
		}
	});

	testBtn.addEventListener('click', async () => {
		testBtn.disabled = true;
		show('Sending…');
		const res = await post('/api/push/test');
		show(res.ok ? 'Sent. It should appear in a moment.' : (res.error ?? 'Could not send a test.'));
		testBtn.disabled = false;
	});

	void paint();
}
