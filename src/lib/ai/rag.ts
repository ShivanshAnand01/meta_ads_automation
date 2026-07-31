import { getSupabaseServer } from '@/lib/supabase/server'
import type { AIProviderType } from './types'

const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 100

export function chunkText(text: string, maxTokens = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const words = text.split(/\s+/)
  if (words.length <= maxTokens) return [text]

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + maxTokens, words.length)
    chunks.push(words.slice(start, end).join(' '))
    if (end >= words.length) break
    start = end - overlap
  }

  return chunks
}

export async function generateEmbedding(
  text: string,
  provider: AIProviderType,
  apiKey?: string | null,
  baseUrl?: string | null,
  embeddingKey?: string | null
): Promise<number[] | null> {
  const effectiveKey = embeddingKey || apiKey

  if (provider === 'openai' && effectiveKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${effectiveKey}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.data?.[0]?.embedding as number[] | undefined ?? null
    } catch {
      return null
    }
  }

  if (provider === 'ollama') {
    try {
      const url = (baseUrl || 'http://localhost:11434') + '/api/embeddings'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: text.slice(0, 8000) }),
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.embedding as number[] | undefined ?? null
    } catch {
      return null
    }
  }

  return null
}

export function canGenerateEmbeddings(provider: AIProviderType, apiKey?: string | null, embeddingKey?: string | null): boolean {
  const effectiveKey = embeddingKey || apiKey
  // OpenAI text-embedding-3-small produces 1536-dim vectors matching the
  // pgvector schema. Ollama models like nomic-embed-text output 768-dim
  // vectors and will fail to insert; use OpenAI for embeddings.
  if (provider === 'openai' && effectiveKey) return true
  return false
}

export async function ingestDocument(params: {
  userId: string
  title: string
  content: string
  sourceType: string
  filePath?: string | null
  fileType?: string | null
  provider: AIProviderType
  apiKey?: string | null
  baseUrl?: string | null
  embeddingKey?: string | null
}): Promise<{ documentId: string; chunkCount: number; embedded: boolean }> {
  const { userId, title, content, sourceType, filePath, fileType, provider, apiKey, baseUrl, embeddingKey } = params
  const supabase = await getSupabaseServer()

  const { data: doc, error: docError } = await supabase
    .from('knowledge_documents')
    .insert({
      user_id: userId,
      title,
      source_type: sourceType,
      content,
      file_path: filePath,
      file_type: fileType,
      chunk_count: 0,
    })
    .select()
    .single()

  if (docError) throw new Error(`Failed to create document: ${docError.message}`)
  const documentId = doc.id

  const chunks = chunkText(content)
  const canEmbed = canGenerateEmbeddings(provider, apiKey, embeddingKey)

  const chunkRows: Array<Record<string, unknown>> = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    let embedding: number[] | null = null

    if (canEmbed) {
      embedding = await generateEmbedding(chunk, provider, apiKey, baseUrl, embeddingKey)
    }

    chunkRows.push({
      document_id: documentId,
      user_id: userId,
      content: chunk,
      // pgvector accepts a Postgres array literal directly from supabase-js.
      embedding: embedding ?? null,
      chunk_index: i,
      token_count: Math.ceil(chunk.split(/\s+/).length * 1.3),
    })
  }

  const { error: chunkError } = await supabase
    .from('knowledge_chunks')
    .insert(chunkRows)

  if (chunkError) throw new Error(`Failed to store chunks: ${chunkError.message}`)

  await supabase
    .from('knowledge_documents')
    .update({ chunk_count: chunks.length })
    .eq('id', documentId)

  return { documentId, chunkCount: chunks.length, embedded: canEmbed }
}

