import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import { isValidDate, type Half } from '../domain/dates.ts';
import { holidayGap, type HolidayGap } from '../domain/holidays.ts';
import { t, tm, toLang, type Message, type StringKey } from '../i18n/strings.ts';
import * as db from '../repo/db.ts';
import { ErrorCard, ErrorPage, Layout } from '../views/layout.tsx';
import { PushKeyProvider } from '../views/site.tsx';
import { personKeys } from '../views/person.ts';
import { pushConfigured } from '../notify/digest.ts';
import { shouldTellOwner, tellOwner, type OwnerNoticeAction } from '../notify/owner.ts';
import type { Env, LeaveType, User } from '../types.ts';
import type { Flash } from './flash.ts';

/** The app's Hono environment: its bindings and what middleware puts on the context. */
export type AppEnv = { Bindings: Env; Variables: Vars };

// `leaveTypes` caches db.listLeaveTypes() for the lifetime of one request. It
// deliberately lives on the per-request Hono context rather than a module-level
// variable: a module global in a Worker isolate survives across requests (and
// across different users), and leave types can change out from under us via
// direct SQL or a migration, so a global would keep serving stale data with no
// event that would ever clear it. Scoping the cache to `c` means it is created
// fresh every request and simply falls out of scope when the request ends.
// `user` is absent for a service token, and before the auth middleware has
// run — the error handlers can see that. Routes that need a person read it
// through `userOf`, which says so loudly rather than handing back undefined.
export type Vars = { user?: User; service?: string; today: string; flash: Flash; leaveTypes?: LeaveType[] };

export type Ctx = Context<AppEnv>;

/**
 * The signed-in person, for a route that only runs for one — which is every
 * route below the auth middleware, bar the machine feeds. Throws rather than
 * hand back undefined: reaching here without a person is a bug, and the error
 * handler turns it into a 500 instead of a page about nobody.
 */
export function userOf(c: Ctx): User {
	const user = c.get('user');
	if (!user) throw new Error('this route needs a signed-in person');
	return user;
}

/**
 * Translate for whoever is signed in.
 *
 * Flash messages are rendered on the next request, by which time the reader is
 * known again — but translating here keeps the message and its numbers in one
 * place, and means a stored flash cannot outlive a language change.
 */
export function say(c: Ctx, key: StringKey, vars?: Record<string, string | number>): string {
	return t(toLang(c.get('user')?.lang), key, vars);
}

export function sayMessage(c: Ctx, m: Message): string {
	return tm(toLang(c.get('user')?.lang), m);
}

/**
 * Leave types, memoised on `c` for this request. Several routes need the list
 * more than once (once to build a form, again to validate what came back from
 * it), and the data is static seed data within a request's lifetime, so the
 * repeat calls were pure waste. See the comment on `Vars` for why this is a
 * per-request cache and not a module-level one.
 */
/**
 * The people an admin may book for: everyone active, the admin first. Empty
 * for anyone else, and the booking form then has no "Booking for" field.
 */
export async function bookablePeople(c: Ctx): Promise<{ key: string; name: string }[]> {
	const user = userOf(c);
	if (!user.is_admin) return [];
	const users = await db.listUsers(c.env.DB);
	return peopleFor(user, users, await keysOf(c, users));
}

export function peopleFor(user: User, users: User[], keys: ReadonlyMap<string, string>): { key: string; name: string }[] {
	const others = users.filter((u) => u.active && u.email !== user.email);
	return [user, ...others].map((u) => ({ key: keys.get(u.email) ?? '', name: u.display_name }));
}

/** Everyone's opaque key, by email (`personKeys`). */
export async function keysOf(c: Ctx, users: readonly { email: string }[]): Promise<Map<string, string>> {
	return personKeys(await db.personKeySalt(c.env.DB), users.map((u) => u.email));
}

/**
 * The person a `personKey` from the booking form names, if they are active.
 * Null when it names nobody, or — the key being a short hash — more than one.
 */
export async function personByKey(c: Ctx, key: string): Promise<User | null> {
	const users = (await db.listUsers(c.env.DB)).filter((u) => u.active);
	const keys = await keysOf(c, users);
	const matches = users.filter((u) => keys.get(u.email) === key);
	return matches.length === 1 ? matches[0] : null;
}

/**
 * When someone changes a booking that is not theirs, tell its owner. After the
 * response, so a slow push service never holds up the page.
 */
export function notifyOwner(
	c: Ctx,
	action: OwnerNoticeAction,
	booking: { id: string; user_email: string; start_date: string; end_date: string; start_half: Half; end_half: Half },
	type: { label_en: string; label_th: string } | undefined,
) {
	const actor = userOf(c);
	if (!type || !shouldTellOwner(actor.email, booking.user_email)) return;
	c.executionCtx.waitUntil(
		tellOwner(c.env, booking.user_email, {
			action,
			actorName: actor.display_name,
			leaveId: booking.id,
			type,
			start_date: booking.start_date,
			end_date: booking.end_date,
			start_half: booking.start_half,
			end_half: booking.end_half,
		}),
	);
}

/**
 * What a back link to `path` is called: the page's own name, so the link says
 * where it goes. "Back" only for a page without one.
 */
export function backLabel(c: Ctx, path: string): string {
	const p = path.split('?')[0];
	if (p === '/') return say(c, 'nav.calendar');
	if (p === '/me') return say(c, 'me.title');
	if (p === '/admin') return say(c, 'admin.title');
	if (p === '/admin/activity') return say(c, 'admin.activity');
	if (p === '/admin/year-end') return say(c, 'admin.yearEnd');
	if (p.startsWith('/admin/people')) return say(c, 'admin.people');
	return say(c, 'edit.back');
}

