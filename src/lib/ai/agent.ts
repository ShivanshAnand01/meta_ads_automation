import type { AIProvider, ChatMessage, ToolCall, ToolDefinition, ToolResult } from './types'

const AGENT_SYSTEM_PROMPT = `You are the **AI Manager** — the mastermind that controls everything related to this client's Meta (Facebook/Instagram) Ads. You manage ad campaigns for Marathi sales ebooks targeting the Maharashtrian audience in India, but you operate the WHOLE account: strategy, campaigns, creatives, audiences, budgets, pacing, scheduling, reporting, and live optimization.

# How you operate (always)
1. **Ask before you act.** Before performing complex tasks (creating campaigns, generating creatives, changing strategy, publishing to Meta), use \`ask_user_question\` to gather any missing information — one question at a time. Ask about budget, audience, product details, tone, timing, or anything else you need. Only ask for genuinely missing info; skip questions you can answer from strategy, memory, or the conversation. Once you have what you need, proceed confidently without asking further.
2. **Know the goal.** Before recommending or acting, call \`get_strategy\` to read the client's target ROAS, CPA, budget caps, guardrails, and whether auto-optimize is on. Optimize toward these — do not drift.
2. **Verify the connection.** If Meta operations fail or the client asks "does my connection work?", call \`test_meta_connection\` to validate the token, check expiry/permissions, and confirm the ad account is reachable. Report what you find clearly.
3. **Work from real data.** Never analyze performance on stale numbers. Call \`sync_campaign_insights\` first to pull live Meta data, then use \`get_daily_metrics\` / \`get_performance_trend\` / \`get_dashboard_summary\`. Only trust numbers you just synced.
4. **Remember.** Call \`get_memory\` to recall past decisions and outcomes; after meaningful actions call \`add_memory\` so future turns (and autonomous runs) stay consistent.
5. **Do, don't just describe.** Use tools proactively. If the client asks to create a campaign, actually create it. If they ask to pause an ad, actually pause it (it will ask for approval unless auto-optimize is on — that's a guardrail, explain it).
6. **Build full creatives.** When the client wants an ad creative, use \`generate_creative_with_image\` to produce Marathi ad copy AND a matching image in one step and save it for review. Use \`generate_ad_image\` for a standalone image, and \`review_creative\` / \`improve_creative\` to polish existing creatives. Image generation works even without an OpenAI key (free provider fallback), so always try it.
7. **Visualize & report.** Use \`generate_chart\` to show spend trends, funnels, and ROAS by campaign; use \`generate_report\` for structured markdown reports. Speak the client's language and show, don't tell.
8. **Multimodal.** The client may send images (analyze them) or voice (transcribe with \`transcribe_audio\`). You may reply with images (\`generate_ad_image\`), charts, reports, and even voice (\`speak\`) when helpful.
9. **Autonomous-ready.** You can schedule routines (\`create_scheduled_job\`) like morning optimization, budget pacing, anomaly detection, and weekly reports. When running autonomously you act decisively within guardrails and log everything to memory.

# Guardrails
- Spend-affecting live Meta actions (create/pause/resume campaigns, publish, create ad creatives, audiences) require the client's approval UNLESS \`auto_optimize\` is enabled in the strategy. When an action needs approval, tell the client clearly what will happen and that they can approve it in the Approvals panel — do NOT pretend it succeeded.
- Never exceed the strategy's budget caps. Flag pacing risks (e.g. "on track to overshoot daily cap by 20%").
- Be decisive but safe: prefer pausing clear losers and scaling proven winners.

# Communication style
- Conversational, friendly, simple — the client is a non-technical business owner from Maharashtra.
- Generate ad copy in **Marathi (Devanagari script)** for the Maharashtrian audience; mix English and Marathi where appropriate.
- When the client sends an image, acknowledge and describe it before recommending.
- Use markdown (headers, bold, lists, tables, code blocks). Offer to generate both text copy AND a visual image.

# If Meta is not connected
Suggest connecting via the Meta Connection page; local-only tools still work.

# Notes
To save a note about what you built, include in your response:
\`\`\`note
{ "title": "What was created/done", "content": "Details, parameters, outcomes" }
\`\`\`
If you don't need any tools, just respond conversationally with helpful advice.`

export interface AgentResult {
  response: string
  toolCalls: ToolCall[]
  toolResults: ToolResult[]
  notes: Array<{ title: string; content: string; type: string }>
}

export type AgentStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking'; phase: 'reasoning' | 'analyzing' }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCallId: string; toolName: string; result: unknown; error?: string }
  | { type: 'note'; note: { title: string; content: string; type: string } }
  | { type: 'done'; result: AgentResult }

type AgentNote = { title: string; content: string; type: string }

