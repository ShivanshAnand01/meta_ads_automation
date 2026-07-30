import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { createAIProvider } from '@/lib/ai/factory'
import {
  generateCreativeSuggestion,
  generateMultipleCreativeSuggestions,
} from '@/lib/ai/creative-generator'
import type { AIProviderType } from '@/lib/ai/types'

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()

    const {
      productType,
      productName,
      productDescription,
      targetAudience,
      budget,
      count = 1,
      pastPerformance,
    } = body as {
      productType: string
      productName: string
      productDescription: string
      targetAudience: string
      budget: number
      count?: number
      pastPerformance?: string
    }

    if (!productType || !productName || !productDescription) {
      return Response.json(
        { error: 'productType, productName, and productDescription are required' },
        { status: 400 }
      )
    }

    const settings = await db.aiSettings.findUnique({ where: { userId } }) as
      | { provider: string; apiKey: string | null; model: string; baseUrl: string | null }
      | null

    if (!settings) {
      return Response.json(
        { error: 'AI not configured' },
        { status: 400 }
      )
    }

    const provider = createAIProvider(settings.provider as AIProviderType, {
      apiKey: settings.apiKey || undefined,
      model: settings.model,
      baseUrl: settings.baseUrl || undefined,
    })

    if (count > 1) {
      const suggestions = await generateMultipleCreativeSuggestions(provider, {
        productType,
        productName,
        productDescription,
        targetAudience,
        budget,
        count,
        pastPerformance,
      })

      const savedCreatives = await Promise.all(
        suggestions.map((s) =>
          db.adCreative.create({
            data: {
              userId,
              title: s.title,
              description: s.description,
              primaryText: s.primaryText,
              headline: s.headline,
              callToAction: s.callToAction,
              targeting: s.targeting,
              expectedRoas: s.expectedRoas,
              language: 'marathi',
              status: 'draft',
              reviewStatus: 'pending',
            },
          })
        )
      )

      return Response.json({ suggestions, creatives: savedCreatives })
    }

    const suggestion = await generateCreativeSuggestion(provider, {
      productType,
      productName,
      productDescription,
      targetAudience,
      budget,
      pastPerformance,
    })

    return Response.json({ suggestion })
  } catch (error) {
    return handleError(error, 'Failed to generate creative suggestions')
  }
}
