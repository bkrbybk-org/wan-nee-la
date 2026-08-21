import { describeRange, formatDays } from '../domain/dates.ts';
import type { LeaveEntry, LeaveType, User } from '../types.ts';
import { Layout } from './layout.tsx';
import { BookingForm } from './booking.tsx';
import { ChevronLeftIcon, DeleteIcon } from './icons.tsx';

interface EditProps {
	user: User;
	entry: LeaveEntry;
	types: LeaveType[];
	today: string;
	/** Set when an admin is editing someone else's booking. */
	onBehalfOf?: string;
	version?: string;
	error?: string;
	notice?: string;
}

export function EditPage({ user, entry, types, today, onBehalfOf, version, error, notice }: EditProps) {
	return (
		<Layout title="Edit leave" user={user} active="me" version={version}>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="page-head">
				<a class="icon-btn" href="/me" aria-label="Back to my leave">
					<ChevronLeftIcon />
				</a>
				<h1>Edit leave</h1>
			</div>

			{onBehalfOf ? (
				<div class="banner error">
					You are editing {onBehalfOf}'s booking as an admin.
				</div>
			) : null}

			<section class="card">
				<h2>Currently booked</h2>
				<p class="leave-current">
					<span class="dot" style={`--chip: ${entry.color}`} />
					<strong>{describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half)}</strong>
					<span class="muted">
						{' '}
						· {entry.type_label_en} · {formatDays(entry.days_total)} day(s)
					</span>
				</p>
				{entry.note ? <p class="muted">{entry.note}</p> : null}
			</section>

			<section class="card">
				<h2>Change it</h2>
				<BookingForm types={types} today={today} entry={entry} compact />
			</section>

			<section class="card">
				<h2>Remove</h2>
				<p class="muted">
					Cancelling returns {formatDays(entry.days_total)} day(s) to the balance and takes the entry off the shared
					calendar. The record is kept, marked cancelled, rather than deleted.
				</p>
				<form method="post" action={`/api/leave/${entry.id}/cancel`}>
					<button type="submit" class="btn danger">
						<DeleteIcon class="sm" />
						Remove this leave
					</button>
				</form>
			</section>
		</Layout>
	);
}
