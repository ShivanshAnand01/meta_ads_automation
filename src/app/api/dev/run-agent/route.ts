import { handleError } from '@/lib/supabase/server'
import { developerOrResponse } from '@/lib/developer'
import { delegateToAgent } from '@/lib/ai/agents/runner'
import { getSpecialist } from '@/lib/ai/agents/registry'
import { enforceRateLimit } from '@/lib/rate-limit'

/**
 * Developer test bench: run any specialist — including ones not yet switched
 * on for businesses — on the developer's OWN account and wait for its report.
 * It goes through delegateToAgent exactly as the AI Manager's tool call does,
 * so the allow-list, approval gate, cost cap and metering all apply.
 */

export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const dev = await developerOrResponse()
    if (dev instanceof Response) return dev

    const body = (await request.json().catch(() => ({}))) as { agent?: string; brief?: string; background?: boolean }
    if (!getSpecialist(String(body.agent ?? ''))) {
      return Response.json({ error: 'Pick one of the five agents.' }, { status: 400 })
    }
    if (!String(body.brief ?? '').trim()) {
      return Response.json({ error: 'Write a brief: what should the agent do?' }, { status: 400 })
    }

    const limited = await enforceRateLimit(dev.id, 'autonomous', 'agent test runs')
    if (limited) return limited

    const result = await delegateToAgent({ userId: dev.id }, { agent: body.agent, brief: body.brief, background: Boolean(body.background) })
    return Response.json(result)
  } catch (error) {
    return handleError(error, 'The agent run failed')
  }
}
