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
| GET | `/api/leave?from=&to=` | JSON feed for the calendar, all users. |
| GET | `/me` | Personal dashboard: balance per leave type, upcoming + past leave. |
| POST | `/api/leave` | Book leave. Server computes days, checks overlap + balance. |
| POST | `/api/leave/:id/cancel` | Cancel own leave (admin can cancel any). |
| GET | `/admin` | Users, quotas, holidays, notification log. Admin only. |
| POST | `/admin/quotas` | Edit quota rows. |
| POST | `/line/webhook` | Capture the group ID; verify `X-Line-Signature` (HMAC-SHA256 of raw body with the channel secret). |
| GET | `/health` | Version metadata + D1 ping + LINE config presence. |

## The 08:00 notification

`scheduled()` handler, cron `0 1 * * *`:

1. Compute today in Asia/Bangkok.
2. If weekend or in `holidays` → write `skipped_empty`, stop.
3. Query confirmed leave overlapping today.
4. If nobody on leave → `skipped_empty`, stop. (Also saves LINE quota — see ISSUES.md #2.)
5. `INSERT OR IGNORE` into `notification_log` **first**. If the row already exists with `status='sent'`, stop. Cron retries and manual re-runs must not double-post.
6. `POST https://api.line.me/v2/bot/message/push` with `to = <group id>`, Bearer channel access token, and an `X-Line-Retry-Key` UUID (LINE's own idempotency header).
7. Update the log row with the outcome.

Message: Flex message, one line per person — name, leave type, and half-day marker. Falls back to plain text if the Flex payload is rejected.

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
| `LINE_GROUP_ID` | var or app_config | captured by the webhook |
| `TZ_OFFSET` | var | `+07:00`, single source of truth |

## Frontend

One `public/app.css`, mobile-first. Breakpoint 768px: below it the calendar renders as a scrollable agenda list (a 7×5 grid with names is unreadable on a phone); above it, a month grid with colored chips. Booking form is a `<form>` that works without JS; JS only adds the date-range picker and live day-count preview.

## Non-goals (v1)

Approval workflow, carry-over quota, attachments/medical certs, half-hour granularity, per-team filtering, i18n toggle (Thai labels inline), export to payroll.
