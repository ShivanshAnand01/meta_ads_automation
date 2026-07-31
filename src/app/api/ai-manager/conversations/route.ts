import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'

export async function GET() {
  try {
    const userId = await requireUserId()

    const conversations = await db.aiConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
        notes: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    return Response.json({ conversations })
  } catch (error) {
    return handleError(error, 'Failed to load conversations')
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId()
    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('id')

    if (!conversationId) {
      return Response.json({ error: 'Conversation ID required' }, { status: 400 })
    }

    const existing = await db.aiConversation.findUnique({ where: { id: conversationId, userId } })
    if (!existing) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 })
    }

    await db.aiConversation.delete({ where: { id: conversationId, userId } })

    return Response.json({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete conversation')
  }
}
