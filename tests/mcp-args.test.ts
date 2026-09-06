import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptArgsForMcp, adaptDatePreset } from '../src/lib/meta/mcp-args.ts'

const ctx = { adAccountId: '1316138380606285', currency: 'INR' }

// ── Money ─────────────────────────────────────────────────────────────────

test('MCP budgets are converted from rupees to paise', () => {
  // meta-ads-mcp takes "account currency cents". Passing ₹500 through
  // unchanged would create a ₹5 campaign.
  const out = adaptArgsForMcp('create_campaign', { name: 'x', objective: 'OUTCOME_SALES', daily_budget: 500 }, ctx)
  assert.equal(out.daily_budget, 50_000)
})

test('ad set budgets and bid amounts are converted too', () => {
  const out = adaptArgsForMcp('create_ad_set', { name: 'x', campaign_id: '1', daily_budget: 250, bid_amount: 12.5 }, ctx)
  assert.equal(out.daily_budget, 25_000)
  assert.equal(out.bid_amount, 1_250)
})

test('update_campaign_budget converts and keeps only the field supplied', () => {
  const out = adaptArgsForMcp('update_campaign_budget', { campaign_id: '9', daily_budget: 1200, lifetime_budget: undefined }, ctx)
  assert.equal(out.daily_budget, 120_000)
  assert.equal('lifetime_budget' in out, false)
})

test('zero-decimal currencies are not multiplied', () => {
  const out = adaptArgsForMcp('create_campaign', { name: 'x', objective: 'OUTCOME_SALES', daily_budget: 500 }, { adAccountId: '1', currency: 'JPY' })
  assert.equal(out.daily_budget, 500)
})

test('a malformed budget is dropped, never sent as NaN', () => {
  const out = adaptArgsForMcp('create_campaign', { name: 'x', objective: 'OUTCOME_SALES', daily_budget: 'lots' }, ctx)
  assert.equal('daily_budget' in out, false)
})

// ── Insights ──────────────────────────────────────────────────────────────

test('get_insights gets the account object_id and a level by default', () => {
  const out = adaptArgsForMcp('get_insights', {}, ctx)
  assert.equal(out.object_id, 'act_1316138380606285')
  assert.equal(out.level, 'campaign')
})

test('last_Nd presets become an explicit time_range', () => {
  const now = new Date('2026-09-06T00:00:00Z')
  assert.deepEqual(adaptDatePreset('last_7d', now), { time_range: { since: '2026-08-30', until: '2026-09-06' } })
  assert.deepEqual(adaptDatePreset('last_30d', now), { time_range: { since: '2026-08-07', until: '2026-09-06' } })
})

test('maximum maps to lifetime; MCP-native presets pass through', () => {
  assert.deepEqual(adaptDatePreset('maximum'), { date_preset: 'lifetime' })
  assert.deepEqual(adaptDatePreset('last_month'), { date_preset: 'last_month' })
})

test('get_insights drops date_preset when it was converted to time_range', () => {
  const out = adaptArgsForMcp('get_insights', { date_preset: 'last_7d' }, ctx)
  assert.equal('date_preset' in out, false)
  assert.ok(out.time_range)
})

// ── Field-shape differences ───────────────────────────────────────────────

test('campaign end_time becomes stop_time and the special category enum is mapped', () => {
  const out = adaptArgsForMcp('create_campaign', {
    name: 'x', objective: 'OUTCOME_LEADS', end_time: '2026-10-01T00:00:00Z', special_ad_categories: ['ISSUES_ELECTIONS_POLITICS', 'CREDIT'],
  }, ctx)
  assert.equal(out.stop_time, '2026-10-01T00:00:00Z')
  assert.equal('end_time' in out, false)
  assert.deepEqual(out.special_ad_categories, ['SOCIAL_ISSUES_ELECTIONS_POLITICS', 'CREDIT'])
  assert.equal(out.status, 'PAUSED')
})

test('creative call_to_action string becomes the MCP object form with the link', () => {
  const out = adaptArgsForMcp('create_ad_creative', { name: 'c', call_to_action: 'SHOP_NOW', link_url: 'https://example.in/buy', page_id: '77' }, ctx)
  assert.deepEqual(out.call_to_action, { type: 'SHOP_NOW', value: { link: 'https://example.in/buy' } })
  assert.equal('page_id' in out, false)
})

test('unknown tools pass arguments through with only account_id added', () => {
  const out = adaptArgsForMcp('list_campaigns', { limit: 10 }, ctx)
  assert.deepEqual(out, { limit: 10, account_id: 'act_1316138380606285' })
})

test('ad set status becomes configured_status and geo gets location_types', () => {
  const out = adaptArgsForMcp('create_ad_set', {
    name: 'x', campaign_id: '1', status: 'ACTIVE',
    targeting: { age_min: 18, geo_locations: { regions: [{ key: '1735' }] } },
  }, ctx)
  assert.equal(out.configured_status, 'ACTIVE')
  assert.equal('status' in out, false)
  const geo = (out.targeting as { geo_locations: Record<string, unknown> }).geo_locations
  assert.deepEqual(geo.location_types, ['home', 'recent'])
  assert.deepEqual(geo.regions, [{ key: '1735' }])
})

test('ad set defaults to PAUSED and leaves explicit location_types alone', () => {
  const out = adaptArgsForMcp('create_ad_set', {
    name: 'x', campaign_id: '1', targeting: { geo_locations: { countries: ['IN'], location_types: ['home'] } },
  }, ctx)
  assert.equal(out.configured_status, 'PAUSED')
  assert.deepEqual((out.targeting as { geo_locations: { location_types: string[] } }).geo_locations.location_types, ['home'])
})
