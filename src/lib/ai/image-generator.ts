import type { AIProviderType } from './types'

export interface ImageGenResult {
  success: boolean
  imageUrl: string
  provider: string
  error?: string
  promptUsed?: string
  aspectRatio?: AspectRatio
  width?: number
  height?: number
}

export type AspectRatio = '1:1' | '4:5' | '9:16' | '1.91:1' | '16:9'

export interface ImageGenOptions {
  size?: string
  style?: string
  quality?: 'standard' | 'hd'
  aspectRatio?: AspectRatio
  brandColors?: string[]
  negativePrompt?: string
  model?: string
  count?: number
  /** Overall wall-clock budget. Kept under the route's maxDuration. */
  timeoutMs?: number
}

/**
 * Meta's recommended pixel dimensions per placement.
 *   1:1     feed, square
 *   4:5     feed, portrait — the highest-performing feed ratio on mobile
 *   9:16    Stories / Reels
 *   1.91:1  link ad, landscape
 *   16:9    landscape video/image
 */
export const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, { w: number; h: number }> = {
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
  '9:16': { w: 1080, h: 1920 },
  '1.91:1': { w: 1200, h: 628 },
  '16:9': { w: 1920, h: 1080 },
}

/** The placement set a single ad actually needs to cover feed + stories. */
export const META_PLACEMENT_SET: AspectRatio[] = ['1:1', '4:5', '9:16']

const GPT_IMAGE_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536'])

const POLLINATIONS_MODELS = ['flux', 'turbo'] as const
type PollinationsModel = (typeof POLLINATIONS_MODELS)[number]

/**
 * Per-attempt timeout. The old code allowed 90s per provider across a 3-link
 * fallback chain — 270s worst case, on a function that is killed at 60s. So
 * generation timed out before it could ever fail over.
 */
const PROVIDER_TIMEOUT_MS = 22_000
const DEFAULT_TOTAL_BUDGET_MS = 50_000

function resolveDimensions(options?: ImageGenOptions): { w: number; h: number } {
  if (options?.aspectRatio && ASPECT_RATIO_DIMENSIONS[options.aspectRatio]) {
    return ASPECT_RATIO_DIMENSIONS[options.aspectRatio]
  }
  const size = options?.size || '1024x1024'
  const [w, h] = size.split('x').map(Number)
  return { w: w || 1024, h: h || 1024 }
}

/**
 * Map an aspect ratio to the nearest size gpt-image-1 supports.
 *
 * Portrait ratios map to the PORTRAIT size and landscape ratios to the
 * LANDSCAPE size. The previous mapping had these inverted — 4:5 (portrait)
 * produced a landscape image and 1.91:1 (landscape) produced a portrait one,
 * so every feed-portrait and link ad came out the wrong shape and was cropped
 * by Meta.
 */
export function resolveGptImageSize(options?: ImageGenOptions): string {
  if (options?.aspectRatio) {
    switch (options.aspectRatio) {
      case '1:1':
        return '1024x1024'
      case '4:5': // portrait
      case '9:16': // portrait
        return '1024x1536'
      case '1.91:1': // landscape
      case '16:9': // landscape
        return '1536x1024'
    }
  }
  const size = options?.size || '1024x1024'
  if (size === '1792x1024') return '1536x1024'
  if (size === '1024x1792') return '1024x1536'
  return GPT_IMAGE_SIZES.has(size) ? size : '1024x1024'
}

/**
 * Build the image prompt.
 *
 * Text is deliberately excluded from the generated image: diffusion models
 * cannot render legible Devanagari, and a garbled Marathi headline baked into
 * the pixels is unusable and un-editable. Copy is composited over the image
 * afterwards as real text.
 */
function buildEnhancedPrompt(prompt: string, options?: ImageGenOptions): string {
  const parts: string[] = [prompt]

  parts.push(
    'Professional digital marketing ad creative for Facebook/Instagram Meta Ads. ' +
      'High quality, clean modern composition with clear negative space in the upper third for a headline overlay, ' +
      'vibrant colours, sharp focus, suitable for an Indian / Maharashtrian audience. ' +
      'Commercial advertising photography style.',
  )

  parts.push(
    'IMPORTANT: absolutely no text, no letters, no words, no numbers, no captions, no watermarks and no logos ' +
      'anywhere in the image. The image must be purely visual.',
  )

  if (options?.brandColors?.length) {
    parts.push(`Brand colour palette: ${options.brandColors.join(', ')}. Build the composition around these colours.`)
  }

  parts.push(
    options?.style === 'natural'
      ? 'Natural, realistic photographic style.'
      : 'Vivid, eye-catching, high-contrast advertising style.',
  )

  if (options?.negativePrompt) parts.push(`AVOID: ${options.negativePrompt}`)

  return parts.join(' ')
}

