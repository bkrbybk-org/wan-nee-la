# wan-nee-la — Plan

The original build plan (phases 0–5) is delivered and has been removed; what it
produced is described in [PROGRESS.md](PROGRESS.md). This is the forward plan,
rewritten 2026-08-16 after a security review and a technical-debt sweep, and
brought back in line with the code on 2026-09-13, 2026-09-18 and 2026-09-19.

## How work is assigned

- **Owner** — decisions about company policy, and anything needing a credential or a console.
- **Opus** — security boundaries, date and balance arithmetic, anything where a wrong answer is silent.
- **Sonnet 5** — well-specified changes whose contract is already pinned down by existing code.
- **Haiku 4.5** — mechanical, verifiable-by-eye work: config, seed data, doc scaffolding.

The rule that has held so far: delegate when the contract is fixed; keep anything a subagent would have to *decide*. Two early cases proved it — a subagent's "this week" summary was correct to spec and useless in practice, and a subagent implementing the smoke harness would have had no way to know that a suite passing without testing anything is the real risk.

A third, from 2026-09-01: three agents dispatched in isolated worktrees were branched from a commit one behind `main`, and one of them correctly reported that its spec contradicted the code it could see. The contract was fixed; the base it was read from was not. Check what a worktree is branched from before dispatching into it.

---

## 1. Blocking real use — Owner

Nothing here needs code.

