import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { getMetaConnection } from '@/lib/meta/user-client'
import { getAccountSummary } from '@/lib/meta/sync'
import { getStrategy } from '@/lib/ai/strategy'
import { getSpendSoFar } from '@/lib/ai/budget-guard'
import { computeDerived, sumTotals } from '@/lib/meta/metrics'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  try {
    const userId = await requireUserId()

    const conn = await getMetaConnection(userId)
    const aiSettings = await db.aiSettings.findUnique({ where: { userId } })

    // Real performance from synced daily_metrics + campaign totals.
    const summary = await getAccountSummary(userId, 30)

    // The previous 30 days, so every headline number can carry a change and
    // the client can see direction, not just a level.
    const previous = await getAccountSummary(userId, 60)
    const previousWindow = previous.daily.filter((d) => !summary.daily.some((c) => c.date === d.date))
    const prevTotals = sumTotals(previousWindow)
    const prevDerived = computeDerived(prevTotals)

    const pctChange = (now: number, before: number): number | null => {
      if (!Number.isFinite(before) || before === 0) return null
      return ((now - before) / before) * 100
    }

    // The same numbers the budget guard enforces against, so what the client
    // sees on screen is exactly what the server will allow.
    const pacing = await getSpendSoFar(userId).catch(() => ({ spentToday: 0, spentThisMonth: 0 }))

    const recentCreatives = await db.adCreative.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }) as any[]
    const campaigns = await db.campaign.findMany({ where: { userId } }) as any[]

    const pendingApprovals = await db.pendingApproval.findMany({
      where: { userId, status: 'pending' },
    }) as any[]

    let strategy: any = null
    try { strategy = await getStrategy(userId) } catch {}

    return Response.json({
      connected: !!conn,
      adAccount: conn
        ? {
            id: conn.adAccountId,
            accountId: conn.adAccountId || '',
            name: conn.adAccountName || 'Ad Account',
            status: conn.adAccountStatus || 'ACTIVE',
            currency: conn.adAccountCurrency || 'INR',
            appId: conn.appId,
            connectedAt: conn.connectedAt,
          }
        : null,
      stats: {
        totalSpend: summary.totalSpend,
        totalRevenue: summary.totalRevenue,
        totalImpressions: summary.totalImpressions,
        totalClicks: summary.totalClicks,
        totalConversions: summary.totalConversions,
        ctr: summary.ctr,
        cpc: summary.cpc,
        cpm: summary.cpm,
        cpa: summary.cpa,
        // Real ROAS = revenue / spend (falls back to 0 when no revenue tracked).
        roas: summary.roas,
        roasNote: summary.totalRevenue > 0 ? null : 'No revenue tracked — sync Meta insights & set revenue to compute ROAS.',
      },
      performanceData: summary.daily,
      campaignCount: campaigns.length,
      campaigns: campaigns.map((c) => ({
        id: c.id, name: c.name, status: c.status,
        metaCampaignId: c.metaCampaignId,
        spend: Number(c.totalSpend) || 0,
        revenue: Number(c.totalRevenue) || 0,
        roas: Number(c.totalSpend) > 0 ? (Number(c.totalRevenue) || 0) / Number(c.totalSpend) : 0,
        lastSyncedAt: c.lastSyncedAt,
      })),
      recentCreatives: recentCreatives.map((c) => ({
        id: c.id, title: c.title, status: c.status, reviewStatus: c.reviewStatus,
        expectedSpend: Number(c.expectedSpend) || 0, expectedRoas: Number(c.expectedRoas) || 0,
        createdAt: new Date(c.createdAt as string).toISOString(),
      })),
      strategy: strategy
        ? {
            targetRoas: strategy.targetRoas,
            targetCpa: strategy.targetCpa ?? null,
            autoOptimize: strategy.autoOptimize,
            focus: strategy.focus,
          }
        : null,
      pendingApprovals: pendingApprovals.length,
      // Full records, not just a count — an approval the client cannot read
      // is an approval they cannot act on.
      approvals: pendingApprovals
        .filter((a) => !a.expiresAt || new Date(a.expiresAt as string).getTime() > Date.now())
        .slice(0, 5)
        .map((a) => ({
          id: a.id,
          summary: a.summary,
          risk: a.risk,
          toolName: a.toolName,
          createdAt: a.createdAt ? new Date(a.createdAt as string).toISOString() : null,
          expiresAt: a.expiresAt ? new Date(a.expiresAt as string).toISOString() : null,
        })),
      pacing: {
        spentToday: pacing.spentToday,
        spentThisMonth: pacing.spentThisMonth,
        dailyCap: strategy?.dailyBudgetCap ?? null,
        monthlyCap: strategy?.monthlyBudget ?? null,
      },
      deltas: {
        spend: pctChange(summary.totalSpend, prevTotals.spend),
        revenue: pctChange(summary.totalRevenue, prevTotals.revenue),
        roas: pctChange(summary.roas, prevDerived.roas),
        conversions: pctChange(summary.totalConversions, prevTotals.conversions),
        cpa: pctChange(summary.cpa, prevDerived.cpa),
        ctr: pctChange(summary.ctr, prevDerived.ctr),
      },
      aiConfigured: !!aiSettings,
      lastSyncedAt: campaigns.reduce<string | null>((latest, c) => {
        const t = c.lastSyncedAt as string | null
        if (!t) return latest
        if (!latest) return t
        return new Date(t) > new Date(latest) ? t : latest
      }, null),
    })
  } catch (error) {
    return handleError(error, 'Failed to load dashboard data')
  }
}
