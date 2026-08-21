# wan-nee-la — Progress

Updated: 2026-08-21

> This repo is **public**. Every account id, hostname, database id and Access
> value below is a placeholder; the real ones live in `wrangler.local.jsonc`,
> which is gitignored. See ISSUES.md #16 for why.

## Status

Deployed and serving. Version `6c8106f9-59db-44d0-b4b2-8626b69d8634`, D1 `<database-id>` in APAC, behind Cloudflare Access on `<hostname>`. `/health` reports `accessConfigured: true`, `devAuthBypass: false`.

Everything in phases 1–5 is built. Two things gate real use, both needing the owner rather than more code:

1. **No human has signed in through SSO yet.** It cannot be tested from a terminal — a service token authenticates at the edge but carries no `email`, so the app correctly refuses it. Someone must open the site in a browser. **Whoever does so first becomes the admin.**
2. **The LINE post is inert.** The code is complete and tested; it needs a Messaging API channel, an Access Bypass rule on `/line/webhook`, and two secrets.

---

## Architecture

| Area | Choice | Why |
| --- | --- | --- |
| Runtime | Cloudflare Workers | Required. |
| Framework | Hono + Hono JSX, server-rendered | No SPA. Pages are small; SSR is faster on a phone and keeps the client bundle at ~6kb. |
| Data | D1 (SQLite) | Relational: users × quotas × requests. KV cannot do the date-range queries the calendar needs. |
| Auth | Cloudflare Access, JWT **verified** in the Worker | Never trust the header alone — that assumption breaks the moment a second route exists. |
| Dates | Bangkok-local `YYYY-MM-DD` strings | Leave is a calendar date, not an instant. UTC timestamps cause off-by-one bugs at the boundary. |
| Notify | LINE Messaging API | LINE Notify was terminated 2025-03-31. |
| Schedule | Cron `0 1 * * *` | 01:00 UTC = 08:00 Asia/Bangkok. Thailand has no DST, so the offset is a constant. |
| Config | `wrangler.jsonc` template + gitignored `wrangler.local.jsonc` | Keeps one company's infrastructure out of a public clone. npm scripts prefer the local file. |

### Layers

```
src/domain/    pure functions — date maths, half-days, booking rules, balances
src/repo/      every D1 query; no SQL anywhere else
src/auth/      Access JWT verification
src/notify/    LINE digest + webhook signature
src/views/     Hono JSX pages
src/client/    progressive enhancement only (booking preview, dialogs, drag, ripple)
```

The rule that keeps this honest: **the server computes and validates everything.** `days_total` is never read from a request; the booking form's live preview asks the server rather than reimplementing the rules; drag-to-move submits to the same endpoint the edit page uses, so one set of validations covers every path.

### Auth model

Access sits in front of the custom hostname. The Worker verifies the JWT — RS256 signature against the team JWKS, `aud`, `exp`, `iss` — and takes identity from the `email` claim. Admin is a D1 flag, not an Access group.

Two consequences worth remembering:

- `workers_dev` must stay `false`. Access protects the custom hostname only.
- `/line/webhook` sits **above** the auth middleware, because LINE cannot carry an Access token. It is the one publicly reachable route, so it verifies `X-Line-Signature` over the raw body with a constant-time compare and refuses anything unsigned.

