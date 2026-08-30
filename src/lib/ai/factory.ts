import type { AIProvider, AIProviderType } from './types'
import { OllamaProvider } from './providers/ollama'
import { OpenAIProvider } from './providers/openai'
import { GroqProvider } from './providers/groq'
import { AnthropicProvider } from './providers/anthropic'

export function createAIProvider(
  type: AIProviderType,
  config: { apiKey?: string; model?: string; baseUrl?: string }
): AIProvider {
  switch (type) {
    case 'anthropic':
      if (!config.apiKey) throw new Error('Anthropic API key is required')
      return new AnthropicProvider(config.apiKey, config.model || 'claude-sonnet-5')

    case 'openai':
      if (!config.apiKey) throw new Error('OpenAI API key is required')
      return new OpenAIProvider(config.apiKey, config.model || 'gpt-4.1-mini')

    case 'groq':
      if (!config.apiKey) throw new Error('Groq API key is required')
      return new GroqProvider(config.apiKey, config.model || 'llama-3.3-70b-versatile')

    case 'ollama':
      return new OllamaProvider(
        config.baseUrl || 'http://localhost:11434',
        config.model || 'llama3'
      )

    default:
      throw new Error(`Unknown AI provider type: ${type}`)
  }
}

export function getAvailableModels(type: AIProviderType): { value: string; label: string }[] {
  switch (type) {
    case 'anthropic':
      return [
        { value: 'claude-sonnet-5', label: 'Claude Sonnet 5 (Recommended)' },
        { value: 'claude-opus-5', label: 'Claude Opus 5 (Most Capable)' },
        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast & Cheap)' },
      ]

    case 'openai':
      return [
        { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Recommended)' },
        { value: 'gpt-4.1', label: 'GPT-4.1 (Most Capable)' },
        { value: 'gpt-4o', label: 'GPT-4o' },
      ]

    case 'groq':
      return [
        { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Recommended)' },
        { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Fast)' },
        { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
      ]

    case 'ollama':
      return [
        { value: 'llama3', label: 'Llama 3 (8B)' },
        { value: 'llama3:70b', label: 'Llama 3 (70B)' },
        { value: 'qwen2.5', label: 'Qwen 2.5' },
        { value: 'mistral', label: 'Mistral' },
      ]

    default:
      return []
  }
}
