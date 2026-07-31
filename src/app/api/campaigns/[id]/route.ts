import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

const EDITABLE_FIELDS = new Set([
  'name',
  'objective',
  'status',
  'budget',
  'budgetType',
  'startDate',
  'endDate',
])

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/campaigns/[id]'>
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const body = await request.json()

    const existing = await db.campaign.findUnique({ where: { id, userId } })
    if (!existing) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue
      if (key === 'startDate' || key === 'endDate') {
        data[key] = value ? new Date(value as string) : null
      } else {
        data[key] = value
      }
    }

    const updated = await db.campaign.update({
      where: { id, userId },
      data,
    })

    return Response.json({ campaign: updated })
  } catch (error) {
    return handleError(error, 'Failed to update campaign')
  }
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<'/api/campaigns/[id]'>
) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params

    const existing = await db.campaign.findUnique({ where: { id, userId } })
    if (!existing) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 })
    }

    await db.campaign.delete({ where: { id, userId } })

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete campaign')
  }
}
