import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { resolveSecrets, SECRET_KEYS } from '@/lib/secrets'
import { enforceRateLimit } from '@/lib/rate-limit'
import { ingestWebsite } from '@/lib/ai/website-ingest'
import { getProfile, upsertProfile } from '@/lib/ai/profile'
import type { AIProviderType } from '@/lib/ai/types'

// Crawling several pages plus embedding each one takes real time.
export const maxDuration = 120

/**
 * Crawl the user's website into their knowledge base, and pre-fill whatever
 * the site already tells us about the business so onboarding does not ask
 * for it again.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId()

    const limited = await enforceRateLimit(userId, 'upload', 'website crawls')
    if (limited) return limited

    const { url } = (await request.json()) as { url?: string }
    if (!url?.trim()) return Response.json({ error: 'url is required' }, { status: 400 })

    type AiSettings = { provider: string; apiKey: string | null; baseUrl: string | null; embeddingKey: string | null }
    let settings = (await db.aiSettings.findUnique({ where: { userId } })) as AiSettings | null
    if (settings) {
      settings = await resolveSecrets<AiSettings>(settings, [
        { column: 'apiKey', vaultKey: SECRET_KEYS.aiApiKey },
        { column: 'embeddingKey', vaultKey: SECRET_KEYS.aiEmbeddingKey },
      ])
    }

    const result = await ingestWebsite({
      userId,
      url: url.trim(),
      provider: (settings?.provider || 'openai') as AIProviderType,
      apiKey: settings?.apiKey ?? null,
      baseUrl: settings?.baseUrl ?? null,
      embeddingKey: settings?.embeddingKey ?? null,
    })

    // Only fill profile fields that are still empty — never overwrite what the
    // user told us with what a meta tag guessed.
    const profile = await getProfile(userId)
    const patch: Parameters<typeof upsertProfile>[1] = {}
    if (!profile.websiteUrl) patch.websiteUrl = url.trim()
    if (!profile.businessName && result.learned.siteTitle) patch.businessName = result.learned.siteTitle.split(/[|–-]/)[0].trim()
    if (!profile.description && result.learned.description) patch.description = result.learned.description
    if (Object.keys(patch).length) await upsertProfile(userId, patch)

    return Response.json({ ...result, profilePrefilled: Object.keys(patch) }, { status: result.success ? 200 : 422 })
  } catch (error) {
    return handleError(error, 'Failed to crawl website')
  }
}
