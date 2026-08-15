# wan-nee-la — Progress

Updated: 2026-08-15

## Status

**Phases 1–3 built and verified locally.** Calendar, booking, balances, and admin all work end to end against a local D1. Phase 4 (LINE push) is deliberately not built — the owner deferred it.

Not yet deployed. Deploy is blocked on two owner tasks: a hostname and a Cloudflare Access app (PLAN.md 0.5, 0.6).

## Decisions locked (2026-08-15)

- Self-serve booking. No approval workflow, no pending state. — owner
- Per-type annual quota (annual / sick / personal / unpaid). No carry-over in v1. — owner
- LINE notification deferred. Cron trigger is wired and logs what it *would* send. — owner
- Hono + JSX SSR + D1 on Workers, mirroring a sibling Workers project's stack.
- Dates stored as Bangkok-local `YYYY-MM-DD` strings.
- Node 24 (`.nvmrc`) — the test scripts import `.ts` directly via type stripping.

## Phase status

| Phase | State |
| --- | --- |
| 0 — Prerequisites | **blocked on owner**: hostname, Access app. LINE items no longer blocking. |
| 1 — Foundation | **done** |
| 2 — Core app | **done** |
| 3 — Admin | **done** |
| 4 — LINE notification | **deferred by owner**. Cron fires and logs; no message is sent. |
| 5 — Ship (CI, deploy) | not started |

## What exists

| Area | Files |
| --- | --- |
| Date + half-day math | [src/domain/dates.ts](../src/domain/dates.ts) |
| Booking rules, balances | [src/domain/leave.ts](../src/domain/leave.ts) |
| Access JWT verification | [src/auth/access.ts](../src/auth/access.ts) |
| D1 queries | [src/repo/db.ts](../src/repo/db.ts) |
| Routes + cron stub | [src/index.tsx](../src/index.tsx) |
| Views | [src/views/](../src/views/) |
| Booking form enhancement | [src/client/booking.ts](../src/client/booking.ts) |
| Schema + seed | [migrations/](../migrations/) |
| Tests | [scripts/test-dates.mjs](../scripts/test-dates.mjs), [scripts/test-leave.mjs](../scripts/test-leave.mjs) |

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
- Cron fires both branches: `skipped_empty` with nobody out, `would_send` with one person out.

## Next action

1. Owner: pick the hostname, create the Access app, `wrangler d1 create wan-nee-la`, paste the database id into `wrangler.jsonc`, uncomment the route.
2. Then phase 5: CI and first deploy.
3. Phase 4 (LINE) whenever the owner wants it — nothing else depends on it.

## Log

- **2026-08-15** — Requirements gathered. Architecture, plan, and issue list drafted. Confirmed LINE Notify EOL against LINE's own announcement; repointed the notification design at the Messaging API. Flagged per-member push billing (ISSUES.md #2).
- **2026-08-15** — Built phases 1–3. Owner deferred the LINE notification, so the `scheduled()` handler logs its decision instead of pushing. Verified every booking rule and both cron branches against a local D1.
