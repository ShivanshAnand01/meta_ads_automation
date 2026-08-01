import { getSupabaseServer } from '@/lib/supabase/server'

/**
 * Shared store for pending AI-to-user questions backed by Supabase.
 *
 * When the AI calls the `ask_user_question` tool, a row is inserted with
 * status='pending'. The question is streamed to the client via SSE, the user
 * answers through /api/ai-manager/answer, and the row is updated to
 * status='answered'. This implementation is multi-instance safe, unlike the
 * previous in-memory Map.
 */

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const POLL_INTERVAL_MS = 600

interface PendingQuestionRow {
  id: string
  user_id: string
  conversation_id: string
  question: string
  answer: string | null
  status: string
  created_at: string
  expires_at: string
}

export async function createPendingQuestion(
  id: string,
  question: string,
  conversationId: string,
  userId: string
): Promise<string> {
  const supabase = await getSupabaseServer()

  const { error: insertError } = await supabase.from('pending_questions').insert({
    id,
    user_id: userId,
    conversation_id: conversationId,
    question,
    status: 'pending',
    answer: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + QUESTION_TIMEOUT_MS).toISOString(),
  })

  if (insertError) {
    throw new Error(`Failed to create pending question: ${insertError.message}`)
  }

  return new Promise<string>((resolve, reject) => {
    let resolved = false

    const cleanup = async () => {
      await supabase.from('pending_questions').delete().eq('id', id)
    }

    const timeout = setTimeout(async () => {
      if (resolved) return
      resolved = true
      clearInterval(interval)
      await supabase
        .from('pending_questions')
        .update({ status: 'expired' })
        .eq('id', id)
        .eq('status', 'pending')
      reject(new Error('Question timed out — no answer received within 5 minutes'))
    }, QUESTION_TIMEOUT_MS)

    const interval = setInterval(async () => {
      if (resolved) return
      const { data, error } = await supabase
        .from('pending_questions')
        .select('status, answer')
        .eq('id', id)
        .single()

      if (error || !data) return

      if (data.status === 'answered' && data.answer !== null) {
        resolved = true
        clearInterval(interval)
        clearTimeout(timeout)
        await cleanup()
        resolve(data.answer)
      } else if (data.status === 'cancelled' || data.status === 'expired') {
        resolved = true
        clearInterval(interval)
        clearTimeout(timeout)
        reject(new Error(`Question ${data.status}`))
      }
    }, POLL_INTERVAL_MS)
  })
}

export async function resolvePendingQuestion(
  conversationId: string,
  id: string,
  answer: string
): Promise<boolean> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pending_questions')
    .update({ status: 'answered', answer })
    .eq('id', id)
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .select('id')
    .single()

  return !error && data != null
}

export async function cancelPendingQuestion(
  conversationId: string,
  id: string
): Promise<void> {
  const supabase = await getSupabaseServer()
  await supabase
    .from('pending_questions')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
}

export async function cancelPendingQuestionsForConversation(
  conversationId: string
): Promise<void> {
  const supabase = await getSupabaseServer()
  await supabase
    .from('pending_questions')
    .update({ status: 'cancelled' })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
}

export async function getPendingQuestion(
  conversationId: string,
  id: string
): Promise<string | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pending_questions')
    .select('question')
    .eq('id', id)
    .eq('conversation_id', conversationId)
    .single()
  if (error || !data) return null
  return data.question
}

export async function getQuestionMetadata(
  conversationId: string,
  id: string
): Promise<{ userId: string; conversationId: string; question: string } | null> {
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('pending_questions')
    .select('*')
    .eq('id', id)
    .eq('conversation_id', conversationId)
    .single()
  if (error || !data) return null
  const row = data as unknown as PendingQuestionRow
  return {
    userId: row.user_id,
    conversationId: row.conversation_id,
    question: row.question,
  }
}
