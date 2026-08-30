import { type NextRequest } from 'next/server'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { metaGetInsights } from '@/lib/meta/ops'
import { enforceRateLimit } from '@/lib/rate-limit'

// Insights can walk several pages of Graph results.
export const maxDuration = 60

const VALID_PRESETS = new Set([
  'today', 'yesterday', 'this_week', 'last_week',
  'this_month', 'last_month', 'this_quarter', 'last_quarter',
  'this_year', 'last_year', 'lifetime', 'maximum',
  'last_3d', 'last_7d', 'last_30d', 'last_90d',
])

const VALID_LEVELS = new Set(['account', 'campaign', 'adset', 'ad'])

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId()

    const limited = await enforceRateLimit(userId, 'metaSync', 'Meta API requests')
    if (limited) return limited

    const rawLevel = request.nextUrl.searchParams.get('level') || 'campaign'
    const level = VALID_LEVELS.has(rawLevel) ? rawLevel : 'campaign'

    const rawPreset = request.nextUrl.searchParams.get('datePreset') || 'last_30d'
    const datePreset = VALID_PRESETS.has(rawPreset) ? rawPreset : 'last_30d'

    const result = await metaGetInsights(userId, {
      level: level as 'account' | 'campaign' | 'adset' | 'ad',
      datePreset,
    })

    if (result && typeof result === 'object' && 'error' in result) {
      return Response.json(result, { status: 400 })
    }

    return Response.json(result)
  } catch (error) {
    return handleError(error, 'Failed to fetch insights')
  }
}
