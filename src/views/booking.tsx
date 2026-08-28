import type { BookingDraft } from '../domain/leave.ts';
import type { LeaveEntry, LeaveType } from '../types.ts';
import { SelectField, TextField } from './fields.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { tRaw } from '../i18n/strings.ts';

interface BookingFormProps {
	types: readonly LeaveType[];
	today: string;
	compact?: boolean;
	/** When present the form edits this booking instead of creating a new one. */
	entry?: LeaveEntry;
	/** Start date to prefill when creating — the day the user clicked on the calendar. */
	defaultDate?: string;
	/**
	 * The input the last submission was rejected over, carried back by the flash
	 * cookie. The message itself is already at the top of the page; this is what
	 * says which of five fields it is about.
	 */
	errorField?: string;
	/**
	 * The booking that rejection was about, carried back by the same cookie. It
	 * wins over every other source of a value: it is what the reader typed, and
	 * the banner above the form is explaining why it was turned down. `errorField`
	 * marks which of these values to look at.
	 */
	draft?: BookingDraft;
}

/**
 * Booking form, used for both creating and editing. A plain POST form that
 * works with JS disabled — `booking.js` only adds the live day-count preview
 * and the half-day field toggling.
 *
 * `type="date"` gives the native picker on both iOS and Android, which is a far
 * better mobile experience than any date-picker library and costs nothing.
 */
export function BookingForm({ types, today, compact, entry, defaultDate, errorField, draft }: BookingFormProps) {
	const editing = Boolean(entry);
	const action = entry ? `/api/leave/${entry.id}/edit` : '/api/leave';

	const startValue = draft?.startDate ?? (entry ? entry.start_date : (defaultDate ?? today));
	// On a single-day booking the end date is left blank, which is what the
	// create form defaults to — keeps the two modes rendering identically. A
	// draft goes through the same rule: `parseBooking` has already turned its
	// blank end date into a copy of the start, so an equal pair means one day.
	const endSource = draft ?? (entry ? { startDate: entry.start_date, endDate: entry.end_date } : null);
	const endValue = endSource && endSource.endDate !== endSource.startDate ? endSource.endDate : '';
	const uid = entry?.id ?? 'new';

	const typeId = draft?.leaveTypeId ?? entry?.leave_type_id;
	// A dropped note (see `flashCookie`) leaves `draft.note` undefined, which
	// falls through to whatever the form held before — an empty string means the
	// reader deliberately cleared it.
	const noteValue = draft?.note ?? entry?.note ?? '';
	const shareNote = draft ? !draft.notePrivate : entry ? !entry.note_private : false;

	const half = (want: string, current: string | undefined, fallback: string) =>
		(current ?? fallback) === want;

	const bad = (name: string) => errorField === name;

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
				days: tRaw(lang, 'book.days'),
				coverage: t('book.coverage'),
				coverageMore: t('book.coverageMore'),
			})}
		>
			<SelectField id={`leaveTypeId-${uid}`} name="leaveTypeId" label={t('book.type')} required invalid={bad('leaveTypeId')}>
				{types.map((type) => (
					<option value={String(type.id)} selected={typeId === undefined ? undefined : type.id === typeId}>
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
					value={startValue}
					invalid={bad('startDate')}
					extra={{ 'data-start': '' }}
				/>
				<SelectField id={`startHalf-${uid}`} name="startHalf" label={t('book.startHalf')} invalid={bad('startHalf')} extra={{ 'data-start-half': '' }}>
					<option value="full" selected={half('full', draft?.startHalf ?? entry?.start_half, 'full')}>{t('book.fullDay')}</option>
					<option value="am" selected={half('am', draft?.startHalf ?? entry?.start_half, 'full')}>{t('book.am')}</option>
					<option value="pm" selected={half('pm', draft?.startHalf ?? entry?.start_half, 'full')}>{t('book.pm')}</option>
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
					invalid={bad('endDate')}
					extra={{ 'data-end': '' }}
				/>
				<SelectField
					id={`endHalf-${uid}`}
					name="endHalf"
					label={t('book.endHalf')}
					class="end-half-field"
					invalid={bad('endHalf')}
					extra={{ 'data-end-half': '' }}
					fieldExtra={{ 'data-end-half-field': '' }}
				>
					<option value="full" selected={half('full', draft?.endHalf ?? entry?.end_half, 'full')}>{t('book.fullDay')}</option>
					<option value="am" selected={half('am', draft?.endHalf ?? entry?.end_half, 'full')}>{t('book.am')}</option>
				</SelectField>
			</div>

			<TextField id={`note-${uid}`} name="note" label={t('book.note')} maxlength={500} value={noteValue} />
			{/* Private by default. The old behaviour was to share every note with
			    everyone, which was defensible for a shared calendar — the problem
			    was that the field gave no sign of it (ISSUES.md #17). */}
			<label class="checkline">
				<input type="checkbox" name="noteVisibility" value="shared" checked={shareNote} />
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
