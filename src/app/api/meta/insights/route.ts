import { type NextRequest } from 'next/server'
import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { getMCPClient } from '@/lib/meta/mcp-client'
import { normalizeAdAccountId } from '@/lib/meta/user-client'

const DATE_PRESET_MAP: Record<string, string> = {
  last_30d: 'last_month',
  last_7d: 'last_week',
  last_90d: 'last_quarter',
  last_3d: 'last_week',
  maximum: 'lifetime',
  data_maximum: 'lifetime',
}

const VALID_PRESETS = new Set([
  'today', 'yesterday', 'this_week', 'last_week',
  'this_month', 'last_month', 'this_quarter', 'last_quarter',
  'this_year', 'last_year', 'lifetime',
])

function mapDatePreset(preset: string): string {
  if (DATE_PRESET_MAP[preset]) return DATE_PRESET_MAP[preset]
  if (VALID_PRESETS.has(preset)) return preset
  return 'last_month'
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId()

    const conn = await db.metaConnection.findUnique({
      where: { userId },
    }) as { adAccountId: string | null } | null

    if (!conn) {
      return Response.json(
        { error: 'Not connected to Meta' },
        { status: 400 }
      )
    }
    if (!conn.adAccountId) {
      return Response.json(
        { error: 'No ad account selected' },
        { status: 400 }
      )
    }

    const level = request.nextUrl.searchParams.get('level') || 'campaign'
    const rawDatePreset = request.nextUrl.searchParams.get('datePreset') || 'last_30d'
    const datePreset = mapDatePreset(rawDatePreset)

    const mcp = await getMCPClient()
    const result = await mcp.callTool('get_insights', {
      object_id: `act_${normalizeAdAccountId(conn.adAccountId)}`,
      level,
      date_preset: datePreset,
    })

    return Response.json(result)
  } catch (error) {
    return handleError(error, 'Failed to fetch insights')
  }
}
