import { formatDays } from '../domain/dates.ts';
import type { Holiday, LeaveType, Quota, User } from '../types.ts';
import { Layout } from './layout.tsx';

interface AdminProps {
	user: User;
	year: number;
	users: User[];
	types: LeaveType[];
	quotas: Quota[];
	holidays: Holiday[];
	version?: string;
	error?: string;
	notice?: string;
}

export function AdminPage(props: AdminProps) {
	const { user, year, users, types, quotas, holidays, version, error, notice } = props;
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
				<h2>Notifications</h2>
				<p class="muted">
					The 08:00 LINE post is not built yet — see docs/PLAN.md phase 4. The cron trigger is wired and logs a
					no-op each morning.
				</p>
			</section>
		</Layout>
	);
}
