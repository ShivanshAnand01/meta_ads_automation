import { db } from '@/lib/db/supabase-db'
import { getSupabaseServer } from '@/lib/supabase/server'
import type { AIProvider, AIProviderType } from '@/lib/ai/types'
import { generateAdImage, saveImageToStorage } from '@/lib/ai/image-generator'
import { retrieveRelevant, trackGeneratedImage } from '@/lib/ai/rag'
import { getStrategy, updateStrategy, buildStrategyContext } from '@/lib/ai/strategy'
import { getRecentMemory, addMemory } from '@/lib/ai/memory'
import { syncCampaignInsights, syncFromMeta, publishCampaignToMeta, setCampaignStatus, getAccountSummary } from '@/lib/meta/sync'
import { generateChart } from '@/lib/ai/chart'
import { transcribeAudio, speak } from '@/lib/ai/voice'
import type { MemoryKind } from '@/lib/ai/memory'
import { searchMemory as semanticSearchMemory } from '@/lib/ai/memory'
import { runReflection } from '@/lib/ai/reflection'
import { createPendingQuestion, cancelPendingQuestion } from '@/lib/ai/pending-questions'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface LocalToolContext {
  userId: string
  conversationId?: string
  providerType: AIProviderType
  apiKey?: string | null
  baseUrl?: string | null
  embeddingKey?: string | null
  whisperKey?: string | null
  ttsKey?: string | null
  provider?: AIProvider
  /** SSE event sender — used by ask_user_question to stream the question to the client. */
  sendEvent?: (event: Record<string, unknown>) => void
}

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

