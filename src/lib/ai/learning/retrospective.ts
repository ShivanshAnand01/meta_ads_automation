import { z } from 'zod'
import { db, getScopedSupabase } from '@/lib/db/supabase-db'
import { generateStructured } from '@/lib/ai/structured'
import { learningProvider } from './provider'
import { listLearnings, upsertLearning } from './store'
import { extractOwnerPreferences } from './preferences'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Self-improvement: the weekly retrospective.
 *
 * Reads what actually happened for one business — pitfalls and fixes, the
 * owner's approvals, rejections and rewrites, preferences, agent and tool
 * failure rates — and rewrites the AI's working notes for that business
 * (at most eight, each tied to evidence). Notes it no longer supports are
 * retired, so the set stays current instead of growing.
 *
 * It also proposes improvements to the platform itself, which only the
 * developer sees (developer console).
 *
 * Inputs are structured records only — never web pages or specialist
 * research text — so nothing a third party wrote can become an instruction.
 */

export const retrospectiveSchema = z.object({
  operatingNotes: z
    .array(z.object({
      topic: z.string().regex(/^[a-z0-9_]{2,40}$/),
      note: z.string().min(10).max(260),
      evidence: z.string().max(260).default(''),
    }))
    .max(8),
  platformSuggestions: z
    .array(z.object({
      topic: z.string().regex(/^[a-z0-9_]{2,40}$/),
      suggestion: z.string().min(10).max(300),
      evidence: z.string().max(260).default(''),
    }))
    .max(5)
    .default([]),
  summary: z.string().max(600).default(''),
})

const SYSTEM = `You are reviewing one week of an AI ad manager's work for one business, to make it better next week.
You receive EVENTS only: what failed and why, what got fixed, what the owner approved, rejected or rewrote, and failure rates.
(The AI already reads the business profile and the owner's preferences separately; you are not shown them, and must not invent any.)

Write the AI's WORKING NOTES for this business: at most 8 short, concrete rules that would have avoided these failures or matched the owner's decisions better.
- Every note must come from a specific event above; quote or name it in "evidence". No generic advertising advice, no rules about language, market or landing page unless an owner rewrite or rejection shows it.
- Fewer, sharper notes beat many. Zero notes is right when nothing happened.
- Notes must never loosen approvals, budget caps or safety rules, and must never tell the AI to act without the owner's approval.
- A temporary state (a missing payment method) is something to check before acting, not a permanent rule about the business.

Separately, list up to 5 PLATFORM SUGGESTIONS for the developer of the software itself (a bug, a confusing step, a missing feature),
only when the evidence shows the software, not the business, caused the problem.

Respond ONLY with JSON: {"operatingNotes":[{"topic":"snake_case","note":"...","evidence":"..."}],"platformSuggestions":[{"topic":"snake_case","suggestion":"...","evidence":"..."}],"summary":"one paragraph"}`

