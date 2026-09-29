'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { TerminalSquare, Users, Link2, Coins, AlertTriangle, Bot, RefreshCw, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader, Section, StatTile, EmptyState } from '@/components/ui/metric'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AccountDetail, when } from '@/components/admin/account-detail'
import { TestBench } from '@/components/admin/test-bench'
import { cn } from '@/lib/utils'

/**
 * Developer console — every business on the platform, live, for the
 * developer only (DEVELOPER_EMAILS). Read-only across businesses; the test
 * bench acts on the developer's own account.
 */

interface Account {
  userId: string
  email: string | null
  developer: boolean
  createdAt: string
  confirmed: boolean
  lastActive: string | null
  businessName: string | null
  onboardingComplete: boolean
  hasLandingUrl: boolean
  ai: { provider: string; model: string } | null
  meta: { adAccountId: string; adAccountName: string | null } | null
  chats7d: number
  routines7d: number
  actions7d: number
  errors7d: number
  agentRuns7d: number
  pendingApprovals: number
  campaigns: number
  liveCampaigns: number
  creatives: number
  costUsd30d: number
}

interface Overview {
  generatedAt: string
  fx: { rate: number } | null
  totals: { accounts: number; active7d: number; withMeta: number; costUsd30d: number; errors7d: number; agentRuns7d: number }
  accounts: Account[]
  suggestions: Array<{ userId: string; statement: string; evidence: string; occurrences: number; lastSeen: string }>
}

