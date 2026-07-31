import { executeLocalTool, type LocalToolContext } from './local'
import { logAction } from '@/lib/ai/audit'
import { needsApproval, classifyRisk } from '@/lib/ai/guardrails'
import { getStrategy } from '@/lib/ai/strategy'
import { db } from '@/lib/db/supabase-db'
import {
  metaListCampaigns, metaListCreatives, metaGetInsights, metaComparePerformance,
  metaValidateToken, metaCreateAdCreative, metaGetAccountBalance,
  metaCreateCampaign, metaPauseCampaign, metaResumeCampaign,
} from '@/lib/meta/ops'
import { getMCPClient } from '@/lib/meta/mcp-client'
import { getMetaConnection } from '@/lib/meta/user-client'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ToolExecutionContext {
  userId: string
  conversationId?: string
  local: LocalToolContext
  actor?: 'agent' | 'autonomous'
  /** When true (autonomous + autoOptimize), even approval tools execute. */
  autoApproved?: boolean
}

const META_OP_TOOLS = new Set([
  'list_campaigns', 'list_creatives', 'get_insights', 'compare_performance',
  'validate_token', 'create_ad_creative', 'get_account_balance',
  'create_campaign', 'pause_campaign', 'resume_campaign', 'test_meta_connection',
])

const LOCAL_TOOL_NAMES = new Set([
  'ask_user_question',
  'get_local_campaigns', 'get_local_creatives', 'get_local_campaign',
  'create_local_campaign', 'update_local_campaign', 'delete_local_campaign',
  'create_local_creative', 'update_local_creative', 'delete_local_creative',
  'generate_ad_image', 'generate_creative_with_image', 'review_creative', 'improve_creative',
  'get_dashboard_summary', 'search_knowledge_base',
  'get_strategy', 'update_strategy', 'get_memory', 'add_memory',
  'sync_campaign_insights', 'sync_from_meta', 'publish_campaign_to_meta', 'set_campaign_status',
  'get_daily_metrics', 'get_performance_trend',
  'list_scheduled_jobs', 'create_scheduled_job', 'update_scheduled_job', 'delete_scheduled_job',
  'generate_chart', 'generate_report', 'transcribe_audio', 'speak',
  'search_memory', 'reflect_and_learn',
])

/**
 * Master tool dispatcher. Enforces guardrails, audits every action, and routes
 * between local DB, stateless Meta Graph ops, and the MCP subprocess fallback.
 */
export async function executeTool(ctx: ToolExecutionContext, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const { userId, conversationId, local } = ctx

  // Resolve strategy for guardrails
  let autoOptimize = false
  try {
    const strategy = await getStrategy(userId)
    autoOptimize = Boolean(strategy.autoOptimize)
  } catch {}

  const allowExecute = ctx.autoApproved || !needsApproval(tool, autoOptimize)

  if (!allowExecute) {
    // Create a pending approval instead of executing the spend-affecting action.
    const risk = classifyRisk(tool)
    const summary = buildApprovalSummary(tool, args)
    let approvalId: string | null = null
    try {
      const row = await db.pendingApproval.create({
        data: {
          userId,
          conversationId: conversationId || null,
          toolName: tool,
          arguments: JSON.stringify(args),
          summary,
          risk,
          status: 'pending',
        },
      }) as any
      approvalId = row?.id || null
    } catch {}

    await logAction({ userId, conversationId, toolName: tool, arguments: args, status: 'pending', actor: ctx.actor })

    return {
      needsApproval: true,
      approvalId,
      tool,
      risk,
      summary,
      message: `This action changes live ad spend on Meta. I've prepared it for your approval${approvalId ? ` (approval #${approvalId})` : ''}. Review and approve it in the AI Manager → Approvals panel, then I'll execute it immediately. To let me act without approval, enable "auto-optimize" in your strategy.`,
    }
  }

  // Execute
  let result: unknown
  let status = 'success'
  try {
    if (LOCAL_TOOL_NAMES.has(tool)) {
      result = await executeLocalTool(tool, args, local)
    } else if (META_OP_TOOLS.has(tool)) {
      result = await executeMetaOp(tool, args, userId)
    } else {
      // Fallback: MCP subprocess (server runtime only) for tools like audiences/preview.
      result = await executeViaMcp(tool, args, userId)
    }
    if (result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)) {
      status = 'error'
    }
  } catch (e) {
    status = 'error'
    result = { error: e instanceof Error ? e.message : 'Tool execution failed' }
  }

  await logAction({ userId, conversationId, toolName: tool, arguments: args, result: result as any, status, actor: ctx.actor })
  return result
}

