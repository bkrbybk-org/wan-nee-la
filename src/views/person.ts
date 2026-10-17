/**
 * Who someone is, at a glance: initials on a colour that is theirs.
 *
 * The calendar's colours used to mean only the leave type, and with nearly
 * everyone on annual leave nearly every chip was the same blue — the only way
 * to tell people apart was to read. The leave type keeps the chip's stripe and
 * tint; the person gets a small badge.
 *
 * Colours are handed out in sign-up order: the first person gets the first
 * colour, the second the second. That is the same on every page, every month
 * and every device, and nobody's changes when somebody joins, because user rows
 * are only ever deactivated, never deleted. A hash of the email was tried first
 * and put three of eight people on one colour; in order, nobody shares until
 * there are more people than colours, and their initials differ even then.
 * The hash stays as the fallback for an address with no user row.
 *
 * Every colour is dark enough for white initials at WCAG AA in both themes —
 * a badge looks the same in each — and none is the blue, red, violet or green
 * the leave types use. `scripts/palette.mjs` checks both, in CI.
 */

export const PERSON_COLORS = [
	'#0f766e', // teal
	'#c2410c', // coral
	'#a16207', // gold
	'#be185d', // pink
	'#18181b', // ink
	'#475569', // slate
	'#7c2d12', // brown
	'#4d7c0f', // olive
	'#a21caf', // magenta
] as const;

/** Everyone's colour, in sign-up order. Ties on the timestamp fall back to the email. */
export function personColors(users: readonly { email: string; created_at: string }[]): Map<string, string> {
	const ordered = [...users].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.email.localeCompare(b.email));
	return new Map(ordered.map((u, i) => [u.email, PERSON_COLORS[i % PERSON_COLORS.length]]));
}

/** FNV-1a over the normalised address: tiny, fast, and well spread. */
function hashOf(email: string): number {
	let h = 0x811c9dc5;
	for (const ch of email.trim().toLowerCase()) {
		h ^= ch.codePointAt(0) ?? 0;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

/** A stable colour for an address with no user row, from the address itself. */
export function personColor(email: string): string {
	return PERSON_COLORS[hashOf(email) % PERSON_COLORS.length];
}

/**
 * A short opaque key for one person, for matching their bars, rows and panel
 * entries on the page so hovering one can light up the rest.
 *
 * Not the email: the calendar keeps addresses out of the HTML every colleague
 * receives, and a key copied from the address would put them back. This is one
 * way — the page can tell two entries are the same person, not who they are
 * beyond the name already shown.
 */
export function personKey(email: string): string {
	return hashOf(email).toString(36);
}

/**
 * A name short enough for a calendar bar: the first name and the next word's
 * initial — "Chatchai Wongdetsakul" becomes "Chatchai W.". A single word is
 * left alone. The full name stays in the bar's tooltip, its label and the popup.
 */
export function shortName(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 2) return name.trim();
	return `${parts[0]} ${Array.from(parts[1])[0]}.`;
}

/** Up to two letters, e.g. "Somchai Pong" -> "SP". Thai names keep their first characters. */
export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	const first = (s: string) => Array.from(s)[0] ?? '';
	return (first(parts[0]) + first(parts[1] ?? '')).toUpperCase();
}
