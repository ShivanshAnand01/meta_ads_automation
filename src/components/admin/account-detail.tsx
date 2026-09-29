'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Bot, MessageSquare, Repeat, Loader2 } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { StatusPill, type StatusTone } from '@/components/ui/metric'
import { getSpecialist } from '@/lib/ai/agents/registry'
import { sourceLabel } from '@/lib/ai/usage-labels'
import { cn } from '@/lib/utils'

/* Read-only view of one business, for the developer console. */

interface Detail {
  account: { userId: string; email: string | null; createdAt: string; confirmed: boolean; lastSignIn: string | null }
  profile: Record<string, unknown> | null
  ai: { provider: string; model: string; hasApiKey: boolean; hasEmbeddingKey: boolean } | null
  meta: { app_id: string; ad_account_id: string; ad_account_name: string; ad_account_currency: string; token_expiry: string | null; last_validated_at: string | null } | null
  conversations: Array<{ id: string; title: string; autonomous: boolean; updated_at: string }>
  actions: Array<{ tool: string; status: string; actor: string; at: string; arguments: string; result: string }>
  agentRuns: Array<{ id: string; agent: string; mode: string; status: string; brief: string; report: { summary?: string; findings?: Array<{ finding: string; evidence?: string }>; recommendations?: string[] } | null; error: string | null; model: string | null; cost_usd: number; created_at: string }>
  approvals: Array<{ tool_name: string; summary: string; risk: string; status: string; created_at: string }>
  jobs: Array<{ type: string; cron_expression: string; status: string; last_run_at: string | null; next_run_at: string | null }>
  cost30d: Array<{ source: string; calls: number; costUsd: number }>
  learnings: Array<{ kind: string; statement: string; status: string; occurrences: number; source: string; last_seen: string }>
}

interface Transcript {
  conversation: { title: string; autonomous: boolean }
  messages: Array<{ role: string; content: string; toolName: string | null; tools: string[]; at: string }>
}

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

const statusTone = (s: string): StatusTone =>
  s === 'success' || s === 'done' || s === 'approved' || s === 'active' ? 'good'
    : s === 'error' || s === 'failed' || s === 'rejected' ? 'critical'
      : s === 'pending' || s === 'queued' || s === 'running' ? 'warning' : 'neutral'

