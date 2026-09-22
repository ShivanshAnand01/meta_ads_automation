# AdManager — AI Meta Ads automation, multi-tenant

An AI agent that runs a business's Meta (Facebook/Instagram) advertising end to
end: onboards the business conversationally, learns it from its website, connects
its **own** Meta developer app, writes ad copy and generates images in **its**
language for **its** market, builds Campaign → Ad Set → Ad structures, syncs
performance, and optimises within budget caps that are enforced in code.

Any business can sign up. Marathi ebooks in Maharashtra was the first customer,
not the product.

**Live:** https://meta-ads-platform-two.vercel.app

## How it works

```
sign up ─► onboarding (agent) ─► knowledge base ─► Meta connect ─► creatives ─► publish ─► measure ─► optimise
             │                      │                 │               │             │           │          │
             │  get_business_profile│ ingest_website  │ own App ID    │ profile     │ Campaign  │ insights │ daily
             │  set_business_profile│ (crawl→pgvector)│ + secret      │ language    │ → Ad Set  │ at ad    │ routine,
             │  one question at a   │ pre-fills the   │ + token,      │ + script,   │ → Ad, all │ level,   │ budget
             │  time, never a form  │ profile         │ 60-day swap   │ image per   │ PAUSED    │ attrib.  │ caps in
             │                      │                 │ Vault-stored  │ ratio       │           │ pinned   │ code
```

**Bring your own Meta app.** Each business supplies its App ID, App Secret and
an access token generated under that app. Because every business uses its own
app in development mode, the platform itself never needs Meta App Review.

**Per-user language and market.** A `business_profiles` row holds the language
code and exact script label ("Marathi (Devanagari script)"), single/mixed mode,
country/regions/cities, currency, audience, tone, brand colours, defaults and
cultural notes. It is injected into every prompt as a BUSINESS PROFILE block.
Nothing about language or market is hardcoded anywhere.

**MCP first, Graph API second.** Meta operations go through the `meta-ads-mcp`
server, spawned per request with the user's credentials. Any failure — missing
tool, spawn error, schema rejection, timeout — falls back to the direct Graph
client. Results carry `via: "mcp" | "graph"`. Graph is the only path that can
`create_ad` (MCP has no such tool).

**Guardrails that are code, not prompt text.** Unknown tools require approval
(fail closed). Daily and monthly caps are checked before every spend action and
breaches are rejected outright. Approvals expire after 24 h. Everything is
created PAUSED; going live is a separate, explicit act.

## Stack

Next.js 16 · React 19 · Tailwind 4 · shadcn/Base UI · Supabase (auth, Postgres,
pgvector, Vault, Storage) · Vercel (`bom1`, Mumbai) · `meta-ads-mcp` · OpenAI /
Anthropic / Groq / Ollama for text · gpt-image-1 for images (free fallback
optional).

## Repository map

| Area | Files |
|---|---|
| Agent brain | `src/lib/ai/agent.ts` (system prompt) · `manager.ts` · `tools/index.ts` (dispatcher, approval gate, budget guard) · `tools/local.ts` (handlers) · `tool-definitions*.ts` |
| Safety | `src/lib/ai/guardrails.ts` · `budget-guard.ts` · `structured.ts` (zod-validated LLM output, Meta copy limits) |
| Business profile & KB | `src/lib/ai/profile.ts` · `website-ingest.ts` · `rag.ts` · `memory.ts` · `reflection.ts` |
| Creatives | `src/lib/ai/creative-generator.ts` · `creative-reviewer.ts` · `image-generator.ts` |
| Meta | `src/lib/meta/client.ts` (Graph: pagination, retry, `appsecret_proof`) · `mcp-client.ts` · `mcp-bridge.ts` · `mcp-args.ts` (schema adaptation, budgets in minor units) · `publish.ts` (Campaign→Ad Set→Ad) · `connect.ts` (BYO app) · `sync.ts` · `metrics.ts` · `ops.ts` |
| Scheduler | `src/app/api/cron/run-jobs/route.ts` (Vercel Cron; honours `nextRunAt`, claims jobs) |
| UI | `src/app/page.tsx` (dashboard) · `src/components/ui/metric.tsx` · `src/components/charts/trend-chart.tsx` · `src/components/layout/sidebar.tsx` |
| Database | `supabase/schema.sql` (fresh DB) · `supabase/migrations/0001…0003` (applied, in order) |
| Tests & tooling | `tests/*.test.ts` (39, run with `npm test` under tsx) · `scripts/smoke-meta-readonly.ts` (live read-only check) · `.github/workflows/ci.yml` |

## Local development

```bash
npm install
cp .env.example .env.local        # fill in Supabase URL, anon key, service role key, DATABASE_URL, DIRECT_URL
npm run dev                       # http://localhost:3000
```

Verify before pushing (this is what CI runs):

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Exercise the real Meta connection **read-only** through the app's own code
(Graph, MCP, and the MCP→Graph fallback; zero spend):

```bash
npx tsx scripts/smoke-meta-readonly.ts
```

## Deploying

Push to `master` and Vercel builds and promotes automatically. Branches get
preview URLs. **Previews share the production database and Meta connection** —
they are not a sandbox.

Migrations are applied by hand, in order, before code that depends on them.
Environment variables, cron limits, health check and everything operational:
see **[DEPLOYMENT.md](DEPLOYMENT.md)**. Current state and next steps for a
collaborator: **[HANDOFF.md](HANDOFF.md)**.

## Onboarding a business (what the agent does)

1. `get_business_profile` — what is known, what is still unknown.
2. Asks for the website → `ingest_website` crawls it into the knowledge base and
   pre-fills the profile. Returns a script-based language hint the agent must
   confirm (Devanagari could be Marathi or Hindi).
3. Confirms language, market, audience, tone, landing page → `set_business_profile`.
4. Asks for App ID → App Secret → access token, one at a time → `connect_meta_account`
   validates the token against the app, checks `ads_management`/`ads_read`,
   exchanges for a 60-day token, discovers ad accounts, stores secrets in Vault.
   Never echoes a secret back.
5. `select_ad_account` if several. Then `onboarding_complete`.

For a link ad to exist the token also needs **Page scopes**
(`pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, and
`business_management` if the Page is under Business Manager) and the account
needs a **Pixel** for conversion optimisation and revenue tracking.

## Status

Verified live: connection, Vault, profile, Graph reads, MCP spawn per user,
MCP→Graph fallback, targeting lookups, insights — all through the app's own
code. Not yet exercised: the write path (publish). See `HANDOFF.md`.
