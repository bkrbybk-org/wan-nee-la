# wan-nee-la — Architecture

Employee leave tracker. Cloudflare Workers, SSR, D1, and a weekday 09:00 Asia/Bangkok digest by browser push, with LINE as an optional second channel.

Name: วันนี้ลา — "on leave today".

## Decisions (locked)

| Area | Choice | Why |
| --- | --- | --- |
| Runtime | Cloudflare Workers | Required. |
| Framework | Hono + Hono JSX (SSR) | Same stack as a sibling Workers project. No React/SPA — pages are small, SSR is faster on mobile. |
| Data | D1 (SQLite) | Relational: users × quotas × requests. KV can't do the date-range queries the calendar needs. |
| Auth | Cloudflare Access (configured manually by owner) | Worker reads identity from the Access JWT. No password, no session store. |
| Client JS | esbuild IIFE bundles into `public/` | Same pattern as a sibling Workers project (`build:client`). Progressive enhancement only. |
| Notify | Web Push (VAPID); LINE Messaging API behind `LINE_ENABLED`, off by default | Push is free; LINE bills per group member. LINE Notify is dead (ISSUES.md #1). |
| Schedule | Workers Cron Trigger `0 2 * * 1-5` | 02:00 UTC = 09:00 Asia/Bangkok, Mon–Fri. Thailand has no DST, so the offset is fixed at UTC+7. The weekday range is evaluated in UTC and only matches the Bangkok week because 02:00 UTC is the same calendar day there. |
| Dates | `YYYY-MM-DD` strings, Bangkok-local | Leave is a calendar concept, not an instant. Storing UTC timestamps causes off-by-one-day bugs at the boundary. |

## Auth model

Cloudflare Access sits in front of the custom domain. Every request arrives with:

- `Cf-Access-Jwt-Assertion` header (also the `CF_Authorization` cookie)

The Worker **verifies** that JWT — signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (JWKS, cached in memory per isolate), plus `aud` == the Access application AUD tag, plus `exp`. Identity = the `email` claim.

Do **not** trust the header without verification, and do **not** expose a `workers.dev` route — Access only protects the custom hostname, so a `workers.dev` URL is an unauthenticated bypass to all employee leave data. `wrangler.jsonc` sets `"workers_dev": false`. Same rule as a sibling Workers project.

Admin = `users.is_admin` flag in D1, not an Access group (keeps the app self-contained).

### Machine callers

An Access service token carries `common_name`, not `email`, so it is nobody's employee. Since 2026-09-21 a named one may read four feeds — `/api/v1/leave`, `/api/v1/leave/by-date`, `/api/v1/holidays` and `/api/v1/balances` — and only those:

- Two gates. Access must admit the token (a Service Auth include on the policy), **and** `SERVICE_TOKENS` must name it. They are edited in different places by different people, and either one alone is not enough. An absent var means no machine may call at all, which is how the app behaved before and what it falls back to.
- Read-only, and narrow: no pages, no admin, no writes, and not the booking preview, which costs a real person's quota to compute. Anything else answers 403 naming the token.
- `/api/v1/balances` is the one feed a token may read that an ordinary employee may not: it is admin-or-token, because an integration asking it is an HR system by definition, while a colleague asking it is reading how much sick leave everyone has taken.
- No employee row is created, and no note is ever returned — not even a shared one, because "shared with the team" means shared with colleagues, and a credential is not one.
- Exercised locally by `DEV_SERVICE_TOKEN` under `DEV_AUTH_BYPASS`, so the machine path is covered by the smoke suite rather than only in production.

### In front of Access

Two zone-level layers run at the edge **before** Access, so they see anonymous traffic too (both verified 2026-09-19):

- **API Shield schema validation.** The ten JSON operations are uploaded as an OpenAPI 3.0.3 schema derived from `public/openapi.yaml` (`npm run openapi:shield`), and a WAF custom rule blocks on `cf.schema_validation.uploaded.violated`. The other 33 routes are not in the schema and are not checked; there is no fallthrough rule, and there must not be one. A change to what one of those operations *accepts* needs the schema regenerated and re-uploaded in the same change, or real requests start getting 403s. `npm run shield:probe` checks enforcement from outside. And `ship` warns when the spec would now validate differently from the schema last recorded as uploaded: `scripts/shield-uploaded.json` holds a fingerprint of paths, parameters and request bodies — prose excluded, so rewording a description does not raise it — written by `shield:upload`, or by `openapi:shield -- --mark-uploaded` after a dashboard upload. That file is only a record; `npm run shield:check` fingerprints a schema itself — a file downloaded from the dashboard, every upload in the zone with a read token, or with neither, the local file to upload.
- **A rule refusing `*.yaml` and `*.yml`.** Which is why `/docs` reads `/openapi.json`, not the YAML (ISSUES #42).

## Data model (D1)

Twelve migrations, applied in order; `0010` removed the unused unpaid leave type and changed data only, `0011` added `leave_types.active`, and `0012` indexes the audit trail by whose booking it was. This is the schema they produce — checked against a database with all of them applied, not written from memory.

Which have run is recorded in the database itself, in `applied_migrations (name, applied_at)`, written by `scripts/migrate.mjs` in the same script as each file it applies. It is not in the block below because no migration creates it: the runner does, on first use.

```sql
CREATE TABLE users (
  email         TEXT PRIMARY KEY,          -- from Access JWT, lowercased
  display_name  TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  week_start    INTEGER NOT NULL DEFAULT 1,-- 0 Sunday, 1 Monday. Presentation only (0003)
  lang          TEXT NOT NULL DEFAULT 'en' -- en | th (0007)
);

CREATE TABLE leave_types (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,      -- annual | sick | medical | personal
  label_th      TEXT NOT NULL,
  label_en      TEXT NOT NULL,
  color         TEXT NOT NULL,             -- calendar chip colour
  default_days  REAL NOT NULL,             -- seeds new quota rows only
  counts_quota  INTEGER NOT NULL DEFAULT 1,-- planned medical is 0
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1 -- 0 = retired: not bookable, history kept (0011)
);

CREATE TABLE quotas (
  user_email    TEXT NOT NULL,
  year          INTEGER NOT NULL,
  leave_type_id INTEGER NOT NULL,
  days_allotted REAL NOT NULL,
  PRIMARY KEY (user_email, year, leave_type_id)
);

CREATE TABLE leave_requests (
  id            TEXT PRIMARY KEY,          -- crypto.randomUUID()
  user_email    TEXT NOT NULL,
  leave_type_id INTEGER NOT NULL,
  start_date    TEXT NOT NULL,             -- YYYY-MM-DD
  end_date      TEXT NOT NULL,             -- inclusive
  start_half    TEXT NOT NULL,             -- full | am | pm
  end_half      TEXT NOT NULL,
  days_total    REAL NOT NULL,             -- computed server-side, never trusted from client
  note          TEXT,
  note_private  INTEGER NOT NULL DEFAULT 1,-- 1 = booker and admins only (0005)
  status        TEXT NOT NULL,             -- confirmed | cancelled
  created_at    TEXT NOT NULL,
  cancelled_at  TEXT
);
CREATE INDEX idx_leave_range ON leave_requests (start_date, end_date);
CREATE INDEX idx_leave_user  ON leave_requests (user_email, start_date);

-- Who changed what, and to whose booking (0006).
CREATE TABLE leave_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_id      TEXT NOT NULL,
  actor_email   TEXT NOT NULL,
  subject_email TEXT NOT NULL,
  action        TEXT NOT NULL,             -- created | edited | cancelled | restored
  at            TEXT NOT NULL,
  before        TEXT,                      -- JSON snapshot; records whether a note
  after         TEXT                       -- existed, never the note itself
);
CREATE INDEX idx_audit_at    ON leave_audit (at DESC);
CREATE INDEX idx_audit_leave ON leave_audit (leave_id);

CREATE TABLE holidays (
  date   TEXT PRIMARY KEY,                 -- YYYY-MM-DD
  label  TEXT NOT NULL
);

-- One row per browser, not per person (0004).
CREATE TABLE push_subscriptions (
  endpoint    TEXT PRIMARY KEY,            -- issued by the browser's push service
  user_email  TEXT NOT NULL,
  p256dh      TEXT NOT NULL,               -- the browser's public key, base64url
  auth        TEXT NOT NULL,               -- shared secret for the encryption
  created_at  TEXT NOT NULL,
  last_seen   TEXT
);
CREATE INDEX idx_push_user ON push_subscriptions (user_email);

-- Keyed per date, kind and channel, so no post can suppress another (0004, 0008).
CREATE TABLE notification_runs (
  date     TEXT NOT NULL,
  kind     TEXT NOT NULL,                  -- daily | week
  channel  TEXT NOT NULL,                  -- line | push
  sent_at  TEXT NOT NULL,
  people   INTEGER NOT NULL,
  status   TEXT NOT NULL,                  -- pending | sent | failed
  error    TEXT,
  PRIMARY KEY (date, kind, channel)
);

CREATE TABLE app_config (                  -- LINE group id, captured via webhook
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Two notes on things that used to be documented here and were not true. There is no `line_user_id` column — @-mentioning people in the LINE post was never built. And `idx_leave_range` is a plain index, not a partial one on `status = 'confirmed'`; the status filter lives in the query.

`days_total` is always recomputed on the server from `start_date`/`end_date`/halves minus weekends minus `holidays`. Client-submitted totals are ignored.

Leave is charged to the year its **start date** falls in. `usedByType` and the booking check agree on that, and a booking spanning New Year draws entirely from its first year. Quota rows exist only for years someone has signed in during, so `allottedFor` falls back to the type's `default_days` where a row is missing; an explicit row, including a deliberate 0, always wins. An edit credits the booking's own days back only when it already starts in the year being checked — otherwise a booking moved across New Year would be measured against a balance inflated by its own size (ISSUES.md #36).

Self-serve model (owner's decision): a POST creates a `confirmed` row directly. No approver, no pending state. Overlap with an existing confirmed request for the same user is rejected.

## Routes

**Where they live.** `src/index.tsx` is the entry point and only that: the security headers, the flash cookie, `/health` and the LINE webhook (both above auth), authentication, the cross-origin guard, the error handlers and the cron. Every other route is in `src/routes/` — `calendar`, `api`, `leave`, `me`, `push`, `admin` — each its own Hono app, mounted at `/` in that order, so the middleware above runs first for all of them and their errors reach the one handler. What more than one area needs is in `src/server/`: `common.tsx` (the context types, `userOf`, `say`, `page`, `errorPage`, the safe-path and referrer checks, person keys, owner notices) and `flash.ts` (the flash cookie). Until 2026-10-21 this was one file of 2,400 lines.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Above the app's auth, still behind Access. Version, deploy time, D1 ping, Bangkok date, `accessConfigured`, `devAuthBypass`. 503 when D1 is unreachable. |
| POST | `/line/webhook` | Above auth. Verifies `X-Line-Signature` (HMAC-SHA256 of the raw body); only writes the group id. |
| GET | `/` | Calendar. A month grid at every width — bars with names on a laptop, dots on a phone — and a day panel: the chosen day's card, then the Upcoming list. Month/year jump. |
| GET | `/book?date=` | Booking page, prefilled. The no-JS destination for a day cell. |
| GET | `/docs` | API reference, Swagger UI over `/openapi.json` — the committed JSON copy of `public/openapi.yaml`, because the zone refuses `*.yaml` at the edge. "Try it out" targets the page's own origin. A Worker route rather than an asset, so it carries the CSP. |
| GET | `/api/v1/leave/by-date?from=&to=` | The same leave grouped by date: one entry per date, each listing who is away and which part of the day (`full_day`/`morning`/`afternoon`). **Carries email addresses** — a deliberate exception, see below. Max 366 days. |
| GET | `/api/v1/holidays?from=&to=` | Public holidays in a range. About nobody, so any signed-in caller or named service token. |
| GET | `/api/v1/balances?year=&user=` | Entitlement, taken and remaining per person per type. Admins and service tokens only. |
| GET | `/api/v1/leave?from=&to=&user=` | JSON feed, active users only. No email addresses in the response; notes filtered per viewer. `user` takes an address as *input* to narrow the feed to one person — the rows `/u/:email` renders as a page. |
| GET | `/api/v1/leave/preview` | Server-side day count, coverage and balance for the form's summary — and so what holds the form's button: a refused count, or a balance that would go below zero, disables it with the reason beside it (`aria-describedby`), until the form is one the save would take. The coverage line is amber on a busy day, never red: red is kept for refusals. The balance: `balance` is what the booking leaves of its type's allowance in the year it starts — the owner's when an admin edits someone else's, with the booking's own days credited back when it is that type in that year, the rule the save applies. `for` (admins, new bookings) makes it the balance and coverage of the person being booked for. |
| POST | `/api/v1/leave` | Book. Server computes days, checks overlap and the start year's balance. A refusal carries the submission and the offending field back to the form. An admin may send `for` — a person key from the form's "Booking for" field — to book for someone active, checked against that person's allowance and bookings; anyone else sending another key is refused. |
| GET | `/leave/:id/edit` | A booking's page, for its owner or an admin; the no-JS destination for an entry. The booking first — dates, owner, type, a status ("in 12 days", "on leave now", "taken"), days, note, the owner's balance in its start year, who else is away during it (`coverageInRange`, from the owner), and its history from `leave_audit` — then Edit, a `<details>` holding the booking form (open by itself after a refused save), and Remove…, a `<details>` that asks once. Back goes to the page the reader came from (`referrerPath`), unless that was this page or a form it posted to. |
| POST | `/api/v1/leave/:id/edit` | Save an edit, and offer undo. Also the drag-to-move target, which carries `returnTo` and so gets no form prefill. |
| POST | `/api/v1/leave/:id/cancel` | Soft cancel, idempotent. Offers undo. |
| POST | `/api/v1/leave/:id/undo` | Undo the last cancel or edit within ten minutes, after re-running the booking rules. |
| GET | `/me?y=&list=` | Next leave (under way, tomorrow, or in N days) with a Book button to `/book`; balances, an overdrawn one in the error colour as days over; one list switched between Upcoming — every confirmed booking from today on, any year, soonest first (`listUpcomingFor`) — and Earlier in the year, with cancelled ones folded under a `<details>`; days off by month (`monthlyDays`: each day in the month it falls in, so leave over New Year splits across the years while the balance charges it to the year it starts in). Each row links to the booking's page, where it is edited or removed. Year navigation. |
| GET | `/u/:email` | One person's leave. Schedule shared; balances to them and admins; notes never. |
| GET · POST | `/me/settings` | Display name, Monday or Sunday first, English or Thai — one form, one Save. All three are checked before any is written; the confirmation comes back in the language just chosen. Replaced `/me/name`, `/me/week-start` and `/me/lang`. |
| POST | `/api/v1/push/subscribe` · `/api/v1/push/unsubscribe` | This browser's subscription. Unsubscribe is scoped to its owner. |
| POST | `/api/v1/push/test` | Push to the caller's own browsers. |
| GET | `/admin` | Overview, admin only like everything under it: the holiday reminder, four figures (away today, people with notifications on, the last 09:00 digest, changes in seven days) and a tile per section. An old `/admin?audit_…` link is sent on to `/admin/activity`. |
| GET | `/admin/people?y=` | The roster for a year, read-only: one row per person, one column per offered type, through `allottedFor` so an unset year shows what the booking check enforces. The bell is a count of browsers, never an endpoint. |
| GET · POST | `/admin/people/:email?y=` | One person's role, status and every allowance, in one form with one Save. Every allowance is validated before anything is written; the last-admin guard refuses the whole save. Replaced `POST /admin/user` and `POST /admin/quotas`, whose two Save buttons per person each discarded what was typed in the other. |
| GET | `/admin/types` · `/admin/holidays?y=` · `/admin/notifications` · `/admin/export` · `/admin/activity` | One page per section. Types read as a line each, the form behind a `<details>`; holidays a year at a time with weekdays; notifications both channels side by side with the preview and send; the export form; the change history. |
| GET | `/admin/export.csv` | `from`, `to` (≤ 366 days apart, defaulting to this year) and `kind` = `summary` or `bookings`. Counted by `daysWithin` in `src/domain/report.ts`: a booking crossing the range's edge is cut there and recounted, halves only where the booking's own half falls inside. Deactivated people are included (`listLeaveInRange`'s `includeInactive`); notes are not. CSV with a UTF-8 BOM, for Excel and Thai, every cell quoted, and a leading `= + - @` defused with an apostrophe, since display names are typed by employees. `Cache-Control: private, no-store`. |
| POST | `/admin/quotas/bulk` | One leave type's allowance for every active user. |
| POST | `/admin/holiday` · `/admin/holiday/delete` · `/admin/holidays/import` | Add, remove, or paste a year's list — all-or-nothing. |
| POST | `/admin/holidays/preview` | The import's middle step, writing nothing: each line as new, renamed or already held; parse errors by line number, with the list handed back to fix; and the bookings already made across a new working-day holiday, which were charged for it (`importPlan`). Its confirm button posts the same text to `/admin/holidays/import`, with `recount=1` unless the admin unticks it: the import then recounts those bookings through `updateLeave`, the path an edit takes, so each recount is an audited edit by the admin. Only ever fewer days, so no balance check can refuse one; a booking left with no working day is left alone. |
| POST | `/admin/type` · `/admin/type/delete` | Add or edit a leave type, including retiring it; delete only one nobody has ever booked. The code is fixed once added — it is the feed's `type`. |
| POST | `/admin/notify/preview` · `/admin/notify/send` | Dry-run and manual send, through the real digest job. |
| GET | `/admin/year-end?y=` | Unused leave: each active person's annual allowance, what is booked to start in the year (taken or ahead) and what is left, most left first (`unusedLeave` in `src/domain/report.ts`); with notifications on or off, and this year's reminder — due, sent, empty or failed. |
| POST | `/admin/year-end/remind` | Send this year's reminder now instead of in November. Still once a year: it takes the same claim the cron would. |

## The 09:00 notification

`scheduled()` handler, cron `0 2 * * 1-5` — 02:00 UTC, which is 09:00 in Bangkok on the same calendar day. Cron's day-of-week field is evaluated in UTC, so `1-5` only lines up with the Bangkok week because of that; move the hour past 17:00 UTC and the weekdays silently shift.

1. Compute today in Asia/Bangkok.
2. Weekend → `skipped_weekend`; a date in `holidays` → `skipped_holiday`. Nothing is written. The cron already excludes weekends; this check stays the authority, since only it knows about holidays.
3. Query confirmed leave overlapping today, for active users.
4. Nobody on leave → `skipped_empty`, nothing written. Neither channel ever says "nobody is out today".
5. Per channel, `INSERT OR IGNORE` into `notification_runs` **first**, keyed on (date, kind, channel). If the row already exists, that channel stops. Cron retries and manual re-runs must not double-post, and the daily and week-ahead posts must not suppress each other.
6. **Push:** encrypt and send to every subscription; a 404 or 410 deletes it. **LINE:** only when `LINE_ENABLED` is `"1"` — otherwise the channel reports `disabled` before touching any config — then `POST https://api.line.me/v2/bot/message/push` with an `X-Line-Retry-Key`, LINE's own idempotency header.
7. Update each log row with its outcome.

The claim in step 5 happens **before** the push, so a crash mid-send fails closed with no message rather than open with two. A send that fails stays logged as `failed` and needs an explicit force to retry, so a flapping error cannot spam the group.

Message: **plain text**, one line per person — name, leave type, half-day marker, and the span for multi-day leave. Not a Flex bubble: a Flex payload is a second thing that can be rejected for schema reasons at 09:00 with nobody watching, and it costs the same under LINE's per-member billing.

The browser notification's **title** is the message on its own: `วันนี้ Mai, Nok ลา`, three names and then a count (`และอีก 3 คน`). Thai only, unlike the bilingual body, because a lock screen gives a title one line and pairing each name list with a translation would push the names out of view. The Monday week-ahead push keeps `Away this week · N people` — `วันนี้` means today, and that post is not about today.

## Secrets / bindings

| Name | Kind | Notes |
| --- | --- | --- |
| `DB` | D1 binding | |
| `ASSETS` | assets binding | `./public` |
| `CF_VERSION_METADATA` | version metadata | footer + `/health`, same as a sibling Workers project |
| `ACCESS_TEAM_DOMAIN` | var | e.g. `acme.cloudflareaccess.com` |
| `ACCESS_AUD` | var | Access application AUD tag |
| `SERVICE_TOKENS` | var | Access service tokens allowed to read the four feeds, comma-separated by name. Empty = no machine callers |
| `LINE_CHANNEL_ACCESS_TOKEN` | secret | `wrangler secret put` |
| `LINE_CHANNEL_SECRET` | secret | webhook signature verification |
| `LINE_GROUP_ID` | var or app_config | normally captured by the webhook |
| `LINE_ENABLED` | var | `"1"` turns the LINE channel on; anything else, including absent, leaves it off |
| `VAPID_PUBLIC_KEY` | var | not a secret — every subscribing browser is given it; empty keeps push off |
| `VAPID_PRIVATE_KEY` | secret | `wrangler secret put`; push stays off without it |
| `VAPID_SUBJECT` | var | a contact address push services can reach, e.g. `mailto:ops@example.com` |
| `DEV_AUTH_BYPASS` / `DEV_EMAIL` | var | local development only — `"1"` skips Access verification and signs in as `DEV_EMAIL`, and only for a caller on this machine: `CF-Connecting-IP` must be loopback. In production the edge sets that header to the visitor's address, so the bypass left on still signs nobody in. Not by hostname — `wrangler dev` rewrites the URL to the configured route. |

The Bangkok offset is a constant in `src/domain/dates.ts`, not a binding — Thailand has never observed DST, so there is nothing to configure.

## Frontend

### Design system — Material 3

The UI follows Material Design 3. Colour is the part that matters most, because M3's rules are what keep it coherent:

- Every surface and every piece of text on it is a **named role** (`--md-surface-container`, `--md-on-surface-variant`, `--md-primary-container`, …), never a raw hex outside the token block. A component says what it *is*; the theme decides what that looks like.
- The roles are derived from six **tonal palettes** — primary, secondary, tertiary, error, neutral, neutral-variant — sampled at fixed tones. `scripts/palette.mjs` generates them and prints the CSS. It works in OKLCh rather than Google's HCT (no dependency, and perceptually uniform either way), converting M3's L\* tones through luminance, since OKLab's L is a different scale — read tone 6 as OKLab 0.06 and a dark surface comes out nearly black.
- The same script **checks every pair the stylesheet actually paints** against WCAG AA and exits non-zero if one fails. Contrast is measured, not eyeballed. Re-run it after touching a token: `node scripts/palette.mjs`.

The rest of the system:

| Piece | Where |
| --- | --- |
| Shape scale (4/8/12/16/28/full), elevation levels 1–3, motion easing and durations | tokens in `public/app.css` |
| State layers — the translucent overlay every M3 control shows on hover, focus and press | `.state-layer` / per-component `::before`, at `z-index: -1` under `isolation: isolate` so it sits behind the label without a wrapper element |
| Touch ripple | `src/client/ripple.ts`, delegated from `document`; decoration only, and skipped under `prefers-reduced-motion` |
| Filled text fields with floating labels | `src/views/fields.tsx` + `.tf*` rules |
| Icons | `src/views/icons.tsx` — drawn by hand on the 24px grid rather than pulling Material Symbols, which would mean a request to `fonts.googleapis.com` on every page for eight glyphs |
| App mark | `src/views/logo.ts` — a calendar page with a palm, on the primary blue. One description of shapes, read by everything: the header and the browser-tab icon render it as inline SVG, and `npm run icons` rasterises the same shapes into the home-screen PNGs, a 32px tab-icon fallback and the notification badge (the page as a white silhouette with the palm cut out, since Android draws badges from alpha alone). The rasteriser is in the script, with no image library, so paths stay to absolute M, C and Z. Replaced, on 2026-10-19, a 🌴 emoji that every OS drew differently and a home-screen calendar that matched nothing else. |

Two deliberate deviations. `<input type="date">` and `<select>` never match `:placeholder-shown` — they always display something — so their labels are pinned up (`tf-fixed`) instead of flickering. And the month grid keeps `<table>` semantics rather than taking `role="grid"`: an ARIA grid promises an arrow-key navigation model, and announcing one without it is worse than saying nothing.

### Theme

Three states: **System** (default), **Light**, **Dark**, cycled by a button in the top bar and remembered in `localStorage` under `wnl-theme`.

- System stamps nothing on `<html>`, so `prefers-color-scheme` decides.
- An explicit choice stamps `data-theme="light"` or `data-theme="dark"`.
- The dark media query is guarded with `:root:not([data-theme="light"])`, so choosing Light on a dark-mode OS actually stays light. Without that guard the override only works in one direction.
- `color-scheme` is set alongside the tokens, so native date pickers, selects, and scrollbars follow the chosen theme rather than the OS.

The switching logic is **inlined into `<head>`** (`THEME_SCRIPT` in `views/layout.tsx`), not shipped in `booking.js`. A stored choice has to be applied before the first paint; a deferred or external script renders the system theme first and then flips. The same script stamps `data-js="1"`, which is what reveals the toggle — the control is useless without scripting, so it stays hidden when there is none.

Dark tokens are duplicated between the media query and the `[data-theme="dark"]` block. Custom properties cannot be composed, and the alternative — a class applied by JS — reintroduces the flash.

### Calendar interaction

Click a day to see it in the day panel; click its **+**, or the panel's "Book this day", to book it; click an entry to open it. All of them are **links first**:

- a day cell is covered by `<a class="cell-day" href="#d-…">` (or `/book?date=…` for an empty day), which the script turns into "select this day"; under it `.cell-add`, the same link to `/book`, stays for drag-to-move and is out of the tab order
- each day of the month has a `.cell-plus`, `<a href="/book?date=…">`, shown on hover and focus, and always on the chosen day — so a tablet, which cannot hover, chooses the day and then books it. Shown on every day at once, the first version was a grid of thirty circles on a device without hover; the Linux screenshot in CI caught it
- an entry is an `<a href="/leave/:id/edit">` sitting above those, so a click on an entry opens the entry

Until 2026-10-20 a click on a laptop's empty day booked it, and a phone's tap selected it. Both select now, so the two read the same way and the panel answers "who is out that day" without a dialog.

`src/client/calendar.ts` intercepts those clicks and opens a `<dialog>` instead, so the user never loses their place in the month. With scripting off, the same clicks navigate and everything still works. Modifier- and middle-clicks are deliberately not intercepted, so "open in new tab" behaves like any other link.

The detail popup is built from `data-*` attributes on the clicked element rather than a fetch — opening it costs no request. Those attributes carry only what the grid already displays; values are written with `textContent`, never parsed as markup.

Native `<dialog>` + `showModal()` is used for focus trapping and Escape-to-close rather than reimplementing them.

Only one booking form exists per page — inside the create dialog on the calendar, inside Edit on a booking's page — two would collide on element ids. Editing, the summary says what changes ("4 days → 3 days", "Annual: 6 left → 7 after this") — `remaining` is what is left now, the booking included, and `after` counts its days back before charging the new ones.

**Coverage is the owner's.** The who-else-is-away count is worked out from the booking's owner, not from whoever is looking: an admin editing someone else's booking had seen it counted from the admin — their own days left out, the owner among "someone else" — and told "with you". The preview now names the owner (`coverage.with`), and the line reads "with Ploy". `coverageInRange` also counts a person once per day however many bookings they hold on it; a morning and an afternoon booked separately had been listed, and counted, twice.

**The booking form** (`src/views/booking.tsx`) has two shapes, "One day" and "Several days", switched by radios named `mode`, with `:has()` showing the chosen shape's fields, so the switch works without script. One day is a date and a part of it (`dayPart`: full, morning, afternoon); several days are two dates, the first "all day" or "from noon", the last "all day" or "until noon" — `startHalf` and `endHalf` as before, now saying what a half means at each end. The hidden shape's fields still submit, so `parseBooking` reads `mode`: for one day it ignores the end date and both halves and takes `dayPart` for both; without `mode` — the API, drag-to-move — the fields mean what they always did. Leave types are radio chips in their calendar colours. The note sits behind "Add a note". Above the button, the script fills a summary from `/api/v1/leave/preview` — the days, the balance before and after ("Annual: 7 left → 6 after this", "none left" or "not enough" in the error colour), and who else is away by name, "with you, 2 of 12" — and the button says "Book 1 day". It replaced a form whose "Start half" said nothing about halves, whose end-half field appeared on a second date, and whose day count and "2 of 12 away …: Parkpoom P." (counting the booker, naming only the other) arrived after the button.

**Bars, not chips** (from 768px). A booking is one bar across the days it covers in each week (`weekLanes` in `src/domain/leave.ts`, unit-tested): pieces are cut at week boundaries, and since 2026-10-20 at weekends and holidays inside the booking too, each cut flagged so the bar loses its rounded end on that side, and stacked into the fewest rows that keep two pieces sharing a day apart, longer pieces on top so a long absence stays a straight line. Cells clip their content, so the bars cannot live in them: each week's bars sit in one positioned layer (`.week-bars`) inside the week's first cell — a table row can hold nothing but cells — laid out as a seven-column grid with the table's own spacing, which puts every column exactly on a day. The layer ignores the pointer except on the bars themselves, so clicks between bars still book that day. Because the layer no longer makes a row grow, every cell carries an invisible spacer sized to the week's rows. Three rows show; each day counts the rest as "+N more". Drag-to-move finds the day under the pointer through the layer (`elementsFromPoint` down to the cell's `.cell-add`), so a bar grabbed by its Thursday moves by the distance dragged, not from its first day. Bars and chips are links, so `drag.ts` refuses the browser's own link drag (`dragstart`); left alone it cancels the pointer stream a few pixels in and the move never lands (ISSUES #45). On a phone the layer is hidden and each cell shows its dots, as before.

The trade-off: a screen reader meets a week's bars inside its first day cell. Each bar's label therefore carries the whole range ("Parkpoom P — Annual, 19 – 30 Oct"), not one day.

**Who is who.** The stripe and tint still mean the leave type; a badge with the person's initials says whose (`src/views/person.ts`). Colours are handed out in sign-up order — every user row, deactivated included, since rows are never deleted — so nobody shares one until there are more than nine people, and nobody's changes when someone joins. A hash of the email was tried first and put three of eight people on one colour. All nine carry white at WCAG AA in both themes and avoid the leave types' colours; `scripts/palette.mjs` checks both.

**Bars show "First L."** — "Chatchai W." rather than a surname cut off by an ellipsis in every cell. The tooltip, the bar's label, the popup and the Upcoming list keep the full name.

**Following one person.** Pointing at any of someone's bars, Upcoming rows or "+N more" rows lights all of them and dims everyone else (`src/client/calendar.ts`); keyboard focus does the same. They are matched on `data-who`, an opaque key per person (`personKeys`) — the page can tell two entries belong to one person without carrying the address, which the calendar keeps out of its HTML. The key is HMAC-SHA256 of the address under a random salt kept in `app_config` (`personKeySalt`, made on first use), cut to 16 hex characters. It replaced an unsalted 32-bit FNV hash, which anyone with a list of likely addresses could recompute and so map back. Only on devices that can hover.

**Past days fade** — a washed-out ground and a quieter date, not opacity on the cell, which would also fade the week's bars living in its first cell. A bar fades on its own, and only once it has finished entirely: one still running today is not in the past, only its start is. Fading is a cue, not a lock — leave can be booked into the past, and sick leave usually is.

**Holidays** are hatched, not tinted: the tertiary teal they used sat beside planned medical's green and read as the same thing. Leave types own colour; a holiday owns a texture.

**"+N more"** opens a native popover (`popovertarget`), not a script-built dialog: no JavaScript is needed to open or dismiss it, the browser handles Escape, click-outside and returning focus, and the top layer means the cell's clipping cannot cut it off. Its rows carry the same `data-entry` attributes as chips, so a click opens the same detail popup — but they are not `.chip`, which drag-to-move would otherwise pick up.

### Shared parts

`src/views/parts.tsx` holds what every page does the same way, so a new page reuses it rather than inventing its own. A review on 2026-10-21 found six ways back, two orders of Save and Cancel, "3d" beside "3 days", and one delete that asked first beside one that did not:

- **`BackLink`** — the way back from a page under another, above its heading, naming where it goes: "‹ My leave", "‹ Calendar", "‹ People". A booking's page names wherever the reader came from (`backLabel`), and says "Back" only for a page without a name.
- **`FormActions`** — Cancel first, the button that commits last, at the right-hand edge.
- **`DayCount`** — "3 days", "0.5 days", "3 วัน"; never "3d", which Thai readers would see in Latin. The Activity trail says "4 days → 5 days" too.
- **`AskOnceDelete`** — a bin that opens a one-line confirmation beside it; only that button posts. Removing a holiday and deleting a leave type use it, as Remove… on a booking does: a holiday removed by accident changes what everyone's bookings cost.
- **`BalanceCard`** and **`LeaveRow`** — the same balance cards and booking rows on My leave and a person's page. There, rows open the booking only for its owner or an admin, and never show a note.

Errors are pages inside the app for anyone signed in — the bars, the reader's language, and "Go to the calendar" (`errorPage` in `src/server/common.tsx`). Only "not signed in" and "account inactive", which have nobody to show the app to, are bare.

### Layout

One `public/app.css`, mobile-first, single breakpoint at 768px. The month grid renders at every width: coloured chips with names above it, dots below it with the whole cell as one tap target (a 7×5 grid of names is unreadable on a phone). Beside the month on a laptop, and under it on a phone, is the day panel: one day's card — today to begin with, or the month's first busy day when browsing another month — and choosing a day swaps the card in place (`client/calendar.ts`, `.day-mode`), so the grid never scrolls away and reading the 20th no longer means scrolling past the 1st to the 19th. A day with people away is the lit card (primary container); a quiet one steps back. The card carries its own "Book this day". Each row says how long that absence runs ("Annual · 18–21 Oct"). The server renders a row for every day of the month and marks the one to open on; with scripting off the list is the month's busy days as before, empty rows hidden, and an empty cell's link books that day. A sideways swipe on the grid follows the prev/next month links, and one on the day card steps a day, carrying into the next or previous month off either end (touch screens only, one `onSwipe` helper for both; it has to be mostly horizontal, 60px or more, and under 600ms, so a tap or a drifting scroll is never taken for one). The per-day views — the phone's dots, the day card, the day list and `/api/v1/leave/by-date` — list someone only on the days they are actually off: `byDate` leaves weekends and holidays inside a booking out, so a Friday-to-Monday booking shows on Friday and Monday; the desktop bars break the same way (`weekLanes`). A phone cell with more than three people away (`PHONE_DOTS`) shows the number in a small pill instead of a wrapping cluster of dots. Above the grid on a phone, the notification invitation and an admin's holiday reminder are compact strips clamped to two lines with their buttons alongside, so with both up the day card still starts on an 812px screen — `test-browser.mjs` measures it. The phone's floating Book button is round from the start and steps aside while the day card is on screen (an `IntersectionObserver` on the card): as an extended FAB it sat on the card's rows until the page was scrolled. It keeps its accessible name. When a tap or swipe changes the day, a visually hidden polite live region (`[data-day-status]`) says the day and who is away, once; each row carries its full date in `data-label` for it. Making the whole list live instead would read every row. The booking form is a `<form>` that works without JS; JS only adds the live day-count preview and the half-day field toggling.

The Upcoming list — 90 days from today, grouped by day under sticky headings, with a caption saying it is anchored to today rather than the month on screen — sits in the day panel under the card: in the sidebar once the window is at least 1024×700, stacked under the grid otherwise. It never repeats the card: while the card shows today, Upcoming's Today group is hidden (`:has()` on the panel), at every width. On a phone it folds to its first four days with a **Show all upcoming** button (`calendar.ts`; without the script every row shows), and a one-line key of dots and type names sits under the grid, since the grid's dots carry colour and nothing else. Until 2026-10-22 the phone hid Upcoming whenever the chosen day had anyone away, which left a phone with no "who is out next" at all on a busy day, and had no key. It replaced the phone's who-summary card ("Out today" / "Next 7 days") on 2026-10-19, which said the same thing in a worse shape. The prev/next month buttons sit ahead of the month name, so their position does not depend on how long the name is. Below 768px the heading shows the short month ("Sep 2026", "ก.ย. 2026"): the long form is sent as well and CSS picks one, since "September 2026" beside three icon buttons and Today does not fit a 375px screen. It fits down to 360px.

Navigation changes shape at the same breakpoint, following M3's own guidance rather than shrinking one control:

- **Phone** — an M3 navigation bar fixed to the bottom, with the active destination marked by a filled pill behind its icon, and an **extended FAB** for "Book leave" in the bottom-right, where a thumb reaches. `body` reserves room for both so the last row of a list can still scroll clear.
- **Desktop** — the same destinations as primary tabs in the top app bar, marked by an indicator under the label, and Book leave in the month's header beside Today. The FAB is hidden; every day also has its own +.

On a laptop the month fits the window: the admin's holiday reminder is a chip in the header rather than a strip above it, the "Click any day…" hint row is gone, and the legend sits under the grid — together about 120px, which is what pushed the last week of a 1,366×800 screen into an inner scroll. Rows still size to their bars rather than being equal: equal rows sized to the busiest week overflow the window, and fitting won. Holiday names get two lines in the cell instead of one cut short. From 768px the weekend columns are narrower — 10% each against 16% for a weekday, set on `<col>` elements — because they rarely hold anyone and the width is worth more to weekday names; the bars' own grid (`.week-bars`), positioned in each week's first cell, is given the same proportions and sized from that cell (`.weekend-first` when the week opens on Sunday). Which columns are the weekend is worked out from the week start, not from the column label, which had never matched in Thai.

Both are rendered on every page and chosen by CSS, so there is no JS in the navigation.

### Admin area

An overview and seven section pages (`src/views/admin/`, a file per section and `shell.tsx` for the tabs and frame they share), replacing one page that had grown to 6,000px on a laptop and 10,000 on a phone with 242 controls and two forms per person. The overview is for "is anything wrong": the holiday reminder, four figures, a tile per section with a one-line state. Each section page carries a row of chips — the way back to the overview and across to the others — that scrolls sideways on a phone instead of wrapping. Everything is still a plain form or link, and every section has its own URL, so a flash from a POST lands on the page the form was on. On a phone the People table stays a table: the type headings wrap, the email and the pencil drop out (the name is the same link), and it fits 375px with four types.

### Booking for someone

An admin's booking form opens with **Booking for**: themselves first, then everyone active. Someone off sick phones in, and the admin books it for them. The booking is the other person's in every respect — their allowance, their other bookings for the overlap check, their coverage in the summary ("with Ploy") — and the audit trail records the admin as the actor, so the booking's history reads "Pim → Ploy's booking". A note under the field, shown only once someone else is chosen, says it counts against their allowance and that they are told.

The options are person keys, not addresses: the calendar, where the dialog lives, keeps addresses out of its HTML (see *Following one person*). The server maps a key back by keying every active user, and refuses a key that names nobody, or more than one. Only the create form has the field — a booking's owner never changes.

**The owner is told** (`src/notify/owner.ts`). When anyone other than the owner books, edits, removes or restores a booking — through the form, a drag, or undo — the owner's browsers get a push in the owner's language: "Pim changed your leave", "Annual · 3 Nov – 6 Nov". It is tagged per booking, so a second change replaces the first on the lock screen. It is sent with `waitUntil`, after the response, and is best effort: no subscription, no keys or a refusing push service are silent, and the change is already saved. The booking's page says the same thing to the owner for as long as it is true — "Pim booked this for you" or "Last changed by Pim", from the latest audit row — for the owner who has notifications off, and so does each row of My leave ("Booked for you by Pim", "Changed by Pim", "Removed by Pim"; `changedByOthers`, one query for all of them).

## Response headers

Every response the Worker returns carries `nosniff`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: same-origin`; HTML additionally carries a Content-Security-Policy and `Cache-Control: private, no-store`.

Two choices worth knowing:

- **`same-origin`, not `no-referrer`.** The app reads its own `Referer` to send someone back to the month they booked from. Under `no-referrer` that header is absent and the feature silently degrades ([ISSUES.md](ISSUES.md) #28). The path taken from it is checked against the origin and through `safePath`, because a URL pathname can begin `//` and become a protocol-relative redirect off the site (#27).
- **CSP is strict about scripts, permissive about styles.** `script-src 'self' 'sha256-…'` — the hash is of the inline theme switcher, which must run before first paint. Styles need `'unsafe-inline'` because leave-type colours are rendered as `style="--chip: …"` on hundreds of elements. Script execution is what turns an escaping mistake into an account takeover; an inline style is not.

`Strict-Transport-Security` is deliberately absent: it belongs to the zone, not the Worker (#13).

**Static files carry the build.** Pages link `/app.css?v=…` and `/app.js?v=…`, the first eight characters of the deployment id (`asset()` in `src/views/layout.tsx`), so a deploy changes their addresses and a page can never pick up a script or stylesheet from another build — a page restored from the back-forward cache, say, or one loaded while a deploy rolls out. The assets themselves are still served with `max-age=0, must-revalidate`; the query string changes which file is asked for, not how long it is kept. Plain paths when the build is unknown, as in local development.

## Language

Two languages, English and Thai, chosen per person on `/me/settings` and stored in D1 — like the week start, and for the same reason: pages are rendered on the server, so the preference has to reach the Worker, and per person it follows someone between their laptop and their phone.

- **Strings** live in `src/i18n/strings.ts`, both languages on one line per key, so a stale translation is visible while editing rather than hiding in a second file.
- **Components** read the reader's language from a Hono JSX context provided by `Layout`, instead of threading a prop through every component. Rendering is synchronous, so the provider reaches everything below it within one render and nothing is shared between requests.
- **Pure functions never see a language.** `validateBooking` and `countLeaveDays` return a `Message` — a key plus its numbers — and the route renders it at the edge, where the reader is known. Tests assert on the key, so rewording a message cannot turn a test red.
- **Client-rendered text** (the day count, the coverage line, the notification card's states) is handed to the browser as data attributes on the element that needs it. The catalogue stays out of the bundle; esbuild drops it, and the browser is never sent strings in a language nobody asked for.

What stays as it is, and why, is in [ISSUES.md](ISSUES.md) #25.

## Notifications

Two channels, one job. `runDigest` decides *whether* to notify once — skipping weekends, public holidays, and days with nobody out — builds the text once, then fans out. An admin's preview runs the same function in dry-run mode, so what they see is produced by the code that sends.

Two kinds of post, too: the daily "out today" digest, and a week-ahead summary on Monday mornings. They claim separate rows in `notification_runs` — keyed on `(date, kind, channel)` — because a Monday carries both, and a shared key would let whichever ran first suppress the other.

**The year-end reminder** (`src/notify/yearend.ts`) is a third kind, push only and personal: in November, everyone with annual leave unbooked is told how much, in their own language ("6 days of Annual leave left in 2026"). The app carries nothing over into the next year (PLAN 5.7), so the cheapest fix for days lost in January is saying so while there are weeks left to book them. It runs from the same cron, in its own `try`, and claims `(YYYY-11-01, yearend, push)` — the year's 1 November, not the day it ran — so the first weekday of November sends it and every later run finds it taken. An admin's "Send now instead" on `/admin/year-end` takes the same claim, and is then that year's reminder. When there were people to reach and no browser accepted it — a broken key, a refusing push service — the run is recorded as failed rather than sent, and the page offers "Try again", which takes back only a failed claim. "Unbooked" rather than "untaken": a day booked for December is already spoken for. Only people with notifications on can be reached, and the page shows who they are so an admin can tell the others.

| Channel | Reaches | Cost | Configured by |
| --- | --- | --- | --- |
| LINE | one group chat | billed per member, per push | channel token + group id |
| Browser push | each person who opted in, per browser | free | VAPID keypair |

`notification_runs` is keyed on **(date, kind, channel)**, not date alone. With one row per date, a LINE row would claim the day and silently suppress the push, and one status column could not say "LINE failed but the browsers got it". Each channel claims its own row *before* sending, so a crash fails closed — no message — rather than open, with two.

### Web Push

Implemented directly against RFC 8291 (`aes128gcm` payload encryption) and RFC 8292 (VAPID) in `src/notify/push.ts`, using only WebCrypto. No dependency: every primitive is in the runtime, and the alternative is handing the VAPID private key to an unaudited package. RFC 8291 §5 publishes a complete worked example, so the implementation is asserted against the spec's own bytes rather than against a reading of it.

Three consequences worth knowing:

- **The message travels inside the payload.** A service worker wakes with no page open, and a fetch to an origin behind Access returns a login redirect — so it cannot pull the digest itself. The text is encrypted end to end; the push service forwards bytes it cannot read.
- **Only real push services.** `parseSubscription` accepts an endpoint on FCM, Mozilla's autopush, Apple's or Windows' push service (`isPushService`), not any https URL: a subscription is an address the Worker posts to every morning, and anyone signed in could otherwise point it at their own server.
- **Subscriptions are per browser, not per person.** The endpoint is the primary key. Re-subscribing reassigns ownership to whoever is signed in, which is what makes a shared machine safe after someone signs out.
- **Dead endpoints are pruned on send.** 404 and 410 mean gone for good and the row is deleted; anything else may be transient and is retried tomorrow.

**Asking people.** The bell in the app bar is the switch. The calendar also carries an invitation (`PushNudge` in `views/layout.tsx`), rendered hidden; `client/push.ts` shows it only to a browser whose permission is still `default`, i.e. one that has never been asked. "Turn on" clicks the panel's own button, so there is one path to subscribing. On an iPhone Safari tab it gives the Home Screen step instead. "Not now" is remembered in `localStorage` for 30 days. A browser that is subscribed, turned off, or blocked never sees it.

The service worker (`public/sw.js`) deliberately caches nothing. Every page here is behind Access and rendered per user; a cached page served to the wrong person, or after their access was revoked, is a far worse failure than a page that will not load offline.

## Notes, and who can read them

One rule, in one function: `visibleNote(entry, viewer)` in `domain/leave.ts`. A note is readable by its author, by admins, and by everyone else only if the booker ticked "share".

It is applied at the **boundary**, not in a template — the calendar's `data-*` attributes and the JSON feed both call it, so an unshared note is absent from what reaches another colleague's browser rather than hidden by CSS. The per-person page (`/u/:email`) renders no notes at all, for anyone.

The audit trail records whether a note existed, never its text. A trail that copied notes into a second, admin-readable table would quietly undo the whole feature.

## Audit trail

`leave_audit` records every create, edit and cancel: actor, subject, action, timestamp, and JSON snapshots either side.

The write is batched with the change itself, inside the repo functions that perform it, rather than being left to the routes. Three code paths reach a mutation — the form, the drag-to-move, and an admin editing someone else's booking — and a trail with a hole in it would always be the path someone forgot. `updateLeave` reads the previous row itself rather than trusting a caller to pass it.

Snapshots are JSON rather than mirrored columns so the trail keeps its meaning when `leave_requests` changes shape.

On `/admin/activity` the trail is filtered by person — as actor or as subject, since "what happened around Mai" includes an admin changing her booking — and by action, through a GET form so a filtered view is a link; thirty rows a page, asking for one more than a page to know whether an older one exists rather than counting the table. Unrecognised filter values are dropped, not refused.

**Retention.** After the digest, the same cron run deletes audit rows older than three years and `notification_runs` rows older than 90 days (`AUDIT_KEEP_YEARS`, `NOTIFICATION_KEEP_DAYS` in `src/repo/db.ts`). In its own `try`, so housekeeping can never delay or block a post. Three years covers the year being worked in, the two before it, and any balance that crossed New Year; everything the app can still change — 90 days of backdating, 10 minutes of undo — sits well inside it.

## Errors

Every JSON failure is `{ "error": { "message", "key"?, "vars"? } }`. `message` is a sentence in the reader's language, ready to show; `key` is present when the booking rules named the message, for a program that would rather match than parse prose. There were three shapes before 2026-09-21 — a bare string on the feeds, `{ ok: false, error }` on the push routes, and a bare key from the preview — and a caller had to know which endpoint it was talking to before it could read a failure.

Success bodies are unchanged: the feeds return their data, the push routes `{ ok: true }`.

**Unhandled errors** (`app.onError`) answer in the same shapes — that error body on `/api/…`, an error page elsewhere — instead of Hono's bare "Internal Server Error", and write one JSON line for Workers Logs (`observability` is on in the config): method, the **route pattern**, the error's name and message, five stack frames and the version. The pattern rather than the path, because `/u/:email` would put an address in the log; no query, body or identity either. The smoke suite renames a table under the running server to prove it.

## Versioning

API paths are `/api/v1/…` since 2026-09-21; the unversioned ones were dropped rather than kept as aliases, since every caller was inside this repo. `/health` and `/line/webhook` are deliberately outside the versioned space: one is monitoring, the other a URL configured in someone else's console.

The uploaded API Shield schema names paths exactly, so a path change leaves those operations unvalidated until the schema is regenerated and uploaded again.

## Email addresses in the API

The calendar feed has never carried them: a name and a leave type are what the calendar shows, and an address list is what turns a leave tracker into a staff directory. `/api/v1/leave` still does not, and `user=` there takes an address only as input.

`/api/v1/leave/by-date` is the exception, decided by the owner on 2026-09-21: an integration consuming "who is away today" needs a stable identifier per person, and a display name is neither unique nor stable. The scope of that exception is exactly one endpoint, and it changes who can read addresses — any signed-in colleague, not only admins. Notes are still absent from it entirely.

## Leave types

`active = 0` retires a type (0011). Deleting one that has bookings is not an option: nothing has a foreign key, and `ENTRY_FROM` inner-joins `leave_types`, so its bookings would silently drop out of every query rather than error. A retired type:

- leaves the booking form, the admin quota editor and the bulk-quota picker;
- is refused for a new booking (`error.retiredType`), but stays bookable for the booking that already has it — `keepTypeId` in the booking context — so its dates can be edited, dragged or undone without changing what kind of leave it was;
- keeps its balance card only in a year it was actually used, and its legend entry only on a month where it appears.

Delete is offered only for a type with no bookings in any status, and the `DELETE` repeats that guard itself (the same `NOT EXISTS` as 0010), so a booking made between page load and click cannot be orphaned. The last offered type cannot be retired.

**Undo reads the trail back.** `POST /api/v1/leave/:id/undo` acts on the most recent audit row for that booking, within ten minutes. A cancellation is undone by flipping the status back — the row never left, so its note is intact — and recorded as its own `restored` action. An edit is undone from the `before` snapshot, but the note always comes from the row, because the snapshot deliberately records only `has_note`; rebuilding a booking from the trail alone would have wiped every note it touched. Both re-run the booking rules first, since quota and dates can change between a change and its undo. The route re-authorises through `ownedLeave` and finds the audit row itself — the undo offer rides in a client-held cookie and is trusted for nothing.

## Non-goals (v1)

Approval workflow, carry-over quota, attachments/medical certs, half-hour granularity, per-team filtering, a payroll integration (`/admin/export.csv` is a file an admin downloads; nothing is pushed to a payroll system).
