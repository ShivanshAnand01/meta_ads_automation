import crypto from 'node:crypto'
import { createSupabaseServiceClient, requireUserId, handleError } from '@/lib/supabase/server'
import { withServiceClient, db } from '@/lib/db/supabase-db'
import { runRoutine, type Routine } from '@/lib/ai/autonomous'

/* eslint-disable @typescript-eslint/no-explicit-any */

const RUNNER_SECRET = process.env.RUNNER_SECRET || ''

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  try {
    const runnerHeader = request.headers.get('x-runner-secret') || ''
    const isRunner = RUNNER_SECRET.length > 0 && constantTimeEqual(runnerHeader, RUNNER_SECRET)

    const body = (await request.json().catch(() => ({}))) as {
      routine?: Routine
      userId?: string
      customPrompt?: string
      jobId?: string
    }
    const routine = (body.routine || 'morning_optimization') as Routine

    // Runner (background scheduler) mode: act on behalf of users using a
    // dedicated secret. The Supabase service-role key is only used to create
    // the service client and never travels as a bearer token.
    if (isRunner) {
      const serviceClient = createSupabaseServiceClient()

      return withServiceClient(serviceClient, async () => {
        let userIds: string[] = []
        if (body.userId) {
          userIds = [body.userId]
        } else {
          // Find users with an active scheduled job of this routine type.
          const jobs = await db.scheduledJob.findMany({
            where: { type: routine, status: 'active' },
          }) as any[]
          userIds = Array.from(new Set(jobs.map((j) => j.userId as string).filter(Boolean)))
        }

        const results: any[] = []
        for (const uid of userIds.slice(0, 10)) {
          try {
            const r = await runRoutine({ userId: uid, routine, customPrompt: body.customPrompt, jobId: body.jobId })
            results.push({ userId: uid, ...r })
          } catch (e) {
            results.push({ userId: uid, success: false, message: e instanceof Error ? e.message : 'failed' })
          }
        }

        return Response.json({ routine, processed: results.length, results })
      })
    }

    // Manual mode: a logged-in user triggers their own routine (useful for testing).
    const userId = await requireUserId()
    const r = await runRoutine({ userId, routine, customPrompt: body.customPrompt, jobId: body.jobId })
    return Response.json({ routine, ...r })
  } catch (error) {
    return handleError(error, 'Failed to run autonomous routine')
  }
}
