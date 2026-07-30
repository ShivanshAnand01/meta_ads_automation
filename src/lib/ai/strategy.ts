import { db } from '@/lib/db/supabase-db'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AccountStrategy {
  id?: string
  userId: string
  targetRoas: number
  targetCpa?: number | null
  monthlyBudget?: number | null
  dailyBudgetCap?: number | null
  scalingRules?: string | null      // JSON
  guardrails?: string | null        // JSON
  focus?: string | null
  autoOptimize: boolean
}

export const DEFAULT_STRATEGY: Omit<AccountStrategy, 'userId'> = {
  targetRoas: 2.0,
  targetCpa: null,
  monthlyBudget: null,
  dailyBudgetCap: null,
  scalingRules: null,
  guardrails: null,
  focus: null,
  autoOptimize: false,
}

export async function getStrategy(userId: string): Promise<AccountStrategy> {
  const row = await db.accountStrategy.findUnique({ where: { userId } }) as any
  if (!row) return { userId, ...DEFAULT_STRATEGY }
  return row as AccountStrategy
}

export async function updateStrategy(userId: string, patch: Partial<AccountStrategy>): Promise<AccountStrategy> {
  const existing = await db.accountStrategy.findUnique({ where: { userId } }) as any
  const data: Record<string, unknown> = { userId }
  if (patch.targetRoas !== undefined) data.targetRoas = patch.targetRoas
  if (patch.targetCpa !== undefined) data.targetCpa = patch.targetCpa
  if (patch.monthlyBudget !== undefined) data.monthlyBudget = patch.monthlyBudget
  if (patch.dailyBudgetCap !== undefined) data.dailyBudgetCap = patch.dailyBudgetCap
  if (patch.scalingRules !== undefined) data.scalingRules = typeof patch.scalingRules === 'string' ? patch.scalingRules : JSON.stringify(patch.scalingRules ?? null)
  if (patch.guardrails !== undefined) data.guardrails = typeof patch.guardrails === 'string' ? patch.guardrails : JSON.stringify(patch.guardrails ?? null)
  if (patch.focus !== undefined) data.focus = patch.focus
  if (patch.autoOptimize !== undefined) data.autoOptimize = patch.autoOptimize

  if (existing) {
    const updated = await db.accountStrategy.update({ where: { userId }, data }) as any
    return updated as AccountStrategy
  }
  const created = await db.accountStrategy.create({ data }) as any
  return created as AccountStrategy
}

export function buildStrategyContext(s: AccountStrategy): string {
  const lines: string[] = ['ACCOUNT STRATEGY (your persistent goals & guardrails — optimize toward these):']
  lines.push(`- Target ROAS: ${s.targetRoas}x`)
  if (s.targetCpa != null) lines.push(`- Max acceptable CPA: ₹${s.targetCpa}`)
  if (s.monthlyBudget != null) lines.push(`- Monthly budget cap: ₹${s.monthlyBudget}`)
  if (s.dailyBudgetCap != null) lines.push(`- Daily spend guardrail: ₹${s.dailyBudgetCap}`)
  if (s.focus) lines.push(`- Current focus: ${s.focus}`)
  lines.push(`- Autonomous optimization: ${s.autoOptimize ? 'ENABLED — you may act without per-action approval for safe actions' : 'OFF — spend-affecting Meta actions need user approval'}`)

  if (s.guardrails) {
    try {
      const g = JSON.parse(s.guardrails)
      if (g && Object.keys(g).length) lines.push(`- Hard guardrails: ${JSON.stringify(g)}`)
    } catch {}
  }
  if (s.scalingRules) {
    try {
      const r = JSON.parse(s.scalingRules)
      if (r && Object.keys(r).length) lines.push(`- Scaling rules: ${JSON.stringify(r)}`)
    } catch {}
  }
  return lines.join('\n')
}
