import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { CronExpressionParser } from 'cron-parser'

type Routine = 'morning_optimization' | 'budget_pacing' | 'anomaly_detection' | 'weekly_report' | 'reflection' | 'custom'

const ROUTINES: Routine[] = ['morning_optimization', 'budget_pacing', 'anomaly_detection', 'weekly_report', 'reflection', 'custom']

function isValidCron(expr: unknown): boolean {
  if (typeof expr !== 'string') return false
  try {
    CronExpressionParser.parse(expr)
    return true
  } catch {
    return false
  }
}

function computeNextRun(cronExpression: string): Date {
  return CronExpressionParser.parse(cronExpression).next().toDate()
}

async function validateCampaignOwnership(campaignId: unknown, userId: string): Promise<boolean> {
  if (campaignId === undefined || campaignId === null) return true
  const campaign = await db.campaign.findUnique({ where: { id: campaignId as string, userId } })
  return campaign != null
}

const EDITABLE_FIELDS = new Set([
  'type',
  'campaignId',
  'cronExpression',
  'status',
  'config',
  'nextRunAt',
  'lastRunAt',
])

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/schedule/[id]'>
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const body = await request.json()

    const existing = await db.scheduledJob.findUnique({ where: { id, userId } })
    if (!existing) {
      return Response.json({ error: 'Scheduled job not found' }, { status: 404 })
    }

    if (body.type && !ROUTINES.includes(body.type as Routine)) {
      return Response.json({ error: 'Invalid routine type' }, { status: 400 })
    }
    if (body.cronExpression && !isValidCron(body.cronExpression)) {
      return Response.json({ error: 'Invalid cron expression' }, { status: 400 })
    }

    if (body.campaignId && !(await validateCampaignOwnership(body.campaignId, userId))) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue
      if (key === 'nextRunAt' || key === 'lastRunAt') {
        data[key] = value ? new Date(value as string) : null
      } else if (key === 'type') {
        data[key] = value
      } else {
        data[key] = value
      }
    }

    if (body.cronExpression && data.nextRunAt == null) {
      data.nextRunAt = computeNextRun(body.cronExpression as string)
    }

    const updated = await db.scheduledJob.update({
      where: { id, userId },
      data,
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
    const userId = await requireUserId()
    const { id } = await ctx.params

    const existing = await db.scheduledJob.findUnique({ where: { id, userId } })
    if (!existing) {
      return Response.json({ error: 'Scheduled job not found' }, { status: 404 })
    }

    await db.scheduledJob.delete({ where: { id, userId } })

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete scheduled job')
  }
}
