import { getMetaClientForUser, getMetaConnection, needsMetaConnection } from './user-client'
import { MetaApiError, fromMinorUnits } from './client'
import { normalizeInsightRow, num, computeDerived, sumTotals } from './metrics'
import { getAllowedImageHosts } from './publish'
import type { MetaTargeting, OptimizationGoal, BillingEvent, SpecialAdCategory } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

function friendly(err: unknown): string {
  if (err instanceof MetaApiError) return err.friendlyMessage
  return err instanceof Error ? err.message : 'Meta request failed'
}

/**
 * Resolve the connection and client in one step, returning a blocker string
 * instead of throwing when Meta is not usable yet.
 */
async function withClient<T>(
  userId: string,
  fn: (client: Awaited<ReturnType<typeof getMetaClientForUser>>, conn: NonNullable<Awaited<ReturnType<typeof getMetaConnection>>>) => Promise<T>,
): Promise<T | { error: string }> {
  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { error: blocker }
  try {
    const client = await getMetaClientForUser(userId)
    return await fn(client, conn!)
  } catch (err) {
    return { error: friendly(err) }
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────

export async function metaListCampaigns(userId: string) {
  return withClient(userId, async (client, conn) => {
    const currency = conn.adAccountCurrency || 'INR'
    const campaigns = await client.getCampaignsList()
    return {
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        objective: c.objective,
        status: c.effective_status || c.configured_status || c.status,
        dailyBudget: fromMinorUnits(c.daily_budget, currency),
        lifetimeBudget: fromMinorUnits(c.lifetime_budget, currency),
        startTime: c.start_time,
        stopTime: c.stop_time,
        buyingType: c.buying_type,
      })),
      total: campaigns.length,
      currency,
    }
  })
}

export async function metaListAdSets(userId: string, campaignId?: string) {
  return withClient(userId, async (client, conn) => {
    const currency = conn.adAccountCurrency || 'INR'
    const adSets = await client.getAdSets(campaignId)
    return {
      adSets: adSets.map((a) => ({
        id: a.id,
        name: a.name,
        campaignId: a.campaign_id,
        status: a.effective_status || a.configured_status || a.status,
        dailyBudget: fromMinorUnits(a.daily_budget, currency),
        lifetimeBudget: fromMinorUnits(a.lifetime_budget, currency),
        optimizationGoal: a.optimization_goal,
        billingEvent: a.billing_event,
        bidStrategy: a.bid_strategy,
        targeting: a.targeting,
        startTime: a.start_time,
        endTime: a.end_time,
      })),
      total: adSets.length,
      currency,
    }
  })
}

export async function metaListAds(userId: string, adsetId?: string) {
  return withClient(userId, async (client) => {
    const ads = await client.getAds(adsetId)
    return {
      ads: ads.map((a) => ({
        id: a.id,
        name: a.name,
        adsetId: a.adset_id,
        campaignId: a.campaign_id,
        status: a.effective_status || a.configured_status || a.status,
        creativeId: a.creative?.id,
      })),
      total: ads.length,
    }
  })
}

export async function metaListCreatives(userId: string) {
  return withClient(userId, async (client) => {
    const creatives = await client.getAdCreatives()
    return {
      creatives: creatives.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        body: c.body,
        title: c.title,
        imageUrl: c.image_url,
        thumbnailUrl: c.thumbnail_url,
        callToAction: c.call_to_action_type,
        link: c.link,
      })),
      total: creatives.length,
    }
  })
}

export async function metaListPages(userId: string) {
  return withClient(userId, async (client) => {
    const pages = await client.getPages()
    return { pages, total: pages.length }
  })
}

export async function metaListPixels(userId: string) {
  return withClient(userId, async (client) => {
    const pixels = await client.getPixels()
    return { pixels, total: pixels.length }
  })
}

