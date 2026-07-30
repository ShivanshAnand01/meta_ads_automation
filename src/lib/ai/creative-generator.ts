import type { AIProvider, CreativeSuggestion } from './types'
import type { AdCreativeData } from '@/lib/meta/types'

const SYSTEM_PROMPT = `You are an expert digital marketing strategist specializing in Meta (Facebook/Instagram) Ads for the Indian market, specifically targeting the Maharashtrian audience. You understand Marathi language and culture deeply.

Your expertise includes:
- Creating compelling ad copy in Marathi (Devanagari script)
- Understanding Maharashtrian cultural nuances, festivals, and consumer behavior
- Optimizing for ROAS (Return on Ad Spend) in the Indian market
- Crafting messages that resonate with Marathi-speaking audiences
- Sales ebook marketing and digital product promotion

Always respond with valid JSON only, no markdown formatting or additional text.`

export async function generateCreativeSuggestion(
  provider: AIProvider,
  context: {
    productType: string
    productName: string
    productDescription: string
    targetAudience: string
    budget: number
    pastPerformance?: string
  }
): Promise<CreativeSuggestion> {
  const prompt = `Generate a Meta Ads creative suggestion for the following product:

Product Type: ${context.productType}
Product Name: ${context.productName}
Product Description: ${context.productDescription}
Target Audience: ${context.targetAudience}
Budget: ₹${context.budget}
${context.pastPerformance ? `Past Performance Data: ${context.pastPerformance}` : ''}

Create an ad creative that targets the Maharashtrian audience. The primary text and headline should be in Marathi (Devanagari script). The title and description can be in English for management purposes.

Respond with this JSON format:
{
  "title": "Creative name for management purposes (English)",
  "description": "Brief description of the creative strategy (English)",
  "primaryText": "The main ad copy text in Marathi (Devanagari script)",
  "headline": "Catchy headline in Marathi (Devanagari script)",
  "callToAction": "CALL_TO_ACTION type (e.g., SHOP_NOW, LEARN_MORE, DOWNLOAD, SIGN_UP, BUY_NOW)",
  "targeting": "Targeting description for Maharashtra region",
  "expectedRoas": number (expected return on ad spend, e.g., 2.5),
  "reasoning": "Why this creative will work for the Maharashtrian audience (English)"
}`

  const response = await provider.generateCompletion(prompt, SYSTEM_PROMPT)
  return parseJsonResponse<CreativeSuggestion>(response)
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
  }
): Promise<CreativeSuggestion[]> {
  const prompt = `Generate ${context.count} different Meta Ads creative suggestions for the following product:

Product Type: ${context.productType}
Product Name: ${context.productName}
Product Description: ${context.productDescription}
Target Audience: ${context.targetAudience}
Budget: ₹${context.budget}
${context.pastPerformance ? `Past Performance Data: ${context.pastPerformance}` : ''}

Create ${context.count} unique ad creative variations that target the Maharashtrian audience. Each should have a different angle (e.g., emotional appeal, scarcity, social proof, festival-themed, benefit-driven). The primaryText and headline should be in Marathi (Devanagari script).

Respond with this JSON format:
{
  "creatives": [
    {
      "title": "Creative name for management (English)",
      "description": "Brief description of the strategy (English)",
      "primaryText": "Main ad copy in Marathi (Devanagari)",
      "headline": "Catchy headline in Marathi (Devanagari)",
      "callToAction": "CALL_TO_ACTION type",
      "targeting": "Targeting description",
      "expectedRoas": number,
      "reasoning": "Why this will work (English)"
    }
  ]
}`

  const response = await provider.generateCompletion(prompt, SYSTEM_PROMPT)
  const parsed = parseJsonResponse<{ creatives: CreativeSuggestion[] }>(response)
  return parsed.creatives
}

export async function suggestCreativeImprovements(
  provider: AIProvider,
  creative: AdCreativeData,
  performance?: {
    impressions: number
    clicks: number
    conversions: number
    spend: number
  }
): Promise<CreativeSuggestion> {
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
- Spend: ₹${performance.spend}
- CTR: ${performance.impressions ? ((performance.clicks / performance.impressions) * 100).toFixed(2) : 0}%
- Conversion Rate: ${performance.clicks ? ((performance.conversions / performance.clicks) * 100).toFixed(2) : 0}%
` : ''}

Based on this analysis, create an improved version of the creative. The improved primaryText and headline should be in Marathi (Devanagari script) targeting the Maharashtrian audience.

Respond with this JSON format:
{
  "title": "Improved creative name (English)",
  "description": "What was changed and why (English)",
  "primaryText": "Improved ad copy in Marathi (Devanagari)",
  "headline": "Improved headline in Marathi (Devanagari)",
  "callToAction": "CALL_TO_ACTION type",
  "targeting": "Improved targeting description",
  "expectedRoas": number,
  "reasoning": "Why these changes will improve performance (English)"
}`

  const response = await provider.generateCompletion(prompt, SYSTEM_PROMPT)
  return parseJsonResponse<CreativeSuggestion>(response)
}

function parseJsonResponse<T>(response: string): T {
  let cleaned = response.trim()
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7)
  }
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3)
  }
  cleaned = cleaned.trim()
  return JSON.parse(cleaned) as T
}
