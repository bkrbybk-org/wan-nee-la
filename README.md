# wan-nee-la (วันนี้ลา)

[![CI](https://github.com/bkrbybk-org/wan-nee-la/actions/workflows/ci.yml/badge.svg)](https://github.com/bkrbybk-org/wan-nee-la/actions/workflows/ci.yml)

Employee leave tracker on Cloudflare Workers. "wan nee la" is Thai for *on leave today*.

- Global calendar — who is out, which day. A month grid at every width: names on a laptop, dots on a phone. Click a day to book it, click an entry to open it, drag an entry to move it.
- Self-serve booking with half-day granularity, and a note that is private unless you share it. Edit or remove afterwards, undo a cancel or a move within ten minutes; every change is recorded. A refused booking comes back to the form with what you typed and the offending field marked.
- Personal dashboard — days remaining per leave type. An upcoming sidebar on the calendar, and a month/year jump for planning further out.
- A 09:00 Asia/Bangkok notification on weekdays, only on days someone is away — "วันนี้ Mai, Nok ลา" — to subscribed browsers (free). A LINE group post is built too but off by default (billed per member). A week-ahead post on Mondays.
- Behind Cloudflare Access. Material 3 interface in English or Thai, mobile and laptop layouts, System/Light/Dark themes.

Hono + Hono JSX (SSR) + D1. No frontend framework; the client bundle is ~10kb of progressive enhancement and every page works without it.

## Setup

Needs Node 24 (`.nvmrc`) — the test scripts import `.ts` directly via type stripping.

```bash
nvm use && npm install
```

`wrangler.jsonc` is committed as a **template**. Copy it and fill in your own values:

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

Edit `wrangler.local.jsonc` and replace the `REPLACE_ME_*` placeholders:

| Placeholder | Where it comes from |
| --- | --- |
| `REPLACE_ME_ACCOUNT_ID` | Cloudflare dashboard, or drop the key and export `CLOUDFLARE_ACCOUNT_ID` |
| `REPLACE_ME_HOSTNAME` | the hostname staff will use; its zone must be in the same account |
| `REPLACE_ME_DATABASE_ID` | `wrangler d1 create wan-nee-la` |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | your Access application (see Deploying) |

`wrangler.local.jsonc` is gitignored, and every npm script prefers it when present. That keeps one company's account, hostname and Access application out of a public clone.

## Local development

```bash
npm run db:init && npm run db:seed
```

Cloudflare Access cannot run locally, so create `.dev.vars` (gitignored) to log in as a fixed user:

```bash
printf 'DEV_AUTH_BYPASS=1\nDEV_EMAIL=you@example.com\n' > .dev.vars
```

> `DEV_AUTH_BYPASS=1` skips identity verification entirely. It is for `wrangler dev` only — in production it would hand every visitor a session as `DEV_EMAIL`. `/health` reports whether it is on.

```bash
npm run dev
```

The first account to sign in becomes the admin.

## Checks

```bash
npm run typecheck && npm run lint && npm test
```

`npm test` runs six suites — date arithmetic, booking rules, the LINE digest,
Web Push against RFC 8291's worked example, holiday-list parsing, and the
string catalogue's own health — then checks that `public/openapi.yaml` accounts
for every route, that the committed `public/openapi.json` still matches it
(`npm run build:spec` regenerates it), and that the API Shield copy still
builds from it.

`npm run lint` is ESLint, tuned to the existing style rather than reshaping it.
CI runs it.

`npm run test:smoke` additionally boots a worker against a scratch database and
exercises the HTTP layer over all 31 routes — CSRF, ownership checks, note
visibility across two identities, booking rules, the audit trail, security
headers, the digest's decisions and the LINE webhook signature. It needs no
secrets and makes no outbound calls. Every `check(` and `eq(` written in the
file has to actually run, so a section that dies early fails the suite by name.

`node scripts/palette.mjs` regenerates the Material 3 colour roles, checks every
pair the stylesheet paints against WCAG AA, and fails if the values in
`public/app.css` are not the ones it generates. CI runs it.

CI runs the same checks on every push and pull request, plus a client and Worker build, and asserts that no local-only file or credential-shaped string has been committed. It needs no secrets, so it also runs on pull requests from forks.

To fire the scheduled handler by hand against `npm run dev`:

```bash
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

It logs one JSON line per job. On a weekend or a public holiday that line says
so rather than sending — which is the expected result, not a failure.

## Deploying

```bash
npm run db:init:remote && npm run db:seed:remote && npm run deploy
```

That is the first deploy. After it, ship with:

```bash
npm run ship
```

which runs every local check, deploys only if they all pass, then checks
production — the new version is the one serving, Access still fronts `/health`
and `/`, and production D1 answers a read. It stops at the first failure. Run
from a git worktree, it borrows `wrangler.local.jsonc` from the main checkout
for the deploy and removes it afterwards. A migration is named, never inferred,
since D1 here keeps no record of which files have run:

```bash
npm run ship -- --migrate migrations/0011_leave_type_active.sql
```

**Every deploy replaces the Worker's vars with the ones in
`wrangler.local.jsonc`.** A var changed in the dashboard, or by a deploy from
another copy of the config, is silently overwritten (docs/ISSUES.md #40). Keep
that file the one source of truth, and read the "differs from the remote
configuration" warning a deploy prints.

Then, in order:

1. Create a **Cloudflare Access** application on your hostname. Put its team domain and AUD tag into `wrangler.local.jsonc` and redeploy. The app fails closed while they are empty, so nothing is served until this is done.
2. Leave `workers_dev` at `false`. Access protects the custom hostname only, so a `workers.dev` route would be an unauthenticated bypass to everyone's leave data. Verify after deploying: the `workers.dev` URL must 404.
3. Check `/health` — `accessConfigured` must be `true` and `devAuthBypass` must be `false`. It answers 503 if D1 is unreachable.
4. Sign in. **Whoever signs in first becomes the admin**, so make sure it is the right person.
5. Optionally, watch it. `.github/workflows/uptime.yml` checks `/health` every 15 minutes once the `HEALTH_URL` secret is set, and a failed run emails you. Access has to let it through: either a **Bypass** rule on `/health`, or an Access service token in the `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` secrets.

## Turning on the LINE post

Optional — the app is fully functional without it, and the channel is **off by default** behind `LINE_ENABLED`: an absent variable never starts it sending. LINE Notify was shut down on 2025-03-31, so this uses the Messaging API.

1. Create a LINE Official Account with a Messaging API channel, invite the bot to the group, and in the OA Manager disable Auto-reply and enable Webhook.
2. Set the webhook URL to `https://<your-host>/line/webhook`, and add an Access **Bypass** rule for that path — otherwise LINE's requests are sent to the login page and the group id is never captured.
3. Set the two secrets. They never go in a config file:
   ```bash
   wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   ```
   ```bash
   wrangler secret put LINE_CHANNEL_SECRET
   ```
4. Post any message in the group. The webhook captures the group id; `/admin` will show it.
5. Set `"LINE_ENABLED": "1"` in `wrangler.local.jsonc` and redeploy. Until then `/admin` reports the channel as switched off, whatever the secrets say.
6. Drop the "Not enabled yet" wording from the LINE tag and operation in `public/openapi.yaml`, then `npm run build:spec`. `/docs` says the channel is off until you do.
6. Use **Preview** on `/admin`, then **Send now**.

LINE bills a group push **per member**, so a 20-person group posted to daily is ~600 messages a month. The job skips weekends, public holidays, and days with nobody on leave. See [docs/ISSUES.md](docs/ISSUES.md) #2.

## Turning on browser notifications

Optional, free, and independent of LINE: subscribers get a notification at 09:00 on weekdays when someone is away — titled `วันนี้ <names> ลา`, three names then a count — from the same job that would post to LINE. Days nobody is away send nothing.

1. Generate a VAPID keypair. Once, ever — regenerating it silently invalidates every existing subscription, because a browser binds its subscription to the key that created it.

   ```
   npm run vapid
   ```

2. Put the **public** key and a contact address in `wrangler.local.jsonc`. The public key is not a secret; every subscribing browser is given it.

   ```jsonc
   "VAPID_PUBLIC_KEY": "B...",
   "VAPID_SUBJECT": "mailto:you@example.com"
   ```

3. Store the **private** key as a secret. Anyone holding it can push to every subscriber.

   ```
   npx wrangler secret put VAPID_PRIVATE_KEY --config wrangler.local.jsonc
   ```

4. Deploy, then open `/me` and turn notifications on. **Send a test** proves the whole path without waiting for 09:00.

Leave `VAPID_PUBLIC_KEY` empty to keep the feature off: the card disappears from `/me` and the digest skips the channel.

Once notifications actually reach a phone, drop the "Not enabled yet" wording from the Push tag and its three operations in `public/openapi.yaml` and run `npm run build:spec`.

**On iPhone and iPad** this only works from an installed web app — Share → *Add to Home Screen*, then turn notifications on from there. Safari tabs have no Push API at all (docs/ISSUES.md #21). Android Chrome works in an ordinary tab.

## Cloudflare API Shield

`public/openapi.yaml` is OpenAPI 3.1. API Shield's schema validation accepts
only 3.0.x — uploading the 3.1 file fails with `cannot unmarshal !!seq into
string`. Upload the derived copy instead:

```bash
npm run openapi:shield
```

That writes `dist/openapi-shield.json`: OpenAPI 3.0.3, the seven JSON
operations, request schemas only (API Shield does not validate responses), and
`servers` set to your real hostname from `wrangler.local.jsonc`. It names the
hostname, so it stays in the gitignored `dist/`. `npm test` builds it from the
spec on every run, so a 3.1-only construct fails there rather than in the
dashboard.

The other 24 routes — HTML pages and form posts — are deliberately not in the
spec. So do **not** deploy API Shield's fallthrough rule ("mitigate requests to
unidentified endpoints") on this hostname: it would block the whole app.
An uploaded schema only *detects*: it sets
`cf.schema_validation.uploaded.violated` and blocks nothing. Enforcement is a
WAF custom rule on that field, scoped to this hostname — start it on **Log**,
switch to **Block** once the log is quiet.

```bash
npm run shield:probe
```

sends ~20 anonymous requests to production, a schema-compliant and a
schema-breaking one per operation, and prints each one's status and Ray ID.
Nothing it sends can change data. Compliant requests should get Access's 302;
with a blocking rule in place, breaking ones get a 403 from the edge instead.
On Log, both look the same from outside — look the Ray IDs up in Security →
Analytics.

## Docs

| File | What |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, auth model, D1 schema, routes, notification flow, bindings |
| [docs/PLAN.md](docs/PLAN.md) | Forward backlog, with an owner per item |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Current state, decisions log, what was verified |
| [docs/ISSUES.md](docs/ISSUES.md) | Open risks, accepted trade-offs, unresolved questions |
