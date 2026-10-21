import type { BookingDraft } from '../domain/leave.ts';
import type { LeaveEntry, LeaveType } from '../types.ts';
import { TextField } from './fields.tsx';
import { CheckIcon } from './icons.tsx';
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
	/** Where Discard goes when editing. The booking's own page, which closes the form. */
	discardHref?: string;
}

/**
 * Booking form, used for both creating and editing. A plain POST form that
 * works with JS disabled; `booking.js` adds the live summary.
 *
 * Two shapes of one form, switched by "One day" / "Several days" — radios, so
 * the switch is the form's own state and CSS (`:has`) shows the fields for
 * whichever is chosen, script or not. One day is a date and a part of it;
 * several days is a first and last day, each of which can be half. The
 * server reads `mode` and ignores the other shape's fields, which stay in the
 * form, hidden, holding whatever was typed before the switch (`parseBooking`).
 *
 * It replaced a form whose "Start half" and "End half" said nothing about
 * what a half was, whose end-half field appeared once a second date was
 * typed, and whose day count and who-else-is-away line arrived after the
 * button. Now the half days say "from noon" and "until noon", and the summary
 * — days, the balance before and after, who else is away — sits above the
 * button that commits to it.
 *
 * `type="date"` gives the native picker on both iOS and Android, which is a far
 * better mobile experience than any date-picker library and costs nothing.
 */
