import type { AIProvider, CreativeReview } from './types'
import { generateStructured, creativeReviewSchema } from './structured'
import type { AdCreativeData } from '@/lib/meta/types'

const REVIEW_SYSTEM_PROMPT = `You are an expert Meta Ads reviewer and strategist specializing in the Indian/Maharashtrian market. You evaluate ad creatives based on cultural relevance, emotional appeal, clarity, call-to-action effectiveness, and potential ROAS for the Marathi-speaking audience.

Always respond with valid JSON only, no markdown formatting or additional text.`

export async function reviewCreative(
  provider: AIProvider,
  creative: AdCreativeData,
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    spend: number
  }
): Promise<CreativeReview> {
  const prompt = `Review this Meta Ads creative for the Maharashtrian audience:

Creative Details:
- Title: ${creative.title}
- Description: ${creative.description}
- Primary Text: ${creative.primaryText || 'N/A'}
- Headline: ${creative.headline || 'N/A'}
- Call to Action: ${creative.callToAction || 'N/A'}
- Targeting: ${creative.targeting || 'N/A'}
- Expected Spend: ₹${creative.expectedSpend || 'N/A'}
- Expected ROAS: ${creative.expectedRoas || 'N/A'}
- Language: ${creative.language}
- Audience: ${creative.audience || 'N/A'}

${performance ? `
Actual Performance:
- Impressions: ${performance.impressions}
- Clicks: ${performance.clicks}
- Conversions: ${performance.conversions}
- Spend: ₹${performance.spend}
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

  return generateStructured(provider, creativeReviewSchema, prompt, REVIEW_SYSTEM_PROMPT)
}

export async function generatePerformanceReport(
  provider: AIProvider,
  creatives: AdCreativeData[],
  totalSpend: number,
  totalConversions: number
): Promise<string> {
  const creativesSummary = creatives
    .map(
      (c, i) =>
        `Creative ${i + 1}: ${c.title} | Spend: ₹${c.actualSpend || 0} | ROAS: ${c.actualRoas || 0} | Status: ${c.reviewStatus}`
    )
    .join('\n')

  // Portfolio ROAS is total revenue / total spend. Averaging per-creative
  // ROAS weights a ₹100 creative the same as a ₹100,000 one and produces a
  // number that is simply wrong.
  const totalRevenue = creatives.reduce((sum, c) => sum + (c.actualSpend || 0) * (c.actualRoas || 0), 0)
  const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0

  const prompt = `Analyze the following Meta Ads campaign performance for a Marathi ebook marketing campaign targeting Maharashtra:

Total Spend: ₹${totalSpend}
Total Conversions: ${totalConversions}
${totalRevenue > 0 ? `Overall ROAS: ${overallRoas.toFixed(2)}x (total revenue ₹${totalRevenue.toFixed(0)} / total spend)` : 'Overall ROAS: N/A (no revenue tracked)'}

Individual Creative Performance:
${creativesSummary}

Provide a comprehensive performance report in simple, easy-to-understand language that a non-technical business owner can understand. Include:
1. Overall performance summary
2. What worked well
3. What needs improvement
4. Recommendations for next steps

Write the report in a mix of English and Marathi where appropriate.`

  return provider.generateCompletion(prompt, REVIEW_SYSTEM_PROMPT)
}

