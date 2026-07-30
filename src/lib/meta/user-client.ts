import { createMetaClient, MetaApiClient } from './client'
import { db } from '@/lib/db/supabase-db'
import { UnauthorizedError } from '@/lib/supabase/server'
import { resolveSecrets, SECRET_KEYS } from '@/lib/secrets'

export interface MetaConnectionRow {
  id: string
  userId: string
  appId: string
  appSecret: string
  accessToken: string
  tokenExpiry: string | null
  adAccountId: string | null
  adAccountName: string | null
  adAccountStatus: string | null
  adAccountCurrency: string | null
  connectedAt?: string | null
}

export function normalizeAdAccountId(id: string | null | undefined): string | null {
  if (!id) return null
  return id.replace(/^act_/, '')
}

export async function getMetaConnection(userId: string): Promise<MetaConnectionRow | null> {
  let conn = await db.metaConnection.findUnique({ where: { userId } }) as MetaConnectionRow | null
  if (conn) {
    conn = await resolveSecrets(conn, [
      { column: 'accessToken', vaultKey: SECRET_KEYS.metaAccessToken },
      { column: 'appSecret', vaultKey: SECRET_KEYS.metaAppSecret },
    ])
    conn.adAccountId = normalizeAdAccountId(conn.adAccountId)
  }
  return conn
}

export async function requireMetaConnection(userId: string): Promise<MetaConnectionRow> {
  const conn = await getMetaConnection(userId)
  if (!conn) {
    throw new UnauthorizedError()
  }
  return conn
}

export async function getMetaClientForUser(userId: string): Promise<MetaApiClient> {
  const conn = await requireMetaConnection(userId)
  const client = createMetaClient({
    appId: conn.appId,
    appSecret: conn.appSecret,
    accessToken: conn.accessToken,
    adAccountId: conn.adAccountId || undefined,
  })
  return client
}

export function needsMetaConnection(conn: MetaConnectionRow | null): string | null {
  if (!conn) return 'Meta Ads is not connected. Connect via the Meta Connection page first.'
  if (!conn.adAccountId) return 'No ad account selected. Select an ad account in the Meta Connection page first.'
  return null
}
