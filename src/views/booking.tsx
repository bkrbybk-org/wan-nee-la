import type { LeaveEntry, LeaveType } from '../types.ts';

interface BookingFormProps {
	types: readonly LeaveType[];
	today: string;
	compact?: boolean;
	/** When present the form edits this booking instead of creating a new one. */
	entry?: LeaveEntry;
}

/**
 * Booking form, used for both creating and editing. A plain POST form that
 * works with JS disabled — `booking.js` only adds the live day-count preview
 * and the half-day field toggling.
 *
 * `type="date"` gives the native picker on both iOS and Android, which is a far
 * better mobile experience than any date-picker library and costs nothing.
 */
export function BookingForm({ types, today, compact, entry }: BookingFormProps) {
	const editing = Boolean(entry);
	const action = entry ? `/api/leave/${entry.id}/edit` : '/api/leave';
	// On a single-day booking the end date is left blank, which is what the
	// create form defaults to — keeps the two modes rendering identically.
	const endValue = entry && entry.end_date !== entry.start_date ? entry.end_date : '';

	const half = (want: string, current: string | undefined, fallback: string) =>
		(current ?? fallback) === want;

	return (
		<form method="post" action={action} class={`booking ${compact ? 'compact' : ''}`} data-booking>
			<div class="field">
				<label for={`leaveTypeId-${entry?.id ?? 'new'}`}>Leave type</label>
				<select id={`leaveTypeId-${entry?.id ?? 'new'}`} name="leaveTypeId" required>
					{types.map((t) => (
						<option value={String(t.id)} selected={entry ? t.id === entry.leave_type_id : undefined}>
							{t.label_en} · {t.label_th}
						</option>
					))}
				</select>
			</div>

			<div class="row">
				<div class="field">
					<label for={`startDate-${entry?.id ?? 'new'}`}>From</label>
					<input
						type="date"
						id={`startDate-${entry?.id ?? 'new'}`}
						name="startDate"
						required
						value={entry ? entry.start_date : today}
						data-start
					/>
				</div>
				<div class="field">
					<label for={`startHalf-${entry?.id ?? 'new'}`}>
						Start <span class="muted">half</span>
					</label>
					<select id={`startHalf-${entry?.id ?? 'new'}`} name="startHalf" data-start-half>
						<option value="full" selected={half('full', entry?.start_half, 'full')}>Full day</option>
						<option value="am" selected={half('am', entry?.start_half, 'full')}>Morning only</option>
						<option value="pm" selected={half('pm', entry?.start_half, 'full')}>Afternoon only</option>
					</select>
				</div>
			</div>

			<div class="row">
				<div class="field">
					<label for={`endDate-${entry?.id ?? 'new'}`}>
						To <span class="muted">(blank = same day)</span>
					</label>
					<input type="date" id={`endDate-${entry?.id ?? 'new'}`} name="endDate" value={endValue} data-end />
				</div>
				<div class="field" data-end-half-field>
					<label for={`endHalf-${entry?.id ?? 'new'}`}>
						End <span class="muted">half</span>
					</label>
					<select id={`endHalf-${entry?.id ?? 'new'}`} name="endHalf" data-end-half>
						<option value="full" selected={half('full', entry?.end_half, 'full')}>Full day</option>
						<option value="am" selected={half('am', entry?.end_half, 'full')}>Morning only</option>
					</select>
				</div>
			</div>

			<div class="field">
				<label for={`note-${entry?.id ?? 'new'}`}>
					Note <span class="muted">(optional)</span>
				</label>
				<input
					type="text"
					id={`note-${entry?.id ?? 'new'}`}
					name="note"
					maxlength={500}
					placeholder="Family trip"
					value={entry?.note ?? ''}
				/>
			</div>

			<div class="actions">
				<button type="submit" class="btn primary">{editing ? 'Save changes' : 'Book leave'}</button>
				{/* "Discard", not "Cancel" — this page also has a button that cancels
				    the leave itself, and two different meanings of Cancel side by
				    side is how someone deletes a booking they meant to keep. */}
				{editing ? <a class="btn" href="/me">Discard changes</a> : null}
				{/* Filled in by booking.js; stays empty and harmless without it. */}
				<span class="preview" data-preview aria-live="polite"></span>
			</div>
		</form>
	);
}
