import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function GET() {
  try {
    const userId = await requireUserId()

    const jobs = await db.scheduledJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    return Response.json({ jobs })
  } catch (error) {
    return handleError(error, 'Failed to fetch scheduled jobs')
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()

    if (!body.type || !body.cronExpression) {
      return Response.json(
        { error: 'type and cronExpression are required' },
        { status: 400 }
      )
    }

    const job = await db.scheduledJob.create({
      data: {
        userId,
        type: body.type,
        campaignId: body.campaignId ?? null,
        cronExpression: body.cronExpression,
        status: body.status ?? 'active',
        config: body.config ?? null,
        nextRunAt: body.nextRunAt ? new Date(body.nextRunAt) : null,
      },
    })

    return Response.json({ job }, { status: 201 })
  } catch (error) {
    return handleError(error, 'Failed to create scheduled job')
  }
}
