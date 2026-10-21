import {
	dayOfWeek,
	describeRange,
	formatDays,
	monthGrid,
	monthName,
	monthShort,
	parseWeekStart,
	shiftMonth,
	shortDate,
	longDate,
	intoWeeks,
	weekdayLabels,
	weekdayName,
	MONDAY,
} from '../domain/dates.ts';
import { byDate, halfOn, visibleNote, weekLanes, type BookingDraft, type WeekSegment } from '../domain/leave.ts';
import { initials, personKey, shortName } from './person.ts';
import { PersonColorsProvider, useColorOf } from './site.tsx';
import type { Half, Holiday, LeaveEntry, LeaveType, User } from '../types.ts';
import { FlashBanner, HolidaysDueBanner, Layout } from './layout.tsx';
import type { HolidayGap } from '../domain/holidays.ts';
import { BookingForm } from './booking.tsx';
import { SelectField } from './fields.tsx';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DeleteIcon, EditIcon, PlusIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { t as translate, toLang, type Lang } from '../i18n/strings.ts';

interface CalendarProps {
	user: User;
	year: number;
	month: number;
	entries: LeaveEntry[];
	/** Everything from today forward, independent of the month being browsed. */
	upcoming: LeaveEntry[];
	/** For admins: next year's holidays look unentered — see `holidayGap`. */
	holidaysDue: HolidayGap | null;
	/** For an admin, who they may book for; see `BookingForm`. */
	people?: { key: string; name: string }[];
	/** Each person's badge colour, by email, in sign-up order. */
	colors: ReadonlyMap<string, string>;
	holidays: Holiday[];
	types: LeaveType[];
	today: string;
	version?: string;
	error?: string;
	/** The booking-form input the last submission was rejected over, if any. */
	errorField?: string;
	notice?: string;
	/**
	 * A booking the server just rejected. The create dialog is closed on load, so
	 * this does not confront anyone with a form — it is there for the reader who
	 * reopens the dialog after reading the banner, holding what they typed.
	 */
	draft?: BookingDraft;
	/** The booking whose last change this page is offering to undo. */
	undo?: string;
}

/**
 * A leave type's own name, in the reader's language.
 *
 * These come from the seed data, not from the string catalogue — they are the
 * admin's to rename, and both languages are already stored alongside each
 * other.
 */
function typeLabel(e: { type_label_en: string; type_label_th: string }, lang: Lang): string {
	return lang === 'th' ? e.type_label_th : e.type_label_en;
}

/**
 * How many names a cell draws before it counts the rest instead.
 *
 * Kept in step with the `nth-of-type` rule in app.css that hides the others —
 * change one and the count stops matching what is on screen.
 */
const CELL_CHIPS = 3;

/**
 * Dots a phone's 48px cell shows before it shows a number instead. Three fit
 * on one row; a fourth wraps, and by six they are a cluster to be counted.
 */
const PHONE_DOTS = 3;

/**
 * How far ahead the sidebar looks.
 *
 * Exported so the route that fetches the window and the view that describes it
 * cannot disagree — they were two constants with a comment asking them to
 * match, which is the setup for a quiet drift.
 */
export const UPCOMING_DAYS = 90;

/**
 * What is coming up, in the sidebar.
 *
 * Anchored to today rather than to the month on screen: paging back to April
 * should not change the answer to "who is away soon". Grouped by day, because
 * a flat list repeats the same date down the column and the question is
 * usually about a day rather than about a person.
 *
 * Each row carries the same data attributes as a calendar chip, so the detail
 * popup opens from here too without a second code path.
 */
