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

    if (!ROUTINES.includes(body.type as Routine)) {
      return Response.json({ error: 'Invalid routine type' }, { status: 400 })
    }

    if (!isValidCron(body.cronExpression)) {
      return Response.json({ error: 'Invalid cron expression' }, { status: 400 })
    }

    if (body.campaignId && !(await validateCampaignOwnership(body.campaignId, userId))) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const nextRunAt = body.nextRunAt
      ? new Date(body.nextRunAt)
      : computeNextRun(body.cronExpression as string)

    const job = await db.scheduledJob.create({
      data: {
        userId,
        type: body.type,
        campaignId: body.campaignId ?? null,
        cronExpression: body.cronExpression,
        status: body.status ?? 'active',
        config: body.config ?? null,
        nextRunAt,
      },
    })

    return Response.json({ job }, { status: 201 })
  } catch (error) {
    return handleError(error, 'Failed to create scheduled job')
  }
}
