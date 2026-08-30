import { executeLocalTool, type LocalToolContext } from './local'
import { logAction } from '@/lib/ai/audit'
import { needsApproval, classifyRisk, requiresApprovalAlways } from '@/lib/ai/guardrails'
import { checkBudget } from '@/lib/ai/budget-guard'
import { getStrategy } from '@/lib/ai/strategy'
import { db } from '@/lib/db/supabase-db'
import {
  metaListCampaigns, metaListCreatives, metaListAdSets, metaListAds,
  metaListPages, metaListPixels, metaGetInsights, metaComparePerformance,
  metaValidateToken, metaCreateAdCreative, metaGetAccountBalance,
  metaCreateCampaign, metaCreateAdSet, metaCreateAd,
  metaUpdateCampaignBudget, metaUpdateAdSetBudget,
  metaPauseCampaign, metaResumeCampaign, metaSetAdSetStatus, metaSetAdStatus,
  metaSearchTargeting, metaEstimateReach,
  metaListAudiences, metaCreateCustomAudience, metaCreateLookalikeAudience, metaPreviewAd,
} from '@/lib/meta/ops'
import { getMetaConnection } from '@/lib/meta/user-client'
import type { MetaTargeting, OptimizationGoal, BillingEvent, SpecialAdCategory } from '@/lib/meta/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ToolExecutionContext {
  userId: string
  conversationId?: string
  local: LocalToolContext
  actor?: 'agent' | 'autonomous'
  /** When true (autonomous + autoOptimize), approval tools execute directly. */
  autoApproved?: boolean
}

/** How long a queued approval stays executable before it is considered stale. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

const META_OP_TOOLS = new Set([
  'list_campaigns', 'list_creatives', 'list_ad_sets', 'list_ads', 'list_pages', 'list_pixels',
  'get_insights', 'compare_performance', 'validate_token', 'get_account_balance',
  'test_meta_connection', 'search_targeting', 'estimate_audience_size',
  'create_campaign', 'create_ad_set', 'create_ad', 'create_ad_creative',
  'update_campaign_budget', 'update_ad_set_budget',
  'pause_campaign', 'resume_campaign', 'set_ad_set_status', 'set_ad_status',
  'list_audiences', 'create_custom_audience', 'create_lookalike_audience', 'preview_ad',
])

const LOCAL_TOOL_NAMES = new Set([
  'ask_user_question',
  'get_local_campaigns', 'get_local_creatives', 'get_local_campaign',
  'create_local_campaign', 'update_local_campaign', 'delete_local_campaign',
  'create_local_creative', 'update_local_creative', 'delete_local_creative',
  'generate_ad_image', 'generate_creative_with_image', 'review_creative', 'improve_creative',
  'get_dashboard_summary', 'search_knowledge_base',
  'get_strategy', 'update_strategy', 'get_memory', 'add_memory',
  'sync_campaign_insights', 'sync_from_meta', 'publish_campaign_to_meta', 'publish_full_campaign',
  'set_campaign_status',
  'get_daily_metrics', 'get_performance_trend',
  'list_scheduled_jobs', 'create_scheduled_job', 'update_scheduled_job', 'delete_scheduled_job',
  'generate_chart', 'generate_report', 'transcribe_audio', 'speak',
  'search_memory', 'reflect_and_learn',
])

/**
 * Master tool dispatcher.
 *
 * Order matters: budget is checked BEFORE approval queuing, so an action that
 * breaches the client's caps is rejected outright rather than queued as
 * something they could accidentally approve.
 */
