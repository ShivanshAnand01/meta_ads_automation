import { requireUserId, handleError } from '@/lib/supabase/server'
import { getSupabaseServer } from '@/lib/supabase/server'

// Vercel kills a function at its maxDuration. Without this the default
// (10s Hobby / 15s Pro) truncates long AI work mid-stream.
import { enforceRateLimit } from '@/lib/rate-limit'

export const maxDuration = 60


const MAX_FILE_SIZE = 10 * 1024 * 1024

// SVG is deliberately excluded. An SVG is executable markup, and serving one
// from our own storage origin is a stored-XSS vector.
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
]

const ALLOWED_BUCKETS = new Set([
  'chat-attachments',
  'ad-creative-images',
  'knowledge-documents',
  'voice-clips',
])

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.+/g, '.').slice(0, 120)
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()

    const limited = await enforceRateLimit(userId, 'upload', 'uploads')
    if (limited) return limited

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const rawBucket = (formData.get('bucket') as string) || 'chat-attachments'
    const bucket = ALLOWED_BUCKETS.has(rawBucket) ? rawBucket : 'chat-attachments'

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: 'File too large (max 10MB)' }, { status: 413 })
    }

    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
    const isDoc = ALLOWED_DOC_TYPES.includes(file.type)
    if (!isImage && !isDoc) {
      return Response.json(
        {
          error:
            `File type "${file.type}" is not allowed. Accepted: JPEG, PNG, WebP, GIF images, ` +
            `and PDF, TXT, CSV or JSON documents. SVG is not accepted for security reasons.`,
        },
        { status: 415 }
      )
    }

    const safeBase = sanitizeFileName(file.name.split('/').pop() || 'upload')
    const ext = safeBase.split('.').pop() || 'bin'
    const base = safeBase.replace(/\.[^.]+$/, '') || 'file'
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base.slice(0, 60)}.${ext}`
    const filePath = `${userId}/${fileName}`

    const supabase = await getSupabaseServer()

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      })

    if (error) {
      console.error('Storage upload error:', error)
      return Response.json(
        { error: `Upload failed: ${error.message}` },
        { status: 500 }
      )
    }

    // Signed URL, not public. These buckets hold the client's business
    // documents and unreleased ad creative; a public URL is readable by anyone
    // who ever sees it, forever, with no way to revoke it.
    const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7
    let url: string
    const { data: signed, error: signError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS)

    if (signed?.signedUrl) {
      url = signed.signedUrl
    } else {
      // Older deployments may still have public buckets — keep working while
      // the storage migration is applied, but make the gap visible.
      console.warn('[upload] signed URL unavailable, falling back to public URL:', signError?.message)
      url = supabase.storage.from(bucket).getPublicUrl(filePath).data.publicUrl
    }

    return Response.json({
      success: true,
      url,
      signedUrlExpiresIn: signed?.signedUrl ? SIGNED_URL_TTL_SECONDS : null,
      path: data.path,
      bucket,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      isImage,
    })
  } catch (error) {
    return handleError(error, 'Failed to upload file')
  }
}
