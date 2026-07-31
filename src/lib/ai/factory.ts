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
      return new AnthropicProvider(config.apiKey, config.model || 'claude-3-5-sonnet-20241022')

    case 'openai':
      if (!config.apiKey) throw new Error('OpenAI API key is required')
      return new OpenAIProvider(config.apiKey, config.model || 'gpt-4o-mini')

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
        { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Recommended)' },
        { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Most Powerful)' },
        { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Fast)' },
      ]

    case 'openai':
      return [
        { value: 'gpt-4o', label: 'GPT-4o (Most Powerful)' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Recommended)' },
        { value: 'o1-mini', label: 'o1 Mini (Reasoning)' },
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
