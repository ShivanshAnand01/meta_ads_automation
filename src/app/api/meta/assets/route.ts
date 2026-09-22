import { requireUserId, handleError } from '@/lib/supabase/server'
import { getMetaConnection, getMetaClientForUser, needsMetaConnection } from '@/lib/meta/user-client'

/**
 * The Meta assets a publish needs to pick from: Facebook Pages (a link ad
 * must be published from one) and Pixels (a Sales campaign optimises
 * against one). Both lists are empty when the token lacks the scope, and
 * the response says so rather than pretending the account has none.
 */
export async function GET() {
  try {
    const userId = await requireUserId()
    const conn = await getMetaConnection(userId)
    const blocker = needsMetaConnection(conn)
    if (blocker) return Response.json({ connected: false, error: blocker, pages: [], pixels: [] })

    const client = await getMetaClientForUser(userId)
    const [pages, pixels] = await Promise.all([
      client.getPages().catch(() => [] as Array<{ id: string; name: string }>),
      client.getPixels().catch(() => [] as Array<{ id: string; name: string }>),
    ])
    return Response.json({ connected: true, pages, pixels })
  } catch (error) {
    return handleError(error, 'Failed to load Meta assets')
  }
}
