import { formatDays } from '../domain/dates.ts';
import type { Holiday, LeaveType, Quota, User } from '../types.ts';
import type { NotificationRun } from '../repo/db.ts';
import { Layout } from './layout.tsx';
import { SelectField, TextField } from './fields.tsx';
import { DeleteIcon } from './icons.tsx';

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
	version?: string;
	error?: string;
	notice?: string;
}

export function AdminPage(props: AdminProps) {
	const { user, year, users, types, quotas, holidays, today, line, log, version, error, notice } = props;
	const quotaFor = (email: string, typeId: number) =>
		quotas.find((q) => q.user_email === email && q.leave_type_id === typeId)?.days_allotted ?? 0;

	return (
		<Layout title="Admin" user={user} active="admin" version={version}>
			{error ? <div class="banner error">{error}</div> : null}
			{notice ? <div class="banner ok">{notice}</div> : null}

			<div class="page-head">
				<h1>Admin</h1>
				<span class="muted">{year}</span>
			</div>

			<section class="card">
				<h2>Quotas</h2>
				<p class="muted">Days allotted per person for {year}. Blank rows default from the leave type.</p>
				<form method="post" action="/admin/quotas/bulk" class="quota-form bulk-quota-form">
					<input type="hidden" name="year" value={String(year)} />
					<SelectField id="bulk-type" name="leaveTypeId" label="Leave type" required>
						{types.map((t) => (
							<option value={String(t.id)}>{t.label_en}</option>
						))}
					</SelectField>
					<TextField id="bulk-days" name="days" label="Days" type="number" step="0.5" min="0" max="365" required class="quota-cell" />
					<button type="submit" class="btn tonal">Set for everyone (active)</button>
				</form>
				<div class="table-scroll">
					<table class="grid-table">
						{/* Two columns only: the quota inputs carry their own labels, so a
						    column per leave type would be a second, misaligned header for
						    the same fields. */}
						<thead>
							<tr>
								<th>Person</th>
								<th>Days allotted</th>
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
												<input type="checkbox" name="isAdmin" value="1" checked={!!u.is_admin} /> admin
											</label>
											<label class="checkline">
												<input type="checkbox" name="active" value="1" checked={!!u.active} /> active
											</label>
											<button type="submit" class="btn small tonal">Save</button>
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
													label={t.label_en}
													type="number"
													value={formatDays(quotaFor(u.email, t.id))}
													step="0.5"
													min="0"
													max="365"
													class="quota-cell"
												/>
											))}
											<button type="submit" class="btn small tonal">Save quotas</button>
										</form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section class="card">
				<h2>Holidays</h2>
				<p class="muted">
					Days that do not draw down anyone's quota. Thai lunar holidays and substitution days are announced yearly —
					add them here as they land.
				</p>
				<form method="post" action="/admin/holiday" class="row inline">
					<TextField id="holiday-date" name="date" label="Date" type="date" required />
					<TextField id="holiday-label" name="label" label="Name" maxlength={80} required support="For example, Makha Bucha" />
					<button type="submit" class="btn tonal">Add</button>
				</form>
				<ul class="holiday-list">
					{holidays.map((h) => (
						<li>
							<span class="mono">{h.date}</span>
							<span>{h.label}</span>
							<form method="post" action="/admin/holiday/delete" class="inline">
								<input type="hidden" name="date" value={h.date} />
								<button type="submit" class="icon-btn" aria-label={`Remove ${h.label} on ${h.date}`}>
									<DeleteIcon />
								</button>
							</form>
						</li>
					))}
				</ul>
			</section>

			<section class="card">
				<h2>LINE notification</h2>
				<p class="muted">
					Posts once each morning at 08:00 Asia/Bangkok listing who is out that day. Weekends, public holidays, and
					days with nobody on leave are skipped — LINE bills a group push per member, so silence is cheaper than
					"nobody is out today".
				</p>

				<dl class="popup-facts">
					<dt>Channel token</dt>
					<dd>{line.configured ? 'set' : 'not set — run wrangler secret put LINE_CHANNEL_ACCESS_TOKEN'}</dd>
					<dt>Group</dt>
					<dd class="mono">{line.groupId ?? 'not captured yet — invite the bot to the group, then post any message in it'}</dd>
				</dl>

				<form method="post" action="/admin/notify/preview" class="row inline">
					<TextField id="preview-date" name="date" label="Date" type="date" value={today} />
					<button type="submit" class="btn tonal">Preview</button>
				</form>
				<form method="post" action="/admin/notify/send" class="row inline">
					<TextField id="send-date" name="date" label="Date" type="date" value={today} />
					<label class="checkline">
						<input type="checkbox" name="force" value="1" /> resend if already logged
					</label>
					<button type="submit" class="btn primary" disabled={!line.ready}>Send now</button>
				</form>
				{!line.ready ? (
					<p class="muted">Sending is disabled until both the channel token and the group are in place.</p>
				) : null}

				<h3 class="sub">Recent runs</h3>
				{log.length === 0 ? (
					<p class="muted">Nothing yet.</p>
				) : (
					<ul class="holiday-list">
						{log.map((row) => (
							<li>
								<span class="mono">{row.date}</span>
								<span class="tag">{row.channel}</span>
								<span class={`tag ${row.status === 'failed' ? 'bad' : ''}`}>{row.status}</span>
								<span class="muted">{row.people} out</span>
								{row.error ? <span class="muted">{row.error}</span> : null}
							</li>
						))}
					</ul>
				)}
			</section>
		</Layout>
	);
}
