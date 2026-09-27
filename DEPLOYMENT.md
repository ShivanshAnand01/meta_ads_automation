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
| `NEXT_PUBLIC_ALLOW_SIGNUP` | `true`. This is a multi-tenant SaaS: any business signs up and brings its own Meta app. (Baked in at build time — a change needs a redeploy.) |
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
- `0003_business_profiles.sql` — the per-user business profile (language,
  script, market, currency, audience, tone), `knowledge_documents.source_url`
  for website re-crawls.
- `0004_service_secret_access.sql` — `get_user_secret_for(user, key)` and
  `delete_user_secret(user, key)`, executable by the service role only, so
  cron and other session-less runs can read a user's Meta token and AI key.
- `0005_integrations.sql` — the `integrations` table behind Setup →
  Connections (owner RLS, explicit grants; secrets live in Vault).
- `0006_lock_definer_functions.sql` — revokes `anon` from the SECURITY
  DEFINER functions that take a user id and guards each with
  `caller_may_act_for()`, which closed cross-tenant reads of the action log,
  memory, knowledge base and strategy through the public anon key.

All six are applied to the live database (0001–0002 on 2026-08-30, 0003 on
2026-09-05, 0004–0006 on 2026-09-27).

The SQL editor works, and so does the Prisma CLI against `DIRECT_URL` (it
reads `prisma.config.ts`):

```bash
node --env-file=.env.local node_modules/prisma/build/index.js db execute --file supabase/migrations/0005_integrations.sql
```

Tables created this way do not always inherit Supabase's default grants, so
new migrations grant `authenticated` and `service_role` explicitly.

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

Until 2026-09-27 no scheduled run ever reached this route: the proxy
demanded a logged-in user on every API path and answered Vercel Cron with 401
before the route could check its secret. The proxy now lets a request carrying
a valid `CRON_SECRET` bearer or `x-runner-secret` header through to
`/api/cron/*` and `/api/ai-manager/autonomous`, which still re-validate.

Trigger a run manually without waiting for the schedule:

```bash
curl -X POST https://meta-ads-platform-two.vercel.app/api/cron/run-jobs -H "x-runner-secret: $RUNNER_SECRET"
```

### External heartbeat (n8n, cron-job.org)

Hobby allows one cron a day. For checks every 2–3 hours, point any external
scheduler at the same route. It only runs jobs that are due, so extra calls
are harmless.

- Method `POST`, URL `https://meta-ads-platform-two.vercel.app/api/cron/run-jobs`
- Header `x-runner-secret: <RUNNER_SECRET>` (or `Authorization: Bearer <CRON_SECRET>`)
- Expect `200` with `{ ranAt, activeJobs, dueJobs, processed, deferred, results }`.
  A `401` means the secret is wrong.

Keep the secret in the scheduler's credential store, never in the URL.

## Health check

```bash
curl https://meta-ads-platform-two.vercel.app/api/status
```

Returns `{"ok":true,"status":"healthy"}` publicly. Send the `x-runner-secret`
header for the full report (env presence, table inventory, pgvector status) —
the detail is gated because it is otherwise free reconnaissance.

## Multi-tenant architecture

Any business signs up (self-serve signup is ON — `NEXT_PUBLIC_ALLOW_SIGNUP=true`)
and brings its **own** Meta developer app. Because every business uses its own
App ID / secret / token, the platform never needs Meta App Review: each app is
in development mode managing ad accounts its own admin already controls.

**Onboarding is conversational.** The AI Manager runs it with five tools:
`get_business_profile` → `ingest_website` (crawls the site into the pgvector
knowledge base and pre-fills the profile) → `set_business_profile` (language,
script, market, audience, tone, landing page) → `connect_meta_account`
(validates the token against the app, exchanges it for a 60-day token, stores
secrets in Vault) → `select_ad_account`.

**Language and market are per user**, held in `business_profiles` and injected
into every prompt as a BUSINESS PROFILE block. Nothing about language, script,
market or currency is hardcoded any more; the first account ("Marathi Dnyan",
Marathi/Maharashtra/INR) is simply a seeded profile row.

**Meta calls: MCP first, Graph API second.** `src/lib/meta/mcp-bridge.ts`
spawns `meta-ads-mcp` per request with the user's credentials in its env
(`next.config.ts` traces the binary into the bundle). Any MCP failure — no
such tool, spawn error, schema mismatch, timeout — falls through to the direct
Graph client in `src/lib/meta/client.ts`, which is also the only path that can
`create_ad` (MCP has `create_ad_set` but no `create_ad`). Results carry
`via: "mcp" | "graph"`. Disable MCP with `META_MCP_ENABLED=false`.

## Still outstanding

- **MCP argument schemas are untested against real calls.** The bridge passes
  our tool arguments through to `meta-ads-mcp` and falls back to Graph on any
  rejection, so nothing breaks — but until each tool has been exercised against
  a live account, some calls will silently take the Graph path every time.
  Watch the `via` field in tool results.
- **The Meta token expiry is the real onboarding risk**, not App Review (each
  business uses its own app, so no review is needed). See below.
- **Meta access tokens expire in ~60 days** and nothing renews them. The app
  warns when expiry is within 7 days; reconnect before it lapses or automation
  stops.
- **No staging environment.** Previews share production data (see above).
- **The repo is public.** Make it private before it carries client specifics.
