'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Link2,
  Megaphone,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wallet,
} from 'lucide-react'
import {
  Delta,
  EmptyState,
  PacingBar,
  PageHeader,
  Section,
  StatTile,
  StatusPill,
  formatCompact,
  formatCurrency,
  type StatusTone,
} from '@/components/ui/metric'
import dynamic from 'next/dynamic'
import type { TrendPoint } from '@/components/charts/trend-chart'

// Client-only. Recharts writes colours into SVG presentation attributes, which
// cannot read CSS custom properties, so the hue is resolved in JS — and the
// server has no theme to resolve against. Server-rendering the plot would
// mismatch on hydration every single load.
const TrendChart = dynamic(() => import('@/components/charts/trend-chart').then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <div className="h-[300px] animate-pulse rounded-lg bg-muted" />,
})

/**
 * The dashboard answers four questions, in the order a business owner asks
 * them when they open the app:
 *
 *   1. Is anything waiting on me?      (approvals — the only interruptive item)
 *   2. Am I within budget?             (pacing — prevents the disaster)
 *   3. Is it working?                  (ROAS against the target they set)
 *   4. What changed, and what's next?  (trend, then creatives to review)
 *
 * The previous version opened with five identically-weighted stat cards and
 * two equally-sized charts, which is the same as having no hierarchy: the
 * client had to read everything to find the one thing that mattered.
 */

interface Approval {
  id: string
  summary: string
  risk: 'low' | 'medium' | 'high'
  toolName: string
  createdAt: string | null
  expiresAt: string | null
}

interface DashboardData {
  connected: boolean
  adAccount?: { name: string; accountId: string; currency: string; status: string }
  stats?: {
    totalSpend: number
    totalRevenue: number
    totalImpressions: number
    totalClicks: number
    totalConversions: number
    ctr: number
    cpc: number
    cpa: number
    roas: number
    roasNote: string | null
  }
  performanceData?: Array<{ date: string; spend: number; revenue: number }>
  recentCreatives?: Array<{
    id: string
    title: string
    status: string
    reviewStatus: string
    createdAt: string
  }>
  campaignCount?: number
  strategy?: { targetRoas: number; targetCpa: number | null; autoOptimize: boolean; focus: string | null } | null
  approvals?: Approval[]
  pendingApprovals?: number
  pacing?: { spentToday: number; spentThisMonth: number; dailyCap: number | null; monthlyCap: number | null }
  deltas?: Partial<Record<'spend' | 'revenue' | 'roas' | 'conversions' | 'cpa' | 'ctr', number | null>>
  aiConfigured: boolean
  lastSyncedAt?: string | null
}

