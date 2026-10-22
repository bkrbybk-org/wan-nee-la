/**
 * Calendar interactions: click a day to book it, click an entry to open it.
 *
 * Everything here is an upgrade of a link that already works. Each day cell and
 * each entry is a real `<a>`; without this script they navigate to `/book?date=`
 * or `/leave/:id/edit` and the app is fully usable. With it, the same click
 * opens a dialog and the user never loses their place in the month.
 *
 * Modifier-clicks and middle-clicks are left alone, so "open in new tab" keeps
 * working the way it does on any other link.
 */

const createDialog = document.querySelector<HTMLDialogElement>('[data-create-dialog]');
const entryDialog = document.querySelector<HTMLDialogElement>('[data-entry-dialog]');

/** A click the browser should handle itself: new tab, new window, download. */
function isModifiedClick(e: MouseEvent): boolean {
	return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

function open(dialog: HTMLDialogElement | null) {
	if (!dialog) return;
	// showModal gives focus trapping and Escape-to-close for free, which a
	// hand-rolled overlay would have to reimplement badly.
	if (typeof dialog.showModal === 'function') dialog.showModal();
	else dialog.setAttribute('open', '');
}

for (const dialog of [createDialog, entryDialog]) {
	if (!dialog) continue;
	dialog.querySelector('[data-popup-close]')?.addEventListener('click', () => dialog.close());
	// The form's own Cancel is a link to the calendar, for /book; in the dialog
	// it just closes it.
	dialog.querySelector('[data-form-cancel]')?.addEventListener('click', (e) => {
		e.preventDefault();
		dialog.close();
	});
	// Clicking the backdrop closes. The dialog element itself fills only the
	// panel, so a click whose target is the dialog is a click outside the panel.
	dialog.addEventListener('click', (e) => {
		if (e.target === dialog) dialog.close();
	});
}

// ---------------------------------------------------------------------------
// Book a day
// ---------------------------------------------------------------------------

const startInput = createDialog?.querySelector<HTMLInputElement>('[data-start]');
const endInput = createDialog?.querySelector<HTMLInputElement>('[data-end]');
const createTitle = createDialog?.querySelector<HTMLElement>('[data-create-title]');

document.addEventListener('click', (e) => {
	const target = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('[data-book-link]');
	if (!target || !createDialog || !startInput) return;
	if (isModifiedClick(e)) return;

	e.preventDefault();

	const date = target.getAttribute('data-date');
	if (date) {
		startInput.value = date;
		// A fresh single-day booking: clear any end date left from last time, or
		// the new start silently inherits an old range, and open on One day —
		// a day was what was clicked.
		if (endInput) endInput.value = '';
		const oneDay = createDialog.querySelector<HTMLInputElement>('input[name="mode"][value="one"]');
		if (oneDay) oneDay.checked = true;
		if (createTitle) createTitle.textContent = S.bookOn.split('{date}').join(formatDate(date));
	} else if (createTitle) {
		createTitle.textContent = S.book;
	}

	// Let booking.ts recompute the day preview and the half-day fields.
	startInput.dispatchEvent(new Event('change', { bubbles: true }));

	open(createDialog);
});

/** Wording from the server, in the reader's language; English if it is absent. */
const S = {
	book: 'Book leave',
	bookOn: 'Book leave — {date}',
	months: 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec',
	...(() => {
		try {
			return JSON.parse(createDialog?.getAttribute('data-dialog-strings') ?? '{}') as Record<string, string>;
		} catch {
			return {};
		}
	})(),
};

function formatDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	return `${d} ${S.months.split(' ')[m - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Open an entry
// ---------------------------------------------------------------------------

const p = {
	dot: entryDialog?.querySelector<HTMLElement>('[data-p-dot]'),
	name: entryDialog?.querySelector<HTMLElement>('[data-p-name]'),
	when: entryDialog?.querySelector<HTMLElement>('[data-p-when]'),
	type: entryDialog?.querySelector<HTMLElement>('[data-p-type]'),
	days: entryDialog?.querySelector<HTMLElement>('[data-p-days]'),
	note: entryDialog?.querySelector<HTMLElement>('[data-p-note]'),
	noteRow: entryDialog?.querySelector<HTMLElement>('[data-p-note-row]'),
	actions: entryDialog?.querySelector<HTMLElement>('[data-p-actions]'),
	readonly: entryDialog?.querySelector<HTMLElement>('[data-p-readonly]'),
	edit: entryDialog?.querySelector<HTMLAnchorElement>('[data-p-edit]'),
	cancel: entryDialog?.querySelector<HTMLFormElement>('[data-p-cancel]'),
};

document.addEventListener('click', (e) => {
	const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-entry]');
	if (!el || !entryDialog) return;
	if (isModifiedClick(e)) return;

	e.preventDefault();

	// Opened from a day's "+N more" list: put that away first, so the detail
	// popup is not stacked over a panel the reader has finished with.
	el.closest<HTMLElement>('[popover]')?.hidePopover?.();

	const id = el.getAttribute('data-entry') ?? '';
	const canEdit = el.getAttribute('data-can-edit') === '1';
	const note = el.getAttribute('data-note') ?? '';

	// textContent throughout: these values are other people's names and notes,
	// and they are never parsed as markup.
	if (p.dot) p.dot.style.setProperty('--chip', el.getAttribute('data-color') ?? '');
	if (p.name) p.name.textContent = el.getAttribute('data-name') ?? '';
	if (p.when) p.when.textContent = el.getAttribute('data-when') ?? '';
	if (p.type) p.type.textContent = el.getAttribute('data-type') ?? '';
	if (p.days) p.days.textContent = el.getAttribute('data-days') ?? '';
	if (p.note) p.note.textContent = note;
	if (p.noteRow) p.noteRow.hidden = note === '';

	if (p.actions) p.actions.hidden = !canEdit;
	if (p.readonly) p.readonly.hidden = canEdit;
	if (p.edit) p.edit.href = `/leave/${id}/edit`;
	if (p.cancel) p.cancel.action = `/api/v1/leave/${id}/cancel`;

	open(entryDialog);
});

// ---------------------------------------------------------------------------
// The day panel
// ---------------------------------------------------------------------------

/**
 * The day list becomes one card: the day tapped or clicked. On a phone it
 * sits under the grid; on a laptop it is the panel beside the month, ahead of
 * Upcoming, and clicking a day there selects it rather than booking it — the
 * + on each day, and the card's own link, book.
 *
 * Without this the list holds every busy day of the month, and the 20th is a
 * long scroll past the 1st to the 19th. The server already marks the day to
 * open on (today, or the month's first busy day) and renders a row for every
 * day, empty ones too; all this does is hide the others and move the mark
 * when a cell is tapped. The grid stays where it is, so a run of taps reads
 * the week without scrolling at all.
 *
 * The CSS that hides the other rows keys on `.day-mode`, set here, so with
 * scripting off the list is the whole month as before.
 */
/**
 * Call `go(-1)` or `go(1)` when `el` is swiped sideways on a touch screen:
 * finger moving left is +1, the thing to its right coming in.
 *
 * A swipe has to be clearly sideways — mostly horizontal, 60px or more, and
 * under 600ms — so a tap, or a vertical scroll that drifts a little, is never
 * taken for one. Passive listeners: nothing here ever blocks scrolling.
 */
const coarse = window.matchMedia('(pointer: coarse)').matches;
function onSwipe(el: HTMLElement, go: (dir: -1 | 1) => void) {
	if (!coarse) return;
	let start: { x: number; y: number; t: number } | null = null;
	el.addEventListener('touchstart', (e) => {
		const touch = e.touches.length === 1 ? e.touches[0] : null;
		start = touch ? { x: touch.clientX, y: touch.clientY, t: e.timeStamp } : null;
	}, { passive: true });
	el.addEventListener('touchend', (e) => {
		const touch = e.changedTouches[0];
		if (!start || !touch) return;
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		const quick = e.timeStamp - start.t < 600;
		start = null;
		if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
		go(dx < 0 ? 1 : -1);
	}, { passive: true });
	el.addEventListener('touchcancel', () => {
		start = null;
	}, { passive: true });
}

const prevLink = document.querySelector<HTMLAnchorElement>('[data-month-prev]');
const nextLink = document.querySelector<HTMLAnchorElement>('[data-month-next]');

/** The ISO date `n` days from `iso`. */
function shiftDay(iso: string, n: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const agenda = document.querySelector<HTMLElement>('[data-agenda]');
if (agenda) {
	agenda.classList.add('day-mode');

	const rowFor = (date: string) => agenda.querySelector<HTMLElement>(`.agenda-row[data-day="${date}"]`);

	const status = document.querySelector<HTMLElement>('[data-day-status]');

	/** "Tuesday 20 October 2026: Mai Srisuk (Annual), Nok (Sick)". */
	const announce = (row: HTMLElement) => {
		if (!status) return;
		const people = [...row.querySelectorAll('.agenda-item')].map((item) => {
			const name = item.querySelector('.agenda-name')?.textContent ?? '';
			const type = item.querySelector('.agenda-type')?.textContent ?? '';
			return type ? `${name} (${type})` : name;
		});
		const holiday = row.querySelector('.holiday-tag')?.textContent;
		const none = row.querySelector('.agenda-none')?.textContent ?? '';
		const said = [holiday, people.length > 0 ? people.join(', ') : none].filter(Boolean).join('. ');
		status.textContent = `${row.dataset.label ?? row.dataset.day}: ${said}`;
	};

	const select = (date: string, { speak = true } = {}) => {
		const row = rowFor(date);
		if (!row) return false;
		for (const el of document.querySelectorAll('.agenda-row.selected, .cell.selected')) el.classList.remove('selected');
		row.classList.add('selected');
		document.querySelector(`.cell-day[data-day="${date}"]`)?.closest('.cell')?.classList.add('selected');
		// Said only when the reader changed the day, not on arrival — the page
		// is already being read from the top then.
		if (speak) announce(row);
		return true;
	};

	// A shared link to a day ("#d-2026-10-20") opens on that day.
	const fromHash = /^#d-(\d{4}-\d{2}-\d{2})$/.exec(location.hash)?.[1];
	if (fromHash) select(fromHash, { speak: false });

	document.addEventListener('click', (e) => {
		const cell = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('.cell-day[data-day]');
		if (!cell || isModifiedClick(e)) return;
		// A day from the next or previous month has no row here; let its link
		// do what it does.
		if (!select(cell.dataset.day ?? '')) return;
		e.preventDefault();
		// Keeps the URL shareable without the jump an anchor would make.
		history.replaceState(null, '', `#d-${cell.dataset.day}`);
	});

	// Swipe the card to step a day at a time. Off the end of the month it
	// carries on into the next or previous one, landing on the day after (or
	// before) rather than wherever that month would open by default.
	onSwipe(agenda, (dir) => {
		const current = agenda.querySelector<HTMLElement>('.agenda-row.selected')?.dataset.day;
		if (!current) return;
		const target = shiftDay(current, dir);
		if (select(target)) {
			history.replaceState(null, '', `#d-${target}`);
			return;
		}
		const link = dir > 0 ? nextLink : prevLink;
		if (link) location.href = `${link.href}#d-${target}`;
	});
}

