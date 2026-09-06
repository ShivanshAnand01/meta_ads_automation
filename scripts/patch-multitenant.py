"""
One-shot source patch for the multi-tenant rebuild. Run from the repo root:
    python scripts/patch-multitenant.py
Every edit is guarded and reported; a missing anchor is logged, never fatal.
Safe to re-run (each edit is skipped if already applied).
"""
import pathlib, re, sys
sys.stdout.reconfigure(encoding='utf-8')
report = []

def patch(path, pairs):
    p = pathlib.Path(path); s = p.read_text(encoding='utf-8'); n = 0; skipped = 0
    for old, new in pairs:
        if new in s and old not in s:
            skipped += 1; continue
        if old in s:
            s = s.replace(old, new, 1); n += 1
        else:
            report.append(f"  !! MISSING anchor in {path}: {old[:80]!r}")
    p.write_text(s, encoding='utf-8')
    report.append(f"  {path}: {n} applied, {skipped} already done, {len(pairs)-n-skipped} missing")

# ── 1. Register onboarding tools ───────────────────────────────────────────
patch('src/lib/ai/tool-definitions.ts', [
  ("import { DELIVERY_TOOLS } from './tool-definitions.delivery'",
   "import { DELIVERY_TOOLS } from './tool-definitions.delivery'\nimport { ONBOARDING_TOOLS } from './tool-definitions.onboarding'"),
  ("for (const tool of [...LOCAL_TOOLS, ...MASTERMIND_TOOLS, ...DELIVERY_TOOLS]) {",
   "for (const tool of [...ONBOARDING_TOOLS, ...LOCAL_TOOLS, ...MASTERMIND_TOOLS, ...DELIVERY_TOOLS]) {"),
])
patch('src/lib/ai/guardrails.ts', [
  ("  'get_local_campaigns', 'get_local_creatives', 'get_local_campaign',",
   "  // Onboarding: reads, profile edits, crawling and connecting spend nothing\n  'get_business_profile', 'set_business_profile', 'ingest_website', 'connect_meta_account', 'select_ad_account',\n  'get_local_campaigns', 'get_local_creatives', 'get_local_campaign',"),
])

# ── 2. Dispatcher: onboarding names + MCP-first routing ────────────────────
patch('src/lib/ai/tools/index.ts', [
  ("const LOCAL_TOOL_NAMES = new Set([\n  'ask_user_question',",
   "const LOCAL_TOOL_NAMES = new Set([\n  'ask_user_question',\n  'get_business_profile', 'set_business_profile', 'ingest_website', 'connect_meta_account', 'select_ad_account',"),
  ("import { getMetaConnection } from '@/lib/meta/user-client'",
   "import { getMetaConnection } from '@/lib/meta/user-client'\nimport { tryMcp } from '@/lib/meta/mcp-bridge'"),
  ("async function executeMetaOp(tool: string, args: Record<string, unknown>, userId: string): Promise<unknown> {\n  switch (tool) {",
   """/**
 * MCP first, Graph second. Every failure on the MCP side is caught and the
 * same call is retried against the direct Graph client, so the agent only
 * ever sees one answer. `via` says which path produced it.
 */
async function executeMetaOp(tool: string, args: Record<string, unknown>, userId: string): Promise<unknown> {
  const mcp = await tryMcp(tool, args, userId)
  if (mcp.attempted && mcp.ok) {
    return typeof mcp.result === 'object' && mcp.result !== null
      ? { ...(mcp.result as Record<string, unknown>), via: 'mcp' }
      : { result: mcp.result, via: 'mcp' }
  }
  const fallbackReason = mcp.attempted ? mcp.error : mcp.reason
  const graph = await executeGraphOp(tool, args, userId)
  if (graph && typeof graph === 'object' && !Array.isArray(graph)) {
    return { ...(graph as Record<string, unknown>), via: 'graph', ...(mcp.attempted ? { mcpFallbackReason: fallbackReason } : {}) }
  }
  return graph
}

async function executeGraphOp(tool: string, args: Record<string, unknown>, userId: string): Promise<unknown> {
  switch (tool) {"""),
])

# ── 3. mcp-client: spawn with the running node binary, not "node" on PATH ──
patch('src/lib/meta/mcp-client.ts', [
  ("      command: 'node',", "      // process.execPath is the node that is actually running; a bare\n      // 'node' is not on PATH inside a Vercel function.\n      command: process.execPath,"),
])

