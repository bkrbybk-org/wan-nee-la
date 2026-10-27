import { formatDays } from '../../domain/dates.ts';
import { allottedFor } from '../../domain/leave.ts';
import type { LeaveType, Quota, User } from '../../types.ts';
import type { AuditRow } from '../../repo/db.ts';
import { AuditItem } from './activity.tsx';
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
	/** Days taken per person per type in `year`, confirmed bookings only. */
	used: Map<string, Map<number, number>>;
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

function PeopleBody({ year, users, types, quotas, used, pushCounts }: PeopleProps) {
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
										<UsedCell used={used.get(u.email)?.get(type.id) ?? 0} allotted={type.counts_quota ? quotaFor(u.email, type) : null} />
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

/**
 * "4.5 / 10": days used of the days allotted, so who is over or has most left
 * reads off the roster without opening anyone. Over the allowance is in the
 * error colour, and says so in words for a screen reader. A type with no
 * allowance shows only what was taken, or a dash for none.
 */
function UsedCell({ used, allotted }: { used: number; allotted: number | null }) {
	const t = useT();
	if (allotted === null) {
		return (
			<td class="num">
				{used > 0 ? (
					<>
						<span aria-hidden="true">{formatDays(used)}</span>
						<span class="visually-hidden">{t('admin.usedOnly', { used: formatDays(used) })}</span>
					</>
				) : (
					'—'
				)}
			</td>
		);
	}
	const over = used > allotted;
	return (
		<td class={`num ${over ? 'over' : ''}`}>
			<span aria-hidden="true">
				{formatDays(used)}
				<span class="of"> / {formatDays(allotted)}</span>
			</span>
			<span class="visually-hidden">
				{over
					? t('admin.usedOver', { used: formatDays(used), allotted: formatDays(allotted), over: formatDays(used - allotted) })
					: t('admin.usedOf', { used: formatDays(used), allotted: formatDays(allotted) })}
			</span>
		</td>
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
	/** The latest changes someone else made to this person's leave. */
	byOthers: AuditRow[];
	/** Names for the trail's actors. */
	users: User[];
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
			<ChangedByOthers subject={props.subject} rows={props.byOthers} users={props.users} />
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
 * What other people — admins, in practice — did to this person's leave: booked
 * it for them, moved it, removed it. The same lines as Activity, filtered to
 * the ones the person did not make themselves, because those are the ones
 * that come up when someone asks "who changed my leave?".
 */
export function ChangedByOthers({ subject, rows, users }: { subject: User; rows: AuditRow[]; users: User[] }) {
	const t = useT();
	const names = new Map(users.map((u) => [u.email, u.display_name]));
	return (
		<section class="card">
			<h2>{t('admin.othersChanged', { name: subject.display_name })}</h2>
			{rows.length === 0 ? (
				<p class="muted">{t('admin.othersNone')}</p>
			) : (
				<>
					<p class="muted">{t('admin.othersChangedHelp', { n: OTHERS_SHOWN })}</p>
					<ul class="leave-list">
						{rows.map((row) => (
							<AuditItem row={row} names={names} />
						))}
					</ul>
				</>
			)}
			<a class="btn text" href={`/admin/activity?audit_who=${encodeURIComponent(subject.email)}`}>{t('admin.othersAll')}</a>
		</section>
	);
}

/** How many of those the person page lists; Activity has the rest. */
export const OTHERS_SHOWN = 10;