export async function metaGetInsights(
  userId: string,
  params: { objectId?: string; level?: 'account' | 'campaign' | 'ad' | 'adset'; datePreset?: string; timeIncrement?: number; objective?: string },
) {
  return withClient(userId, async (client, conn) => {
    const objectId = params.objectId || `act_${conn.adAccountId}`
    const rows = await client.getObjectInsights(objectId, params.level || 'campaign', {
      datePreset: params.datePreset || 'last_30d',
      timeIncrement: params.timeIncrement,
    })
    // Conversions and revenue are extracted from the `actions` /
    // `action_values` arrays, not read off a scalar field that Graph never
    // returns.
    const insights = rows.map((r) => normalizeInsightRow(r, params.objective))
    const totals = sumTotals(insights)
    return {
      insights,
      totals: { ...totals, ...computeDerived(totals) },
      total: insights.length,
      attributionWindow: '7d_click,1d_view',
    }
  })
}

export async function metaComparePerformance(
  userId: string,
  objectIds: string[],
  level: 'campaign' | 'ad' | 'adset' = 'campaign',
  datePreset = 'last_30d',
) {
  return withClient(userId, async (client) => {
    const comparison: any[] = []
    for (const id of objectIds) {
      const rows = await client.getObjectInsights(id, level, { datePreset })
      const normalized = rows.map((r) => normalizeInsightRow(r))
      const totals = sumTotals(normalized)
      comparison.push({ objectId: id, ...totals, ...computeDerived(totals) })
    }
    return { comparison, attributionWindow: '7d_click,1d_view' }
  })
}

export async function metaValidateToken(userId: string) {
  return withClient(userId, async (client) => {
    const res = await client.verifyToken()
    const expiresIn = res.expiresAt ? Math.max(0, res.expiresAt - Math.floor(Date.now() / 1000)) : undefined
    const daysLeft = expiresIn ? Math.floor(expiresIn / 86400) : undefined
    return {
      valid: res.valid,
      userId: res.userId,
      expiresAt: res.expiresAt,
      expiresIn,
      daysUntilExpiry: daysLeft,
      scopes: res.scopes,
      // Meta long-lived tokens last ~60 days and nothing renews them
      // automatically, so surface the deadline before it bites.
      warning:
        daysLeft != null && daysLeft <= 7
          ? `This Meta access token expires in ${daysLeft} day(s). Reconnect the Meta account to avoid automation stopping.`
          : undefined,
    }
  })
}

export async function metaGetAccountBalance(userId: string) {
  return withClient(userId, async (client) => {
    const raw = await client.getAccountBalance()
    const currency = raw.currency || 'INR'
    return {
      currency,
      balance: fromMinorUnits(raw.balance, currency),
      spendCap: fromMinorUnits(raw.spendCap, currency),
      amountSpent: fromMinorUnits(raw.amountSpent, currency),
    }
  })
}

// ── Targeting research ────────────────────────────────────────────────────

export async function metaSearchTargeting(
  userId: string,
  params: { query: string; kind: 'geo' | 'interest' | 'locale' },
) {
  return withClient(userId, async (client) => {
    if (params.kind === 'geo') return { results: await client.searchGeoLocations(params.query) }
    if (params.kind === 'locale') return { results: await client.searchLocales(params.query) }
    return { results: await client.searchInterests(params.query) }
  })
}

export async function metaEstimateReach(
  userId: string,
  params: { targeting: MetaTargeting; optimizationGoal?: string },
) {
  return withClient(userId, async (client) => {
    const estimate = await client.getReachEstimate(params.targeting, params.optimizationGoal || 'LINK_CLICKS')
    return {
      estimate,
      lowerBound: estimate.users_lower_bound ?? null,
      upperBound: estimate.users_upper_bound ?? null,
      ready: estimate.estimate_ready ?? false,
    }
  })
}

// ── Writes ────────────────────────────────────────────────────────────────

