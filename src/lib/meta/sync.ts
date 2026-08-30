import { getMetaClientForUser, getMetaConnection, needsMetaConnection } from './user-client'
import { db, getScopedSupabase } from '@/lib/db/supabase-db'
import { MetaApiError } from './client'
import { normalizeInsightRow, num, computeDerived, sumTotals } from './metrics'
import { publishFullCampaign } from './publish'
import type { MetaInsights } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SyncResult {
  success: boolean
  synced: number
  campaignsUpdated: number
  dailyRows: number
  totalSpend: number
  totalConversions: number
  errors: string[]
}

function friendly(err: unknown): string {
  if (err instanceof MetaApiError) return err.friendlyMessage
  return err instanceof Error ? err.message : 'failed'
}

const emptyResult = (errors: string[]): SyncResult => ({
  success: false,
  synced: 0,
  campaignsUpdated: 0,
  dailyRows: 0,
  totalSpend: 0,
  totalConversions: 0,
  errors,
})

/**
 * Pull daily and lifetime insights from Meta and persist them locally.
 *
 * Syncs at campaign, ad set AND ad level. Campaign-level data alone cannot
 * answer "which ad is losing money", which is the actual optimization
 * question.
 */
export async function syncCampaignInsights(userId: string, days = 30): Promise<SyncResult> {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return emptyResult([blocker])

  const client = await getMetaClientForUser(userId)
  const adAccountId = conn!.adAccountId!
  const errors: string[] = []

  const since = new Date()
  since.setDate(since.getDate() - days)
  const timeRange = {
    since: since.toISOString().split('T')[0],
    until: new Date().toISOString().split('T')[0],
  }

  const localCampaigns = (await db.campaign.findMany({ where: { userId } })) as any[]
  const byMetaId = new Map<string, any>()
  for (const c of localCampaigns) if (c.metaCampaignId) byMetaId.set(c.metaCampaignId, c)
  const objectiveByMetaId = new Map<string, string>()
  for (const c of localCampaigns) if (c.metaCampaignId) objectiveByMetaId.set(c.metaCampaignId, c.objective)

  let dailyRows = 0
  let campaignsUpdated = 0
  let totalSpend = 0
  let totalConversions = 0

  // ── Daily rows, per level ──────────────────────────────────────────────
  const levels: Array<'campaign' | 'adset' | 'ad'> = ['campaign', 'adset', 'ad']
  const pending: Array<Record<string, unknown>> = []

  for (const level of levels) {
    try {
      const rows = await client.getObjectInsights(`act_${adAccountId}`, level, { timeRange, timeIncrement: 1 })
      for (const raw of rows) {
        const objective = raw.campaign_id ? objectiveByMetaId.get(raw.campaign_id) : undefined
        const row = normalizeInsightRow(raw, objective)
        if (!row.date) continue

        // Only the campaign level contributes to account totals; summing all
        // three levels would triple-count every rupee.
        if (level === 'campaign') {
          totalSpend += row.spend
          totalConversions += row.conversions
        }

        const local = row.campaignId ? byMetaId.get(row.campaignId) : null
        pending.push({
          user_id: userId,
          campaign_id: local?.id ?? null,
          meta_campaign_id: row.campaignId ?? null,
          meta_adset_id: row.adsetId ?? null,
          meta_ad_id: row.adId ?? null,
          level,
          date: row.date,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          conversions: row.conversions,
          reach: row.reach,
          frequency: row.frequency,
          ctr: row.ctr,
          cpc: row.cpc,
          cpm: row.cpm,
          revenue: row.revenue,
        })
        dailyRows++
      }
    } catch (err) {
      errors.push(`${level} insights: ${friendly(err)}`)
    }
  }

  if (pending.length > 0) {
    try {
      await upsertDailyMetrics(pending)
    } catch (err) {
      errors.push(`persisting metrics: ${friendly(err)}`)
    }
  }

  // ── Lifetime totals per campaign ───────────────────────────────────────
  try {
    const lifetime = await client.getObjectInsights(`act_${adAccountId}`, 'campaign', { datePreset: 'maximum' })
    for (const raw of lifetime) {
      const metaId = raw.campaign_id
      if (!metaId) continue
      const local = byMetaId.get(metaId)
      if (!local) continue

      const row = normalizeInsightRow(raw, objectiveByMetaId.get(metaId))
      await db.campaign.update({
        where: { id: local.id },
        data: {
          totalSpend: row.spend,
          totalRevenue: row.revenue,
          totalImpressions: row.impressions,
          totalClicks: row.clicks,
          totalConversions: row.conversions,
          lastSyncedAt: new Date(),
        },
      })
      campaignsUpdated++
    }
  } catch (err) {
    errors.push(`lifetime totals: ${friendly(err)}`)
  }

  return {
    success: errors.length === 0,
    synced: dailyRows + campaignsUpdated,
    campaignsUpdated,
    dailyRows,
    totalSpend,
    totalConversions,
    errors,
  }
}

