import type { AIProviderType } from './types'

export interface ImageGenResult {
  success: boolean
  imageUrl: string
  provider: string
  error?: string
  promptUsed?: string
}

export interface ImageGenOptions {
  size?: string
  style?: string
  quality?: 'standard' | 'hd'
  aspectRatio?: '1:1' | '4:5' | '9:16' | '1.91:1' | '16:9'
  brandColors?: string[]
  negativePrompt?: string
  model?: string
  count?: number
}

// Meta Ads recommended aspect ratios mapped to pixel dimensions.
const ASPECT_RATIO_DIMENSIONS: Record<string, { w: number; h: number }> = {
  '1:1':     { w: 1080, h: 1080 },  // Feed (square)
  '4:5':     { w: 1080, h: 1350 },  // Feed (portrait)
  '9:16':    { w: 1080, h: 1920 },  // Stories / Reels
  '1.91:1':  { w: 1200, h: 628 },   // Link ad (landscape)
  '16:9':    { w: 1920, h: 1080 },  // Landscape
}

// GPT image model supported sizes.
const GPT_IMAGE_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536'])

// Pollinations models (free, no API key required).
const POLLINATIONS_MODELS = ['flux', 'sana', 'turbo'] as const
type PollinationsModel = (typeof POLLINATIONS_MODELS)[number]

function resolveDimensions(options?: ImageGenOptions): { w: number; h: number } {
  if (options?.aspectRatio && ASPECT_RATIO_DIMENSIONS[options.aspectRatio]) {
    return ASPECT_RATIO_DIMENSIONS[options.aspectRatio]
  }
  const size = options?.size || '1024x1024'
  const [w, h] = size.split('x').map(Number)
  return { w: w || 1024, h: h || 1024 }
}

function resolveGptImageSize(options?: ImageGenOptions): string {
  if (options?.aspectRatio) {
    switch (options.aspectRatio) {
      case '1:1': return '1024x1024'
      case '9:16':
      case '1.91:1': return '1024x1536'
      case '16:9':
      case '4:5': return '1536x1024'
    }
  }
  const size = options?.size || '1024x1024'
  // Map legacy DALL-E sizes to GPT image sizes
  if (size === '1792x1024') return '1536x1024'
  if (size === '1024x1792') return '1024x1536'
  return GPT_IMAGE_SIZES.has(size) ? size : '1024x1024'
}

function buildEnhancedPrompt(prompt: string, options?: ImageGenOptions): string {
  const parts: string[] = [prompt]

  parts.push(
    'Professional digital marketing ad creative for Facebook/Instagram Meta Ads. ' +
    'High quality, clean modern design, vibrant colors, sharp focus, ' +
    'suitable for Indian / Maharashtrian audience marketing. ' +
    'No watermarks, no logos unless specified, no text artifacts. ' +
    'Commercial advertising photography style.'
  )

  if (options?.brandColors && options.brandColors.length > 0) {
    parts.push(`Brand color palette: ${options.brandColors.join(', ')}. Incorporate these colors into the design.`)
  }

  if (options?.style === 'natural') {
    parts.push('Natural, realistic photographic style.')
  } else {
    parts.push('Vivid, eye-catching, high-contrast advertising style.')
  }

  if (options?.negativePrompt) {
    parts.push(`AVOID: ${options.negativePrompt}`)
  }

  return parts.join(' ')
}

async function generateViaGptImage(
  apiKey: string,
  prompt: string,
  options?: ImageGenOptions,
): Promise<ImageGenResult> {
  const enhancedPrompt = buildEnhancedPrompt(prompt, options)
  const size = resolveGptImageSize(options)
  // Map quality: standard → medium, hd → high, default → high (best quality)
  const qualityMap: Record<string, 'low' | 'medium' | 'high'> = {
    standard: 'medium',
    hd: 'high',
  }
  const quality = (options?.quality ? qualityMap[options.quality] : 'high') as 'low' | 'medium' | 'high'

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: enhancedPrompt,
      n: 1,
      size: size as '1024x1024' | '1536x1024' | '1024x1536',
      quality,
      output_format: 'png',
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    console.error('GPT image error:', errText)
    throw new Error(`GPT image error: ${response.status} — ${errText.slice(0, 200)}`)
  }

  const data = await response.json()
  const b64 = data.data?.[0]?.b64_json
  if (b64) {
    const imageUrl = `data:image/png;base64,${b64}`
    return { success: true, imageUrl, provider: 'gpt-image-1', promptUsed: enhancedPrompt }
  }
  throw new Error('GPT image returned no image data')
}