# ── 4. Handlers in local.ts ────────────────────────────────────────────────
patch('src/lib/ai/tools/local.ts', [
  ("import { createPendingQuestion, cancelPendingQuestion } from '@/lib/ai/pending-questions'",
   "import { createPendingQuestion, cancelPendingQuestion } from '@/lib/ai/pending-questions'\nimport { getProfile, upsertProfile, buildProfileContext, missingProfileFields, type BusinessProfile } from '@/lib/ai/profile'\nimport { ingestWebsite } from '@/lib/ai/website-ingest'\nimport { connectMetaAccount, selectAdAccount } from '@/lib/meta/connect'"),
  ("  switch (tool) {\n    // --- Ask user a clarifying question (popup on chat) -----------------",
   """  switch (tool) {
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
      if (!profile.businessName && result.learned.siteTitle) patch.businessName = result.learned.siteTitle.split(/[|\\u2013-]/)[0].trim()
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

    // --- Ask user a clarifying question (popup on chat) -----------------"""),
])

# review / improve handlers pass the profile; creative defaults come from it
p = pathlib.Path('src/lib/ai/tools/local.ts'); s = p.read_text(encoding='utf-8'); before = s
s = re.sub(r"await reviewCreative\((ctx\.provider[^,]*),\s*([^,\n]+?)(,\s*([^\n]+?))?\)\s*\n",
           lambda m: f"await reviewCreative({m.group(1)}, {m.group(2)}, {m.group(4) if m.group(4) else 'undefined'}, await getProfile(userId))\n", s)
s = re.sub(r"await suggestCreativeImprovements\((ctx\.provider[^,]*),\s*([^,\n]+?)(,\s*([^\n]+?))?\)\s*\n",
           lambda m: f"await suggestCreativeImprovements({m.group(1)}, {m.group(2)}, {m.group(4) if m.group(4) else 'undefined'}, await getProfile(userId))\n", s)
s = s.replace("language: (args.language as string) || 'marathi'", "language: (args.language as string) || (await getProfile(userId)).primaryLanguage")
s = s.replace("audience: (args.audience as string) || 'Maharashtra'", "audience: (args.audience as string) || (await getProfile(userId)).marketRegions.join(', ') || null")
p.write_text(s, encoding='utf-8')
report.append(f"  local.ts callers: {'patched' if s != before else 'no change'}; 'marathi' literals left: {s.lower().count('marathi')}")

# ── 5. manager.ts: profile into context and into creative generation ──────
patch('src/lib/ai/manager.ts', [
  ("import { checkBudget, buildPacingContext } from '@/lib/ai/budget-guard'",
   "import { checkBudget, buildPacingContext } from '@/lib/ai/budget-guard'\nimport { getProfile, buildProfileContext, type BusinessProfile } from '@/lib/ai/profile'"),
  ("    let strategyContext = ''\n    try {\n      if (!this.strategy) this.strategy = await getStrategy(this.userId)",
   "    // The profile decides language, script, market and currency for everything\n    // the agent writes. Loaded here so no prompt can fall back to an assumption.\n    let profileContext = ''\n    try {\n      const profile: BusinessProfile = await getProfile(this.userId)\n      profileContext = buildProfileContext(profile)\n    } catch {}\n\n    let strategyContext = ''\n    try {\n      if (!this.strategy) this.strategy = await getStrategy(this.userId)"),
  ("      'Call sync_campaign_insights before analyzing performance so you work with real Meta data.',\n      strategyContext,\n      pacingContext,",
   "      'Call sync_campaign_insights before analyzing performance so you work with real Meta data.',\n      profileContext,\n      strategyContext,\n      pacingContext,"),
  ("    const copyWarnings: string[] = []\n    try {\n      const copyPrompt = `Generate a Meta Ads creative for: \"${product}\". Angle: ${angle}. Target audience: Maharashtra, India (Marathi-speaking).",
   "    const copyWarnings: string[] = []\n    const profile = await getProfile(this.userId).catch(() => null)\n    const lang = profile?.primaryLanguageLabel ?? 'English'\n    const where = profile ? [...profile.marketRegions, ...profile.marketCities, profile.marketCountry].filter(Boolean).join(', ') : 'the target market'\n    try {\n      const copyPrompt = `Generate a Meta Ads creative for: \"${product}\". Angle: ${angle}. Target audience: ${profile?.targetAudience ?? 'customers'} in ${where}.${profile?.tone ? ` Tone: ${profile.tone}.` : ''}${profile?.avoid ? ` Never: ${profile.avoid}.` : ''}"),
  ("\"primaryText\":\"(Marathi Devanagari ad copy, max 125 characters)\",\"headline\":\"(Marathi Devanagari headline, max 40 characters)\"",
   "\"primaryText\":\"(ad copy in ${lang}, max 125 characters)\",\"headline\":\"(headline in ${lang}, max 40 characters)\""),
  ("        'You are an expert Marathi ad copywriter for the Maharashtrian market. Respond only with valid JSON, no markdown.',",
   "        `You are an expert ad copywriter writing in ${lang} for ${where}. ${profile ? buildProfileContext(profile) : ''} Respond only with valid JSON, no markdown.`,"),
  ("professional digital ad creative, Marathi Indian audience, high quality, clean modern design, vibrant colors`\n    const imgResult = await this.generateImage(finalImagePrompt, imageOptions)",
   "professional digital ad creative for ${profile?.targetAudience ?? 'the target audience'} in ${where}, high quality, clean modern design, vibrant colors`\n    const imgResult = await this.generateImage(finalImagePrompt, { brandColors: profile?.brandColors?.length ? profile.brandColors : undefined, ...imageOptions })"),
  ("        language: 'marathi',\n        audience: 'Maharashtra',", "        language: profile?.primaryLanguage ?? 'en',\n        audience: where,"),
])

