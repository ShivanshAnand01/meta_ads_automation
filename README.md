# AdManager — AI Meta Ads automation, multi-tenant

An AI agent that runs a business's Meta (Facebook and Instagram) advertising end
to end: it onboards the business in conversation, learns it from its website,
connects the business's **own** Meta developer app, writes ad copy and
generates images in **its** language for **its** market, builds Campaign → Ad
Set → Ad structures, syncs performance, and optimises within budget caps that
are enforced in code.

Any business can sign up. Marathi ebooks in Maharashtra was the first customer,
not the product. Nothing about language or market is hardcoded.

**Live:** https://meta-ads-platform-two.vercel.app

**Picking this up in a new chat?** Read [HANDOFF.md](HANDOFF.md) for the current
state. To build the multi-agent system, paste
[MULTI-AGENT-PROMPT.md](MULTI-AGENT-PROMPT.md) into the new chat.

## How it works

```
sign up ─► onboarding (agent) ─► knowledge base ─► Meta connect ─► creatives ─► publish ─► measure ─► optimise
             │                      │                 │               │             │           │          │
             │  one question at a   │ website crawl   │ own App ID    │ profile     │ Campaign  │ insights │ daily
             │  time, never a form  │ → pgvector,     │ + secret      │ language    │ → Ad Set  │ at ad    │ routines,
             │  profile saved       │ pre-fills the   │ + token,      │ + script,   │ → Ad, all │ level    │ caps in
             │                      │ profile         │ 60-day swap,  │ one image   │ PAUSED    │          │ code
             │                      │                 │ Vault-stored  │ per ratio   │           │          │
```

- **Bring your own Meta app.** Each business supplies its App ID, App Secret and
  a token generated under that app. Every business uses its own app, so the
  platform never needs Meta App Review.
- **Per-business language and market.** A `business_profiles` row holds the
  language code and exact script label, single or mixed mode, market, currency,
  audience, tone, brand colours and cultural notes. It is injected into every
  prompt.
- **MCP first, Graph API second.** Meta operations go through `meta-ads-mcp`,
  spawned per request with the business's credentials. Any failure falls back
  to the direct Graph client. Results carry `via: "mcp" | "graph"`. Only Graph
  can `create_ad`.
- **Guardrails are code, not prompt text.** Unknown tools need approval (fail
  closed). Daily and monthly caps are checked before every spend action, and
  breaches are rejected. Approvals expire after 24 hours. Everything is created
  PAUSED; going live is a separate, explicit act. Only creatives the owner
  approved can become ads; an AI review never approves.
- **Connections.** A business can add research tools (Tavily, Exa, Firecrawl,
  Apify), image and video models (fal.ai, Replicate, Runway, Gemini), voice
  (ElevenLabs) or any MCP server, by API key or MCP. Keys are tested before
  saving and stored in Vault. The agent researches freely; any connected tool
  that spends the provider's credits needs approval.
- **Model-agnostic AI.** OpenAI, Anthropic, Groq or Ollama per business. The
  OpenAI provider adapts to each model's accepted parameters (GPT-5+ reject
  `max_tokens`; GPT-5.5 and GPT-6 reject a non-default temperature).

## Stack

Next.js 16 · React 19 · Tailwind 4 · shadcn / Base UI · Plus Jakarta Sans with
Noto Sans Devanagari fallback · Supabase (auth, Postgres, pgvector, Vault,
Storage) · Vercel (`bom1`, Mumbai) · `meta-ads-mcp` and `@modelcontextprotocol/sdk`
· OpenAI, Anthropic, Groq or Ollama for text · `gpt-image-1` for images.

## Repository map