const EMPTY_STATS = {
  totalSpend: 0, totalRevenue: 0, totalImpressions: 0, totalClicks: 0,
  totalConversions: 0, ctr: 0, cpc: 0, cpa: 0, roas: 0, roasNote: null,
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `reloadKey` is the effect's only trigger. Retry and Sync bump it rather
  // than calling a fetch function directly, which keeps every setState inside
  // the effect that owns it.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false

    async function fetchDashboard() {
      try {
        const res = await fetch('/api/dashboard')
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(json.error || 'Failed to load dashboard')
        setData(json)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDashboard()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  async function handleSync() {
    setSyncing(true)
    try {
      await fetch('/api/meta/insights?level=campaign&datePreset=last_30d')
      reload()
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <DashboardSkeleton />

  // ── Not connected: one job, one path ────────────────────────────────
  if (!data?.connected) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-10">
        <PageHeader
          title="Let's get your ads running"
          description="Three steps, then the AI Manager can build and run campaigns for you."
        />
        <ol className="space-y-3">
          <SetupStep
            n={1}
            done={false}
            icon={Link2}
            title="Connect your Meta Ads account"
            description="So the platform can read performance and publish campaigns."
            href="/connect"
            cta="Connect"
          />
          <SetupStep
            n={2}
            done={Boolean(data?.aiConfigured)}
            icon={Sparkles}
            title="Set up the AI brain"
            description="Pick a provider and add an API key. This writes the Marathi ad copy and images."
            href="/settings"
            cta="Configure"
          />
          <SetupStep
            n={3}
            done={false}
            icon={Wallet}
            title="Set your budget guardrails"
            description="A daily and monthly cap. The platform refuses to spend past them."
            href="/settings"
            cta="Set limits"
          />
        </ol>
        {error && <ErrorBanner message={error} onRetry={reload} />}
      </div>
    )
  }

  const stats = data.stats ?? EMPTY_STATS
  const pacing = data.pacing ?? { spentToday: 0, spentThisMonth: 0, dailyCap: null, monthlyCap: null }
  const deltas = data.deltas ?? {}
  const currency = data.adAccount?.currency || 'INR'
  const targetRoas = data.strategy?.targetRoas ?? null
  const approvals = data.approvals ?? []

  const trend: TrendPoint[] = (data.performanceData ?? []).map((d) => ({
    date: d.date,
    spend: d.spend,
    revenue: d.revenue,
  }))

  // ROAS is the headline, so it gets a verdict rather than a bare number.
  const hasRevenue = stats.totalRevenue > 0
  const roasTone: StatusTone = !hasRevenue
    ? 'neutral'
    : targetRoas == null
      ? 'neutral'
      : stats.roas >= targetRoas
        ? 'good'
        : stats.roas >= targetRoas * 0.75
          ? 'warning'
          : 'critical'

  const roasVerdict = !hasRevenue
    ? 'No revenue tracked yet'
    : targetRoas == null
      ? 'No target set'
      : stats.roas >= targetRoas
        ? `Above your ${targetRoas}x target`
        : `Below your ${targetRoas}x target`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`${data.adAccount?.name || 'Ad account'} · last 30 days`}
        meta={
          <>
            {data.strategy?.autoOptimize ? (
              <StatusPill tone="warning" icon={ShieldAlert}>Auto-optimize on</StatusPill>
            ) : (
              <StatusPill tone="neutral" icon={BadgeCheck}>Approval required for spend</StatusPill>
            )}
            {data.lastSyncedAt && (
              <span className="text-xs text-muted-foreground">
                Synced {new Date(data.lastSyncedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
            <Button nativeButton={false} render={<Link href="/ai-manager" />}>
              <Sparkles aria-hidden="true" className="mr-2 h-4 w-4" />
              Ask the AI Manager
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {/* 1 ── Waiting on you. Above everything, because it is the only thing
             on this page that stops work until the client acts. */}
      {approvals.length > 0 && (
        <Section
          title={`${approvals.length} action${approvals.length === 1 ? '' : 's'} waiting for your approval`}
          description="These change live ad spend. Nothing happens until you approve."
          className="border-[var(--status-warning)]/40"
          action={
            <Button size="sm" nativeButton={false} render={<Link href="/ai-manager" />}>
              Review
              <ArrowRight aria-hidden="true" className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          }
        >
          <ul className="space-y-2">
            {approvals.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm">{a.summary}</p>
                  {a.expiresAt && (
                    <p className="text-xs text-muted-foreground">
                      Expires {new Date(a.expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  )}
                </div>
                <StatusPill tone={a.risk === 'high' ? 'critical' : a.risk === 'medium' ? 'warning' : 'neutral'}>
                  {a.risk} risk
                </StatusPill>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 2 ── Budget. The guardrail made visible: these are the same numbers
             the server enforces, so the limit is something the client can see
             rather than something they have to trust. */}
      <Section
        title="Budget pacing"
        description="Enforced in code — the AI cannot spend past these caps."
        action={
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/settings" />}>
            Adjust caps
          </Button>
        }
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <PacingBar label="Spent today" spent={pacing.spentToday} cap={pacing.dailyCap} currency={currency} />
          <PacingBar label="Spent this month" spent={pacing.spentThisMonth} cap={pacing.monthlyCap} currency={currency} />
        </div>
      </Section>

      {/* 3 ── Is it working? ROAS leads at double weight; the supporting
             measures sit beside it, deliberately smaller. */}
      <div className="grid gap-4 lg:grid-cols-4">
        <StatTile
          className="lg:col-span-1"
          emphasis
          label="Return on ad spend"
          value={hasRevenue ? `${stats.roas.toFixed(2)}x` : '—'}
          tone={roasTone === 'critical' ? 'critical' : roasTone === 'good' ? 'good' : undefined}
          delta={deltas.roas}
          sub={<StatusPill tone={roasTone}>{roasVerdict}</StatusPill>}
          footnote={stats.roasNote ?? undefined}
        />
        <StatTile
          label="Spend"
          value={formatCurrency(stats.totalSpend, currency)}
          delta={deltas.spend}
          deltaInvert
          sub="Last 30 days"
        />
        <StatTile
          label="Revenue"
          value={hasRevenue ? formatCurrency(stats.totalRevenue, currency) : '—'}
          delta={deltas.revenue}
          sub={hasRevenue ? 'Tracked conversion value' : 'Needs a Meta Pixel'}
        />
        <StatTile
          label="Cost per result"
          value={stats.totalConversions > 0 ? formatCurrency(stats.cpa, currency) : '—'}
          delta={deltas.cpa}
          deltaInvert
          sub={
            stats.totalConversions > 0
              ? `${formatCompact(stats.totalConversions)} results${data.strategy?.targetCpa ? ` · target ${formatCurrency(data.strategy.targetCpa, currency)}` : ''}`
              : 'No conversions tracked'
          }
        />
      </div>

      {/* 4 ── What changed. One chart, one axis, two series that share a unit. */}
      <Section title="Spend and revenue" description="Daily, last 30 days. The gap between the two lines is your profit.">
        {trend.length > 0 ? (
          <TrendChart data={trend} currency={currency} />
        ) : (
          <EmptyState
            icon={Megaphone}
            title="No performance data yet"
            description="Once a campaign is live and you sync from Meta, daily spend and revenue appear here."
            action={
              <Button variant="outline" onClick={handleSync} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync from Meta'}
              </Button>
            }
          />
        )}
      </Section>

      {/* 5 ── What's next. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Creatives awaiting review"
          description="Approve a creative before it can be published as an ad."
          action={
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/creatives" />}>
              All creatives
              <ArrowRight aria-hidden="true" className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          }
        >
          {data.recentCreatives?.length ? (
            <ul className="space-y-2">
              {data.recentCreatives.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <StatusPill
                    tone={c.reviewStatus === 'verified' ? 'good' : c.reviewStatus === 'not_verified' ? 'critical' : 'neutral'}
                  >
                    {c.reviewStatus === 'verified' ? 'Approved' : c.reviewStatus === 'not_verified' ? 'Needs work' : 'Pending'}
                  </StatusPill>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No creatives yet"
              description="Generate Marathi ad copy and a matching image in one step, then review before it goes live."
              action={
                <Button nativeButton={false} render={<Link href="/creatives" />}>Generate a creative</Button>
              }
            />
          )}
        </Section>

        <Section title="Account" description="Where things stand right now.">
          <dl className="divide-y divide-border text-sm">
            <Row label="Campaigns" value={String(data.campaignCount ?? 0)} />
            <Row label="Impressions (30d)" value={formatCompact(stats.totalImpressions)} />
            <Row
              label="Clicks (30d)"
              value={
                <span className="inline-flex items-center gap-2">
                  {formatCompact(stats.totalClicks)}
                  <span className="text-xs text-muted-foreground tabular">{stats.ctr.toFixed(2)}% CTR</span>
                  <Delta value={deltas.ctr} />
                </span>
              }
            />
            <Row label="Target ROAS" value={targetRoas ? `${targetRoas}x` : 'Not set'} />
            <Row
              label="AI brain"
              value={
                data.aiConfigured ? (
                  <StatusPill tone="good">Configured</StatusPill>
                ) : (
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/settings" />}>
                    Set up
                  </Button>
                )
              }
            />
          </dl>
        </Section>
      </div>
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular">{value}</dd>
    </div>
  )
}

function SetupStep({
  n, done, icon: Icon, title, description, href, cta,
}: {
  n: number
  done: boolean
  icon: typeof Link2
  title: string
  description: string
  href: string
  cta: string
}) {
  return (
    <li className="flex items-start gap-4 rounded-xl border border-border bg-card p-4">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold tabular ${
          done ? 'border-[var(--status-good)]/30 bg-[var(--status-good)]/10 text-[var(--status-good-ink)]' : 'border-border bg-muted text-muted-foreground'
        }`}
      >
        {done ? <BadgeCheck aria-hidden="true" className="h-4 w-4" /> : n}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button variant={done ? 'ghost' : 'default'} size="sm" nativeButton={false} render={<Link href={href} />}>
        <Icon aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
        {done ? 'Review' : cta}
      </Button>
    </li>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-xl border border-[var(--status-critical)]/30 bg-[var(--status-critical)]/8 p-4"
    >
      <div className="flex items-start gap-3">
        <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-critical-ink)]" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Could not load your dashboard</p>
          <p className="text-xs text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-32 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}
