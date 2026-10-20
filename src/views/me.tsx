import { daysBetween, describeRange, formatDays, monthName, monthShort, shortDate } from '../domain/dates.ts';
import type { MonthTotals } from '../domain/report.ts';
import type { Balance, LeaveEntry, LeaveType, User } from '../types.ts';
import { FlashBanner, Layout, YearNav } from './layout.tsx';
import { TextField } from './fields.tsx';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, SettingsIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { LANGS, t as translate, toLang, type Lang } from '../i18n/strings.ts';

/*
 * /me answers two questions before anything else: when am I off next, and how
 * much do I have left. It used to open on the balances, then put a whole
 * booking form between them and the bookings — which were listed furthest
 * first, so the next one was at the bottom — and end on three settings cards
 * with a Save each. The form is gone (the Book button, the calendar and /book
 * all reach it); the settings have their own page.
 */

export type MeList = 'upcoming' | 'past';

interface MeProps {
	user: User;
	year: number;
	minYear: number;
	maxYear: number;
	balances: Balance[];
	/** Days off in each month of `year`, by type — see `monthlyDays`. */
	months: MonthTotals[];
	/** Confirmed leave from today on, soonest first, any year. */
	upcoming: LeaveEntry[];
	/** Everything in `year` that started before today's leave, any status. */
	past: LeaveEntry[];
	list: MeList;
	types: LeaveType[];
	today: string;
	version?: string;
	error?: string;
	notice?: string;
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
	const { year, minYear, maxYear, balances, months, upcoming, past, list, types, today, error, notice, undo } = props;
	const t = useT();
	const thisYear = Number(today.slice(0, 4));
	const listHref = (l: MeList) => `/me?${new URLSearchParams({ ...(year !== thisYear ? { y: String(year) } : {}), ...(l === 'past' ? { list: 'past' } : {}) })}`.replace(/\?$/, '');
	const confirmedPast = past.filter((e) => e.status === 'confirmed').sort((a, b) => b.start_date.localeCompare(a.start_date));
	const cancelled = past.filter((e) => e.status === 'cancelled');

	return (
		<>
			<FlashBanner error={error} notice={notice} undo={undo} />

			<div class="page-head">
				<h1>{t('me.title')}</h1>
				<YearNav basePath="/me" year={year} minYear={minYear} maxYear={maxYear} />
				<a href="/me/settings" class="icon-btn" aria-label={t('me.settings')} title={t('me.settings')}>
					<SettingsIcon />
				</a>
			</div>

			<NextLeave next={upcoming[0]} today={today} />

			<section class="balances">
				{balances.map((b) => (
					<BalanceCard b={b} />
				))}
			</section>

			<section class="card my-leave">
				{/* Links, not a script-driven toggle: each list has its own URL and
				    the page works the same with scripting off. */}
				<nav class="segmented-links" aria-label={t('me.title')}>
					<a href={listHref('upcoming')} class={list === 'upcoming' ? 'on' : ''} aria-current={list === 'upcoming' ? 'page' : undefined}>
						{t('me.upcoming')} <span class="count">{upcoming.length}</span>
					</a>
					<a href={listHref('past')} class={list === 'past' ? 'on' : ''} aria-current={list === 'past' ? 'page' : undefined}>
						{t('me.earlierIn', { year })} <span class="count">{confirmedPast.length}</span>
					</a>
				</nav>

				{list === 'upcoming' ? (
					upcoming.length === 0 ? (
						<p class="muted">{t('me.nothingBooked')}</p>
					) : (
						<ul class="my-list">
							{upcoming.map((e) => (
								<MyRow entry={e} today={today} />
							))}
						</ul>
					)
				) : (
					<>
						{confirmedPast.length === 0 ? (
							<p class="muted">{t('me.nothingYet')}</p>
						) : (
							<ul class="my-list">
								{confirmedPast.map((e) => (
									<MyRow entry={e} today={today} />
								))}
							</ul>
						)}
						{/* Kept, out of the way: a cancelled booking took no days, but
						    "did I cancel that?" is a fair question. */}
						{cancelled.length > 0 ? (
							<details class="my-cancelled">
								<summary class="btn text">{t('me.showCancelled', { n: cancelled.length, count: cancelled.length })}</summary>
								<ul class="my-list">
									{cancelled.map((e) => (
										<MyRow entry={e} today={today} />
									))}
								</ul>
							</details>
						) : null}
					</>
				)}
			</section>

			<MonthBars months={months} types={types} year={year} />
		</>
	);
}

/**
 * When you are off next. Under way today, it says until when; otherwise how
 * far away it is. With nothing booked it is an invitation to book.
 */
