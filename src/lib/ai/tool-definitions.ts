import type { ToolDefinition } from './types'
import { DELIVERY_TOOLS } from './tool-definitions.delivery'

/**
 * LOCAL_TOOLS — tools that operate entirely on the local platform database.
 * These do NOT require a Meta connection and are always safe to execute
 * (no approval needed). They cover campaign/creative CRUD, image generation,
 * creative review, dashboard summaries, and knowledge-base search.
 */
export const LOCAL_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'ask_user_question',
      description:
        'Ask the user a clarifying question to gather information you need before performing a task. ' +
        'The question appears as a popup on the chat — the user types an answer and it comes back to you instantly. ' +
        '\n\n' +
        'USE THIS when you need more details to do a good job — e.g. before creating a campaign (ask about budget, ' +
        'audience, objective), before generating a creative (ask about the product, angle, tone), or before making ' +
        'strategy changes (ask about goals, constraints). ' +
        '\n\n' +
        'Ask ONE question at a time. After the user answers, you can ask another question or proceed with the task. ' +
        'Do NOT ask questions you can already answer from the conversation, strategy, or memory — only ask for ' +
        'genuinely missing information. ' +
        '\n\n' +
        'Returns the user\'s answer as a string. If the user skips or the question times out, you\'ll get an ' +
        'error — proceed with reasonable defaults in that case.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask the user. Be specific and concise. Example: "What is your daily budget for this campaign?"' },
          placeholder: { type: 'string', description: 'Optional placeholder text for the input field, giving the user a hint about the expected answer. Example: "e.g. ₹500/day"' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_local_campaigns',
      description:
        'Retrieve ALL campaigns stored in the local platform database for the current user. ' +
        'Each campaign includes: id, name, objective (e.g. OUTCOME_SALES, OUTCOME_AWARENESS, OUTCOME_TRAFFIC), ' +
        'status (draft / active / paused / completed), budget, budgetType (daily / lifetime), ' +
        'the linked Meta campaign ID (if published), and aggregated performance metrics (totalSpend, ' +
        'totalRevenue, totalImpressions, totalClicks, totalConversions, and computed ROAS). ' +
        'The list is ordered by most recently created first. ' +
        'Use this to get an overview of all campaigns before recommending changes or creating new ones.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_local_creatives',
      description:
        'Retrieve ALL ad creatives stored in the local platform database for the current user. ' +
        'Each creative includes: id, title, description, primaryText (the Marathi ad copy), ' +
        'headline, callToAction, status (draft / approved / rejected / published), reviewStatus ' +
        '(pending / approved / rejected), language, audience, imageUrl, and performance metrics ' +
        '(impressions, clicks, conversions, actualSpend, revenue, and computed ROAS). ' +
        'The list is ordered by most recently created first. ' +
        'Use this to review existing creatives, find ones that need improvement, or check which ' +
        'creatives are pending approval before they can be published to Meta.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_local_campaign',
      description:
        'Retrieve a single campaign by its unique ID from the local database. ' +
        'Returns the full campaign record including all fields (name, objective, status, budget, ' +
        'budgetType, startDate, endDate, metaCampaignId, and all performance metrics). ' +
        'Use this when you need detailed information about one specific campaign rather than the full list.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'The unique identifier of the campaign to retrieve (UUID format)' },
        },
        required: ['campaignId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_local_campaign',
      description:
        'Create a new campaign in the local database. The campaign always starts in "draft" status ' +
        'so it can be reviewed before being published to Meta. ' +
        'Required fields: name (a descriptive campaign name), objective (Meta objective type such as ' +
        'OUTCOME_SALES, OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEAD_GENERATION), ' +
        'budget (numeric amount in INR), and budgetType (daily or lifetime). ' +
        'Optional: startDate and endDate in ISO 8601 format (e.g. "2024-12-01T00:00:00Z"). ' +
        'Returns the new campaign ID and a confirmation message. ' +
        'This is a safe operation — it does NOT spend any money until the campaign is explicitly ' +
        'published to Meta via the publish_campaign_to_meta tool.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A descriptive name for the campaign (e.g. "Diwali Ebook Sale 2024")' },
          objective: { type: 'string', description: 'Meta Ads campaign objective. Valid values: OUTCOME_SALES, OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_LEAD_GENERATION, OUTCOME_APP_PROMOTION, OUTCOME_MESSAGES, OUTCOME_VIDEO_VIEWS' },
          budget: { type: 'number', description: 'Budget amount in Indian Rupees (INR). For daily budgets, this is the amount spent per day. For lifetime budgets, this is the total amount over the campaign duration.' },
          budgetType: { type: 'string', enum: ['daily', 'lifetime'], description: '"daily" for a budget that resets each day, or "lifetime" for a total campaign budget' },
          startDate: { type: 'string', description: 'Campaign start date in ISO 8601 format (e.g. "2024-12-01T00:00:00Z"). If omitted, the campaign starts when published.' },
          endDate: { type: 'string', description: 'Campaign end date in ISO 8601 format. Only meaningful for lifetime budgets.' },
        },
        required: ['name', 'objective', 'budget', 'budgetType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_local_campaign',
      description:
        'Update an existing campaign in the local database. Only the fields you provide will be changed; ' +
        'all other fields remain untouched. You can update the name, status (draft / active / paused / ' +
        'completed), budget, and budgetType. ' +
        'Returns the updated campaign ID and a confirmation message. ' +
        'Note: changing the status here only affects the local record. To pause or resume a campaign ' +
        'on Meta (live), use the set_campaign_status tool instead.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'The unique ID of the campaign to update' },
          name: { type: 'string', description: 'New campaign name' },
          status: { type: 'string', enum: ['draft', 'active', 'paused', 'completed'], description: 'New campaign status (local only — does not affect live Meta campaigns)' },
          budget: { type: 'number', description: 'New budget amount in INR' },
          budgetType: { type: 'string', enum: ['daily', 'lifetime'], description: 'New budget type' },
        },
        required: ['campaignId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_local_campaign',
      description:
        'Permanently delete a campaign from the local database. This also removes it from the local ' +
        'dashboard but does NOT delete the campaign on Meta if it has already been published. ' +
        'This action requires approval if auto-optimize is not enabled. ' +
        'Returns a confirmation message on success.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'The unique ID of the campaign to delete' },
        },
        required: ['campaignId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_local_creative',
      description:
        'Create a new ad creative in the local database for later review and publishing. ' +
        'The creative is stored with "draft" status and "pending" review status. ' +
        'Generate Marathi (Devanagari script) ad copy for the primaryText and headline to target ' +
        'the Maharashtrian audience in India. ' +
        'Required fields: title (English, for management purposes) and description (English, one sentence ' +
        'describing the creative strategy). ' +
        'Optional: primaryText (Marathi ad copy), headline (Marathi headline), callToAction (e.g. LEARN_MORE, ' +
        'SHOP_NOW, SIGN_UP, DOWNLOAD), expectedSpend (INR), expectedRoas (return on ad spend), language ' +
        '(default: marathi), audience (default: Maharashtra), imageUrl (if an image already exists), ' +
        'and campaignId (to associate the creative with a campaign). ' +
        'Returns the new creative ID and a confirmation message. ' +
        'This is a safe operation — no ad spend is triggered until the creative is reviewed, approved, ' +
        'and published to Meta.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Creative title in English (for management/identification purposes)' },
          description: { type: 'string', description: 'One-sentence description of the creative strategy in English' },
          primaryText: { type: 'string', description: 'Primary ad copy text in Marathi (Devanagari script). This is the main body of the ad visible to users.' },
          headline: { type: 'string', description: 'Catchy ad headline in Marathi (Devanagari script)' },
          callToAction: { type: 'string', description: 'Meta Ads call-to-action type. Valid values: LEARN_MORE, SHOP_NOW, SIGN_UP, DOWNLOAD, BUY_NOW, CONTACT_US, SUBSCRIBE, GET_OFFER, BOOK_TRAVEL, DOWNLOAD_LINK' },
          expectedSpend: { type: 'number', description: 'Expected daily spend for this creative in INR (for planning purposes)' },
          expectedRoas: { type: 'number', description: 'Expected return on ad spend (e.g. 2.5 means ₹2.50 revenue per ₹1 spent)' },
          language: { type: 'string', description: 'Language of the ad copy (default: marathi)' },
          audience: { type: 'string', description: 'Target audience description (default: Maharashtra)' },
          imageUrl: { type: 'string', description: 'URL of an existing image to attach to this creative. If you want to generate a new image, use generate_ad_image or generate_creative_with_image instead.' },
          campaignId: { type: 'string', description: 'ID of a campaign to associate this creative with' },
        },
        required: ['title', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_local_creative',
      description:
        'Update an existing ad creative in the local database. Only the fields you provide will be ' +
        'changed; all others remain untouched. You can update the title, description, primaryText, ' +
        'headline, callToAction, status (draft / approved / rejected / published), and reviewStatus ' +
        '(pending / approved / rejected). ' +
        'Returns the updated creative ID and a confirmation message.',
      parameters: {
        type: 'object',
        properties: {
          creativeId: { type: 'string', description: 'The unique ID of the creative to update' },
          title: { type: 'string', description: 'New creative title (English)' },
          description: { type: 'string', description: 'New creative description (English)' },
          primaryText: { type: 'string', description: 'New primary ad copy (Marathi Devanagari)' },
          headline: { type: 'string', description: 'New headline (Marathi Devanagari)' },
          callToAction: { type: 'string', description: 'New call-to-action type' },
          status: { type: 'string', enum: ['draft', 'approved', 'rejected', 'published'], description: 'New creative status' },
          reviewStatus: { type: 'string', enum: ['pending', 'approved', 'rejected'], description: 'New review status' },
        },
        required: ['creativeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_local_creative',
      description:
        'Permanently delete an ad creative from the local database. This does NOT remove the creative ' +
        'from Meta if it has already been published there. ' +
        'This action requires approval if auto-optimize is not enabled. ' +
        'Returns a confirmation message on success.',
      parameters: {
        type: 'object',
        properties: {
          creativeId: { type: 'string', description: 'The unique ID of the creative to delete' },
        },
        required: ['creativeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_ad_image',
      description:
        'Generate a professional ad creative image using AI image generation. ' +
        'The image is automatically enhanced for digital marketing use (clean design, vibrant colors, ' +
        'sharp focus, commercial advertising style for the Indian/Maharashtrian audience). ' +
        'The generated image is saved to Supabase storage and a stable public URL is returned. ' +
        '\n\n' +
        'PROVIDER CHAIN (always works, even without an API key): ' +
        '1. GPT image (gpt-image-1) via OpenAI (best quality — requires the user\'s OpenAI API key) ' +
        '2. Pollinations flux model (free, no key required, high quality) ' +
        '3. Pollinations sana model (free, no key required) ' +
        '4. Pollinations turbo model (free, faster) ' +
        '\n\n' +
        'If the primary provider fails, it automatically falls through to the next provider. ' +
        'Returns the image URL, the provider used, and a confirmation message. ' +
        'Use this when the user wants a standalone image, or when you already have ad copy and ' +
        'just need the visual.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the image to generate. Be specific about the product, mood, colors, composition, background, and style. Example: "A Maharashtrian woman in traditional saree reading an ebook on her smartphone during Diwali festival, warm golden lighting, bokeh lights in background, joyful expression, product placement style"' },
          size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'], description: 'Image dimensions in pixels. 1024x1024 = square, 1536x1024 = landscape, 1024x1536 = portrait (GPT image sizes)' },
          aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '1.91:1', '16:9'], description: 'Meta Ads recommended aspect ratios. 1:1 = Feed (square), 4:5 = Feed (portrait), 9:16 = Stories/Reels, 1.91:1 = Link ad, 16:9 = landscape. Overrides "size" for free providers.' },
          style: { type: 'string', enum: ['vivid', 'natural'], description: 'Image style: "vivid" for high-contrast, eye-catching advertising style (default), or "natural" for realistic photographic style' },
          quality: { type: 'string', enum: ['standard', 'hd'], description: 'Image quality: "standard" (medium quality, lower cost) or "hd" (high quality, best detail). Default: hd for best quality.' },
          brandColors: { type: 'array', items: { type: 'string' }, description: 'Brand colors to incorporate into the design (e.g. ["#FF6B35", "#F7C59F", "#004E89"]). Helps maintain brand consistency across creatives.' },
          negativePrompt: { type: 'string', description: 'What to avoid in the generated image (e.g. "text, watermarks, low quality, distorted faces")' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_creative_with_image',
      description:
        'Generate a COMPLETE ad creative in a single step — writes Marathi ad copy (title, primary text, ' +
        'headline, CTA) AND generates a matching AI image, then saves both to the local database as a draft ' +
        'creative ready for review. ' +
        '\n\n' +
        'This is the recommended tool when the user says "create an ad", "make a creative", or wants a full ' +
        'creative produced. It is faster and more cohesive than calling create_local_creative and ' +
        'generate_ad_image separately because the image prompt is derived from the product and angle, ' +
        'ensuring visual and textual themes match. ' +
        '\n\n' +
        'Required: product (the product or service being advertised). ' +
        'Optional: angle (creative theme — e.g. emotional, scarcity, festival, benefit-driven, social proof, ' +
        'urgency, testimonial), callToAction (default: LEARN_MORE), campaignId (to link to a campaign), ' +
        'imagePrompt (custom image description; if omitted, one is auto-derived from the product and angle), ' +
        'aspectRatio (Meta Ads ratio: 1:1 feed, 4:5 feed portrait, 9:16 stories/reels, 1.91:1 link ad, ' +
        '16:9 landscape), style (vivid or natural), quality (standard or hd), brandColors (array of hex ' +
        'colors to incorporate), negativePrompt (what to avoid in the image). ' +
        '\n\n' +
        'Image generation always works — even without an OpenAI key — via the free Pollinations fallback. ' +        'Returns the creative ID, generated copy, image URL (or null if image generation failed), the provider ' +
        'used, and a confirmation message.',
      parameters: {
        type: 'object',
        properties: {
          product: { type: 'string', description: 'The product or service being advertised (e.g. "Marathi sales ebook", "Diwali discount sale", "real estate listing in Pune")' },
          angle: { type: 'string', description: 'Creative angle or theme. Common values: emotional, scarcity, festival, benefit-driven, social-proof, urgency, testimonial, aspirational, comparison, storytelling. This shapes both the ad copy and the image prompt.' },
          imagePrompt: { type: 'string', description: 'Optional custom image description. If omitted, one is automatically derived from the product and angle. Provide this when you want specific visual control.' },
          callToAction: { type: 'string', description: 'Meta Ads CTA type (default: LEARN_MORE). Valid: LEARN_MORE, SHOP_NOW, DOWNLOAD, SIGN_UP, BUY_NOW, CONTACT_US, SUBSCRIBE, GET_OFFER' },
          campaignId: { type: 'string', description: 'Optional campaign ID to associate this creative with' },
          aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '1.91:1', '16:9'], description: 'Meta Ads aspect ratio. 1:1 = Feed (square, default), 4:5 = Feed (portrait), 9:16 = Stories/Reels, 1.91:1 = Link ad, 16:9 = landscape.' },
          style: { type: 'string', enum: ['vivid', 'natural'], description: 'Image style: vivid (high-contrast advertising, default) or natural (realistic)' },
          quality: { type: 'string', enum: ['standard', 'hd'], description: 'Image quality: standard (medium quality) or hd (high quality, best detail). Default: hd.' },
          brandColors: { type: 'array', items: { type: 'string' }, description: 'Brand colors to incorporate (e.g. ["#FF6B35", "#004E89"])' },
          negativePrompt: { type: 'string', description: 'What to avoid in the image (e.g. "text, watermarks, low quality")' },
        },
        required: ['product'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'review_creative',
      description:
        'Review an existing ad creative and provide a quality assessment. ' +
        'The AI reads the creative\'s title, description, primary text (Marathi copy), headline, CTA, ' +
        'and language, then returns a structured review with: ' +
        '- score (1-10 quality rating) ' +
        '- strengths (what works well) ' +
        '- weaknesses (what needs improvement) ' +
        '- suggestions (specific actionable recommendations) ' +
        '\n\n' +
        'Use this before publishing a creative to Meta to ensure quality, or when the user asks for feedback ' +
        'on their ad copy. The review is tailored to the Maharashtrian Marathi-speaking audience.',
      parameters: {
        type: 'object',
        properties: {
          creativeId: { type: 'string', description: 'The unique ID of the creative to review' },
        },
        required: ['creativeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'improve_creative',
      description:
        'Generate specific improvement suggestions for an ad creative, including rewritten Marathi copy. ' +
        'The AI analyzes the existing creative (title, primary text, headline, CTA) and returns an ' +
        'improved version with: ' +
        '- Improved title (English, for management) ' +
        '- Improved primaryText (Marathi Devanagari) ' +
        '- Improved headline (Marathi Devanagari) ' +
        '- Improved callToAction ' +
        '- Reasoning (why the changes improve performance) ' +
        '\n\n' +
        'The improved version is automatically saved to the database, updating the existing creative. ' +
        'Use this after review_creative identifies weaknesses, or when the user asks to "improve" or ' +
        '"optimize" their ad copy.',
      parameters: {
        type: 'object',
        properties: {
          creativeId: { type: 'string', description: 'The unique ID of the creative to improve' },
        },
        required: ['creativeId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_summary',
      description:
        'Retrieve a comprehensive performance summary of the entire account from the local database. ' +
        'Returns: totalCampaigns, totalCreatives, totalSpend (INR), totalRevenue (INR), totalImpressions, ' +
        'totalClicks, totalConversions, CTR (click-through rate %), CPC (cost per click in INR), CPM ' +
        '(cost per mille in INR), and ROAS (return on ad spend). ' +
        'If no revenue is tracked yet, ROAS is 0 and a note explains that revenue tracking must be enabled. ' +
        'Use this for quick health checks or when the user asks "how are my ads doing?"',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        'Search the user\'s uploaded knowledge base using semantic similarity (RAG — Retrieval Augmented ' +
        'Generation). The knowledge base contains documents the user uploaded (product descriptions, brand ' +
        'guidelines, past performance reports, business details, etc.). ' +
        'Returns the top 5 most relevant document chunks with their titles, content, and similarity scores. ' +
        'Use this when the user asks about specific products, business details, or anything that might be ' +
        'documented in their knowledge base. This makes responses more informed and personalised. ' +
        'Requires an embedding API key to be configured (falls back gracefully if not available).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query describing what you want to find (e.g. "product pricing", "target audience demographics", "brand guidelines", "Diwali campaign performance")' },
        },
        required: ['query'],
      },
    },
  },
]
// MCP_TOOLS is gone. It reached Meta through an MCP subprocess that cannot
// run on serverless, and it had no ad set or ad tools — so nothing it
// published could ever deliver. DELIVERY_TOOLS replaces it with direct
// Graph API calls covering the full Campaign -> Ad Set -> Ad hierarchy.
export { DELIVERY_TOOLS } from './tool-definitions.delivery'

/**
 * MASTERMIND_TOOLS — the advanced AI Manager tools that give the agent
 * strategy, memory, autonomy, scheduling, reporting, and multimodal
 * capabilities. These are the "brain" tools that make the manager a
 * mastermind rather than a simple chatbot.
 */
export const MASTERMIND_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_strategy',
      description:
        'Retrieve the account strategy — the persistent goals and guardrails the AI Manager optimizes toward. ' +
        'Returns: targetRoas (e.g. 2.5 = ₹2.50 revenue per ₹1 spent), targetCpa (max acceptable cost per ' +
        'acquisition in INR), monthlyBudget (monthly spend cap in INR), dailyBudgetCap (daily spend guardrail ' +
        'in INR), scalingRules (JSON describing when/how to scale winning campaigns), guardrails (JSON hard ' +
        'limits that cannot be exceeded), focus (current strategic focus in plain text), and autoOptimize ' +
        '(boolean — if true, the manager can execute spend-affecting Meta actions without per-action approval). ' +
        '\n\n' +
        'ALWAYS call this before recommending changes or taking actions so you optimize toward the right goals.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_strategy',
      description:
        'Update the account strategy — the persistent goals and guardrails the AI Manager optimizes toward. ' +
        'Only the fields you provide will be changed; all others remain untouched. ' +
        'You can update: targetRoas (desired return on ad spend), targetCpa (max acceptable cost per ' +
        'acquisition in INR), monthlyBudget (monthly spend cap in INR), dailyBudgetCap (daily spend guardrail), ' +
        'scalingRules (JSON describing when/how to scale winners, e.g. {"ifRoasGt":3,"scalePct":20}), ' +
        'guardrails (JSON hard limits, e.g. {"maxDailySpend":5000,"neverPauseAllActive":true}), focus (current ' +
        'strategic focus in plain text), and autoOptimize (boolean — enables autonomous spend-affecting ' +
        'actions without per-action approval). ' +
        '\n\n' +
        'When autoOptimize is set to true, the manager gains complete autonomy: it can create, pause, resume ' +
        'campaigns and publish creatives to Meta without asking for approval each time. All actions are still ' +
        'audited and logged. Set to false to require approval for every spend-affecting action.',
      parameters: {
        type: 'object',
        properties: {
          targetRoas: { type: 'number', description: 'Target return on ad spend. E.g. 2.5 means the goal is ₹2.50 revenue per ₹1 spent. Lower = more lenient, higher = more aggressive.' },
          targetCpa: { type: 'number', description: 'Maximum acceptable cost per acquisition in INR. The manager will try to keep CPA below this. Set to null to remove.' },
          monthlyBudget: { type: 'number', description: 'Monthly spend cap in INR. The manager flags pacing risks if spend is on track to exceed this.' },
          dailyBudgetCap: { type: 'number', description: 'Daily spend guardrail in INR. Hard limit — the manager will pause campaigns to stay within this.' },
          scalingRules: { type: 'string', description: 'JSON string describing scaling rules. Example: {"ifRoasGt":3,"scalePct":20,"minDaysBeforeScale":3} means scale by 20% if ROAS exceeds 3x after 3+ days.' },
          guardrails: { type: 'string', description: 'JSON string of hard guardrails. Example: {"maxDailySpend":5000,"neverPauseAllActive":true,"minCampaignsToKeepActive":1}' },
          focus: { type: 'string', description: 'Current strategic focus in plain text (e.g. "Scale Diwali campaign while maintaining 2.5x ROAS")' },
          autoOptimize: { type: 'boolean', description: 'If true, the manager can execute spend-affecting Meta actions (create/pause/resume campaigns, publish creatives) without per-action approval. If false, each action requires user approval. Default: false.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_memory',
      description:
        'Retrieve your rolling memory of past decisions, observations, learnings, and outcomes. ' +
        'Memory persists across conversations and autonomous runs, so you stay consistent and learn from ' +
        'past experience. ' +
        'Returns the most recent memories (default: 12), each with: kind (summary / decision / observation / ' +
        'learning / outcome), content, importance (1-10), and related ID (if linked to a specific entity). ' +
        '\n\n' +
        'Use this at the start of a conversation to recall context, or when you need to check what you ' +
        'previously decided about a campaign or creative.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many recent memories to retrieve (default: 12, max: 50)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_memory',
      description:
        'Record a decision, observation, learning, or outcome to your persistent memory. This memory is ' +
        'embedded (semantic search enabled) and persists across all conversations and autonomous runs. ' +
        '\n\n' +
        'Always call this after taking meaningful actions so future turns and autonomous routines can recall ' +
        'what you did and why. ' +
        'Kinds: "decision" (you chose to do X), "observation" (you noticed Y), "learning" (you discovered Z ' +
        'from an outcome), "outcome" (the result of an action), "summary" (a high-level recap). ' +
        'Set importance (1-10) higher for critical learnings and lower for routine observations. ' +
        'Optional: relatedId to link the memory to a specific campaign/creative/conversation.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['summary', 'decision', 'observation', 'learning', 'outcome'], description: 'Type of memory being recorded' },
          content: { type: 'string', description: 'The memory content — be specific and actionable. Example: "Paused campaign C123 after 3 days of ROAS < 1.0. Spend was ₹450/day with 0 conversions. Safe to auto-pause similar underperformers."' },
          relatedId: { type: 'string', description: 'Optional ID of a related entity (campaign ID, creative ID, conversation ID)' },
          importance: { type: 'number', description: 'Importance level 1-10 (default: 5). Use 8-10 for critical learnings, 3-5 for routine observations.' },
        },
        required: ['kind', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_campaign_insights',
      description:
        'Pull live campaign performance data (spend, impressions, clicks, conversions, reach, CTR, CPC, CPM, ' +
        'revenue) from the Meta Ads API into the local database, including a daily breakdown for the specified ' +
        'number of days. ' +
        '\n\n' +
        'ALWAYS call this BEFORE analyzing performance so you work with real, up-to-date data rather than stale ' +
        'numbers. The synced data powers get_daily_metrics, get_performance_trend, get_dashboard_summary, ' +
        'generate_chart, and generate_report. ' +
        'Requires a valid Meta connection. ' +
        'Returns a summary of what was synced.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days of historical data to sync from Meta (default: 30). Use 7 for recent trends, 30 for monthly analysis, 90 for quarterly.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_from_meta',
      description:
        'Pull ALL live campaigns from the Meta Ads API and create or update local campaign rows so the local ' +
        'database mirrors what is on Meta. This is a full sync (campaigns + creatives + performance). ' +
        'Use this when the local database is empty or significantly out of sync with Meta. ' +
        'Requires a valid Meta connection.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_campaign_to_meta',
      description:
        'Publish a local draft campaign to the Meta Ads API — this makes the campaign LIVE and it will start ' +
        'spending budget. ' +
        '⚠️ This is a SPEND-AFFECTING action. It requires user approval unless auto-optimize is enabled. ' +
        'When the action requires approval, a pending approval is created and the user must approve it in the ' +
        'AI Manager → Approvals panel before the campaign goes live. ' +
        'Returns a confirmation message with the Meta campaign ID.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'The local database campaign ID to publish to Meta' },
        },
        required: ['campaignId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_campaign_status',
      description:
        'Pause or resume a campaign on Meta (live). This directly affects live ad spend. ' +
        '⚠️ This is a SPEND-AFFECTING action. It requires user approval unless auto-optimize is enabled. ' +
        'When approval is needed, a pending approval is created and the user must approve it before the action ' +
        'executes. ' +
        'Returns a confirmation message.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'The local database campaign ID (must already be published to Meta)' },
          active: { type: 'boolean', description: 'true to resume the campaign (start spending), false to pause it (stop spending)' },
        },
        required: ['campaignId', 'active'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_metrics',
      description:
        'Retrieve the synced daily performance time series (real Meta data) for charting and pacing analysis. ' +
        'Returns rows of: date, spend, impressions, clicks, conversions, reach, ctr, cpc, revenue. ' +
        'Data must be synced first via sync_campaign_insights. ' +
        'Use this for pacing analysis, anomaly detection, or building custom charts.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days of data to retrieve (default: 30)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_performance_trend',
      description:
        'Retrieve an aggregated performance summary PLUS the daily trend for the last N days (real synced ' +
        'Meta data). ' +
        'Returns: summary (totals + computed metrics like ROAS, CTR, CPC, CPM) and trend (array of daily ' +
        'breakdowns). ' +
        'Use this for pacing analysis, anomaly detection, and evaluating whether performance is improving or ' +
        'declining over time. Always call sync_campaign_insights first to ensure data is current.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to analyze (default: 30). Use 7 for short-term, 30 for monthly, 90 for quarterly trends.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_account_balance',
      description:
        'Retrieve the live Meta ad account balance, spend cap, and amount spent so far. ' +
        'Returns: balance, spendCap, amountSpent, currency. ' +
        'Use this for budget pacing — check if the account is close to its spend cap or has sufficient balance.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'test_meta_connection',
      description:
        'Test the live Meta Ads connection end-to-end. Validates the access token (is it valid? when does it ' +
        'expire? what scopes/permissions does it have?), confirms the ad account is reachable, counts live ' +
        'campaigns, and returns a health summary. ' +
        '\n\n' +
        'Use this when: ' +
        '1. The user asks "does my Meta connection work?" or "is my connection OK?" ' +
        '2. Meta operations are failing and you need to diagnose why ' +
        '3. Before relying on Meta tools in a complex workflow ' +
        '4. To check token expiry and recommend reconnection. ' +
        'Returns: token info, ad account details, reachability, campaign count, and a human-readable health ' +
        'summary.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_scheduled_jobs',
      description:
        'List all autonomous scheduled routines (cron jobs) the AI Manager runs for the user. ' +
        'Returns each job\'s: id, type (morning_optimization / budget_pacing / anomaly_detection / ' +
        'weekly_report / custom), cronExpression (UTC), status (active / paused), campaignId, config, ' +
        'lastRunAt, and nextRunAt. ' +
        'Use this to review what autonomous routines are configured and their schedules.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_scheduled_job',
      description:
        'Schedule a new autonomous routine that runs on a cron schedule via Supabase pg_cron. ' +
        'The routine types are: ' +
        '- "morning_optimization": Daily sync + evaluate each campaign vs targets → pause underperformers, scale winners. ' +
        '- "budget_pacing": Check spend vs caps → adjust to stay within budget. ' +
        '- "anomaly_detection": Compare last 7d vs prior 7d → flag metrics that moved >30%. ' +
        '- "weekly_report": Generate and save a structured weekly performance report. ' +
        '- "custom": Run a custom prompt defined in the config field. ' +
        '\n\n' +
        'Required: type and cronExpression (standard cron in UTC, e.g. "0 9 * * *" = 9 AM daily). ' +
        'Optional: campaignId (to scope the routine to a specific campaign) and config (JSON string with ' +
        'custom parameters or a custom prompt). ' +
        'Returns the created job and a confirmation message.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Routine type: morning_optimization, budget_pacing, anomaly_detection, weekly_report, or custom' },
          cronExpression: { type: 'string', description: 'Standard cron expression in UTC. Examples: "0 9 * * *" = daily at 9 AM UTC, "0 9 * * 1" = every Monday at 9 AM UTC, "0 */6 * * *" = every 6 hours.' },
          campaignId: { type: 'string', description: 'Optional campaign ID to scope the routine to a specific campaign' },
          config: { type: 'string', description: 'Optional JSON configuration or custom prompt for the routine (especially for "custom" type)' },
        },
        required: ['type', 'cronExpression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_scheduled_job',
      description:
        'Update an existing scheduled autonomous routine. You can change its status (active / paused), ' +
        'cron expression, or config. ' +
        'Use this to pause a routine temporarily, adjust its schedule, or update its configuration.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The ID of the scheduled job to update' },
          status: { type: 'string', enum: ['active', 'paused'], description: 'New status: "active" to enable, "paused" to disable' },
          cronExpression: { type: 'string', description: 'New cron expression in UTC' },
          config: { type: 'string', description: 'New JSON configuration or custom prompt' },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_scheduled_job',
      description:
        'Permanently delete a scheduled autonomous routine. The routine will no longer run. ' +
        'Returns a confirmation message. Use this when a routine is no longer needed or was created in error.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The ID of the scheduled job to delete' },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_chart',
      description:
        'Generate a data visualization chart from real performance data. The chart spec is returned and ' +
        'the UI renders it inline in the chat. ' +
        'Chart kinds: ' +
        '- "spend_trend": Daily spend over time (line/area chart) — shows pacing. ' +
        '- "funnel": Impressions → Clicks → Conversions funnel (bar chart) — shows drop-off rates. ' +
        '- "roas_by_campaign": ROAS comparison across campaigns (bar chart) — identifies winners/losers. ' +
        '- "performance_compare": Side-by-side metric comparison across campaigns (composed chart). ' +
        '- "custom": Provide your own data, xKey, and yKeys for a fully custom chart. ' +
        '\n\n' +
        'Optional: title, days (data range), campaignIds (filter), chartType (line/bar/area/pie/composed), ' +
        'and for custom charts: data (array of data points), xKey, yKeys. ' +
        'Returns the chart spec and a confirmation message.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['spend_trend', 'funnel', 'roas_by_campaign', 'performance_compare', 'custom'], description: 'Chart kind — determines what data is used and how it is visualized' },
          chartType: { type: 'string', enum: ['line', 'bar', 'area', 'pie', 'composed'], description: 'Visual chart type: line (trends), bar (comparisons), area (cumulative), pie (distribution), composed (mixed bar+line)' },
          title: { type: 'string', description: 'Chart title displayed above the visualization' },
          days: { type: 'number', description: 'Number of days of data to include (default: 30)' },
          campaignIds: { type: 'array', items: { type: 'string' }, description: 'Filter to specific campaign IDs (for comparison charts)' },
          data: { type: 'array', items: { type: 'object' }, description: 'For custom charts: array of data point objects' },
          xKey: { type: 'string', description: 'For custom charts: the key in each data point to use for the X axis' },
          yKeys: { type: 'array', items: { type: 'object' }, description: 'For custom charts: array of {key, label, color?} objects defining the Y axis series' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_report',
      description:
        'Generate a structured markdown performance report from real synced data. ' +
        'The report includes: headline metrics (total spend, revenue, ROAS, impressions, clicks, conversions, ' +
        'CTR, CPC, CPM), strategy comparison (current ROAS vs target ROAS), campaign breakdown table (name, ' +
        'status, spend, ROAS, conversions), and creative summary (title, status, review status). ' +
        '\n\n' +
        'Always call sync_campaign_insights before generating a report so the numbers are current. ' +
        'Returns the report as markdown text and a confirmation message.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days to cover in the report (default: 30). Use 7 for weekly, 30 for monthly, 90 for quarterly.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transcribe_audio',
      description:
        'Transcribe an audio or voice attachment (URL) to text using OpenAI Whisper. ' +
        'Use this when the client sends a voice message — transcribe it first, then process the transcribed ' +
        'text as a regular message. ' +
        'Requires the user\'s Whisper API key to be configured. ' +
        'Returns the transcribed text and a confirmation message.',
      parameters: {
        type: 'object',
        properties: {
          audioUrl: { type: 'string', description: 'Public URL of the audio file to transcribe (MP3, WAV, M4A, OGG, etc.)' },
        },
        required: ['audioUrl'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'speak',
      description:
        'Convert text to speech (voice reply) and return a playable audio URL. Use this to give the client ' +
        'a voice response — especially helpful for non-technical users who prefer audio. ' +
        'Optional: voice (OpenAI TTS voice: alloy, echo, fable, onyx, nova, shimmer — default: nova). ' +
        'Requires the user\'s TTS API key to be configured. ' +
        'Returns the audio URL and a confirmation message.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to convert to speech. Use Marathi text for Marathi-speaking clients.' },
          voice: { type: 'string', enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'], description: 'OpenAI TTS voice persona. nova = warm female, onyx = deep male, alloy = neutral, echo = clear male, fable = expressive, shimmer = soft female.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description:
        'Semantically search your own past memories (decisions, observations, learnings, outcomes) for ' +
        'anything relevant to a query. Uses embedding-based similarity search (pgvector) to find memories ' +
        'that are conceptually related, even if they do not share exact keywords. ' +
        '\n\n' +
        'Use this when you suspect a past lesson or decision applies to the current situation. ' +
        'Example: "what did I learn about pausing low-ROAS campaigns?" ' +
        'Returns matched memories with their kind, content, and similarity score. ' +
        'Requires an embedding API key (falls back gracefully — returns empty if embeddings are unavailable).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query describing what you want to recall. Example: "lessons about scaling campaigns", "past decisions about Diwali", "what happened when I paused campaign X"' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reflect_and_learn',
      description:
        'Trigger a reflection cycle: analyze recent actions and performance deltas to extract durable, ' +
        'actionable learnings, then persist them as "learning" memories (with embeddings for future semantic ' +
        'recall). ' +
        '\n\n' +
        'The reflection engine: ' +
        '1. Reviews the last ~40 actions from the audit log (what was done and the outcome). ' +
        '2. Computes performance deltas (last 7d vs prior 7d: spend, clicks, conversions). ' +
        '3. Asks the AI to extract 2-5 concise, causal learnings connecting actions to outcomes. ' +
        '4. Saves each learning as an embedded memory for future semantic recall. ' +
        '\n\n' +
        'Use this after meaningful campaigns of actions, or when the user asks to "learn", "reflect", or ' +
        '"improve". Also runs automatically on the scheduled "reflection" routine. ' +
        'Returns the number of learnings extracted and a summary message.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

/**
 * The tool list handed to the model.
 *
 * De-duplicated by name: a few tools (get_account_balance, test_meta_connection)
 * are defined in more than one group, and OpenAI rejects a tools array
 * containing two functions with the same name. First definition wins.
 */
export const ALL_TOOLS: ToolDefinition[] = (() => {
  const seen = new Set<string>()
  const out: ToolDefinition[] = []
  for (const tool of [...LOCAL_TOOLS, ...MASTERMIND_TOOLS, ...DELIVERY_TOOLS]) {
    if (seen.has(tool.function.name)) continue
    seen.add(tool.function.name)
    out.push(tool)
  }
  return out
})()

/** Every tool name the dispatcher can be asked for. Used by tests. */
export const ALL_TOOL_NAMES = ALL_TOOLS.map((t) => t.function.name)
