import { db } from '@/lib/db/supabase-db'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AuditEntry {
  userId: string
  conversationId?: string | null
  toolName: string
  arguments?: Record<string, unknown> | null
  result?: unknown
  status?: string
  actor?: string
}

export async function logAction(entry: AuditEntry): Promise<void> {
  try {
    await db.aiAction.create({
      data: {
        userId: entry.userId,
        conversationId: entry.conversationId || null,
        toolName: entry.toolName,
        arguments: entry.arguments ? JSON.stringify(entry.arguments) : null,
        result: entry.result != null ? JSON.stringify(entry.result) : null,
        status: entry.status || 'success',
        actor: entry.actor || 'agent',
      },
    })
  } catch {
    // Audit logging must never break the agent loop.
  }
}

export async function listActions(userId: string, limit = 50): Promise<any[]> {
  return (await db.aiAction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })) as any[]
}
