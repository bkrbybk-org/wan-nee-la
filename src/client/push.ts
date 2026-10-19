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
const bell = document.querySelector<HTMLButtonElement>('[data-push-bell]');

if (card && bell) {
	const status = card.querySelector<HTMLElement>('[data-push-status]')!;
	const enableBtn = card.querySelector<HTMLButtonElement>('[data-push-enable]')!;
	const disableBtn = card.querySelector<HTMLButtonElement>('[data-push-disable]')!;
	const testBtn = card.querySelector<HTMLButtonElement>('[data-push-test]')!;
	const iosNote = card.querySelector<HTMLElement>('[data-push-ios]')!;
	const vapidKey = card.querySelector<HTMLElement>('[data-vapid-key]')?.getAttribute('data-vapid-key') ?? '';

	/**
	 * Wording, rendered by the server in the reader's language.
	 *
	 * English is kept here as a fallback rather than as the source: if the
	 * attribute is ever missing or malformed the card still says something
	 * truthful instead of going blank.
	 */
	const S: Record<string, string> = {
		title: 'Browser notifications',
		on: 'On for this browser.',
		off: 'Off for this browser.',
		blocked: 'Blocked. Notifications are switched off for this site in your browser settings.',
		unsupported: 'This browser cannot show notifications.',
		tabOnly: 'Not available in a Safari tab.',
		asking: 'Asking for permission…',
		sending: 'Sending…',
		sent: 'Sent. It should appear in a moment.',
		failed: 'Could not send a test.',
		refused: 'The server would not accept this subscription.',
		enableFailed: 'Could not turn notifications on.',
		...(() => {
			try {
				return JSON.parse(card.getAttribute('data-push-strings') ?? '{}') as Record<string, string>;
			} catch {
				return {};
			}
		})(),
	};

	// Only now, with a script to make its buttons work, is the bell worth showing.
	bell.hidden = false;

	/**
	 * Which bell the header shows, and what it says when hovered or read aloud.
	 * The icon carries the state at a glance — ringing when on, plain when off,
	 * struck through when this browser cannot or will not — so someone can tell
	 * without opening the panel.
	 */
	function mark(state: 'on' | 'off' | 'blocked', message: string) {
		bell!.dataset.pushState = state;
		const label = `${S.title}: ${message}`;
		bell!.title = label;
		bell!.setAttribute('aria-label', label);
	}

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

	// The invitation on the calendar (layout.tsx, PushNudge). "Not now" holds
	// for 30 days, in this browser only — it is a per-device question anyway.
	const nudgeEl = document.querySelector<HTMLElement>('[data-push-nudge]');
	const NUDGE_LATER = 'wnl-push-nudge-later';
	const NUDGE_QUIET_MS = 30 * 24 * 60 * 60 * 1000;

	function nudgeSnoozed(): boolean {
		try {
			const at = Number(localStorage.getItem(NUDGE_LATER));
			return at > 0 && Date.now() - at < NUDGE_QUIET_MS;
		} catch {
			return false;
		}
	}

	/** Show the invitation as a one-tap "Turn on", as install steps, or not at all. */
	function nudge(kind: 'enable' | 'ios' | null) {
		if (!nudgeEl) return;
		if (kind === null || nudgeSnoozed()) {
			nudgeEl.hidden = true;
			return;
		}
		const text = nudgeEl.querySelector<HTMLElement>('[data-push-nudge-text]')!;
		if (kind === 'ios') text.textContent = text.dataset.iosText ?? text.textContent;
		nudgeEl.querySelector<HTMLElement>('[data-push-nudge-on]')!.hidden = kind !== 'enable';
		nudgeEl.querySelector<HTMLElement>('[data-push-nudge-how]')!.hidden = kind !== 'ios';
		nudgeEl.hidden = false;
	}

	if (nudgeEl) {
		// The panel's own button does the work, so there is one path to
		// subscribing. Clicking it from inside this click keeps the user
		// gesture the permission prompt needs.
		nudgeEl.querySelector('[data-push-nudge-on]')!.addEventListener('click', () => enableBtn.click());
		nudgeEl.querySelector('[data-push-nudge-later]')!.addEventListener('click', () => {
			try {
				localStorage.setItem(NUDGE_LATER, String(Date.now()));
			} catch {
				// Storage blocked: it still goes away for this page view.
			}
			nudgeEl.hidden = true;
		});
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
				show(S.tabOnly);
				mark('blocked', S.tabOnly);
				nudge('ios');
			} else {
				show(S.unsupported);
				mark('blocked', S.unsupported);
				nudge(null);
			}
			return;
		}

		if (Notification.permission === 'denied') {
			buttons({});
			show(S.blocked);
			mark('blocked', S.blocked);
			nudge(null);
			return;
		}

		const reg = await registration();
		let sub = await reg.pushManager.getSubscription();

		// A subscription is bound to the public key it was made with. After the
		// deployment's keypair changes, this browser still holds one made with the
		// old key: every push to it is refused, yet it would read as "on" here
		// and "Turn on" would reuse it. Move it to the current key — silently
		// when permission is already granted, since the reader asked for this
		// once and should not have to notice a key rotation.
		if (sub && !madeWithCurrentKey(sub)) {
			const stale = sub.endpoint;
			await sub.unsubscribe();
			await post('/api/v1/push/unsubscribe', { endpoint: stale });
			sub = null;
			if (Notification.permission === 'granted') {
				const fresh = await reg.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: keyBytes(vapidKey) as BufferSource,
				});
				if ((await post('/api/v1/push/subscribe', fresh.toJSON())).ok) sub = fresh;
				else await fresh.unsubscribe();
			}
		}

		if (sub) {
			show(S.on);
			mark('on', S.on);
			buttons({ disable: true, test: true });
			nudge(null);
		} else {
			show(S.off);
			mark('off', S.off);
			buttons({ enable: true });
			// Only a browser never asked. "granted" with no subscription means
			// someone turned it off here on purpose; that is not to be nagged.
			nudge(Notification.permission === 'default' ? 'enable' : null);
		}
	}

	/**
	 * Whether this browser's subscription was made with the key the server now
	 * signs with. A browser that does not report the key is given the benefit of
	 * the doubt: re-subscribing it on every visit would be worse than a stale one.
	 */
	function madeWithCurrentKey(sub: PushSubscription): boolean {
		const held = sub.options?.applicationServerKey;
		if (!held) return true;
		const a = new Uint8Array(held);
		const b = keyBytes(vapidKey);
		return a.length === b.length && a.every((v, i) => v === b[i]);
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
		// Success and failure are told apart by the status, not by a field in the
		// body: every JSON failure in this app is `{ error: { message } }`, and a
		// response that is not JSON at all — Access's login page, say — must not
		// read as success either.
		const parsed = (await res.json().catch(() => null)) as { error?: { message?: string }; delivered?: number } | null;
		if (!res.ok) return { ok: false, error: parsed?.error?.message ?? `HTTP ${res.status}` };
		return { ok: true, delivered: parsed?.delivered };
	}

	enableBtn.addEventListener('click', async () => {
		enableBtn.disabled = true;
		show(S.asking);
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

			const saved = await post('/api/v1/push/subscribe', sub.toJSON());
			if (!saved.ok) {
				// Do not leave a live subscription the server has no record of —
				// it would be a notification nobody can ever turn off.
				await sub.unsubscribe();
				show(saved.error ?? S.refused);
				buttons({ enable: true });
				return;
			}
			await paint();
		} catch (err) {
			show(err instanceof Error ? err.message : S.enableFailed);
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
				await post('/api/v1/push/unsubscribe', { endpoint });
			}
			await paint();
		} finally {
			disableBtn.disabled = false;
		}
	});

	testBtn.addEventListener('click', async () => {
		testBtn.disabled = true;
		show(S.sending);
		const res = await post('/api/v1/push/test');
		show(res.ok ? S.sent : (res.error ?? S.failed));
		testBtn.disabled = false;
	});

	void paint();
}
