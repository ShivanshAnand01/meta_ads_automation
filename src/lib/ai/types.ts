export type AIProviderType = 'ollama' | 'openai' | 'groq' | 'anthropic'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  result: unknown
  error?: string
}

export type ProviderStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; toolCalls: ToolCall[] }
  | { type: 'done' }

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | ContentPart[]
  toolCalls?: ToolCall[]
  toolCallId?: string
}

/** Tokens a single model call consumed, as the provider reported them. */
export interface TokenUsage {
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
}

/** Receives each call's usage; awaited, so a recorder can finish its write. */
export type UsageReporter = (model: string, usage: TokenUsage) => Promise<void> | void

export interface AIProvider {
  name: string
  generateCompletion(prompt: string, systemPrompt?: string): Promise<string>
  chat(messages: ChatMessage[], systemPrompt?: string, signal?: AbortSignal): Promise<string>
  streamChat(
    messages: ChatMessage[],
    systemPrompt?: string,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown>
  streamChatWithTools(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal?: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent, void, unknown>
  isAvailable(): boolean
}

export interface CreativeSuggestion {
  title: string
  description: string
  primaryText: string
  headline: string
  callToAction: string
  targeting: string
  expectedRoas: number
  reasoning: string
}

export interface CreativeReview {
  score: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  recommendedChanges: string[]
}