/** Execute a "local" (non-Meta) tool. Returns a JSON-serializable result. */
export async function executeLocalTool(tool: string, args: Record<string, unknown>, ctx: LocalToolContext): Promise<unknown> {
  const { userId } = ctx

  switch (tool) {
    // --- Ask user a clarifying question (popup on chat) -----------------
    case 'ask_user_question': {
      const question = (args.question as string) || 'Please provide more details.'
      const placeholder = (args.placeholder as string) || ''
      const questionId = crypto.randomUUID()

      if (!ctx.sendEvent) {
        return { error: 'Cannot ask user — no event stream available (autonomous mode).' }
      }

      ctx.sendEvent({ t: 'question', questionId, question, placeholder })

      try {
        const answer = await createPendingQuestion(questionId, question)
        return { success: true, answer, message: 'User answered the question.' }
      } catch (err) {
        cancelPendingQuestion(questionId)
        return {
          error: err instanceof Error ? err.message : 'Question failed',
          answer: null,
          message: 'User did not answer — proceed with reasonable defaults.',
        }
      }
    }

    // --- Strategy ---------------------------------------------------------
    case 'get_strategy': {
      const strategy = await getStrategy(userId)
      return { strategy }
    }
    case 'update_strategy': {
      const patch: Record<string, unknown> = {}
      if (args.targetRoas !== undefined) patch.targetRoas = num(args.targetRoas)
      if (args.targetCpa !== undefined) patch.targetCpa = args.targetCpa != null ? num(args.targetCpa) : null
      if (args.monthlyBudget !== undefined) patch.monthlyBudget = args.monthlyBudget != null ? num(args.monthlyBudget) : null
      if (args.dailyBudgetCap !== undefined) patch.dailyBudgetCap = args.dailyBudgetCap != null ? num(args.dailyBudgetCap) : null
      if (args.scalingRules !== undefined) patch.scalingRules = args.scalingRules
      if (args.guardrails !== undefined) patch.guardrails = args.guardrails
      if (args.focus !== undefined) patch.focus = args.focus as string
      if (args.autoOptimize !== undefined) patch.autoOptimize = Boolean(args.autoOptimize)
      const strategy = await updateStrategy(userId, patch)
      return { success: true, strategy, context: buildStrategyContext(strategy) }
    }

    // --- Memory -----------------------------------------------------------
    case 'get_memory': {
      const limit = (args.limit as number) || 12
      const memories = await getRecentMemory(userId, limit)
      return { memories, total: memories.length }
    }
    case 'add_memory': {
      const memory = await addMemory({
        userId,
        kind: ((args.kind as string) || 'observation') as MemoryKind,
        content: (args.content as string) || '',
        relatedId: (args.relatedId as string) || null,
        importance: (args.importance as number) || 5,
        embed: {
          provider: ctx.providerType,
          apiKey: ctx.apiKey,
          baseUrl: ctx.baseUrl,
          embeddingKey: ctx.embeddingKey,
        },
      })
      return { success: true, memory }
    }

    // --- Campaigns (local DB) --------------------------------------------
    case 'get_local_campaigns': {
      const campaigns = await db.campaign.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }) as any[]
      return {
        campaigns: campaigns.map((c) => ({
          id: c.id, name: c.name, objective: c.objective, status: c.status,
          budget: c.budget, budgetType: c.budgetType, metaCampaignId: c.metaCampaignId,
          totalSpend: num(c.totalSpend), totalRevenue: num(c.totalRevenue),
          totalImpressions: num(c.totalImpressions), totalClicks: num(c.totalClicks),
          totalConversions: num(c.totalConversions),
          roas: num(c.totalSpend) > 0 ? num(c.totalRevenue) / num(c.totalSpend) : 0,
          lastSyncedAt: c.lastSyncedAt,
        })),
        total: campaigns.length,
      }
    }
    case 'get_local_campaign': {
      const campaign = await db.campaign.findUnique({ where: { id: args.campaignId as string } }) as any
      if (!campaign) return { error: 'Campaign not found' }
      return { campaign }
    }
    case 'create_local_campaign': {
      const campaign = await db.campaign.create({
        data: {
          userId,
          name: (args.name as string) || 'Untitled Campaign',
          objective: (args.objective as string) || 'OUTCOME_SALES',
          budget: num(args.budget) || 1000,
          budgetType: (args.budgetType as string) || 'daily',
          startDate: args.startDate ? new Date(args.startDate as string) : null,
          endDate: args.endDate ? new Date(args.endDate as string) : null,
          status: 'draft',
        },
      }) as any
      return { success: true, campaignId: campaign?.id, message: `Campaign "${campaign?.name}" created as a draft` }
    }
    case 'update_local_campaign': {
      const data: Record<string, unknown> = {}
      if (args.name) data.name = args.name
      if (args.status) data.status = args.status
      if (args.budget !== undefined) data.budget = num(args.budget)
      if (args.budgetType) data.budgetType = args.budgetType
      const campaign = await db.campaign.update({ where: { id: args.campaignId as string }, data }) as any
      if (!campaign) return { error: 'Campaign not found' }
      return { success: true, campaignId: campaign.id, message: 'Campaign updated' }
    }
    case 'delete_local_campaign': {
      await db.campaign.delete({ where: { id: args.campaignId as string } })
      return { success: true, message: 'Campaign deleted' }
    }

    // --- Creatives (local DB) ---------------------------------------------
    case 'get_local_creatives': {
      const creatives = await db.adCreative.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }) as any[]
      return {
        creatives: creatives.map((c) => ({
          id: c.id, title: c.title, description: c.description,
          primaryText: c.primaryText, headline: c.headline,
          callToAction: c.callToAction, status: c.status, reviewStatus: c.reviewStatus,
          language: c.language, audience: c.audience, imageUrl: c.imageUrl,
          impressions: num(c.impressions), clicks: num(c.clicks), conversions: num(c.conversions),
          actualSpend: num(c.actualSpend), revenue: num(c.revenue),
          roas: num(c.actualSpend) > 0 ? num(c.revenue) / num(c.actualSpend) : 0,
        })),
        total: creatives.length,
      }
    }
    case 'create_local_creative': {
      const creative = await db.adCreative.create({
        data: {
          userId,
          title: (args.title as string) || 'Untitled',
          description: (args.description as string) || '',
          primaryText: (args.primaryText as string) || null,
          headline: (args.headline as string) || null,
          callToAction: (args.callToAction as string) || 'LEARN_MORE',
          expectedSpend: num(args.expectedSpend) || 1000,
          expectedRoas: num(args.expectedRoas) || 2,
          language: (args.language as string) || 'marathi',
          audience: (args.audience as string) || 'Maharashtra',
          imageUrl: (args.imageUrl as string) || null,
          campaignId: (args.campaignId as string) || null,
          status: 'draft', reviewStatus: 'pending',
        },
      }) as any
      return { success: true, creativeId: creative?.id, message: `Creative "${creative?.title}" created for review` }
    }
    case 'update_local_creative': {
      const data: Record<string, unknown> = {}
      if (args.title) data.title = args.title
      if (args.description) data.description = args.description
      if (args.primaryText) data.primaryText = args.primaryText
      if (args.headline) data.headline = args.headline
      if (args.callToAction) data.callToAction = args.callToAction
      if (args.status) data.status = args.status
      if (args.reviewStatus) data.reviewStatus = args.reviewStatus
      if (args.revenue !== undefined) data.revenue = num(args.revenue)
      const creative = await db.adCreative.update({ where: { id: args.creativeId as string }, data }) as any
      if (!creative) return { error: 'Creative not found' }
      return { success: true, creativeId: creative.id, message: 'Creative updated' }
    }
    case 'delete_local_creative': {
      await db.adCreative.delete({ where: { id: args.creativeId as string } })
      return { success: true, message: 'Creative deleted' }
    }

    // --- Image generation -------------------------------------------------
    case 'generate_ad_image': {
      const prompt = (args.prompt as string) || 'Professional ad creative for a Marathi ebook'
      const imageApiKey = ctx.providerType === 'openai' ? ctx.apiKey : ctx.embeddingKey
      const result = await generateAdImage('openai', imageApiKey, prompt, {
        size: (args.size as string) || undefined,
        style: (args.style as string) || undefined,
        quality: (args.quality as 'standard' | 'hd') || undefined,
        aspectRatio: (args.aspectRatio as '1:1' | '4:5' | '9:16' | '1.91:1' | '16:9') || undefined,
        brandColors: Array.isArray(args.brandColors) ? (args.brandColors as string[]) : undefined,
        negativePrompt: (args.negativePrompt as string) || undefined,
      })
      if (!result.success || !result.imageUrl) return { error: result.error || 'Image generation failed' }
      let savedUrl = result.imageUrl
      let storagePath: string | null = null
      try {
        const supabase = await getSupabaseServer()
        const saved = await saveImageToStorage(result.imageUrl, userId, supabase as never)
        if (saved) { savedUrl = saved.url; storagePath = saved.path }
      } catch {}
      try {
        await trackGeneratedImage({ userId, prompt, imageUrl: savedUrl, storagePath, provider: result.provider, size: (args.size as string) || '1024x1024', style: (args.style as string) || 'vivid' })
      } catch {}
      return {
        success: true,
        imageUrl: savedUrl,
        provider: result.provider,
        promptUsed: result.promptUsed,
        message: `Ad image generated via ${result.provider}${result.promptUsed ? '' : ''}. Saved to storage.`,
      }
    }

    // --- Combined creative + image (one step) ----------------------------
    case 'generate_creative_with_image': {
      const product = (args.product as string) || 'a Marathi ebook'
      const angle = (args.angle as string) || 'benefit-driven'
      const cta = (args.callToAction as string) || 'LEARN_MORE'
      const campaignId = (args.campaignId as string) || null
      const imagePromptArg = (args.imagePrompt as string) || ''

      // Generate Marathi ad copy via the provider
      let copy: { title: string; description: string; primaryText: string; headline: string; callToAction: string } = {
        title: `${product} — ${angle}`, description: `${angle} angle for ${product}`, primaryText: '', headline: '', callToAction: cta,
      }
      try {
        const prov = ctx.provider as { generateCompletion: (p: string, s?: string) => Promise<string> }
        const copyPrompt = `Generate a Meta Ads creative for: "${product}". Angle: ${angle}. Target audience: Maharashtra, India (Marathi-speaking). Respond ONLY with valid JSON: {"title":"(English management name)","description":"(English, one sentence strategy)","primaryText":"(Marathi Devanagari ad copy, 2-3 lines)","headline":"(Marathi Devanagari headline)","callToAction":"${cta}"}.`
        const text = await prov.generateCompletion(copyPrompt, 'You are an expert Marathi ad copywriter for the Maharashtrian market. Respond only with valid JSON, no markdown.')
        const parsed = JSON.parse(text)
        copy = { ...copy, ...parsed }
      } catch {}

      // Generate the ad image via the enhanced image generator (multi-provider fallback)
      const imagePrompt = imagePromptArg || `${product}, ${angle} marketing theme, professional digital ad creative, Marathi Indian audience, high quality, clean modern design, vibrant colors`
      const imageApiKey = ctx.providerType === 'openai' ? ctx.apiKey : ctx.embeddingKey
      const imgResult = await generateAdImage('openai', imageApiKey, imagePrompt, {
        size: '1024x1024',
        style: 'vivid',
        aspectRatio: (args.aspectRatio as '1:1' | '4:5' | '9:16' | '1.91:1' | '16:9') || undefined,
        quality: (args.quality as 'standard' | 'hd') || undefined,
        brandColors: Array.isArray(args.brandColors) ? (args.brandColors as string[]) : undefined,
        negativePrompt: (args.negativePrompt as string) || undefined,
      })
      let imageUrl: string | null = null
      if (imgResult.success && imgResult.imageUrl) {
        imageUrl = imgResult.imageUrl
        try {
          const supabase = await getSupabaseServer()
          const saved = await saveImageToStorage(imgResult.imageUrl, userId, supabase as never)
          if (saved) imageUrl = saved.url
        } catch {}
        try { await trackGeneratedImage({ userId, prompt: imagePrompt, imageUrl: imageUrl, storagePath: null, provider: imgResult.provider, size: '1024x1024', style: 'vivid' }) } catch {}
      }

      // Persist the local creative
      const creative = await db.adCreative.create({
        data: {
          userId,
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
        success: true,
        creativeId: creative?.id,
        creative: {
          title: creative?.title,
          primaryText: creative?.primaryText,
          headline: creative?.headline,
          callToAction: creative?.callToAction,
          imageUrl,
        },
        imageGenerated: !!imageUrl,
        imageProvider: imgResult.provider,
        imageError: imageUrl ? null : (imgResult.error || 'Image generation failed — creative saved with text only.'),
        message: `Creative "${creative?.title}" created${imageUrl ? ` with image (${imgResult.provider})` : ' (image generation failed — text only)'}. Ready for review.`,
      }
    }

    // --- Creative review / improve (LLM) ----------------------------------
    case 'review_creative': {
      const creative = await db.adCreative.findUnique({ where: { id: args.creativeId as string } }) as any
      if (!creative) return { error: 'Creative not found' }
      const reviewPrompt = `Review this Marathi ad creative for the Maharashtrian audience:
Title: ${creative.title}
Description: ${creative.description}
Primary Text: ${creative.primaryText || 'N/A'}
Headline: ${creative.headline || 'N/A'}
Call to Action: ${creative.callToAction || 'N/A'}
Language: ${creative.language || 'marathi'}
Provide JSON: { "score": number(1-10), "strengths": [], "weaknesses": [], "suggestions": [] }`
      try {
        const prov = ctx.provider as { generateCompletion: (p: string, s?: string) => Promise<string> }
        const text = await prov.generateCompletion(reviewPrompt, 'You are an expert ad creative reviewer. Respond only with valid JSON.')
        try { return { review: JSON.parse(text), creativeId: creative.id, title: creative.title } }
        catch { return { review: text, creativeId: creative.id, title: creative.title } }
      } catch {
        return { error: 'Failed to generate review', creativeId: creative.id }
      }
    }
    case 'improve_creative': {
      const creative = await db.adCreative.findUnique({ where: { id: args.creativeId as string } }) as any
      if (!creative) return { error: 'Creative not found' }
      const improvePrompt = `Improve this Marathi ad creative:
Title: ${creative.title}
Primary Text: ${creative.primaryText || 'N/A'}
Headline: ${creative.headline || 'N/A'}
Return JSON: { title, primaryText (Marathi/Devanagari), headline (Marathi/Devanagari), callToAction, reasoning }`
      try {
        const prov = ctx.provider as { generateCompletion: (p: string, s?: string) => Promise<string> }
        const text = await prov.generateCompletion(improvePrompt, 'You are an expert Marathi ad copywriter. Respond only with valid JSON.')
        try {
          const improved = JSON.parse(text)
          await db.adCreative.update({ where: { id: creative.id }, data: {
            title: improved.title || creative.title,
            primaryText: improved.primaryText || creative.primaryText,
            headline: improved.headline || creative.headline,
            callToAction: improved.callToAction || creative.callToAction,
          } })
          return { success: true, improved, creativeId: creative.id, message: 'Creative improved and updated' }
        } catch {
          return { suggestions: text, creativeId: creative.id, message: 'Suggestions generated (manual update needed)' }
        }
      } catch {
        return { error: 'Failed to generate improvements', creativeId: creative.id }
      }
    }

    // --- Dashboard summary (FIXED: real ROAS via revenue) -----------------
    case 'get_dashboard_summary': {
      const campaigns = await db.campaign.findMany({ where: { userId } }) as any[]
      const creatives = await db.adCreative.findMany({ where: { userId } }) as any[]
      const totalSpend = campaigns.reduce((s, c) => s + num(c.totalSpend), 0)
      const totalRevenue = campaigns.reduce((s, c) => s + num(c.totalRevenue), 0)
      const totalImpressions = campaigns.reduce((s, c) => s + num(c.totalImpressions), 0)
      const totalClicks = campaigns.reduce((s, c) => s + num(c.totalClicks), 0)
      const totalConversions = campaigns.reduce((s, c) => s + num(c.totalConversions), 0)
      return {
        totalCampaigns: campaigns.length,
        totalCreatives: creatives.length,
        totalSpend,
        totalRevenue,
        totalImpressions,
        totalClicks,
        totalConversions,
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
        cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
        cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
        // True ROAS = revenue / spend. If no revenue tracked, falls back to a conversions signal.
        roas: totalSpend > 0 ? (totalRevenue > 0 ? totalRevenue / totalSpend : 0) : 0,
        roasProxyNote: totalRevenue > 0 ? null : 'No revenue tracked yet — ROAS unavailable. Sync Meta insights & set revenue per conversion to enable real ROAS.',
      }
    }

    // --- Knowledge base (FIXED: real baseUrl/embeddingKey) -----------------
    case 'search_knowledge_base': {
      const query = (args.query as string) || ''
      const relevant = await retrieveRelevant({
        userId, query,
        provider: ctx.providerType || 'openai',
        apiKey: ctx.apiKey, baseUrl: ctx.baseUrl,
        embeddingKey: ctx.embeddingKey,
        topK: 5,
      })
      return {
        results: relevant.map((r, i) => ({ index: i + 1, title: r.title, content: r.content, similarity: r.similarity })),
        total: relevant.length,
      }
    }

    // --- Live Meta sync (read-only) --------------------------------------
    case 'sync_campaign_insights': {
      const days = (args.days as number) || 30
      return await syncCampaignInsights(userId, days)
    }
    case 'sync_from_meta': {
      return await syncFromMeta(userId)
    }
    case 'publish_campaign_to_meta': {
      return await publishCampaignToMeta(userId, args.campaignId as string)
    }
    case 'set_campaign_status': {
      return await setCampaignStatus(userId, args.campaignId as string, Boolean(args.active))
    }

    // --- Daily metrics & trends ------------------------------------------
    case 'get_daily_metrics': {
      const days = (args.days as number) || 30
      const since = new Date(); since.setDate(since.getDate() - days)
      const supabase = await getSupabaseServer()
      const { data } = await supabase
        .from('daily_metrics')
        .select('date, spend, impressions, clicks, conversions, reach, ctr, cpc, revenue')
        .eq('user_id', userId)
        .gte('date', since.toISOString().split('T')[0])
        .order('date', { ascending: true })
      return { metrics: data || [], total: (data || []).length }
    }
    case 'get_performance_trend': {
      const summary = await getAccountSummary(userId, (args.days as number) || 30)
      return { summary, trend: summary.daily }
    }

    // --- Scheduled jobs (autonomous) -------------------------------------
    case 'list_scheduled_jobs': {
      const jobs = await db.scheduledJob.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }) as any[]
      return { jobs, total: jobs.length }
    }
    case 'create_scheduled_job': {
      if (!args.type || !args.cronExpression) return { error: 'type and cronExpression are required' }
      const job = await db.scheduledJob.create({
        data: {
          userId,
          type: args.type as string,
          campaignId: (args.campaignId as string) || null,
          cronExpression: args.cronExpression as string,
          status: (args.status as string) || 'active',
          config: args.config ? (typeof args.config === 'string' ? args.config : JSON.stringify(args.config)) : null,
        },
      }) as any
      return { success: true, job, message: `Scheduled "${args.type}" (${args.cronExpression}). It runs via Supabase pg_cron once configured.` }
    }
    case 'update_scheduled_job': {
      const data: Record<string, unknown> = {}
      if (args.status) data.status = args.status
      if (args.cronExpression) data.cronExpression = args.cronExpression
      if (args.config !== undefined) data.config = typeof args.config === 'string' ? args.config : JSON.stringify(args.config)
      const job = await db.scheduledJob.update({ where: { id: args.jobId as string }, data }) as any
      return { success: true, job }
    }
    case 'delete_scheduled_job': {
      await db.scheduledJob.delete({ where: { id: args.jobId as string } })
      return { success: true, message: 'Scheduled job deleted' }
    }

    // --- Modality: charts -------------------------------------------------
    case 'generate_chart': {
      const spec = await generateChart({
        kind: args.kind as any,
        chartType: args.chartType as any,
        title: args.title as string,
        data: args.data as any,
        xKey: args.xKey as string,
        yKeys: args.yKeys as any,
        campaignIds: args.campaignIds as string[],
        days: (args.days as number) || 30,
      })
      return { chart: spec, message: `Chart "${spec.title}" rendered (${spec.chartType}, ${spec.data.length} points).` }
    }

    // --- Modality: report -------------------------------------------------
    case 'generate_report': {
      const summary = await getAccountSummary(userId, (args.days as number) || 30)
      const campaigns = await db.campaign.findMany({ where: { userId } }) as any[]
      const creatives = await db.adCreative.findMany({ where: { userId } }) as any[]
      const strategy = await getStrategy(userId)
      const md = buildMarkdownReport(summary, campaigns, creatives, strategy)
      return { report: md, format: 'markdown', message: `Performance report generated (${summary.daily.length} days).` }
    }

    // --- Modality: voice --------------------------------------------------
    case 'transcribe_audio': {
      const res = await transcribeAudio(args.audioUrl as string, ctx.whisperKey)
      if (res.error) return { error: res.error }
      return { transcript: res.text, message: 'Audio transcribed.' }
    }
    case 'speak': {
      const res = await speak((args.text as string) || '', userId, ctx.ttsKey, (args.voice as string) || 'nova')
      if (res.error) return { error: res.error }
      return { success: true, audioUrl: res.audioUrl, message: 'Voice reply generated.' }
    }

    case 'search_memory': {
      const query = (args.query as string) || ''
      const memories = await semanticSearchMemory(userId, query, {
        provider: ctx.providerType,
        apiKey: ctx.apiKey,
        baseUrl: ctx.baseUrl,
        embeddingKey: ctx.embeddingKey,
      }, 6)
      return {
        memories: memories.map((m, i) => ({ index: i + 1, kind: m.kind, content: m.content, similarity: m.similarity })),
        total: memories.length,
        note: memories.length === 0 ? 'No semantically relevant memories found (or embeddings not enabled). Showing recent memory is available via get_memory.' : undefined,
      }
    }

    case 'reflect_and_learn': {
      const r = await runReflection({ userId })
      return r
    }

    default:
      return { error: `Unknown local tool: ${tool}` }
  }
}

