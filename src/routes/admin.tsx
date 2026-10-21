import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { addDays, countLeaveDays, daysBetween, isValidDate, MAX_RANGE_DAYS } from '../domain/dates.ts';
import { byDate, round } from '../domain/leave.ts';
import { importPlan, parseHolidayList } from '../domain/holidays.ts';
import { daysWithin, leaveSummary, toCsv } from '../domain/report.ts';
import { parseLeaveTypeForm } from '../domain/leaveTypes.ts';
import { toLang } from '../i18n/strings.ts';
import * as db from '../repo/db.ts';
import { AdminActivityPage, AdminExportPage, AdminHolidaysPage, AdminNotificationsPage, AdminOverviewPage, AdminPeoplePage, AdminPersonPage, AdminTypesPage, AdminYearEndPage, HolidayPreviewPage } from '../views/admin/index.ts';
import { lineConfigured, lineEnabled, pushConfigured, resolveGroupId, runDigest, runWeekAhead } from '../notify/digest.ts';
import { runYearEnd, yearEndKey, yearEndReport } from '../notify/yearend.ts';
import { type Ctx, userOf, say, sayMessage, leaveTypesOf, holidayReminder, clampInt, yearNavBounds, errorPage, page, validDateOr, isEmail, type AppEnv } from '../server/common.tsx';
import { flashOf, redirectWithFlash } from '../server/flash.ts';
/*
 * The admin area: the overview, each section, and their forms.
 */

const app = new Hono<AppEnv>();

const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
	if (!userOf(c).is_admin) {
		return errorPage(c, 403, 'err.adminsOnly', 'err.adminsOnlyDetail');
	}
	await next();
};

app.use('/admin', adminOnly);
app.use('/admin/*', adminOnly);

/** The props every admin page takes from the request: who, which build, and the flash. */
function adminCommon(c: Ctx) {
	return {
		user: userOf(c),
		version: c.env.CF_VERSION_METADATA?.id,
		error: flashOf(c.get('flash'), 'err'),
		notice: flashOf(c.get('flash'), 'ok'),
	};
}

/** `?y=`, defaulting to this year, and the bounds the year arrows stop at. */
function adminYear(c: Ctx) {
	const thisYear = Number(c.get('today').slice(0, 4));
	const year = clampInt(c.req.query('y'), thisYear, 2000, 2100);
	return { year, ...yearNavBounds(thisYear) };
}

/**
 * Overview: what needs doing, whether the app is doing its job, and the way
 * into each section.
 *
 * The trail's filter used to live here as `/admin?audit_who=…`; such a link
 * goes on to the Activity page rather than quietly losing its filter.
 */
app.get('/admin', async (c) => {
	const query = new URL(c.req.url).searchParams;
	if ([...query.keys()].some((k) => k.startsWith('audit_'))) return c.redirect(`/admin/activity?${query.toString()}`, 302);

	const today = c.get('today');
	const thisYear = Number(today.slice(0, 4));
	const configured = pushConfigured(c.env);
	const [users, types, entries, todayHolidays, log, counts, holidaysDue, pushCounts, holidaysNow, holidaysNext, yearEnd] = await Promise.all([
		db.listUsers(c.env.DB),
		leaveTypesOf(c),
		db.listLeaveInRange(c.env.DB, today, today),
		db.holidaySet(c.env.DB, today, today),
		db.recentNotifications(c.env.DB),
		db.auditCounts(c.env.DB, addDays(today, -7)),
		holidayReminder(c),
		configured ? db.subscriptionCounts(c.env.DB) : Promise.resolve(null),
		db.listHolidays(c.env.DB, `${thisYear}-01-01`, `${thisYear}-12-31`),
		db.listHolidays(c.env.DB, `${thisYear + 1}-01-01`, `${thisYear + 1}-12-31`),
		yearEndReport(c.env, thisYear),
	]);
	const active = users.filter((u) => u.active);
	const lang = toLang(userOf(c).lang);
	// Working days only, the way the calendar and the digest count them.
	const away = [...new Set((byDate(entries, todayHolidays).get(today) ?? []).map((e) => e.display_name))];

	return page(
		c,
		<AdminOverviewPage
			{...adminCommon(c)}
			today={today}
			holidaysDue={holidaysDue}
			awayToday={away}
			push={pushCounts ? { people: active.filter((u) => (pushCounts.get(u.email) ?? 0) > 0).length, active: active.length } : null}
			lastDigest={log.find((r) => r.kind === 'daily') ?? null}
			changesWeek={counts.since}
			changesTotal={counts.total}
			users={users}
			types={types}
			holidayCounts={[
				{ year: thisYear, n: holidaysNow.length },
				{ year: thisYear + 1, n: holidaysNext.length },
			]}
			lineEnabled={lineEnabled(c.env)}
			unused={
				yearEnd.type
					? {
							type: lang === 'th' ? yearEnd.type.label_th : yearEnd.type.label_en,
							days: yearEnd.rows.reduce((n, r) => n + Math.max(r.left, 0), 0),
						}
					: null
			}
		/>,
	);
});

