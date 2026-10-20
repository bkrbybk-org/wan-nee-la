/**
 * Parsing a pasted list of public holidays.
 *
 * Thai public holidays are announced yearly by cabinet resolution, and the
 * lunar ones move (docs/ISSUES.md #10). They arrive as a list — from a
 * government notice, an HR email, a spreadsheet — so the import accepts what
 * that list plausibly looks like after a copy and paste, rather than demanding
 * one exact format.
 */

import { isValidDate } from './dates.ts';
import type { Holiday } from '../types.ts';

export interface HolidayParse {
	holidays: Holiday[];
	/** Lines that could not be read, with their original number, so they can be fixed rather than guessed at. */
	errors: { line: number; text: string; reason: string }[];
}

const LABEL_MAX = 80;

/**
 * Caps, because this input is a paste box.
 *
 * `MAX_ROWS` bounds the D1 batch that follows — a spreadsheet column pasted by
 * accident should be refused, not turned into ten thousand statements. The
 * error text is clamped for a different reason: it quotes the offending value,
 * it travels back in a cookie, and a 10KB "date" would silently break the flash
 * message rather than explain itself.
 */
const MAX_ROWS = 400;
const ERROR_ECHO_MAX = 40;
/** A whole year of holidays is a few hundred bytes; this is room to spare. */
const MAX_INPUT = 64 * 1024;

/**
 * One holiday per line: a date, then a name, separated by a comma, a tab, or
 * whitespace. Blank lines and `#` comments are ignored.
 *
 * Nothing is written by this function — it reports what it understood and what
 * it did not, and the caller decides. An import that silently dropped the three
 * lines it could not read would be worse than one that refuses.
 */
export function parseHolidayList(text: string): HolidayParse {
	const holidays = new Map<string, Holiday>();
	const errors: HolidayParse['errors'] = [];
	const clamp = (v: string) => (v.length > ERROR_ECHO_MAX ? `${v.slice(0, ERROR_ECHO_MAX)}…` : v);

	if (text.length > MAX_INPUT) {
		return { holidays: [], errors: [{ line: 0, text: '', reason: 'That paste is too large to be a holiday list.' }] };
	}

	const lines = text.split(/\r?\n/);
	if (lines.length > MAX_ROWS) {
		return {
			holidays: [],
			errors: [{ line: MAX_ROWS + 1, text: '', reason: `That is more than ${MAX_ROWS} lines. Import a year at a time.` }],
		};
	}

	lines.forEach((raw, i) => {
		const line = raw.trim();
		if (!line || line.startsWith('#')) return;

		// The first token is the date; everything after the separator is the name,
		// which may itself contain spaces and commas ("Songkran, day 2").
		const match = /^([^\s,;\t]+)[\s,;\t]+(.+)$/.exec(line);
		if (!match) {
			errors.push({ line: i + 1, text: clamp(line), reason: 'Expected a date and a name.' });
			return;
		}

		const [, date, rest] = match;
		if (!isValidDate(date)) {
			errors.push({ line: i + 1, text: clamp(line), reason: `"${clamp(date)}" is not a YYYY-MM-DD date.` });
			return;
		}

		const label = rest.trim().replace(/^[,;\t]+/, '').trim().slice(0, LABEL_MAX);
		if (!label) {
			errors.push({ line: i + 1, text: clamp(line), reason: 'The name is empty.' });
			return;
		}

		// A repeated date in one paste is a correction further down the list, not
		// a second holiday — the table can only hold one label per date anyway.
		holidays.set(date, { date, label });
	});

	return { holidays: [...holidays.values()].sort((a, b) => a.date.localeCompare(b.date)), errors };
}

/**
 * The holidays that fall on the same date every year, as MM-DD — the ones
 * migrations/0002 seeds for each year ahead. Everything else (the Buddhist
 * holidays, which move with the lunar calendar, substitution days, and any
 * company days) is announced year by year and has to be entered by an admin.
 */
export const FIXED_DATE_HOLIDAYS: ReadonlySet<string> = new Set([
	'01-01', '04-06', '04-13', '04-14', '04-15', '05-01', '05-04', '06-03',
	'07-28', '08-12', '10-13', '10-23', '12-05', '12-10', '12-31',
]);

export interface HolidayGap {
	/** The year whose list still needs entering. */
	year: number;
	/** How many holidays it has so far, all of them fixed-date ones. */
	have: number;
}

/**
 * Whether a year's announced holidays still need entering.
 *
 * Nothing used to say so until someone booked a Buddhist holiday and had a day
 * taken off their quota (#10). A year whose every holiday is a fixed-date one
 * has had nothing announced added to it, which is exactly the gap: no year in
 * Thailand goes by without Makha Bucha, Visakha Bucha and Asarnha Bucha. (A
 * first version compared counts with the year before and was fooled straight
 * away: production's 2026 began in August, so a seeded 2027 already had more.)
 *
 * Asked from 1 October, once the cabinet's list is usually out, about next
 * year, and through January about the year just begun.
 *
 * `datesOf(year)` is the holiday dates entered for that year.
 */
export function holidayGap(today: string, datesOf: (year: number) => readonly string[]): HolidayGap | null {
	const y = Number(today.slice(0, 4));
	const m = Number(today.slice(5, 7));
	const year = m >= 10 ? y + 1 : m === 1 ? y : null;
	if (year === null) return null;
	const dates = datesOf(year);
	const announced = dates.some((d) => !FIXED_DATE_HOLIDAYS.has(d.slice(5)));
	return announced ? null : { year, have: dates.length };
}