async function generateViaGptImage(
  apiKey: string,
  prompt: string,
  options: ImageGenOptions | undefined,
  signal: AbortSignal,
): Promise<ImageGenResult> {
  const enhancedPrompt = buildEnhancedPrompt(prompt, options)
  const size = resolveGptImageSize(options)
  const qualityMap: Record<string, 'low' | 'medium' | 'high'> = { standard: 'medium', hd: 'high' }
  const quality = (options?.quality ? qualityMap[options.quality] : 'high') as 'low' | 'medium' | 'high'

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: enhancedPrompt,
      n: 1,
      size,
      quality,
      output_format: 'png',
    }),
    signal,
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`GPT image error ${response.status}: ${errText.slice(0, 200)}`)
  }

  const data = await response.json()
  const b64 = data.data?.[0]?.b64_json
  if (!b64) throw new Error('GPT image returned no image data')

  const [w, h] = size.split('x').map(Number)
  return {
    success: true,
    imageUrl: `data:image/png;base64,${b64}`,
    provider: 'gpt-image-1',
    promptUsed: enhancedPrompt,
    aspectRatio: options?.aspectRatio,
    width: w,
    height: h,
  }
}

/**
 * Free fallback. Useful for development and as a last resort, but it is an
 * unauthenticated public service with no SLA, no content moderation and no
 * commercial licensing — see the note in generateAdImage before relying on it
 * for client work.
 */
