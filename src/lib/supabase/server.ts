import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { SupabaseClient, User } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined

export class UnauthorizedError extends Error {
  status = 401
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

export function validateSupabaseEnv(): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  return { ok: missing.length === 0, missing }
}

export async function getSupabaseServer() {
  const store = await cookies()
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            store.set(name, value, options)
          )
        } catch {
          // setAll can be called from a Server Component where cookies are
          // read-only. Safe to ignore — the proxy already refreshed the
          // session in-place on the request, so the refreshed tokens are
          // available via cookies().getAll() on the next read.
        }
      },
    },
  })
}

export async function getSessionUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null
  const supabase = await getSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function requireUserId(): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new UnauthorizedError()
  return user.id
}

export function handleError(error: unknown, fallback: string): Response {
  const status = (error as { status?: number })?.status ?? 500
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status }
  )
}

/**
 * Service-role client that bypasses RLS. ONLY for the autonomous background
 * runner (authenticated via SUPABASE_SERVICE_ROLE_KEY). Never expose this to
 * the browser.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } })
}

export function hasServiceRoleKey(): boolean {
  return Boolean(serviceRoleKey)
}
