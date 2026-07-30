import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/creatives/[id]'>
) {
  try {
    await requireUserId()
    const { id } = await ctx.params
    const body = await request.json()

    const existing = await db.adCreative.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Creative not found' }, { status: 404 })
    }

    const updated = await db.adCreative.update({
      where: { id },
      data: {
        title: body.title,
        description: body.description,
        imageUrl: body.imageUrl,
        primaryText: body.primaryText,
        headline: body.headline,
        callToAction: body.callToAction,
        targeting: body.targeting,
        expectedSpend: body.expectedSpend,
        expectedRoas: body.expectedRoas,
        status: body.status,
        reviewStatus: body.reviewStatus,
        reviewNotes: body.reviewNotes,
        language: body.language,
        audience: body.audience,
        campaignId: body.campaignId,
      },
    })

    return Response.json({ creative: updated })
  } catch (error) {
    return handleError(error, 'Failed to update creative')
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/creatives/[id]'>
) {
  try {
    await requireUserId()
    const { id } = await ctx.params

    const existing = await db.adCreative.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Creative not found' }, { status: 404 })
    }

    await db.adCreative.delete({ where: { id } })

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete creative')
  }
}