/**
 * Write metric rows in bulk.
 *
 * Uses a single upsert against the `daily_metrics_unique_row` index rather
 * than the old select-then-insert, which raced with itself: two concurrent
 * syncs both saw "no existing row" and both inserted, doubling every number on
 * the dashboard.
 */
async function upsertDailyMetrics(rows: Array<Record<string, unknown>>): Promise<void> {
  const supabase = await getScopedSupabase()
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('daily_metrics').upsert(chunk, {
      onConflict: 'user_id,date,level,meta_campaign_id,meta_adset_id,meta_ad_id',
      ignoreDuplicates: false,
    })
    if (error) throw new Error(error.message)
  }
}

/** Pull live campaigns from Meta and create/update local campaign rows. */
export async function syncFromMeta(userId: string): Promise<SyncResult> {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return emptyResult([blocker])

  const client = await getMetaClientForUser(userId)
  const errors: string[] = []
  let synced = 0

  try {
    const metaCampaigns = await client.getCampaignsList()
    const local = (await db.campaign.findMany({ where: { userId } })) as any[]
    const byMetaId = new Map(
      local.filter((c) => c.metaCampaignId).map((c) => [c.metaCampaignId, c] as [string, any]),
    )

    const statusMap: Record<string, string> = {
      ACTIVE: 'active',
      PAUSED: 'paused',
      DELETED: 'completed',
      ARCHIVED: 'completed',
      DRAFT: 'draft',
    }

    for (const mc of metaCampaigns) {
      const existing = byMetaId.get(mc.id)
      const budget = num(mc.daily_budget || mc.lifetime_budget) / 100
      const data: Record<string, unknown> = {
        userId,
        name: mc.name,
        objective: mc.objective,
        status: statusMap[mc.effective_status || mc.configured_status || mc.status] || 'draft',
        budget,
        budgetType: mc.daily_budget ? 'daily' : 'lifetime',
        startDate: mc.start_time ? new Date(mc.start_time) : null,
        endDate: mc.stop_time ? new Date(mc.stop_time) : null,
      }
      if (existing) {
        await db.campaign.update({ where: { id: existing.id }, data })
      } else {
        await db.campaign.create({ data: { ...data, metaCampaignId: mc.id } })
      }
      synced++
    }
  } catch (err) {
    errors.push(friendly(err))
  }

  return {
    success: errors.length === 0,
    synced,
    campaignsUpdated: synced,
    dailyRows: 0,
    totalSpend: 0,
    totalConversions: 0,
    errors,
  }
}

/**
 * Publish a local draft campaign to Meta.
 *
 * Delegates to the full Campaign → Ad Set → Ad pipeline. The previous
 * implementation created only the campaign object, which can never deliver an
 * impression or spend anything.
 */
