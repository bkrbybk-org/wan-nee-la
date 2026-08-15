# wan-nee-la — Issues, risks, open questions

Status: `open` | `resolved` | `accepted` (known, living with it)

---

## #1 — LINE Notify is dead. Messaging API is the only path. `resolved`

LINE Notify terminated **2025-03-31**; all API access ended 2025-04-01 and the docs site was removed 2025-05-12. Any tutorial using a `notify-api.line.me` token no longer works.

Replacement: LINE Messaging API push.

```
POST https://api.line.me/v2/bot/message/push
Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>
X-Line-Retry-Key: <uuid>
{ "to": "<groupId>", "messages": [ ... ] }
```

Consequences vs. the old Notify flow:
- Needs a LINE Official Account + Messaging API channel, not a personal token.
- The bot must be **invited to the group**; it can only push to groups it belongs to.
- The group ID is not visible in the LINE app. It arrives in a webhook event (`join`, or any `message` event from the group) as `source.groupId`. Hence the `/line/webhook` route — capture it once, store in `app_config`, done.
- Push is metered; Notify was free. See #2.

Sources: [End of service for LINE Notify](https://notify-bot.line.me/closing-announce), [Messaging API overview](https://developers.line.biz/en/docs/messaging-api/overview/)

---

## #2 — LINE push cost: messages are billed **per group member**, not per message `open`

LINE counts a push to a group as one message *per person in the chat*. A push with 4 message objects to a 5-person group = 5 messages counted.

So a daily 08:00 post to a group of N people costs **N × (days with leave)** per month, not 30.

| Group size | Worst case (30 posts/mo) |
| --- | --- |
| 10 | 300 |
| 20 | 600 |
| 40 | 1,200 |

Free allowance depends on the OA subscription plan and **varies by country** — Thailand's plan tiers differ from Japan's. Must be checked in the LINE OA Manager for the actual account (task 0.4).

Mitigations already in the design:
1. **Skip the push when nobody is on leave** (ARCHITECTURE.md, step 4). Realistically cuts volume 30–50%.
2. Skip weekends and company holidays entirely.
3. One push per day, never per-person.

If the allowance still doesn't fit: fall back to a Cloudflare Email Service digest, or upgrade the OA plan. Decide after 0.4.

Source: [Messaging API pricing](https://developers.line.biz/en/docs/messaging-api/pricing/)

---

## #3 — `workers.dev` route is an auth bypass `resolved by design`

Cloudflare Access protects the custom hostname only. If `workers_dev` is left on, `wan-nee-la.<sub>.workers.dev` serves every employee's leave data with no auth at all.

`wrangler.jsonc` must set `"workers_dev": false` and route via `custom_domain`. Same trap as a sibling Workers project. Verify after every deploy: the workers.dev URL must 404.

---

## #4 — `/line/webhook` is the one route Access cannot protect `open`

LINE's servers must reach it, so it has to sit outside the Access policy (Access Bypass rule for that path, or a separate hostname).

Therefore the route defends itself:
- Verify `X-Line-Signature` = base64(HMAC-SHA256(raw body, channel secret)) before parsing anything.
- Constant-time compare.
- Reject any unsigned request with 401 — never "log and continue".
- Read the raw body **once**, before `c.req.json()`; re-reading a consumed stream silently yields an empty body and the signature will pass over nothing.
- The only state it may write is the group ID. Nothing else.

---

## #5 — Timezone off-by-one `resolved`

Workers run in UTC. Bangkok is UTC+7, no DST, ever.

- `new Date().toISOString().slice(0,10)` inside the cron at 01:00 UTC gives the **correct** Bangkok date only by luck of the offset — but at 17:00–23:59 UTC it gives yesterday's Bangkok date. Any admin action in that window would misfile.
- Fix: one helper `bangkokToday()` in `src/domain/dates.ts`, used everywhere. No raw `new Date()` for date logic anywhere else.
- Store dates as `YYYY-MM-DD` strings. Never `Date` objects, never UTC timestamps, for leave dates.

Done. `bangkokToday()` is the only clock read; `scripts/test-dates.mjs` pins the 16:59/17:00 UTC boundary, the 01:00 UTC cron hour, and the 31 Dec 18:00 UTC year rollover. Still worth a lint rule if `new Date()` starts creeping back into other modules.

---

## #6 — Half-day arithmetic `resolved`

`start_half`/`end_half` ∈ `full | am | pm`. The model was narrowed to keep it checkable:

- **Single day** (`start == end`): both halves must match. `full` → 1, `am`/`pm` → 0.5. A mismatched pair is rejected rather than guessed at.
- **Multi-day**: `start_half ∈ full | pm`, `end_half ∈ full | am`. The other combinations are meaningless and are rejected.

Covered by tests, including the cases that are easy to get wrong:

- `start_half = 'pm'` Friday → `end_half = 'am'` Monday = 1.0 days, weekend excluded.
- A half on a day that never counted (PM start on a Saturday, AM end on a Sunday) discounts nothing.
- A range with no workdays at all is rejected, not booked as 0 days.
- A range crossing New Year counts only its workdays.

The booking form hides the combinations the server rejects, so the rule is enforced in one place and merely reflected in the UI.

---

## #7 — Concurrent booking / double-spend of quota `accepted`

Two tabs submitting at once could both pass the balance check and overdraw the quota. D1 has no `SELECT … FOR UPDATE`.

Accepted for v1: the window is milliseconds, the population is small, and an overdrawn balance is visible and correctable in `/admin`. If it ever bites, the fix is a `UNIQUE` guard plus a re-check inside a D1 batch.

---

## #8 — Retroactive cancellation still reclaims quota `open — needs owner decision`

Self-serve with no approval means a user can cancel leave that has already been taken and get the days back. Nothing currently stops it.

Partial mitigations already in place:

- Booking is limited to `MAX_BACKDATE_DAYS = 90` days in the past (`src/domain/leave.ts`), so history cannot be rewritten arbitrarily far back.
- Cancellation is a soft delete: `status` flips to `cancelled` and `cancelled_at` is stamped, so the row survives for an audit.

Not fixed: cancelling a *past* booking is still allowed and still returns the days.

Options: (a) allow it, trust people; (b) block cancelling a booking whose end date has passed, admin override only; (c) allow but surface it in an admin audit view.

Leaning (b). Needs the owner's call — it is a policy question, not a technical one.

---

## #9 — Access email vs. display name `resolved`

The Access JWT gives an email, no name. First login auto-provisions the user with a name derived from the email local-part: `chatchai.w@…` → "Chatchai W". Good enough to render, and the user can correct it on `/me` under "Display name". Nothing blocks on it.

Related: **the first user to sign in becomes an admin**, because otherwise a fresh deployment has nobody who can reach `/admin` to promote anyone. Make sure the first sign-in is the right person. A last-admin guard then prevents that account from demoting or deactivating itself while it is the only admin.

---

## #10 — Thai public holidays are announced yearly, sometimes mid-year `open`

Substitution days and special government holidays get announced with weeks of notice. A hardcoded 2026 list will drift.

Hence the `holidays` table + admin editor, not a constant in the source.

`migrations/0002_seed.sql` seeds **fixed-date holidays only** — the rest of 2026 and all of 2027. Deliberately absent, because guessing them would be worse than leaving them out:

- Buddhist lunar holidays: Makha Bucha, Visakha Bucha, Asahna Bucha, Khao Phansa.
- Substitution days when a holiday falls on a weekend.
- Special one-off government holidays.

Add those via `/admin` → Holidays. A missing holiday is not cosmetic: leave booked across it silently costs the employee a day of quota.

---

## #15 — WAF blocked the post-booking redirect `resolved`

**Symptom**: booking leave in a browser landed on a Cloudflare block page.

**Cause, ours not theirs.** The app used post-redirect-get with the message in the query string:

```
GET /?ok=Booked%205%20day(s)%20of%20annual%20leave.
```

The zone's custom rule `<rule-id>` — "Block Attacks (WAF Attack Score ≤ 20)" — scored that as an injection probe. Free prose in a query string carries the same punctuation as an attack payload: parentheses, colons, periods, percent-encoding. Confirmed against `firewallEventsAdaptive`: ray `<ray-id>`, `GET /`, browser user-agent, action `block`.

**Fix**: the message now travels in a short-lived cookie (`wnl_flash`, 30s, HttpOnly, Secure, SameSite=Lax, base64url-encoded), and the redirect target is a bare path. A flash is read once and the cookie expired on the same response, so it never resurfaces on refresh.

The WAF rule was right and was left alone. A flash message is UI state, not addressable content — it never belonged in a URL. The base64url encoding also keeps punctuation out of the cookie header, so the payload cannot trip the same rule from its new home.

**Watch for this again** anywhere user-visible prose would end up in a URL. Nothing in the app does that now.

---

## #13 — Zone rules override the Worker's security headers `open — owner's call`

The Worker sets `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. Production serves `SAMEORIGIN` and `same-origin`.

Confirmed not an app bug: the same build on `wrangler dev` emits `DENY` / `no-referrer`, so something on the `example.com` zone — a Transform Rule or managed header setting — is rewriting them downstream. `X-Robots-Tag` and `X-Content-Type-Options` pass through untouched.

Impact is mild: `SAMEORIGIN` still blocks third-party framing, and `same-origin` still withholds the referrer cross-origin. But the app cannot enforce its own header policy, and it would be worth knowing that before relying on any header this Worker sets.

Owner's call: leave it, or find the zone rule and exempt this hostname. Fighting it from the Worker is not possible — the rewrite happens after the response leaves.

---

## #14 — Service tokens cannot use the app `resolved by design`

An Access service token authenticates fine at the edge but carries `common_name`/`sub` and no `email` — it identifies a machine. wan-nee-la is a per-person leave record, so admitting one would create a user row named after a credential, with its own quota and balance.

`verifyAccessJwt` returns a typed `Rejection` for this case rather than a bare `null`, so the app can say "this is a valid service token, not a person" instead of "failed verification" — the latter sends people hunting a signature bug that does not exist.

Consequence for testing: **production cannot be smoke-tested end to end with a service token.** Anything past the identity check needs a real browser session. Worth remembering before writing a synthetic uptime check against `/` — use `/health`, which sits above the auth middleware.

---

## #11 — No CSRF token, only an Origin check `accepted`

Cloudflare Access authenticates but does not stop a cross-site form POST — its cookie rides along. `src/index.tsx` rejects any non-GET whose `Origin` host differs from the `Host` header.

Accepted rather than a token scheme because every mutation here is a same-origin form submit, and browsers have sent `Origin` on cross-site POSTs for years. The gap: a request with **no** `Origin` header at all is allowed through, which keeps non-browser clients (curl, the tests above) working. Revisit if this ever gets a public or API-key surface.

---

## #12 — Concurrent-safe? Only as far as D1 allows `accepted`

Restating #7 with what shipped: the balance check and the insert are separate statements, so two simultaneous submits can both pass. See #7 — same reasoning, still accepted for a small team.

Cancellation *is* safe: the `UPDATE … WHERE status = 'confirmed'` guard makes a double submit a no-op rather than a second write.
