import { db, getScopedSupabase } from '@/lib/db/supabase-db'
import { createAIManager } from '@/lib/ai/manager'
import { createAIProvider } from '@/lib/ai/factory'
import { processAgentMessage } from '@/lib/ai/agent'
import { ALL_TOOLS } from '@/lib/ai/tool-definitions'
import { executeTool } from '@/lib/ai/tools'
import { getProfile, buildProfileContext } from '@/lib/ai/profile'
import { getStrategy, buildStrategyContext } from '@/lib/ai/strategy'
import { getRecentMemory, buildMemoryContext, addMemory, type EmbedConfig } from '@/lib/ai/memory'
import { modelForTier } from '@/lib/ai/model-catalog'
import { redactSecrets } from '@/lib/redact'
import { isDeveloperUserId } from '@/lib/developer'
import { buildLearningContext } from '@/lib/ai/learning/context'
import type { AIProviderType } from '@/lib/ai/types'
import type { MeteredUsage } from '@/lib/ai/usage'
import { getSpecialist, specialistsFor, SPECIALIST_BASE_PROMPT, type SpecialistConfig, type SpecialistReport } from './registry'
import {
  buildSpecialistExecutor, specialistToolContext, specialistToolDefinitions, parseSpecialistReport,
  type ToolLogEntry,
} from './specialist'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Hard ceiling on what one specialist run may spend on AI, in USD. It exists
 * to stop a runaway loop, not to budget: real costs are recorded per call in
 * ai_usage. Override with AGENT_RUN_COST_CAP_USD.
 */
function runCostCapUsd(): number {
  const v = Number(process.env.AGENT_RUN_COST_CAP_USD)
  return Number.isFinite(v) && v > 0 ? v : 0.5
}

const MAX_BRIEF_CHARS = 4000
const MAX_MEMORIES_PER_RUN = 4

export interface AgentRunRow {
  id: string
  userId: string
  agent: string
  brief: string
  mode: 'interactive' | 'background'
  status: 'queued' | 'running' | 'done' | 'failed'
  conversationId?: string | null
  parentRunId?: string | null
}

/** What the AI Manager gets back: short, so it does not flood its own context. */
export interface DelegationResult {
  runId: string | null
  agent: string
  status: 'done' | 'failed' | 'queued'
  summary?: string
  findings?: Array<{ finding: string; evidence: string; source?: string }>
  recommendations?: string[]
  openQuestions?: string[]
  costUsd?: number
  error?: string
  message: string
}

// ── Entry point: the delegate_to_agent tool ──────────────────────────────

export async function delegateToAgent(
  ctx: { userId: string; conversationId?: string },
  args: Record<string, unknown>,
): Promise<DelegationResult> {
  const agentId = String(args.agent ?? '')
  const brief = String(args.brief ?? '').trim()
  const background = args.background === true || args.background === 'true'
  const agent = getSpecialist(agentId)
  const developer = await isDeveloperUserId(ctx.userId)

  if (!agent || !(agent.enabled || developer)) {
    return {
      runId: null, agent: agentId, status: 'failed',
      message: `There is no available specialist called "${agentId}". Available: ${availableList(developer)}.`,
    }
  }
  if (!brief) {
    return { runId: null, agent: agent.id, status: 'failed', message: 'A brief is required: say what you need the specialist to find or make.' }
  }

  const row = (await db.agentRun.create({
    data: {
      userId: ctx.userId,
      agent: agent.id,
      brief: brief.slice(0, MAX_BRIEF_CHARS),
      mode: background ? 'background' : 'interactive',
      status: background ? 'queued' : 'running',
      conversationId: ctx.conversationId ?? null,
      startedAt: background ? null : new Date().toISOString(),
    },
  })) as AgentRunRow | null
  if (!row?.id) {
    return { runId: null, agent: agent.id, status: 'failed', message: 'Could not record the run, so it was not started.' }
  }

  if (background) {
    await kickAgentQueue()
    return {
      runId: row.id, agent: agent.id, status: 'queued',
      message: `${agent.name} is working on this in the background. Its report will appear on the Agents page and in memory when it finishes.`,
    }
  }

  return runSpecialist(row, agent, { budgetMs: agent.interactiveBudgetMs })
}

function availableList(developer: boolean): string {
  return specialistsFor(developer).map((s) => s.id).join(', ') || 'none yet'
}

// ── Running one specialist ───────────────────────────────────────────────

