import { requireUserId, handleError } from '@/lib/supabase/server'
import { getStrategy, updateStrategy } from '@/lib/ai/strategy'

/**
 * Account strategy: target ROAS/CPA, the daily and monthly caps that
 * budget-guard enforces in code, and the auto-optimize switch.
 */
export async function GET() {
  try {
    const userId = await requireUserId()
    return Response.json({ strategy: await getStrategy(userId) })
  } catch (error) {
    return handleError(error, 'Failed to load strategy')
  }
}

function numOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId()
    const body = (await request.json()) as Record<string, unknown>

    const patch: Parameters<typeof updateStrategy>[1] = {}
    const targetRoas = numOrNull(body.targetRoas)
    if (typeof targetRoas === 'number') patch.targetRoas = targetRoas
    const targetCpa = numOrNull(body.targetCpa)
    if (targetCpa !== undefined) patch.targetCpa = targetCpa
    const monthly = numOrNull(body.monthlyBudget)
    if (monthly !== undefined) patch.monthlyBudget = monthly
    const daily = numOrNull(body.dailyBudgetCap)
    if (daily !== undefined) patch.dailyBudgetCap = daily
    if (typeof body.focus === 'string' || body.focus === null) patch.focus = (body.focus as string) || null
    if (typeof body.autoOptimize === 'boolean') patch.autoOptimize = body.autoOptimize

    if (patch.dailyBudgetCap != null && patch.monthlyBudget != null && patch.dailyBudgetCap > patch.monthlyBudget) {
      return Response.json({ error: 'The daily cap cannot be larger than the monthly cap.' }, { status: 400 })
    }

    return Response.json({ strategy: await updateStrategy(userId, patch) })
  } catch (error) {
    return handleError(error, 'Failed to save strategy')
  }
}
