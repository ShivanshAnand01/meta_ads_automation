import { db } from '@/lib/db/supabase-db'
import { getUserSecret, setUserSecret, clearUserSecret, VAULT_SENTINEL } from '@/lib/secrets'
import { PROVIDERS, getProvider, customSlug, validateCustomUrl, type IntegrationMode, type IntegrationView, type ProviderDef } from './catalog'
import { listMcpTools, callMcpTool, type McpEndpoint, type McpToolSummary } from './mcp'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Server side of third-party connections: test a key or MCP server, store the
 * secret in Vault, and give the agents a way to use what is connected.
 *
 * Secrets are written to Vault as "<user>__integration_<slug>"; the table's
 * `secret` column holds only the sentinel. Nothing in this module returns a
 * secret to a caller outside the server.
 */

const vaultKey = (slug: string) => `integration_${slug}`
const TEST_TIMEOUT_MS = 12_000

export interface TestResult {
  ok: boolean
  message: string
  tools?: McpToolSummary[]
}

// ── API-key checks ────────────────────────────────────────────────────────
// One cheap, documented call per provider. Free where the provider offers a
// free endpoint; otherwise the smallest possible request (said on the card).

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function apiCheck(provider: string, key: string): Promise<Response> {
  const json = { 'Content-Type': 'application/json' }
  switch (provider) {
    case 'tavily':
      return fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: 'connection test', max_results: 1, search_depth: 'basic' }),
      })
    case 'exa':
      return fetchWithTimeout('https://api.exa.ai/search', {
        method: 'POST',
        headers: { ...json, 'x-api-key': key },
        body: JSON.stringify({ query: 'connection test', numResults: 1 }),
      })
    case 'firecrawl':
      return fetchWithTimeout('https://api.firecrawl.dev/v2/team/credit-usage', { headers: { Authorization: `Bearer ${key}` } })
    case 'apify':
      return fetchWithTimeout('https://api.apify.com/v2/users/me', { headers: { Authorization: `Bearer ${key}` } })
    case 'fal':
      return fetchWithTimeout('https://api.fal.ai/v1/models?limit=1', { headers: { Authorization: `Key ${key}` } })
    case 'replicate':
      return fetchWithTimeout('https://api.replicate.com/v1/account', { headers: { Authorization: `Bearer ${key}` } })
    case 'runway':
      return fetchWithTimeout('https://api.dev.runwayml.com/v1/organization', {
        headers: { Authorization: `Bearer ${key}`, 'X-Runway-Version': '2024-11-06' },
      })
    case 'gemini':
      return fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } })
    case 'elevenlabs':
      return fetchWithTimeout('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } })
    default:
      throw new Error(`No API check for "${provider}"`)
  }
}

function explainStatus(status: number, name: string): string {
  if (status === 401 || status === 403) return `${name} rejected this key. Check you copied all of it, and that it is still active.`
  if (status === 402) return `${name} accepted the key but says the account is out of credit.`
  if (status === 429) return `${name} is rate-limiting this key right now. Wait a minute and test again.`
  return `${name} answered with an unexpected error (HTTP ${status}).`
}

async function testApiKey(p: ProviderDef, key: string): Promise<TestResult> {
  try {
    const res = await apiCheck(p.id, key)
    if (res.ok) return { ok: true, message: `Connected to ${p.name}.` }
    return { ok: false, message: explainStatus(res.status, p.name) }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return { ok: false, message: aborted ? `${p.name} did not answer within 12 seconds.` : `Could not reach ${p.name}.` }
  }
}

// ── MCP ───────────────────────────────────────────────────────────────────

function mcpEndpointFor(p: ProviderDef, secret: string): McpEndpoint {
  if (!p.mcp) throw new Error(`${p.name} has no MCP server`)
  const url = new URL(p.mcp.url)
  const headers: Record<string, string> = {}
  const auth = p.mcp.auth
  if (auth.kind === 'bearer') headers.Authorization = `Bearer ${secret}`
  else if (auth.kind === 'header') headers[auth.name] = secret
  else url.searchParams.set(auth.param, secret)
  return { url: url.toString(), headers }
}

function customEndpoint(config: Record<string, any>, secret: string | null): McpEndpoint {
  const headers: Record<string, string> = {}
  const headerName = typeof config.headerName === 'string' && config.headerName.trim() ? config.headerName.trim() : 'Authorization'
  if (secret) headers[headerName] = headerName.toLowerCase() === 'authorization' && !/^\w+\s/.test(secret) ? `Bearer ${secret}` : secret
  return { url: String(config.mcpUrl), headers }
}