export async function runSpecialist(
  run: AgentRunRow,
  agent: SpecialistConfig,
  opts: { budgetMs: number },
): Promise<DelegationResult> {
  const toolLog: ToolLogEntry[] = []
  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
  const controller = new AbortController()
  let stopReason: string | null = null
  const timer = setTimeout(() => {
    stopReason = `stopped after ${Math.round(opts.budgetMs / 1000)} s (time limit)`
    controller.abort()
  }, opts.budgetMs)
  const costCap = runCostCapUsd()

  let model: string | null = null
  try {
    const manager = await createAIManager({ userId: run.userId, conversationId: run.conversationId ?? undefined, actor: 'agent' })
    const settings = manager.getSettings()
    model = modelForTier(settings.provider, settings.model, agent.modelTier)

    const provider = createAIProvider(
      settings.provider as AIProviderType,
      { apiKey: settings.apiKey || undefined, model, baseUrl: settings.baseUrl || undefined },
      {
        userId: run.userId,
        source: `agent:${agent.id}`,
        agentRunId: run.id,
        onUsage: (u: MeteredUsage) => {
          totals.inputTokens += u.inputTokens
          totals.outputTokens += u.outputTokens
          totals.costUsd += u.costUsd ?? 0
          if (totals.costUsd > costCap && !controller.signal.aborted) {
            stopReason = `stopped at $${totals.costUsd.toFixed(3)} (per-run AI cost limit $${costCap})`
            controller.abort()
          }
        },
      },
    )

    const local = {
      ...manager.getLocalContext(),
      conversationId: run.conversationId ?? undefined,
      provider,
      meter: { userId: run.userId, source: `agent:${agent.id}`, agentRunId: run.id },
      sendEvent: undefined,
    }
    const toolCtx = specialistToolContext({ userId: run.userId, conversationId: run.conversationId ?? undefined, local }, agent)
    const execute = buildSpecialistExecutor(agent, (tool, args) => executeTool(toolCtx, tool, args), (e) => toolLog.push(e))

    const context = await buildSpecialistContext(run.userId)
    const result = await processAgentMessage(
      provider,
      [{ role: 'user', content: `Brief from the AI Manager:\n${run.brief}` }],
      specialistToolDefinitions(agent, ALL_TOOLS),
      execute,
      context,
      { basePrompt: `${SPECIALIST_BASE_PROMPT}\n\n# Your job\n${agent.instructions}`, maxRounds: agent.maxRounds, signal: controller.signal },
    )

    if (stopReason) throw new Error(`The ${agent.name} ${stopReason} before it finished.`)

    const parsed = parseSpecialistReport(result.response)
    if (!parsed.ok) throw new Error(`The ${agent.name}'s report was rejected: ${parsed.error}`)

    await finishRun(run.id, { status: 'done', report: parsed.report, toolLog, totals, model })
    await rememberFindings(run, agent, parsed.report, settings)

    return {
      runId: run.id,
      agent: agent.id,
      status: 'done',
      summary: parsed.report.summary,
      findings: parsed.report.findings
        .slice()
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 6)
        .map(({ finding, evidence, source }) => ({ finding, evidence, source })),
      recommendations: parsed.report.recommendations.slice(0, 5),
      openQuestions: parsed.report.openQuestions.slice(0, 3),
      costUsd: round6(totals.costUsd),
      message: `${agent.name} finished. Full report is on the Agents page.`,
    }
  } catch (err) {
    const error = stopReason && !(err instanceof Error && err.message.includes(stopReason))
      ? `The ${agent.name} ${stopReason} before it finished.`
      : err instanceof Error ? err.message : 'The specialist failed.'
    await finishRun(run.id, { status: 'failed', error, toolLog, totals, model })
    return { runId: run.id, agent: agent.id, status: 'failed', error, costUsd: round6(totals.costUsd), message: error }
  } finally {
    clearTimeout(timer)
  }
}

async function buildSpecialistContext(userId: string): Promise<string> {
  const parts: string[] = []
  try { parts.push(buildProfileContext(await getProfile(userId))) } catch {}
  try { parts.push(buildStrategyContext(await getStrategy(userId))) } catch {}
  try { parts.push(buildMemoryContext(await getRecentMemory(userId, 8))) } catch {}
  parts.push(await buildLearningContext(userId))
  try {
    const rows = (await db.creativePlaybook.findMany({
      where: { userId, status: 'active' },
      orderBy: { confidence: 'desc' },
      take: 8,
    })) as any[]
    if (rows.length) {
      parts.push(['PLAYBOOK (what has won and lost for this business):',
        ...rows.map((r) => `- [${r.verdict}] ${r.dimension}: ${r.finding} (confidence ${r.confidence}, n=${r.sampleSize})`)].join('\n'))
    }
  } catch {}
  return parts.filter(Boolean).join('\n\n')
}

