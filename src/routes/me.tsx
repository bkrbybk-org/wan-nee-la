import { Hono } from 'hono';
import { parseWeekStart } from '../domain/dates.ts';
import { monthlyDays } from '../domain/report.ts';
import { isLang, t } from '../i18n/strings.ts';
import * as db from '../repo/db.ts';
import { MePage, MeSettingsPage } from '../views/me.tsx';
import { UserPage } from '../views/user.tsx';
import { userOf, say, leaveTypesOf, clampInt, yearNavBounds, errorPage, page, type AppEnv } from '../server/common.tsx';
import { flashUndo, flashOf, redirectWithFlash } from '../server/flash.ts';
/*
 * My leave, a person's page, and settings.
 */

const app = new Hono<AppEnv>();

app.get('/me', async (c) => {
	const user = userOf(c);
	const today = c.get('today');
	const nowYear = Number(today.slice(0, 4));
	const year = clampInt(c.req.query('y'), nowYear, 2000, 2100);
	const { minYear, maxYear } = yearNavBounds(nowYear);
	// Upcoming unless asked otherwise — and for a year already over, where
	// nothing is upcoming, that year's bookings.
	const list = c.req.query('list') === 'past' || (c.req.query('list') === undefined && year < nowYear) ? 'past' : 'upcoming';

	const types = await leaveTypesOf(c);
	const [balances, entries, holidays, upcoming, byOthers] = await Promise.all([
		db.balancesFor(c.env.DB, user.email, year, types),
		db.listUserLeave(c.env.DB, user.email, year),
		db.holidaySet(c.env.DB, `${year}-01-01`, `${year}-12-31`),
		db.listUpcomingFor(c.env.DB, user.email, today),
		db.changedByOthers(c.env.DB, user.email),
	]);
	// Confirmed leave only: a cancelled booking took no days off.
	const months = monthlyDays(entries.filter((e) => e.status === 'confirmed'), year, holidays);

	return page(
		c,
		<MePage
			user={user}
			year={year}
			minYear={minYear}
			maxYear={maxYear}
			balances={balances}
			months={months}
			upcoming={upcoming}
			past={entries.filter((e) => e.status !== 'confirmed' || e.end_date < today)}
			list={list}
			byOthers={byOthers}
			types={types}
			today={today}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			notice={flashOf(c.get('flash'), 'ok')}
			undo={flashUndo(c.get('flash'))}
		/>,
	);
});

/**
 * One person's leave, keyed by email rather than an internal id — the same
 * address Access already authenticates them with, and what the admin table
 * and the calendar both key off of.
 *
 * Privacy rule lives entirely here: the schedule (`entries`) is fetched and
 * shown regardless of who's asking, since it already sits on the shared
 * calendar. `balances` is only fetched, and only rendered, when the viewer is
 * the subject themselves or an admin — everyone else gets the section omitted
 * by never receiving the prop, not by receiving zeros. An unknown email gets
 * the exact same 404 as a real-but-mistyped one, so this route can't be used
 * to enumerate who has an account.
 */
app.get('/u/:email', async (c) => {
	const viewer = userOf(c);
	const today = c.get('today');
	const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();

	const subject = await db.getUser(c.env.DB, email);
	if (!subject) {
		return errorPage(c, 404, 'err.notFound', 'err.notFoundDetail');
	}

	const nowYear = Number(today.slice(0, 4));
	const year = clampInt(c.req.query('y'), nowYear, 2000, 2100);
	const { minYear, maxYear } = yearNavBounds(nowYear);

	const canSeeBalances = viewer.email === subject.email || viewer.is_admin;
	const [entries, balances] = await Promise.all([
		db.listUserLeave(c.env.DB, subject.email, year),
		canSeeBalances ? db.balancesFor(c.env.DB, subject.email, year, await leaveTypesOf(c)) : Promise.resolve(undefined),
	]);

	return page(
		c,
		<UserPage
			viewer={viewer}
			today={c.get('today')}
			subject={subject}
			year={year}
			minYear={minYear}
			maxYear={maxYear}
			entries={entries}
			balances={balances}
			version={c.env.CF_VERSION_METADATA?.id}
		/>,
	);
});

app.get('/me/settings', (c) =>
	page(
		c,
		<MeSettingsPage
			user={userOf(c)}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			notice={flashOf(c.get('flash'), 'ok')}
		/>,
	),
);

/**
 * Name, week start and language, saved together. Each is checked before
 * anything is written, so one bad field saves none of them.
 */
app.post('/me/settings', async (c) => {
	const user = userOf(c);
	const form = await c.req.parseBody();
	const name = String(form.displayName ?? '').trim().slice(0, 60);
	if (!name) return redirectWithFlash('/me/settings', 'err', say(c, 'flash.nameEmpty'));
	// Only Sunday and Monday are offered; anything else is a crafted request,
	// and silently storing it would rotate the grid to an arbitrary column.
	const weekStart = parseWeekStart(form.weekStart);
	if (weekStart === null) return redirectWithFlash('/me/settings', 'err', say(c, 'flash.weekBad'));
	// Only the languages actually offered. Storing anything else would fall
	// back to English on every page while the radio button claimed otherwise.
	const lang = String(form.lang ?? '');
	if (!isLang(lang)) return redirectWithFlash('/me/settings', 'err', say(c, 'flash.langBad'));

	await db.setDisplayName(c.env.DB, user.email, name);
	await db.setWeekStart(c.env.DB, user.email, weekStart);
	await db.setLanguage(c.env.DB, user.email, lang);
	// In the language just chosen, not the one being left behind.
	return redirectWithFlash('/me/settings', 'ok', t(lang, 'flash.settingsSaved'));
});

export default app;
