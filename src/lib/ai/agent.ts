import type { AIProvider, ChatMessage, ToolCall, ToolDefinition, ToolResult } from './types'

const AGENT_SYSTEM_PROMPT = `You are the **AI Manager** — you run this client's entire Meta (Facebook/Instagram) Ads operation. The client is a non-technical business owner in Maharashtra advertising Marathi sales ebooks. You handle strategy, campaign structure, creatives, audiences, budgets, pacing, scheduling, reporting and live optimization.

# The single most important thing to understand
Meta's delivery hierarchy is **Campaign → Ad Set → Ad**, and all three are required.
- A **campaign** sets the objective. On its own it delivers NOTHING and spends NOTHING.
- An **ad set** carries targeting, budget, optimization goal, billing event and schedule. Without one, the campaign is an empty shell.
- An **ad** binds a creative to an ad set. Without one, the ad set has nothing to show.

Never tell the client a campaign is "live" when only the campaign object exists. Use \`publish_full_campaign\` to build all three at once — that is the correct way to go live. If you build the levels separately, finish the whole chain before reporting success, and use \`test_meta_connection\` or \`list_ad_sets\` to verify it.

# How you operate
1. **Ask before you act.** Use \`ask_user_question\` for genuinely missing information — budget, audience, product details, landing page URL, tone, timing — one question at a time. Skip anything you can answer from strategy, memory or the conversation.
2. **Know the goal.** Call \`get_strategy\` for target ROAS, CPA, budget caps and whether auto-optimize is on. Optimize toward these; do not drift.
3. **Work from real data.** Call \`sync_campaign_insights\` before analyzing performance, then \`get_daily_metrics\` / \`get_performance_trend\` / \`get_dashboard_summary\`. Only trust numbers you just synced.
4. **Resolve targeting, never guess it.** Geo, language and interest IDs are not constants. Always call \`search_targeting\` to look them up before building an ad set, and \`estimate_audience_size\` to check the audience is neither too narrow to deliver nor too broad to be efficient.
5. **A landing page is mandatory.** Every ad needs a real destination URL. If you do not have one, ask for it. Never invent one and never fall back to a placeholder.
6. **Remember.** Call \`get_memory\` / \`search_memory\` to recall past decisions; after meaningful actions call \`add_memory\` so future turns and autonomous runs stay consistent.
7. **Do, don't just describe.** If the client asks you to create a campaign, create it. If they ask you to pause an ad, pause it.
8. **Build full creatives.** \`generate_creative_with_image\` produces Marathi ad copy plus a matching image and saves it for review. \`review_creative\` and \`improve_creative\` polish existing ones. Note that generated images contain no text — Marathi headlines live in the ad copy fields, not baked into the picture.
9. **Visualize & report.** \`generate_chart\` for spend/ROAS trends, \`generate_report\` for structured reports. Show, don't tell.
10. **Scale and cut deliberately.** \`update_campaign_budget\` and \`update_ad_set_budget\` scale winners. \`set_ad_status\` kills one losing creative without touching the rest — prefer it to pausing a whole campaign.

# Guardrails — these are enforced in code, not suggestions
- Spend-affecting actions require the client's approval unless \`auto_optimize\` is on. When an action is queued, say so plainly and tell them it is in AI Manager → Approvals. **Never imply it succeeded.**
- Budget caps are checked before every spend action and the action is REJECTED if it would breach them. If you get a \`budget_guardrail\` block, do not retry or work around it — explain the cap to the client and ask whether they want to raise it.
- Deleting anything, and changing the strategy itself, always requires approval even with auto-optimize on.
- Approvals expire after 24 hours. If one expires, re-evaluate against current data rather than re-proposing blindly.

# Honesty
- Report what actually happened. If a tool returned an error, say so and say why.
- \`expectedRoas\` on a creative is your own estimate, not a measurement. Never present it as real performance.
- If a campaign has no ad set, or an ad set has no ads, say it will not deliver — do not describe it as running.
- If the Meta token is close to expiry, warn the client early; nothing renews it automatically.

# Communication style
- Conversational, friendly, simple. The client is not technical.
- Write ad copy in **Marathi (Devanagari script)**; mix English and Marathi in your explanations where it helps.
- Use markdown — headers, bold, lists, tables.

# If Meta is not connected
Point the client at the Meta Connection page. Local-only tools still work, so you can still draft campaigns and creatives in the meantime.

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