# ── 6. agent.ts: onboarding first, language from the profile ───────────────
patch('src/lib/ai/agent.ts', [
  ("You run this client's entire Meta (Facebook/Instagram) Ads operation. The client is a non-technical business owner in Maharashtra advertising Marathi sales ebooks. You handle strategy, campaign structure, creatives, audiences, budgets, pacing, scheduling, reporting and live optimization.",
   "You run this business's entire Meta (Facebook/Instagram) Ads operation. Any business can sign up - a Marathi ebook seller in Pune, a Tamil restaurant in Chennai, an English SaaS in Bangalore - and you handle strategy, campaign structure, creatives, audiences, budgets, pacing, scheduling, reporting and live optimization in THEIR language, for THEIR market.\n\n# Onboarding a new business (before anything else)\nThe BUSINESS PROFILE block in your context says what is known and what is STILL UNKNOWN. If anything important is unknown, or Meta is not connected, onboard them conversationally - one question at a time, never a form:\n1. \\`get_business_profile\\` - see what we already know.\n2. Ask for their website and call \\`ingest_website\\` - read it before asking questions the site already answers.\n3. Confirm the AD COPY LANGUAGE explicitly (Devanagari on a site could be Marathi or Hindi - ask). Confirm market regions/cities, audience, tone and landing page. Save each with \\`set_business_profile\\`.\n4. Ask for their Meta app credentials one at a time - App ID, then App Secret, then access token - and call \\`connect_meta_account\\`. If several ad accounts come back, ask which and call \\`select_ad_account\\`. Never repeat a secret or token back to them.\n5. Set \\`onboarding_complete\\` true. From then on every campaign and creative is built from the profile and the knowledge base.\nIf the profile is complete and Meta is connected, skip all of this and get to work."),
  ("- Write ad copy in **Marathi (Devanagari script)**; mix English and Marathi in your explanations where it helps.",
   "- Write ad copy in the language and script named in the BUSINESS PROFILE - never in a language you assumed. Explain things in whatever language the client writes to you in."),
  ("- Conversational, friendly, simple. The client is not technical.", "- Conversational, friendly, simple. The client is a business owner, not a marketer."),
])

# ── 7. creative-generator.ts: profile-built system prompt ──────────────────
p = pathlib.Path('src/lib/ai/creative-generator.ts'); s = p.read_text(encoding='utf-8'); before = s
if "from './profile'" not in s:
    s = s.replace("import type { AdCreativeData } from '@/lib/meta/types'",
                  "import type { AdCreativeData } from '@/lib/meta/types'\nimport { DEFAULT_PROFILE, buildProfileContext, currencySymbol, type BusinessProfile } from './profile'")
