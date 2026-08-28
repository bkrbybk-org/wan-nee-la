#!/usr/bin/env node
// Unit tests for src/domain/leave.ts — booking rules and balance arithmetic.
// Pure functions only: no D1, no bindings, every input a plain object literal.
// Run: npm run test:leave
import {
	byDate,
	computeBalances,
	draftPayload,
	halfOn,
	MAX_BACKDATE_DAYS,
	parseBooking,
	parseDraft,
	parseHalf,
	round,
	validateBooking,
	visibleNote,
} from '../src/domain/leave.ts';
import { defaultDisplayName } from '../src/repo/db.ts';

let failures = 0;
const check = (name, cond, detail) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` -> ${detail}`}`);
	if (!cond) failures++;
};
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------------------------------
// Fixtures. 2026-08-17 is a Monday; 2026-08-21 is the Friday of that week.
// ---------------------------------------------------------------------------------------

const TODAY = '2026-08-17';

const TYPES = [
	{ id: 1, code: 'annual', label_th: 'ลาพักร้อน', label_en: 'Annual', color: '#2563eb', default_days: 10, counts_quota: 1, sort_order: 1 },
	{ id: 2, code: 'sick', label_th: 'ลาป่วย', label_en: 'Sick', color: '#dc2626', default_days: 30, counts_quota: 1, sort_order: 2 },
	{ id: 4, code: 'unpaid', label_th: 'ลาไม่รับค่าจ้าง', label_en: 'Unpaid', color: '#64748b', default_days: 0, counts_quota: 0, sort_order: 4 },
];

function ctx(overrides = {}) {
	return {
		holidays: new Set(),
		existing: [],
		types: TYPES,
		remaining: new Map([[1, 10], [2, 30], [4, 0]]),
		today: TODAY,
		...overrides,
	};
}

function booking(overrides = {}) {
	return {
		leaveTypeId: 1,
		startDate: '2026-08-17',
		endDate: '2026-08-17',
		startHalf: 'full',
		endHalf: 'full',
		note: '',
		...overrides,
	};
}

const okDays = (name, res, want) =>
	check(name, res.ok && res.days === want, res.ok ? `got ${res.days}, want ${want}` : `errored: ${res.error?.key}`);

/**
 * Rejections are asserted by message key, not by wording.
 *
 * The domain returns `{ key, vars }` rather than a sentence, so tests name the
 * rule that fired instead of matching prose — which also means rewording a
 * message, or translating it, cannot turn a green test red.
 */
const rejects = (name, res, key) =>
	check(
		name,
		!res.ok && (!key || res.error.key === key),
		res.ok ? `expected rejection, booked ${res.days}d` : `error key was: ${res.error.key}`,
	);

// ---------------------------------------------------------------------------------------
// parseHalf / parseBooking — the untrusted-input boundary.
// ---------------------------------------------------------------------------------------

eq('parseHalf: full', parseHalf('full'), 'full');
eq('parseHalf: am', parseHalf('am'), 'am');
eq('parseHalf: garbage', parseHalf('morning'), null);
eq('parseHalf: number', parseHalf(1), null);
eq('parseHalf: undefined', parseHalf(undefined), null);

const p1 = parseBooking({ leaveTypeId: '1', startDate: '2026-08-17' });
check('parseBooking: blank end date means a single day', !('error' in p1) && p1.endDate === '2026-08-17', JSON.stringify(p1));
check('parseBooking: missing type', 'error' in parseBooking({ startDate: '2026-08-17' }), 'expected an error');
check('parseBooking: non-numeric type', 'error' in parseBooking({ leaveTypeId: 'x', startDate: '2026-08-17' }), 'expected an error');
check('parseBooking: bad date', 'error' in parseBooking({ leaveTypeId: '1', startDate: '17/08/2026' }), 'expected an error');
check('parseBooking: bad half', 'error' in parseBooking({ leaveTypeId: '1', startDate: '2026-08-17', startHalf: 'evening' }), 'expected an error');

const p2 = parseBooking({ leaveTypeId: '1', startDate: '2026-08-17', note: 'x'.repeat(900) });
check('parseBooking: note is truncated, not rejected', !('error' in p2) && p2.note.length === 500, 'note not clamped to 500');

// snake_case keys (a raw form post) are accepted alongside camelCase.
const p3 = parseBooking({ leave_type_id: '2', start_date: '2026-08-17', end_date: '2026-08-21', start_half: 'pm' });
check('parseBooking: snake_case form keys', !('error' in p3) && p3.leaveTypeId === 2 && p3.startHalf === 'pm', JSON.stringify(p3));

// ---------------------------------------------------------------------------------------
// validateBooking
// ---------------------------------------------------------------------------------------

okDays('single full day', validateBooking(booking(), ctx()), 1);
okDays('Mon–Fri', validateBooking(booking({ endDate: '2026-08-21' }), ctx()), 5);
okDays('half day', validateBooking(booking({ startHalf: 'am', endHalf: 'am' }), ctx()), 0.5);

rejects('unknown leave type', validateBooking(booking({ leaveTypeId: 99 }), ctx()), 'error.unknownType');
rejects('weekend booking', validateBooking(booking({ startDate: '2026-08-15', endDate: '2026-08-15' }), ctx()), 'error.notAWorkingDay');
rejects(
	'booking on a holiday',
	validateBooking(booking({ startDate: '2026-08-19', endDate: '2026-08-19' }), ctx({ holidays: new Set(['2026-08-19']) })),
	'error.notAWorkingDay',
);

// Overlap: the same day already booked blocks a second request.
rejects(
	'overlaps existing leave',
	validateBooking(booking({ endDate: '2026-08-21' }), ctx({ existing: [{ id: 'a', start_date: '2026-08-19', end_date: '2026-08-19' }] })),
	'error.overlap',
);
okDays(
	'adjacent but not overlapping is fine',
	validateBooking(booking({ startDate: '2026-08-24', endDate: '2026-08-25' }), ctx({ existing: [{ id: 'a', start_date: '2026-08-17', end_date: '2026-08-21' }] })),
	2,
);

// Quota.
rejects(
	'over quota',
	validateBooking(booking({ endDate: '2026-08-21' }), ctx({ remaining: new Map([[1, 3]]) })),
	'error.notEnough',
);
okDays('exactly the remaining balance', validateBooking(booking({ endDate: '2026-08-21' }), ctx({ remaining: new Map([[1, 5]]) })), 5);
// Unpaid leave has no allowance, so a zero balance must not block it.
okDays('unpaid leave ignores quota', validateBooking(booking({ leaveTypeId: 4, endDate: '2026-08-21' }), ctx()), 5);

// Backdating window.
okDays('backdated within the window', validateBooking(booking({ startDate: '2026-08-10', endDate: '2026-08-10' }), ctx()), 1);
rejects(
	'backdated beyond the window',
	validateBooking(booking({ startDate: '2026-01-05', endDate: '2026-01-05' }), ctx()),
	'error.tooFarBack',
);
check('MAX_BACKDATE_DAYS is a sane window', MAX_BACKDATE_DAYS >= 30 && MAX_BACKDATE_DAYS <= 365, `got ${MAX_BACKDATE_DAYS}`);
rejects(
	'typo\'d year far in the future',
	// 2126-08-19 is a Monday, so this fails the future-window check rather than
	// the weekend check.
	validateBooking(booking({ startDate: '2126-08-19', endDate: '2126-08-19' }), ctx()),
	'error.tooFarAhead',
);

// ---------------------------------------------------------------------------------------
// computeBalances
// ---------------------------------------------------------------------------------------

const quotas = [
	{ user_email: 'a@x.com', year: 2026, leave_type_id: 1, days_allotted: 10 },
	{ user_email: 'a@x.com', year: 2026, leave_type_id: 2, days_allotted: 30 },
];
const balances = computeBalances(TYPES, quotas, new Map([[1, 2.5]]));

eq('balances: one row per type', balances.length, 3);
eq('balances: sorted by sort_order', balances[0].type.code, 'annual');
eq('balances: allotted', balances[0].allotted, 10);
eq('balances: used', balances[0].used, 2.5);
eq('balances: remaining', balances[0].remaining, 7.5);
eq('balances: untouched type keeps the full allowance', balances[1].remaining, 30);
eq('balances: unpaid has no remaining', balances[2].remaining, 0);
eq('balances: missing quota row reads as zero', computeBalances(TYPES, [], new Map())[0].allotted, 0);

// Float subtraction must not leak 7.499999999999999 onto a dashboard.
eq('round: half-day precision', round(10 - 2.5), 7.5);
eq('round: float noise', round(0.1 + 0.2 - 0.3 + 9), 9);

// ---------------------------------------------------------------------------------------
// byDate / halfOn — calendar placement
// ---------------------------------------------------------------------------------------

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

const idx = byDate([entry()]);
eq('byDate: covers every day in the range', idx.size, 3);
check('byDate: includes the start', idx.has('2026-08-17'), 'missing start');
check('byDate: includes the middle', idx.has('2026-08-18'), 'missing middle');
check('byDate: includes the end', idx.has('2026-08-19'), 'missing end');
check('byDate: excludes the day after', !idx.has('2026-08-20'), 'leaked past the end');

const two = byDate([entry(), entry({ id: 'e2', display_name: 'B' })]);
eq('byDate: two people on one day', two.get('2026-08-18').length, 2);

// A range crossing a month boundary must not drop days.
eq('byDate: spans month end', byDate([entry({ start_date: '2026-08-30', end_date: '2026-09-02' })]).size, 4);

const halves = entry({ start_half: 'pm', end_half: 'am' });
eq('halfOn: start day', halfOn(halves, '2026-08-17'), 'pm');
eq('halfOn: middle day is always full', halfOn(halves, '2026-08-18'), 'full');
eq('halfOn: end day', halfOn(halves, '2026-08-19'), 'am');
eq(
	'halfOn: single-day entry uses its own half',
	halfOn(entry({ start_date: '2026-08-17', end_date: '2026-08-17', start_half: 'am', end_half: 'am' }), '2026-08-17'),
	'am',
);

// ---------------------------------------------------------------------------------------
// defaultDisplayName
// ---------------------------------------------------------------------------------------

eq('displayName: dotted local part', defaultDisplayName('chatchai.w@example.com'), 'Chatchai W');
eq('displayName: underscores', defaultDisplayName('some_one@example.com'), 'Some One');
eq('displayName: plain', defaultDisplayName('bob@example.com'), 'Bob');

// ---------------------------------------------------------------------------------------
// Note visibility — one rule, used by the calendar, the popup and the JSON feed.
// ---------------------------------------------------------------------------------------

const owner = { email: 'mai@example.com', is_admin: 0 };
const colleague = { email: 'bob@example.com', is_admin: 0 };
const admin = { email: 'boss@example.com', is_admin: 1 };
const privateEntry = { note: 'oncology follow-up', note_private: 1, user_email: 'mai@example.com' };
const sharedEntry = { note: 'team offsite', note_private: 0, user_email: 'mai@example.com' };

eq('private note: the author reads it', visibleNote(privateEntry, owner), 'oncology follow-up');
eq('private note: an admin reads it', visibleNote(privateEntry, admin), 'oncology follow-up');
eq('private note: a colleague does not', visibleNote(privateEntry, colleague), null);
eq('shared note: a colleague reads it', visibleNote(sharedEntry, colleague), 'team offsite');
eq('no note at all is null, not empty string', visibleNote({ note: null, note_private: 0, user_email: 'mai@example.com' }, admin), null);
// An empty string is not a note; rendering "Note:" with nothing after it is worse than omitting the row.
eq('an empty note is null', visibleNote({ note: '', note_private: 0, user_email: 'mai@example.com' }, owner), null);

// ---------------------------------------------------------------------------------------
// Note visibility on the way in — an unchecked box submits nothing at all.
// ---------------------------------------------------------------------------------------

const base = { leaveTypeId: '1', startDate: '2026-08-17', note: 'x' };
eq('note is private when the box is unticked', parseBooking(base).notePrivate, true);
eq('note is shared when the box is ticked', parseBooking({ ...base, noteVisibility: 'shared' }).notePrivate, false);
eq('an unexpected value falls back to private', parseBooking({ ...base, noteVisibility: 'yes' }).notePrivate, true);
eq('an empty value falls back to private', parseBooking({ ...base, noteVisibility: '' }).notePrivate, true);

// ---------------------------------------------------------------------------------------
// The rejected booking carried back to the form through the flash cookie.
// ---------------------------------------------------------------------------------------

const rejected = parseBooking({
	leaveTypeId: '1',
	startDate: '2026-09-01',
	endDate: '2026-10-15',
	startHalf: 'pm',
	endHalf: 'am',
	note: 'conference',
	noteVisibility: 'shared',
});

const roundTrip = parseDraft(JSON.parse(JSON.stringify(draftPayload(rejected))));
eq('draft round-trip: leave type', roundTrip.leaveTypeId, 1);
eq('draft round-trip: start date', roundTrip.startDate, '2026-09-01');
eq('draft round-trip: end date', roundTrip.endDate, '2026-10-15');
eq('draft round-trip: start half', roundTrip.startHalf, 'pm');
eq('draft round-trip: end half', roundTrip.endHalf, 'am');
eq('draft round-trip: note', roundTrip.note, 'conference');
eq('draft round-trip: note stays shared', roundTrip.notePrivate, false);

// A dropped note and a cleared one have to stay distinguishable, or redisplaying
// a rejected edit wipes a note the reader never touched.
eq('a dropped note comes back undefined', parseDraft(draftPayload({ ...rejected, note: undefined })).note, undefined);
eq('a cleared note comes back empty', parseDraft(draftPayload({ ...rejected, note: '' })).note, '');

// The cookie round-trips through the client, so what comes back is untrusted.
eq('a draft that is not an object is rejected', parseDraft('not a draft'), null);
eq('a null draft is rejected', parseDraft(null), null);
eq('a non-numeric leave type is rejected', parseDraft({ ...draftPayload(rejected), t: '1' }), null);
eq('a zero leave type is rejected', parseDraft({ ...draftPayload(rejected), t: 0 }), null);
eq('an impossible date is rejected', parseDraft({ ...draftPayload(rejected), s: '2026-02-30' }), null);
eq('a missing end date is rejected', parseDraft({ ...draftPayload(rejected), e: undefined }), null);
eq('an unknown half is rejected', parseDraft({ ...draftPayload(rejected), sh: 'evening' }), null);
eq('a non-string note is rejected', parseDraft({ ...draftPayload(rejected), n: 42 }), null);
eq('an over-long note is cut to NOTE_MAX', parseDraft({ ...draftPayload(rejected), n: 'x'.repeat(600) }).note.length, 500);
// Same safe direction as an unticked checkbox: only an explicit false shares.
eq('a missing privacy flag falls back to private', parseDraft({ ...draftPayload(rejected), p: undefined }).notePrivate, true);
eq('a junk privacy flag falls back to private', parseDraft({ ...draftPayload(rejected), p: 'no' }).notePrivate, true);

console.log(failures === 0 ? '\nAll leave tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
