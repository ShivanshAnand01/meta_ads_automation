import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractConversions,
  extractRevenue,
  computeRoas,
  computeDerived,
  sumTotals,
  normalizeInsightRow,
} from '../src/lib/meta/metrics.ts'
import type { MetaInsights } from '../src/lib/meta/types.ts'

/**
 * These guard the numbers the client makes spending decisions on. Every case
 * here corresponds to a bug that was live in production.
 */

function row(partial: Partial<MetaInsights>): MetaInsights {
  return {
    impressions: '0',
    clicks: '0',
    spend: '0',
    reach: '0',
    frequency: '0',
    cpc: '0',
    cpm: '0',
    ctr: '0',
    conversions: '0',
    cost_per_conversion: '0',
    actions: [],
    ...partial,
  } as MetaInsights
}

test('conversions come from the actions array, not a scalar field', () => {
  // Graph never returns a usable scalar `conversions`; reading it gave 0
  // forever, which silently zeroed CPA and ROAS.
  const r = row({
    conversions: '0',
    actions: [
      { action_type: 'link_click', value: '50' },
      { action_type: 'purchase', value: '7' },
    ],
  })
  assert.equal(extractConversions(r, 'OUTCOME_SALES'), 7)
})

test('aliases of the same conversion event are not double counted', () => {
  // purchase / omni_purchase / offsite_conversion.fb_pixel_purchase are
  // normally the SAME 5 purchases reported three ways. Summing them reported
  // 15 and made ROAS look 3x better than reality.
  const r = row({
    actions: [
      { action_type: 'purchase', value: '5' },
      { action_type: 'omni_purchase', value: '5' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '5' },
    ],
  })
  assert.equal(extractConversions(r, 'OUTCOME_SALES'), 5)
})

test('conversion action type follows the campaign objective', () => {
  const r = row({
    actions: [
      { action_type: 'lead', value: '12' },
      { action_type: 'landing_page_view', value: '300' },
    ],
  })
  assert.equal(extractConversions(r, 'OUTCOME_LEADS'), 12)
  assert.equal(extractConversions(r, 'OUTCOME_TRAFFIC'), 300)
})

test('revenue is read from action_values', () => {
  const r = {
    ...row({ actions: [{ action_type: 'purchase', value: '4' }] }),
    action_values: [{ action_type: 'purchase', value: '9600' }],
  }
  assert.equal(extractRevenue(r, 'OUTCOME_SALES'), 9600)
})

test('missing actions yield zero rather than NaN', () => {
  assert.equal(extractConversions(row({ actions: undefined as never })), 0)
  assert.equal(extractRevenue({}), 0)
})

test('ROAS is revenue over spend, not an average of ratios', () => {
  // A ₹100 campaign at 10x and a ₹100,000 campaign at 1x is NOT 5.5x.
  const campaigns = [
    { spend: 100, revenue: 1000, impressions: 0, clicks: 0, conversions: 0 },
    { spend: 100_000, revenue: 100_000, impressions: 0, clicks: 0, conversions: 0 },
  ]
  const totals = sumTotals(campaigns)
  const roas = computeRoas(totals)

  const naiveAverage = (1000 / 100 + 100_000 / 100_000) / 2
  assert.equal(naiveAverage, 5.5)
  assert.ok(Math.abs(roas - 1.009) < 0.001, `expected ~1.009x, got ${roas}`)
})

test('zero spend does not divide by zero', () => {
  const derived = computeDerived({ spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 })
  for (const [key, value] of Object.entries(derived)) {
    assert.ok(Number.isFinite(value), `${key} was ${value}`)
    assert.equal(value, 0)
  }
})

test('derived metrics compute correctly', () => {
  const derived = computeDerived({ spend: 1000, revenue: 3000, impressions: 100_000, clicks: 2000, conversions: 50 })
  assert.equal(derived.ctr, 2)
  assert.equal(derived.cpc, 0.5)
  assert.equal(derived.cpm, 10)
  assert.equal(derived.cpa, 20)
  assert.equal(derived.roas, 3)
  assert.equal(derived.conversionRate, 2.5)
})

test('normalizeInsightRow maps a full Graph row', () => {
  const normalized = normalizeInsightRow(
    {
      ...row({
        campaign_id: '123',
        adset_id: '456',
        ad_id: '789',
        date_start: '2026-08-01',
        spend: '1500.5',
        impressions: '20000',
        clicks: '400',
        actions: [{ action_type: 'purchase', value: '10' }],
      }),
      action_values: [{ action_type: 'purchase', value: '4500' }],
    } as MetaInsights,
    'OUTCOME_SALES',
  )

  assert.equal(normalized.campaignId, '123')
  assert.equal(normalized.adsetId, '456')
  assert.equal(normalized.adId, '789')
  assert.equal(normalized.date, '2026-08-01')
  assert.equal(normalized.spend, 1500.5)
  assert.equal(normalized.conversions, 10)
  assert.equal(normalized.revenue, 4500)
})