### Routes

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Above the app's auth. Version, D1 ping, config flags. Still behind Access, so an anonymous monitor cannot reach it — see ISSUES.md #18. |
| POST | `/line/webhook` | Above auth. Signature-verified; only writes the group id. |
| GET | `/` | Calendar. Month grid ≥768px, agenda list below. Out-today / next-7-days summary. |
| GET | `/book?date=` | Booking page — the no-JS destination for calendar day cells. |
| GET | `/api/leave?from=&to=` | JSON feed. No email addresses. |
| GET | `/api/leave/preview` | Server-side day count for the form's live preview. |
| POST | `/api/leave` | Book. Server computes days, checks overlap and balance. |
| GET · POST | `/leave/:id/edit` · `/api/leave/:id/edit` | Edit. Also the drag-to-move target. |
| POST | `/api/leave/:id/cancel` | Soft cancel; idempotent. |
| GET | `/me` | Balances, upcoming and past leave, settings. Year navigation. |
| GET | `/u/:email` | One person's leave. Schedule is shared; balances only for that person and admins; notes never. |
| POST | `/me/name` · `/me/week-start` | Display name; whether the grid starts Monday or Sunday. |
| GET | `/admin` | Users, quotas, holidays, LINE status and run log. Admin only. |
| POST | `/admin/quotas` · `/admin/quotas/bulk` | One person, or every active user at once. |
| POST | `/admin/user` | Role and active flag. Last admin cannot demote itself. |
| POST | `/admin/notify/preview` · `/admin/notify/send` | Dry-run and manual send, through the real digest job. |
| POST | `/admin/holiday` · `/admin/holiday/delete` | |

---

## What is built

**Calendar** — month grid on desktop, agenda on mobile. Click an empty day to book it, click an entry to open a detail popup, drag an entry to move it (desktop). Everything is a real link first; the dialogs are an upgrade, and the whole calendar works with scripting off. An out-today / next-7-days summary sits above both views, and hides itself when you browse a month that cannot contain today.

**Booking** — half-day granularity, live day-count preview from the server, overlap detection, quota enforcement, weekend and holiday rejection, a 90-day backdate window and a far-future guard. Edit and remove on every confirmed booking, past ones included.

**Balances** — per leave type, per year. Unpaid leave draws no quota. Editing credits a booking's own days back before checking the balance, so shortening or retyping is never refused by the quota that booking is itself holding.

**Admin** — quota editing per person or in bulk across active users, holiday management, user roles, LINE status and run log.

**LINE digest** — cron at 08:00 Asia/Bangkok posts who is out. Skips weekends, holidays, and days with nobody out, because LINE bills a group push per member. Double-posting is guarded twice: a `notification_log` row is claimed *before* the push, and the request carries LINE's `X-Line-Retry-Key`. `scheduled()` never throws, since a retried handler that already sent would post again.

**Week start** — each person chooses Monday or Sunday on `/me`. Presentation only: weekends stay Saturday and Sunday and no quota arithmetic changes. Stored per user in D1 rather than `localStorage`, because the grid is rendered on the server.

**Per-person page** — `/u/:email` shows one person's leave for a year. Their schedule is visible to everyone, because it is already on the shared calendar; their balances only to themselves and admins, because "12 of 30 sick days used" is an aggregate the calendar does not reveal; their notes to nobody, while ISSUES #17 is undecided.

**Accessibility** — the month grid is a real `<table>` with column headers, so a screen reader gets row and column relationships without a JS keyboard model. Each cell announces its full date rather than a bare digit, each entry announces name, type, half-day and date rather than a repeated name, today carries `aria-current="date"`, and there is a skip link. Contrast measured at AA or better in both themes.

**Material 3 interface** — the whole UI is built on M3 roles, shape, elevation, state layers and motion. Colour comes from tonal palettes generated by `scripts/palette.mjs`, which also checks every pair the stylesheet paints against WCAG AA and fails if one does not clear it. Navigation follows the platform: a bottom navigation bar and an extended FAB on a phone, tabs in the top app bar on a laptop, both server-rendered and chosen by CSS. Text fields are M3 filled fields with floating labels, and icons are drawn in the repo rather than fetched from Google Fonts.

**Theme** — System (default) / Light / Dark, applied before first paint from an inline script so there is no flash.

---

## Verification

**267 automated assertions**, all green in CI on every push and pull request.

| Suite | Assertions | Covers |
| --- | --- | --- |
| `test-dates.mjs` | 114 | Bangkok boundary, half-days, weekends, holidays, month grids |
| `test-leave.mjs` | 51 | Booking rules, balances, calendar placement |
| `test-line.mjs` | 32 | Webhook signature, group-id extraction, digest text |
| `smoke.mjs` | 70 | The HTTP layer — see below |

