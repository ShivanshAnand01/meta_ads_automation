import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

const EDITABLE_FIELDS = new Set([
  'title',
  'description',
  'imageUrl',
  'primaryText',
  'headline',
  'callToAction',
  'targeting',
  'expectedSpend',
  'expectedRoas',
  'status',
  'reviewStatus',
  'reviewNotes',
  'language',
  'audience',
  'campaignId',
])

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/creatives/[id]'>
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const body = await request.json()

    const existing = await db.adCreative.findUnique({ where: { id, userId } })
    if (!existing) {
      return Response.json({ error: 'Creative not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (EDITABLE_FIELDS.has(key)) data[key] = value
    }

    const updated = await db.adCreative.update({
      where: { id, userId },
      data,
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
    const userId = await requireUserId()
    const { id } = await ctx.params

    const existing = await db.adCreative.findUnique({ where: { id, userId } })
    if (!existing) {
      return Response.json({ error: 'Creative not found' }, { status: 404 })
    }

    await db.adCreative.delete({ where: { id, userId } })

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete creative')
  }
}
