import { describeRange, formatDays } from '../domain/dates.ts';
import type { Balance, LeaveEntry, User } from '../types.ts';
import { Layout, YearNav } from './layout.tsx';

interface UserPageProps {
	viewer: User;
	subject: User;
	year: number;
	minYear: number;
	maxYear: number;
	entries: LeaveEntry[];
	// Undefined when the viewer is neither the subject nor an admin — the
	// balances section is omitted entirely in that case, not rendered empty.
	balances?: Balance[];
	version?: string;
}

export function UserPage(props: UserPageProps) {
	const { viewer, subject, year, minYear, maxYear, entries, balances, version } = props;

	return (
		<Layout title={subject.display_name} user={viewer} active="calendar" version={version}>
			<div class="page-head">
				<h1>{subject.display_name}</h1>
				<YearNav basePath={`/u/${encodeURIComponent(subject.email)}`} year={year} minYear={minYear} maxYear={maxYear} />
			</div>

			{balances ? (
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
			) : null}

			<section class="card">
				<h2>Leave in {year}</h2>
				{entries.length === 0 ? (
					<p class="muted">Nothing booked.</p>
				) : (
					<ul class="leave-list">
						{entries.map((e) => (
							<UserLeaveRow entry={e} />
						))}
					</ul>
				)}
			</section>
		</Layout>
	);
}

/**
 * Cancelled bookings are shown struck through, same as /me — a cancellation
 * is still a fact about the schedule (a day someone expected to be out and
 * then wasn't), and hiding it outright would make this page disagree with
 * the calendar, which also shows cancelled entries. The free-text note is
 * never rendered here, for anyone, confirmed or cancelled (see task brief).
 */
function UserLeaveRow({ entry }: { entry: LeaveEntry }) {
	const cancelled = entry.status === 'cancelled';
	return (
		<li class={`leave-row ${cancelled ? 'cancelled' : ''}`}>
			<span class="dot" style={`--chip: ${entry.color}`} />
			<span class="leave-when">{describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half)}</span>
			<span class="leave-type muted">{entry.type_label_en}</span>
			<span class="leave-days">{formatDays(entry.days_total)}d</span>
			{cancelled ? <span class="tag">cancelled</span> : null}
		</li>
	);
}
