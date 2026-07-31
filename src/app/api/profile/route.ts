import { getSessionUser, requireUserId, handleError } from '@/lib/supabase/server'
import { getMetaConnection } from '@/lib/meta/user-client'
import { db } from '@/lib/db/supabase-db'

/* eslint-disable @typescript-eslint/no-explicit-any */

const GRAPH_API_VERSION = 'v21.0'
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`

function mask(v: string | null | undefined): string | null {
  if (!v) return null
  if (v.startsWith('vault:')) return '•••••••••• (Vault)'
  if (v.length <= 8) return '••••••••'
  return `${v.slice(0, 4)}••••••••${v.slice(-4)}`
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId()
    const user = await getSessionUser()
    const { searchParams } = new URL(request.url)
    const test = searchParams.get('test') === '1'

    const userInfo = user
      ? {
          id: user.id,
          email: user.email || null,
          name:
            (user.user_metadata as Record<string, string> | undefined)?.name ||
            user.email?.split('@')[0] ||
            'User',
          createdAt: user.created_at,
        }
      : { id: userId, email: null, name: 'User', createdAt: null }

    // Meta connection (secrets resolved + adAccountId normalized)
    const conn = await getMetaConnection(userId)
    const connection = conn
      ? {
          connected: true,
          appId: conn.appId,
          appSecret: mask(conn.appSecret),
          accessToken: mask(conn.accessToken),
          adAccountId: conn.adAccountId ? `act_${conn.adAccountId}` : null,
          adAccountIdRaw: conn.adAccountId,
          adAccountName: conn.adAccountName,
          adAccountStatus: conn.adAccountStatus,
          adAccountCurrency: conn.adAccountCurrency,
          connectedAt: conn.connectedAt,
        }
      : {
          connected: false,
          appId: null,
          appSecret: null,
          accessToken: null,
          adAccountId: null,
          adAccountIdRaw: null,
          adAccountName: null,
          adAccountStatus: null,
          adAccountCurrency: null,
          connectedAt: null,
        }

    // AI brain config
    const aiSettings = (await db.aiSettings.findUnique({ where: { userId } })) as {
      provider: string; model: string; baseUrl: string | null; apiKey: string | null
    } | null
    const aiConfig = aiSettings
      ? {
          configured: true,
          provider: aiSettings.provider,
          model: aiSettings.model,
          baseUrl: aiSettings.baseUrl,
          apiKey: mask(aiSettings.apiKey),
        }
      : { configured: false, provider: null, model: null, baseUrl: null, apiKey: null }

    // Live token validation
    let tokenTest: any = null
    if (test && conn) {
      try {
        const url = `${BASE_URL}/debug_token?input_token=${encodeURIComponent(conn.accessToken)}&access_token=${encodeURIComponent(`${conn.appId}|${conn.appSecret}`)}`
        const res = await fetch(url)
        const data = await res.json()
        const d = data?.data
        if (d) {
          tokenTest = {
            valid: Boolean(d.is_valid),
            expiresAt: d.expires_at || d.data_access_expires_at || null,
            scopes: d.scopes || [],
            appId: d.app_id || null,
            appName: d.app_name || null,
            error: null,
          }
        } else {
          tokenTest = { valid: false, error: data?.error?.message || 'Token validation returned no data' }
        }
      } catch (e) {
        tokenTest = { valid: false, error: e instanceof Error ? e.message : 'Token validation failed' }
      }
    }

    return Response.json({ user: userInfo, connection, aiConfig, tokenTest })
  } catch (error) {
    return handleError(error, 'Failed to load profile')
  }
}
