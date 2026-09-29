import { getScopedSupabase } from '@/lib/db/supabase-db'
import { lessonsFromResult } from './outcome'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type LearningKind = 'pitfall' | 'fix' | 'owner_preference' | 'owner_feedback' | 'operating_note' | 'platform_suggestion'

export interface Learning {
  id: string
  userId: string
  kind: LearningKind
  signature: string
  statement: string
  detail: Record<string, unknown>
  source: string
  occurrences: number
  confidence: number
  status: 'active' | 'resolved' | 'dismissed'
  firstSeen: string
  lastSeen: string
  resolvedAt: string | null
}

function toLearning(r: any): Learning {
  return {
    id: r.id, userId: r.user_id, kind: r.kind, signature: r.signature, statement: r.statement,
    detail: r.detail ?? {}, source: r.source, occurrences: r.occurrences, confidence: Number(r.confidence),
    status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen, resolvedAt: r.resolved_at,
  }
}

/**
 * Record a lesson. Seen before → count it and refresh it. A lesson the owner
 * dismissed stays dismissed: they said it is wrong, and repetition does not
 * make it right. A resolved pitfall that happens again becomes active again.
 */
export async function upsertLearning(input: {
  userId: string
  kind: LearningKind
  signature: string
  statement: string
  source: string
  detail?: Record<string, unknown>
  confidence?: number
}): Promise<void> {
  const supabase = await getScopedSupabase()
  const now = new Date().toISOString()
  const signature = input.signature.slice(0, 300)
  const { data: existing } = await supabase
    .from('ai_learnings')
    .select('id, occurrences, status, confidence')
    .eq('user_id', input.userId).eq('kind', input.kind).eq('signature', signature)
    .maybeSingle()

  if (existing) {
    await supabase.from('ai_learnings').update({
      statement: input.statement.slice(0, 1200),
      detail: input.detail ?? {},
      occurrences: (existing as any).occurrences + 1,
      last_seen: now,
      confidence: Math.max(Number((existing as any).confidence), input.confidence ?? 0),
      ...((existing as any).status === 'resolved' ? { status: 'active', resolved_at: null } : {}),
    }).eq('id', (existing as any).id)
    return
  }
  await supabase.from('ai_learnings').insert({
    user_id: input.userId,
    kind: input.kind,
    signature,
    statement: input.statement.slice(0, 1200),
    detail: input.detail ?? {},
    source: input.source,
    confidence: input.confidence ?? 0.5,
  })
}

/** Mark matching active pitfalls resolved: the thing that failed works now. */
export async function resolvePitfalls(userId: string, prefixes: string[], keep: string[] = []): Promise<number> {
  if (prefixes.length === 0) return 0
  const supabase = await getScopedSupabase()
  const { data } = await supabase
    .from('ai_learnings')
    .select('id, signature')
    .eq('user_id', userId).eq('kind', 'pitfall').eq('status', 'active')
  const ids = ((data ?? []) as any[])
    .filter((r) => prefixes.some((p) => r.signature.startsWith(p)) && !keep.includes(r.signature))
    .map((r) => r.id)
  if (ids.length === 0) return 0
  await supabase.from('ai_learnings').update({ status: 'resolved', resolved_at: new Date().toISOString() }).in('id', ids)
  return ids.length
}

/**
 * Learn from one tool call. Called by the dispatcher after every call; never
 * throws, because learning must not break the action it is learning from.
 */
export async function recordToolOutcome(userId: string, tool: string, result: unknown): Promise<void> {
  try {
    const lessons = lessonsFromResult(tool, result)
    for (const p of lessons.pitfalls) {
      await upsertLearning({ userId, kind: 'pitfall', signature: p.signature, statement: p.statement, source: p.signature.startsWith('readiness:') ? 'readiness' : 'tool_failure', detail: p.detail, confidence: 0.9 })
    }
    if (lessons.resolvePrefixes?.length) await resolvePitfalls(userId, lessons.resolvePrefixes, lessons.keepSignatures)
  } catch (err) {
    console.warn('[learning] could not record outcome:', err instanceof Error ? err.message : err)
  }
}

export async function listLearnings(userId: string, opts: { status?: Learning['status'][]; kinds?: LearningKind[]; limit?: number } = {}): Promise<Learning[]> {
  const supabase = await getScopedSupabase()
  let q = supabase.from('ai_learnings').select('*').eq('user_id', userId)
  if (opts.status?.length) q = q.in('status', opts.status)
  if (opts.kinds?.length) q = q.in('kind', opts.kinds)
  const { data } = await q.order('last_seen', { ascending: false }).limit(opts.limit ?? 200)
  return ((data ?? []) as any[]).map(toLearning)
}
