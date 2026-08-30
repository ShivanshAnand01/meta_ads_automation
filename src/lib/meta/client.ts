import crypto from 'node:crypto'
import type {
  MetaAdAccount,
  MetaCampaign,
  MetaAdCreative,
  MetaAdSet,
  MetaAd,
  MetaInsights,
  MetaBillingInfo,
  MetaConnectionConfig,
  AdSetCreateParams,
  AdCreateParams,
  SpecialAdCategory,
} from './types'

// Pin one version and bump deliberately. Meta drops versions ~2 years after
// release, so this needs a calendar reminder, not a surprise 400 in production.
export const GRAPH_API_VERSION = 'v23.0'
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

/** Max pages to walk when following `paging.next`. Guards runaway loops. */
const MAX_PAGES = 25
const DEFAULT_PAGE_LIMIT = 100

/**
 * Meta error codes worth retrying. Everything else is a real failure and
 * retrying just burns the rate limit harder.
 *   1, 2       transient / unknown API error
 *   4, 17, 32  app / user / page rate limit
 *   613        calls-per-second limit
 *   80000-80014 business-use-case rate limits (ads, insights, custom audiences)
 */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 613])

function isRetryableCode(code: number | undefined): boolean {
  if (code == null) return false
  if (RETRYABLE_CODES.has(code)) return true
  return code >= 80000 && code <= 80014
}

export class MetaApiError extends Error {
  code?: number
  subcode?: number
  type?: string
  fbtraceId?: string
  httpStatus: number
  isRateLimit: boolean

  constructor(
    message: string,
    opts: { code?: number; subcode?: number; type?: string; fbtraceId?: string; httpStatus: number },
  ) {
    super(message)
    this.name = 'MetaApiError'
    this.code = opts.code
    this.subcode = opts.subcode
    this.type = opts.type
    this.fbtraceId = opts.fbtraceId
    this.httpStatus = opts.httpStatus
    this.isRateLimit = isRetryableCode(opts.code) || opts.httpStatus === 429
  }

  /** Message a non-technical client can actually act on. */
  get friendlyMessage(): string {
    if (this.code === 190) return 'Your Meta access token has expired or been revoked. Reconnect your Meta account.'
    if (this.isRateLimit) return 'Meta is rate-limiting this ad account right now. Try again in a few minutes.'
    if (this.code === 200 || this.code === 10) return 'Your Meta app is missing a permission for this action (ads_management).'
    if (this.code === 100) return `Meta rejected the request: ${this.message}`
    return this.message
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string; fbtrace_id?: string }
}

