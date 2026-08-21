import type { LeaveEntry, LeaveType } from '../types.ts';
import { SelectField, TextField } from './fields.tsx';

interface BookingFormProps {
	types: readonly LeaveType[];
	today: string;
	compact?: boolean;
	/** When present the form edits this booking instead of creating a new one. */
	entry?: LeaveEntry;
	/** Start date to prefill when creating — the day the user clicked on the calendar. */
	defaultDate?: string;
}

/**
 * Booking form, used for both creating and editing. A plain POST form that
 * works with JS disabled — `booking.js` only adds the live day-count preview
 * and the half-day field toggling.
 *
 * `type="date"` gives the native picker on both iOS and Android, which is a far
 * better mobile experience than any date-picker library and costs nothing.
 */
export function BookingForm({ types, today, compact, entry, defaultDate }: BookingFormProps) {
	const editing = Boolean(entry);
	const action = entry ? `/api/leave/${entry.id}/edit` : '/api/leave';
	// On a single-day booking the end date is left blank, which is what the
	// create form defaults to — keeps the two modes rendering identically.
	const endValue = entry && entry.end_date !== entry.start_date ? entry.end_date : '';
	const uid = entry?.id ?? 'new';

	const half = (want: string, current: string | undefined, fallback: string) =>
		(current ?? fallback) === want;

	return (
		<form method="post" action={action} class={`booking ${compact ? 'compact' : ''}`} data-booking>
			<SelectField id={`leaveTypeId-${uid}`} name="leaveTypeId" label="Leave type" required>
				{types.map((t) => (
					<option value={String(t.id)} selected={entry ? t.id === entry.leave_type_id : undefined}>
						{t.label_en} · {t.label_th}
					</option>
				))}
			</SelectField>

			<div class="row">
				<TextField
					id={`startDate-${uid}`}
					name="startDate"
					label="From"
					type="date"
					required
					value={entry ? entry.start_date : (defaultDate ?? today)}
					extra={{ 'data-start': '' }}
				/>
				<SelectField id={`startHalf-${uid}`} name="startHalf" label="Start half" extra={{ 'data-start-half': '' }}>
					<option value="full" selected={half('full', entry?.start_half, 'full')}>Full day</option>
					<option value="am" selected={half('am', entry?.start_half, 'full')}>Morning only</option>
					<option value="pm" selected={half('pm', entry?.start_half, 'full')}>Afternoon only</option>
				</SelectField>
			</div>

			<div class="row">
				<TextField
					id={`endDate-${uid}`}
					name="endDate"
					label="To"
					type="date"
					value={endValue}
					support="Leave blank for a single day"
					extra={{ 'data-end': '' }}
				/>
				<SelectField
					id={`endHalf-${uid}`}
					name="endHalf"
					label="End half"
					class="end-half-field"
					extra={{ 'data-end-half': '' }}
					fieldExtra={{ 'data-end-half-field': '' }}
				>
					<option value="full" selected={half('full', entry?.end_half, 'full')}>Full day</option>
					<option value="am" selected={half('am', entry?.end_half, 'full')}>Morning only</option>
				</SelectField>
			</div>

			<TextField
				id={`note-${uid}`}
				name="note"
				label="Note (optional)"
				maxlength={500}
				value={entry?.note ?? ''}
				support="Visible to everyone on the calendar"
			/>

			<div class="actions">
				<button type="submit" class="btn primary">{editing ? 'Save changes' : 'Book leave'}</button>
				{/* "Discard", not "Cancel" — this page also has a button that cancels
				    the leave itself, and two different meanings of Cancel side by
				    side is how someone deletes a booking they meant to keep. */}
				{editing ? <a class="btn text" href="/me">Discard changes</a> : null}
				{/* Filled in by booking.js; stays empty and harmless without it. */}
				<span class="preview" data-preview aria-live="polite"></span>
			</div>
		</form>
	);
}