function NextLeave({ next, today }: { next?: LeaveEntry; today: string }) {
	const t = useT();
	const lang = useLang();
	let lead: string;
	if (!next) lead = t('me.nothingNext');
	else if (next.start_date <= today) lead = t('me.underWay', { date: shortDate(next.end_date, lang) });
	else {
		const n = daysBetween(today, next.start_date);
		lead = n === 1 ? t('me.nextTomorrow') : t('me.nextIn', { n, count: n });
	}
	return (
		<section class="next-leave">
			<div class="next-leave-text">
				<span class="next-leave-lead">{lead}</span>
				{next ? (
					<a class="next-leave-what" href={`/leave/${next.id}/edit`}>
						{describeRange(next.start_date, next.end_date, next.start_half, next.end_half, lang)} · {lang === 'th' ? next.type_label_th : next.type_label_en} ·{' '}
						{t('me.days', { n: formatDays(next.days_total), count: next.days_total })}
					</a>
				) : null}
			</div>
			<a class="btn primary" href="/book">
				<PlusIcon />
				{t('book.submit')}
			</a>
		</section>
	);
}

/**
 * One leave type's balance. An overdrawn one says so — in the error colour,
 * as days over — rather than as a minus sign beside a full bar in the type's
 * own colour, which read as fine.
 */
