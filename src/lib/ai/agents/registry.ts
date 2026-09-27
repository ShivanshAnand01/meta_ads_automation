import { z } from 'zod'

/**
 * The AI Manager's team. A specialist is data, not a class: its job, the tools
 * it may touch, the model tier it runs on, and the report it must return.
 *
 * The hard rule: no specialist is given any tool that spends, publishes,
 * deletes or changes live ads. Specialists look, write drafts and propose; only
 * the AI Manager (the Brain) acts, through the same approval gate as always.
 * tests/agents.test.ts fails the build if an allow-list ever breaks that.
 */

export const AGENT_IDS = ['research', 'past_ads_analyst', 'creative', 'watcher', 'editor'] as const
export type AgentId = (typeof AGENT_IDS)[number]

/** Every specialist report shares this shape; the runner rejects anything else. */
export const specialistReportSchema = z.object({
  summary: z.string().min(1).max(2000),
  findings: z
    .array(
      z.object({
        finding: z.string().min(1).max(600),
        evidence: z.string().max(600).default(''),
        importance: z.coerce.number().int().min(1).max(10).default(5),
        source: z.string().max(400).optional(),
      }),
    )
    .max(20)
    .default([]),
  recommendations: z.array(z.string().min(1).max(600)).max(10).default([]),
  openQuestions: z.array(z.string().min(1).max(400)).max(10).default([]),
})

export type SpecialistReport = z.infer<typeof specialistReportSchema>

export interface SpecialistConfig {
  id: AgentId
  name: string
  /** One line: shown to the AI Manager in the delegate tool and to the owner on the Agents page. */
  job: string
  /** Off until the phase that builds its tools and data ships. */
  enabled: boolean
  /** owner = the business's chosen model; economy = the provider's low-cost model. */
  modelTier: 'owner' | 'economy'
  tools: readonly string[]
  maxRounds: number
  /** Wall-clock budget when the AI Manager waits for it inside a chat reply. */
  interactiveBudgetMs: number
  instructions: string
}

const READ_CONTEXT = ['get_business_profile', 'get_strategy', 'get_memory', 'search_memory', 'search_knowledge_base'] as const
const READ_PERFORMANCE = [
  'sync_campaign_insights', 'get_daily_metrics', 'get_performance_trend', 'get_dashboard_summary',
  'list_campaigns', 'list_ad_sets', 'list_ads', 'get_insights', 'compare_performance',
] as const

export const SPECIALISTS: Record<AgentId, SpecialistConfig> = {
  research: {
    id: 'research',
    name: 'Research agent',
    job: 'Researches competitors, market prices, reviews, trends and the landing page on the web, and reports what it found with sources.',
    enabled: true,
    modelTier: 'owner',
    tools: [...READ_CONTEXT, 'research_web', 'list_connected_tools'],
    maxRounds: 6,
    interactiveBudgetMs: 90_000,
    instructions: `You are the Research agent. You research the market for this business so the AI Manager can plan ads on facts, not guesses.
- Read the business profile first so every search is about THIS business, its products, city and customers.
- Use research_web with specific queries (product, city, competitor names). Prefer several narrow searches over one broad one.
- Every finding must say where it came from: put the URL or the tool in "source". Never invent a competitor, price or statistic.
- If research_web says no research tool is connected, say so plainly in the summary and report only what the profile and knowledge base tell you.
- Competitor research means their websites, social pages, reviews and prices. Meta's Ad Library does not expose their commercial ads in India.`,
  },
  past_ads_analyst: {
    id: 'past_ads_analyst',
    name: 'Past-ads analyst',
    job: 'Studies past ads and their results and writes the playbook: which hooks, offers, images, audiences and placements won or lost, with numbers.',
    enabled: false,
    modelTier: 'economy',
    tools: [...READ_CONTEXT, ...READ_PERFORMANCE, 'list_creatives', 'get_local_creatives'],
    maxRounds: 8,
    interactiveBudgetMs: 90_000,
    instructions: `You are the Past-ads analyst. Compare what ran against its results and name the patterns that won and lost, always with the numbers behind them (impressions, CTR, CPC, conversions). Too little data is a finding: say how much more is needed before a pattern can be trusted.`,
  },
  creative: {
    id: 'creative',
    name: 'Creative generator',
    job: 'Writes ad copy and images from a brief, grounded in the playbook, research and business profile. Saves drafts for the owner to approve.',
    enabled: false,
    modelTier: 'owner',
    tools: [...READ_CONTEXT, 'get_local_creatives', 'generate_creative_with_image', 'review_creative'],
    maxRounds: 6,
    interactiveBudgetMs: 150_000,
    instructions: `You are the Creative generator. Write in the language and script of the business profile. Build on what the playbook says won; avoid what lost. Every creative you make is saved as a draft pending the owner's approval — say so, and never describe a draft as live.`,
  },
  watcher: {
    id: 'watcher',
    name: 'Watcher',
    job: 'Reads live results, flags tired ads and anomalies, and proposes fixes for the AI Manager to decide on.',
    enabled: false,
    modelTier: 'economy',
    tools: [...READ_CONTEXT, ...READ_PERFORMANCE],
    maxRounds: 6,
    interactiveBudgetMs: 90_000,
    instructions: `You are the Watcher. Report what changed in live results and why it matters. You propose; the AI Manager decides. Never claim you paused, scaled or changed anything.`,
  },
  editor: {
    id: 'editor',
    name: 'Editor',
    job: 'Improves or varies an existing creative from feedback and prepares A/B variants as drafts.',
    enabled: false,
    modelTier: 'owner',
    tools: [...READ_CONTEXT, 'get_local_creatives', 'review_creative', 'generate_creative_with_image'],
    maxRounds: 6,
    interactiveBudgetMs: 150_000,
    instructions: `You are the Editor. Make a variant that changes one thing at a time so an A/B test can tell what worked. Variants are saved as drafts pending the owner's approval.`,
  },
}

export function getSpecialist(id: string): SpecialistConfig | null {
  return (AGENT_IDS as readonly string[]).includes(id) ? SPECIALISTS[id as AgentId] : null
}

export function enabledSpecialists(): SpecialistConfig[] {
  return AGENT_IDS.map((id) => SPECIALISTS[id]).filter((s) => s.enabled)
}

/** Rules every specialist follows, whatever its job. */
export const SPECIALIST_BASE_PROMPT = `You are a specialist on the AI Manager's team for a Meta (Facebook/Instagram) ads platform. The AI Manager gave you a brief; do that job and report back. You never talk to the business owner directly.

Rules that are enforced in code, not just asked of you:
- You cannot publish, spend, pause, change budgets or delete anything. Those tools are not available to you. If something should change, recommend it; the AI Manager decides.
- Only use the tools you were given. Work from real data returned by tools; if data is missing, say so instead of filling the gap.
- Be brief and specific. Numbers beat adjectives.
- Importance means "how much this changes what the AI Manager should do". 8-10 only for NEW facts it does not already have. Restating the business profile, strategy or memory you were given is importance 1-3 — leave it out unless it matters.

When you are done, end your reply with one fenced block tagged report, containing JSON of exactly this shape:
\`\`\`report
{"summary":"2-4 sentences: what you found and what it means","findings":[{"finding":"one fact","evidence":"the number or quote behind it","importance":1-10,"source":"URL or tool"}],"recommendations":["a concrete next step"],"openQuestions":["what only the owner can answer"]}
\`\`\``
