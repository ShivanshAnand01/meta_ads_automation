import { db } from '@/lib/db/supabase-db'
import { createAIProvider } from '@/lib/ai/factory'
import { processAgentMessage, streamAgentMessage, type AgentResult, type AgentStreamEvent } from '@/lib/ai/agent'
import { ALL_TOOLS } from '@/lib/ai/tool-definitions'
import { executeTool, type ToolExecutionContext } from '@/lib/ai/tools'
import type { LocalToolContext } from '@/lib/ai/tools/local'
import type { AIProvider, AIProviderType, ChatMessage, ToolCall, ContentPart } from '@/lib/ai/types'
import { getStrategy, updateStrategy, buildStrategyContext, type AccountStrategy } from '@/lib/ai/strategy'
import { getRecentMemory, addMemory, retrieveRelevantMemory, buildMemoryContext, type EmbedConfig, type ManagerMemory } from '@/lib/ai/memory'
import { getMetaConnection } from '@/lib/meta/user-client'
import { resolveSecrets, SECRET_KEYS } from '@/lib/secrets'
import { generateAdImage, saveImageToStorage, type ImageGenOptions, type ImageGenResult } from '@/lib/ai/image-generator'
import { getSupabaseServer } from '@/lib/supabase/server'
import { syncCampaignInsights, syncFromMeta } from '@/lib/meta/sync'
import { runReflection } from '@/lib/ai/reflection'
import { retrieveRelevant } from '@/lib/ai/rag'
import { logAction } from '@/lib/ai/audit'
import { generateStructured, creativeSuggestionSchema, enforceCopyLimits } from '@/lib/ai/structured'
import { checkBudget, buildPacingContext } from '@/lib/ai/budget-guard'

/**
 * How many past messages to keep in the model's context. Tool results are
 * verbose, so this is deliberately modest — durable facts belong in memory
 * (get_memory / search_memory), not in an ever-growing transcript.
 */
const MAX_HISTORY_MESSAGES = 40

/**
 * Keep the most recent messages while preserving assistant/tool pairing: an
 * assistant message with tool_calls must keep its tool replies, or providers
 * reject the request.
 */