function UpcomingList({
	entries,
	today,
	user,
	lang,
}: {
	entries: readonly LeaveEntry[];
	today: string;
	user: User;
	lang: Lang;
}) {
	const t = useT();
	const colorOf = useColorOf();
	const canEdit = (e: LeaveEntry) => e.user_email === user.email || Boolean(user.is_admin);

	// One row per booking, under the day it starts. It used to be one row per
	// person per day, so a fortnight away was ten identical rows and the list
	// ran out of room after a week. Anything already under way sits under
	// "Today", saying when it ends.
	const byDay = new Map<string, LeaveEntry[]>();
	for (const e of [...entries].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.display_name.localeCompare(b.display_name))) {
		if (e.end_date < today) continue;
		const key = e.start_date > today ? e.start_date : today;
		byDay.set(key, [...(byDay.get(key) ?? []), e]);
	}
	const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	const when = (e: LeaveEntry) =>
		e.start_date < today && e.end_date > today
			? t('cal.until', { date: shortDate(e.end_date, lang) })
			: describeRange(e.start_date, e.end_date, e.start_half, e.end_half, lang);

	return (
		<section class="cal-upcoming">
			<h2>{t('cal.upcoming')}</h2>
			{days.length === 0 ? (
				// The empty message already names the window, so the caption below
				// would only say it twice.
				<p class="muted">{t('cal.nothingUpcoming', { days: UPCOMING_DAYS })}</p>
			) : (
				<>
					{/* The list is anchored to today, not to the month on screen.
					    Without saying so, paging forward to November and still
					    seeing September reads as a bug rather than as the point. */}
					<p class="upcoming-window">{t('cal.upcomingWindow', { days: UPCOMING_DAYS })}</p>
					<ol class="upcoming-list">
						{days.map(([date, dayEntries]) => (
							<li class={`upcoming-day ${date === today ? 'today' : ''}`}>
								<p class="upcoming-date">{date === today ? t('cal.today') : longDate(date, lang)}</p>
								{dayEntries.map((e) => (
									<a
										class={`upcoming-item ${canEdit(e) ? 'mine' : ''}`}
										data-who={personKey(e.user_email)}
										href={canEdit(e) ? `/leave/${e.id}/edit` : '#'}
										aria-label={rangeLabel(e, lang)}
										{...entryData(e, canEdit(e), visibleNote(e, user), lang)}
									>
										<span class="badge" style={`--who: ${colorOf(e.user_email)}`} aria-hidden="true">
											{initials(e.display_name)}
										</span>
										<span class="upcoming-who">
											<span class="upcoming-name">{e.display_name}</span>
											<span class="upcoming-when">
												{when(e)} · {t('cal.dayCount', { n: formatDays(e.days_total), count: e.days_total })}
											</span>
										</span>
										<span class="upcoming-type">
											<span class="dot" style={`--chip: ${e.color}`} aria-hidden="true" />
											{typeLabel(e, lang)}
										</span>
									</a>
								))}
							</li>
						))}
					</ol>
				</>
			)}
		</section>
	);
}

function halfMark(h: Half, lang: Lang): string {
	return h === 'am' ? translate(lang, 'cal.markAm') : h === 'pm' ? translate(lang, 'cal.markPm') : '';
}

/**
 * A week's leave as bars, each one a single piece across the days it covers.
 *
 * Laid out on its own grid of seven equal columns, over the row of cells, so a
 * bar can run from Monday to Friday — something a cell, which clips what it
 * holds, cannot do. It sits in the week's first cell only because a table row
 * cannot hold anything but cells; positioned from there it spans all seven.
 *
 * The stripe and tint still mean the leave type. The badge is the person, in a
 * colour of their own (src/views/person.ts). A bar cut by the edge of the week
 * loses its rounded end on that side, which is how it says it carries on.
 *
 * Every bar keeps the chip's data attributes, so a click opens the same detail
 * popup and drag-to-move works on it as it did on a chip.
 */
