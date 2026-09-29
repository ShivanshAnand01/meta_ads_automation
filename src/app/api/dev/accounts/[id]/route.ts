import { createSupabaseServiceClient, handleError } from '@/lib/supabase/server'
import { developerOrResponse } from '@/lib/developer'
import { redactSecrets, redactSecretText } from '@/lib/redact'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Developer console: one business in detail — setup, recent chats and
 * routines, what the AI did (with failures), agent runs, approvals, schedules
 * and cost. Read-only. Secrets never leave the server: keys are reported as
 * present/absent, audit arguments are redacted again on the way out.
 */

export const dynamic = 'force-dynamic'

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

function preview(v: unknown, max = 280): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export async function GET(_request: Request, ctx: RouteContext<'/api/dev/accounts/[id]'>) {
  try {
    const dev = await developerOrResponse()
    if (dev instanceof Response) return dev
    const { id } = await ctx.params

    const supabase = createSupabaseServiceClient()
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()

    const [user, profile, settings, meta, convs, actions, runs, approvals, jobs, usage, learnings] = await Promise.all([
      supabase.auth.admin.getUserById(id),
      supabase.from('business_profiles').select('*').eq('user_id', id).maybeSingle(),
      supabase.from('ai_settings').select('provider, model, base_url, api_key, embedding_key').eq('user_id', id).maybeSingle(),
      supabase.from('meta_connections').select('app_id, ad_account_id, ad_account_name, ad_account_currency, token_expiry, last_validated_at, connected_at').eq('user_id', id).maybeSingle(),
      supabase.from('ai_conversations').select('id, title, autonomous, created_at, updated_at').eq('user_id', id).order('updated_at', { ascending: false }).limit(25),
      supabase.from('ai_actions').select('tool_name, status, actor, arguments, result, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(60),
      supabase.from('agent_runs').select('id, agent, mode, status, brief, report, error, model, cost_usd, created_at, finished_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('pending_approvals').select('tool_name, summary, risk, status, created_at, expires_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('scheduled_jobs').select('type, cron_expression, status, last_run_at, next_run_at').eq('user_id', id),
      supabase.from('ai_usage').select('source, cost_usd').eq('user_id', id).gte('created_at', since30).limit(50_000),
      supabase.from('ai_learnings').select('kind, statement, status, occurrences, source, last_seen').eq('user_id', id).in('status', ['active', 'resolved']).order('last_seen', { ascending: false }).limit(80),
    ])
    if (!user.data?.user) return Response.json({ error: 'No such account' }, { status: 404 })

    const u = user.data.user
    const s: any = settings.data
    const bySource = new Map<string, { calls: number; costUsd: number }>()
    for (const r of (usage.data ?? []) as any[]) {
      const b = bySource.get(r.source) ?? { calls: 0, costUsd: 0 }
      b.calls += 1
      b.costUsd += Number(r.cost_usd ?? 0)
      bySource.set(r.source, b)
    }

    return Response.json({
      account: {
        userId: u.id, email: u.email ?? null, createdAt: u.created_at,
        confirmed: Boolean(u.email_confirmed_at), lastSignIn: u.last_sign_in_at ?? null,
      },
      profile: profile.data ?? null,
      ai: s ? { provider: s.provider, model: s.model, baseUrl: s.base_url, hasApiKey: Boolean(s.api_key), hasEmbeddingKey: Boolean(s.embedding_key) } : null,
      meta: meta.data ?? null,
      conversations: convs.data ?? [],
      actions: ((actions.data ?? []) as any[]).map((a) => ({
        tool: a.tool_name,
        status: a.status,
        actor: a.actor,
        at: a.created_at,
        arguments: redactSecretText(preview(redactSecrets(parseJson(a.arguments)))),
        result: redactSecretText(preview(redactSecrets(parseJson(a.result)))),
      })),
      agentRuns: runs.data ?? [],
      approvals: approvals.data ?? [],
      jobs: jobs.data ?? [],
      learnings: learnings.data ?? [],
      cost30d: [...bySource.entries()].map(([source, b]) => ({ source, ...b })).sort((a, b) => b.costUsd - a.costUsd),
    })
  } catch (error) {
    return handleError(error, 'Failed to load the account')
  }
}
