import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { getMetaConnection } from '@/lib/meta/user-client'
import { getAccountSummary } from '@/lib/meta/sync'
import { getStrategy } from '@/lib/ai/strategy'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  try {
    const userId = await requireUserId()

    const conn = await getMetaConnection(userId)
    const aiSettings = await db.aiSettings.findUnique({ where: { userId } })

    // Real performance from synced daily_metrics + campaign totals.
    const summary = await getAccountSummary(userId, 30)

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
        ? { targetRoas: strategy.targetRoas, autoOptimize: strategy.autoOptimize, focus: strategy.focus }
        : null,
      pendingApprovals: pendingApprovals.length,
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
