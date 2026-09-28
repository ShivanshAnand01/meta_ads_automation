import { getSessionUser } from '@/lib/supabase/server'
import { isDeveloperEmail } from '@/lib/developer'

/** Whether the signed-in user is the developer — decides if the sidebar shows the Developer section. */

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser().catch(() => null)
  return Response.json({ developer: isDeveloperEmail(user?.email) })
}
