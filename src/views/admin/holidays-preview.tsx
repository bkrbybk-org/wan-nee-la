import { describeRange, shortDate, weekdayName } from '../../domain/dates.ts';
import type { User } from '../../types.ts';
import type { HolidayParse, ImportPlan } from '../../domain/holidays.ts';
import { useLang, useT } from '../../i18n/context.tsx';
import { AdminShell } from './shell.tsx';

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
