#!/usr/bin/env node
// Unit tests for src/domain/dates.ts. Pure functions, no bindings, no I/O.
// Run: npm run test:dates
import {
	addDays,
	bangkokToday,
	countLeaveDays,
	daysBetween,
	describeRange,
	dayOfWeek,
	eachDate,
	isValidDate,
	isWeekend,
	isWorkday,
	lastOfMonth,
	monthGrid,
	indexInWeek,
	weekdayLabels,
	weekdayName,
	parseWeekStart,
	rangesOverlap,
	shiftMonth,
	workdaysIn,
} from '../src/domain/dates.ts';

let failures = 0;
const check = (name, cond, detail) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` -> ${detail}`}`);
	if (!cond) failures++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------------------------------
// bangkokToday — the boundary that causes silent off-by-one bugs.
// ---------------------------------------------------------------------------------------

eq('bangkokToday: midday UTC', bangkokToday(new Date('2026-08-15T12:00:00Z')), '2026-08-15');
eq('bangkokToday: 16:59 UTC is still today', bangkokToday(new Date('2026-08-15T16:59:00Z')), '2026-08-15');
eq('bangkokToday: 17:00 UTC is already tomorrow', bangkokToday(new Date('2026-08-15T17:00:00Z')), '2026-08-16');
eq('bangkokToday: 23:59 UTC is tomorrow', bangkokToday(new Date('2026-08-15T23:59:59Z')), '2026-08-16');
eq('bangkokToday: 00:00 UTC is same day', bangkokToday(new Date('2026-08-15T00:00:00Z')), '2026-08-15');
// The 08:00 Bangkok cron fires at 01:00 UTC and must announce that same Bangkok date.
eq('bangkokToday: cron hour', bangkokToday(new Date('2026-08-15T01:00:00Z')), '2026-08-15');
// Year boundary: 31 Dec 18:00 UTC is already New Year's Day in Bangkok.
eq('bangkokToday: year rollover', bangkokToday(new Date('2026-12-31T18:00:00Z')), '2027-01-01');

// ---------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------

eq('isValidDate: ok', isValidDate('2026-08-15'), true);
eq('isValidDate: leap day 2028', isValidDate('2028-02-29'), true);
eq('isValidDate: non-leap 29 Feb', isValidDate('2026-02-29'), false);
eq('isValidDate: 31 Feb rolls over, rejected', isValidDate('2026-02-31'), false);
eq('isValidDate: 31 Apr', isValidDate('2026-04-31'), false);
eq('isValidDate: month 13', isValidDate('2026-13-01'), false);
eq('isValidDate: no zero padding', isValidDate('2026-8-15'), false);
eq('isValidDate: garbage', isValidDate('tomorrow'), false);
eq('isValidDate: empty', isValidDate(''), false);

// ---------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------

eq('addDays: forward', addDays('2026-08-15', 3), '2026-08-18');
eq('addDays: across month end', addDays('2026-08-31', 1), '2026-09-01');
eq('addDays: across year end', addDays('2026-12-31', 1), '2027-01-01');
eq('addDays: backwards', addDays('2026-01-01', -1), '2025-12-31');
eq('daysBetween: same day', daysBetween('2026-08-15', '2026-08-15'), 0);
eq('daysBetween: inclusive span', daysBetween('2026-08-15', '2026-08-18'), 3);
eq('daysBetween: reversed is negative', daysBetween('2026-08-18', '2026-08-15'), -3);
eq('eachDate: inclusive both ends', eachDate('2026-08-15', '2026-08-17').length, 3);
eq('eachDate: single day', eachDate('2026-08-15', '2026-08-15').length, 1);
eq('eachDate: reversed is empty', eachDate('2026-08-17', '2026-08-15').length, 0);
eq('lastOfMonth: Aug', lastOfMonth(2026, 8), '2026-08-31');
eq('lastOfMonth: Feb non-leap', lastOfMonth(2026, 2), '2026-02-28');
eq('lastOfMonth: Feb leap', lastOfMonth(2028, 2), '2028-02-29');

// 2026-08-15 is a Saturday.
eq('dayOfWeek: Saturday', dayOfWeek('2026-08-15'), 6);
eq('dayOfWeek: Sunday', dayOfWeek('2026-08-16'), 0);
eq('dayOfWeek: Monday', dayOfWeek('2026-08-17'), 1);
eq('isWeekend: Sat', isWeekend('2026-08-15'), true);
eq('isWeekend: Sun', isWeekend('2026-08-16'), true);
eq('isWeekend: Mon', isWeekend('2026-08-17'), false);
eq('isWeekend: Fri', isWeekend('2026-08-21'), false);

// ---------------------------------------------------------------------------------------
// Workdays and holidays
// ---------------------------------------------------------------------------------------

const noHolidays = new Set();
// 2026-08-12 (Wed) is Mother's Day; 2026-08-19 (Wed) is invented for these tests.
const holidays = new Set(['2026-08-12', '2026-08-19']);

eq('isWorkday: plain Monday', isWorkday('2026-08-17', noHolidays), true);
eq('isWorkday: holiday Wednesday', isWorkday('2026-08-19', holidays), false);
eq('isWorkday: same day without the holiday list', isWorkday('2026-08-19', noHolidays), true);
// Mon 17 – Fri 21 = 5 weekdays, minus the Wed holiday.
eq('workdaysIn: full week', workdaysIn('2026-08-17', '2026-08-21', noHolidays).length, 5);
eq('workdaysIn: full week less a holiday', workdaysIn('2026-08-17', '2026-08-21', holidays).length, 4);
eq('workdaysIn: weekend only', workdaysIn('2026-08-15', '2026-08-16', noHolidays).length, 0);

// ---------------------------------------------------------------------------------------
// countLeaveDays — the arithmetic that spends people's quota.
// ---------------------------------------------------------------------------------------

const days = (s, e, sh = 'full', eh = 'full', h = noHolidays) => countLeaveDays(s, e, sh, eh, h);
const ok = (name, res, want) =>
	check(name, res.ok && res.days === want, res.ok ? `got ${res.days}, want ${want}` : `errored: ${res.error}`);
const bad = (name, res) => check(name, !res.ok, `expected an error, got ${res.ok ? res.days : '?'} days`);

ok('single full weekday', days('2026-08-17', '2026-08-17'), 1);
ok('single AM half', days('2026-08-17', '2026-08-17', 'am', 'am'), 0.5);
ok('single PM half', days('2026-08-17', '2026-08-17', 'pm', 'pm'), 0.5);
bad('single day with mismatched halves', days('2026-08-17', '2026-08-17', 'am', 'pm'));
bad('single day on a Saturday', days('2026-08-15', '2026-08-15'));
bad('single day on a holiday', days('2026-08-19', '2026-08-19', 'full', 'full', holidays));

ok('Mon–Fri', days('2026-08-17', '2026-08-21'), 5);
ok('Mon–Fri with a midweek holiday', days('2026-08-17', '2026-08-21', 'full', 'full', holidays), 4);
// Weekend in the middle costs nothing: Fri 21 → Mon 24 is 2 workdays.
ok('range spanning a weekend', days('2026-08-21', '2026-08-24'), 2);
bad('weekend-only range', days('2026-08-15', '2026-08-16'));

// Half days at the edges.
ok('Fri PM → Mon AM', days('2026-08-21', '2026-08-24', 'pm', 'am'), 1);
ok('Mon PM → Fri full', days('2026-08-17', '2026-08-21', 'pm', 'full'), 4.5);
ok('Mon full → Fri AM', days('2026-08-17', '2026-08-21', 'full', 'am'), 4.5);
ok('Mon PM → Fri AM', days('2026-08-17', '2026-08-21', 'pm', 'am'), 4);
// A half on a day that never counted must not discount anything.
// Sat 15 PM → Fri 21 full: the Saturday contributes 0, so this is the plain Mon–Fri 5.
ok('PM start on a Saturday discounts nothing', days('2026-08-15', '2026-08-21', 'pm', 'full'), 5);
// Mon 17 full → Sun 23 AM: the Sunday contributes 0, so still Mon–Fri 5.
ok('AM end on a Sunday discounts nothing', days('2026-08-17', '2026-08-23', 'full', 'am'), 5);

bad('multi-day starting AM', days('2026-08-17', '2026-08-21', 'am', 'full'));
bad('multi-day ending PM', days('2026-08-17', '2026-08-21', 'full', 'pm'));
bad('end before start', days('2026-08-21', '2026-08-17'));
bad('invalid start date', days('2026-02-30', '2026-08-17'));
bad('invalid end date', days('2026-08-17', 'nope'));

// A booking crossing a year boundary still counts only workdays.
// Mon 28 – Thu 31 Dec, Fri 1 Jan, Mon 4 Jan = 6 weekdays.
ok('across the new year', days('2026-12-28', '2027-01-04'), 6);
ok(
	'across the new year, 1 Jan a holiday',
	days('2026-12-28', '2027-01-04', 'full', 'full', new Set(['2027-01-01'])),
	5,
);

// ---------------------------------------------------------------------------------------
// Overlap
// ---------------------------------------------------------------------------------------

eq('overlap: identical', rangesOverlap('2026-08-17', '2026-08-21', '2026-08-17', '2026-08-21'), true);
eq('overlap: contained', rangesOverlap('2026-08-17', '2026-08-21', '2026-08-18', '2026-08-19'), true);
eq('overlap: touching at one end', rangesOverlap('2026-08-17', '2026-08-21', '2026-08-21', '2026-08-25'), true);
eq('overlap: adjacent but disjoint', rangesOverlap('2026-08-17', '2026-08-21', '2026-08-22', '2026-08-25'), false);
eq('overlap: far apart', rangesOverlap('2026-08-17', '2026-08-21', '2026-09-01', '2026-09-02'), false);

// ---------------------------------------------------------------------------------------
// Calendar grid
// ---------------------------------------------------------------------------------------

const grid = monthGrid(2026, 8);
eq('monthGrid: whole weeks', grid.length % 7, 0);
eq('monthGrid: starts on a Monday', dayOfWeek(grid[0]), 1);
eq('monthGrid: ends on a Sunday', dayOfWeek(grid[grid.length - 1]), 0);
check('monthGrid: contains the 1st', grid.includes('2026-08-01'), 'missing 2026-08-01');
check('monthGrid: contains the last day', grid.includes('2026-08-31'), 'missing 2026-08-31');
// 1 Feb 2027 is a Monday, so a Monday-first grid needs no leading pad.
eq('monthGrid: Feb 2027 needs no lead pad', monthGrid(2027, 2)[0], '2027-02-01');

// ---------------------------------------------------------------------------------------
// Week start — presentation only. Rotating the columns must not drop or duplicate a day.
// ---------------------------------------------------------------------------------------

const sunGrid = monthGrid(2026, 8, 0);
eq('monthGrid Sunday-first: whole weeks', sunGrid.length % 7, 0);
eq('monthGrid Sunday-first: starts on a Sunday', dayOfWeek(sunGrid[0]), 0);
eq('monthGrid Sunday-first: ends on a Saturday', dayOfWeek(sunGrid[sunGrid.length - 1]), 6);
check('monthGrid Sunday-first: contains the 1st', sunGrid.includes('2026-08-01'), 'missing 2026-08-01');
check('monthGrid Sunday-first: contains the last day', sunGrid.includes('2026-08-31'), 'missing 2026-08-31');

// Every day of the month appears exactly once whichever way the week starts.
for (const [label, g] of [['Monday', monthGrid(2026, 8, 1)], ['Sunday', sunGrid]]) {
	const inMonth = g.filter((d) => d.startsWith('2026-08'));
	eq(`monthGrid ${label}-first: all 31 days present`, inMonth.length, 31);
	eq(`monthGrid ${label}-first: no duplicates`, new Set(inMonth).size, 31);
}

// The two grids are not the same range — this is exactly why the route has to
// build its query with the viewer's own week start rather than a fixed one.
check(
	'monthGrid: Sunday-first starts earlier than Monday-first for Aug 2026',
	sunGrid[0] < monthGrid(2026, 8, 1)[0],
	`${sunGrid[0]} vs ${monthGrid(2026, 8, 1)[0]}`,
);

// A month whose 1st is a Sunday is the case where the two disagree most.
// 2026-11-01 is a Sunday: Sunday-first needs no lead pad, Monday-first needs six.
eq('monthGrid: Nov 2026 Sunday-first needs no lead pad', monthGrid(2026, 11, 0)[0], '2026-11-01');
eq('monthGrid: Nov 2026 Monday-first pads back to Oct 26', monthGrid(2026, 11, 1)[0], '2026-10-26');

// 2026-08-17 is a Monday.
eq('indexInWeek: Monday is column 0 when weeks start Monday', indexInWeek('2026-08-17', 1), 0);
eq('indexInWeek: Monday is column 1 when weeks start Sunday', indexInWeek('2026-08-17', 0), 1);
eq('indexInWeek: Sunday is column 6 when weeks start Monday', indexInWeek('2026-08-16', 1), 6);
eq('indexInWeek: Sunday is column 0 when weeks start Sunday', indexInWeek('2026-08-16', 0), 0);

eq('weekdayLabels: Monday first', weekdayLabels(1).join(','), 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');
eq('weekdayLabels: Sunday first', weekdayLabels(0).join(','), 'Sun,Mon,Tue,Wed,Thu,Fri,Sat');
eq('weekdayLabels: default is Monday', weekdayLabels().join(','), 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');

// The agenda labels a date by its own weekday, which must not move with the setting.
eq('weekdayName: independent of week start', weekdayName('2026-08-16'), 'Sun');
eq('weekdayName: Monday', weekdayName('2026-08-17'), 'Mon');

eq('parseWeekStart: "0"', parseWeekStart('0'), 0);
eq('parseWeekStart: "1"', parseWeekStart('1'), 1);
eq('parseWeekStart: number 0', parseWeekStart(0), 0);
eq('parseWeekStart: rejects Tuesday', parseWeekStart('2'), null);
eq('parseWeekStart: rejects nonsense', parseWeekStart('monday'), null);
eq('parseWeekStart: rejects empty', parseWeekStart(''), null);
eq('parseWeekStart: rejects undefined', parseWeekStart(undefined), null);

eq('shiftMonth: forward within year', JSON.stringify(shiftMonth(2026, 8, 1)), JSON.stringify({ year: 2026, month: 9 }));
eq('shiftMonth: over December', JSON.stringify(shiftMonth(2026, 12, 1)), JSON.stringify({ year: 2027, month: 1 }));
eq('shiftMonth: back over January', JSON.stringify(shiftMonth(2026, 1, -1)), JSON.stringify({ year: 2025, month: 12 }));

// ---------------------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------------------

eq('describeRange: single full day', describeRange('2026-08-17', '2026-08-17', 'full', 'full'), '17 Aug');
eq('describeRange: single PM', describeRange('2026-08-17', '2026-08-17', 'pm', 'pm'), '17 Aug (PM)');
eq('describeRange: multi day', describeRange('2026-08-17', '2026-08-21', 'full', 'full'), '17 Aug – 21 Aug');
eq('describeRange: multi day with halves', describeRange('2026-08-17', '2026-08-21', 'pm', 'am'), '17 Aug (PM) – 21 Aug (AM)');

// A booking longer than a year is a mistyped year, not a plan — and for a leave
// type with no allowance there is no quota standing behind this check.
bad('range longer than a year', days('2026-01-05', '2027-06-01'));
check(
	'and it says which rule refused it',
	days('2026-01-05', '2027-06-01').error?.key === 'error.tooLong',
	days('2026-01-05', '2027-06-01').error?.key,
);
check('a range just inside the limit is allowed', days('2026-01-05', '2026-12-31').ok, 'rejected a valid year');

console.log(failures === 0 ? '\nAll date tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