export default function DeveloperConsolePage() {
  const [data, setData] = useState<Overview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading')
  const [refreshing, setRefreshing] = useState(false)
  // Kept after closing so the dialog does not empty out while it fades.
  const [open, setOpen] = useState<Account | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async (): Promise<{ denied: true } | { data: Overview }> => {
    const r = await fetch('/api/dev/overview')
    if (r.status === 404 || r.status === 401) return { denied: true }
    const j = await r.json()
    if (!r.ok) throw new Error(j?.error || 'Failed')
    return { data: j as Overview }
  }, [])

  const apply = useCallback((res: { denied: true } | { data: Overview }) => {
    if ('denied' in res) { setState('denied'); return }
    setData(res.data)
    setState('ready')
  }, [])

  useEffect(() => {
    let cancelled = false
    load()
      .then((res) => { if (!cancelled) apply(res) })
      .catch(() => toast.error('Could not load the console'))
    return () => { cancelled = true }
  }, [load, apply])

  async function refresh() {
    setRefreshing(true)
    try { apply(await load()) } catch { toast.error('Could not refresh') } finally { setRefreshing(false) }
  }

  if (state === 'denied') {
    return (
      <div className="space-y-6">
        <PageHeader icon={TerminalSquare} title="Developer console" />
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState icon={TerminalSquare} title="Not available" description="This page is only for the platform's developer." />
        </div>
      </div>
    )
  }
  if (state === 'loading' || !data) return <PageSkeleton rows={4} />

  const rate = data.fx?.rate ?? null
  const inr = (usd: number) => (rate ? `₹${(usd * rate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${usd.toFixed(4)}`)
  const me = data.accounts.find((a) => a.developer)
  const setupWarning = !me ? null
    : !me.ai ? 'Your account has no AI key yet, so agents and routines cannot run. Add one in Settings.'
      : !me.meta ? 'Your account is not connected to Meta, so anything that reads ads will fail. Connect it under Meta Connection.'
        : null

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TerminalSquare}
        title="Developer console"
        description="Every business on the platform, live. Read-only; only you can see this."
        meta={<span className="text-xs text-muted-foreground">Updated {when(data.generatedAt)}</span>}
        actions={
          <>
            <Button variant="outline" render={<Link href="/admin/costs" />} nativeButton={false}>
              <Coins aria-hidden="true" className="mr-1.5 h-4 w-4" /> Running cost
            </Button>
            <Button variant="outline" onClick={refresh} disabled={refreshing} aria-label="Refresh">
              <RefreshCw aria-hidden="true" className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile emphasis icon={Users} label="Businesses" value={data.totals.accounts} sub={`${data.totals.active7d} active this week`} />
        <StatTile icon={Link2} label="Connected to Meta" value={data.totals.withMeta} />
        <StatTile icon={Coins} label="AI cost, 30 days" value={inr(data.totals.costUsd30d)} />
        <StatTile icon={Bot} label="Agent runs, 7 days" value={data.totals.agentRuns7d} />
        <StatTile icon={AlertTriangle} label="Errors, 7 days" value={data.totals.errors7d} tone={data.totals.errors7d > 0 ? 'warning' : undefined} />
      </div>

      <Tabs defaultValue="businesses" className="gap-4">
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="businesses">Businesses</TabsTrigger>
          <TabsTrigger value="bench">Test bench</TabsTrigger>
        </TabsList>

        <TabsContent value="businesses" className="space-y-6">
          {data.suggestions?.length > 0 && (
            <Section title="Improvement ideas from the AI" description="Each business's weekly learning review flags problems the software itself caused. Read-only; fix them in code.">
              <ul className="space-y-2">
                {data.suggestions.map((s, i) => {
                  const who = data.accounts.find((a) => a.userId === s.userId)
                  return (
                    <li key={i} className="rounded-xl border border-border px-3 py-2.5 text-sm">
                      <p>{s.statement}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {who?.businessName || who?.email || s.userId.slice(0, 8)} · {when(s.lastSeen)}{s.occurrences > 1 ? ` · raised ${s.occurrences}×` : ''}{s.evidence ? ` · ${s.evidence}` : ''}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}
          <Section title="All businesses" description="Most recently active first. Open one to see its setup, chats, actions and agent runs.">
            <div className="relative -mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Business</th>
                    <th className="py-2 pr-4 font-medium">Setup</th>
                    <th className="py-2 pr-4 text-right font-medium">Chats 7d</th>
                    <th className="py-2 pr-4 text-right font-medium">Errors 7d</th>
                    <th className="py-2 pr-4 text-right font-medium">AI cost 30d</th>
                    <th className="py-2 font-medium">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.userId} className="border-b border-border/60 last:border-0">
                      <td className="max-w-[16rem] py-2.5 pr-4">
                        <button
                          type="button"
                          onClick={() => { setOpen(a); setDialogOpen(true) }}
                          className="block w-full min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="block truncate font-medium text-primary underline-offset-2 hover:underline">
                            {a.businessName || a.email || a.userId.slice(0, 8)}
                            {a.developer && <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground no-underline">you</span>}
                          </span>
                          {a.businessName && a.email && <span className="block truncate text-xs text-muted-foreground">{a.email}</span>}
                          {!a.confirmed && <span className="block text-xs text-amber-700 dark:text-amber-300">email not confirmed</span>}
                        </button>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex flex-wrap gap-1.5">
                          <SetupChip ok={Boolean(a.ai)} label="AI" />
                          <SetupChip ok={Boolean(a.meta)} label="Meta" />
                          <SetupChip ok={a.onboardingComplete} label="Profile" />
                          <SetupChip ok={a.hasLandingUrl} label="Landing" />
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular">{a.chats7d}{a.routines7d ? <span className="text-xs text-muted-foreground"> +{a.routines7d} auto</span> : null}</td>
                      <td className={cn('py-2.5 pr-4 text-right tabular', a.errors7d > 0 && 'font-medium text-[var(--status-critical-ink)] dark:text-red-300')}>{a.errors7d}</td>
                      <td className="py-2.5 pr-4 text-right tabular">{inr(a.costUsd30d)}</td>
                      <td className="py-2.5 text-xs text-muted-foreground tabular">{when(a.lastActive)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="bench">
          <TestBench setupWarning={setupWarning} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          {open && (
            <>
              <DialogHeader className="border-b border-border px-5 py-4">
                <DialogTitle>{open.businessName || open.email}</DialogTitle>
                <DialogDescription>
                  {open.email} · {open.campaigns} campaign{open.campaigns === 1 ? '' : 's'} ({open.liveCampaigns} on Meta) · {open.creatives} creative{open.creatives === 1 ? '' : 's'} · {open.pendingApprovals} waiting approval
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <AccountDetail userId={open.userId} inr={inr} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SetupChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
      ok ? 'border-[var(--status-good)]/35 text-[var(--status-good-ink)] dark:text-green-300' : 'border-border text-muted-foreground',
    )}>
      {ok ? <Check aria-hidden="true" className="h-3 w-3" /> : <X aria-hidden="true" className="h-3 w-3" />}
      {label}
      <span className="sr-only">{ok ? 'set up' : 'missing'}</span>
    </span>
  )
}
