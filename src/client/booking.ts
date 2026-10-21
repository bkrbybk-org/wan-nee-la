/**
 * Progressive enhancement for the booking form. The form posts and works
 * without any of this — even its One day / Several days switch, which is
 * radios and CSS. The script only adds the summary above the button:
 *
 *   - what the booking costs ("3 days"), computed by the server so it cannot
 *     disagree with what is actually charged — and the button says it too
 *   - the balance before and after ("Annual: 7 left → 4 after this")
 *   - who else is already away on the busiest of those days
 *
 * and keeps the last day from falling behind the first.
 *
 * Built by `npm run build:client` into public/app.js.
 */

interface Coverage {
	date: string;
	/** The booking's owner, when that is not the person asking. */
	with?: string;
	out: number;
	headcount: number;
	busy: boolean;
	names: string[];
	more: number;
}

interface Balance {
	type: string;
	remaining: number;
	after: number;
}

const forms = document.querySelectorAll<HTMLFormElement>('[data-booking]');

for (const form of forms) enhance(form);

function enhance(form: HTMLFormElement) {
	const start = form.querySelector<HTMLInputElement>('[data-start]');
	const end = form.querySelector<HTMLInputElement>('[data-end]');
	const summary = form.querySelector<HTMLElement>('[data-summary]');
	const preview = form.querySelector<HTMLElement>('[data-preview]');
	const balance = form.querySelector<HTMLElement>('[data-balance]');
	const coverage = form.querySelector<HTMLElement>('[data-coverage]');
	const submit = form.querySelector<HTMLButtonElement>('[data-submit]');
	// Set when editing, so the booking being changed is not counted as somebody
	// else already away on those days, and its own days are credited back.
	const excludeId = form.getAttribute('data-editing') ?? '';
	const submitLabel = submit?.textContent ?? '';
	// What the booking costs now, when editing, so the summary can say what
	// changes: "5 days → 4 days".
	const currentDays = form.hasAttribute('data-current-days') ? Number(form.getAttribute('data-current-days')) : null;

	/** Wording from the server, in the reader's language; English if it is missing. */
	const S = {
		days: '{days} day|{days} days',
		bookDays: 'Book {days} day|Book {days} days',
		balance: '{type}: {remaining} left → {after} after this',
		balanceShort: '{type}: only {remaining} left — not enough for this',
		balanceNone: '{type}: none left',
		coverage: 'Also away on {date}: {names} — with you, {out} of {headcount}',
		coverageFor: 'Also away on {date}: {names} — with {who}, {out} of {headcount}',
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
	if (!start || !end || !preview) return;

	/** The checked value of a radio group in this form. */
	const radio = (name: string, fallback: string) =>
		form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? fallback;
	const severalDays = () => radio('mode', 'one') === 'range';

	function syncFields() {
		// The last day is never before the first: always a mistake, never a shortcut.
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

	function clear() {
		preview!.textContent = '';
		preview!.classList.remove('bad');
		if (balance) balance.textContent = '';
		paintCoverage(null);
		if (submit) submit.textContent = submitLabel;
		summary?.classList.remove('filled');
	}

	async function request() {
		if (!start!.value) {
			clear();
			return;
		}
		// The same mapping the server applies (`parseBooking`): one day is a
		// date and its part; several days are two dates and their ends.
		const several = severalDays() && end!.value && end!.value !== start!.value;
		const part = radio('dayPart', 'full');
		const params = new URLSearchParams({
			leaveTypeId: radio('leaveTypeId', '1'),
			start: start!.value,
			end: several ? end!.value : start!.value,
			startHalf: several ? radio('startHalf', 'full') : severalDays() ? radio('startHalf', 'full') : part,
			endHalf: several ? radio('endHalf', 'full') : severalDays() ? radio('startHalf', 'full') : part,
		});
		if (excludeId) params.set('exclude', excludeId);
		// An admin booking for someone else: their balance and their coverage.
		const forWhom = form.querySelector<HTMLSelectElement>('[data-for]');
		if (forWhom && forWhom.selectedIndex > 0) params.set('for', forWhom.value);

		// Responses can land out of order; only the newest one may paint.
		const mine = ++seq;
		try {
			const res = await fetch(`/api/v1/leave/preview?${params}`, { headers: { Accept: 'application/json' } });
			if (mine !== seq) return;
			const body = (await res.json()) as {
				days?: number;
				error?: { key: string; message?: string };
				coverage?: Coverage | null;
				balance?: Balance | null;
			};
			if (mine !== seq) return;

			summary?.classList.add('filled');
			if (typeof body.days === 'number') {
				const now = fill(S.days, { days: body.days }, body.days);
				preview!.textContent = currentDays !== null && currentDays !== body.days ? `${fill(S.days, { days: currentDays }, currentDays)} → ${now}` : now;
				preview!.classList.remove('bad');
				if (submit && !excludeId) submit.textContent = fill(S.bookDays, { days: body.days }, body.days);
			} else {
				preview!.textContent = body.error?.message ?? '';
				preview!.classList.add('bad');
				if (submit) submit.textContent = submitLabel;
			}
			paintBalance(body.balance ?? null);
			paintCoverage(body.coverage ?? null);
		} catch {
			// Offline or the request failed. The summary is a nicety; the form
			// still submits and the server still decides.
			if (mine === seq) clear();
		}
	}

	/** "Annual: 7 left → 4 after this", or that there is not enough. Nothing for a type without an allowance. */
	function paintBalance(data: Balance | null) {
		if (!balance) return;
		if (!data) {
			balance.textContent = '';
			balance.classList.remove('bad');
			return;
		}
		const short = data.after < 0;
		// Already at or past zero, "only -6.5 left" is nonsense: say none is left.
		const template = data.remaining <= 0 ? S.balanceNone : short ? S.balanceShort : S.balance;
		balance.textContent = fill(template, { type: data.type, remaining: data.remaining, after: data.after });
		balance.classList.toggle('bad', short);
	}

	/**
	 * Who else is away on the busiest day of the range, by name, and how many
	 * of the team that makes with the booker.
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
		coverage.textContent = fill(data.with ? S.coverageFor : S.coverage, {
			who: data.with ?? '',
			out: data.out,
			headcount: data.headcount,
			date: data.date,
			names: others,
		});
		coverage.classList.toggle('busy', data.busy);
	}

	form.addEventListener('change', refresh);
	start.addEventListener('input', refresh);
	end.addEventListener('input', refresh);

	refresh();
}
