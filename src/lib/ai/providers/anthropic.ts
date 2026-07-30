import type { AIProvider, ChatMessage, ContentPart, ToolCall, ToolDefinition, ProviderStreamEvent } from '../types'

function toAnthropicContent(content: string | ContentPart[]) {
  if (typeof content === 'string') return content
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    const url = part.image_url.url
    if (url.startsWith('data:')) {
      const match = url.match(/^data:(image\/\w+);base64,(.+)$/)
      if (match) {
        return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
      }
    }
    return { type: 'image', source: { type: 'url', url } }
  })
}

function toAnthropicMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  for (const m of messages) {
    if (m.role === 'system') continue

    if (m.role === 'tool') {
      result.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        }],
      })
      continue
    }

    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: unknown[] = []
      if (typeof m.content === 'string' && m.content) {
        blocks.push({ type: 'text', text: m.content })
      }
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
      }
      result.push({ role: 'assistant', content: blocks })
      continue
    }

    result.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: toAnthropicContent(m.content) })
  }
  return result
}

function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }))
}

export class AnthropicProvider implements AIProvider {
  name = 'anthropic'
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string = 'claude-sonnet-4-5-20250514') {
    this.apiKey = apiKey
    this.model = model
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async generateCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }
    if (systemPrompt) body.system = systemPrompt

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    return data.content?.[0]?.text || ''
  }

  async *streamChat(
    messages: ChatMessage[],
    systemPrompt?: string,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      stream: true,
      messages: toAnthropicMessages(messages),
    }
    if (systemPrompt) body.system = systemPrompt

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok || !response.body) {
      const error = await response.text().catch(() => '')
      throw new Error(`Anthropic error: ${response.status} - ${error}`)
    }

    yield* this.parseStream(response.body.getReader())
  }

  async *streamChatWithTools(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal?: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      stream: true,
      messages: toAnthropicMessages(messages),
      system: systemPrompt,
      tools: toAnthropicTools(tools),
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok || !response.body) {
      const error = await response.text().catch(() => '')
      throw new Error(`Anthropic error: ${response.status} - ${error}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const toolBlocks: Map<number, { id: string; name: string; argsBuffer: string }> = new Map()
    let hasToolCalls = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data) continue
        try {
          const json = JSON.parse(data)

          if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
            hasToolCalls = true
            toolBlocks.set(json.index, {
              id: json.content_block.id,
              name: json.content_block.name,
              argsBuffer: '',
            })
          } else if (json.type === 'content_block_delta') {
            if (json.delta?.type === 'text_delta') {
              yield { type: 'text', text: json.delta.text }
            } else if (json.delta?.type === 'input_json_delta') {
              const block = toolBlocks.get(json.index)
              if (block) block.argsBuffer += json.delta.partial_json
            }
          } else if (json.type === 'content_block_stop') {
            // Tool call block complete
          } else if (json.type === 'message_stop') {
            if (hasToolCalls) {
              const toolCalls: ToolCall[] = []
              for (const [, tb] of toolBlocks) {
                let args: Record<string, unknown> = {}
                try { args = JSON.parse(tb.argsBuffer || '{}') } catch {}
                toolCalls.push({ id: tb.id, name: tb.name, arguments: args })
              }
              yield { type: 'tool_calls', toolCalls }
            }
            yield { type: 'done' }
            return
          }
        } catch {}
      }
    }
    yield { type: 'done' }
  }

  private async *parseStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string, void, unknown> {
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data) continue
        try {
          const json = JSON.parse(data)
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
            if (typeof json.delta.text === 'string' && json.delta.text) yield json.delta.text
          } else if (json.type === 'message_stop') {
            return
          }
        } catch {}
      }
    }
  }

  async chat(messages: ChatMessage[], systemPrompt?: string, signal?: AbortSignal): Promise<string> {
    let out = ''
    for await (const chunk of this.streamChat(messages, systemPrompt, signal)) out += chunk
    return out
  }
}
