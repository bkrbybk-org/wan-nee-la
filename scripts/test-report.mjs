#!/usr/bin/env node
// Unit tests for src/domain/report.ts — leave counted over a span: the HR
// export and the per-month view on /me.
// Run: npm run test:report
import { daysWithin, leaveSummary, monthlyDays, toCsv, unusedLeave } from '../src/domain/report.ts';

let failures = 0;
const check = (name, cond, detail) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` -> ${detail}`}`);
	if (!cond) failures++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// Mon 17 – Wed 19 August 2026, as in test-leave.mjs.
const entry = (over = {}) => ({
	id: 'e1',
	user_email: 'a@x.com',
	leave_type_id: 1,
	start_date: '2026-08-17',
	end_date: '2026-08-19',
	start_half: 'full',
	end_half: 'full',
	days_total: 3,
	note: null,
	status: 'confirmed',
	created_at: '',
	cancelled_at: null,
	display_name: 'A',
	type_code: 'annual',
	type_label_en: 'Annual',
	type_label_th: 'ลาพักร้อน',
	color: '#2563eb',
	...over,
});
const none = new Set();

// --- one booking, cut to a span ----------------------------------------------

eq('within: a booking inside the span counts whole', daysWithin(entry(), '2026-08-01', '2026-08-31', none), 3);
eq('within: cut at the span\'s start', daysWithin(entry(), '2026-08-18', '2026-08-31', none), 2);
eq('within: cut at the span\'s end', daysWithin(entry(), '2026-08-01', '2026-08-17', none), 1);
eq('within: outside the span is nothing', daysWithin(entry(), '2026-09-01', '2026-09-30', none), 0);
eq('within: a holiday inside is free', daysWithin(entry(), '2026-08-01', '2026-08-31', new Set(['2026-08-18'])), 2);
eq('within: a weekend inside is free', daysWithin(entry({ start_date: '2026-08-21', end_date: '2026-08-24' }), '2026-08-01', '2026-08-31', none), 2);
{
	// Fri 28 Aug (from the afternoon) to Tue 1 Sep (to lunch): 0.5 + 1 + 0.5.
	const e = entry({ start_date: '2026-08-28', end_date: '2026-09-01', start_half: 'pm', end_half: 'am' });
	eq('within: halves count where they fall', daysWithin(e, '2026-08-01', '2026-09-30', none), 2);
	eq('within: August keeps the afternoon half', daysWithin(e, '2026-08-01', '2026-08-31', none), 1.5);
	eq('within: September keeps the morning half', daysWithin(e, '2026-09-01', '2026-09-30', none), 0.5);
}
eq('within: a slice of only weekend is zero, not an error', daysWithin(entry({ start_date: '2026-08-21', end_date: '2026-08-24' }), '2026-08-22', '2026-08-23', none), 0);

// --- per person, per type ---------------------------------------------------

{
	const rows = leaveSummary(
		[
			entry(),
			entry({ id: 'e2', start_date: '2026-08-25', end_date: '2026-08-25' }),
			entry({ id: 'e3', leave_type_id: 2, type_label_en: 'Sick', type_label_th: 'ลาป่วย', start_date: '2026-08-26', end_date: '2026-08-26' }),
			entry({ id: 'e4', user_email: 'b@x.com', display_name: 'B', start_date: '2026-08-20', end_date: '2026-08-20' }),
			entry({ id: 'e5', user_email: 'c@x.com', display_name: 'C', start_date: '2026-10-01', end_date: '2026-10-01' }),
		],
		'2026-08-01',
		'2026-08-31',
		none,
	);
	eq('summary: one row per person and type', rows.map((r) => `${r.name}/${r.typeEn}/${r.days}/${r.bookings}`).join(' '), 'A/Annual/4/2 A/Sick/1/1 B/Annual/1/1');
	check('summary: nobody outside the span', !rows.some((r) => r.name === 'C'), 'C included');
	eq('summary: carries the Thai label too', rows[1].typeTh, 'ลาป่วย');
}

// --- month by month -----------------------------------------------------------

{
	const months = monthlyDays(
		[entry({ start_date: '2026-08-28', end_date: '2026-09-01', start_half: 'pm', end_half: 'am' }), entry({ id: 'e2', leave_type_id: 2, start_date: '2026-09-02', end_date: '2026-09-02' })],
		2026,
		none,
	);
	eq('monthly: twelve months', months.length, 12);
	eq('monthly: August', months[7].total, 1.5);
	eq('monthly: September, two types', `${months[8].total} ${months[8].byType.get(1)} ${months[8].byType.get(2)}`, '1.5 0.5 1');
	eq('monthly: an empty month is zero', months[0].total, 0);
}

// --- CSV --------------------------------------------------------------------

{
	const csv = toCsv([['name', 'days'], ['Mai "M" Srisuk', 2.5], ['=HYPERLINK("x")', 1], ['ลาป่วย', 0]]);
	check('csv: starts with a byte order mark, for Excel and Thai', csv.startsWith('\uFEFF'), 'no BOM');
	check('csv: lines end CRLF', csv.includes('\r\n') && !/[^\r]\n/.test(csv), 'bare LF');
	check('csv: quotes are doubled', csv.includes('"Mai ""M"" Srisuk"'), csv);
	check('csv: a formula is defused', csv.includes('"\'=HYPERLINK(""x"")"'), csv);
	check('csv: numbers stay numbers', csv.includes('"2.5"') && !csv.includes("'2.5"), csv);
	check('csv: Thai passes through', csv.includes('"ลาป่วย"'), csv);
	check('csv: a negative-looking name is defused too', toCsv([['-1 day']]).includes("\"'-1 day\""), 'not defused');
}

// --- unused leave, for the year end -----------------------------------------
{
	const annual = { id: 1, code: 'annual', label_en: 'Annual', label_th: 'ลาพักร้อน', color: '#000', default_days: 10, counts_quota: 1, sort_order: 1, active: 1 };
	const person = (email, name, active = 1) => ({ email, display_name: name, active, is_admin: 0, week_start: 1, lang: 'en', created_at: '2026-01-01' });
	const users = [person('a@x.com', 'Anan'), person('b@x.com', 'Bee'), person('c@x.com', 'Chai'), person('gone@x.com', 'Gone', 0)];
	const quotas = [{ user_email: 'b@x.com', year: 2026, leave_type_id: 1, days_allotted: 15 }];
	const used = new Map([
		['a@x.com', new Map([[1, 4.5]])],
		['c@x.com', new Map([[1, 12], [2, 3]])],
	]);
	const rows = unusedLeave(users, annual, quotas, used);
	eq('unused: active people only', rows.map((r) => r.name).join(), 'Bee,Anan,Chai');
	eq('unused: their own allowance where one is set', rows[0].allotted, 15);
	eq('unused: the type\'s default where none is', rows[1].allotted, 10);
	eq('unused: a half day left is kept', rows[1].left, 5.5);
	eq('unused: overdrawn is negative, and last', rows[2].left, -2);
	eq('unused: other types do not count', rows[2].booked, 12);
}

console.log(failures === 0 ? '\nAll report tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