export async function executeTool(
  ctx: ToolExecutionContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { userId, conversationId, local } = ctx

  let autoOptimize = false
  try {
    autoOptimize = Boolean((await getStrategy(userId)).autoOptimize)
  } catch {
    // Unreadable strategy means we cannot prove auto-optimize is on, so we
    // leave it off — the safe direction.
  }

  // ── 1. Budget enforcement (hard, in code) ────────────────────────────
  const budget = await checkBudget(userId, tool, args)
  if (!budget.allowed) {
    await logAction({ userId, conversationId, toolName: tool, arguments: args, status: 'error', actor: ctx.actor,
      result: { blocked: 'budget', reason: budget.reason } as any })
    return {
      blocked: true,
      reason: 'budget_guardrail',
      message: budget.reason,
      spentToday: budget.spentToday,
      spentThisMonth: budget.spentThisMonth,
      dailyCap: budget.dailyCap,
      monthlyCap: budget.monthlyCap,
    }
  }

  // ── 2. Approval gate (fails closed) ──────────────────────────────────
  const mustAlwaysApprove = requiresApprovalAlways(tool)
  const allowExecute = mustAlwaysApprove
    ? false
    : ctx.autoApproved || !needsApproval(tool, autoOptimize)

  if (!allowExecute) {
    const risk = classifyRisk(tool)
    const summary = buildApprovalSummary(tool, args)
    let approvalId: string | null = null
    try {
      const row = (await db.pendingApproval.create({
        data: {
          userId,
          conversationId: conversationId || null,
          toolName: tool,
          arguments: JSON.stringify(args),
          summary,
          risk,
          status: 'pending',
          expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
        },
      })) as any
      approvalId = row?.id || null
    } catch (err) {
      console.error('[tools] failed to queue approval:', err)
    }

    await logAction({ userId, conversationId, toolName: tool, arguments: args, status: 'pending', actor: ctx.actor })

    return {
      needsApproval: true,
      approvalId,
      tool,
      risk,
      summary,
      expiresInHours: 24,
      message:
        `This action changes live ad spend on Meta, so I have queued it for your approval` +
        `${approvalId ? ` (approval #${approvalId})` : ''}. Review and approve it in AI Manager → Approvals and I will run it immediately. ` +
        `It expires in 24 hours. To let me act without approval, enable auto-optimize in your strategy.`,
    }
  }

  // ── 3. Execute ───────────────────────────────────────────────────────
  let result: unknown
  let status = 'success'
  try {
    if (LOCAL_TOOL_NAMES.has(tool)) {
      result = await executeLocalTool(tool, args, local)
    } else if (META_OP_TOOLS.has(tool)) {
      result = await executeMetaOp(tool, args, userId)
    } else {
      result = {
        error:
          `Unknown tool "${tool}". It is not available on this platform. ` +
          `Use one of the documented tools instead.`,
      }
      status = 'error'
    }
    if (result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)) status = 'error'
  } catch (err) {
    status = 'error'
    result = { error: err instanceof Error ? err.message : 'Tool execution failed' }
  }

  await logAction({ userId, conversationId, toolName: tool, arguments: args, result: result as any, status, actor: ctx.actor })
  return result
}

function asNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