export async function leaveTypesOf(c: Ctx): Promise<LeaveType[]> {
	const cached = c.get('leaveTypes');
	if (cached) return cached;
	const types = await db.listLeaveTypes(c.env.DB);
	c.set('leaveTypes', types);
	return types;
}

/**
 * Whether next year's public holidays still need entering — for admins only,
 * and only in the months the rule looks at, so most page loads pay nothing.
 * See `holidayGap`.
 */
export async function holidayReminder(c: Ctx): Promise<HolidayGap | null> {
	const user = userOf(c);
	const today = c.get('today');
	const month = Number(today.slice(5, 7));
	if (!user.is_admin || (month < 10 && month !== 1)) return null;
	const year = Number(today.slice(0, 4)) + (month >= 10 ? 1 : 0);
	const dates = (await db.listHolidays(c.env.DB, `${year}-01-01`, `${year}-12-31`)).map((h) => h.date);
	return holidayGap(today, () => dates);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) return fallback;
	return n;
}

/**
 * Bounds for the prev/next year links on /me and /u/:email.
 *
 * `clampInt` above still allows a hand-edited `?y=` anywhere from 2000 to
 * 2100 — those routes work fine given a request for a year that far off, they
 * just have nothing to show. The links shouldn't invite that walk one click
 * at a time, so they stop five years either side of the current year, which
 * covers "last year's balances" and then some without wandering into empty
 * years.
 */
export function yearNavBounds(nowYear: number): { minYear: number; maxYear: number } {
	return { minYear: nowYear - 5, maxYear: nowYear + 5 };
}

/**
 * Every JSON failure, in one shape: `{ error: { message, key? } }`.
 *
 * There were three — a bare string here, `{ ok: false, error }` on the push
 * routes, and `{ error: { key } }` from the preview — so a caller handling
 * failures had to know which endpoint it was talking to. `message` is always a
 * sentence in the reader's language; `key` is there when the booking rules
 * named one, for a program that would rather match than parse prose.
 */
export function jsonError(c: Ctx, message: string, status: 400 | 403 | 409 | 500 | 502 | 503, key?: StringKey) {
	return c.json({ error: key === undefined ? { message } : { key, message } }, status);
}

/** Our half-day vocabulary, in the words this feed speaks. */
export const PERIOD: Record<Half, string> = { full: 'full_day', am: 'morning', pm: 'afternoon' };

/**
 * Render a page with the per-deployment facts the shared header reads — today
 * only the push key, which decides whether the notifications bell is drawn.
 * See src/views/site.tsx for why that is a context and not a prop.
 */
/**
 * An error as a page. Inside the app, with its bars and a way back, whenever
 * someone is signed in; in their language. A bare page only when nobody is.
 */
export function errorPage(c: Ctx, status: 403 | 404 | 500, title: StringKey, detail: StringKey) {
	const user = c.get('user');
	const lang = toLang(user?.lang);
	if (!user) return c.html(<ErrorPage title={t('en', title)} detail={t('en', detail)} />, status);
	return page(
		c,
		<Layout title={t(lang, title)} user={user} active="calendar" version={c.env.CF_VERSION_METADATA?.id}>
			<ErrorCard title={t(lang, title)} detail={t(lang, detail)} />
		</Layout>,
		status,
	);
}

export function page(c: Ctx, node: Child, status?: 403 | 404 | 500) {
	const pushKey = pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : '';
	return c.html(<PushKeyProvider value={pushKey}>{node}</PushKeyProvider>, status);
}

export function validDateOr(raw: string | undefined, fallback: string): string {
	return raw && isValidDate(raw) ? raw : fallback;
}

/**
 * Is this shaped like an email address?
 *
 * Deliberately loose. The addresses here come from Access, not from a signup
 * form, so this is not the authority on what an address may look like — it only
 * keeps obvious rubbish out of a lookup, and gives a caller a 400 saying which
 * parameter is wrong instead of a silently empty list. The length cap is the
 * SMTP maximum.
 */
export function isEmail(raw: string): boolean {
	return raw.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

/**
 * Path to bounce back to after a form post. Only the path and query of a
 * same-origin URL are kept — a Referer is attacker-influenceable, and feeding
 * it whole into a redirect is an open-redirect.
 */
/**
 * A client-supplied redirect target, accepted only when it is a plain
 * same-origin path. A bare `/` prefix is not enough: `//evil.example` is
 * protocol-relative and would leave the site, which is an open redirect.
 */
export function safePath(raw: unknown): string | null {
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value.startsWith('/') || value.startsWith('//')) return null;
	if (value.includes('\\') || value.includes('\n') || value.includes('\r')) return null;
	return value.slice(0, 200);
}

/**
 * Where a form was submitted from, as a path on this site.
 *
 * Two guards, because this feeds a `Location` header:
 *
 *  - the referrer must be *this* origin. A page elsewhere can set its own
 *    `Referrer-Policy: unsafe-url` and send us any URL it likes; only our own
 *    pages get to say where a redirect goes.
 *  - the extracted path goes through `safePath` like every other redirect
 *    target. `new URL('https://evil.example//evil.com').pathname` is
 *    `//evil.com`, which starts with a slash and would otherwise sail through
 *    as a protocol-relative redirect off the site.
 */
export function referrerPath(referer: string | undefined, requestUrl: string): string | null {
	if (!referer) return null;
	try {
		const u = new URL(referer);
		if (u.origin !== new URL(requestUrl).origin) return null;
		return safePath(u.pathname + u.search);
	} catch {
		return null;
	}
}

