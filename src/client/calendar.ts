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
		// the new start silently inherits an old range.
		if (endInput) endInput.value = '';
		if (createTitle) createTitle.textContent = `Book leave — ${formatDate(date)}`;
	} else if (createTitle) {
		createTitle.textContent = 'Book leave';
	}

	// Let booking.ts recompute the day preview and the half-day fields.
	startInput.dispatchEvent(new Event('change', { bubbles: true }));

	open(createDialog);
});

function formatDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${d} ${months[m - 1]} ${y}`;
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
	if (p.cancel) p.cancel.action = `/api/leave/${id}/cancel`;

	open(entryDialog);
});
