import type { AIProvider, ChatMessage, ToolCall, ToolDefinition, ProviderStreamEvent } from '../types'

function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  const msg: Record<string, unknown> = { role: m.role }

  if (m.role === 'tool') {
    msg.content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    msg.tool_call_id = m.toolCallId
    return msg
  }

  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    msg.content = typeof m.content === 'string' ? m.content : null
    msg.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }))
    return msg
  }

  msg.content = m.content
  return msg
}

export class OpenAIProvider implements AIProvider {
  name = 'openai'
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string = 'gpt-4o') {
    this.apiKey = apiKey
    this.model = model
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async generateCompletion(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Record<string, unknown>[] = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: prompt })

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.7, max_tokens: 2000 }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI error: ${response.status} - ${error}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  }

  async *streamChat(
    messages: ChatMessage[],
    systemPrompt?: string,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const reqMessages: Record<string, unknown>[] = []
    if (systemPrompt) reqMessages.push({ role: 'system', content: systemPrompt })
    for (const m of messages) {
      if (m.role !== 'tool') reqMessages.push(toOpenAIMessage(m))
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages: reqMessages, temperature: 0.7, stream: true }),
      signal,
    })

    if (!response.ok || !response.body) {
      const error = await response.text().catch(() => '')
      throw new Error(`OpenAI error: ${response.status} - ${error}`)
    }

    const reader = response.body.getReader()
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
        if (!data || data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) yield delta
        } catch {}
      }
    }
  }

  async *streamChatWithTools(
    messages: ChatMessage[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal?: AbortSignal
  ): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const reqMessages: Record<string, unknown>[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(toOpenAIMessage),
    ]

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: reqMessages,
        tools,
        tool_choice: 'auto',
        temperature: 0.7,
        stream: true,
      }),
      signal,
    })

    if (!response.ok || !response.body) {
      const error = await response.text().catch(() => '')
      throw new Error(`OpenAI error: ${response.status} - ${error}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const toolCallAccumulator: Map<number, { id: string; name: string; argsBuffer: string }> = new Map()
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
        if (!data || data === '[DONE]') {
          if (hasToolCalls) {
            const toolCalls: ToolCall[] = []
            for (const [, tc] of toolCallAccumulator) {
              let args: Record<string, unknown> = {}
              try { args = JSON.parse(tc.argsBuffer || '{}') } catch {}
              toolCalls.push({ id: tc.id, name: tc.name, arguments: args })
            }
            yield { type: 'tool_calls', toolCalls }
          }
          yield { type: 'done' }
          return
        }
        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta
          const finishReason = json.choices?.[0]?.finish_reason

          if (delta?.content && typeof delta.content === 'string') {
            yield { type: 'text', text: delta.content }
          }

          if (delta?.tool_calls) {
            hasToolCalls = true
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!toolCallAccumulator.has(idx)) {
                toolCallAccumulator.set(idx, {
                  id: tc.id || `call_${idx}`,
                  name: tc.function?.name || '',
                  argsBuffer: '',
                })
              }
              const acc = toolCallAccumulator.get(idx)!
              if (tc.function?.name) acc.name = tc.function.name
              if (tc.function?.arguments) acc.argsBuffer += tc.function.arguments
            }
          }

          if (finishReason === 'tool_calls' || finishReason === 'stop') {
            if (hasToolCalls) {
              const toolCalls: ToolCall[] = []
              for (const [, tc] of toolCallAccumulator) {
                let args: Record<string, unknown> = {}
                try { args = JSON.parse(tc.argsBuffer || '{}') } catch {}
                toolCalls.push({ id: tc.id, name: tc.name, arguments: args })
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

  async chat(messages: ChatMessage[], systemPrompt?: string, signal?: AbortSignal): Promise<string> {
    let out = ''
    for await (const chunk of this.streamChat(messages, systemPrompt, signal)) out += chunk
    return out
  }
}