function parseNotes(text: string): AgentNote[] {
  const notes: AgentNote[] = []
  const re = /```note\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    try {
      const d = JSON.parse(m[1].trim())
      notes.push({ title: d.title || 'Note', content: d.content || '', type: 'note' })
    } catch {}
  }
  return notes
}

function stripNoteBlocks(text: string): string {
  return text.replace(/```note\s*[\s\S]*?```/g, '').trim()
}

const MAX_ROUNDS = 10

export async function* streamAgentMessage(
  provider: AIProvider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolExecutor: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  signal?: AbortSignal,
  systemContext?: string
): AsyncGenerator<AgentStreamEvent, AgentResult, unknown> {
  const allToolCalls: ToolCall[] = []
  const allToolResults: ToolResult[] = []
  const allNotes: AgentNote[] = []
  let fullResponse = ''

  const fullPrompt = systemContext ? `${AGENT_SYSTEM_PROMPT}\n\n${systemContext}` : AGENT_SYSTEM_PROMPT

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) break

    yield { type: 'thinking', phase: round === 0 ? 'reasoning' : 'analyzing' }

    let textBuffer = ''
    let toolCallsInRound: ToolCall[] = []

    try {
      for await (const ev of provider.streamChatWithTools(messages, fullPrompt, tools, signal)) {
        if (signal?.aborted) break

        if (ev.type === 'text') {
          textBuffer += ev.text
          yield { type: 'text_delta', text: ev.text }
        } else if (ev.type === 'tool_calls') {
          toolCallsInRound = ev.toolCalls
        } else if (ev.type === 'done') {
          break
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') break
      throw err
    }

    const roundNotes = parseNotes(textBuffer)
    for (const n of roundNotes) {
      allNotes.push(n)
      yield { type: 'note', note: n }
    }

    if (toolCallsInRound.length === 0) {
      fullResponse = fullResponse ? `${fullResponse}\n\n${stripNoteBlocks(textBuffer)}` : stripNoteBlocks(textBuffer)
      break
    }

    fullResponse = fullResponse ? `${fullResponse}\n\n${stripNoteBlocks(textBuffer)}` : stripNoteBlocks(textBuffer)

    messages.push({
      role: 'assistant',
      content: textBuffer,
      toolCalls: toolCallsInRound,
    })

    // Emit all tool calls, then execute in parallel for throughput.
    for (const tc of toolCallsInRound) {
      allToolCalls.push(tc)
      yield { type: 'tool_call', toolCall: tc }
    }

    const settled = await Promise.all(
      toolCallsInRound.map(async (tc) => {
        try {
          const result = await toolExecutor(tc.name, tc.arguments)
          return { tc, result, error: undefined as string | undefined }
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Tool execution failed'
          return { tc, result: null, error }
        }
      })
    )

    for (const { tc, result, error } of settled) {
      allToolResults.push({ toolCallId: tc.id, toolName: tc.name, result, error })
      messages.push({
        role: 'tool',
        content: JSON.stringify(error ? { error } : result ?? {}),
        toolCallId: tc.id,
      })
      if (!signal?.aborted) {
        yield { type: 'tool_result', toolCallId: tc.id, toolName: tc.name, result, error }
      }
    }
  }

  const result: AgentResult = {
    response: fullResponse,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    notes: allNotes,
  }

  yield { type: 'done', result }
  return result
}

export async function processAgentMessage(
  provider: AIProvider,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolExecutor: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
  systemContext?: string
): Promise<AgentResult> {
  const fullPrompt = systemContext ? `${AGENT_SYSTEM_PROMPT}\n\n${systemContext}` : AGENT_SYSTEM_PROMPT
  const allToolCalls: ToolCall[] = []
  const allToolResults: ToolResult[] = []
  const allNotes: AgentNote[] = []
  let fullResponse = ''

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let textBuffer = ''
    let toolCallsInRound: ToolCall[] = []

    for await (const ev of provider.streamChatWithTools(messages, fullPrompt, tools)) {
      if (ev.type === 'text') {
        textBuffer += ev.text
      } else if (ev.type === 'tool_calls') {
        toolCallsInRound = ev.toolCalls
      } else if (ev.type === 'done') {
        break
      }
    }

    const roundNotes = parseNotes(textBuffer)
    allNotes.push(...roundNotes)

    if (toolCallsInRound.length === 0) {
      fullResponse = fullResponse ? `${fullResponse}\n\n${stripNoteBlocks(textBuffer)}` : stripNoteBlocks(textBuffer)
      break
    }

    fullResponse = fullResponse ? `${fullResponse}\n\n${stripNoteBlocks(textBuffer)}` : stripNoteBlocks(textBuffer)

    messages.push({ role: 'assistant', content: textBuffer, toolCalls: toolCallsInRound })

    const settled = await Promise.all(
      toolCallsInRound.map(async (tc) => {
        try {
          const result = await toolExecutor(tc.name, tc.arguments)
          return { tc, result, error: undefined as string | undefined }
        } catch (err) {
          return { tc, result: null, error: err instanceof Error ? err.message : 'Tool execution failed' }
        }
      })
    )

    for (const { tc, result, error } of settled) {
      allToolCalls.push(tc)
      allToolResults.push({ toolCallId: tc.id, toolName: tc.name, result, error })
      messages.push({
        role: 'tool',
        content: JSON.stringify(error ? { error } : result ?? {}),
        toolCallId: tc.id,
      })
    }
  }

  return { response: fullResponse, toolCalls: allToolCalls, toolResults: allToolResults, notes: allNotes }
}
