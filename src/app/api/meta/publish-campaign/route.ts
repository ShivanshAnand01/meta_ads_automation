import { requireUserId, handleError } from '@/lib/supabase/server'
import { publishFullCampaign } from '@/lib/meta/publish'
import { checkBudget } from '@/lib/ai/budget-guard'
import { enforceRateLimit } from '@/lib/rate-limit'

// Publishing walks Graph several times (campaign, ad set, creatives, ads).
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()

    const limited = await enforceRateLimit(userId, 'metaSync', 'publish requests')
    if (limited) return limited

    const body = (await request.json()) as {
      campaignId?: string
      creativeIds?: string[]
      linkUrl?: string
      pageId?: string
      pixelId?: string
      conversionEvent?: string
      activate?: boolean
      targeting?: Record<string, unknown>
    }

    if (!body.campaignId) {
      return Response.json({ error: 'campaignId is required' }, { status: 400 })
    }

    // Budget caps are enforced here too, not only in the agent path — a user
    // clicking Publish in the UI is just as capable of blowing the cap.
    const budget = await checkBudget(userId, 'publish_full_campaign', {
      ...body,
    } as Record<string, unknown>)
    if (!budget.allowed) {
      return Response.json({ error: budget.reason, blocked: 'budget_guardrail' }, { status: 422 })
    }

    const result = await publishFullCampaign({
      userId,
      campaignId: body.campaignId,
      creativeIds: body.creativeIds,
      linkUrl: body.linkUrl,
      pageId: body.pageId,
      pixelId: body.pixelId,
      conversionEvent: body.conversionEvent,
      activate: Boolean(body.activate),
      targeting: body.targeting as never,
    })

    return Response.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    return handleError(error, 'Failed to publish campaign')
  }
}
