/**
 * Progressive enhancement for the booking form. The form posts and works
 * without any of this; the script only adds:
 *
 *   - a live "= N days" preview, computed by the server so it cannot disagree
 *     with what the booking is actually charged
 *   - hiding the end-half field while the booking is a single day, where it has
 *     no meaning
 *   - keeping the end date from falling behind the start date
 *
 * Built by `npm run build:client` into public/booking.js.
 */

const forms = document.querySelectorAll<HTMLFormElement>('[data-booking]');

for (const form of forms) enhance(form);

function enhance(form: HTMLFormElement) {
	const start = form.querySelector<HTMLInputElement>('[data-start]');
	const end = form.querySelector<HTMLInputElement>('[data-end]');
	const startHalf = form.querySelector<HTMLSelectElement>('[data-start-half]');
	const endHalf = form.querySelector<HTMLSelectElement>('[data-end-half]');
	const endHalfField = form.querySelector<HTMLElement>('[data-end-half-field]');
	const preview = form.querySelector<HTMLElement>('[data-preview]');
	const typeSel = form.querySelector<HTMLSelectElement>('select[name="leaveTypeId"]');
	if (!start || !end || !startHalf || !endHalf || !preview) return;

	const isSingleDay = () => !end.value || end.value === start.value;

	function syncFields() {
		const single = isSingleDay();

		// On a single day, the end half is the start half — showing a second
		// dropdown just invites the "AM start, PM end" combination the server
		// rejects.
		if (endHalfField) endHalfField.hidden = single;
		if (single) endHalf!.value = startHalf!.value;

		// Multi-day bookings cannot start in the morning only or end in the
		// afternoon only. Mirror that here so the option is never offered.
		for (const opt of Array.from(startHalf!.options)) {
			opt.hidden = !single && opt.value === 'am';
		}
		if (!single && startHalf!.value === 'am') startHalf!.value = 'full';

		// An end date before the start is always a mistake, never a shortcut.
		if (start!.value) end!.min = start!.value;
		if (end!.value && start!.value && end!.value < start!.value) end!.value = start!.value;
	}

	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function refresh() {
		syncFields();
		if (timer) clearTimeout(timer);
		// Debounced: a native date picker fires `change` per component on some
		// Android builds, and each keystroke in the typed fallback.
		timer = setTimeout(request, 150);
	}

	async function request() {
		if (!start!.value) {
			preview!.textContent = '';
			return;
		}
		const params = new URLSearchParams({
			leaveTypeId: typeSel?.value ?? '1',
			start: start!.value,
			end: end!.value || start!.value,
			startHalf: startHalf!.value,
			endHalf: isSingleDay() ? startHalf!.value : endHalf!.value,
		});

		// Responses can land out of order; only the newest one may paint.
		const mine = ++seq;
		try {
			const res = await fetch(`/api/leave/preview?${params}`, { headers: { Accept: 'application/json' } });
			if (mine !== seq) return;
			const body = (await res.json()) as { days?: number; error?: string };
			if (mine !== seq) return;

			if (typeof body.days === 'number') {
				preview!.textContent = `= ${body.days} day${body.days === 1 ? '' : 's'}`;
				preview!.classList.remove('bad');
			} else {
				preview!.textContent = body.error ?? '';
				preview!.classList.add('bad');
			}
		} catch {
			// Offline or the request failed. The preview is a nicety; the form
			// still submits and the server still decides.
			if (mine === seq) preview!.textContent = '';
		}
	}

	for (const el of [start, end, startHalf, endHalf]) {
		el.addEventListener('change', refresh);
		el.addEventListener('input', refresh);
	}
	typeSel?.addEventListener('change', refresh);

	refresh();
}
