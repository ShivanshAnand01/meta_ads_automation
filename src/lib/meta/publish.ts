import { db } from '@/lib/db/supabase-db'
import { getMetaClientForUser, getMetaConnection, needsMetaConnection } from './user-client'
import { MetaApiError, type MetaApiClient } from './client'
import type {
  MetaTargeting,
  OptimizationGoal,
  BillingEvent,
  SpecialAdCategory,
  BidStrategy,
} from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Full publish pipeline: Campaign → Ad Set → Ad.
 *
 * Meta's delivery hierarchy has three levels and all three are required. The
 * previous implementation created only the campaign, which produces an object
 * that is visible in Ads Manager but can never deliver an impression or spend
 * a rupee — every metric downstream of it reads zero forever.
 *
 * Everything is created PAUSED by default. Going live is a separate, explicit
 * act so a mistake here costs nothing.
 */

export interface PublishTargeting {
  /** Free-text place names, resolved to Meta geo keys at publish time. */
  regions?: string[]
  cities?: string[]
  countries?: string[]
  ageMin?: number
  ageMax?: number
  /** 1 = male, 2 = female. Omit to target all. */
  genders?: number[]
  /** Free-text language names, resolved to Meta locale IDs. */
  languages?: string[]
  interests?: string[]
  publisherPlatforms?: string[]
  customAudienceIds?: string[]
  excludedCustomAudienceIds?: string[]
  /** Let Meta expand beyond the stated audience when it predicts better results. */
  advantageAudience?: boolean
}

export interface PublishCampaignInput {
  userId: string
  campaignId: string
  /** Local creative rows to turn into live ads. */
  creativeIds?: string[]
  targeting?: PublishTargeting
  optimizationGoal?: OptimizationGoal
  billingEvent?: BillingEvent
  bidStrategy?: BidStrategy
  /** Landing page the ad sends people to. Required — there is no safe default. */
  linkUrl?: string
  /** Facebook Page the ad is published from. Required by Meta for link ads. */
  pageId?: string
  /** Pixel + event, required when optimizing for OFFSITE_CONVERSIONS. */
  pixelId?: string
  conversionEvent?: string
  specialAdCategories?: SpecialAdCategory[]
  /** Publish live immediately instead of paused. Defaults to false. */
  activate?: boolean
  adSetName?: string
}

export interface PublishResult {
  success: boolean
  message: string
  metaCampaignId?: string
  metaAdSetId?: string
  metaAdIds?: string[]
  warnings: string[]
  /** Which stage failed, when it did. Useful for a partial rollback. */
  failedStage?: 'campaign' | 'adset' | 'creative' | 'ad'
}

/** Objectives paired with the optimization goal that actually makes sense. */
const DEFAULT_GOAL_BY_OBJECTIVE: Record<string, OptimizationGoal> = {
  OUTCOME_SALES: 'OFFSITE_CONVERSIONS',
  OUTCOME_LEADS: 'LEAD_GENERATION',
  OUTCOME_TRAFFIC: 'LANDING_PAGE_VIEWS',
  OUTCOME_ENGAGEMENT: 'POST_ENGAGEMENT',
  OUTCOME_AWARENESS: 'REACH',
  OUTCOME_APP_PROMOTION: 'LINK_CLICKS',
}

const DEFAULT_BILLING_BY_GOAL: Partial<Record<OptimizationGoal, BillingEvent>> = {
  OFFSITE_CONVERSIONS: 'IMPRESSIONS',
  LEAD_GENERATION: 'IMPRESSIONS',
  LANDING_PAGE_VIEWS: 'IMPRESSIONS',
  LINK_CLICKS: 'IMPRESSIONS',
  POST_ENGAGEMENT: 'IMPRESSIONS',
  REACH: 'IMPRESSIONS',
  THRUPLAY: 'IMPRESSIONS',
  VALUE: 'IMPRESSIONS',
}

/**
 * Resolve human place/language names into the Meta targeting spec.
 *
 * Geo and locale keys are account- and version-specific data, not constants —
 * they get looked up, never hardcoded. Unresolvable names are reported as
 * warnings rather than silently dropped, because silently targeting the wrong
 * geography is how a client's budget disappears into the wrong state.
 */
