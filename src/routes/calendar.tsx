import { Hono } from 'hono';
import { addDays, isValidDate, monthGrid, parseWeekStart } from '../domain/dates.ts';
import * as db from '../repo/db.ts';
import { BookPage } from '../views/book.tsx';
import { CalendarPage, UPCOMING_DAYS } from '../views/calendar.tsx';
import { personColors } from '../views/person.ts';
import { userOf, bookablePeople, peopleFor, keysOf, leaveTypesOf, holidayReminder, clampInt, page, type AppEnv } from '../server/common.tsx';
import { flashUndo, flashDraft, flashOf, flashField } from '../server/flash.ts';
/*
 * The calendar, the API reference page, and the standalone booking page.
 */

const app = new Hono<AppEnv>();

app.get('/', async (c) => {
	const user = userOf(c);
	const today = c.get('today');
	const now = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
	const year = clampInt(c.req.query('y'), now.year, 2000, 2100);
	const month = clampInt(c.req.query('m'), now.month, 1, 12);

	// The grid is padded to whole weeks, so the query has to cover the padding
	// days too — otherwise leave shows in the trailing week of one month and
	// vanishes from the leading week of the next.
	//
	// It must be built with the viewer's own week start. A Sunday-first grid
	// begins a day earlier than a Monday-first one, and fetching the Monday-first
	// range would leave that first column silently empty.
	const grid = monthGrid(year, month, parseWeekStart(user.week_start) ?? undefined);
	const from = grid[0];
	const to = grid[grid.length - 1];

	// The sidebar answers "what is coming up", which is not the same question as
	// "what is in this month" — it stays anchored to today while someone pages
	// through months, so it is fetched on its own rather than filtered out of
	// the grid's data.
	const [entries, holidays, types, upcoming, users, holidaysDue] = await Promise.all([
		db.listLeaveInRange(c.env.DB, from, to),
		db.listHolidays(c.env.DB, from, to),
		leaveTypesOf(c),
		db.listLeaveInRange(c.env.DB, today, addDays(today, UPCOMING_DAYS)),
		// Every user, deactivated ones included, because colours are handed out
		// in sign-up order and leaving someone out would shift everyone after.
		db.listUsers(c.env.DB),
		holidayReminder(c),
	]);
	// The same list `bookablePeople` builds, from the users already fetched.
	const keys = await keysOf(c, users);
	const people = user.is_admin ? peopleFor(user, users, keys) : [];

	return page(
		c,
		<CalendarPage
			user={user}
			year={year}
			month={month}
			entries={entries}
			holidays={holidays}
			types={types}
			upcoming={upcoming}
			holidaysDue={holidaysDue}
			people={people}
			colors={personColors(users)}
			keys={keys}
			today={today}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			errorField={flashField(c.get('flash'))}
			notice={flashOf(c.get('flash'), 'ok')}
			draft={flashDraft(c.get('flash'))}
			undo={flashUndo(c.get('flash'))}
		/>,
	);
});

/**
 * API reference.
 *
 * Rendered by the Worker rather than dropped into `public/` as a static page,
 * for two reasons. Assets are served before the Worker runs, so a page there
 * would arrive with none of the security headers every other response
 * carries — no CSP, no frame refusal. And this way it sits behind the same
 * authentication as the rest of the app rather than only behind Access.
 *
 * Swagger UI itself is 1.7MB of vendored build, copied out of node_modules by
 * `npm run build:docs` and gitignored, exactly as `public/app.js` is. It loads
 * from this origin, which is all `script-src 'self'` permits, and
 * `connect-src 'self'` means the page cannot call anything but this app even
 * if a future version of it tried to.
 */
app.get('/docs', (c) =>
	c.html(
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>API · wan-nee-la</title>
				<link rel="stylesheet" href="/docs/swagger-ui.css" />
				{/* Swagger UI paints its own white surface and does not follow the
				    app's theme. Saying so here stops the browser handing it a dark
				    form control on a light panel. */}
				<meta name="color-scheme" content="light" />
				<style>{'body { margin: 0; } .swagger-ui .topbar { display: none; }'}</style>
				<script src="/docs/swagger-ui-bundle.js"></script>
				<script src="/docs/init.js"></script>
			</head>
			<body>
				<div id="swagger-ui"></div>
			</body>
		</html>,
	),
);

/**
 * Standalone booking page — the no-JS destination for the calendar's day cells
 * and Book leave button. With scripting on, those clicks open a dialog instead
 * and never reach this route.
 */
app.get('/book', async (c) => {
	const user = userOf(c);
	const today = c.get('today');
	const raw = c.req.query('date');
	const [types, people] = await Promise.all([leaveTypesOf(c), bookablePeople(c)]);

	return page(
		c,
		<BookPage
			user={user}
			types={types}
			people={people}
			today={today}
			date={raw && isValidDate(raw) ? raw : undefined}
			version={c.env.CF_VERSION_METADATA?.id}
			error={flashOf(c.get('flash'), 'err')}
			errorField={flashField(c.get('flash'))}
			notice={flashOf(c.get('flash'), 'ok')}
			draft={flashDraft(c.get('flash'))}
			undo={flashUndo(c.get('flash'))}
		/>,
	);
});

export default app;
