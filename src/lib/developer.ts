import type { User } from '@supabase/supabase-js'
import { getSessionUser, createSupabaseServiceClient, hasServiceRoleKey } from '@/lib/supabase/server'

/**
 * The platform's developer: the account(s) that see every business (console,
 * running cost) and can test features before businesses get them.
 *
 * Who counts is DEVELOPER_EMAILS (comma separated). Unset means nobody — every
 * check here fails closed.
 */

export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = (process.env.DEVELOPER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(email.toLowerCase())
}

/** The signed-in user if they are the developer, else null. */
export async function getDeveloperUser(): Promise<User | null> {
  const user = await getSessionUser()
  return user && isDeveloperEmail(user.email) ? user : null
}

/**
 * For developer-only API routes: the developer, or a 404 to everyone else
 * (401 when signed out). A 404 rather than 403, so the console's existence
 * is not advertised.
 */
export async function developerOrResponse(): Promise<User | Response> {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isDeveloperEmail(user.email)) return Response.json({ error: 'Not found' }, { status: 404 })
  return user
}

// userId → developer?, so agent runs and routines (no session) can ask
// without an Auth round trip every call. Emails do not change often.
const byUserId = new Map<string, { developer: boolean; at: number }>()
const TTL_MS = 10 * 60 * 1000

/** Whether a user id belongs to the developer. Works without a session. */
export async function isDeveloperUserId(userId: string): Promise<boolean> {
  if (!process.env.DEVELOPER_EMAILS || !hasServiceRoleKey()) return false
  const hit = byUserId.get(userId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.developer
  try {
    const { data } = await createSupabaseServiceClient().auth.admin.getUserById(userId)
    const developer = isDeveloperEmail(data?.user?.email)
    byUserId.set(userId, { developer, at: Date.now() })
    return developer
  } catch {
    return false
  }
}