async function generateViaPollinations(
  prompt: string,
  options: ImageGenOptions | undefined,
  model: PollinationsModel,
  seed: number,
  signal: AbortSignal,
): Promise<ImageGenResult> {
  const enhancedPrompt = buildEnhancedPrompt(prompt, options)
  const { w, h } = resolveDimensions(options)
  const encoded = encodeURIComponent(enhancedPrompt.slice(0, 1200))
  const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${model}`

  const res = await fetch(imageUrl, { signal })
  const contentType = res.headers.get('content-type') || ''
  if (res.ok && contentType.startsWith('image/')) {
    return {
      success: true,
      imageUrl,
      provider: `pollinations-${model}`,
      promptUsed: enhancedPrompt,
      aspectRatio: options?.aspectRatio,
      width: w,
      height: h,
    }
  }
  throw new Error(`Pollinations ${model} returned ${res.status} (${contentType || 'no content-type'})`)
}

/** Run one provider attempt under both a per-attempt and a total deadline. */
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, budgetMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(PROVIDER_TIMEOUT_MS, budgetMs))
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Generate an ad creative image, falling through a provider chain:
 *   1. gpt-image-1 — production quality, needs an OpenAI key
 *   2. Pollinations flux / turbo — free, no key, development-grade only
 *
 * PRODUCTION NOTE: Pollinations is an unauthenticated free service with no
 * SLA, no moderation and no commercial licence or indemnity, and the prompt is
 * embedded in a publicly reachable URL. Set `IMAGE_FALLBACK_ENABLED=false` to
 * turn the fallback off for client accounts and surface a clear error instead
 * of quietly shipping a lower-provenance image into a paid ad.
 */
export async function generateAdImage(
  _providerType: AIProviderType,
  apiKey: string | null | undefined,
  prompt: string,
  options?: ImageGenOptions,
): Promise<ImageGenResult> {
  const errors: string[] = []
  const deadline = Date.now() + (options?.timeoutMs ?? DEFAULT_TOTAL_BUDGET_MS)
  const remaining = () => deadline - Date.now()

  if (apiKey) {
    try {
      return await withTimeout((signal) => generateViaGptImage(apiKey, prompt, options, signal), remaining())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'GPT image failed'
      errors.push(message)
      console.warn('[image] gpt-image-1 failed, falling back:', message)
    }
  } else {
    errors.push('No OpenAI API key configured for image generation')
  }

  const fallbackEnabled = process.env.IMAGE_FALLBACK_ENABLED !== 'false'
  if (!fallbackEnabled) {
    return {
      success: false,
      imageUrl: '',
      provider: 'none',
      error: `Image generation failed and the free fallback is disabled for this account: ${errors.join(' | ')}`,
    }
  }

  for (const model of POLLINATIONS_MODELS) {
    if (remaining() < 5_000) {
      errors.push('Ran out of time before trying the remaining image providers')
      break
    }
    try {
      const seed = Math.floor(Math.random() * 1_000_000)
      return await withTimeout((signal) => generateViaPollinations(prompt, options, model, seed, signal), remaining())
    } catch (err) {
      const message = err instanceof Error ? (err.name === 'AbortError' ? `${model} timed out` : err.message) : `${model} failed`
      errors.push(message)
      console.warn(`[image] pollinations ${model} failed:`, message)
    }
  }

  return {
    success: false,
    imageUrl: '',
    provider: 'none',
    error: `All image providers failed: ${errors.join(' | ')}`,
  }
}

/**
 * Generate the same creative concept at every ratio an ad needs (feed square,
 * feed portrait, story). Running them concurrently keeps the whole set inside
 * one function invocation instead of three sequential timeouts.
 */
export async function generatePlacementSet(
  providerType: AIProviderType,
  apiKey: string | null | undefined,
  prompt: string,
  ratios: AspectRatio[] = META_PLACEMENT_SET,
  options?: ImageGenOptions,
): Promise<Record<string, ImageGenResult>> {
  const entries = await Promise.all(
    ratios.map(async (aspectRatio) => {
      const result = await generateAdImage(providerType, apiKey, prompt, { ...options, aspectRatio })
      return [aspectRatio, result] as const
    }),
  )
  return Object.fromEntries(entries)
}

/**
 * Distinct creative variations for A/B testing.
 *
 * Each variation gets a different visual angle appended to the prompt. The old
 * implementation re-ran the identical prompt N times, which for gpt-image-1
 * (no seed control) meant paying N times for near-duplicates.
 */
const VARIATION_ANGLES = [
  'hero product shot, centred composition, studio lighting',
  'lifestyle scene showing the product in everyday use',
  'close-up detail shot with shallow depth of field',
  'flat-lay overhead composition on a clean surface',
  'aspirational outcome scene showing the result of using the product',
]

export async function generateImageVariations(
  providerType: AIProviderType,
  apiKey: string | null | undefined,
  prompt: string,
  count: number,
  options?: ImageGenOptions,
): Promise<ImageGenResult[]> {
  const n = Math.max(1, Math.min(count, VARIATION_ANGLES.length))
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      generateAdImage(providerType, apiKey, `${prompt}. Visual treatment: ${VARIATION_ANGLES[i]}`, options),
    ),
  )
}

type StorageLike = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Blob,
        options?: Record<string, unknown>,
      ) => Promise<{ data: { path: string } | null; error: { message: string } | null }>
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
      getPublicUrl: (path: string) => { data: { publicUrl: string } }
    }
  }
}

/**
 * Persist a generated image to Supabase storage.
 *
 * Returns a long-lived signed URL rather than a public one: the bucket holds
 * the client's unreleased ad creative, and a public URL is readable by anyone
 * who ever sees it, forever.
 */
export async function saveImageToStorage(
  imageUrl: string,
  userId: string,
  supabase: StorageLike,
  opts?: { signedUrlTtlSeconds?: number },
): Promise<{ url: string; path: string } | null> {
  try {
    let blob: Blob
    let contentType: string

    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:(image\/[\w+]+);base64,(.+)$/)
      if (!match) {
        console.error('[image] invalid data URL format')
        return null
      }
      contentType = match[1]
      const binary = atob(match[2])
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      blob = new Blob([bytes], { type: contentType })
    } else {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      let res: Response
      try {
        res = await fetch(imageUrl, { signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }
      if (!res.ok) {
        console.error('[image] fetch failed:', res.status, res.statusText)
        return null
      }
      contentType = res.headers.get('content-type') || ''
      if (!contentType.startsWith('image/')) {
        console.error('[image] non-image content-type:', contentType)
        return null
      }
      blob = await res.blob()
    }

    if (blob.size < 1000) {
      console.error('[image] blob too small, likely an error response:', blob.size)
      return null
    }

    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png'
    const fileName = `ad-creative-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const filePath = `${userId}/${fileName}`

    const bucket = supabase.storage.from('ad-creative-images')
    const { data, error } = await bucket.upload(filePath, blob, { contentType, cacheControl: '3600' })
    if (error) {
      console.error('[image] storage save error:', error)
      return null
    }

    const path = data?.path || filePath
    const ttl = opts?.signedUrlTtlSeconds ?? 60 * 60 * 24 * 365

    const { data: signed, error: signError } = await bucket.createSignedUrl(path, ttl)
    if (!signError && signed?.signedUrl) {
      return { url: signed.signedUrl, path }
    }

    // Bucket may still be public on older deployments — fall back so image
    // generation keeps working while the storage migration is applied.
    console.warn('[image] signed URL unavailable, falling back to public URL:', signError?.message)
    return { url: bucket.getPublicUrl(path).data.publicUrl, path }
  } catch (err) {
    console.error('[image] failed to save to storage:', err)
    return null
  }
}
