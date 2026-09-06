import { getMCPClient } from './mcp-client'
import { getMetaConnection } from './user-client'
import { adaptArgsForMcp } from './mcp-args'

/**
 * MCP first, Graph API second.
 *
 * The platform's Meta operations go through the `meta-ads-mcp` server, spawned
 * per request with THIS user's App ID / secret / token in its environment, so
 * every business talks to Meta with its own credentials. When MCP cannot
 * serve a call — it has no such tool, the process fails to start, the schema
 * rejects our arguments, or it times out — the dispatcher falls through to
 * the direct Graph client, which is the code path that always works and the
 * only one that can create ads at all (MCP exposes `create_ad_set` but no
 * `create_ad`).
 *
 * Set META_MCP_ENABLED=false to bypass MCP entirely (useful when debugging).
 */

/** Our tool name → the MCP server's tool name. Absent = Graph only. */
export const MCP_TOOL_MAP: Record<string, string> = {
  list_campaigns: 'list_campaigns',
  create_campaign: 'create_campaign',
  pause_campaign: 'pause_campaign',
  resume_campaign: 'resume_campaign',
  update_campaign_budget: 'update_campaign',
  list_ad_sets: 'list_ad_sets',
  create_ad_set: 'create_ad_set',
  list_ads: 'list_ads',
  list_creatives: 'list_creatives',
  create_ad_creative: 'create_ad_creative',
  preview_ad: 'preview_ad',
  get_insights: 'get_insights',
  compare_performance: 'compare_performance',
  list_audiences: 'list_audiences',
  create_custom_audience: 'create_custom_audience',
  create_lookalike_audience: 'create_lookalike_audience',
  estimate_audience_size: 'estimate_audience_size',
  validate_token: 'validate_token',
}

/** Tools that exist only in the direct Graph client. */
export const GRAPH_ONLY_TOOLS = new Set([
  'create_ad', 'set_ad_status', 'set_ad_set_status', 'update_ad_set_budget',
  'list_pages', 'list_pixels', 'search_targeting', 'get_account_balance', 'test_meta_connection',
])

const MCP_TIMEOUT_MS = 25_000

export type McpAttempt =
  | { attempted: true; ok: true; result: unknown; via: 'mcp' }
  | { attempted: true; ok: false; error: string; via: 'mcp' }
  | { attempted: false; reason: string }

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

/**
 * Try the operation over MCP. Never throws — every failure is a structured
 * "fall back" signal so the caller can route to Graph.
 */
export async function tryMcp(tool: string, args: Record<string, unknown>, userId: string): Promise<McpAttempt> {
  if (process.env.META_MCP_ENABLED === 'false') return { attempted: false, reason: 'META_MCP_ENABLED=false' }
  const mcpName = MCP_TOOL_MAP[tool]
  if (!mcpName) return { attempted: false, reason: `no MCP equivalent for ${tool}` }

  try {
    const conn = await getMetaConnection(userId)
    if (!conn) return { attempted: false, reason: 'Meta not connected' }

    const mcp = await withTimeout(getMCPClient(userId), 10_000, 'MCP start')
    const result = await withTimeout(mcp.callTool(mcpName, adaptArgsForMcp(tool, args, { adAccountId: conn.adAccountId, currency: conn.adAccountCurrency || 'INR' })), MCP_TIMEOUT_MS, `MCP ${mcpName}`)

    // The MCP server returns its own error envelopes as text; treat those as
    // failures so Graph gets a turn rather than surfacing a string to the agent.
    if (result && typeof result === 'object' && ('error' in (result as Record<string, unknown>))) {
      const err = (result as Record<string, unknown>).error
      return { attempted: true, ok: false, error: typeof err === 'string' ? err : JSON.stringify(err), via: 'mcp' }
    }
    if (typeof result === 'string' && /error|failed|invalid/i.test(result.slice(0, 120))) {
      return { attempted: true, ok: false, error: result.slice(0, 300), via: 'mcp' }
    }
    return { attempted: true, ok: true, result, via: 'mcp' }
  } catch (err) {
    return { attempted: true, ok: false, error: err instanceof Error ? err.message : 'MCP call failed', via: 'mcp' }
  }
}
