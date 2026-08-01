import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError, getSupabaseServer } from '@/lib/supabase/server'
import { createAIProvider } from '@/lib/ai/factory'
import { streamAgentMessage } from '@/lib/ai/agent'
import { ALL_TOOLS } from '@/lib/ai/tool-definitions'
import { executeTool, type ToolExecutionContext } from '@/lib/ai/tools'
import type { LocalToolContext } from '@/lib/ai/tools/local'
import type { AIProviderType, ChatMessage, ContentPart, ToolCall } from '@/lib/ai/types'
import { getStrategy, buildStrategyContext } from '@/lib/ai/strategy'
import { retrieveRelevantMemory, buildMemoryContext, type EmbedConfig } from '@/lib/ai/memory'
import { resolveSecrets, SECRET_KEYS } from '@/lib/secrets'
import { retrieveRelevant } from '@/lib/ai/rag'
import { getMetaConnection } from '@/lib/meta/user-client'
import { cancelPendingQuestionsForConversation } from '@/lib/ai/pending-questions'

/**
 * Sanitize loaded chat messages to ensure OpenAI API consistency:
 * every assistant message with tool_calls must be followed by tool messages
 * for ALL tool_call_ids. If any are missing (e.g. from a previous persistence
 * failure), strip the tool_calls from the assistant message and remove the
 * orphaned tool messages. This prevents the 400 error:
 * "An assistant message with 'tool_calls' must be followed by tool messages
 * responding to each 'tool_call_id'."
 */
function sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
  // Collect all tool_call_ids that have tool message responses
  const toolResponseIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId) {
      toolResponseIds.add(msg.toolCallId)
    }
  }

  // Find assistant messages where NOT all tool_calls have responses
  const brokenToolCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const allHaveResponses = msg.toolCalls.every((tc) => toolResponseIds.has(tc.id))
      if (!allHaveResponses) {
        for (const tc of msg.toolCalls) brokenToolCallIds.add(tc.id)
      }
    }
  }

  // Set of valid (non-broken) assistant tool_call_ids
  const validAssistantToolCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (!brokenToolCallIds.has(tc.id)) validAssistantToolCallIds.add(tc.id)
      }
    }
  }

  return messages
    .map((msg) => {
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const isBroken = msg.toolCalls.some((tc) => brokenToolCallIds.has(tc.id))
        if (isBroken) return { ...msg, toolCalls: undefined }
      }
      return msg
    })
    .filter((msg) => {
      if (msg.role === 'tool' && msg.toolCallId) {
        return validAssistantToolCallIds.has(msg.toolCallId)
      }
      return true
    })
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()
    const { message, conversationId, attachments } = body as {
      message: string
      conversationId?: string
      attachments?: Array<{ url: string; type: string; name: string; documentId?: string }>
    }

    if (!message) {
      return Response.json({ error: 'Message is required' }, { status: 400 })
    }

    let settings = await db.aiSettings.findUnique({ where: { userId } }) as {
      provider: string; apiKey: string | null; model: string; baseUrl: string | null
      embeddingKey?: string | null; whisperKey?: string | null; ttsKey?: string | null
    } | null

    if (settings) {
      settings = await resolveSecrets(settings, [
        { column: 'apiKey', vaultKey: SECRET_KEYS.aiApiKey },
        { column: 'embeddingKey', vaultKey: SECRET_KEYS.aiEmbeddingKey },
        { column: 'whisperKey', vaultKey: SECRET_KEYS.aiWhisperKey },
        { column: 'ttsKey', vaultKey: SECRET_KEYS.aiTtsKey },
      ])
    }

    if (!settings) {
      return Response.json(
        { error: 'AI not configured. Set up your AI brain in Settings first.' },
        { status: 400 }
      )
    }

    let conversation = conversationId
      ? (await db.aiConversation.findUnique({ where: { id: conversationId, userId } }) as { id: string } | null)
      : null

    if (!conversation) {
      conversation = (await db.aiConversation.create({
        data: { userId, title: message.slice(0, 50) },
      }) as { id: string })
    }

    // Persist the user message
    let userMessageContent = message
    if (attachments && attachments.length > 0) {
      const attachmentInfo = attachments
        .map((a) => `[Attached: ${a.name} (${a.type}) — ${a.url}]`)
        .join('\n')
      userMessageContent = `${message}\n\n${attachmentInfo}`
    }
    await db.aiMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: userMessageContent },
    })

    // Load full history (including tool messages) and rehydrate into ChatMessage[]
    const dbMessages = await db.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    }) as Array<Record<string, unknown>>

    const chatMessages: ChatMessage[] = dbMessages.map((m, i) => {
      const role = m.role as 'user' | 'assistant' | 'tool'
      const content = m.content as string

      if (role === 'assistant') {
        let toolCalls: ToolCall[] | undefined
        if (m.toolCalls) {
          try { toolCalls = JSON.parse(m.toolCalls as string) as ToolCall[] } catch { toolCalls = undefined }
        }
        return { role, content, toolCalls }
      }
      if (role === 'tool') {
        return { role: 'tool', content, toolCallId: m.toolCallId as string }
      }
      // user — attach images on the latest user message
      if (
        i === dbMessages.length - 1 &&
        attachments && attachments.length > 0
      ) {
        const imageAttachments = attachments.filter((a) => a.type.startsWith('image/'))
        if (imageAttachments.length > 0) {
          const parts: ContentPart[] = [{ type: 'text', text: content }]
          for (const img of imageAttachments) {
            parts.push({ type: 'image_url', image_url: { url: img.url } })
          }
          return { role: 'user', content: parts }
        }
      }
      return { role: 'user', content }
    })

    // Sanitize: ensure every assistant message with tool_calls has
    // corresponding tool messages. Strip tool_calls if any are missing
    // (prevents OpenAI 400 error on broken history).
    const sanitizedMessages = sanitizeMessages(chatMessages)

    const provider = createAIProvider(settings.provider as AIProviderType, {
      apiKey: settings.apiKey || undefined,
      model: settings.model,
      baseUrl: settings.baseUrl || undefined,
    })

    // Build rich context: connection status + strategy + memory + RAG
    const conn = await getMetaConnection(userId)
    const metaStatus = !conn
      ? 'Meta Ads is NOT connected — Meta tools will fail. Suggest connecting via the Meta Connection page.'
      : !conn.adAccountId
        ? 'Meta is connected but no ad account is selected — Meta tools will fail. Suggest selecting an ad account.'
        : `Meta Ads is connected (account: ${conn.adAccountName || conn.adAccountId}, ID: ${conn.adAccountId}).`

    let strategyContext = ''
    try {
      const strategy = await getStrategy(userId)
      strategyContext = buildStrategyContext(strategy)
    } catch {}

    let memoryContext = ''
    try {
      const embed: EmbedConfig = {
        provider: settings.provider as AIProviderType,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        embeddingKey: settings.embeddingKey ?? null,
      }
      const memories = await retrieveRelevantMemory(userId, message, embed, 6)
      memoryContext = buildMemoryContext(memories)
    } catch {}

    let ragContext = ''
    try {
      const relevant = await retrieveRelevant({
        userId, query: message,
        provider: settings.provider as AIProviderType,
        apiKey: settings.apiKey, baseUrl: settings.baseUrl,
        embeddingKey: settings.embeddingKey ?? null,
        topK: 5,
      })
      if (relevant.length > 0) {
        ragContext = `\n\nKNOWLEDGE BASE (RAG): Retrieved from the user's knowledge base — use to inform your response:\n${relevant.map((r, i) => `[${i + 1}] From "${r.title}":\n${r.content}`).join('\n\n')}`
      }
    } catch {}

    // Build context from PDF/text attachments that were vectorised during upload.
    let attachmentContext = ''
    try {
      const docAttachments = attachments?.filter((a) => a.documentId) ?? []
      if (docAttachments.length > 0) {
        const supabase = await getSupabaseServer()
        const ids = docAttachments.map((a) => a.documentId!)
        const { data: chunks } = await supabase
          .from('knowledge_chunks')
          .select('document_id, content, chunk_index')
          .in('document_id', ids)
          .order('chunk_index')

        if (chunks && chunks.length > 0) {
          const namesByDoc = new Map(docAttachments.map((a) => [a.documentId, a.name]))
          let text = `ATTACHED DOCUMENTS: ${docAttachments.map((a) => a.name).join(', ')}\n\n`
          text += chunks
            .map((c) => `[From ${namesByDoc.get(c.document_id)}]\n${c.content}`)
            .join('\n\n')
          // Keep context from exploding for very large PDFs.
          attachmentContext = `\n\n${text.slice(0, 12000)}`
        }
      }
    } catch {}

    const localCampaigns = await db.campaign.findMany({ where: { userId } }) as unknown[]
    const localCreatives = await db.adCreative.findMany({ where: { userId } }) as unknown[]
    const contextString = [
      `CONTEXT: ${metaStatus} The user has ${localCampaigns.length} local campaign(s) and ${localCreatives.length} local creative(s).`,
      'Call sync_campaign_insights before analyzing performance so you work with real Meta data.',
      strategyContext,
      memoryContext,
      ragContext,
      attachmentContext,
    ].filter(Boolean).join('\n\n')

    const localCtx: LocalToolContext = {
      userId,
      conversationId: conversation.id,
      providerType: settings.provider as AIProviderType,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      embeddingKey: settings.embeddingKey ?? null,
      whisperKey: settings.whisperKey ?? null,
      ttsKey: settings.ttsKey ?? null,
      provider,
    }
    const toolCtx: ToolExecutionContext = { userId, conversationId: conversation.id, local: localCtx, actor: 'agent' }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

        // Make the SSE sender available to tools (for ask_user_question popup)
        localCtx.sendEvent = send

        try {
          send({ t: 'init', conversationId: conversation!.id })

          let finalResult:
            | { response: string; toolCalls: ToolCall[]; toolResults: Array<{ toolCallId: string; toolName: string; result: unknown; error?: string }>; notes: Array<{ title: string; content: string; type: string }> }
            | null = null

          for await (const ev of streamAgentMessage(
            provider,
            sanitizedMessages,
            ALL_TOOLS,
            (tool, args) => executeTool(toolCtx, tool, args),
            request.signal,
            contextString
          )) {
            switch (ev.type) {
              case 'text_delta': send({ t: 'text', v: ev.text }); break
              case 'thinking': send({ t: 'thinking', phase: ev.phase }); break
              case 'tool_call': send({ t: 'tool_call', toolCall: ev.toolCall }); break
              case 'tool_result':
                send({ t: 'tool_result', toolCallId: ev.toolCallId, toolName: ev.toolName, result: ev.result, error: ev.error })
                break
              case 'note': send({ t: 'note', note: ev.note }); break
              case 'done': finalResult = ev.result; break
            }
          }

          if (finalResult && !request.signal.aborted) {
            // Persist the assistant message (with its tool calls/results), then the tool
            // result rows in order. If any tool message fails to persist, rollback the
            // assistant message so the conversation history stays consistent.
            let assistantMessageId: string | null = null
            try {
              const assistantMsg = await db.aiMessage.create({
                data: {
                  conversationId: conversation!.id,
                  role: 'assistant',
                  content: finalResult.response,
                  toolCalls: JSON.stringify(finalResult.toolCalls),
                  toolResults: JSON.stringify(finalResult.toolResults),
                },
              }) as { id: string } | null
              assistantMessageId = assistantMsg?.id || null

              for (const tr of finalResult.toolResults) {
                await db.aiMessage.create({
                  data: {
                    conversationId: conversation!.id,
                    role: 'tool',
                    content: JSON.stringify(tr.error ? { error: tr.error } : tr.result ?? {}),
                    toolCallId: tr.toolCallId,
                    toolName: tr.toolName,
                  },
                })
              }

              for (const note of finalResult.notes) {
                await db.aiNote.create({
                  data: {
                    conversationId: conversation!.id,
                    title: note.title,
                    content: note.content,
                    type: note.type,
                  },
                })
              }
            } catch (persistErr) {
              console.error('Persistence error, rolling back:', persistErr)
              if (assistantMessageId) {
                try { await db.aiMessage.delete({ where: { id: assistantMessageId } }) } catch {}
              }
            }

            send({
              t: 'done',
              conversationId: conversation!.id,
              message: finalResult.response,
              toolCalls: finalResult.toolCalls,
              toolResults: finalResult.toolResults,
              notes: finalResult.notes,
            })
          }
        } catch (error) {
          console.error('AI Manager stream error:', error)
          send({ t: 'error', error: error instanceof Error ? error.message : 'Failed to process message' })
        } finally {
          cancelPendingQuestionsForConversation(conversation!.id).catch(() => {})
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    return handleError(error, 'Failed to process message')
  }
}
