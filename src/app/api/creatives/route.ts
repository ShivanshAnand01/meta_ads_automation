import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

async function validateCampaignOwnership(campaignId: unknown, userId: string): Promise<boolean> {
  if (campaignId === undefined || campaignId === null) return true
  const campaign = await db.campaign.findUnique({ where: { id: campaignId as string, userId } })
  return campaign != null
}

export async function GET() {
  try {
    const userId = await requireUserId()

    const creatives = await db.adCreative.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { campaign: true },
    })

    return Response.json({ creatives })
  } catch (error) {
    return handleError(error, 'Failed to fetch creatives')
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()

    if (body.campaignId && !(await validateCampaignOwnership(body.campaignId, userId))) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const creative = await db.adCreative.create({
      data: {
        userId,
        title: body.title,
        description: body.description,
        imageUrl: body.imageUrl ?? null,
        primaryText: body.primaryText ?? null,
        headline: body.headline ?? null,
        callToAction: body.callToAction ?? null,
        targeting: body.targeting ?? null,
        expectedSpend: body.expectedSpend ?? null,
        expectedRoas: body.expectedRoas ?? null,
        language: body.language ?? 'marathi',
        audience: body.audience ?? null,
        campaignId: body.campaignId ?? null,
        status: body.status ?? 'draft',
        reviewStatus: body.reviewStatus ?? 'pending',
      },
    })

    return Response.json({ creative }, { status: 201 })
  } catch (error) {
    return handleError(error, 'Failed to create creative')
  }
}
