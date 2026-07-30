import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { normalizeAdAccountId } from '@/lib/meta/user-client'

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/meta/accounts/[id]'>
) {
  try {
    const { id } = await ctx.params
    const body = await request.json().catch(() => ({}))
    const { name, status, currency } = body as {
      name?: string
      status?: string
      currency?: string
    }

    const userId = await requireUserId()

    const conn = await db.metaConnection.findUnique({ where: { userId } })
    if (!conn) {
      return Response.json(
        { error: 'Not connected to Meta' },
        { status: 400 }
      )
    }

    const updated = await db.metaConnection.update({
      where: { userId },
      data: {
        adAccountId: normalizeAdAccountId(id) || null,
        adAccountName: name,
        adAccountStatus: status,
        adAccountCurrency: currency,
      },
    })

    return Response.json({ success: true, connection: updated })
  } catch (error) {
    return handleError(error, 'Failed to set ad account')
  }
}