function windowMessages(
  messages: Array<Record<string, unknown>>,
  limit: number,
): { messages: Array<Record<string, unknown>>; droppedCount: number } {
  if (messages.length <= limit) return { messages, droppedCount: 0 }

  let start = messages.length - limit
  // Never begin the window on an orphaned tool reply.
  while (start < messages.length && messages[start].role === 'tool') start++
  return { messages: messages.slice(start), droppedCount: start }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ManagerConfig {
  userId: string
  conversationId?: string
  actor?: 'agent' | 'autonomous'
  autoApproved?: boolean
}

export interface ChatOptions {
  attachments?: Array<{ url: string; type: string; name: string }>
  signal?: AbortSignal
  streamCallback?: (event: AgentStreamEvent) => void
}

export interface CreativeResult {
  creativeId?: string
  title: string
  description: string
  primaryText: string | null
  headline: string | null
  callToAction: string
  imageUrl: string | null
  imageProvider: string | null
  imageError: string | null
  success: boolean
  message: string
  warnings?: string[]
}

export interface FullAutonomyResult {
  success: boolean
  response: string
  toolCalls: ToolCall[]
  toolResults: Array<{ toolCallId: string; toolName: string; result: unknown; error?: string }>
  notes: Array<{ title: string; content: string; type: string }>
  conversationId: string
  error?: string
}

export interface ManagerContext {
  metaConnected: boolean
  metaStatus: string
  adAccountId: string | null
  adAccountName: string | null
  strategy: AccountStrategy
  recentMemories: ManagerMemory[]
  ragContext: string
  localCampaignCount: number
  localCreativeCount: number
}

/**
 * AIManager — the unified, self-contained wrapper that gives the AI Manager
 * complete autonomy over the entire Meta Ads platform.
 *
 * It encapsulates the full lifecycle:
 *   1. Initialise (provider, strategy, memory, connection status, RAG context)
 *   2. Process messages (interactive chat with tool-calling, streaming)
   *   3. Generate ad creative images (GPT image → Pollinations fallback chain)
 *   4. Generate full creatives (Marathi ad copy + matching image, saved to DB)
 *   5. Sync live Meta data
 *   6. Run autonomous routines (morning optimization, pacing, anomaly detection)
 *   7. Run full autonomy cycle (sync → analyze → act → reflect → learn)
 *   8. Approve / execute pending actions
 *
 * Every action is audited. Spend-affecting actions respect guardrails: they
 * require per-action approval unless `autoOptimize` is enabled in the strategy,
 * in which case the manager acts decisively and logs everything.
 */
export class AIManager {
  readonly userId: string
  readonly conversationId?: string
  readonly actor: 'agent' | 'autonomous'
  readonly autoApproved: boolean

  private settings: any
  private provider: AIProvider | null = null
  private strategy: AccountStrategy | null = null
  private localCtx: LocalToolContext | null = null
  private toolCtx: ToolExecutionContext | null = null
  private _initialized = false

  constructor(config: ManagerConfig) {
    this.userId = config.userId
    this.conversationId = config.conversationId
    this.actor = config.actor || 'agent'
    this.autoApproved = config.autoApproved || false
  }

  // ─── Initialization ────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this._initialized) return

    let settings = await db.aiSettings.findUnique({ where: { userId: this.userId } }) as any
    if (!settings) {
      throw new Error('AI not configured. Set up your AI brain in Settings first.')
    }

    settings = await resolveSecrets(settings, [
      { column: 'apiKey', vaultKey: SECRET_KEYS.aiApiKey },
      { column: 'embeddingKey', vaultKey: SECRET_KEYS.aiEmbeddingKey },
      { column: 'whisperKey', vaultKey: SECRET_KEYS.aiWhisperKey },
      { column: 'ttsKey', vaultKey: SECRET_KEYS.aiTtsKey },
    ])

    this.settings = settings
    this.provider = createAIProvider(settings.provider as AIProviderType, {
      apiKey: settings.apiKey || undefined,
      model: settings.model,
      baseUrl: settings.baseUrl || undefined,
    })

    try {
      this.strategy = await getStrategy(this.userId)
    } catch {
      this.strategy = { userId: this.userId, targetRoas: 2.0, autoOptimize: false } as AccountStrategy
    }

    this.localCtx = {
      userId: this.userId,
      conversationId: this.conversationId,
      providerType: settings.provider as AIProviderType,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      embeddingKey: settings.embeddingKey ?? null,
      whisperKey: settings.whisperKey ?? null,
      ttsKey: settings.ttsKey ?? null,
      provider: this.provider,
    }

    const effectiveAutoApproved = this.autoApproved || Boolean((this.strategy as any).autoOptimize)

    this.toolCtx = {
      userId: this.userId,
      conversationId: this.conversationId,
      local: this.localCtx,
      actor: this.actor,
      autoApproved: effectiveAutoApproved,
    }

    this._initialized = true
  }

  private ensureInitialized(): void {
    if (!this._initialized || !this.provider || !this.toolCtx || !this.localCtx) {
      throw new Error('AIManager not initialized — call init() first')
    }
  }

  getProvider(): AIProvider {
    this.ensureInitialized()
    return this.provider!
  }

  getStrategy(): AccountStrategy {
    this.ensureInitialized()
    return this.strategy!
  }

  getToolContext(): ToolExecutionContext {
    this.ensureInitialized()
    return this.toolCtx!
  }

  getLocalContext(): LocalToolContext {
    this.ensureInitialized()
    return this.localCtx!
  }

  getSettings(): any {
    this.ensureInitialized()
    return this.settings
  }

  // ─── Context Building ─────────────────────────────────────────────────

  async buildContext(userMessage?: string): Promise<{ contextString: string; context: ManagerContext }> {
    this.ensureInitialized()

    const conn = await getMetaConnection(this.userId).catch(() => null)
    const metaStatus = !conn
      ? 'Meta Ads is NOT connected — Meta tools will fail. Suggest connecting via the Meta Connection page.'
      : !conn.adAccountId
        ? 'Meta is connected but no ad account is selected — Meta tools will fail. Suggest selecting an ad account.'
        : `Meta Ads is connected (account: ${conn.adAccountName || conn.adAccountId}, ID: ${conn.adAccountId}).`

    let strategyContext = ''
    try {
      if (!this.strategy) this.strategy = await getStrategy(this.userId)
      strategyContext = buildStrategyContext(this.strategy)
    } catch {}

    let memoryContext = ''
    let recentMemories: ManagerMemory[] = []
    try {
      const embed: EmbedConfig = {
        provider: this.settings.provider as AIProviderType,
        apiKey: this.settings.apiKey,
        baseUrl: this.settings.baseUrl,
        embeddingKey: this.settings.embeddingKey ?? null,
      }
      if (userMessage) {
        recentMemories = await retrieveRelevantMemory(this.userId, userMessage, embed, 6)
      } else {
        recentMemories = await getRecentMemory(this.userId, 8)
      }
      memoryContext = buildMemoryContext(recentMemories)
    } catch {}

    let ragContext = ''
    if (userMessage) {
      try {
        const relevant = await retrieveRelevant({
          userId: this.userId,
          query: userMessage,
          provider: this.settings.provider as AIProviderType,
          apiKey: this.settings.apiKey,
          baseUrl: this.settings.baseUrl,
          embeddingKey: this.settings.embeddingKey ?? null,
          topK: 5,
        })
        if (relevant.length > 0) {
          ragContext = `\n\nKNOWLEDGE BASE (RAG): Retrieved from the user's knowledge base — use to inform your response:\n${relevant.map((r, i) => `[${i + 1}] From "${r.title}":\n${r.content}`).join('\n\n')}`
        }
      } catch {}
    }

    const localCampaigns = await db.campaign.findMany({ where: { userId: this.userId } }) as unknown[]
    const localCreatives = await db.adCreative.findMany({ where: { userId: this.userId } }) as unknown[]

    // Real pacing numbers, so the agent reasons about spend against the caps
    // that will actually be enforced rather than guessing.
    let pacingContext = ''
    try {
      const decision = await checkBudget(this.userId, 'create_campaign', {})
      pacingContext = buildPacingContext(decision)
    } catch {
      /* pacing is advisory here; the hard check still runs at execution time */
    }

    const contextString = [
      `CONTEXT: ${metaStatus} The user has ${localCampaigns.length} local campaign(s) and ${localCreatives.length} local creative(s).`,
      'Call sync_campaign_insights before analyzing performance so you work with real Meta data.',
      strategyContext,
      pacingContext,
      memoryContext,
      ragContext,
    ].filter(Boolean).join('\n\n')

    return {
      contextString,
      context: {
        metaConnected: !!conn,
        metaStatus,
        adAccountId: conn?.adAccountId ?? null,
        adAccountName: conn?.adAccountName ?? null,
        strategy: this.strategy!,
        recentMemories,
        ragContext,
        localCampaignCount: localCampaigns.length,
        localCreativeCount: localCreatives.length,
      },
    }
  }

  // ─── Interactive Chat ──────────────────────────────────────────────────

  async chat(messages: ChatMessage[], systemContext?: string): Promise<AgentResult> {
    this.ensureInitialized()
    return processAgentMessage(
      this.provider!,
      messages,
      ALL_TOOLS,
      (tool, args) => executeTool(this.toolCtx!, tool, args),
      systemContext,
    )
  }

  async *chatStream(
    messages: ChatMessage[],
    systemContext?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent, void, unknown> {
    this.ensureInitialized()
    yield* streamAgentMessage(
      this.provider!,
      messages,
      ALL_TOOLS,
      (tool, args) => executeTool(this.toolCtx!, tool, args),
      signal,
      systemContext,
    )
  }

  async processUserMessage(
    message: string,
    conversationId: string,
    attachments?: Array<{ url: string; type: string; name: string }>,
    signal?: AbortSignal,
    streamCallback?: (event: AgentStreamEvent) => void,
  ): Promise<{ result: AgentResult; conversationId: string }> {
    this.ensureInitialized()

    // Ensure the tool context has the right conversationId
    this.toolCtx!.conversationId = conversationId
    this.localCtx!.conversationId = conversationId

    // Build context
    const { contextString: baseContext } = await this.buildContext(message)

    // Persist the user message
    let userMessageContent = message
    if (attachments && attachments.length > 0) {
      const attachmentInfo = attachments
        .map((a) => `[Attached: ${a.name} (${a.type}) — ${a.url}]`)
        .join('\n')
      userMessageContent = `${message}\n\n${attachmentInfo}`
    }
    await db.aiMessage.create({
      data: { conversationId, role: 'user', content: userMessageContent },
    })

    // Load history, capped.
    //
    // This used to load EVERY message in the conversation with no limit, so
    // cost and latency grew linearly forever until the model 400'd on context
    // length. We keep a rolling window of the most recent turns and prepend a
    // short summary line so older context is not silently lost.
    const allMessages = await db.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    }) as Array<Record<string, unknown>>

    const { messages: dbMessages, droppedCount } = windowMessages(allMessages, MAX_HISTORY_MESSAGES)

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
      if (i === dbMessages.length - 1 && attachments && attachments.length > 0) {
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

    const contextString = droppedCount > 0
      ? `${baseContext}

NOTE: this conversation is long, so the ${droppedCount} oldest message(s) are not in context. Rely on get_memory and search_memory for earlier decisions rather than assuming you can see them.`
      : baseContext

    // Stream or process
    let result: AgentResult
    if (streamCallback) {
      let finalResult: AgentResult | null = null
      for await (const ev of this.chatStream(chatMessages, contextString, signal)) {
        streamCallback(ev)
        if (ev.type === 'done') finalResult = ev.result
      }
      result = finalResult || { response: '', toolCalls: [], toolResults: [], notes: [] }
    } else {
      result = await this.chat(chatMessages, contextString)
    }

    // Persist assistant message + tool messages
    await db.aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: result.response,
        toolCalls: JSON.stringify(result.toolCalls),
        toolResults: JSON.stringify(result.toolResults),
      },
    })
    for (const tr of result.toolResults) {
      await db.aiMessage.create({
        data: {
          conversationId,
          role: 'tool',
          content: JSON.stringify(tr.error ? { error: tr.error } : tr.result ?? {}),
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
        },
      })
    }
    for (const note of result.notes) {
      await db.aiNote.create({
        data: { conversationId, title: note.title, content: note.content, type: note.type },
      })
    }

    return { result, conversationId }
  }

  // ─── Image Generation ─────────────────────────────────────────────────

  async generateImage(
    prompt: string,
    options?: ImageGenOptions,
  ): Promise<ImageGenResult> {
    this.ensureInitialized()
    // Image generation always uses OpenAI's GPT-image-1 (or DALL-E) regardless
    // of the active chat provider. Use the OpenAI key when the active provider is
    // OpenAI; otherwise fall back to the dedicated embedding/image key.
    const imageApiKey =
      this.localCtx!.providerType === 'openai'
        ? this.localCtx!.apiKey
        : this.localCtx!.embeddingKey || this.localCtx!.apiKey
    const result = await generateAdImage('openai', imageApiKey, prompt, options)

    if (result.success && result.imageUrl) {
      // Persist to Supabase storage for a stable public URL
      try {
        const supabase = await getSupabaseServer()
        const saved = await saveImageToStorage(result.imageUrl, this.userId, supabase as never)
        if (saved) {
          return { ...result, imageUrl: saved.url }
        }
      } catch {}
    }

    return result
  }

  async generateImageAndSave(
    prompt: string,
    options?: ImageGenOptions,
  ): Promise<{ imageUrl: string | null; provider: string; error: string | null }> {
    const result = await this.generateImage(prompt, options)
    if (!result.success || !result.imageUrl) {
      return { imageUrl: null, provider: result.provider, error: result.error || 'Image generation failed' }
    }
    return { imageUrl: result.imageUrl, provider: result.provider, error: null }
  }

  // ─── Full Creative Generation (copy + image) ───────────────────────────

  async generateCreativeWithImage(params: {
    product: string
    angle?: string
    callToAction?: string
    campaignId?: string
    imagePrompt?: string
    imageOptions?: ImageGenOptions
  }): Promise<CreativeResult> {
    this.ensureInitialized()

    const { product, angle = 'benefit-driven', callToAction: cta = 'LEARN_MORE',
            campaignId = null, imagePrompt = '', imageOptions } = params

    // 1. Generate Marathi ad copy via the provider
    let copy: { title: string; description: string; primaryText: string; headline: string; callToAction: string } = {
      title: `${product} — ${angle}`,
      description: `${angle} angle for ${product}`,
      primaryText: '',
      headline: '',
      callToAction: cta,
    }

    const copyWarnings: string[] = []
    try {
      const copyPrompt = `Generate a Meta Ads creative for: "${product}". Angle: ${angle}. Target audience: Maharashtra, India (Marathi-speaking). Respond ONLY with valid JSON: {"title":"(English management name)","description":"(English, one sentence strategy)","primaryText":"(Marathi Devanagari ad copy, max 125 characters)","headline":"(Marathi Devanagari headline, max 40 characters)","callToAction":"${cta}","targeting":"(short targeting description)","expectedRoas":0,"reasoning":"(why this works)"}.`
      const validated = await generateStructured(
        this.provider!,
        creativeSuggestionSchema,
        copyPrompt,
        'You are an expert Marathi ad copywriter for the Maharashtrian market. Respond only with valid JSON, no markdown.',
      )
      const limited = enforceCopyLimits(validated)
      copyWarnings.push(...limited.copyWarnings)
      copy = {
        title: limited.title,
        description: limited.description,
        primaryText: limited.primaryText,
        headline: limited.headline,
        callToAction: limited.callToAction,
      }
    } catch (err) {
      // Previously this was `catch {}`, which persisted a creative with empty
      // ad copy and reported success. Surface it instead.
      copyWarnings.push(
        `Ad copy generation failed: ${err instanceof Error ? err.message : 'unknown error'}. Placeholder text was used.`,
      )
    }

    // 2. Generate the ad image via the enhanced image generator
    const finalImagePrompt = imagePrompt || `${product}, ${angle} marketing theme, professional digital ad creative, Marathi Indian audience, high quality, clean modern design, vibrant colors`
    const imgResult = await this.generateImage(finalImagePrompt, imageOptions)

    const imageUrl: string | null = imgResult.success && imgResult.imageUrl ? imgResult.imageUrl : null

    // 3. Persist the local creative
    const creative = await db.adCreative.create({
      data: {
        userId: this.userId,
        title: copy.title || `${product} Ad`,
        description: copy.description || angle,
        primaryText: copy.primaryText || null,
        headline: copy.headline || null,
        callToAction: copy.callToAction || cta,
        expectedSpend: 1000,
        expectedRoas: 2,
        language: 'marathi',
        audience: 'Maharashtra',
        imageUrl,
        campaignId,
        status: 'draft',
        reviewStatus: 'pending',
      },
    }) as any

    return {
      creativeId: creative?.id,
      title: creative?.title || copy.title,
      description: creative?.description || copy.description,
      primaryText: creative?.primaryText || copy.primaryText,
      headline: creative?.headline || copy.headline,
      callToAction: creative?.callToAction || cta,
      imageUrl,
      imageProvider: imgResult.provider,
      imageError: imageUrl ? null : (imgResult.error || 'Image generation failed — creative saved with text only.'),
      success: copyWarnings.length === 0,
      warnings: copyWarnings,
      message:
        `Creative "${creative?.title}" created${imageUrl ? ` with image (${imgResult.provider})` : ' (image generation failed — text only)'}. Ready for review.` +
        (copyWarnings.length ? ` Issues: ${copyWarnings.join(' ')}` : ''),
    }
  }

  // ─── Data Sync ────────────────────────────────────────────────────────

  async syncMetaInsights(days: number = 30): Promise<unknown> {
    return syncCampaignInsights(this.userId, days)
  }

  async syncMetaCampaigns(): Promise<unknown> {
    return syncFromMeta(this.userId)
  }

  // ─── Strategy Management ──────────────────────────────────────────────

  async getAccountStrategy(): Promise<AccountStrategy> {
    if (!this.strategy) this.strategy = await getStrategy(this.userId)
    return this.strategy
  }

  async setAccountStrategy(patch: Partial<AccountStrategy>): Promise<AccountStrategy> {
    this.strategy = await updateStrategy(this.userId, patch)
    // Update auto-approved status based on new strategy
    if (this.toolCtx) {
      this.toolCtx.autoApproved = this.autoApproved || this.strategy.autoOptimize
    }
    return this.strategy
  }

  // ─── Memory ───────────────────────────────────────────────────────────

  async remember(kind: 'summary' | 'decision' | 'observation' | 'learning' | 'outcome', content: string, importance: number = 5): Promise<void> {
    await addMemory({
      userId: this.userId,
      kind,
      content,
      importance,
      embed: {
        provider: this.settings.provider as AIProviderType,
        apiKey: this.settings.apiKey,
        baseUrl: this.settings.baseUrl,
        embeddingKey: this.settings.embeddingKey ?? null,
      },
    })
  }

  async recall(limit: number = 12): Promise<ManagerMemory[]> {
    return getRecentMemory(this.userId, limit)
  }

  // ─── Reflection ────────────────────────────────────────────────────────

  async reflect(): Promise<{ success: boolean; learnings: number; message: string }> {
    return runReflection({ userId: this.userId })
  }

  // ─── Direct Tool Execution ────────────────────────────────────────────

  async executeToolDirect(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    this.ensureInitialized()
    return executeTool(this.toolCtx!, toolName, args)
  }

  // ─── Audit ────────────────────────────────────────────────────────────

  async audit(
    toolName: string,
    args: Record<string, unknown>,
    status: 'success' | 'error' | 'pending',
    result?: unknown,
  ): Promise<void> {
    await logAction({
      userId: this.userId,
      conversationId: this.conversationId,
      toolName,
      arguments: args,
      status,
      result: result as any,
      actor: this.actor,
    })
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────

export async function createAIManager(config: ManagerConfig): Promise<AIManager> {
  const manager = new AIManager(config)
  await manager.init()
  return manager
}

/**
 * Create an AIManager with full autonomy enabled. The manager will be able to
 * execute spend-affecting Meta actions without per-action approval (as long as
 * the account strategy has autoOptimize enabled OR the caller explicitly
 * sets autoApproved).
 */
export async function createAutonomousManager(
  userId: string,
  options?: { conversationId?: string; forceAutoApproved?: boolean },
): Promise<AIManager> {
  const manager = new AIManager({
    userId,
    conversationId: options?.conversationId,
    actor: 'autonomous',
    autoApproved: options?.forceAutoApproved || false,
  })
  await manager.init()

  // Force auto-approved if explicitly requested (overrides strategy setting)
  if (options?.forceAutoApproved) {
    const ctx = manager.getToolContext()
    ctx.autoApproved = true
  }

  return manager
}