/** Who still has annual leave unbooked this year, and the November reminder. */
app.get('/admin/year-end', async (c) => {
	const { year, minYear, maxYear } = adminYear(c);
	const thisYear = Number(c.get('today').slice(0, 4));
	const [report, pushCounts, reminder] = await Promise.all([
		yearEndReport(c.env, year),
		pushConfigured(c.env) ? db.subscriptionCounts(c.env.DB) : Promise.resolve(null),
		db.getNotification(c.env.DB, yearEndKey(thisYear), 'yearend', 'push'),
	]);
	return page(
		c,
		<AdminYearEndPage
			{...adminCommon(c)}
			year={year}
			minYear={minYear}
			maxYear={maxYear}
			thisYear={thisYear}
			type={report.type}
			rows={report.rows}
			pushCounts={pushCounts}
			reminder={reminder}
		/>,
	);
});

/** Send this year's reminder now rather than in November. Still once a year. */
app.post('/admin/year-end/remind', async (c) => {
	const form = await c.req.parseBody();
	// `retry` takes back a failed attempt's claim; a sent reminder is never resent.
	const outcome = await runYearEnd(c.env, c.get('today'), { force: true, retry: form.retry === '1' });
	console.log(JSON.stringify({ job: 'year-end-reminder', trigger: 'admin', ...outcome }));
	const back = '/admin/year-end';
	switch (outcome.status) {
		case 'sent':
			return redirectWithFlash(back, 'ok', say(c, 'flash.remindSent', { n: outcome.people, count: outcome.people }));
		case 'skipped_duplicate':
			return redirectWithFlash(back, 'err', say(c, 'flash.remindDone'));
		case 'skipped_empty':
			return redirectWithFlash(back, 'ok', say(c, 'flash.remindEmpty'));
		case 'not_configured':
			return redirectWithFlash(back, 'err', say(c, 'flash.remindOff'));
		default:
			return redirectWithFlash(back, 'err', say(c, 'flash.remindFailed'));
	}
});

app.get('/admin/people', async (c) => {
	const { year, minYear, maxYear } = adminYear(c);
	const [users, types, quotas, pushCounts] = await Promise.all([
		db.listUsers(c.env.DB),
		leaveTypesOf(c),
		db.listQuotasForYear(c.env.DB, year),
		pushConfigured(c.env) ? db.subscriptionCounts(c.env.DB) : Promise.resolve(null),
	]);
	return page(
		c,
		<AdminPeoplePage {...adminCommon(c)} year={year} minYear={minYear} maxYear={maxYear} users={users} types={types} quotas={quotas} pushCounts={pushCounts} />,
	);
});

