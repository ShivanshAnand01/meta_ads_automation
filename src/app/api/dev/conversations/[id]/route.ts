import { createSupabaseServiceClient, handleError } from '@/lib/supabase/server'
import { developerOrResponse } from '@/lib/developer'
import { redactSecrets, redactSecretText } from '@/lib/redact'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Developer console: read one conversation (chat or autonomous routine) as it
 * happened — user and assistant messages, and which tools ran. Read-only.
 */

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: RouteContext<'/api/dev/conversations/[id]'>) {
  try {
    const dev = await developerOrResponse()
    if (dev instanceof Response) return dev
    const { id } = await ctx.params

    const supabase = createSupabaseServiceClient()
    const [{ data: conv }, { data: messages }] = await Promise.all([
      supabase.from('ai_conversations').select('id, user_id, title, autonomous, created_at').eq('id', id).maybeSingle(),
      supabase.from('ai_messages').select('role, content, tool_name, tool_calls, created_at').eq('conversation_id', id).order('created_at', { ascending: true }).limit(400),
    ])
    if (!conv) return Response.json({ error: 'No such conversation' }, { status: 404 })

    return Response.json({
      conversation: conv,
      messages: ((messages ?? []) as any[]).map((m) => {
        let tools: string[] = []
        if (m.tool_calls) {
          try { tools = (JSON.parse(m.tool_calls) as Array<{ name: string }>).map((t) => t.name) } catch {}
        }
        // Tool results can be long and may carry credentials; show the name
        // and a redacted preview only.
        let content = String(m.content ?? '')
        if (m.role === 'tool') {
          try { content = JSON.stringify(redactSecrets(JSON.parse(content))) } catch {}
          if (content.length > 600) content = `${content.slice(0, 600)}…`
        }
        return { role: m.role, content: redactSecretText(content), toolName: m.tool_name ?? null, tools, at: m.created_at }
      }),
    })
  } catch (error) {
    return handleError(error, 'Failed to load the conversation')
  }
}
