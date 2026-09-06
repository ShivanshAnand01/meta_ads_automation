"""
Second pass: the tool handlers in local.ts are the LIVE path for the agent
(the dispatcher routes generate_creative_with_image / review_creative /
improve_creative there, not to manager.ts). They carried their own inline
prompts with raw JSON.parse and hardcoded language. This makes them delegate
to the profile-aware, schema-validated functions, and clears the last
literals elsewhere. Guarded and re-runnable.
"""
import pathlib, sys
sys.stdout.reconfigure(encoding='utf-8')
report = []

def patch(path, pairs):
    p = pathlib.Path(path); s = p.read_text(encoding='utf-8'); n = done = 0
    for old, new in pairs:
        if old in s: s = s.replace(old, new, 1); n += 1
        elif new in s: done += 1
        else: report.append(f"  !! MISSING anchor in {path}: {old[:90]!r}")
    p.write_text(s, encoding='utf-8'); report.append(f"  {path}: {n} applied, {done} already, {len(pairs)-n-done} missing")

# ── local.ts ───────────────────────────────────────────────────────────────
p = pathlib.Path('src/lib/ai/tools/local.ts'); s = p.read_text(encoding='utf-8')
if "from '@/lib/ai/structured'" not in s:
    s = s.replace("import { ingestWebsite } from '@/lib/ai/website-ingest'",
                  "import { ingestWebsite } from '@/lib/ai/website-ingest'\nimport { generateStructured, creativeSuggestionSchema, enforceCopyLimits } from '@/lib/ai/structured'\nimport { suggestCreativeImprovements } from '@/lib/ai/creative-generator'\nimport { reviewCreative } from '@/lib/ai/creative-reviewer'", 1)
p.write_text(s, encoding='utf-8')

