# Handoff prompt — paste this into a new chat

> You are picking up an in-progress project. Read all of this before touching anything. It is accurate as of 2026-09-27, commit `4cf2f45`.
>
> **Building the multi-agent system?** Paste [MULTI-AGENT-PROMPT.md](MULTI-AGENT-PROMPT.md) instead; it points back here for details.

## What this is

**AdManager** — a multi-tenant SaaS where any business signs up, brings its **own Meta developer app** (App ID, App Secret, access token), and an AI agent runs its Meta ads: onboarding, website→knowledge base, creatives in the business's own language/script, Campaign→Ad Set→Ad publishing, sync, optimisation within code-enforced budget caps. Meta calls go **MCP first (`meta-ads-mcp`, spawned per request with the user's credentials), Graph API as fallback**. Marathi ebooks in Maharashtra was the first customer, not the product — nothing about language or market is hardcoded any more.

Owner: Shivansh (ceo.realtooth@gmail.com). He judges the tool by whether a non-technical business owner can actually run ad spend through it. He authorised direct pushes to `master`, applying migrations, and setting Vercel env vars — but confirm before anything destructive or anything that spends money.

## Where everything is

| | |
|---|---|
| Live | https://meta-ads-platform-two.vercel.app |
| Repo (local) | `C:\Users\SHIVANSH\meta-ads-platform` — GitHub `ShivanshAnand01/meta_ads_automation`, branch `master`, **public** |
| Vercel | project `meta-ads-platform`, team `shivansh-s-projects14`, **Hobby plan**, region `bom1`. Push to `master` auto-deploys (git webhook works). Token for CLI in `~/command-center-brain/.env` as `VERCEL_TOKEN` (same account; use `npx vercel@latest … --token=$VERCEL_TOKEN --scope=shivansh-s-projects14`). |
| Supabase | project `mnepghtodhjdxtmcihls` ("Meta Ads Automation", ap-southeast-1). Migrations `0001`–`0007` applied (see DEPLOYMENT.md for how). The Supabase MCP's direct-Postgres tools sometimes fail with `28P01 password authentication failed` — that is the MCP tool's credential, not the app; use the REST API with `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, or `pg` via `DIRECT_URL`. |
| Docs in repo | `README.md`, `DEPLOYMENT.md`, this file, `MULTI-AGENT-PROMPT.md`, diagrams in `docs/` |
| Verify | `npm run typecheck && npm run lint && npm test && npm run build` — all green at commit `4cf2f45`. Tests: 53, run under tsx. |
| Live read-only check | `npx tsx --env-file=.env.local scripts/smoke-meta-readonly.ts` — 21/21 pass; exercises Graph, MCP spawn, and MCP→Graph fallback against the real account with zero spend. |

## The one account, and what it lacks

User `ef47db24-ea14-4d0e-b9a5-9036b052921a`, ad account **act_1316138380606285 "Marathi Dnyan"**, INR, app `2240767766687942`. Profile seeded: Marathi (Devanagari), mixed with English, Maharashtra.

- **Token regenerated with Page scopes; expires 2026-11-21.** Scopes: `read_insights, pages_show_list, ads_management, ads_read, business_management, pages_read_engagement, pages_manage_ads, public_profile`. One Page visible: "AI उद्योजक बना" (`1164580690072134`). Nothing auto-renews the token.
- **OpenAI is the AI provider, model `gpt-5.4-mini`.** Its key sat in plain text in `ai_settings.api_key` (a Vault write had failed silently); moved into Vault on 2026-09-27 and `storeSecret` now logs such failures.
- **0 campaigns, 0 Pixels, ₹0 spend in 30 days.** No Pixel → no conversion optimisation, no revenue, ROAS reads 0, no retargeting.
- **No landing URL on the profile** — publishing refuses without one, by design.
- Meta geo key for Maharashtra = `1735`, locale Marathi = `81` (resolved live).

## What is verified vs not

**Verified live 2026-09-27 (AI):** with the account's OpenAI key on gpt-5.4-mini and gpt-5.5: completion, streaming, tool calls, a two-creative Marathi batch, AI review (scores out of 100), one medium image in 16.6 s saved without a session and loaded back through its signed URL, embeddings (1536 dims).

**Verified live 2026-09-27 (platform):** smoke check 21/21 after the Vault fix (was 13/21: session-less runs got no token); cron endpoint answers 200 with the secret and 401 without it; Connections key checks reject bad Tavily and fal.ai keys with plain messages; the MCP client connects, lists and calls tools on a real public server.

**Verified earlier, through the app's own code:** connection + Vault, profile injection, Graph reads (campaigns, ad sets, ads, pages, pixels, insights, geo/locale search), MCP spawn per user with the user's env, MCP→Graph fallback routing (`via` field), token validation. Multi-tenant onboarding tools exist and typecheck.

**Never exercised against Meta:** the **write path** — `create_campaign`, `create_ad_set`, `create_ad_creative`, `create_ad`, `publish_full_campaign`. MCP argument adaptation for these is unit-tested (`src/lib/meta/mcp-args.ts`, 14 tests: budgets major→minor units, `status`→`configured_status`, `location_types` injected, `end_time`→`stop_time`, CTA string→object) but has not hit a live account. `ingest_website` has never run. The multi-agent system is at Phase 1 (framework + Research agent), below. Cron is once daily (Hobby limit; `30 0 * * *` = 06:00 IST).

## Mistakes already made — do not repeat

1. Supabase `list_tables` row counts are `reltuples`, a planner estimate — **not real counts**. I said the DB was empty; it wasn't, and migration 0002 (private buckets) broke the one saved creative's public image URL. Repaired with a signed URL. Always `select count(*)` or use the REST API with `Prefer: count=exact`.
2. **Do not disable signup** (`NEXT_PUBLIC_ALLOW_SIGNUP=true` is required by the multi-tenant model). It's `NEXT_PUBLIC_`, so baked at build time — a change needs a redeploy.
3. **Meta App Review is NOT a blocker.** Each business brings its own app. I called it "the long pole" — wrong.
4. **Do not delete the MCP path** as "can't run on serverless". The real problem was Next's file tracer not seeing a `process.cwd()`-built spawn path; fixed via `outputFileTracingIncludes` + `serverExternalPackages` in `next.config.ts`, and spawning `process.execPath`.
5. A sub-daily cron **fails the Vercel deploy outright** on Hobby; it does not degrade. Keep daily until Pro.
6. `next-themes`, Base UI `Button` (`render={<Link/>}` needs `nativeButton={false}`), Recharts colours can't read CSS vars (resolve in JS, render client-only, `isAnimationActive={false}`).
7. The first push after changing `vercel.json` looked like it did nothing — the deploy failed at config validation before a deployment record existed.
8. **Anything without a browser session was broken twice over**: the proxy 401'd machine callers before their route ran, and `get_user_secret` needs `auth.uid()`. Test autonomous paths with a real secret-authenticated call, not from a logged-in page.
9. **An MCP server listing its tools does not prove the key works.** Tavily's lists tools for any key. Connections runs the provider's API key check before trusting an MCP listing.
10. **Do not bypass auth to screenshot signed-in pages.** A dev-only impersonation patch was refused by the permission classifier and reverted. What works instead: a throwaway Next app in a git-ignored `.harness/` folder (add it to `.git/info/exclude`), with its own port, `turbopack.root` set to the repo, `tsconfig` paths `@/*` → `../src/*`, `@import` of `src/app/globals.css` plus `@source "../../src"`, and a module that replaces `window.fetch` with sample data (including a streaming SSE reply) before rendering the real page component. Delete it before committing. If the Browser pane is hidden, screenshots time out; check through `get_page_text` and same-origin iframes of a fixed width instead.
11. **OpenAI models do not share parameters.** GPT-5+ reject `max_tokens`; GPT-5.5 and GPT-6 reject any non-default `temperature`. The provider now sends `max_completion_tokens` and drops a rejected optional parameter per model, then retries. Always call OpenAI through the provider.
12. **One word for "approved".** The UI wrote `approved` while publishing accepted only `verified`, and an AI review silently set `verified`. Use `src/lib/ai/review-status.ts`; an AI review never approves.
13. **Image calls take 20–60 s.** A 22 s timeout silently dropped to an unlicensed free fallback. OpenAI images now get 120 s and the fallback is opt-in only.

## Next steps, in order

1. **Shivansh:** ~~regenerate the Meta token with Page scopes~~ (done). Still open: set a landing URL (Business Profile) and daily/monthly caps (Settings) — the dashboard's launch checklist tracks both; install the Pixel only if customers buy on a website; connect a research tool under Connections; set up the n8n heartbeat (DEPLOYMENT.md → External heartbeat).
2. **One ₹100 paused publish, end to end**, verified in Ads Manager — proves the write path. Watch `via` in tool results to see whether MCP or Graph handled each step.
3. **Leads engine:** Click-to-WhatsApp campaigns as a first-class type (`destination_type: WHATSAPP`, `WHATSAPP_MESSAGE` CTA, pre-filled opener in the profile language) and Instant Forms + leadgen webhook → `leads` table → notify owner. Zero code for either exists today.
4. **Funnel builder:** prospecting + retargeting (pixel visitors 7/30d, engagers) + lookalike of purchasers. Zero retargeting code today. UTM builder and landing-page check (zero today).
5. **Learning loop:** creative generation does not read memory or ad-level insights; reflection's learnings go unread. Feed winners into prompts; fatigue rule (frequency > 2.5 or CTR −30%/7d → rotate); real A/B (variants as separate ads, auto-pause losers).
6. **Multi-agent system:** see [MULTI-AGENT-PROMPT.md](MULTI-AGENT-PROMPT.md). It includes the learning loop in step 5.
7. **Script compositing** for images (headline, price and CTA rendered in code with Noto Sans Devanagari; diffusion cannot render Indic scripts).
8. Vercel Pro (hourly pacing), a staging Supabase project, make the repo private, custom domain, Sentry. The landing page is on hold by the owner's decision.

**Multi-agent plan (agreed 2026-09-26, diagram in `docs/admanager-agents.html`, build brief in `MULTI-AGENT-PROMPT.md`):** one Brain (the existing AI Manager) delegating to five specialists: past-ads analyst, research agent (uses Connections), creative generator, watcher (runs on the heartbeat), editor. All read and write shared memory.

**Phase 1 shipped 2026-09-27:** `src/lib/ai/agents/` — `registry.ts` (one config per specialist; only `research` is enabled, the others switch on in their phase), `specialist.ts` (allow-list gate + report validation, tested), `runner.ts` (runs a specialist through the same agent loop and `executeTool`, stores the run in `agent_runs`, writes findings to memory, per-run cost cap, background queue). The Brain calls `delegate_to_agent`. Specialists have no spend tools, and `mayExecuteWithoutApproval` queues any approval tool from a specialist even with auto-optimize on. Every paid AI call is metered into `ai_usage` (`src/lib/ai/usage.ts`, prices in `pricing.ts`); the developer view is `/admin/costs` (gated by `DEVELOPER_EMAILS`). Live run: Research agent, 19.6 s, $0.0105. Next: Phase 2 (Watcher + Creative generator).

**Open question that decides step 3 vs 4 first:** does this business (and the ones he'll onboard) close via website checkout (→ Pixel-driven Sales path) or via WhatsApp/DM conversation (→ Leads path first)? Ask him.

## Working conventions

- Commit messages: imperative subject, body explains *why*; end with the attribution line your environment specifies.
- Verify (typecheck, lint, test, build) before every push; `master` is production.
- Every Meta write is created PAUSED. Never activate without an explicit yes.
- Prefer real checks over inference. When you can't verify, say so.
