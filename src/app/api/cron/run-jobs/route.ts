import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { withServiceClient, db } from '@/lib/db/supabase-db'
import { runRoutine, type Routine } from '@/lib/ai/autonomous'
import { CronExpressionParser } from 'cron-parser'
import { isMachineAuthorized } from '@/lib/cron-auth'
import { kickAgentQueue } from '@/lib/ai/agents/runner'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The scheduler tick.
 *
 * Every piece of the autonomous system existed — the jobs table, the runner
 * endpoint, cron-parser computing nextRunAt — but nothing ever called it. The
 * pg_cron block in schema.sql was commented out and the Supabase edge function
 * was never deployed, so scheduled jobs the client created simply never ran.
 *
 * This endpoint is driven by Vercel Cron (see vercel.json). Unlike the old
 * runner, it honours `nextRunAt`: only jobs that are actually DUE run.
 */

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/** Jobs processed per tick. Keeps one invocation inside maxDuration. */
const MAX_JOBS_PER_TICK = 8

function parseJobConfig(raw: unknown): { prompt?: string } {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as { prompt?: string }
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function nextRunFrom(cronExpression?: string | null): Date {
  if (cronExpression) {
    try {
      return CronExpressionParser.parse(cronExpression).next().toDate()
    } catch {
      /* fall through */
    }
  }
  const next = new Date()
  next.setDate(next.getDate() + 1)
  return next
}

async function handle(request: Request): Promise<Response> {
  if (!isMachineAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createSupabaseServiceClient()

  return withServiceClient(serviceClient, async () => {
    const now = new Date()

    const jobs = (await db.scheduledJob.findMany({ where: { status: 'active' } })) as any[]

    // Only run what is actually due. The previous runner enumerated every
    // active job of a routine type and ran them all on each ping, regardless
    // of schedule — a job set to "weekly" would have run hourly.
    const due = jobs
      .filter((job) => {
        if (!job.nextRunAt) return true
        return new Date(job.nextRunAt).getTime() <= now.getTime()
      })
      .sort((a, b) => new Date(a.nextRunAt || 0).getTime() - new Date(b.nextRunAt || 0).getTime())

    const batch = due.slice(0, MAX_JOBS_PER_TICK)
    const results: any[] = []

    for (const job of batch) {
      // Claim the job before running it, so an overlapping tick cannot pick up
      // the same job and double-spend.
      const claimedUntil = nextRunFrom(job.cronExpression)
      try {
        await db.scheduledJob.update({
          where: { id: job.id },
          data: { nextRunAt: claimedUntil, lastRunAt: now },
        })
      } catch (err) {
        results.push({ jobId: job.id, success: false, message: `Could not claim job: ${err instanceof Error ? err.message : 'unknown'}` })
        continue
      }

      try {
        const result = await runRoutine({
          userId: job.userId,
          routine: job.type as Routine,
          // config is a text column holding JSON; reading .prompt off the raw
          // string was always undefined, so custom jobs ran with no prompt.
          customPrompt: parseJobConfig(job.config).prompt,
          jobId: job.id,
        })
        results.push({ jobId: job.id, userId: job.userId, routine: job.type, ...result })
      } catch (err) {
        results.push({
          jobId: job.id,
          userId: job.userId,
          routine: job.type,
          success: false,
          message: err instanceof Error ? err.message : 'Routine threw',
        })
      }
    }

    // Background specialist runs queued since the last tick get their own
    // invocation, so they do not share this one's time budget.
    await kickAgentQueue()

    return Response.json({
      ranAt: now.toISOString(),
      activeJobs: jobs.length,
      dueJobs: due.length,
      processed: batch.length,
      // Say so out loud rather than silently truncating.
      deferred: Math.max(0, due.length - batch.length),
      results,
    })
  })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
