# wan-nee-la (วันนี้ลา)

Employee leave tracker on Cloudflare Workers.

- Global calendar — who is on leave, which day
- Self-serve booking, half-day granularity
- Personal dashboard — days remaining per leave type
- Behind Cloudflare Access; mobile and laptop layouts
- Daily 08:00 Asia/Bangkok LINE post — **not built yet**, see [docs/PLAN.md](docs/PLAN.md) phase 4

## Status

Phases 1–3 work end to end locally. Not deployed yet — see [docs/PROGRESS.md](docs/PROGRESS.md).

## Local development

Needs Node 24 (`.nvmrc`) — the test scripts import `.ts` files directly via type stripping.

```bash
nvm use && npm install
```

Create the local database and seed it:

```bash
npm run db:init && npm run db:seed
```

Cloudflare Access cannot run locally, so create `.dev.vars` (gitignored) to log in as a fixed user:

```bash
printf 'DEV_AUTH_BYPASS=1\nDEV_EMAIL=you@example.com\n' > .dev.vars
```

> `DEV_AUTH_BYPASS=1` skips identity verification entirely. It is for `wrangler dev` only — in production it would hand every visitor a session as `DEV_EMAIL`. `/health` reports whether it is on.

Then:

```bash
npm run dev
```

The first account to sign in becomes the admin.

## Checks

```bash
npm run typecheck && npm test
```

To fire the morning cron by hand, run `wrangler dev --test-scheduled` and:

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=0+1+*+*+*"
```

## Deploying

Not yet done. In order:

1. `wrangler d1 create wan-nee-la`, paste the id into `wrangler.jsonc`.
2. Set the hostname in `wrangler.jsonc` `routes` and uncomment it. Leave `workers_dev` at `false` — Access only protects the custom hostname, so a `workers.dev` route would be an unauthenticated bypass to everyone's leave data.
3. Create the Cloudflare Access application on that hostname; put its team domain and AUD tag into `vars` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. The app fails closed while these are empty.
4. `npm run db:init:remote && npm run db:seed:remote`
5. `npm run deploy`
6. Check `/health`: `accessConfigured` must be `true` and `devAuthBypass` must be `false`.

## Docs

| File | What |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, auth model, D1 schema, routes, notification flow, bindings |
| [docs/PLAN.md](docs/PLAN.md) | Phased task list with owner per task |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Current state, decisions log, what was verified |
| [docs/ISSUES.md](docs/ISSUES.md) | Open risks, accepted trade-offs, unresolved questions |
