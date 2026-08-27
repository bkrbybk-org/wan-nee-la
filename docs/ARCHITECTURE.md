# wan-nee-la — Architecture

Employee leave tracker. Cloudflare Workers, SSR, D1, LINE push at 08:00 Asia/Bangkok.

Name: วันนี้ลา — "on leave today".

## Decisions (locked)

| Area | Choice | Why |
| --- | --- | --- |
| Runtime | Cloudflare Workers | Required. |
| Framework | Hono + Hono JSX (SSR) | Same stack as a sibling Workers project. No React/SPA — pages are small, SSR is faster on mobile. |
| Data | D1 (SQLite) | Relational: users × quotas × requests. KV can't do the date-range queries the calendar needs. |
| Auth | Cloudflare Access (configured manually by owner) | Worker reads identity from the Access JWT. No password, no session store. |
| Client JS | esbuild IIFE bundles into `public/` | Same pattern as a sibling Workers project (`build:client`). Progressive enhancement only. |
| Notify | LINE **Messaging API** push | LINE Notify is dead (see ISSUES.md #1). |
| Schedule | Workers Cron Trigger `0 1 * * *` | 01:00 UTC = 08:00 Asia/Bangkok. Thailand has no DST, so the offset is fixed at UTC+7 forever. |
| Dates | `YYYY-MM-DD` strings, Bangkok-local | Leave is a calendar concept, not an instant. Storing UTC timestamps causes off-by-one-day bugs at the boundary. |

## Auth model

Cloudflare Access sits in front of the custom domain. Every request arrives with:

- `Cf-Access-Jwt-Assertion` header (also the `CF_Authorization` cookie)

The Worker **verifies** that JWT — signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (JWKS, cached in memory per isolate), plus `aud` == the Access application AUD tag, plus `exp`. Identity = the `email` claim.

Do **not** trust the header without verification, and do **not** expose a `workers.dev` route — Access only protects the custom hostname, so a `workers.dev` URL is an unauthenticated bypass to all employee leave data. `wrangler.jsonc` sets `"workers_dev": false`. Same rule as a sibling Workers project.

Admin = `users.is_admin` flag in D1, not an Access group (keeps the app self-contained).

## Data model (D1)

Nine migrations, applied in order. This is the schema they produce — checked against a database with all of them applied, not written from memory.

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
  code          TEXT NOT NULL UNIQUE,      -- annual | sick | medical | personal | unpaid
  label_th      TEXT NOT NULL,
  label_en      TEXT NOT NULL,
  color         TEXT NOT NULL,             -- calendar chip colour
  default_days  REAL NOT NULL,             -- seeds new quota rows only
  counts_quota  INTEGER NOT NULL DEFAULT 1,-- unpaid and planned medical are 0
  sort_order    INTEGER NOT NULL DEFAULT 0
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
  action        TEXT NOT NULL,             -- created | edited | cancelled
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

Self-serve model (owner's decision): a POST creates a `confirmed` row directly. No approver, no pending state. Overlap with an existing confirmed request for the same user is rejected.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Global calendar. Month grid on ≥768px, agenda list on mobile. |
| GET | `/book?date=` | Booking page, prefilled. The no-JS destination for the calendar's day cells. |
| GET | `/leave/:id/edit` | Edit one booking. Also the no-JS destination for a calendar entry. |
| POST | `/api/leave/:id/edit` | Save an edit. |
| GET | `/api/leave?from=&to=` | JSON feed for the calendar, all users. |
| GET | `/me` | Personal dashboard: balance per leave type, upcoming + past leave. |
| POST | `/api/leave` | Book leave. Server computes days, checks overlap + balance. |
| POST | `/api/leave/:id/cancel` | Cancel own leave (admin can cancel any). |
| GET | `/admin` | Users, quotas, holidays, notification log. Admin only. |
| POST | `/admin/quotas` | Edit one person's quota rows. |
| POST | `/admin/quotas/bulk` | Set one leave type's quota for every active user. |
| POST | `/admin/notify/preview` | Dry-run the digest through the real job. |
| POST | `/admin/notify/send` | Send the digest now, or retry a failed date. |
| POST | `/line/webhook` | Capture the group ID; verify `X-Line-Signature` (HMAC-SHA256 of raw body with the channel secret). |
| GET | `/health` | Version metadata + D1 ping + LINE config presence. |

## The 08:00 notification

`scheduled()` handler, cron `0 1 * * *`:

1. Compute today in Asia/Bangkok.
2. If weekend or in `holidays` → write `skipped_empty`, stop.
3. Query confirmed leave overlapping today.
4. If nobody on leave → `skipped_empty`, stop. (Also saves LINE quota — see ISSUES.md #2.)
5. `INSERT OR IGNORE` into `notification_runs` **first**, keyed on (date, kind, channel). If the row already exists, stop. Cron retries and manual re-runs must not double-post, and the daily and week-ahead posts must not suppress each other.
6. `POST https://api.line.me/v2/bot/message/push` with `to = <group id>`, Bearer channel access token, and an `X-Line-Retry-Key` (LINE's own idempotency header).
7. Update the log row with the outcome.

The claim in step 5 happens **before** the push, so a crash mid-send fails closed with no message rather than open with two. A send that fails stays logged as `failed` and needs an explicit force to retry, so a flapping error cannot spam the group.

Message: **plain text**, one line per person — name, leave type, half-day marker, and the span for multi-day leave. Not a Flex bubble: a Flex payload is a second thing that can be rejected for schema reasons at 08:00 with nobody watching, and it costs the same under LINE's per-member billing.

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

One `public/app.css`, mobile-first, single breakpoint at 768px. Below it the calendar renders as a scrollable agenda list (a 7×5 grid with names is unreadable on a phone); above it, a month grid with coloured chips. The booking form is a `<form>` that works without JS; JS only adds the live day-count preview and the half-day field toggling.

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

`notification_runs` is keyed on **(date, channel)**, not date alone. With one row per date, a LINE row would claim the day and silently suppress the push, and one status column could not say "LINE failed but the browsers got it". Each channel claims its own row *before* sending, so a crash fails closed — no message — rather than open, with two.

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

## Non-goals (v1)

Approval workflow, carry-over quota, attachments/medical certs, half-hour granularity, per-team filtering, i18n toggle (Thai labels inline), export to payroll.
