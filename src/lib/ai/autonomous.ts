import { db } from '@/lib/db/supabase-db'
import { createAutonomousManager, type AIManager } from '@/lib/ai/manager'
import type { ToolCall, ChatMessage } from '@/lib/ai/types'
import { buildStrategyContext } from '@/lib/ai/strategy'
import { buildMemoryContext } from '@/lib/ai/memory'
import { getRecentMemory } from '@/lib/ai/memory'
import { getMetaConnection } from '@/lib/meta/user-client'
import { runReflection } from '@/lib/ai/reflection'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Routine = 'morning_optimization' | 'budget_pacing' | 'anomaly_detection' | 'weekly_report' | 'reflection' | 'custom'

const ROUTINE_PROMPTS: Record<Routine, string> = {
  morning_optimization: `Run your daily morning optimization routine. Steps:
 1. Call sync_campaign_insights (last 30d) so you have real data.
 2. Call get_strategy to confirm targets & guardrails.
 3. Use get_performance_trend to evaluate each campaign vs the target ROAS/CPA.
 4. For campaigns clearly underperforming (ROAS below target for 3+ days, or CPA above cap), pause them via set_campaign_status (active=false) — but never pause all active campaigns at once.
 5. For proven winners (ROAS above target with stable spend), scale their budget by ~20% if it stays within the daily budget cap.
 6. Record a concise "decision" memory of what you did and why.
 7. Finish with a short summary for the client.`,
  budget_pacing: `Run budget pacing. Steps:
 1. sync_campaign_insights (last 7d) and get_strategy.
 2. Compute total spend today/this month vs the daily/monthly caps.
 3. If spend is pacing to overshoot a cap, pause the lowest-ROAS campaigns to stay within the cap.
 4. Record an "observation" memory of the pacing status.`,
  anomaly_detection: `Detect anomalies. Steps:
 1. sync_campaign_insights (last 30d) and get_daily_metrics.
 2. Compare the last 7 days vs the prior 7 days for spend, CPC, CTR, conversions per campaign.
 3. Flag any metric that moved >30% (good or bad) and explain likely causes.
 4. Recommend concrete actions; record a "learning" memory.`,
  weekly_report: `Produce your weekly report. Steps:
 1. sync_campaign_insights (last 7d), get_strategy, get_memory.
 2. Use generate_report to build a structured markdown report.
 3. Summarize what worked, what didn't, and next steps.
 4. Save a "summary" memory of the week's key learnings.`,
  custom: `Run the custom routine described in the job config.`,
  reflection: `Reflect on recent actions and learn. (Handled by the reflection engine — reviews the action log + performance deltas and writes durable learnings to memory.)`,
}

export interface RoutineResult {
  success: boolean
  conversationId: string
  response: string
  toolCalls: number
  message: string
  error?: string
}

/**
 * Run an autonomous routine using the AIManager wrapper.
 *
 * The wrapper encapsulates provider creation, secret resolution, strategy
 * loading, and tool-context setup. When auto-optimize is enabled in the
 * strategy, spend-affecting actions execute directly; otherwise they queue
 * for approval (read-only analysis still runs).
 */
export async function runRoutine(params: {
  userId: string
  routine: Routine
  customPrompt?: string
  jobId?: string
}): Promise<RoutineResult> {
  const { userId, routine, jobId } = params

  // Reflection is a specialized engine, not a free-form agent conversation.
  if (routine === 'reflection') {
    const r = await runReflection({ userId })
    if (jobId) await db.scheduledJob.update({ where: { id: jobId }, data: { lastRunAt: new Date(), nextRunAt: nextCronRun() } }).catch(() => {})
    return { success: r.success, conversationId: '', response: r.message, toolCalls: 0, message: r.message, error: r.error }
  }

  // Initialise the autonomous manager (provider, strategy, tool context)
  let manager: AIManager
  try {
    manager = await createAutonomousManager(userId)
  } catch (e) {
    return { success: false, conversationId: '', response: '', toolCalls: 0, message: 'Failed to initialise AI Manager', error: e instanceof Error ? e.message : 'init error' }
  }

  const strategy = manager.getStrategy()
  const conn = await getMetaConnection(userId).catch(() => null)
  const metaStatus = !conn
    ? 'Meta Ads is NOT connected.'
    : !conn.adAccountId ? 'Meta connected but no ad account selected.' : `Meta connected (${conn.adAccountId}).`

  const memory = await getRecentMemory(userId, 8).catch(() => [])
  const contextString = [
    `AUTONOMOUS RUN — routine: ${routine}. ${metaStatus}`,
    buildStrategyContext(strategy),
    buildMemoryContext(memory),
    'You are running without the client present. Act decisively within guardrails. ' +
      (strategy.autoOptimize
        ? 'auto-optimize is ON: you may execute spend-affecting actions directly. Generate ad creative images when creating new creatives — use generate_creative_with_image or generate_ad_image. Image generation always works (free fallback provider).'
        : 'auto-optimize is OFF: spend-affecting actions will queue for approval — still do read-only analysis, safe optimizations, and image generation for new creatives.'),
  ].filter(Boolean).join('\n\n')

  // Create a conversation for this autonomous run
  const conversation = await db.aiConversation.create({
    data: { userId, title: `Autonomous: ${routine}`, autonomous: true },
  }) as any

  // Wire the conversation ID into the manager's tool context
  manager.getToolContext().conversationId = conversation.id
  manager.getLocalContext().conversationId = conversation.id

  const promptText = routine === 'custom'
    ? (params.customPrompt || ROUTINE_PROMPTS.custom)
    : ROUTINE_PROMPTS[routine]

  await db.aiMessage.create({
    data: { conversationId: conversation.id, role: 'user', content: promptText },
  })

  const history: ChatMessage[] = [{ role: 'user', content: promptText }]

  try {
    const result = await manager.chat(history, contextString)

    // Persist assistant + tool messages (service-role client bypasses RLS)
    await db.aiMessage.create({
      data: {
        conversationId: conversation.id, role: 'assistant',
        content: result.response,
        toolCalls: JSON.stringify(result.toolCalls),
        toolResults: JSON.stringify(result.toolResults),
      },
    })
    for (const tr of result.toolResults as any[]) {
      await db.aiMessage.create({
        data: {
          conversationId: conversation.id, role: 'tool',
          content: JSON.stringify(tr.error ? { error: tr.error } : tr.result ?? {}),
          toolCallId: tr.toolCallId, toolName: tr.toolName,
        },
      })
    }
    for (const note of result.notes) {
      await db.aiNote.create({
        data: { conversationId: conversation.id, title: note.title, content: note.content, type: note.type },
      })
    }

    // Record outcome in memory
    await manager.remember(
      'outcome',
      `Autonomous "${routine}" run: ${result.toolCalls.length} tool calls. ${result.response.slice(0, 280)}`,
      6,
    )

    if (jobId) {
      const next = nextCronRun()
      await db.scheduledJob.update({ where: { id: jobId }, data: { lastRunAt: new Date(), nextRunAt: next } }).catch(() => {})
    }

    return {
      success: true,
      conversationId: conversation.id,
      response: result.response,
      toolCalls: (result.toolCalls as ToolCall[]).length,
      message: `Routine "${routine}" completed`,
    }
  } catch (e) {
    return {
      success: false, conversationId: conversation.id, response: '', toolCalls: 0,
      message: 'Routine failed', error: e instanceof Error ? e.message : 'unknown error',
    }
  }
}

function nextCronRun(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d
}
