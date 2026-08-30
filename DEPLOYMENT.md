# Deployment

Live: **https://meta-ads-platform-two.vercel.app**

| Thing | Where |
|---|---|
| Vercel project | `meta-ads-platform` (team `shivansh-s-projects14`), region `bom1` (Mumbai) |
| GitHub repo | `ShivanshAnand01/meta_ads_automation`, branch `master` |
| Supabase project | `Meta Ads Automation` — ref `mnepghtodhjdxtmcihls`, region `ap-southeast-1` |

## Editing it

Push to `master` and Vercel builds and promotes to production automatically:

```bash
git add -A && git commit -m "your change" && git push origin master
```

Work on a branch to get a preview URL without touching production:

```bash
git checkout -b my-change && git push -u origin my-change
```

> **Preview deploys share the production Supabase project and the production
> Meta connection.** A preview is not a sandbox — it reads and writes the same
> data and can reach the same live ad account. Safe for looking at the UI, not
> safe for testing a publish.

Before pushing, run what CI runs:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Environment variables

Set in Vercel → Settings → Environment Variables (Production, Preview, Development).

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role — used only by the background runner |
| `DATABASE_URL` / `DIRECT_URL` | Pooled / direct Postgres connection strings |
| `RUNNER_SECRET` | Authenticates manual runs of the autonomous routines |
| `CRON_SECRET` | Vercel Cron sends this as a Bearer token to `/api/cron/run-jobs` |
| `VAULT_ENABLED` | `true` — encrypt API keys and tokens in Supabase Vault |
| `NEXT_PUBLIC_ALLOW_SIGNUP` | `false`. Leave it false: this tool runs live ad spend, and open signup lets anyone create an account on it |
| `IMAGE_FALLBACK_ENABLED` | `true` allows the free Pollinations image provider. Set `false` for client work — it has no SLA, no moderation and no commercial licence |
| `NEXT_TELEMETRY_DISABLED` | `1` |

## Database migrations

`supabase/schema.sql` builds a fresh database. Incremental changes live in
`supabase/migrations/` and are applied **in order**, by hand, in the Supabase
SQL editor:

- `0001_ads_delivery_layer.sql` — ad set / ad columns, ad-level metric
  granularity, the unique index that stops double-counted metrics, approval
  expiry, and the rate-limit table + `bump_rate_limit()`.
- `0002_private_storage.sql` — makes every storage bucket private with
  owner-scoped RLS, and blocks SVG uploads.

Both are applied to the live database as of 2026-08-30.

**Apply migrations before deploying code that depends on them.** The app writes
`daily_metrics.level` and upserts against `daily_metrics_unique_row`; if the
code ships first, every sync fails.

## The scheduler

Vercel Cron calls `/api/cron/run-jobs` on the schedule in `vercel.json`. It runs
only jobs whose `nextRunAt` is due, and claims each one before running so two
overlapping ticks cannot double-spend.

Currently `30 0 * * *` — 00:30 UTC / 06:00 IST, **once a day, because the
project is on the Vercel Hobby plan**, which rejects any cron firing more often
and fails the deploy outright.

Budget pacing and anomaly detection really want to run hourly. On Pro, change
the schedule to `*/15 * * * *` and redeploy — nothing else changes.

Trigger a routine manually without waiting for the schedule:

```bash
curl -X POST https://meta-ads-platform-two.vercel.app/api/cron/run-jobs -H "x-runner-secret: $RUNNER_SECRET"
```

## Health check

```bash
curl https://meta-ads-platform-two.vercel.app/api/status
```

Returns `{"ok":true,"status":"healthy"}` publicly. Send the `x-runner-secret`
header for the full report (env presence, table inventory, pgvector status) —
the detail is gated because it is otherwise free reconnaissance.

## Still outstanding

- **Meta App Review.** Clients cannot paste an App Secret. Production needs
  Facebook Login for Business plus App Review for `ads_management` /
  `ads_read` / `business_management`, and Business Verification. This is the
  long pole and it is not in our control — start it early.
- **Meta access tokens expire in ~60 days** and nothing renews them. The app
  warns when expiry is within 7 days; reconnect before it lapses or automation
  stops.
- **No staging environment.** Previews share production data (see above).
- **The repo is public.** Make it private before it carries client specifics.
