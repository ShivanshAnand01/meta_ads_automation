import { getScopedSupabase } from '@/lib/db/supabase-db'

/**
 * Business profile — the per-user facts every prompt is written against.
 *
 * Nothing about language, script, market or currency is hardcoded anywhere
 * else. If a prompt needs to know what language to write in, it reads it from
 * here. If it needs a currency symbol, it reads it from here. The first
 * customer was a Marathi ebook seller in Maharashtra; the second might be a
 * Tamil restaurant in Chennai or an English SaaS in Bangalore, and the agent
 * has to be equally right for all of them.
 */

export type { LanguageMode } from './profile-constants'
export { LANGUAGES, languageLabel, currencySymbol, formatMoney } from './profile-constants'
import { languageLabel, currencySymbol, type LanguageMode } from './profile-constants'

export interface BusinessProfile {
  userId: string
  businessName: string | null
  websiteUrl: string | null
  industry: string | null
  description: string | null
  products: string | null
  usp: string | null
  primaryLanguage: string
  primaryLanguageLabel: string
  secondaryLanguages: string[]
  languageMode: LanguageMode
  marketCountry: string
  marketRegions: string[]
  marketCities: string[]
  currency: string
  targetAudience: string | null
  tone: string | null
  brandColors: string[]
  avoid: string | null
  defaultObjective: string | null
  defaultCta: string | null
  landingUrl: string | null
  culturalNotes: string | null
  onboardingComplete: boolean
}

export const DEFAULT_PROFILE: Omit<BusinessProfile, 'userId'> = {
  businessName: null,
  websiteUrl: null,
  industry: null,
  description: null,
  products: null,
  usp: null,
  primaryLanguage: 'en',
  primaryLanguageLabel: 'English',
  secondaryLanguages: [],
  languageMode: 'single',
  marketCountry: 'IN',
  marketRegions: [],
  marketCities: [],
  currency: 'INR',
  targetAudience: null,
  tone: null,
  brandColors: [],
  avoid: null,
  defaultObjective: null,
  defaultCta: null,
  landingUrl: null,
  culturalNotes: null,
  onboardingComplete: false,
}

// ── Persistence ───────────────────────────────────────────────────────────

function rowToProfile(userId: string, row: Record<string, unknown> | null): BusinessProfile {
  if (!row) return { userId, ...DEFAULT_PROFILE }
  return {
    userId,
    businessName: (row.business_name as string) ?? null,
    websiteUrl: (row.website_url as string) ?? null,
    industry: (row.industry as string) ?? null,
    description: (row.description as string) ?? null,
    products: (row.products as string) ?? null,
    usp: (row.usp as string) ?? null,
    primaryLanguage: (row.primary_language as string) || 'en',
    primaryLanguageLabel: (row.primary_language_label as string) || languageLabel((row.primary_language as string) || 'en'),
    secondaryLanguages: (row.secondary_languages as string[]) ?? [],
    languageMode: ((row.language_mode as LanguageMode) || 'single'),
    marketCountry: (row.market_country as string) || 'IN',
    marketRegions: (row.market_regions as string[]) ?? [],
    marketCities: (row.market_cities as string[]) ?? [],
    currency: (row.currency as string) || 'INR',
    targetAudience: (row.target_audience as string) ?? null,
    tone: (row.tone as string) ?? null,
    brandColors: (row.brand_colors as string[]) ?? [],
    avoid: (row.avoid as string) ?? null,
    defaultObjective: (row.default_objective as string) ?? null,
    defaultCta: (row.default_cta as string) ?? null,
    landingUrl: (row.landing_url as string) ?? null,
    culturalNotes: (row.cultural_notes as string) ?? null,
    onboardingComplete: Boolean(row.onboarding_complete),
  }
}

export async function getProfile(userId: string): Promise<BusinessProfile> {
  const supabase = await getScopedSupabase()
  const { data } = await supabase.from('business_profiles').select('*').eq('user_id', userId).maybeSingle()
  return rowToProfile(userId, (data as Record<string, unknown>) ?? null)
}

const PATCHABLE: Record<keyof Omit<BusinessProfile, 'userId'>, string> = {
  businessName: 'business_name',
  websiteUrl: 'website_url',
  industry: 'industry',
  description: 'description',
  products: 'products',
  usp: 'usp',
  primaryLanguage: 'primary_language',
  primaryLanguageLabel: 'primary_language_label',
  secondaryLanguages: 'secondary_languages',
  languageMode: 'language_mode',
  marketCountry: 'market_country',
  marketRegions: 'market_regions',
  marketCities: 'market_cities',
  currency: 'currency',
  targetAudience: 'target_audience',
  tone: 'tone',
  brandColors: 'brand_colors',
  avoid: 'avoid',
  defaultObjective: 'default_objective',
  defaultCta: 'default_cta',
  landingUrl: 'landing_url',
  culturalNotes: 'cultural_notes',
  onboardingComplete: 'onboarding_complete',
}

