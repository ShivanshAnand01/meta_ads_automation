import { getMCPClient } from '@/lib/meta/mcp-client'
import { requireUserId } from '@/lib/supabase/server'

export async function GET() {
  try {
    const userId = await requireUserId()
    const mcp = await getMCPClient(userId)
    const tools = await mcp.listTools()
    return Response.json({ tools })
  } catch (error) {
    console.error('MCP list tools error:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to list MCP tools' },
      { status: 500 }
    )
  }
}
