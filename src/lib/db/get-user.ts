import { requireUserId } from '@/lib/supabase/server'

export async function getDefaultUserId(): Promise<string> {
  return requireUserId()
}
