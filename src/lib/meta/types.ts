export interface MetaAdAccount {
  id: string
  name: string
  account_id: string
  account_status: number
  currency: string
  timezone_name: string
  spend_cap: string
  amount_spent: string
  balance: string
  min_daily_budget: number
}

export interface MetaCampaign {
  id: string
  name: string
  objective: string
  status: string
  daily_budget: string
  lifetime_budget: string
  start_time: string
  stop_time: string
  buying_type: string
  configured_status: string
  effective_status: string
}

export interface MetaAdCreative {
  id: string
  name: string
  status: string
  body: string
  title: string
  image_url: string
  thumbnail_url: string
  call_to_action_type: string
  link: string
}

export interface MetaInsights {
  campaign_id?: string
  adset_id?: string
  ad_id?: string
  date_start?: string
  date_stop?: string
  impressions: string
  clicks: string
  spend: string
  reach: string
  frequency: string
  cpc: string
  cpm: string
  ctr: string
  conversions: string
  cost_per_conversion: string
  actions: MetaAction[]
}

export interface MetaAction {
  action_type: string
  value: string
}

export interface MetaBillingInfo {
  amount: string
  currency: string
  billing_date: string
  status: string
  invoice_url: string
}

export interface MetaConnectionConfig {
  appId: string
  appSecret: string
  accessToken: string
  adAccountId?: string
}

export interface AdCreativeData {
  title: string
  description: string
  primaryText: string
  headline: string
  callToAction: string
  targeting: string
  expectedSpend: number
  expectedRoas: number
  language: string
  audience: string
  imageUrl?: string
  actualSpend?: number
  actualRoas?: number
  reviewStatus?: string
}

export type CampaignObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_APP_PROMOTION'
  | 'OUTCOME_SALES'

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' | 'DRAFT'

export type AdCreativeStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'published'

export type ReviewStatus = 'pending' | 'verified' | 'not_verified'

// ── Ad Set / Ad layer ────────────────────────────────────────────────────
// Meta's delivery hierarchy is Campaign → Ad Set → Ad. A campaign alone
// never delivers: the ad set carries targeting/budget/optimization and the
// ad binds a creative to that ad set.

export interface MetaAdSet {
  id: string
  name: string
  campaign_id: string
  status: string
  configured_status?: string
  effective_status?: string
  daily_budget?: string
  lifetime_budget?: string
  billing_event?: string
  optimization_goal?: string
  bid_strategy?: string
  bid_amount?: string
  start_time?: string
  end_time?: string
  targeting?: MetaTargeting
  promoted_object?: Record<string, unknown>
}

export interface MetaAd {
  id: string
  name: string
  adset_id: string
  campaign_id?: string
  status: string
  configured_status?: string
  effective_status?: string
  creative?: { id: string }
}

/** Meta targeting spec. Geo + demo + interests + placements. */
export interface MetaTargeting {
  geo_locations?: {
    countries?: string[]
    regions?: Array<{ key: string }>
    cities?: Array<{ key: string; radius?: number; distance_unit?: 'mile' | 'kilometer' }>
  }
  age_min?: number
  age_max?: number
  genders?: number[]
  locales?: number[]
  interests?: Array<{ id: string; name?: string }>
  behaviors?: Array<{ id: string; name?: string }>
  flexible_spec?: Array<Record<string, unknown>>
  publisher_platforms?: string[]
  facebook_positions?: string[]
  instagram_positions?: string[]
  device_platforms?: string[]
  custom_audiences?: Array<{ id: string }>
  excluded_custom_audiences?: Array<{ id: string }>
  targeting_automation?: { advantage_audience?: 0 | 1 }
}

export type OptimizationGoal =
  | 'OFFSITE_CONVERSIONS' | 'LINK_CLICKS' | 'LANDING_PAGE_VIEWS' | 'IMPRESSIONS'
  | 'REACH' | 'POST_ENGAGEMENT' | 'LEAD_GENERATION' | 'THRUPLAY' | 'VALUE'

export type BillingEvent = 'IMPRESSIONS' | 'LINK_CLICKS' | 'THRUPLAY'

export type BidStrategy =
  | 'LOWEST_COST_WITHOUT_CAP' | 'LOWEST_COST_WITH_BID_CAP'
  | 'COST_CAP' | 'LOWEST_COST_WITH_MIN_ROAS'

/** Meta special ad categories. Wrong/missing values get accounts restricted. */
export type SpecialAdCategory =
  | 'NONE' | 'EMPLOYMENT' | 'HOUSING' | 'CREDIT' | 'ISSUES_ELECTIONS_POLITICS' | 'ONLINE_GAMBLING_AND_GAMING'

export interface AdSetCreateParams {
  name: string
  campaignId: string
  optimizationGoal: OptimizationGoal
  billingEvent: BillingEvent
  targeting: MetaTargeting
  dailyBudget?: number
  lifetimeBudget?: number
  bidStrategy?: BidStrategy
  bidAmount?: number
  startTime?: string
  endTime?: string
  status?: string
  /** Pixel + conversion event, required for OFFSITE_CONVERSIONS. */
  promotedObject?: { pixel_id?: string; custom_event_type?: string; page_id?: string; application_id?: string }
  /** Meta requires this on every ad set in a special-ad-category campaign. */
  destinationType?: string
}

export interface AdCreateParams {
  name: string
  adsetId: string
  creativeId: string
  status?: string
  trackingSpecs?: Array<Record<string, unknown>>
}
