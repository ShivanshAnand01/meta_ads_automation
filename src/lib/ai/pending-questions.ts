/**
 * In-memory store for pending AI-to-user questions.
 *
 * When the AI calls the `ask_user_question` tool, a Promise is created
 * and stored here. The question is streamed to the client via SSE, the
 * user answers in a popup, and the answer is sent to the /api/ai-manager/answer
 * endpoint, which resolves the Promise. The tool execution then continues
 * with the user's answer as its result.
 *
 * Note: This is still in-memory, so it works within a single server function
 * instance. For true multi-instance resilience, move the store to Supabase/Redis.
 * We key questions by conversationId to avoid cross-conversation leakage.
 */

interface PendingQuestion {
  resolve: (answer: string) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
  question: string
  conversationId: string
  userId: string
  createdAt: number
}

const pendingQuestions = new Map<string, PendingQuestion>()

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function key(conversationId: string, id: string): string {
  return `${conversationId}:${id}`
}

export function createPendingQuestion(
  id: string,
  question: string,
  conversationId: string,
  userId: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingQuestions.delete(key(conversationId, id))
      reject(new Error('Question timed out — no answer received within 5 minutes'))
    }, QUESTION_TIMEOUT_MS)

    pendingQuestions.set(key(conversationId, id), {
      resolve,
      reject,
      timeout,
      question,
      conversationId,
      userId,
      createdAt: Date.now(),
    })
  })
}

export function resolvePendingQuestion(
  conversationId: string,
  id: string,
  answer: string
): boolean {
  const pending = pendingQuestions.get(key(conversationId, id))
  if (!pending) return false
  clearTimeout(pending.timeout)
  pending.resolve(answer)
  pendingQuestions.delete(key(conversationId, id))
  return true
}

export function cancelPendingQuestion(conversationId: string, id: string): void {
  const pending = pendingQuestions.get(key(conversationId, id))
  if (!pending) return
  clearTimeout(pending.timeout)
  pending.reject(new Error('Question cancelled'))
  pendingQuestions.delete(key(conversationId, id))
}

export function cancelPendingQuestionsForConversation(conversationId: string): void {
  for (const [k, pending] of pendingQuestions) {
    if (pending.conversationId === conversationId) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Request aborted'))
      pendingQuestions.delete(k)
    }
  }
}

/** @deprecated Use cancelPendingQuestionsForConversation(conversationId) instead. */
export function cancelAllPendingQuestions(): void {
  for (const [, pending] of pendingQuestions) {
    clearTimeout(pending.timeout)
    pending.reject(new Error('Request aborted'))
  }
  pendingQuestions.clear()
}

export function getPendingQuestion(conversationId: string, id: string): string | null {
  return pendingQuestions.get(key(conversationId, id))?.question ?? null
}

export function getQuestionMetadata(
  conversationId: string,
  id: string
): { userId: string; conversationId: string; question: string } | null {
  const pending = pendingQuestions.get(key(conversationId, id))
  if (!pending) return null
  return {
    userId: pending.userId,
    conversationId: pending.conversationId,
    question: pending.question,
  }
}
