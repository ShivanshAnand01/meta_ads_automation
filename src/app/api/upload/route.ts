import { requireUserId, handleError } from '@/lib/supabase/server'
import { getSupabaseServer } from '@/lib/supabase/server'

const MAX_FILE_SIZE = 10 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
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
        { error: `File type "${file.type}" not allowed. Images and PDFs only.` },
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

    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath)

    return Response.json({
      success: true,
      url: urlData.publicUrl,
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
