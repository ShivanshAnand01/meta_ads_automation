# Build the AdManager multi-agent system — paste this into a new chat

> You are picking up a live, multi-tenant SaaS and adding a team of AI agents to
> it. Read this whole message, then `HANDOFF.md`, `README.md` and
> `DEPLOYMENT.md` in the repo, before writing code. This brief is accurate as of
> 2026-09-27, commit `4cf2f45`.

## The project in one paragraph

**AdManager** (repo `C:\Users\SHIVANSH\meta-ads-platform`, GitHub
`ShivanshAnand01/meta_ads_automation`, branch `master`, live at
https://meta-ads-platform-two.vercel.app) lets any business sign up, connect its
own Meta developer app, and have an AI agent run its Facebook and Instagram
ads: onboarding, website knowledge base, ad copy and images in the business's
own language, Campaign → Ad Set → Ad publishing (always PAUSED), sync, and
optimisation inside budget caps enforced in code. The owner, Shivansh, is not
a developer. He judges the product by whether a non-technical business owner
can safely run real ad spend through it.

## What to build

One **Brain** that plans and decides, delegating to **five specialists**. They
share one memory, and every report they write is visible to the owner. The
diagram is `docs/admanager-agents.html`.

| Agent | Job | Reads | Writes | When it runs |
|---|---|---|---|---|
| **Brain** (exists: the AI Manager) | Talks to the owner, plans, delegates, decides, publishes | Everything | Decisions, briefs | Every chat message; every heartbeat |
| **Past-ads analyst** | Imports past ads (copy, image, audience, results) and writes a *playbook*: which hooks, offers, images, audiences and placements won or lost, with numbers | Meta ads and ad-level insights, `daily_metrics` | Playbook entries | On first connect; weekly |
| **Research agent** | Competitors, market prices, reviews, trends, the landing page | `research_web` and connected MCP tools (Connections) | Research reports | On request; before a new campaign |
| **Creative generator** | Copy and image prompts from the Brain's brief, grounded in playbook, research and profile; OpenAI images | Playbook, research, profile, brief | Creative drafts (pending approval) | On request |
| **Watcher** | Reads live results, flags fatigue and anomalies, proposes fixes | Ad-level insights, caps, pacing | Watch reports | Every heartbeat (n8n, about every 2 hours) |
| **Editor** | Improves or varies an existing creative from Watcher or analyst feedback; sets up A/B pairs | A creative plus feedback | New variant drafts (pending approval) | When the Watcher or the owner asks |

The owner's words: "all of this should be intertwined and interconnected". In
practice: every specialist returns a structured report, the report is stored,
its key findings go into shared memory, and the Brain reads memory before
every decision. The creative generator must stop writing blind. Today
`creative-generator.ts` and `creative-reviewer.ts` never read memory; only the
manager does.

## How it plugs into what exists (read these files first)

- **Agent loop:** `src/lib/ai/agent.ts`, `streamAgentMessage(provider, messages, tools, toolExecutor, signal, systemContext)`, at most 10 tool rounds. A specialist should reuse this loop with its own system prompt and a restricted tool list. Do not write a second loop.
- **Tool dispatch:** `src/lib/ai/tools/index.ts`, `executeTool(ctx, tool, args)`. In order: budget guard, approval gate (fail closed), then execute and audit. Specialists must call tools through this same function, so every guardrail applies to them unchanged. A delegated agent must never get more authority than the Brain.
- **Guardrails:** `guardrails.ts` has `SAFE_TOOLS`, `APPROVAL_TOOLS` and `classifyRisk`. Any new tool must be added deliberately. Unknown tools need approval.
- **Context:** `manager.ts`, `buildContext()`, assembles the profile, strategy, pacing, memory, RAG and connected tools into the prompt.
- **Memory:** `memory.ts` and table `manager_memory` (kinds: summary, decision, observation, learning, outcome; importance 1–10; metadata JSON; optional embeddings). `reflection.ts` writes learnings.
- **Autonomy:** `autonomous.ts`, `runRoutine({ userId, routine })`. Routines are driven by `scheduled_jobs` via `/api/cron/run-jobs`, called by Vercel Cron once a day and by an external heartbeat with `x-runner-secret`.
- **Structured output:** `structured.ts`, `generateStructured(provider, zodSchema, prompt, system)`. Every specialist report must be a zod-validated object, never free text parsed by regex.
- **Meta data:** `src/lib/meta/ops.ts`, `sync.ts` (insights at campaign, ad set and ad level into `daily_metrics`), `client.ts`. Past ads with creative bodies and images are not imported yet; that is the analyst's first job.
- **Connections:** `src/lib/integrations/server.ts`, `researchWeb()` and `callConnectedTool()`. Tools: `research_web` (safe), `list_connected_tools` (safe), `call_connected_tool` (needs approval).
- **Images:** `image-generator.ts` plus `image-store.ts`, `persistGeneratedImage()`. OpenAI only; the free fallback is off unless `IMAGE_FALLBACK_ENABLED=true`.
- **Review status:** `review-status.ts` has one vocabulary: pending, approved, rejected. Publishing only uses approved creatives.
- **Chat UI:** `src/components/chat/*`. Tool calls render as a step timeline with plain-language labels in `tool-steps.tsx`, `STEP_LABELS`. Add labels for every new tool.

## Suggested design (improve it if you find better, but say why)

1. **A specialist is data, not a class hierarchy.** `src/lib/ai/agents/registry.ts` exports one config per agent: `id`, display name, system prompt, tool allow-list, model tier (Brain uses the business's chosen model; Watcher may use a cheaper preset from `model-catalog.ts`), zod report schema, and max rounds.
2. **One delegation tool for the Brain:** `delegate_to_agent({ agent, brief })`. It runs the specialist through `streamAgentMessage` with its allow-listed tools via `executeTool`, validates the report, stores it, writes the key findings to memory, and returns a compact summary to the Brain.
3. **A runs table** (new migration `0006_agent_runs.sql`, with owner RLS and explicit grants as in `0005`): `id, user_id, agent, parent_run_id, brief, status (queued|running|done|failed), report jsonb, tool_calls jsonb, tokens, cost_estimate, error, created_at, finished_at`. Every delegation is inspectable and debuggable.
4. **A playbook** the creative generator reads: either `manager_memory` entries tagged `playbook` in metadata, or a small `creative_playbook` table. Pick one and justify it. The creative generator and the Editor must include the top playbook entries and the latest research in their prompts.
5. **Serverless time limits are the main constraint.** Vercel functions stop at 300 s. A full "build this for me" run (analyst, research, creatives, review) will not fit in one request. Queue runs in `agent_runs`, process them from the heartbeat and from a dedicated route, and let the UI poll or stream progress. Interactive delegations inside chat need a per-agent time budget, for example 90 s.
6. **Cost control.** A per-run token or cost cap, a monthly AI budget per business in `account_strategy`, and the estimated cost shown in the run record.
7. **An Agents page** (`/agents`, in the sidebar): each agent as a card with its last run, status and report; a timeline of runs. In chat, a delegation shows as a step ("Asked the Research agent…") with the report expandable. Match the existing design system: `PageHeader` with an icon, `Section`, `StatTile`, the orb in `src/components/chat/ai-orb.tsx`, and the elevation utilities `elev-1` to `elev-3`.

## Build in phases; each ends green and deployed

Verify every phase with `npm run typecheck && npm run lint && npm test && npm run build`, then commit and push. `master` auto-deploys and is production.

1. **Phase 0, read and confirm.** Run the checks and the read-only Meta smoke test (`npx tsx --env-file=.env.local scripts/smoke-meta-readonly.ts`, 21/21 expected). Propose the data model and registry shape to the owner in plain words. Wait for his yes before migrations.
2. **Phase 1, framework.** Registry, `delegate_to_agent`, `agent_runs` migration, report storage, and findings to memory. Tests: delegated tools go through `executeTool`; a spend tool requested by a specialist is queued for approval exactly as for the Brain; malformed reports are rejected.
3. **Phase 2, Watcher and Creative generator.** They reuse the existing routines and generator. The Watcher runs on the heartbeat with a fatigue rule (frequency above 2.5, or CTR down 30% over 7 days, means rotate) and proposes; the Brain decides within caps. The generator reads playbook and research.
4. **Phase 3, Past-ads analyst.** Import past ads with copy, image URL and ad-level results via Graph, then write the playbook. The first account has zero past ads, so it must also work with an empty history and learn from its own runs.
5. **Phase 4, Editor.** Variants and A/B as separate ads in the same ad set, all PAUSED. Auto-pausing losers needs approval unless the owner turned on auto-optimise.
6. **Phase 5, Research agent.** Uses `research_web` and connected MCP tools. Note: Meta's Ad Library API only exposes political ads in India, so competitor research means websites, social pages, reviews and prices, not their ads.
7. **Phase 6, orchestration and UI.** A "build this for me" flow (Brain asks a few questions, then analyst and research in parallel, then plan, creatives, owner approval, publish PAUSED), the Agents page, and the chat step labels.

## Rules that must not break

- Every Meta write is created **PAUSED**. Never activate, spend or raise a budget without the owner's explicit yes in the product flow, or auto-optimise explicitly on, and never past the caps.
- Specialists never bypass `executeTool`. No direct Graph or MCP calls from agent code.
- Multi-tenant: never hardcode a language, market, currency or the first customer. Read the business profile.
- Never put a base64 image in the database, a tool result or a prompt. Use `persistGeneratedImage()`.
- OpenAI calls go through the provider (`max_completion_tokens`, adaptive parameters). Do not hand-roll `fetch` to OpenAI.
- Test session-less paths (cron, heartbeat, background runs) with a real secret-authenticated call, not from a logged-in page. Twice already, something worked in the browser and failed in the background.
- Do not bypass auth to see signed-in pages. For UI checks, use a throwaway harness app in a git-ignored `.harness/` folder that imports the real page and mocks `fetch` (the method is recorded in the project memory and in `HANDOFF.md`). Delete it before committing.
- Supabase `list_tables` row counts are estimates. Use `select count(*)` or the REST API with `Prefer: count=exact`.
- Migrations: write to `supabase/migrations/`, apply with `node --env-file=.env.local node_modules/prisma/build/index.js db execute --file <file>`, and grant `authenticated` and `service_role` explicitly.
- Confirm with the owner before anything destructive or anything that spends money, including more than a few rupees of AI calls for testing. State the expected cost.

## Ask the owner these before Phase 1

1. Do his customers pay on a website (then the Pixel and Sales path matters) or over WhatsApp or DMs (then the Leads path, Click-to-WhatsApp and Instant Forms, matters)? This changes what the Watcher optimises for.
2. What monthly AI spend per business is acceptable, so cost caps can be set?
3. Should specialists run on his chosen model, or should the Watcher and analyst use a cheaper preset?
4. Is the n8n heartbeat set up yet? It is needed for Phase 2.

## Working conventions

- Commit messages: imperative subject; the body explains why. End with the attribution line your environment specifies.
- Explain things to the owner in plain words. He is not a developer. Lead with the outcome, say what you could not verify, and keep jargon out.
- Prefer real checks over inference. When you cannot verify something, say so.