async function generateViaPollinations(
  prompt: string,
  options?: ImageGenOptions,
  model: PollinationsModel = 'flux',
): Promise<ImageGenResult> {
  const enhancedPrompt = buildEnhancedPrompt(prompt, options)
  const { w, h } = resolveDimensions(options)
  const encoded = encodeURIComponent(enhancedPrompt.slice(0, 1200))
  const seed = Math.floor(Math.random() * 1000000)

  const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${model}`

  // Actually GET the image to verify it was generated successfully.
  // HEAD is unreliable with Pollinations (often returns non-image content-type
  // or 500 while the image is still generating). A GET waits for the full
  // image, so we know it's valid before returning the URL. The same URL
  // (same seed) will return the cached image on subsequent fetches.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  try {
    const res = await fetch(imageUrl, { signal: controller.signal })
    clearTimeout(timeout)
    const contentType = res.headers.get('content-type') || ''
    if (res.ok && contentType.startsWith('image/')) {
      return { success: true, imageUrl, provider: `pollinations-${model}`, promptUsed: enhancedPrompt }
    }
    throw new Error(`Pollinations ${model} returned ${res.status} (${contentType || 'no content-type'})`)
  } catch (err) {
    clearTimeout(timeout)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Pollinations ${model} timed out after 90s`)
    }
    throw err
  }
}

/**
 * Generate an ad creative image using AI. Falls through a provider chain:
 *   1. GPT image (gpt-image-1) — best quality, requires an OpenAI API key
 *   2. Pollinations flux (free, no key)
 *   3. Pollinations sana (free, no key)
 *   4. Pollinations turbo (free, faster)
 *
 * The OpenAI key can come from the main provider (if OpenAI) or from the
 * embedding key (which is always an OpenAI key). This ensures image
 * generation uses the best model available even when the main AI provider
 * is Anthropic, Groq, or Ollama.
 *
 * This ensures image generation ALWAYS works, even without an OpenAI key.
 */
export async function generateAdImage(
  providerType: AIProviderType,
  apiKey: string | null | undefined,
  prompt: string,
  options?: ImageGenOptions,
): Promise<ImageGenResult> {
  const errors: string[] = []

  // 1. GPT image (best quality, requires an OpenAI key)
  if (apiKey) {
    try {
      return await generateViaGptImage(apiKey, prompt, options)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'GPT image failed')
      console.warn('GPT image generation failed, falling back to Pollinations:', errors[errors.length - 1])
    }
  }

  // 2-4. Pollinations free fallback chain (always works, no key needed)
  for (const model of POLLINATIONS_MODELS) {
    try {
      return await generateViaPollinations(prompt, options, model)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `${model} failed`)
      console.warn(`Pollinations ${model} failed:`, errors[errors.length - 1])
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
 * Generate multiple ad image variations from the same prompt by using
 * different seeds. Useful for A/B testing ad creatives.
 */
export async function generateImageVariations(
  providerType: AIProviderType,
  apiKey: string | null | undefined,
  prompt: string,
  count: number,
  options?: ImageGenOptions,
): Promise<ImageGenResult[]> {
  const results: ImageGenResult[] = []
  for (let i = 0; i < count; i++) {
    const result = await generateAdImage(providerType, apiKey, prompt, {
      ...options,
      size: options?.size,
    })
    results.push(result)
  }
  return results
}

export async function saveImageToStorage(
  imageUrl: string,
  userId: string,
  supabase: { storage: { from: (bucket: string) => { upload: (path: string, body: Blob, options?: Record<string, unknown>) => Promise<{ data: { path: string } | null; error: { message: string } | null }> ; getPublicUrl: (path: string) => { data: { publicUrl: string } } } } }
): Promise<{ url: string; path: string } | null> {
  try {
    let blob: Blob
    let contentType: string

    // Handle data URLs (from gpt-image-1 base64 response) directly,
    // without going through fetch — more reliable across Node.js versions.
    if (imageUrl.startsWith('data:')) {
      const m = imageUrl.match(/^data:(image\/[\w+]+);base64,(.+)$/)
      if (!m) {
        console.error('Invalid data URL format')
        return null
      }
      contentType = m[1]
      const binary = atob(m[2])
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      blob = new Blob([bytes], { type: contentType })
    } else {
      // Remote URL — fetch with timeout
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 90_000)
      let res: Response
      try {
        res = await fetch(imageUrl, { signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }
      if (!res.ok) {
        console.error('Image fetch failed:', res.status, res.statusText)
        return null
      }
      contentType = res.headers.get('content-type') || ''
      if (!contentType.startsWith('image/')) {
        console.error('Image fetch returned non-image content-type:', contentType)
        return null
      }
      blob = await res.blob()
    }

    if (blob.size < 1000) {
      console.error('Image blob too small, likely an error response:', blob.size, 'bytes')
      return null
    }
    const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png'
    const fileName = `ad-creative-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const filePath = `${userId}/${fileName}`

    const { data, error } = await supabase.storage
      .from('ad-creative-images')
      .upload(filePath, blob, {
        contentType,
        cacheControl: '3600',
      })

    if (error) {
      console.error('Storage save error:', error)
      return null
    }

    const { data: urlData } = supabase.storage
      .from('ad-creative-images')
      .getPublicUrl(data?.path || filePath)

    return { url: urlData.publicUrl, path: data?.path || filePath }
  } catch (err) {
    console.error('Failed to save image to storage:', err)
    return null
  }
}
