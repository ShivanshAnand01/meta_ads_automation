import { requireUserId, handleError } from '@/lib/supabase/server'
import { getScopedSupabase } from '@/lib/db/supabase-db'

/**
 * The owner corrects the AI: "forget this" (dismissed — it stays out of every
 * prompt and is never revived by repetition) or "keep this" (active again).
 */

export async function PATCH(request: Request, ctx: RouteContext<'/api/learnings/[id]'>) {
  try {
    const userId = await requireUserId()
    const { id } = await ctx.params
    const { status } = (await request.json().catch(() => ({}))) as { status?: string }
    if (status !== 'dismissed' && status !== 'active') {
      return Response.json({ error: 'status must be "dismissed" or "active"' }, { status: 400 })
    }
    const supabase = await getScopedSupabase()
    const { data, error } = await supabase
      .from('ai_learnings')
      .update({ status, resolved_at: null })
      .eq('id', id).eq('user_id', userId).neq('kind', 'platform_suggestion')
      .select('id, status')
    if (error) throw new Error(error.message)
    if (!data?.length) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ learning: data[0] })
  } catch (error) {
    return handleError(error, 'Failed to update the learning')
  }
}
