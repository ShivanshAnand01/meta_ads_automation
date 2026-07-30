import { requireUserId, handleError, getSupabaseServer } from '@/lib/supabase/server'
import { ingestDocument, listDocuments, deleteDocument } from '@/lib/ai/rag'
import { db } from '@/lib/db/supabase-db'
import type { AIProviderType } from '@/lib/ai/types'

export async function GET() {
  try {
    const userId = await requireUserId()
    const documents = await listDocuments(userId)
    return Response.json({ documents })
  } catch (error) {
    return handleError(error, 'Failed to list documents')
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const contentType = request.headers.get('content-type') || ''

    const settings = await db.aiSettings.findUnique({ where: { userId } }) as
      | { provider: string; apiKey: string | null; baseUrl: string | null; embeddingKey?: string | null }
      | null

    const provider = (settings?.provider || 'openai') as AIProviderType
    const apiKey = settings?.apiKey || null
    const baseUrl = settings?.baseUrl || null
    const embeddingKey = settings?.embeddingKey || null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const title = (formData.get('title') as string) || file?.name || 'Untitled'

      if (!file) {
        return Response.json({ error: 'No file provided' }, { status: 400 })
      }

      if (file.size > 5 * 1024 * 1024) {
        return Response.json({ error: 'File too large (max 5MB)' }, { status: 413 })
      }

      const text = await file.text()
      if (!text.trim()) {
        return Response.json({ error: 'File is empty or not text-readable' }, { status: 400 })
      }

      let filePath: string | null = null
      if (file.type !== 'text/plain' && file.type !== 'text/csv' && file.type !== 'application/json') {
        const supabase = await getSupabaseServer()
        const ext = file.name.split('.').pop() || 'txt'
        const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('knowledge-documents')
          .upload(storagePath, file, { contentType: file.type })
        if (!uploadError) filePath = storagePath
      }

      const result = await ingestDocument({
        userId, title, content: text, sourceType: 'file',
        filePath, fileType: file.type,
        provider, apiKey, baseUrl, embeddingKey,
      })

      return Response.json({ success: true, ...result })
    }

    const body = await request.json()
    const { title, content } = body as { title?: string; content?: string }

    if (!content || !content.trim()) {
      return Response.json({ error: 'Content is required' }, { status: 400 })
    }

    const result = await ingestDocument({
      userId,
      title: title || 'Pasted Text',
      content: content.trim(),
      sourceType: 'text',
      provider, apiKey, baseUrl, embeddingKey,
    })

    return Response.json({ success: true, ...result })
  } catch (error) {
    return handleError(error, 'Failed to upload document')
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId()
    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get('id')

    if (!documentId) {
      return Response.json({ error: 'Document ID required' }, { status: 400 })
    }

    await deleteDocument(userId, documentId)
    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete document')
  }
}
