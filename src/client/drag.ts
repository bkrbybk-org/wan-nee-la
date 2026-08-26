/**
 * Drag an entry chip on the month grid to move it to another day.
 *
 * A separate module from calendar.ts because the two features barely touch —
 * calendar.ts turns clicks on real links into dialogs; this turns a
 * press-and-move gesture into a submit of the same edit form those dialogs
 * already point at. Keeping them apart keeps calendar.ts's click handling
 * readable and lets this file be skipped entirely below the desktop
 * breakpoint without an `if` threaded through the other file.
 *
 * On drop this builds a hidden `<form>` and POSTs it to the existing
 * `/api/leave/:id/edit` — the same endpoint the edit page uses — so overlap
 * detection, quota limits, weekend/holiday rejection and the backdate window
 * are enforced in exactly one place. A rejected drop reloads to the normal
 * error banner.
 *
 * Pointer Events, not the HTML5 drag-and-drop API: HTML5 DnD fires its own
 * click-suppression and dragover targeting that fights the absolutely
 * positioned `.cell-add` overlay link filling each day cell.
 */

import { addDays, daysBetween } from '../domain/dates.ts';

// Dragging a scrolling month grid on a touch screen fights the scroll
// gesture and loses to it. Below this width the grid is hidden anyway (see
// app.css's 768px breakpoint) and the agenda's tap-to-open-popup is the only
// path — keep it that way.
const MIN_WIDTH = 768;

// Distance the pointer must travel before a press becomes a drag, so a plain
// click (which must still open the detail popup) is never swallowed.
const DRAG_THRESHOLD = 6;

function desktop(): boolean {
	return window.matchMedia(`(min-width: ${MIN_WIDTH}px)`).matches;
}

const grid = document.querySelector<HTMLElement>('.grid-view .grid');
if (grid) {
	let originChip: HTMLAnchorElement | null = null;
	/**
	 * The day whose cell the drag started in — not the booking's start date.
	 *
	 * A multi-day booking renders a chip on every day it covers, so grabbing one
	 * on the 19th of a 17–20 booking and dropping on the 21st should shift it by
	 * two days, to 19–22. Shifting from the booking's start instead would move it
	 * to 21–24, which is a four-day jump the user did not ask for.
	 */
	let grabDate = '';
	let startX = 0;
	let startY = 0;
	let dragging = false;
	let suppressClick = false;
	let dropCell: HTMLElement | null = null;

	function cellAt(x: number, y: number): HTMLElement | null {
		// Elements under the pointer, not the chip being dragged (pointer capture
		// keeps events on it) or the ghost (pointer-events: none already).
		const el = document.elementFromPoint(x, y);
		return el?.closest<HTMLElement>('.cell') ?? null;
	}

	function dateOf(cell: HTMLElement): string | null {
		return cell.querySelector<HTMLAnchorElement>('.cell-add')?.getAttribute('data-date') ?? null;
	}

	function setDropCell(cell: HTMLElement | null) {
		if (dropCell === cell) return;
		dropCell?.classList.remove('drop-target');
		dropCell = cell;
		dropCell?.classList.add('drop-target');
	}

	function cleanup() {
		originChip?.classList.remove('chip-dragging');
		setDropCell(null);
		originChip = null;
		dragging = false;
	}

	function submitMove(id: string, newStart: string, newEnd: string, chip: HTMLElement) {
		const form = document.createElement('form');
		form.method = 'post';
		form.action = `/api/leave/${id}/edit`;
		form.style.display = 'none';

		const field = (name: string, value: string) => {
			const input = document.createElement('input');
			input.type = 'hidden';
			input.name = name;
			input.value = value;
			form.appendChild(input);
		};

		field('leaveTypeId', chip.getAttribute('data-type-id') ?? '');
		field('startDate', newStart);
		field('endDate', newEnd);
		field('startHalf', chip.getAttribute('data-start-half') ?? 'full');
		field('endHalf', chip.getAttribute('data-end-half') ?? 'full');
		field('note', chip.getAttribute('data-note') ?? '');
		// Only own-or-admin chips are draggable, so the note text above is always
		// one this viewer may read — but its visibility still has to survive the
		// move rather than resetting to the default.
		if (!chip.getAttribute('data-note-private')) field('noteVisibility', 'shared');
		// Come back to the month the drag happened in. Without this the edit
		// endpoint's defaults apply and a drag on the calendar would land the
		// user on /me, or on the edit page if the move was rejected.
		field('returnTo', location.pathname + location.search);

		document.body.appendChild(form);
		form.submit();
	}

	grid.addEventListener('pointerdown', (e) => {
		if (!desktop() || e.button !== 0) return;
		const chip = (e.target as HTMLElement).closest<HTMLAnchorElement>('.chip');
		if (!chip || chip.getAttribute('data-can-edit') !== '1') return;

		const cell = chip.closest<HTMLElement>('.cell');
		originChip = chip;
		grabDate = cell ? (dateOf(cell) ?? '') : '';
		startX = e.clientX;
		startY = e.clientY;
		dragging = false;
		// Clear any flag left over from a drag whose click never arrived — the
		// pointer can be released outside the element, in which case no click
		// follows and a stale flag would swallow the next real one.
		suppressClick = false;
	});

	grid.addEventListener('pointermove', (e) => {
		if (!originChip) return;

		if (!dragging) {
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			dragging = true;
			originChip.classList.add('chip-dragging');
			originChip.setPointerCapture(e.pointerId);
		}

		setDropCell(cellAt(e.clientX, e.clientY));
	});

	grid.addEventListener('pointerup', (e) => {
		if (!originChip) return;
		const chip = originChip;

		if (!dragging) {
			cleanup();
			return;
		}

		// The drag reached the threshold — this is a drag, not a click. The
		// dialog opener listens on `document` and runs after this, so mark the
		// click to skip before letting the event continue.
		suppressClick = true;

		const cell = cellAt(e.clientX, e.clientY);
		const targetDate = cell ? dateOf(cell) : null;

		if (targetDate && grabDate && targetDate !== grabDate) {
			const shift = daysBetween(grabDate, targetDate);
			const bookingStart = chip.getAttribute('data-start-date') ?? '';
			const bookingEnd = chip.getAttribute('data-end-date') ?? bookingStart;
			const id = chip.getAttribute('data-entry') ?? '';
			cleanup();
			// Both ends move by the same shift, so the booking keeps its length.
			submitMove(id, addDays(bookingStart, shift), addDays(bookingEnd, shift), chip);
			return;
		}

		// Dropped back on the origin day, or outside the grid: no-op.
		cleanup();
	});

	grid.addEventListener('pointercancel', cleanup);

	// Capture phase, ahead of calendar.ts's click listener on `document`, so
	// the suppression flag is checked before that listener opens the popup.
	document.addEventListener(
		'click',
		(e) => {
			if (!suppressClick) return;
			suppressClick = false;
			e.preventDefault();
			e.stopPropagation();
		},
		true,
	);
}
