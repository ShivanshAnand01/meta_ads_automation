import { normalizeError } from './outcome'
import { upsertLearning } from './store'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * What the owner decides is the strongest signal the AI gets about them: an
 * approval, a rejection, and above all a rewrite of the AI's own copy. Each is
 * recorded as owner_feedback, read back in every prompt, and summarised by the
 * weekly retrospective into preferences and working notes.
 */

const clip = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

export async function recordCreativeDecision(
  userId: string,
  before: any,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const status = patch.reviewStatus as string | undefined
    if (status === 'approved' || status === 'rejected') {
      const reason = patch.reviewNotes ? ` Reason: ${clip(patch.reviewNotes, 200)}` : ''
      await upsertLearning({
        userId,
        kind: 'owner_feedback',
        signature: `creative:${before.id}`,
        statement: `Owner ${status} the ad "${clip(before.headline || before.title, 60)}" — "${clip(before.primaryText, 110)}".${reason}`,
        source: 'creative_review',
        detail: { creativeId: before.id, decision: status, title: before.title },
        confidence: 0.9,
      })
    }

    // A rewrite shows exactly how the owner wants ads worded.
    for (const field of ['headline', 'primaryText'] as const) {
      const next = patch[field]
      if (typeof next === 'string' && before[field] && next.trim() && next.trim() !== String(before[field]).trim()) {
        await upsertLearning({
          userId,
          kind: 'owner_feedback',
          signature: `creative-edit:${before.id}:${field}`,
          statement: `Owner rewrote the ${field === 'headline' ? 'headline' : 'ad text'}: "${clip(before[field], 110)}" → "${clip(next, 110)}".`,
          source: 'creative_review',
          detail: { creativeId: before.id, field },
          confidence: 0.95,
        })
      }
    }
  } catch (err) {
    console.warn('[learning] could not record creative decision:', err instanceof Error ? err.message : err)
  }
}

export async function recordApprovalDecision(
  userId: string,
  approval: { toolName: string; summary?: string | null },
  decision: 'approve' | 'reject',
): Promise<void> {
  try {
    const summary = approval.summary || approval.toolName
    await upsertLearning({
      userId,
      kind: 'owner_feedback',
      signature: `approval:${decision}:${approval.toolName}:${normalizeError(summary).slice(0, 80)}`,
      statement: `Owner ${decision === 'approve' ? 'approved' : 'REJECTED'}: ${clip(summary, 220)}`,
      source: 'approval',
      detail: { tool: approval.toolName, decision },
      confidence: decision === 'reject' ? 0.9 : 0.7,
    })
  } catch (err) {
    console.warn('[learning] could not record approval decision:', err instanceof Error ? err.message : err)
  }
}