| # | Task | Why it blocks |
| --- | --- | --- |
| ~~1.1~~ | ~~Sign in through a browser~~ | **Done.** Ten active users; the first became the admin. |
| 1.2 | Switch on LINE, if wanted | Off by default behind `LINE_ENABLED` since 2026-09-06. Channel, bot in the group, Access **Bypass** rule on `/line/webhook`, two `wrangler secret put` calls, then `"LINE_ENABLED": "1"` and a redeploy. Steps in the [README](../README.md#turning-on-the-line-post). |
| 1.3 | Check the LINE message allowance | Billing is per group member. ~600 messages/month for a 20-person group, and the free tier varies by country ([ISSUES.md](ISSUES.md) #2). Moot while 1.2 stays off. |
| 1.4 | **Prove a push arrives** ([ISSUES.md](ISSUES.md) #23, #31) | The keys are paired again as of 2026-09-21 (#40), but nothing has ever been delivered: nobody has subscribed. Sign in, turn notifications on from `/me`, press **Send a test**. If a push service rejects it, the status and body are surfaced verbatim — a placeholder `VAPID_SUBJECT` is the likeliest complaint, and `npm run vapid` plus two `wrangler secret put`/config edits would replace the pair outright. On iPhone the site must be installed to the Home Screen first (#21). |

---

## 2. Decisions needed — Owner, then Opus implements

These are policy questions. Each has a recommendation; none should be decided by me alone.

| # | Question | Recommendation |
| --- | --- | --- |
| ~~2.1~~ | ~~**Leave notes are readable by everyone** ([ISSUES.md](ISSUES.md) #17).~~ | **Done:** per-note choice, private by default. |
| ~~2.2~~ | ~~**No audit trail on retroactive changes** ([ISSUES.md](ISSUES.md) #8).~~ | **Done:** `leave_audit`, written in the same batch as each change. |
| 2.3 | **Nothing monitors the deployment** ([ISSUES.md](ISSUES.md) #18). | **Monitor built** (2026-09-18): `.github/workflows/uptime.yml`, every 15 minutes. Needs the `HEALTH_URL` secret, and a way past Access — a Bypass rule on `/health`, or a service token in `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`. The token keeps `/health` private; the Bypass is simpler. |
| 2.4 | **Retire Personal leave?** ([ISSUES.md](ISSUES.md) #39). Asked to be removed, but it has one confirmed booking, so it cannot be deleted without hiding that day. | **Mechanism done** (2026-09-18): `/admin` → Leave types → untick *offered* → **Save**. Left to the owner because it changes what everyone can book. |

---

## 3. Security

The 2026-08-16 review found **no critical and no high-severity issues**. SQL is parameterised throughout, Hono JSX escapes children and attributes, ownership is gated centrally before any row is read or written, admin routes sit behind one middleware, the open-redirect guard holds, and the JWT verification pins RS256 and checks `aud`, `exp`, `iss`.

| # | Task | Who | Notes |
| --- | --- | --- | --- |
| ~~3.1~~ | ~~Act on the notes decision (2.1)~~ | — | **Done:** per-note choice, private by default, filtered in the route. |
| ~~3.2~~ | ~~Audit trail (2.2)~~ | — | **Done:** see 2.2. Undo (2026-09-01) added a `restored` action, re-authorises through `ownedLeave`, and re-runs the booking rules before any restore. |
| ~~3.3~~ | ~~Consider a Content-Security-Policy header~~ | — | **Done:** CSP with the inline theme script allowed by hash, plus `no-store` on HTML and the other headers (ISSUES #30). |

---

## 4. Technical debt

Nothing here is urgent. Ordered by cost-to-benefit.

| # | Task | Who | Detail |
| --- | --- | --- | --- |
| ~~4.1~~ | ~~Stop writing on every request~~ | — | **Done** (2026-09-01): gated on a read that compares a user's quota rows against the number of leave types, so a new year *and* a type added mid-year still seed. |
| ~~4.2~~ | ~~Fix the `/admin` N+1~~ | — | **Done:** `listQuotasForYear`, one query. |
| ~~4.3~~ | ~~Extend smoke coverage~~ | — | **Done:** all 32 routes. Current counts in [PROGRESS.md](PROGRESS.md#verification). |
| ~~4.4~~ | ~~Prune `notification_runs` and `leave_audit`~~ | — | **Done** (2026-09-18): the cron keeps audit rows three years and notification runs 90 days (ISSUES #26). |
| ~~4.5~~ | ~~Correct `ARCHITECTURE.md` schema drift~~ | — | **Done:** the schema block is the one the migrations actually produce, checked against a migrated database. |
| ~~4.6~~ | ~~Add a formatter and linter~~ | — | **Done:** ESLint with typescript-eslint and @stylistic, tuned to pass on the existing code with zero reformatting. Prettier was tried and cannot reach zero-diff here — the codebase's line breaks are editorial, not width-driven. See 4.10. |
| ~~4.7~~ | ~~Cache `leave_types`~~ | — | **Done:** memoised per request on the Hono context — deliberately not a module global, which would outlive the request and serve stale types. |
| ~~4.8~~ | ~~Bump Hono~~ | — | **Done** (2026-09-18): `^4.13.8`. Wrangler went to `^4.135.0` in the same pass, to clear a HIGH advisory in its bundled `sharp` that the CI Trivy gate would have failed on. |
| ~~4.9~~ | ~~Make the smoke assertion floor self-maintaining~~ | — | **Done** (2026-09-18): the hand-kept count is gone. Every line that calls `check(` or `eq(` must run, and a miss is reported by line number. |
| ~~4.10~~ | ~~Run `npm run lint` in CI~~ | — | **Done** (2026-09-18), beside Typecheck (ISSUES #38). |
| 4.11 | Show the push title in the admin preview | **Sonnet** | `/admin` → Preview renders the digest body, not the `วันนี้ … ลา` title a phone actually shows. |
| ~~4.12~~ | ~~One command for the release order~~ | — | **Done** (2026-09-18): `npm run ship` — local checks, then deploy, then production checks, stopping at the first failure. Docs, commit and push stay manual on purpose. |
| 4.14 | Keep the API Shield schema current automatically | **Owner** then **Sonnet** | Uploaded by hand today, so changing what a JSON operation accepts can silently start 403-ing real requests. `ship` could upload `dist/openapi-shield.json` through the API, or refuse when it differs from the active schema. Needs an API token with API Gateway permission, which is the owner's to create. |
| 4.13 | Warn on config drift before deploying | **Sonnet** | `wrangler deploy` overwrites Worker vars and only warns (ISSUES #40). `ship` could compare `wrangler.local.jsonc` against the live version's vars first and refuse on a difference. |

---

## 5. Features

None of these are needed for the app to do its job. Rough value order.

| # | Feature | Who | Notes |
| --- | --- | --- | --- |
| 5.1 | iCal feed | **Opus** then **Sonnet** | Leave appears in Google Calendar or Outlook. Calendar clients cannot do SSO, so it needs a per-user signed-token URL exempted from Access — the auth design is mine, the rest is not. |
| 5.2 | CSV export for HR | **Sonnet** | Leave taken per person per type over a date range. |
| ~~5.3~~ | ~~Look-ahead in the LINE digest~~ | — | **Done:** a Monday week-ahead post, on both channels. |
| 5.4 | Team grouping and filtering | **Sonnet** | The calendar shows everyone. Worth doing when the roster makes it unreadable, not before. |
| ~~5.5~~ | ~~Coverage warnings~~ | — | **Done:** shown under the booking form, roster-wide; see 5.8. |
| 5.6 | Deploy on merge to main | **Opus** | Deliberately not set up: it puts a Cloudflare API token and the infrastructure ids into repository settings for a public repo. Revisit when more than one person merges. |
| 5.7 | Carry-over of unused leave | **Owner** then **Opus** | An explicit v1 non-goal. Confirm before January. The ledger underneath is now sound — since 2026-09-09 leave is charged to the year it starts in, a year with no quota rows falls back to `default_days`, and moving a booking across New Year is checked against the year it lands in — so carry-over would be an adjustment on a correct per-year balance rather than a repair of one. |
| 5.8 | Sharpen the coverage warning with teams | **Sonnet** | It counts the whole roster ("3 of 4 away"). With 5.4 it could count the people who actually cover for each other. |
| ~~5.9~~ | ~~An admin UI for leave types~~ | — | **Done** (2026-09-18): add, edit, retire, and delete a type nobody has booked. |

---

## Suggested order

1. **1.4** — re-pair the push keys (ISSUES #40), then **Send a test**. Closes #23 and #31, the last unverified claims in the repo.
2. **2.3** — `HEALTH_URL` plus a Bypass rule or service token, so the monitor starts watching.
3. **2.4** — retire Personal leave from `/admin`, if that is still wanted.
4. **4.13** — make `ship` refuse on config drift, so #40 cannot happen twice.
5. **1.2 / 1.3** — LINE, only if browser notifications turn out not to be enough.
6. Features, as they are actually wanted.
