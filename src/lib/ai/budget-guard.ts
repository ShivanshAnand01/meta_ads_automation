import { db } from '@/lib/db/supabase-db'
import { getStrategy, type AccountStrategy } from '@/lib/ai/strategy'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Budget enforcement.
 *
 * The account strategy's `dailyBudgetCap` and `monthlyBudget` used to be
 * injected into the system prompt and nothing else — the model was politely
 * asked not to overspend. That is not a guardrail. This module checks the
 * caps in code, before the Graph call, and blocks the action if it breaches.
 */

export interface BudgetDecision {
  allowed: boolean
  reason?: string
  /** Spend already committed today, from synced daily metrics. */
  spentToday: number
  /** Spend already committed this calendar month. */
  spentThisMonth: number
  /** Daily budget the action would add or activate. */
  proposedDailyBudget: number
  dailyCap: number | null
  monthlyCap: number | null
}

function todayKey(now = new Date()): string {
  return now.toISOString().split('T')[0]
}

function monthPrefix(now = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/** Sum synced spend for today and for the current calendar month. */
export async function getSpendSoFar(userId: string): Promise<{ spentToday: number; spentThisMonth: number }> {
  const rows = (await db.dailyMetric.findMany({ where: { userId } }).catch(() => [])) as any[]
  const today = todayKey()
  const month = monthPrefix()

  let spentToday = 0
  let spentThisMonth = 0
  for (const row of rows) {
    const date = String(row.date || '')
    const spend = Number(row.spend) || 0
    if (date === today) spentToday += spend
    if (date.startsWith(month)) spentThisMonth += spend
  }
  return { spentToday, spentThisMonth }
}

/**
 * Sum the daily budgets of every campaign already live, so activating one more
 * is judged against total committed daily spend rather than in isolation.
 */
async function getCommittedDailyBudget(userId: string): Promise<number> {
  const campaigns = (await db.campaign.findMany({ where: { userId } }).catch(() => [])) as any[]
  return campaigns
    .filter((c) => c.status === 'active' && c.budgetType === 'daily')
    .reduce((sum, c) => sum + (Number(c.budget) || 0), 0)
}

/** Tools whose arguments carry a budget that would increase live spend. */
const BUDGET_BEARING_TOOLS = new Set([
  'create_campaign',
  'create_ad_set',
  'update_campaign_budget',
  'update_ad_set_budget',
  'publish_campaign_to_meta',
  'publish_full_campaign',
])

/** Tools that switch spend on without necessarily naming an amount. */
const ACTIVATION_TOOLS = new Set(['resume_campaign', 'set_campaign_status', 'set_ad_set_status', 'set_ad_status'])

function readProposedDailyBudget(tool: string, args: Record<string, unknown>): number {
  const daily = Number(args.daily_budget ?? args.dailyBudget ?? 0)
  const lifetime = Number(args.lifetime_budget ?? args.lifetimeBudget ?? 0)
  if (Number.isFinite(daily) && daily > 0) return daily
  // Spread a lifetime budget across the schedule so it is comparable to a
  // daily cap. Without dates, treat it as a single day (the safe reading).
  if (Number.isFinite(lifetime) && lifetime > 0) {
    const start = args.start_time ?? args.startTime
    const end = args.end_time ?? args.endTime ?? args.stop_time
    if (typeof start === 'string' && typeof end === 'string') {
      const days = Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000))
      if (Number.isFinite(days)) return lifetime / days
    }
    return lifetime
  }
  return 0
}

/**
 * Decide whether a spend-affecting tool call is within the client's caps.
 *
 * Fails CLOSED on an unreadable strategy or a malformed budget: when we cannot
 * prove an action is within budget, we do not let it spend the client's money.
 */