app.get('/admin/people/:email', async (c) => {
	const email = c.req.param('email').trim().toLowerCase();
	const { year, minYear, maxYear } = adminYear(c);
	const subject = isEmail(email) ? await db.getUser(c.env.DB, email) : null;
	if (!subject) return redirectWithFlash(`/admin/people?y=${year}`, 'err', say(c, 'flash.unknownPerson'));
	const [types, quotas, subs] = await Promise.all([
		leaveTypesOf(c),
		db.listQuotas(c.env.DB, subject.email, year),
		pushConfigured(c.env) ? db.subscriptionsFor(c.env.DB, subject.email) : Promise.resolve(null),
	]);
	return page(
		c,
		<AdminPersonPage
			{...adminCommon(c)}
			subject={subject}
			year={year}
			minYear={minYear}
			maxYear={maxYear}
			types={types}
			quotas={quotas}
			pushCount={subs ? subs.length : null}
		/>,
	);
});

/**
 * One person's role, status and allowances, saved together.
 *
 * These were two forms with two Save buttons, and saving either discarded
 * whatever had been typed into the other. Every allowance is checked before
 * anything is written, so a typo in one field does not save the rest.
 */
app.post('/admin/people/:email', async (c) => {
	const actor = userOf(c);
	const email = c.req.param('email').trim().toLowerCase();
	const form = await c.req.parseBody();
	const year = Number(form.year);
	const subject = isEmail(email) ? await db.getUser(c.env.DB, email) : null;
	if (!subject || !Number.isInteger(year) || year < 2000 || year > 2100) {
		return redirectWithFlash('/admin/people', 'err', say(c, 'flash.badRequest'));
	}
	const back = `/admin/people/${encodeURIComponent(subject.email)}?y=${year}`;

	const types = await leaveTypesOf(c);
	const days = new Map<number, number>();
	for (const type of types) {
		const raw = form[`q_${type.id}`];
		if (raw === undefined || raw === '') continue;
		const n = Number(raw);
		if (!Number.isFinite(n) || n < 0 || n > 365) return redirectWithFlash(back, 'err', say(c, 'flash.daysRange'));
		days.set(type.id, round(n));
	}

	const isAdmin = form.isAdmin === '1';
	const active = form.active === '1';
	// The last admin cannot demote or deactivate themselves: nobody would be
	// left who could undo it.
	if (subject.email === actor.email && (!isAdmin || !active)) {
		const admins = (await db.listUsers(c.env.DB)).filter((u) => u.is_admin && u.active);
		if (admins.length <= 1) return redirectWithFlash(back, 'err', say(c, 'flash.onlyAdmin'));
	}

	await db.setAdmin(c.env.DB, subject.email, isAdmin);
	await db.setActive(c.env.DB, subject.email, active);
	for (const [typeId, n] of days) await db.setQuota(c.env.DB, subject.email, year, typeId, n);
	return redirectWithFlash(`/admin/people?y=${year}`, 'ok', say(c, 'flash.personSaved', { name: subject.display_name }));
});

app.get('/admin/types', async (c) => {
	const [types, usage] = await Promise.all([leaveTypesOf(c), db.leaveTypeUsage(c.env.DB)]);
	return page(c, <AdminTypesPage {...adminCommon(c)} types={types} usage={usage} />);
});

app.get('/admin/holidays', async (c) => {
	const { year, minYear, maxYear } = adminYear(c);
	const [holidays, holidaysDue] = await Promise.all([db.listHolidays(c.env.DB, `${year}-01-01`, `${year}-12-31`), holidayReminder(c)]);
	return page(
		c,
		<AdminHolidaysPage {...adminCommon(c)} year={year} minYear={minYear} maxYear={maxYear} holidays={holidays} holidaysDue={holidaysDue} />,
	);
});

