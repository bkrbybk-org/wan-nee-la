import { describeRange, formatDays } from '../domain/dates.ts';
import type { Balance, LeaveEntry, LeaveType, User } from '../types.ts';
import { Layout, YearNav } from './layout.tsx';
import { BookingForm } from './booking.tsx';
import { TextField } from './fields.tsx';
import { BellIcon, CheckIcon, DeleteIcon, EditIcon } from './icons.tsx';

interface MeProps {
	user: User;
	year: number;
	minYear: number;
	maxYear: number;
	balances: Balance[];
	entries: LeaveEntry[];
	types: LeaveType[];
	today: string;
	/** Absent when the server has no VAPID pair — the whole card is hidden then. */
	vapidPublicKey?: string;
	version?: string;
	error?: string;
	notice?: string;
}

export function MePage(props: MeProps) {
	const { user, year, minYear, maxYear, balances, entries, types, today, vapidPublicKey, version, error, notice } = props;
	const upcoming = entries.filter((e) => e.status === 'confirmed' && e.end_date >= today);
	const past = entries.filter((e) => e.status !== 'confirmed' || e.end_date < today);

	return (
		<Layout title="My leave" user={user} active="me" version={version}>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="page-head">
				<h1>My leave</h1>
				<YearNav basePath="/me" year={year} minYear={minYear} maxYear={maxYear} />
			</div>

			<section class="balances">
				{balances.map((b) => {
					const pct = b.allotted > 0 ? Math.min(100, (b.used / b.allotted) * 100) : 0;
					return (
						<div class="balance-card">
							<div class="balance-top">
								<span class="dot" style={`--chip: ${b.type.color}`} />
								<span class="balance-label">{b.type.label_en}</span>
								<span class="balance-th muted">{b.type.label_th}</span>
							</div>
							{b.type.counts_quota ? (
								<>
									<div class="balance-big">
										{formatDays(b.remaining)}
										<span class="unit">days left</span>
									</div>
									<div class="meter" role="img" aria-label={`${formatDays(b.used)} of ${formatDays(b.allotted)} days used`}>
										<span class="meter-fill" style={`width: ${pct}%; --chip: ${b.type.color}`} />
									</div>
									<div class="balance-sub muted">
										{formatDays(b.used)} used of {formatDays(b.allotted)}
									</div>
								</>
							) : (
								<>
									<div class="balance-big">
										{formatDays(b.used)}
										<span class="unit">days taken</span>
									</div>
									<div class="balance-sub muted">No annual allowance</div>
								</>
							)}
						</div>
					);
				})}
			</section>

			<section class="card">
				<h2>Book leave</h2>
				<BookingForm types={types} today={today} compact />
			</section>

			<section class="card">
				<h2>Upcoming</h2>
				{upcoming.length === 0 ? (
					<p class="muted">Nothing booked. </p>
				) : (
					<ul class="leave-list">
						{upcoming.map((e) => (
							<LeaveRow entry={e} />
						))}
					</ul>
				)}
			</section>

			<section class="card">
				<h2>Earlier this year</h2>
				{past.length === 0 ? (
					<p class="muted">Nothing yet.</p>
				) : (
					<ul class="leave-list">
						{past.map((e) => (
							<LeaveRow entry={e} />
						))}
					</ul>
				)}
			</section>

			{vapidPublicKey ? <PushCard vapidPublicKey={vapidPublicKey} /> : null}

			<section class="card">
				<h2>Calendar</h2>
				<p class="muted">Which day the month grid starts on. Weekends stay Saturday and Sunday either way.</p>
				{/* A segmented button: two mutually exclusive options that belong to
				    one setting. The radios inside are what the form submits, so this
				    is still an ordinary POST with scripting off. */}
				<form method="post" action="/me/week-start" class="row inline">
					<div class="segmented" role="group" aria-label="Week starts on">
						<label>
							<input type="radio" name="weekStart" value="1" checked={user.week_start !== 0} />
							<CheckIcon class="sm seg-check" />
							<span class="seg-text">Monday first</span>
						</label>
						<label>
							<input type="radio" name="weekStart" value="0" checked={user.week_start === 0} />
							<CheckIcon class="sm seg-check" />
							<span class="seg-text">Sunday first</span>
						</label>
					</div>
					<button type="submit" class="btn tonal">Save</button>
				</form>
			</section>

			<section class="card">
				<h2>Display name</h2>
				<p class="muted">This is the name shown on the shared calendar.</p>
				<form method="post" action="/me/name" class="row inline">
					<TextField id="displayName" name="displayName" label="Display name" value={user.display_name} maxlength={60} required />
					<button type="submit" class="btn tonal">Save</button>
				</form>
			</section>
		</Layout>
	);
}

/**
 * Browser notifications for the 08:00 digest.
 *
 * Entirely script-driven, and deliberately inert without JS: there is no
 * server-rendered "on" or "off" state to show, because the answer is per
 * browser and only that browser knows it. `push.ts` fills in the status,
 * enables the buttons, and — on iOS, where the Push API exists only inside an
 * installed web app — replaces the controls with the install instructions.
 */
function PushCard({ vapidPublicKey }: { vapidPublicKey: string }) {
	return (
		<section class="card" data-push-card hidden>
			<h2>Browser notifications</h2>
			<p class="muted">
				One notification each working morning at 08:00, listing who is out that day. Nothing is sent on weekends,
				public holidays, or days when nobody is away.
			</p>

			<p class="push-status" data-push-status aria-live="polite"></p>

			<div class="actions" data-vapid-key={vapidPublicKey}>
				<button type="button" class="btn primary" data-push-enable hidden>
					<BellIcon class="sm" />
					Turn on
				</button>
				<button type="button" class="btn" data-push-disable hidden>Turn off</button>
				<button type="button" class="btn text" data-push-test hidden>Send a test</button>
			</div>

			{/* Shown only on iOS, where a tab cannot subscribe at all. */}
			<p class="muted" data-push-ios hidden>
				On iPhone and iPad, notifications work only once this site is installed: tap Share, then <strong>Add to
				Home Screen</strong>, and turn them on from there.
			</p>
		</section>
	);
}

/**
 * A booking in a list. Edit and remove are offered on every confirmed booking,
 * past ones included — sick leave in particular is often entered after the fact
 * and then needs correcting.
 */
function LeaveRow({ entry }: { entry: LeaveEntry }) {
	const cancelled = entry.status === 'cancelled';
	const when = describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half);
	return (
		<li class={`leave-row ${cancelled ? 'cancelled' : ''}`}>
			<span class="dot" style={`--chip: ${entry.color}`} />
			<span class="leave-when">{when}</span>
			<span class="leave-type muted">{entry.type_label_en}</span>
			<span class="leave-days">{formatDays(entry.days_total)}d</span>
			{entry.note ? <span class="leave-note muted">{entry.note}</span> : null}
			{cancelled ? <span class="tag">cancelled</span> : null}
			{!cancelled ? (
				<span class="row-actions">
					<a class="icon-btn" href={`/leave/${entry.id}/edit`} aria-label={`Edit leave on ${when}`}>
						<EditIcon />
					</a>
					<form method="post" action={`/api/leave/${entry.id}/cancel`} class="inline">
						<button type="submit" class="icon-btn" aria-label={`Remove leave on ${when}`}>
							<DeleteIcon />
						</button>
					</form>
				</span>
			) : null}
		</li>
	);
}
