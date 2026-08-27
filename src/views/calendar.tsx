import {
	addDays,
	isWeekend,
	dayOfWeek,
	describeRange,
	formatDays,
	monthGrid,
	monthName,
	parseWeekStart,
	shiftMonth,
	shortDate,
	longDate,
	intoWeeks,
	weekdayLabels,
	weekdayName,
	MONDAY,
} from '../domain/dates.ts';
import { byDate, halfOn, visibleNote } from '../domain/leave.ts';
import type { Half, Holiday, LeaveEntry, LeaveType, User } from '../types.ts';
import { Layout } from './layout.tsx';
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
	holidays: Holiday[];
	types: LeaveType[];
	today: string;
	version?: string;
	error?: string;
	notice?: string;
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
	const canEdit = (e: LeaveEntry) => e.user_email === user.email || Boolean(user.is_admin);

	// One row per person per day they are away, from today forward. A booking
	// that started last week still appears, on its remaining days only.
	const byDay = new Map<string, LeaveEntry[]>();
	for (const e of entries) {
		for (let d = e.start_date > today ? e.start_date : today; d <= e.end_date; d = addDays(d, 1)) {
			if (isWeekend(d)) continue;
			byDay.set(d, [...(byDay.get(d) ?? []), e]);
		}
	}
	const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));

	return (
		<section class="cal-upcoming">
			<h2>{t('cal.upcoming')}</h2>
			{days.length === 0 ? (
				<p class="muted">{t('cal.nothingUpcoming', { days: UPCOMING_DAYS })}</p>
			) : (
				<ol class="upcoming-list">
					{days.map(([date, dayEntries]) => (
						<li class={`upcoming-day ${date === today ? 'today' : ''}`}>
							<p class="upcoming-date">{date === today ? t('cal.today') : longDate(date, lang)}</p>
							{dayEntries.map((e) => (
								<a
									class={`upcoming-item ${canEdit(e) ? 'mine' : ''}`}
									href={canEdit(e) ? `/leave/${e.id}/edit` : '#'}
									aria-label={entryLabel(e, date, lang)}
									{...entryData(e, canEdit(e), visibleNote(e, user), lang)}
								>
									<span class="dot" style={`--chip: ${e.color}`} />
									<span class="upcoming-name">{e.display_name}</span>
									<span class="upcoming-type">
										{typeLabel(e, lang)}
										{halfMark(halfOn(e, date), lang)}
									</span>
								</a>
							))}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function halfMark(h: Half, lang: Lang): string {
	return h === 'am' ? translate(lang, 'cal.markAm') : h === 'pm' ? translate(lang, 'cal.markPm') : '';
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
			<CalendarBody {...props} />
		</Layout>
	);
}

/** Inside the Layout, so `useT` sees the language the Layout provides. */
function CalendarBody(props: CalendarProps) {
	const { user, year, month, entries, upcoming, holidays, types, today, error, notice } = props;
	const t = useT();
	const lang = useLang();
	// Presentation only: rotating the columns changes no arithmetic, and Saturday
	// and Sunday stay the weekend whichever day the week opens on.
	const weekStart = parseWeekStart(user.week_start) ?? MONDAY;
	const grid = monthGrid(year, month, weekStart);
	const weekdays = weekdayLabels(weekStart, lang);
	const weeks = intoWeeks(grid);
	const map = byDate(entries);
	const holidayMap = new Map(holidays.map((h) => [h.date, h.label]));
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

	// `entries` only covers the displayed month's grid, padded to whole weeks.
	// When today isn't in that grid (browsing another month) there is no data
	// to summarise, so the whole block is hidden rather than showing a false
	// "nobody out" for a day we never fetched.
	const showSummary = grid.includes(today);
	const todayEntries = showSummary ? map.get(today) ?? [] : [];
	const todayEmails = new Set(todayEntries.map((e) => e.user_email));

	// The next seven days, not the calendar week.
	//
	// A Mon-Sun week is the obvious reading of "this week", but it is mostly in
	// the past by Thursday and entirely useless on a Sunday — the moment someone
	// is most likely to be checking what the coming week looks like. A rolling
	// window answers the planning question on every day of the week.
	//
	// The route deliberately queries seven days past the end of the grid so this
	// window is always fully covered, including when today falls in the month's
	// last row.
	const weekDates = showSummary ? Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)) : [];

	type WeekPerson = { id: string; name: string; type: string; color: string; days: string[] };
	const weekMap = new Map<string, WeekPerson>();
	for (const d of weekDates) {
		if (d === today) continue;
		for (const e of map.get(d) ?? []) {
			if (todayEmails.has(e.user_email)) continue;
			const existing = weekMap.get(e.id);
			if (existing) existing.days.push(d);
			else weekMap.set(e.id, { id: e.id, name: e.display_name, type: typeLabel(e, lang), color: e.color, days: [d] });
		}
	}
	const weekPeople = [...weekMap.values()];

	// The agenda view only lists days that have something on them — a phone
	// screen of empty date rows is scrolling for no reason.
	const agenda = grid
		.filter((d) => d.startsWith(monthPrefix))
		.filter((d) => map.has(d) || holidayMap.has(d))
		.map((d) => ({ date: d, entries: map.get(d) ?? [], holiday: holidayMap.get(d) }));

	return (
		<>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="month-head">
				{/* The heading is the control. Stepping a month at a time is fine for
				    next week and useless for next January — five clicks to get
				    there, and five back. A disclosure keeps the header as quiet as
				    it was while putting any month one interaction away.

				    A plain GET form, so it works with scripting off, the result is
				    a URL that can be bookmarked or shared, and the browser's own
				    back button undoes it. */}
				<h1>
					{monthName(month, lang)} <span class="muted">{year}</span>
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
				<a class="icon-btn" href={`/?y=${prev.year}&m=${prev.month}`} aria-label={t('cal.prevMonth')}>
					<ChevronLeftIcon />
				</a>
				<a class="icon-btn" href={`/?y=${next.year}&m=${next.month}`} aria-label={t('cal.nextMonth')}>
					<ChevronRightIcon />
				</a>
				<a class="btn text today-link" href="/">{t('cal.today')}</a>
			</div>

			{/* A real link, so this works with scripting off. The client script
			    intercepts it and opens the dialog instead. The same link is drawn
			    twice: inline on a wide screen, and as an extended FAB on a phone,
			    where the bottom-right corner is where Material puts the primary
			    action and where a thumb can reach it. */}
			<p class="calendar-actions">
				<a class="btn primary book-inline" href="/book" data-book-link>
					<PlusIcon class="sm" />
					{t('cal.book')}
				</a>
				<span class="muted hint">{t('cal.hint')}</span>
			</p>
			<a class="fab" href="/book" data-book-link>
				<PlusIcon />
				{t('cal.book')}
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
							{weeks.map((week) => (
								<tr>
									{week.map((date) => {
										const inMonth = date.startsWith(monthPrefix);
										const weekend = dayOfWeek(date) === 0 || dayOfWeek(date) === 6;
										const holiday = holidayMap.get(date);
										const dayEntries = map.get(date) ?? [];
										const classes = [
											'cell',
											inMonth ? '' : 'out',
											weekend ? 'weekend' : '',
											holiday ? 'holiday' : '',
											date === today ? 'today' : '',
										]
											.filter(Boolean)
											.join(' ');
										return (
											<td class={classes} aria-current={date === today ? 'date' : undefined}>
												{/* Covers the cell's empty space. Sits under the chips so a
												    click on an entry opens that entry rather than the
												    booking form. */}
												<a
													class="cell-add"
													href={`/book?date=${date}`}
													data-book-link
													data-date={date}
													aria-label={t('cal.bookOn', { date: longDate(date, lang) })}
												></a>
												{/* Phones only, and only where there is something to see. A
												    cell is about 48px wide there — too narrow for names, and
												    far too narrow to tap one of several. So the whole cell
												    becomes one target that jumps to this day in the list
												    below, which is where the names, types and controls live.
												    An anchor, not a script: it works with JS off and it can
												    be opened in a new tab like any other link. */}
												{dayEntries.length > 0 ? (
													<a
														class="cell-day"
														href={`#d-${date}`}
														aria-label={t('cal.seeDay', { date: longDate(date, lang) })}
													></a>
												) : null}
												<div class="cell-head">
													<span class="daynum" aria-hidden="true">{Number(date.slice(8, 10))}</span>
													{/* The number alone reads as a bare digit out of context, so the
													    full date is announced instead and the digit is hidden. */}
													<span class="visually-hidden">{longDate(date, lang)}</span>
													{holiday ? <span class="holiday-tag">{holiday}</span> : null}
												</div>
												{/* A cell is only as tall as the month allows once the grid
												    has to fit the window, so it shows the first few and says
												    how many it kept back. The day is still one click from the
												    booking form, and the sidebar lists what is coming. */}
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
													{dayEntries.length > CELL_CHIPS ? (
														<span class="chip-more">{t('cal.more', { n: dayEntries.length - CELL_CHIPS })}</span>
													) : null}
												</div>
											</td>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
				</section>

				<section class="agenda-view" aria-label={t('cal.byDay')}>
					{agenda.length === 0 ? (
						<p class="muted pad">{t('cal.emptyMonth')}</p>
					) : (
						agenda.map((row) => (
							<div class={`agenda-row ${row.date === today ? 'today' : ''}`} id={`d-${row.date}`}>
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
											</span>
										</a>
									))}
								</div>
							</div>
						))
					)}
				</section>

				{/* Both languages, whichever the reader has chosen: the legend is where
				    someone learns that ลาป่วย and Sick leave are the same chip colour. */}
				<section class="legend">
					{types.map((type) => (
						<span class="legend-item">
							<span class="dot" style={`--chip: ${type.color}`} /> {lang === 'th' ? type.label_th : type.label_en}
							<span class="muted"> · {lang === 'th' ? type.label_en : type.label_th}</span>
						</span>
					))}
				</section>
				</div>

				<aside class="cal-side" aria-label={t('cal.whoIsOut')}>
					{/* Both halves empty is the common case in a quiet week, and two
					    cards saying almost the same nothing is a poor use of the space.
					    One line covers it — and "nobody *else*" needs somebody to be
					    else to, which there isn't. */}
					{showSummary && todayEntries.length === 0 && weekPeople.length === 0 ? (
					<section class="who-summary quiet" aria-label={t('cal.whoIsOut')}>
						<p class="muted">{t('cal.nobodyAtAll')}</p>
					</section>
				) : null}

				{showSummary && (todayEntries.length > 0 || weekPeople.length > 0) ? (
					<section class="who-summary" aria-label={t('cal.whoIsOut')}>
						<div class="who-block">
							<h2>{t('cal.outToday')}</h2>
							{todayEntries.length === 0 ? (
								<p class="muted">{t('cal.nobodyToday')}</p>
							) : (
								<ul class="who-list">
									{todayEntries.map((e) => (
										<li>
											<span class="dot" style={`--chip: ${e.color}`} />
											<span class="who-name">{e.display_name}</span>
											<span class="muted">
												{typeLabel(e, lang)}
												{halfMark(halfOn(e, today), lang)}
											</span>
										</li>
									))}
								</ul>
							)}
						</div>
						<div class="who-block">
							<h2>{t('cal.next7')}</h2>
							{weekPeople.length === 0 ? (
								<p class="muted">{t('cal.nobodyWeek')}</p>
							) : (
								<ul class="who-list">
									{weekPeople.map((p) => (
										<li>
											<span class="dot" style={`--chip: ${p.color}`} />
											<span class="who-name">{p.name}</span>
											<span class="muted">
												{p.type} ({p.days.map((d) => shortDate(d, lang)).join(', ')})
											</span>
										</li>
									))}
								</ul>
							)}
						</div>
					</section>
				) : null}

				{/* Both views are rendered; CSS picks one by width. The month grid is
				    unreadable under ~768px once names are in the cells.

				    A real <table>, not a lattice of divs: a month genuinely is tabular
				    data, and the table element gives a screen reader the row and column
				    relationships for free. The ARIA grid role would need an arrow-key
				    navigation model to be honest, and announcing "grid" without one is
				    worse than saying nothing. */}
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
				aria-label={t('cal.book')}
				data-dialog-strings={JSON.stringify({
					book: t('cal.book'),
					bookOn: t('cal.bookOnShort'),
					months: t('cal.months'),
				})}
			>
				<div class="popup-head">
					<h2 data-create-title>{t('cal.book')}</h2>
					<button type="button" class="icon-btn popup-x" data-popup-close aria-label={t('popup.close')}>
						<CloseIcon />
					</button>
				</div>
				<BookingForm types={types} today={today} compact />
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
