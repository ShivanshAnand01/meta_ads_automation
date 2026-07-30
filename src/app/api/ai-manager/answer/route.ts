import { resolvePendingQuestion, getPendingQuestion } from '@/lib/ai/pending-questions'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    await requireUserId()
    const body = await request.json()
    const { questionId, answer } = body as { questionId?: string; answer?: string }

    if (!questionId || answer === undefined) {
      return Response.json({ error: 'questionId and answer are required' }, { status: 400 })
    }

    const resolved = resolvePendingQuestion(questionId, answer)
    if (!resolved) {
      return Response.json({ error: 'Question not found or already answered' }, { status: 404 })
    }

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to submit answer')
  }
}

export async function GET(request: Request) {
  try {
    await requireUserId()
    const url = new URL(request.url)
    const questionId = url.searchParams.get('questionId')
    if (!questionId) {
      return Response.json({ error: 'questionId is required' }, { status: 400 })
    }
    const question = getPendingQuestion(questionId)
    if (!question) {
      return Response.json({ found: false })
    }
    return Response.json({ found: true, question })
  } catch (error) {
    return handleError(error, 'Failed to check question')
  }
}
