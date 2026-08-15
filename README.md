# wan-nee-la (วันนี้ลา)

[![CI](https://github.com/bkrbybk-org/wan-nee-la/actions/workflows/ci.yml/badge.svg)](https://github.com/bkrbybk-org/wan-nee-la/actions/workflows/ci.yml)

Employee leave tracker on Cloudflare Workers. "wan nee la" is Thai for *on leave today*.

- Global calendar — who is out, which day. Click a day to book it, click an entry to open it, drag an entry to move it.
- Self-serve booking with half-day granularity. Edit or remove afterwards.
- Personal dashboard — days remaining per leave type.
- A LINE group post every morning at 08:00 Asia/Bangkok listing who is out.
- Behind Cloudflare Access. Mobile and laptop layouts. System/Light/Dark themes.

Hono + Hono JSX (SSR) + D1. No frontend framework; the client bundle is ~6kb of progressive enhancement and every page works without it.

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
npm run typecheck && npm test
```

CI runs the same checks on every push and pull request, plus a client and Worker build, and asserts that no local-only file or credential-shaped string has been committed. It needs no secrets, so it also runs on pull requests from forks.

To fire the morning digest by hand, run `wrangler dev --test-scheduled` and:

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=0+1+*+*+*"
```

## Deploying

```bash
npm run db:init:remote && npm run db:seed:remote && npm run deploy
```

Then, in order:

1. Create a **Cloudflare Access** application on your hostname. Put its team domain and AUD tag into `wrangler.local.jsonc` and redeploy. The app fails closed while they are empty, so nothing is served until this is done.
2. Leave `workers_dev` at `false`. Access protects the custom hostname only, so a `workers.dev` route would be an unauthenticated bypass to everyone's leave data. Verify after deploying: the `workers.dev` URL must 404.
3. Check `/health` — `accessConfigured` must be `true` and `devAuthBypass` must be `false`.
4. Sign in. **Whoever signs in first becomes the admin**, so make sure it is the right person.

## Turning on the LINE post

Optional — the app is fully functional without it. LINE Notify was shut down on 2025-03-31, so this uses the Messaging API.

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
5. Use **Preview** on `/admin`, then **Send now**.

LINE bills a group push **per member**, so a 20-person group posted to daily is ~600 messages a month. The job skips weekends, public holidays, and days with nobody on leave. See [docs/ISSUES.md](docs/ISSUES.md) #2.

## Docs

| File | What |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, auth model, D1 schema, routes, notification flow, bindings |
| [docs/PLAN.md](docs/PLAN.md) | Phased task list |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Current state, decisions log, what was verified |
| [docs/ISSUES.md](docs/ISSUES.md) | Open risks, accepted trade-offs, unresolved questions |