export async function metaCreateCampaign(
  userId: string,
  params: {
    name: string
    objective: string
    status?: string
    dailyBudget?: number
    lifetimeBudget?: number
    startTime?: string
    endTime?: string
    specialAdCategories?: SpecialAdCategory[]
  },
) {
  return withClient(userId, async (client) => {
    const result = await client.createCampaign({
      name: params.name,
      objective: params.objective,
      status: params.status || 'PAUSED',
      dailyBudget: params.dailyBudget,
      lifetimeBudget: params.lifetimeBudget,
      startTime: params.startTime,
      endTime: params.endTime,
      specialAdCategories: params.specialAdCategories,
    })
    return {
      success: true,
      campaign_id: result.id,
      message:
        `Created Meta campaign "${params.name}" (id: ${result.id}). ` +
        'It has no ad set or ad yet, so it will NOT deliver — create an ad set and an ad beneath it, or use publish_full_campaign.',
    }
  })
}

export async function metaCreateAdSet(
  userId: string,
  params: {
    name: string
    campaignId: string
    optimizationGoal: OptimizationGoal
    billingEvent: BillingEvent
    targeting: MetaTargeting
    dailyBudget?: number
    lifetimeBudget?: number
    startTime?: string
    endTime?: string
    status?: string
    promotedObject?: { pixel_id?: string; custom_event_type?: string; page_id?: string }
  },
) {
  return withClient(userId, async (client) => {
    const result = await client.createAdSet({
      name: params.name,
      campaignId: params.campaignId,
      optimizationGoal: params.optimizationGoal,
      billingEvent: params.billingEvent,
      targeting: params.targeting,
      dailyBudget: params.dailyBudget,
      lifetimeBudget: params.lifetimeBudget,
      startTime: params.startTime,
      endTime: params.endTime,
      status: params.status || 'PAUSED',
      promotedObject: params.promotedObject,
    })
    return {
      success: true,
      adset_id: result.id,
      message: `Created ad set "${params.name}" (id: ${result.id}). Attach at least one ad to it before it can deliver.`,
    }
  })
}

export async function metaCreateAd(
  userId: string,
  params: { name: string; adsetId: string; creativeId: string; status?: string },
) {
  return withClient(userId, async (client) => {
    const result = await client.createAd({
      name: params.name,
      adsetId: params.adsetId,
      creativeId: params.creativeId,
      status: params.status || 'PAUSED',
    })
    return { success: true, ad_id: result.id, message: `Created ad "${params.name}" (id: ${result.id}).` }
  })
}

export async function metaCreateAdCreative(
  userId: string,
  params: {
    name: string
    title: string
    body: string
    imageUrl?: string
    link: string
    callToAction: string
    pageId?: string
    description?: string
  },
) {
  if (!params.link) {
    return { error: 'A landing page URL is required. An ad with no real destination spends money sending people nowhere.' }
  }
  return withClient(userId, async (client) => {
    let pageId = params.pageId
    if (!pageId) {
      const pages = await client.getPages().catch(() => [])
      if (pages.length === 1) pageId = pages[0].id
    }
    const result = await client.createAdCreative({
      name: params.name,
      body: params.body,
      title: params.title,
      description: params.description,
      imageUrl: params.imageUrl,
      link: params.link,
      callToAction: params.callToAction,
      pageId,
      allowedImageHostSuffixes: getAllowedImageHosts(),
    })
    return { success: true, creativeId: result.id, imageHash: result.imageHash }
  })
}

export async function metaUpdateCampaignBudget(
  userId: string,
  params: { campaignId: string; dailyBudget?: number; lifetimeBudget?: number },
) {
  return withClient(userId, async (client) => {
    await client.updateCampaignBudget(params.campaignId, {
      dailyBudget: params.dailyBudget,
      lifetimeBudget: params.lifetimeBudget,
    })
    return {
      success: true,
      message: `Updated budget on campaign ${params.campaignId} to ${
        params.dailyBudget != null ? `₹${params.dailyBudget}/day` : `₹${params.lifetimeBudget} lifetime`
      }.`,
    }
  })
}

