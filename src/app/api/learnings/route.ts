import { requireUserId, handleError } from '@/lib/supabase/server'
import { listLearnings } from '@/lib/ai/learning/store'

/**
 * What the AI has learned about this business, for the owner to read and
 * correct. Platform suggestions are the developer's, so they are left out.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userId = await requireUserId()
    const all = (await listLearnings(userId, { limit: 300 })).filter((l) => l.kind !== 'platform_suggestion')
    const fortnight = Date.now() - 14 * 86_400_000
    return Response.json({
      learnings: all.filter((l) =>
        l.status === 'active' ||
        l.status === 'dismissed' ||
        (l.status === 'resolved' && l.kind === 'pitfall' && l.resolvedAt && new Date(l.resolvedAt).getTime() > fortnight)),
    })
  } catch (error) {
    return handleError(error, 'Failed to load learnings')
  }
}
