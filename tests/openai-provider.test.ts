import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpenAIProvider } from '../src/lib/ai/providers/openai'
import { normalizeReview, isApproved } from '../src/lib/ai/review-status'

type Call = { body: Record<string, unknown> }

function mockFetch(responses: Array<{ status: number; body: unknown }>): Call[] {
  const calls: Call[] = []
  let i = 0
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body ?? '{}')) })
    const r = responses[Math.min(i++, responses.length - 1)]
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return calls
}

const ok = { choices: [{ message: { content: 'ok' } }] }

test('never sends max_tokens (GPT-5 and later reject it)', async () => {
  const calls = mockFetch([{ status: 200, body: ok }])
  const out = await new OpenAIProvider('k', 'gpt-5.4-mini-test-a').generateCompletion('hi')
  assert.equal(out, 'ok')
  assert.equal('max_tokens' in calls[0].body, false)
  assert.ok(Number(calls[0].body.max_completion_tokens) > 0)
})

test('a rejected temperature is dropped, remembered, and the call retried', async () => {
  const rejected = { error: { message: "Unsupported value: 'temperature'", param: 'temperature', code: 'unsupported_value' } }
  const calls = mockFetch([{ status: 400, body: rejected }, { status: 200, body: ok }, { status: 200, body: ok }])
  const p = new OpenAIProvider('k', 'gpt-6-test-b')
  assert.equal(await p.generateCompletion('hi'), 'ok')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].body.temperature, 0.7)
  assert.equal('temperature' in calls[1].body, false)
  // Remembered: the next call skips it without another failed round trip.
  await p.generateCompletion('again')
  assert.equal(calls.length, 3)
  assert.equal('temperature' in calls[2].body, false)
})

test('other 400s are reported, not retried, with OpenAI\'s own message', async () => {
  const bad = { error: { message: 'The model `nope` does not exist', param: 'model' } }
  const calls = mockFetch([{ status: 400, body: bad }])
  await assert.rejects(new OpenAIProvider('k', 'nope').generateCompletion('hi'), /OpenAI error 400: The model `nope` does not exist/)
  assert.equal(calls.length, 1)
})

test('review status: one vocabulary, legacy spellings still read correctly', () => {
  assert.equal(normalizeReview('approved'), 'approved')
  assert.equal(normalizeReview('verified'), 'approved')
  assert.equal(normalizeReview('not_verified'), 'rejected')
  assert.equal(normalizeReview(null), 'pending')
  assert.equal(isApproved('pending'), false)
})

test('streamed tool calls still arrive once, and usage (sent after finish_reason) is reported', async () => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'research_web', arguments: '{"query":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"pune"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1000 } } },
  ]
  const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  let sentBody: Record<string, unknown> = {}
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body ?? '{}'))
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch

  const reported: Array<{ model: string; usage: unknown }> = []
  const p = new OpenAIProvider('k', 'gpt-5.4-mini', (model, usage) => { reported.push({ model, usage }) })
  const events: string[] = []
  let toolArgs: unknown
  for await (const ev of p.streamChatWithTools([{ role: 'user', content: 'hi' }], 'sys', [])) {
    events.push(ev.type)
    if (ev.type === 'tool_calls') toolArgs = ev.toolCalls[0].arguments
  }
  assert.deepEqual(events, ['tool_calls', 'done'])
  assert.deepEqual(toolArgs, { query: 'pune' })
  assert.deepEqual((sentBody.stream_options as Record<string, unknown>)?.include_usage, true)
  assert.deepEqual(reported, [{ model: 'gpt-5.4-mini', usage: { inputTokens: 1200, cachedInputTokens: 1000, outputTokens: 40 } }])
})
