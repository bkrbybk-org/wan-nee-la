# wan-nee-la — Progress

Updated: 2026-08-15

## Status

**Phases 1–4 built, verified, and deployed.** The LINE post is built but inert until its two secrets are set.

Deployed and running. The real hostname, account id, database id and Access details are in `wrangler.local.jsonc`, which is gitignored — this repo is public, so the values below are placeholders. Version `3c0b882b-304f-4630-8cba-0bb8ebeae216`, D1 `<database-id>` (APAC).

Cloudflare Access is enforcing, with the team domain and AUD set in `wrangler.local.jsonc`. `/health` reports `accessConfigured: true`, `devAuthBypass: false`.

**Not yet confirmed: a human SSO login.** That cannot be tested from a terminal. Everything up to the identity claim is proven (see below) — someone needs to open the URL in a browser and confirm they land on the calendar. The first person to do so becomes the admin.

## Decisions locked (2026-08-15)

- Self-serve booking. No approval workflow, no pending state. — owner
- Per-type annual quota (annual / sick / personal / unpaid). No carry-over in v1. — owner
- LINE notification via the Messaging API; LINE Notify is dead. Ships inert until the secrets are set.
- Hono + JSX SSR + D1 on Workers, mirroring a sibling Workers project's stack.
- Dates stored as Bangkok-local `YYYY-MM-DD` strings.
- Node 24 (`.nvmrc`) — the test scripts import `.ts` directly via type stripping.

## Phase status

| Phase | State |
| --- | --- |
| 0 — Prerequisites | hostname + Access app **done**; LINE channel still outstanding. |
| 1 — Foundation | **done** |
| 2 — Core app | **done** |
| 3 — Admin | **done** |
| 4 — LINE notification | **built**; inert until the LINE credentials are set. |
| 5 — Ship | **deployed**; CI not set up |

## What exists

| Area | Files |
| --- | --- |
| Date + half-day math | [src/domain/dates.ts](../src/domain/dates.ts) |
| Booking rules, balances | [src/domain/leave.ts](../src/domain/leave.ts) |
| Access JWT verification | [src/auth/access.ts](../src/auth/access.ts) |
| D1 queries | [src/repo/db.ts](../src/repo/db.ts) |
| Routes + cron | [src/index.tsx](../src/index.tsx) |
| LINE digest + webhook | [src/notify/](../src/notify/) |
| Views | [src/views/](../src/views/) |
| Client bundle (progressive enhancement) | [src/client/app.ts](../src/client/app.ts) → `booking.ts`, `calendar.ts` |
| Schema + seed | [migrations/](../migrations/) |
| Tests | [scripts/](../scripts/) — dates, leave, LINE |

## Verified locally (2026-08-15)

Against `wrangler dev` with a local D1 and `DEV_AUTH_BYPASS=1`:

- 64 date assertions + 48 leave assertions pass; both tsconfigs typecheck clean.
- Booking a Mon–Fri range charges 5 days; balance drops 10 → 5 and returns to 10 on cancel.
- Rejected as intended: overlapping range, weekend-only day, holiday, over-quota, backdated past the window, typo'd far-future year, invalid dates.
- Cancel is idempotent — a second cancel reports "already cancelled" rather than rewriting the row.
- Cross-origin POST returns 403; same-origin POST succeeds.
- Last-admin guard blocks self-demotion; out-of-range quota values are ignored.
- Month grid renders at desktop width; agenda list renders at 375px with half-day markers and Thai labels.
- Live day-count preview matches the server exactly (`pm`→`am` over Tue–Fri = 3 days in both).
- Cron skips weekends and holidays; posts only when someone is out.
- Webhook returns 401 for unsigned, wrong and tampered bodies; 200 and captures the group id for a valid signature.
- Digest is idempotent: a second send is refused as a duplicate, and only an explicit force retries a failed date.
- Bulk quota touches active users only; drag preserves a booking's length and shifts from the grabbed day.

## Production validation (2026-08-15, via Access service token)

- Unauthenticated request → 302 to `<team>.cloudflareaccess.com` login. Access is in front of every path, `/health` included.
- A forged `Cf-Access-Jwt-Assertion` never reaches the Worker — Access rejects it first.
- `wan-nee-la.<sub>.workers.dev` → 404. No unauthenticated route to the same data.
- Service token reaches the Worker and is refused with "This is a valid service token, not a person." That message only prints **after** signature, `exp`, `aud`, and `iss` have all passed, so it proves the whole Access chain is correctly configured — the token simply carries no `email`.
- D1 reachable from production (`/health` → `db: true`), 7 tables, seed loaded.
- Cron `0 1 * * *` registered on the deployed Worker.

Service-token claims are `aud, common_name, exp, iat, iss, sub, type` — no `email`, which is why a machine credential cannot be admitted to a per-person leave record.

## Next action

1. **Owner**: open https://leave.example.com in a browser, sign in through Access, confirm the calendar renders. This is the one path that cannot be validated from a terminal. Whoever does this first becomes the admin — make sure it is the right person.
2. **Owner**: to switch the LINE post on —
   1. create a Messaging API channel, invite the bot to the group, disable auto-reply and enable webhook in the LINE OA Manager
   2. set the webhook URL to `https://leave.example.com/line/webhook` and add an Access **Bypass** rule for that path, or LINE's requests will be sent to the login page
   3. `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN` and `wrangler secret put LINE_CHANNEL_SECRET`
   4. post any message in the group so the webhook captures the group id, then check /admin shows it
   5. use **Preview** on /admin, then **Send now**
3. Then: CI (phase 5.2). Nothing else depends on it.

## Log

- **2026-08-15** — Requirements gathered. Architecture, plan, and issue list drafted. Confirmed LINE Notify EOL against LINE's own announcement; repointed the notification design at the Messaging API. Flagged per-member push billing (ISSUES.md #2).
- **2026-08-15** — LINE digest built (phase 4). Cron posts the day's leave to a LINE group; /line/webhook captures the group id and verifies X-Line-Signature; notification_log makes a double post impossible. Inert until the two secrets are set.
- **2026-08-15** — Bulk quota action on /admin, and drag-to-move on the calendar.
- **2026-08-15** — Calendar is now directly editable: click an empty day to book it, click an entry to open a detail popup with Edit and Remove. Both are real links (`/book?date=`, `/leave/:id/edit`) upgraded to dialogs by `src/client/calendar.ts`, so the calendar still works with scripting off. Client bundle renamed `booking.js` → `app.js`.
- **2026-08-15** — Added a System/Light/Dark theme toggle, defaulting to System. Switching logic is inlined in `<head>` so a stored choice applies before first paint; the dark media query is guarded so an explicit Light choice wins on a dark-mode OS.
- **2026-08-15** — Added edit and remove for submitted leave: `/leave/:id/edit`, `POST /api/leave/:id/edit`. Editing excludes the booking from its own overlap check and credits its days back before the balance check, so shortening or retyping is never refused by the quota the booking itself holds. Remove is the existing soft cancel, now reachable from every confirmed booking including past ones.
- **2026-08-15** — Booking in a browser hit a Cloudflare WAF block; cause was our own query-string flash messages (ISSUES.md #15). Moved them to a cookie.
- **2026-08-15** — Built phases 1–3. Owner deferred the LINE notification, so the `scheduled()` handler logs its decision instead of pushing. Verified every booking rule and both cron branches against a local D1.