export async function upsertProfile(
  userId: string,
  patch: Partial<Omit<BusinessProfile, 'userId'>>,
): Promise<BusinessProfile> {
  const row: Record<string, unknown> = { user_id: userId }
  for (const [key, column] of Object.entries(PATCHABLE) as Array<[keyof typeof PATCHABLE, string]>) {
    if (patch[key] !== undefined) row[column] = patch[key]
  }
  // Setting a language code without a label fills the label in, so the
  // prompt always has the precise script instruction.
  if (patch.primaryLanguage && !patch.primaryLanguageLabel) {
    row.primary_language_label = languageLabel(patch.primaryLanguage)
  }

  const supabase = await getScopedSupabase()
  const { data, error } = await supabase
    .from('business_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error) throw new Error(`business_profiles upsert: ${error.message}`)
  return rowToProfile(userId, data as Record<string, unknown>)
}

// ── Prompt context ────────────────────────────────────────────────────────

/**
 * What's still unknown. The agent asks for these during onboarding, one at a
 * time, and stops asking once they are filled.
 */
export function missingProfileFields(p: BusinessProfile): string[] {
  const missing: string[] = []
  if (!p.businessName) missing.push('business name')
  if (!p.description && !p.products) missing.push('what the business sells')
  if (!p.websiteUrl) missing.push('website URL (for the knowledge base)')
  if (!p.targetAudience) missing.push('who the customers are')
  if (p.marketRegions.length === 0 && p.marketCities.length === 0) missing.push('which regions or cities to target')
  if (!p.landingUrl) missing.push('landing page URL for ads')
  return missing
}

/** The block every system prompt carries. */
export function buildProfileContext(p: BusinessProfile): string {
  const lines: string[] = ['BUSINESS PROFILE (write every piece of copy against this — never assume a language or market):']
  lines.push(`- Business: ${p.businessName ?? 'unknown'}${p.industry ? ` (${p.industry})` : ''}`)
  if (p.description) lines.push(`- What they do: ${p.description}`)
  if (p.products) lines.push(`- Products / offers: ${p.products}`)
  if (p.usp) lines.push(`- Why customers choose them: ${p.usp}`)
  if (p.websiteUrl) lines.push(`- Website: ${p.websiteUrl}`)

  const langLine =
    p.languageMode === 'mixed' && p.secondaryLanguages.length
      ? `${p.primaryLanguageLabel}, code-switching naturally with ${p.secondaryLanguages.map(languageLabel).join(' and ')} the way local advertising does`
      : p.primaryLanguageLabel
  lines.push(`- AD COPY LANGUAGE: ${langLine}. Headlines and primary text MUST be in this language and script.`)
  if (p.secondaryLanguages.length && p.languageMode === 'single') {
    lines.push(`- Also understands: ${p.secondaryLanguages.map(languageLabel).join(', ')} (use only if the client asks)`)
  }

  const where = [...p.marketRegions, ...p.marketCities].filter(Boolean)
  lines.push(`- Market: ${where.length ? where.join(', ') + ', ' : ''}${p.marketCountry}. Currency: ${p.currency} (${currencySymbol(p.currency).trim() || p.currency}).`)
  if (p.targetAudience) lines.push(`- Target audience: ${p.targetAudience}`)
  if (p.tone) lines.push(`- Tone of voice: ${p.tone}`)
  if (p.culturalNotes) lines.push(`- Cultural notes: ${p.culturalNotes}`)
  if (p.avoid) lines.push(`- NEVER: ${p.avoid}`)
  if (p.brandColors.length) lines.push(`- Brand colours: ${p.brandColors.join(', ')}`)
  if (p.defaultObjective) lines.push(`- Default campaign objective: ${p.defaultObjective}`)
  if (p.defaultCta) lines.push(`- Default call to action: ${p.defaultCta}`)
  if (p.landingUrl) lines.push(`- Landing page for ads: ${p.landingUrl}`)

  const missing = missingProfileFields(p)
  if (missing.length) {
    lines.push(`- STILL UNKNOWN: ${missing.join('; ')}. Ask for these (one at a time) before building campaigns or creatives.`)
  }
  return lines.join('\n')
}