async function finishRun(
  runId: string,
  outcome: {
    status: 'done' | 'failed'
    report?: SpecialistReport
    error?: string
    toolLog: ToolLogEntry[]
    totals: { inputTokens: number; outputTokens: number; costUsd: number }
    model: string | null
  },
): Promise<void> {
  try {
    await db.agentRun.update({
      where: { id: runId },
      data: {
        status: outcome.status,
        report: outcome.report ?? null,
        error: outcome.error ?? null,
        toolCalls: redactSecrets(outcome.toolLog),
        model: outcome.model,
        inputTokens: outcome.totals.inputTokens,
        outputTokens: outcome.totals.outputTokens,
        costUsd: round6(outcome.totals.costUsd),
        finishedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('[agents] could not save run outcome:', err instanceof Error ? err.message : err)
  }
}

/** The run's summary and its most important findings go into shared memory. */
async function rememberFindings(run: AgentRunRow, agent: SpecialistConfig, report: SpecialistReport, settings: any): Promise<void> {
  const embed: EmbedConfig = {
    provider: settings.provider as AIProviderType,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    embeddingKey: settings.embeddingKey ?? null,
  }
  const metadata = { agent: agent.id, runId: run.id }
  try {
    await addMemory({ userId: run.userId, kind: 'summary', content: `[${agent.name}] ${report.summary}`, relatedId: run.id, importance: 5, metadata, embed })
    // What the profile already says is not a finding; saving it would crowd
    // real findings out of the AI Manager's memory.
    const top = report.findings
      .filter((f) => f.importance >= 6 && !/business profile|strategy/i.test(f.source ?? ''))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, MAX_MEMORIES_PER_RUN)
    for (const f of top) {
      await addMemory({
        userId: run.userId,
        kind: 'observation',
        content: `[${agent.name}] ${f.finding}${f.evidence ? ` — ${f.evidence}` : ''}${f.source ? ` (${f.source})` : ''}`,
        relatedId: run.id,
        importance: f.importance,
        metadata,
        embed,
      })
    }
  } catch (err) {
    console.error('[agents] could not write findings to memory:', err instanceof Error ? err.message : err)
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

// ── Background queue ─────────────────────────────────────────────────────

/**
 * Run queued specialist runs until the time budget is spent. Called from the
 * agent-queue cron route (heartbeat, daily cron, and the kick below), always
 * inside withServiceClient.
 */
export async function processAgentQueue(params: { budgetMs: number; limit?: number }): Promise<{ processed: number; results: DelegationResult[] }> {
  const started = Date.now()
  const results: DelegationResult[] = []
  const supabase = await getScopedSupabase()

  const { data: queued } = await supabase
    .from('agent_runs')
    .select('id, user_id, agent, brief, mode, status, conversation_id, parent_run_id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(params.limit ?? 5)

  for (const r of (queued ?? []) as any[]) {
    const remaining = params.budgetMs - (Date.now() - started)
    if (remaining < 45_000) break

    // Claim it: only one invocation may move a run out of 'queued'.
    const { data: claimed } = await supabase
      .from('agent_runs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('status', 'queued')
      .select('id')
    if (!claimed || claimed.length === 0) continue

    const agent = getSpecialist(r.agent)
    const allowed = Boolean(agent?.enabled) || (await isDeveloperUserId(r.user_id))
    const run: AgentRunRow = {
      id: r.id, userId: r.user_id, agent: r.agent, brief: r.brief, mode: r.mode, status: 'running',
      conversationId: r.conversation_id, parentRunId: r.parent_run_id,
    }
    if (!agent || !allowed) {
      const error = `Specialist "${r.agent}" is not available.`
      await finishRun(r.id, { status: 'failed', error, toolLog: [], totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, model: null })
      results.push({ runId: r.id, agent: r.agent, status: 'failed', error, message: error })
      continue
    }
    results.push(await runSpecialist(run, agent, { budgetMs: Math.min(remaining - 15_000, 240_000) }))
  }

  return { processed: results.length, results }
}

/**
 * Ask the agent-queue route to start working now rather than at the next
 * heartbeat. The route answers at once and does the work after responding, so
 * this does not hold up the chat reply. Silent no-op when the app's URL or the
 * runner secret is unknown (local dev): the heartbeat still picks the run up.
 */
export async function kickAgentQueue(): Promise<void> {
  const secret = process.env.RUNNER_SECRET
  const host = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
  if (!secret || !host) return
  try {
    await fetch(`${host.replace(/\/$/, '')}/api/cron/agent-queue`, {
      method: 'POST',
      headers: { 'x-runner-secret': secret },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    console.warn('[agents] could not kick the queue; the heartbeat will run it:', err instanceof Error ? err.message : err)
  }
}
