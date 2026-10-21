import { formatDays, shortDate } from '../../domain/dates.ts';
import type { LeaveType, User } from '../../types.ts';
import type { NotificationRun } from '../../repo/db.ts';
import type { HolidayGap } from '../../domain/holidays.ts';
import { HolidaysDueBanner } from '../layout.tsx';
import { BellIcon, CalendarIcon, HourglassIcon, DownloadIcon, HistoryIcon, TagIcon, UsersIcon } from '../icons.tsx';
import { useLang, useT } from '../../i18n/context.tsx';
import { AdminShell } from './shell.tsx';

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