The smoke suite boots a real worker against a scratch database and exercises what pure functions cannot reach: the CSRF guard, ownership checks on edit and cancel, booking rules over real requests, the open-redirect guard on `returnTo`, digest decisions, the webhook signature, and admin authorisation across two signed-in identities.

It is built against its own worst failure mode — passing while testing nothing. The server is health-checked before any assertion; each boot proves it is signed in as the expected identity; a minimum assertion count fails the run if a section throws early. Confirmed by sabotage: removing the ownership check turns 5 assertions red, restoring the leaked email field turns 1 red, and pointing a boot at the wrong identity fails the harness.

**CI** also builds the client bundle and the Worker (`--dry-run`, no credentials), and fails if `.dev.vars`, `wrangler.local.jsonc` or the built bundle are ever tracked, or if a credential-shaped string is committed. It needs no secrets, so it runs on pull requests from forks.

**Verified in production** with an Access service token: unauthenticated requests redirect to the Access login, a forged assertion never reaches the Worker, the `workers.dev` URL 404s, D1 responds, and the cron is registered.

---

## Open items

**No known bugs.** 262 assertions are green, `npm audit` is clean, and a security review on 2026-08-16 found nothing critical or high. Three real bugs were found and fixed while building the week-start setting; all three are now covered by tests.

What follows is decisions, unfinished configuration, accepted trade-offs and debt — not defects.

### Needs a decision

