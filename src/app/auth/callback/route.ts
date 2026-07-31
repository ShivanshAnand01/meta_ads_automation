import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const ALLOWED_REDIRECTS = new Set(['/', '/settings', '/reset-password'])

function safeRedirect(next: string | null, origin: string): string {
  if (!next) return '/'
  // Reject anything that is not a same-origin relative path.
  if (!next.startsWith('/') || /^\/\//.test(next)) return '/'
  try {
    if (new URL(next, origin).origin !== origin) return '/'
  } catch {
    return '/'
  }
  return next
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type')
  const rawNext = requestUrl.searchParams.get('next') || '/'

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    console.error('[auth/callback] Supabase env vars missing')
    return NextResponse.redirect(new URL('/login?error=server', requestUrl.origin))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', requestUrl.origin))
  }

  let next = rawNext
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    })
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw error

    // Recovery flow: redirect to password reset page after confirming the session.
    if (type === 'recovery') {
      next = '/reset-password'
    }
  } catch (err) {
    console.error('[auth/callback] session exchange failed', err)
    return NextResponse.redirect(
      new URL('/login?error=callback', requestUrl.origin)
    )
  }

  const redirectTo = ALLOWED_REDIRECTS.has(next) ? next : safeRedirect(next, requestUrl.origin)
  return NextResponse.redirect(new URL(redirectTo, requestUrl.origin))
}