export async function publishCampaignToMeta(
  userId: string,
  campaignId: string,
  options?: Parameters<typeof publishFullCampaign>[0] extends infer P
    ? P extends { userId: string; campaignId: string }
      ? Omit<P, 'userId' | 'campaignId'>
      : never
    : never,
): Promise<{ success: boolean; metaCampaignId?: string; metaAdSetId?: string; metaAdIds?: string[]; message: string; warnings?: string[] }> {
  const result = await publishFullCampaign({ userId, campaignId, ...(options || {}) })
  return {
    success: result.success,
    metaCampaignId: result.metaCampaignId,
    metaAdSetId: result.metaAdSetId,
    metaAdIds: result.metaAdIds,
    message: result.message,
    warnings: result.warnings,
  }
}

/** Pause or resume a campaign on Meta and mirror the status locally. */
export async function setCampaignStatus(
  userId: string,
  campaignId: string,
  active: boolean,
): Promise<{ success: boolean; message: string }> {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { success: false, message: blocker }

  const campaign = (await db.campaign.findUnique({ where: { id: campaignId, userId } })) as any
  if (!campaign) return { success: false, message: 'Campaign not found' }
  if (!campaign.metaCampaignId) return { success: false, message: 'Campaign has not been published to Meta yet' }

  const client = await getMetaClientForUser(userId)
  try {
    if (active) await client.resumeCampaign(campaign.metaCampaignId)
    else await client.pauseCampaign(campaign.metaCampaignId)

    // Meta treats campaign, ad set and ad status independently: resuming the
    // campaign alone leaves paused ad sets paused, so nothing delivers and the
    // agent reports a success that did not happen.
    const nested: string[] = []
    if (active) {
      try {
        const adSets = await client.getAdSets(campaign.metaCampaignId)
        for (const adSet of adSets) {
          await client.setAdSetStatus(adSet.id, true)
          const ads = await client.getAds(adSet.id)
          for (const ad of ads) await client.setAdStatus(ad.id, true)
        }
        nested.push(`${adSets.length} ad set(s) resumed`)
      } catch (err) {
        nested.push(`ad sets could not be resumed: ${friendly(err)}`)
      }
    }

    await db.campaign.update({ where: { id: campaignId }, data: { status: active ? 'active' : 'paused' } })
    return {
      success: true,
      message: `Campaign ${active ? 'resumed' : 'paused'} on Meta${nested.length ? ` (${nested.join('; ')})` : ''}`,
    }
  } catch (err) {
    return { success: false, message: friendly(err) }
  }
}

/** Dashboard summary computed from synced campaign-level daily metrics. */
export async function getAccountSummary(
  userId: string,
  days = 30,
): Promise<{
  totalSpend: number
  totalRevenue: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  ctr: number
  cpc: number
  cpm: number
  cpa: number
  roas: number
  daily: Array<{ date: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }>
}> {
  const supabase = await getScopedSupabase()
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data } = await supabase
    .from('daily_metrics')
    .select('date, spend, impressions, clicks, conversions, revenue')
    .eq('user_id', userId)
    // Campaign level only — summing campaign + adset + ad rows would count
    // every rupee three times.
    .eq('level', 'campaign')
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: true })

  const rows = (data || []) as any[]
  const byDate = new Map<string, { date: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }>()

  for (const r of rows) {
    const agg = byDate.get(r.date) || {
      date: r.date,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
    }
    agg.spend += num(r.spend)
    agg.impressions += num(r.impressions)
    agg.clicks += num(r.clicks)
    agg.conversions += num(r.conversions)
    agg.revenue += num(r.revenue)
    byDate.set(r.date, agg)
  }

  const daily = Array.from(byDate.values())
  const totals = sumTotals(daily)
  const derived = computeDerived(totals)

  return {
    totalSpend: totals.spend,
    totalRevenue: totals.revenue,
    totalImpressions: Math.round(totals.impressions),
    totalClicks: Math.round(totals.clicks),
    totalConversions: Math.round(totals.conversions),
    ctr: derived.ctr,
    cpc: derived.cpc,
    cpm: derived.cpm,
    cpa: derived.cpa,
    roas: derived.roas,
    daily,
  }
}

export type { MetaInsights }
