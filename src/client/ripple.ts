/**
 * Material touch ripple.
 *
 * Purely decorative: every control it attaches to already has a CSS state
 * layer for hover, focus and press, so blocking this script costs nothing but
 * the animation. It is delegated from the document, which means controls that
 * appear later — the ones inside a dialog — get it for free.
 */

// The bottom navigation bar is deliberately absent: M3 confines a navigation
// item's ripple to its active-indicator pill, and the pill is not the element
// a tap on the label would find.
const TARGETS = '.btn, .icon-btn, .fab, .nav a, .segmented label, .chip';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

document.addEventListener(
	'pointerdown',
	(e) => {
		if (reduced.matches) return;
		// Primary button / single touch only — a right-click is not a press.
		if (e.button !== 0) return;

		const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(TARGETS);
		if (!el) return;

		const rect = el.getBoundingClientRect();
		// The circle has to reach the far corner from wherever it started, or the
		// ripple stops short of the edge on a wide button.
		const radius = Math.hypot(
			Math.max(e.clientX - rect.left, rect.right - e.clientX),
			Math.max(e.clientY - rect.top, rect.bottom - e.clientY),
		);

		const span = document.createElement('span');
		span.className = 'ripple';
		span.style.width = span.style.height = `${radius * 2}px`;
		span.style.left = `${e.clientX - rect.left - radius}px`;
		span.style.top = `${e.clientY - rect.top - radius}px`;
		span.addEventListener('animationend', () => span.remove());
		el.appendChild(span);
	},
	// Passive: this never calls preventDefault, and scrolling must not wait on it.
	{ passive: true },
);
