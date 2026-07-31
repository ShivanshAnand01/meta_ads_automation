import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'
import { getMetaConnection } from '@/lib/meta/user-client'

/* eslint-disable @typescript-eslint/no-explicit-any */

class MCPClientManager {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private credentialsKey: string | null = null
  private connecting: Promise<Client> | null = null

  private getServerPath(): string {
    return path.join(process.cwd(), 'node_modules', 'meta-ads-mcp', 'build', 'index.js')
  }

  async connect(credentials: {
    accessToken: string
    appId?: string
    appSecret?: string
  }): Promise<Client> {
    const key = `${credentials.accessToken}:${credentials.appId || ''}`
    if (this.client && this.credentialsKey === key) {
      return this.client
    }

    if (this.connecting) {
      return this.connecting
    }

    this.connecting = this._doConnect(credentials)
    try {
      const result = await this.connecting
      return result
    } finally {
      this.connecting = null
    }
  }

  private async _doConnect(credentials: {
    accessToken: string
    appId?: string
    appSecret?: string
  }): Promise<Client> {
    await this.disconnect()

    const env: Record<string, string> = {
      META_ACCESS_TOKEN: credentials.accessToken,
    }
    if (credentials.appId) env.META_APP_ID = credentials.appId
    if (credentials.appSecret) env.META_APP_SECRET = credentials.appSecret

    this.transport = new StdioClientTransport({
      command: 'node',
      args: [this.getServerPath()],
      env,
      stderr: 'pipe',
    })

    this.client = new Client(
      { name: 'admanager-mcp-client', version: '1.0.0' },
      { capabilities: {} }
    )

    await this.client.connect(this.transport)
    this.credentialsKey = `${credentials.accessToken}:${credentials.appId || ''}`

    return this.client
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close()
      } catch {}
    }
    this.client = null
    this.transport = null
    this.credentialsKey = null
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.client) throw new Error('MCP client not connected')

    const result = await this.client.callTool({ name, arguments: args })
    const content = result.content as Array<{ type: string; text: string }>

    if (result.isError) {
      throw new Error(content?.[0]?.text || 'MCP tool call failed')
    }

    const text = content?.[0]?.text
    if (!text) return null

    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  async listTools() {
    if (!this.client) throw new Error('MCP client not connected')
    return this.client.listTools()
  }

  isConnected(): boolean {
    return this.client !== null
  }
}

const globalForMCP = globalThis as unknown as {
  mcpClient: MCPClientManager | undefined
}

export const mcpClient = globalForMCP.mcpClient ?? new MCPClientManager()
if (process.env.NODE_ENV !== 'production') globalForMCP.mcpClient = mcpClient

/**
 * Get or create an MCP client connection for a specific user.
 * Reads the user's Meta credentials from the database and connects (or
 * reuses an existing connection if the credentials match).
 *
 * In serverless / production environments where a long-lived Node process
 * isn't guaranteed, this will still work — the connect call is fast and
 * the global singleton persists for the lifetime of the function instance.
 *
 * @param userId The authenticated user's ID
 */
export async function getMCPClient(userId: string): Promise<MCPClientManager> {
  if (!userId) {
    throw new Error('User ID is required to connect to Meta.')
  }

  const conn = await getMetaConnection(userId)
  if (!conn) {
    throw new Error('Not connected to Meta. Please connect your Meta Ads account first.')
  }

  await mcpClient.connect({
    accessToken: conn.accessToken,
    appId: conn.appId,
    appSecret: conn.appSecret,
  })

  return mcpClient
}
