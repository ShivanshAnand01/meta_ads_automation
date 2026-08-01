import { resolvePendingQuestion, getQuestionMetadataById } from '@/lib/ai/pending-questions'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const body = await request.json()
    const { questionId, answer } = body as {
      questionId?: string
      answer?: string
    }

    if (!questionId || answer === undefined) {
      return Response.json(
        { error: 'questionId and answer are required' },
        { status: 400 }
      )
    }

    const meta = await getQuestionMetadataById(questionId)
    if (!meta || meta.userId !== userId) {
      return Response.json({ error: 'Question not found' }, { status: 404 })
    }

    const resolved = await resolvePendingQuestion(questionId, answer)
    if (!resolved) {
      return Response.json({ error: 'Question not found or already answered' }, { status: 404 })
    }

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to submit answer')
  }
}
