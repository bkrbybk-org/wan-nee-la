import { shortDate } from '../domain/dates.ts';
import type { LeaveType, User } from '../types.ts';
import { Layout } from './layout.tsx';
import { BookingForm } from './booking.tsx';
import { ChevronLeftIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { t as translate, toLang } from '../i18n/strings.ts';

/**
 * Standalone booking page.
 *
 * This is the no-JS destination for every "book leave" affordance on the
 * calendar — the Book leave button and each day cell link here with the date in
 * the query string. With JS the same click opens a dialog instead and never
 * leaves the page, but the link is real, so the calendar stays usable with
 * scripting off and the targets are ordinary links to middle-click or share.
 */
export function BookPage({
	user,
	types,
	today,
	date,
	version,
	error,
	errorField,
	notice,
}: {
	user: User;
	types: LeaveType[];
	today: string;
	date?: string;
	version?: string;
	error?: string;
	errorField?: string;
	notice?: string;
}) {
	return (
		<Layout title={translate(toLang(user.lang), 'book.pageTitle')} user={user} active="calendar" version={version}>
			<BookBody {...{ user, types, today, date, error, errorField, notice }} />
		</Layout>
	);
}

function BookBody({
	types,
	today,
	date,
	error,
	errorField,
	notice,
}: {
	user: User;
	types: LeaveType[];
	today: string;
	date?: string;
	error?: string;
	errorField?: string;
	notice?: string;
}) {
	const t = useT();
	const lang = useLang();
	return (
		<>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="page-head">
				<a class="icon-btn" href="/" aria-label={t('book.back')}>
					<ChevronLeftIcon />
				</a>
				<h1>{t('book.pageTitle')}</h1>
				{date ? <span class="muted">{shortDate(date, lang)}</span> : null}
			</div>

			<section class="card">
				<BookingForm types={types} today={today} defaultDate={date} errorField={errorField} compact />
			</section>

			<p>
				<a class="btn text" href="/">{t('book.back')}</a>
			</p>
		</>
	);
}
