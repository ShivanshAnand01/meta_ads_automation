import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

/**
 * A short-lived client for a remote MCP server: connect, do one thing, close.
 *
 * Remote servers speak Streamable HTTP today; a few older ones only speak SSE,
 * so we try Streamable first and fall back. Every call is bounded by a timeout
 * so a slow third party can never hang an agent run or an API request.
 */

export interface McpEndpoint {
  url: string
  headers: Record<string, string>
}

export interface McpToolSummary {
  name: string
  description?: string
  required: string[]
}

const CONNECT_TIMEOUT_MS = 12_000
const CALL_TIMEOUT_MS = 60_000

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

async function open(endpoint: McpEndpoint): Promise<Client> {
  const url = new URL(endpoint.url)
  const requestInit = { headers: endpoint.headers }
  const client = new Client({ name: 'admanager', version: '1.0.0' })
  try {
    await withTimeout(client.connect(new StreamableHTTPClientTransport(url, { requestInit })), CONNECT_TIMEOUT_MS, 'Connecting')
    return client
  } catch (streamErr) {
    const legacy = new Client({ name: 'admanager', version: '1.0.0' })
    try {
      await withTimeout(legacy.connect(new SSEClientTransport(url, { requestInit })), CONNECT_TIMEOUT_MS, 'Connecting')
      return legacy
    } catch {
      throw streamErr instanceof Error ? streamErr : new Error('Could not connect to the MCP server')
    }
  }
}

async function using<T>(endpoint: McpEndpoint, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await open(endpoint)
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
  }
}

export async function listMcpTools(endpoint: McpEndpoint): Promise<McpToolSummary[]> {
  return using(endpoint, async (c) => {
    const res = await withTimeout(c.listTools(), CONNECT_TIMEOUT_MS, 'Listing tools')
    return (res.tools || []).map((t) => ({
      name: t.name,
      description: t.description?.slice(0, 300),
      required: Array.isArray(t.inputSchema?.required) ? (t.inputSchema.required as string[]) : [],
    }))
  })
}

export async function callMcpTool(endpoint: McpEndpoint, name: string, args: Record<string, unknown>): Promise<unknown> {
  return using(endpoint, async (c) => {
    const res = await withTimeout(c.callTool({ name, arguments: args }), CALL_TIMEOUT_MS, `Tool "${name}"`)
    // Flatten MCP content blocks into something an LLM can read directly.
    const blocks = Array.isArray((res as { content?: unknown[] }).content) ? (res as { content: unknown[] }).content : []
    const text = blocks
      .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('\n')
    return {
      isError: Boolean((res as { isError?: boolean }).isError),
      text: text.length > 12_000 ? `${text.slice(0, 12_000)}\n…[truncated]` : text,
      structured: (res as { structuredContent?: unknown }).structuredContent ?? null,
    }
  })
}
