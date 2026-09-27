'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader, StatusPill, EmptyState } from '@/components/ui/metric'
import { TextField, TextAreaField, ChipGroup, Field } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Plus, Play, Pause, Trash2, Loader2, CalendarClock, Sun, Gauge, Radar, FileBarChart, Brain, Wand2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Automations.
 *
 * Routines the agent runs without being asked. The honest constraint is
 * stated on the page: the hosted plan runs the scheduler once a day, so a
 * job's cron sets *whether* it is due at that tick, not a precise time.
 */

interface Job { id: string; type: string; campaignId: string | null; cronExpression: string; status: string; lastRunAt: string | null; nextRunAt: string | null; createdAt: string }
interface Campaign { id: string; name: string }

const ROUTINES: Record<string, { label: string; description: string; icon: LucideIcon; suggested: string }> = {
  morning_optimization: { label: 'Morning check', description: 'Reviews yesterday, checks pacing against your caps, proposes what to scale or pause.', icon: Sun, suggested: '30 3 * * *' },
  budget_pacing: { label: 'Budget pacing', description: 'Flags campaigns burning faster than planned before the day is over.', icon: Gauge, suggested: '30 3 * * *' },
  anomaly_detection: { label: 'Anomaly watch', description: 'Catches sudden drops in results or jumps in cost.', icon: Radar, suggested: '30 3 * * *' },
  weekly_report: { label: 'Weekly report', description: 'Monday summary: winners, losers, and next week\'s plan.', icon: FileBarChart, suggested: '30 3 * * 1' },
  reflection: { label: 'Learn from the week', description: 'Updates the agent\'s memory of what worked for your business.', icon: Brain, suggested: '30 3 * * 0' },
  custom: { label: 'Custom prompt', description: 'Run any instruction on a schedule.', icon: Wand2, suggested: '30 3 * * *' },
}

const PRESETS = [
  { value: '30 3 * * *', label: 'Every day' },
  { value: '30 3 * * 1', label: 'Mondays' },
  { value: '30 3 * * 0', label: 'Sundays' },
  { value: '30 3 1 * *', label: '1st of the month' },
]

