import { getMetaClientForUser, getMetaConnection, needsMetaConnection } from './user-client'
import { db } from '@/lib/db/supabase-db'
import { getSupabaseServer } from '@/lib/supabase/server'
import { createMetaClient } from './client'

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

function num(v: string | undefined | null): number {
  if (v == null) return 0
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function revenueFromActions(actions: unknown): number {
  if (!Array.isArray(actions)) return 0
  return actions.reduce((sum, a) => {
    if (!a || typeof a !== 'object') return sum
    const type = String((a as Record<string, unknown>).action_type || '').toLowerCase()
    const value = Number((a as Record<string, unknown>).value)
    if (type.includes('purchase') || type === 'offsite_conversion') {
      return sum + (Number.isFinite(value) ? value : 0)
    }
    return sum
  }, 0)
}

/** Pull daily + lifetime campaign insights from Meta and persist locally. */
export async function syncCampaignInsights(userId: string, days = 30): Promise<SyncResult> {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { success: false, synced: 0, campaignsUpdated: 0, dailyRows: 0, totalSpend: 0, totalConversions: 0, errors: [blocker] }

  const client = await getMetaClientForUser(userId)
  const adAccountId = conn!.adAccountId!
  const errors: string[] = []
  const since = new Date()
  since.setDate(since.getDate() - days)
  const timeRange = {
    since: since.toISOString().split('T')[0],
    until: new Date().toISOString().split('T')[0],
  }

  const localCampaigns = await db.campaign.findMany({ where: { userId } }) as any[]
  const byMetaId = new Map<string, any>()
  for (const c of localCampaigns) if (c.metaCampaignId) byMetaId.set(c.metaCampaignId, c)

  let dailyRows = 0
  let campaignsUpdated = 0
  let totalSpend = 0
  let totalConversions = 0

  try {
    const daily = await client.getObjectInsights(`act_${adAccountId}`, 'campaign', {
      timeRange,
      timeIncrement: 1,
    })

    for (const row of daily) {
      const metaId = row.campaign_id
      if (!metaId) continue
      const local = byMetaId.get(metaId)
      const campaignId = local?.id || null
      const date = row.date_start || row.date_stop
      if (!date) continue

      const spend = num(row.spend)
      const impressions = num(row.impressions)
      const clicks = num(row.clicks)
      const conversions = num(row.conversions)
      const reach = num(row.reach)
      const frequency = num(row.frequency)
      const ctr = num(row.ctr)
      const cpc = num(row.cpc)
      const cpm = num(row.cpm)
      const revenue = revenueFromActions((row as any).action_values)

      totalSpend += spend
      totalConversions += conversions

      await upsertDailyMetric(userId, campaignId, metaId, date, {
        spend, impressions: Math.round(impressions), clicks: Math.round(clicks),
        conversions: Math.round(conversions), reach: Math.round(reach), frequency,
        ctr, cpc, cpm, revenue,
      })
      dailyRows++
    }
  } catch (e) {
    errors.push(`daily insights: ${e instanceof Error ? e.message : 'failed'}`)
  }

  // Lifetime aggregates per campaign -> update campaign totals
  try {
    const lifetime = await client.getObjectInsights(`act_${adAccountId}`, 'campaign', {
      datePreset: 'maximum',
    })
    for (const row of lifetime) {
      const metaId = row.campaign_id
      if (!metaId) continue
      const local = byMetaId.get(metaId)
      if (!local) continue
      const spend = num(row.spend)
      const impressions = num(row.impressions)
      const clicks = num(row.clicks)
      const conversions = num(row.conversions)
      const revenue = revenueFromActions((row as any).action_values)
      await db.campaign.update({
        where: { id: local.id },
        data: {
          totalSpend: spend,
          totalRevenue: revenue,
          totalImpressions: Math.round(impressions),
          totalClicks: Math.round(clicks),
          totalConversions: Math.round(conversions),
          lastSyncedAt: new Date(),
        },
      })
      campaignsUpdated++
    }
  } catch (e) {
    errors.push(`lifetime totals: ${e instanceof Error ? e.message : 'failed'}`)
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

async function upsertDailyMetric(
  userId: string,
  campaignId: string | null,
  metaCampaignId: string,
  dateStr: string,
  m: {
    spend: number; impressions: number; clicks: number; conversions: number
    reach: number; frequency: number; ctr: number; cpc: number; cpm: number; revenue: number
  }
): Promise<void> {
  const supabase = await getSupabaseServer()
  const date = dateStr
  let query = supabase
    .from('daily_metrics')
    .select('id')
    .eq('user_id', userId)
    .eq('date', date)

  if (campaignId) {
    query = query.eq('campaign_id', campaignId)
  } else {
    query = query.is('campaign_id', null)
  }

  const { data: existing } = await query.maybeSingle()

  const payload = {
    user_id: userId,
    campaign_id: campaignId,
    meta_campaign_id: metaCampaignId,
    date,
    spend: m.spend,
    impressions: m.impressions,
    clicks: m.clicks,
    conversions: m.conversions,
    reach: m.reach,
    frequency: m.frequency,
    ctr: m.ctr,
    cpc: m.cpc,
    cpm: m.cpm,
    revenue: m.revenue,
  }

  if (existing) {
    await supabase.from('daily_metrics').update(payload).eq('id', (existing as any).id)
  } else {
    await supabase.from('daily_metrics').insert(payload)
  }
}

/** Pull live campaigns from Meta and create/update local campaign rows. */
export async function syncFromMeta(userId: string): Promise<SyncResult> {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { success: false, synced: 0, campaignsUpdated: 0, dailyRows: 0, totalSpend: 0, totalConversions: 0, errors: [blocker] }

  const client = await getMetaClientForUser(userId)
  const errors: string[] = []
  let synced = 0

  try {
    const metaCampaigns = await client.getCampaignsList()
    const local = await db.campaign.findMany({ where: { userId } }) as any[]
    const byMetaId = new Map(local.filter((c) => c.metaCampaignId).map((c) => [c.metaCampaignId, c] as [string, any]))

    for (const mc of metaCampaigns) {
      const existing = byMetaId.get(mc.id)
      const statusMap: Record<string, string> = {
        ACTIVE: 'active', PAUSED: 'paused', DELETED: 'completed', ARCHIVED: 'completed', DRAFT: 'draft',
      }
      const budget = num(mc.daily_budget || mc.lifetime_budget) / 100
      const budgetType = mc.daily_budget ? 'daily' : 'lifetime'
      const data: Record<string, unknown> = {
        userId,
        name: mc.name,
        objective: mc.objective,
        status: statusMap[mc.effective_status || mc.configured_status || mc.status] || 'draft',
        budget,
        budgetType,
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
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'sync failed')
  }

  return { success: errors.length === 0, synced, campaignsUpdated: synced, dailyRows: 0, totalSpend: 0, totalConversions: 0, errors }
}

/** Publish a local draft campaign to Meta and store the returned campaign id. */
export async function publishCampaignToMeta(userId: string, campaignId: string): Promise<{
  success: boolean
  metaCampaignId?: string
  message: string
}> {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { success: false, message: blocker }

  const campaign = await db.campaign.findUnique({ where: { id: campaignId } }) as any
  if (!campaign) return { success: false, message: 'Campaign not found' }
  if (campaign.userId !== userId) return { success: false, message: 'Not your campaign' }

  const client = createMetaClient({
    appId: conn!.appId,
    appSecret: conn!.appSecret,
    accessToken: conn!.accessToken,
    adAccountId: conn!.adAccountId || undefined,
  })

  try {
    const result = await client.createCampaign({
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status === 'active' ? 'ACTIVE' : 'PAUSED',
      dailyBudget: campaign.budgetType === 'daily' ? campaign.budget : undefined,
      lifetimeBudget: campaign.budgetType === 'lifetime' ? campaign.budget : undefined,
      startTime: campaign.startDate ? new Date(campaign.startDate).toISOString() : undefined,
      endTime: campaign.endDate ? new Date(campaign.endDate).toISOString() : undefined,
    })

    await db.campaign.update({
      where: { id: campaignId },
      data: { metaCampaignId: result.id, status: campaign.status === 'active' ? 'active' : 'paused' },
    })

    return { success: true, metaCampaignId: result.id, message: `Published "${campaign.name}" to Meta (id: ${result.id})` }
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Publish failed' }
  }
}

/** Pause or resume a campaign on Meta and update local status. */
export async function setCampaignStatus(userId: string, campaignId: string, active: boolean): Promise<{ success: boolean; message: string }> {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { success: false, message: blocker }

  const campaign = await db.campaign.findUnique({ where: { id: campaignId } }) as any
  if (!campaign) return { success: false, message: 'Campaign not found' }
  if (!campaign.metaCampaignId) return { success: false, message: 'Campaign not published to Meta yet' }

  const client = await getMetaClientForUser(userId)
  try {
    if (active) await client.resumeCampaign(campaign.metaCampaignId)
    else await client.pauseCampaign(campaign.metaCampaignId)
    await db.campaign.update({ where: { id: campaignId }, data: { status: active ? 'active' : 'paused' } })
    return { success: true, message: `Campaign ${active ? 'resumed' : 'paused'} on Meta` }
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : 'Status change failed' }
  }
}

/** Compute a dashboard summary from real daily_metrics + campaign totals. */
export async function getAccountSummary(userId: string, days = 30): Promise<{
  totalSpend: number
  totalRevenue: number
  totalImpressions: number
  totalClicks: number
  totalConversions: number
  ctr: number
  cpc: number
  cpm: number
  roas: number
  daily: Array<{ date: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }>
}> {
  const supabase = await getSupabaseServer()
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data } = await supabase
    .from('daily_metrics')
    .select('date, spend, impressions, clicks, conversions, reach, cpc, cpm, revenue')
    .eq('user_id', userId)
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: true })

  const rows = (data || []) as any[]
  const byDate = new Map<string, any>()
  let totalSpend = 0, totalRevenue = 0, totalImpressions = 0, totalClicks = 0, totalConversions = 0

  for (const r of rows) {
    const d = r.date
    const agg = byDate.get(d) || { date: d, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }
    agg.spend += num(r.spend)
    agg.impressions += num(r.impressions)
    agg.clicks += num(r.clicks)
    agg.conversions += num(r.conversions)
    agg.revenue += num(r.revenue)
    byDate.set(d, agg)

    totalSpend += num(r.spend)
    totalRevenue += num(r.revenue)
    totalImpressions += num(r.impressions)
    totalClicks += num(r.clicks)
    totalConversions += num(r.conversions)
  }

  return {
    totalSpend,
    totalRevenue,
    totalImpressions: Math.round(totalImpressions),
    totalClicks: Math.round(totalClicks),
    totalConversions: Math.round(totalConversions),
    ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
    roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
    daily: Array.from(byDate.values()),
  }
}
