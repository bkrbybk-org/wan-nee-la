import { dayOfWeek, describeRange, formatDays, monthGrid, monthName, shiftMonth } from '../domain/dates.ts';
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

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function halfMark(h: Half): string {
	return h === 'am' ? ' ½am' : h === 'pm' ? ' ½pm' : '';
}

export function CalendarPage(props: CalendarProps) {
	const { user, year, month, entries, holidays, types, today, version, error, notice } = props;
	const grid = monthGrid(year, month);
	const map = byDate(entries);
	const holidayMap = new Map(holidays.map((h) => [h.date, h.label]));
	const prev = shiftMonth(year, month, -1);
	const next = shiftMonth(year, month, 1);

	// The agenda view only lists days that have something on them — a phone
	// screen of empty date rows is scrolling for no reason.
	const agenda = grid
		.filter((d) => d.startsWith(`${year}-${String(month).padStart(2, '0')}`))
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

			<details class="booking-disclosure">
				<summary class="btn primary">Book leave</summary>
				<BookingForm types={types} today={today} />
			</details>

			{/* Both views are rendered; CSS picks one by width. The month grid is
			    unreadable under ~768px once names are in the cells. */}
			<section class="grid-view" aria-label="Month grid">
				<div class="weekhead">
					{WEEKDAYS.map((w) => (
						<div class={`weekhead-cell ${w === 'Sat' || w === 'Sun' ? 'weekend' : ''}`}>{w}</div>
					))}
				</div>
				<div class="grid">
					{grid.map((date) => {
						const inMonth = date.startsWith(`${year}-${String(month).padStart(2, '0')}`);
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
								<div class="cell-head">
									<span class="daynum">{Number(date.slice(8, 10))}</span>
									{holiday ? <span class="holiday-tag" title={holiday}>{holiday}</span> : null}
								</div>
								<div class="chips">
									{dayEntries.map((e) => (
										<span
											class="chip"
											style={`--chip: ${e.color}`}
											title={`${e.display_name} — ${e.type_label_en}${e.note ? `: ${e.note}` : ''}`}
										>
											{e.display_name}
											{halfMark(halfOn(e, date))}
										</span>
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
							<div class="agenda-date">
								<span class="agenda-dow">{WEEKDAYS[(dayOfWeek(row.date) + 6) % 7]}</span>
								<span class="agenda-num">{Number(row.date.slice(8, 10))}</span>
							</div>
							<div class="agenda-body">
								{row.holiday ? <div class="holiday-tag block">{row.holiday}</div> : null}
								{row.entries.map((e) => (
									<div class="agenda-item">
										<span class="dot" style={`--chip: ${e.color}`} />
										<span class="agenda-name">{e.display_name}</span>
										<span class="agenda-type">
											{e.type_label_en}
											{halfMark(halfOn(e, row.date))}
										</span>
									</div>
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

			{entries.length > 0 ? (
				<details class="month-summary">
					<summary>This month: {entries.length} booking(s)</summary>
					<ul class="plain">
						{entries.map((e) => (
							<li>
								<strong>{e.display_name}</strong> — {describeRange(e.start_date, e.end_date, e.start_half, e.end_half)}
								<span class="muted">
									{' '}
									· {e.type_label_en} · {formatDays(e.days_total)}d
								</span>
							</li>
						))}
					</ul>
				</details>
			) : null}
		</Layout>
	);
}