function BalanceCard({ b }: { b: Balance }) {
	const t = useT();
	const lang = useLang();
	const over = b.type.counts_quota && b.remaining < 0;
	const pct = b.allotted > 0 ? Math.min(100, (b.used / b.allotted) * 100) : over ? 100 : 0;
	return (
		<div class={`balance-card ${over ? 'over' : ''}`}>
			<div class="balance-top">
				<span class="dot" style={`--chip: ${b.type.color}`} />
				<span class="balance-label">{lang === 'th' ? b.type.label_th : b.type.label_en}</span>
				<span class="balance-th muted">{lang === 'th' ? b.type.label_en : b.type.label_th}</span>
			</div>
			{b.type.counts_quota ? (
				<>
					<div class="balance-big">
						{formatDays(Math.abs(b.remaining))}
						<span class="unit">{over ? t('me.daysOver', { count: -b.remaining }) : t('me.daysLeft', { count: b.remaining })}</span>
					</div>
					<div class="meter" role="img" aria-label={t('me.meterLabel', { used: formatDays(b.used), allotted: formatDays(b.allotted) })}>
						<span class="meter-fill" style={`width: ${pct}%; --chip: ${b.type.color}`} />
					</div>
					<div class="balance-sub muted">{t('me.usedOf', { used: formatDays(b.used), allotted: formatDays(b.allotted) })}</div>
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
}

/**
 * A booking in the list: the whole row is the link to its page, where it can
 * be edited or removed — past ones included, since sick leave is often entered
 * after the fact and then corrected. Every row has the same shape; a note sits
 * on its own line under the dates, with whether colleagues can read it.
 */
function MyRow({ entry, today }: { entry: LeaveEntry; today: string }) {
	const t = useT();
	const lang = useLang();
	const cancelled = entry.status === 'cancelled';
	const when = describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half, lang);
	const otherYear = entry.start_date.slice(0, 4) !== today.slice(0, 4) ? ` ${entry.start_date.slice(0, 4)}` : '';
	const now = !cancelled && entry.start_date <= today && entry.end_date >= today;
	const body = (
		<>
			<span class="dot" style={`--chip: ${entry.color}`} />
			<span class="my-main">
				<span class="my-when">
					{when}
					{otherYear}
				</span>
				<span class="muted">
					{' '}
					{lang === 'th' ? entry.type_label_th : entry.type_label_en}
					{now ? ` · ${t('me.now')}` : ''}
				</span>
				{entry.note ? (
					<span class="my-note muted">
						{entry.note} · {entry.note_private ? t('me.notePrivate') : t('me.noteShared')}
					</span>
				) : null}
			</span>
			<span class="my-days">{formatDays(entry.days_total)}d</span>
			{cancelled ? <span class="tag">{t('me.cancelled')}</span> : <ChevronRightIcon class="my-go" />}
		</>
	);
	return (
		<li class={`my-row ${cancelled ? 'cancelled' : ''}`}>
			{cancelled ? (
				<div class="my-link">{body}</div>
			) : (
				<a class="my-link" href={`/leave/${entry.id}/edit`} aria-label={t('me.editOn', { when: `${when}${otherYear}` })}>
					{body}
				</a>
			)}
		</li>
	);
}

interface SettingsProps {
	user: User;
	version?: string;
	error?: string;
	notice?: string;
}

/**
 * Name, week start and language, in one form with one Save. They had a card
 * and a Save button each on /me, taking as much room as the leave itself for
 * things set once.
 */
export function MeSettingsPage(props: SettingsProps) {
	return (
		<Layout title={translate(toLang(props.user.lang), 'me.settings')} user={props.user} active="me" version={props.version}>
			<SettingsBody {...props} />
		</Layout>
	);
}

function SettingsBody({ user, error, notice }: SettingsProps) {
	const t = useT();
	const lang = useLang();
	return (
		<>
			<FlashBanner error={error} notice={notice} />
			<a href="/me" class="back-link">
				<ChevronLeftIcon />
				{t('me.title')}
			</a>
			<div class="page-head">
				<h1>{t('me.settings')}</h1>
			</div>
			<form method="post" action="/me/settings" class="card settings-form">
				<div class="setting">
					<h2>{t('me.displayName')}</h2>
					<p class="muted">{t('me.displayNameHelp')}</p>
					<TextField id="displayName" name="displayName" label={t('me.displayName')} value={user.display_name} maxlength={60} required />
				</div>
				<div class="setting">
					<h2>{t('me.calendar')}</h2>
					<p class="muted">{t('me.weekStartHelp')}</p>
					{/* A segmented button: two mutually exclusive options that belong
					    to one setting. The radios inside are what the form submits. */}
					<div class="segmented" role="radiogroup" aria-label={t('me.weekStart')}>
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
				</div>
				<div class="setting">
					<h2>{t('me.language')}</h2>
					<p class="muted">{t('me.languageHelp')}</p>
					<div class="segmented" role="radiogroup" aria-label={t('me.language')}>
						{LANGS.map((code: Lang) => (
							<label>
								<input type="radio" name="lang" value={code} checked={lang === code} />
								<CheckIcon class="sm seg-check" />
								<span class="seg-text">{code === 'en' ? t('me.english') : t('me.thai')}</span>
							</label>
						))}
					</div>
				</div>
				<div class="actions">
					<button type="submit" class="btn primary">{t('me.save')}</button>
					<a class="btn text" href="/me">{t('admin.cancel')}</a>
				</div>
			</form>
		</>
	);
}

/**
 * Days off in each month of the year, as twelve small bars split by leave
 * type, in the types' own colours.
 *
 * The balances above say how much is left; this says when it went, which is
 * the question behind "have I taken a proper break this year". Days are the
 * ones that fall in each month — a booking crossing a month end is split
 * across both — so a booking over New Year shows its December days here and
 * its January days next year, though the balance charges it all to the year
 * it started in.
 *
 * The bars are a picture only; a real table carries the same numbers for a
 * screen reader.
 */
function MonthBars({ months, types, year }: { months: MonthTotals[]; types: LeaveType[]; year: number }) {
	const t = useT();
	const lang = useLang();
	const max = Math.max(...months.map((m) => m.total));
	const label = (type: LeaveType) => (lang === 'th' ? type.label_th : type.label_en);
	const used = types.filter((type) => months.some((m) => m.byType.has(type.id)));
	return (
		<section class="card month-use">
			<h2>{t('me.byMonth')}</h2>
			{max === 0 ? (
				<p class="muted">{t('me.byMonthNone', { year })}</p>
			) : (
				<>
					<div class="month-bars" aria-hidden="true">
						{months.map((m) => (
							<div class="mb-col">
								<span class="mb-n">{m.total > 0 ? formatDays(m.total) : ''}</span>
								<span class="mb-stack" style={`height: ${Math.round((m.total / max) * 96)}px`}>
									{used.filter((type) => m.byType.has(type.id)).map((type) => (
										<span style={`flex: ${m.byType.get(type.id)}; background: ${type.color}`} title={label(type)} />
									))}
								</span>
								<span class="mb-m">{monthShort(m.month, lang)}</span>
							</div>
						))}
					</div>
					<table class="visually-hidden">
						<caption>{t('me.byMonth')}</caption>
						<thead>
							<tr>
								<th scope="col">{t('cal.month')}</th>
								{used.map((type) => <th scope="col">{label(type)}</th>)}
							</tr>
						</thead>
						<tbody>
							{months.filter((m) => m.total > 0).map((m) => (
								<tr>
									<th scope="row">{monthName(m.month, lang)}</th>
									{used.map((type) => <td>{formatDays(m.byType.get(type.id) ?? 0)}</td>)}
								</tr>
							))}
						</tbody>
					</table>
					<p class="muted mb-help">{t('me.byMonthHelp')}</p>
				</>
			)}
		</section>
	);
}
