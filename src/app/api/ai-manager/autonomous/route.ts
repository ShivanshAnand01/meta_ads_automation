import { createSupabaseServiceClient, hasServiceRoleKey, requireUserId, handleError } from '@/lib/supabase/server'
import { setSupabaseServiceClient, db } from '@/lib/db/supabase-db'
import { runRoutine, type Routine } from '@/lib/ai/autonomous'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  try {
    const serviceRole = request.headers.get('x-service-role')
    const isAdmin = !!serviceRole && !!process.env.SUPABASE_SERVICE_ROLE_KEY && serviceRole === process.env.SUPABASE_SERVICE_ROLE_KEY

    const body = (await request.json().catch(() => ({}))) as {
      routine?: Routine
      userId?: string
      customPrompt?: string
      jobId?: string
    }
    const routine = (body.routine || 'morning_optimization') as Routine

    // Admin (pg_cron / service role) mode: act on behalf of users.
    if (isAdmin) {
      if (!hasServiceRoleKey()) {
        return Response.json({ error: 'Service role not configured' }, { status: 500 })
      }
      const serviceClient = createSupabaseServiceClient()
      setSupabaseServiceClient(serviceClient)

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

      setSupabaseServiceClient(null)
      return Response.json({ routine, processed: results.length, results })
    }

    // Manual mode: a logged-in user triggers their own routine (useful for testing).
    const userId = await requireUserId()
    const r = await runRoutine({ userId, routine, customPrompt: body.customPrompt, jobId: body.jobId })
    return Response.json({ routine, ...r })
  } catch (error) {
    return handleError(error, 'Failed to run autonomous routine')
  }
}
