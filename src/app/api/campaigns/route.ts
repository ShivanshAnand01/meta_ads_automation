import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function GET() {
  try {
    const userId = await requireUserId()

    const campaigns = await db.campaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { adCreatives: true } },
      },
    })

    return Response.json({ campaigns })
  } catch (error) {
    return handleError(error, 'Failed to fetch campaigns')
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()

    if (!body.name || !body.objective || body.budget == null) {
      return Response.json(
        { error: 'name, objective, and budget are required' },
        { status: 400 }
      )
    }

    const campaign = await db.campaign.create({
      data: {
        userId,
        name: body.name,
        objective: body.objective,
        status: body.status ?? 'draft',
        budget: body.budget,
        budgetType: body.budgetType ?? 'daily',
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        metaCampaignId: body.metaCampaignId ?? null,
      },
    })

    return Response.json({ campaign }, { status: 201 })
  } catch (error) {
    return handleError(error, 'Failed to create campaign')
  }
}
