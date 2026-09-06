import { toMinorUnits } from './client'

/**
 * Argument adaptation between OUR tool shapes and meta-ads-mcp's zod schemas.
 *
 * Pure and unit-tested, because the differences are exactly the kind that
 * spend the wrong amount of money quietly:
 *
 *  - MCP budgets are in MINOR units ("account currency cents"); ours are
 *    major units. Passing ₹500 straight through creates a ₹5 campaign.
 *  - MCP `get_insights` requires `object_id` and rejects Meta's `last_Nd`
 *    presets; those become an explicit `time_range`.
 *  - `end_time` → `stop_time` on campaigns; special-ad-category enum differs;
 *    `call_to_action` is an object, not a string.
 */

const MCP_DATE_PRESETS = new Set([
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
  'this_quarter', 'last_quarter', 'this_year', 'last_year', 'lifetime',
])

const SPECIAL_CATEGORY_MAP: Record<string, string> = {
  ISSUES_ELECTIONS_POLITICS: 'SOCIAL_ISSUES_ELECTIONS_POLITICS',
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/** Convert a Meta `last_Nd` / `maximum` preset into what MCP accepts. */
export function adaptDatePreset(
  preset: string | undefined,
  now = new Date(),
): { date_preset?: string; time_range?: { since: string; until: string } } {
  if (!preset) return {}
  if (MCP_DATE_PRESETS.has(preset)) return { date_preset: preset }
  if (preset === 'maximum') return { date_preset: 'lifetime' }
  const m = preset.match(/^last_(\d+)d$/)
  if (m) {
    const days = Number(m[1])
    const since = new Date(now)
    since.setUTCDate(since.getUTCDate() - days)
    return { time_range: { since: isoDate(since), until: isoDate(now) } }
  }
  // Unknown preset: let MCP reject it so the caller falls back to Graph.
  return { date_preset: preset }
}

export interface AdaptContext {
  adAccountId: string | null
  currency: string
}

/**
 * Shape our arguments for the named MCP tool. Never throws; anything it does
 * not recognise is passed through untouched (MCP's zod will reject it and the
 * bridge falls back to Graph).
 */
export function adaptArgsForMcp(
  tool: string,
  args: Record<string, unknown>,
  ctx: AdaptContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args }
  const accountId = ctx.adAccountId ? `act_${ctx.adAccountId}` : null
  if (accountId && !out.account_id) out.account_id = accountId

  const toCents = (key: string) => {
    const v = out[key]
    if (v === undefined || v === null || v === '') { delete out[key]; return }
    const n = Number(v)
    if (!Number.isFinite(n)) { delete out[key]; return }
    out[key] = toMinorUnits(n, ctx.currency)
  }

  switch (tool) {
    case 'get_insights': {
      if (!out.object_id && accountId) out.object_id = accountId
      const { date_preset, time_range } = adaptDatePreset(out.date_preset as string | undefined)
      delete out.date_preset
      if (date_preset) out.date_preset = date_preset
      if (time_range && !out.time_range) out.time_range = time_range
      if (!out.level) out.level = 'campaign'
      if (out.time_increment !== undefined) delete out.time_increment
      break
    }

    case 'compare_performance': {
      const { date_preset, time_range } = adaptDatePreset(out.date_preset as string | undefined)
      delete out.date_preset
      if (date_preset) out.date_preset = date_preset
      if (time_range && !out.time_range) out.time_range = time_range
      break
    }

    case 'create_campaign': {
      toCents('daily_budget'); toCents('lifetime_budget')
      if (out.end_time !== undefined) { out.stop_time = out.end_time; delete out.end_time }
      if (Array.isArray(out.special_ad_categories)) {
        out.special_ad_categories = (out.special_ad_categories as string[]).map((c) => SPECIAL_CATEGORY_MAP[c] ?? c)
      }
      if (!out.status) out.status = 'PAUSED'
      break
    }

    case 'update_campaign_budget': {
      toCents('daily_budget'); toCents('lifetime_budget')
      break
    }

    case 'create_ad_set': {
      toCents('daily_budget'); toCents('lifetime_budget'); toCents('bid_amount')
      // MCP's schema wants configured_status, not status, and marks it required.
      out.configured_status = (out.status as string) || 'PAUSED'
      delete out.status
      // Meta requires location_types inside geo_locations; MCP's schema marks it
      // required too. Our publish pipeline never sets it.
      const targeting = out.targeting as Record<string, unknown> | undefined
      const geo = targeting?.geo_locations as Record<string, unknown> | undefined
      if (geo && !geo.location_types) {
        out.targeting = { ...targeting, geo_locations: { ...geo, location_types: ['home', 'recent'] } }
      }
      break
    }

    case 'create_ad_creative': {
      // Ours: call_to_action: "SHOP_NOW", link_url: "https://…"
      // MCP:  call_to_action: { type, value: { link } }
      if (typeof out.call_to_action === 'string') {
        out.call_to_action = { type: out.call_to_action, ...(out.link_url ? { value: { link: out.link_url } } : {}) }
      }
      // MCP's creative schema has no page_id; drop it rather than fail validation.
      delete out.page_id
      delete out.description
      break
    }

    default:
      break
  }
  return out
}