async function testMcp(endpoint: McpEndpoint, name: string): Promise<TestResult> {
  try {
    const tools = await listMcpTools(endpoint)
    if (tools.length === 0) return { ok: false, message: `${name} connected but offers no tools.` }
    return { ok: true, message: `Connected to ${name}: ${tools.length} tool${tools.length === 1 ? '' : 's'} available.`, tools }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/401|403|unauthori[sz]ed|forbidden/i.test(msg)) return { ok: false, message: `${name} refused the credentials.` }
    if (/timed out/i.test(msg)) return { ok: false, message: `${name} did not answer within 12 seconds.` }
    return { ok: false, message: `Could not connect to ${name}'s MCP server.` }
  }
}

// ── Persistence ───────────────────────────────────────────────────────────

function toView(row: any): IntegrationView {
  const config = (row.config && typeof row.config === 'object' ? row.config : {}) as Record<string, any>
  return {
    slug: row.slug,
    provider: row.provider,
    mode: row.mode,
    label: row.label ?? null,
    status: row.status,
    lastTestedAt: row.lastTestedAt ?? null,
    lastError: row.lastError ?? null,
    tools: Array.isArray(row.tools) ? row.tools.map((t: any) => ({ name: t.name, description: t.description })) : [],
    enabled: row.enabled !== false,
    keyPreview: typeof config.keyPreview === 'string' ? config.keyPreview : null,
    mcpUrl: row.provider === 'custom-mcp' ? (config.mcpUrl ?? null) : null,
  }
}

export async function listIntegrations(userId: string): Promise<IntegrationView[]> {
  const rows = (await db.integration.findMany({ where: { userId } })) as any[]
  return rows.map(toView)
}

export interface ConnectInput {
  provider: string
  mode: IntegrationMode
  secret?: string
  /** Custom MCP only. */
  name?: string
  mcpUrl?: string
  headerName?: string
}

/**
 * Test first, store only on success. A key that fails its check is never
 * written anywhere, so a typo cannot leave a half-connected provider behind.
 */
export async function connectIntegration(userId: string, input: ConnectInput): Promise<{ ok: boolean; message: string; integration?: IntegrationView }> {
  const secret = (input.secret || '').trim()
  let slug: string
  let label: string | null = null
  let config: Record<string, unknown> = {}
  let result: TestResult

  if (input.provider === 'custom-mcp') {
    const name = (input.name || '').trim()
    const url = (input.mcpUrl || '').trim()
    if (!name) return { ok: false, message: 'Give this server a name.' }
    const urlError = validateCustomUrl(url)
    if (urlError) return { ok: false, message: urlError }
    slug = customSlug(name)
    label = name
    config = { mcpUrl: url, headerName: (input.headerName || '').trim() || 'Authorization' }
    result = await testMcp(customEndpoint(config, secret || null), name)
  } else {
    const p = getProvider(input.provider)
    if (!p) return { ok: false, message: 'Unknown provider.' }
    if (!secret) return { ok: false, message: `Paste your ${p.name} key first.` }
    if (input.mode === 'mcp' && !p.mcp) return { ok: false, message: `${p.name} has no MCP server; use an API key.` }
    if (input.mode === 'api_key' && !p.api) return { ok: false, message: `${p.name} connects through MCP only.` }
    slug = p.id
    label = p.name
    result = input.mode === 'mcp' ? await testProviderMcp(p, secret) : await testApiKey(p, secret)
  }

  if (!result.ok) return { ok: false, message: result.message }

  if (secret) {
    const stored = await setUserSecret(userId, vaultKey(slug), secret, `AdManager integration: ${label}`)
    if (!stored) return { ok: false, message: 'The key worked, but it could not be stored securely. Nothing was saved.' }
    config.keyPreview = secret.length > 8 ? `…${secret.slice(-4)}` : null
  }

  const data = {
    userId,
    slug,
    provider: input.provider,
    mode: input.provider === 'custom-mcp' ? 'mcp' : input.mode,
    label,
    config,
    secret: secret ? `${VAULT_SENTINEL}${vaultKey(slug)}` : null,
    status: 'connected',
    lastTestedAt: new Date().toISOString(),
    lastError: null,
    tools: result.tools || [],
    enabled: true,
  }
  const existing = (await db.integration.findUnique({ where: { userId, slug } })) as any
  const row = existing
    ? await db.integration.update({ where: { id: existing.id }, data })
    : await db.integration.create({ data })
  return { ok: true, message: result.message, integration: toView(row) }
}

