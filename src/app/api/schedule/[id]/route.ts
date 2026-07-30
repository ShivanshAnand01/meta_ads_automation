import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/schedule/[id]'>
) {
  try {
    await requireUserId()
    const { id } = await ctx.params
    const body = await request.json()

    const existing = await db.scheduledJob.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Scheduled job not found' }, { status: 404 })
    }

    const updated = await db.scheduledJob.update({
      where: { id },
      data: {
        type: body.type,
        campaignId: body.campaignId,
        cronExpression: body.cronExpression,
        status: body.status,
        config: body.config,
        nextRunAt: body.nextRunAt ? new Date(body.nextRunAt) : undefined,
        lastRunAt: body.lastRunAt ? new Date(body.lastRunAt) : undefined,
      },
    })

    return Response.json({ job: updated })
  } catch (error) {
    return handleError(error, 'Failed to update scheduled job')
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/schedule/[id]'>
) {
  try {
    await requireUserId()
    const { id } = await ctx.params

    const existing = await db.scheduledJob.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Scheduled job not found' }, { status: 404 })
    }

    await db.scheduledJob.delete({ where: { id } })

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete scheduled job')
  }
}
