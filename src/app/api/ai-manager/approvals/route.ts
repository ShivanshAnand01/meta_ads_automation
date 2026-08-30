import { db } from '@/lib/db/supabase-db'
import { requireUserId, handleError } from '@/lib/supabase/server'
import { executeTool, type ToolExecutionContext } from '@/lib/ai/tools'
import type { LocalToolContext } from '@/lib/ai/tools/local'
import { createAIProvider } from '@/lib/ai/factory'
import { resolveSecrets, SECRET_KEYS } from '@/lib/secrets'
import type { AIProviderType } from '@/lib/ai/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  try {
    const userId = await requireUserId()
    const pending = (await db.pendingApproval.findMany({
      where: { userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })) as any[]

    const now = Date.now()
    const live = pending.filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now)
    const expired = pending.filter((a) => a.expiresAt && new Date(a.expiresAt).getTime() <= now)

    return Response.json({
      approvals: live,
      total: live.length,
      expiredCount: expired.length,
    })
  } catch (error) {
    return handleError(error, 'Failed to load approvals')
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId()
    const { approvalId, decision } = (await request.json()) as { approvalId?: string; decision?: 'approve' | 'reject' }
    if (!approvalId || !decision) {
      return Response.json({ error: 'approvalId and decision are required' }, { status: 400 })
    }

    const approval = await db.pendingApproval.findUnique({ where: { id: approvalId } }) as any
    if (!approval || approval.userId !== userId) {
      return Response.json({ error: 'Approval not found' }, { status: 404 })
    }
    if (approval.status !== 'pending') {
      return Response.json({ error: `Approval already ${approval.status}` }, { status: 409 })
    }

    // An approval queued days ago was reasoned about against a state of the
    // account that no longer exists. Executing it blindly is how an agent
    // pauses a campaign that is now the client's best performer.
    const expiresAt = approval.expiresAt ? new Date(approval.expiresAt) : null
    if (decision === 'approve' && expiresAt && expiresAt.getTime() < Date.now()) {
      await db.pendingApproval.update({
        where: { id: approvalId },
        data: { status: 'expired', decidedBy: userId, decidedAt: new Date() },
      })
      return Response.json(
        {
          error:
            'This approval has expired. The account may have changed since it was proposed — ask the AI Manager to re-evaluate and propose it again.',
          status: 'expired',
        },
        { status: 410 },
      )
    }

    if (decision === 'reject') {
      await db.pendingApproval.update({
        where: { id: approvalId },
        data: { status: 'rejected', decidedBy: userId, decidedAt: new Date() },
      })
      return Response.json({ success: true, status: 'rejected' })
    }

    // Approve: execute the deferred tool now, bypassing the guardrail.
    let settings = await db.aiSettings.findUnique({ where: { userId } }) as any
    if (settings) {
      settings = await resolveSecrets(settings, [
        { column: 'apiKey', vaultKey: SECRET_KEYS.aiApiKey },
        { column: 'embeddingKey', vaultKey: SECRET_KEYS.aiEmbeddingKey },
        { column: 'whisperKey', vaultKey: SECRET_KEYS.aiWhisperKey },
        { column: 'ttsKey', vaultKey: SECRET_KEYS.aiTtsKey },
      ])
    }
    const provider = settings ? createAIProvider(settings.provider as AIProviderType, {
      apiKey: settings.apiKey || undefined, model: settings.model, baseUrl: settings.baseUrl || undefined,
    }) : undefined

    const localCtx: LocalToolContext = {
      userId,
      conversationId: approval.conversationId || undefined,
      providerType: settings?.provider as AIProviderType || 'openai',
      apiKey: settings?.apiKey ?? null,
      baseUrl: settings?.baseUrl ?? null,
      embeddingKey: settings?.embeddingKey ?? null,
      whisperKey: settings?.whisperKey ?? null,
      ttsKey: settings?.ttsKey ?? null,
      provider,
    }
    const toolCtx: ToolExecutionContext = {
      userId, conversationId: approval.conversationId || undefined, local: localCtx,
      actor: 'agent', autoApproved: true,
    }

    let args: Record<string, unknown> = {}
    try { args = JSON.parse(approval.arguments) as Record<string, unknown> } catch {}

    const result = await executeTool(toolCtx, approval.toolName, args)

    await db.pendingApproval.update({
      where: { id: approvalId },
      data: {
        status: 'executed', decidedBy: userId, decidedAt: new Date(),
        result: JSON.stringify(result),
      },
    })

    return Response.json({ success: true, status: 'executed', result })
  } catch (error) {
    return handleError(error, 'Failed to process approval')
  }
}