function WeekBars(props: {
	week: readonly string[];
	segs: readonly WeekSegment[];
	heldBack: readonly number[];
	monthPrefix: string;
	today: string;
	map: Map<string, LeaveEntry[]>;
	canEdit: (e: LeaveEntry) => boolean;
	noteFor: (e: LeaveEntry) => string | null;
}) {
	const { week, segs, heldBack, monthPrefix, today, map, canEdit, noteFor } = props;
	const lang = useLang();
	const colorOf = useColorOf();
	return (
		<div class="week-bars">
			{segs.map((s) => {
				const e = s.entry;
				const days = week.slice(s.col, s.col + s.span);
				const outside = days.every((d) => !d.startsWith(monthPrefix));
				// A one-day piece says which half; a longer one leaves that to its
				// label and popup, where the whole range is spelled out.
				const half = s.span === 1 && !s.continuesBefore && !s.continuesAfter ? halfMark(halfOn(e, days[0]), lang) : '';
				const classes = [
					'chip',
					'bar',
					canEdit(e) ? 'mine' : '',
					s.continuesBefore ? 'cont-before' : '',
					s.continuesAfter ? 'cont-after' : '',
					outside ? 'out' : '',
					// Finished entirely. A bar still running today stays at full
					// strength — it is not in the past, only its start is.
					days[days.length - 1] < today ? 'past' : '',
				]
					.filter(Boolean)
					.join(' ');
				return (
					<a
						class={classes}
						href={canEdit(e) ? `/leave/${e.id}/edit` : '#'}
						style={`--chip: ${e.color}; grid-column: ${s.col + 1} / span ${s.span}; grid-row: ${s.lane + 1}`}
						title={`${e.display_name} — ${typeLabel(e, lang)}${noteFor(e) ? `: ${noteFor(e)}` : ''}`}
						aria-label={rangeLabel(e, lang)}
						data-who={personKey(e.user_email)}
						{...entryData(e, canEdit(e), noteFor(e), lang)}
					>
						<span class="badge" style={`--who: ${colorOf(e.user_email)}`} aria-hidden="true">
							{initials(e.display_name)}
						</span>
						{/* First name and an initial: the surname is what was being cut
						    off with an ellipsis in every cell. The tooltip, the label
						    and the popup all keep the full name. */}
						<span class="bar-name" aria-hidden="true">
							{shortName(e.display_name)}
							{half}
						</span>
					</a>
				);
			})}
			{heldBack.map((n, c) =>
				n > 0 ? (
					<div class="bar-more" style={`grid-column: ${c + 1}; grid-row: ${CELL_CHIPS + 1}`}>
						<DayMore date={week[c]} entries={map.get(week[c]) ?? []} hidden={n} canEdit={canEdit} noteFor={noteFor} />
					</div>
				) : null,
			)}
		</div>
	);
}

/** What a screen reader hears for a bar: who, what, and the whole range. */
function rangeLabel(e: LeaveEntry, lang: Lang): string {
	return translate(lang, 'cal.entryLabel', {
		name: e.display_name,
		type: typeLabel(e, lang),
		part: '',
		date: describeRange(e.start_date, e.end_date, e.start_half, e.end_half, lang),
	});
}

