'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Brain, Sparkles, UserRound, TriangleAlert, CircleCheck, MessageSquareQuote, X, RotateCcw, Loader2, ExternalLink } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader, Section, EmptyState } from '@/components/ui/metric'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { cn } from '@/lib/utils'

/**
 * What the AI has learned for this business — and the owner's way to correct
 * it. Everything here is read by the AI before it acts; "Forget" removes a
 * lesson from every prompt for good.
 */

interface Learning {
  id: string
  kind: 'pitfall' | 'fix' | 'owner_preference' | 'owner_feedback' | 'operating_note'
  statement: string
  detail: { link?: string | null; evidence?: string }
  source: string
  occurrences: number
  status: 'active' | 'resolved' | 'dismissed'
  lastSeen: string
  resolvedAt: string | null
}

const GROUPS: Array<{ key: string; title: string; description: string; icon: LucideIcon; match: (l: Learning) => boolean }> = [
  { key: 'notes', title: 'Working notes', description: 'Rules the AI wrote for itself from what worked and what did not here. Rewritten every week.', icon: Sparkles, match: (l) => l.kind === 'operating_note' && l.status === 'active' },
  { key: 'you', title: 'About you', description: 'What the AI has understood from your own messages.', icon: UserRound, match: (l) => l.kind === 'owner_preference' && l.status === 'active' },
  { key: 'problems', title: 'Problems to fix', description: 'Things that failed and are still failing. The AI checks these before it acts.', icon: TriangleAlert, match: (l) => l.kind === 'pitfall' && l.status === 'active' },
  { key: 'fixed', title: 'Recently fixed', description: 'Problems that went away in the last two weeks.', icon: CircleCheck, match: (l) => l.kind === 'pitfall' && l.status === 'resolved' },
  { key: 'decisions', title: 'Your decisions', description: 'What you approved, rejected and rewrote. The AI writes the way you approve.', icon: MessageSquareQuote, match: (l) => l.kind === 'owner_feedback' && l.status === 'active' },
]

const FIX_LINK = 'mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')

export default function LearningsPage() {
  const [items, setItems] = useState<Learning[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [improving, setImproving] = useState(false)
  const [showForgotten, setShowForgotten] = useState(false)

  const fetchAll = useCallback(async (): Promise<Learning[]> => {
    const r = await fetch('/api/learnings')
    const j = await r.json()
    if (!r.ok) throw new Error(j?.error || 'Failed')
    return j.learnings as Learning[]
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchAll().then((l) => { if (!cancelled) setItems(l) }).catch(() => toast.error('Could not load what the AI has learned'))
    return () => { cancelled = true }
  }, [fetchAll])

  async function setStatus(id: string, status: 'dismissed' | 'active') {
    setBusy(id)
    try {
      const r = await fetch(`/api/learnings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      if (!r.ok) throw new Error()
      setItems((prev) => prev?.map((l) => (l.id === id ? { ...l, status } : l)) ?? prev)
      toast.success(status === 'dismissed' ? 'Forgotten. The AI will no longer use this.' : 'Restored.')
    } catch {
      toast.error('Could not update it')
    } finally {
      setBusy(null)
    }
  }

  async function improveNow() {
    setImproving(true)
    try {
      const r = await fetch('/api/ai-manager/autonomous', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routine: 'learning_review' }) })
      const j = await r.json()
      if (!r.ok || j.success === false) throw new Error(j.error || j.message || 'Failed')
      toast.success(j.response || 'Done')
      setItems(await fetchAll())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The review failed')
    } finally {
      setImproving(false)
    }
  }

  if (!items) return <PageSkeleton rows={3} />

  const forgotten = items.filter((l) => l.status === 'dismissed')
  const visible = GROUPS.map((g) => ({ ...g, list: items.filter(g.match) })).filter((g) => g.list.length > 0)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Brain}
        title="AI learnings"
        description="What your AI has learned from real results and from you. It reads all of this before it acts. Forget anything that is wrong."
        actions={
          <Button onClick={improveNow} disabled={improving}>
            {improving ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles aria-hidden="true" className="mr-1.5 h-4 w-4" />}
            {improving ? 'Reviewing… up to a minute' : 'Improve now'}
          </Button>
        }
      />

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState icon={Brain} title="Nothing learned yet" description="As the AI works — publishing, failing, being approved or corrected by you — what it learns appears here." />
        </div>
      ) : (
        visible.map((g) => (
          <Section key={g.key} title={g.title} description={g.description}>
            <ul className="space-y-2">
              {g.list.map((l) => (
                <li key={l.id} className={cn('flex items-start gap-3 rounded-xl border px-3 py-2.5', g.key === 'problems' ? 'border-[var(--status-warning)]/40 bg-[var(--status-warning)]/5' : 'border-border')}>
                  <g.icon aria-hidden="true" className={cn('mt-0.5 h-4 w-4 shrink-0', g.key === 'fixed' ? 'text-[var(--status-good-ink)] dark:text-green-300' : g.key === 'problems' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed">{g.key === 'fixed' ? l.statement.replace(/ Fix: .*$/, '') : l.statement}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{g.key === 'fixed' ? `Fixed ${when(l.resolvedAt)}` : `Last ${when(l.lastSeen)}`}</span>
                      {l.occurrences > 1 && <span>· seen {l.occurrences}×</span>}
                    </p>
                    {l.detail?.link && g.key === 'problems' && (
                      // The most useful thing on this page, so a real tap target.
                      l.detail.link.startsWith('/')
                        ? <Link href={l.detail.link} className={FIX_LINK}>Fix it</Link>
                        : <a href={l.detail.link} target="_blank" rel="noopener noreferrer" className={FIX_LINK}>Fix it <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a>
                    )}
                  </div>
                  {g.key !== 'fixed' && (
                    <Button variant="ghost" size="sm" onClick={() => setStatus(l.id, 'dismissed')} disabled={busy === l.id} aria-label={`Forget: ${l.statement}`} title="Forget this">
                      <X aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}

      {forgotten.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowForgotten((v) => !v)} aria-expanded={showForgotten} className="min-h-9 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {showForgotten ? 'Hide' : 'Show'} {forgotten.length} forgotten
          </button>
          {showForgotten && (
            <ul className="mt-2 space-y-2">
              {forgotten.map((l) => (
                <li key={l.id} className="flex items-start gap-3 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
                  <p className="min-w-0 flex-1 line-through decoration-muted-foreground/40">{l.statement}</p>
                  <Button variant="ghost" size="sm" onClick={() => setStatus(l.id, 'active')} disabled={busy === l.id} aria-label={`Restore: ${l.statement}`}>
                    <RotateCcw aria-hidden="true" className="mr-1 h-3.5 w-3.5" /> Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