export function AccountDetail({ userId, inr }: { userId: string; inr: (usd: number) => string }) {
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openConv, setOpenConv] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/dev/accounts/${userId}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Failed'); if (!cancelled) setData(j) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed') })
    return () => { cancelled = true }
  }, [userId])

  if (error) return <p role="alert" className="text-sm text-[var(--status-critical-ink)]">{error}</p>
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading…</p>
  if (openConv) return <TranscriptView id={openConv} onBack={() => setOpenConv(null)} />

  const p = data.profile as Record<string, string | boolean | string[] | null> | null
  const failures = data.actions.filter((a) => a.status === 'error')

  return (
    <Tabs defaultValue="setup" className="gap-4">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="setup">Setup</TabsTrigger>
        <TabsTrigger value="activity">Chats</TabsTrigger>
        <TabsTrigger value="actions">
          Actions
          {failures.length > 0 && (
            <span className="ml-1.5 rounded-md bg-[var(--status-critical)]/15 px-1.5 text-[11px] font-medium text-[var(--status-critical-ink)] dark:text-red-300">
              {failures.length}<span className="sr-only"> failed</span>
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
        <TabsTrigger value="learnings">Learned</TabsTrigger>
      </TabsList>

      <TabsContent value="setup" className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Account" value={data.account.email ?? data.account.userId} sub={`Joined ${when(data.account.createdAt)} · ${data.account.confirmed ? 'email confirmed' : 'email NOT confirmed'} · last sign-in ${when(data.account.lastSignIn)}`} />
          <Fact label="Business" value={(p?.business_name as string) || 'No profile yet'} sub={p ? `${p.primary_language_label ?? p.primary_language ?? '?'} · ${[...((p.market_cities as string[]) ?? []), ...((p.market_regions as string[]) ?? [])].join(', ') || (p.market_country as string) || '?'} · ${p.onboarding_complete ? 'onboarded' : 'onboarding not finished'}` : 'The AI Manager will onboard them in chat'} />
          <Fact label="AI" value={data.ai ? `${data.ai.provider} · ${data.ai.model}` : 'Not set up'} sub={data.ai ? `API key ${data.ai.hasApiKey ? 'saved' : 'MISSING'}` : 'Chat and agents cannot run'} warn={!data.ai || !data.ai.hasApiKey} />
          <Fact label="Meta" value={data.meta ? `${data.meta.ad_account_name ?? 'Ad account'} (act_${data.meta.ad_account_id})` : 'Not connected'} sub={data.meta ? `Token expires ${when(data.meta.token_expiry)} · ${data.meta.ad_account_currency ?? ''}` : 'Meta tools will fail'} warn={!data.meta} />
          <Fact label="Landing page" value={(p?.landing_url as string) || 'Not set'} sub="Publishing refuses without one" warn={!p?.landing_url} />
          <Fact label="Website" value={(p?.website_url as string) || '—'} />
        </dl>

        <MiniTable
          title="AI cost, last 30 days"
          empty="No metered AI calls yet."
          head={['Feature', 'Calls', 'Cost']}
          rows={data.cost30d.map((c) => [sourceLabel(c.source), String(c.calls), `${inr(c.costUsd)} · $${c.costUsd.toFixed(4)}`])}
        />
        <MiniTable
          title="Scheduled routines"
          empty="No routines scheduled."
          head={['Routine', 'Schedule', 'Next run']}
          rows={data.jobs.map((j) => [j.type.replace(/_/g, ' '), `${j.cron_expression} · ${j.status}`, when(j.next_run_at)])}
        />
        <MiniTable
          title="Approvals"
          empty="Nothing waiting for approval."
          head={['Action', 'Status', 'Asked']}
          rows={data.approvals.map((a) => [a.summary || a.tool_name, <StatusPill key="s" tone={statusTone(a.status)}>{a.status}</StatusPill>, when(a.created_at)])}
        />
      </TabsContent>

      <TabsContent value="activity">
        {data.conversations.length === 0 ? <p className="text-sm text-muted-foreground">No conversations yet.</p> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {data.conversations.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setOpenConv(c.id)} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {c.autonomous ? <Repeat aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /> : <MessageSquare aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{c.title || 'Untitled'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">{when(c.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="actions">
        {data.actions.length === 0 ? <p className="text-sm text-muted-foreground">The AI has not run any tools yet.</p> : (
          <ul className="space-y-2">
            {data.actions.map((a, i) => (
              <li key={i} className={cn('rounded-xl border px-3 py-2 text-sm', a.status === 'error' ? 'border-[var(--status-critical)]/30 bg-[var(--status-critical)]/5' : 'border-border')}>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[13px] font-medium">{a.tool}</code>
                  <StatusPill tone={statusTone(a.status)}>{a.status}</StatusPill>
                  <span className="text-xs text-muted-foreground">{a.actor}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular">{when(a.at)}</span>
                </div>
                {a.status === 'error' && a.result && <p className="mt-1 break-words text-xs text-[var(--status-critical-ink)] dark:text-red-300">{a.result}</p>}
                {a.arguments && a.arguments !== '{}' && a.arguments !== '""' && <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">{a.arguments}</p>}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="agents">
        {data.agentRuns.length === 0 ? <p className="text-sm text-muted-foreground">No agent runs yet.</p> : (
          <ul className="space-y-3">
            {data.agentRuns.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Bot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{getSpecialist(r.agent)?.name ?? r.agent}</span>
                  <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>
                  <span className="text-xs text-muted-foreground">{r.mode} · {r.model ?? '—'} · {inr(Number(r.cost_usd))}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular">{when(r.created_at)}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Brief:</span> {r.brief}</p>
                {r.error && <p className="mt-1.5 text-xs text-[var(--status-critical-ink)] dark:text-red-300">{r.error}</p>}
                {r.report?.summary && <p className="mt-1.5">{r.report.summary}</p>}
                {!!r.report?.findings?.length && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-foreground/85">
                    {r.report.findings.slice(0, 5).map((f, i) => <li key={i}>{f.finding}{f.evidence ? <span className="text-muted-foreground"> — {f.evidence}</span> : null}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="learnings">
        {(data.learnings ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nothing learned yet.</p> : (
          <ul className="space-y-2">
            {data.learnings.map((l, i) => (
              <li key={i} className="rounded-xl border border-border px-3 py-2 text-sm">
                <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">{l.kind.replace(/_/g, ' ')}</span>
                  <StatusPill tone={l.status === 'active' ? (l.kind === 'pitfall' ? 'warning' : 'good') : 'neutral'}>{l.status}</StatusPill>
                  <span>{l.source}</span>
                  {l.occurrences > 1 && <span>· {l.occurrences}×</span>}
                  <span className="ml-auto tabular">{when(l.last_seen)}</span>
                </div>
                <p>{l.statement}</p>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  )
}

function Fact({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-xl border px-3 py-2.5', warn ? 'border-[var(--status-warning)]/40 bg-[var(--status-warning)]/5' : 'border-border')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium" title={value}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted-foreground">{sub}</dd>}
    </div>
  )
}

function MiniTable({ title, head, rows, empty }: { title: string; head: [string, string, string]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <div className="relative -mx-1 overflow-x-auto px-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                {head.map((h, i) => <th key={h} className={cn('py-1.5 font-medium', i < 2 && 'pr-4', i === 2 && 'text-right')}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4">{cells[0]}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{cells[1]}</td>
                  <td className="py-2 text-right tabular">{cells[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TranscriptView({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<Transcript | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/dev/conversations/${id}`).then((r) => r.json()).then((j) => { if (!cancelled) setData(j) }).catch(() => {})
    return () => { cancelled = true }
  }, [id])

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
      </button>
      {!data ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading…</p> : (
        <>
          <h3 className="font-semibold">{data.conversation?.title || 'Conversation'}</h3>
          <ol className="space-y-2">
            {data.messages.map((m, i) => (
              <li key={i} className={cn(
                'rounded-xl px-3 py-2 text-sm',
                m.role === 'user' ? 'ml-6 bg-primary/10' : m.role === 'tool' ? 'border border-dashed border-border font-mono text-[11px] text-muted-foreground' : 'mr-6 bg-muted/60',
              )}>
                <p className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {m.role === 'tool' ? `tool · ${m.toolName ?? ''}` : m.role} · {when(m.at)}
                  {m.tools.length > 0 && <> · called {m.tools.join(', ')}</>}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.content || (m.tools.length ? '(tool calls only)' : '')}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
