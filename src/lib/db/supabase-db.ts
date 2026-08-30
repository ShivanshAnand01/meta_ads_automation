import { getSupabaseServer } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AsyncLocalStorage } from 'async_hooks'

// Intentionally loose Prisma-compatible proxy: returns `any` so callers can
// access fields exactly as Prisma returned them.
/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// camelCase <-> snake_case helpers
// Prisma fields are camelCase; Supabase columns are snake_case.
// ---------------------------------------------------------------------------
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
}
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
function mapKeys<T extends Record<string, unknown>>(obj: T, fn: (k: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[fn(k)] = v
  return out
}
function toCamelRow<T>(row: Record<string, unknown> | null): T | null {
  if (!row) return null
  return mapKeys(row, snakeToCamel) as T
}
function toCamelRows<T>(rows: Record<string, unknown>[] | null): T[] {
  return (rows || []).map((r) => mapKeys(r, snakeToCamel) as T)
}
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}

function preparePayload(data: Record<string, unknown>): Record<string, unknown> {
  const payload = mapKeys(stripUndefined(data), camelToSnake)
  // The server-side callers are responsible for supplying the correct userId
  // (taken from the authenticated session). We keep it in the payload so
  // owner-table inserts satisfy RLS and not-null constraints.
  return payload
}

// Apply a Prisma-like `where` to a Supabase query. Supports `eq` (scalar),
// `{ in: [...] }`, and `{ not: v }`. Column names are camel→snake mapped.
function applyWhere(q: any, where: Where): any {
  for (const [k, v] of Object.entries(where)) {
    const col = camelToSnake(k)
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'in' in (v as Record<string, unknown>)) {
      const arr = (v as Record<string, unknown>).in as unknown[]
      q = q.in(col, arr as never)
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && 'not' in (v as Record<string, unknown>)) {
      q = q.neq(col, (v as Record<string, unknown>).not as never)
    } else {
      q = q.eq(col, v as never)
    }
  }
  return q
}

// Service-role override is request-scoped via AsyncLocalStorage so it never
// leaks across concurrent serverless invocations.
const serviceClientStorage = new AsyncLocalStorage<SupabaseClient>()

export function withServiceClient<T>(client: SupabaseClient, fn: () => Promise<T>): Promise<T> {
  return serviceClientStorage.run(client, fn)
}

/**
 * The Supabase client for the current execution scope: the service-role client
 * when running inside `withServiceClient` (the autonomous runner), otherwise
 * the cookie-bound user client.
 *
 * Callers that drop to raw `supabase.from(...)` MUST use this rather than
 * `getSupabaseServer()` directly — the latter reads request cookies, which do
 * not exist in a background run, so the query silently fails or returns
 * nothing under RLS.
 */
export async function getScopedSupabase(): Promise<SupabaseClient> {
  return serviceClientStorage.getStore() ?? (await getSupabaseServer())
}

type Where = Record<string, unknown>
type Query = {
  where?: Where
  orderBy?: Record<string, 'asc' | 'desc'>
  include?: Record<string, unknown>
  select?: Record<string, boolean>
  take?: number
}

// ---------------------------------------------------------------------------
// Generic model accessor backed by Supabase (RLS-enforced per user)
// ---------------------------------------------------------------------------
function model(table: string) {
  async function client(): Promise<SupabaseClient> {
    const override = serviceClientStorage.getStore()
    if (override) return override
    return getSupabaseServer()
  }

  return {
    async findUnique({ where }: { where: Where }) {
      const supabase = await client()
      let q = supabase.from(table).select('*')
      q = applyWhere(q, where)
      const { data, error } = await q.maybeSingle()
      if (error) throw new Error(`${table}.findUnique: ${error.message}`)
      return toCamelRow(data)
    },

    async findMany(opts: Query = {}) {
      const supabase = await client()
      const { where, orderBy, include, select, take } = opts
      const selectStr = select
        ? Object.keys(select)
            .filter((k) => select[k])
            .map(camelToSnake)
            .join(',')
        : '*'
      let q = supabase.from(table).select(selectStr)
      if (where) q = applyWhere(q, where)
      if (orderBy) {
        for (const [k, dir] of Object.entries(orderBy)) {
          q = q.order(camelToSnake(k), { ascending: dir === 'asc' })
        }
      }
      if (take) q = q.limit(take)
      const { data, error } = await q
      if (error) throw new Error(`${table}.findMany: ${error.message}`)
      const rows = toCamelRows<Record<string, unknown>>(data as unknown as Record<string, unknown>[] | null)
      if (include) return applyIncludes(table, rows, include)
      return rows
    },

    async create({ data }: { data: Record<string, unknown> }) {
      const supabase = await client()
      const payload = preparePayload(data)
      const { data: row, error } = await supabase
        .from(table)
        .insert(payload)
        .select()
        .single()
      if (error) throw new Error(`${table}.create: ${error.message}`)
      return toCamelRow(row)
    },

    async update({ where, data }: { where: Where; data: Record<string, unknown> }) {
      const supabase = await client()
      const payload = preparePayload(data)
      let q = supabase.from(table).update(payload)
      q = applyWhere(q, where)
      const { data: row, error } = await q.select().maybeSingle()
      if (error) throw new Error(`${table}.update: ${error.message}`)
      return toCamelRow(row)
    },

    async delete({ where }: { where: Where }) {
      const supabase = await client()
      let q = supabase.from(table).delete()
      q = applyWhere(q, where)
      const { error } = await q
      if (error) throw new Error(`${table}.delete: ${error.message}`)
    },

    async upsert({ where, update, create }: { where: Where; update: Record<string, unknown>; create: Record<string, unknown> }) {
      const supabase = await client()
      let q = supabase.from(table).select('*')
      q = applyWhere(q, where)
      const { data: existing } = await q.maybeSingle()
      if (existing) {
        const payload = preparePayload(update)
        let u = supabase.from(table).update(payload)
        u = applyWhere(u, where)
        const { data: row, error } = await u.select().maybeSingle()
        if (error) throw new Error(`${table}.upsert.update: ${error.message}`)
        return toCamelRow(row)
      }
      const payload = preparePayload(create)
      const { data: row, error } = await supabase
        .from(table)
        .insert(payload)
        .select()
        .single()
      if (error) throw new Error(`${table}.upsert.insert: ${error.message}`)
      return toCamelRow(row)
    },
  }
}