export async function checkBudget(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  strategyOverride?: AccountStrategy,
): Promise<BudgetDecision> {
  const isBudgetBearing = BUDGET_BEARING_TOOLS.has(tool)
  const isActivation = ACTIVATION_TOOLS.has(tool)

  if (!isBudgetBearing && !isActivation) {
    return {
      allowed: true,
      spentToday: 0,
      spentThisMonth: 0,
      proposedDailyBudget: 0,
      dailyCap: null,
      monthlyCap: null,
    }
  }

  // `set_campaign_status` with active=false is a pause — always allowed, and
  // in fact the action we most want to succeed when money is running away.
  if (tool === 'set_campaign_status' && args.active === false) {
    return { allowed: true, spentToday: 0, spentThisMonth: 0, proposedDailyBudget: 0, dailyCap: null, monthlyCap: null }
  }
  if ((tool === 'set_ad_set_status' || tool === 'set_ad_status') && args.active === false) {
    return { allowed: true, spentToday: 0, spentThisMonth: 0, proposedDailyBudget: 0, dailyCap: null, monthlyCap: null }
  }

  let strategy: AccountStrategy
  try {
    strategy = strategyOverride ?? (await getStrategy(userId))
  } catch (err) {
    return {
      allowed: false,
      reason: `Could not read the account strategy to verify budget caps, so this spend action was blocked. (${
        err instanceof Error ? err.message : 'unknown error'
      })`,
      spentToday: 0,
      spentThisMonth: 0,
      proposedDailyBudget: 0,
      dailyCap: null,
      monthlyCap: null,
    }
  }

  const dailyCap = strategy.dailyBudgetCap ?? null
  const monthlyCap = strategy.monthlyBudget ?? null
  const { spentToday, spentThisMonth } = await getSpendSoFar(userId)
  const proposedDailyBudget = readProposedDailyBudget(tool, args)

  const base: Omit<BudgetDecision, 'allowed' | 'reason'> = {
    spentToday,
    spentThisMonth,
    proposedDailyBudget,
    dailyCap,
    monthlyCap,
  }

  // A budget that is negative or not a number is a bug or a bad model call.
  const rawDaily = args.daily_budget ?? args.dailyBudget
  const rawLifetime = args.lifetime_budget ?? args.lifetimeBudget
  for (const [label, raw] of [['daily_budget', rawDaily], ['lifetime_budget', rawLifetime]] as const) {
    if (raw === undefined || raw === null) continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      return { ...base, allowed: false, reason: `${label} must be a positive number (got ${String(raw)}).` }
    }
  }

  // No caps configured means nothing to enforce. Surfaced to the caller so the
  // agent can tell the client their spend is currently unbounded.
  if (dailyCap == null && monthlyCap == null) {
    return { ...base, allowed: true }
  }

  if (monthlyCap != null && spentThisMonth >= monthlyCap) {
    return {
      ...base,
      allowed: false,
      reason: `Monthly budget cap reached: ₹${spentThisMonth.toFixed(0)} already spent against a ₹${monthlyCap.toFixed(0)} cap. Raise the cap in Strategy to continue spending.`,
    }
  }

  if (dailyCap != null) {
    if (spentToday >= dailyCap) {
      return {
        ...base,
        allowed: false,
        reason: `Daily spend guardrail reached: ₹${spentToday.toFixed(0)} spent today against a ₹${dailyCap.toFixed(0)} cap.`,
      }
    }

    const committed = await getCommittedDailyBudget(userId)
    const projected = committed + proposedDailyBudget
    if (proposedDailyBudget > 0 && projected > dailyCap) {
      return {
        ...base,
        allowed: false,
        reason: `This would push committed daily budget to ₹${projected.toFixed(0)}, over the ₹${dailyCap.toFixed(0)} daily guardrail (₹${committed.toFixed(0)} is already committed across active campaigns). Reduce the budget or raise the cap in Strategy.`,
      }
    }

    if (monthlyCap != null && spentThisMonth + proposedDailyBudget > monthlyCap) {
      return {
        ...base,
        allowed: false,
        reason: `This would exceed the ₹${monthlyCap.toFixed(0)} monthly cap (₹${spentThisMonth.toFixed(0)} spent so far this month).`,
      }
    }
  }

  return { ...base, allowed: true }
}

/** Human-readable pacing summary for the agent's system context. */
export function buildPacingContext(decision: Pick<BudgetDecision, 'spentToday' | 'spentThisMonth' | 'dailyCap' | 'monthlyCap'>): string {
  const lines: string[] = ['SPEND PACING (enforced in code, not just guidance):']
  lines.push(`- Spent today: ₹${decision.spentToday.toFixed(0)}${decision.dailyCap != null ? ` of ₹${decision.dailyCap.toFixed(0)} daily cap` : ' (no daily cap set)'}`)
  lines.push(`- Spent this month: ₹${decision.spentThisMonth.toFixed(0)}${decision.monthlyCap != null ? ` of ₹${decision.monthlyCap.toFixed(0)} monthly cap` : ' (no monthly cap set)'}`)
  if (decision.dailyCap == null && decision.monthlyCap == null) {
    lines.push('- WARNING: no spend caps are configured. Recommend the client set them in Strategy.')
  }
  return lines.join('\n')
}
