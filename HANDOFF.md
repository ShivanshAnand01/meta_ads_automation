# Handoff prompt — paste this into a new chat

> You are picking up an in-progress project. Read all of this before touching anything. It is accurate as of 2026-09-22.

## What this is

**AdManager** — a multi-tenant SaaS where any business signs up, brings its **own Meta developer app** (App ID, App Secret, access token), and an AI agent runs its Meta ads: onboarding, website→knowledge base, creatives in the business's own language/script, Campaign→Ad Set→Ad publishing, sync, optimisation within code-enforced budget caps. Meta calls go **MCP first (`meta-ads-mcp`, spawned per request with the user's credentials), Graph API as fallback**. Marathi ebooks in Maharashtra was the first customer, not the product — nothing about language or market is hardcoded any more.

Owner: Shivansh (ceo.realtooth@gmail.com). He judges the tool by whether a non-technical business owner can actually run ad spend through it. He authorised direct pushes to `master`, applying migrations, and setting Vercel env vars — but confirm before anything destructive or anything that spends money.

## Where everything is

| | |
|---|---|
| Live | https://meta-ads-platform-two.vercel.app |
| Repo (local) | `C:\Users\SHIVANSH\meta-ads-platform` — GitHub `ShivanshAnand01/meta_ads_automation`, branch `master`, **public** |
| Vercel | project `meta-ads-platform`, team `shivansh-s-projects14`, **Hobby plan**, region `bom1`. Push to `master` auto-deploys (git webhook works). Token for CLI in `~/command-center-brain/.env` as `VERCEL_TOKEN` (same account; use `npx vercel@latest … --token=$VERCEL_TOKEN --scope=shivansh-s-projects14`). |
| Supabase | project `mnepghtodhjdxtmcihls` ("Meta Ads Automation", ap-southeast-1). Migrations `0001`–`0003` applied. The Supabase MCP's direct-Postgres tools sometimes fail with `28P01 password authentication failed` — that is the MCP tool's credential, not the app; use the REST API with `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, or `pg` via `DIRECT_URL`. |
| Docs in repo | `README.md`, `DEPLOYMENT.md`, this file |
| Verify | `npm run typecheck && npm run lint && npm test && npm run build` — all green at commit `7ec31b2`. Tests: 39, run under tsx. |
| Live read-only check | `npx tsx scripts/smoke-meta-readonly.ts` — 21/21 pass; exercises Graph, MCP spawn, and MCP→Graph fallback against the real account with zero spend. |

## The one account, and what it lacks

User `ef47db24-ea14-4d0e-b9a5-9036b052921a`, ad account **act_1316138380606285 "Marathi Dnyan"**, INR, app `2240767766687942`. Profile seeded: Marathi (Devanagari), mixed with English, Maharashtra.

- **Token expires 2026-09-28.** Nothing auto-renews it. Reconnect via the agent (`connect_meta_account`) or `/connect`. `meta-ads-mcp` has `META_AUTO_REFRESH` — untested.
- **Token scopes are `read_insights, ads_management, ads_read, public_profile` — no `pages_*` scopes.** `/me/accounts` returns 0 Pages, so **no link ad can be created** until the token is regenerated with `pages_show_list`, `pages_read_engagement`, `pages_manage_ads` (+ `business_management` if the Page is under Business Manager). The publish pipeline correctly refuses.
- **0 campaigns, 0 Pixels, ₹0 spend in 30 days.** No Pixel → no conversion optimisation, no revenue, ROAS reads 0, no retargeting.
- **No landing URL on the profile** — publishing refuses without one, by design.
- Meta geo key for Maharashtra = `1735`, locale Marathi = `81` (resolved live).

## What is verified vs not

**Verified live, through the app's own code:** connection + Vault, profile injection, Graph reads (campaigns, ad sets, ads, pages, pixels, insights, geo/locale search), MCP spawn per user with the user's env, MCP→Graph fallback routing (`via` field), token validation. Multi-tenant onboarding tools exist and typecheck.

**Never exercised against Meta:** the **write path** — `create_campaign`, `create_ad_set`, `create_ad_creative`, `create_ad`, `publish_full_campaign`. MCP argument adaptation for these is unit-tested (`src/lib/meta/mcp-args.ts`, 14 tests: budgets major→minor units, `status`→`configured_status`, `location_types` injected, `end_time`→`stop_time`, CTA string→object) but has not hit a live account. `ingest_website` has never run. Cron is once daily (Hobby limit; `30 0 * * *` = 06:00 IST).

## Mistakes already made — do not repeat

1. Supabase `list_tables` row counts are `reltuples`, a planner estimate — **not real counts**. I said the DB was empty; it wasn't, and migration 0002 (private buckets) broke the one saved creative's public image URL. Repaired with a signed URL. Always `select count(*)` or use the REST API with `Prefer: count=exact`.
2. **Do not disable signup** (`NEXT_PUBLIC_ALLOW_SIGNUP=true` is required by the multi-tenant model). It's `NEXT_PUBLIC_`, so baked at build time — a change needs a redeploy.
3. **Meta App Review is NOT a blocker.** Each business brings its own app. I called it "the long pole" — wrong.
4. **Do not delete the MCP path** as "can't run on serverless". The real problem was Next's file tracer not seeing a `process.cwd()`-built spawn path; fixed via `outputFileTracingIncludes` + `serverExternalPackages` in `next.config.ts`, and spawning `process.execPath`.
5. A sub-daily cron **fails the Vercel deploy outright** on Hobby; it does not degrade. Keep daily until Pro.
6. `next-themes`, Base UI `Button` (`render={<Link/>}` needs `nativeButton={false}`), Recharts colours can't read CSS vars (resolve in JS, render client-only, `isAnimationActive={false}`).
7. The first push after changing `vercel.json` looked like it did nothing — the deploy failed at config validation before a deployment record existed.

## Next steps, in order

1. **Shivansh, today:** regenerate the Meta token **with Page scopes**, reconnect (expires 28 Sep), install the Pixel firing `Purchase`/`Lead` with value+currency, set a landing URL and daily/monthly caps in the profile/strategy.
2. **One ₹100 paused publish, end to end**, verified in Ads Manager — proves the write path. Watch `via` in tool results to see whether MCP or Graph handled each step.
3. **Leads engine:** Click-to-WhatsApp campaigns as a first-class type (`destination_type: WHATSAPP`, `WHATSAPP_MESSAGE` CTA, pre-filled opener in the profile language) and Instant Forms + leadgen webhook → `leads` table → notify owner. Zero code for either exists today.
4. **Funnel builder:** prospecting + retargeting (pixel visitors 7/30d, engagers) + lookalike of purchasers. Zero retargeting code today. UTM builder and landing-page check (zero today).
5. **Learning loop:** creative generation does not read memory or ad-level insights; reflection's learnings go unread. Feed winners into prompts; fatigue rule (frequency > 2.5 or CTR −30%/7d → rotate); real A/B (variants as separate ads, auto-pause losers).
6. **Script compositing** for images (headline/price/CTA rendered in code with Noto Sans Devanagari etc.; diffusion can't render Indic scripts). Creatives page redesign (still the old table layout).
7. Vercel Pro (hourly pacing), a staging Supabase project, make the repo private, custom domain, Sentry.

**Open question that decides step 3 vs 4 first:** does this business (and the ones he'll onboard) close via website checkout (→ Pixel-driven Sales path) or via WhatsApp/DM conversation (→ Leads path first)? Ask him.

## Working conventions

- Commit messages: imperative subject, body explains *why*; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Verify (typecheck, lint, test, build) before every push; `master` is production.
- Every Meta write is created PAUSED. Never activate without an explicit yes.
- Prefer real checks over inference. When you can't verify, say so.
