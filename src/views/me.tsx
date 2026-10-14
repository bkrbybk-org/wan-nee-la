import { describeRange, formatDays } from '../domain/dates.ts';
import type { BookingDraft } from '../domain/leave.ts';
import type { Balance, LeaveEntry, LeaveType, User } from '../types.ts';
import { FlashBanner, Layout, YearNav } from './layout.tsx';
import { BookingForm } from './booking.tsx';
import { TextField } from './fields.tsx';
import { CheckIcon, DeleteIcon, EditIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { LANGS, t as translate, toLang, type Lang } from '../i18n/strings.ts';

interface MeProps {
	user: User;
	year: number;
	minYear: number;
	maxYear: number;
	balances: Balance[];
	entries: LeaveEntry[];
	types: LeaveType[];
	today: string;
	version?: string;
	error?: string;
	errorField?: string;
	notice?: string;
	/** A booking the server just rejected, to hand back to the form. */
	draft?: BookingDraft;
	/** The booking whose last change this page is offering to undo. */
	undo?: string;
}

export function MePage(props: MeProps) {
	return (
		<Layout title={translate(toLang(props.user.lang), 'me.title')} user={props.user} active="me" version={props.version}>
			<MeBody {...props} />
		</Layout>
	);
}

function MeBody(props: MeProps) {
	const { user, year, minYear, maxYear, balances, entries, types, today, error, errorField, notice, draft, undo } = props;
	const t = useT();
	const lang = useLang();
	const upcoming = entries.filter((e) => e.status === 'confirmed' && e.end_date >= today);
	const past = entries.filter((e) => e.status !== 'confirmed' || e.end_date < today);

	return (
		<>
			<FlashBanner error={error} notice={notice} undo={undo} />

			<div class="page-head">
				<h1>{t('me.title')}</h1>
				<YearNav basePath="/me" year={year} minYear={minYear} maxYear={maxYear} />
			</div>

			<section class="balances">
				{balances.map((b) => {
					const pct = b.allotted > 0 ? Math.min(100, (b.used / b.allotted) * 100) : 0;
					return (
						<div class="balance-card">
							<div class="balance-top">
								<span class="dot" style={`--chip: ${b.type.color}`} />
								<span class="balance-label">{lang === 'th' ? b.type.label_th : b.type.label_en}</span>
								<span class="balance-th muted">{lang === 'th' ? b.type.label_en : b.type.label_th}</span>
							</div>
							{b.type.counts_quota ? (
								<>
									<div class="balance-big">
										{formatDays(b.remaining)}
										<span class="unit">{t('me.daysLeft', { count: b.remaining })}</span>
									</div>
									<div
										class="meter"
										role="img"
										aria-label={t('me.meterLabel', { used: formatDays(b.used), allotted: formatDays(b.allotted) })}
									>
										<span class="meter-fill" style={`width: ${pct}%; --chip: ${b.type.color}`} />
									</div>
									<div class="balance-sub muted">
										{t('me.usedOf', { used: formatDays(b.used), allotted: formatDays(b.allotted) })}
									</div>
								</>
							) : (
								<>
									<div class="balance-big">
										{formatDays(b.used)}
										<span class="unit">{t('me.daysTaken', { count: b.used })}</span>
									</div>
									<div class="balance-sub muted">{t('me.noAllowance')}</div>
								</>
							)}
						</div>
					);
				})}
			</section>

			<section class="card">
				<h2>{t('book.submit')}</h2>
				<BookingForm types={types} today={today} errorField={errorField} draft={draft} compact />
			</section>

			<section class="card">
				<h2>{t('me.upcoming')}</h2>
				{upcoming.length === 0 ? (
					<p class="muted">{t('me.nothingBooked')}</p>
				) : (
					<ul class="leave-list">
						{upcoming.map((e) => (
							<LeaveRow entry={e} />
						))}
					</ul>
				)}
			</section>

			<section class="card">
				<h2>{t('me.earlier')}</h2>
				{past.length === 0 ? (
					<p class="muted">{t('me.nothingYet')}</p>
				) : (
					<ul class="leave-list">
						{past.map((e) => (
							<LeaveRow entry={e} />
						))}
					</ul>
				)}
			</section>

			{/* Browser notifications moved to the bell beside the theme toggle,
			    on every page: like the theme, they belong to this browser. */}

			<section class="card">
				<h2>{t('me.calendar')}</h2>
				<p class="muted">{t('me.weekStartHelp')}</p>
				{/* A segmented button: two mutually exclusive options that belong to
				    one setting. The radios inside are what the form submits, so this
				    is still an ordinary POST with scripting off. */}
				<form method="post" action="/me/week-start" class="row inline">
					<div class="segmented" role="group" aria-label={t('me.weekStart')}>
						<label>
							<input type="radio" name="weekStart" value="1" checked={user.week_start !== 0} />
							<CheckIcon class="sm seg-check" />
							<span class="seg-text">{t('me.monday')}</span>
						</label>
						<label>
							<input type="radio" name="weekStart" value="0" checked={user.week_start === 0} />
							<CheckIcon class="sm seg-check" />
							<span class="seg-text">{t('me.sunday')}</span>
						</label>
					</div>
					<button type="submit" class="btn tonal">{t('me.save')}</button>
				</form>
			</section>

			{/* Language sits with the other personal settings rather than in the top
			    bar: it is a preference stored per person, not a per-visit toggle. */}
			<section class="card">
				<h2>{t('me.language')}</h2>
				<p class="muted">{t('me.languageHelp')}</p>
				<form method="post" action="/me/lang" class="row inline">
					<div class="segmented" role="group" aria-label={t('me.language')}>
						{LANGS.map((code: Lang) => (
							<label>
								<input type="radio" name="lang" value={code} checked={lang === code} />
								<CheckIcon class="sm seg-check" />
								<span class="seg-text">{code === 'en' ? t('me.english') : t('me.thai')}</span>
							</label>
						))}
					</div>
					<button type="submit" class="btn tonal">{t('me.save')}</button>
				</form>
			</section>

			<section class="card">
				<h2>{t('me.displayName')}</h2>
				<p class="muted">{t('me.displayNameHelp')}</p>
				<form method="post" action="/me/name" class="row inline">
					<TextField id="displayName" name="displayName" label={t('me.displayName')} value={user.display_name} maxlength={60} required />
					<button type="submit" class="btn tonal">{t('me.save')}</button>
				</form>
			</section>
		</>
	);
}

/**
 * A booking in a list. Edit and remove are offered on every confirmed booking,
 * past ones included — sick leave in particular is often entered after the fact
 * and then needs correcting.
 */
function LeaveRow({ entry }: { entry: LeaveEntry }) {
	const t = useT();
	const lang = useLang();
	const cancelled = entry.status === 'cancelled';
	const when = describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half, lang);
	return (
		<li class={`leave-row ${cancelled ? 'cancelled' : ''}`}>
			<span class="dot" style={`--chip: ${entry.color}`} />
			<span class="leave-when">{when}</span>
			<span class="leave-type muted">{lang === 'th' ? entry.type_label_th : entry.type_label_en}</span>
			<span class="leave-days">{formatDays(entry.days_total)}d</span>
			{entry.note ? <span class="leave-note muted">{entry.note}</span> : null}
			{cancelled ? <span class="tag">{t('me.cancelled')}</span> : null}
			{!cancelled ? (
				<span class="row-actions">
					<a class="icon-btn" href={`/leave/${entry.id}/edit`} aria-label={t('me.editOn', { when })}>
						<EditIcon />
					</a>
					<form method="post" action={`/api/v1/leave/${entry.id}/cancel`} class="inline">
						<button type="submit" class="icon-btn" aria-label={t('me.removeOn', { when })}>
							<DeleteIcon />
						</button>
					</form>
				</span>
			) : null}
		</li>
	);
}
