# wan-nee-la — Plan

The original build plan (phases 0–5) is delivered and has been removed; what it
produced is described in [PROGRESS.md](PROGRESS.md). This is the forward plan,
rewritten 2026-08-16 after a security review and a technical-debt sweep.

## How work is assigned

- **Owner** — decisions about company policy, and anything needing a credential or a console.
- **Opus** — security boundaries, date and balance arithmetic, anything where a wrong answer is silent.
- **Sonnet 5** — well-specified changes whose contract is already pinned down by existing code.
- **Haiku 4.5** — mechanical, verifiable-by-eye work: config, seed data, doc scaffolding.

The rule that has held so far: delegate when the contract is fixed; keep anything a subagent would have to *decide*. Two recent cases proved it — a subagent's "this week" summary was correct to spec and useless in practice, and a subagent implementing the smoke harness would have had no way to know that a suite passing without testing anything is the real risk.

---

## 1. Blocking real use — Owner

Nothing here needs code.

| # | Task | Why it blocks |
| --- | --- | --- |
| 1.1 | Sign in through a browser | Nobody has completed an SSO login. It cannot be tested from a terminal: a service token authenticates at the edge but carries no `email`. **Whoever signs in first becomes the admin.** |
| 1.2 | Switch on LINE, if wanted | Channel, bot in the group, Access **Bypass** rule on `/line/webhook`, then two `wrangler secret put` calls. Steps in the [README](../README.md#turning-on-the-line-post). |
| 1.3 | Check the LINE message allowance | Billing is per group member. ~600 messages/month for a 20-person group, and the free tier varies by country ([ISSUES.md](ISSUES.md) #2). |
| 1.4 | Switch on browser notifications, if wanted | `npm run vapid`, public key into `wrangler.local.jsonc`, `wrangler secret put VAPID_PRIVATE_KEY`, then turn them on from `/me` and press **Send a test**. Free, and independent of LINE. Steps in the [README](../README.md#turning-on-browser-notifications). On iPhone the site must be installed to the Home Screen first ([ISSUES.md](ISSUES.md) #21). |

---

## 2. Decisions needed — Owner, then Opus implements

These are policy questions. Each has a recommendation; none should be decided by me alone.

| # | Question | Recommendation |
| --- | --- | --- |
| 2.1 | **Leave notes are readable by everyone** ([ISSUES.md](ISSUES.md) #17). Verified: a colleague who is neither owner nor admin sees the note text in the calendar HTML and the JSON feed. | Relabel the field and warn that it is shared; restrict to owner + admin if anyone objects. The problem is not that notes are shared, it is that the field does not look shared. |
| 2.2 | **No audit trail on retroactive changes** ([ISSUES.md](ISSUES.md) #8). An edit overwrites the old values; edit, remove and drag all reach past bookings within the 90-day window. | Keep editing easy, add an audit table, surface it in `/admin`. Needs a migration. |
| 2.3 | **Nothing monitors the deployment** ([ISSUES.md](ISSUES.md) #18). `/health` is behind Access, so an anonymous check gets a 302. | Add an Access Bypass rule for `/health` — it exposes only a version string, a D1 ping and two booleans — then point a monitor at it. |

---

## 3. Security

The review found **no critical and no high-severity issues**. SQL is parameterised throughout, Hono JSX escapes children and attributes, ownership is gated centrally before any row is read or written, admin routes sit behind one middleware, the open-redirect guard holds, and the JWT verification pins RS256 and checks `aud`, `exp`, `iss`.

| # | Task | Who | Notes |
| --- | --- | --- | --- |
| 3.1 | Act on the notes decision (2.1) | **Sonnet** | Contract is fixed once the owner chooses. Touches `entryData`, the popup, and the JSON feed. |
| 3.2 | Audit trail (2.2) | **Opus** | New table plus writes on three mutation paths; getting it wrong means a trail with holes, which is worse than none. |
| 3.3 | Consider a Content-Security-Policy header | **Opus** | The theme script is inline and must run before first paint, so a CSP needs a hash or nonce. Small but easy to get subtly wrong. |

---

## 4. Technical debt

Nothing here is urgent. Ordered by cost-to-benefit.

| # | Task | Who | Detail |
| --- | --- | --- | --- |
| 4.1 | Stop writing on every request | **Sonnet** | `ensureUser` calls `ensureQuotas` on *both* branches, so every authenticated page load runs an `INSERT OR IGNORE`. Only new users and a new year need it. |
| 4.2 | Fix the `/admin` N+1 | **Sonnet** | One `listQuotas` per user ([index.tsx:524](../src/index.tsx)); 40 staff is 41 round trips. One grouped query instead. |
| 4.3 | Extend smoke coverage | **Sonnet** | 16/20 routes exercised. Untested: `/book`, `/api/leave/preview`, `/me/name`, `/admin/holiday` and its delete, and the success path of `GET /leave/:id/edit`. |
| 4.4 | Prune `notification_log` | **Haiku** | One row per day, never deleted. Drop rows older than a year in the cron. |
| 4.5 | Correct `ARCHITECTURE.md` schema drift | **Haiku** | It documents a `line_user_id` column and a partial index on `leave_requests` that the migration does not create. |
| 4.6 | Add a formatter and linter | **Haiku** | None configured. Style has been held by hand across ~20 files and four subagents; it will not survive a fifth. |
| 4.7 | Cache `leave_types` | **Sonnet** | Static seed data, re-queried on all 7 call sites per page load. |
| 4.8 | Bump Hono | **Haiku** | Pinned `^4.6.14`, current is 4.13.2. `npm audit` is clean, so this is hygiene, not a fix. |
| 4.9 | Make the smoke assertion floor self-maintaining | **Haiku** | `MIN_ASSERTIONS` is bumped by hand each time tests are added. |

---

## 5. Features

None of these are needed for the app to do its job. Rough value order.

| # | Feature | Who | Notes |
| --- | --- | --- | --- |
| 5.1 | iCal feed | **Opus** then **Sonnet** | Leave appears in Google Calendar or Outlook. Calendar clients cannot do SSO, so it needs a per-user signed-token URL exempted from Access — the auth design is mine, the rest is not. |
| 5.2 | CSV export for HR | **Sonnet** | Leave taken per person per type over a date range. |
| 5.3 | Look-ahead in the LINE digest | **Sonnet** | "Out today" plus tomorrow, or a Monday week-ahead post. Cheap now the job exists. |
| 5.4 | Team grouping and filtering | **Sonnet** | The calendar shows everyone. Worth doing when the roster makes it unreadable, not before. |
| 5.5 | Coverage warnings | **Opus** | "Three of your team are already out that day", at booking time. Depends on 5.4. The rule is a judgement call, hence Opus. |
| 5.6 | Deploy on merge to main | **Opus** | Deliberately not set up: it puts a Cloudflare API token and the infrastructure ids into repository settings for a public repo. Revisit when more than one person merges. |
| 5.7 | Carry-over of unused leave | **Owner** then **Opus** | An explicit v1 non-goal. Confirm before January, since the rule affects balances retroactively. |

---

## Suggested order

1. **1.1** — sign in. Everything else is theoretical until someone has used it.
2. **2.1** and **2.3** — the two cheap decisions: notes visibility, and something watching the deployment.
3. **4.1**, **4.2**, **4.3** — one Sonnet batch; measurable, low risk, and 4.3 protects the rest.
4. **2.2 / 3.2** — the audit trail, once the policy is settled.
5. Features, as they are actually wanted.
