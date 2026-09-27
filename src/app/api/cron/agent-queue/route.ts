import { after } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { withServiceClient } from '@/lib/db/supabase-db'
import { isMachineAuthorized } from '@/lib/cron-auth'
import { processAgentQueue } from '@/lib/ai/agents/runner'

/**
 * Runs background specialist runs queued in agent_runs.
 *
 * It answers 202 immediately and works after responding (next/server `after`,
 * which Vercel keeps alive up to maxDuration), so whoever kicked it — the chat,
 * the daily cron, the n8n heartbeat — is never held up by the run itself.
 */

export const maxDuration = 300
export const dynamic = 'force-dynamic'

async function handle(request: Request): Promise<Response> {
  if (!isMachineAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createSupabaseServiceClient()
  after(() =>
    withServiceClient(serviceClient, async () => {
      try {
        const { processed, results } = await processAgentQueue({ budgetMs: 280_000 })
        console.log(`[agent-queue] processed ${processed}`, results.map((r) => `${r.agent}:${r.status}`).join(' '))
      } catch (err) {
        console.error('[agent-queue] failed:', err instanceof Error ? err.message : err)
      }
    }),
  )

  return Response.json({ accepted: true, startedAt: new Date().toISOString() }, { status: 202 })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
