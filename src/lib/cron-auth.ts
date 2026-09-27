import crypto from 'node:crypto'

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/**
 * Machine callers of /api/cron/*: Vercel Cron (bearer CRON_SECRET), the
 * external heartbeat and the app itself (x-runner-secret RUNNER_SECRET).
 */
export function isMachineAuthorized(request: Request): boolean {
  // Vercel Cron signs its requests with CRON_SECRET as a bearer token.
  const cronSecret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (cronSecret && constantTimeEqual(auth, `Bearer ${cronSecret}`)) return true

  // The runner secret also works, for manual triggering, the heartbeat and
  // the agent queue kick.
  const runnerSecret = process.env.RUNNER_SECRET
  const header = request.headers.get('x-runner-secret') || ''
  if (runnerSecret && runnerSecret.length > 0 && constantTimeEqual(header, runnerSecret)) return true

  return false
}