export async function retrieveRelevant(params: {
  userId: string
  query: string
  provider: AIProviderType
  apiKey?: string | null
  baseUrl?: string | null
  embeddingKey?: string | null
  topK?: number
}): Promise<Array<{ content: string; title: string; similarity: number }>> {
  const { userId, query, provider, apiKey, baseUrl, embeddingKey, topK = 5 } = params
  const supabase = await getSupabaseServer()

  if (canGenerateEmbeddings(provider, apiKey, embeddingKey)) {
    const queryEmbedding = await generateEmbedding(query, provider, apiKey, baseUrl, embeddingKey)

    if (queryEmbedding) {
      const { data, error } = await supabase.rpc('match_knowledge_chunks', {
        p_user_id: userId,
        p_embedding: queryEmbedding,
        p_match_count: topK,
        p_match_threshold: 0.65,
      })

      if (!error && data && data.length > 0) {
        const docIds = Array.from(new Set(data.map((r: { document_id: string }) => r.document_id)))
        const { data: docs } = await supabase
          .from('knowledge_documents')
          .select('id, title')
          .in('id', docIds)

        const docMap = new Map((docs || []).map((d: { id: string; title: string }) => [d.id, d.title]))

        return data.map((r: { content: string; document_id: string; similarity: number }) => ({
          content: r.content,
          title: docMap.get(r.document_id) || 'Unknown',
          similarity: r.similarity,
        }))
      }
    }
  }

  const terms = query.split(/\s+/).filter((w) => w.length > 3).slice(0, 5)
  if (terms.length === 0) return []

  const orFilter = terms.map((t) => `content.ilike.%${t}%`).join(',')
  const { data: chunks, error } = await supabase
    .from('knowledge_chunks')
    .select('content, document_id')
    .eq('user_id', userId)
    .or(orFilter)
    .limit(topK)

  if (error || !chunks || chunks.length === 0) return []

  const docIds = Array.from(new Set(chunks.map((c: { document_id: string }) => c.document_id)))
  const { data: docs } = await supabase
    .from('knowledge_documents')
    .select('id, title')
    .in('id', docIds)

  const docMap = new Map((docs || []).map((d: { id: string; title: string }) => [d.id, d.title]))

  return chunks.map((c: { content: string; document_id: string }) => ({
    content: c.content,
    title: docMap.get(c.document_id) || 'Unknown',
    similarity: 0.5,
  }))
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  const supabase = await getSupabaseServer()
  const { error } = await supabase
    .from('knowledge_documents')
    .delete()
    .eq('id', documentId)
    .eq('user_id', userId)

  if (error) throw new Error(`Failed to delete document: ${error.message}`)
}

export async function listDocuments(userId: string): Promise<Array<{
  id: string
  title: string
  sourceType: string
  chunkCount: number
  createdAt: string
}>> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, title, source_type, chunk_count, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list documents: ${error.message}`)

  return (data || []).map((d: { id: string; title: string; source_type: string; chunk_count: number; created_at: string }) => ({
    id: d.id,
    title: d.title,
    sourceType: d.source_type,
    chunkCount: d.chunk_count,
    createdAt: d.created_at,
  }))
}

export async function trackGeneratedImage(params: {
  userId: string
  prompt: string
  imageUrl: string
  storagePath?: string | null
  provider: string
  size?: string
  style?: string
}): Promise<void> {
  const supabase = await getSupabaseServer()
  await supabase.from('generated_images').insert({
    user_id: params.userId,
    prompt: params.prompt,
    image_url: params.imageUrl,
    storage_path: params.storagePath,
    provider: params.provider,
    size: params.size,
    style: params.style,
  })
}

export async function listGeneratedImages(userId: string): Promise<Array<{
  id: string
  prompt: string
  imageUrl: string
  provider: string
  createdAt: string
}>> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('generated_images')
    .select('id, prompt, image_url, provider, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return []

  return (data || []).map((d: { id: string; prompt: string; image_url: string; provider: string; created_at: string }) => ({
    id: d.id,
    prompt: d.prompt,
    imageUrl: d.image_url,
    provider: d.provider,
    createdAt: d.created_at,
  }))
}
