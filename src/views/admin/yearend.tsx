import { formatDays, shortDate } from '../../domain/dates.ts';
import type { LeaveType, User } from '../../types.ts';
import type { NotificationRun } from '../../repo/db.ts';
import type { UnusedRow } from '../../domain/report.ts';
import { YearNav } from '../layout.tsx';
import { BellRingIcon } from '../icons.tsx';
import { useLang, useT } from '../../i18n/context.tsx';
import { AdminShell, PushState } from './shell.tsx';

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
						<>
							<p class="bad">{t('admin.remindFailed', { date: when(reminder), error: reminder.error ?? '' })}</p>
							<form method="post" action="/admin/year-end/remind">
								<input type="hidden" name="retry" value="1" />
								<button type="submit" class="btn tonal">
									<BellRingIcon class="sm" />
									{t('admin.remindRetry')}
								</button>
							</form>
						</>
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