export async function buildTargeting(
  client: MetaApiClient,
  input: PublishTargeting | undefined,
  warnings: string[],
): Promise<MetaTargeting> {
  const t = input || {}
  const targeting: MetaTargeting = {
    age_min: t.ageMin ?? 18,
    age_max: t.ageMax ?? 65,
  }

  const geo: NonNullable<MetaTargeting['geo_locations']> = {}

  if (t.countries?.length) geo.countries = t.countries

  if (t.regions?.length) {
    const keys: Array<{ key: string }> = []
    for (const name of t.regions) {
      try {
        const hits = await client.searchGeoLocations(name, ['region'])
        const match = hits.find((h) => h.name.toLowerCase() === name.toLowerCase()) || hits[0]
        if (match) keys.push({ key: match.key })
        else warnings.push(`Could not resolve region "${name}" on Meta — it was not included in targeting.`)
      } catch {
        warnings.push(`Region lookup failed for "${name}" — it was not included in targeting.`)
      }
    }
    if (keys.length) geo.regions = keys
  }

  if (t.cities?.length) {
    const keys: Array<{ key: string; radius: number; distance_unit: 'kilometer' }> = []
    for (const name of t.cities) {
      try {
        const hits = await client.searchGeoLocations(name, ['city'])
        const match = hits.find((h) => h.name.toLowerCase() === name.toLowerCase()) || hits[0]
        if (match) keys.push({ key: match.key, radius: 25, distance_unit: 'kilometer' })
        else warnings.push(`Could not resolve city "${name}" on Meta — it was not included in targeting.`)
      } catch {
        warnings.push(`City lookup failed for "${name}" — it was not included in targeting.`)
      }
    }
    if (keys.length) geo.cities = keys
  }

  // Meta rejects an ad set with no geography at all.
  if (!geo.countries && !geo.regions && !geo.cities) {
    geo.countries = ['IN']
    warnings.push('No geography was specified, so targeting defaulted to all of India.')
  }
  targeting.geo_locations = geo

  if (t.genders?.length) targeting.genders = t.genders

  if (t.languages?.length) {
    const locales: number[] = []
    for (const lang of t.languages) {
      try {
        const hits = await client.searchLocales(lang)
        const match = hits.find((h) => h.name.toLowerCase().includes(lang.toLowerCase())) || hits[0]
        if (match) locales.push(match.key)
        else warnings.push(`Could not resolve language "${lang}" on Meta.`)
      } catch {
        warnings.push(`Language lookup failed for "${lang}".`)
      }
    }
    if (locales.length) targeting.locales = locales
  }

  if (t.interests?.length) {
    const interests: Array<{ id: string; name: string }> = []
    for (const term of t.interests) {
      try {
        const hits = await client.searchInterests(term)
        if (hits[0]) interests.push({ id: hits[0].id, name: hits[0].name })
        else warnings.push(`No Meta interest matched "${term}".`)
      } catch {
        warnings.push(`Interest lookup failed for "${term}".`)
      }
    }
    if (interests.length) targeting.interests = interests
  }

  if (t.publisherPlatforms?.length) targeting.publisher_platforms = t.publisherPlatforms
  if (t.customAudienceIds?.length) targeting.custom_audiences = t.customAudienceIds.map((id) => ({ id }))
  if (t.excludedCustomAudienceIds?.length) {
    targeting.excluded_custom_audiences = t.excludedCustomAudienceIds.map((id) => ({ id }))
  }
  if (t.advantageAudience !== undefined) {
    targeting.targeting_automation = { advantage_audience: t.advantageAudience ? 1 : 0 }
  }

  return targeting
}

function metaMessage(err: unknown): string {
  if (err instanceof MetaApiError) return err.friendlyMessage
  return err instanceof Error ? err.message : 'Unknown error'
}

/**
 * Publish a local draft campaign to Meta as a complete, deliverable structure.
 */
