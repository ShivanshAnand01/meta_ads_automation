import { db } from '@/lib/db/supabase-db'
import { getSupabaseServer } from '@/lib/supabase/server'
import { generateEmbedding, canGenerateEmbeddings } from '@/lib/ai/rag'
import type { AIProviderType } from '@/lib/ai/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MemoryKind = 'summary' | 'decision' | 'observation' | 'learning' | 'outcome'

export interface ManagerMemory {
  id: string
  userId: string
  kind: string
  content: string
  relatedId?: string | null
  importance: number
  metadata?: string | null
  createdAt: string
  similarity?: number
}

export interface EmbedConfig {
  provider: AIProviderType
  apiKey?: string | null
  baseUrl?: string | null
  embeddingKey?: string | null
}

export async function addMemory(params: {
  userId: string
  kind: MemoryKind
  content: string
  relatedId?: string | null
  importance?: number
  metadata?: Record<string, unknown> | null
  embed?: EmbedConfig | null
}): Promise<ManagerMemory> {
  let embedding: number[] | null = null
  if (params.embed && canGenerateEmbeddings(params.embed.provider, params.embed.apiKey ?? undefined, params.embed.embeddingKey)) {
    try {
      embedding = await generateEmbedding(
        params.content,
        params.embed.provider,
        params.embed.apiKey,
        params.embed.baseUrl,
        params.embed.embeddingKey,
      )
    } catch {
      embedding = null
    }
  }

  const row = await db.managerMemory.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      content: params.content,
      relatedId: params.relatedId || null,
      importance: params.importance ?? 5,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      // pgvector accepts a Postgres array literal directly from supabase-js.
      embedding: embedding ?? null,
    },
  }) as any
  return row as ManagerMemory
}

export async function getRecentMemory(userId: string, limit = 12): Promise<ManagerMemory[]> {
  const rows = await db.managerMemory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  }) as any[]
  return rows as ManagerMemory[]
}

/** Semantic recall: find memories relevant to a query via pgvector. */
export async function searchMemory(
  userId: string,
  query: string,
  embed: EmbedConfig,
  topK = 6,
): Promise<ManagerMemory[]> {
  if (!canGenerateEmbeddings(embed.provider, embed.apiKey ?? undefined, embed.embeddingKey)) return []
  const queryEmbedding = await generateEmbedding(query, embed.provider, embed.apiKey, embed.baseUrl, embed.embeddingKey)
  if (!queryEmbedding) return []

  try {
    const supabase = await getSupabaseServer()
    const { data, error } = await supabase.rpc('match_memory', {
      p_user_id: userId,
      p_embedding: queryEmbedding,
      p_match_count: topK,
      p_match_threshold: 0.6,
    })
    if (error || !data) return []
    return (data as any[]).map((r) => ({
      id: r.id, userId, kind: r.kind, content: r.content,
      relatedId: r.related_id, importance: r.importance, similarity: r.similarity,
      createdAt: '',
    }))
  } catch {
    return []
  }
}

/**
 * Merge recent memories with semantically-relevant ones (deduped, recency
 * first, relevance boosting). Used to build the memory context each turn.
 */
export async function retrieveRelevantMemory(
  userId: string,
  query: string,
  embed: EmbedConfig | null,
  topK = 6,
): Promise<ManagerMemory[]> {
  const recent = await getRecentMemory(userId, 8)
  if (!embed) return recent
  const relevant = await searchMemory(userId, query, embed, topK)
  if (relevant.length === 0) return recent

  const seen = new Set<string>()
  const merged: ManagerMemory[] = []
  for (const m of recent) { if (!seen.has(m.id)) { seen.add(m.id); merged.push(m) } }
  for (const m of relevant) { if (!seen.has(m.id)) { seen.add(m.id); merged.push(m) } }
  return merged.slice(0, 14)
}

export async function deleteMemory(userId: string, memoryId: string): Promise<void> {
  await db.managerMemory.delete({ where: { id: memoryId, userId } })
}

export function buildMemoryContext(memories: ManagerMemory[]): string {
  if (memories.length === 0) return ''
  const lines = ['MANAGER MEMORY (your rolling memory of past decisions, observations & learnings — use this to stay consistent and avoid repeating mistakes):']
  for (const m of memories) {
    const tag = m.similarity != null ? ` (${(m.similarity * 100).toFixed(0)}% relevant)` : ''
    lines.push(`[${m.kind}]${tag} ${m.content}`)
  }
  return lines.join('\n')
}
