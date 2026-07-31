import { resolvePendingQuestion, getPendingQuestion, getQuestionMetadata } from '@/lib/ai/pending-questions'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()
    const { questionId, answer, conversationId } = body as {
      questionId?: string
      answer?: string
      conversationId?: string
    }

    if (!questionId || answer === undefined || !conversationId) {
      return Response.json(
        { error: 'questionId, conversationId, and answer are required' },
        { status: 400 }
      )
    }

    const meta = getQuestionMetadata(conversationId, questionId)
    if (!meta || meta.userId !== userId) {
      return Response.json({ error: 'Question not found' }, { status: 404 })
    }

    const resolved = resolvePendingQuestion(conversationId, questionId, answer)
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
    const userId = await requireUserId()
    const url = new URL(request.url)
    const questionId = url.searchParams.get('questionId')
    const conversationId = url.searchParams.get('conversationId')
    if (!questionId || !conversationId) {
      return Response.json({ error: 'questionId and conversationId are required' }, { status: 400 })
    }

    const meta = getQuestionMetadata(conversationId, questionId)
    if (!meta || meta.userId !== userId) {
      return Response.json({ found: false })
    }

    const question = getPendingQuestion(conversationId, questionId)
    if (!question) {
      return Response.json({ found: false })
    }
    return Response.json({ found: true, question })
  } catch (error) {
    return handleError(error, 'Failed to check question')
  }
}