patch('src/lib/ai/tools/local.ts', [
  # generate_ad_image: the default prompt is the profile's business, not an ebook
  ("      const prompt = (args.prompt as string) || 'Professional ad creative for a Marathi ebook'",
   "      const promptProfile = await getProfile(userId)\n      const prompt = (args.prompt as string) || `Professional ad creative for ${promptProfile.businessName || promptProfile.description || 'the business'}`"),
  ("        brandColors: Array.isArray(args.brandColors) ? (args.brandColors as string[]) : undefined,\n        negativePrompt: (args.negativePrompt as string) || undefined,\n      })\n      if (!result.success || !result.imageUrl) return { error: result.error || 'Image generation failed' }",
   "        brandColors: Array.isArray(args.brandColors) ? (args.brandColors as string[]) : (promptProfile.brandColors.length ? promptProfile.brandColors : undefined),\n        negativePrompt: (args.negativePrompt as string) || undefined,\n      })\n      if (!result.success || !result.imageUrl) return { error: result.error || 'Image generation failed' }"),

  # generate_creative_with_image: profile-driven copy, schema-validated, limits enforced
  ("      const product = (args.product as string) || 'a Marathi ebook'",
   "      const profile = await getProfile(userId)\n      const lang = profile.primaryLanguageLabel\n      const where = [...profile.marketRegions, ...profile.marketCities, profile.marketCountry].filter(Boolean).join(', ')\n      const product = (args.product as string) || profile.products || profile.businessName || 'the product'"),
  ("""      // Generate Marathi ad copy via the provider
      let copy: { title: string; description: string; primaryText: string; headline: string; callToAction: string } = {
        title: `${product} — ${angle}`, description: `${angle} angle for ${product}`, primaryText: '', headline: '', callToAction: cta,
      }
      try {
        const prov = ctx.provider as { generateCompletion: (p: string, s?: string) => Promise<string> }
        const copyPrompt = `Generate a Meta Ads creative for: "${product}". Angle: ${angle}. Target audience: Maharashtra, India (Marathi-speaking). Respond ONLY with valid JSON: {"title":"(English management name)","description":"(English, one sentence strategy)","primaryText":"(Marathi Devanagari ad copy, 2-3 lines)","headline":"(Marathi Devanagari headline)","callToAction":"${cta}"}.`
        const text = await prov.generateCompletion(copyPrompt, 'You are an expert Marathi ad copywriter for the Maharashtrian market. Respond only with valid JSON, no markdown.')
        const parsed = JSON.parse(text)
        copy = { ...copy, ...parsed }
      } catch {}""",
   """      // Ad copy in the profile's language, validated against the schema and
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
      }"""),
  ("      const imagePrompt = imagePromptArg || `${product}, ${angle} marketing theme, professional digital ad creative, Marathi Indian audience, high quality, clean modern design, vibrant colors`",
   "      const imagePrompt = imagePromptArg || `${product}, ${angle} marketing theme, professional digital ad creative for ${profile.targetAudience ?? 'the target audience'} in ${where}, high quality, clean modern design, vibrant colors`"),
  ("        brandColors: Array.isArray(args.brandColors) ? (args.brandColors as string[]) : undefined,\n        negativePrompt: (args.negativePrompt as string) || undefined,\n      })\n      let imageUrl: string | null = null",
   "        brandColors: Array.isArray(args.brandColors) ? (args.brandColors as string[]) : (profile.brandColors.length ? profile.brandColors : undefined),\n        negativePrompt: (args.negativePrompt as string) || undefined,\n      })\n      let imageUrl: string | null = null"),
  ("          expectedSpend: 1000,\n          expectedRoas: 2,\n          language: 'marathi',\n          audience: 'Maharashtra',\n          imageUrl,\n          campaignId,",
   "          language: profile.primaryLanguage,\n          audience: where,\n          imageUrl,\n          campaignId,"),
  ("        imageGenerated: !!imageUrl,\n        imageProvider: imgResult.provider,\n        imageError: imageUrl ? null : (imgResult.error || 'Image generation failed — creative saved with text only.'),\n        message: `Creative \"${creative?.title}\" created${imageUrl ? ` with image (${imgResult.provider})` : ' (image generation failed — text only)'}. Ready for review.`,",
   "        imageGenerated: !!imageUrl,\n        imageProvider: imgResult.provider,\n        imageError: imageUrl ? null : (imgResult.error || 'Image generation failed — creative saved with text only.'),\n        warnings: copyWarnings,\n        language: lang,\n        message: `Creative \"${creative?.title}\" created in ${lang}${imageUrl ? ` with image (${imgResult.provider})` : ' (image generation failed — text only)'}. Ready for review.${copyWarnings.length ? ` Issues: ${copyWarnings.join(' ')}` : ''}`,"),

  # review_creative / improve_creative: delegate to the shared, validated functions
  ("""      const reviewPrompt = `Review this Marathi ad creative for the Maharashtrian audience:
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
      }""",
   """      if (!ctx.provider) return { error: 'No AI provider configured' }
      try {
        // Same reviewer the API uses: profile-aware and schema-validated.
        const review = await reviewCreative(ctx.provider, creative, undefined, await getProfile(userId))
        return { review, creativeId: creative.id, title: creative.title }
      } catch (err) {
        return { error: `Failed to generate review: ${err instanceof Error ? err.message : 'unknown error'}`, creativeId: creative.id }
      }"""),
  ("""      const improvePrompt = `Improve this Marathi ad creative:
Title: ${creative.title}
Primary Text: ${creative.primaryText || 'N/A'}
Headline: ${creative.headline || 'N/A'}
Return JSON: { title, primaryText (Marathi/Devanagari), headline (Marathi/Devanagari), callToAction, reasoning }`
      try {
        const prov = ctx.provider as { generateCompletion: (p: string, s?: string) => Promise<string> }
        const text = await prov.generateCompletion(improvePrompt, 'You are an expert Marathi ad copywriter. Respond only with valid JSON.')
        try {
          const improved = JSON.parse(text)""",
   """      if (!ctx.provider) return { error: 'No AI provider configured' }
      try {
        // Same improver the API uses: profile-aware, schema-validated, length-limited.
        const improved = await suggestCreativeImprovements(ctx.provider, creative, undefined, await getProfile(userId))
        {"""),
])

