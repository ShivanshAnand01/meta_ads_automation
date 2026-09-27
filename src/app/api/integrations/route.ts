import { requireUserId, handleError } from '@/lib/supabase/server'
import { listIntegrations, connectIntegration } from '@/lib/integrations/server'
import type { IntegrationMode } from '@/lib/integrations/catalog'

/**
 * Third-party connections. GET lists what this business has connected;
 * POST tests a key or MCP server and stores it only if the test passes.
 * Secrets go to Vault and are never returned.
 */
export async function GET() {
  try {
    const userId = await requireUserId()
    return Response.json({ integrations: await listIntegrations(userId) })
  } catch (error) {
    return handleError(error, 'Failed to load connections')
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = (await request.json()) as Record<string, unknown>
    const mode: IntegrationMode = body.mode === 'mcp' ? 'mcp' : 'api_key'
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
    const result = await connectIntegration(userId, {
      provider: String(body.provider || ''),
      mode,
      secret: str(body.secret),
      name: str(body.name),
      mcpUrl: str(body.mcpUrl),
      headerName: str(body.headerName),
    })
    return Response.json(result, { status: result.ok ? 200 : 400 })
  } catch (error) {
    return handleError(error, 'Failed to connect')
  }
}
