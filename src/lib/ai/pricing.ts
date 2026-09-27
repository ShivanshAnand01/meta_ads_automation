import type { TokenUsage } from './types'

/**
 * What each model costs, in USD per million tokens, so every AI call can be
 * priced from the token counts the provider reports.
 *
 * OpenAI figures are the standard tier from developers.openai.com/api/docs/pricing,
 * read 2026-09-27. A model missing from this table is recorded with its token
 * counts and a null cost — never a guessed price. Update this table when
 * prices change; past rows keep the cost they were recorded with.
 */

export interface ModelPrice {
  input: number
  cachedInput?: number
  output: number
}

export const MODEL_PRICES_USD_PER_MTOK: Record<string, ModelPrice> = {
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'gpt-6-sol': { input: 2, cachedInput: 0.2, output: 10 },
  'gpt-6-astra': { input: 10, cachedInput: 1, output: 50 },
  // Image generation: prompt text in, image tokens out.
  'gpt-image-1': { input: 5, output: 40 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
}


/** Cost in USD, or null when the model's price is unknown. */
export function costUsd(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES_USD_PER_MTOK[model]
  if (!price) return null
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens)
  const fresh = usage.inputTokens - cached
  const usd =
    (fresh * price.input + cached * (price.cachedInput ?? price.input) + usage.outputTokens * price.output) / 1_000_000
  return Math.round(usd * 1_000_000) / 1_000_000
}
