/** The longest display name kept; the rest is cut off. */
export const MAX_NAME = 60;

/**
 * A display name as it is stored: one line of visible text.
 *
 * The name goes into the LINE and push digests, which are plain text with one
 * person per line. A line break inside a name started a line of its own, so
 * anyone could add "Somchai W — Sick" to the company digest under their own
 * booking. Control characters, line and paragraph separators, and the
 * direction overrides that can make a name read as something else all become
 * a space; runs of spaces collapse to one.
 */
export function cleanDisplayName(raw: string): string {
	return raw
		.replace(/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_NAME)
		.trim();
}