// ---------------------------------------------------------------------------
// Includes: replicate the exact relation shapes the routes use
// ---------------------------------------------------------------------------
async function applyIncludes(
  table: string,
  rows: Record<string, unknown>[],
  include: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const supabase = serviceClientStorage.getStore() ?? (await getSupabaseServer())

  // ad_creatives -> campaign
  if (table === 'ad_creatives' && include.campaign) {
    const ids = Array.from(
      new Set(rows.map((r) => r.campaignId as string).filter(Boolean))
    )
    const cmap: Record<string, Record<string, unknown>> = {}
    if (ids.length) {
      const { data } = await supabase.from('campaigns').select('*').in('id', ids)
      for (const c of toCamelRows<Record<string, unknown>>(data)) {
        cmap[c.id as string] = c
      }
    }
    for (const r of rows) r.campaign = r.campaignId ? (cmap[r.campaignId as string] || null) : null
    return rows
  }

  // campaigns -> _count.adCreatives
  if (table === 'campaigns' && (include as Record<string, unknown>)?._count) {
    const ids = rows.map((r) => r.id as string).filter(Boolean)
    const counts: Record<string, number> = {}
    if (ids.length) {
      const { data } = await supabase
        .from('ad_creatives')
        .select('campaign_id')
        .in('campaign_id', ids)
      for (const row of data || []) {
        const cid = (row as Record<string, unknown>).campaign_id as string
        if (cid) counts[cid] = (counts[cid] || 0) + 1
      }
    }
    for (const r of rows) r._count = { adCreatives: counts[r.id as string] || 0 }
    return rows
  }

  // ai_conversations -> messages + notes
  if (table === 'ai_conversations') {
    const convIds = rows.map((r) => r.id as string).filter(Boolean)
    if (include.messages) {
      const orderCfg = (include.messages as Record<string, unknown>)?.orderBy as Record<string, string> | undefined
      const ascending = orderCfg?.createdAt ? orderCfg.createdAt === 'asc' : true
      const { data } = await supabase
        .from('ai_messages')
        .select('*')
        .in('conversation_id', convIds)
        .order('created_at', { ascending })
      const grouped: Record<string, Record<string, unknown>[]> = {}
      for (const m of toCamelRows<Record<string, unknown>>(data)) {
        const cid = m.conversationId as string
        ;(grouped[cid] ||= []).push(m)
      }
      for (const r of rows) r.messages = grouped[r.id as string] || []
    }
    if (include.notes) {
      const orderCfg = (include.notes as Record<string, unknown>)?.orderBy as Record<string, string> | undefined
      const ascending = orderCfg?.createdAt ? orderCfg.createdAt === 'asc' : false
      const { data } = await supabase
        .from('ai_notes')
        .select('*')
        .in('conversation_id', convIds)
        .order('created_at', { ascending })
      const grouped: Record<string, Record<string, unknown>[]> = {}
      for (const n of toCamelRows<Record<string, unknown>>(data)) {
        const cid = n.conversationId as string
        ;(grouped[cid] ||= []).push(n)
      }
      for (const r of rows) r.notes = grouped[r.id as string] || []
    }
    return rows
  }

  return rows
}

export const db = {
  aiSettings: model('ai_settings'),
  adCreative: model('ad_creatives'),
  campaign: model('campaigns'),
  aiConversation: model('ai_conversations'),
  aiMessage: model('ai_messages'),
  aiNote: model('ai_notes'),
  aiMessageAttachment: model('ai_message_attachments'),
  metaConnection: model('meta_connections'),
  scheduledJob: model('scheduled_jobs'),
  knowledgeDocument: model('knowledge_documents'),
  knowledgeChunk: model('knowledge_chunks'),
  generatedImage: model('generated_images'),
  // AI Mastermind tables
  accountStrategy: model('account_strategy'),
  managerMemory: model('manager_memory'),
  aiAction: model('ai_actions'),
  dailyMetric: model('daily_metrics'),
  pendingApproval: model('pending_approvals'),
}
