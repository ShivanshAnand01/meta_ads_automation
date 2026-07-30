import { getSupabaseServer, createSupabaseServiceClient, hasServiceRoleKey } from '@/lib/supabase/server'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Sentinel stored in a column when the real value has been moved to Vault.
export const VAULT_SENTINEL = 'vault:'
export const VAULT_ENABLED = process.env.VAULT_ENABLED === 'true'

// Canonical Vault key names per secret.
export const SECRET_KEYS = {
  aiApiKey: 'ai_api_key',
  aiEmbeddingKey: 'ai_embedding_key',
  aiWhisperKey: 'ai_whisper_key',
  aiTtsKey: 'ai_tts_key',
  metaAccessToken: 'meta_access_token',
  metaAppSecret: 'meta_app_secret',
} as const

function isSentinel(v: string | null | undefined): boolean {
  return !!v && v.startsWith(VAULT_SENTINEL)
}

/** Read one of the current user's secrets from Vault (RLS-scoped). */
export async function getUserSecret(key: string): Promise<string | null> {
  try {
    const supabase = await getSupabaseServer()
    const { data, error } = await supabase.rpc('get_user_secret', { p_key: key })
    if (error || !data) return null
    return data as string
  } catch {
    return null
  }
}

/** Write a secret to Vault for a user (service role). Returns true on success. */
export async function setUserSecret(userId: string, key: string, value: string, description?: string): Promise<boolean> {
  if (!hasServiceRoleKey()) return false
  try {
    const client = createSupabaseServiceClient()
    const { error } = await client.rpc('set_user_secret', {
      p_user_id: userId, p_key: key, p_secret: value, p_description: description || key,
    })
    return !error
  } catch {
    return false
  }
}

/** Clear a secret from Vault. */
export async function clearUserSecret(userId: string, key: string): Promise<void> {
  if (!hasServiceRoleKey()) return
  try {
    const client = createSupabaseServiceClient()
    await client.from('vault.secrets').delete().eq('name', `${userId}__${key}`)
  } catch {}
}

/**
 * Resolve a settings/connection row so secret fields hold real values.
 * If a column holds a Vault sentinel, fetch from Vault; otherwise use the
 * column value (backward compatible when Vault isn't enabled yet).
 */
export async function resolveSecrets<T extends Record<string, any>>(
  row: T,
  fields: Array<{ column: keyof T; vaultKey: string }>,
): Promise<T> {
  const out = { ...row }
  for (const f of fields) {
    const colVal = out[f.column] as string | null | undefined
    if (isSentinel(colVal)) {
      const real = await getUserSecret(f.vaultKey)
      if (real != null) (out as any)[f.column] = real
      else (out as any)[f.column] = null
    }
  }
  return out
}

/**
 * Persist a secret: prefer Vault (store sentinel in the column). If Vault is
 * unavailable, fall back to storing the value in the column (plaintext) so the
 * app keeps working. Returns the value to write into the column.
 */
export async function storeSecret(
  userId: string,
  vaultKey: string,
  value: string | null | undefined,
  description?: string,
): Promise<string | null> {
  if (value === undefined) return undefined as unknown as string // caller should skip
  if (!value) return null // empty -> clear
  if (VAULT_ENABLED) {
    const ok = await setUserSecret(userId, vaultKey, value, description)
    if (ok) return `${VAULT_SENTINEL}${vaultKey}` // sentinel in the column
  }
  // Fallback: keep plaintext in the column (still RLS-protected).
  return value
}