s = re.sub(r"const SYSTEM_PROMPT = `[\s\S]*?Always respond with valid JSON only, no markdown formatting or additional text\.`",
"""/**
 * Built per call from the business profile. Language, script, market and
 * currency are never literals here - the first customer was Marathi in
 * Maharashtra; the next may not be.
 */
function systemPrompt(profile: BusinessProfile): string {
  const where = [...profile.marketRegions, ...profile.marketCities, profile.marketCountry].filter(Boolean).join(', ')
  const mixed = profile.languageMode === 'mixed' && profile.secondaryLanguages.length
    ? ` (code-switching naturally with ${profile.secondaryLanguages.join(', ')}, the way local advertising does)` : ''
  return `You are an expert digital marketing strategist specializing in Meta (Facebook/Instagram) Ads. You write ad copy in ${profile.primaryLanguageLabel}${mixed} for ${where}, and you understand that market's culture, festivals and consumer behaviour deeply.

${buildProfileContext(profile)}

Always respond with valid JSON only, no markdown formatting or additional text.`
}

function langLine(profile: BusinessProfile): string {
  return `The primaryText and headline MUST be written in ${profile.primaryLanguageLabel}. The title and description are in English, for management purposes.`
}""", s, count=1)
s = s.replace("    pastPerformance?: string\n  }\n): Promise<CreativeSuggestion> {\n  const prompt = `Generate a Meta Ads creative suggestion",
              "    pastPerformance?: string\n  },\n  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },\n): Promise<CreativeSuggestion> {\n  const cur = currencySymbol(profile.currency)\n  const prompt = `Generate a Meta Ads creative suggestion")
s = s.replace("    pastPerformance?: string\n  }\n): Promise<CreativeSuggestion[]> {\n  const prompt = `Generate ${context.count}",
              "    pastPerformance?: string\n  },\n  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },\n): Promise<CreativeSuggestion[]> {\n  const cur = currencySymbol(profile.currency)\n  const prompt = `Generate ${context.count}")
s = s.replace("    spend: number\n  }\n): Promise<CreativeSuggestion> {\n  const prompt = `Analyze and suggest improvements",
              "    spend: number\n  },\n  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },\n): Promise<CreativeSuggestion> {\n  const cur = currencySymbol(profile.currency)\n  const prompt = `Analyze and suggest improvements")
s = s.replace("Budget: ₹${context.budget}", "Budget: ${cur}${context.budget}").replace("- Spend: ₹${performance.spend}", "- Spend: ${cur}${performance.spend}")
s = s.replace("Create an ad creative that targets the Maharashtrian audience. The primary text and headline should be in Marathi (Devanagari script). The title and description can be in English for management purposes.",
              "Create an ad creative for the audience in the profile. ${langLine(profile)}")
s = s.replace("Create ${context.count} unique ad creative variations that target the Maharashtrian audience. Each should have a different angle (e.g. emotional appeal, scarcity, social proof, festival-themed, benefit-driven). The primaryText and headline should be in Marathi (Devanagari script).",
              "Create ${context.count} unique ad creative variations for the audience in the profile. Each should have a different angle (e.g. emotional appeal, scarcity, social proof, festival-themed, benefit-driven). ${langLine(profile)}")
s = s.replace("Based on this analysis, create an improved version of the creative. The improved primaryText and headline should be in Marathi (Devanagari script) targeting the Maharashtrian audience.",
              "Based on this analysis, create an improved version of the creative. ${langLine(profile)}")
for old, new in [
  ('"The main ad copy text in Marathi (Devanagari script)"', '"The main ad copy text in the profile language"'),
  ('"Catchy headline in Marathi (Devanagari script)"', '"Catchy headline in the profile language"'),
  ('"Targeting description for Maharashtra region"', '"Targeting description for the profile market"'),
  ('"Why this creative will work for the Maharashtrian audience (English)"', '"Why this creative will work for this audience (English)"'),
  ('"Main ad copy in Marathi (Devanagari)"', '"Main ad copy in the profile language"'),
  ('"Catchy headline in Marathi (Devanagari)"', '"Catchy headline in the profile language"'),
  ('"Improved ad copy in Marathi (Devanagari)"', '"Improved ad copy in the profile language"'),
  ('"Improved headline in Marathi (Devanagari)"', '"Improved headline in the profile language"'),
]: s = s.replace(old, new)
s = s.replace("generateStructured(provider, creativeSuggestionSchema, prompt, SYSTEM_PROMPT)", "generateStructured(provider, creativeSuggestionSchema, prompt, systemPrompt(profile))")
s = s.replace("generateStructured(provider, creativeSuggestionListSchema, prompt, SYSTEM_PROMPT)", "generateStructured(provider, creativeSuggestionListSchema, prompt, systemPrompt(profile))")
p.write_text(s, encoding='utf-8')
report.append(f"  creative-generator.ts: {'patched' if s != before else 'no change'}; SYSTEM_PROMPT refs left: {s.count('SYSTEM_PROMPT')}; marathi refs: {s.lower().count('marathi')}")