// The phone's Book button steps aside while the day card is on screen. The
// card carries its own Book link, and the button — fixed in the bottom-right
// corner — would otherwise sit on top of a name in it.
const fab = document.querySelector<HTMLElement>('[data-fab]');
if (fab && agenda && 'IntersectionObserver' in window) {
	// Out of the way until the observer first reports, which can be a few
	// frames after the first paint: shown until then, it sat over the card's
	// corner and then slid away.
	fab.classList.add('fab-away');
	new IntersectionObserver(([entry]) => fab.classList.toggle('fab-away', entry.isIntersecting)).observe(agenda);
}

// On a phone, Upcoming sits under the day card and can run to dozens of rows:
// it shows the first few days, and a button opens the rest. Folded here rather
// than in the markup, so without the script every row is there.
/** Days of Upcoming a phone shows before "Show all". */
const UPCOMING_FOLDED = 4;
const upcoming = document.querySelector<HTMLElement>('[data-upcoming]');
const upcomingAll = upcoming?.querySelector<HTMLButtonElement>('[data-upcoming-all]');
if (upcoming && upcomingAll && upcoming.querySelectorAll('.upcoming-day').length > UPCOMING_FOLDED) {
	upcoming.classList.add('folded');
	upcomingAll.hidden = false;
	upcomingAll.addEventListener('click', () => {
		upcoming.classList.remove('folded');
		upcomingAll.hidden = true;
	});
}

