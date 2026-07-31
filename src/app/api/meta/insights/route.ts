import { type NextRequest } from 'next/server'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { getMCPClient } from '@/lib/meta/mcp-client'
import { getMetaConnection, normalizeAdAccountId } from '@/lib/meta/user-client'

const VALID_PRESETS = new Set([
  'today', 'yesterday', 'this_week', 'last_week',
  'this_month', 'last_month', 'this_quarter', 'last_quarter',
  'this_year', 'last_year', 'lifetime', 'maximum',
  'last_3d', 'last_7d', 'last_30d', 'last_90d',
])

function mapDatePreset(preset: string): string {
  if (VALID_PRESETS.has(preset)) return preset
  return 'last_30d'
}

export async function GET(request: NextRequest) {
  try {
    const userId = await requireUserId()

    const conn = await getMetaConnection(userId)
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

    const mcp = await getMCPClient(userId)
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
