import type {
  MetaAdAccount,
  MetaCampaign,
  MetaAdCreative,
  MetaInsights,
  MetaBillingInfo,
  MetaConnectionConfig,
} from './types'

const GRAPH_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

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

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    params: Record<string, string> = {}
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${endpoint}`)
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
    url.searchParams.append('access_token', this.accessToken)

    const response = await fetch(url.toString(), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(
        data.error?.message || `Meta API error: ${response.status} ${response.statusText}`
      )
    }

    return data as T
  }

  async verifyToken(): Promise<{ valid: boolean; userId?: string; expiresIn?: number }> {
    try {
      const data = await this.makeRequest<{ data: { user_id: string; expires_at: number }[] }>(
        '/debug_token',
        {},
        {
          input_token: this.accessToken,
          access_token: `${this.appId}|${this.appSecret}`,
        }
      )
      return {
        valid: true,
        userId: data.data[0]?.user_id,
        expiresIn: data.data[0]?.expires_at,
      }
    } catch {
      return { valid: false }
    }
  }

  async getAdAccounts(): Promise<MetaAdAccount[]> {
    const data = await this.makeRequest<{ data: MetaAdAccount[] }>('/me/adaccounts', {}, {
      fields: 'id,name,account_id,account_status,currency,timezone_name,spend_cap,amount_spent,balance,min_daily_budget',
    })
    return data.data
  }

  async setAdAccountId(accountId: string) {
    this.adAccountId = accountId
  }

  async getCampaigns(): Promise<MetaCampaign[]> {
    if (!this.adAccountId) throw new Error('Ad account ID not set')
    const data = await this.makeRequest<{ data: MetaCampaign[] }>(
      `/act_${this.adAccountId}/campaigns`,
      {},
      {
        fields: 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,buying_type,configured_status,effective_status',
      }
    )
    return data.data
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
  }): Promise<{ id: string }> {
    if (!this.adAccountId) throw new Error('Ad account ID not set')
    const body = {
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status,
      daily_budget: campaign.dailyBudget ? Math.round(campaign.dailyBudget * 100) : undefined,
      lifetime_budget: campaign.lifetimeBudget ? Math.round(campaign.lifetimeBudget * 100) : undefined,
      start_time: campaign.startTime,
      stop_time: campaign.endTime,
      buying_type: campaign.buyingType || 'AUCTION',
      special_ad_categories: '[]',
    }

    const data = await this.makeRequest<{ id: string }>(
      `/act_${this.adAccountId}/campaigns`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    )
    return data
  }

  async updateCampaign(campaignId: string, updates: Record<string, unknown>): Promise<{ success: boolean }> {
    const data = await this.makeRequest<{ success: boolean }>(`/${campaignId}`, {
      method: 'POST',
      body: JSON.stringify(updates),
    })
    return data
  }

  async deleteCampaign(campaignId: string): Promise<{ success: boolean }> {
    const data = await this.makeRequest<{ success: boolean }>(`/${campaignId}`, {
      method: 'DELETE',
    })
    return data
  }

  async getAdCreatives(): Promise<MetaAdCreative[]> {
    if (!this.adAccountId) throw new Error('Ad account ID not set')
    const data = await this.makeRequest<{ data: MetaAdCreative[] }>(
      `/act_${this.adAccountId}/adcreatives`,
      {},
      {
        fields: 'id,name,status,body,title,image_url,thumbnail_url,call_to_action_type,link',
      }
    )
    return data.data
  }

  async createAdCreative(creative: {
    name: string
    body: string
    title: string
    imageUrl?: string
    link: string
    callToAction: string
  }): Promise<{ id: string }> {
    if (!this.adAccountId) throw new Error('Ad account ID not set')
    const body = {
      name: creative.name,
      object_story_spec: {
        link_data: {
          message: creative.body,
          picture: creative.imageUrl,
          link: creative.link,
          name: creative.title,
          call_to_action: {
            type: creative.callToAction,
          },
        },
      },
    }

    const data = await this.makeRequest<{ id: string }>(
      `/act_${this.adAccountId}/adcreatives`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    )
    return data
  }

  async getInsights(
    level: 'campaign' | 'ad' | 'adset' = 'campaign',
    datePreset: string = 'last_30d'
  ): Promise<MetaInsights[]> {
    if (!this.adAccountId) throw new Error('Ad account ID not set')
    const data = await this.makeRequest<{ data: MetaInsights[] }>(
      `/act_${this.adAccountId}/insights`,
      {},
      {
        level,
        date_preset: datePreset,
        fields: 'campaign_id,adset_id,ad_id,date_start,date_stop,impressions,clicks,spend,reach,frequency,cpc,cpm,ctr,conversions,cost_per_conversion,actions',
      }
    )
    return data.data
  }

  async getObjectInsights(
    objectId: string,
    level: 'campaign' | 'ad' | 'adset' = 'campaign',
    options?: { datePreset?: string; timeRange?: { since: string; until: string }; timeIncrement?: number }
  ): Promise<MetaInsights[]> {
    const params: Record<string, string> = {
      level,
      fields: 'campaign_id,adset_id,ad_id,date_start,date_stop,impressions,clicks,spend,reach,frequency,cpc,cpm,ctr,conversions,cost_per_conversion,actions',
    }
    if (options?.timeRange) {
      params.time_range = JSON.stringify(options.timeRange)
    } else {
      params.date_preset = options?.datePreset || 'last_30d'
    }
    if (options?.timeIncrement) params.time_increment = String(options.timeIncrement)
    const data = await this.makeRequest<{ data: MetaInsights[] }>(
      `/${objectId}/insights`,
      {},
      params
    )
    return data.data
  }

  async getCampaignsList(): Promise<MetaCampaign[]> {
    if (!this.adAccountId) throw new Error('Ad account ID not set')
    const data = await this.makeRequest<{ data: MetaCampaign[] }>(
      `/act_${this.adAccountId}/campaigns`,
      {},
      {
        fields: 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,buying_type,configured_status,effective_status',
      }
    )
    return data.data
  }

  async pauseCampaign(campaignId: string): Promise<{ success: boolean }> {
    return this.updateCampaign(campaignId, { status: 'PAUSED' })
  }

  async resumeCampaign(campaignId: string): Promise<{ success: boolean }> {
    return this.updateCampaign(campaignId, { status: 'ACTIVE' })
  }

  async getBillingInfo(): Promise<MetaBillingInfo[]> {
    if (!this.adAccountId) throw new Error('Ad account ID not set')
    const data = await this.makeRequest<{ data: MetaBillingInfo[] }>(
      `/act_${this.adAccountId}/billing_invoices`,
      {},
      {
        fields: 'amount,currency,billing_date,status,invoice_url',
      }
    )
    return data.data
  }

  async getAccountBalance(): Promise<{ balance: string; spendCap: string; amountSpent: string }> {
    if (!this.adAccountId) throw new Error('Ad account ID not set')
    const data = await this.makeRequest<{
      balance: string
      spend_cap: string
      amount_spent: string
    }>(`/act_${this.adAccountId}`, {}, {
      fields: 'balance,spend_cap,amount_spent',
    })
    return {
      balance: data.balance,
      spendCap: data.spend_cap,
      amountSpent: data.amount_spent,
    }
  }
}

export function createMetaClient(config: MetaConnectionConfig): MetaApiClient {
  return new MetaApiClient(config)
}
