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

```sql
CREATE TABLE users (
  email         TEXT PRIMARY KEY,          -- from Access JWT, lowercased
  display_name  TEXT NOT NULL,
  line_user_id  TEXT,                      -- optional, for @-mention in the LINE post
  is_admin      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE leave_types (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,      -- annual | sick | personal | unpaid
  label_th      TEXT NOT NULL,
  label_en      TEXT NOT NULL,
  color         TEXT NOT NULL,             -- calendar chip color
  default_days  REAL NOT NULL,             -- seeds new-year quotas
  counts_quota  INTEGER NOT NULL DEFAULT 1 -- unpaid leave = 0
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
  status        TEXT NOT NULL,             -- confirmed | cancelled
  created_at    TEXT NOT NULL,
  cancelled_at  TEXT
);
CREATE INDEX idx_leave_range  ON leave_requests (start_date, end_date) WHERE status = 'confirmed';
CREATE INDEX idx_leave_user   ON leave_requests (user_email, start_date);

CREATE TABLE holidays (
  date   TEXT PRIMARY KEY,                 -- YYYY-MM-DD
  label  TEXT NOT NULL
);

CREATE TABLE notification_log (
  date        TEXT PRIMARY KEY,            -- the leave date announced
  sent_at     TEXT NOT NULL,
  people      INTEGER NOT NULL,
  status      TEXT NOT NULL,               -- sent | skipped_empty | failed
  error       TEXT
);

CREATE TABLE app_config (                  -- LINE group id, captured via webhook
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

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
5. `INSERT OR IGNORE` into `notification_log` **first**. If the row already exists with `status='sent'`, stop. Cron retries and manual re-runs must not double-post.
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

## Non-goals (v1)

Approval workflow, carry-over quota, attachments/medical certs, half-hour granularity, per-team filtering, i18n toggle (Thai labels inline), export to payroll.
