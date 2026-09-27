import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PUBLIC_PATHS = new Set([
  '/login',
  '/auth/callback',
  '/reset-password',
  '/api/auth/signup',
  '/api/auth/reset-password',
])

const PUBLIC_PREFIXES = ['/api/auth/', '/api/status', '/_next/', '/favicon.ico']

/**
 * Machine callers (Vercel Cron, the n8n heartbeat, the runner) carry a shared
 * secret instead of a Supabase session. Without this check the proxy answered
 * them with 401 before the route could validate the secret, so no scheduled
 * run ever reached /api/cron/run-jobs. The route re-validates in full; this is
 * only the gate that lets the request get there.
 */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function hasMachineSecret(request: NextRequest): boolean {
  const cron = process.env.CRON_SECRET || ''
  const runner = process.env.RUNNER_SECRET || ''
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const runnerHeader = request.headers.get('x-runner-secret') || ''
  return (cron.length > 0 && safeEqual(bearer, cron)) || (runner.length > 0 && safeEqual(runnerHeader, runner))
}

const MACHINE_ROUTES = ['/api/cron/', '/api/ai-manager/autonomous']

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|otf|json)$/.test(pathname)) {
    return true
  }
  return false
}

export async function proxy(request: NextRequest) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Make the current pathname available to server components/layouts.
  request.headers.set('x-pathname', pathname)

  // Don't run auth on the login/callback/public routes themselves.
  if (isPublic(pathname)) {
    return NextResponse.next({ request })
  }

  if (MACHINE_ROUTES.some((p) => pathname.startsWith(p)) && hasMachineSecret(request)) {
    return NextResponse.next({ request })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Not configured yet — let the app render (routes will surface a clear error).
  if (!supabaseUrl || !anonKey) {
    console.error('[proxy] Supabase environment variables are missing')
    return NextResponse.next({ request })
  }

  // ── Phase 1: refresh the session IN-PLACE on the request cookies ──────
  // We update request.cookies first (before creating the NextResponse) so
  // the refreshed tokens are visible to every downstream route handler via
  // cookies(). Without this, the route handler reads the *stale* cookies
  // from the original HTTP request and the Supabase RLS query fails.
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })
      },
    },
  })

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  // A logged-out visitor has no session; that is the normal case, not an
  // error, and it was the only entry in production's error log.
  if (error && error.name !== 'AuthSessionMissingError') {
    console.error('[proxy] getUser error', error.message)
  }

  // If user is logged in and hits /login, redirect to dashboard.
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', url.origin))
  }

  if (!user) {
    if (pathname.startsWith('/api')) {
      return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const redirectUrl = new URL('/login', url.origin)
    redirectUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // ── Phase 2: build the response AFTER the refresh ────────────────────
  // Now that request.cookies holds the refreshed session tokens, create the
  // response so the downstream route handler and the browser both get the
  // updated cookies.
  const response = NextResponse.next({ request })

  // Also set Set-Cookie headers on the response so the browser persists the
  // refreshed tokens for the next request.
  const refreshedCookies = request.cookies.getAll()
  for (const cookie of refreshedCookies) {
    if (cookie.name.startsWith('sb-')) {
      response.cookies.set(cookie.name, cookie.value, {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
      })
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)',
  ],
}