async function executeMetaOp(tool: string, args: Record<string, unknown>, userId: string): Promise<unknown> {
  switch (tool) {
    case 'list_campaigns': return await metaListCampaigns(userId)
    case 'list_creatives': return await metaListCreatives(userId)
    case 'get_insights':
      return await metaGetInsights(userId, {
        objectId: args.object_id as string | undefined,
        level: args.level as any,
        datePreset: args.date_preset as string | undefined,
        timeIncrement: args.time_increment as number | undefined,
      })
    case 'compare_performance':
      return await metaComparePerformance(userId, args.object_ids as string[], (args.level as any) || 'campaign', (args.date_preset as string) || 'last_30d')
    case 'validate_token': return await metaValidateToken(userId)
    case 'create_ad_creative':
      return await metaCreateAdCreative(userId, {
        name: args.name as string, title: args.title as string, body: args.body as string,
        imageUrl: args.image_url as string | undefined, link: (args.link_url as string) || 'https://facebook.com',
        callToAction: args.call_to_action as string,
      })
    case 'get_account_balance': return await metaGetAccountBalance(userId)
    case 'create_campaign':
      return await metaCreateCampaign(userId, {
        name: args.name as string, objective: args.objective as string,
        status: (args.status as string) || 'PAUSED',
        dailyBudget: args.daily_budget as number | undefined,
        lifetimeBudget: args.lifetime_budget as number | undefined,
      })
    case 'pause_campaign': return await metaPauseCampaign(userId, args.campaign_id as string)
    case 'resume_campaign': return await metaResumeCampaign(userId, args.campaign_id as string)
    case 'test_meta_connection': {
      const tokenInfo = await metaValidateToken(userId)
      const conn = await getMetaConnection(userId)
      let accountReachable = false
      let campaignCount = 0
      let accountError: string | undefined
      try {
        const camps = await metaListCampaigns(userId)
        if (camps && 'error' in camps && camps.error) {
          accountError = camps.error
        } else {
          campaignCount = (camps as { total?: number }).total ?? 0
          accountReachable = true
        }
      } catch (e) {
        accountError = e instanceof Error ? e.message : 'Account not reachable'
      }
      const adAccountId = conn?.adAccountId ? `act_${conn.adAccountId}` : null
      const healthy = Boolean(tokenInfo.valid) && accountReachable
      return {
        token: tokenInfo,
        adAccountId,
        adAccountName: conn?.adAccountName || null,
        accountReachable,
        campaignCount,
        accountError,
        healthy,
        summary: healthy
          ? `Meta connection is healthy. Token is valid, ad account "${conn?.adAccountName || adAccountId}" is reachable with ${campaignCount} campaign(s).`
          : `Meta connection issue: ${!tokenInfo.valid ? 'access token is invalid or expired' : accountError || 'ad account not reachable'}.`,
      }
    }
    default: return { error: `Unknown Meta tool: ${tool}` }
  }
}

async function executeViaMcp(tool: string, args: Record<string, unknown>, userId: string): Promise<unknown> {
  try {
    const mcp = await getMCPClient(userId)
    const mcpArgs = { ...args }
    const conn = await getMetaConnection(userId)
    if (conn?.adAccountId && !mcpArgs.account_id) mcpArgs.account_id = `act_${conn.adAccountId}`
    return await mcp.callTool(tool, mcpArgs)
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : 'MCP tool unavailable (requires a long-lived server runtime; not available on serverless). Use the equivalent local/stateless tool instead.',
    }
  }
}

function buildApprovalSummary(tool: string, args: Record<string, unknown>): string {
  const a = args as any
  switch (tool) {
    case 'create_campaign': return `Create Meta campaign "${a.name}" (objective ${a.objective})${a.daily_budget ? ` with daily budget ${a.daily_budget}` : a.lifetime_budget ? ` with lifetime budget ${a.lifetime_budget}` : ''}.`
    case 'pause_campaign': return `Pause Meta campaign ${a.campaign_id}.`
    case 'resume_campaign': return `Resume Meta campaign ${a.campaign_id}.`
    case 'create_ad_creative': return `Create a new Meta ad creative "${a.name}".`
    case 'publish_campaign_to_meta': return `Publish local campaign ${a.campaignId} to Meta (goes live).`
    case 'set_campaign_status': return `${a.active ? 'Resume' : 'Pause'} campaign ${a.campaignId} on Meta.`
    case 'delete_local_campaign': return `Delete local campaign ${a.campaignId}.`
    case 'delete_local_creative': return `Delete local creative ${a.creativeId}.`
    case 'create_custom_audience': return `Create custom audience "${a.name}".`
    case 'create_lookalike_audience': return `Create lookalike audience "${a.name}".`
    default: return `Execute ${tool} with ${JSON.stringify(args).slice(0, 200)}.`
  }
}
