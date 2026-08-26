import type { LeaveEntry, LeaveType } from '../types.ts';
import { SelectField, TextField } from './fields.tsx';
import { useLang, useT } from '../i18n/context.tsx';

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

	const t = useT();
	const lang = useLang();

	return (
		<form
			method="post"
			action={action}
			class={`booking ${compact ? 'compact' : ''}`}
			data-booking
			// Lets the coverage line ignore the booking being edited, instead of
			// counting it as somebody else already away on those days.
			data-editing={entry?.id}
			// Templates, with their placeholders intact, for the two lines the
			// client fills in after asking the server. Same reasoning as the push
			// card: the wording stays in the catalogue, not in the bundle.
			data-booking-strings={JSON.stringify({
				days: t('book.days'),
				coverage: t('book.coverage'),
				coverageMore: t('book.coverageMore'),
			})}
		>
			<SelectField id={`leaveTypeId-${uid}`} name="leaveTypeId" label={t('book.type')} required>
				{types.map((type) => (
					<option value={String(type.id)} selected={entry ? type.id === entry.leave_type_id : undefined}>
						{lang === 'th' ? type.label_th : type.label_en} · {lang === 'th' ? type.label_en : type.label_th}
					</option>
				))}
			</SelectField>

			<div class="row">
				<TextField
					id={`startDate-${uid}`}
					name="startDate"
					label={t('book.from')}
					type="date"
					required
					value={entry ? entry.start_date : (defaultDate ?? today)}
					extra={{ 'data-start': '' }}
				/>
				<SelectField id={`startHalf-${uid}`} name="startHalf" label={t('book.startHalf')} extra={{ 'data-start-half': '' }}>
					<option value="full" selected={half('full', entry?.start_half, 'full')}>{t('book.fullDay')}</option>
					<option value="am" selected={half('am', entry?.start_half, 'full')}>{t('book.am')}</option>
					<option value="pm" selected={half('pm', entry?.start_half, 'full')}>{t('book.pm')}</option>
				</SelectField>
			</div>

			<div class="row">
				<TextField
					id={`endDate-${uid}`}
					name="endDate"
					label={t('book.to')}
					type="date"
					value={endValue}
					support={t('book.toHelp')}
					extra={{ 'data-end': '' }}
				/>
				<SelectField
					id={`endHalf-${uid}`}
					name="endHalf"
					label={t('book.endHalf')}
					class="end-half-field"
					extra={{ 'data-end-half': '' }}
					fieldExtra={{ 'data-end-half-field': '' }}
				>
					<option value="full" selected={half('full', entry?.end_half, 'full')}>{t('book.fullDay')}</option>
					<option value="am" selected={half('am', entry?.end_half, 'full')}>{t('book.am')}</option>
				</SelectField>
			</div>

			<TextField id={`note-${uid}`} name="note" label={t('book.note')} maxlength={500} value={entry?.note ?? ''} />
			{/* Private by default. The old behaviour was to share every note with
			    everyone, which was defensible for a shared calendar — the problem
			    was that the field gave no sign of it (ISSUES.md #17). */}
			<label class="checkline">
				<input type="checkbox" name="noteVisibility" value="shared" checked={entry ? !entry.note_private : false} />
				{t('book.shareNote')}
			</label>
			<p class="tf-support">{t('book.noteHelp')}</p>

			<div class="actions">
				<button type="submit" class="btn primary">{editing ? t('book.save') : t('book.submit')}</button>
				{/* "Discard", not "Cancel" — this page also has a button that cancels
				    the leave itself, and two different meanings of Cancel side by
				    side is how someone deletes a booking they meant to keep. */}
				{editing ? <a class="btn text" href="/me">{t('book.discard')}</a> : null}
				{/* Filled in by booking.js; stays empty and harmless without it. */}
				<span class="preview" data-preview aria-live="polite"></span>
			</div>
			<p class="coverage" data-coverage aria-live="polite"></p>
		</form>
	);
}
