import { getSupabaseServer } from '@/lib/supabase/server'
import { db } from '@/lib/db/supabase-db'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ChartSpec {
  chartType: 'line' | 'bar' | 'area' | 'pie' | 'composed'
  data: Array<Record<string, unknown>>
  xKey: string
  yKeys: Array<{ key: string; label: string; color?: string }>
  title: string
  meta?: Record<string, unknown>
}

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

export async function generateChart(params: {
  userId: string
  kind?: 'spend_trend' | 'funnel' | 'roas_by_campaign' | 'performance_compare' | 'custom'
  chartType?: ChartSpec['chartType']
  title?: string
  data?: Array<Record<string, unknown>>
  xKey?: string
  yKeys?: Array<{ key: string; label: string }>
  campaignIds?: string[]
  days?: number
}): Promise<ChartSpec> {
  const kind = params.kind || 'custom'
  const days = params.days || 30

  if (kind === 'spend_trend') {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const supabase = await getSupabaseServer()
    const { data } = await supabase
      .from('daily_metrics')
      .select('date, spend, impressions, clicks, conversions')
      .eq('user_id', params.userId)
      .gte('date', since.toISOString().split('T')[0])
      .order('date', { ascending: true })

    const byDate = new Map<string, { date: string; spend: number; impressions: number; clicks: number; conversions: number }>()
    for (const r of (data || []) as any[]) {
      const agg = byDate.get(r.date) || { date: r.date, spend: 0, impressions: 0, clicks: 0, conversions: 0 }
      agg.spend += num(r.spend)
      agg.impressions += num(r.impressions)
      agg.clicks += num(r.clicks)
      agg.conversions += num(r.conversions)
      byDate.set(r.date, agg)
    }
    return {
      chartType: params.chartType || 'area',
      data: Array.from(byDate.values()),
      xKey: 'date',
      yKeys: [
        { key: 'spend', label: 'Spend (₹)', color: '#f97316' },
        { key: 'clicks', label: 'Clicks', color: '#3b82f6' },
        { key: 'conversions', label: 'Conversions', color: '#22c55e' },
      ],
      title: params.title || `Spend & Performance (last ${days}d)`,
    }
  }

  if (kind === 'funnel') {
    const campaigns = await db.campaign.findMany({ where: { userId: params.userId } }) as any[]
    const impressions = campaigns.reduce((s, c) => s + num(c.totalImpressions), 0)
    const clicks = campaigns.reduce((s, c) => s + num(c.totalClicks), 0)
    const conversions = campaigns.reduce((s, c) => s + num(c.totalConversions), 0)
    const spend = campaigns.reduce((s, c) => s + num(c.totalSpend), 0)
    return {
      chartType: 'funnel' as any,
      data: [
        { stage: 'Impressions', value: impressions },
        { stage: 'Clicks', value: clicks },
        { stage: 'Conversions', value: conversions },
      ],
      xKey: 'stage',
      yKeys: [{ key: 'value', label: 'Count', color: '#8b5cf6' }],
      title: params.title || 'Marketing Funnel',
      meta: { spend, ctr: impressions > 0 ? (clicks / impressions) * 100 : 0, cvr: clicks > 0 ? (conversions / clicks) * 100 : 0 },
    }
  }

  if (kind === 'roas_by_campaign' || kind === 'performance_compare') {
    const where: Record<string, unknown> = { userId: params.userId }
    if (params.campaignIds?.length) where.id = { in: params.campaignIds }
    const campaigns = await db.campaign.findMany({ where }) as any[]
    const data = campaigns.map((c) => ({
      name: c.name,
      spend: num(c.totalSpend),
      conversions: num(c.totalConversions),
      impressions: num(c.totalImpressions),
      clicks: num(c.totalClicks),
      roas: num(c.totalSpend) > 0 ? num(c.totalRevenue) / num(c.totalSpend) : 0,
    }))
    return {
      chartType: params.chartType || 'bar',
      data,
      xKey: 'name',
      yKeys: [
        { key: 'spend', label: 'Spend (₹)', color: '#f97316' },
        { key: 'conversions', label: 'Conversions', color: '#22c55e' },
        { key: 'roas', label: 'ROAS (x)', color: '#8b5cf6' },
      ],
      title: params.title || 'Performance by Campaign',
    }
  }

  // custom
  return {
    chartType: params.chartType || 'line',
    data: params.data || [],
    xKey: params.xKey || 'x',
    yKeys: (params.yKeys || []).map((y) => ({ key: y.key, label: y.label, color: undefined })),
    title: params.title || 'Custom Chart',
  }
}
