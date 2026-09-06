import type { ToolDefinition } from './types'

/**
 * ONBOARDING_TOOLS — how the agent takes a brand-new business from "just
 * signed up" to "ready to run ads", conversationally.
 *
 * The order the agent should drive:
 *   1. get_business_profile      → what do we already know? what is missing?
 *   2. ingest_website            → learn from their site; pre-fills the profile
 *   3. set_business_profile      → confirm language, market, audience, tone
 *   4. connect_meta_account      → their own App ID / secret / token
 *   5. select_ad_account         → if the token can see more than one
 * Then the normal campaign / creative tools take over, and every one of
 * them reads the profile for language and market.
 */
export const ONBOARDING_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_business_profile',
      description:
        'Read the business profile for the current user: name, what they sell, website, AD COPY LANGUAGE and script, ' +
        'market (country/regions/cities), currency, audience, tone, defaults — plus a list of what is still unknown. ' +
        'Call this FIRST in any new conversation. Never assume a language or market; if it is unknown, ask.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_business_profile',
      description:
        'Save facts about the business as you learn them. Send only the fields you learned. ' +
        'primary_language is a code (en, hi, mr, gu, ta, te, kn, ml, bn, pa, ur, es, fr, de, pt, ar, id); ' +
        'the platform derives the exact script instruction from it. language_mode "mixed" allows natural code-switching ' +
        '(e.g. Hinglish, Marathi+English). Set onboarding_complete true once language, market, audience and landing page are known.',
      parameters: {
        type: 'object',
        properties: {
          business_name: { type: 'string' },
          website_url: { type: 'string' },
          industry: { type: 'string' },
          description: { type: 'string', description: 'What the business does, one or two sentences' },
          products: { type: 'string', description: 'What they sell, price points, current offers' },
          usp: { type: 'string', description: 'Why customers pick them' },
          primary_language: { type: 'string', description: 'Language code for ad copy, e.g. "mr", "hi", "en", "ta"' },
          secondary_languages: { type: 'array', items: { type: 'string' } },
          language_mode: { type: 'string', description: '"single" or "mixed"' },
          market_country: { type: 'string', description: 'ISO country code, e.g. "IN"' },
          market_regions: { type: 'array', items: { type: 'string' }, description: 'States/regions to target, e.g. ["Maharashtra"]' },
          market_cities: { type: 'array', items: { type: 'string' } },
          currency: { type: 'string', description: 'ISO code, e.g. "INR". Usually taken from the ad account.' },
          target_audience: { type: 'string' },
          tone: { type: 'string', description: 'e.g. "warm and plain-spoken", "premium and precise"' },
          brand_colors: { type: 'array', items: { type: 'string' } },
          avoid: { type: 'string', description: 'Things never to say or show' },
          default_objective: { type: 'string', description: 'OUTCOME_SALES, OUTCOME_LEADS, OUTCOME_TRAFFIC, ...' },
          default_cta: { type: 'string', description: 'SHOP_NOW, LEARN_MORE, WHATSAPP_MESSAGE, SIGN_UP, ...' },
          landing_url: { type: 'string', description: 'Where ads send people' },
          cultural_notes: { type: 'string', description: 'Festivals, idiom, taboos the copy should respect' },
          onboarding_complete: { type: 'boolean' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ingest_website',
      description:
        "Crawl the business's website (home page plus about/products/services/pricing/contact) into the knowledge base, " +
        'and pre-fill the profile with the site title and description. Returns what was learned, including a language hint ' +
        'from the page text — CONFIRM the language with the user rather than assuming it (Devanagari could be Marathi or Hindi). ' +
        'Do this early: the agent cannot write accurate ads for a business it has not read about.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The website URL, e.g. https://example.com' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'connect_meta_account',
      description:
        "Connect the user's OWN Meta app to the platform. Ask them for three things from developers.facebook.com, one at a time: " +
        'App ID (a 15–16 digit number), App Secret, and an access token generated under that app with ads_management and ads_read. ' +
        'The tool validates the token against the app, exchanges it for a ~60-day token, discovers their ad accounts, and stores ' +
        'the secrets encrypted. If more than one ad account is returned, ask which to use and call select_ad_account. ' +
        'Never echo the secret or token back in your reply.',
      parameters: {
        type: 'object',
        properties: {
          app_id: { type: 'string' },
          app_secret: { type: 'string' },
          access_token: { type: 'string' },
          ad_account_id: { type: 'string', description: 'Optional: choose a specific ad account (act_ prefix optional)' },
        },
        required: ['app_id', 'app_secret', 'access_token'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_ad_account',
      description: 'Choose which of the connected Meta ad accounts this platform manages, when the token can see several.',
      parameters: {
        type: 'object',
        properties: { ad_account_id: { type: 'string' } },
        required: ['ad_account_id'],
      },
    },
  },
]