| Area | Files |
|---|---|
| Agent loop | `src/lib/ai/agent.ts` (system prompt, streaming tool loop, 10 rounds max) · `manager.ts` (context assembly: profile, strategy, pacing, memory, RAG, connections) · `autonomous.ts` (scheduled routines) |
| Tools | `tools/index.ts` (dispatcher: budget guard, then approval gate, then execute) · `tools/local.ts` (handlers) · `tool-definitions*.ts` (onboarding, local, delivery, integrations) |
| Safety | `guardrails.ts` (safe list, approval list, risk) · `budget-guard.ts` · `structured.ts` (zod-validated LLM output, Meta copy limits) · `review-status.ts` (pending / approved / rejected) |
| Memory and knowledge | `memory.ts` (`manager_memory`: summary, decision, observation, learning, outcome) · `reflection.ts` · `rag.ts` · `profile.ts` · `website-ingest.ts` |
| Creatives | `creative-generator.ts` · `creative-reviewer.ts` · `image-generator.ts` (OpenAI images, 120 s timeout, medium quality) · `image-store.ts` (saves with or without a session, never returns base64) |
| AI providers | `providers/openai.ts` (parameter-adaptive) · `anthropic.ts` · `groq.ts` · `factory.ts` · `model-catalog.ts` (presets shown in the UI) |
| Connections | `src/lib/integrations/catalog.ts` (providers, client-safe) · `server.ts` (test, store, research, call) · `mcp.ts` (streamable HTTP with SSE fallback) |
| Meta | `src/lib/meta/client.ts` (Graph) · `mcp-bridge.ts` · `mcp-args.ts` · `publish.ts` (Campaign → Ad Set → Ad, approved creatives only) · `connect.ts` · `sync.ts` · `metrics.ts` · `ops.ts` |
| Secrets | `src/lib/secrets.ts` (Vault; service-role read for session-less runs) |
| Scheduler | `src/app/api/cron/run-jobs/route.ts` (Vercel Cron daily, or any external heartbeat with the runner secret) |
| UI | `src/app/*/page.tsx` · `src/components/chat/*` (AI Manager chat) · `src/components/ui/metric.tsx` (page header, sections, tiles, sparkline) · `src/components/layout/sidebar.tsx` |
| Database | `supabase/schema.sql` (fresh DB) · `supabase/migrations/0001…0006` (applied, in order) |
| Tests and tooling | `tests/*.test.ts` (53, `npm test`) · `scripts/smoke-meta-readonly.ts` (live read-only Meta check) · `.github/workflows/ci.yml` |
| Architecture diagrams | `docs/admanager-flowchart.html` (today) · `docs/admanager-target.html` (target flow) · `docs/admanager-agents.html` (multi-agent plan) |

## Local development

```bash
npm install
cp .env.example .env.local        # Supabase URL, anon key, service role key, DATABASE_URL, DIRECT_URL, CRON_SECRET, RUNNER_SECRET
npm run dev                       # http://localhost:3000
```

Verify before pushing (this is what CI runs):

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Exercise the real Meta connection read-only, through the app's own code, with
zero spend:

```bash
npx tsx --env-file=.env.local scripts/smoke-meta-readonly.ts
```

## Deploying

Push to `master`; Vercel builds and promotes automatically. Preview deployments
share the production database and Meta connection, so they are not a sandbox.
Migrations are applied by hand, in order, before code that depends on them.
Environment variables, the scheduler, the external heartbeat and the migration
commands are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Onboarding a business (what the agent does)

1. `get_business_profile`: what is known and what is still missing.
2. Asks for the website, then `ingest_website` crawls it into the knowledge base
   and pre-fills the profile.
3. Confirms language, market, audience, tone and landing page with
   `set_business_profile`.
4. Asks for App ID, App Secret and token, one at a time, then
   `connect_meta_account` validates them, exchanges for a 60-day token, finds
   the ad accounts and stores the secrets in Vault.
5. `select_ad_account` if there are several.

A link ad also needs Page scopes on the token (`pages_show_list`,
`pages_read_engagement`, `pages_manage_ads`), and conversion optimisation needs
a Meta Pixel on the website.

## Status

**Verified live:** Meta connection and Vault, session-less secret reads, Graph
and MCP reads with fallback, the cron endpoint, Connections key checks, and the
full OpenAI path on the first account's key: text, streaming, tool calls, a
Marathi creative batch, AI review, image generation and saving, embeddings.

**Not yet exercised against Meta:** the write path (publish). **Not built yet:**
the multi-agent system; see [MULTI-AGENT-PROMPT.md](MULTI-AGENT-PROMPT.md).