# ── 8. creative-reviewer.ts ────────────────────────────────────────────────
p = pathlib.Path('src/lib/ai/creative-reviewer.ts'); s = p.read_text(encoding='utf-8'); before = s
if "from './profile'" not in s:
    s = s.replace("import { generateStructured, creativeReviewSchema } from './structured'",
                  "import { generateStructured, creativeReviewSchema } from './structured'\nimport { DEFAULT_PROFILE, buildProfileContext, currencySymbol, type BusinessProfile } from './profile'")
s = re.sub(r"const REVIEW_SYSTEM_PROMPT = `[\s\S]*?Always respond with valid JSON only, no markdown formatting or additional text\.`",
"""function reviewSystemPrompt(profile: BusinessProfile): string {
  const where = [...profile.marketRegions, ...profile.marketCities, profile.marketCountry].filter(Boolean).join(', ')
  return `You are an expert Meta Ads reviewer and strategist for ${where}. You evaluate ad creatives written in ${profile.primaryLanguageLabel} on cultural relevance, emotional appeal, clarity, call-to-action effectiveness, and potential ROAS for this audience.

${buildProfileContext(profile)}

Always respond with valid JSON only, no markdown formatting or additional text.`
}""", s, count=1)
s = s.replace("    spend: number\n  }\n): Promise<CreativeReview> {\n  const prompt = `Review this Meta Ads creative for the Maharashtrian audience:",
              "    spend: number\n  },\n  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },\n): Promise<CreativeReview> {\n  const cur = currencySymbol(profile.currency)\n  const prompt = `Review this Meta Ads creative for the audience in the profile:")
s = s.replace("  totalConversions: number\n): Promise<string> {", "  totalConversions: number,\n  profile: BusinessProfile = { userId: '', ...DEFAULT_PROFILE },\n): Promise<string> {\n  const cur = currencySymbol(profile.currency)")
for old, new in [
  ("₹${creative.expectedSpend || 'N/A'}", "${cur}${creative.expectedSpend || 'N/A'}"),
  ("- Spend: ₹${performance.spend}", "- Spend: ${cur}${performance.spend}"),
  ("| Spend: ₹${c.actualSpend || 0}", "| Spend: ${cur}${c.actualSpend || 0}"),
  ("Total Spend: ₹${totalSpend}", "Total Spend: ${cur}${totalSpend}"),
  ("(total revenue ₹${totalRevenue.toFixed(0)} / total spend)", "(total revenue ${cur}${totalRevenue.toFixed(0)} / total spend)"),
  ("Analyze the following Meta Ads campaign performance for a Marathi ebook marketing campaign targeting Maharashtra:", "Analyze the following Meta Ads campaign performance for this business:"),
  ("Write the report in a mix of English and Marathi where appropriate.", "Write the report in English, with key phrases in ${profile.primaryLanguageLabel} where it helps the owner."),
  ("generateStructured(provider, creativeReviewSchema, prompt, REVIEW_SYSTEM_PROMPT)", "generateStructured(provider, creativeReviewSchema, prompt, reviewSystemPrompt(profile))"),
  ("return provider.generateCompletion(prompt, REVIEW_SYSTEM_PROMPT)", "return provider.generateCompletion(prompt, reviewSystemPrompt(profile))"),
]: s = s.replace(old, new)
p.write_text(s, encoding='utf-8')
report.append(f"  creative-reviewer.ts: {'patched' if s != before else 'no change'}; REVIEW_SYSTEM_PROMPT refs left: {s.count('REVIEW_SYSTEM_PROMPT')}")

