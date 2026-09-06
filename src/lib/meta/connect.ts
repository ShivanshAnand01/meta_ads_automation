import { db } from '@/lib/db/supabase-db'
import { normalizeAdAccountId } from '@/lib/meta/user-client'
import { getLongLivedToken } from '@/lib/meta/oauth'
import { storeSecret, SECRET_KEYS } from '@/lib/secrets'
import { GRAPH_API_VERSION } from '@/lib/meta/client'

/**
 * Connect a user's own Meta app to their account.
 *
 * Every business brings its own Meta developer app — its App ID, App Secret
 * and an access token generated under that app. Because the credentials are
 * theirs, the platform itself never needs Meta App Review: each app is in
 * development mode and manages only ad accounts its own admin already has
 * access to.
 *
 * Used by both the /connect form and the agent's `connect_meta_account` tool,
 * so the conversational onboarding and the manual page behave identically.
 */

const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface ConnectMetaInput {
  appId: string
  appSecret: string
  accessToken: string
  /** Pick a specific ad account instead of the first one returned. */
  adAccountId?: string
}

export interface ConnectMetaResult {
  success: boolean
  error?: string
  adAccountId: string | null
  adAccountName: string | null
  adAccountStatus: string | null
  adAccountCurrency: string | null
  /** Every account the token can see, so the agent can ask which to use. */
  availableAccounts: Array<{ id: string; name: string; currency: string; status: string }>
  tokenExchanged: boolean
  tokenExpiry: string | null
  scopes: string[]
  missingScopes: string[]
}

const REQUIRED_SCOPES = ['ads_management', 'ads_read']

function looksLikeAppId(v: string): boolean {
  return /^\d{10,20}$/.test(v.trim())
}

export async function connectMetaAccount(userId: string, input: ConnectMetaInput): Promise<ConnectMetaResult> {
  const appId = input.appId?.trim()
  const appSecret = input.appSecret?.trim()
  const accessToken = input.accessToken?.trim()

  const empty: ConnectMetaResult = {
    success: false, adAccountId: null, adAccountName: null, adAccountStatus: null, adAccountCurrency: null,
    availableAccounts: [], tokenExchanged: false, tokenExpiry: null, scopes: [], missingScopes: [],
  }

  if (!appId || !appSecret || !accessToken) {
    return { ...empty, error: 'App ID, App Secret and access token are all required.' }
  }
  if (!looksLikeAppId(appId)) {
    return { ...empty, error: `"${appId}" does not look like a Meta App ID — it should be a 15–16 digit number from developers.facebook.com.` }
  }

  // 1. Validate the token against the app it claims to belong to.
  const verifyUrl = `${BASE_URL}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`
  let verify: { data?: { is_valid?: boolean; scopes?: string[]; app_id?: string; error?: { message?: string } } } = {}
  try {
    verify = await (await fetch(verifyUrl)).json()
  } catch {
    return { ...empty, error: 'Could not reach Meta to validate the token. Try again in a moment.' }
  }

  if (!verify.data?.is_valid) {
    const reason = verify.data?.error?.message
    return {
      ...empty,
      error: reason
        ? `Meta rejected the token: ${reason}`
        : 'Meta says this token is not valid for this App ID and secret. Check all three values were copied from the same app.',
    }
  }
  if (verify.data.app_id && verify.data.app_id !== appId) {
    return { ...empty, error: `This token was issued by app ${verify.data.app_id}, not ${appId}. Use a token generated under the same app.` }
  }

  const scopes = verify.data.scopes ?? []
  const missingScopes = REQUIRED_SCOPES.filter((s) => !scopes.includes(s))

  // 2. Exchange for a long-lived token (~60 days) so they are not reconnecting weekly.
  let longLivedToken = accessToken
  let tokenExchanged = false
  let tokenExpiry: string | null = null
  try {
    const ll = await getLongLivedToken(accessToken, appId, appSecret)
    longLivedToken = ll.accessToken
    tokenExchanged = true
    tokenExpiry = new Date(Date.now() + (ll.expiresIn || 5_184_000) * 1000).toISOString()
  } catch {
    /* keep the short-lived token; the agent will warn about expiry */
  }

  // 3. Discover ad accounts.
  let availableAccounts: ConnectMetaResult['availableAccounts'] = []
  try {
    const res = await fetch(
      `${BASE_URL}/me/adaccounts?fields=id,name,account_id,account_status,currency&limit=50&access_token=${encodeURIComponent(longLivedToken)}`,
    )
    const json = await res.json()
    if (res.ok && Array.isArray(json.data)) {
      availableAccounts = json.data.map((a: { id: string; name: string; currency: string; account_status: number }) => ({
        id: normalizeAdAccountId(a.id) as string,
        name: a.name,
        currency: a.currency,
        status: String(a.account_status),
      }))
    }
  } catch {
    /* non-fatal; they can pick an account later */
  }

  const chosen =
    (input.adAccountId && availableAccounts.find((a) => a.id === normalizeAdAccountId(input.adAccountId))) ||
    availableAccounts[0] ||
    null

  // 4. Persist, secrets in Vault.
  const storedAppSecret = await storeSecret(userId, SECRET_KEYS.metaAppSecret, appSecret)
  const storedAccessToken = await storeSecret(userId, SECRET_KEYS.metaAccessToken, longLivedToken)

  const fields = {
    appId,
    appSecret: storedAppSecret,
    accessToken: storedAccessToken,
    tokenExpiry,
    lastValidatedAt: new Date(),
    ...(chosen
      ? { adAccountId: chosen.id, adAccountName: chosen.name, adAccountStatus: chosen.status, adAccountCurrency: chosen.currency }
      : {}),
  }
  await db.metaConnection.upsert({ where: { userId }, update: fields, create: { userId, ...fields } })

  return {
    success: true,
    adAccountId: chosen?.id ?? null,
    adAccountName: chosen?.name ?? null,
    adAccountStatus: chosen?.status ?? null,
    adAccountCurrency: chosen?.currency ?? null,
    availableAccounts,
    tokenExchanged,
    tokenExpiry,
    scopes,
    missingScopes,
  }
}

/** Switch the selected ad account without re-entering credentials. */
export async function selectAdAccount(userId: string, adAccountId: string): Promise<{ success: boolean; error?: string; name?: string; currency?: string }> {
  const conn = (await db.metaConnection.findUnique({ where: { userId } })) as { accessToken?: string } | null
  if (!conn) return { success: false, error: 'Meta is not connected yet.' }
  const id = normalizeAdAccountId(adAccountId)
  if (!id) return { success: false, error: 'Invalid ad account ID.' }
  await db.metaConnection.update({ where: { userId }, data: { adAccountId: id } })
  return { success: true }
}
