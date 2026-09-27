/**
 * Model presets shown in Settings and the AI Manager.
 *
 * OpenAI IDs were read from GET /v1/models on a live account (2026-09-27);
 * Claude IDs from Anthropic's models overview. The model field stays free
 * text, so a business can type any ID its key can reach; these are just the
 * sensible picks, with the recommended one first.
 */
export interface ModelPreset {
  value: string
  label: string
  note: string
}

export const MODEL_PRESETS: Record<string, ModelPreset[]> = {
  openai: [
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini', note: 'Recommended. Fast and low cost for everyday runs.' },
    { value: 'gpt-5.4', label: 'GPT-5.4', note: 'Stronger reasoning for strategy and reviews.' },
    { value: 'gpt-5.5', label: 'GPT-5.5', note: 'Newer, more capable, higher cost.' },
    { value: 'gpt-6-luna', label: 'GPT-6 Luna', note: 'Efficient GPT-6 for high-volume work.' },
    { value: 'gpt-6-sol', label: 'GPT-6 Sol', note: 'Built for agentic, multi-step work.' },
    { value: 'gpt-6-astra', label: 'GPT-6 Astra', note: 'Most capable. Slowest and priciest.' },
  ],
  anthropic: [
    { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Recommended. Best balance of speed and quality.' },
    { value: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Deeper agentic work and long runs.' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest and cheapest.' },
    { value: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: 'Most capable. Slowest and priciest.' },
  ],
  groq: [
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', note: 'Fast, free tier. Weaker in Indic scripts.' },
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', note: 'Very fast, lower quality.' },
  ],
  ollama: [
    { value: 'llama3', label: 'Llama 3 (8B)', note: 'Runs on your own machine.' },
    { value: 'qwen2.5', label: 'Qwen 2.5', note: 'Runs on your own machine.' },
  ],
}

export function defaultModelFor(provider: string): string {
  return MODEL_PRESETS[provider]?.[0]?.value ?? ''
}
