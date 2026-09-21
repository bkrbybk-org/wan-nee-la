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

### In front of Access

Two zone-level layers run at the edge **before** Access, so they see anonymous traffic too (both verified 2026-09-19):

- **API Shield schema validation.** The seven JSON operations are uploaded as an OpenAPI 3.0.3 schema derived from `public/openapi.yaml` (`npm run openapi:shield`), and a WAF custom rule blocks on `cf.schema_validation.uploaded.violated`. The other 24 routes are not in the schema and are not checked; there is no fallthrough rule, and there must not be one. A change to what one of those seven operations *accepts* needs the schema regenerated and re-uploaded in the same change, or real requests start getting 403s. `npm run shield:probe` checks enforcement from outside.
- **A rule refusing `*.yaml` and `*.yml`.** Which is why `/docs` reads `/openapi.json`, not the YAML (ISSUES #42).

## Data model (D1)

Eleven migrations, applied in order; `0010` removed the unused unpaid leave type and changed data only, and `0011` added `leave_types.active`. This is the schema they produce — checked against a database with all of them applied, not written from memory.

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

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Above the app's auth, still behind Access. Version, deploy time, D1 ping, Bangkok date, `accessConfigured`, `devAuthBypass`. 503 when D1 is unreachable. |
| POST | `/line/webhook` | Above auth. Verifies `X-Line-Signature` (HMAC-SHA256 of the raw body); only writes the group id. |
| GET | `/` | Calendar. A month grid at every width — names on a laptop, dots on a phone with the day list beneath. Upcoming list, month/year jump. |
| GET | `/book?date=` | Booking page, prefilled. The no-JS destination for a day cell. |
| GET | `/docs` | API reference, Swagger UI over `/openapi.json` — the committed JSON copy of `public/openapi.yaml`, because the zone refuses `*.yaml` at the edge. "Try it out" targets the page's own origin. A Worker route rather than an asset, so it carries the CSP. |
| GET | `/api/leave?from=&to=&user=` | JSON feed, active users only. No email addresses in the response; notes filtered per viewer. `user` takes an address as *input* to narrow the feed to one person — the rows `/u/:email` renders as a page. |
| GET | `/api/leave/preview` | Server-side day count and coverage for the form's live preview. |
| POST | `/api/leave` | Book. Server computes days, checks overlap and the start year's balance. A refusal carries the submission and the offending field back to the form. |
| GET | `/leave/:id/edit` | Edit one booking; the no-JS destination for an entry. |
| POST | `/api/leave/:id/edit` | Save an edit, and offer undo. Also the drag-to-move target, which carries `returnTo` and so gets no form prefill. |
| POST | `/api/leave/:id/cancel` | Soft cancel, idempotent. Offers undo. |
| POST | `/api/leave/:id/undo` | Undo the last cancel or edit within ten minutes, after re-running the booking rules. |
| GET | `/me` | Balances, upcoming and past leave, settings, notifications card. Year navigation. |
| GET | `/u/:email` | One person's leave. Schedule shared; balances to them and admins; notes never. |
| POST | `/me/name` · `/me/week-start` · `/me/lang` | Display name; Monday or Sunday first; English or Thai. |
| POST | `/api/push/subscribe` · `/api/push/unsubscribe` | This browser's subscription. Unsubscribe is scoped to its owner. |
| POST | `/api/push/test` | Push to the caller's own browsers. |
| GET | `/admin` | Users, quotas, leave types, holidays, LINE status, run log, audit trail. Admin only. |
| POST | `/admin/quotas` · `/admin/quotas/bulk` | One person, or one leave type for every active user. |
| POST | `/admin/user` | Role and active flag. The last admin cannot demote itself. |
| POST | `/admin/holiday` · `/admin/holiday/delete` · `/admin/holidays/import` | Add, remove, or paste a year's list — all-or-nothing. |
| POST | `/admin/type` · `/admin/type/delete` | Add or edit a leave type, including retiring it; delete only one nobody has ever booked. The code is fixed once added — it is the feed's `type`. |
| POST | `/admin/notify/preview` · `/admin/notify/send` | Dry-run and manual send, through the real digest job. |

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
| `LINE_CHANNEL_ACCESS_TOKEN` | secret | `wrangler secret put` |
| `LINE_CHANNEL_SECRET` | secret | webhook signature verification |
| `LINE_GROUP_ID` | var or app_config | normally captured by the webhook |
| `LINE_ENABLED` | var | `"1"` turns the LINE channel on; anything else, including absent, leaves it off |
| `VAPID_PUBLIC_KEY` | var | not a secret — every subscribing browser is given it; empty keeps push off |
| `VAPID_PRIVATE_KEY` | secret | `wrangler secret put`; push stays off without it |
| `VAPID_SUBJECT` | var | a contact address push services can reach, e.g. `mailto:ops@example.com` |
| `DEV_AUTH_BYPASS` / `DEV_EMAIL` | var | local development only — `"1"` skips Access verification and signs in as `DEV_EMAIL` |

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

Click an empty day to book it; click an entry to open it. Both are **links first**:

- a day cell contains an absolutely-positioned `<a href="/book?date=…">` filling its empty space
- an entry is an `<a href="/leave/:id/edit">` sitting above that overlay, so a click on an entry opens the entry rather than the booking form

`src/client/calendar.ts` intercepts those clicks and opens a `<dialog>` instead, so the user never loses their place in the month. With scripting off, the same clicks navigate and everything still works. Modifier- and middle-clicks are deliberately not intercepted, so "open in new tab" behaves like any other link.

The detail popup is built from `data-*` attributes on the clicked element rather than a fetch — opening it costs no request. Those attributes carry only what the grid already displays; values are written with `textContent`, never parsed as markup.

Native `<dialog>` + `showModal()` is used for focus trapping and Escape-to-close rather than reimplementing them.

Only one booking form exists per page, inside the create dialog — two would collide on element ids.

### Layout

One `public/app.css`, mobile-first, single breakpoint at 768px. The month grid renders at every width: coloured chips with names above it, dots below it with the whole cell as one tap target into the day list underneath (a 7×5 grid of names is unreadable on a phone). The booking form is a `<form>` that works without JS; JS only adds the live day-count preview and the half-day field toggling.

The Upcoming list — 90 days from today, grouped by day under sticky headings, with a caption saying it is anchored to today rather than the month on screen — appears from 768px: in a sidebar once the window is at least 1024×700, stacked under the grid otherwise. Wherever it is visible it replaces the who-summary card, which says the same thing in a worse shape; below 768px there is no list, and the card and the day list answer the question instead. The prev/next month buttons sit ahead of the month name, so their position does not depend on how long the name is.

Navigation changes shape at the same breakpoint, following M3's own guidance rather than shrinking one control:

- **Phone** — an M3 navigation bar fixed to the bottom, with the active destination marked by a filled pill behind its icon, and an **extended FAB** for "Book leave" in the bottom-right, where a thumb reaches. `body` reserves room for both so the last row of a list can still scroll clear.
- **Desktop** — the same destinations as primary tabs in the top app bar, marked by an indicator under the label, and the booking action inline. The FAB is hidden; the month grid already offers a target on every day.

Both are rendered on every page and chosen by CSS, so there is no JS in the navigation.

## Response headers

Every response the Worker returns carries `nosniff`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: same-origin`; HTML additionally carries a Content-Security-Policy and `Cache-Control: private, no-store`.

Two choices worth knowing:

- **`same-origin`, not `no-referrer`.** The app reads its own `Referer` to send someone back to the month they booked from. Under `no-referrer` that header is absent and the feature silently degrades ([ISSUES.md](ISSUES.md) #28). The path taken from it is checked against the origin and through `safePath`, because a URL pathname can begin `//` and become a protocol-relative redirect off the site (#27).
- **CSP is strict about scripts, permissive about styles.** `script-src 'self' 'sha256-…'` — the hash is of the inline theme switcher, which must run before first paint. Styles need `'unsafe-inline'` because leave-type colours are rendered as `style="--chip: …"` on hundreds of elements. Script execution is what turns an escaping mistake into an account takeover; an inline style is not.

`Strict-Transport-Security` is deliberately absent: it belongs to the zone, not the Worker (#13).

## Language

Two languages, English and Thai, chosen per person on `/me` and stored in D1 — like the week start, and for the same reason: pages are rendered on the server, so the preference has to reach the Worker, and per person it follows someone between their laptop and their phone.

- **Strings** live in `src/i18n/strings.ts`, both languages on one line per key, so a stale translation is visible while editing rather than hiding in a second file.
- **Components** read the reader's language from a Hono JSX context provided by `Layout`, instead of threading a prop through every component. Rendering is synchronous, so the provider reaches everything below it within one render and nothing is shared between requests.
- **Pure functions never see a language.** `validateBooking` and `countLeaveDays` return a `Message` — a key plus its numbers — and the route renders it at the edge, where the reader is known. Tests assert on the key, so rewording a message cannot turn a test red.
- **Client-rendered text** (the day count, the coverage line, the notification card's states) is handed to the browser as data attributes on the element that needs it. The catalogue stays out of the bundle; esbuild drops it, and the browser is never sent strings in a language nobody asked for.

What stays as it is, and why, is in [ISSUES.md](ISSUES.md) #25.

## Notifications

Two channels, one job. `runDigest` decides *whether* to notify once — skipping weekends, public holidays, and days with nobody out — builds the text once, then fans out. An admin's preview runs the same function in dry-run mode, so what they see is produced by the code that sends.

Two kinds of post, too: the daily "out today" digest, and a week-ahead summary on Monday mornings. They claim separate rows in `notification_runs` — keyed on `(date, kind, channel)` — because a Monday carries both, and a shared key would let whichever ran first suppress the other.

| Channel | Reaches | Cost | Configured by |
| --- | --- | --- | --- |
| LINE | one group chat | billed per member, per push | channel token + group id |
| Browser push | each person who opted in, per browser | free | VAPID keypair |

`notification_runs` is keyed on **(date, kind, channel)**, not date alone. With one row per date, a LINE row would claim the day and silently suppress the push, and one status column could not say "LINE failed but the browsers got it". Each channel claims its own row *before* sending, so a crash fails closed — no message — rather than open, with two.

### Web Push

Implemented directly against RFC 8291 (`aes128gcm` payload encryption) and RFC 8292 (VAPID) in `src/notify/push.ts`, using only WebCrypto. No dependency: every primitive is in the runtime, and the alternative is handing the VAPID private key to an unaudited package. RFC 8291 §5 publishes a complete worked example, so the implementation is asserted against the spec's own bytes rather than against a reading of it.

Three consequences worth knowing:

- **The message travels inside the payload.** A service worker wakes with no page open, and a fetch to an origin behind Access returns a login redirect — so it cannot pull the digest itself. The text is encrypted end to end; the push service forwards bytes it cannot read.
- **Subscriptions are per browser, not per person.** The endpoint is the primary key. Re-subscribing reassigns ownership to whoever is signed in, which is what makes a shared machine safe after someone signs out.
- **Dead endpoints are pruned on send.** 404 and 410 mean gone for good and the row is deleted; anything else may be transient and is retried tomorrow.

The service worker (`public/sw.js`) deliberately caches nothing. Every page here is behind Access and rendered per user; a cached page served to the wrong person, or after their access was revoked, is a far worse failure than a page that will not load offline.

## Notes, and who can read them

One rule, in one function: `visibleNote(entry, viewer)` in `domain/leave.ts`. A note is readable by its author, by admins, and by everyone else only if the booker ticked "share".

It is applied at the **boundary**, not in a template — the calendar's `data-*` attributes and the JSON feed both call it, so an unshared note is absent from what reaches another colleague's browser rather than hidden by CSS. The per-person page (`/u/:email`) renders no notes at all, for anyone.

The audit trail records whether a note existed, never its text. A trail that copied notes into a second, admin-readable table would quietly undo the whole feature.

## Audit trail

`leave_audit` records every create, edit and cancel: actor, subject, action, timestamp, and JSON snapshots either side.

The write is batched with the change itself, inside the repo functions that perform it, rather than being left to the routes. Three code paths reach a mutation — the form, the drag-to-move, and an admin editing someone else's booking — and a trail with a hole in it would always be the path someone forgot. `updateLeave` reads the previous row itself rather than trusting a caller to pass it.

Snapshots are JSON rather than mirrored columns so the trail keeps its meaning when `leave_requests` changes shape.

**Retention.** After the digest, the same cron run deletes audit rows older than three years and `notification_runs` rows older than 90 days (`AUDIT_KEEP_YEARS`, `NOTIFICATION_KEEP_DAYS` in `src/repo/db.ts`). In its own `try`, so housekeeping can never delay or block a post. Three years covers the year being worked in, the two before it, and any balance that crossed New Year; everything the app can still change — 90 days of backdating, 10 minutes of undo — sits well inside it.

## Leave types

`active = 0` retires a type (0011). Deleting one that has bookings is not an option: nothing has a foreign key, and `ENTRY_FROM` inner-joins `leave_types`, so its bookings would silently drop out of every query rather than error. A retired type:

- leaves the booking form, the admin quota editor and the bulk-quota picker;
- is refused for a new booking (`error.retiredType`), but stays bookable for the booking that already has it — `keepTypeId` in the booking context — so its dates can be edited, dragged or undone without changing what kind of leave it was;
- keeps its balance card only in a year it was actually used, and its legend entry only on a month where it appears.

Delete is offered only for a type with no bookings in any status, and the `DELETE` repeats that guard itself (the same `NOT EXISTS` as 0010), so a booking made between page load and click cannot be orphaned. The last offered type cannot be retired.

**Undo reads the trail back.** `POST /api/leave/:id/undo` acts on the most recent audit row for that booking, within ten minutes. A cancellation is undone by flipping the status back — the row never left, so its note is intact — and recorded as its own `restored` action. An edit is undone from the `before` snapshot, but the note always comes from the row, because the snapshot deliberately records only `has_note`; rebuilding a booking from the trail alone would have wiped every note it touched. Both re-run the booking rules first, since quota and dates can change between a change and its undo. The route re-authorises through `ownedLeave` and finds the audit row itself — the undo offer rides in a client-held cookie and is trusted for nothing.

## Non-goals (v1)

Approval workflow, carry-over quota, attachments/medical certs, half-hour granularity, per-team filtering, export to payroll.
