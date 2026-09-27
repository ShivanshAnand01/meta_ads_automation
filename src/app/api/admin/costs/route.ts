import { getSessionUser, createSupabaseServiceClient, handleError } from '@/lib/supabase/server'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The platform's running AI cost, across every business — for the developer,
 * not for the businesses. Answers "what does it cost to run this, per
 * business, per feature?" from the ai_usage ledger, so pricing can be set on
 * measured numbers.
 *
 * Access: signed-in users whose email is in DEVELOPER_EMAILS (comma
 * separated). Unset means nobody — it fails closed.
 */

export const dynamic = 'force-dynamic'

function isDeveloper(email: string | undefined | null): boolean {
  if (!email) return false
  const allowed = (process.env.DEVELOPER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(email.toLowerCase())
}

/** Today's USD→INR rate (ECB reference, via frankfurter.app), or null if unreachable. */
async function usdToInr(): Promise<{ rate: number; date: string } | null> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=INR', {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const j = await res.json()
    const rate = Number(j?.rates?.INR)
    return Number.isFinite(rate) && rate > 0 ? { rate, date: String(j.date ?? '') } : null
  } catch {
    return null
  }
}

interface Bucket { costUsd: number; calls: number; inputTokens: number; outputTokens: number; unpriced: number }
const empty = (): Bucket => ({ costUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0, unpriced: 0 })

export async function GET(request: Request) {
  try {
    const user = await getSessionUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isDeveloper(user.email)) return Response.json({ error: 'Not available' }, { status: 404 })

    const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 30, 1), 365)
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const supabase = createSupabaseServiceClient()

    const [{ data: rows, error }, { data: profiles }, { data: runs }, fx] = await Promise.all([
      supabase
        .from('ai_usage')
        .select('user_id, source, model, input_tokens, output_tokens, cost_usd, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50_000),
      supabase.from('business_profiles').select('user_id, business_name'),
      supabase.from('agent_runs').select('user_id, agent, status, cost_usd').gte('created_at', since).limit(10_000),
      usdToInr(),
    ])
    if (error) throw new Error(error.message)

    const names = new Map<string, string>()
    for (const p of (profiles ?? []) as any[]) if (p.business_name) names.set(p.user_id, p.business_name)
    const emails = new Map<string, string>()
    try {
      const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 })
      for (const u of data?.users ?? []) if (u.email) emails.set(u.id, u.email)
    } catch { /* names fall back to the id */ }

    const total = empty()
    const byBusiness = new Map<string, Bucket>()
    const bySource = new Map<string, Bucket>()
    const byModel = new Map<string, Bucket>()
    const byDay = new Map<string, Bucket>()
    const bump = (b: Bucket, r: any) => {
      b.calls += 1
      b.inputTokens += r.input_tokens ?? 0
      b.outputTokens += r.output_tokens ?? 0
      if (r.cost_usd == null) b.unpriced += 1
      else b.costUsd += Number(r.cost_usd)
    }
    const add = (map: Map<string, Bucket>, key: string, r: any) => {
      const b = map.get(key) ?? empty()
      bump(b, r)
      map.set(key, b)
    }
    for (const r of (rows ?? []) as any[]) {
      bump(total, r)
      add(byBusiness, r.user_id, r)
      add(bySource, r.source, r)
      add(byModel, r.model, r)
      add(byDay, String(r.created_at).slice(0, 10), r)
    }

    const agentRuns = new Map<string, { runs: number; failed: number; costUsd: number }>()
    for (const r of (runs ?? []) as any[]) {
      const a = agentRuns.get(r.agent) ?? { runs: 0, failed: 0, costUsd: 0 }
      a.runs += 1
      if (r.status === 'failed') a.failed += 1
      a.costUsd += Number(r.cost_usd ?? 0)
      agentRuns.set(r.agent, a)
    }

    const sorted = (m: Map<string, Bucket>) => [...m.entries()].sort((a, b) => b[1].costUsd - a[1].costUsd)
    const businesses = sorted(byBusiness).map(([userId, b]) => ({
      userId,
      name: names.get(userId) ?? emails.get(userId) ?? userId.slice(0, 8),
      email: emails.get(userId) ?? null,
      ...b,
    }))

    return Response.json({
      days,
      since,
      fx,
      total,
      businessCount: businesses.length,
      businesses,
      sources: sorted(bySource).map(([source, b]) => ({ source, ...b })),
      models: sorted(byModel).map(([model, b]) => ({ model, ...b })),
      daily: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, b]) => ({ date, ...b })),
      agents: [...agentRuns.entries()].map(([agent, a]) => ({ agent, ...a })),
      truncated: (rows?.length ?? 0) >= 50_000,
    })
  } catch (error) {
    return handleError(error, 'Failed to load costs')
  }
}
