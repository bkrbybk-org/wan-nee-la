import { formatDays } from '../../domain/dates.ts';
import { allottedFor } from '../../domain/leave.ts';
import type { LeaveType, Quota, User } from '../../types.ts';
import { YearNav } from '../layout.tsx';
import { SelectField, TextField } from '../fields.tsx';
import { FormActions } from '../parts.tsx';
import { EditIcon } from '../icons.tsx';
import { useLang, useT } from '../../i18n/context.tsx';
import { AdminShell, PushState } from './shell.tsx';

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
