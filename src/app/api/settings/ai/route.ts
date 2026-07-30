import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { storeSecret, SECRET_KEYS } from '@/lib/secrets'

/* eslint-disable @typescript-eslint/no-explicit-any */

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  anthropic: 'claude-sonnet-4-5-20250514',
  ollama: 'llama3',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
}

export async function GET() {
  try {
    const userId = await requireUserId()

    const settings = (await db.aiSettings.findUnique({ where: { userId } })) as
      | { id: string; provider: string; model: string; baseUrl: string | null; apiKey: string | null; embeddingKey?: string | null; whisperKey?: string | null; ttsKey?: string | null }
      | null

    if (!settings) {
      return Response.json({ configured: false, settings: null })
    }

    return Response.json({
      configured: true,
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl,
      // Masked for display, plus a boolean "has key" flag so the UI can show
      // "configured" without ever pre-filling a value the user might save back.
      apiKey: maskSecret(settings.apiKey),
      hasApiKey: Boolean(settings.apiKey),
      embeddingKey: maskSecret(settings.embeddingKey),
      hasEmbeddingKey: Boolean(settings.embeddingKey),
      whisperKey: maskSecret(settings.whisperKey),
      hasWhisperKey: Boolean(settings.whisperKey),
      ttsKey: maskSecret(settings.ttsKey),
      hasTtsKey: Boolean(settings.ttsKey),
    })
  } catch (error) {
    console.error('Fetch AI settings error:', error)
    return handleError(error, 'Failed to fetch AI settings')
  }
}

function maskSecret(v: string | null | undefined): string | null {
  if (!v) return null
  if (v.startsWith('vault:')) return '•••••••••• (Vault)'
  return `${v.slice(0, 3)}••••••••${v.slice(-4)}`
}

/**
 * Resolve a secret value sent from the client.
 * Returns undefined when the value is absent, blank, or a masked placeholder —
 * meaning "keep the existing stored value, do not overwrite or clear it".
 * Only a real new value is returned for storage.
 */
function resolveKey(v: string | undefined | null): string | undefined {
  if (v === undefined || v === null) return undefined
  if (v === '' || v.includes('••••')) return undefined
  return v
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()

    const { provider, apiKey, model, baseUrl, embeddingKey, whisperKey, ttsKey } = body as {
      provider?: string
      apiKey?: string
      model?: string
      baseUrl?: string
      embeddingKey?: string
      whisperKey?: string
      ttsKey?: string
    }

    // Provider is optional: fall back to the existing provider so the AI Manager
    // can save just the model without sending credentials.
    const existing = (await db.aiSettings.findUnique({ where: { userId } })) as any
    const resolvedProvider = provider || existing?.provider || 'ollama'
    const providerDefault = PROVIDER_DEFAULT_MODEL[resolvedProvider] || 'llama3'
    const resolvedModel = model ?? existing?.model ?? providerDefault

    // Only store secrets when a real new value is provided. Masked/blank values
    // are skipped so existing keys are never corrupted or cleared by accident.
    const akResolved = resolveKey(apiKey)
    const ekResolved = resolveKey(embeddingKey)
    const wkResolved = resolveKey(whisperKey)
    const tkResolved = resolveKey(ttsKey)

    // Compute each stored column value ONCE. storeSecret() writes to Vault (or
    // returns the plaintext fallback), so calling it twice for the same key —
    // once for the update branch and once for the create branch — causes
    // redundant Vault RPCs, wasted work, and potential race conditions. We
    // resolve the column value a single time and reuse it for both paths.
    const storedApiKey    = akResolved !== undefined ? await storeSecret(userId, SECRET_KEYS.aiApiKey,       akResolved, 'AI provider API key') : undefined
    const storedEmbedding = ekResolved !== undefined ? await storeSecret(userId, SECRET_KEYS.aiEmbeddingKey,  ekResolved, 'Embeddings API key')  : undefined
    const storedWhisper   = wkResolved !== undefined ? await storeSecret(userId, SECRET_KEYS.aiWhisperKey,    wkResolved, 'Whisper API key')     : undefined
    const storedTts       = tkResolved !== undefined ? await storeSecret(userId, SECRET_KEYS.aiTtsKey,         tkResolved, 'TTS API key')         : undefined

    const updateData: Record<string, unknown> = {
      provider: resolvedProvider,
      model: resolvedModel,
    }
    if (baseUrl !== undefined) updateData.baseUrl = baseUrl || null
    if (storedApiKey    !== undefined) updateData.apiKey       = storedApiKey
    if (storedEmbedding !== undefined) updateData.embeddingKey = storedEmbedding
    if (storedWhisper   !== undefined) updateData.whisperKey  = storedWhisper
    if (storedTts       !== undefined) updateData.ttsKey       = storedTts

    // For the create path (first-time setup), reuse the SAME resolved column
    // values. When no key was provided, fall back to null so the column is
    // empty rather than storing an accidental sentinel.
    const settings = (await db.aiSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        provider: resolvedProvider,
        apiKey:       storedApiKey    ?? null,
        embeddingKey: storedEmbedding ?? null,
        whisperKey:   storedWhisper   ?? null,
        ttsKey:       storedTts       ?? null,
        model: resolvedModel,
        baseUrl: baseUrl ?? null,
      },
    })) as { id: string; provider: string; model: string; baseUrl: string | null; apiKey: string | null; embeddingKey?: string | null; whisperKey?: string | null; ttsKey?: string | null }

    return Response.json({
      success: true,
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKey: maskSecret(settings.apiKey),
      hasApiKey: Boolean(settings.apiKey),
      embeddingKey: maskSecret(settings.embeddingKey),
      hasEmbeddingKey: Boolean(settings.embeddingKey),
    })
  } catch (error) {
    console.error('Update AI settings error:', error)
    return handleError(error, 'Failed to update AI settings')
  }
}
