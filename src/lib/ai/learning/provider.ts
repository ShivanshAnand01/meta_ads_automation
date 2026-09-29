import { db } from '@/lib/db/supabase-db'
import { resolveSecrets, SECRET_KEYS } from '@/lib/secrets'
import { createAIProvider } from '@/lib/ai/factory'
import { modelForTier } from '@/lib/ai/model-catalog'
import type { AIProvider, AIProviderType } from '@/lib/ai/types'
import type { MeteredUsage } from '@/lib/ai/usage'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The model background learning runs on: the business's own key, on the
 * provider's economy model, metered under a learning:* source so its cost is
 * visible on the running-cost page. Null when the business has no AI set up.
 */
export async function learningProvider(
  userId: string,
  source: string,
  onUsage?: (u: MeteredUsage) => void,
): Promise<{ provider: AIProvider; model: string } | null> {
  let settings = (await db.aiSettings.findUnique({ where: { userId } }).catch(() => null)) as any
  if (!settings) return null
  settings = await resolveSecrets(settings, [{ column: 'apiKey', vaultKey: SECRET_KEYS.aiApiKey }])
  if (!settings.apiKey && settings.provider !== 'ollama') return null
  const model = modelForTier(settings.provider, settings.model, 'economy')
  const provider = createAIProvider(
    settings.provider as AIProviderType,
    { apiKey: settings.apiKey || undefined, model, baseUrl: settings.baseUrl || undefined },
    { userId, source, onUsage },
  )
  return { provider, model }
}
