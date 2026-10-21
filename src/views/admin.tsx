import type { Child } from 'hono/jsx';
import { describeRange, formatDays, shortDate, weekdayName } from '../domain/dates.ts';
import { allottedFor } from '../domain/leave.ts';
import type { Holiday, LeaveType, Quota, User } from '../types.ts';
import { AUDIT_ACTIONS } from '../repo/db.ts';
import type { AuditFilter, AuditRow, LeaveSnapshot, NotificationRun } from '../repo/db.ts';
import type { HolidayGap, HolidayParse, ImportPlan } from '../domain/holidays.ts';
import type { UnusedRow } from '../domain/report.ts';
import { FlashBanner, HolidaysDueBanner, Layout, YearNav } from './layout.tsx';
import { SelectField, TextField } from './fields.tsx';
import { AskOnceDelete, BackLink, FormActions } from './parts.tsx';
import { BellIcon, BellRingIcon, CalendarIcon, HourglassIcon, ChevronLeftIcon, DownloadIcon, EditIcon, HistoryIcon, TagIcon, UsersIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { t as translate, toLang } from '../i18n/strings.ts';
import type { StringKey } from '../i18n/strings.ts';

/*
 * The admin area: an overview at /admin and one page per job.
 *
 * It was one page — quotas, leave types, holidays, LINE, the export and the
 * trail stacked in a single scroll, six thousand pixels on a laptop and ten on
 * a phone, with two forms and two Save buttons per person. Saving one form
 * dropped whatever had been typed into the other, and the page grew with every
 * hire. Now the overview answers "is anything wrong?" and each section is its
 * own page: shorter, linkable, and still plain HTML forms that work without
 * JavaScript.
 */

export type AdminSection = 'people' | 'types' | 'holidays' | 'notifications' | 'yearend' | 'export' | 'activity';

const SECTIONS: { key: AdminSection; href: string; label: StringKey }[] = [
	{ key: 'people', href: '/admin/people', label: 'admin.people' },
	{ key: 'types', href: '/admin/types', label: 'admin.types' },
	{ key: 'holidays', href: '/admin/holidays', label: 'admin.holidays' },
	{ key: 'notifications', href: '/admin/notifications', label: 'admin.notifications' },
	{ key: 'yearend', href: '/admin/year-end', label: 'admin.yearEnd' },
	{ key: 'export', href: '/admin/export', label: 'admin.export' },
	{ key: 'activity', href: '/admin/activity', label: 'admin.activity' },
];

interface ShellProps {
	user: User;
	version?: string;
	/** Absent on the overview, which has no tab row. */
	section?: AdminSection;
	/** Beside the heading — a year switcher, where the page has a year. */
	headExtra?: Child;
	/** A page under a section — one person — names itself, and links back to the section. */
	heading?: string;
	error?: string;
	notice?: string;
	children?: Child;
}

/** Every admin page: the layout, the flash, the heading and — on a section — the tab row. */
function AdminShell({ user, version, section, headExtra, heading: own, error, notice, children }: ShellProps) {
	const lang = toLang(user.lang);
	const sectionName = section ? translate(lang, SECTIONS.find((s) => s.key === section)!.label) : translate(lang, 'admin.title');
	const heading = own ?? sectionName;
	const title = section ? `${own ? `${own} · ` : ''}${sectionName} · ${translate(lang, 'admin.title')}` : heading;
	return (
		<Layout title={title} user={user} active="admin" version={version}>
			<FlashBanner error={error} notice={notice} />
			{section ? <AdminTabs current={section} /> : null}
			{own && section ? <BackLink href={SECTIONS.find((s) => s.key === section)!.href} label={sectionName} /> : null}
			<div class="page-head">
				<h1>{heading}</h1>
				{headExtra}
			</div>
			{children}
		</Layout>
	);
}

/**
 * The way between sections, and back to the overview. Links, so every section
 * has its own URL; a row of chips that scrolls sideways on a phone rather than
 * wrapping into three lines above the content.
 */
function AdminTabs({ current }: { current: AdminSection }) {
	const t = useT();
	return (
		<nav class="admin-tabs" aria-label={t('admin.sections')}>
			<a href="/admin" class="admin-back" aria-label={t('admin.title')}>
				<ChevronLeftIcon />
				<span>{t('admin.title')}</span>
			</a>
			{SECTIONS.map((s) => (
				<a href={s.href} class={s.key === current ? 'admin-tab on' : 'admin-tab'} aria-current={s.key === current ? 'page' : undefined}>
					{t(s.label)}
				</a>
			))}
		</nav>
	);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface OverviewProps {
	user: User;
	version?: string;
	today: string;
	holidaysDue: HolidayGap | null;
	/** Names of people away today, working days only. */
	awayToday: string[];
	/** People with notifications on, of the active roster; null when push is not configured. */
	push: { people: number; active: number } | null;
	/** The most recent daily-digest run on any channel, if one exists. */
	lastDigest: NotificationRun | null;
	changesWeek: number;
	changesTotal: number;
	users: User[];
	types: LeaveType[];
	holidayCounts: { year: number; n: number }[];
	lineEnabled: boolean;
	/** Unbooked days of annual leave this year, for the tile; null without an annual type. */
	unused: { type: string; days: number } | null;
	error?: string;
	notice?: string;
}

/**
 * What an admin opens to: anything that needs doing, four numbers that say
 * whether the app is doing its job, and the way into each section.
 */
export function AdminOverviewPage(props: OverviewProps) {
	return (
		<AdminShell user={props.user} version={props.version} error={props.error} notice={props.notice}>
			<OverviewBody {...props} />
		</AdminShell>
	);
}

function OverviewBody(props: OverviewProps) {
	const { today, holidaysDue, awayToday, push, lastDigest, changesWeek, changesTotal, users, types, holidayCounts, lineEnabled, unused } = props;
	const t = useT();
	const lang = useLang();
	const active = users.filter((u) => u.active);
	const admins = active.filter((u) => u.is_admin).length;
	const offered = types.filter((ty) => ty.active).length;
	const retired = types.length - offered;

	const digest = !lastDigest
		? { text: t('admin.digestNone'), tone: '' }
		: lastDigest.date === today
			? lastDigest.status === 'failed'
				? { text: t('admin.digestFailedToday'), tone: 'bad' }
				: { text: t('admin.digestToday'), tone: 'good' }
			: { text: t('admin.digestLast', { date: shortDate(lastDigest.date, lang) }), tone: lastDigest.status === 'failed' ? 'bad' : '' };

	const [h1, h2] = holidayCounts;
	return (
		<>
			{holidaysDue ? <HolidaysDueBanner gap={holidaysDue} link /> : null}

			<div class="admin-metrics">
				<div class="admin-metric">
					<span class="admin-metric-label">{t('admin.awayToday')}</span>
					<span class="admin-metric-value">{awayToday.length}</span>
					<span class="admin-metric-note">{awayToday.length ? awayToday.slice(0, 3).join(', ') + (awayToday.length > 3 ? ` +${awayToday.length - 3}` : '') : t('admin.nobody')}</span>
				</div>
				<div class="admin-metric">
					<span class="admin-metric-label">{t('admin.notifyOn')}</span>
					{push ? (
						<>
							<span class="admin-metric-value">{push.people}</span>
							<span class="admin-metric-note">{t('admin.ofPeople', { total: push.active })}</span>
						</>
					) : (
						<span class="admin-metric-value small">{t('admin.notSetUp')}</span>
					)}
				</div>
				<div class="admin-metric">
					<span class="admin-metric-label">{t('admin.lastDigest')}</span>
					<span class={`admin-metric-value small ${digest.tone}`}>{digest.text}</span>
				</div>
				<div class="admin-metric">
					<span class="admin-metric-label">{t('admin.changesWeek')}</span>
					<span class="admin-metric-value">{changesWeek}</span>
				</div>
			</div>

			<ul class="admin-tiles">
				<Tile href="/admin/people" Icon={UsersIcon} title={t('admin.people')} note={t('admin.tilePeople', { n: active.length, count: admins })} />
				<Tile
					href="/admin/types"
					Icon={TagIcon}
					title={t('admin.types')}
					note={retired ? t('admin.tileTypesRetired', { n: offered, retired }) : t('admin.tileTypes', { n: offered })}
				/>
				<Tile
					href="/admin/holidays"
					Icon={CalendarIcon}
					title={t('admin.holidays')}
					note={t('admin.tileHolidays', { y1: h1.year, n1: h1.n, y2: h2.year, n2: h2.n })}
					alert={Boolean(holidaysDue)}
				/>
				<Tile
					href="/admin/notifications"
					Icon={BellIcon}
					title={t('admin.notifications')}
					note={t('admin.tileNotify', { push: push ? t('admin.on') : t('admin.off'), line: lineEnabled ? t('admin.on') : t('admin.off') })}
				/>
				{unused ? (
					<Tile
						href="/admin/year-end"
						Icon={HourglassIcon}
						title={t('admin.yearEnd')}
						note={t('admin.tileYearEnd', { n: formatDays(unused.days), type: unused.type })}
					/>
				) : null}
				<Tile href="/admin/export" Icon={DownloadIcon} title={t('admin.export')} note={t('admin.tileExport')} />
				<Tile href="/admin/activity" Icon={HistoryIcon} title={t('admin.activity')} note={t('admin.tileActivity', { n: changesTotal, count: changesTotal })} />
			</ul>
		</>
	);
}

function Tile({ href, Icon, title, note, alert }: { href: string; Icon: typeof UsersIcon; title: string; note: string; alert?: boolean }) {
	return (
		<li>
			<a href={href} class={alert ? 'admin-tile alert' : 'admin-tile'}>
				<Icon class="admin-tile-icon" />
				<span class="admin-tile-text">
					<strong>{title}</strong>
					<span class="muted">{note}</span>
				</span>
			</a>
		</li>
	);
}

// ---------------------------------------------------------------------------
// Unused leave
// ---------------------------------------------------------------------------

export interface YearEndProps {
	user: User;
	version?: string;
	year: number;
	minYear: number;
	maxYear: number;
	thisYear: number;
	type: LeaveType | null;
	rows: UnusedRow[];
	pushCounts: Map<string, number> | null;
	/** This year's reminder, once it has been claimed. */
	reminder: NotificationRun | null;
	error?: string;
	notice?: string;
}

/**
 * Who still has annual leave unbooked, and the November reminder that tells
 * them. Unused days do not carry over, so this is the page to open in the
 * autumn: who to nudge, and whether the app already has.
 */
export function AdminYearEndPage(props: YearEndProps) {
	const { user, version, year, minYear, maxYear, error, notice } = props;
	return (
		<AdminShell
			user={user}
			version={version}
			section="yearend"
			error={error}
			notice={notice}
			headExtra={<YearNav basePath="/admin/year-end" year={year} minYear={minYear} maxYear={maxYear} />}
		>
			<YearEndBody {...props} />
		</AdminShell>
	);
}

function YearEndBody({ year, thisYear, type, rows, pushCounts, reminder }: YearEndProps) {
	const t = useT();
	const lang = useLang();
	if (!type) {
		return (
			<section class="card">
				<p class="muted">{t('admin.yearEndNoType')}</p>
			</section>
		);
	}
	const typeName = lang === 'th' ? type.label_th : type.label_en;
	const owed = rows.filter((r) => r.left > 0);
	const total = owed.reduce((n, r) => n + r.left, 0);
	const when = (r: NotificationRun) => shortDate(r.sent_at.slice(0, 10), lang);

	return (
		<>
			{year === thisYear ? (
				<section class="card">
					<h2>{t('admin.remindHead')}</h2>
					{!pushCounts ? (
						<p class="muted">{t('admin.remindOff')}</p>
					) : !reminder ? (
						<>
							<p class="muted">{t('admin.remindPlanned')}</p>
							<form method="post" action="/admin/year-end/remind">
								<button type="submit" class="btn tonal" disabled={owed.length === 0}>
									<BellRingIcon class="sm" />
									{t('admin.remindNow')}
								</button>
								<span class="tf-support">{t('admin.remindNowHelp')}</span>
							</form>
						</>
					) : reminder.status === 'failed' ? (
						<p class="bad">{t('admin.remindFailed', { date: when(reminder), error: reminder.error ?? '' })}</p>
					) : reminder.status === 'skipped_empty' ? (
						<p>{t('admin.remindEmpty', { date: when(reminder) })}</p>
					) : (
						<p data-reminder-sent>{t('admin.remindSent', { date: when(reminder), n: reminder.people, count: reminder.people })}</p>
					)}
				</section>
			) : null}

			<section class="card">
				<h2>{t('admin.yearEndHead', { type: typeName, year })}</h2>
				<p class="muted">{t('admin.yearEndHelp', { year })}</p>
				<p data-yearend-total>
					{owed.length ? t('admin.yearEndTotal', { people: owed.length, active: rows.length, days: formatDays(total) }) : t('admin.yearEndNone')}
				</p>
				<div class="table-scroll">
					<table class="grid-table people-table yearend-table">
						<thead>
							<tr>
								<th>{t('admin.person')}</th>
								<th class="num">{t('admin.allowance')}</th>
								<th class="num">{t('admin.booked')}</th>
								<th class="num">{t('admin.leftCol')}</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr class={r.left > 0 ? '' : 'inactive'}>
									<td>
										<a href={`/admin/people/${encodeURIComponent(r.email)}?y=${year}`} class="person-link">
											<strong>{r.name}</strong>
										</a>
										{pushCounts && r.left > 0 ? <PushState n={pushCounts.get(r.email) ?? 0} /> : null}
									</td>
									<td class="num">{formatDays(r.allotted)}</td>
									<td class="num">{formatDays(r.booked)}</td>
									<td class={`num ${r.left < 0 ? 'bad' : ''}`}>
										<strong>{formatDays(r.left)}</strong>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</>
	);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PeopleProps {
	user: User;
	version?: string;
	year: number;
	minYear: number;
	maxYear: number;
	users: User[];
	types: LeaveType[];
	quotas: Quota[];
	pushCounts: Map<string, number> | null;
	error?: string;
	notice?: string;
}

/**
 * The roster, read-only: one row per person, one column per offered type.
 * Changing anything is one click to that person's own form — so a role and
 * the allowances are saved together, and nothing typed is lost to the other
 * form's Save.
 */
export function AdminPeoplePage(props: PeopleProps) {
	const { user, version, year, minYear, maxYear, error, notice } = props;
	return (
		<AdminShell
			user={user}
			version={version}
			section="people"
			error={error}
			notice={notice}
			headExtra={<YearNav basePath="/admin/people" year={year} minYear={minYear} maxYear={maxYear} />}
		>
			<PeopleBody {...props} />
		</AdminShell>
	);
}

function PeopleBody({ year, users, types, quotas, pushCounts }: PeopleProps) {
	const t = useT();
	const lang = useLang();
	// Only types that can still be booked: a retired type's rows stay in the
	// database, they just stop being something to maintain.
	const offered = types.filter((type) => type.active);
	const typeName = (type: LeaveType) => (lang === 'th' ? type.label_th : type.label_en);
	// The same helper the booking check uses, so a year nobody has set shows the
	// number that will actually be enforced rather than a zero.
	const quotaFor = (email: string, type: LeaveType) => allottedFor(type, quotas.filter((q) => q.user_email === email));
	// Active people first, then those who have left; each group by name.
	const rows = [...users].sort((a, b) => b.active - a.active || a.display_name.localeCompare(b.display_name));

	return (
		<section class="card">
			<div class="card-head">
				<h2>{t('admin.allowances', { year })}</h2>
				<details class="bulk-quota">
					<summary class="btn text">{t('admin.setOneType')}</summary>
					<form method="post" action="/admin/quotas/bulk" class="quota-form bulk-quota-form">
						<input type="hidden" name="year" value={String(year)} />
						<SelectField id="bulk-type" name="leaveTypeId" label={t('book.type')} required>
							{offered.map((type) => (
								<option value={String(type.id)}>{typeName(type)}</option>
							))}
						</SelectField>
						<TextField id="bulk-days" name="days" label={t('admin.days')} type="number" step="0.5" min="0" max="365" required class="quota-cell" />
						<button type="submit" class="btn tonal">{t('admin.setForEveryone')}</button>
					</form>
				</details>
			</div>
			<p class="muted">{t('admin.peopleHelp', { year })}</p>
			<div class="table-scroll">
				<table class="grid-table people-table">
					<thead>
						<tr>
							<th>{t('admin.person')}</th>
							{offered.map((type) => (
								<th class="num">
									<span class="dot" style={`--chip: ${type.color}`} /> {typeName(type)}
								</th>
							))}
							<th>
								<span class="visually-hidden">{t('admin.edit')}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((u) => {
							const edit = `/admin/people/${encodeURIComponent(u.email)}?y=${year}`;
							return (
								<tr class={u.active ? '' : 'inactive'}>
									<td>
										<a href={edit} class="person-link">
											<strong>{u.display_name}</strong>
										</a>
										{u.is_admin ? <span class="tag">{t('admin.isAdmin')}</span> : null}
										{u.active ? null : <span class="tag">{t('admin.left')}</span>}
										{pushCounts && u.active ? <PushState n={pushCounts.get(u.email) ?? 0} /> : null}
										<span class="muted mono person-email">{u.email}</span>
									</td>
									{offered.map((type) => (
										<td class="num">{type.counts_quota ? formatDays(quotaFor(u.email, type)) : '—'}</td>
									))}
									<td class="row-action">
										<a href={edit} class="icon-btn" aria-label={t('admin.editPerson', { name: u.display_name })}>
											<EditIcon />
										</a>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</section>
	);
}

export interface PersonProps {
	user: User;
	version?: string;
	subject: User;
	year: number;
	minYear: number;
	maxYear: number;
	types: LeaveType[];
	quotas: Quota[];
	pushCount: number | null;
	error?: string;
	notice?: string;
}

/** One person: role, status and every allowance for the year, in one form with one Save. */
export function AdminPersonPage(props: PersonProps) {
	const { user, version, subject, year, minYear, maxYear, error, notice } = props;
	const base = `/admin/people/${encodeURIComponent(subject.email)}`;
	return (
		<AdminShell
			user={user}
			version={version}
			section="people"
			heading={subject.display_name}
			error={error}
			notice={notice}
			headExtra={<YearNav basePath={base} year={year} minYear={minYear} maxYear={maxYear} />}
		>
			<PersonBody {...props} />
		</AdminShell>
	);
}

function PersonBody({ subject, year, types, quotas, pushCount }: PersonProps) {
	const t = useT();
	const lang = useLang();
	const offered = types.filter((type) => type.active);
	const typeName = (type: LeaveType) => (lang === 'th' ? type.label_th : type.label_en);
	const base = `/admin/people/${encodeURIComponent(subject.email)}`;
	return (
		<section class="card">
			<div class="person-head">
				<div class="person">
					<span class="muted mono">{subject.email}</span>
					{pushCount !== null ? <PushState n={pushCount} /> : null}
				</div>
				<a class="btn text" href={`/u/${encodeURIComponent(subject.email)}`}>{t('admin.viewLeave')}</a>
			</div>
			<form method="post" action={base} class="person-form">
				<input type="hidden" name="year" value={String(year)} />
				<h3 class="sub">{t('admin.allowances', { year })}</h3>
				<div class="quota-form">
					{offered.map((type) => (
						<TextField
							id={`q-${type.id}`}
							name={`q_${type.id}`}
							label={typeName(type)}
							type="number"
							value={formatDays(allottedFor(type, quotas))}
							step="0.5"
							min="0"
							max="365"
							class="quota-cell"
							support={type.counts_quota ? undefined : t('admin.noAllowance')}
						/>
					))}
				</div>
				<h3 class="sub">{t('admin.roleStatus')}</h3>
				<label class="checkline">
					<input type="checkbox" name="isAdmin" value="1" checked={!!subject.is_admin} /> {t('admin.isAdmin')}
				</label>
				<label class="checkline">
					<input type="checkbox" name="active" value="1" checked={!!subject.active} /> {t('admin.isActive')}
				</label>
				<p class="muted">{t('admin.activeHelp')}</p>
				<FormActions cancel={<a class="btn text" href={`/admin/people?y=${year}`}>{t('admin.cancel')}</a>}>
					<button type="submit" class="btn primary">{t('admin.save')}</button>
				</FormActions>
			</form>
		</section>
	);
}

/**
 * Whether someone gets the 09:00 notification. A count of browsers, nothing
 * about them — which push service or device is not a roster fact.
 */
function PushState({ n }: { n: number }) {
	const t = useT();
	return n > 0 ? (
		<span class="push-state on" title={t('admin.pushOn', { n })}>
			<BellRingIcon />
			<span class="push-text">{t('admin.pushOn', { n })}</span>
		</span>
	) : (
		<span class="push-state muted" title={t('admin.pushOff')}>
			<BellIcon />
			<span class="push-text">{t('admin.pushOff')}</span>
		</span>
	);
}

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

export interface TypesProps {
	user: User;
	version?: string;
	types: LeaveType[];
	/** Bookings per type id, any status. A type with none is the only kind that can be deleted. */
	usage: Map<number, number>;
	error?: string;
	notice?: string;
}

/**
 * Leave types, read first: changed perhaps once a year, so each row is a line
 * of facts and its form opens only when asked for.
 */
export function AdminTypesPage(props: TypesProps) {
	return (
		<AdminShell user={props.user} version={props.version} section="types" error={props.error} notice={props.notice}>
			<TypesBody {...props} />
		</AdminShell>
	);
}

function TypesBody({ types, usage }: TypesProps) {
	const t = useT();
	const lang = useLang();
	const typeName = (type: LeaveType) => (lang === 'th' ? type.label_th : type.label_en);
	return (
		<section class="card">
			<p class="muted">{t('admin.typesHelp')}</p>
			<ul class="type-list">
				{types.map((type) => {
					const booked = usage.get(type.id) ?? 0;
					return (
						<li class={type.active ? '' : 'inactive'}>
							<details class="type-row">
								<summary>
									<span class="dot" style={`--chip: ${type.color}`} />
									<strong>{typeName(type)}</strong>
									<span class="muted">{lang === 'th' ? type.label_en : type.label_th}</span>
									<span class="mono muted">{type.code}</span>
									{type.active ? null : <span class="tag">{t('admin.retired')}</span>}
									<span class="type-facts muted">
										{type.counts_quota ? t('admin.defaultDaysN', { n: formatDays(type.default_days) }) : t('admin.noAllowance')} · {t('admin.bookings', { n: booked, count: booked })}
									</span>
									{/* A pencil, as on People: the row's one way to edit. */}
									<span class="icon-btn type-edit" aria-hidden="true">
										<EditIcon />
									</span>
									<span class="visually-hidden">{t('admin.editType', { label: typeName(type) })}</span>
								</summary>
								<form method="post" action="/admin/type" class="type-form">
									<input type="hidden" name="id" value={String(type.id)} />
									<TypeFields type={type} />
									<label class="checkline">
										<input type="checkbox" name="active" value="1" checked={!!type.active} /> {t('admin.offered')}
									</label>
									<button type="submit" class="btn small tonal">{t('admin.save')}</button>
								</form>
								{/* Offered only where it can succeed. The route re-checks, and so
								    does the DELETE itself, in case someone books it meanwhile. */}
								{booked === 0 ? (
									<AskOnceDelete
										action="/admin/type/delete"
										fields={{ id: String(type.id) }}
										label={t('admin.deleteType', { label: typeName(type) })}
										confirm={t('admin.deleteTypeAsk')}
										button={t('admin.deleteTypeButton')}
									/>
								) : null}
							</details>
						</li>
					);
				})}
			</ul>
			<details class="import-block">
				<summary class="btn text">{t('admin.addType')}</summary>
				<form method="post" action="/admin/type" class="type-form">
					<TextField id="type-code" name="code" label={t('admin.typeCode')} maxlength={24} required support={t('admin.typeCodeHelp')} class="type-code" />
					<TypeFields />
					<button type="submit" class="btn tonal">{t('admin.add')}</button>
				</form>
			</details>
		</section>
	);
}

/** The editable half of a leave type, shared by the add form and each row's edit form. */
function TypeFields({ type }: { type?: LeaveType }) {
	const t = useT();
	const key = type ? String(type.id) : 'new';
	return (
		<>
			<TextField id={`type-th-${key}`} name="label_th" label={t('admin.labelTh')} value={type?.label_th} maxlength={40} required />
			<TextField id={`type-en-${key}`} name="label_en" label={t('admin.labelEn')} value={type?.label_en} maxlength={40} required />
			<label class="color-field">
				<span class="muted">{t('admin.color')}</span>
				<input type="color" name="color" value={type?.color ?? '#0891b2'} required />
			</label>
			<TextField
				id={`type-days-${key}`}
				name="default_days"
				label={t('admin.defaultDays')}
				type="number"
				value={type ? formatDays(type.default_days) : '0'}
				step="0.5"
				min="0"
				max="365"
				required
				class="quota-cell"
			/>
			<TextField
				id={`type-order-${key}`}
				name="sort_order"
				label={t('admin.order')}
				type="number"
				value={String(type?.sort_order ?? 9)}
				step="1"
				min="0"
				max="999"
				class="quota-cell"
			/>
			<label class="checkline">
				<input type="checkbox" name="counts_quota" value="1" checked={type ? !!type.counts_quota : true} /> {t('admin.countsQuota')}
			</label>
		</>
	);
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export interface HolidaysProps {
	user: User;
	version?: string;
	year: number;
	minYear: number;
	maxYear: number;
	holidays: Holiday[];
	holidaysDue: HolidayGap | null;
	error?: string;
	notice?: string;
}

/** One year's holidays at a time, each with its weekday — the thing that decides whether it costs anyone a day. */
export function AdminHolidaysPage(props: HolidaysProps) {
	const { user, version, year, minYear, maxYear, error, notice } = props;
	return (
		<AdminShell
			user={user}
			version={version}
			section="holidays"
			error={error}
			notice={notice}
			headExtra={<YearNav basePath="/admin/holidays" year={year} minYear={minYear} maxYear={maxYear} />}
		>
			<HolidaysBody {...props} />
		</AdminShell>
	);
}

function HolidaysBody({ year, holidays, holidaysDue }: HolidaysProps) {
	const t = useT();
	const lang = useLang();
	return (
		<>
			{holidaysDue && holidaysDue.year === year ? <HolidaysDueBanner gap={holidaysDue} /> : null}
			<section class="card">
				<p class="muted">{t('admin.holidaysHelp')}</p>
				<form method="post" action="/admin/holiday" class="row inline">
					<TextField id="holiday-date" name="date" label={t('admin.date')} type="date" required />
					<TextField id="holiday-label" name="label" label={t('admin.name')} maxlength={80} required support={t('admin.nameExample')} />
					<button type="submit" class="btn tonal">{t('admin.add')}</button>
				</form>
				<details class="import-block" open={holidaysDue?.year === year}>
					<summary class="btn text">{t('admin.import')}</summary>
					{/* Previewed first: nothing is written until it is confirmed there. */}
					<form method="post" action="/admin/holidays/preview">
						<p class="muted">{t('admin.importHelp')}</p>
						<textarea
							class="tf-input import-list"
							name="list"
							rows={8}
							placeholder={`${year}-01-01 New Year's Day\n${year}-04-13 Songkran`}
						></textarea>
						<div class="actions">
							<button type="submit" class="btn tonal">{t('admin.previewButton')}</button>
						</div>
					</form>
				</details>
			</section>
			<section class="card">
				<h2>{t('admin.holidayCount', { n: holidays.length, count: holidays.length, year })}</h2>
				{holidays.length === 0 ? (
					<p class="muted">{t('admin.holidaysNone', { year })}</p>
				) : (
					<ul class="holiday-list">
						{holidays.map((h) => (
							<li>
								<span class="holiday-date">
									<span class="muted">{weekdayName(h.date, lang)}</span> {shortDate(h.date, lang)}
								</span>
								<span>{h.label}</span>
								<AskOnceDelete
									action="/admin/holiday/delete"
									fields={{ date: h.date }}
									label={t('admin.removeHoliday', { label: h.label, date: h.date })}
									confirm={t('admin.removeHolidayAsk')}
									button={t('admin.removeHolidayButton')}
								/>
							</li>
						))}
					</ul>
				)}
			</section>
		</>
	);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationsProps {
	user: User;
	version?: string;
	today: string;
	push: { people: number; active: number; browsers: number } | null;
	line: { enabled: boolean; configured: boolean; groupId: string | null; ready: boolean };
	log: NotificationRun[];
	error?: string;
	notice?: string;
}

/**
 * The 09:00 notification, both channels side by side. The preview and send
 * used to live under "LINE notification", which is switched off — but they
 * send to browsers as well, and that heading said otherwise.
 */
export function AdminNotificationsPage(props: NotificationsProps) {
	return (
		<AdminShell user={props.user} version={props.version} section="notifications" error={props.error} notice={props.notice}>
			<NotificationsBody {...props} />
		</AdminShell>
	);
}

function NotificationsBody({ today, push, line, log }: NotificationsProps) {
	const t = useT();
	return (
		<>
			<section class="card">
				<p class="muted">{t('admin.notificationsHelp')}</p>
				<div class="channel-grid">
					<div class="channel">
						<h3 class="sub">{t('admin.pushChannel')}</h3>
						<p>
							<span class={`tag ${push ? 'good' : ''}`}>{push ? t('admin.on') : t('admin.off')}</span>{' '}
							{push ? t('admin.pushStatus', { n: push.people, total: push.active, browsers: push.browsers }) : t('admin.pushMissing')}
						</p>
					</div>
					<div class="channel">
						<h3 class="sub">{t('admin.lineChannel')}</h3>
						<p>
							<span class={`tag ${line.enabled ? 'good' : ''}`}>{line.enabled ? t('admin.on') : t('admin.off')}</span>{' '}
							{/* Switched off and not set up are different problems, and the
							    note says which one this is. */}
							{!line.enabled ? t('admin.lineDisabled') : !line.ready ? t('admin.lineIncomplete') : null}
						</p>
						<dl class="popup-facts">
							<dt>{t('admin.channelToken')}</dt>
							<dd>{line.configured ? t('admin.tokenSet') : t('admin.tokenMissing')}</dd>
							<dt>{t('admin.group')}</dt>
							<dd class={line.groupId ? 'mono' : ''}>{line.groupId ?? t('admin.groupMissing')}</dd>
						</dl>
					</div>
				</div>
				{/* The commands live behind a disclosure: the page speaks plainly, and
				    whoever sets the server up still finds what to run. */}
				{!push || !line.enabled || !line.ready ? (
					<details class="setup-how">
						<summary class="btn text">{t('admin.setupHow')}</summary>
						{!push ? <p class="muted">{t('admin.setupPush')}</p> : null}
						{!line.enabled || !line.ready ? <p class="muted">{t('admin.setupLine')}</p> : null}
					</details>
				) : null}
			</section>
			<section class="card">
				<h2>{t('admin.sendTitle')}</h2>
				<form method="post" action="/admin/notify/preview" class="row inline">
					<TextField id="preview-date" name="date" label={t('admin.date')} type="date" value={today} />
					<label class="checkline">
						<input type="checkbox" name="kind" value="week" /> {t('admin.weekAhead')}
					</label>
					<button type="submit" class="btn tonal">{t('admin.preview')}</button>
				</form>
				<form method="post" action="/admin/notify/send" class="row inline">
					<TextField id="send-date" name="date" label={t('admin.date')} type="date" value={today} />
					<label class="checkline">
						<input type="checkbox" name="kind" value="week" /> {t('admin.weekAhead')}
					</label>
					<label class="checkline">
						<input type="checkbox" name="force" value="1" /> {t('admin.resend')}
					</label>
					<button type="submit" class="btn primary">{t('admin.sendNow')}</button>
				</form>
			</section>
			<section class="card">
				<h2>{t('admin.recentRuns')}</h2>
				{log.length === 0 ? (
					<p class="muted">{t('admin.nothingYet')}</p>
				) : (
					<ul class="holiday-list">
						{log.map((row) => (
							<li>
								<span class="mono">{row.date}</span>
								<span class="tag">{row.kind}</span>
								<span class="tag">{row.channel}</span>
								<span class={`tag ${row.status === 'failed' ? 'bad' : ''}`}>{row.status}</span>
								<span class="muted">{t('admin.out', { n: row.people })}</span>
								{row.error ? <span class="muted">{row.error}</span> : null}
							</li>
						))}
					</ul>
				)}
			</section>
		</>
	);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function AdminExportPage(props: { user: User; version?: string; today: string; error?: string; notice?: string }) {
	const { user, version, today, error, notice } = props;
	return (
		<AdminShell user={user} version={version} section="export" error={error} notice={notice}>
			<ExportBody today={today} />
		</AdminShell>
	);
}

function ExportBody({ today }: { today: string }) {
	const t = useT();
	return (
		// A plain GET form: the file downloads, and the URL can be bookmarked for
		// the same report next month.
		<section class="card">
			<p class="muted">{t('admin.exportHelp')}</p>
			<form method="get" action="/admin/export.csv" class="row inline">
				<TextField id="export-from" name="from" label={t('admin.exportFrom')} type="date" value={`${today.slice(0, 4)}-01-01`} required />
				<TextField id="export-to" name="to" label={t('admin.exportTo')} type="date" value={`${today.slice(0, 4)}-12-31`} required />
				<SelectField id="export-kind" name="kind" label={t('admin.exportKind')}>
					<option value="summary">{t('admin.exportSummary')}</option>
					<option value="bookings">{t('admin.exportBookings')}</option>
				</SelectField>
				<button type="submit" class="btn tonal">{t('admin.exportButton')}</button>
			</form>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface ActivityProps {
	user: User;
	version?: string;
	users: User[];
	audit: AuditRow[];
	/** An older page of the trail exists. */
	auditMore: boolean;
	auditFilter: AuditFilter;
	error?: string;
	notice?: string;
}

export function AdminActivityPage(props: ActivityProps) {
	return (
		<AdminShell user={props.user} version={props.version} section="activity" error={props.error} notice={props.notice}>
			<ActivityBody {...props} />
		</AdminShell>
	);
}

function ActivityBody({ users, audit, auditMore, auditFilter }: ActivityProps) {
	const t = useT();
	const names = new Map(users.map((u) => [u.email, u.display_name]));
	return (
		<section class="card" id="audit">
			<p class="muted">{t('admin.auditHelp')}</p>
			{/* A GET form, so a filtered trail is a link an admin can keep or send. */}
			<form method="get" action="/admin/activity" class="quota-form audit-filter">
				<SelectField id="audit-who" name="audit_who" label={t('admin.auditWho')}>
					<option value="">{t('admin.auditAnyone')}</option>
					{users.map((u) => (
						<option value={u.email} selected={u.email === auditFilter.who}>{u.display_name}</option>
					))}
				</SelectField>
				<SelectField id="audit-action" name="audit_action" label={t('admin.auditAction')}>
					<option value="">{t('admin.auditAnyAction')}</option>
					{AUDIT_ACTIONS.map((a) => (
						<option value={a} selected={a === auditFilter.action}>{t(`audit.${a}`)}</option>
					))}
				</SelectField>
				<button type="submit" class="btn tonal">{t('admin.auditFilter')}</button>
				{auditFilter.who || auditFilter.action ? (
					<a class="btn text" href={activityHref({})}>{t('admin.auditClear')}</a>
				) : null}
			</form>
			{audit.length === 0 ? (
				<p class="muted">{auditFilter.who || auditFilter.action || auditFilter.page > 1 ? t('admin.auditNone') : t('admin.nothingYet')}</p>
			) : (
				<ul class="leave-list">
					{audit.map((row) => (
						<AuditItem row={row} names={names} />
					))}
				</ul>
			)}
			{auditFilter.page > 1 || auditMore ? (
				<nav class="audit-pages" aria-label={t('admin.activity')}>
					{auditFilter.page > 1 ? (
						<a class="btn text" rel="prev" href={activityHref({ ...auditFilter, page: auditFilter.page - 1 })}>
							{t('admin.auditNewer')}
						</a>
					) : (
						<span />
					)}
					<span class="muted">{t('admin.auditPage', { n: auditFilter.page })}</span>
					{auditMore ? (
						<a class="btn text" rel="next" href={activityHref({ ...auditFilter, page: auditFilter.page + 1 })}>
							{t('admin.auditOlder')}
						</a>
					) : (
						<span />
					)}
				</nav>
			) : null}
		</section>
	);
}

/** `/admin/activity` with the trail's filter in the query. Defaults are left out of the URL. */
function activityHref(f: Partial<AuditFilter>): string {
	const q = new URLSearchParams();
	if (f.who) q.set('audit_who', f.who);
	if (f.action) q.set('audit_action', f.action);
	if (f.page && f.page > 1) q.set('audit_page', String(f.page));
	const qs = q.toString();
	return `/admin/activity${qs ? `?${qs}` : ''}`;
}

function parseSnapshot(raw: string | null): LeaveSnapshot | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as LeaveSnapshot;
	} catch {
		return null;
	}
}

/**
 * One line of the trail.
 *
 * An edit shows what actually moved rather than a full before-and-after dump:
 * the reason to read this list is to find the change someone did not expect,
 * and six unchanged fields hide it. People by name, where they still have a
 * row; the address otherwise.
 */
export function AuditItem({ row, names }: { row: AuditRow; names: Map<string, string> }) {
	const t = useT();
	const lang = useLang();
	const before = parseSnapshot(row.before);
	const after = parseSnapshot(row.after);
	// "3 days", as everywhere else — never "3d".
	const days = (n: number) => t('edit.days', { count: n, days: formatDays(n) });
	const span = (s: LeaveSnapshot) => (s.start_date === s.end_date ? shortDate(s.start_date, lang) : `${shortDate(s.start_date, lang)} – ${shortDate(s.end_date, lang)}`);

	const changes: string[] = [];
	if (before && after) {
		if (before.start_date !== after.start_date || before.end_date !== after.end_date) {
			changes.push(`${span(before)} → ${span(after)}`);
		}
		if (before.leave_type_id !== after.leave_type_id) changes.push(t('audit.typeChanged'));
		if (before.days_total !== after.days_total) changes.push(`${days(before.days_total)} → ${days(after.days_total)}`);
		if (before.has_note !== after.has_note) changes.push(t(after.has_note ? 'audit.noteAdded' : 'audit.noteRemoved'));
		if (before.note_private !== after.note_private) {
			changes.push(t(after.note_private ? 'audit.notePrivate' : 'audit.noteShared'));
		}
		if (changes.length === 0) changes.push(t('audit.noChange'));
	} else if (after) {
		changes.push(`${span(after)}, ${days(after.days_total)}`);
	} else if (before) {
		changes.push(span(before));
	}

	const name = (email: string) => names.get(email) ?? email;
	// "X edited their own booking" is the common case and reads better than
	// repeating the same name twice.
	const who =
		row.actor_email === row.subject_email
			? name(row.actor_email)
			: t('audit.onBehalf', { actor: name(row.actor_email), subject: name(row.subject_email) });

	return (
		<li class="leave-row">
			<span class={`tag ${row.action === 'cancelled' ? 'bad' : ''}`}>{t(`audit.${row.action}`)}</span>
			<span class="leave-when">{changes.join(' · ')}</span>
			<span class="leave-type muted" title={`${row.actor_email} → ${row.subject_email}`}>{who}</span>
			<span class="leave-days muted">
				{shortDate(row.at.slice(0, 10), lang)}, {row.at.slice(11, 16)}
			</span>
		</li>
	);
}

// ---------------------------------------------------------------------------
// Holiday import preview
// ---------------------------------------------------------------------------

interface HolidayPreviewProps {
	user: User;
	/** The list as pasted, handed back so it can be fixed or confirmed. */
	text: string;
	errors: HolidayParse['errors'];
	plan: ImportPlan | null;
	version?: string;
}

/**
 * The import's middle step: what the pasted list would do, before it does it.
 *
 * Importing used to write straight away, all or nothing. It still is all or
 * nothing, but now the admin sees first which dates are new, which rename one
 * already held, and whose existing bookings cross a new holiday — those were
 * charged for that day when they were saved, and only re-saving recounts them.
 *
 * The confirm button posts the same text to the same import route as before,
 * so the write path, and its checks, are unchanged.
 */
export function HolidayPreviewPage(props: HolidayPreviewProps) {
	return (
		<AdminShell user={props.user} version={props.version} section="holidays">
			<HolidayPreviewBody {...props} />
		</AdminShell>
	);
}

function HolidayPreviewBody({ text, errors, plan }: HolidayPreviewProps) {
	const t = useT();
	const lang = useLang();
	const toWrite = plan ? plan.rows.filter((r) => r.status !== 'same').length : 0;
	return (
		<section class="card">
			<h2>{t('admin.previewTitle')}</h2>

			{errors.length > 0 ? (
				<div class="banner error">
					<span>
						{t('admin.previewErrors')}
						{'\n'}
						{errors.map((e) => `\n${t('admin.previewLine', { line: e.line })} ${e.text} — ${e.reason}`).join('')}
					</span>
				</div>
			) : null}

			{plan ? (
				<>
					<ul class="holiday-list import-preview">
						{plan.rows.map((r) => (
							<li class={`import-${r.status}`}>
								<span class="holiday-date">
									<span class="muted">{weekdayName(r.date, lang)}</span> {shortDate(r.date, lang)} {r.date.slice(0, 4)}
								</span>
								<span>{r.label}</span>
								<span class="tag">
									{r.status === 'new' ? t('admin.previewNew') : r.status === 'renamed' ? t('admin.previewRenamed', { was: r.was ?? '' }) : t('admin.previewSame')}
								</span>
							</li>
						))}
					</ul>

					<h3 class="sub">{t('admin.previewBookings')}</h3>
					{plan.affected.length === 0 ? (
						<p class="muted">{t('admin.previewNoBookings')}</p>
					) : (
						<>
							<p class="muted">{t('admin.previewAffected')}</p>
							<ul class="holiday-list import-affected">
								{plan.affected.map(({ entry, dates }) => (
									<li>
										<a href={`/leave/${entry.id}/edit`}>{entry.display_name}</a>
										<span class="muted">{describeRange(entry.start_date, entry.end_date, entry.start_half, entry.end_half, lang)}</span>
										<span class="tag">{t('admin.previewCharged', { n: dates.length, count: dates.length })}</span>
									</li>
								))}
							</ul>
						</>
					)}
				</>
			) : null}

			{/* Confirm: the same list, to the same import route as before. */}
			{plan && errors.length === 0 && toWrite > 0 ? (
				<form method="post" action="/admin/holidays/import" class="actions import-confirm">
					<input type="hidden" name="list" value={text} />
					{/* Ticked by default: a booking charged for a holiday is the thing
					    the preview exists to catch. Unticked, it is left for the admin
					    to look at one by one. */}
					{plan.affected.length > 0 ? (
						<label class="checkline">
							<input type="checkbox" name="recount" value="1" checked />
							{t('admin.previewRecount', { n: plan.affected.length, count: plan.affected.length })}
						</label>
					) : null}
					<button type="submit" class="btn primary">{t('admin.previewImport', { n: toWrite, count: toWrite })}</button>
					<a class="btn text" href="/admin/holidays">{t('admin.previewCancel')}</a>
				</form>
			) : null}
			{plan && errors.length === 0 && toWrite === 0 ? <p class="muted">{t('admin.previewNothing')}</p> : null}

			{/* Fix and look again, without retyping anything. */}
			<form method="post" action="/admin/holidays/preview">
				<textarea class="tf-input import-list" name="list" rows={8}>{text}</textarea>
				<div class="actions">
					<button type="submit" class="btn tonal">{t('admin.previewAgain')}</button>
					<a class="btn text" href="/admin/holidays">{t('admin.previewCancel')}</a>
				</div>
			</form>
		</section>
	);
}
