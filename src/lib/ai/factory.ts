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
      return new AnthropicProvider(config.apiKey, config.model || 'claude-sonnet-4-5-20250514')

    case 'openai':
      if (!config.apiKey) throw new Error('OpenAI API key is required')
      return new OpenAIProvider(config.apiKey, config.model || 'gpt-5.4-mini')

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
        { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5 (Latest)' },
        { value: 'claude-opus-4-1-20250515', label: 'Claude Opus 4.1 (Most Powerful)' },
        { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
        { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (Fast)' },
      ]

    case 'openai':
      return [
        { value: 'gpt-5.4', label: 'GPT-5.4 (Latest, Most Powerful)' },
        { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (Recommended)' },
        { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano (Fastest)' },
        { value: 'gpt-5.1-mini', label: 'GPT-5.1 Mini' },
        { value: 'gpt-4o', label: 'GPT-4o' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
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
