import {
	addDays,
	dayOfWeek,
	describeRange,
	formatDays,
	monthGrid,
	monthName,
	parseWeekStart,
	shiftMonth,
	shortDate,
	weekdayLabels,
	weekdayName,
	MONDAY,
} from '../domain/dates.ts';
import { byDate, halfOn } from '../domain/leave.ts';
import type { Half, Holiday, LeaveEntry, LeaveType, User } from '../types.ts';
import { Layout } from './layout.tsx';
import { BookingForm } from './booking.tsx';

interface CalendarProps {
	user: User;
	year: number;
	month: number;
	entries: LeaveEntry[];
	holidays: Holiday[];
	types: LeaveType[];
	today: string;
	version?: string;
	error?: string;
	notice?: string;
}

function halfMark(h: Half): string {
	return h === 'am' ? ' ½am' : h === 'pm' ? ' ½pm' : '';
}

/**
 * Everything the detail popup shows, hung off the element the user clicks.
 *
 * The popup is built from these attributes rather than fetched, so opening one
 * costs no request and works the instant the page renders.
 *
 * Note that `data-note` goes further than the rest: the grid cell shows only a
 * name, but the note is free text the booker wrote, and it is emitted for every
 * viewer regardless of `canEdit`. That is a deliberate property of a shared
 * calendar, not an oversight — but it is the one field here that a colleague
 * could not otherwise read off the page, so see ISSUES.md #17 before assuming
 * notes are private.
 */