async function executeMetaOp(tool: string, args: Record<string, unknown>, userId: string): Promise<unknown> {
  switch (tool) {
    // ── Reads ──────────────────────────────────────────────────────────
    case 'list_campaigns':
      return metaListCampaigns(userId)
    case 'list_ad_sets':
      return metaListAdSets(userId, args.campaign_id as string | undefined)
    case 'list_ads':
      return metaListAds(userId, args.adset_id as string | undefined)
    case 'list_creatives':
      return metaListCreatives(userId)
    case 'list_pages':
      return metaListPages(userId)
    case 'list_pixels':
      return metaListPixels(userId)
    case 'list_audiences':
      return metaListAudiences(userId)
    case 'get_insights':
      return metaGetInsights(userId, {
        objectId: args.object_id as string | undefined,
        level: args.level as any,
        datePreset: args.date_preset as string | undefined,
        timeIncrement: asNumber(args.time_increment),
        objective: args.objective as string | undefined,
      })
    case 'compare_performance':
      return metaComparePerformance(
        userId,
        (args.object_ids as string[]) || [],
        (args.level as any) || 'campaign',
        (args.date_preset as string) || 'last_30d',
      )
    case 'validate_token':
      return metaValidateToken(userId)
    case 'get_account_balance':
      return metaGetAccountBalance(userId)
    case 'search_targeting':
      return metaSearchTargeting(userId, {
        query: args.query as string,
        kind: (args.kind as 'geo' | 'interest' | 'locale') || 'geo',
      })
    case 'estimate_audience_size':
      return metaEstimateReach(userId, {
        targeting: args.targeting as MetaTargeting,
        optimizationGoal: args.optimization_goal as string | undefined,
      })
    case 'preview_ad':
      return metaPreviewAd(userId, args.ad_id as string, args.ad_format as string | undefined)

    // ── Writes ─────────────────────────────────────────────────────────
    case 'create_campaign':
      return metaCreateCampaign(userId, {
        name: args.name as string,
        objective: args.objective as string,
        status: (args.status as string) || 'PAUSED',
        dailyBudget: asNumber(args.daily_budget),
        lifetimeBudget: asNumber(args.lifetime_budget),
        startTime: args.start_time as string | undefined,
        endTime: args.end_time as string | undefined,
        specialAdCategories: args.special_ad_categories as SpecialAdCategory[] | undefined,
      })

    case 'create_ad_set':
      if (!args.campaign_id) return { error: 'campaign_id is required to create an ad set.' }
      if (!args.targeting) return { error: 'targeting is required. Use search_targeting to resolve geo/interest IDs first.' }
      return metaCreateAdSet(userId, {
        name: args.name as string,
        campaignId: args.campaign_id as string,
        optimizationGoal: (args.optimization_goal as OptimizationGoal) || 'LINK_CLICKS',
        billingEvent: (args.billing_event as BillingEvent) || 'IMPRESSIONS',
        targeting: args.targeting as MetaTargeting,
        dailyBudget: asNumber(args.daily_budget),
        lifetimeBudget: asNumber(args.lifetime_budget),
        startTime: args.start_time as string | undefined,
        endTime: args.end_time as string | undefined,
        status: (args.status as string) || 'PAUSED',
        promotedObject: args.promoted_object as any,
      })

    case 'create_ad':
      if (!args.adset_id || !args.creative_id) {
        return { error: 'Both adset_id and creative_id are required to create an ad.' }
      }
      return metaCreateAd(userId, {
        name: args.name as string,
        adsetId: args.adset_id as string,
        creativeId: args.creative_id as string,
        status: (args.status as string) || 'PAUSED',
      })

    case 'create_ad_creative':
      if (!args.link_url) {
        return { error: 'link_url is required — an ad must point at a real landing page.' }
      }
      return metaCreateAdCreative(userId, {
        name: args.name as string,
        title: args.title as string,
        body: args.body as string,
        description: args.description as string | undefined,
        imageUrl: args.image_url as string | undefined,
        link: args.link_url as string,
        callToAction: (args.call_to_action as string) || 'LEARN_MORE',
        pageId: args.page_id as string | undefined,
      })

    case 'update_campaign_budget':
      return metaUpdateCampaignBudget(userId, {
        campaignId: args.campaign_id as string,
        dailyBudget: asNumber(args.daily_budget),
        lifetimeBudget: asNumber(args.lifetime_budget),
      })

    case 'update_ad_set_budget':
      return metaUpdateAdSetBudget(userId, {
        adsetId: args.adset_id as string,
        dailyBudget: asNumber(args.daily_budget),
        lifetimeBudget: asNumber(args.lifetime_budget),
      })

    case 'pause_campaign':
      return metaPauseCampaign(userId, args.campaign_id as string)
    case 'resume_campaign':
      return metaResumeCampaign(userId, args.campaign_id as string)
    case 'set_ad_set_status':
      return metaSetAdSetStatus(userId, args.adset_id as string, Boolean(args.active))
    case 'set_ad_status':
      return metaSetAdStatus(userId, args.ad_id as string, Boolean(args.active))

    case 'create_custom_audience':
      return metaCreateCustomAudience(userId, {
        name: args.name as string,
        description: args.description as string | undefined,
        subtype: args.subtype as string | undefined,
        retentionDays: asNumber(args.retention_days),
        rule: args.rule,
      })
    case 'create_lookalike_audience':
      return metaCreateLookalikeAudience(userId, {
        name: args.name as string,
        originAudienceId: args.origin_audience_id as string,
        country: args.country as string | undefined,
        ratio: asNumber(args.ratio),
      })

    case 'test_meta_connection': {
      const tokenInfo = (await metaValidateToken(userId)) as any
      const conn = await getMetaConnection(userId)
      let accountReachable = false
      let campaignCount = 0
      let deliverableCount = 0
      let accountError: string | undefined

      try {
        const camps = (await metaListCampaigns(userId)) as any
        if (camps?.error) {
          accountError = camps.error
        } else {
          campaignCount = camps.total ?? 0
          accountReachable = true
          // A campaign with no ad set cannot deliver. Surfacing this is the
          // difference between "connected" and "actually able to run ads".
          const adSets = (await metaListAdSets(userId)) as any
          if (!adSets?.error) {
            const campaignsWithAdSets = new Set((adSets.adSets || []).map((a: any) => a.campaignId))
            deliverableCount = campaignsWithAdSets.size
          }
        }
      } catch (err) {
        accountError = err instanceof Error ? err.message : 'Account not reachable'
      }

      const adAccountId = conn?.adAccountId ? `act_${conn.adAccountId}` : null
      const healthy = Boolean(tokenInfo.valid) && accountReachable
      const notes: string[] = []
      if (tokenInfo.warning) notes.push(tokenInfo.warning)
      if (healthy && campaignCount > deliverableCount) {
        notes.push(`${campaignCount - deliverableCount} campaign(s) have no ad set and cannot deliver.`)
      }

      return {
        token: tokenInfo,
        adAccountId,
        adAccountName: conn?.adAccountName || null,
        accountReachable,
        campaignCount,
        campaignsWithAdSets: deliverableCount,
        accountError,
        healthy,
        notes,
        summary: healthy
          ? `Meta connection is healthy. Token valid, ad account "${conn?.adAccountName || adAccountId}" reachable with ${campaignCount} campaign(s), ${deliverableCount} able to deliver.${notes.length ? ' ' + notes.join(' ') : ''}`
          : `Meta connection issue: ${!tokenInfo.valid ? 'access token is invalid or expired' : accountError || 'ad account not reachable'}.`,
      }
    }

    default:
      return { error: `Unknown Meta tool: ${tool}` }
  }
}

