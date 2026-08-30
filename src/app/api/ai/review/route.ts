import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { createAIProvider } from '@/lib/ai/factory'
import { reviewCreative } from '@/lib/ai/creative-reviewer'
import { resolveSecrets, SECRET_KEYS } from '@/lib/secrets'
import type { AIProviderType } from '@/lib/ai/types'
import type { AdCreativeData } from '@/lib/meta/types'

// Vercel kills a function at its maxDuration. Without this the default
// (10s Hobby / 15s Pro) truncates long AI work mid-stream.
import { enforceRateLimit } from '@/lib/rate-limit'

export const maxDuration = 60


export async function POST(request: Request) {
  try {
    const userId = await requireUserId()

    const limited = await enforceRateLimit(userId, 'aiGenerate', 'AI reviews')
    if (limited) return limited
    const body = await request.json()

    const rawSettings = await db.aiSettings.findUnique({ where: { userId } }) as
      | { provider: string; apiKey: string | null; model: string; baseUrl: string | null }
      | null

    if (!rawSettings) {
      return Response.json(
        { error: 'AI not configured' },
        { status: 400 }
      )
    }

    const settings = await resolveSecrets(rawSettings, [
      { column: 'apiKey', vaultKey: SECRET_KEYS.aiApiKey },
    ])

    const provider = createAIProvider(settings.provider as AIProviderType, {
      apiKey: settings.apiKey || undefined,
      model: settings.model,
      baseUrl: settings.baseUrl || undefined,
    })

    let creativeData: AdCreativeData
    let performance: {
      impressions: number
      clicks: number
      conversions: number
      spend: number
    } | undefined

    if (body.creativeId) {
      const creative = await db.adCreative.findUnique({
        where: { id: body.creativeId as string, userId },
      }) as Record<string, unknown> | null

      if (!creative) {
        return Response.json(
          { error: 'Creative not found' },
          { status: 404 }
        )
      }

      creativeData = {
        title: creative.title as string,
        description: creative.description as string,
        primaryText: (creative.primaryText as string) || '',
        headline: (creative.headline as string) || '',
        callToAction: (creative.callToAction as string) || '',
        targeting: (creative.targeting as string) || '',
        expectedSpend: (creative.expectedSpend as number) || 0,
        expectedRoas: (creative.expectedRoas as number) || 0,
        language: creative.language as string,
        audience: (creative.audience as string) || '',
      }

      if (
        creative.impressions != null &&
        creative.clicks != null &&
        creative.conversions != null &&
        creative.actualSpend != null
      ) {
        performance = {
          impressions: creative.impressions as number,
          clicks: creative.clicks as number,
          conversions: creative.conversions as number,
          spend: creative.actualSpend as number,
        }
      }
    } else {
      creativeData = body.creative as AdCreativeData
    }

    const review = await reviewCreative(provider, creativeData, performance)

    if (body.creativeId) {
      await db.adCreative.update({
        where: { id: body.creativeId as string, userId },
        data: {
          reviewStatus: 'verified',
          reviewNotes: `Score: ${review.score}/100`,
        },
      })
    }

    return Response.json({ review })
  } catch (error) {
    return handleError(error, 'Failed to review creative')
  }
}