app.get('/admin/notifications', async (c) => {
	const configured = pushConfigured(c.env);
	const [users, groupId, log, pushCounts] = await Promise.all([
		db.listUsers(c.env.DB),
		resolveGroupId(c.env),
		db.recentNotifications(c.env.DB),
		configured ? db.subscriptionCounts(c.env.DB) : Promise.resolve(null),
	]);
	const active = users.filter((u) => u.active);
	const enabled = lineEnabled(c.env);
	const lineSet = lineConfigured(c.env);
	return page(
		c,
		<AdminNotificationsPage
			{...adminCommon(c)}
			today={c.get('today')}
			push={
				pushCounts
					? {
						people: active.filter((u) => (pushCounts.get(u.email) ?? 0) > 0).length,
						active: active.length,
						browsers: active.reduce((n, u) => n + (pushCounts.get(u.email) ?? 0), 0),
					}
					: null
			}
			line={{ enabled, configured: lineSet, groupId, ready: enabled && lineSet && Boolean(groupId) }}
			log={log}
		/>,
	);
});

app.get('/admin/export', (c) => page(c, <AdminExportPage {...adminCommon(c)} today={c.get('today')} />));

app.get('/admin/activity', async (c) => {
	// Anything unrecognised is dropped rather than refused: it is a view, and
	// the unfiltered trail is a fine answer to a bad link.
	const whoRaw = c.req.query('audit_who')?.trim().toLowerCase();
	const actionRaw = c.req.query('audit_action');
	const auditFilter: db.AuditFilter = {
		who: whoRaw && isEmail(whoRaw) ? whoRaw : undefined,
		action: db.AUDIT_ACTIONS.find((a) => a === actionRaw),
		page: clampInt(c.req.query('audit_page'), 1, 1, 1000),
	};
	const [users, audit] = await Promise.all([db.listUsers(c.env.DB), db.listAudit(c.env.DB, auditFilter)]);
	return page(c, <AdminActivityPage {...adminCommon(c)} users={users} audit={audit.rows} auditMore={audit.more} auditFilter={auditFilter} />);
});

app.post('/admin/quotas/bulk', async (c) => {
	const form = await c.req.parseBody();
	const leaveTypeId = Number(form.leaveTypeId);
	const days = Number(form.days);
	const year = Number(form.year);
	if (!Number.isInteger(year)) return redirectWithFlash('/admin/people', 'err', say(c, 'flash.badRequest'));
	if (!Number.isFinite(days) || days < 0 || days > 365) {
		return redirectWithFlash(`/admin/people?y=${year}`, 'err', say(c, 'flash.daysRange'));
	}

	const types = await leaveTypesOf(c);
	if (!types.some((t) => t.id === leaveTypeId)) {
		return redirectWithFlash(`/admin/people?y=${year}`, 'err', say(c, 'flash.unknownType'));
	}

	const count = await db.bulkSetQuota(c.env.DB, year, leaveTypeId, round(days));
	return redirectWithFlash(`/admin/people?y=${year}`, 'ok', say(c, 'flash.quotasBulk', { count, n: count }));
});

/**
 * Add a leave type, or edit one. One route for both, told apart by `id`: the
 * form and the rules are the same apart from the code, which only a new type
 * takes (src/domain/leaveTypes.ts).
 */
app.post('/admin/type', async (c) => {
	const form = (await c.req.parseBody()) as Record<string, unknown>;
	const rawId = String(form.id ?? '').trim();
	const creating = rawId === '';
	const id = Number(rawId);
	if (!creating && !Number.isInteger(id)) return redirectWithFlash('/admin/types', 'err', say(c, 'flash.badRequest'));

	const parsed = parseLeaveTypeForm(form, creating);
	if (!parsed.ok) return redirectWithFlash('/admin/types', 'err', sayMessage(c, parsed.error));
	const t = parsed.value;
	const label = t.label_en;

	if (creating) {
		const code = t.code ?? '';
		const added = await db.createLeaveType(c.env.DB, { ...t, code });
		return added
			? redirectWithFlash('/admin/types', 'ok', say(c, 'flash.typeAdded', { label }))
			: redirectWithFlash('/admin/types', 'err', say(c, 'flash.typeCodeTaken', { code }));
	}

	const types = await leaveTypesOf(c);
	if (!types.some((x) => x.id === id)) return redirectWithFlash('/admin/types', 'err', say(c, 'flash.unknownType'));
	// Retiring the last offered type would leave a booking form with nothing to pick.
	if (!t.active && !types.some((x) => x.id !== id && x.active)) {
		return redirectWithFlash('/admin/types', 'err', say(c, 'flash.typeLastActive'));
	}

	await db.updateLeaveType(c.env.DB, id, t);
	return redirectWithFlash('/admin/types', 'ok', say(c, 'flash.typeSaved', { label }));
});

