import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { normalizeAdAccountId } from '@/lib/meta/user-client'
import { getLongLivedToken } from '@/lib/meta/oauth'
import { storeSecret, SECRET_KEYS } from '@/lib/secrets'

const GRAPH_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()
    const { appId, appSecret, accessToken } = body as {
      appId?: string
      appSecret?: string
      accessToken?: string
    }

    if (!appId || !appSecret || !accessToken) {
      return Response.json(
        { error: 'appId, appSecret, and accessToken are required' },
        { status: 400 }
      )
    }

    // Validate the token before storing
    const verifyUrl = `${BASE_URL}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`
    const verifyRes = await fetch(verifyUrl)
    const verifyData = await verifyRes.json()

    if (!verifyRes.ok || !verifyData?.data?.is_valid) {
      return Response.json(
        { error: 'Invalid access token. Verification failed.' },
        { status: 401 }
      )
    }

    // Exchange the short-lived token for a long-lived token (~60 days)
    // so the user doesn't need to reconnect frequently.
    let longLivedToken = accessToken
    let tokenExpiry: string | null = null
    try {
      const longLived = await getLongLivedToken(accessToken, appId, appSecret)
      longLivedToken = longLived.accessToken
      // Long-lived tokens expire in ~60 days
      tokenExpiry = new Date(Date.now() + (longLived.expiresIn || 5184000) * 1000).toISOString()
    } catch {
      // Fall back to the original token if exchange fails
      longLivedToken = accessToken
    }

    // Fetch ad accounts to auto-select the first one
    let adAccountId: string | null = null
    let adAccountName: string | null = null
    let adAccountStatus: string | null = null
    let adAccountCurrency: string | null = null

    try {
      const acctUrl = `${BASE_URL}/me/adaccounts?fields=id,name,account_id,account_status,currency&limit=1&access_token=${longLivedToken}`
      const acctRes = await fetch(acctUrl)
      const acctData = await acctRes.json()

      if (acctRes.ok && acctData.data && acctData.data.length > 0) {
        const acct = acctData.data[0]
        adAccountId = normalizeAdAccountId(acct.id)
        adAccountName = acct.name
        adAccountStatus = String(acct.account_status)
        adAccountCurrency = acct.currency
      }
    } catch {
      // Non-fatal — user can select an account later
    }

    // Store secrets in Vault when available, otherwise fall back to the
    // plaintext column (still protected by RLS).
    const storedAppSecret = await storeSecret(userId, SECRET_KEYS.metaAppSecret, appSecret)
    const storedAccessToken = await storeSecret(userId, SECRET_KEYS.metaAccessToken, longLivedToken)

    await db.metaConnection.upsert({
      where: { userId },
      update: {
        appId,
        appSecret: storedAppSecret,
        accessToken: storedAccessToken,
        tokenExpiry,
        ...(adAccountId ? { adAccountId, adAccountName, adAccountStatus, adAccountCurrency } : {}),
      },
      create: {
        userId,
        appId,
        appSecret: storedAppSecret,
        accessToken: storedAccessToken,
        tokenExpiry,
        ...(adAccountId ? { adAccountId, adAccountName, adAccountStatus, adAccountCurrency } : {}),
      },
    })

    return Response.json({
      success: true,
      connected: true,
      adAccountId,
      adAccountName,
      adAccountStatus,
      adAccountCurrency,
      tokenExchanged: longLivedToken !== accessToken,
      tokenExpiry,
    })
  } catch (error) {
    return handleError(error, 'Failed to connect to Meta')
  }
}
