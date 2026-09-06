import { requireUserId, handleError } from '@/lib/supabase/server'
import { connectMetaAccount, selectAdAccount } from '@/lib/meta/connect'
import { enforceRateLimit } from '@/lib/rate-limit'

/**
 * Manual connection form. The conversational path (the agent's
 * `connect_meta_account` tool) calls the same `connectMetaAccount`, so both
 * routes validate, exchange and store credentials identically.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId()

    const limited = await enforceRateLimit(userId, 'metaSync', 'connection attempts')
    if (limited) return limited

    const body = (await request.json()) as {
      appId?: string
      appSecret?: string
      accessToken?: string
      adAccountId?: string
    }

    if (!body.appId || !body.appSecret || !body.accessToken) {
      return Response.json({ error: 'appId, appSecret, and accessToken are required' }, { status: 400 })
    }

    const result = await connectMetaAccount(userId, {
      appId: body.appId,
      appSecret: body.appSecret,
      accessToken: body.accessToken,
      adAccountId: body.adAccountId,
    })

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 401 })
    }

    return Response.json({ connected: true, ...result })
  } catch (error) {
    return handleError(error, 'Failed to connect to Meta')
  }
}

/** Switch ad account without re-entering credentials. */
export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId()
    const { adAccountId } = (await request.json()) as { adAccountId?: string }
    if (!adAccountId) return Response.json({ error: 'adAccountId is required' }, { status: 400 })
    const result = await selectAdAccount(userId, adAccountId)
    return Response.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    return handleError(error, 'Failed to select ad account')
  }
}
