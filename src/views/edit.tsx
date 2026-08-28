import { describeRange, formatDays } from '../domain/dates.ts';
import type { BookingDraft } from '../domain/leave.ts';
import type { LeaveEntry, LeaveType, User } from '../types.ts';
import { Layout } from './layout.tsx';
import { BookingForm } from './booking.tsx';
import { ChevronLeftIcon, DeleteIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { t as translate, toLang } from '../i18n/strings.ts';

interface EditProps {
	user: User;
	entry: LeaveEntry;
	types: LeaveType[];
	today: string;
	/** Set when an admin is editing someone else's booking. */
	onBehalfOf?: string;
	version?: string;
	error?: string;
	/** The booking-form input the last submission was rejected over, if any. */
	errorField?: string;
	notice?: string;
	/** A rejected edit, to hand back to the form instead of the stored booking. */
	draft?: BookingDraft;
}

export function EditPage({ user, entry, types, today, onBehalfOf, version, error, errorField, notice, draft }: EditProps) {
	return (
		<Layout title={translate(toLang(user.lang), 'edit.title')} user={user} active="me" version={version}>
			<EditBody {...{ entry, types, today, onBehalfOf, error, errorField, notice, draft }} />
		</Layout>
	);
}

function EditBody({
	entry,
	types,
	today,
	onBehalfOf,
	error,
	errorField,
	notice,
	draft,
}: Omit<EditProps, 'user' | 'version'>) {
	const t = useT();
	const lang = useLang();
	return (
		<>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="page-head">
				<a class="icon-btn" href="/me" aria-label={t('edit.back')}>
					<ChevronLeftIcon />
				</a>
				<h1>{t('edit.title')}</h1>
			</div>

			{onBehalfOf ? (
				<div class="banner">{t('edit.onBehalf', { name: onBehalfOf })}</div>
			) : null}

			<section class="card">
				<h2>{t('edit.current')}</h2>
				<p class="leave-current">
					<span class="dot" style={`--chip: ${entry.color}`} />
					<strong>{describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half, lang)}</strong>
					<span class="muted">
						{' '}
						· {lang === 'th' ? entry.type_label_th : entry.type_label_en} ·{' '}
						{t('edit.days', { count: entry.days_total, days: formatDays(entry.days_total) })}
					</span>
				</p>
				{entry.note ? <p class="muted">{entry.note}</p> : null}
			</section>

			<section class="card">
				<h2>{t('edit.change')}</h2>
				<BookingForm types={types} today={today} entry={entry} errorField={errorField} draft={draft} compact />
			</section>

			<section class="card">
				<h2>{t('edit.remove')}</h2>
				<p class="muted">{t('edit.removeHelp', { count: entry.days_total, days: formatDays(entry.days_total) })}</p>
				<form method="post" action={`/api/leave/${entry.id}/cancel`}>
					<button type="submit" class="btn danger">
						<DeleteIcon class="sm" />
						{t('edit.removeButton')}
					</button>
				</form>
			</section>
		</>
	);
}
