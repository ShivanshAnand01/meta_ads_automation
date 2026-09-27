import { requireUserId, handleError } from '@/lib/supabase/server'
import { retestIntegration, removeIntegration } from '@/lib/integrations/server'

/** POST re-tests a stored connection; DELETE removes it and its Vault secret. */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const userId = await requireUserId()
    const { slug } = await params
    const result = await retestIntegration(userId, slug)
    return Response.json(result, { status: result.ok ? 200 : 400 })
  } catch (error) {
    return handleError(error, 'Failed to test the connection')
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const userId = await requireUserId()
    const { slug } = await params
    await removeIntegration(userId, slug)
    return Response.json({ ok: true })
  } catch (error) {
    return handleError(error, 'Failed to disconnect')
  }
}