# ── 9. API callers ────────────────────────────────────────────────────────
patch('src/app/api/ai/generate/route.ts', [
  ("import type { AIProviderType } from '@/lib/ai/types'", "import type { AIProviderType } from '@/lib/ai/types'\nimport { getProfile } from '@/lib/ai/profile'"),
  ("    const context = { productType, productName, productDescription, targetAudience, budget, pastPerformance }",
   "    const profile = await getProfile(userId)\n    const context = { productType, productName, productDescription, targetAudience: targetAudience || profile.targetAudience || '', budget, pastPerformance }"),
  ("        ? await generateMultipleCreativeSuggestions(provider, { ...context, count: safeCount })\n        : [await generateCreativeSuggestion(provider, context)]",
   "        ? await generateMultipleCreativeSuggestions(provider, { ...context, count: safeCount }, profile)\n        : [await generateCreativeSuggestion(provider, context, profile)]"),
  ("            language: 'marathi',", "            language: profile.primaryLanguage,"),
])
p = pathlib.Path('src/app/api/creatives/route.ts'); s = p.read_text(encoding='utf-8'); before = s
if "from '@/lib/ai/profile'" not in s:
    s = s.replace("import { db } from '@/lib/db/supabase-db'", "import { db } from '@/lib/db/supabase-db'\nimport { getProfile } from '@/lib/ai/profile'", 1)
s = s.replace("        language: body.language ?? 'marathi',", "        language: body.language ?? (await getProfile(userId)).primaryLanguage,")
p.write_text(s, encoding='utf-8'); report.append(f"  creatives/route.ts: {'patched' if s != before else 'no change'}")

# ── 10. Tool descriptions: language literals ───────────────────────────────
for f in ['src/lib/ai/tool-definitions.ts', 'src/lib/ai/tool-definitions.delivery.ts']:
    p = pathlib.Path(f); s = p.read_text(encoding='utf-8'); before = s
    for old, new in [
      ('Marathi (Devanagari script) ad copy', 'ad copy in the business profile language'),
      ('Marathi ad copy', 'ad copy in the profile language'), ('Marathi headline', 'headline in the profile language'),
      ('Primary ad copy text in Marathi (Devanagari script)', 'Primary ad copy text in the profile language'),
      ('Catchy ad headline in Marathi (Devanagari script)', 'Catchy ad headline in the profile language'),
      ('New primary ad copy (Marathi Devanagari)', 'New primary ad copy (profile language)'), ('New headline (Marathi Devanagari)', 'New headline (profile language)'),
      ('(default: marathi)', '(defaults to the profile language)'), ('(default: Maharashtra)', '(defaults to the profile market)'),
      ('writes Marathi ad copy', 'writes ad copy in the profile language'), ('primary text (Marathi copy)', 'primary text'),
      ('rewritten Marathi copy', 'rewritten copy in the profile language'),
      ('The review is tailored to the Maharashtrian Marathi-speaking audience.', 'The review is tailored to the audience in the business profile.'),
      ('(e.g. "Marathi sales ebook")', '(e.g. "sales ebook", "dental checkup offer")'),
      ('Budget amount in Indian Rupees (INR).', 'Budget amount in the ad account currency.'), ('New budget amount in INR', 'New budget amount in the ad account currency'),
      ('Expected daily spend for this creative in INR', 'Expected daily spend for this creative in the account currency'),
      ('(e.g. 2.5 means ₹2.50 revenue', '(e.g. 2.5 means 2.50 revenue'),
      ('Example: search_targeting({query: "Maharashtra", kind: "geo"}) or {query: "Marathi", kind: "locale"}.', 'Example: search_targeting({query: "Karnataka", kind: "geo"}) or {query: "Tamil", kind: "locale"}.'),
      ('e.g. "Maharashtra", "Pune", "Marathi", "Online shopping"', 'e.g. "Gujarat", "Chennai", "Hindi", "Online shopping"'),
      ('{"regions":["Maharashtra"],"cities":["Pune"],"languages":["Marathi"],', '{"regions":["<from profile>"],"cities":["<from profile>"],"languages":["<from profile>"],'),
    ]: s = s.replace(old, new)
    p.write_text(s, encoding='utf-8')
    report.append(f"  {f}: {'swept' if s != before else 'unchanged'}; refs left: {len(re.findall('(?i)marathi|maharashtra', s))}")

print("\n".join(report))