# ── creative-generator.ts: the one prompt line the first pass missed ───────
patch('src/lib/ai/creative-generator.ts', [
  ("Create ${context.count} unique ad creative variations that target the Maharashtrian audience. Each should have a different angle (e.g., emotional appeal, scarcity, social proof, festival-themed, benefit-driven). The primaryText and headline should be in Marathi (Devanagari script).",
   "Create ${context.count} unique ad creative variations for the audience in the profile. Each should have a different angle (e.g., emotional appeal, scarcity, social proof, festival-themed, benefit-driven). ${langLine(profile)}"),
])

# ── agent.ts: the opening sentence (em dash, lowercase 'you') and item 8 ──
patch('src/lib/ai/agent.ts', [
  ("You are the **AI Manager** — you run this client's entire Meta (Facebook/Instagram) Ads operation. The client is a non-technical business owner in Maharashtra advertising Marathi sales ebooks. You handle strategy, campaign structure, creatives, audiences, budgets, pacing, scheduling, reporting and live optimization.",
   "You are the **AI Manager** — you run this business's entire Meta (Facebook/Instagram) Ads operation. Any business can sign up — a Marathi ebook seller in Pune, a Tamil restaurant in Chennai, an English SaaS in Bangalore — and you handle strategy, campaign structure, creatives, audiences, budgets, pacing, scheduling, reporting and live optimization in THEIR language, for THEIR market.\n\n# Onboarding a new business (before anything else)\nThe BUSINESS PROFILE block in your context says what is known and what is STILL UNKNOWN. If anything important is unknown, or Meta is not connected, onboard them conversationally — one question at a time, never a form:\n1. \\`get_business_profile\\` — see what we already know.\n2. Ask for their website and call \\`ingest_website\\` — read it before asking questions the site already answers.\n3. Confirm the AD COPY LANGUAGE explicitly (Devanagari on a site could be Marathi or Hindi — ask). Confirm market regions/cities, audience, tone and landing page. Save each with \\`set_business_profile\\`.\n4. Ask for their Meta app credentials one at a time — App ID, then App Secret, then access token — and call \\`connect_meta_account\\`. If several ad accounts come back, ask which and call \\`select_ad_account\\`. Never repeat a secret or token back to them.\n5. Set \\`onboarding_complete\\` true. From then on every campaign and creative is built from the profile and the knowledge base.\nIf the profile is complete and Meta is connected, skip all of this and get to work."),
  ("8. **Build full creatives.** \\`generate_creative_with_image\\` produces Marathi ad copy plus a matching image and saves it for review. \\`review_creative\\` and \\`improve_creative\\` polish existing ones. Note that generated images contain no text — Marathi headlines live in the ad copy fields, not baked into the picture.",
   "8. **Build full creatives.** \\`generate_creative_with_image\\` writes ad copy in the profile language plus a matching image and saves it for review. \\`review_creative\\` and \\`improve_creative\\` polish existing ones. Generated images contain no text — headlines live in the ad copy fields, not baked into the picture."),
])

# ── tool descriptions ──────────────────────────────────────────────────────
patch('src/lib/ai/tool-definitions.ts', [
  ('(e.g. "Marathi sales ebook", "Diwali discount sale", "real estate listing in Pune")', '(e.g. "sales ebook", "Diwali discount sale", "dental checkup offer")'),
  ("        '- Improved primaryText (Marathi Devanagari) ' +\n        '- Improved headline (Marathi Devanagari) ' +",
   "        '- Improved primaryText (in the profile language) ' +\n        '- Improved headline (in the profile language) ' +"),
  ("'The text to convert to speech. Use Marathi text for Marathi-speaking clients.'", "'The text to convert to speech, in the language the client writes in.'"),
])

# ── comments that still describe the old single-tenant world ──────────────
patch('src/lib/ai/manager.ts', [
  (" *   4. Generate full creatives (Marathi ad copy + matching image, saved to DB)", " *   4. Generate full creatives (ad copy in the profile language + matching image, saved to DB)"),
  ("    // 1. Generate Marathi ad copy via the provider", "    // 1. Generate ad copy in the profile language via the provider"),
])

print("\n".join(report))
