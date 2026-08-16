# wan-nee-la — Progress

Updated: 2026-08-16

> This repo is **public**. Every account id, hostname, database id and Access
> value below is a placeholder; the real ones live in `wrangler.local.jsonc`,
> which is gitignored. See ISSUES.md #16 for why.

## Status

Deployed and serving. Version `f21afd6b-5e4f-49ee-b15b-5294ad0af810`, D1 `<database-id>` in APAC, behind Cloudflare Access on `<hostname>`. `/health` reports `accessConfigured: true`, `devAuthBypass: false`.

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
src/client/    progressive enhancement only (booking preview, dialogs, drag)
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
| GET | `/health` | Above auth. Version, D1 ping, config flags. Safe for uptime checks. |
| POST | `/line/webhook` | Above auth. Signature-verified; only writes the group id. |
| GET | `/` | Calendar. Month grid ≥768px, agenda list below. Out-today / next-7-days summary. |
| GET | `/book?date=` | Booking page — the no-JS destination for calendar day cells. |
| GET | `/api/leave?from=&to=` | JSON feed. No email addresses. |
| GET | `/api/leave/preview` | Server-side day count for the form's live preview. |
| POST | `/api/leave` | Book. Server computes days, checks overlap and balance. |
| GET · POST | `/leave/:id/edit` · `/api/leave/:id/edit` | Edit. Also the drag-to-move target. |
| POST | `/api/leave/:id/cancel` | Soft cancel; idempotent. |
| GET | `/me` | Balances, upcoming and past leave, display name. |
| POST | `/me/name` | |
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

**Theme** — System (default) / Light / Dark, applied before first paint from an inline script so there is no flash.

---

## Verification

**224 automated assertions**, all green in CI on every push and pull request.

| Suite | Assertions | Covers |
| --- | --- | --- |
| `test-dates.mjs` | 83 | Bangkok boundary, half-days, weekends, holidays, month grids |
| `test-leave.mjs` | 51 | Booking rules, balances, calendar placement |
| `test-line.mjs` | 32 | Webhook signature, group-id extraction, digest text |
| `smoke.mjs` | 58 | The HTTP layer — see below |

The smoke suite boots a real worker against a scratch database and exercises what pure functions cannot reach: the CSRF guard, ownership checks on edit and cancel, booking rules over real requests, the open-redirect guard on `returnTo`, digest decisions, the webhook signature, and admin authorisation across two signed-in identities.

It is built against its own worst failure mode — passing while testing nothing. The server is health-checked before any assertion; each boot proves it is signed in as the expected identity; a minimum assertion count fails the run if a section throws early. Confirmed by sabotage: removing the ownership check turns 5 assertions red, restoring the leaked email field turns 1 red, and pointing a boot at the wrong identity fails the harness.

**CI** also builds the client bundle and the Worker (`--dry-run`, no credentials), and fails if `.dev.vars`, `wrangler.local.jsonc` or the built bundle are ever tracked, or if a credential-shaped string is committed. It needs no secrets, so it runs on pull requests from forks.

**Verified in production** with an Access service token: unauthenticated requests redirect to the Access login, a forged assertion never reaches the Worker, the `workers.dev` URL 404s, D1 responds, and the cron is registered.

---

## Open items

No known bugs. What follows is risk, unfinished configuration, and one real design gap.

### Needs a decision

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

### Housekeeping

- `notification_log` grows one row per day and is never pruned.
- No carry-over of unused leave into the next year — a deliberate v1 non-goal, worth reconfirming before January.
- Deploy is manual. Deploy-on-merge would need a Cloudflare API token plus infrastructure ids in repository settings; see below.

---

## Next tasks

1. **Owner** — sign in through a browser and confirm the calendar renders. Make sure the right person goes first; they become the admin.
2. **Owner** — switch on LINE, if wanted. Steps are in the [README](../README.md#turning-on-the-line-post). The Access Bypass rule for `/line/webhook` is the step most likely to be missed.
3. **Audit trail** for edits and cancellations (#8). Needs a new table.
4. Then, roughly in value order: an iCal feed so leave appears in Google Calendar or Outlook (note: calendar clients cannot do SSO, so it needs a signed-token URL outside Access); CSV export for HR; a look-ahead in the digest; team grouping and coverage warnings once the roster is large enough to need them.
5. Optional: deploy on merge to main. Deliberately not set up — it would put a Cloudflare API token and the infrastructure ids into repository settings, and deploying from a laptop is one command. Worth revisiting when more than one person merges.

---

## Decisions log

- Self-serve booking. No approval workflow, no pending state. — owner
- Per-type annual quota (annual / sick / personal / unpaid). No carry-over in v1. — owner
- Deactivated users disappear from the calendar, feed and digest; their history stays for admins. Those three surfaces answer "who of us is out", and a former employee is not.
- The digest is plain text, not a Flex bubble: a Flex payload is a second thing that can be rejected at 08:00 with nobody watching, and costs the same under per-member billing.
- Flash messages travel in a cookie, never the query string — free prose in a URL was blocked by the WAF (#15).
- "Next 7 days" rather than a Monday–Sunday week: a calendar week is mostly in the past by Thursday and useless on a Sunday.
- Node 24 (`.nvmrc`) — the test scripts import `.ts` directly via type stripping.

## Change log

- **2026-08-16** — Route-level smoke tests in CI (58 assertions). Deactivated users removed from shared surfaces; emails removed from the JSON feed; out-today / next-7-days summary added.
- **2026-08-15** — CI: typecheck, unit tests, client and Worker builds, committed-secrets guard.
- **2026-08-15** — Repo made publishable: infrastructure ids moved to a gitignored config, git history rewritten, pushed public.
- **2026-08-15** — LINE digest, webhook and admin controls (phase 4). Bulk quota editing. Drag-to-move on the calendar.
- **2026-08-15** — Calendar made directly editable: click a day to book, click an entry to open it. Theme toggle. Edit and remove for submitted leave.
- **2026-08-15** — Booking in a browser hit a Cloudflare WAF block; the cause was our own query-string flash messages (#15). Moved to a cookie.
- **2026-08-15** — Phases 1–3 built and deployed behind Access.