interface Paged<T> {
  data: T[]
  paging?: { next?: string; cursors?: { after?: string } }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class MetaApiClient {
  private accessToken: string
  private appId: string
  private appSecret: string
  private adAccountId?: string

  constructor(config: MetaConnectionConfig) {
    this.accessToken = config.accessToken
    this.appId = config.appId
    this.appSecret = config.appSecret
    this.adAccountId = config.adAccountId
  }

  /**
   * HMAC-SHA256 of the access token keyed by the app secret. Meta requires
   * this on server-side calls once "Require app secret proof" is enabled on
   * the app, and recommends it always. Without it, enabling that setting
   * silently breaks every call.
   */
  private appSecretProof(): string | null {
    if (!this.appSecret) return null
    try {
      return crypto.createHmac('sha256', this.appSecret).update(this.accessToken).digest('hex')
    } catch {
      return null
    }
  }

  private buildUrl(endpoint: string, params: Record<string, string>): URL {
    const url = new URL(`${BASE_URL}${endpoint}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.append(key, value)
    if (!params.access_token) {
      url.searchParams.append('access_token', this.accessToken)
      const proof = this.appSecretProof()
      if (proof) url.searchParams.append('appsecret_proof', proof)
    }
    return url
  }

  /**
   * Single Graph request with exponential backoff + jitter on rate limits and
   * transient 5xx. Throws a typed MetaApiError so callers can branch on code.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    params: Record<string, string> = {},
    attempt = 0,
  ): Promise<T> {
    const url = this.buildUrl(endpoint, params)

    let response: Response
    try {
      response = await fetch(url.toString(), {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      })
    } catch (err) {
      if (attempt < 3) {
        await sleep(2 ** attempt * 500 + Math.random() * 300)
        return this.request<T>(endpoint, options, params, attempt + 1)
      }
      throw new MetaApiError(err instanceof Error ? err.message : 'Network error reaching Meta', { httpStatus: 0 })
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      data = {}
    }

    const errBody = (data as GraphErrorBody).error
    if (!response.ok || errBody) {
      const apiError = new MetaApiError(errBody?.message || `Meta API error: ${response.status} ${response.statusText}`, {
        code: errBody?.code,
        subcode: errBody?.error_subcode,
        type: errBody?.type,
        fbtraceId: errBody?.fbtrace_id,
        httpStatus: response.status,
      })

      const retryable = apiError.isRateLimit || response.status === 500 || response.status === 503
      if (retryable && attempt < 4) {
        // Meta rate limits reset on a rolling window, so back off hard.
        await sleep(2 ** attempt * 1000 + Math.random() * 500)
        return this.request<T>(endpoint, options, params, attempt + 1)
      }
      throw apiError
    }

    return data as T
  }

  /**
   * Paginated GET. Graph defaults to 25 rows per page and silently drops the
   * rest, so every list endpoint here goes through this rather than `request`.
   */
  private async requestAll<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = []
    let page = await this.request<Paged<T>>(endpoint, {}, { limit: String(DEFAULT_PAGE_LIMIT), ...params })
    out.push(...(page.data || []))

    let pages = 1
    while (page.paging?.next && pages < MAX_PAGES) {
      const res = await fetch(page.paging.next)
      if (!res.ok) break
      page = (await res.json()) as Paged<T>
      out.push(...(page.data || []))
      pages++
    }
    return out
  }

  // ── Connection ────────────────────────────────────────────────────────

  async verifyToken(): Promise<{ valid: boolean; userId?: string; expiresAt?: number; scopes?: string[] }> {
    try {
      const data = await this.request<{
        data: { user_id: string; expires_at: number; is_valid: boolean; scopes?: string[] }
      }>('/debug_token', {}, { input_token: this.accessToken, access_token: `${this.appId}|${this.appSecret}` })
      return {
        valid: data.data?.is_valid ?? false,
        userId: data.data?.user_id,
        expiresAt: data.data?.expires_at,
        scopes: data.data?.scopes,
      }
    } catch {
      return { valid: false }
    }
  }

  async getAdAccounts(): Promise<MetaAdAccount[]> {
    return this.requestAll<MetaAdAccount>('/me/adaccounts', {
      fields:
        'id,name,account_id,account_status,currency,timezone_name,spend_cap,amount_spent,balance,min_daily_budget',
    })
  }

  setAdAccountId(accountId: string) {
    this.adAccountId = accountId
  }

  private requireAccount(): string {
    if (!this.adAccountId) throw new MetaApiError('Ad account ID not set', { httpStatus: 400 })
    return this.adAccountId
  }

  // ── Campaigns ─────────────────────────────────────────────────────────

  private static readonly CAMPAIGN_FIELDS =
    'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,buying_type,configured_status,effective_status'

  async getCampaigns(): Promise<MetaCampaign[]> {
    return this.requestAll<MetaCampaign>(`/act_${this.requireAccount()}/campaigns`, {
      fields: MetaApiClient.CAMPAIGN_FIELDS,
    })
  }

  /** Alias kept for existing callers. */
  async getCampaignsList(): Promise<MetaCampaign[]> {
    return this.getCampaigns()
  }

  async createCampaign(campaign: {
    name: string
    objective: string
    status: string
    dailyBudget?: number
    lifetimeBudget?: number
    startTime?: string
    endTime?: string
    buyingType?: string
    specialAdCategories?: SpecialAdCategory[]
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status,
      buying_type: campaign.buyingType || 'AUCTION',
      // Meta requires this field. An empty array means "no restricted
      // category" — the wrong value here can get an ad account restricted,
      // so regulated verticals must set it explicitly.
      special_ad_categories: (campaign.specialAdCategories || []).filter((c) => c !== 'NONE'),
    }
    if (campaign.dailyBudget != null) body.daily_budget = toMinorUnits(campaign.dailyBudget)
    if (campaign.lifetimeBudget != null) body.lifetime_budget = toMinorUnits(campaign.lifetimeBudget)
    if (campaign.startTime) body.start_time = campaign.startTime
    if (campaign.endTime) body.stop_time = campaign.endTime

    return this.request<{ id: string }>(`/act_${this.requireAccount()}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async updateCampaign(campaignId: string, updates: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/${campaignId}`, {
      method: 'POST',
      body: JSON.stringify(updates),
    })
  }

  /** Change a campaign budget. Amounts are major units (₹), converted here. */
  async updateCampaignBudget(
    campaignId: string,
    budget: { dailyBudget?: number; lifetimeBudget?: number },
  ): Promise<{ success: boolean }> {
    const updates: Record<string, unknown> = {}
    if (budget.dailyBudget != null) updates.daily_budget = toMinorUnits(budget.dailyBudget)
    if (budget.lifetimeBudget != null) updates.lifetime_budget = toMinorUnits(budget.lifetimeBudget)
    if (Object.keys(updates).length === 0) throw new MetaApiError('No budget value supplied', { httpStatus: 400 })
    return this.updateCampaign(campaignId, updates)
  }

  async deleteCampaign(campaignId: string): Promise<{ success: boolean }> {
    // Meta has no DELETE on campaigns; status DELETED is the documented path.
    return this.updateCampaign(campaignId, { status: 'DELETED' })
  }

  async pauseCampaign(campaignId: string): Promise<{ success: boolean }> {
    return this.updateCampaign(campaignId, { status: 'PAUSED' })
  }

  async resumeCampaign(campaignId: string): Promise<{ success: boolean }> {
    return this.updateCampaign(campaignId, { status: 'ACTIVE' })
  }

  // ── Ad Sets ───────────────────────────────────────────────────────────

  private static readonly ADSET_FIELDS =
    'id,name,campaign_id,status,configured_status,effective_status,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,bid_amount,start_time,end_time,targeting,promoted_object'

  async getAdSets(campaignId?: string): Promise<MetaAdSet[]> {
    const path = campaignId ? `/${campaignId}/adsets` : `/act_${this.requireAccount()}/adsets`
    return this.requestAll<MetaAdSet>(path, { fields: MetaApiClient.ADSET_FIELDS })
  }

  /**
   * Create an ad set — the layer that carries targeting, budget, optimization
   * goal and schedule. A campaign without one never delivers an impression.
   */
  async createAdSet(params: AdSetCreateParams): Promise<{ id: string }> {
    // A lifetime budget on an ad set requires an end time; Meta otherwise
    // rejects it with an unhelpful message.
    if (params.lifetimeBudget != null && !params.endTime) {
      throw new MetaApiError('An ad set with a lifetime budget must also have an end time.', { httpStatus: 400 })
    }

    const body: Record<string, unknown> = {
      name: params.name,
      campaign_id: params.campaignId,
      optimization_goal: params.optimizationGoal,
      billing_event: params.billingEvent,
      targeting: params.targeting,
      status: params.status || 'PAUSED',
      bid_strategy: params.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
    }
    if (params.dailyBudget != null) body.daily_budget = toMinorUnits(params.dailyBudget)
    if (params.lifetimeBudget != null) body.lifetime_budget = toMinorUnits(params.lifetimeBudget)
    if (params.bidAmount != null) body.bid_amount = toMinorUnits(params.bidAmount)
    if (params.startTime) body.start_time = params.startTime
    if (params.endTime) body.end_time = params.endTime
    if (params.promotedObject) body.promoted_object = params.promotedObject
    if (params.destinationType) body.destination_type = params.destinationType

    return this.request<{ id: string }>(`/act_${this.requireAccount()}/adsets`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async updateAdSet(adsetId: string, updates: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/${adsetId}`, { method: 'POST', body: JSON.stringify(updates) })
  }

  async updateAdSetBudget(
    adsetId: string,
    budget: { dailyBudget?: number; lifetimeBudget?: number },
  ): Promise<{ success: boolean }> {
    const updates: Record<string, unknown> = {}
    if (budget.dailyBudget != null) updates.daily_budget = toMinorUnits(budget.dailyBudget)
    if (budget.lifetimeBudget != null) updates.lifetime_budget = toMinorUnits(budget.lifetimeBudget)
    if (Object.keys(updates).length === 0) throw new MetaApiError('No budget value supplied', { httpStatus: 400 })
    return this.updateAdSet(adsetId, updates)
  }

  async setAdSetStatus(adsetId: string, active: boolean): Promise<{ success: boolean }> {
    return this.updateAdSet(adsetId, { status: active ? 'ACTIVE' : 'PAUSED' })
  }

  // ── Ads ───────────────────────────────────────────────────────────────

  private static readonly AD_FIELDS =
    'id,name,adset_id,campaign_id,status,configured_status,effective_status,creative{id}'

  async getAds(adsetId?: string): Promise<MetaAd[]> {
    const path = adsetId ? `/${adsetId}/ads` : `/act_${this.requireAccount()}/ads`
    return this.requestAll<MetaAd>(path, { fields: MetaApiClient.AD_FIELDS })
  }

  /** Bind a creative to an ad set. This is the object that actually runs. */
  async createAd(params: AdCreateParams): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: params.name,
      adset_id: params.adsetId,
      creative: { creative_id: params.creativeId },
      status: params.status || 'PAUSED',
    }
    if (params.trackingSpecs) body.tracking_specs = params.trackingSpecs

    return this.request<{ id: string }>(`/act_${this.requireAccount()}/ads`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async setAdStatus(adId: string, active: boolean): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/${adId}`, {
      method: 'POST',
      body: JSON.stringify({ status: active ? 'ACTIVE' : 'PAUSED' }),
    })
  }

  // ── Creatives & images ────────────────────────────────────────────────

  async getAdCreatives(): Promise<MetaAdCreative[]> {
    return this.requestAll<MetaAdCreative>(`/act_${this.requireAccount()}/adcreatives`, {
      fields: 'id,name,status,body,title,image_url,thumbnail_url,call_to_action_type,link',
    })
  }

  /**
   * Upload an image to the ad account library and return its hash. Only https
   * URLs on an allowlisted host are fetched — this runs server-side, so an
   * arbitrary caller-supplied URL would otherwise be an SSRF vector.
   */
  async uploadImage(
    imageUrl: string,
    opts?: { allowedHostSuffixes?: string[]; maxBytes?: number },
  ): Promise<{ hash: string; url?: string }> {
    const accountId = this.requireAccount()
    const maxBytes = opts?.maxBytes ?? 8 * 1024 * 1024

    let parsed: URL
    try {
      parsed = new URL(imageUrl)
    } catch {
      throw new MetaApiError('Image URL is not a valid URL', { httpStatus: 400 })
    }
    if (parsed.protocol !== 'https:') {
      throw new MetaApiError('Image URL must use https', { httpStatus: 400 })
    }
    const allowed = opts?.allowedHostSuffixes
    if (
      allowed &&
      allowed.length > 0 &&
      !allowed.some((suffix) => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`))
    ) {
      throw new MetaApiError(`Image host "${parsed.hostname}" is not allowed`, { httpStatus: 400 })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    let imageRes: Response
    try {
      imageRes = await fetch(parsed.toString(), { signal: controller.signal, redirect: 'follow' })
    } finally {
      clearTimeout(timeout)
    }
    if (!imageRes.ok) {
      throw new MetaApiError(`Failed to fetch image: ${imageRes.status}`, { httpStatus: imageRes.status })
    }

    const contentType = imageRes.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      throw new MetaApiError(`Image URL returned "${contentType || 'no content-type'}", not an image`, {
        httpStatus: 415,
      })
    }
    const declaredLength = Number(imageRes.headers.get('content-length') || 0)
    if (declaredLength && declaredLength > maxBytes) {
      throw new MetaApiError(`Image is over the ${Math.round(maxBytes / 1024)}KB limit`, { httpStatus: 413 })
    }

    const buffer = Buffer.from(await imageRes.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      throw new MetaApiError(`Image is over the ${Math.round(maxBytes / 1024)}KB limit`, { httpStatus: 413 })
    }

    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png'
    const data = await this.request<{ images?: Record<string, { hash: string; url?: string }> }>(
      `/act_${accountId}/adimages`,
      {
        method: 'POST',
        body: JSON.stringify({ bytes: buffer.toString('base64'), filename: `creative_${Date.now()}.${ext}` }),
      },
    )
    const first = data.images ? Object.values(data.images)[0] : null
    if (!first?.hash) throw new MetaApiError('Meta did not return an image hash', { httpStatus: 502 })
    return { hash: first.hash, url: first.url }
  }

  async createAdCreative(creative: {
    name: string
    body: string
    title: string
    imageUrl?: string
    imageHash?: string
    link: string
    callToAction: string
    pageId?: string
    description?: string
    allowedImageHostSuffixes?: string[]
  }): Promise<{ id: string; imageHash?: string }> {
    const accountId = this.requireAccount()

    let imageHash: string | undefined = creative.imageHash
    if (!imageHash && creative.imageUrl) {
      const uploaded = await this.uploadImage(creative.imageUrl, {
        allowedHostSuffixes: creative.allowedImageHostSuffixes,
      })
      imageHash = uploaded.hash
    }

    const linkData: Record<string, unknown> = {
      message: creative.body,
      link: creative.link,
      name: creative.title,
      call_to_action: { type: creative.callToAction },
    }
    if (creative.description) linkData.description = creative.description
    // `image_hash` is the correct field for an uploaded image. The old code
    // put the hash in `picture`, which expects a URL — Meta accepted it and
    // silently produced an imageless ad.
    if (imageHash) linkData.image_hash = imageHash

    const body: Record<string, unknown> = {
      name: creative.name,
      object_story_spec: {
        ...(creative.pageId ? { page_id: creative.pageId } : {}),
        link_data: linkData,
      },
    }

    const data = await this.request<{ id: string }>(`/act_${accountId}/adcreatives`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { id: data.id, imageHash }
  }

  // ── Audiences ─────────────────────────────────────────────────────────

  async getCustomAudiences(): Promise<Array<{ id: string; name: string; subtype?: string; approximate_count_lower_bound?: number }>> {
    return this.requestAll<{ id: string; name: string; subtype?: string; approximate_count_lower_bound?: number }>(
      `/act_${this.requireAccount()}/customaudiences`,
      { fields: 'id,name,subtype,approximate_count_lower_bound,delivery_status' },
    )
  }

  async createCustomAudience(params: {
    name: string
    description?: string
    subtype?: string
    customerFileSource?: string
    rule?: unknown
    retentionDays?: number
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: params.name,
      subtype: params.subtype || 'WEBSITE',
    }
    if (params.description) body.description = params.description
    if (params.rule) body.rule = params.rule
    if (params.retentionDays) body.retention_days = params.retentionDays
    if (params.subtype === 'CUSTOM' || params.customerFileSource) {
      body.customer_file_source = params.customerFileSource || 'USER_PROVIDED_ONLY'
    }
    return this.request<{ id: string }>(`/act_${this.requireAccount()}/customaudiences`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async createLookalikeAudience(params: {
    name: string
    originAudienceId: string
    country?: string
    ratio?: number
  }): Promise<{ id: string }> {
    const body = {
      name: params.name,
      subtype: 'LOOKALIKE',
      origin_audience_id: params.originAudienceId,
      lookalike_spec: JSON.stringify({
        type: 'similarity',
        country: params.country || 'IN',
        ratio: params.ratio ?? 0.01,
      }),
    }
    return this.request<{ id: string }>(`/act_${this.requireAccount()}/customaudiences`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /** Rendered preview of an ad, as an iframe embed URL. */
  async getAdPreview(adId: string, format = 'MOBILE_FEED_STANDARD'): Promise<string | null> {
    const data = await this.request<{ data: Array<{ body: string }> }>(`/${adId}/previews`, {}, { ad_format: format })
    return data.data?.[0]?.body ?? null
  }

  // ── Targeting lookups ─────────────────────────────────────────────────
  // Geo and locale IDs are NOT stable constants to hardcode — they must be
  // resolved from Meta's search endpoints, or the ad set silently targets the
  // wrong place (or fails validation).

  async searchGeoLocations(
    query: string,
    locationTypes: Array<'country' | 'region' | 'city'> = ['region', 'city'],
  ): Promise<Array<{ key: string; name: string; type: string; country_code?: string; region?: string }>> {
    const data = await this.request<{
      data: Array<{ key: string; name: string; type: string; country_code?: string; region?: string }>
    }>('/search', {}, {
      type: 'adgeolocation',
      q: query,
      location_types: JSON.stringify(locationTypes),
      limit: '25',
    })
    return data.data || []
  }

  /** Locale IDs for language targeting (e.g. Marathi). */
  async searchLocales(query: string): Promise<Array<{ key: number; name: string }>> {
    const data = await this.request<{ data: Array<{ key: number; name: string }> }>('/search', {}, {
      type: 'adlocale',
      q: query,
      limit: '25',
    })
    return data.data || []
  }

  /** Interest IDs for detailed targeting. */
  async searchInterests(query: string): Promise<Array<{ id: string; name: string; audience_size_lower_bound?: number }>> {
    const data = await this.request<{
      data: Array<{ id: string; name: string; audience_size_lower_bound?: number }>
    }>('/search', {}, { type: 'adinterest', q: query, limit: '25' })
    return data.data || []
  }

  /** Reach estimate for a targeting spec, before spending anything on it. */
  async getReachEstimate(
    targeting: unknown,
    optimizationGoal: string,
  ): Promise<{ users_lower_bound?: number; users_upper_bound?: number; estimate_ready?: boolean }> {
    const data = await this.request<{
      data: Array<{ users_lower_bound?: number; users_upper_bound?: number; estimate_ready?: boolean }>
    }>(`/act_${this.requireAccount()}/delivery_estimate`, {}, {
      targeting_spec: JSON.stringify(targeting),
      optimization_goal: optimizationGoal,
    })
    return data.data?.[0] || {}
  }

  /** Pages the connected user can advertise for. A creative needs a page_id. */
  async getPages(): Promise<Array<{ id: string; name: string }>> {
    return this.requestAll<{ id: string; name: string }>('/me/accounts', { fields: 'id,name' })
  }

  /** Pixels on the ad account, needed as promoted_object for conversions. */
  async getPixels(): Promise<Array<{ id: string; name: string }>> {
    return this.requestAll<{ id: string; name: string }>(`/act_${this.requireAccount()}/adspixels`, {
      fields: 'id,name',
    })
  }

  // ── Insights ──────────────────────────────────────────────────────────

  private static readonly INSIGHT_FIELDS =
    'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,impressions,clicks,spend,reach,frequency,cpc,cpm,ctr,actions,action_values,cost_per_action_type'

  /**
   * Attribution windows must be pinned explicitly, otherwise these numbers
   * silently disagree with what the client sees in Ads Manager — the fastest
   * way to lose their trust in the dashboard. 7-day click / 1-day view is
   * Meta's current default.
   */
  private static readonly ATTRIBUTION_WINDOWS = JSON.stringify(['7d_click', '1d_view'])

  async getInsights(
    level: 'account' | 'campaign' | 'ad' | 'adset' = 'campaign',
    datePreset = 'last_30d',
  ): Promise<MetaInsights[]> {
    return this.getObjectInsights(`act_${this.requireAccount()}`, level, { datePreset })
  }

  async getObjectInsights(
    objectId: string,
    level: 'account' | 'campaign' | 'ad' | 'adset' = 'campaign',
    options?: { datePreset?: string; timeRange?: { since: string; until: string }; timeIncrement?: number },
  ): Promise<MetaInsights[]> {
    const params: Record<string, string> = {
      level,
      fields: MetaApiClient.INSIGHT_FIELDS,
      action_attribution_windows: MetaApiClient.ATTRIBUTION_WINDOWS,
    }
    if (options?.timeRange) params.time_range = JSON.stringify(options.timeRange)
    else params.date_preset = options?.datePreset || 'last_30d'
    if (options?.timeIncrement) params.time_increment = String(options.timeIncrement)

    return this.requestAll<MetaInsights>(`/${objectId}/insights`, params)
  }

  // ── Billing ───────────────────────────────────────────────────────────

  async getBillingInfo(): Promise<MetaBillingInfo[]> {
    return this.requestAll<MetaBillingInfo>(`/act_${this.requireAccount()}/billing_invoices`, {
      fields: 'amount,currency,billing_date,status,invoice_url',
    })
  }

  async getAccountBalance(): Promise<{
    balance: string
    spendCap: string
    amountSpent: string
    currency: string
  }> {
    const data = await this.request<{
      balance: string
      spend_cap: string
      amount_spent: string
      currency: string
    }>(`/act_${this.requireAccount()}`, {}, { fields: 'balance,spend_cap,amount_spent,currency' })
    return {
      balance: data.balance,
      spendCap: data.spend_cap,
      amountSpent: data.amount_spent,
      currency: data.currency,
    }
  }
}

/**
 * Meta budgets are in the currency's minor unit (paise for INR, cents for
 * USD). Zero-decimal currencies are the exception and must NOT be multiplied.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK'])

export function toMinorUnits(amount: number, currency = 'INR'): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return Math.round(amount)
  return Math.round(amount * 100)
}

export function fromMinorUnits(amount: number | string | null | undefined, currency = 'INR'): number {
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount ?? 0))
  if (!Number.isFinite(n)) return 0
  if (ZERO_DECIMAL_CURRENCIES.has(currency)) return n
  return n / 100
}

export function createMetaClient(config: MetaConnectionConfig): MetaApiClient {
  return new MetaApiClient(config)
}
