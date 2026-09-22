import { requireUserId, handleError } from '@/lib/supabase/server'
import { getProfile, upsertProfile, missingProfileFields, type BusinessProfile } from '@/lib/ai/profile'

/**
 * The business profile: language, script, market, audience, tone, defaults.
 *
 * This is the same row the agent reads before it writes a single line of ad
 * copy. Until now it could only be edited by talking to the agent; a business
 * owner also needs to see and change it directly.
 */
export async function GET() {
  try {
    const userId = await requireUserId()
    const profile = await getProfile(userId)
    return Response.json({ profile, missing: missingProfileFields(profile) })
  } catch (error) {
    return handleError(error, 'Failed to load business profile')
  }
}

const STRING_FIELDS = new Set<keyof BusinessProfile>([
  'businessName', 'websiteUrl', 'industry', 'description', 'products', 'usp',
  'primaryLanguage', 'marketCountry', 'currency', 'targetAudience', 'tone', 'avoid',
  'defaultObjective', 'defaultCta', 'landingUrl', 'culturalNotes',
])
const ARRAY_FIELDS = new Set<keyof BusinessProfile>(['secondaryLanguages', 'marketRegions', 'marketCities', 'brandColors'])

export async function PUT(request: Request) {
  try {
    const userId = await requireUserId()
    const body = (await request.json()) as Record<string, unknown>

    const patch: Partial<Omit<BusinessProfile, 'userId'>> = {}
    for (const [key, value] of Object.entries(body)) {
      const k = key as keyof BusinessProfile
      if (STRING_FIELDS.has(k)) {
        if (value === null || typeof value === 'string') (patch as Record<string, unknown>)[k] = value === '' ? null : value
      } else if (ARRAY_FIELDS.has(k)) {
        if (Array.isArray(value)) (patch as Record<string, unknown>)[k] = value.map(String).map((s) => s.trim()).filter(Boolean)
      } else if (k === 'languageMode') {
        if (value === 'single' || value === 'mixed') patch.languageMode = value
      } else if (k === 'onboardingComplete') {
        if (typeof value === 'boolean') patch.onboardingComplete = value
      }
    }

    // Normalise the codes the model keys off.
    if (patch.primaryLanguage) patch.primaryLanguage = patch.primaryLanguage.toLowerCase()
    if (patch.marketCountry) patch.marketCountry = patch.marketCountry.toUpperCase()
    if (patch.currency) patch.currency = patch.currency.toUpperCase()
    // The label must always agree with the code; the code is the source of truth.
    if (patch.primaryLanguage) patch.primaryLanguageLabel = undefined

    const profile = await upsertProfile(userId, patch)
    return Response.json({ profile, missing: missingProfileFields(profile) })
  } catch (error) {
    return handleError(error, 'Failed to save business profile')
  }
}
