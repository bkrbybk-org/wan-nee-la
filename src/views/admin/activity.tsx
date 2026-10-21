import { formatDays, shortDate } from '../../domain/dates.ts';
import type { User } from '../../types.ts';
import { AUDIT_ACTIONS } from '../../repo/db.ts';
import type { AuditFilter, AuditRow, LeaveSnapshot } from '../../repo/db.ts';
import { SelectField } from '../fields.tsx';
import { useLang, useT } from '../../i18n/context.tsx';
import { AdminShell } from './shell.tsx';

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