async function loadSecret(userId: string, row: any): Promise<string | null> {
  if (!row.secret) return null
  return getUserSecret(vaultKey(row.slug), userId)
}

function endpointForRow(row: any, secret: string | null): McpEndpoint | null {
  if (row.mode !== 'mcp') return null
  if (row.provider === 'custom-mcp') return customEndpoint(row.config || {}, secret)
  const p = getProvider(row.provider)
  if (!p?.mcp || !secret) return null
  return mcpEndpointFor(p, secret)
}

/** Re-run the check with the stored secret and record the outcome. */
/**
 * Some MCP servers list their tools for any key and only reject it when a tool
 * runs (Tavily does). Catalog providers use one key for both paths, so check
 * the key against the API first; a listing alone is not proof.
 */
async function testProviderMcp(p: ProviderDef, secret: string): Promise<TestResult> {
  if (p.api) {
    const key = await testApiKey(p, secret)
    if (!key.ok) return key
  }
  return testMcp(mcpEndpointFor(p, secret), p.name)
}

export async function retestIntegration(userId: string, slug: string): Promise<TestResult> {
  const row = (await db.integration.findUnique({ where: { userId, slug } })) as any
  if (!row) return { ok: false, message: 'Not connected.' }
  const secret = await loadSecret(userId, row)
  let result: TestResult
  if (row.mode === 'mcp') {
    const endpoint = endpointForRow(row, secret)
    const p = getProvider(row.provider)
    result = !endpoint
      ? { ok: false, message: 'The stored key is missing. Reconnect.' }
      : p && secret
        ? await testProviderMcp(p, secret)
        : await testMcp(endpoint, row.label || row.provider)
  } else {
    const p = getProvider(row.provider)
    result = p && secret ? await testApiKey(p, secret) : { ok: false, message: 'The stored key is missing. Reconnect.' }
  }
  await db.integration.update({
    where: { id: row.id },
    data: {
      status: result.ok ? 'connected' : 'error',
      lastTestedAt: new Date().toISOString(),
      lastError: result.ok ? null : result.message,
      ...(result.tools ? { tools: result.tools } : {}),
    },
  })
  return result
}

export async function removeIntegration(userId: string, slug: string): Promise<void> {
  const row = (await db.integration.findUnique({ where: { userId, slug } })) as any
  if (!row) return
  await clearUserSecret(userId, vaultKey(slug))
  await db.integration.delete({ where: { id: row.id } })
}

// ── What the agents use ───────────────────────────────────────────────────

async function activeRows(userId: string): Promise<any[]> {
  const rows = (await db.integration.findMany({ where: { userId, status: 'connected' } })) as any[]
  return rows.filter((r) => r.enabled !== false)
}

/** A short block for the system prompt, so the agent knows what it can reach. */
export async function buildIntegrationsContext(userId: string): Promise<string> {
  let rows: any[] = []
  try {
    rows = await activeRows(userId)
  } catch {
    return ''
  }
  if (rows.length === 0) return ''
  const lines = rows.map((r) => {
    const p = getProvider(r.provider)
    const via = r.mode === 'mcp' ? `MCP, ${Array.isArray(r.tools) ? r.tools.length : 0} tools` : 'API key'
    return `- ${r.label || r.provider} [${r.slug}] (${p?.category ?? 'custom'}, ${via})`
  })
  return [
    'CONNECTED TOOLS (added by the business in Connections):',
    ...lines,
    'Use research_web for web and competitor research. Use list_connected_tools to see an MCP server\'s tools and call_connected_tool to run one; calls outside research need the owner\'s approval because they can spend the provider\'s credits.',
  ].join('\n')
}

export async function describeConnectedTools(userId: string, slug?: string): Promise<unknown> {
  const rows = await activeRows(userId)
  const picked = slug ? rows.filter((r) => r.slug === slug) : rows
  if (slug && picked.length === 0) return { error: `No connected integration "${slug}".` }
  return {
    integrations: picked.map((r) => ({
      slug: r.slug,
      name: r.label || r.provider,
      mode: r.mode,
      category: getProvider(r.provider)?.category ?? 'custom',
      tools: r.mode === 'mcp' && Array.isArray(r.tools) ? r.tools : [],
    })),
    available: PROVIDERS.filter((p) => !rows.some((r) => r.provider === p.id)).map((p) => p.name),
  }
}