/** "18–21 Oct", or "30 Oct – 2 Nov" across a month end. */
function spanLabel(start: string, end: string, lang: Lang): string {
	if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8, 10))}–${shortDate(end, lang)}`;
	return `${shortDate(start, lang)} – ${shortDate(end, lang)}`;
}

/**
 * "+2 more", and the list it opens.
 *
 * A native popover rather than a script-built dialog: `popovertarget` wires the
 * button to the panel with no JavaScript at all, the browser handles focus,
 * Escape and click-outside, and the panel renders in the top layer, so the
 * cell's clipping cannot cut it off. The calendar is built to work with
 * scripting off, and this keeps that true.
 *
 * Every entry for the day is listed, not only the hidden ones — someone asking
 * "who's out on the 8th" wants the whole answer in one place. Each row carries
 * the same data attributes as a chip, so a click opens the same detail popup.
 * The rows are deliberately not `.chip`: drag-to-move picks those up, and a
 * list in a floating panel is not somewhere to drag from.
 */
function DayMore(props: {
	date: string;
	entries: LeaveEntry[];
	/** How many of the day's people have no bar showing. */
	hidden: number;
	canEdit: (e: LeaveEntry) => boolean;
	noteFor: (e: LeaveEntry) => string | null;
}) {
	const { date, entries, hidden, canEdit, noteFor } = props;
	const t = useT();
	const lang = useLang();
	const colorOf = useColorOf();
	const id = `more-${date}`;
	return (
		<>
			<button
				type="button"
				class="chip-more"
				popovertarget={id}
				aria-label={t('cal.seeAll', { n: entries.length, count: entries.length, date: longDate(date, lang) })}
			>
				{t('cal.more', { n: hidden })}
			</button>
			<div id={id} popover="auto" class="popup day-more" aria-label={longDate(date, lang)}>
				<div class="popup-head">
					<h2>{longDate(date, lang)}</h2>
					<button type="button" class="icon-btn popup-x" popovertarget={id} popovertargetaction="hide" aria-label={t('popup.close')}>
						<CloseIcon />
					</button>
				</div>
				<ul class="day-more-list">
					{entries.map((e) => (
						<li>
							<a
								class="day-more-item"
								data-who={personKey(e.user_email)}
								href={canEdit(e) ? `/leave/${e.id}/edit` : '#'}
								style={`--chip: ${e.color}`}
								aria-label={entryLabel(e, date, lang)}
								{...entryData(e, canEdit(e), noteFor(e), lang)}
							>
								<span class="badge" style={`--who: ${colorOf(e.user_email)}`} aria-hidden="true">
									{initials(e.display_name)}
								</span>
								<span class="day-more-name" aria-hidden="true">
									{e.display_name}
									{halfMark(halfOn(e, date), lang)}
								</span>
								<span class="day-more-type muted" aria-hidden="true">
									<span class="dot" />
									{typeLabel(e, lang)}
								</span>
							</a>
						</li>
					))}
				</ul>
			</div>
		</>
	);
}

/**
 * What a screen reader hears for one entry.
 *
 * The visible chip is just a name, which is enough when you can see which cell
 * it sits in. Read aloud in a list of links, five identical names carry no
 * information at all, so the date and leave type are spoken too.
 */
function entryLabel(e: LeaveEntry, date: string, lang: Lang): string {
	const half = halfOn(e, date);
	const part = half === 'am' ? translate(lang, 'cal.halfAm') : half === 'pm' ? translate(lang, 'cal.halfPm') : '';
	return translate(lang, 'cal.entryLabel', {
		name: e.display_name,
		type: typeLabel(e, lang),
		part,
		date: longDate(date, lang),
	});
}

/**
 * Everything the detail popup shows, hung off the element the user clicks.
 *
 * The popup is built from these attributes rather than fetched, so opening one
 * costs no request and works the instant the page renders.
 *
 * `data-note` is the one field here a colleague could not otherwise read off
 * the page, so it is filtered rather than emitted: a note marked private never
 * reaches the HTML at all for anyone but its author and admins. Hiding it in
 * the popup instead would ship the text to every browser and rely on CSS to
 * keep a secret (ISSUES.md #17).
 */
function entryData(e: LeaveEntry, canEdit: boolean, note: string | null, lang: Lang) {
	return {
		'data-entry': e.id,
		'data-name': e.display_name,
		'data-type': typeLabel(e, lang),
		'data-color': e.color,
		'data-when': describeRange(e.start_date, e.end_date, e.start_half, e.end_half, lang),
		'data-days': formatDays(e.days_total),
		'data-note': note ?? '',
		// Carried so drag-to-move can preserve it; without this every dragged
		// booking's note would fall back to private. Only for people who may
		// drag the chip, since to anyone else it would quietly announce that a
		// note exists and is being kept from them.
		'data-note-private': canEdit && e.note_private ? '1' : '',
		'data-can-edit': canEdit ? '1' : '',
		// Raw values, not for display — drag-to-move rebuilds the booking from
		// these rather than parsing the human-readable data-when/data-type back apart.
		'data-type-id': e.leave_type_id,
		'data-start-date': e.start_date,
		'data-end-date': e.end_date,
		'data-start-half': e.start_half,
		'data-end-half': e.end_half,
	};
}

export function CalendarPage(props: CalendarProps) {
	return (
		<Layout
			title={`${monthName(props.month, toLang(props.user.lang))} ${props.year}`}
			user={props.user}
			active="calendar"
			version={props.version}
			fitViewport
		>
			<PersonColorsProvider value={props.colors}>
				<CalendarBody {...props} />
			</PersonColorsProvider>
		</Layout>
	);
}

/** Inside the Layout, so `useT` sees the language the Layout provides. */
function CalendarBody(props: CalendarProps) {
	const { user, year, month, entries, upcoming, holidaysDue, holidays, types, today, error, errorField, notice, draft, undo } = props;
	const t = useT();
	const lang = useLang();
	// Presentation only: rotating the columns changes no arithmetic, and Saturday
	// and Sunday stay the weekend whichever day the week opens on.
	const weekStart = parseWeekStart(user.week_start) ?? MONDAY;
	const grid = monthGrid(year, month, weekStart);
	const weekdays = weekdayLabels(weekStart, lang);
	const weeks = intoWeeks(grid);
	const holidayMap = new Map(holidays.map((h) => [h.date, h.label]));
	// Who is away on each day — weekends and holidays inside a booking left
	// out, here and in the desktop's bars alike.
	const holidayDates = new Set(holidayMap.keys());
	const map = byDate(entries, holidayDates);
	const prev = shiftMonth(year, month, -1);
	const next = shiftMonth(year, month, 1);
	const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
	// Enough to cover a year already booked and the one being planned. The
	// route clamps anything outside this anyway.
	const thisYear = Number(today.slice(0, 4));
	const years = Array.from({ length: 5 }, (_, i) => thisYear - 1 + i);

	const canEdit = (e: LeaveEntry) => e.user_email === user.email || Boolean(user.is_admin);
	// Resolved once per entry, here, so the chip's tooltip and the popup's data
	// attributes cannot disagree about what this viewer may read.
	const noteFor = (e: LeaveEntry) => visibleNote(e, user);

	// The phone's day list. Every day of the month has a row, because with
	// scripting on the list shows one day at a time — the one tapped in the grid
	// — and an empty day has to be able to say so. Without scripting the whole
	// list shows, and CSS hides the empty rows: a screen of blank dates is
	// scrolling for no reason.
	const agenda = grid
		.filter((d) => d.startsWith(monthPrefix))
		.map((d) => ({ date: d, entries: map.get(d) ?? [], holiday: holidayMap.get(d) }));
	// The day it opens on: today, when today is in this month; otherwise the
	// first day anyone is away, so paging to next month lands on something.
	const selectedDay = agenda.some((r) => r.date === today)
		? today
		: (agenda.find((r) => r.entries.length > 0)?.date ?? agenda[0]?.date);

	return (
		<>
			<FlashBanner error={error} notice={notice} undo={undo} />
			{/* Admins only. Here as well as on /admin, because nobody opens /admin
			    in November unless something sends them there. */}
			{holidaysDue ? (
				// A phone keeps the two-line strip; from 768px it is a chip in the
				// month's header, so the month gets the 70px the strip took.
				<div class="cal-due">
					<HolidaysDueBanner gap={holidaysDue} link />
				</div>
			) : null}

			<div class="month-head">
				{/* Ahead of the heading, not after it, so stepping through the year
				    does not move the thing you are clicking. Month names differ in
				    length in both languages — May against September, ก.พ. against
				    ธ.ค. — and buttons that followed the name shifted sideways on
				    every press, which is how a run of clicks lands on the wrong
				    one. Their own position is now fixed and only the label
				    changes. */}
				<a class="icon-btn" data-month-prev href={`/?y=${prev.year}&m=${prev.month}`} aria-label={t('cal.prevMonth')}>
					<ChevronLeftIcon />
				</a>
				<a class="icon-btn" data-month-next href={`/?y=${next.year}&m=${next.month}`} aria-label={t('cal.nextMonth')}>
					<ChevronRightIcon />
				</a>
				{/* The heading is the control. Stepping a month at a time is fine for
				    next week and useless for next January — five clicks to get
				    there, and five back. A disclosure keeps the header as quiet as
				    it was while putting any month one interaction away.

				    A plain GET form, so it works with scripting off, the result is
				    a URL that can be bookmarked or shared, and the browser's own
				    back button undoes it. */}
				<h1>
					{/* Both forms are sent and CSS picks one. "September 2026" is
					    166px at a phone's heading size, and beside three icon
					    buttons and Today it pushed Today off the right edge of a
					    375px screen. Only one is ever displayed, so a screen reader
					    hears one name, not two. */}
					<span class="m-long">{monthName(month, lang)}</span>
					<span class="m-short">{monthShort(month, lang)}</span> <span class="muted">{year}</span>
				</h1>
				{/* The heading stays a heading. Wrapping it in the summary made the
				    control ambiguous to assistive technology — the disclosure was
				    exposed as a plain container, so neither its purpose nor its
				    expanded state was announced. A named control beside it is
				    unambiguous and just as easy to find. */}
				<details class="month-jump">
					<summary class="icon-btn" aria-label={t('cal.jump')} title={t('cal.jump')}>
						<ChevronDownIcon />
					</summary>
					<form method="get" action="/" class="month-jump-form">
						<SelectField id="jump-month" name="m" label={t('cal.month')}>
							{Array.from({ length: 12 }, (_, i) => (
								<option value={String(i + 1)} selected={i + 1 === month}>
									{monthName(i + 1, lang)}
								</option>
							))}
						</SelectField>
						<SelectField id="jump-year" name="y" label={t('cal.year')}>
							{years.map((y) => (
								<option value={String(y)} selected={y === year}>
									{y}
								</option>
							))}
						</SelectField>
						<button type="submit" class="btn tonal">{t('cal.go')}</button>
					</form>
				</details>
				{holidaysDue ? (
					<a
						class="due-chip"
						href={`/admin/holidays?y=${holidaysDue.year}`}
						title={t('admin.holidaysDue', { year: holidaysDue.year, have: holidaysDue.have })}
					>
						{t('cal.holidaysDueShort', { year: holidaysDue.year })}
					</a>
				) : null}
				<a class="btn text today-link" href="/">{t('cal.today')}</a>
				{/* Beside Today rather than on a row of its own above the grid, which
				    cost the month a week's worth of height on a laptop. A real link:
				    the client script opens the dialog instead. */}
				<a class="btn primary book-head" href="/book" data-book-link>
					<PlusIcon class="sm" />
					{t('cal.book')}
				</a>
			</div>

			{/* A phone's Book button, bottom right where a thumb reaches it. Round
			    from the start: as an extended FAB it covered the day card's rows
			    until the page was scrolled. The day card carries its own Book
			    button, and the script moves this one aside while the card is on
			    screen (client/calendar.ts), so it never sits on a name. */}
			<a class="fab fab-mini" href="/book" data-book-link data-fab aria-label={t('cal.book')}>
				<PlusIcon />
				<span class="fab-label">{t('cal.book')}</span>
			</a>

			{/* Both halves empty is the common case in a quiet week, and two cards
			{/* Two columns on a wide screen: the month on the left, and what is
			    coming up on the right. On a phone they stack, the month first —
			    the sidebar is where a laptop's spare width goes, not something a
			    narrow screen has to make room for. */}
			<div class="cal-layout">
				<div class="cal-main">
				<section class="grid-view">
					<table class="grid">
						<caption class="visually-hidden">{t('cal.title', { month: monthName(month, lang), year })}</caption>
						<thead>
							<tr>
								{weekdays.map((w) => (
									<th scope="col" class={`weekhead-cell ${w === 'Sat' || w === 'Sun' ? 'weekend' : ''}`}>
										{w}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{weeks.map((week) => {
								// Bars for the week, laid out once. Rows past CELL_CHIPS are
								// not drawn; each day they would have covered says how many
								// it holds back instead.
								const segs = weekLanes(week, entries, holidayDates);
								const shown = segs.filter((s) => s.lane < CELL_CHIPS);
								const heldBack = week.map(
									(_, c) => segs.filter((s) => s.lane >= CELL_CHIPS && c >= s.col && c < s.col + s.span).length,
								);
								const lanes = Math.min(CELL_CHIPS, segs.reduce((m, s) => Math.max(m, s.lane + 1), 0)) +
									(heldBack.some((n) => n > 0) ? 1 : 0);
								return (
								<tr>
									{week.map((date, col) => {
										const inMonth = date.startsWith(monthPrefix);
										const weekend = dayOfWeek(date) === 0 || dayOfWeek(date) === 6;
										const holiday = holidayMap.get(date);
										const dayEntries = map.get(date) ?? [];
										const classes = [
											'cell',
											col === 0 ? 'week-start' : '',
											inMonth ? '' : 'out',
											weekend ? 'weekend' : '',
											holiday ? 'holiday' : '',
											date === today ? 'today' : '',
											date === selectedDay ? 'selected' : '',
											dayEntries.length > PHONE_DOTS ? 'many' : '',
											// Faded, not locked: leave can still be booked into the
											// past — sick leave usually is — so this is a cue only.
											date < today ? 'past' : '',
										]
											.filter(Boolean)
											.join(' ');
										return (
											<td class={classes} aria-current={date === today ? 'date' : undefined}>
												{/* Covers the cell's empty space. Sits under the chips so a
												    click on an entry opens that entry rather than the
												    booking form. */}
												{/* The day's surface, kept for drag-to-move, which finds the
												    day under the pointer through it (client/drag.ts). Where a
												    day can be selected, the layer above it takes the click and
												    the + below books, so it is out of the tab order there. */}
												<a
													class="cell-add"
													href={`/book?date=${date}`}
													data-book-link
													data-date={date}
													aria-label={t('cal.bookOn', { date: longDate(date, lang) })}
													tabindex={dayEntries.length > 0 || inMonth ? -1 : undefined}
													aria-hidden={dayEntries.length > 0 || inMonth ? 'true' : undefined}
												></a>
												{/* Phones only. A cell is about 48px wide there — too narrow
												    for names, and far too narrow to tap one of several. So the
												    whole cell is one target, and the script turns a tap into
												    "show this day in the card under the grid", empty days
												    included. Without the script it is still a real link: into
												    the list for a busy day, to the booking page for an empty
												    one, which is what the cell offered before. */}
												{dayEntries.length > 0 || inMonth ? (
													<a
														class="cell-day"
														href={dayEntries.length > 0 ? `#d-${date}` : `/book?date=${date}`}
														data-day={date}
														aria-label={t('cal.seeDay', { date: longDate(date, lang) })}
													></a>
												) : null}
												{/* Laptops: clicking a day shows it in the panel beside the
												    month, as a tap does on a phone, so booking is this +,
												    shown on hover and focus. */}
												{inMonth ? (
													<a
														class="cell-plus"
														href={`/book?date=${date}`}
														data-book-link
														data-date={date}
														aria-label={t('cal.bookOn', { date: longDate(date, lang) })}
													>
														<PlusIcon class="sm" />
													</a>
												) : null}
												<div class="cell-head">
													<span class="daynum" aria-hidden="true">{Number(date.slice(8, 10))}</span>
													{/* The number alone reads as a bare digit out of context, so the
													    full date is announced instead and the digit is hidden. */}
													<span class="visually-hidden">{longDate(date, lang)}</span>
													{holiday ? <span class="holiday-tag" title={holiday}>{holiday}</span> : null}
												</div>
												{/* Phones only, on a busy day: a number reads at a glance
												    where five or six dots wrap into a cluster that has to be
												    counted. Hidden from assistive technology, which hears the
												    cell's date and then the day card. */}
												{dayEntries.length > PHONE_DOTS ? (
													<span class="day-count" aria-hidden="true">{dayEntries.length}</span>
												) : null}
												{/* Phones only: each person away is a coloured dot, because
												    a 48px cell has room for nothing else. On a wider screen
												    these are hidden and the week's bars below take over. */}
												<div class="chips">
													{dayEntries.map((e) => (
														<a
															class={`chip ${canEdit(e) ? 'mine' : ''}`}
															href={canEdit(e) ? `/leave/${e.id}/edit` : '#'}
															style={`--chip: ${e.color}`}
															title={`${e.display_name} — ${typeLabel(e, lang)}${noteFor(e) ? `: ${noteFor(e)}` : ''}`}
															aria-label={entryLabel(e, date, lang)}
															{...entryData(e, canEdit(e), noteFor(e), lang)}
														>
															<span aria-hidden="true">
																{e.display_name}
																{halfMark(halfOn(e, date), lang)}
															</span>
														</a>
													))}
												</div>
												{/* The bars live in a layer above the cells, so they no longer
												    make a row grow. This reserves the room they need, so a
												    busy week still gets a taller row. */}
												<span class="lane-space" aria-hidden="true" style={`--lanes: ${lanes}`}></span>
												{col === 0 ? (
													<WeekBars
														week={week}
														segs={shown}
														heldBack={heldBack}
														monthPrefix={monthPrefix}
														today={today}
														map={map}
														canEdit={canEdit}
														noteFor={noteFor}
													/>
												) : null}
											</td>
										);
									})}
								</tr>
								);
							})}
						</tbody>
					</table>
				</section>

				{/* Both languages, whichever the reader has chosen: the legend is where
				    someone learns that ลาป่วย and Sick leave are the same chip colour. */}
				<section class="legend">
					{/* A retired type still explains its own chips on the months it appears in. */}
					{types.filter((type) => type.active || entries.some((e) => e.leave_type_id === type.id)).map((type) => (
						<span class="legend-item">
							<span class="dot" style={`--chip: ${type.color}`} /> {lang === 'th' ? type.label_th : type.label_en}
							<span class="muted"> · {lang === 'th' ? type.label_en : type.label_th}</span>
						</span>
					))}
				</section>
				</div>

				{/* The day panel: the day chosen in the grid — today to begin with —
				    and who is away on it, then the 90 days from today. On a phone it
				    stacks under the grid, and Upcoming shows only while the chosen day
				    has nobody away, since otherwise it repeats the card. */}
				<aside class="cal-side" aria-label={t('cal.whoIsOut')}>
					{/* What a screen reader hears when a tap or swipe changes the day:
					    the day and who is away, said once. Showing one row and hiding
					    another is not announced reliably on its own, and making the
					    whole list live would read out every row it holds. */}
					<p class="visually-hidden" aria-live="polite" data-day-status></p>
					<section class="agenda-view" aria-label={t('cal.byDay')} data-agenda>
						{agenda.every((r) => r.entries.length === 0 && !r.holiday) ? (
							<p class="muted pad agenda-quiet">{t('cal.emptyMonth')}</p>
						) : null}
						{agenda.map((row) => {
							const empty = row.entries.length === 0 && !row.holiday;
							const classes = ['agenda-row', row.date === today ? 'today' : '', row.date === selectedDay ? 'selected' : '', empty ? 'empty' : '', row.entries.length > 0 ? 'has-people' : '']
								.filter(Boolean)
								.join(' ');
							return (
								<div class={classes} id={`d-${row.date}`} data-day={row.date} data-label={longDate(row.date, lang)}>
									<a
										class="agenda-date"
										href={`/book?date=${row.date}`}
										data-book-link
										data-date={row.date}
										aria-label={t('cal.bookOn', { date: longDate(row.date, lang) })}
									>
										<span class="agenda-dow">{weekdayName(row.date, lang)}</span>
										<span class="agenda-num">{Number(row.date.slice(8, 10))}</span>
									</a>
									<div class="agenda-body">
										{row.holiday ? <div class="holiday-tag block">{row.holiday}</div> : null}
										{empty ? <p class="muted agenda-none">{t('cal.nobodyOn')}</p> : null}
										{row.entries.map((e) => (
											<a
												class={`agenda-item ${canEdit(e) ? 'mine' : ''}`}
												href={canEdit(e) ? `/leave/${e.id}/edit` : '#'}
												aria-label={entryLabel(e, row.date, lang)}
												{...entryData(e, canEdit(e), noteFor(e), lang)}
											>
												<span class="dot" style={`--chip: ${e.color}`} />
												<span class="agenda-name">{e.display_name}</span>
												<span class="agenda-type">
													{typeLabel(e, lang)}
													{halfMark(halfOn(e, row.date), lang)}
													{/* How long they are away, so one day's card answers
													    "back when?" without tapping through the week. */}
													{e.start_date !== e.end_date ? (
														<span class="agenda-span"> · {spanLabel(e.start_date, e.end_date, lang)}</span>
													) : null}
												</span>
											</a>
										))}
										<a class="agenda-book" href={`/book?date=${row.date}`} data-book-link data-date={row.date}>
											<PlusIcon class="sm" />
											{t('cal.bookThisDay')}
										</a>
									</div>
								</div>
							);
						})}
					</section>
					<UpcomingList entries={upcoming} today={today} user={user} lang={lang} />
				</aside>
			</div>

			{/* Both dialogs are inert markup until the client script upgrades them.
			    Rendered once per page, not once per entry. */}
			{/* The dialog's own title changes as days are clicked, so the client
			    needs the wording and the month names — same reasoning as the
			    booking form's templates. */}
			<dialog
				class="popup"
				data-create-dialog
				aria-labelledby="create-dialog-title"
				data-dialog-strings={JSON.stringify({
					book: t('cal.book'),
					bookOn: t('cal.bookOnShort'),
					months: t('cal.months'),
				})}
			>
				<div class="popup-head">
					<h2 id="create-dialog-title" data-create-title>{t('cal.book')}</h2>
					<button type="button" class="icon-btn popup-x" data-popup-close aria-label={t('popup.close')}>
						<CloseIcon />
					</button>
				</div>
				<BookingForm types={types} today={today} errorField={errorField} draft={draft} people={props.people} compact />
			</dialog>

			<dialog class="popup" data-entry-dialog aria-label={t('popup.details')}>
				<div class="popup-head">
					<h2>
						<span class="dot" data-p-dot /> <span data-p-name></span>
					</h2>
					<button type="button" class="icon-btn popup-x" data-popup-close aria-label={t('popup.close')}>
						<CloseIcon />
					</button>
				</div>
				<dl class="popup-facts">
					<dt>{t('popup.when')}</dt>
					<dd data-p-when></dd>
					<dt>{t('popup.type')}</dt>
					<dd data-p-type></dd>
					<dt>{t('popup.days')}</dt>
					<dd data-p-days></dd>
					<div data-p-note-row>
						<dt>{t('popup.note')}</dt>
						<dd data-p-note></dd>
					</div>
				</dl>
				<div class="popup-actions" data-p-actions>
					<form method="post" data-p-cancel class="inline">
						<button type="submit" class="btn text danger">
							<DeleteIcon class="sm" />
							{t('popup.remove')}
						</button>
					</form>
					<a class="btn tonal" data-p-edit href="#">
						<EditIcon class="sm" />
						{t('popup.edit')}
					</a>
				</div>
				<p class="muted" data-p-readonly hidden>{t('popup.readonly')}</p>
			</dialog>
		</>
	);
}
