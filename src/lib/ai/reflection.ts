import { getSupabaseServer } from '@/lib/supabase/server'
import { db } from '@/lib/db/supabase-db'
import { createAIProvider } from '@/lib/ai/factory'
import { addMemory, type EmbedConfig } from '@/lib/ai/memory'
import type { AIProviderType } from '@/lib/ai/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ReflectionResult {
  success: boolean
  learnings: number
  message: string
  error?: string
}

/**
 * Mine recent actions + performance deltas for causal learnings, and persist
 * them as `learning` memories (embedded) so the mastermind improves over time.
 */
export async function runReflection(params: {
  userId: string
  actionsLimit?: number
}): Promise<ReflectionResult> {
  const { userId } = params
  const settings = await db.aiSettings.findUnique({ where: { userId } }) as any
  if (!settings) return { success: false, learnings: 0, message: 'No AI settings configured' }

  const provider = createAIProvider(settings.provider as AIProviderType, {
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    baseUrl: settings.baseUrl || undefined,
  })

  const embed: EmbedConfig = {
    provider: settings.provider as AIProviderType,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    embeddingKey: settings.embeddingKey ?? null,
  }

  // 1. Recent actions (what the manager actually did)
  let actionsText = ''
  try {
    const supabase = await getSupabaseServer()
    const { data } = await supabase.rpc('recent_actions', { p_user_id: userId, p_limit: params.actionsLimit ?? 40 })
    actionsText = (data as any[] || [])
      .map((a, i) => `${i + 1}. [${a.status}] ${a.tool_name}(${(a.arguments || '').toString().slice(0, 120)}) → ${(a.result || '').toString().slice(0, 80)}`)
      .join('\n')
  } catch {}
  if (!actionsText) actionsText = '(no recent actions)'

  // 2. Performance deltas: last 7d vs prior 7d
  const deltas = await computeDeltas(userId)
  const deltasText = deltas
    ? `Last 7d: spend ₹${deltas.recent.spend.toFixed(0)}, clicks ${deltas.recent.clicks}, conversions ${deltas.recent.conversions}. Prior 7d: spend ₹${deltas.prior.spend.toFixed(0)}, clicks ${deltas.prior.clicks}, conversions ${deltas.prior.conversions}. Δ spend ${(pct(deltas.recent.spend, deltas.prior.spend))}%, Δ conversions ${(pct(deltas.recent.conversions, deltas.prior.conversions))}%.`
    : '(no performance data yet — sync Meta insights first)'

  // 3. Ask the model for causal learnings
  const prompt = `You are the AI Manager reflecting on recent actions and their performance impact to extract durable learnings.

RECENT ACTIONS:
${actionsText}

PERFORMANCE DELTA (last 7d vs prior 7d):
${deltasText}

Extract 2-5 CONCISE, ACTIONABLE learnings that will make future decisions better. Each learning should connect an action to an outcome where possible (e.g. "Pausing campaign X after ROAS<1 for 2 days reduced waste without hurting conversions — safe to auto-pause clear losers"). Avoid generic advice.

Respond ONLY with valid JSON: { "learnings": ["...", "..."] }`

  let learnings: string[] = []
  try {
    const raw = await provider.generateCompletion(prompt, 'You are an expert at extracting actionable learnings from marketing action logs. Respond only with valid JSON.')
    learnings = parseLearnings(raw)
  } catch (e) {
    return { success: false, learnings: 0, message: 'Reflection LLM call failed', error: e instanceof Error ? e.message : 'failed' }
  }

  if (learnings.length === 0) return { success: true, learnings: 0, message: 'No new learnings extracted.' }

  // 4. Persist as embedded learning memories
  let stored = 0
  for (const l of learnings) {
    try {
      await addMemory({ userId, kind: 'learning', content: l, importance: 7, embed })
      stored++
    } catch {}
  }

  return { success: true, learnings: stored, message: `Learned ${stored} new lesson(s) from recent actions.` }
}

function pct(recent: number, prior: number): string {
  if (prior === 0) return recent > 0 ? '+∞' : '0'
  const d = ((recent - prior) / prior) * 100
  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`
}

async function computeDeltas(userId: string): Promise<{ recent: any; prior: any } | null> {
  const supabase = await getSupabaseServer()
  const to = (d: Date) => d.toISOString().split('T')[0]
  const today = new Date()
  const r7 = new Date(); r7.setDate(r7.getDate() - 7)
  const p7 = new Date(); p7.setDate(p7.getDate() - 14)

  const { data: recentRows } = await supabase
    .from('daily_metrics').select('spend, clicks, conversions')
    .eq('user_id', userId).gte('date', to(r7)).lte('date', to(today))
  const { data: priorRows } = await supabase
    .from('daily_metrics').select('spend, clicks, conversions')
    .eq('user_id', userId).gte('date', to(p7)).lt('date', to(r7))

  const sum = (rows: any[] | null) => (rows || []).reduce((a, r) => ({
    spend: a.spend + Number(r.spend) || 0,
    clicks: a.clicks + Number(r.clicks) || 0,
    conversions: a.conversions + Number(r.conversions) || 0,
  }), { spend: 0, clicks: 0, conversions: 0 })

  if (!recentRows?.length && !priorRows?.length) return null
  return { recent: sum(recentRows), prior: sum(priorRows) }
}

function parseLearnings(raw: string): string[] {
  let s = raw.trim()
  if (s.startsWith('```json')) s = s.slice(7)
  if (s.startsWith('```')) s = s.slice(3)
  if (s.endsWith('```')) s = s.slice(0, -3)
  s = s.trim()
  try {
    const obj = JSON.parse(s) as { learnings?: string[] }
    return Array.isArray(obj.learnings) ? obj.learnings.filter((x) => typeof x === 'string' && x.trim()).slice(0, 5) : []
  } catch {
    return []
  }
}
