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

## #8 — Retroactive edit/cancel still reclaims quota `open — needs owner decision`

Self-serve with no approval means a user can edit or cancel leave that has already been taken and get the days back. Nothing stops it, and the owner has since asked for edit and remove to be available on every booking, so the surface is now wider than when this was first written.

Mitigations in place:

- `MAX_BACKDATE_DAYS = 90` applies to edits as well as new bookings, so a booking cannot be *moved* further back than that either.
- Cancellation is a soft delete: `status` flips to `cancelled`, `cancelled_at` is stamped, the row survives.

Still true, and now on more paths: a past booking can be shortened, retyped, or removed, and the days come back.

Not fixed, and **deliberately not decided unilaterally** — this is a policy question about how much the company trusts self-reporting, not a technical one.

Options: (a) allow it, trust people; (b) freeze bookings whose end date has passed, admin override only; (c) allow but write an audit row on every edit and cancel, surfaced in `/admin`.

Leaning (c) now rather than (b): the owner explicitly wants correction to be easy, and an audit trail preserves that while making retroactive changes visible. Note that an edit currently overwrites the old values with no record of what they were, so (c) needs a new table.

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

Consequence for testing: **production cannot be smoke-tested end to end with a service token.** Anything past the identity check needs a real browser session.

Correction to an earlier note here: `/health` is *not* usable for an anonymous uptime check either. It sits above the app's own auth middleware, but Cloudflare Access fronts every path, so an unauthenticated monitor gets a 302 to the login page — verified against production. A monitor needs either an Access Bypass rule on `/health` or an Access service token. See #18.

---

## #11 — No CSRF token, only an Origin check `accepted`

Cloudflare Access authenticates but does not stop a cross-site form POST — its cookie rides along. `src/index.tsx` rejects any non-GET whose `Origin` host differs from the `Host` header.

Accepted rather than a token scheme because every mutation here is a same-origin form submit, and browsers have sent `Origin` on cross-site POSTs for years. The gap: a request with **no** `Origin` header at all is allowed through, which keeps non-browser clients (curl, the tests above) working. Revisit if this ever gets a public or API-key surface.

---

## #12 — Concurrent-safe? Only as far as D1 allows `accepted`

Restating #7 with what shipped: the balance check and the insert are separate statements, so two simultaneous submits can both pass. See #7 — same reasoning, still accepted for a small team.

Cancellation *is* safe: the `UPDATE … WHERE status = 'confirmed'` guard makes a double submit a no-op rather than a second write.

---

## #16 — The repo is public, so infrastructure ids stay out of it `resolved`

The remote is a public GitHub repository. Nothing in the app is a credential — the Access team domain and AUD tag are readable from the unauthenticated login redirect, and the account, database and zone ids are inert without account access. But together they point at exactly which host holds a given company's leave data, and scanners found the hostname within minutes of its DNS record appearing, probing `.env`, `.git/HEAD` and `.ssh/id_rsa`.

So:

- `wrangler.jsonc` is committed as a template with `REPLACE_ME_*` placeholders.
- Real values live in `wrangler.local.jsonc`, gitignored. Every npm script prefers it and falls back to the template, so a fresh clone builds and a configured checkout deploys.
- Docs use placeholders (`<account-id>`, `<hostname>`, `<team>.cloudflareaccess.com`).
- CI fails if `.dev.vars`, `wrangler.local.jsonc` or the built bundle are ever tracked. Its patterns are generic on purpose: naming this company's hostname in a CI rule would put it back in the public repo.

**History was rewritten** on 2026-08-15 to purge those values from all earlier commits, including one commit message, and force-pushed. Caveat recorded at the time: GitHub keeps unreferenced commits reachable by direct SHA until it garbage-collects, so the old objects were not instantly destroyed. There were 0 forks and 0 clones, and the SHAs are no longer discoverable through any branch. Deleting and recreating the repository is the only way to remove them with certainty.

---

## #17 — Leave notes are visible to everyone, not just the booker `open — needs owner decision`

The optional free-text note on a booking is shown to **every** authenticated user, not only the owner and admins. It reaches them three ways: the chip's `title` tooltip, the `data-note` attribute the detail popup reads, and the `note` field in `GET /api/leave`.

Verified live: a user who is neither the booker nor an admin loaded the calendar and the JSON feed and saw a note reading "oncology follow-up" in both.

This may well be intended — it is a shared team calendar, and context for an absence is often the point. But two things suggest the exposure was not thought through:

- The LINE digest deliberately omits notes, so the spread was clearly considered somewhere.
- The comment above `entryData()` claimed these attributes "carry only what is already visible on the calendar", which was false: the grid cell shows a name, the note shows whatever the person typed. That comment has been corrected to point here.

The risk is that notes are exactly where someone writes a medical or family detail, because the field is right there and looks incidental.

