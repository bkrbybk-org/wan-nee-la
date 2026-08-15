import { shortDate } from '../domain/dates.ts';
import type { LeaveType, User } from '../types.ts';
import { Layout } from './layout.tsx';
import { BookingForm } from './booking.tsx';

/**
 * Standalone booking page.
 *
 * This is the no-JS destination for every "book leave" affordance on the
 * calendar — the Book leave button and each day cell link here with the date in
 * the query string. With JS the same click opens a dialog instead and never
 * leaves the page, but the link is real, so the calendar stays usable with
 * scripting off and the targets are ordinary links to middle-click or share.
 */
export function BookPage({
	user,
	types,
	today,
	date,
	version,
	error,
	notice,
}: {
	user: User;
	types: LeaveType[];
	today: string;
	date?: string;
	version?: string;
	error?: string;
	notice?: string;
}) {
	return (
		<Layout title="Book leave" user={user} active="calendar" version={version}>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="page-head">
				<h1>Book leave</h1>
				{date ? <span class="muted">{shortDate(date)}</span> : null}
			</div>

			<section class="card">
				<BookingForm types={types} today={today} defaultDate={date} compact />
			</section>

			<p>
				<a class="btn" href="/">Back to calendar</a>
			</p>
		</Layout>
	);
}
