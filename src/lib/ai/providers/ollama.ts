import type { AIProvider, ChatMessage, ContentPart, ToolCall, ToolDefinition, ProviderStreamEvent } from '../types'

function extractBase64(url: string): string | null {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:image\/\w+;base64,(.+)$/)
    return match ? match[1] : null
  }
  return null
}

async function toOllamaMessage(m: ChatMessage): Promise<Record<string, unknown>> {
  const role = m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : m.role === 'tool' ? 'tool' : 'user'

  if (m.role === 'tool') {
    return { role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }
  }

  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role,
      content: typeof m.content === 'string' ? m.content : '',
      tool_calls: m.toolCalls.map((tc) => ({
        function: { name: tc.name, arguments: tc.arguments },
      })),
    }
  }

  if (typeof m.content === 'string') {
    return { role, content: m.content }
  }

  const parts = m.content as ContentPart[]
  const textParts: string[] = []
  const images: string[] = []

  for (const part of parts) {
    if (part.type === 'text') {
      textParts.push(part.text)
    } else if (part.type === 'image_url') {
      const url = part.image_url.url
      const base64 = extractBase64(url)
      if (base64) {
        images.push(base64)
      } else {
        try {
          const res = await fetch(url)
          const buf = await res.arrayBuffer()
          images.push(Buffer.from(buf).toString('base64'))
        } catch {}
      }
    }
  }

  const msg: Record<string, unknown> = { role, content: textParts.join('\n') }
  if (images.length > 0) msg.images = images
  return msg
}

export class OllamaProvider implements AIProvider {
  name = 'ollama'
  private baseUrl: string
  private model: string

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'llama3') {
    this.baseUrl = baseUrl
    this.model = model
  }

  isAvailable(): boolean {
    return !!this.baseUrl
  }

  async generateCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    const body: Record<string, unknown> = { model: this.model, prompt, stream: false }
    if (systemPrompt) body.system = systemPrompt

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data.response || ''
  }

  async *streamChat(
    messages: ChatMessage[],
    systemPrompt?: string,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const reqMessages: Record<string, unknown>[] = []
    if (systemPrompt) reqMessages.push({ role: 'system', content: systemPrompt })
    for (const m of messages) {
      if (m.role !== 'tool') {
        const msg = await toOllamaMessage(m)
        reqMessages.push(msg)
      }
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: reqMessages, stream: true }),
      signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
    }

    yield* this.parseStream(response.body.getReader())
  }

  async *streamChatWithTools(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal?: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const reqMessages: Record<string, unknown>[] = [
      { role: 'system', content: systemPrompt },
    ]
    for (const m of messages) {
      reqMessages.push(await toOllamaMessage(m))
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: reqMessages,
        tools,
        stream: true,
      }),
      signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let toolCallCounter = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const json = JSON.parse(trimmed)

          if (json.message?.tool_calls && json.message.tool_calls.length > 0) {
            const toolCalls: ToolCall[] = json.message.tool_calls.map((tc: { function: { name: string; arguments: Record<string, unknown> } }) => ({
              id: `call_${toolCallCounter++}`,
              name: tc.function.name,
              arguments: tc.function.arguments || {},
            }))
            yield { type: 'tool_calls', toolCalls }
          }

          if (json.message?.content && typeof json.message.content === 'string') {
            yield { type: 'text', text: json.message.content }
          }

          if (json.done) {
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
        if (!trimmed) continue
        try {
          const json = JSON.parse(trimmed)
          const text = json.message?.content
          if (typeof text === 'string' && text) yield text
          if (json.done) return
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