export async function metaUpdateAdSetBudget(
  userId: string,
  params: { adsetId: string; dailyBudget?: number; lifetimeBudget?: number },
) {
  return withClient(userId, async (client) => {
    await client.updateAdSetBudget(params.adsetId, {
      dailyBudget: params.dailyBudget,
      lifetimeBudget: params.lifetimeBudget,
    })
    return {
      success: true,
      message: `Updated budget on ad set ${params.adsetId} to ${
        params.dailyBudget != null ? `₹${params.dailyBudget}/day` : `₹${params.lifetimeBudget} lifetime`
      }.`,
    }
  })
}

export async function metaPauseCampaign(userId: string, metaCampaignId: string) {
  return withClient(userId, async (client) => {
    await client.pauseCampaign(metaCampaignId)
    return { success: true, message: `Paused Meta campaign ${metaCampaignId}` }
  })
}

/**
 * Resume a campaign AND the ad sets and ads under it. Meta tracks status
 * independently at each level, so resuming only the campaign leaves the ad
 * sets paused and nothing delivers.
 */
export async function metaResumeCampaign(userId: string, metaCampaignId: string) {
  return withClient(userId, async (client) => {
    await client.resumeCampaign(metaCampaignId)
    const notes: string[] = []
    try {
      const adSets = await client.getAdSets(metaCampaignId)
      if (adSets.length === 0) {
        notes.push('WARNING: this campaign has no ad sets, so it will not deliver.')
      }
      for (const adSet of adSets) {
        await client.setAdSetStatus(adSet.id, true)
        const ads = await client.getAds(adSet.id)
        if (ads.length === 0) notes.push(`WARNING: ad set "${adSet.name}" has no ads and will not deliver.`)
        for (const ad of ads) await client.setAdStatus(ad.id, true)
      }
    } catch (err) {
      notes.push(`Ad sets could not be resumed: ${friendly(err)}`)
    }
    return {
      success: true,
      message: `Resumed Meta campaign ${metaCampaignId}${notes.length ? `. ${notes.join(' ')}` : ''}`,
    }
  })
}

export async function metaSetAdSetStatus(userId: string, adsetId: string, active: boolean) {
  return withClient(userId, async (client) => {
    await client.setAdSetStatus(adsetId, active)
    return { success: true, message: `Ad set ${adsetId} ${active ? 'resumed' : 'paused'}.` }
  })
}

export async function metaSetAdStatus(userId: string, adId: string, active: boolean) {
  return withClient(userId, async (client) => {
    await client.setAdStatus(adId, active)
    return { success: true, message: `Ad ${adId} ${active ? 'resumed' : 'paused'}.` }
  })
}

export { num }

// ── Audiences ─────────────────────────────────────────────────────────────

export async function metaListAudiences(userId: string) {
  return withClient(userId, async (client) => {
    const audiences = await client.getCustomAudiences()
    return { audiences, total: audiences.length }
  })
}

export async function metaCreateCustomAudience(
  userId: string,
  params: { name: string; description?: string; subtype?: string; retentionDays?: number; rule?: unknown },
) {
  return withClient(userId, async (client) => {
    const result = await client.createCustomAudience(params)
    return { success: true, audienceId: result.id, message: `Created custom audience "${params.name}".` }
  })
}

export async function metaCreateLookalikeAudience(
  userId: string,
  params: { name: string; originAudienceId: string; country?: string; ratio?: number },
) {
  return withClient(userId, async (client) => {
    const result = await client.createLookalikeAudience(params)
    return { success: true, audienceId: result.id, message: `Created lookalike audience "${params.name}".` }
  })
}

export async function metaPreviewAd(userId: string, adId: string, format?: string) {
  return withClient(userId, async (client) => {
    const body = await client.getAdPreview(adId, format)
    return body ? { preview: body } : { error: 'Meta returned no preview for that ad.' }
  })
}
