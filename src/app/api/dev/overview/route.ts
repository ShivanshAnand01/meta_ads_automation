import { createSupabaseServiceClient, handleError } from '@/lib/supabase/server'
import { developerOrResponse, isDeveloperEmail } from '@/lib/developer'
import { usdToInr } from '@/lib/fx'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Developer console: every business on the platform at a glance — who they
 * are, what is set up, how much they use it, what it costs, what is failing.
 * Read-only, service role, developer only.
 */

export const dynamic = 'force-dynamic'

const DAY = 86_400_000

export async function GET() {
  try {
    const dev = await developerOrResponse()
    if (dev instanceof Response) return dev

    const supabase = createSupabaseServiceClient()
    const since7 = new Date(Date.now() - 7 * DAY).toISOString()
    const since30 = new Date(Date.now() - 30 * DAY).toISOString()

    const [users, profiles, settings, metas, convs, usage, actions, runs, approvals, campaigns, creatives, fx] = await Promise.all([
      supabase.auth.admin.listUsers({ perPage: 1000 }),
      supabase.from('business_profiles').select('user_id, business_name, onboarding_complete, landing_url'),
      supabase.from('ai_settings').select('user_id, provider, model'),
      supabase.from('meta_connections').select('user_id, ad_account_id, ad_account_name, token_expiry'),
      supabase.from('ai_conversations').select('user_id, autonomous, updated_at').gte('updated_at', since30).limit(20_000),
      supabase.from('ai_usage').select('user_id, cost_usd').gte('created_at', since30).limit(50_000),
      supabase.from('ai_actions').select('user_id, status, created_at').gte('created_at', since7).limit(50_000),
      supabase.from('agent_runs').select('user_id, status').gte('created_at', since7).limit(10_000),
      supabase.from('pending_approvals').select('user_id').eq('status', 'pending'),
      supabase.from('campaigns').select('user_id, meta_campaign_id'),
      supabase.from('ad_creatives').select('user_id'),
      usdToInr(),
    ])

    const group = <T,>(rows: T[] | null | undefined, key: (r: T) => string) => {
      const m = new Map<string, T[]>()
      for (const r of rows ?? []) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]) }
      return m
    }
    const one = <T,>(rows: T[] | null | undefined, key: (r: T) => string) => new Map((rows ?? []).map((r) => [key(r), r] as const))

    const profileBy = one(profiles.data as any[], (r) => r.user_id)
    const settingsBy = one(settings.data as any[], (r) => r.user_id)
    const metaBy = one(metas.data as any[], (r) => r.user_id)
    const convBy = group(convs.data as any[], (r) => r.user_id)
    const usageBy = group(usage.data as any[], (r) => r.user_id)
    const actionBy = group(actions.data as any[], (r) => r.user_id)
    const runBy = group(runs.data as any[], (r) => r.user_id)
    const approvalBy = group(approvals.data as any[], (r) => r.user_id)
    const campaignBy = group(campaigns.data as any[], (r) => r.user_id)
    const creativeBy = group(creatives.data as any[], (r) => r.user_id)

    const accounts = (users.data?.users ?? []).map((u) => {
      const p: any = profileBy.get(u.id)
      const s: any = settingsBy.get(u.id)
      const m: any = metaBy.get(u.id)
      const c = convBy.get(u.id) ?? []
      const acts = actionBy.get(u.id) ?? []
      const lastAction = acts.reduce((max: string, a: any) => (a.created_at > max ? a.created_at : max), '')
      const lastChat = c.reduce((max: string, x: any) => (x.updated_at > max ? x.updated_at : max), '')
      return {
        userId: u.id,
        email: u.email ?? null,
        developer: isDeveloperEmail(u.email),
        createdAt: u.created_at,
        confirmed: Boolean(u.email_confirmed_at),
        lastSignIn: u.last_sign_in_at ?? null,
        lastActive: [lastAction, lastChat, u.last_sign_in_at ?? ''].sort().pop() || null,
        businessName: p?.business_name ?? null,
        onboardingComplete: Boolean(p?.onboarding_complete),
        hasLandingUrl: Boolean(p?.landing_url),
        ai: s ? { provider: s.provider, model: s.model } : null,
        meta: m ? { adAccountId: m.ad_account_id, adAccountName: m.ad_account_name, tokenExpiry: m.token_expiry } : null,
        chats7d: c.filter((x: any) => !x.autonomous && x.updated_at >= since7).length,
        routines7d: c.filter((x: any) => x.autonomous && x.updated_at >= since7).length,
        actions7d: acts.length,
        errors7d: acts.filter((a: any) => a.status === 'error').length,
        agentRuns7d: (runBy.get(u.id) ?? []).length,
        pendingApprovals: (approvalBy.get(u.id) ?? []).length,
        campaigns: (campaignBy.get(u.id) ?? []).length,
        liveCampaigns: (campaignBy.get(u.id) ?? []).filter((x: any) => x.meta_campaign_id).length,
        creatives: (creativeBy.get(u.id) ?? []).length,
        costUsd30d: (usageBy.get(u.id) ?? []).reduce((sum: number, r: any) => sum + Number(r.cost_usd ?? 0), 0),
      }
    }).sort((a, b) => String(b.lastActive ?? '').localeCompare(String(a.lastActive ?? '')))

    return Response.json({
      generatedAt: new Date().toISOString(),
      fx,
      totals: {
        accounts: accounts.length,
        active7d: accounts.filter((a) => a.lastActive && a.lastActive >= since7).length,
        withMeta: accounts.filter((a) => a.meta).length,
        costUsd30d: accounts.reduce((s, a) => s + a.costUsd30d, 0),
        errors7d: accounts.reduce((s, a) => s + a.errors7d, 0),
        agentRuns7d: accounts.reduce((s, a) => s + a.agentRuns7d, 0),
      },
      accounts,
    })
  } catch (error) {
    return handleError(error, 'Failed to load the developer overview')
  }
}