export async function publishFullCampaign(input: PublishCampaignInput): Promise<PublishResult> {
  const warnings: string[] = []
  const { userId, campaignId } = input

  const conn = await getMetaConnection(userId)
  const blocker = needsMetaConnection(conn)
  if (blocker) return { success: false, message: blocker, warnings }

  const campaign = (await db.campaign.findUnique({ where: { id: campaignId, userId } })) as any
  if (!campaign) return { success: false, message: 'Campaign not found', warnings }

  // A link ad without a real destination is worse than no ad — it spends money
  // sending people nowhere. The old code defaulted this to facebook.com.
  const linkUrl = input.linkUrl || campaign.linkUrl
  if (!linkUrl) {
    return {
      success: false,
      message: 'A landing page URL is required before publishing. Set the campaign link URL, then publish again.',
      warnings,
    }
  }

  const client = await getMetaClientForUser(userId)

  // Resolve the Page. Meta requires one for link ads.
  let pageId = input.pageId as string | undefined
  if (!pageId) {
    try {
      const pages = await client.getPages()
      if (pages.length === 1) {
        pageId = pages[0].id
        warnings.push(`Using the only available Facebook Page: "${pages[0].name}".`)
      } else if (pages.length > 1) {
        return {
          success: false,
          message: `This account manages ${pages.length} Facebook Pages. Choose which one the ad publishes from before continuing.`,
          warnings,
        }
      }
    } catch (err) {
      warnings.push(`Could not list Facebook Pages: ${metaMessage(err)}`)
    }
  }
  if (!pageId) {
    return {
      success: false,
      message: 'No Facebook Page is available to publish from. Connect a Page with the pages_manage_ads permission.',
      warnings,
    }
  }

  const objective = campaign.objective || 'OUTCOME_TRAFFIC'
  const optimizationGoal = input.optimizationGoal || DEFAULT_GOAL_BY_OBJECTIVE[objective] || 'LINK_CLICKS'
  const billingEvent = input.billingEvent || DEFAULT_BILLING_BY_GOAL[optimizationGoal] || 'IMPRESSIONS'

  // Conversion optimization without a pixel silently under-delivers.
  let promotedObject: { pixel_id?: string; custom_event_type?: string; page_id?: string } | undefined
  if (optimizationGoal === 'OFFSITE_CONVERSIONS') {
    let pixelId = input.pixelId
    if (!pixelId) {
      try {
        const pixels = await client.getPixels()
        if (pixels.length >= 1) {
          pixelId = pixels[0].id
          warnings.push(`Using pixel "${pixels[0].name}" for conversion optimization.`)
        }
      } catch {
        /* fall through to the check below */
      }
    }
    if (!pixelId) {
      return {
        success: false,
        message:
          'This campaign optimizes for conversions but no Meta Pixel is available. Install a pixel on the landing page, or switch the optimization goal to LANDING_PAGE_VIEWS.',
        warnings,
      }
    }
    promotedObject = { pixel_id: pixelId, custom_event_type: input.conversionEvent || 'PURCHASE' }
  } else if (optimizationGoal === 'LEAD_GENERATION') {
    promotedObject = { page_id: pageId }
  }

  const status = input.activate ? 'ACTIVE' : 'PAUSED'
  const budget = Number(campaign.budget) || 0
  const isDaily = campaign.budgetType !== 'lifetime'
  const endTime = campaign.endDate ? new Date(campaign.endDate).toISOString() : undefined

  // ── 1. Campaign ────────────────────────────────────────────────────────
  let metaCampaignId: string | undefined = campaign.metaCampaignId || undefined
  if (!metaCampaignId) {
    try {
      const created = await client.createCampaign({
        name: campaign.name,
        objective,
        status,
        specialAdCategories: input.specialAdCategories || [],
        startTime: campaign.startDate ? new Date(campaign.startDate).toISOString() : undefined,
        endTime,
        // Budget lives on the ad set here so pacing is per-audience. Set it at
        // the campaign level only when the caller explicitly wants CBO.
      })
      metaCampaignId = created.id
      await db.campaign.update({ where: { id: campaignId }, data: { metaCampaignId } })
    } catch (err) {
      return { success: false, message: `Campaign creation failed: ${metaMessage(err)}`, warnings, failedStage: 'campaign' }
    }
  } else {
    warnings.push('Campaign already exists on Meta — reusing it and adding the ad set beneath it.')
  }

  // ── 2. Ad Set ──────────────────────────────────────────────────────────
  const targeting = await buildTargeting(client, input.targeting, warnings)

  let metaAdSetId: string
  try {
    const adSet = await client.createAdSet({
      name: input.adSetName || `${campaign.name} — Ad Set`,
      campaignId: metaCampaignId!,
      optimizationGoal,
      billingEvent,
      targeting,
      status,
      bidStrategy: input.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
      dailyBudget: isDaily && budget > 0 ? budget : undefined,
      lifetimeBudget: !isDaily && budget > 0 ? budget : undefined,
      endTime: !isDaily ? endTime : undefined,
      promotedObject,
    })
    metaAdSetId = adSet.id
  } catch (err) {
    return {
      success: false,
      message: `Ad set creation failed: ${metaMessage(err)}. The campaign exists but has no ad set, so it will not deliver.`,
      metaCampaignId,
      warnings,
      failedStage: 'adset',
    }
  }

  // ── 3. Creatives + Ads ────────────────────────────────────────────────
  const creatives = (await db.adCreative.findMany({ where: { userId } })) as any[]
  const selected = input.creativeIds?.length
    ? creatives.filter((c) => input.creativeIds!.includes(c.id))
    : creatives.filter((c) => c.campaignId === campaignId && c.reviewStatus === 'verified')

  if (selected.length === 0) {
    return {
      success: true,
      message:
        'Campaign and ad set are live on Meta, but no approved creative was attached — so no ad was created and nothing will deliver yet. Approve a creative and publish again.',
      metaCampaignId,
      metaAdSetId,
      metaAdIds: [],
      warnings,
    }
  }

  const allowedImageHosts = getAllowedImageHosts()
  const metaAdIds: string[] = []

  for (const creative of selected) {
    try {
      const created = await client.createAdCreative({
        name: creative.title || 'Ad Creative',
        body: creative.primaryText || creative.description || '',
        title: creative.headline || creative.title || '',
        description: creative.description || undefined,
        imageUrl: creative.imageUrl || undefined,
        link: linkUrl,
        callToAction: creative.callToAction || 'LEARN_MORE',
        pageId,
        allowedImageHostSuffixes: allowedImageHosts,
      })

      const ad = await client.createAd({
        name: creative.title || 'Ad',
        adsetId: metaAdSetId,
        creativeId: created.id,
        status,
      })
      metaAdIds.push(ad.id)

      await db.adCreative.update({
        where: { id: creative.id },
        data: { status: 'published', metaCreativeId: created.id, metaAdId: ad.id },
      }).catch(() => {
        warnings.push(`Ad created on Meta but the local creative row for "${creative.title}" could not be updated.`)
      })
    } catch (err) {
      warnings.push(`Creative "${creative.title}" was not published: ${metaMessage(err)}`)
    }
  }

  if (metaAdIds.length === 0) {
    return {
      success: false,
      message: 'Campaign and ad set were created, but every ad failed to publish. Nothing will deliver.',
      metaCampaignId,
      metaAdSetId,
      metaAdIds: [],
      warnings,
      failedStage: 'ad',
    }
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: input.activate ? 'active' : 'paused', metaAdSetId },
  }).catch(() => {})

  return {
    success: true,
    message: input.activate
      ? `"${campaign.name}" is LIVE on Meta with ${metaAdIds.length} ad(s) and will begin spending.`
      : `"${campaign.name}" is published to Meta as a complete campaign → ad set → ${metaAdIds.length} ad(s), all PAUSED. Activate it when you are ready to spend.`,
    metaCampaignId,
    metaAdSetId,
    metaAdIds,
    warnings,
  }
}

/**
 * Hosts the ad-image uploader is allowed to fetch from. Restricted to our own
 * Supabase storage so a model- or user-supplied URL cannot be used to make the
 * server fetch an internal address.
 */
export function getAllowedImageHosts(): string[] {
  const hosts = ['supabase.co', 'supabase.in']
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (url) {
    try {
      hosts.push(new URL(url).hostname)
    } catch {
      /* ignore a malformed env value */
    }
  }
  return hosts
}
