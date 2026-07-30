/**
 * In-memory store for pending AI-to-user questions.
 *
 * When the AI calls the `ask_user_question` tool, a Promise is created
 * and stored here. The question is streamed to the client via SSE, the
 * user answers in a popup, and the answer is sent to the /api/ai-manager/answer
 * endpoint, which resolves the Promise. The tool execution then continues
 * with the user's answer as its result.
 *
 * Note: This is in-memory, so it works within a single server process.
 * For multi-instance deployments, use a shared store (Redis, DB, etc.).
 */

interface PendingQuestion {
  resolve: (answer: string) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
  question: string
  createdAt: number
}

const pendingQuestions = new Map<string, PendingQuestion>()

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export function createPendingQuestion(id: string, question: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingQuestions.delete(id)
      reject(new Error('Question timed out — no answer received within 5 minutes'))
    }, QUESTION_TIMEOUT_MS)

    pendingQuestions.set(id, { resolve, reject, timeout, question, createdAt: Date.now() })
  })
}

export function resolvePendingQuestion(id: string, answer: string): boolean {
  const pending = pendingQuestions.get(id)
  if (!pending) return false
  clearTimeout(pending.timeout)
  pending.resolve(answer)
  pendingQuestions.delete(id)
  return true
}

export function cancelPendingQuestion(id: string): void {
  const pending = pendingQuestions.get(id)
  if (!pending) return
  clearTimeout(pending.timeout)
  pending.reject(new Error('Question cancelled'))
  pendingQuestions.delete(id)
}

export function cancelAllPendingQuestions(): void {
  for (const [, pending] of pendingQuestions) {
    clearTimeout(pending.timeout)
    pending.reject(new Error('Request aborted'))
  }
  pendingQuestions.clear()
}

export function getPendingQuestion(id: string): string | null {
  return pendingQuestions.get(id)?.question ?? null
}
