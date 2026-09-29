'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Play, Loader2, Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Section, StatusPill } from '@/components/ui/metric'
import { SPECIALISTS, AGENT_IDS, type AgentId } from '@/lib/ai/agents/registry'
import { cn } from '@/lib/utils'

/*
 * Developer test bench. Everything here runs on the developer's OWN account,
 * through the same code paths businesses use, so approvals, caps and metering
 * all apply. Routines and agents make real AI calls (they cost money) and
 * read the real Meta account connected to this login.
 */

const ROUTINES: Array<{ id: string; name: string; what: string }> = [
  { id: 'morning_optimization', name: 'Morning optimisation', what: 'Syncs results, pauses clear losers, scales clear winners within caps.' },
  { id: 'budget_pacing', name: 'Budget pacing', what: 'Checks today and this month against the caps.' },
  { id: 'anomaly_detection', name: 'Anomaly check', what: 'Compares the last 7 days with the 7 before.' },
  { id: 'weekly_report', name: 'Weekly report', what: 'Writes the weekly summary.' },
  { id: 'reflection', name: 'Reflection', what: 'Learns from recent actions and saves learnings to memory.' },
  { id: 'learning_review', name: 'Learning review', what: 'Refreshes what the AI knows about the owner and rewrites its working notes from real outcomes.' },
]

interface RunOutcome { label: string; ok: boolean; text: string; at: string }

export function TestBench({ setupWarning }: { setupWarning: string | null }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState<RunOutcome[]>([])
  const [agent, setAgent] = useState<AgentId>('research')
  const [brief, setBrief] = useState('')

  const push = (o: Omit<RunOutcome, 'at'>) => setLog((l) => [{ ...o, at: new Date().toLocaleTimeString('en-IN') }, ...l].slice(0, 12))

  async function runRoutine(id: string, name: string) {
    setBusy(id)
    try {
      const r = await fetch('/api/ai-manager/autonomous', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routine: id }),
      })
      const j = await r.json()
      const ok = r.ok && j.success !== false
      push({ label: name, ok, text: ok ? (j.response || j.message || 'Done') : (j.error || j.message || `Failed (${r.status})`) })
      if (!ok) toast.error(`${name} failed`)
    } catch {
      push({ label: name, ok: false, text: 'Network error' })
    } finally {
      setBusy(null)
    }
  }

  async function runAgent() {
    if (!brief.trim()) { toast.error('Write a brief first.'); return }
    const name = SPECIALISTS[agent].name
    setBusy('agent')
    try {
      const r = await fetch('/api/dev/run-agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent, brief }),
      })
      const j = await r.json()
      const ok = r.ok && j.status === 'done'
      const body = ok
        ? [j.summary, ...(j.findings ?? []).map((f: { finding: string }) => `• ${f.finding}`), ...(j.recommendations ?? []).map((x: string) => `→ ${x}`), j.costUsd != null ? `Cost $${Number(j.costUsd).toFixed(4)}` : ''].filter(Boolean).join('\n')
        : (j.error || j.message || `Failed (${r.status})`)
      push({ label: name, ok, text: body })
    } catch {
      push({ label: name, ok: false, text: 'Network error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      {setupWarning && (
        <p role="status" className="rounded-xl border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-4 py-3 text-sm">
          {setupWarning}
        </p>
      )}

      <Section title="Run an agent" description="Any of the five, including ones not yet switched on for businesses. Runs on your account and waits for the report.">
        <div className="space-y-3">
          <div role="radiogroup" aria-label="Agent" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {AGENT_IDS.map((id) => {
              const s = SPECIALISTS[id]
              const selected = agent === id
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAgent(id)}
                  className={cn(
                    'flex min-h-11 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-muted/60',
                  )}
                >
                  <span className="flex w-full items-center gap-2 text-sm font-medium">
                    <Bot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />{s.name}
                    {!s.enabled && <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">test only</span>}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">{s.job}</span>
                </button>
              )
            })}
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Brief</span>
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder={`What should the ${SPECIALISTS[agent].name} do? e.g. "Find three competitors selling Marathi self-help ebooks and their prices."`}
            />
          </label>
          <Button onClick={runAgent} disabled={busy !== null}>
            {busy === 'agent' ? <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" /> : <Play aria-hidden="true" className="mr-1.5 h-4 w-4" />}
            {busy === 'agent' ? 'Running… up to 2 minutes' : `Run ${SPECIALISTS[agent].name}`}
          </Button>
        </div>
      </Section>

      <Section title="Run a routine now" description="The same routines the scheduler runs, on your account, without waiting for the schedule. Up to 10 runs an hour.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {ROUTINES.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.what}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => runRoutine(r.id, r.name)} disabled={busy !== null} aria-label={`Run ${r.name} now`}>
                {busy === r.id ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Play aria-hidden="true" className="h-4 w-4" />}
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      {log.length > 0 && (
        <Section title="Results" description="Newest first. Full detail is under your account in the Businesses tab.">
          <ul className="space-y-2" aria-live="polite">
            {log.map((o, i) => (
              <li key={i} className="rounded-xl border border-border p-3 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium">{o.label}</span>
                  <StatusPill tone={o.ok ? 'good' : 'critical'}>{o.ok ? 'done' : 'failed'}</StatusPill>
                  <span className="ml-auto text-xs text-muted-foreground tabular">{o.at}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[13px] text-foreground/85">{o.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
