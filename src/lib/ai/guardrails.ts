// Guardrails: spend-affecting Meta actions require user approval unless the
// account strategy has autoOptimize enabled. Read-only and local-DB actions
// always execute immediately.

// Read-only / local tools that are safe to run without approval.
export const SAFE_TOOLS = new Set([
  'get_local_campaigns', 'get_local_creatives', 'get_local_campaign',
  'get_dashboard_summary', 'search_knowledge_base',
  'get_strategy', 'get_memory',
  'get_daily_metrics', 'get_performance_trend', 'get_account_balance',
  'test_meta_connection',
  'generate_chart', 'generate_report',
  'transcribe_audio',
  // Local CRUD (drafts, not live spend) are safe
  'create_local_campaign', 'update_local_campaign', 'create_local_creative', 'update_local_creative',
  'review_creative', 'improve_creative', 'generate_ad_image', 'generate_creative_with_image',
  'sync_campaign_insights', 'sync_from_meta',  // read-only pulls
])

// Spend-affecting Meta actions that change live ad state.
export const APPROVAL_TOOLS = new Set([
  'create_campaign', 'pause_campaign', 'resume_campaign',
  'create_ad_creative', 'create_custom_audience', 'create_lookalike_audience',
  'publish_campaign_to_meta', 'set_campaign_status',
  'delete_local_campaign', 'delete_local_creative',
])

export type RiskLevel = 'low' | 'medium' | 'high'

export function classifyRisk(tool: string): RiskLevel {
  if (tool === 'pause_campaign' || tool === 'resume_campaign' || tool === 'set_campaign_status') return 'high'
  if (tool === 'create_campaign' || tool === 'create_ad_creative' || tool === 'publish_campaign_to_meta') return 'medium'
  if (tool === 'delete_local_campaign' || tool === 'delete_local_creative') return 'high'
  return 'medium'
}

export function needsApproval(tool: string, autoOptimize: boolean): boolean {
  if (SAFE_TOOLS.has(tool)) return false
  if (APPROVAL_TOOLS.has(tool)) return !autoOptimize
  // Unknown tool: default to no approval (it will just be attempted)
  return false
}
