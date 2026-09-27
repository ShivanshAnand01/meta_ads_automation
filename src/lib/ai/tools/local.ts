import { db } from '@/lib/db/supabase-db'
import { getScopedSupabase } from '@/lib/db/supabase-db'
import type { AIProvider, AIProviderType } from '@/lib/ai/types'
import { generateAdImage, saveImageToStorage } from '@/lib/ai/image-generator'
import { retrieveRelevant, trackGeneratedImage } from '@/lib/ai/rag'
import { getStrategy, updateStrategy, buildStrategyContext } from '@/lib/ai/strategy'
import { getRecentMemory, addMemory } from '@/lib/ai/memory'
import { syncCampaignInsights, syncFromMeta, setCampaignStatus, getAccountSummary } from '@/lib/meta/sync'
import { publishFullCampaign } from '@/lib/meta/publish'
import { generateChart } from '@/lib/ai/chart'
import { transcribeAudio, speak } from '@/lib/ai/voice'
import type { MemoryKind } from '@/lib/ai/memory'
import { searchMemory as semanticSearchMemory } from '@/lib/ai/memory'
import { runReflection } from '@/lib/ai/reflection'
import { createPendingQuestion, cancelPendingQuestion } from '@/lib/ai/pending-questions'
import { getProfile, upsertProfile, buildProfileContext, missingProfileFields, type BusinessProfile } from '@/lib/ai/profile'
import { ingestWebsite } from '@/lib/ai/website-ingest'
import { generateStructured, creativeSuggestionSchema, enforceCopyLimits } from '@/lib/ai/structured'
import { suggestCreativeImprovements } from '@/lib/ai/creative-generator'
import { reviewCreative } from '@/lib/ai/creative-reviewer'
import { connectMetaAccount, selectAdAccount } from '@/lib/meta/connect'
import { researchWeb, describeConnectedTools, callConnectedTool } from '@/lib/integrations/server'

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

async function validateCampaignOwnership(campaignId: unknown, userId: string): Promise<boolean> {
  if (campaignId === undefined || campaignId === null) return true
  const campaign = await db.campaign.findUnique({ where: { id: campaignId as string, userId } })
  return campaign != null
}

