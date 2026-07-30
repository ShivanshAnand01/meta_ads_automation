import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

const GRAPH_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export async function GET() {
  try {
    const userId = await requireUserId()

    const conn = await db.metaConnection.findUnique({
      where: { userId },
    }) as { accessToken: string } | null

    if (!conn) {
      return Response.json(
        { error: 'Not connected to Meta' },
        { status: 400 }
      )
    }

    const url = `${BASE_URL}/me/adaccounts?fields=id,name,account_id,account_status,currency,timezone_name,spend_cap,amount_spent,balance&access_token=${conn.accessToken}`

    const response = await fetch(url)
    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(
        data.error?.message || `Meta API error: ${response.status} ${response.statusText}`
      )
    }

    return Response.json({ accounts: data.data })
  } catch (error) {
    return handleError(error, 'Failed to fetch ad accounts')
  }
}