function buildApprovalSummary(tool: string, args: Record<string, unknown>): string {
  const a = args as any
  switch (tool) {
    case 'create_campaign':
      return `Create Meta campaign "${a.name}" (objective ${a.objective})${a.daily_budget ? ` with a ₹${a.daily_budget}/day budget` : a.lifetime_budget ? ` with a ₹${a.lifetime_budget} lifetime budget` : ''}.`
    case 'create_ad_set':
      return `Create ad set "${a.name}" under campaign ${a.campaign_id}${a.daily_budget ? ` at ₹${a.daily_budget}/day` : ''}, optimizing for ${a.optimization_goal || 'LINK_CLICKS'}.`
    case 'create_ad':
      return `Create ad "${a.name}" in ad set ${a.adset_id}.`
    case 'update_campaign_budget':
      return `Change campaign ${a.campaign_id} budget to ${a.daily_budget ? `₹${a.daily_budget}/day` : `₹${a.lifetime_budget} lifetime`}.`
    case 'update_ad_set_budget':
      return `Change ad set ${a.adset_id} budget to ${a.daily_budget ? `₹${a.daily_budget}/day` : `₹${a.lifetime_budget} lifetime`}.`
    case 'pause_campaign':
      return `Pause Meta campaign ${a.campaign_id} — it will stop spending.`
    case 'resume_campaign':
      return `Resume Meta campaign ${a.campaign_id} and its ad sets — it will start spending.`
    case 'set_ad_set_status':
      return `${a.active ? 'Resume' : 'Pause'} ad set ${a.adset_id}.`
    case 'set_ad_status':
      return `${a.active ? 'Resume' : 'Pause'} ad ${a.ad_id}.`
    case 'create_ad_creative':
      return `Create Meta ad creative "${a.name}" linking to ${a.link_url}.`
    case 'publish_campaign_to_meta':
    case 'publish_full_campaign':
      return `Publish campaign ${a.campaignId || a.campaign_id} to Meta as campaign → ad set → ad${a.activate ? ' and START it spending immediately' : ' (paused)'}.`
    case 'set_campaign_status':
      return `${a.active ? 'Resume' : 'Pause'} campaign ${a.campaignId} on Meta.`
    case 'update_strategy':
      return `Change your account strategy/guardrails: ${JSON.stringify(args).slice(0, 200)}.`
    case 'delete_local_campaign':
      return `Delete local campaign ${a.campaignId}.`
    case 'delete_local_creative':
      return `Delete local creative ${a.creativeId}.`
    case 'create_custom_audience':
      return `Create custom audience "${a.name}".`
    case 'create_lookalike_audience':
      return `Create lookalike audience "${a.name}".`
    default:
      return `Execute ${tool} with ${JSON.stringify(args).slice(0, 200)}.`
  }
}
