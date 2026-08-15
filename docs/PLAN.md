# wan-nee-la — Implementation plan

Delegation column: who does the task.

- **Opus (me)** — security boundaries, date math, anything where a subtle bug is silent and expensive.
- **Sonnet 5** — well-specified CRUD, views, CSS, admin screens. Needs the schema and helper signatures to already exist.
- **Haiku 4.5** — mechanical, verifiable-by-eye work: seed data, fixtures, config files, doc scaffolding.

Rule used: delegate only when the task's contract is fully pinned down by an earlier task's output. Anything a subagent would have to *decide* stays with me.

---

## Phase 0 — Prerequisites (owner, blocking for Phase 4 only)

| # | Task | Owner |
| --- | --- | --- |
| 0.1 | Create LINE Official Account + Messaging API channel at developers.line.biz | **You** |
| 0.2 | Invite the bot to the target LINE group; disable "Auto-reply" and enable "Webhook" in the OA manager | **You** |
| 0.3 | Issue a long-lived channel access token, note the channel secret | **You** |
| 0.4 | Confirm the OA plan's free monthly message allowance (see ISSUES.md #2 — this may cost money) | **You** |
| 0.5 | Cloudflare Access app on the custom hostname; note team domain + AUD tag | **You** |
| 0.6 | Decide the hostname (e.g. `leave.example.com`) | **You** |

Phases 1–3 do not block on any of these. 0.5/0.6 are only needed at first deploy; 0.1–0.4 only for Phase 4.

---

## Phase 1 — Foundation

| # | Task | Owner | Why |
| --- | --- | --- | --- |
| 1.1 | Repo scaffold: `package.json`, `tsconfig`, `wrangler.jsonc`, `.gitignore`, Hono skeleton, `/health` | **Haiku** | Mechanical; mirror a sibling Workers project's config verbatim. |
| 1.2 | D1 schema `migrations/0001_init.sql` from ARCHITECTURE.md | **Opus** | Schema is the contract every later task depends on. |
| 1.3 | `src/domain/dates.ts` — Bangkok-local today, business-day count, half-day math, holiday exclusion | **Opus** | The one place off-by-one bugs hide. Pure functions, no I/O. |
| 1.4 | `scripts/test-dates.mjs` — node test runner, table-driven cases | **Opus** writes cases → **Haiku** expands | Cases are the spec; expansion is grunt work. |
| 1.5 | `src/auth/access.ts` — Access JWT verify (JWKS fetch + cache, `aud`, `exp`, `email`) | **Opus** | Security boundary. A subagent shortcut here (trusting the header) silently exposes everyone's data. |
| 1.6 | Seed data: 4 leave types, Thai public holidays 2026 | **Haiku** | Pure data entry. Verify the holiday list against the BOT calendar afterwards. |

## Phase 2 — Core app

| # | Task | Owner | Why |
| --- | --- | --- | --- |
| 2.1 | `src/domain/leave.ts` — create/cancel/overlap/balance, all server-computed | **Opus** | Balance math + overlap rules are the app's correctness core. |
| 2.2 | `src/repo/*.ts` — D1 queries behind typed functions | **Sonnet** | Contract fixed by 1.2 + 2.1 signatures. |
| 2.3 | `GET /` global calendar view (month grid + mobile agenda) | **Sonnet** | Biggest pure-UI chunk. Give it the JSON shape and the breakpoint rule. |
| 2.4 | `public/app.css` mobile-first, 768px breakpoint | **Sonnet** | |
| 2.5 | Booking form + `POST /api/leave` (works with JS off) | **Sonnet** | |
| 2.6 | `src/client/date-picker.ts` — range pick + live day-count preview, esbuild IIFE | **Sonnet** | |
| 2.7 | `GET /me` personal dashboard: balance bars per type, upcoming/past lists | **Sonnet** | |
| 2.8 | Cancel flow | **Sonnet** | |

## Phase 3 — Admin

| # | Task | Owner |
| --- | --- | --- |
| 3.1 | `GET /admin` — users, quota editor, holiday editor, notification log | **Sonnet** |
| 3.2 | First-login auto-provision: unknown Access email → create user + seed current-year quotas | **Opus** |
| 3.3 | Year-rollover: seed next year's quotas from `leave_types.default_days` | **Sonnet** |

## Phase 4 — LINE notification

| # | Task | Owner | Why |
| --- | --- | --- | --- |
| 4.1 | `POST /line/webhook` + `X-Line-Signature` HMAC-SHA256 verify; store group ID | **Opus** | Unauthenticated public endpoint — the one route Access does not protect. Must be constant-time-compared and reject unsigned bodies. |
| 4.2 | `src/notify/line.ts` — push client, Flex payload, `X-Line-Retry-Key`, text fallback | **Sonnet** | |
| 4.3 | `scheduled()` handler + idempotency via `notification_log` | **Opus** | Double-posting to a company group is the loudest possible bug. |
| 4.4 | `POST /admin/notify/test` — dry-run preview + manual send | **Sonnet** | |
| 4.5 | Cron `0 1 * * *` in `wrangler.jsonc`; verify with `wrangler dev --test-scheduled` | **Opus** | |

## Phase 5 — Ship

| # | Task | Owner |
| --- | --- | --- |
| 5.1 | `npm test` aggregate script | **Haiku** |
| 5.2 | GitHub Actions: typecheck + test on PR, deploy on main | **Haiku** |
| 5.3 | README: setup, secrets, LINE onboarding, Access config | **Haiku** drafts → **Opus** reviews |
| 5.4 | Deploy, smoke-test on phone + laptop, watch the first real 08:00 run | **Opus** |

---

## Delegation summary

| Owner | Tasks | Share |
| --- | --- | --- |
| Opus | 1.2, 1.3, 1.4(spec), 1.5, 2.1, 3.2, 4.1, 4.3, 4.5, 5.4 | ~35% |
| Sonnet 5 | 2.2–2.8, 3.1, 3.3, 4.2, 4.4 | ~45% |
| Haiku 4.5 | 1.1, 1.4(expand), 1.6, 5.1, 5.2, 5.3 | ~20% |

Kept in-house on purpose: **1.5** (auth), **4.1** (webhook signature), **4.3** (idempotency), **1.3/2.1** (date + balance math). Everything else has a contract tight enough to hand off.

Parallelism: 2.3/2.4 (calendar UI) and 4.2 (LINE client) are independent — can run as concurrent subagents once 1.2 and 2.1 land.

## Build order

`1.1 → 1.2 → 1.3+1.5 → 1.6 → 2.1 → 2.2 → 2.3–2.8 → 3.x → 4.x → 5.x`

Usable milestone after Phase 2: calendar + booking + balances working behind Access. LINE is bolted on after, and the app is fully functional without it.
