import { db } from '@/lib/db/supabase-db'
import { listLearnings, type Learning } from './store'

/**
 * What the AI has learned for this business, as a prompt block. Every agent
 * that decides or writes reads it: the AI Manager in chat and in routines, the
 * specialists, and creative generation.
 *
 * Kept short on purpose (a context block that grows forever gets ignored):
 * the newest and most-seen lessons of each kind, capped.
 */

const DAY = 86_400_000

function line(l: Learning): string {
  const seen = l.occurrences > 1 ? ` (seen ${l.occurrences}×)` : ''
  return `- ${l.statement}${seen}`
}

export function formatLearningContext(all: Learning[], now = Date.now()): string {
  const active = all.filter((l) => l.status === 'active')
  const pick = (kind: Learning['kind'], n: number) =>
    active.filter((l) => l.kind === kind).sort((a, b) => b.occurrences - a.occurrences || b.lastSeen.localeCompare(a.lastSeen)).slice(0, n)

  const notes = pick('operating_note', 8)
  const prefs = pick('owner_preference', 10)
  const pitfalls = pick('pitfall', 8)
  const feedback = active.filter((l) => l.kind === 'owner_feedback').sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, 6)
  const fixed = all
    .filter((l) => l.kind === 'pitfall' && l.status === 'resolved' && l.resolvedAt && now - new Date(l.resolvedAt).getTime() < 14 * DAY)
    .slice(0, 5)

  if (!notes.length && !prefs.length && !pitfalls.length && !feedback.length && !fixed.length) return ''

  const out = [
    "LEARNED FROM THIS BUSINESS'S OWN HISTORY (real outcomes and the owner's own words — use them; they never override the guardrails, and the BUSINESS PROFILE wins if anything here conflicts with it):",
  ]
  if (notes.length) out.push('Your working notes for this business:', ...notes.map(line))
  if (prefs.length) out.push('What the owner wants:', ...prefs.map(line))
  if (pitfalls.length) out.push('Known problems, still unresolved — check before repeating the action that hit them:', ...pitfalls.map(line))
  if (fixed.length) out.push('Recently fixed — these no longer block you:', ...fixed.map((l) => `- ${l.statement.replace(/ Fix: .*$/, '')}`))
  if (feedback.length) out.push("The owner's recent decisions:", ...feedback.map(line))
  return out.join('\n')
}

export async function buildLearningContext(userId: string): Promise<string> {
  try {
    const all = await listLearnings(userId, { status: ['active', 'resolved'], limit: 120 })
    return formatLearningContext(all)
  } catch {
    return ''
  }
}

/**
 * What ad-copy writing needs to know: the owner's stated preferences, how they
 * judged and rewrote past ads, and the playbook's strongest lessons. This is
 * what stops the creative generator writing blind.
 */
export async function buildCopyGuidance(userId: string): Promise<string> {
  try {
    const all = await listLearnings(userId, { status: ['active'], kinds: ['owner_preference', 'owner_feedback'], limit: 60 })
    const prefs = all.filter((l) => l.kind === 'owner_preference').slice(0, 10)
    const decisions = all.filter((l) => l.kind === 'owner_feedback' && l.source === 'creative_review').slice(0, 8)
    const playbook = (await db.creativePlaybook.findMany({ where: { userId, status: 'active' }, orderBy: { confidence: 'desc' }, take: 5 }).catch(() => [])) as Array<{ verdict: string; dimension: string; finding: string }>
    const out: string[] = []
    if (prefs.length) out.push("The owner's preferences — follow them:", ...prefs.map((l) => `- ${l.statement}`))
    if (decisions.length) out.push('How the owner judged and rewrote past ads — write the way they approve, not the way they rejected:', ...decisions.map((l) => `- ${l.statement}`))
    if (playbook.length) out.push('What has won and lost in real results:', ...playbook.map((p) => `- [${p.verdict}] ${p.dimension}: ${p.finding}`))
    return out.join('\n')
  } catch {
    return ''
  }
}
