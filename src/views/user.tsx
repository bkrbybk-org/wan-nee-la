import type { Balance, LeaveEntry, User } from '../types.ts';
import { Layout, YearNav } from './layout.tsx';
import { BackLink, BalanceCard, LeaveRow } from './parts.tsx';
import { useT } from '../i18n/context.tsx';

interface UserPageProps {
	viewer: User;
	subject: User;
	year: number;
	minYear: number;
	maxYear: number;
	entries: LeaveEntry[];
	// Undefined when the viewer is neither the subject nor an admin — the
	// balances section is omitted entirely in that case, not rendered empty.
	balances?: Balance[];
	today: string;
	version?: string;
}

export function UserPage(props: UserPageProps) {
	return (
		<Layout title={props.subject.display_name} user={props.viewer} active="calendar" version={props.version}>
			<UserBody {...props} />
		</Layout>
	);
}

function UserBody(props: UserPageProps) {
	const { viewer, subject, year, minYear, maxYear, entries, balances, today } = props;
	const t = useT();
	// Their own bookings, or anyone's for an admin, open the booking's page —
	// the same rows as My leave. Notes are never shown here, to anyone.
	const mayOpen = viewer.email === subject.email || Boolean(viewer.is_admin);

	return (
		<>
			<BackLink href="/" label={t('nav.calendar')} />
			<div class="page-head">
				<h1>{subject.display_name}</h1>
				<YearNav basePath={`/u/${encodeURIComponent(subject.email)}`} year={year} minYear={minYear} maxYear={maxYear} />
			</div>

			{balances ? (
				<section class="balances">
					{balances.map((b) => (
						<BalanceCard b={b} />
					))}
				</section>
			) : null}

			<section class="card">
				<h2>{t('user.leaveIn', { year })}</h2>
				{entries.length === 0 ? (
					<p class="muted">{t('user.nothing')}</p>
				) : (
					<ul class="my-list">
						{entries.map((e) => (
							<LeaveRow entry={e} today={today} linked={mayOpen} showNote={false} />
						))}
					</ul>
				)}
			</section>
		</>
	);
}