export async function runRetrospective(userId: string): Promise<{ success: boolean; notes: number; suggestions: number; costUsd: number; message: string }> {
  let costUsd = 0
  const llm = await learningProvider(userId, 'learning:retrospective', (u) => { costUsd += u.costUsd ?? 0 })
  if (!llm) return { success: false, notes: 0, suggestions: 0, costUsd: 0, message: 'No AI provider configured' }

  // Refresh what we know about the owner first, so the review uses it.
  await extractOwnerPreferences(userId).catch(() => null)

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const supabase = await getScopedSupabase()
  const [learnings, actionsRes, runsRes] = await Promise.all([
    listLearnings(userId, { status: ['active', 'resolved'], limit: 150 }),
    supabase.from('ai_actions').select('tool_name, status').eq('user_id', userId).gte('created_at', since).limit(5000),
    supabase.from('agent_runs').select('agent, status, error').eq('user_id', userId).gte('created_at', since).neq('agent', 'retrospective').limit(500),
  ])

  const toolStats = new Map<string, { ok: number; failed: number }>()
  for (const a of (actionsRes.data ?? []) as any[]) {
    const s = toolStats.get(a.tool_name) ?? { ok: 0, failed: 0 }
    if (a.status === 'error') s.failed++
    else if (a.status === 'success') s.ok++
    toolStats.set(a.tool_name, s)
  }
  const agentStats = new Map<string, { runs: number; failed: number; errors: string[] }>()
  for (const r of (runsRes.data ?? []) as any[]) {
    const s = agentStats.get(r.agent) ?? { runs: 0, failed: 0, errors: [] }
    s.runs++
    if (r.status === 'failed') { s.failed++; if (r.error && s.errors.length < 2) s.errors.push(String(r.error).slice(0, 160)) }
    agentStats.set(r.agent, s)
  }

  const section = (title: string, items: string[]) => (items.length ? `${title}:\n${items.join('\n')}` : `${title}: none`)
  const byKind = (k: string, status = 'active') => learnings.filter((l) => l.kind === k && l.status === status)
  const facts = [
    section('Unresolved problems', byKind('pitfall').map((l) => `- ${l.statement} (seen ${l.occurrences}×, last ${l.lastSeen.slice(0, 10)})`)),
    section('Problems fixed recently', byKind('pitfall', 'resolved').slice(0, 10).map((l) => `- ${l.statement.replace(/ Fix: .*$/, '')} (fixed ${String(l.resolvedAt).slice(0, 10)})`)),
    section("Owner's decisions", byKind('owner_feedback').slice(0, 25).map((l) => `- ${l.statement}`)),
    section('Tool results, last 14 days', [...toolStats].filter(([, s]) => s.failed > 0 || s.ok > 3).map(([t, s]) => `- ${t}: ${s.ok} ok, ${s.failed} failed`)),
    section('Specialist runs, last 14 days', [...agentStats].map(([a, s]) => `- ${a}: ${s.runs} runs, ${s.failed} failed${s.errors.length ? ` (${s.errors.join(' | ')})` : ''}`)),
  ].join('\n\n')

  const run = (await db.agentRun.create({
    data: { userId, agent: 'retrospective', mode: 'background', status: 'running', brief: 'Weekly learning review', startedAt: new Date().toISOString() },
  }).catch(() => null)) as any

  let out: z.infer<typeof retrospectiveSchema>
  try {
    out = await generateStructured(llm.provider, retrospectiveSchema, facts, SYSTEM)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'review failed'
    if (run?.id) await db.agentRun.update({ where: { id: run.id }, data: { status: 'failed', error: message, costUsd, model: llm.model, finishedAt: new Date().toISOString() } }).catch(() => {})
    return { success: false, notes: 0, suggestions: 0, costUsd, message }
  }

  // Write the new set; retire notes the review no longer supports.
  const keep = new Set<string>()
  for (const n of out.operatingNotes) {
    const signature = `note:${n.topic}`
    keep.add(signature)
    await upsertLearning({ userId, kind: 'operating_note', signature, statement: n.note, source: 'retrospective', detail: { evidence: n.evidence }, confidence: 0.7 })
  }
  const retired = byKind('operating_note').filter((l) => !keep.has(l.signature)).map((l) => l.id)
  if (retired.length) await supabase.from('ai_learnings').update({ status: 'resolved', resolved_at: new Date().toISOString() }).in('id', retired)

  for (const s of out.platformSuggestions) {
    await upsertLearning({ userId, kind: 'platform_suggestion', signature: `suggest:${s.topic}`, statement: s.suggestion, source: 'retrospective', detail: { evidence: s.evidence }, confidence: 0.6 })
  }

  if (run?.id) {
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: 'done', report: out, costUsd, model: llm.model, finishedAt: new Date().toISOString() },
    }).catch(() => {})
  }
  return {
    success: true,
    notes: out.operatingNotes.length,
    suggestions: out.platformSuggestions.length,
    costUsd,
    message: `Learning review done: ${out.operatingNotes.length} working note(s), ${retired.length} retired, ${out.platformSuggestions.length} platform suggestion(s). ${out.summary}`,
  }
}

/**
 * Called from the scheduler tick: review businesses that were active this
 * week and have not been reviewed in the last 7 days. Bounded per tick.
 */
export async function runDueRetrospectives(params: { max: number }): Promise<Array<{ userId: string; message: string }>> {
  const supabase = await getScopedSupabase()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [{ data: active }, { data: recent }] = await Promise.all([
    supabase.from('ai_actions').select('user_id').gte('created_at', weekAgo).limit(5000),
    supabase.from('agent_runs').select('user_id').eq('agent', 'retrospective').gte('created_at', weekAgo),
  ])
  const reviewed = new Set(((recent ?? []) as any[]).map((r) => r.user_id))
  const due = [...new Set(((active ?? []) as any[]).map((r) => r.user_id))].filter((u) => !reviewed.has(u)).slice(0, params.max)
  const results: Array<{ userId: string; message: string }> = []
  for (const userId of due) {
    const r = await runRetrospective(userId).catch((e) => ({ message: e instanceof Error ? e.message : 'failed' }))
    results.push({ userId, message: r.message })
  }
  return results
}
