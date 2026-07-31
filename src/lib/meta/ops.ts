import { getMetaClientForUser, getMetaConnection, needsMetaConnection } from './user-client'

/* eslint-disable @typescript-eslint/no-explicit-any */

function num(v: string | undefined | null): number {
  if (v == null) return 0
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export async function metaListCampaigns(userId: string) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  const campaigns = await client.getCampaignsList()
  return {
    campaigns: campaigns.map((c) => ({
      id: c.id, name: c.name, objective: c.objective, status: c.effective_status || c.configured_status || c.status,
      dailyBudget: num(c.daily_budget) / 100, lifetimeBudget: num(c.lifetime_budget) / 100,
      startTime: c.start_time, stopTime: c.stop_time, buyingType: c.buying_type,
    })),
    total: campaigns.length,
  }
}

export async function metaListCreatives(userId: string) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  const creatives = await client.getAdCreatives()
  return {
    creatives: creatives.map((c) => ({
      id: c.id, name: c.name, status: c.status, body: c.body, title: c.title,
      imageUrl: c.image_url, thumbnailUrl: c.thumbnail_url,
      callToAction: c.call_to_action_type, link: c.link,
    })),
    total: creatives.length,
  }
}

export async function metaGetInsights(
  userId: string,
  params: { objectId?: string; level?: 'campaign' | 'ad' | 'adset'; datePreset?: string; timeIncrement?: number }
) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  const objectId = params.objectId || `act_${conn!.adAccountId}`
  const insights = await client.getObjectInsights(objectId, params.level || 'campaign', {
    datePreset: params.datePreset || 'last_30d',
    timeIncrement: params.timeIncrement,
  })
  return {
    insights: insights.map((i) => ({
      campaignId: i.campaign_id, impressions: num(i.impressions), clicks: num(i.clicks),
      spend: num(i.spend), reach: num(i.reach), frequency: num(i.frequency),
      ctr: num(i.ctr), cpc: num(i.cpc), cpm: num(i.cpm), conversions: num(i.conversions),
      costPerConversion: num(i.cost_per_conversion), dateStart: i.date_start, dateStop: i.date_stop,
    })),
    total: insights.length,
  }
}

export async function metaComparePerformance(
  userId: string,
  objectIds: string[],
  level: 'campaign' | 'ad' | 'adset' = 'campaign',
  datePreset = 'last_30d'
) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  const results: any[] = []
  for (const id of objectIds) {
    const insights = await client.getObjectInsights(id, level, { datePreset })
    const agg = insights.reduce(
      (acc, i) => {
        acc.impressions += num(i.impressions)
        acc.clicks += num(i.clicks)
        acc.spend += num(i.spend)
        acc.conversions += num(i.conversions)
        return acc
      },
      { impressions: 0, clicks: 0, spend: 0, conversions: 0 }
    )
    results.push({
      objectId: id,
      ...agg,
      ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
      cpc: agg.clicks > 0 ? agg.spend / agg.clicks : 0,
      cpa: agg.conversions > 0 ? agg.spend / agg.conversions : 0,
    })
  }
  return { comparison: results }
}

export async function metaValidateToken(userId: string) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  const res = await client.verifyToken()
  return {
    valid: res.valid,
    userId: res.userId,
    expiresAt: res.expiresAt,
    expiresIn: res.expiresAt ? Math.max(0, res.expiresAt - Math.floor(Date.now() / 1000)) : undefined,
  }
}

export async function metaCreateAdCreative(
  userId: string,
  params: { name: string; title: string; body: string; imageUrl?: string; link: string; callToAction: string }
) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  const result = await client.createAdCreative({
    name: params.name, body: params.body, title: params.title,
    imageUrl: params.imageUrl, link: params.link, callToAction: params.callToAction,
  })
  return { success: true, creativeId: result.id }
}

export async function metaGetAccountBalance(userId: string) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  return client.getAccountBalance()
}

export async function metaCreateCampaign(
  userId: string,
  params: { name: string; objective: string; status?: string; dailyBudget?: number; lifetimeBudget?: number; startTime?: string; endTime?: string }
) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  const result = await client.createCampaign({
    name: params.name, objective: params.objective,
    status: params.status || 'PAUSED',
    dailyBudget: params.dailyBudget, lifetimeBudget: params.lifetimeBudget,
    startTime: params.startTime, endTime: params.endTime,
  })
  return { success: true, campaign_id: result.id, message: `Created Meta campaign "${params.name}" (id: ${result.id})` }
}

export async function metaPauseCampaign(userId: string, metaCampaignId: string) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  await client.pauseCampaign(metaCampaignId)
  return { success: true, message: `Paused Meta campaign ${metaCampaignId}` }
}

export async function metaResumeCampaign(userId: string, metaCampaignId: string) {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  const client = await getMetaClientForUser(userId)
  await client.resumeCampaign(metaCampaignId)
  return { success: true, message: `Resumed Meta campaign ${metaCampaignId}` }
}
