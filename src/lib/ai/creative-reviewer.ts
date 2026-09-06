import type { AIProvider, CreativeReview } from './types'
import { generateStructured, creativeReviewSchema } from './structured'
import { DEFAULT_PROFILE, buildProfileContext, currencySymbol, type BusinessProfile } from './profile'
import type { AdCreativeData } from '@/lib/meta/types'

function reviewSystemPrompt(profile: BusinessProfile): string {
  const where = [...profile.marketRegions, ...profile.marketCities, profile.marketCountry].filter(Boolean).join(', ')
  return `You are an expert Meta Ads reviewer and strategist for ${where}. You evaluate ad creatives written in ${profile.primaryLanguageLabel} on cultural relevance, emotional appeal, clarity, call-to-action effectiveness, and potential ROAS for this audience.

${buildProfileContext(profile)}

Always respond with valid JSON only, no markdown formatting or additional text.`
}

export async function reviewCreative(
  provider: AIProvider,
  creative: AdCreativeData,
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    spend: number
  },
  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },
): Promise<CreativeReview> {
  const cur = currencySymbol(profile.currency)
  const prompt = `Review this Meta Ads creative for the audience in the profile:

Creative Details:
- Title: ${creative.title}
- Description: ${creative.description}
- Primary Text: ${creative.primaryText || 'N/A'}
- Headline: ${creative.headline || 'N/A'}
- Call to Action: ${creative.callToAction || 'N/A'}
- Targeting: ${creative.targeting || 'N/A'}
- Expected Spend: ${cur}${creative.expectedSpend || 'N/A'}
- Expected ROAS: ${creative.expectedRoas || 'N/A'}
- Language: ${creative.language}
- Audience: ${creative.audience || 'N/A'}

${performance ? `
Actual Performance:
- Impressions: ${performance.impressions}
- Clicks: ${performance.clicks}
- Conversions: ${performance.conversions}
- Spend: ${cur}${performance.spend}
- CTR: ${performance.impressions ? ((performance.clicks / performance.impressions) * 100).toFixed(2) : 0}%
- Actual ROAS: ${creative.actualRoas != null ? creative.actualRoas.toFixed(2) : 'N/A'}x
` : ''}

Provide a comprehensive review with a score (0-100), strengths, weaknesses, and actionable suggestions.

Respond with this JSON format:
{
  "score": number (0-100),
  "strengths": ["strength1", "strength2", ...],
  "weaknesses": ["weakness1", "weakness2", ...],
  "suggestions": ["suggestion1", "suggestion2", ...],
  "recommendedChanges": ["change1", "change2", ...]
}`

  return generateStructured(provider, creativeReviewSchema, prompt, reviewSystemPrompt(profile))
}

export async function generatePerformanceReport(
  provider: AIProvider,
  creatives: AdCreativeData[],
  totalSpend: number,
  totalConversions: number,
  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },
): Promise<string> {
  const cur = currencySymbol(profile.currency)
  const creativesSummary = creatives
    .map(
      (c, i) =>
        `Creative ${i + 1}: ${c.title} | Spend: ${cur}${c.actualSpend || 0} | ROAS: ${c.actualRoas || 0} | Status: ${c.reviewStatus}`
    )
    .join('\n')

  // Portfolio ROAS is total revenue / total spend. Averaging per-creative
  // ROAS weights a ₹100 creative the same as a ₹100,000 one and produces a
  // number that is simply wrong.
  const totalRevenue = creatives.reduce((sum, c) => sum + (c.actualSpend || 0) * (c.actualRoas || 0), 0)
  const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0

  const prompt = `Analyze the following Meta Ads campaign performance for this business:

Total Spend: ${cur}${totalSpend}
Total Conversions: ${totalConversions}
${totalRevenue > 0 ? `Overall ROAS: ${overallRoas.toFixed(2)}x (total revenue ${cur}${totalRevenue.toFixed(0)} / total spend)` : 'Overall ROAS: N/A (no revenue tracked)'}

Individual Creative Performance:
${creativesSummary}

Provide a comprehensive performance report in simple, easy-to-understand language that a non-technical business owner can understand. Include:
1. Overall performance summary
2. What worked well
3. What needs improvement
4. Recommendations for next steps

Write the report in English, with key phrases in ${profile.primaryLanguageLabel} where it helps the owner.`

  return provider.generateCompletion(prompt, reviewSystemPrompt(profile))
}

