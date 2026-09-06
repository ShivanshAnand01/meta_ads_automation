import type { AIProvider, CreativeSuggestion } from './types'
import {
  generateStructured,
  creativeSuggestionSchema,
  creativeSuggestionListSchema,
  enforceCopyLimits,
} from './structured'
import type { AdCreativeData } from '@/lib/meta/types'
import { DEFAULT_PROFILE, buildProfileContext, currencySymbol, type BusinessProfile } from './profile'

/**
 * Built per call from the business profile. Language, script, market and
 * currency are never literals here - the first customer was Marathi in
 * Maharashtra; the next may not be.
 */
function systemPrompt(profile: BusinessProfile): string {
  const where = [...profile.marketRegions, ...profile.marketCities, profile.marketCountry].filter(Boolean).join(', ')
  const mixed = profile.languageMode === 'mixed' && profile.secondaryLanguages.length
    ? ` (code-switching naturally with ${profile.secondaryLanguages.join(', ')}, the way local advertising does)` : ''
  return `You are an expert digital marketing strategist specializing in Meta (Facebook/Instagram) Ads. You write ad copy in ${profile.primaryLanguageLabel}${mixed} for ${where}, and you understand that market's culture, festivals and consumer behaviour deeply.

${buildProfileContext(profile)}

Always respond with valid JSON only, no markdown formatting or additional text.`
}

function langLine(profile: BusinessProfile): string {
  return `The primaryText and headline MUST be written in ${profile.primaryLanguageLabel}. The title and description are in English, for management purposes.`
}

export async function generateCreativeSuggestion(
  provider: AIProvider,
  context: {
    productType: string
    productName: string
    productDescription: string
    targetAudience: string
    budget: number
    pastPerformance?: string
  },
  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },
): Promise<CreativeSuggestion> {
  const cur = currencySymbol(profile.currency)
  const prompt = `Generate a Meta Ads creative suggestion for the following product:

Product Type: ${context.productType}
Product Name: ${context.productName}
Product Description: ${context.productDescription}
Target Audience: ${context.targetAudience}
Budget: ${cur}${context.budget}
${context.pastPerformance ? `Past Performance Data: ${context.pastPerformance}` : ''}

Create an ad creative for the audience in the profile. ${langLine(profile)}

Respond with this JSON format:
{
  "title": "Creative name for management purposes (English)",
  "description": "Brief description of the creative strategy (English)",
  "primaryText": "The main ad copy text in the profile language",
  "headline": "Catchy headline in the profile language",
  "callToAction": "CALL_TO_ACTION type (e.g., SHOP_NOW, LEARN_MORE, DOWNLOAD, SIGN_UP, BUY_NOW)",
  "targeting": "Targeting description for the profile market",
  "expectedRoas": number (expected return on ad spend, e.g., 2.5),
  "reasoning": "Why this creative will work for this audience (English)"
}`

  const parsed = await generateStructured(provider, creativeSuggestionSchema, prompt, systemPrompt(profile))
  return enforceCopyLimits(parsed) as unknown as CreativeSuggestion
}

export async function generateMultipleCreativeSuggestions(
  provider: AIProvider,
  context: {
    productType: string
    productName: string
    productDescription: string
    targetAudience: string
    budget: number
    count: number
    pastPerformance?: string
  },
  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },
): Promise<CreativeSuggestion[]> {
  const cur = currencySymbol(profile.currency)
  const prompt = `Generate ${context.count} different Meta Ads creative suggestions for the following product:

Product Type: ${context.productType}
Product Name: ${context.productName}
Product Description: ${context.productDescription}
Target Audience: ${context.targetAudience}
Budget: ${cur}${context.budget}
${context.pastPerformance ? `Past Performance Data: ${context.pastPerformance}` : ''}

Create ${context.count} unique ad creative variations for the audience in the profile. Each should have a different angle (e.g., emotional appeal, scarcity, social proof, festival-themed, benefit-driven). ${langLine(profile)}

Respond with this JSON format:
{
  "creatives": [
    {
      "title": "Creative name for management (English)",
      "description": "Brief description of the strategy (English)",
      "primaryText": "Main ad copy in the profile language",
      "headline": "Catchy headline in the profile language",
      "callToAction": "CALL_TO_ACTION type",
      "targeting": "Targeting description",
      "expectedRoas": number,
      "reasoning": "Why this will work (English)"
    }
  ]
}`

  const parsed = await generateStructured(provider, creativeSuggestionListSchema, prompt, systemPrompt(profile))
  return parsed.creatives.map((c) => enforceCopyLimits(c)) as unknown as CreativeSuggestion[]
}

export async function suggestCreativeImprovements(
  provider: AIProvider,
  creative: AdCreativeData,
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    spend: number
  },
  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },
): Promise<CreativeSuggestion> {
  const cur = currencySymbol(profile.currency)
  const prompt = `Analyze and suggest improvements for this Meta Ads creative:

Current Creative:
- Title: ${creative.title}
- Description: ${creative.description}
- Primary Text: ${creative.primaryText || 'N/A'}
- Headline: ${creative.headline || 'N/A'}
- Call to Action: ${creative.callToAction || 'N/A'}
- Targeting: ${creative.targeting || 'N/A'}
- Language: ${creative.language}

${performance ? `
Past Performance:
- Impressions: ${performance.impressions}
- Clicks: ${performance.clicks}
- Conversions: ${performance.conversions}
- Spend: ${cur}${performance.spend}
- CTR: ${performance.impressions ? ((performance.clicks / performance.impressions) * 100).toFixed(2) : 0}%
- Conversion Rate: ${performance.clicks ? ((performance.conversions / performance.clicks) * 100).toFixed(2) : 0}%
` : ''}

Based on this analysis, create an improved version of the creative. ${langLine(profile)}

Respond with this JSON format:
{
  "title": "Improved creative name (English)",
  "description": "What was changed and why (English)",
  "primaryText": "Improved ad copy in the profile language",
  "headline": "Improved headline in the profile language",
  "callToAction": "CALL_TO_ACTION type",
  "targeting": "Improved targeting description",
  "expectedRoas": number,
  "reasoning": "Why these changes will improve performance (English)"
}`

  const parsed = await generateStructured(provider, creativeSuggestionSchema, prompt, systemPrompt(profile))
  return enforceCopyLimits(parsed) as unknown as CreativeSuggestion
}

