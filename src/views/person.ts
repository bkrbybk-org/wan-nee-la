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

/** A stable colour for an address with no user row, from the address itself. */
export function personColor(email: string): string {
	// FNV-1a: tiny, fast, and spreads short similar strings well enough that
	// "a.b@x" and "a.c@x" do not land on neighbours.
	let h = 0x811c9dc5;
	for (const ch of email.trim().toLowerCase()) {
		h ^= ch.codePointAt(0) ?? 0;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return PERSON_COLORS[h % PERSON_COLORS.length];
}

/** Up to two letters, e.g. "Somchai Pong" -> "SP". Thai names keep their first characters. */
export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	const first = (s: string) => Array.from(s)[0] ?? '';
	return (first(parts[0]) + first(parts[1] ?? '')).toUpperCase();
}