function entryData(e: LeaveEntry, canEdit: boolean) {
	return {
		'data-entry': e.id,
		'data-name': e.display_name,
		'data-type': e.type_label_en,
		'data-color': e.color,
		'data-when': describeRange(e.start_date, e.end_date, e.start_half, e.end_half),
		'data-days': formatDays(e.days_total),
		'data-note': e.note ?? '',
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
	const { user, year, month, entries, holidays, types, today, version, error, notice } = props;
	// Presentation only: rotating the columns changes no arithmetic, and Saturday
	// and Sunday stay the weekend whichever day the week opens on.
	const weekStart = parseWeekStart(user.week_start) ?? MONDAY;
	const grid = monthGrid(year, month, weekStart);
	const weekdays = weekdayLabels(weekStart);
	const map = byDate(entries);
	const holidayMap = new Map(holidays.map((h) => [h.date, h.label]));
	const prev = shiftMonth(year, month, -1);
	const next = shiftMonth(year, month, 1);
	const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

	const canEdit = (e: LeaveEntry) => e.user_email === user.email || Boolean(user.is_admin);

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
			else weekMap.set(e.id, { id: e.id, name: e.display_name, type: e.type_label_en, color: e.color, days: [d] });
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
		<Layout title={`${monthName(month)} ${year}`} user={user} active="calendar" version={version}>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="month-head">
				<a class="btn ghost" href={`/?y=${prev.year}&m=${prev.month}`} aria-label="Previous month">←</a>
				<h1>
					{monthName(month)} <span class="muted">{year}</span>
				</h1>
				<a class="btn ghost" href={`/?y=${next.year}&m=${next.month}`} aria-label="Next month">→</a>
				<a class="btn ghost today-link" href="/">Today</a>
			</div>

			{/* A real link, so this works with scripting off. The client script
			    intercepts it and opens the dialog instead. */}
			<p class="calendar-actions">
				<a class="btn primary" href="/book" data-book-link>Book leave</a>
				<span class="muted hint">Click any day to book it, or an entry to open it.</span>
			</p>

			{showSummary ? (
				<section class="who-summary" aria-label="Who is out">
					<div class="who-block">
						<h2>Out today</h2>
						{todayEntries.length === 0 ? (
							<p class="muted">Nobody is out today.</p>
						) : (
							<ul class="who-list">
								{todayEntries.map((e) => (
									<li>
										<span class="dot" style={`--chip: ${e.color}`} />
										<span class="who-name">{e.display_name}</span>
										<span class="muted">
											{e.type_label_en}
											{halfMark(halfOn(e, today))}
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
					<div class="who-block">
						<h2>Next 7 days</h2>
						{weekPeople.length === 0 ? (
							<p class="muted">Nobody else is out in the next 7 days.</p>
						) : (
							<ul class="who-list">
								{weekPeople.map((p) => (
									<li>
										<span class="dot" style={`--chip: ${p.color}`} />
										<span class="who-name">{p.name}</span>
										<span class="muted">
											{p.type} ({p.days.map((d) => shortDate(d)).join(', ')})
										</span>
									</li>
								))}
							</ul>
						)}
					</div>
				</section>
			) : null}

			{/* Both views are rendered; CSS picks one by width. The month grid is
			    unreadable under ~768px once names are in the cells. */}
			<section class="grid-view" aria-label="Month grid">
				<div class="weekhead">
					{weekdays.map((w) => (
						<div class={`weekhead-cell ${w === 'Sat' || w === 'Sun' ? 'weekend' : ''}`}>{w}</div>
					))}
				</div>
				<div class="grid">
					{grid.map((date) => {
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
							<div class={classes}>
								{/* Covers the cell's empty space. Sits under the chips so a
								    click on an entry opens that entry rather than the
								    booking form. */}
								<a
									class="cell-add"
									href={`/book?date=${date}`}
									data-book-link
									data-date={date}
									aria-label={`Book leave on ${shortDate(date)}`}
								></a>
								<div class="cell-head">
									<span class="daynum">{Number(date.slice(8, 10))}</span>
									{holiday ? <span class="holiday-tag" title={holiday}>{holiday}</span> : null}
								</div>
								<div class="chips">
									{dayEntries.map((e) => (
										<a
											class={`chip ${canEdit(e) ? 'mine' : ''}`}
											href={canEdit(e) ? `/leave/${e.id}/edit` : '#'}
											style={`--chip: ${e.color}`}
											title={`${e.display_name} — ${e.type_label_en}${e.note ? `: ${e.note}` : ''}`}
											{...entryData(e, canEdit(e))}
										>
											{e.display_name}
											{halfMark(halfOn(e, date))}
										</a>
									))}
								</div>
							</div>
						);
					})}
				</div>
			</section>

			<section class="agenda-view" aria-label="Agenda">
				{agenda.length === 0 ? (
					<p class="muted pad">Nobody is on leave this month.</p>
				) : (
					agenda.map((row) => (
						<div class={`agenda-row ${row.date === today ? 'today' : ''}`}>
							<a class="agenda-date" href={`/book?date=${row.date}`} data-book-link data-date={row.date}>
								<span class="agenda-dow">{weekdayName(row.date)}</span>
								<span class="agenda-num">{Number(row.date.slice(8, 10))}</span>
							</a>
							<div class="agenda-body">
								{row.holiday ? <div class="holiday-tag block">{row.holiday}</div> : null}
								{row.entries.map((e) => (
									<a
										class={`agenda-item ${canEdit(e) ? 'mine' : ''}`}
										href={canEdit(e) ? `/leave/${e.id}/edit` : '#'}
										{...entryData(e, canEdit(e))}
									>
										<span class="dot" style={`--chip: ${e.color}`} />
										<span class="agenda-name">{e.display_name}</span>
										<span class="agenda-type">
											{e.type_label_en}
											{halfMark(halfOn(e, row.date))}
										</span>
									</a>
								))}
							</div>
						</div>
					))
				)}
			</section>

			<section class="legend">
				{types.map((t) => (
					<span class="legend-item">
						<span class="dot" style={`--chip: ${t.color}`} /> {t.label_en}
						<span class="muted"> · {t.label_th}</span>
					</span>
				))}
			</section>

			{/* Both dialogs are inert markup until the client script upgrades them.
			    Rendered once per page, not once per entry. */}
			<dialog class="popup" data-create-dialog aria-label="Book leave">
				<div class="popup-head">
					<h2 data-create-title>Book leave</h2>
					<button type="button" class="popup-x" data-popup-close aria-label="Close">✕</button>
				</div>
				<BookingForm types={types} today={today} compact />
			</dialog>

			<dialog class="popup" data-entry-dialog aria-label="Leave details">
				<div class="popup-head">
					<h2>
						<span class="dot" data-p-dot /> <span data-p-name></span>
					</h2>
					<button type="button" class="popup-x" data-popup-close aria-label="Close">✕</button>
				</div>
				<dl class="popup-facts">
					<dt>When</dt>
					<dd data-p-when></dd>
					<dt>Type</dt>
					<dd data-p-type></dd>
					<dt>Days</dt>
					<dd data-p-days></dd>
					<div data-p-note-row>
						<dt>Note</dt>
						<dd data-p-note></dd>
					</div>
				</dl>
				<div class="popup-actions" data-p-actions>
					<a class="btn" data-p-edit href="#">Edit</a>
					<form method="post" data-p-cancel class="inline">
						<button type="submit" class="btn danger">Remove</button>
					</form>
				</div>
				<p class="muted" data-p-readonly hidden>
					Only the person who booked this — or an admin — can change it.
				</p>
			</dialog>
		</Layout>
	);
}
