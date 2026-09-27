import { db } from '@/lib/db/supabase-db'
import { costUsd } from '@/lib/ai/pricing'
import type { TokenUsage, UsageReporter } from '@/lib/ai/types'

/**
 * Who a model call is billed to and why. Every provider the app creates for a
 * business carries one, so the platform's running cost is measured per
 * business and per source (chat, routines, creatives, images, specialists).
 */
export interface UsageMeter {
  userId: string
  /** chat · autonomous:<routine> · reflection · creative:generate · image · agent:<id> … */
  source: string
  agentRunId?: string | null
  /** Called after each call is priced — how a specialist run enforces its cost cap. */
  onUsage?: (usage: MeteredUsage) => void
}

export interface MeteredUsage extends TokenUsage {
  provider: string
  model: string
  costUsd: number | null
}

/** Price one call, tell the meter, and append it to the ledger. Never throws. */
export async function recordUsage(meter: UsageMeter, provider: string, model: string, usage: TokenUsage): Promise<void> {
  const cost = costUsd(model, usage)
  try {
    meter.onUsage?.({ ...usage, provider, model, costUsd: cost })
  } catch { /* a meter callback must not break the call it measures */ }
  try {
    await db.aiUsage.create({
      data: {
        userId: meter.userId,
        source: meter.source,
        agentRunId: meter.agentRunId ?? null,
        provider,
        model,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens ?? 0,
        outputTokens: usage.outputTokens,
        costUsd: cost,
      },
    })
  } catch (err) {
    console.error('[usage] could not record AI usage:', err instanceof Error ? err.message : err)
  }
}

/** Record an image generation's billed tokens, if the provider reported them. */
export async function recordImageUsage(meter: UsageMeter, result: { provider: string; usage?: TokenUsage }): Promise<void> {
  if (result.usage) await recordUsage(meter, 'openai', result.provider, result.usage)
}

export function usageReporter(meter: UsageMeter | undefined, provider: string): UsageReporter | undefined {
  if (!meter) return undefined
  return (model, usage) => recordUsage(meter, provider, model, usage)
}