/** Delete a leave type — only ever one nobody has booked. Anything else is retired instead. */
app.post('/admin/type/delete', async (c) => {
	const form = await c.req.parseBody();
	const id = Number(form.id);
	const type = (await leaveTypesOf(c)).find((x) => x.id === id);
	if (!type) return redirectWithFlash('/admin/types', 'err', say(c, 'flash.unknownType'));
	const label = type.label_en;
	if (type.active && !(await leaveTypesOf(c)).some((x) => x.id !== id && x.active)) {
		return redirectWithFlash('/admin/types', 'err', say(c, 'flash.typeLastActive'));
	}

	const deleted = await db.deleteUnusedLeaveType(c.env.DB, id);
	return deleted
		? redirectWithFlash('/admin/types', 'ok', say(c, 'flash.typeDeleted', { label }))
		: redirectWithFlash('/admin/types', 'err', say(c, 'flash.typeInUse', { label }));
});

/**
 * Preview the digest without sending. Runs the real job in dry-run mode, so
 * what an admin sees here is produced by the same code that posts at 09:00.
 */
app.post('/admin/notify/preview', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim() || c.get('today');
	if (!isValidDate(date)) return redirectWithFlash('/admin/notifications', 'err', say(c, 'flash.badDate'));

	const week = form.kind === 'week';
	const outcome = week
		? await runWeekAhead(c.env, date, { dryRun: true, allowAnyDay: true })
		: await runDigest(c.env, date, { dryRun: true });
	const summary =
		outcome.status === 'dry_run'
			? say(c, 'flash.wouldPost', { count: outcome.people, n: outcome.people })
			: say(c, 'flash.wouldNotPost', { reason: say(c, `status.${outcome.status}`) });

	// The push title leads, because it is the one line a phone shows on the lock
	// screen; the body below it is what LINE posts and what a notification
	// shows when expanded.
	//
	// The preview text itself is stashed in the flash rather than the URL —
	// query strings carrying prose get blocked by the WAF (docs/ISSUES.md #15).
	const title = outcome.title ? `\n\n${say(c, 'flash.pushTitle', { title: outcome.title })}` : '';
	return redirectWithFlash('/admin/notifications', 'ok', outcome.text ? `${summary}${title}\n\n${outcome.text}` : summary);
});

/** Send the digest now. Used to verify a fresh LINE setup, and to retry a failure. */
app.post('/admin/notify/send', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim() || c.get('today');
	if (!isValidDate(date)) return redirectWithFlash('/admin/notifications', 'err', say(c, 'flash.badDate'));

	// `force` comes from the tick box in both cases. Only the day gate is
	// relaxed for a manual week-ahead send — an admin pressing the button twice
	// must still hit the duplicate guard.
	const force = form.force === '1';
	const outcome =
		form.kind === 'week'
			? await runWeekAhead(c.env, date, { force, allowAnyDay: true })
			: await runDigest(c.env, date, { force });

	if (outcome.status === 'sent') {
		// Says which channels actually delivered, rather than naming LINE when the
		// message may well have gone only to browsers.
		const sent = outcome.channels
			.filter((ch) => ch.status === 'sent')
			.map((ch) =>
				ch.channel === 'push' ? say(c, 'flash.browsers', { count: ch.recipients ?? 0, n: ch.recipients ?? 0 }) : say(c, 'flash.line'),
			)
			.join(' + ');
		return redirectWithFlash('/admin/notifications', 'ok', say(c, 'flash.sentTo', { count: outcome.people, channels: sent, n: outcome.people }));
	}
	if (outcome.status === 'failed') {
		return redirectWithFlash('/admin/notifications', 'err', say(c, 'flash.sendFailed', { error: outcome.error ?? '—' }));
	}
	return redirectWithFlash('/admin/notifications', 'err', say(c, 'flash.nothingSent', { reason: say(c, `status.${outcome.status}`) }));
});

