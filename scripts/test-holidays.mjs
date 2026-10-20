#!/usr/bin/env node
// Unit tests for src/domain/holidays.ts — parsing a pasted holiday list, and
// the reminder to enter next year's.
// Run: npm run test:holidays
import { FIXED_DATE_HOLIDAYS, holidayGap, importPlan, parseHolidayList } from '../src/domain/holidays.ts';

let failures = 0;
const check = (name, cond, detail) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` -> ${detail}`}`);
	if (!cond) failures++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- the shapes a pasted list actually arrives in --------------------------

const spaces = parseHolidayList('2027-01-01 New Year\'s Day\n2027-04-13 Songkran');
eq('space separated: count', spaces.holidays.length, 2);
eq('space separated: date', spaces.holidays[0].date, '2027-01-01');
eq('space separated: label keeps its spaces', spaces.holidays[0].label, "New Year's Day");
eq('space separated: no errors', spaces.errors.length, 0);

eq('comma separated', parseHolidayList('2027-01-01,New Year').holidays[0]?.label, 'New Year');
eq('tab separated', parseHolidayList('2027-01-01\tNew Year').holidays[0]?.label, 'New Year');
eq('semicolon separated', parseHolidayList('2027-01-01;New Year').holidays[0]?.label, 'New Year');

// A label may contain the separator itself — "Songkran, day 2" is one holiday,
// not a date followed by two fields.
eq('label may contain commas', parseHolidayList('2027-04-14,Songkran, day 2').holidays[0]?.label, 'Songkran, day 2');

// Thai labels are the common case here.
eq('Thai label', parseHolidayList('2027-01-01 วันขึ้นปีใหม่').holidays[0]?.label, 'วันขึ้นปีใหม่');

// --- what is ignored -------------------------------------------------------

const noise = parseHolidayList('\n# 2027 public holidays\n\n2027-01-01 New Year\n   \n');
eq('blank lines and comments ignored', noise.holidays.length, 1);
eq('and are not reported as errors', noise.errors.length, 0);

// --- what is rejected ------------------------------------------------------

const bad = parseHolidayList('01/01/2027 New Year\n2027-01-02 Second\n2027-13-45 Impossible\nlonely');
eq('bad rows do not become holidays', bad.holidays.length, 1);
eq('the good row still parses', bad.holidays[0].date, '2027-01-02');
eq('every bad row is reported', bad.errors.length, 3);
eq('errors carry their line number', bad.errors[0].line, 1);
eq('a line with no name is an error', bad.errors[2].line, 4);
check('the reason names the offending value', /01\/01\/2027/.test(bad.errors[0].reason), bad.errors[0].reason);

eq('a date with no name is an error', parseHolidayList('2027-01-01').errors.length, 1);
eq('empty input is not an error', parseHolidayList('').errors.length, 0);
eq('empty input has no holidays', parseHolidayList('').holidays.length, 0);

// --- normalisation ---------------------------------------------------------

// The table holds one label per date, so a repeat later in the paste is a
// correction rather than a second holiday.
const dupes = parseHolidayList('2027-01-01 Wrong name\n2027-01-01 Right name');
eq('a repeated date collapses', dupes.holidays.length, 1);
eq('and the last one wins', dupes.holidays[0].label, 'Right name');

const unsorted = parseHolidayList('2027-12-05 December\n2027-01-01 January');
eq('output is sorted by date', unsorted.holidays.map((h) => h.date).join(','), '2027-01-01,2027-12-05');

const long = parseHolidayList(`2027-01-01 ${'x'.repeat(200)}`);
eq('a very long label is clamped, not rejected', long.holidays[0].label.length, 80);

// --- bounds ----------------------------------------------------------------
//
// This is a paste box, so both the number of lines and the sheer size of the
// input are attacker-shaped — one becomes a D1 batch, the other a string in a
// Worker's memory.

const tooMany = parseHolidayList(Array.from({ length: 500 }, (_, i) => `2029-01-0${(i % 9) + 1} H${i}`).join('\n'));
eq('an oversized list is refused outright', tooMany.holidays.length, 0);
eq('and says why', tooMany.errors.length, 1);
check('naming the limit', /400 lines/.test(tooMany.errors[0].reason), tooMany.errors[0].reason);

const tooBig = parseHolidayList('2027-01-01 ' + 'x'.repeat(70 * 1024));
eq('an oversized paste is refused', tooBig.holidays.length, 0);
eq('with one error, not thousands', tooBig.errors.length, 1);

// Error text is echoed back into a cookie-borne flash message, so it cannot
// carry an unbounded slice of the input.
const longToken = parseHolidayList('x'.repeat(500) + ' Name');
check('a long bad token is clamped in the error', longToken.errors[0].reason.length < 120, longToken.errors[0].reason.length);

// --- the reminder to enter next year's list --------------------------------

// What migrations/0002 seeds for a year ahead: only the fixed-date holidays.
const seeded = (y) => [...FIXED_DATE_HOLIDAYS].map((md) => `${y}-${md}`);
const withMakhaBucha = (y) => [...seeded(y), `${y}-02-20`];
const gap = holidayGap('2026-10-20', seeded);
eq('reminder: October looks at next year', gap?.year, 2027);
eq('reminder: a seeded-only year is flagged, however many it holds', gap?.have, 15);
eq('reminder: quiet once anything announced is in', holidayGap('2026-11-02', withMakhaBucha), null);
eq('reminder: an empty year is flagged too', holidayGap('2026-12-01', () => [])?.have, 0);
eq('reminder: in January it looks at the year just begun', holidayGap('2027-01-15', seeded)?.year, 2027);
eq('reminder: quiet from February to September', holidayGap('2027-02-01', () => []), null);
eq('reminder: September is still quiet', holidayGap('2026-09-30', () => []), null);
check('reminder: from 1 October', holidayGap('2026-10-01', seeded) !== null, 'quiet on 1 October');
eq('reminder: the fixed-date list matches the seed', FIXED_DATE_HOLIDAYS.size, 15);

// --- what an import would change -------------------------------------------

const booking = (id, start_date, end_date) => ({ id, start_date, end_date, display_name: id });
const plan = importPlan(
	[
		{ date: '2027-02-22', label: 'Makha Bucha' },
		{ date: '2027-04-13', label: 'Songkran' },
		{ date: '2027-05-01', label: 'Labour Day (moved)' },
		{ date: '2027-02-20', label: 'A Saturday' },
	],
	new Map([['2027-04-13', 'Songkran'], ['2027-05-01', 'Labour Day']]),
	[booking('across', '2027-02-19', '2027-02-23'), booking('before', '2027-02-01', '2027-02-05'), booking('labour', '2027-04-30', '2027-05-03')],
);
eq('import plan: a date not held is new', plan.rows[0].status, 'new');
eq('import plan: a date held with the same name is unchanged', plan.rows[1].status, 'same');
eq('import plan: a new name is a rename', `${plan.rows[2].status} ${plan.rows[2].was}`, 'renamed Labour Day');
eq('import plan: a booking across a new working-day holiday is flagged', plan.affected.map((a) => `${a.entry.id}:${a.dates.join(',')}`).join(' '), 'across:2027-02-22');
check('import plan: a new Saturday holiday charges nobody back', !plan.affected.some((a) => a.dates.includes('2027-02-20')), 'weekend counted');
check('import plan: a rename frees no day', !plan.affected.some((a) => a.entry.id === 'labour'), 'rename counted');

console.log(failures === 0 ? '\nAll holiday tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
