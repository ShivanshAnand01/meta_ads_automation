import type { MetaAction, MetaInsights } from './types'

/**
 * Conversion and revenue extraction from Meta insights.
 *
 * Graph does NOT return a scalar `conversions` field on insights — conversions
 * live inside the `actions` array keyed by `action_type`, and their monetary
 * value lives in the parallel `action_values` array. Reading `row.conversions`
 * directly (as this codebase used to) yields 0 forever, which silently zeroes
 * out CPA, ROAS and every optimization decision built on them.
 */

export function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

/**
 * The action types that count as a conversion, per objective. Order matters:
 * the first match wins, so we never double-count the same conversion reported
 * under several aliases (`purchase`, `omni_purchase` and
 * `offsite_conversion.fb_pixel_purchase` are usually the SAME event).
 */
const CONVERSION_PRIORITY: Record<string, string[]> = {
  OUTCOME_SALES: ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase'],
  OUTCOME_LEADS: ['offsite_conversion.fb_pixel_lead', 'lead', 'onsite_conversion.lead_grouped'],
  OUTCOME_TRAFFIC: ['landing_page_view', 'link_click'],
  OUTCOME_ENGAGEMENT: ['post_engagement', 'page_engagement'],
  OUTCOME_AWARENESS: ['reach'],
  OUTCOME_APP_PROMOTION: ['app_install', 'omni_app_install'],
}

/** Fallback order when the objective is unknown or not mapped. */
const DEFAULT_PRIORITY = [
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
  'purchase',
  'offsite_conversion.fb_pixel_lead',
  'lead',
  'complete_registration',
  'landing_page_view',
]

function findAction(actions: MetaAction[] | undefined, priority: string[]): MetaAction | null {
  if (!Array.isArray(actions)) return null
  for (const type of priority) {
    const hit = actions.find((a) => a?.action_type === type)
    if (hit) return hit
  }
  return null
}

function priorityFor(objective?: string | null): string[] {
  if (objective && CONVERSION_PRIORITY[objective]) {
    return [...CONVERSION_PRIORITY[objective], ...DEFAULT_PRIORITY]
  }
  return DEFAULT_PRIORITY
}

/**
 * Count conversions for a row, picking exactly one action type so aliases of
 * the same event are never summed together.
 */
export function extractConversions(row: Pick<MetaInsights, 'actions'>, objective?: string | null): number {
  const match = findAction(row.actions, priorityFor(objective))
  return match ? num(match.value) : 0
}

/**
 * Conversion value (revenue) for a row, read from `action_values` using the
 * same single-action-type rule as `extractConversions`.
 */
export function extractRevenue(
  row: { action_values?: MetaAction[] },
  objective?: string | null,
): number {
  const match = findAction(row.action_values, priorityFor(objective))
  return match ? num(match.value) : 0
}

export interface NormalizedInsightRow {
  campaignId?: string
  adsetId?: string
  adId?: string
  date: string | null
  spend: number
  impressions: number
  clicks: number
  reach: number
  frequency: number
  ctr: number
  cpc: number
  cpm: number
  conversions: number
  revenue: number
}

/** Turn a raw Graph insights row into the shape the app stores and charts. */
export function normalizeInsightRow(row: MetaInsights, objective?: string | null): NormalizedInsightRow {
  return {
    campaignId: row.campaign_id,
    adsetId: row.adset_id,
    adId: row.ad_id,
    date: row.date_start || row.date_stop || null,
    spend: num(row.spend),
    impressions: Math.round(num(row.impressions)),
    clicks: Math.round(num(row.clicks)),
    reach: Math.round(num(row.reach)),
    frequency: num(row.frequency),
    ctr: num(row.ctr),
    cpc: num(row.cpc),
    cpm: num(row.cpm),
    conversions: extractConversions(row, objective),
    revenue: extractRevenue(row as unknown as { action_values?: MetaAction[] }, objective),
  }
}

export interface Totals {
  spend: number
  revenue: number
  impressions: number
  clicks: number
  conversions: number
}

/**
 * Portfolio ROAS = total revenue / total spend.
 *
 * NOT the mean of per-campaign ROAS — averaging ratios weights a ₹100 campaign
 * the same as a ₹100,000 one and produces a number that is simply wrong.
 */
export function computeRoas(totals: Pick<Totals, 'spend' | 'revenue'>): number {
  return totals.spend > 0 ? totals.revenue / totals.spend : 0
}

export function computeDerived(totals: Totals) {
  return {
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : 0,
    cpm: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0,
    cpa: totals.conversions > 0 ? totals.spend / totals.conversions : 0,
    roas: computeRoas(totals),
    conversionRate: totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0,
  }
}

export function sumTotals(rows: Array<Partial<Totals>>): Totals {
  return rows.reduce<Totals>(
    (acc, r) => ({
      spend: acc.spend + (r.spend || 0),
      revenue: acc.revenue + (r.revenue || 0),
      impressions: acc.impressions + (r.impressions || 0),
      clicks: acc.clicks + (r.clicks || 0),
      conversions: acc.conversions + (r.conversions || 0),
    }),
    { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 },
  )
}
