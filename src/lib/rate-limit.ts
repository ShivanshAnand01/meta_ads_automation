import { getScopedSupabase } from '@/lib/db/supabase-db'

/**
 * Per-user rate limiting, backed by Postgres.
 *
 * Serverless functions share no memory, so an in-process counter is
 * decorative. The counter lives in a table and is incremented atomically by
 * `bump_rate_limit`, which avoids the read-then-write race an application-side
 * counter would have.
 *
 * The expensive routes here are AI routes: one chat turn runs up to 10 tool
 * rounds against a paid model, so an unbounded client (or a stuck browser tab
 * retrying) can burn a real budget.
 */

export interface RateLimitConfig {
  /** Requests allowed per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

export const RATE_LIMITS = {
  /** Agent chat turns — the most expensive thing a user can trigger. */
  aiChat: { limit: 30, windowSeconds: 60 * 60 },
  /** Image generation — slow and paid per image. */
  imageGen: { limit: 40, windowSeconds: 60 * 60 },
  /** Creative copy generation. */
  aiGenerate: { limit: 60, windowSeconds: 60 * 60 },
  /** Meta sync — protects the shared Graph API rate limit, not just our cost. */
  metaSync: { limit: 30, windowSeconds: 60 * 60 },
  /** Manually triggered autonomous runs. */
  autonomous: { limit: 10, windowSeconds: 60 * 60 },
  /** File uploads. */
  upload: { limit: 60, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitConfig>

export type RateLimitBucket = keyof typeof RATE_LIMITS

export interface RateLimitResult {
  allowed: boolean
  count: number
  limit: number
  /** Seconds until the current window rolls over. */
  retryAfter: number
}

function windowStart(windowSeconds: number, now = Date.now()): string {
  const ms = windowSeconds * 1000
  return new Date(Math.floor(now / ms) * ms).toISOString()
}

/**
 * Consume one unit from a user's bucket.
 *
 * Fails OPEN on infrastructure errors: a rate limiter that is itself broken
 * should not take the product down. The tradeoff is deliberate — the cost
 * ceiling matters, but not more than the app working.
 */
export async function rateLimit(userId: string, bucket: RateLimitBucket): Promise<RateLimitResult> {
  const config = RATE_LIMITS[bucket]
  const start = windowStart(config.windowSeconds)
  const elapsed = (Date.now() - new Date(start).getTime()) / 1000
  const retryAfter = Math.max(1, Math.ceil(config.windowSeconds - elapsed))

  try {
    const supabase = await getScopedSupabase()
    const { data, error } = await supabase.rpc('bump_rate_limit', {
      p_user_id: userId,
      p_bucket: bucket,
      p_window_start: start,
      p_limit: config.limit,
    })

    if (error) {
      console.error('[rate-limit] bump failed, allowing request:', error.message)
      return { allowed: true, count: 0, limit: config.limit, retryAfter }
    }

    const row = Array.isArray(data) ? data[0] : data
    const count = Number(row?.current_count ?? 0)
    return { allowed: row?.allowed !== false, count, limit: config.limit, retryAfter }
  } catch (err) {
    console.error('[rate-limit] unavailable, allowing request:', err instanceof Error ? err.message : err)
    return { allowed: true, count: 0, limit: config.limit, retryAfter }
  }
}

/** 429 response with the standard headers, for a route that is over budget. */
export function rateLimitResponse(result: RateLimitResult, what = 'requests'): Response {
  return Response.json(
    {
      error: `Too many ${what}. You have used ${result.count} of ${result.limit} this hour — try again in ${Math.ceil(result.retryAfter / 60)} minute(s).`,
      retryAfter: result.retryAfter,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfter),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(Math.max(0, result.limit - result.count)),
      },
    },
  )
}

/**
 * Guard a route in one call. Returns a 429 Response to return immediately, or
 * null when the request may proceed.
 */
export async function enforceRateLimit(
  userId: string,
  bucket: RateLimitBucket,
  what?: string,
): Promise<Response | null> {
  const result = await rateLimit(userId, bucket)
  return result.allowed ? null : rateLimitResponse(result, what)
}