- **Leave notes are readable by everyone** ([ISSUES.md](ISSUES.md) #17). Verified live: a user who is neither the booker nor an admin sees the note text in the calendar HTML and in the JSON feed. Plausibly fine for a shared calendar — but notes are exactly where someone writes a medical or family detail, because the field looks incidental. Recommendation: relabel it so it reads as shared; restrict to owner and admins if anyone objects.
- **Nothing monitors the deployment** ([ISSUES.md](ISSUES.md) #18). `/health` is above the app's own auth but still behind Access, so an anonymous check gets a 302 to the login page. An earlier version of this document claimed otherwise; that was wrong. Needs an Access Bypass rule on `/health`, which exposes only a version string, a D1 ping and two booleans.
- **No audit trail on retroactive changes** ([ISSUES.md](ISSUES.md) #8). An edit overwrites the old values with no record of what they were, and edit, remove and drag all reach past bookings within the 90-day window. Someone can quietly reclaim last month's sick days. This is the largest correctness gap; my recommendation is to keep editing easy and add an audit table surfaced in `/admin`.
- **LINE cost is unverified** (#2). Billing is per group member: a 20-person group posted to daily is ~600 messages a month, and the free allowance varies by country. Check the actual allowance in the OA Manager before switching it on.

### Accepted

- **Concurrent booking can overdraw a quota** (#7, #12). D1 has no row locking; the window is milliseconds and an overdraw is visible and correctable in `/admin`.
- **CSRF is an Origin check, not a token** (#11). Every mutation is a same-origin form submit. A request with no `Origin` header is allowed, which is what keeps non-browser clients working; an opaque `null` origin is rejected.
- **Zone rules override the Worker's security headers** (#13). The app sends `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`; production serves `SAMEORIGIN` and `same-origin`. Confirmed not an app bug. Mild, but the app cannot enforce its own header policy.

### Configuration outstanding

- **Nobody has signed in through SSO.** See Status.
- **LINE is not switched on.** Needs the channel, the Access Bypass rule on `/line/webhook`, and `wrangler secret put` for the token and secret.
- **Thai lunar holidays need entering each year** (#10). Only fixed-date holidays are seeded. A missing holiday silently costs someone a quota day.

### Technical debt

From a sweep on 2026-08-16. Nothing here is urgent; all of it is confirmed present. Ordered by cost-to-benefit, with owners, in [PLAN.md](PLAN.md) section 4.

- `ensureUser` calls `ensureQuotas` on **both** branches, so every authenticated page load runs a write that only a new user or a new year needs.
- `/admin` issues one quota query per user — 40 staff is 41 round trips.
- `notification_log` grows one row per day and is never pruned.
- `leave_types` is static seed data, re-queried on every page load.
- `ARCHITECTURE.md` documents a `line_user_id` column and a partial index that the migration does not create.
- No linter or formatter. Style has been held by hand across ~20 files and five subagents; it will not survive many more.
- Smoke covers 16 of 20 routes. Untested: `/book`, `/api/leave/preview`, `/me/name`, `/admin/holiday` and its delete, and the success path of `GET /leave/:id/edit`.
- No carry-over of unused leave into the next year — a deliberate v1 non-goal, worth reconfirming before January.
- Deploy is manual, by choice. Deploy-on-merge would put a Cloudflare API token and the infrastructure ids into a public repo's settings.

Dependencies are clean: `npm audit` reports zero vulnerabilities. Hono is pinned `^4.6.14` against a current 4.13.2 — hygiene, not risk.

---

## Next tasks

[PLAN.md](PLAN.md) is the full backlog, with an owner and a reason per item. The short version:

1. **Owner** — sign in through a browser and confirm the calendar renders. Everything else is theoretical until someone has actually used it, and whoever signs in first becomes the admin.
2. **Owner** — two cheap decisions: notes visibility (#17) and a Bypass rule so something can monitor `/health` (#18).
3. **Owner** — switch on LINE, if wanted. The Access Bypass rule for `/line/webhook` is the step most likely to be missed.
4. One batch of debt: the per-request write, the `/admin` N+1, and the four uncovered routes. Low risk, and the last of those protects the rest.
5. **Audit trail** for edits and cancellations (#8), once the policy in item 2 is settled.

Features — iCal, CSV export, a digest look-ahead, team grouping and coverage warnings — are in PLAN.md section 5. None are needed for the app to do its job.

---

## Decisions log

- Self-serve booking. No approval workflow, no pending state. — owner
- Per-type annual quota (annual / sick / personal / unpaid). No carry-over in v1. — owner
- Deactivated users disappear from the calendar, feed and digest; their history stays for admins. Those three surfaces answer "who of us is out", and a former employee is not.
- The digest is plain text, not a Flex bubble: a Flex payload is a second thing that can be rejected at 08:00 with nobody watching, and costs the same under per-member billing.
- Flash messages travel in a cookie, never the query string — free prose in a URL was blocked by the WAF (#15).
- "Next 7 days" rather than a Monday–Sunday week: a calendar week is mostly in the past by Thursday and useless on a Sunday.
- First day of week is per user in D1, not `localStorage` like the theme: the month grid is server-rendered, so the preference has to reach the Worker, and per user it follows someone between devices.
- Node 24 (`.nvmrc`) — the test scripts import `.ts` directly via type stripping.

## Change log

- **2026-08-20** — Per-person page `/u/:email` with year navigation, and an accessibility pass on the calendar: the grid is now a table with proper headers and spoken dates. Contrast measured; all pairs pass AA.
- **2026-08-19** — Per-user first-day-of-week (Monday or Sunday) on `/me`, migration 0003. `db:init` and the smoke harness now apply every migration in order rather than a hardcoded list.
- **2026-08-16** — Route-level smoke tests in CI (58 assertions). Deactivated users removed from shared surfaces; emails removed from the JSON feed; out-today / next-7-days summary added.
- **2026-08-15** — CI: typecheck, unit tests, client and Worker builds, committed-secrets guard.
- **2026-08-15** — Repo made publishable: infrastructure ids moved to a gitignored config, git history rewritten, pushed public.
- **2026-08-15** — LINE digest, webhook and admin controls (phase 4). Bulk quota editing. Drag-to-move on the calendar.
- **2026-08-15** — Calendar made directly editable: click a day to book, click an entry to open it. Theme toggle. Edit and remove for submitted leave.
- **2026-08-15** — Booking in a browser hit a Cloudflare WAF block; the cause was our own query-string flash messages (#15). Moved to a cookie.
- **2026-08-15** — Phases 1–3 built and deployed behind Access.