Options: (a) leave it — a shared calendar, and people can simply not write anything private; (b) show the note only to its owner and admins; (c) keep it public but relabel the field and add a hint that everyone can read it, so the choice is informed; (d) two fields, one shared and one private.

Recommendation: **(c) now, (b) if anyone objects.** (c) is small, keeps the feature's usefulness, and fixes the real problem, which is that the field does not look like a broadcast. Not decided unilaterally — this is a privacy policy question for the company, not a technical one.

---

## #18 — `/health` is not reachable for an anonymous uptime check `open`

Access fronts every path, `/health` included, so a monitor without credentials receives a 302 to the Cloudflare Access login rather than the JSON. Confirmed against production.

Options: add an Access **Bypass** rule for `/health` (it deliberately exposes nothing about who works here or when they are away — only a version string, a D1 ping and two config booleans), or point the monitor at Access with a service token.

Worth doing whichever way, because right now nothing watches this deployment.

---

## #19 — `/u/:email` confirms whether an address exists `accepted`

The per-person page returns 200 for a real user and 404 for an unknown one, so any signed-in employee can test whether an email address belongs to a colleague.

This was briefly specified as "return the same response either way", which is incoherent: the page's whole purpose is to render for people who exist. The distinction cannot be removed without removing the feature.

Accepted. Everyone who can probe it is an authenticated colleague, the staff **names** are already on the shared calendar, and the marginal gain is confirming an address someone had already guessed. If this ever matters, the fix is an opaque per-user id in the URL instead of the email — which would also keep addresses out of logs and referrers.

---

## #20 — Leave notes stay out of the per-person page `resolved by design`

`/u/:email` never renders the free-text note, for anyone, including the person themselves and admins.

The calendar already shows notes team-wide, which is #17's open question. A page that gathered one person's notes into a single chronological list would make that materially worse — scattered context across a month is not the same as a readable history of why someone was away. Until #17 is decided, this page shows schedule and nothing else.

Balances follow a different rule and are visible to the person and to admins only: "12 of 30 sick days used" is an aggregate the calendar does not reveal, and is closer to a medical fact than a scheduling one. Enforced in the route, which passes `undefined` to the view rather than letting the template decide, and covered by the smoke suite.


---

## #21 — Browser notifications need an installed web app on iPhone `accepted`

Safari exposes the Push API only to a web app added to the Home Screen. In an ordinary Safari tab there is no `PushManager` at all, so nothing on `/me` can turn notifications on — and this is still true in 2026, three years after iOS 16.4 introduced web push.

Android Chrome has no such requirement: a normal tab can subscribe.

Accepted, because the alternative is a native app. The mitigation is to say so plainly rather than show a button that cannot work: on iOS the card hides its controls and gives the Share → **Add to Home Screen** instruction instead. A web app manifest and real icons ship for exactly this reason, and the manifest link carries `crossorigin="use-credentials"` — without it the browser fetches the manifest anonymously, Access answers with a login redirect, and the app silently becomes uninstallable.

---

## #22 — A digest notification shows names on a lock screen `accepted`

The message is encrypted end to end: the push service forwards bytes it cannot read, and only the subscribed browser holds the key. What it cannot control is where the browser then displays it — a phone shows notification text on the lock screen by default, so "Somchai — Sick leave" can be read by anyone holding the handset.

Accepted. It is the same information the shared calendar shows to every colleague, and the recipient chose to subscribe. Free-text notes are never included, which is the one field that could carry something genuinely private. Anyone who would rather not have it on a lock screen can turn the notification off, or configure their phone to hide contents until unlocked.

---

## #23 — Delivery to a real push service is unverified `open`

The encryption is checked against RFC 8291's own worked example byte for byte, and the VAPID token is verified against its own key, so the bytes leaving the Worker are right. What has not been observed is a push service — FCM, Mozilla, Apple — accepting one and a device showing it.

It cannot be tested from a terminal: it needs a real browser subscription, which needs a real person granting permission. The automation browser used during development has notifications denied at the profile level.

Closing this is one click: sign in, turn notifications on from `/me`, press **Send a test**. If a push service rejects the request its status and body are surfaced verbatim in the response and in `/admin`, which is where a wrong `VAPID_SUBJECT` or a malformed key would show up.

---

## #24 — `npm run db:init` fails on a second run `open`

`migrations/0003_week_start.sql` is a bare `ALTER TABLE users ADD COLUMN week_start`, which errors with "duplicate column name" if the column is already there. Since `db:init` replays every file in `migrations/` and stops at the first failure, running it twice against the same database fails.

Harmless in practice — the schema is already correct when it happens — but it makes a real failure indistinguishable from a no-op, and it means the command cannot be used to bring an existing database up to date.

Found while checking that `0004_push.sql`, which rebuilds a table, survives being replayed; it does. The fix for 0003 is to rebuild the table the same way, or to move to a migration runner that records what it has applied.
