import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

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
