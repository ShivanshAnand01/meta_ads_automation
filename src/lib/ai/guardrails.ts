// Guardrails: spend-affecting Meta actions require user approval unless the
// account strategy has autoOptimize enabled. Read-only and local-DB actions
// always execute immediately.
//
// The rule is FAIL CLOSED: anything not explicitly listed as safe requires
// approval. Previously an unrecognised tool fell through to "no approval
// needed", which meant every tool reached through the MCP fallback could move
// live ad spend with no review and no risk classification.

/** Read-only or local-draft tools that never touch live spend. */
export const SAFE_TOOLS = new Set([
  'ask_user_question',
  'get_local_campaigns', 'get_local_creatives', 'get_local_campaign',
  'get_dashboard_summary', 'search_knowledge_base',
  'get_strategy', 'get_memory', 'search_memory',
  'get_daily_metrics', 'get_performance_trend', 'get_account_balance',
  'test_meta_connection', 'validate_token',
  'generate_chart', 'generate_report',
  'transcribe_audio', 'speak',
  'add_memory', 'reflect_and_learn',
  // Read-only Meta pulls
  'list_campaigns', 'list_creatives', 'list_ad_sets', 'list_ads',
  'list_audiences', 'list_pages', 'list_pixels',
  'get_insights', 'compare_performance', 'estimate_audience_size', 'preview_ad',
  'sync_campaign_insights', 'sync_from_meta',
  // Local CRUD — drafts, not live spend
  'create_local_campaign', 'update_local_campaign',
  'create_local_creative', 'update_local_creative',
  'review_creative', 'improve_creative',
  'generate_ad_image', 'generate_creative_with_image',
  // Scheduling metadata only; the routine itself is guardrailed when it runs
  'list_scheduled_jobs', 'create_scheduled_job', 'update_scheduled_job', 'delete_scheduled_job',
])

/** Spend-affecting Meta actions that change live ad state. */
export const APPROVAL_TOOLS = new Set([
  'create_campaign', 'pause_campaign', 'resume_campaign',
  'create_ad_set', 'update_ad_set_budget', 'set_ad_set_status',
  'create_ad', 'set_ad_status',
  'update_campaign_budget',
  'create_ad_creative', 'create_custom_audience', 'create_lookalike_audience',
  'publish_campaign_to_meta', 'publish_full_campaign', 'set_campaign_status',
  'update_strategy',
  'delete_local_campaign', 'delete_local_creative',
])

export type RiskLevel = 'low' | 'medium' | 'high'

export function classifyRisk(tool: string): RiskLevel {
  // Anything that starts, scales or stops live delivery is high risk: it
  // changes what the client is charged, immediately.
  const high = new Set([
    'resume_campaign', 'set_campaign_status', 'set_ad_set_status', 'set_ad_status',
    'update_campaign_budget', 'update_ad_set_budget',
    'publish_full_campaign', 'publish_campaign_to_meta',
    'delete_local_campaign', 'delete_local_creative',
  ])
  if (high.has(tool)) return 'high'

  // Creating a PAUSED object costs nothing until it is activated.
  const medium = new Set([
    'create_campaign', 'create_ad_set', 'create_ad', 'create_ad_creative',
    'create_custom_audience', 'create_lookalike_audience', 'pause_campaign', 'update_strategy',
  ])
  if (medium.has(tool)) return 'medium'

  // Unknown tool: treat as high risk, matching the fail-closed approval rule.
  return SAFE_TOOLS.has(tool) ? 'low' : 'high'
}

/**
 * Whether a tool call must be queued for the client's approval.
 *
 * Fails closed: an unrecognised tool requires approval. Adding a new
 * read-only tool means adding it to SAFE_TOOLS — a deliberate, reviewable act
 * rather than an accidental grant of spend authority.
 */
export function needsApproval(tool: string, autoOptimize: boolean): boolean {
  if (SAFE_TOOLS.has(tool)) return false
  return !autoOptimize
}

/**
 * Actions that stay behind approval even with auto-optimize on. Deleting data
 * and rewriting the client's own guardrails are not "optimizations".
 */
export const ALWAYS_APPROVE = new Set([
  'delete_local_campaign',
  'delete_local_creative',
  'update_strategy',
])

export function requiresApprovalAlways(tool: string): boolean {
  return ALWAYS_APPROVE.has(tool)
}