// Swipe the month grid to change month. The arrows stay; this follows their
// links, so the result is the same page with the same URL.
const gridView = document.querySelector<HTMLElement>('.grid-view');
if (gridView && prevLink && nextLink) {
	onSwipe(gridView, (dir) => {
		location.href = (dir > 0 ? nextLink : prevLink).href;
	});
}

/**
 * Follow one person across the page: pointing at any of their bars, Upcoming
 * rows or "+N more" rows lights up all of them and dims everyone else.
 *
 * Matched on `data-who`, an opaque key per person rather than their address,
 * which the calendar keeps out of its HTML. Keyboard focus does the same as
 * hovering, so it is not a mouse-only feature. Only on devices that can hover:
 * on a phone a tap is already an action, and the grid there is dots anyway.
 */
if (window.matchMedia('(hover: hover)').matches) {
	let following = '';
	const follow = (key: string) => {
		if (key === following) return;
		following = key;
		document.body.classList.toggle('who-dim', key !== '');
		for (const el of document.querySelectorAll('.who-lit')) el.classList.remove('who-lit');
		// The key is base-36 digits, so it is safe inside the selector as is.
		if (key) for (const el of document.querySelectorAll(`[data-who="${key}"]`)) el.classList.add('who-lit');
	};
	const keyFrom = (target: EventTarget | null) =>
		(target as HTMLElement | null)?.closest<HTMLElement>('[data-who]')?.dataset.who ?? '';

	document.addEventListener('pointerover', (e) => follow(keyFrom(e.target)));
	document.addEventListener('focusin', (e) => follow(keyFrom(e.target)));
	document.addEventListener('focusout', () => follow(''));
	// Leaving the window must not strand the page dimmed.
	document.documentElement.addEventListener('pointerleave', () => follow(''));
}
