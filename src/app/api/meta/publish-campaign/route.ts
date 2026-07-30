import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { getMCPClient } from '@/lib/meta/mcp-client'

export async function POST(request: Request) {
  try {
    await requireUserId()
    const body = await request.json()
    const { campaignId } = body as { campaignId?: string }

    if (!campaignId) {
      return Response.json(
        { error: 'campaignId is required' },
        { status: 400 }
      )
    }

    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
    }) as Record<string, unknown> | null

    if (!campaign) {
      return Response.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    const conn = await db.metaConnection.findUnique({
      where: { userId: campaign.userId as string },
    }) as { adAccountId: string | null } | null

    if (!conn || !conn.adAccountId) {
      return Response.json(
        { error: 'No Meta ad account connected. Please connect and select an ad account first.' },
        { status: 400 }
      )
    }

    const mcp = await getMCPClient()
    const result = await mcp.callTool('create_campaign', {
      account_id: conn.adAccountId,
      name: campaign.name as string,
      objective: campaign.objective as string,
      status: campaign.status === 'active' ? 'ACTIVE' : 'PAUSED',
      daily_budget: campaign.budgetType === 'daily' ? Math.round((campaign.budget as number) * 100) : undefined,
      lifetime_budget: campaign.budgetType === 'lifetime' ? Math.round((campaign.budget as number) * 100) : undefined,
      start_time: campaign.startDate ? new Date(campaign.startDate as string).toISOString() : undefined,
      stop_time: campaign.endDate ? new Date(campaign.endDate as string).toISOString() : undefined,
    })

    if (result.success && result.campaign_id) {
      const updated = await db.campaign.update({
        where: { id: campaignId },
        data: {
          metaCampaignId: result.campaign_id,
          status: 'active',
        },
      })
      return Response.json({
        success: true,
        campaign: updated,
        metaCampaignId: result.campaign_id,
        message: result.message,
      })
    }

    return Response.json(
      { error: result.message || 'Failed to publish campaign to Meta' },
      { status: 500 }
    )
  } catch (error) {
    return handleError(error, 'Failed to publish campaign')
  }
}
