import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/campaigns/[id]'>
) {
  try {
    await requireUserId()
    const { id } = await ctx.params
    const body = await request.json()

    const existing = await db.campaign.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const updated = await db.campaign.update({
      where: { id },
      data: {
        name: body.name,
        objective: body.objective,
        status: body.status,
        budget: body.budget,
        budgetType: body.budgetType,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        metaCampaignId: body.metaCampaignId,
        totalSpend: body.totalSpend,
        totalImpressions: body.totalImpressions,
        totalClicks: body.totalClicks,
        totalConversions: body.totalConversions,
      },
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
    await requireUserId()
    const { id } = await ctx.params

    const existing = await db.campaign.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 })
    }

    await db.campaign.delete({ where: { id } })

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete campaign')
  }
}
