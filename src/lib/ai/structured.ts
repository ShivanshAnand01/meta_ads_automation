import { z } from 'zod'
import type { AIProvider } from './types'

/**
 * Structured LLM output with schema validation and one repair retry.
 *
 * Every JSON path in this codebase used to be a bare `JSON.parse` on raw model
 * output. A single malformed response either threw a 500 at the client or —
 * worse, where it was wrapped in `catch {}` — silently persisted a creative
 * with empty ad copy. Validate, and when it fails, show the model its own
 * error and let it correct itself once.
 */

/** Strip markdown fences and any prose around the JSON body. */
export function extractJson(raw: string): string {
  let text = raw.trim()

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) text = fenced[1].trim()

  // Models sometimes prefix "Here is the JSON:" — take the outermost braces.
  const firstBrace = text.indexOf('{')
  const firstBracket = text.indexOf('[')
  const start =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket)
  if (start > 0) text = text.slice(start)

  const lastBrace = text.lastIndexOf('}')
  const lastBracket = text.lastIndexOf(']')
  const end = Math.max(lastBrace, lastBracket)
  if (end !== -1 && end < text.length - 1) text = text.slice(0, end + 1)

  return text.trim()
}

export class StructuredOutputError extends Error {
  raw: string
  constructor(message: string, raw: string) {
    super(message)
    this.name = 'StructuredOutputError'
    this.raw = raw
  }
}

/**
 * Ask the provider for JSON matching `schema`. On a parse or validation
 * failure, retry once with the error fed back, then give up with a typed
 * error the caller can turn into a useful message.
 */
export async function generateStructured<T>(
  provider: AIProvider,
  schema: z.ZodType<T>,
  prompt: string,
  systemPrompt: string,
): Promise<T> {
  let lastRaw = ''
  let lastError = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    const fullPrompt =
      attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous response could not be used. Error: ${lastError}\nPrevious response:\n${lastRaw.slice(0, 800)}\n\nReturn ONLY valid JSON matching the requested shape. No markdown, no commentary.`

    const raw = await provider.generateCompletion(fullPrompt, systemPrompt)
    lastRaw = raw

    let parsed: unknown
    try {
      parsed = JSON.parse(extractJson(raw))
    } catch (err) {
      lastError = `Response was not valid JSON (${err instanceof Error ? err.message : 'parse error'}).`
      continue
    }

    const result = schema.safeParse(parsed)
    if (result.success) return result.data

    lastError = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
  }

  throw new StructuredOutputError(
    `The AI returned output that did not match the expected format after two attempts. ${lastError}`,
    lastRaw,
  )
}

// ── Meta ad copy limits ──────────────────────────────────────────────────
// Meta truncates beyond these in the feed. Devanagari renders wider than
// Latin, so Marathi copy hits the visual limit sooner than the character
// count suggests — these are the hard caps, not a style guide.
export const META_LIMITS = {
  primaryText: 125,
  headline: 40,
  description: 30,
} as const

export function truncateForMeta(text: string, limit: number): { text: string; truncated: boolean } {
  const trimmed = text.trim()
  if ([...trimmed].length <= limit) return { text: trimmed, truncated: false }
  // Prefer a word boundary so we do not cut a Devanagari cluster mid-word.
  const sliced = [...trimmed].slice(0, limit).join('')
  const lastSpace = sliced.lastIndexOf(' ')
  const cut = lastSpace > limit * 0.6 ? sliced.slice(0, lastSpace) : sliced
  return { text: `${cut.trimEnd()}…`, truncated: true }
}

export const CALL_TO_ACTION_VALUES = [
  'SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'DOWNLOAD', 'BOOK_TRAVEL', 'CONTACT_US',
  'GET_OFFER', 'GET_QUOTE', 'SUBSCRIBE', 'APPLY_NOW', 'BUY_NOW', 'ORDER_NOW',
  'SEND_MESSAGE', 'WHATSAPP_MESSAGE', 'CALL_NOW', 'NO_BUTTON',
] as const

/** Coerce a model-invented CTA to the nearest valid Meta enum value. */
const callToActionSchema = z
  .string()
  .transform((v) => v.trim().toUpperCase().replace(/\s+/g, '_'))
  .transform((v) => ((CALL_TO_ACTION_VALUES as readonly string[]).includes(v) ? v : 'LEARN_MORE'))

export const creativeSuggestionSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  primaryText: z.string().min(1),
  headline: z.string().min(1),
  callToAction: callToActionSchema,
  targeting: z.string().default(''),
  // The model invents this number; it is an unvalidated estimate, never a
  // measurement, and the UI must label it as such.
  expectedRoas: z.coerce.number().min(0).max(100).default(0),
  reasoning: z.string().default(''),
})

export type ValidatedCreativeSuggestion = z.infer<typeof creativeSuggestionSchema>

export const creativeSuggestionListSchema = z.object({
  creatives: z.array(creativeSuggestionSchema).min(1),
})

export const creativeReviewSchema = z.object({
  score: z.coerce.number().min(0).max(100),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
  recommendedChanges: z.array(z.string()).default([]),
})

/** Apply Meta's length caps and report what had to be cut. */
export function enforceCopyLimits<T extends { primaryText: string; headline: string; description?: string }>(
  creative: T,
): T & { copyWarnings: string[] } {
  const copyWarnings: string[] = []

  const primary = truncateForMeta(creative.primaryText, META_LIMITS.primaryText)
  if (primary.truncated) {
    copyWarnings.push(`Primary text exceeded Meta's ${META_LIMITS.primaryText}-character limit and was shortened.`)
  }

  const headline = truncateForMeta(creative.headline, META_LIMITS.headline)
  if (headline.truncated) {
    copyWarnings.push(`Headline exceeded Meta's ${META_LIMITS.headline}-character limit and was shortened.`)
  }

  return {
    ...creative,
    primaryText: primary.text,
    headline: headline.text,
    copyWarnings,
  }
}
