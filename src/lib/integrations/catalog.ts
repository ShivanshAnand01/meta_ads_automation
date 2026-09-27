/**
 * Third-party connections a business can add to strengthen its agents.
 *
 * Client-safe: no server imports. Every endpoint, header and MCP URL below was
 * checked against the provider's own documentation (September 2026). When a
 * provider changes one, change it here and nowhere else.
 */

export type IntegrationCategory = 'research' | 'media' | 'voice' | 'custom'
export type IntegrationMode = 'api_key' | 'mcp'

/** How an MCP server expects the secret. */
export type McpAuth =
  | { kind: 'bearer' }
  | { kind: 'header'; name: string }
  | { kind: 'query'; param: string }

export interface ProviderDef {
  id: string
  name: string
  category: IntegrationCategory
  /** One line: what the agents gain. Plain words, shown on the card. */
  blurb: string
  /** Which of the agents uses it. */
  usedBy: string[]
  keyUrl: string
  docsUrl: string
  /** Hint for the key field, e.g. "tvly-…". */
  keyHint?: string
  api?: {
    /** What the connection test does, shown before the user clicks it. */
    testNote: string
  }
  mcp?: {
    url: string
    auth: McpAuth
  }
}

export const CATEGORY_LABELS: Record<IntegrationCategory, { title: string; description: string }> = {
  research: {
    title: 'Research',
    description: 'Lets the research agent read competitor sites, reviews and pricing, and search the web.',
  },
  media: {
    title: 'Images and video',
    description: 'Extra image and video models for the creative generator and editor. OpenAI stays the default.',
  },
  voice: {
    title: 'Voice',
    description: 'Voice-overs for video ads, in your ad language.',
  },
  custom: {
    title: 'Custom',
    description: 'Any other tool that offers an MCP server.',
  },
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    category: 'research',
    blurb: 'Web search built for AI agents. Fast answers with sources.',
    usedBy: ['Research agent'],
    keyUrl: 'https://app.tavily.com/home',
    docsUrl: 'https://docs.tavily.com',
    keyHint: 'tvly-…',
    api: { testNote: 'Runs one basic search, which uses 1 Tavily credit.' },
    mcp: { url: 'https://mcp.tavily.com/mcp/', auth: { kind: 'query', param: 'tavilyApiKey' } },
  },
  {
    id: 'exa',
    name: 'Exa',
    category: 'research',
    blurb: 'Search by meaning. Good at finding competitors and similar businesses.',
    usedBy: ['Research agent'],
    keyUrl: 'https://dashboard.exa.ai/api-keys',
    docsUrl: 'https://exa.ai/docs',
    api: { testNote: 'Runs one search with a single result.' },
    mcp: { url: 'https://mcp.exa.ai/mcp', auth: { kind: 'header', name: 'x-api-key' } },
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    category: 'research',
    blurb: 'Reads whole websites cleanly: landing pages, pricing, offers.',
    usedBy: ['Research agent', 'Past-ads analyst'],
    keyUrl: 'https://www.firecrawl.dev/app/api-keys',
    docsUrl: 'https://docs.firecrawl.dev',
    keyHint: 'fc-…',
    api: { testNote: 'Reads your remaining credits. Free.' },
    mcp: { url: 'https://mcp.firecrawl.dev/v2/mcp', auth: { kind: 'bearer' } },
  },
  {
    id: 'apify',
    name: 'Apify',
    category: 'research',
    blurb: 'Thousands of ready-made scrapers for social pages, maps and marketplaces.',
    usedBy: ['Research agent'],
    keyUrl: 'https://console.apify.com/settings/integrations',
    docsUrl: 'https://docs.apify.com/integrations/mcp',
    keyHint: 'apify_api_…',
    api: { testNote: 'Reads your account details. Free.' },
    mcp: { url: 'https://mcp.apify.com', auth: { kind: 'bearer' } },
  },
  {
    id: 'fal',
    name: 'fal.ai',
    category: 'media',
    blurb: 'Hundreds of image and video models: Flux, Kling, Veo and more.',
    usedBy: ['Creative generator', 'Editor'],
    keyUrl: 'https://fal.ai/dashboard/keys',
    docsUrl: 'https://fal.ai/docs',
    api: { testNote: 'Lists one model. Free.' },
    mcp: { url: 'https://mcp.fal.ai/mcp', auth: { kind: 'bearer' } },
  },
  {
    id: 'replicate',
    name: 'Replicate',
    category: 'media',
    blurb: 'Open-source image, video and upscaling models on demand.',
    usedBy: ['Creative generator', 'Editor'],
    keyUrl: 'https://replicate.com/account/api-tokens',
    docsUrl: 'https://replicate.com/docs',
    keyHint: 'r8_…',
    api: { testNote: 'Reads your account details. Free.' },
  },
  {
    id: 'runway',
    name: 'Runway',
    category: 'media',
    blurb: 'Gen-4 video from a still image or a prompt.',
    usedBy: ['Creative generator'],
    keyUrl: 'https://dev.runwayml.com/',
    docsUrl: 'https://docs.dev.runwayml.com',
    api: { testNote: 'Reads your organisation and credit balance. Free.' },
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'media',
    blurb: 'Google image and video models, including Imagen and Veo.',
    usedBy: ['Creative generator'],
    keyUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    api: { testNote: 'Lists one model. Free.' },
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    category: 'voice',
    blurb: 'Natural voice-overs in Indian and global languages.',
    usedBy: ['Creative generator'],
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    docsUrl: 'https://elevenlabs.io/docs',
    api: { testNote: 'Reads your account details. Free.' },
  },
]

export const CUSTOM_MCP = {
  id: 'custom-mcp',
  name: 'Custom MCP server',
  category: 'custom' as const,
  blurb: 'Connect any tool that publishes an MCP server URL.',
  usedBy: ['Brain'],
}

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** Slug for a custom server: stable, URL-safe, unique per user by name. */
export function customSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `custom-${base || 'server'}`
}

/**
 * A custom MCP URL must be public https. The server makes the request, so a
 * private or loopback address would let a user probe our own network.
 */
export function validateCustomUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return 'Use an https:// address.'
    // Never let a user point the server at our own network.
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?)/i.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) {
      return 'Private and local addresses are not allowed.'
    }
    return null
  } catch {
    return 'That is not a valid URL.'
  }
}

/** Shape the browser receives. Never contains a secret. */
export interface IntegrationView {
  slug: string
  provider: string
  mode: IntegrationMode
  label: string | null
  status: 'connected' | 'error' | 'untested'
  lastTestedAt: string | null
  lastError: string | null
  tools: Array<{ name: string; description?: string }>
  enabled: boolean
  /** Last four characters only, so the user can tell keys apart. */
  keyPreview: string | null
  mcpUrl: string | null
}
