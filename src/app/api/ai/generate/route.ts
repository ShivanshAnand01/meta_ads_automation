import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError, getSupabaseServer } from '@/lib/supabase/server'
import { createAIProvider } from '@/lib/ai/factory'
import { generateCreativeSuggestion, generateMultipleCreativeSuggestions } from '@/lib/ai/creative-generator'
import { generateAdImage, saveImageToStorage, type AspectRatio } from '@/lib/ai/image-generator'
import { resolveSecrets, SECRET_KEYS } from '@/lib/secrets'
import { enforceRateLimit } from '@/lib/rate-limit'
import { StructuredOutputError } from '@/lib/ai/structured'
import type { AIProviderType } from '@/lib/ai/types'

// Vercel kills a function at its maxDuration. Copy plus images for several
// variations needs real headroom.
export const maxDuration = 300

const VALID_RATIOS: AspectRatio[] = ['1:1', '4:5', '9:16', '1.91:1', '16:9']

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()

    const limited = await enforceRateLimit(userId, 'aiGenerate', 'creative generations')
    if (limited) return limited

    const body = await request.json()
    const {
      productType,
      productName,
      productDescription,
      targetAudience,
      budget,
      count = 1,
      pastPerformance,
      // Images default ON. The Creatives page used to produce copy with no
      // image at all, which is half a creative — the client's most obvious
      // entry point silently produced something unusable.
      withImages = true,
      aspectRatio = '4:5',
      brandColors,
    } = body as {
      productType: string
      productName: string
      productDescription: string
      targetAudience: string
      budget: number
      count?: number
      pastPerformance?: string
      withImages?: boolean
      aspectRatio?: AspectRatio
      brandColors?: string[]
    }

    if (!productType || !productName || !productDescription) {
      return Response.json(
        { error: 'productType, productName, and productDescription are required' },
        { status: 400 },
      )
    }

    const safeCount = Math.max(1, Math.min(Number(count) || 1, 5))
    const ratio: AspectRatio = VALID_RATIOS.includes(aspectRatio) ? aspectRatio : '4:5'

    type AiSettings = {
      provider: string
      apiKey: string | null
      model: string
      baseUrl: string | null
      embeddingKey: string | null
    }

    const stored = (await db.aiSettings.findUnique({ where: { userId } })) as AiSettings | null
    if (!stored) {
      return Response.json({ error: 'AI is not configured. Set up your AI brain in Settings first.' }, { status: 400 })
    }

    const settings = await resolveSecrets<AiSettings>(stored, [
      { column: 'apiKey', vaultKey: SECRET_KEYS.aiApiKey },
      { column: 'embeddingKey', vaultKey: SECRET_KEYS.aiEmbeddingKey },
    ])

    const provider = createAIProvider(settings.provider as AIProviderType, {
      apiKey: settings.apiKey || undefined,
      model: settings.model,
      baseUrl: settings.baseUrl || undefined,
    })

    // Image generation always uses an OpenAI key, whichever provider writes
    // the copy.
    const imageApiKey =
      settings.provider === 'openai' ? settings.apiKey : settings.embeddingKey || settings.apiKey

    const context = { productType, productName, productDescription, targetAudience, budget, pastPerformance }

    const suggestions =
      safeCount > 1
        ? await generateMultipleCreativeSuggestions(provider, { ...context, count: safeCount })
        : [await generateCreativeSuggestion(provider, context)]

    const warnings: string[] = []

    // Generate every image concurrently so N creatives cost one wall-clock
    // image, not N sequential ones.
    const images = withImages
      ? await Promise.all(
          suggestions.map(async (s) => {
            const prompt = `${productName}: ${productDescription}. Ad angle: ${s.description || s.title}. Target: ${targetAudience}.`
            const result = await generateAdImage('openai', imageApiKey, prompt, {
              aspectRatio: ratio,
              brandColors,
            })
            if (!result.success || !result.imageUrl) {
              warnings.push(`Image for "${s.title}" failed: ${result.error || 'unknown error'}`)
              return { url: null as string | null, provider: result.provider }
            }
            try {
              const supabase = await getSupabaseServer()
              const saved = await saveImageToStorage(result.imageUrl, userId, supabase as never)
              return { url: saved?.url ?? result.imageUrl, provider: result.provider }
            } catch {
              return { url: result.imageUrl, provider: result.provider }
            }
          }),
        )
      : suggestions.map(() => ({ url: null as string | null, provider: 'none' }))

    const creatives = await Promise.all(
      suggestions.map((s, i) =>
        db.adCreative.create({
          data: {
            userId,
            title: s.title,
            description: s.description,
            primaryText: s.primaryText,
            headline: s.headline,
            callToAction: s.callToAction,
            targeting: s.targeting,
            // Model-estimated, never measured. The UI labels it as such.
            expectedRoas: s.expectedRoas,
            language: 'marathi',
            status: 'draft',
            reviewStatus: 'pending',
            imageUrl: images[i]?.url ?? null,
            imageProvider: images[i]?.provider ?? null,
            aspectRatio: ratio,
          },
        }),
      ),
    )

    return Response.json({
      suggestions,
      creatives,
      warnings,
      imagesGenerated: images.filter((i) => i.url).length,
      note: 'expectedRoas is an AI estimate, not a measurement. Compare it against real ROAS after the ad has run.',
    })
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      return Response.json(
        { error: error.message, hint: 'Try a shorter product description, or switch to a stronger model in Settings.' },
        { status: 502 },
      )
    }
    return handleError(error, 'Failed to generate creative suggestions')
  }
}