function describeCron(expr: string): string {
  const p = PRESETS.find((x) => x.value === expr)
  if (p) return p.label
  return `cron ${expr}`
}

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export default function SchedulePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteFor, setDeleteFor] = useState<Job | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/schedule').then((r) => r.json()),
      fetch('/api/campaigns').then((r) => r.json()).catch(() => ({ campaigns: [] })),
    ]).then(([j, c]) => { if (cancelled) return; setJobs(j.jobs || []); setCampaigns(c.campaigns || []) })
      .catch(() => toast.error('Could not load automations'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [reloadKey])

  async function toggle(job: Job) {
    const status = job.status === 'active' ? 'paused' : 'active'
    setBusyId(job.id)
    try {
      const res = await fetch(`/api/schedule/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Update failed')
      setJobs((prev) => prev.map((x) => (x.id === job.id ? { ...x, ...j.job } : x)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally { setBusyId(null) }
  }

  async function remove(job: Job) {
    const res = await fetch(`/api/schedule/${job.id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Could not delete'); throw new Error('delete failed') }
    setJobs((prev) => prev.filter((x) => x.id !== job.id))
    toast.success('Automation removed')
  }

  if (loading) return <PageSkeleton rows={3} />

  const active = jobs.filter((j) => j.status === 'active').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automations"
        description="Routines the agent runs on its own. Anything that moves money still goes through approval."
        meta={active > 0 ? <StatusPill tone="good">{active} running</StatusPill> : <StatusPill tone="neutral">Nothing scheduled</StatusPill>}
        actions={<Button onClick={() => setShowCreate(true)}><Plus aria-hidden="true" className="mr-1.5 h-4 w-4" /> Add automation</Button>}
      />

      <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        The scheduler wakes once a day at 06:00 IST and runs every routine that is due. Daily jobs run then; weekly and monthly ones on their day.
      </p>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState icon={CalendarClock} title="No automations yet" description="Start with the Morning check. It reads yesterday's numbers and tells you what to do before you have had chai." action={<Button onClick={() => setShowCreate(true)}><Plus aria-hidden="true" className="mr-1.5 h-4 w-4" /> Add automation</Button>} />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Automations">
          {jobs.map((job) => {
            const r = ROUTINES[job.type] ?? ROUTINES.custom
            const Icon = r.icon
            const on = job.status === 'active'
            const busy = busyId === job.id
            const camp = campaigns.find((c) => c.id === job.campaignId)
            return (
              <li key={job.id} className={`flex gap-3 rounded-xl border border-border bg-card p-4 ${on ? '' : 'opacity-75'}`}>
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}><Icon aria-hidden="true" className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{r.label}</h2>
                    <StatusPill tone={on ? 'good' : 'neutral'}>{on ? 'On' : 'Paused'}</StatusPill>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
                    <div><dt className="text-muted-foreground">Runs</dt><dd className="font-medium">{describeCron(job.cronExpression)}</dd></div>
                    <div><dt className="text-muted-foreground">Next</dt><dd className="font-medium tabular">{on ? fmt(job.nextRunAt) : '—'}</dd></div>
                    <div><dt className="text-muted-foreground">Last</dt><dd className="font-medium tabular">{fmt(job.lastRunAt)}</dd></div>
                  </dl>
                  {camp && <p className="text-xs text-muted-foreground">Scoped to {camp.name}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button size="sm" variant="ghost" onClick={() => toggle(job)} disabled={busy} aria-label={on ? 'Pause' : 'Resume'} title={on ? 'Pause' : 'Resume'}>
                    {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : on ? <Pause aria-hidden="true" className="h-4 w-4" /> : <Play aria-hidden="true" className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteFor(job)} disabled={busy} aria-label="Delete" title="Delete" className="text-muted-foreground hover:text-[var(--status-critical-ink)]"><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <CreateDialog open={showCreate} onOpenChange={setShowCreate} campaigns={campaigns} existing={jobs.map((j) => j.type)} onDone={() => setReloadKey((k) => k + 1)} />
      <ConfirmDialog open={Boolean(deleteFor)} onOpenChange={(o) => !o && setDeleteFor(null)} title="Remove this automation?" description="It stops running. Nothing already done is undone." confirmLabel="Remove" destructive onConfirm={() => (deleteFor ? remove(deleteFor) : undefined)} />
    </div>
  )
}

function CreateDialog({ open, onOpenChange, campaigns, existing, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; campaigns: Campaign[]; existing: string[]; onDone: () => void }) {
  const [type, setType] = useState('morning_optimization')
  const [cron, setCron] = useState(ROUTINES.morning_optimization.suggested)
  const [customCron, setCustomCron] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [promptError, setPromptError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const custom = !PRESETS.some((p) => p.value === cron)

  async function submit() {
    const expr = custom ? customCron.trim() : cron
    if (!/^(\S+\s+){4}\S+$/.test(expr)) { setError('A cron expression has five parts, e.g. 30 3 * * 1'); return }
    setError(null)
    // A custom routine with no instruction would run and do nothing.
    if (type === 'custom' && prompt.trim().length < 10) { setPromptError('Tell the agent what to do, in a sentence or two.'); return }
    setPromptError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, cronExpression: expr, campaignId: campaignId || null, config: type === 'custom' ? { prompt: prompt.trim() } : null }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not create')
      toast.success(`${ROUTINES[type].label} scheduled`)
      onOpenChange(false); onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an automation</DialogTitle>
          <DialogDescription>Pick a routine and how often it runs.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Routine">
            {Object.entries(ROUTINES).map(([value, r]) => {
              const Icon = r.icon
              const on = type === value
              const dup = existing.includes(value)
              return (
                <button key={value} type="button" role="radio" aria-checked={on} onClick={() => { setType(value); setCron(r.suggested) }}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/30'}`}>
                  <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${on ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.label}{dup && <span className="ml-2 text-xs font-normal text-muted-foreground">already added</span>}</p>
                    <p className="text-xs leading-snug text-muted-foreground">{r.description}</p>
                  </div>
                </button>
              )
            })}
          </div>

          {type === 'custom' && (
            <TextAreaField
              label="What should the agent do?"
              required
              rows={3}
              value={prompt}
              onChange={(v) => { setPrompt(v); setPromptError(null) }}
              error={promptError}
              placeholder="e.g. Check yesterday's ads. If any ad's cost per result rose more than 30%, pause it and tell me why."
              hint="Written like a message to the agent. Spend changes still follow your approval and budget rules."
            />
          )}

          <Field label="How often">
            {() => <ChipGroup size="sm" value={custom ? 'custom' : cron} onChange={(v) => { if (!v) return; if (v === 'custom') { setCron(''); setCustomCron('30 3 * * *') } else setCron(v as string) }} options={[...PRESETS, { value: 'custom', label: 'Custom cron' }]} />}
          </Field>
          <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
            The scheduler checks once a day at 06:00 IST, so a routine runs at the first check after it falls due. Hourly checks need the n8n heartbeat or Vercel Pro.
          </p>
          {custom && <TextField label="Cron expression" value={customCron} onChange={setCustomCron} error={error} hint="minute hour day month weekday, in UTC. 30 3 * * 1 is Monday 09:00 IST." />}

          {campaigns.length > 0 && (
            <Field label="Only for one campaign" hint="Optional. Leave blank to cover the whole account.">
              {({ id }) => (
                <Select value={campaignId} onValueChange={(v) => setCampaignId(v ?? '')}>
                  <SelectTrigger id={id} className="h-10 w-full"><SelectValue placeholder="Whole account" /></SelectTrigger>
                  <SelectContent>{campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />} Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