/**
 * Import a pasted list of holidays.
 *
 * Nothing is written unless every line parses. A partial import of a
 * government holiday notice is the worst outcome: the calendar looks updated,
 * and the three days that failed silently draw down everyone's quota.
 */
/**
 * Leave as a spreadsheet, for HR. Admin only, like everything under /admin.
 *
 * Two shapes: `summary`, one row per person per leave type, and `bookings`,
 * one row per booking. Both count the days that fall inside the range — a
 * booking crossing its edge is cut there and recounted (`daysWithin`) — and
 * the bookings sheet also gives each booking's own charged total, so the two
 * numbers can be told apart. Deactivated people are included: they took the
 * leave. Notes never are, shared or not. Emails are, since HR needs a stable
 * key and the admin page already shows them.
 */
app.get('/admin/export.csv', async (c) => {
	const today = c.get('today');
	const year = today.slice(0, 4);
	const from = validDateOr(c.req.query('from'), `${year}-01-01`);
	const to = validDateOr(c.req.query('to'), `${year}-12-31`);
	const kind = c.req.query('kind') === 'bookings' ? 'bookings' : 'summary';
	if (from > to) return redirectWithFlash('/admin/export', 'err', say(c, 'flash.exportOrder'));
	if (daysBetween(from, to) > MAX_RANGE_DAYS) return redirectWithFlash('/admin/export', 'err', say(c, 'flash.exportTooLong', { n: MAX_RANGE_DAYS }));

	const [entries, holidays] = await Promise.all([
		db.listLeaveInRange(c.env.DB, from, to, undefined, { includeInactive: true }),
		db.holidaySet(c.env.DB, from, to),
	]);

	const rows: (string | number)[][] =
		kind === 'summary'
			? [
				['name', 'email', 'leave_type', 'leave_type_th', 'days', 'bookings'],
				...leaveSummary(entries, from, to, holidays).map((r) => [r.name, r.email, r.typeEn, r.typeTh, r.days, r.bookings]),
			]
			: [
				['name', 'email', 'leave_type', 'leave_type_th', 'start', 'end', 'start_half', 'end_half', 'days_in_range', 'days_charged'],
				...entries
					.map((e) => [e, daysWithin(e, from, to, holidays)] as const)
					.filter(([, days]) => days > 0)
					.map(([e, days]) => [
						e.display_name, e.user_email, e.type_label_en, e.type_label_th,
						e.start_date, e.end_date, e.start_half, e.end_half, days, e.days_total,
					]),
			];

	return new Response(toCsv(rows), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="wan-nee-la-${kind}-${from}-to-${to}.csv"`,
			// Everyone's leave: never left in a shared machine's cache.
			'Cache-Control': 'private, no-store',
		},
	});
});

/**
 * The holiday import's middle step: parse, compare with what is held, and show
 * whose bookings cross a new holiday. Writes nothing; the page's confirm
 * button posts the same text to /admin/holidays/import.
 */
app.post('/admin/holidays/preview', async (c) => {
	const form = await c.req.parseBody();
	const text = String(form.list ?? '');
	if (!text.trim()) return redirectWithFlash('/admin/holidays', 'err', say(c, 'flash.nothingToImport'));

	const { holidays, errors } = parseHolidayList(text);
	let plan = null;
	if (holidays.length > 0) {
		const from = holidays[0].date;
		const to = holidays[holidays.length - 1].date;
		const [held, bookings] = await Promise.all([db.listHolidays(c.env.DB, from, to), db.listLeaveInRange(c.env.DB, from, to)]);
		plan = importPlan(holidays, new Map(held.map((h) => [h.date, h.label])), bookings);
	}
	return page(
		c,
		<HolidayPreviewPage user={userOf(c)} text={text} errors={errors} plan={plan} version={c.env.CF_VERSION_METADATA?.id} />,
	);
});

app.post('/admin/holidays/import', async (c) => {
	const form = await c.req.parseBody();
	const text = String(form.list ?? '');
	if (!text.trim()) return redirectWithFlash('/admin/holidays', 'err', say(c, 'flash.nothingToImport'));

	const { holidays, errors } = parseHolidayList(text);
	if (errors.length > 0) {
		const shown = errors.slice(0, 5).map((e) => `line ${e.line}: ${e.reason}`).join('\n');
		const more = errors.length > 5 ? `\n…and ${errors.length - 5} more.` : '';
		return redirectWithFlash('/admin/holidays', 'err', `${say(c, 'flash.importFailed')}\n\n${shown}${more}`);
	}
	if (holidays.length === 0) return redirectWithFlash('/admin/holidays', 'err', say(c, 'flash.importEmpty'));

	// Asked for from the preview: the bookings that cross a new holiday, worked
	// out against the table as it is *before* the write, so "new" means new.
	const from = holidays[0].date;
	const to = holidays[holidays.length - 1].date;
	let plan = null;
	if (form.recount === '1') {
		const [held, bookings] = await Promise.all([db.listHolidays(c.env.DB, from, to), db.listLeaveInRange(c.env.DB, from, to)]);
		plan = importPlan(holidays, new Map(held.map((h) => [h.date, h.label])), bookings);
	}

	const written = await db.bulkUpsertHolidays(c.env.DB, holidays);

	// Each booking's days were counted when it was saved, so a holiday added
	// later is still charged. Recount through the same write an edit uses,
	// which records it in the audit trail under the admin's name. Only ever
	// fewer days, so no balance check can refuse it; a booking left with no
	// working day at all is left as it is, for a person to decide about.
	let recounted = 0;
	for (const { entry } of plan?.affected ?? []) {
		const off = await db.holidaySet(c.env.DB, entry.start_date, entry.end_date);
		const count = countLeaveDays(entry.start_date, entry.end_date, entry.start_half, entry.end_half, off);
		if (!count.ok || count.days === entry.days_total) continue;
		const changed = await db.updateLeave(
			c.env.DB,
			entry.id,
			{
				leave_type_id: entry.leave_type_id,
				start_date: entry.start_date,
				end_date: entry.end_date,
				start_half: entry.start_half,
				end_half: entry.end_half,
				days_total: count.days,
				note: entry.note,
				note_private: entry.note_private,
			},
			userOf(c).email,
		);
		if (changed) recounted++;
	}

	const imported = say(c, 'flash.imported', { count: written, n: written, from, to });
	const recountNote = recounted > 0 ? ` ${say(c, 'flash.recounted', { count: recounted, n: recounted })}` : '';
	return redirectWithFlash(`/admin/holidays?y=${from.slice(0, 4)}`, 'ok', `${imported}${recountNote}`);
});

app.post('/admin/holiday', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim();
	const label = String(form.label ?? '').trim().slice(0, 80);
	if (!isValidDate(date) || !label) return redirectWithFlash('/admin/holidays', 'err', say(c, 'flash.holidayNeedsBoth'));
	await db.addHoliday(c.env.DB, date, label);
	return redirectWithFlash(`/admin/holidays?y=${date.slice(0, 4)}`, 'ok', say(c, 'flash.holidayAdded', { date }));
});

app.post('/admin/holiday/delete', async (c) => {
	const form = await c.req.parseBody();
	const date = String(form.date ?? '').trim();
	if (!isValidDate(date)) return redirectWithFlash('/admin/holidays', 'err', say(c, 'flash.badDate'));
	await db.removeHoliday(c.env.DB, date);
	return redirectWithFlash(`/admin/holidays?y=${date.slice(0, 4)}`, 'ok', say(c, 'flash.holidayRemoved', { date }));
});

export default app;
