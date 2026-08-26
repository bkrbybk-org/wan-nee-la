/**
 * Progressive enhancement for the booking form. The form posts and works
 * without any of this; the script only adds:
 *
 *   - a live "= N days" preview, computed by the server so it cannot disagree
 *     with what the booking is actually charged
 *   - hiding the end-half field while the booking is a single day, where it has
 *     no meaning
 *   - keeping the end date from falling behind the start date
 *   - a note of who else is already away on those days
 *
 * Built by `npm run build:client` into public/booking.js.
 */

interface Coverage {
	date: string;
	out: number;
	headcount: number;
	busy: boolean;
	names: string[];
	more: number;
}

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
	const coverage = form.querySelector<HTMLElement>('[data-coverage]');
	// Set when editing, so the booking being changed is not counted as somebody
	// else already away on those days.
	const excludeId = form.getAttribute('data-editing') ?? '';

	/** Wording from the server, in the reader's language; English if it is missing. */
	const S = {
		days: '= {days} day|= {days} days',
		coverage: '{out} of {headcount} away on {date}: {names}.',
		coverageMore: '{names} and {more} more',
		...(() => {
			try {
				return JSON.parse(form.getAttribute('data-booking-strings') ?? '{}') as Record<string, string>;
			} catch {
				return {};
			}
		})(),
	};

	const fill = (template: string, vars: Record<string, string | number>, count?: number) => {
		// Same convention the string catalogue uses: "singular|plural", chosen by
		// count. Languages without a plural form carry one side only.
		const text = template.includes('|')
			? (count === 1 ? template.split('|')[0] : template.split('|')[1])
			: template;
		return Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), text);
	};
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
		if (excludeId) params.set('exclude', excludeId);

		// Responses can land out of order; only the newest one may paint.
		const mine = ++seq;
		try {
			const res = await fetch(`/api/leave/preview?${params}`, { headers: { Accept: 'application/json' } });
			if (mine !== seq) return;
			const body = (await res.json()) as { days?: number; error?: string; coverage?: Coverage | null };
			if (mine !== seq) return;

			if (typeof body.days === 'number') {
				preview!.textContent = fill(S.days, { days: body.days }, body.days);
				preview!.classList.remove('bad');
			} else {
				preview!.textContent = body.error ?? '';
				preview!.classList.add('bad');
			}
			paintCoverage(body.coverage ?? null);
		} catch {
			// Offline or the request failed. The preview is a nicety; the form
			// still submits and the server still decides.
			if (mine === seq) {
				preview!.textContent = '';
				paintCoverage(null);
			}
		}
	}

	/**
	 * Who else is away on the busiest day of the range.
	 *
	 * Never blocks and never nags: below the threshold it states the fact
	 * plainly, above it the same line is marked as a warning. Deciding whether
	 * three people out on one Tuesday is a problem needs to know who covers for
	 * whom, which this app does not.
	 */
	function paintCoverage(data: Coverage | null) {
		if (!coverage) return;
		if (!data) {
			coverage.textContent = '';
			coverage.classList.remove('busy');
			return;
		}
		const names = data.names.join(', ');
		const others = data.more > 0 ? fill(S.coverageMore, { names, more: data.more }) : names;
		coverage.textContent = fill(S.coverage, {
			out: data.out,
			headcount: data.headcount,
			date: data.date,
			names: others,
		});
		coverage.classList.toggle('busy', data.busy);
	}

	for (const el of [start, end, startHalf, endHalf]) {
		el.addEventListener('change', refresh);
		el.addEventListener('input', refresh);
	}
	typeSel?.addEventListener('change', refresh);

	refresh();
}