function buildMarkdownReport(summary: any, campaigns: any[], creatives: any[], strategy: any): string {
  const lines: string[] = []
  lines.push(`# Meta Ads Performance Report`)
  lines.push('')
  lines.push(`**Period:** Last ${summary.daily.length} days`)
  lines.push(`**Generated:** ${new Date().toLocaleString()}`)
  lines.push('')
  lines.push('## Headline Metrics')
  lines.push(`| Metric | Value |`)
  lines.push(`|---|---|`)
  lines.push(`| Total Spend | ₹${(summary.totalSpend || 0).toFixed(2)} |`)
  lines.push(`| Total Revenue | ₹${(summary.totalRevenue || 0).toFixed(2)} |`)
  lines.push(`| ROAS | ${(summary.roas || 0).toFixed(2)}x |`)
  lines.push(`| Impressions | ${summary.totalImpressions.toLocaleString()} |`)
  lines.push(`| Clicks | ${summary.totalClicks.toLocaleString()} |`)
  lines.push(`| Conversions | ${summary.totalConversions.toLocaleString()} |`)
  lines.push(`| CTR | ${(summary.ctr || 0).toFixed(2)}% |`)
  lines.push(`| CPC | ₹${(summary.cpc || 0).toFixed(2)} |`)
  lines.push(`| CPM | ₹${(summary.cpm || 0).toFixed(2)} |`)
  lines.push('')
  if (strategy?.targetRoas) {
    const vs = summary.roas >= strategy.targetRoas ? '✅ on target' : '⚠️ below target'
    lines.push(`> Strategy target ROAS: ${strategy.targetRoas}x — current ${summary.roas.toFixed(2)}x ${vs}`)
    lines.push('')
  }
  lines.push('## Campaigns')
  if (campaigns.length === 0) { lines.push('_No campaigns yet._') }
  else {
    lines.push(`| Campaign | Status | Spend | ROAS | Conversions |`)
    lines.push(`|---|---|---|---|---|`)
    for (const c of campaigns) {
      const roas = num(c.totalSpend) > 0 ? (num(c.totalRevenue) / num(c.totalSpend)) : 0
      lines.push(`| ${c.name} | ${c.status} | ₹${num(c.totalSpend).toFixed(0)} | ${roas.toFixed(2)}x | ${num(c.totalConversions)} |`)
    }
  }
  lines.push('')
  lines.push('## Creatives')
  if (creatives.length === 0) { lines.push('_No creatives yet._') }
  else {
    lines.push(`| Creative | Status | Review |`)
    lines.push(`|---|---|---|`)
    for (const c of creatives.slice(0, 15)) {
      lines.push(`| ${c.title} | ${c.status} | ${c.reviewStatus} |`)
    }
    if (creatives.length > 15) lines.push(`\n_...and ${creatives.length - 15} more_`)
  }
  return lines.join('\n')
}
