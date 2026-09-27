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


/*
 * OpenAI's models do not all accept the same parameters, and the newer ones
 * reject what older ones required:
 *   - GPT-5 and later reject `max_tokens`; every chat model accepts
 *     `max_completion_tokens` (verified live, 2026-09-27).
 *   - GPT-5.5 and GPT-6 reject any `temperature` other than the default.
 * Rather than hard-code a model list that goes stale, send the preferred
 * tuning, and if OpenAI rejects a specific optional parameter, drop it,
 * remember that for this model, and retry once.
 */
const OPTIONAL_PARAMS = new Set(['temperature', 'top_p', 'presence_penalty', 'frequency_penalty'])
const unsupportedByModel = new Map<string, Set<string>>()

function withSupportedParams(model: string, body: Record<string, unknown>): Record<string, unknown> {
  const blocked = unsupportedByModel.get(model)
  if (!blocked) return body
  const out = { ...body }
  for (const k of blocked) delete out[k]
  return out
}

async function postChat(apiKey: string, model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(withSupportedParams(model, { model, ...body })),
      signal,
    })
    if (res.status !== 400) return res
    const text = await res.clone().text()
    let param: string | undefined
    try { param = JSON.parse(text)?.error?.param } catch {}
    if (!param || !OPTIONAL_PARAMS.has(param) || unsupportedByModel.get(model)?.has(param)) return res
    const set = unsupportedByModel.get(model) ?? new Set<string>()
    set.add(param)
    unsupportedByModel.set(model, set)
  }
  throw new Error('OpenAI kept rejecting the request parameters')
}

/** A readable error for the owner, with OpenAI's own message kept for us. */
async function openAIError(res: Response): Promise<Error> {
  const raw = await res.text().catch(() => '')
  let msg = raw
  try { msg = JSON.parse(raw)?.error?.message || raw } catch {}
  const hint =
    res.status === 401 ? ' Check the OpenAI key in Settings.' :
    res.status === 429 ? ' OpenAI is rate-limiting this key or it is out of credit; check billing at platform.openai.com.' :
    res.status === 404 ? ' The model name in Settings may be wrong or not available to this key.' : ''
  return new Error(`OpenAI error ${res.status}: ${String(msg).slice(0, 300)}${hint}`)
}

export class OpenAIProvider implements AIProvider {
  name = 'openai'
  private apiKey: string
  private model: string

  constructor(apiKey: string, model: string = 'gpt-5.4-mini') {
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

    // Generous cap: reasoning models spend part of it thinking before they
    // write, and structured creative batches can be long. Billed on use only.
    const response = await postChat(this.apiKey, this.model, { messages, temperature: 0.7, max_completion_tokens: 8000 })
    if (!response.ok) throw await openAIError(response)

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

    const response = await postChat(this.apiKey, this.model, { messages: reqMessages, temperature: 0.7, stream: true }, signal)
    if (!response.ok || !response.body) throw await openAIError(response)

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

    const response = await postChat(this.apiKey, this.model, {
      messages: reqMessages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
      stream: true,
    }, signal)
    if (!response.ok || !response.body) throw await openAIError(response)

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