export function BookingForm({ types, today, compact, entry, defaultDate, errorField, draft, discardHref }: BookingFormProps) {
	const editing = Boolean(entry);
	const action = entry ? `/api/v1/leave/${entry.id}/edit` : '/api/v1/leave';

	const startValue = draft?.startDate ?? (entry ? entry.start_date : (defaultDate ?? today));
	const endSource = draft ?? (entry ? { startDate: entry.start_date, endDate: entry.end_date } : null);
	const endValue = endSource && endSource.endDate !== endSource.startDate ? endSource.endDate : '';
	// A booking that already spans days opens on Several days; anything else,
	// a new one included, on One day — by far the common case.
	const several = endValue !== '';
	const uid = entry?.id ?? 'new';

	const offered = types.filter((type) => type.active || type.id === entry?.leave_type_id);
	const typeId = draft?.leaveTypeId ?? entry?.leave_type_id ?? offered[0]?.id;
	// A dropped note (see `flashCookie`) leaves `draft.note` undefined, which
	// falls through to whatever the form held before — an empty string means the
	// reader deliberately cleared it.
	const noteValue = draft?.note ?? entry?.note ?? '';
	const shareNote = draft ? !draft.notePrivate : entry ? !entry.note_private : false;
	const startHalf = draft?.startHalf ?? entry?.start_half ?? 'full';
	const endHalf = draft?.endHalf ?? entry?.end_half ?? 'full';

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
			data-current-days={entry ? String(entry.days_total) : undefined}
			// Templates, with their placeholders intact, for the lines the client
			// fills in after asking the server. The wording stays in the
			// catalogue, not in the bundle.
			data-booking-strings={JSON.stringify({
				days: tRaw(lang, 'book.days'),
				bookDays: tRaw(lang, 'book.bookDays'),
				balance: t('book.balance'),
				balanceShort: t('book.balanceShort'),
				balanceNone: t('book.balanceNone'),
				coverage: t('book.coverage'),
				coverageFor: t('book.coverageFor'),
				coverageMore: t('book.coverageMore'),
			})}
		>
			{/* Chips, not a dropdown: four choices fit on one line, each in the
			    colour it will have on the calendar. Radios, so it is still one
			    field the form submits. A retired type is offered only to the
			    booking that already has it. */}
			<fieldset class={`type-chips ${bad('leaveTypeId') ? 'invalid' : ''}`}>
				<legend class="visually-hidden">{t('book.type')}</legend>
				{offered.map((type) => (
					<label class="type-chip">
						<input type="radio" name="leaveTypeId" value={String(type.id)} checked={type.id === typeId} required />
						<span class="dot" style={`--chip: ${type.color}`} aria-hidden="true" />
						<span>{lang === 'th' ? type.label_th : type.label_en}</span>
					</label>
				))}
			</fieldset>

			<Choice
				name="mode"
				label={t('book.howLong')}
				options={[
					['one', t('book.oneDay')],
					['range', t('book.severalDays')],
				]}
				value={several ? 'range' : 'one'}
				class="mode-switch"
			/>

			<div class="when">
				<div class="when-end">
					<TextField
						id={`startDate-${uid}`}
						name="startDate"
						label={
							<>
								<span class="one-only">{t('book.date')}</span>
								<span class="range-only">{t('book.from')}</span>
							</>
						}
						type="date"
						required
						value={startValue}
						invalid={bad('startDate')}
						extra={{ 'data-start': '' }}
					/>
					<Choice
						name="startHalf"
						label={t('book.firstDay')}
						options={[
							['full', t('book.allDay')],
							['pm', t('book.fromNoon')],
						]}
						value={startHalf === 'pm' ? 'pm' : 'full'}
						invalid={bad('startHalf')}
						class="range-only small"
					/>
				</div>
				<div class="when-end range-only">
					<TextField
						id={`endDate-${uid}`}
						name="endDate"
						label={t('book.to')}
						type="date"
						value={endValue}
						invalid={bad('endDate')}
						extra={{ 'data-end': '' }}
					/>
					<Choice
						name="endHalf"
						label={t('book.lastDay')}
						options={[
							['full', t('book.allDay')],
							['am', t('book.untilNoon')],
						]}
						value={endHalf === 'am' ? 'am' : 'full'}
						invalid={bad('endHalf')}
						class="range-only small"
					/>
				</div>
			</div>
			<Choice
				name="dayPart"
				label={t('book.dayPart')}
				options={[
					['full', t('book.fullDay')],
					['am', t('book.morning')],
					['pm', t('book.afternoon')],
				]}
				value={several ? 'full' : startHalf}
				invalid={bad('startHalf')}
				class="one-only"
			/>

			{/* Behind a disclosure: optional, and most bookings have none. Open
			    when there is one already. Private by default (ISSUES.md #17). */}
			<details class="note-block" open={noteValue !== ''}>
				<summary class="btn text">{noteValue ? t('book.noteHeading') : t('book.addNote')}</summary>
				<TextField id={`note-${uid}`} name="note" label={t('book.note')} maxlength={500} value={noteValue} />
				<label class="checkline">
					<input type="checkbox" name="noteVisibility" value="shared" checked={shareNote} />
					{t('book.shareNote')}
				</label>
				<p class="tf-support">{t('book.noteHelp')}</p>
			</details>

			{/* Filled in by booking.js before the button is pressed: what this
			    costs, what it leaves, and who else is away. Empty, and hidden,
			    without it. */}
			<div class="booking-summary" data-summary aria-live="polite">
				<p class="preview" data-preview></p>
				<p class="balance" data-balance></p>
				<p class="coverage" data-coverage></p>
			</div>

			<div class="actions">
				{/* "Discard", not "Cancel", when editing — that page also has a
				    button that cancels the leave itself, and two meanings of
				    Cancel side by side is how someone deletes a booking they
				    meant to keep. */}
				{editing ? (
					<a class="btn text" href={discardHref ?? '/me'}>{t('book.discard')}</a>
				) : (
					<a class="btn text" href="/" data-form-cancel>{t('book.cancel')}</a>
				)}
				<button type="submit" class="btn primary" data-submit>{editing ? t('book.save') : t('book.submit')}</button>
			</div>
		</form>
	);
}

/**
 * A segmented control over radios: one field, a few options, all visible.
 * The radios are what the form submits, so it works without scripting.
 */
function Choice(props: { name: string; label: string; options: [string, string][]; value: string; invalid?: boolean; class?: string }) {
	return (
		<div class={`segmented choice ${props.invalid ? 'invalid' : ''} ${props.class ?? ''}`} role="radiogroup" aria-label={props.label}>
			{props.options.map(([value, text]) => (
				<label>
					<input type="radio" name={props.name} value={value} checked={value === props.value} />
					<CheckIcon class="sm seg-check" />
					<span class="seg-text">{text}</span>
				</label>
			))}
		</div>
	);
}
