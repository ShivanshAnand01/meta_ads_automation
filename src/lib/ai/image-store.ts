import { getScopedSupabase } from '@/lib/db/supabase-db'
import { createSupabaseServiceClient, hasServiceRoleKey } from '@/lib/supabase/server'
import { saveImageToStorage } from './image-generator'

/**
 * Save a freshly generated image to the owner's storage folder and return a
 * signed URL. Works with or without a browser session: the scoped client is
 * tried first, then the service role writing to the same user's folder.
 *
 * Returns null rather than the raw image when saving fails. A multi-megabyte
 * base64 data URL must never reach the database, a tool result (it would be
 * sent back to the model as tokens), or the browser.
 */
export async function persistGeneratedImage(image: string, userId: string): Promise<{ url: string; path: string } | null> {
  if (!image) return null
  try {
    const saved = await saveImageToStorage(image, userId, (await getScopedSupabase()) as never)
    if (saved?.url) return saved
  } catch {
    // No request scope (cron, scripts): fall through to the service role.
  }
  if (!hasServiceRoleKey()) return null
  try {
    const saved = await saveImageToStorage(image, userId, createSupabaseServiceClient() as never)
    return saved?.url ? saved : null
  } catch {
    return null
  }
}