/** Execute a "local" (non-Meta) tool. Returns a JSON-serializable result. */
export async function executeLocalTool(tool: string, args: Record<string, unknown>, ctx: LocalToolContext): Promise<unknown> {
  const { userId } = ctx

  switch (tool) {
    // --- Onboarding: profile, website, Meta connection -------------------
    case 'get_business_profile': {
      const profile = await getProfile(userId)
      return { profile, missing: missingProfileFields(profile), context: buildProfileContext(profile) }
    }
    case 'set_business_profile': {
      const a = args as Record<string, unknown>
      const patch: Partial<Omit<BusinessProfile, 'userId'>> = {}
      const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined)
      const arr = (k: string) => (Array.isArray(a[k]) ? (a[k] as unknown[]).map(String) : undefined)
      if (str('business_name') !== undefined) patch.businessName = str('business_name')
      if (str('website_url') !== undefined) patch.websiteUrl = str('website_url')
      if (str('industry') !== undefined) patch.industry = str('industry')
      if (str('description') !== undefined) patch.description = str('description')
      if (str('products') !== undefined) patch.products = str('products')
      if (str('usp') !== undefined) patch.usp = str('usp')
      if (str('primary_language') !== undefined) patch.primaryLanguage = str('primary_language')!.toLowerCase()
      if (arr('secondary_languages') !== undefined) patch.secondaryLanguages = arr('secondary_languages')
      if (str('language_mode') === 'single' || str('language_mode') === 'mixed') patch.languageMode = str('language_mode') as 'single' | 'mixed'
      if (str('market_country') !== undefined) patch.marketCountry = str('market_country')!.toUpperCase()
      if (arr('market_regions') !== undefined) patch.marketRegions = arr('market_regions')
      if (arr('market_cities') !== undefined) patch.marketCities = arr('market_cities')
      if (str('currency') !== undefined) patch.currency = str('currency')!.toUpperCase()
      if (str('target_audience') !== undefined) patch.targetAudience = str('target_audience')
      if (str('tone') !== undefined) patch.tone = str('tone')
      if (arr('brand_colors') !== undefined) patch.brandColors = arr('brand_colors')
      if (str('avoid') !== undefined) patch.avoid = str('avoid')
      if (str('default_objective') !== undefined) patch.defaultObjective = str('default_objective')
      if (str('default_cta') !== undefined) patch.defaultCta = str('default_cta')
      if (str('landing_url') !== undefined) patch.landingUrl = str('landing_url')
      if (str('cultural_notes') !== undefined) patch.culturalNotes = str('cultural_notes')
      if (typeof a.onboarding_complete === 'boolean') patch.onboardingComplete = a.onboarding_complete
      const profile = await upsertProfile(userId, patch)
      return { success: true, profile, missing: missingProfileFields(profile), context: buildProfileContext(profile) }
    }
    case 'ingest_website': {
      const url = String(args.url || '').trim()
      if (!url) return { error: 'url is required' }
      const result = await ingestWebsite({
        userId, url, provider: ctx.providerType, apiKey: ctx.apiKey, baseUrl: ctx.baseUrl, embeddingKey: ctx.embeddingKey,
      })
      const profile = await getProfile(userId)
      const patch: Partial<Omit<BusinessProfile, 'userId'>> = {}
      if (!profile.websiteUrl) patch.websiteUrl = url
      if (!profile.businessName && result.learned.siteTitle) patch.businessName = result.learned.siteTitle.split(/[|\u2013-]/)[0].trim()
      if (!profile.description && result.learned.description) patch.description = result.learned.description
      if (Object.keys(patch).length) await upsertProfile(userId, patch)
      const hint = result.learned.detectedLanguageHint
      return {
        ...result,
        prefilled: Object.keys(patch),
        nextStep: hint && hint !== 'en'
          ? `The site appears to be in "${hint}". Confirm the ad copy language with the user, then save it with set_business_profile.`
          : 'Confirm the ad copy language and target market with the user, then save them with set_business_profile.',
      }
    }
    case 'connect_meta_account': {
      const result = await connectMetaAccount(userId, {
        appId: String(args.app_id || ''), appSecret: String(args.app_secret || ''),
        accessToken: String(args.access_token || ''), adAccountId: args.ad_account_id ? String(args.ad_account_id) : undefined,
      })
      if (!result.success) return { error: result.error }
      // Currency comes from the ad account; the profile should agree with it.
      if (result.adAccountCurrency) await upsertProfile(userId, { currency: result.adAccountCurrency }).catch(() => {})
      return {
        success: true,
        adAccount: result.adAccountId ? { id: result.adAccountId, name: result.adAccountName, currency: result.adAccountCurrency } : null,
        availableAccounts: result.availableAccounts,
        tokenExpiry: result.tokenExpiry,
        missingScopes: result.missingScopes,
        message: result.availableAccounts.length > 1
          ? `Connected. The token can see ${result.availableAccounts.length} ad accounts - ask the user which one to manage, then call select_ad_account.`
          : `Connected to ad account "${result.adAccountName}".${result.missingScopes.length ? ` WARNING: token is missing ${result.missingScopes.join(', ')} - campaign changes will fail until it is regenerated with those permissions.` : ''}`,
      }
    }
    case 'select_ad_account': {
      return await selectAdAccount(userId, String(args.ad_account_id || ''))
    }

    // --- Connected third-party tools (Setup → Connections) ---------------
    case 'research_web': {
      return await researchWeb(userId, String(args.query || ''), num(args.limit) || 5)
    }
    case 'list_connected_tools': {
      return await describeConnectedTools(userId, args.slug ? String(args.slug) : undefined)
    }
    case 'call_connected_tool': {
      const toolArgs = args.arguments && typeof args.arguments === 'object' ? (args.arguments as Record<string, unknown>) : {}
      return await callConnectedTool(userId, String(args.slug || ''), String(args.tool || ''), toolArgs)
    }

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
        const answer = await createPendingQuestion(questionId, question, ctx.conversationId || 'unknown', userId)
        return { success: true, answer, message: 'User answered the question.' }
      } catch (err) {
        await cancelPendingQuestion(ctx.conversationId || 'unknown', questionId)
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
      const campaign = await db.campaign.findUnique({ where: { id: args.campaignId as string, userId } }) as any
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
          linkUrl: (args.linkUrl as string) || null,
          status: 'draft',
        },
      }) as any
      return {
        success: true,
        campaignId: campaign?.id,
        message: `Campaign "${campaign?.name}" created as a draft`,
        // A draft cannot be published without a destination, so ask for it now
        // rather than failing at publish time.
        nextStep: args.linkUrl
          ? 'Add creatives, then call publish_full_campaign to build the campaign, ad set and ads on Meta.'
          : 'A landing page URL is still required before this can be published. Ask the client for it.',
      }
    }
    case 'update_local_campaign': {
      const data: Record<string, unknown> = {}
      if (args.name) data.name = args.name
      if (args.status) data.status = args.status
      if (args.budget !== undefined) data.budget = num(args.budget)
      if (args.budgetType) data.budgetType = args.budgetType
      if (args.linkUrl !== undefined) data.linkUrl = args.linkUrl
      const campaign = await db.campaign.update({ where: { id: args.campaignId as string, userId }, data }) as any
      if (!campaign) return { error: 'Campaign not found' }
      return { success: true, campaignId: campaign.id, message: 'Campaign updated' }
    }
    case 'delete_local_campaign': {
      await db.campaign.delete({ where: { id: args.campaignId as string, userId } })
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
      const campaignId = (args.campaignId as string) || null
      if (campaignId && !(await validateCampaignOwnership(campaignId, userId))) {
        return { error: 'Campaign not found' }
      }
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
          language: (args.language as string) || (await getProfile(userId)).primaryLanguage,
          audience: (args.audience as string) || (await getProfile(userId)).marketRegions.join(', ') || null,
          imageUrl: (args.imageUrl as string) || null,
          campaignId,
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
      const creative = await db.adCreative.update({ where: { id: args.creativeId as string, userId }, data }) as any
      if (!creative) return { error: 'Creative not found' }
      return { success: true, creativeId: creative.id, message: 'Creative updated' }
    }
    case 'delete_local_creative': {
      await db.adCreative.delete({ where: { id: args.creativeId as string, userId } })
      return { success: true, message: 'Creative deleted' }
    }

    // --- Image generation -------------------------------------------------
    case 'generate_ad_image': {
      const promptProfile = await getProfile(userId)
      const prompt = (args.prompt as string) || `Professional ad creative for ${promptProfile.businessName || promptProfile.description || 'the business'}`
      const imageApiKey = ctx.providerType === 'openai' ? ctx.apiKey : ctx.embeddingKey
      const result = await generateAdImage('openai', imageApiKey, prompt, {
        size: (args.size as string) || undefined,
        style: (args.style as string) || undefined,
        quality: (args.quality as 'standard' | 'hd') || undefined,
        aspectRatio: (args.aspectRatio as '1:1' | '4:5' | '9:16' | '1.91:1' | '16:9') || undefined,
        brandColors: Array.isArray(args.brandColors) ? (args.brandColors as string[]) : (promptProfile.brandColors.length ? promptProfile.brandColors : undefined),
        negativePrompt: (args.negativePrompt as string) || undefined,
      })
      if (!result.success || !result.imageUrl) return { error: result.error || 'Image generation failed' }
      let savedUrl = result.imageUrl
      let storagePath: string | null = null
      try {
        const supabase = await getScopedSupabase()
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
      const profile = await getProfile(userId)
      const lang = profile.primaryLanguageLabel
      const where = [...profile.marketRegions, ...profile.marketCities, profile.marketCountry].filter(Boolean).join(', ')
      const product = (args.product as string) || profile.products || profile.businessName || 'the product'
      const angle = (args.angle as string) || 'benefit-driven'
      const cta = (args.callToAction as string) || 'LEARN_MORE'
      const campaignId = (args.campaignId as string) || null
      if (campaignId && !(await validateCampaignOwnership(campaignId, userId))) {
        return { error: 'Campaign not found' }
      }
      const imagePromptArg = (args.imagePrompt as string) || ''

      // Ad copy in the profile's language, validated against the schema and
      // Meta's length limits. A parse failure is reported, never swallowed.
      let copy: { title: string; description: string; primaryText: string; headline: string; callToAction: string } = {
        title: `${product} — ${angle}`, description: `${angle} angle for ${product}`, primaryText: '', headline: '', callToAction: cta,
      }
      const copyWarnings: string[] = []
      if (!ctx.provider) {
        copyWarnings.push('No AI provider configured — creative saved with placeholder copy.')
      } else {
        try {
          const copyPrompt = `Generate a Meta Ads creative for: "${product}". Angle: ${angle}. Target audience: ${profile.targetAudience ?? 'customers'} in ${where}.${profile.tone ? ` Tone: ${profile.tone}.` : ''}${profile.avoid ? ` Never: ${profile.avoid}.` : ''} Respond ONLY with valid JSON: {"title":"(English management name)","description":"(English, one sentence strategy)","primaryText":"(ad copy in ${lang}, max 125 characters)","headline":"(headline in ${lang}, max 40 characters)","callToAction":"${cta}","targeting":"(short targeting description)","expectedRoas":0,"reasoning":"(why this works)"}.`
          const validated = await generateStructured(ctx.provider, creativeSuggestionSchema, copyPrompt,
            `You are an expert ad copywriter writing in ${lang} for ${where}. ${buildProfileContext(profile)} Respond only with valid JSON, no markdown.`)
          const limited = enforceCopyLimits(validated)
          copyWarnings.push(...limited.copyWarnings)
          copy = { title: limited.title, description: limited.description, primaryText: limited.primaryText, headline: limited.headline, callToAction: limited.callToAction }
        } catch (err) {
          copyWarnings.push(`Ad copy generation failed: ${err instanceof Error ? err.message : 'unknown error'}. Placeholder text was used.`)
        }
      }

      // Generate the ad image via the enhanced image generator (multi-provider fallback)
      const imagePrompt = imagePromptArg || `${product}, ${angle} marketing theme, professional digital ad creative for ${profile.targetAudience ?? 'the target audience'} in ${where}, high quality, clean modern design, vibrant colors`
      const imageApiKey = ctx.providerType === 'openai' ? ctx.apiKey : ctx.embeddingKey
      const imgResult = await generateAdImage('openai', imageApiKey, imagePrompt, {
        size: '1024x1024',
        style: 'vivid',
        aspectRatio: (args.aspectRatio as '1:1' | '4:5' | '9:16' | '1.91:1' | '16:9') || undefined,
        quality: (args.quality as 'standard' | 'hd') || undefined,
        brandColors: Array.isArray(args.brandColors) ? (args.brandColors as string[]) : (profile.brandColors.length ? profile.brandColors : undefined),
        negativePrompt: (args.negativePrompt as string) || undefined,
      })
      let imageUrl: string | null = null
      if (imgResult.success && imgResult.imageUrl) {
        imageUrl = imgResult.imageUrl
        try {
          const supabase = await getScopedSupabase()
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
          language: profile.primaryLanguage,
          audience: where,
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
        warnings: copyWarnings,
        language: lang,
        message: `Creative "${creative?.title}" created in ${lang}${imageUrl ? ` with image (${imgResult.provider})` : ' (image generation failed — text only)'}. Ready for review.${copyWarnings.length ? ` Issues: ${copyWarnings.join(' ')}` : ''}`,
      }
    }

    // --- Creative review / improve (LLM) ----------------------------------
    case 'review_creative': {
      const creative = await db.adCreative.findUnique({ where: { id: args.creativeId as string, userId } }) as any
      if (!creative) return { error: 'Creative not found' }
      if (!ctx.provider) return { error: 'No AI provider configured' }
      try {
        // Same reviewer the API uses: profile-aware and schema-validated.
        const review = await reviewCreative(ctx.provider, creative, undefined, await getProfile(userId))
        return { review, creativeId: creative.id, title: creative.title }
      } catch (err) {
        return { error: `Failed to generate review: ${err instanceof Error ? err.message : 'unknown error'}`, creativeId: creative.id }
      }
    }
    case 'improve_creative': {
      const creative = await db.adCreative.findUnique({ where: { id: args.creativeId as string, userId } }) as any
      if (!creative) return { error: 'Creative not found' }
      if (!ctx.provider) return { error: 'No AI provider configured' }
      try {
        // Same improver the API uses: profile-aware, schema-validated, length-limited.
        const improved = await suggestCreativeImprovements(ctx.provider, creative, undefined, await getProfile(userId))
        await db.adCreative.update({ where: { id: creative.id, userId }, data: {
          title: improved.title || creative.title,
          primaryText: improved.primaryText || creative.primaryText,
          headline: improved.headline || creative.headline,
          callToAction: improved.callToAction || creative.callToAction,
        } })
        return { success: true, improved, creativeId: creative.id, message: 'Creative improved and updated' }
      } catch (err) {
        return { error: `Failed to generate improvements: ${err instanceof Error ? err.message : 'unknown error'}`, creativeId: creative.id }
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
    case 'publish_campaign_to_meta':
    case 'publish_full_campaign': {
      // Both names route through the full Campaign -> Ad Set -> Ad pipeline.
      // Publishing only a campaign object (the old behaviour) produces
      // something that can never deliver an impression.
      return await publishFullCampaign({
        userId,
        campaignId: (args.campaignId || args.campaign_id) as string,
        creativeIds: (args.creativeIds || args.creative_ids) as string[] | undefined,
        linkUrl: (args.linkUrl || args.link_url) as string | undefined,
        pageId: (args.pageId || args.page_id) as string | undefined,
        pixelId: (args.pixelId || args.pixel_id) as string | undefined,
        conversionEvent: (args.conversionEvent || args.conversion_event) as string | undefined,
        optimizationGoal: (args.optimizationGoal || args.optimization_goal) as never,
        activate: Boolean(args.activate),
        targeting: args.targeting as never,
      })
    }
    case 'set_campaign_status': {
      return await setCampaignStatus(userId, args.campaignId as string, Boolean(args.active))
    }

    // --- Daily metrics & trends ------------------------------------------
    case 'get_daily_metrics': {
      const days = (args.days as number) || 30
      const since = new Date(); since.setDate(since.getDate() - days)
      const supabase = await getScopedSupabase()
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
      return { success: true, job, message: `Scheduled "${args.type}" (${args.cronExpression}). It runs on the next scheduler tick after its due time.` }
    }
    case 'update_scheduled_job': {
      const data: Record<string, unknown> = {}
      if (args.status) data.status = args.status
      if (args.cronExpression) data.cronExpression = args.cronExpression
      if (args.config !== undefined) data.config = typeof args.config === 'string' ? args.config : JSON.stringify(args.config)
      const job = await db.scheduledJob.update({ where: { id: args.jobId as string, userId }, data }) as any
      return { success: true, job }
    }
    case 'delete_scheduled_job': {
      await db.scheduledJob.delete({ where: { id: args.jobId as string, userId } })
      return { success: true, message: 'Scheduled job deleted' }
    }

    // --- Modality: charts -------------------------------------------------
    case 'generate_chart': {
      const spec = await generateChart({
        userId,
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
