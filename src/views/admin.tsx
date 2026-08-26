import { formatDays } from '../domain/dates.ts';
import type { Holiday, LeaveType, Quota, User } from '../types.ts';
import type { AuditRow, LeaveSnapshot, NotificationRun } from '../repo/db.ts';
import { Layout } from './layout.tsx';
import { SelectField, TextField } from './fields.tsx';
import { DeleteIcon } from './icons.tsx';
import { useLang, useT } from '../i18n/context.tsx';
import { t as translate, toLang } from '../i18n/strings.ts';

interface AdminProps {
	user: User;
	year: number;
	users: User[];
	types: LeaveType[];
	quotas: Quota[];
	holidays: Holiday[];
	today: string;
	line: { configured: boolean; groupId: string | null; ready: boolean };
	log: NotificationRun[];
	audit: AuditRow[];
	version?: string;
	error?: string;
	notice?: string;
}

export function AdminPage(props: AdminProps) {
	return (
		<Layout title={translate(toLang(props.user.lang), 'admin.title')} user={props.user} active="admin" version={props.version}>
			<AdminBody {...props} />
		</Layout>
	);
}

function AdminBody(props: AdminProps) {
	const { year, users, types, quotas, holidays, today, line, log, audit, error, notice } = props;
	const t = useT();
	const lang = useLang();
	const quotaFor = (email: string, typeId: number) =>
		quotas.find((q) => q.user_email === email && q.leave_type_id === typeId)?.days_allotted ?? 0;
	const typeName = (type: { label_en: string; label_th: string }) => (lang === 'th' ? type.label_th : type.label_en);

	return (
		<>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="page-head">
				<h1>{t('admin.title')}</h1>
				<span class="muted">{year}</span>
			</div>

			<section class="card">
				<h2>{t('admin.quotas')}</h2>
				<p class="muted">{t('admin.quotasHelp', { year })}</p>
				<form method="post" action="/admin/quotas/bulk" class="quota-form bulk-quota-form">
					<input type="hidden" name="year" value={String(year)} />
					<SelectField id="bulk-type" name="leaveTypeId" label={t('book.type')} required>
						{types.map((type) => (
							<option value={String(type.id)}>{typeName(type)}</option>
						))}
					</SelectField>
					<TextField
						id="bulk-days"
						name="days"
						label={t('admin.days')}
						type="number"
						step="0.5"
						min="0"
						max="365"
						required
						class="quota-cell"
					/>
					<button type="submit" class="btn tonal">{t('admin.setForEveryone')}</button>
				</form>
				<div class="table-scroll">
					<table class="grid-table">
						{/* Two columns only: the quota inputs carry their own labels, so a
						    column per leave type would be a second, misaligned header for
						    the same fields. */}
						<thead>
							<tr>
								<th>{t('admin.person')}</th>
								<th>{t('admin.allotted')}</th>
							</tr>
						</thead>
						<tbody>
							{users.map((u) => (
								<tr class={u.active ? '' : 'inactive'}>
									<td>
										<form method="post" action="/admin/user" class="inline">
											<input type="hidden" name="email" value={u.email} />
											<div class="person">
												<a href={`/u/${encodeURIComponent(u.email)}`}><strong>{u.display_name}</strong></a>
												<span class="muted mono">{u.email}</span>
											</div>
											<label class="checkline">
												<input type="checkbox" name="isAdmin" value="1" checked={!!u.is_admin} /> {t('admin.isAdmin')}
											</label>
											<label class="checkline">
												<input type="checkbox" name="active" value="1" checked={!!u.active} /> {t('admin.isActive')}
											</label>
											<button type="submit" class="btn small tonal">{t('admin.save')}</button>
										</form>
									</td>
									<td>
										<form method="post" action="/admin/quotas" class="quota-form">
											<input type="hidden" name="email" value={u.email} />
											<input type="hidden" name="year" value={String(year)} />
											{types.map((t) => (
												<TextField
													id={`q-${t.id}-${u.email}`}
													name={`q_${t.id}`}
													label={typeName(t)}
													type="number"
													value={formatDays(quotaFor(u.email, t.id))}
													step="0.5"
													min="0"
													max="365"
													class="quota-cell"
												/>
											))}
											<button type="submit" class="btn small tonal">{t('admin.saveQuotas')}</button>
										</form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section class="card">
				<h2>{t('admin.holidays')}</h2>
				<p class="muted">{t('admin.holidaysHelp')}</p>
				<form method="post" action="/admin/holiday" class="row inline">
					<TextField id="holiday-date" name="date" label={t('admin.date')} type="date" required />
					<TextField
						id="holiday-label"
						name="label"
						label={t('admin.name')}
						maxlength={80}
						required
						support={t('admin.nameExample')}
					/>
					<button type="submit" class="btn tonal">{t('admin.add')}</button>
				</form>
				<details class="import-block">
					<summary class="btn text">{t('admin.import')}</summary>
					<form method="post" action="/admin/holidays/import">
						{/* No example here: it ran into the end of the sentence, and the
						    textarea's own placeholder already shows the shape. */}
						<p class="muted">{t('admin.importHelp')}</p>
						<textarea
							class="tf-input import-list"
							name="list"
							rows={8}
							placeholder="2027-01-01 New Year's Day&#10;2027-04-13 Songkran"
						></textarea>
						<div class="actions">
							<button type="submit" class="btn tonal">{t('admin.importButton')}</button>
						</div>
					</form>
				</details>

				<ul class="holiday-list">
					{holidays.map((h) => (
						<li>
							<span class="mono">{h.date}</span>
							<span>{h.label}</span>
							<form method="post" action="/admin/holiday/delete" class="inline">
								<input type="hidden" name="date" value={h.date} />
								<button type="submit" class="icon-btn" aria-label={t('admin.removeHoliday', { label: h.label, date: h.date })}>
									<DeleteIcon />
								</button>
							</form>
						</li>
					))}
				</ul>
			</section>

			<section class="card">
				<h2>{t('admin.line')}</h2>
				<p class="muted">{t('admin.lineHelp')}</p>

				<dl class="popup-facts">
					<dt>{t('admin.channelToken')}</dt>
					<dd>{line.configured ? t('admin.tokenSet') : 'not set — run wrangler secret put LINE_CHANNEL_ACCESS_TOKEN'}</dd>
					<dt>{t('admin.group')}</dt>
					<dd class="mono">{line.groupId ?? 'not captured yet — invite the bot to the group, then post any message in it'}</dd>
				</dl>

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
					{/* Not gated on LINE: browser subscribers can be sent to whether or
					    not a LINE channel exists, and the outcome says which went. */}
					<button type="submit" class="btn primary">{t('admin.sendNow')}</button>
				</form>
				{!line.ready ? (
					<p class="muted">{t('admin.lineIncomplete')}</p>
				) : null}

				<h3 class="sub">{t('admin.recentRuns')}</h3>
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
			<section class="card">
				<h2>{t('admin.recentChanges')}</h2>
				<p class="muted">{t('admin.auditHelp')}</p>
				{audit.length === 0 ? (
					<p class="muted">{t('admin.nothingYet')}</p>
				) : (
					<ul class="leave-list">
						{audit.map((row) => (
							<AuditItem row={row} />
						))}
					</ul>
				)}
			</section>
		</>
	);
}

function parseSnapshot(raw: string | null): LeaveSnapshot | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as LeaveSnapshot;
	} catch {
		return null;
	}
}

const span = (s: LeaveSnapshot) => (s.start_date === s.end_date ? s.start_date : `${s.start_date} → ${s.end_date}`);

/**
 * One line of the trail.
 *
 * An edit shows what actually moved rather than a full before-and-after dump:
 * the reason to read this list is to find the change someone did not expect,
 * and six unchanged fields hide it.
 */
function AuditItem({ row }: { row: AuditRow }) {
	const t = useT();
	const before = parseSnapshot(row.before);
	const after = parseSnapshot(row.after);

	const changes: string[] = [];
	if (before && after) {
		if (before.start_date !== after.start_date || before.end_date !== after.end_date) {
			changes.push(`${span(before)} → ${span(after)}`);
		}
		if (before.leave_type_id !== after.leave_type_id) changes.push(t('audit.typeChanged'));
		if (before.days_total !== after.days_total) changes.push(`${before.days_total}d → ${after.days_total}d`);
		if (before.has_note !== after.has_note) changes.push(t(after.has_note ? 'audit.noteAdded' : 'audit.noteRemoved'));
		if (before.note_private !== after.note_private) {
			changes.push(t(after.note_private ? 'audit.notePrivate' : 'audit.noteShared'));
		}
		if (changes.length === 0) changes.push(t('audit.noChange'));
	} else if (after) {
		changes.push(`${span(after)}, ${after.days_total}d`);
	} else if (before) {
		changes.push(span(before));
	}

	// "X edited their own booking" is the common case and reads better than
	// repeating the same address twice.
	const who =
		row.actor_email === row.subject_email
			? row.actor_email
			: t('audit.onBehalf', { actor: row.actor_email, subject: row.subject_email });

	return (
		<li class="leave-row">
			<span class={`tag ${row.action === 'cancelled' ? 'bad' : ''}`}>{t(`audit.${row.action}`)}</span>
			<span class="leave-when">{changes.join(' · ')}</span>
			<span class="leave-type muted mono">{who}</span>
			<span class="leave-days muted mono">{row.at.slice(0, 16)}</span>
		</li>
	);
}
