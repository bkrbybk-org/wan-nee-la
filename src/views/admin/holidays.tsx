import { shortDate, weekdayName } from '../../domain/dates.ts';
import type { Holiday, User } from '../../types.ts';
import type { HolidayGap } from '../../domain/holidays.ts';
import { HolidaysDueBanner, YearNav } from '../layout.tsx';
import { TextField } from '../fields.tsx';
import { AskOnceDelete } from '../parts.tsx';
import { useLang, useT } from '../../i18n/context.tsx';
import { AdminShell } from './shell.tsx';

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
