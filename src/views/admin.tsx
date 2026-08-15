import { formatDays } from '../domain/dates.ts';
import type { Holiday, LeaveType, Quota, User } from '../types.ts';
import type { NotificationLog } from '../repo/db.ts';
import { Layout } from './layout.tsx';

interface AdminProps {
	user: User;
	year: number;
	users: User[];
	types: LeaveType[];
	quotas: Quota[];
	holidays: Holiday[];
	today: string;
	line: { configured: boolean; groupId: string | null; ready: boolean };
	log: NotificationLog[];
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
												<strong>{u.display_name}</strong>
												<span class="muted mono">{u.email}</span>
											</div>
											<label class="checkline">
												<input type="checkbox" name="isAdmin" value="1" checked={!!u.is_admin} /> admin
											</label>
											<label class="checkline">
												<input type="checkbox" name="active" value="1" checked={!!u.active} /> active
											</label>
											<button type="submit" class="btn small">Save</button>
										</form>
									</td>
									<td>
										<form method="post" action="/admin/quotas" class="quota-form">
											<input type="hidden" name="email" value={u.email} />
											<input type="hidden" name="year" value={String(year)} />
											{types.map((t) => (
												<label class="quota-cell">
													<span class="muted">{t.label_en}</span>
													<input
														type="number"
														name={`q_${t.id}`}
														value={formatDays(quotaFor(u.email, t.id))}
														step="0.5"
														min="0"
														max="365"
													/>
												</label>
											))}
											<button type="submit" class="btn small">Save quotas</button>
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
					<input type="date" name="date" required />
					<input type="text" name="label" placeholder="Makha Bucha" maxlength={80} required />
					<button type="submit" class="btn">Add</button>
				</form>
				<ul class="holiday-list">
					{holidays.map((h) => (
						<li>
							<span class="mono">{h.date}</span>
							<span>{h.label}</span>
							<form method="post" action="/admin/holiday/delete" class="inline">
								<input type="hidden" name="date" value={h.date} />
								<button type="submit" class="btn small danger">Remove</button>
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
					<input type="date" name="date" value={today} />
					<button type="submit" class="btn">Preview</button>
				</form>
				<form method="post" action="/admin/notify/send" class="row inline">
					<input type="date" name="date" value={today} />
					<label class="checkline">
						<input type="checkbox" name="force" value="1" /> resend if already logged
					</label>
					<button type="submit" class="btn" disabled={!line.ready}>Send now</button>
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