export async function callConnectedTool(userId: string, slug: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const row = (await activeRows(userId)).find((r) => r.slug === slug)
  if (!row) return { error: `No connected integration "${slug}". Ask the owner to connect it under Connections.` }
  if (row.mode !== 'mcp') return { error: `${row.label || slug} is connected by API key; only MCP connections expose callable tools.` }
  const known = Array.isArray(row.tools) ? row.tools.map((t: any) => t.name) : []
  if (known.length && !known.includes(tool)) return { error: `"${tool}" is not one of ${row.label}'s tools: ${known.join(', ')}` }
  const endpoint = endpointForRow(row, await loadSecret(userId, row))
  if (!endpoint) return { error: 'The stored credentials are missing. Ask the owner to reconnect.' }
  try {
    return await callMcpTool(endpoint, tool, args)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Tool call failed' }
  }
}

// ── Research ──────────────────────────────────────────────────────────────

export interface ResearchHit {
  title: string
  url: string
  snippet: string
}

async function researchViaApi(provider: string, key: string, query: string, limit: number): Promise<{ answer?: string; results: ResearchHit[] }> {
  const json = { 'Content-Type': 'application/json' }
  if (provider === 'tavily') {
    const res = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { ...json, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: limit, search_depth: 'basic', include_answer: true }),
    })
    if (!res.ok) throw new Error(explainStatus(res.status, 'Tavily'))
    const data: any = await res.json()
    return {
      answer: data.answer || undefined,
      results: (data.results || []).map((r: any) => ({ title: r.title, url: r.url, snippet: String(r.content || '').slice(0, 600) })),
    }
  }
  if (provider === 'exa') {
    const res = await fetchWithTimeout('https://api.exa.ai/search', {
      method: 'POST',
      headers: { ...json, 'x-api-key': key },
      body: JSON.stringify({ query, numResults: limit, contents: { text: true } }),
    })
    if (!res.ok) throw new Error(explainStatus(res.status, 'Exa'))
    const data: any = await res.json()
    return { results: (data.results || []).map((r: any) => ({ title: r.title || r.url, url: r.url, snippet: String(r.text || '').slice(0, 600) })) }
  }
  if (provider === 'firecrawl') {
    const res = await fetchWithTimeout('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { ...json, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit }),
    })
    if (!res.ok) throw new Error(explainStatus(res.status, 'Firecrawl'))
    const data: any = await res.json()
    // v2 nests web results under data.web; v1 returned a flat array.
    const items: any[] = Array.isArray(data.data) ? data.data : data.data?.web || []
    return { results: items.map((r: any) => ({ title: r.title || r.url, url: r.url, snippet: String(r.description || r.markdown || '').slice(0, 600) })) }
  }
  throw new Error(`${provider} has no search API`)
}

const RESEARCH_API_ORDER = ['tavily', 'exa', 'firecrawl']

/**
 * Search the web with whatever research provider the business connected.
 * API connections first (predictable output), then any MCP server exposing a
 * search tool. Returns a plain error, not an exception, so the agent can tell
 * the owner what to connect.
 */
export async function researchWeb(userId: string, query: string, limit = 5): Promise<unknown> {
  const q = query.trim()
  if (!q) return { error: 'Empty query.' }
  const n = Math.min(Math.max(Math.round(limit) || 5, 1), 10)
  const rows = await activeRows(userId)
  const failures: string[] = []

  for (const id of RESEARCH_API_ORDER) {
    const row = rows.find((r) => r.provider === id && r.mode === 'api_key')
    if (!row) continue
    const key = await loadSecret(userId, row)
    if (!key) continue
    try {
      return { via: row.label, ...(await researchViaApi(id, key, q, n)) }
    } catch (err) {
      failures.push(`${row.label}: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }

  const mcpRows = rows.filter((r) => r.mode === 'mcp' && (getProvider(r.provider)?.category === 'research' || r.provider === 'custom-mcp'))
  for (const row of mcpRows) {
    const tools: any[] = Array.isArray(row.tools) ? row.tools : []
    // A search tool whose only required input is the query.
    const tool = tools.find((t) => /search/i.test(t.name) && (t.required || []).every((r: string) => r === 'query'))
    if (!tool) continue
    const endpoint = endpointForRow(row, await loadSecret(userId, row))
    if (!endpoint) continue
    try {
      const out: any = await callMcpTool(endpoint, tool.name, { query: q })
      if (out?.isError) throw new Error(out.text || 'tool error')
      return { via: `${row.label} (MCP: ${tool.name})`, text: out.text, structured: out.structured }
    } catch (err) {
      failures.push(`${row.label}: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }

  if (failures.length) return { error: `Every connected research tool failed. ${failures.join(' | ')}` }
  return {
    error: 'No research tool is connected. Ask the owner to connect Tavily, Exa or Firecrawl under Setup → Connections.',
    needsConnection: true,
  }
}
