import { daysBetween, describeRange, formatDays, shortDate } from '../domain/dates.ts';
import type { BookingDraft } from '../domain/leave.ts';
import type { AuditRow } from '../repo/db.ts';
import type { LeaveEntry, LeaveType, User } from '../types.ts';
import { FlashBanner, Layout } from './layout.tsx';
import { BookingForm } from './booking.tsx';
import { AuditItem } from './admin.tsx';
import { ChevronLeftIcon, DeleteIcon, EditIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { t as translate, toLang } from '../i18n/strings.ts';

/*
 * A booking's own page: what it is first, changing it second.
 *
 * It was three cards — "Currently booked", which repeated what the form under
 * it already showed, the form itself, and a Remove card a scroll below. Most
 * visits come from tapping a booking to look at it, so the page now answers
 * "what is this, and who has changed it" before offering to: the dates and
 * the owner as the heading, the facts beneath, its history from the audit
 * trail, and Edit and Remove as the two actions. Edit opens the same booking
 * form in place — a `<details>`, so no script is needed — and it opens by
 * itself when a save was just refused, with what was typed.
 */

interface EditProps {
	user: User;
	entry: LeaveEntry;
	types: LeaveType[];
	today: string;
	/** Set when an admin is looking at someone else's booking. */
	onBehalfOf?: string;
	/** Where Back goes: the page the reader came from, or their own leave. */
	back: string;
	/** The owner's allowance for the type, in the year the booking starts; null for a type without one. */
	balance: { type: string; remaining: number; year: number } | null;
	/** Everyone else away during the booking, with the days they overlap it. */
	alsoAway: { name: string; dates: string[] }[];
	history: AuditRow[];
	/** Display names for the history, by address. */
	names: Map<string, string>;
	version?: string;
	error?: string;
	/** The booking-form input the last submission was rejected over, if any. */
	errorField?: string;
	notice?: string;
	/** A rejected edit, to hand back to the form instead of the stored booking. */
	draft?: BookingDraft;
	/** The booking whose last change this page is offering to undo. */
	undo?: string;
}

export function EditPage(props: EditProps) {
	return (
		<Layout title={translate(toLang(props.user.lang), 'edit.title')} user={props.user} active="me" version={props.version}>
			<EditBody {...props} />
		</Layout>
	);
}

function EditBody(props: EditProps) {
	const { entry, types, today, onBehalfOf, back, balance, alsoAway, history, names, error, errorField, notice, draft, undo } = props;
	const t = useT();
	const lang = useLang();
	const typeName = lang === 'th' ? entry.type_label_th : entry.type_label_en;
	const self = `/leave/${entry.id}/edit`;

	let status: string;
	if (entry.end_date < today) status = t('edit.statusPast');
	else if (entry.start_date <= today) status = t('edit.statusNow', { date: shortDate(entry.end_date, lang) });
	else {
		const n = daysBetween(today, entry.start_date);
		status = n === 1 ? t('edit.statusTomorrow') : t('edit.statusIn', { n, count: n });
	}

	return (
		<>
			<FlashBanner error={error} notice={notice} undo={undo} />

			<a href={back} class="back-link">
				<ChevronLeftIcon />
				{t('edit.back')}
			</a>

			<section class="card booking-view">
				<div class="booking-head">
					<div>
						<h1>
							<span class="dot" style={`--chip: ${entry.color}`} aria-hidden="true" />
							{describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half, lang)}
						</h1>
						<p class="muted">
							{entry.display_name} · {typeName}
						</p>
					</div>
					<span class={`tag ${entry.end_date < today ? '' : 'good'}`}>{status}</span>
				</div>
				{onBehalfOf ? <p class="booking-admin muted">{t('edit.onBehalf', { name: onBehalfOf })}</p> : null}

				<dl class="booking-facts">
					<dt>{t('edit.factDays')}</dt>
					<dd>{t('edit.days', { count: entry.days_total, days: formatDays(entry.days_total) })}</dd>
					<dt>{t('edit.factNote')}</dt>
					<dd>
						{entry.note ? (
							<>
								{entry.note} <span class="muted">· {entry.note_private ? t('me.notePrivate') : t('me.noteShared')}</span>
							</>
						) : (
							<span class="muted">{t('edit.noNote')}</span>
						)}
					</dd>
					<dt>{t('edit.factBalance')}</dt>
					<dd>
						{balance
							? t('edit.balanceIn', { type: balance.type, remaining: formatDays(balance.remaining), year: balance.year })
							: <span class="muted">{t('edit.noAllowance')}</span>}
					</dd>
					<dt>{t('edit.factAway')}</dt>
					<dd>
						{alsoAway.length === 0 ? (
							<span class="muted">{t('edit.nobodyElse')}</span>
						) : (
							alsoAway
								.map((p) => t('edit.awayOn', { name: p.name, dates: p.dates.length > 2 ? `${shortDate(p.dates[0], lang)} – ${shortDate(p.dates.at(-1)!, lang)}` : p.dates.map((d) => shortDate(d, lang)).join(', ') }))
								.join(' · ')
						)}
					</dd>
				</dl>

				{/* The two actions. Each a disclosure, so neither needs script: Edit
				    opens the form, Remove asks once before it removes. */}
				<div class="booking-actions">
					<details class="booking-edit" open={Boolean(errorField || draft)}>
						<summary class="btn primary">
							<EditIcon class="sm" />
							{t('edit.edit')}
						</summary>
						<div class="booking-edit-form">
							<BookingForm types={types} today={today} entry={entry} errorField={errorField} draft={draft} discardHref={self} compact />
						</div>
					</details>
					<details class="booking-remove">
						<summary class="btn text danger">
							<DeleteIcon class="sm" />
							{t('edit.removeAsk')}
						</summary>
						<div class="booking-remove-confirm">
							<p class="muted">{t('edit.removeHelp', { count: entry.days_total, days: formatDays(entry.days_total) })}</p>
							<form method="post" action={`/api/v1/leave/${entry.id}/cancel`}>
								<button type="submit" class="btn danger">
									<DeleteIcon class="sm" />
									{t('edit.removeButton')}
								</button>
							</form>
						</div>
					</details>
				</div>
			</section>

			{history.length > 0 ? (
				<section class="card">
					<h2>{t('edit.history')}</h2>
					<ul class="leave-list booking-history">
						{history.map((row) => (
							<AuditItem row={row} names={names} />
						))}
					</ul>
				</section>
			) : null}
		</>
	);
}
