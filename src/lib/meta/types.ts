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
